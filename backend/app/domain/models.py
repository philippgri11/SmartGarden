from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time
from enum import StrEnum


class TriggerType(StrEnum):
    MANUAL = "manual"
    SCHEDULED = "scheduled"


class RunSource(StrEnum):
    MANUAL = "manual"
    STATIC_SCHEDULE = "static_schedule"
    ADAPTIVE_RULE = "adaptive_rule"


class RunStatus(StrEnum):
    PLANNED = "planned"
    RUNNING = "running"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    FAILED = "failed"
    CANCELLED = "cancelled"


class WeatherDecisionKind(StrEnum):
    ALLOW = "allow"
    SKIP = "skip"
    ERROR = "error"


@dataclass(slots=True)
class DueScheduleOccurrence:
    schedule_id: int
    zone_id: int
    scheduled_for: date
    run_at: time
    duration_minutes: int
