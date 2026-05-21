from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.models import RunSource, RunStatus, TriggerType, WeatherDecisionKind
from app.infrastructure.db import orm


class ZoneRepository:
    def __init__(self, session: Session):
        self.session = session

    def list(self) -> list[orm.Zone]:
        return list(self.session.scalars(select(orm.Zone).order_by(orm.Zone.id)))

    def get(self, zone_id: int) -> orm.Zone | None:
        return self.session.get(orm.Zone, zone_id)

    def add(self, zone: orm.Zone) -> orm.Zone:
        self.session.add(zone)
        self.session.flush()
        return zone

    def delete(self, zone: orm.Zone) -> None:
        self.session.delete(zone)

    def set_gpio_state(self, zone: orm.Zone, state: bool) -> orm.Zone:
        zone.last_known_gpio_state = state
        zone.last_gpio_changed_at = orm.func.now()
        self.session.flush()
        return zone


class ScheduleRepository:
    def __init__(self, session: Session):
        self.session = session

    def list(self) -> list[orm.Schedule]:
        return list(self.session.scalars(select(orm.Schedule).order_by(orm.Schedule.id)))

    def list_active(self) -> list[orm.Schedule]:
        return list(self.session.scalars(select(orm.Schedule).where(orm.Schedule.active.is_(True))))

    def get(self, schedule_id: int) -> orm.Schedule | None:
        return self.session.get(orm.Schedule, schedule_id)

    def add(self, schedule: orm.Schedule) -> orm.Schedule:
        self.session.add(schedule)
        self.session.flush()
        return schedule

    def delete(self, schedule: orm.Schedule) -> None:
        self.session.delete(schedule)


class WateringRunRepository:
    def __init__(self, session: Session):
        self.session = session

    def list_recent(self, limit: int = 50) -> list[orm.WateringRun]:
        stmt = select(orm.WateringRun).order_by(orm.WateringRun.created_at.desc()).limit(limit)
        return list(self.session.scalars(stmt))

    def list_running(self) -> list[orm.WateringRun]:
        stmt = select(orm.WateringRun).where(orm.WateringRun.status == RunStatus.RUNNING.value)
        return list(self.session.scalars(stmt))

    def get(self, run_id: int) -> orm.WateringRun | None:
        return self.session.get(orm.WateringRun, run_id)

    def exists_schedule_slot(self, schedule_id: int, scheduled_for: date, scheduled_time: time) -> bool:
        stmt = select(orm.WateringRun.id).where(
            orm.WateringRun.schedule_id == schedule_id,
            orm.WateringRun.scheduled_for == scheduled_for,
            orm.WateringRun.scheduled_time == scheduled_time,
        )
        return self.session.execute(stmt).first() is not None

    def exists_occurrence_key(self, occurrence_key: str) -> bool:
        stmt = select(orm.WateringRun.id).where(orm.WateringRun.occurrence_key == occurrence_key)
        return self.session.execute(stmt).first() is not None

    def create_planned_run(
        self,
        *,
        zone_id: int,
        schedule_id: int | None,
        trigger_type: TriggerType,
        duration_minutes: int,
        source_type: RunSource | None = None,
        occurrence_key: str | None = None,
        scheduled_for: date | None = None,
        scheduled_time: time | None = None,
        status: RunStatus = RunStatus.PLANNED,
        reason: str | None = None,
        planning_reason: str | None = None,
        execution_reason: str | None = None,
        sequence_group_id: str | None = None,
        sequence_order: int | None = None,
    ) -> orm.WateringRun:
        plan_reason = planning_reason if planning_reason is not None else reason
        run = orm.WateringRun(
            zone_id=zone_id,
            schedule_id=schedule_id,
            trigger_type=trigger_type.value,
            source_type=(source_type or self._infer_source_type(trigger_type=trigger_type, schedule_id=schedule_id)).value,
            occurrence_key=occurrence_key,
            status=status.value,
            scheduled_for=scheduled_for,
            scheduled_time=scheduled_time,
            requested_duration_minutes=duration_minutes,
            sequence_group_id=sequence_group_id,
            sequence_order=sequence_order,
            reason=plan_reason,
            planning_reason=plan_reason,
            execution_reason=execution_reason,
        )
        self.session.add(run)
        self.session.flush()
        return run

    @staticmethod
    def _infer_source_type(*, trigger_type: TriggerType, schedule_id: int | None) -> RunSource:
        if trigger_type == TriggerType.MANUAL:
            return RunSource.MANUAL
        if schedule_id is not None:
            return RunSource.STATIC_SCHEDULE
        return RunSource.ADAPTIVE_RULE

    def create_weather_decision(
        self,
        *,
        run_id: int,
        latitude: float,
        longitude: float,
        forecast_window_hours: int,
        probability_max: float | None,
        precipitation_sum_mm: float | None,
        decision: WeatherDecisionKind,
        reason: str,
        raw_response: dict | None,
    ) -> orm.WeatherDecision:
        entity = orm.WeatherDecision(
            watering_run_id=run_id,
            latitude=latitude,
            longitude=longitude,
            forecast_window_hours=forecast_window_hours,
            precipitation_probability_max=probability_max,
            precipitation_sum_mm=precipitation_sum_mm,
            decision=decision.value,
            reason=reason,
            raw_response=raw_response,
        )
        self.session.add(entity)
        self.session.flush()
        return entity


class AppSettingRepository:
    def __init__(self, session: Session):
        self.session = session

    def get(self) -> orm.AppSetting | None:
        return self.session.get(orm.AppSetting, 1)

    def upsert(self, setting: orm.AppSetting) -> orm.AppSetting:
        self.session.add(setting)
        self.session.flush()
        return setting


class SystemHeartbeatRepository:
    def __init__(self, session: Session):
        self.session = session

    def beat(self, *, component: str, status: str, now: datetime, details: dict | None = None) -> orm.SystemHeartbeat:
        heartbeat = self.session.get(orm.SystemHeartbeat, component)
        if heartbeat is None:
            heartbeat = orm.SystemHeartbeat(
                component=component,
                status=status,
                details_json=details,
                last_seen_at=now,
            )
            self.session.add(heartbeat)
        else:
            heartbeat.status = status
            heartbeat.details_json = details
            heartbeat.last_seen_at = now
        self.session.flush()
        return heartbeat

    def get(self, component: str) -> orm.SystemHeartbeat | None:
        return self.session.get(orm.SystemHeartbeat, component)

    def list(self) -> list[orm.SystemHeartbeat]:
        return list(self.session.scalars(select(orm.SystemHeartbeat).order_by(orm.SystemHeartbeat.component.asc())))


class SystemAlertRepository:
    def __init__(self, session: Session):
        self.session = session

    def record(
        self,
        *,
        fingerprint: str,
        severity: str,
        title: str,
        message: str,
        component: str,
        now: datetime,
    ) -> orm.SystemAlert:
        alert = self.session.scalars(select(orm.SystemAlert).where(orm.SystemAlert.fingerprint == fingerprint)).one_or_none()
        if alert is None:
            alert = orm.SystemAlert(
                fingerprint=fingerprint,
                severity=severity,
                title=title,
                message=message,
                component=component,
                first_seen_at=now,
                last_seen_at=now,
                count=1,
            )
            self.session.add(alert)
        else:
            alert.severity = severity
            alert.title = title
            alert.message = message
            alert.component = component
            alert.last_seen_at = now
            alert.count += 1
            alert.resolved_at = None
        self.session.flush()
        return alert

    def list_recent(self, limit: int = 20) -> list[orm.SystemAlert]:
        stmt = select(orm.SystemAlert).order_by(orm.SystemAlert.last_seen_at.desc()).limit(limit)
        return list(self.session.scalars(stmt))


class GardenMapRepository:
    def __init__(self, session: Session):
        self.session = session

    def list(self) -> list[orm.GardenMap]:
        return list(self.session.scalars(select(orm.GardenMap).order_by(orm.GardenMap.id)))

    def get(self, map_id: int) -> orm.GardenMap | None:
        return self.session.get(orm.GardenMap, map_id)

    def add(self, entity: orm.GardenMap) -> orm.GardenMap:
        self.session.add(entity)
        self.session.flush()
        return entity

    def delete(self, entity: orm.GardenMap) -> None:
        self.session.delete(entity)


class ZoneMapShapeRepository:
    def __init__(self, session: Session):
        self.session = session

    def list_by_map(self, map_id: int) -> list[orm.ZoneMapShape]:
        stmt = select(orm.ZoneMapShape).where(orm.ZoneMapShape.garden_map_id == map_id).order_by(orm.ZoneMapShape.id)
        return list(self.session.scalars(stmt))

    def get(self, shape_id: int) -> orm.ZoneMapShape | None:
        return self.session.get(orm.ZoneMapShape, shape_id)

    def add(self, entity: orm.ZoneMapShape) -> orm.ZoneMapShape:
        self.session.add(entity)
        self.session.flush()
        return entity

    def delete(self, entity: orm.ZoneMapShape) -> None:
        self.session.delete(entity)


class GpioEventRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(self, *, zone_id: int, state: bool, source: str, reason: str | None = None) -> orm.GpioEvent:
        event = orm.GpioEvent(zone_id=zone_id, state=state, source=source, reason=reason)
        self.session.add(event)
        self.session.flush()
        return event

    def list_recent(self, limit: int = 100) -> list[orm.GpioEvent]:
        stmt = select(orm.GpioEvent).order_by(orm.GpioEvent.created_at.desc()).limit(limit)
        return list(self.session.scalars(stmt))
