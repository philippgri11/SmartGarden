from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.irrigation_projection_service import IrrigationProjectionService
from app.application.weather_service import WeatherService
from app.application.watering_service import WateringService
from app.config import Settings
from app.domain.models import RunStatus
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import ScheduleRepository, WateringRunRepository, ZoneRepository


class RuntimeService:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings
        self.weather = WeatherService(session, settings)
        self.zones = ZoneRepository(session)
        self.schedules = ScheduleRepository(session)
        self.runs = WateringRunRepository(session)

    def snapshot(self) -> dict:
        now = datetime.now(UTC)
        app_settings = self.weather.get_settings()
        areas = self.list_areas(now=now, app_settings=app_settings)
        manual_sequence = WateringService(self.session, self.settings, gpio=None).active_manual_sequence_summary()  # type: ignore[arg-type]
        return {
            "generated_at": now,
            "settings": app_settings,
            "summary": self._build_summary(app_settings=app_settings, areas=areas, now=now, manual_sequence=manual_sequence),
            "areas": areas,
        }

    def list_areas(
        self,
        *,
        now: datetime | None = None,
        app_settings: orm.AppSetting | None = None,
    ) -> list[dict]:
        current_time = now or datetime.now(UTC)
        current_settings = app_settings or self.weather.get_settings()
        current_forecast = (
            self.weather.try_fetch_current_summary(app_settings=current_settings)
            if current_settings.weather_enabled
            else None
        )
        zones = self.zones.list()
        runs_by_zone = self._load_runs_by_zone([zone.id for zone in zones])
        projection = IrrigationProjectionService(self.session, self.settings).build_projection(days=14, now=current_time)
        next_by_zone: dict[int, datetime] = {}
        for item in projection.items:
            if item.status != "planned" or item.zone_id in next_by_zone:
                continue
            next_by_zone[item.zone_id] = item.planned_start

        return [
            self._build_area_snapshot(
                zone=zone,
                zone_runs=runs_by_zone.get(zone.id, []),
                app_settings=current_settings,
                now=current_time,
                current_forecast=current_forecast,
                next_watering_at=next_by_zone.get(zone.id),
            )
            for zone in zones
        ]

    def area_snapshots_by_zone_id(
        self,
        *,
        now: datetime | None = None,
        app_settings: orm.AppSetting | None = None,
    ) -> dict[int, dict]:
        return {area["id"]: area for area in self.list_areas(now=now, app_settings=app_settings)}

    def _build_area_snapshot(
        self,
        *,
        zone: orm.Zone,
        zone_runs: list[orm.WateringRun],
        app_settings: orm.AppSetting,
        now: datetime,
        current_forecast,
        next_watering_at: datetime | None,
    ) -> dict:
        current_run = next((run for run in zone_runs if run.status in {RunStatus.PLANNED.value, RunStatus.RUNNING.value}), None)
        last_finished_run = next((run for run in zone_runs if run.status not in {RunStatus.PLANNED.value, RunStatus.RUNNING.value}), None)
        effective_probability_threshold = zone.weather_probability_threshold or app_settings.weather_probability_threshold
        effective_precipitation_threshold = zone.weather_precipitation_mm_threshold or app_settings.weather_precipitation_mm_threshold
        schedule_weather_enabled = any(schedule.active and schedule.weather_enabled for schedule in zone.schedules)
        weather_enabled_effective = bool(app_settings.weather_enabled and (zone.weather_enabled or schedule_weather_enabled or zone.scheduling_mode == "adaptive"))

        run_state = self._derive_run_state(current_run)
        status = self._derive_area_status(
            zone=zone,
            app_settings=app_settings,
            run_state=run_state,
            next_watering_at=next_watering_at,
            last_finished_run=last_finished_run,
            now=now,
        )
        manual_start_block_reason = self._manual_start_block_reason(
            zone=zone,
            app_settings=app_settings,
            run_state=run_state,
            status=status,
            now=now,
        )

        last_weather_decision = None
        if current_run and current_run.weather_decisions:
            last_weather_decision = current_run.weather_decisions[0]
        elif last_finished_run and last_finished_run.weather_decisions:
            last_weather_decision = last_finished_run.weather_decisions[0]

        weather_snapshot = self.weather.overview_from_decision(
            app_settings=app_settings,
            weather_enabled=weather_enabled_effective,
            probability_threshold=effective_probability_threshold,
            precipitation_threshold_mm=effective_precipitation_threshold,
            decision=last_weather_decision,
        )
        if weather_enabled_effective and self._needs_live_weather_refresh(weather_snapshot):
            weather_snapshot = self.weather.build_live_overview(
                app_settings=app_settings,
                weather_enabled=weather_enabled_effective,
                probability_threshold=effective_probability_threshold,
                precipitation_threshold_mm=effective_precipitation_threshold,
                forecast_summary=current_forecast,
            )

        current_run_remaining_seconds = self._current_run_remaining_seconds(
            zone=zone,
            current_run=current_run,
            run_state=run_state,
            now=now,
        )

        return {
            **zone.__dict__,
            "status": status,
            "run_state": run_state,
            "running": run_state in {"running", "stopping"},
            "current_run_id": current_run.id if current_run else None,
            "current_run_status": current_run.status if current_run else None,
            "current_run_started_at": current_run.started_at if current_run else None,
            "current_run_requested_duration_minutes": current_run.requested_duration_minutes if current_run else None,
            "current_run_remaining_seconds": current_run_remaining_seconds,
            "current_run_stop_requested": bool(current_run.stop_requested) if current_run else False,
            "next_watering_at": next_watering_at,
            "last_watering_at": (
                last_finished_run.finished_at
                if last_finished_run and last_finished_run.finished_at
                else (last_finished_run.started_at if last_finished_run else None)
            ),
            "last_run_status": last_finished_run.status if last_finished_run else None,
            "last_weather_decision": last_weather_decision.decision if last_weather_decision else None,
            "last_weather_reason": last_weather_decision.reason if last_weather_decision else None,
            "weather_decision_effective": weather_enabled_effective,
            "weather_decision": weather_snapshot["decision"],
            "weather_reason_human": weather_snapshot["reason_human"],
            "weather_snapshot": weather_snapshot,
            "zone_profile_description": zone.zone_profile_description,
            "irrigation_profile": zone.irrigation_profile_json,
            "scheduling_mode": zone.scheduling_mode,
            "adaptive_irrigation_plan": zone.adaptive_irrigation_plan_json,
            "manual_start_allowed": manual_start_block_reason is None,
            "manual_start_block_reason": manual_start_block_reason,
            "active_shape_count": len(zone.map_shapes),
        }

    def _build_summary(self, *, app_settings: orm.AppSetting, areas: list[dict], now: datetime, manual_sequence: dict | None) -> dict:
        active_schedules = self.schedules.list_active()
        active_schedule_count = 0
        for schedule in active_schedules:
            zone = next((item for item in areas if item["id"] == schedule.zone_id), None)
            if not zone or not zone["active"] or zone.get("scheduling_mode") == "adaptive":
                continue
            active_schedule_count += 1
        next_candidates = [area.get("next_watering_at") for area in areas if area.get("next_watering_at")]
        next_watering_at = min(next_candidates) if next_candidates else None
        last_area = next(
            (area for area in sorted(areas, key=lambda item: item["last_watering_at"] or datetime.min.replace(tzinfo=UTC), reverse=True) if area["last_watering_at"]),
            None,
        )

        if app_settings.safety_stop_active:
            status = "attention"
            headline = "Bewässerung gestoppt"
            detail = app_settings.safety_stop_reason or "Alle Ventile sind geschlossen."
            current_water_status = "aus"
        elif app_settings.winter_mode_active:
            status = "winter"
            headline = "Winterbetrieb aktiv"
            detail = "Automatische Bewässerung ist ausgeschaltet. Alle Ventile sind geschlossen."
            current_water_status = "aus"
        elif app_settings.system_paused_until and app_settings.system_paused_until > now:
            status = "paused"
            headline = "Bewässerung pausiert"
            detail = f"Pausiert bis {app_settings.system_paused_until.isoformat()}."
            current_water_status = "aus"
        elif any(area["run_state"] in {"running", "stopping"} for area in areas):
            status = "running"
            headline = "Gesamtbewässerung läuft" if manual_sequence else "Bewässerung läuft"
            detail = (
                f"{manual_sequence['current_area_name']} wird gerade bewässert."
                if manual_sequence and manual_sequence.get("current_area_name")
                else "Mindestens ein Bereich wird gerade bewässert."
            )
            current_water_status = "läuft"
        elif any(area["run_state"] == "queued" for area in areas):
            status = "running"
            headline = "Gesamtbewässerung wird vorbereitet" if manual_sequence else "Bewässerung wird vorbereitet"
            detail = (
                f"{manual_sequence['current_area_name']} ist als nächstes an der Reihe."
                if manual_sequence and manual_sequence.get("current_area_name")
                else "Ein Lauf wurde angefordert und wird vom Worker übernommen."
            )
            current_water_status = "wird vorbereitet"
        else:
            status = "ok"
            headline = "Alles in Ordnung"
            detail = "Das System ist bereit für die nächste Bewässerung."
            current_water_status = "aus"

        weather_overview = self._build_summary_weather_overview(app_settings=app_settings, areas=areas)
        weather_status = weather_overview["headline"]
        running_zone_count = len([area for area in areas if area["run_state"] in {"running", "stopping"}])

        return {
            "status": status,
            "headline": headline,
            "detail": detail,
            "current_water_status": current_water_status,
            "next_watering_at": next_watering_at,
            "weather_status": weather_status,
            "weather_overview": weather_overview,
            "active_schedule_count": active_schedule_count,
            "running_zone_count": running_zone_count,
            "winter_mode_active": app_settings.winter_mode_active,
            "safety_stop_active": app_settings.safety_stop_active,
            "system_paused_until": app_settings.system_paused_until,
            "last_run_zone_name": last_area["name"] if last_area else None,
            "last_run_finished_at": last_area["last_watering_at"] if last_area else None,
            "last_run_status": last_area["last_run_status"] if last_area else None,
            "manual_sequence_active": bool(manual_sequence),
            "manual_sequence_current_area_name": manual_sequence["current_area_name"] if manual_sequence else None,
            "manual_sequence_total_areas": manual_sequence["total_areas"] if manual_sequence else 0,
            "manual_sequence_completed_areas": manual_sequence["completed_areas"] if manual_sequence else 0,
            "manual_sequence_skipped_schedule_count": manual_sequence["skipped_schedule_count"] if manual_sequence else 0,
            "manual_sequence_notice": manual_sequence["notice"] if manual_sequence else None,
        }

    def _build_summary_weather_overview(self, *, app_settings: orm.AppSetting, areas: list[dict]) -> dict:
        if not app_settings.weather_enabled:
            return self.weather.build_overview(
                app_settings=app_settings,
                weather_enabled=False,
                decision=None,
                raw_reason=None,
                checked_at=None,
                probability_max=None,
                precipitation_sum_mm=None,
                probability_threshold=app_settings.weather_probability_threshold,
                precipitation_threshold_mm=app_settings.weather_precipitation_mm_threshold,
            )

        candidates = [
            area["weather_snapshot"]
            for area in areas
            if area.get("weather_snapshot") and area.get("weather_decision_effective")
        ]
        candidates.sort(
            key=lambda overview: overview["checked_at"] or datetime.min.replace(tzinfo=UTC),
            reverse=True,
        )
        if candidates:
            return candidates[0]

        return self.weather.build_overview(
            app_settings=app_settings,
            weather_enabled=True,
            decision=None,
            raw_reason=None,
            checked_at=None,
            probability_max=None,
            precipitation_sum_mm=None,
            probability_threshold=app_settings.weather_probability_threshold,
            precipitation_threshold_mm=app_settings.weather_precipitation_mm_threshold,
        )

    @staticmethod
    def _needs_live_weather_refresh(overview: dict) -> bool:
        return (
            overview.get("weather_enabled")
            and (
                overview.get("source_status") in {"stale", "unavailable"}
                or overview.get("precipitation_probability_max") is None
                or overview.get("precipitation_sum_mm") is None
            )
        )

    def _load_runs_by_zone(self, zone_ids: list[int]) -> dict[int, list[orm.WateringRun]]:
        if not zone_ids:
            return {}
        runs = list(
            self.session.scalars(
                select(orm.WateringRun)
                .where(orm.WateringRun.zone_id.in_(zone_ids))
                .order_by(orm.WateringRun.created_at.desc())
            )
        )
        grouped: dict[int, list[orm.WateringRun]] = defaultdict(list)
        for run in runs:
            grouped[run.zone_id].append(run)
        return grouped

    @staticmethod
    def _derive_run_state(current_run: orm.WateringRun | None) -> str:
        if current_run is None:
            return "idle"
        if current_run.status == RunStatus.PLANNED.value:
            return "queued"
        if current_run.status == RunStatus.RUNNING.value and current_run.stop_requested:
            return "stopping"
        if current_run.status == RunStatus.RUNNING.value:
            return "running"
        return "idle"

    @staticmethod
    def _derive_area_status(
        *,
        zone: orm.Zone,
        app_settings: orm.AppSetting,
        run_state: str,
        next_watering_at: datetime | None,
        last_finished_run: orm.WateringRun | None,
        now: datetime,
    ) -> str:
        if app_settings.safety_stop_active:
            return "error"
        if run_state in {"running", "stopping"}:
            return "watering"
        if not zone.active:
            return "disabled"
        if app_settings.winter_mode_active or (app_settings.system_paused_until and app_settings.system_paused_until > now):
            return "paused"
        if last_finished_run and last_finished_run.status == RunStatus.FAILED.value:
            return "error"
        if run_state == "queued":
            return "scheduled-soon"
        if next_watering_at and 0 <= (next_watering_at - now).total_seconds() <= 12 * 60 * 60:
            return "scheduled-soon"
        return "active"

    @staticmethod
    def _manual_start_block_reason(
        *,
        zone: orm.Zone,
        app_settings: orm.AppSetting,
        run_state: str,
        status: str,
        now: datetime,
    ) -> str | None:
        if app_settings.safety_stop_active:
            return "Start derzeit nicht möglich, weil ein Sicherheitsstopp aktiv ist."
        if app_settings.winter_mode_active and app_settings.winter_disable_manual_start:
            return "Manueller Start im Winterbetrieb deaktiviert."
        if app_settings.system_paused_until and app_settings.system_paused_until > now:
            return "Das System ist aktuell pausiert."
        if not zone.active:
            return "Dieser Bereich ist deaktiviert."
        if run_state == "queued":
            return "Der Start wurde bereits angefordert."
        if run_state in {"running", "stopping"} or status == "watering":
            return "Dieser Bereich bewässert bereits."
        return None

    @staticmethod
    def _current_run_remaining_seconds(
        *,
        zone: orm.Zone,
        current_run: orm.WateringRun | None,
        run_state: str,
        now: datetime,
    ) -> int | None:
        if not current_run or not current_run.started_at or run_state not in {"running", "stopping"}:
            return None
        hard_limit_seconds = min(current_run.requested_duration_minutes, zone.max_duration_minutes) * 60
        elapsed_seconds = int((now - current_run.started_at).total_seconds())
        return max(0, hard_limit_seconds - elapsed_seconds)
