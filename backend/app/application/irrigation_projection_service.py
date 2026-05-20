from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.application.schemas import (
    AdaptiveIrrigationPlan,
    IrrigationProjectionItem,
    IrrigationProjectionResponse,
    ZoneIrrigationProfile,
)
from app.application.weather_service import WeatherService
from app.config import Settings
from app.domain.adaptive_irrigation import expand_time_windows, WINDOW_STARTS, decide_adaptive_plan
from app.domain.models import RunStatus, TriggerType
from app.domain.services import schedule_occurrences
from app.domain.timezone import app_timezone
from app.domain.zone_irrigation import ZoneWeatherFacts
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import ScheduleRepository, ZoneRepository


@dataclass(slots=True)
class _Candidate:
    zone_id: int
    zone_name: str
    source: str
    original_start: datetime
    duration_minutes: int
    reason: str
    schedule_id: int | None = None
    status: str = "planned"
    weather_summary: str | None = None
    decision_summary: str | None = None
    decision_details: list[str] | None = None
    weather_basis: dict | None = None


class IrrigationProjectionService:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings
        self.zones = ZoneRepository(session)
        self.schedules = ScheduleRepository(session)
        self.weather = WeatherService(session, settings)

    def build_projection(self, *, days: int = 7, now: datetime | None = None) -> IrrigationProjectionResponse:
        generated_at = now or datetime.now(UTC)
        if generated_at.tzinfo is None:
            generated_at = generated_at.replace(tzinfo=UTC)
        schedule_now = generated_at.astimezone(app_timezone(self.settings))
        days = max(1, min(days, 14))
        app_settings = self.weather.get_settings()
        weather_lookup = self.weather.try_fetch_current_lookup(app_settings=app_settings) if app_settings.weather_enabled else None
        weather_summary = weather_lookup.summary if weather_lookup else None
        weather_status = weather_lookup.source_status if weather_lookup else "unavailable"
        candidates = self._manual_rule_candidates(now=schedule_now, days=days, app_settings=app_settings)
        candidates.extend(self._adaptive_rule_candidates(now=schedule_now, days=days, weather_summary=weather_summary, source_status=weather_status))
        items = self._sequence_candidates(candidates)
        return IrrigationProjectionResponse(
            generated_at=generated_at,
            days=days,
            weather_source_status=weather_status,
            items=items,
        )

    def next_available_start(self, *, candidate_start: datetime, duration_minutes: int, zone_id: int) -> datetime:
        if candidate_start.tzinfo is None:
            candidate_start = candidate_start.replace(tzinfo=app_timezone(self.settings))
        candidates = []
        for run in self._planned_runs_on_day(candidate_start):
            if run.zone_id == zone_id:
                continue
            start = datetime.combine(run.scheduled_for, run.scheduled_time, tzinfo=candidate_start.tzinfo)
            candidates.append(
                _Candidate(
                    zone_id=run.zone_id,
                    zone_name="",
                    source="manual_rule" if run.schedule_id else "adaptive_rule",
                    original_start=start,
                    duration_minutes=run.requested_duration_minutes,
                    reason=run.reason or "",
                    schedule_id=run.schedule_id,
                )
            )
        candidates.append(
            _Candidate(
                zone_id=zone_id,
                zone_name="",
                source="adaptive_rule",
                original_start=candidate_start,
                duration_minutes=duration_minutes,
                reason="",
            )
        )
        sequenced = self._sequence_candidates(candidates)
        matching = [
            item
            for item in sequenced
            if item.zone_id == zone_id
            and item.original_start == candidate_start
            and item.duration_minutes == duration_minutes
        ]
        return matching[0].planned_start if matching else candidate_start

    def _manual_rule_candidates(self, *, now: datetime, days: int, app_settings: orm.AppSetting) -> list[_Candidate]:
        zones_by_id = {zone.id: zone for zone in self.zones.list()}
        candidates: list[_Candidate] = []
        for schedule in self.schedules.list_active():
            zone = zones_by_id.get(schedule.zone_id)
            if not zone or not zone.active or zone.scheduling_mode == "adaptive":
                continue
            for start in schedule_occurrences(schedule, start=now, days=days):
                candidates.append(
                    _Candidate(
                        zone_id=zone.id,
                        zone_name=zone.name,
                        schedule_id=schedule.id,
                        source="manual_rule",
                        original_start=start,
                        duration_minutes=min(schedule.duration_minutes, zone.max_duration_minutes),
                        reason="Manuell angelegte Regel.",
                        weather_summary=self._weather_text(
                            enabled=app_settings.weather_enabled and (schedule.weather_enabled or zone.weather_enabled),
                            source_status=None,
                        ),
                        decision_summary="Manuelle Regel: Uhrzeit und Dauer sind fest vorgegeben.",
                        decision_details=[],
                    )
                )
        return candidates

    def _adaptive_rule_candidates(self, *, now: datetime, days: int, weather_summary, source_status: str) -> list[_Candidate]:
        candidates: list[_Candidate] = []
        weather = ZoneWeatherFacts(
            temperature_max_c=weather_summary.temperature_max_24h_c if weather_summary else None,
            rain_last_24h_mm=weather_summary.precipitation_last_24h_mm if weather_summary else None,
            rain_next_24h_mm=weather_summary.precipitation_next_24h_mm if weather_summary else None,
            cloud_cover_avg_pct=weather_summary.cloud_cover_avg_pct if weather_summary else None,
        )
        for zone in self.zones.list():
            if not zone.active or zone.scheduling_mode != "adaptive" or not zone.adaptive_irrigation_plan_json or not zone.irrigation_profile_json:
                continue
            profile = ZoneIrrigationProfile.model_validate(zone.irrigation_profile_json)
            plan = AdaptiveIrrigationPlan.model_validate(zone.adaptive_irrigation_plan_json)
            simulated_last_run = self._last_adaptive_run_at(zone_id=zone.id)
            watered_days: set[datetime.date] = set()
            for slot in self._adaptive_slots(plan, now=now, days=days):
                if simulated_last_run and slot - simulated_last_run < timedelta(hours=plan.minIntervalHours):
                    continue
                already_watered_today = slot.date() in watered_days or self._has_adaptive_run_on_day(zone_id=zone.id, day=slot.date())
                decision = decide_adaptive_plan(
                    profile=profile,
                    plan=plan,
                    weather=weather,
                    now=slot,
                    last_run_at=simulated_last_run,
                    max_duration_minutes=zone.max_duration_minutes,
                    already_watered_today=already_watered_today,
                    model_config=self.settings.zone_irrigation_model_config(),
                )
                if not decision.scheduled_at:
                    continue
                status = "planned" if decision.should_plan else "skipped"
                duration = decision.duration_minutes if decision.should_plan else max(1, plan.baseDurationMinutes)
                candidates.append(
                    _Candidate(
                        zone_id=zone.id,
                        zone_name=zone.name,
                        source="adaptive_rule",
                        original_start=decision.scheduled_at,
                        duration_minutes=duration,
                        reason=decision.reason,
                        status=status,
                        weather_summary=self._weather_text(True, source_status=source_status if weather_summary else "unavailable"),
                        decision_summary=self._adaptive_decision_summary(decision.reason),
                        decision_details=decision.details,
                        weather_basis=self._weather_basis(
                            profile=profile,
                            plan=plan,
                            weather=weather,
                            source_status=source_status if weather_summary else "unavailable",
                            recommendation=decision.recommendation,
                            already_watered_today=already_watered_today,
                        ),
                    )
                )
                if decision.should_plan:
                    simulated_last_run = decision.scheduled_at + timedelta(minutes=duration)
                    watered_days.add(decision.scheduled_at.date())
        return candidates

    def _sequence_candidates(self, candidates: list[_Candidate]) -> list[IrrigationProjectionItem]:
        ordered = sorted(
            candidates,
            key=lambda item: (item.original_start, 0 if item.source == "manual_rule" else 1, item.zone_name.lower(), item.zone_id),
        )
        last_planned_end: datetime | None = None
        items: list[IrrigationProjectionItem] = []
        for candidate in ordered:
            planned_start = candidate.original_start
            if candidate.status == "planned" and last_planned_end and planned_start < last_planned_end:
                planned_start = last_planned_end
            planned_end = planned_start + timedelta(minutes=candidate.duration_minutes)
            if candidate.status == "planned":
                last_planned_end = planned_end
            items.append(
                IrrigationProjectionItem(
                    zone_id=candidate.zone_id,
                    zone_name=candidate.zone_name,
                    schedule_id=candidate.schedule_id,
                    source=candidate.source,  # type: ignore[arg-type]
                    status=candidate.status,  # type: ignore[arg-type]
                    planned_start=planned_start,
                    planned_end=planned_end,
                    original_start=candidate.original_start,
                    duration_minutes=candidate.duration_minutes,
                    reason=candidate.reason,
                    weather_summary=candidate.weather_summary,
                    decision_summary=candidate.decision_summary,
                    decision_details=candidate.decision_details or [],
                    weather_basis=candidate.weather_basis,
                    adjusted_for_sequence=planned_start != candidate.original_start,
                )
            )
        return items

    def _adaptive_slots(self, plan: AdaptiveIrrigationPlan, *, now: datetime, days: int) -> list[datetime]:
        slots: list[datetime] = []
        for day_offset in range(days + 1):
            target_date = (now + timedelta(days=day_offset)).date()
            for window in expand_time_windows(plan):
                start_time = WINDOW_STARTS.get(window)
                if not start_time:
                    continue
                slot = datetime.combine(target_date, start_time, tzinfo=now.tzinfo)
                if slot >= now:
                    slots.append(slot)
        return sorted(slots)

    def _planned_runs_on_day(self, day: datetime) -> list[orm.WateringRun]:
        return (
            self.session.query(orm.WateringRun)
            .filter(
                orm.WateringRun.scheduled_for == day.date(),
                orm.WateringRun.scheduled_time.is_not(None),
                orm.WateringRun.status.in_([RunStatus.PLANNED.value, RunStatus.RUNNING.value]),
            )
            .order_by(orm.WateringRun.scheduled_time.asc(), orm.WateringRun.created_at.asc())
            .all()
        )

    def _last_adaptive_run_at(self, *, zone_id: int) -> datetime | None:
        run = (
            self.session.query(orm.WateringRun)
            .filter(
                orm.WateringRun.zone_id == zone_id,
                orm.WateringRun.schedule_id.is_(None),
                orm.WateringRun.trigger_type == TriggerType.SCHEDULED.value,
                orm.WateringRun.reason.like("adaptive irrigation:%"),
                orm.WateringRun.status.in_([RunStatus.COMPLETED.value, RunStatus.RUNNING.value]),
            )
            .order_by(orm.WateringRun.created_at.desc())
            .first()
        )
        return run.finished_at or run.started_at if run else None

    def _has_adaptive_run_on_day(self, *, zone_id: int, day) -> bool:
        return (
            self.session.query(orm.WateringRun.id)
            .filter(
                orm.WateringRun.zone_id == zone_id,
                orm.WateringRun.schedule_id.is_(None),
                orm.WateringRun.trigger_type == TriggerType.SCHEDULED.value,
                orm.WateringRun.scheduled_for == day,
                orm.WateringRun.reason.like("adaptive irrigation:%"),
                orm.WateringRun.status.in_([RunStatus.PLANNED.value, RunStatus.RUNNING.value, RunStatus.COMPLETED.value]),
            )
            .first()
            is not None
        )

    @staticmethod
    def _weather_text(enabled: bool, *, source_status: str | None) -> str:
        if not enabled:
            return "Wetter ist für diese Regel nicht aktiv."
        if source_status == "unavailable":
            return "Wetterdaten fehlen; die Planung nutzt gespeicherte Regeln und Zonenprofil als Schätzung."
        if source_status == "stale":
            return "Wetterdaten sind älter; die Planung nutzt sie vorsichtig mit dem Zonenprofil."
        return "Wetter und Zonenprofil werden berücksichtigt."

    @staticmethod
    def _adaptive_decision_summary(reason: str) -> str:
        if "Wirksamer Regen deckt den Bedarf" in reason:
            return "Ausgesetzt, weil wirksamer Regen den berechneten Bedarf dieser Zone deckt."
        if "Regen wird erwartet" in reason:
            return "Ausgesetzt, weil Regen erwartet wird und der berechnete Netto-Bedarf noch niedrig ist."
        if "Heute wurde bereits automatisch bewässert" in reason:
            return "Ausgesetzt, weil heute schon automatisch bewässert wurde und kein zweiter Tageslauf erlaubt ist."
        if "Mindestabstand" in reason:
            return "Ausgesetzt, weil der Mindestabstand zum letzten automatischen Lauf noch nicht erreicht ist."
        if "Kein freigegebenes Bewässerungsfenster" in reason:
            return "Ausgesetzt, weil gerade kein erlaubtes Zeitfenster aktiv ist."
        if "übersprungen" in reason:
            return "Ausgesetzt, weil der berechnete Wasserbedarf unter der Skip-Schwelle liegt."
        return reason

    @staticmethod
    def _weather_basis(
        *,
        profile: ZoneIrrigationProfile,
        plan: AdaptiveIrrigationPlan,
        weather: ZoneWeatherFacts,
        source_status: str,
        recommendation,
        already_watered_today: bool,
    ) -> dict:
        return {
            "source_status": source_status,
            "temperature_max_24h_c": weather.temperature_max_c,
            "rain_last_24h_mm": weather.rain_last_24h_mm,
            "rain_next_24h_mm": weather.rain_next_24h_mm,
            "cloud_cover_avg_pct": weather.cloud_cover_avg_pct,
            "base_water_need_mm_per_day": profile.baseWaterNeedMmPerDay,
            "rain_effectiveness": profile.rainEffectiveness,
            "risk_profile": profile.riskProfile,
            "drying_speed": profile.dryingSpeed,
            "sun_exposure": profile.sunExposure,
            "preferred_time_windows": plan.preferredTimeWindows,
            "allow_second_daily_run": plan.allowSecondDailyRun,
            "already_watered_today": already_watered_today,
            "min_interval_hours": plan.minIntervalHours,
            "base_duration_minutes": plan.baseDurationMinutes,
            "min_duration_minutes": plan.minDurationMinutes,
            "max_duration_minutes": plan.maxDurationMinutes,
            "rain_skip_threshold_mm": plan.rainSkipThresholdMm,
            "rain_delay_threshold_mm": plan.rainDelayThresholdMm,
            "high_need_threshold_mm": plan.highNeedThresholdMm,
            "estimated_need_mm": recommendation.estimated_need_mm if recommendation else None,
            "effective_rain_mm": recommendation.effective_rain_mm if recommendation else None,
            "net_need_mm": recommendation.net_need_mm if recommendation else None,
            "duration_multiplier": recommendation.multiplier if recommendation else None,
        }
