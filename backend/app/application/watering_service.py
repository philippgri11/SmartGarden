from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.gpio_state_service import GpioStateService
from app.application.schemas import ZoneIrrigationProfile
from app.application.weather_service import WeatherService
from app.config import Settings
from app.domain.adaptive_irrigation import ADAPTIVE_REASON_PREFIX
from app.domain.models import RunStatus, TriggerType, WeatherDecisionKind
from app.domain.policies import enforce_max_duration, should_finish_run
from app.domain.timezone import app_timezone
from app.domain.zone_irrigation import ZoneWeatherFacts, build_zone_irrigation_recommendation
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import WateringRunRepository, ZoneRepository
from app.infrastructure.gpio.base import GpioAdapter


logger = logging.getLogger(__name__)


class WateringService:
    def __init__(self, session: Session, settings: Settings, gpio: GpioAdapter | None):
        self.session = session
        self.settings = settings
        self.gpio = gpio
        self.runs = WateringRunRepository(session)
        self.zones = ZoneRepository(session)
        self.weather = WeatherService(session, settings)
        self.gpio_state = GpioStateService(session)

    def create_manual_run(self, zone_id: int, duration_minutes: int, reason: str | None = None) -> orm.WateringRun:
        zone = self.zones.get(zone_id)
        if not zone:
            raise ValueError("zone not found")
        app_settings = self.weather.get_settings()
        self._assert_manual_start_allowed(zone=zone, app_settings=app_settings)
        run = self.runs.create_planned_run(
            zone_id=zone_id,
            schedule_id=None,
            trigger_type=TriggerType.MANUAL,
            duration_minutes=enforce_max_duration(duration_minutes, zone.max_duration_minutes),
            reason=reason,
        )
        self.session.commit()
        self.session.refresh(run)
        return run

    def create_run_all_sequence(self) -> tuple[str, int, int]:
        app_settings = self.weather.get_settings()
        self._assert_global_manual_start_allowed(app_settings)
        if self._active_manual_sequence_group_id():
            raise ValueError("manual sequence already active")
        if self.runs.list_running():
            raise ValueError("another watering run is already active")

        ordered_zones = [zone for zone in self._zones_in_sequence_order() if zone.active]
        if not ordered_zones:
            raise ValueError("no active zones available")

        sequence_group_id = uuid4().hex
        total_window_end = datetime.now(UTC)
        queued_count = 0
        for index, zone in enumerate(ordered_zones):
            duration = enforce_max_duration(zone.default_manual_duration_minutes, zone.max_duration_minutes)
            total_window_end += timedelta(minutes=duration)
            self.runs.create_planned_run(
                zone_id=zone.id,
                schedule_id=None,
                trigger_type=TriggerType.MANUAL,
                duration_minutes=duration,
                reason="manual run-all sequence",
                sequence_group_id=sequence_group_id,
                sequence_order=index,
            )
            queued_count += 1

        skipped_count = self._skip_conflicting_scheduled_runs(
            sequence_group_id=sequence_group_id,
            sequence_window_end=total_window_end,
            include_existing_planned=True,
        )
        self.session.commit()
        return sequence_group_id, queued_count, skipped_count

    def request_stop_zone(self, zone_id: int) -> int:
        runs_to_stop = list(
            self.session.query(orm.WateringRun)
            .filter(
                orm.WateringRun.zone_id == zone_id,
                orm.WateringRun.status.in_([RunStatus.PLANNED.value, RunStatus.RUNNING.value]),
            )
            .all()
        )
        now = datetime.now(UTC)
        for run in runs_to_stop:
            run.stop_requested = True
            run.reason = "stop requested via api"
            if run.status == RunStatus.PLANNED.value:
                run.status = RunStatus.CANCELLED.value
                run.finished_at = now
        self.session.commit()
        return len(runs_to_stop)

    def request_stop_all(self) -> int:
        app_settings = self.weather.get_settings()
        runs_to_stop = list(
            self.session.query(orm.WateringRun)
            .filter(orm.WateringRun.status.in_([RunStatus.PLANNED.value, RunStatus.RUNNING.value]))
            .all()
        )
        now = datetime.now(UTC)
        for run in runs_to_stop:
            run.stop_requested = True
            run.reason = "emergency stop requested via api"
            if run.status == RunStatus.PLANNED.value:
                run.status = RunStatus.CANCELLED.value
                run.finished_at = now
        app_settings.safety_stop_active = True
        app_settings.safety_stop_reason = "Bewässerung gestoppt. Laufende Ventile werden durch den Scheduler geschlossen."
        self.session.commit()
        return len(runs_to_stop)

    def release_safety_stop(self) -> None:
        app_settings = self.weather.get_settings()
        app_settings.safety_stop_active = False
        app_settings.safety_stop_reason = None
        self.session.commit()

    def recent_runs(self, limit: int = 50) -> list[orm.WateringRun]:
        return self.runs.list_recent(limit=limit)

    def sync_active_runs(self) -> None:
        now = datetime.now(UTC)
        running = self.runs.list_running()
        for run in running:
            zone = self.zones.get(run.zone_id)
            if not zone:
                run.status = RunStatus.FAILED.value
                run.finished_at = now
                run.reason = "zone missing"
                continue
            if not run.started_at:
                run.started_at = now
            if run.stop_requested:
                self.gpio.deactivate_zone(zone)
                self.gpio_state.record_state(zone_id=zone.id, state=False, source="scheduler", reason="stop requested")
                run.status = RunStatus.CANCELLED.value
                run.finished_at = now
                run.duration_seconds = self._duration_seconds(run.started_at, run.finished_at) if run.started_at else 0
                continue
            if should_finish_run(run.started_at, now, run.requested_duration_minutes, zone.max_duration_minutes):
                self.gpio.deactivate_zone(zone)
                self.gpio_state.record_state(zone_id=zone.id, state=False, source="scheduler", reason="duration completed")
                run.status = RunStatus.COMPLETED.value
                run.finished_at = now
                run.duration_seconds = self._duration_seconds(run.started_at, run.finished_at)
        self.session.commit()

    def execute_planned_runs(self) -> None:
        app_settings = self.weather.get_settings()
        if self._is_system_paused(app_settings):
            return
        if app_settings.safety_stop_active:
            return
        if app_settings.winter_mode_active and app_settings.winter_pause_schedules:
            return
        currently_running_zone_ids = {run.zone_id for run in self.runs.list_running()}
        active_sequence_group_id = self._active_manual_sequence_group_id()
        if active_sequence_group_id:
            next_sequence_run = (
                self.session.query(orm.WateringRun)
                .filter(
                    orm.WateringRun.sequence_group_id == active_sequence_group_id,
                    orm.WateringRun.trigger_type == TriggerType.MANUAL.value,
                    orm.WateringRun.status == RunStatus.PLANNED.value,
                )
                .order_by(orm.WateringRun.sequence_order.asc(), orm.WateringRun.created_at.asc())
                .first()
            )
            if next_sequence_run and not currently_running_zone_ids:
                self._try_start_run(next_sequence_run, app_settings)
            self.session.commit()
            return

        planned_runs = (
            self.session.query(orm.WateringRun)
            .filter(orm.WateringRun.status == RunStatus.PLANNED.value)
            .order_by(orm.WateringRun.created_at.asc())
            .all()
        )
        now = datetime.now(UTC)
        schedule_tz = app_timezone(self.settings)
        for run in planned_runs:
            if run.scheduled_for and run.scheduled_time:
                scheduled_at = datetime.combine(run.scheduled_for, run.scheduled_time, tzinfo=schedule_tz).astimezone(UTC)
                if scheduled_at > now:
                    continue
            zone = self.zones.get(run.zone_id)
            if not zone or not zone.active:
                run.status = RunStatus.SKIPPED.value
                run.reason = "zone inactive or missing"
                run.finished_at = now
                continue
            if currently_running_zone_ids or len(currently_running_zone_ids) >= self.settings.max_global_concurrent_runs:
                break
            if run.zone_id in currently_running_zone_ids:
                continue
            if not self._try_start_run(run, app_settings):
                continue
            currently_running_zone_ids.add(run.zone_id)
            logger.info("watering run started", extra={"run_id": run.id, "zone_id": run.zone_id})
        self.session.commit()

    def active_manual_sequence_summary(self) -> dict | None:
        group_id = self._active_manual_sequence_group_id()
        if not group_id:
            return None
        runs = list(
            self.session.scalars(
                select(orm.WateringRun)
                .where(orm.WateringRun.sequence_group_id == group_id)
                .order_by(orm.WateringRun.sequence_order.asc().nulls_last(), orm.WateringRun.created_at.asc())
            )
        )
        manual_runs = [run for run in runs if run.trigger_type == TriggerType.MANUAL.value and run.sequence_order is not None]
        if not manual_runs:
            return None
        current_run = next((run for run in manual_runs if run.status == RunStatus.RUNNING.value), None)
        next_run = next((run for run in manual_runs if run.status == RunStatus.PLANNED.value), None)
        current_zone = self.zones.get(current_run.zone_id) if current_run else (self.zones.get(next_run.zone_id) if next_run else None)
        completed_count = len([run for run in manual_runs if run.status in {RunStatus.COMPLETED.value, RunStatus.CANCELLED.value, RunStatus.SKIPPED.value, RunStatus.FAILED.value}])
        skipped_schedule_count = len([run for run in runs if run.trigger_type == TriggerType.SCHEDULED.value and run.status == RunStatus.SKIPPED.value])
        notice = None
        if skipped_schedule_count:
            notice = f"{skipped_schedule_count} geplanter Lauf wird für diese Gesamtbewässerung einmalig übersprungen."
        return {
            "sequence_group_id": group_id,
            "current_area_name": current_zone.name if current_zone else None,
            "total_areas": len(manual_runs),
            "completed_areas": completed_count,
            "skipped_schedule_count": skipped_schedule_count,
            "notice": notice,
        }

    def active_manual_sequence_window(self) -> tuple[str, datetime] | None:
        group_id = self._active_manual_sequence_group_id()
        if not group_id:
            return None
        now = datetime.now(UTC)
        sequence_runs = list(
            self.session.scalars(
                select(orm.WateringRun)
                .where(
                    orm.WateringRun.sequence_group_id == group_id,
                    orm.WateringRun.trigger_type == TriggerType.MANUAL.value,
                    orm.WateringRun.status.in_([RunStatus.PLANNED.value, RunStatus.RUNNING.value]),
                )
                .order_by(orm.WateringRun.sequence_order.asc(), orm.WateringRun.created_at.asc())
            )
        )
        if not sequence_runs:
            return None
        window_end = now
        for run in sequence_runs:
            zone = self.zones.get(run.zone_id)
            if not zone:
                continue
            max_minutes = min(run.requested_duration_minutes, zone.max_duration_minutes)
            if run.status == RunStatus.RUNNING.value and run.started_at:
                remaining_seconds = max(
                    0,
                    max_minutes * 60 - int((now - run.started_at).total_seconds()),
                )
                window_end += timedelta(seconds=remaining_seconds)
            else:
                window_end += timedelta(minutes=max_minutes)
        return group_id, window_end

    @staticmethod
    def _is_system_paused(app_settings: orm.AppSetting) -> bool:
        return bool(app_settings.system_paused_until and app_settings.system_paused_until > datetime.now(UTC))

    def _assert_global_manual_start_allowed(self, app_settings: orm.AppSetting) -> None:
        if self._is_system_paused(app_settings):
            raise ValueError("system paused")
        if app_settings.safety_stop_active:
            raise ValueError("safety stop active")
        if app_settings.winter_mode_active and app_settings.winter_disable_manual_start:
            raise ValueError("manual start disabled in winter mode")

    def _assert_manual_start_allowed(self, *, zone: orm.Zone, app_settings: orm.AppSetting) -> None:
        self._assert_global_manual_start_allowed(app_settings)
        if not zone.active:
            raise ValueError("zone inactive")

    def _active_manual_sequence_group_id(self) -> str | None:
        return self.session.execute(
            select(orm.WateringRun.sequence_group_id)
            .where(
                orm.WateringRun.sequence_group_id.is_not(None),
                orm.WateringRun.trigger_type == TriggerType.MANUAL.value,
                orm.WateringRun.status.in_([RunStatus.PLANNED.value, RunStatus.RUNNING.value]),
            )
            .order_by(orm.WateringRun.created_at.asc())
            .limit(1)
        ).scalar_one_or_none()

    def _zones_in_sequence_order(self) -> list[orm.Zone]:
        ordered_zones = self.zones.list()
        garden_maps = list(
            self.session.scalars(select(orm.GardenMap).order_by(orm.GardenMap.updated_at.desc(), orm.GardenMap.id.desc()))
        )
        if not garden_maps:
            return sorted(ordered_zones, key=lambda zone: (zone.name.lower(), zone.id))

        latest_map = garden_maps[0]
        shapes = list(
            self.session.scalars(
                select(orm.ZoneMapShape)
                .where(orm.ZoneMapShape.garden_map_id == latest_map.id)
                .order_by(orm.ZoneMapShape.id.asc())
            )
        )
        seen_zone_ids: set[int] = set()
        ordered: list[orm.Zone] = []
        zones_by_id = {zone.id: zone for zone in ordered_zones}
        for shape in shapes:
            zone = zones_by_id.get(shape.zone_id)
            if zone and zone.id not in seen_zone_ids:
                ordered.append(zone)
                seen_zone_ids.add(zone.id)
        remaining = [zone for zone in ordered_zones if zone.id not in seen_zone_ids]
        remaining.sort(key=lambda zone: (zone.name.lower(), zone.id))
        return ordered + remaining

    def _skip_conflicting_scheduled_runs(
        self,
        *,
        sequence_group_id: str,
        sequence_window_end: datetime,
        include_existing_planned: bool,
    ) -> int:
        now = datetime.now(UTC)
        schedule_tz = app_timezone(self.settings)
        skipped_count = 0
        query = self.session.query(orm.WateringRun).filter(
            orm.WateringRun.schedule_id.is_not(None),
            orm.WateringRun.status == RunStatus.PLANNED.value,
        )
        if include_existing_planned:
            runs = query.all()
        else:
            runs = query.filter(orm.WateringRun.sequence_group_id.is_(None)).all()
        for run in runs:
            if not run.scheduled_for or not run.scheduled_time:
                continue
            scheduled_at = datetime.combine(run.scheduled_for, run.scheduled_time, tzinfo=schedule_tz).astimezone(UTC)
            if scheduled_at <= sequence_window_end:
                run.status = RunStatus.SKIPPED.value
                run.finished_at = now
                run.reason = "Einmalig wegen manueller Gesamtbewässerung übersprungen."
                run.sequence_group_id = sequence_group_id
                skipped_count += 1
        return skipped_count

    def _try_start_run(self, run: orm.WateringRun, app_settings: orm.AppSetting) -> bool:
        zone = self.zones.get(run.zone_id)
        if not zone:
            run.status = RunStatus.FAILED.value
            run.finished_at = datetime.now(UTC)
            run.reason = "zone missing"
            return False
        if run.trigger_type == TriggerType.MANUAL.value:
            self.gpio.activate_zone(zone)
            self.gpio_state.record_state(zone_id=zone.id, state=True, source="scheduler", reason="manual watering run started")
            run.status = RunStatus.RUNNING.value
            run.started_at = datetime.now(UTC)
            run.reason = run.reason or "Manueller Start: Laufzeit wurde unverändert vom Benutzer übernommen."
            return True
        schedule = self.session.get(orm.Schedule, run.schedule_id) if run.schedule_id else None
        is_adaptive_run = bool(run.reason and run.reason.startswith(ADAPTIVE_REASON_PREFIX))
        weather_result, summary, app_settings = self.weather.evaluate(zone=zone, schedule=schedule)
        recommendation = None
        if summary and zone.irrigation_profile_json:
            profile = ZoneIrrigationProfile.model_validate(zone.irrigation_profile_json)
            recommendation = build_zone_irrigation_recommendation(
                profile=profile,
                weather=ZoneWeatherFacts(
                    temperature_max_c=summary.temperature_max_24h_c,
                    rain_last_24h_mm=summary.precipitation_last_24h_mm,
                    rain_next_24h_mm=summary.precipitation_next_24h_mm,
                    cloud_cover_avg_pct=summary.cloud_cover_avg_pct,
                ),
                scheduled_duration_minutes=run.requested_duration_minutes,
                max_duration_minutes=zone.max_duration_minutes,
            )
            if weather_result.decision == WeatherDecisionKind.SKIP and recommendation.decision == "allow":
                weather_result.decision = WeatherDecisionKind.ALLOW
                weather_result.reason = "zone profile overrides rain skip: " + recommendation.explanation
            elif weather_result.decision == WeatherDecisionKind.ALLOW and recommendation.decision == "skip":
                weather_result.decision = WeatherDecisionKind.SKIP
                weather_result.reason = "zone profile skip: " + recommendation.explanation
            elif weather_result.decision == WeatherDecisionKind.ALLOW:
                weather_result.reason = "zone profile adjusted duration: " + recommendation.explanation

        raw_response = summary.raw_response if summary else None
        if raw_response is not None and summary is not None:
            raw_response = {
                **raw_response,
                "irrigation_weather": {
                    "temperature_max_24h_c": summary.temperature_max_24h_c,
                    "precipitation_last_24h_mm": summary.precipitation_last_24h_mm,
                    "precipitation_next_24h_mm": summary.precipitation_next_24h_mm,
                    "cloud_cover_avg_pct": summary.cloud_cover_avg_pct,
                },
                **({"irrigation_recommendation": recommendation.as_dict()} if recommendation is not None else {}),
            }
        self.runs.create_weather_decision(
            run_id=run.id,
            latitude=app_settings.latitude,
            longitude=app_settings.longitude,
            forecast_window_hours=app_settings.weather_window_hours,
            probability_max=summary.probability_max if summary else None,
            precipitation_sum_mm=summary.precipitation_sum_mm if summary else None,
            decision=weather_result.decision,
            reason=weather_result.reason,
            raw_response=raw_response,
        )
        if weather_result.decision in {WeatherDecisionKind.SKIP, WeatherDecisionKind.ERROR}:
            run.status = RunStatus.SKIPPED.value if weather_result.decision == WeatherDecisionKind.SKIP else RunStatus.FAILED.value
            run.finished_at = datetime.now(UTC)
            run.reason = weather_result.reason
            return False
        if recommendation is not None and not is_adaptive_run:
            run.requested_duration_minutes = recommendation.adjusted_duration_minutes
        self.gpio.activate_zone(zone)
        self.gpio_state.record_state(zone_id=zone.id, state=True, source="scheduler", reason="watering run started")
        run.status = RunStatus.RUNNING.value
        run.started_at = datetime.now(UTC)
        run.reason = weather_result.reason
        return True

    @staticmethod
    def _duration_seconds(started_at: datetime, finished_at: datetime) -> int:
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=UTC)
        if finished_at.tzinfo is None:
            finished_at = finished_at.replace(tzinfo=UTC)
        return int((finished_at - started_at).total_seconds())
