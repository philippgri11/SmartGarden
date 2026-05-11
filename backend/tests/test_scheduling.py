from datetime import datetime, time

from app.domain.services import current_schedule_slot, is_schedule_due
from app.infrastructure.db.orm import Schedule


def build_schedule(**overrides):
    data = {
        "id": 1,
        "zone_id": 1,
        "active": True,
        "weekdays": "mon,wed,fri",
        "start_time": time(6, 0),
        "duration_minutes": 5,
        "interval_hours": None,
        "window_start": None,
        "window_end": None,
        "weather_enabled": False,
    }
    data.update(overrides)
    return Schedule(**data)


def test_fixed_time_schedule_due_within_grace() -> None:
    schedule = build_schedule()
    now = datetime(2026, 5, 11, 6, 5)
    assert is_schedule_due(schedule, now, grace_minutes=10) is True


def test_interval_schedule_returns_latest_due_slot() -> None:
    schedule = build_schedule(
        weekdays="sun",
        start_time=time(6, 0),
        interval_hours=4,
        window_start=time(6, 0),
        window_end=time(18, 0),
    )
    now = datetime(2026, 5, 10, 10, 2)
    slot = current_schedule_slot(schedule, now, grace_minutes=5)
    assert slot is not None
    assert slot.hour == 10

