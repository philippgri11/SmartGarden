from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.application.alerting_service import AlertingService
from app.application.gpio_state_service import GpioStateService
from app.application.heartbeat_service import HeartbeatService
from app.application.weather_service import WeatherService
from app.config import Settings
from app.domain.adaptive_irrigation import ADAPTIVE_REASON_PREFIX
from app.domain.models import RunStatus, TriggerType
from app.infrastructure.db import orm
from app.infrastructure.gpio.base import GpioAdapter


logger = logging.getLogger(__name__)


@dataclass(slots=True)
class SafetyViolation:
    fingerprint: str
    title: str
    message: str
    severity: str = "critical"
    emergency_stop: bool = True


class WatchdogService:
    def __init__(self, session: Session, settings: Settings, gpio: GpioAdapter | None):
        self.session = session
        self.settings = settings
        self.gpio = gpio
        self.heartbeat = HeartbeatService(session)
        self.alerting = AlertingService(session, settings)
        self.gpio_state = GpioStateService(session)

    def tick(self, *, now: datetime | None = None) -> list[SafetyViolation]:
        timestamp = now or datetime.now(UTC)
        violations = self.check(timestamp)
        if violations:
            for violation in violations:
                if violation.emergency_stop:
                    self._emergency_stop(violation, now=timestamp)
                self.alerting.record_and_notify(
                    fingerprint=violation.fingerprint,
                    severity=violation.severity,
                    title=violation.title,
                    message=violation.message,
                    component="watchdog",
                    now=timestamp,
                )
            self.heartbeat.beat(
                component="watchdog",
                status="alert",
                details={"violations": [violation.fingerprint for violation in violations]},
                now=timestamp,
            )
        else:
            self.heartbeat.beat(component="watchdog", status="ok", details={"violations": []}, now=timestamp)
        self.session.commit()
        return violations

    def check(self, now: datetime) -> list[SafetyViolation]:
        violations: list[SafetyViolation] = []
        violations.extend(self._running_overflow(now))
        violations.extend(self._overtime_runs(now))
        violations.extend(self._duplicate_adaptive_runs())
        scheduler_violation = self._stale_scheduler_heartbeat(now)
        if scheduler_violation:
            violations.append(scheduler_violation)
        return violations

    def _running_overflow(self, now: datetime) -> list[SafetyViolation]:
        running = self._running_runs()
        if len(running) <= self.settings.max_global_concurrent_runs:
            return []
        zone_names = ", ".join(run.zone.name if run.zone else f"Zone {run.zone_id}" for run in running)
        return [
            SafetyViolation(
                fingerprint="running-overflow",
                title="Mehrere Bewaesserungen gleichzeitig erkannt",
                message=(
                    f"Der Watchdog hat {len(running)} laufende Bewaesserungen erkannt, erlaubt sind "
                    f"{self.settings.max_global_concurrent_runs}. Betroffene Bereiche: {zone_names}. Zeitpunkt: {now.isoformat()}."
                ),
            )
        ]

    def _overtime_runs(self, now: datetime) -> list[SafetyViolation]:
        violations: list[SafetyViolation] = []
        for run in self._running_runs():
            if not run.started_at:
                continue
            started_at = self._as_utc(run.started_at)
            zone = run.zone or self.session.get(orm.Zone, run.zone_id)
            max_minutes = min(run.requested_duration_minutes, zone.max_duration_minutes if zone else self.settings.scheduler_default_run_timeout_minutes)
            hard_stop_at = started_at + timedelta(minutes=max_minutes, seconds=self.settings.watchdog_run_safety_margin_seconds)
            if now <= hard_stop_at:
                continue
            zone_name = zone.name if zone else f"Zone {run.zone_id}"
            violations.append(
                SafetyViolation(
                    fingerprint=f"run-overtime-{run.id}",
                    title=f"{zone_name} laeuft zu lange",
                    message=(
                        f"Lauf {run.id} fuer {zone_name} laeuft seit {started_at.isoformat()} und hat die harte Grenze "
                        f"von {max_minutes} Minuten plus Sicherheitsaufschlag ueberschritten."
                    ),
                )
            )
        return violations

    def _duplicate_adaptive_runs(self) -> list[SafetyViolation]:
        rows = self.session.execute(
            select(
                orm.WateringRun.zone_id,
                orm.WateringRun.scheduled_for,
                orm.WateringRun.scheduled_time,
                func.count(orm.WateringRun.id),
            )
            .where(
                orm.WateringRun.schedule_id.is_(None),
                orm.WateringRun.trigger_type == TriggerType.SCHEDULED.value,
                orm.WateringRun.status.in_([RunStatus.PLANNED.value, RunStatus.RUNNING.value]),
                orm.WateringRun.reason.like(f"{ADAPTIVE_REASON_PREFIX}%"),
                orm.WateringRun.scheduled_for.is_not(None),
                orm.WateringRun.scheduled_time.is_not(None),
            )
            .group_by(orm.WateringRun.zone_id, orm.WateringRun.scheduled_for, orm.WateringRun.scheduled_time)
            .having(func.count(orm.WateringRun.id) > self.settings.watchdog_duplicate_run_threshold)
        ).all()
        violations: list[SafetyViolation] = []
        for zone_id, scheduled_for, scheduled_time, count in rows:
            zone = self.session.get(orm.Zone, zone_id)
            zone_name = zone.name if zone else f"Zone {zone_id}"
            violations.append(
                SafetyViolation(
                    fingerprint=f"duplicate-adaptive-{zone_id}-{scheduled_for}-{scheduled_time}",
                    title=f"Doppelte adaptive Laeufe fuer {zone_name}",
                    message=(
                        f"Der Watchdog hat {count} adaptive Laeufe fuer {zone_name} am {scheduled_for} um "
                        f"{scheduled_time} gefunden. Das deutet auf einen Scheduler-Fehler hin."
                    ),
                )
            )
        return violations

    def _stale_scheduler_heartbeat(self, now: datetime) -> SafetyViolation | None:
        heartbeat = self.heartbeat.get("scheduler")
        threshold = timedelta(seconds=max(10, self.settings.scheduler_heartbeat_max_age_seconds))
        active_runs = self._active_runs()
        if heartbeat is None:
            is_stale = True
            age_text = "kein Heartbeat vorhanden"
        else:
            last_seen = self._as_utc(heartbeat.last_seen_at)
            is_stale = now - last_seen > threshold
            age_text = f"letzter Heartbeat {last_seen.isoformat()}"
        if not is_stale:
            return None
        return SafetyViolation(
            fingerprint="scheduler-heartbeat-stale",
            title="Scheduler-Heartbeat fehlt",
            message=(
                f"Der Scheduler wirkt nicht gesund ({age_text}). "
                f"Offene oder laufende Bewaesserungen: {len(active_runs)}."
            ),
            severity="critical" if active_runs else "warning",
            emergency_stop=bool(active_runs),
        )

    def _emergency_stop(self, violation: SafetyViolation, *, now: datetime) -> None:
        zones = list(self.session.scalars(select(orm.Zone).order_by(orm.Zone.id)))
        if self.gpio:
            try:
                self.gpio.initialize(zones)
                self.gpio.deactivate_all(zones)
                self.gpio_state.record_all_off(source="watchdog", reason=violation.title)
            except Exception:  # noqa: BLE001
                logger.exception("watchdog gpio shutdown failed", extra={"violation": violation.fingerprint})
        app_settings = WeatherService(self.session, self.settings).get_settings()
        app_settings.safety_stop_active = True
        app_settings.safety_stop_reason = f"Watchdog: {violation.title}"
        for run in self._active_runs():
            run.stop_requested = True
            run.reason = f"watchdog emergency stop: {violation.title}"
            run.status = RunStatus.CANCELLED.value
            run.finished_at = now
            if run.started_at:
                run.duration_seconds = max(0, int((now - self._as_utc(run.started_at)).total_seconds()))
        self.session.flush()

    def _active_runs(self) -> list[orm.WateringRun]:
        return list(
            self.session.scalars(
                select(orm.WateringRun)
                .where(orm.WateringRun.status.in_([RunStatus.PLANNED.value, RunStatus.RUNNING.value]))
                .order_by(orm.WateringRun.created_at.asc())
            )
        )

    def _running_runs(self) -> list[orm.WateringRun]:
        return list(
            self.session.scalars(
                select(orm.WateringRun)
                .where(orm.WateringRun.status == RunStatus.RUNNING.value)
                .order_by(orm.WateringRun.created_at.asc())
            )
        )

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
