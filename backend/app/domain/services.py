from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

from app.infrastructure.db import orm


WEEKDAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def parse_weekdays(weekdays: str) -> set[str]:
    return {day.strip().lower() for day in weekdays.split(",") if day.strip()}


def is_schedule_due(schedule: orm.Schedule, now: datetime, grace_minutes: int) -> bool:
    weekdays = parse_weekdays(schedule.weekdays)
    if WEEKDAY_NAMES[now.weekday()] not in weekdays:
        return False

    grace_start = now - timedelta(minutes=grace_minutes)
    if schedule.interval_hours:
        if not schedule.window_start or not schedule.window_end:
            return False
        cursor = datetime.combine(now.date(), schedule.window_start, tzinfo=now.tzinfo)
        end = datetime.combine(now.date(), schedule.window_end, tzinfo=now.tzinfo)
        while cursor <= end:
            if grace_start <= cursor <= now:
                return True
            cursor += timedelta(hours=schedule.interval_hours)
        return False

    scheduled_dt = datetime.combine(now.date(), schedule.start_time, tzinfo=now.tzinfo)
    return grace_start <= scheduled_dt <= now


def current_schedule_slot(schedule: orm.Schedule, now: datetime, grace_minutes: int) -> datetime | None:
    if not is_schedule_due(schedule, now, grace_minutes):
        return None

    if schedule.interval_hours and schedule.window_start and schedule.window_end:
        grace_start = now - timedelta(minutes=grace_minutes)
        cursor = datetime.combine(now.date(), schedule.window_start, tzinfo=now.tzinfo)
        end = datetime.combine(now.date(), schedule.window_end, tzinfo=now.tzinfo)
        matched: datetime | None = None
        while cursor <= end:
            if grace_start <= cursor <= now:
                matched = cursor
            cursor += timedelta(hours=schedule.interval_hours)
        return matched

    return datetime.combine(now.date(), schedule.start_time, tzinfo=now.tzinfo)


def next_schedule_occurrence(schedule: orm.Schedule, now: datetime, days_ahead: int = 14) -> datetime | None:
    weekdays = parse_weekdays(schedule.weekdays)
    base = now if now.tzinfo else now.replace(tzinfo=UTC)
    for day_offset in range(days_ahead + 1):
        candidate_date = (base + timedelta(days=day_offset)).date()
        weekday_name = WEEKDAY_NAMES[candidate_date.weekday()]
        if weekday_name not in weekdays:
            continue

        if schedule.interval_hours and schedule.window_start and schedule.window_end:
            cursor = datetime.combine(candidate_date, schedule.window_start, tzinfo=base.tzinfo)
            end = datetime.combine(candidate_date, schedule.window_end, tzinfo=base.tzinfo)
            while cursor <= end:
                if cursor > base:
                    return cursor
                cursor += timedelta(hours=schedule.interval_hours)
            continue

        scheduled_dt = datetime.combine(candidate_date, schedule.start_time, tzinfo=base.tzinfo)
        if scheduled_dt > base:
            return scheduled_dt
    return None
