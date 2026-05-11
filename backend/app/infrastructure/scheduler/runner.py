from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

from sqlalchemy import text

from app.application.watering_service import WateringService
from app.application.gpio_state_service import GpioStateService
from app.application.weather_service import WeatherService
from app.config import get_settings
from app.domain.models import RunStatus, TriggerType
from app.domain.services import current_schedule_slot
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import ScheduleRepository, WateringRunRepository, ZoneRepository
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.gpio.factory import build_gpio_adapter


logger = logging.getLogger(__name__)


class SchedulerRunner:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.gpio = build_gpio_adapter(self.settings)
        self.initialized = False

    def _initialize_gpio(self, session) -> None:
        if self.initialized:
            return
        zones = ZoneRepository(session).list()
        self.gpio.initialize(zones)
        if self.settings.gpio_safe_shutdown_on_start:
            self.gpio.deactivate_all(zones)
            GpioStateService(session).record_all_off(source="startup", reason="safe shutdown on scheduler start")
            session.commit()
        self.initialized = True

    def _acquire_lock(self, session) -> bool:
        result = session.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": self.settings.scheduler_lock_key}).scalar_one()
        return bool(result)

    def _release_lock(self, session) -> None:
        session.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": self.settings.scheduler_lock_key})

    def _plan_due_runs(self, session) -> None:
        app_settings = WeatherService(session, self.settings).get_settings()
        watering = WateringService(session, self.settings, self.gpio)
        now = datetime.now(UTC)
        if app_settings.safety_stop_active:
            return
        if app_settings.winter_mode_active and app_settings.winter_pause_schedules:
            return
        if app_settings.system_paused_until and app_settings.system_paused_until > now:
            return
        schedules = ScheduleRepository(session).list_active()
        runs = WateringRunRepository(session)
        for schedule in schedules:
            slot = current_schedule_slot(schedule, now, self.settings.scheduler_due_grace_minutes)
            if not slot:
                continue
            if runs.exists_schedule_slot(schedule.id, slot.date(), slot.time()):
                continue
            zone = session.get(orm.Zone, schedule.zone_id)
            if not zone or not zone.active:
                continue
            active_sequence = watering.active_manual_sequence_window()
            if active_sequence and slot <= active_sequence[1]:
                skipped_run = runs.create_planned_run(
                    zone_id=schedule.zone_id,
                    schedule_id=schedule.id,
                    trigger_type=TriggerType.SCHEDULED,
                    duration_minutes=schedule.duration_minutes,
                    scheduled_for=slot.date(),
                    scheduled_time=slot.time(),
                    status=RunStatus.SKIPPED,
                    reason="Einmalig wegen manueller Gesamtbewässerung übersprungen.",
                    sequence_group_id=active_sequence[0],
                )
                skipped_run.finished_at = now
                continue
            runs.create_planned_run(
                zone_id=schedule.zone_id,
                schedule_id=schedule.id,
                trigger_type=TriggerType.SCHEDULED,
                duration_minutes=schedule.duration_minutes,
                scheduled_for=slot.date(),
                scheduled_time=slot.time(),
                reason="planned by scheduler",
            )
        session.commit()

    def tick(self) -> None:
        session = SessionLocal()
        try:
            if not self._acquire_lock(session):
                logger.info("scheduler lock not acquired; another instance is active")
                return
            self._initialize_gpio(session)
            self._plan_due_runs(session)
            watering = WateringService(session, self.settings, self.gpio)
            watering.sync_active_runs()
            watering.execute_planned_runs()
        except Exception:  # noqa: BLE001
            logger.exception("scheduler tick failed, switching all zones off")
            zones = ZoneRepository(session).list()
            self.gpio.deactivate_all(zones)
            GpioStateService(session).record_all_off(source="scheduler", reason="scheduler failure safety shutdown")
            session.commit()
            session.rollback()
        finally:
            try:
                self._release_lock(session)
                session.commit()
            except Exception:  # noqa: BLE001
                session.rollback()
            session.close()

    def run_forever(self) -> None:
        logger.info("scheduler started", extra={"poll_seconds": self.settings.scheduler_poll_seconds})
        while True:
            try:
                self.tick()
            except Exception:  # noqa: BLE001
                logger.exception("scheduler loop error")
            time.sleep(self.settings.scheduler_poll_seconds)
