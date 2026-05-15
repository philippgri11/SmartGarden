from datetime import UTC, datetime, timedelta

from app.application.schemas import AdaptiveIrrigationPlan, ZoneIrrigationProfile
from app.application.runtime_service import RuntimeService
from app.domain.models import RunStatus
from app.infrastructure.db.orm import AppSetting, Schedule, WateringRun, Zone

from conftest import TEST_SETTINGS


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


def test_runtime_next_watering_uses_sequenced_projection(db_session, monkeypatch) -> None:
    settings = build_settings(weather_enabled=False)
    db_session.add(settings)
    manual_zone = Zone(
        name="Rasen",
        gpio_chip="/dev/gpiochip0",
        gpio_line=1,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=30,
        weather_enabled=False,
    )
    adaptive_zone = Zone(
        name="Terrasse",
        gpio_chip="/dev/gpiochip0",
        gpio_line=2,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=30,
        weather_enabled=False,
        scheduling_mode="adaptive",
        irrigation_profile_json=ZoneIrrigationProfile(
            zoneType="container",
            plantType="flowers",
            sunExposure="full_sun",
            rainExposure="low",
            rainEffectiveness=0.3,
            waterNeedLevel="high",
            baseWaterNeedMmPerDay=5,
            temperatureSensitivity=1.2,
            sunSensitivity=1.2,
            containerFactor=1.4,
            dryingSpeed="fast",
            wateringFrequencyPreference="normal",
            preferredTimeWindow="early_morning",
            strategy="balanced",
            riskProfile="balanced",
            explanation="Testprofil",
        ).model_dump(),
        adaptive_irrigation_plan_json=AdaptiveIrrigationPlan(
            preferredTimeWindows=["early_morning"],
            minIntervalHours=18,
            baseDurationMinutes=8,
            maxDurationMinutes=20,
            rules=["Testregel"],
            explanation="Testplan",
        ).model_dump(),
    )
    db_session.add_all([manual_zone, adaptive_zone])
    db_session.flush()
    db_session.add(
        Schedule(
            zone_id=manual_zone.id,
            active=True,
            weekdays="wed",
            start_time=datetime(2026, 5, 13, 5, 30, tzinfo=UTC).time(),
            duration_minutes=12,
            weather_enabled=False,
        )
    )
    db_session.commit()
    monkeypatch.setattr("app.application.weather_service.WeatherService.try_fetch_current_summary", lambda *args, **kwargs: None)

    areas = RuntimeService(db_session, TEST_SETTINGS).list_areas(now=datetime(2026, 5, 13, 3, 0, tzinfo=UTC), app_settings=settings)

    terrace = next(area for area in areas if area["name"] == "Terrasse")
    assert terrace["next_watering_at"].time().hour == 5
    assert terrace["next_watering_at"].time().minute == 42
