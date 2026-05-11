from datetime import UTC, datetime, timedelta

from app.application.runtime_service import RuntimeService
from app.domain.models import RunStatus
from app.infrastructure.db.orm import AppSetting, WateringRun, Zone


def build_settings(**overrides: object) -> AppSetting:
    data = {
        "location_name": "Testgarten",
        "latitude": 52.52,
        "longitude": 13.405,
        "weather_enabled": True,
        "weather_window_hours": 6,
        "weather_probability_threshold": 70,
        "weather_precipitation_mm_threshold": 2.0,
        "weather_fail_mode": "allow",
        "winter_mode_active": False,
        "winter_disable_manual_start": True,
        "winter_pause_schedules": True,
        "safety_shutdown_on_winter": True,
        "system_paused_until": None,
        "safety_stop_active": False,
        "safety_stop_reason": None,
    }
    data.update(overrides)
    return AppSetting(**data)


def build_zone(**overrides: object) -> Zone:
    data = {
        "id": 1,
        "name": "Gemuesebeet Nord",
        "gpio_chip": "/dev/gpiochip0",
        "gpio_line": 12,
        "active": True,
        "default_manual_duration_minutes": 5,
        "max_duration_minutes": 10,
        "weather_enabled": False,
        "last_known_gpio_state": False,
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    data.update(overrides)
    return Zone(**data)


def build_run(**overrides: object) -> WateringRun:
    data = {
        "id": 1,
        "zone_id": 1,
        "trigger_type": "manual",
        "status": RunStatus.PLANNED.value,
        "requested_duration_minutes": 5,
        "sequence_group_id": None,
        "sequence_order": None,
        "stop_requested": False,
        "created_at": datetime.now(UTC),
    }
    data.update(overrides)
    return WateringRun(**data)


def test_manual_start_block_reason_reports_queued_run() -> None:
    reason = RuntimeService._manual_start_block_reason(
        zone=build_zone(),
        app_settings=build_settings(),
        run_state="queued",
        status="scheduled-soon",
        now=datetime.now(UTC),
    )
    assert reason == "Der Start wurde bereits angefordert."


def test_remaining_seconds_respects_zone_hard_limit() -> None:
    now = datetime.now(UTC)
    remaining = RuntimeService._current_run_remaining_seconds(
        zone=build_zone(max_duration_minutes=2),
        current_run=build_run(
            status=RunStatus.RUNNING.value,
            requested_duration_minutes=5,
            started_at=now - timedelta(seconds=30),
        ),
        run_state="running",
        now=now,
    )
    assert remaining == 90
