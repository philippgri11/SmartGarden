from datetime import UTC, datetime, timedelta

from app.domain.models import WeatherDecisionKind
from app.domain.policies import WeatherPolicyInput, enforce_max_duration, evaluate_weather_policy, should_finish_run


def test_enforce_max_duration_caps_to_zone_limit() -> None:
    assert enforce_max_duration(20, 5) == 5


def test_weather_policy_skips_when_rain_expected() -> None:
    result = evaluate_weather_policy(
        WeatherPolicyInput(
            enabled=True,
            probability_threshold=70,
            precipitation_mm_threshold=2.0,
            probability_max=90,
            precipitation_sum_mm=0.2,
            fail_mode="allow",
        )
    )
    assert result.decision == WeatherDecisionKind.SKIP


def test_weather_policy_obeys_fail_closed_mode() -> None:
    result = evaluate_weather_policy(
        WeatherPolicyInput(
            enabled=True,
            probability_threshold=70,
            precipitation_mm_threshold=2.0,
            probability_max=None,
            precipitation_sum_mm=None,
            fail_mode="deny",
            api_error="timeout",
        )
    )
    assert result.decision == WeatherDecisionKind.ERROR


def test_should_finish_run_uses_hard_limit() -> None:
    started = datetime.now(UTC) - timedelta(minutes=11)
    assert should_finish_run(started, datetime.now(UTC), target_minutes=30, hard_limit_minutes=10) is True
