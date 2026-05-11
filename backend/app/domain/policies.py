from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta

from app.domain.models import WeatherDecisionKind


@dataclass(slots=True)
class WeatherPolicyInput:
    enabled: bool
    probability_threshold: int
    precipitation_mm_threshold: float
    probability_max: float | None
    precipitation_sum_mm: float | None
    fail_mode: str
    api_error: str | None = None


@dataclass(slots=True)
class WeatherPolicyResult:
    decision: WeatherDecisionKind
    reason: str


def enforce_max_duration(requested_minutes: int, zone_max_minutes: int) -> int:
    return max(1, min(requested_minutes, zone_max_minutes))


def should_finish_run(started_at: datetime, now: datetime, target_minutes: int, hard_limit_minutes: int) -> bool:
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    max_minutes = min(target_minutes, hard_limit_minutes)
    return now >= started_at + timedelta(minutes=max_minutes)


def evaluate_weather_policy(payload: WeatherPolicyInput) -> WeatherPolicyResult:
    if not payload.enabled:
        return WeatherPolicyResult(decision=WeatherDecisionKind.ALLOW, reason="weather disabled")

    if payload.api_error:
        if payload.fail_mode == "deny":
            return WeatherPolicyResult(decision=WeatherDecisionKind.ERROR, reason=f"weather api error: {payload.api_error}")
        return WeatherPolicyResult(decision=WeatherDecisionKind.ALLOW, reason=f"weather api error overridden: {payload.api_error}")

    probability = payload.probability_max or 0.0
    precipitation = payload.precipitation_sum_mm or 0.0
    if probability >= payload.probability_threshold or precipitation >= payload.precipitation_mm_threshold:
        return WeatherPolicyResult(
            decision=WeatherDecisionKind.SKIP,
            reason=f"skip due to forecast probability={probability} precipitation_mm={precipitation}",
        )
    return WeatherPolicyResult(decision=WeatherDecisionKind.ALLOW, reason="forecast below thresholds")


def is_time_in_window(candidate: time, window_start: time | None, window_end: time | None) -> bool:
    if window_start is None or window_end is None:
        return True
    return window_start <= candidate <= window_end
