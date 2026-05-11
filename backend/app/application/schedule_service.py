from __future__ import annotations

from sqlalchemy.orm import Session

from app.application.schemas import ScheduleCreate, ScheduleUpdate
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import ScheduleRepository, ZoneRepository


class ScheduleService:
    def __init__(self, session: Session):
        self.session = session
        self.schedules = ScheduleRepository(session)
        self.zones = ZoneRepository(session)

    def list_schedules(self) -> list[orm.Schedule]:
        return self.schedules.list()

    def create_schedule(self, payload: ScheduleCreate) -> orm.Schedule:
        if not self.zones.get(payload.zone_id):
            raise ValueError("zone not found")
        entity = orm.Schedule(
            zone_id=payload.zone_id,
            active=payload.active,
            weekdays=",".join(payload.weekdays),
            start_time=payload.start_time,
            duration_minutes=payload.duration_minutes,
            interval_hours=payload.interval_hours,
            window_start=payload.window_start,
            window_end=payload.window_end,
            weather_enabled=payload.weather_enabled,
            weather_probability_threshold=payload.weather_probability_threshold,
            weather_precipitation_mm_threshold=payload.weather_precipitation_mm_threshold,
        )
        self.schedules.add(entity)
        self.session.commit()
        self.session.refresh(entity)
        return entity

    def update_schedule(self, schedule_id: int, payload: ScheduleUpdate) -> orm.Schedule | None:
        entity = self.schedules.get(schedule_id)
        if not entity:
            return None
        entity.zone_id = payload.zone_id
        entity.active = payload.active
        entity.weekdays = ",".join(payload.weekdays)
        entity.start_time = payload.start_time
        entity.duration_minutes = payload.duration_minutes
        entity.interval_hours = payload.interval_hours
        entity.window_start = payload.window_start
        entity.window_end = payload.window_end
        entity.weather_enabled = payload.weather_enabled
        entity.weather_probability_threshold = payload.weather_probability_threshold
        entity.weather_precipitation_mm_threshold = payload.weather_precipitation_mm_threshold
        self.session.commit()
        self.session.refresh(entity)
        return entity

    def delete_schedule(self, schedule_id: int) -> bool:
        entity = self.schedules.get(schedule_id)
        if not entity:
            return False
        self.schedules.delete(entity)
        self.session.commit()
        return True

