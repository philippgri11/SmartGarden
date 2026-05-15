from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import Settings


def app_timezone(settings: Settings) -> ZoneInfo:
    try:
        return ZoneInfo(settings.app_timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def now_in_app_timezone(settings: Settings) -> datetime:
    return datetime.now(app_timezone(settings))


def scheduled_wall_time_to_utc(value: datetime, settings: Settings) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=app_timezone(settings))
    return value.astimezone(ZoneInfo("UTC"))
