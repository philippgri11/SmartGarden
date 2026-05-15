from datetime import UTC, datetime, time

from app.application.irrigation_projection_service import IrrigationProjectionService
from app.application.weather_service import ForecastLookup
from app.application.schemas import AdaptiveIrrigationPlan, ZoneIrrigationProfile
from app.application.watering_service import WateringService
from app.config import Settings
from app.domain.models import RunStatus, TriggerType
from app.domain.services import current_schedule_slot, is_schedule_due
from app.infrastructure.db import orm
from app.infrastructure.db.orm import Schedule
from app.infrastructure.db.repositories import WateringRunRepository
from app.infrastructure.gpio.simulated import SimulatedGpioAdapter

from conftest import TEST_SETTINGS


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


def test_projection_sequences_manual_before_adaptive(db_session, monkeypatch) -> None:
    manual_zone = orm.Zone(
        name="Rasen",
        description="Rasen",
        gpio_chip="/dev/gpiochip0",
        gpio_line=1,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=30,
        weather_enabled=False,
    )
    adaptive_zone = orm.Zone(
        name="Hochbeet",
        description="Hochbeet",
        gpio_chip="/dev/gpiochip0",
        gpio_line=2,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=30,
        weather_enabled=False,
        scheduling_mode="adaptive",
        irrigation_profile_json=ZoneIrrigationProfile(
            zoneType="raised_bed",
            plantType="vegetables",
            sunExposure="full_sun",
            rainExposure="full",
            rainEffectiveness=0.7,
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
        orm.Schedule(
            zone_id=manual_zone.id,
            active=True,
            weekdays="wed",
            start_time=time(5, 30),
            duration_minutes=12,
            weather_enabled=False,
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        "app.application.weather_service.WeatherService.try_fetch_current_lookup",
        lambda *args, **kwargs: ForecastLookup(summary=None, source_status="unavailable", checked_at=None, error="429"),
    )
    projection = IrrigationProjectionService(db_session, TEST_SETTINGS).build_projection(
        days=1,
        now=datetime(2026, 5, 13, 3, 0, tzinfo=UTC),
    )

    first_two = projection.items[:2]
    assert [item.source for item in first_two] == ["manual_rule", "adaptive_rule"]
    assert first_two[0].planned_start.time() == time(5, 30)
    assert first_two[1].planned_start.time() == time(5, 42)
    assert first_two[1].adjusted_for_sequence is True
    assert projection.weather_source_status == "unavailable"
    assert "Wetterdaten fehlen" in (first_two[1].weather_summary or "")


def test_projection_keeps_fixed_schedule_as_local_wall_time(db_session, monkeypatch) -> None:
    zone = orm.Zone(
        name="Terrasse",
        description="Terrasse",
        gpio_chip="/dev/gpiochip0",
        gpio_line=7,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=30,
        weather_enabled=False,
    )
    db_session.add(zone)
    db_session.flush()
    db_session.add(
        orm.Schedule(
            zone_id=zone.id,
            active=True,
            weekdays="fri",
            start_time=time(14, 0),
            duration_minutes=1,
            weather_enabled=False,
        )
    )
    db_session.commit()
    monkeypatch.setattr(
        "app.application.weather_service.WeatherService.try_fetch_current_lookup",
        lambda *args, **kwargs: ForecastLookup(summary=None, source_status="unavailable", checked_at=None, error="429"),
    )

    projection = IrrigationProjectionService(db_session, TEST_SETTINGS).build_projection(
        days=1,
        now=datetime(2026, 5, 15, 11, 58, tzinfo=UTC),
    )

    item = projection.items[0]
    assert item.planned_start.time() == time(14, 0)
    assert item.planned_start.utcoffset().total_seconds() == 7200


def test_projection_endpoint_returns_backend_plan(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.application.weather_service.WeatherService.try_fetch_current_lookup",
        lambda *args, **kwargs: ForecastLookup(summary=None, source_status="unavailable", checked_at=None, error="429"),
    )
    zone_response = client.post(
        "/api/zones",
        json={
            "name": "Beet",
            "gpio_chip": "/dev/gpiochip0",
            "gpio_line": 3,
            "active": True,
            "default_manual_duration_minutes": 5,
            "max_duration_minutes": 20,
            "weather_enabled": False,
        },
    )
    assert zone_response.status_code == 201
    schedule_response = client.post(
        "/api/schedules",
        json={
            "zone_id": zone_response.json()["id"],
            "active": True,
            "weekdays": ["wed"],
            "start_time": "06:00",
            "duration_minutes": 5,
            "weather_enabled": False,
        },
    )
    assert schedule_response.status_code == 201

    response = client.get("/api/schedules/projection?days=7")
    assert response.status_code == 200
    assert response.json()["items"][0]["zone_name"] == "Beet"


def test_execute_planned_runs_starts_only_one_zone_even_if_config_allows_more(db_session, monkeypatch) -> None:
    zones = [
        orm.Zone(name="Zone A", description="", gpio_chip="/dev/gpiochip0", gpio_line=11, active=True, max_duration_minutes=20),
        orm.Zone(name="Zone B", description="", gpio_chip="/dev/gpiochip0", gpio_line=12, active=True, max_duration_minutes=20),
    ]
    db_session.add_all(zones)
    db_session.flush()
    runs = WateringRunRepository(db_session)
    for zone in zones:
        runs.create_planned_run(
            zone_id=zone.id,
            schedule_id=None,
            trigger_type=TriggerType.MANUAL,
            duration_minutes=5,
        )
    db_session.commit()
    monkeypatch.setattr("app.application.weather_service.WeatherService.get_settings", lambda self: orm.AppSetting(
        id=1,
        location_name="Test",
        latitude=52.52,
        longitude=13.405,
        weather_enabled=False,
        weather_window_hours=6,
        weather_probability_threshold=70,
        weather_precipitation_mm_threshold=2,
        weather_fail_mode="allow",
        winter_mode_active=False,
        winter_disable_manual_start=True,
        winter_pause_schedules=True,
        safety_shutdown_on_winter=True,
        safety_stop_active=False,
    ))
    settings = Settings(environment="test", gpio_mode="simulated", max_global_concurrent_runs=4)

    WateringService(db_session, settings, SimulatedGpioAdapter()).execute_planned_runs()

    statuses = [run.status for run in db_session.query(orm.WateringRun).order_by(orm.WateringRun.id).all()]
    assert statuses.count(RunStatus.RUNNING.value) == 1
    assert statuses.count(RunStatus.PLANNED.value) == 1


def test_execute_planned_runs_compares_scheduled_time_in_app_timezone(db_session, monkeypatch) -> None:
    zone = orm.Zone(name="Terrasse", description="", gpio_chip="/dev/gpiochip0", gpio_line=17, active=True, max_duration_minutes=20)
    db_session.add(zone)
    db_session.flush()
    run = WateringRunRepository(db_session).create_planned_run(
        zone_id=zone.id,
        schedule_id=None,
        trigger_type=TriggerType.SCHEDULED,
        duration_minutes=5,
        scheduled_for=datetime(2026, 5, 15).date(),
        scheduled_time=time(14, 0),
    )
    db_session.commit()
    monkeypatch.setattr("app.application.weather_service.WeatherService.get_settings", lambda self: orm.AppSetting(
        id=1,
        location_name="Test",
        latitude=52.52,
        longitude=13.405,
        weather_enabled=False,
        weather_window_hours=6,
        weather_probability_threshold=70,
        weather_precipitation_mm_threshold=2,
        weather_fail_mode="allow",
        winter_mode_active=False,
        winter_disable_manual_start=True,
        winter_pause_schedules=True,
        safety_shutdown_on_winter=True,
        safety_stop_active=False,
    ))

    class BeforeLocalStart(datetime):
        @classmethod
        def now(cls, tz=None):
            value = datetime(2026, 5, 15, 11, 59, tzinfo=UTC)
            return value if tz else value.replace(tzinfo=None)

    monkeypatch.setattr("app.application.watering_service.datetime", BeforeLocalStart)
    service = WateringService(db_session, Settings(environment="test", gpio_mode="simulated"), SimulatedGpioAdapter())
    service.execute_planned_runs()
    db_session.refresh(run)

    assert run.status == RunStatus.PLANNED.value

    class AtLocalStart(datetime):
        @classmethod
        def now(cls, tz=None):
            value = datetime(2026, 5, 15, 12, 0, tzinfo=UTC)
            return value if tz else value.replace(tzinfo=None)

    monkeypatch.setattr("app.application.watering_service.datetime", AtLocalStart)
    service.execute_planned_runs()
    db_session.refresh(run)

    assert run.status == RunStatus.RUNNING.value
