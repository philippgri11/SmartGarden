from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.weather_service import WeatherService
from app.config import Settings
from app.domain.models import RunStatus
from app.domain.services import next_schedule_occurrence
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import ScheduleRepository, WateringRunRepository, ZoneRepository
from app.infrastructure.gpio.base import GpioAdapter


class SystemService:
    def __init__(self, session: Session, settings: Settings, gpio: GpioAdapter):
        self.session = session
        self.settings = settings
        self.gpio = gpio
        self.weather = WeatherService(session, settings)
        self.zones = ZoneRepository(session)
        self.schedules = ScheduleRepository(session)
        self.runs = WateringRunRepository(session)

    def pause_for_hours(self, hours: int) -> orm.AppSetting:
        entity = self.weather.get_settings()
        entity.system_paused_until = datetime.now(UTC) + timedelta(hours=hours)
        self.session.commit()
        self.session.refresh(entity)
        return entity

    def clear_pause(self) -> orm.AppSetting:
        entity = self.weather.get_settings()
        entity.system_paused_until = None
        self.session.commit()
        self.session.refresh(entity)
        return entity

    def set_winter_mode(
        self,
        *,
        active: bool,
        disable_manual_start: bool,
        pause_schedules: bool,
        safety_shutdown: bool,
    ) -> orm.AppSetting:
        entity = self.weather.get_settings()
        entity.winter_mode_active = active
        entity.winter_disable_manual_start = disable_manual_start
        entity.winter_pause_schedules = pause_schedules
        entity.safety_shutdown_on_winter = safety_shutdown
        if active and safety_shutdown:
            running = self.runs.list_running()
            for run in running:
                run.stop_requested = True
                run.reason = "winter mode activated"
        self.session.commit()
        self.session.refresh(entity)
        return entity

    def summary(self) -> dict:
        app_settings = self.weather.get_settings()
        zones = self.zones.list()
        runs = self.runs.list_recent(limit=50)
        running = self.runs.list_running()
        schedules = self.schedules.list_active()
        now = datetime.now(UTC)
        next_candidates: list[datetime] = []
        for schedule in schedules:
            zone = self.zones.get(schedule.zone_id)
            if not zone or not zone.active:
                continue
            occurrence = next_schedule_occurrence(schedule, now)
            if occurrence is not None:
                next_candidates.append(occurrence)
        next_watering_at = min(next_candidates) if next_candidates else None
        last_run = runs[0] if runs else None
        last_run_zone = self.zones.get(last_run.zone_id) if last_run else None

        if app_settings.safety_stop_active:
            status = "attention"
            headline = "Bewässerung gestoppt"
            detail = app_settings.safety_stop_reason or "Alle Ventile sind geschlossen."
        elif app_settings.winter_mode_active:
            status = "winter"
            headline = "Winterbetrieb aktiv"
            detail = "Automatische Bewässerung ist ausgeschaltet. Alle Ventile sind geschlossen."
        elif app_settings.system_paused_until and app_settings.system_paused_until > now:
            status = "paused"
            headline = "Bewässerung pausiert"
            detail = f"Pausiert bis {app_settings.system_paused_until.isoformat()}."
        elif running:
            status = "running"
            headline = "Bewässerung läuft"
            detail = "Mindestens ein Bereich wird gerade bewässert."
        else:
            status = "ok"
            headline = "Alles in Ordnung"
            detail = "Das System ist bereit für die nächste Bewässerung."

        weather_status = (
            "Wettersteuerung aktiv"
            if app_settings.weather_enabled
            else "Wettersteuerung aus"
        )

        return {
            "status": status,
            "headline": headline,
            "detail": detail,
            "current_water_status": "läuft" if running else "aus",
            "next_watering_at": next_watering_at,
            "weather_status": weather_status,
            "active_schedule_count": len(schedules),
            "running_zone_count": len(running),
            "winter_mode_active": app_settings.winter_mode_active,
            "safety_stop_active": app_settings.safety_stop_active,
            "system_paused_until": app_settings.system_paused_until,
            "last_run_zone_name": last_run_zone.name if last_run_zone else None,
            "last_run_finished_at": last_run.finished_at if last_run else None,
            "last_run_status": last_run.status if last_run else None,
        }
