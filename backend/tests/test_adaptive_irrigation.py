from datetime import UTC, datetime, time

from app.application.schemas import AdaptiveIrrigationPlan, ZoneIrrigationProfile
from app.application.weather_service import WeatherService
from app.domain.adaptive_irrigation import ADAPTIVE_REASON_PREFIX, current_adaptive_slot, decide_adaptive_plan
from app.domain.models import RunStatus, TriggerType
from app.domain.zone_irrigation import ZoneWeatherFacts
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import WateringRunRepository
from app.infrastructure.gpio.simulated import SimulatedGpioAdapter
from app.infrastructure.scheduler.runner import SchedulerRunner
from app.application.watering_service import WateringService
from app.infrastructure.weather.open_meteo_client import WeatherForecastSummary

from conftest import TEST_SETTINGS


def test_adaptive_slot_only_matches_approved_window() -> None:
    plan = AdaptiveIrrigationPlan(preferredTimeWindows=["early_morning"], explanation="Testregel")

    assert current_adaptive_slot(plan, now=datetime(2026, 5, 12, 5, 42, tzinfo=UTC)) is not None
    assert current_adaptive_slot(plan, now=datetime(2026, 5, 12, 12, 0, tzinfo=UTC)) is None


def test_adaptive_decision_allows_second_run_for_hot_container() -> None:
    profile = ZoneIrrigationProfile(
        zoneType="container",
        plantType="vegetables",
        sunExposure="full_sun",
        rainExposure="none",
        rainEffectiveness=0.05,
        waterNeedLevel="high",
        baseWaterNeedMmPerDay=5.5,
        temperatureSensitivity=1.6,
        sunSensitivity=1.8,
        containerFactor=1.8,
        dryingSpeed="very_fast",
        wateringFrequencyPreference="frequent_short",
        preferredTimeWindow="morning_and_evening",
        strategy="balanced",
        riskProfile="avoid_drought_stress",
        explanation="Testprofil",
    )
    plan = AdaptiveIrrigationPlan(
        preferredTimeWindows=["morning_and_evening"],
        allowSecondDailyRun=True,
        minIntervalHours=8,
        baseDurationMinutes=8,
        maxDurationMinutes=16,
        rules=["Testregel"],
        explanation="Testplan",
    )

    decision = decide_adaptive_plan(
        profile=profile,
        plan=plan,
        weather=ZoneWeatherFacts(temperature_max_c=32, rain_last_24h_mm=0, rain_next_24h_mm=0, cloud_cover_avg_pct=10),
        now=datetime(2026, 5, 12, 19, 5, tzinfo=UTC),
        last_run_at=datetime(2026, 5, 12, 6, 0, tzinfo=UTC),
        max_duration_minutes=20,
        already_watered_today=True,
    )

    assert decision.should_plan is True
    assert decision.duration_minutes > plan.baseDurationMinutes


def test_scheduler_creates_adaptive_planned_run(db_session, monkeypatch) -> None:
    settings = WeatherService(db_session, TEST_SETTINGS).get_settings()
    settings.weather_enabled = True
    zone = orm.Zone(
        name="Kuebel",
        description="Sonnige Kuebel",
        gpio_chip="/dev/gpiochip0",
        gpio_line=4,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=20,
        weather_enabled=False,
        scheduling_mode="adaptive",
        irrigation_profile_json=ZoneIrrigationProfile(
            zoneType="container",
            plantType="vegetables",
            sunExposure="full_sun",
            rainExposure="none",
            rainEffectiveness=0.0,
            waterNeedLevel="high",
            baseWaterNeedMmPerDay=5.0,
            temperatureSensitivity=1.5,
            sunSensitivity=1.7,
            containerFactor=1.7,
            dryingSpeed="fast",
            wateringFrequencyPreference="frequent_short",
            preferredTimeWindow="early_morning",
            strategy="balanced",
            riskProfile="avoid_drought_stress",
            explanation="Testprofil",
        ).model_dump(),
        adaptive_irrigation_plan_json=AdaptiveIrrigationPlan(
            preferredTimeWindows=["early_morning"],
            allowSecondDailyRun=True,
            minIntervalHours=8,
            baseDurationMinutes=8,
            maxDurationMinutes=16,
            rules=["Testregel"],
            explanation="Testplan",
        ).model_dump(),
    )
    db_session.add(zone)
    db_session.commit()

    def fake_fetch_forecast(self, *, latitude: float, longitude: float, hours: int):
        return WeatherForecastSummary(
            probability_max=0,
            precipitation_sum_mm=0,
            current_weather_code=0,
            current_is_day=True,
            current_temperature_c=23,
            temperature_max_24h_c=31,
            precipitation_last_24h_mm=0,
            precipitation_next_24h_mm=0,
            cloud_cover_avg_pct=5,
            raw_response={"mock": True},
        )

    monkeypatch.setattr("app.infrastructure.weather.open_meteo_client.OpenMeteoClient.fetch_forecast", fake_fetch_forecast)
    runner = SchedulerRunner()
    runner.settings = TEST_SETTINGS
    watering = WateringService(db_session, TEST_SETTINGS, SimulatedGpioAdapter())

    runner._plan_adaptive_runs(
        db_session,
        app_settings=settings,
        watering=watering,
        runs=WateringRunRepository(db_session),
        now=datetime(2026, 5, 12, 5, 40, tzinfo=UTC),
    )

    run = db_session.query(orm.WateringRun).one()
    assert run.trigger_type == TriggerType.SCHEDULED.value
    assert run.status == RunStatus.PLANNED.value
    assert run.reason.startswith(ADAPTIVE_REASON_PREFIX)
    assert run.schedule_id is None


def test_scheduler_deduplicates_adaptive_run_after_sequence_shift(db_session, monkeypatch) -> None:
    settings = WeatherService(db_session, TEST_SETTINGS).get_settings()
    settings.weather_enabled = True
    blocking_zone = orm.Zone(
        name="Kiefer",
        description="",
        gpio_chip="/dev/gpiochip0",
        gpio_line=3,
        active=True,
        max_duration_minutes=20,
    )
    adaptive_zone = orm.Zone(
        name="Teich",
        description="",
        gpio_chip="/dev/gpiochip0",
        gpio_line=4,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=20,
        weather_enabled=True,
        scheduling_mode="adaptive",
        irrigation_profile_json=ZoneIrrigationProfile(
            zoneType="container",
            plantType="flowers",
            sunExposure="full_sun",
            rainExposure="medium",
            rainEffectiveness=0.7,
            waterNeedLevel="high",
            baseWaterNeedMmPerDay=4.5,
            temperatureSensitivity=1.2,
            sunSensitivity=1.5,
            containerFactor=1.4,
            dryingSpeed="fast",
            wateringFrequencyPreference="frequent_short",
            preferredTimeWindow="early_morning",
            strategy="balanced",
            riskProfile="avoid_drought_stress",
            explanation="Testprofil",
        ).model_dump(),
        adaptive_irrigation_plan_json=AdaptiveIrrigationPlan(
            preferredTimeWindows=["early_morning"],
            allowSecondDailyRun=True,
            minIntervalHours=6,
            baseDurationMinutes=7,
            minDurationMinutes=4,
            maxDurationMinutes=10,
            rules=["Testregel"],
            explanation="Testplan",
        ).model_dump(),
    )
    db_session.add_all([blocking_zone, adaptive_zone])
    db_session.flush()
    runs = WateringRunRepository(db_session)
    runs.create_planned_run(
        zone_id=blocking_zone.id,
        schedule_id=None,
        trigger_type=TriggerType.SCHEDULED,
        duration_minutes=6,
        scheduled_for=datetime(2026, 5, 16).date(),
        scheduled_time=time(5, 30),
        reason="blocking run",
    )
    db_session.commit()

    def fake_fetch_forecast(self, *, latitude: float, longitude: float, hours: int):
        return WeatherForecastSummary(
            probability_max=0,
            precipitation_sum_mm=0,
            current_weather_code=0,
            current_is_day=True,
            current_temperature_c=22,
            temperature_max_24h_c=27,
            precipitation_last_24h_mm=0,
            precipitation_next_24h_mm=0,
            cloud_cover_avg_pct=5,
            raw_response={"mock": True},
        )

    monkeypatch.setattr("app.infrastructure.weather.open_meteo_client.OpenMeteoClient.fetch_forecast", fake_fetch_forecast)
    runner = SchedulerRunner()
    runner.settings = TEST_SETTINGS
    watering = WateringService(db_session, TEST_SETTINGS, SimulatedGpioAdapter())

    for _ in range(2):
        runner._plan_adaptive_runs(
            db_session,
            app_settings=settings,
            watering=watering,
            runs=runs,
            now=datetime(2026, 5, 16, 5, 40, tzinfo=UTC),
        )

    adaptive_runs = (
        db_session.query(orm.WateringRun)
        .filter(
            orm.WateringRun.zone_id == adaptive_zone.id,
            orm.WateringRun.reason.like(f"{ADAPTIVE_REASON_PREFIX}%"),
        )
        .all()
    )
    assert len(adaptive_runs) == 1
    assert adaptive_runs[0].scheduled_time == time(5, 36)


def test_scheduler_does_not_recreate_adaptive_run_within_same_window_after_completion(db_session, monkeypatch) -> None:
    settings = WeatherService(db_session, TEST_SETTINGS).get_settings()
    settings.weather_enabled = True
    adaptive_zone = orm.Zone(
        name="Kiefer",
        description="",
        gpio_chip="/dev/gpiochip0",
        gpio_line=4,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=20,
        weather_enabled=True,
        scheduling_mode="adaptive",
        irrigation_profile_json=ZoneIrrigationProfile(
            zoneType="bed",
            plantType="mixed",
            sunExposure="partial_shade",
            rainExposure="medium",
            rainEffectiveness=0.7,
            waterNeedLevel="medium",
            baseWaterNeedMmPerDay=3.5,
            temperatureSensitivity=1.1,
            sunSensitivity=1.1,
            containerFactor=1.0,
            dryingSpeed="normal",
            wateringFrequencyPreference="normal",
            preferredTimeWindow="early_morning",
            strategy="balanced",
            riskProfile="balanced",
            explanation="Testprofil",
        ).model_dump(),
        adaptive_irrigation_plan_json=AdaptiveIrrigationPlan(
            preferredTimeWindows=["early_morning"],
            allowSecondDailyRun=True,
            minIntervalHours=1,
            baseDurationMinutes=7,
            minDurationMinutes=4,
            maxDurationMinutes=10,
            rules=["Testregel"],
            explanation="Testplan",
        ).model_dump(),
    )
    db_session.add(adaptive_zone)
    db_session.flush()
    existing_run = WateringRunRepository(db_session).create_planned_run(
        zone_id=adaptive_zone.id,
        schedule_id=None,
        trigger_type=TriggerType.SCHEDULED,
        duration_minutes=6,
        scheduled_for=datetime(2026, 5, 19).date(),
        scheduled_time=time(5, 36),
        status=RunStatus.COMPLETED,
        reason=f"{ADAPTIVE_REASON_PREFIX} Adaptiver Lauf geplant: 6 Minuten im Fenster 05:30.",
    )
    existing_run.started_at = datetime(2026, 5, 19, 5, 36, tzinfo=UTC)
    existing_run.finished_at = datetime(2026, 5, 19, 5, 42, tzinfo=UTC)
    db_session.commit()

    def fake_fetch_forecast(self, *, latitude: float, longitude: float, hours: int):
        return WeatherForecastSummary(
            probability_max=0,
            precipitation_sum_mm=0,
            current_weather_code=0,
            current_is_day=True,
            current_temperature_c=22,
            temperature_max_24h_c=27,
            precipitation_last_24h_mm=0,
            precipitation_next_24h_mm=0,
            cloud_cover_avg_pct=5,
            raw_response={"mock": True},
        )

    monkeypatch.setattr("app.infrastructure.weather.open_meteo_client.OpenMeteoClient.fetch_forecast", fake_fetch_forecast)
    runner = SchedulerRunner()
    runner.settings = TEST_SETTINGS
    watering = WateringService(db_session, TEST_SETTINGS, SimulatedGpioAdapter())

    runner._plan_adaptive_runs(
        db_session,
        app_settings=settings,
        watering=watering,
        runs=WateringRunRepository(db_session),
        now=datetime(2026, 5, 19, 5, 48, tzinfo=UTC),
    )

    adaptive_runs = (
        db_session.query(orm.WateringRun)
        .filter(
            orm.WateringRun.zone_id == adaptive_zone.id,
            orm.WateringRun.reason.like(f"{ADAPTIVE_REASON_PREFIX}%"),
        )
        .all()
    )
    assert len(adaptive_runs) == 1
    assert adaptive_runs[0].scheduled_time == time(5, 36)
