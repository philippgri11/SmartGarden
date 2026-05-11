from __future__ import annotations

from dataclasses import dataclass
from datetime import time

from sqlalchemy import select

from app.application.weather_service import WeatherService
from app.config import get_settings
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import ScheduleRepository, ZoneRepository
from app.infrastructure.db.session import SessionLocal


@dataclass(frozen=True)
class SeedZone:
    name: str
    description: str
    gpio_line: int
    default_manual_duration_minutes: int
    max_duration_minutes: int
    weekdays: tuple[str, ...]
    start_time: time
    duration_minutes: int


SEED_ZONES = (
    SeedZone(
        name="Teich",
        description="Randbepflanzung rund um den Teich",
        gpio_line=10,
        default_manual_duration_minutes=4,
        max_duration_minutes=8,
        weekdays=("mon", "thu"),
        start_time=time(6, 30),
        duration_minutes=4,
    ),
    SeedZone(
        name="Terrasse",
        description="Kübel und Beete im Terrassenbereich",
        gpio_line=11,
        default_manual_duration_minutes=3,
        max_duration_minutes=6,
        weekdays=("tue", "fri"),
        start_time=time(7, 0),
        duration_minutes=3,
    ),
    SeedZone(
        name="Rasenfläche",
        description="Große zentrale Rasenfläche",
        gpio_line=12,
        default_manual_duration_minutes=8,
        max_duration_minutes=12,
        weekdays=("wed", "sat"),
        start_time=time(5, 45),
        duration_minutes=8,
    ),
)


def seed_local_data_in_session(session, settings) -> None:
    WeatherService(session, settings).get_settings()
    zones = ZoneRepository(session)
    schedules = ScheduleRepository(session)
    for item in SEED_ZONES:
        zone = session.execute(select(orm.Zone).where(orm.Zone.name == item.name)).scalar_one_or_none()
        if zone is None:
            zone = orm.Zone(
                name=item.name,
                description=item.description,
                gpio_chip="/dev/gpiochip0",
                gpio_line=item.gpio_line,
                active=True,
                default_manual_duration_minutes=item.default_manual_duration_minutes,
                max_duration_minutes=item.max_duration_minutes,
                weather_enabled=False,
            )
            zones.add(zone)
            session.flush()
        else:
            zone.description = item.description
            zone.gpio_chip = "/dev/gpiochip0"
            zone.gpio_line = item.gpio_line
            zone.active = True
            zone.default_manual_duration_minutes = item.default_manual_duration_minutes
            zone.max_duration_minutes = item.max_duration_minutes

        existing_schedule = session.execute(
            select(orm.Schedule).where(
                orm.Schedule.zone_id == zone.id,
                orm.Schedule.start_time == item.start_time,
                orm.Schedule.duration_minutes == item.duration_minutes,
            )
        ).scalar_one_or_none()
        if existing_schedule is None:
            schedules.add(
                orm.Schedule(
                    zone_id=zone.id,
                    active=True,
                    weekdays=",".join(item.weekdays),
                    start_time=item.start_time,
                    duration_minutes=item.duration_minutes,
                    interval_hours=None,
                    window_start=None,
                    window_end=None,
                    weather_enabled=False,
                )
            )
    session.commit()


def seed_local_data() -> None:
    settings = get_settings()
    session = SessionLocal()
    try:
        seed_local_data_in_session(session, settings)
    finally:
        session.close()


if __name__ == "__main__":
    seed_local_data()
