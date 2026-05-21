from datetime import UTC, datetime, time

from app.application.irrigation_projection_service import IrrigationProjectionService
from app.application.schemas import AdaptiveIrrigationPlan, ZoneIrrigationProfile
from app.application.weather_service import WeatherService
from app.domain.adaptive_irrigation import ADAPTIVE_REASON_PREFIX, adaptive_window_bounds, current_adaptive_slot, decide_adaptive_plan
from app.domain.models import RunSource, RunStatus, TriggerType
from app.domain.zone_irrigation import ZoneWeatherFacts
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import WateringRunRepository
from app.infrastructure.gpio.simulated import SimulatedGpioAdapter
from app.infrastructure.scheduler.runner import SchedulerRunner
from app.application.watering_service import WateringService
from app.infrastructure.weather.open_meteo_client import WeatherForecastSummary
from sqlalchemy.exc import IntegrityError

from conftest import TEST_SETTINGS


def test_adaptive_slot_only_matches_approved_window() -> None:
    plan = AdaptiveIrrigationPlan(preferredTimeWindows=["early_morning"], explanation="Testregel")

    assert current_adaptive_slot(plan, now=datetime(2026, 5, 12, 5, 42, tzinfo=UTC)) is not None
    assert current_adaptive_slot(plan, now=datetime(2026, 5, 12, 12, 0, tzinfo=UTC)) is None


def test_adaptive_windows_have_capacity_boundaries() -> None:
    plan = AdaptiveIrrigationPlan(preferredTimeWindows=["morning"], explanation="Testregel")
    start, end = adaptive_window_bounds(plan, slot=datetime(2026, 5, 12, 7, 0, tzinfo=UTC))

    assert start == datetime(2026, 5, 12, 7, 0, tzinfo=UTC)
    assert end == datetime(2026, 5, 12, 11, 0, tzinfo=UTC)


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
    assert run.source_type == "adaptive_rule"
    assert run.occurrence_key == f"adaptive:{zone.id}:2026-05-12:05:30:00"
    assert run.status == RunStatus.PLANNED.value
    assert run.reason.startswith(ADAPTIVE_REASON_PREFIX)
    assert run.planning_reason == run.reason
    assert run.execution_reason is None
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
    assert adaptive_runs[0].occurrence_key == f"adaptive:{adaptive_zone.id}:2026-05-16:05:30:00"


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


def test_scheduler_does_not_recreate_adaptive_run_when_duration_extends_beyond_window_grace(db_session, monkeypatch) -> None:
    settings = WeatherService(db_session, TEST_SETTINGS).get_settings()
    settings.weather_enabled = True
    adaptive_zone = orm.Zone(
        name="Langlauf Hochbeet",
        description="",
        gpio_chip="/dev/gpiochip0",
        gpio_line=4,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=90,
        weather_enabled=True,
        scheduling_mode="adaptive",
        irrigation_profile_json=ZoneIrrigationProfile(
            zoneType="raised_bed",
            plantType="vegetables",
            sunExposure="full_sun",
            rainExposure="medium",
            rainEffectiveness=0.6,
            waterNeedLevel="very_high",
            baseWaterNeedMmPerDay=8.0,
            temperatureSensitivity=1.8,
            sunSensitivity=1.8,
            containerFactor=1.4,
            dryingSpeed="very_fast",
            wateringFrequencyPreference="frequent_short",
            preferredTimeWindow="early_morning",
            strategy="growth_oriented",
            riskProfile="avoid_drought_stress",
            explanation="Testprofil",
        ).model_dump(),
        adaptive_irrigation_plan_json=AdaptiveIrrigationPlan(
            preferredTimeWindows=["early_morning"],
            allowSecondDailyRun=True,
            minIntervalHours=1,
            baseDurationMinutes=60,
            minDurationMinutes=45,
            maxDurationMinutes=90,
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
        source_type=RunSource.ADAPTIVE_RULE,
        duration_minutes=60,
        scheduled_for=datetime(2026, 5, 19).date(),
        scheduled_time=time(5, 30),
        status=RunStatus.RUNNING,
        occurrence_key=f"adaptive:{adaptive_zone.id}:2026-05-19:05:30:00",
        reason=f"{ADAPTIVE_REASON_PREFIX} Adaptiver Lauf geplant: 60 Minuten im Fenster 05:30.",
    )
    existing_run.started_at = datetime(2026, 5, 19, 5, 30, tzinfo=UTC)
    db_session.commit()

    def fake_fetch_forecast(self, *, latitude: float, longitude: float, hours: int):
        return WeatherForecastSummary(
            probability_max=0,
            precipitation_sum_mm=0,
            current_weather_code=0,
            current_is_day=True,
            current_temperature_c=22,
            temperature_max_24h_c=32,
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
        now=datetime(2026, 5, 19, 5, 54, tzinfo=UTC),
    )

    adaptive_runs = (
        db_session.query(orm.WateringRun)
        .filter(
            orm.WateringRun.zone_id == adaptive_zone.id,
            orm.WateringRun.source_type == RunSource.ADAPTIVE_RULE.value,
        )
        .all()
    )
    assert len(adaptive_runs) == 1
    assert adaptive_runs[0].requested_duration_minutes == 60
    assert adaptive_runs[0].scheduled_time == time(5, 30)


def test_scheduler_skips_adaptive_run_when_morning_capacity_is_full(db_session) -> None:
    settings = WeatherService(db_session, TEST_SETTINGS).get_settings()
    settings.weather_enabled = False
    profile = ZoneIrrigationProfile(
        zoneType="bed",
        plantType="vegetables",
        sunExposure="full_sun",
        rainExposure="medium",
        rainEffectiveness=0.7,
        waterNeedLevel="very_high",
        baseWaterNeedMmPerDay=8.0,
        temperatureSensitivity=1.8,
        sunSensitivity=1.8,
        containerFactor=1.0,
        dryingSpeed="fast",
        wateringFrequencyPreference="normal",
        preferredTimeWindow="morning",
        strategy="growth_oriented",
        riskProfile="avoid_drought_stress",
        explanation="Testprofil",
    ).model_dump()
    plan = AdaptiveIrrigationPlan(
        preferredTimeWindows=["morning"],
        allowSecondDailyRun=False,
        minIntervalHours=1,
        baseDurationMinutes=120,
        minDurationMinutes=120,
        maxDurationMinutes=120,
        rules=["Nur vormittags bewaessern."],
        explanation="Testplan",
    ).model_dump()
    zones = [
        orm.Zone(
            name=f"Zone {index}",
            description="",
            gpio_chip="/dev/gpiochip0",
            gpio_line=index,
            active=True,
            default_manual_duration_minutes=5,
            max_duration_minutes=120,
            weather_enabled=False,
            scheduling_mode="adaptive",
            irrigation_profile_json=profile,
            adaptive_irrigation_plan_json=plan,
        )
        for index in range(1, 4)
    ]
    db_session.add_all(zones)
    db_session.commit()

    runner = SchedulerRunner()
    runner.settings = TEST_SETTINGS
    runner._plan_adaptive_runs(
        db_session,
        app_settings=settings,
        watering=WateringService(db_session, TEST_SETTINGS, SimulatedGpioAdapter()),
        runs=WateringRunRepository(db_session),
        now=datetime(2026, 5, 19, 7, 5, tzinfo=UTC),
    )

    runs = db_session.query(orm.WateringRun).order_by(orm.WateringRun.zone_id.asc()).all()
    assert [run.status for run in runs] == [RunStatus.PLANNED.value, RunStatus.PLANNED.value, RunStatus.SKIPPED.value]
    assert [run.scheduled_time for run in runs] == [time(7, 0), time(9, 0), time(11, 0)]
    assert "Zeitfenster reicht" in runs[2].planning_reason


def test_projection_marks_adaptive_overflow_as_skipped(db_session) -> None:
    settings = WeatherService(db_session, TEST_SETTINGS).get_settings()
    settings.weather_enabled = False
    profile = ZoneIrrigationProfile(
        zoneType="bed",
        plantType="vegetables",
        sunExposure="full_sun",
        rainExposure="medium",
        rainEffectiveness=0.7,
        waterNeedLevel="very_high",
        baseWaterNeedMmPerDay=8.0,
        temperatureSensitivity=1.8,
        sunSensitivity=1.8,
        containerFactor=1.0,
        dryingSpeed="fast",
        wateringFrequencyPreference="normal",
        preferredTimeWindow="morning",
        strategy="growth_oriented",
        riskProfile="avoid_drought_stress",
        explanation="Testprofil",
    ).model_dump()
    plan = AdaptiveIrrigationPlan(
        preferredTimeWindows=["morning"],
        allowSecondDailyRun=False,
        minIntervalHours=1,
        baseDurationMinutes=120,
        minDurationMinutes=120,
        maxDurationMinutes=120,
        rules=["Nur vormittags bewaessern."],
        explanation="Testplan",
    ).model_dump()
    db_session.add_all(
        [
            orm.Zone(
                name=f"Plan Zone {index}",
                description="",
                gpio_chip="/dev/gpiochip0",
                gpio_line=index,
                active=True,
                default_manual_duration_minutes=5,
                max_duration_minutes=120,
                weather_enabled=False,
                scheduling_mode="adaptive",
                irrigation_profile_json=profile,
                adaptive_irrigation_plan_json=plan,
            )
            for index in range(1, 4)
        ]
    )
    db_session.commit()

    projection = IrrigationProjectionService(db_session, TEST_SETTINGS).build_projection(
        days=1,
        now=datetime(2026, 5, 19, 4, 55, tzinfo=UTC),
    )
    first_day_items = [item for item in projection.items if item.planned_start.date().isoformat() == "2026-05-19"]

    assert [item.status for item in first_day_items] == ["planned", "planned", "skipped"]
    assert first_day_items[2].planned_start.time() == time(11, 0)
    assert first_day_items[2].planned_end.time() == time(13, 0)
    assert "Zeitfenster" in first_day_items[2].decision_summary


def test_scheduler_does_not_recreate_completed_adaptive_run_after_weather_reason_replaced(db_session, monkeypatch) -> None:
    settings = WeatherService(db_session, TEST_SETTINGS).get_settings()
    settings.weather_enabled = True
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
            baseDurationMinutes=4,
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
        duration_minutes=4,
        scheduled_for=datetime(2026, 5, 21).date(),
        scheduled_time=time(5, 34),
        status=RunStatus.COMPLETED,
        reason="Kein kritischer Regen erwartet: bis zu 0 % Regenwahrscheinlichkeit und 0,0 mm Niederschlag.",
    )
    existing_run.started_at = datetime(2026, 5, 21, 5, 34, tzinfo=UTC)
    existing_run.finished_at = datetime(2026, 5, 21, 5, 38, tzinfo=UTC)
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
        now=datetime(2026, 5, 21, 5, 42, tzinfo=UTC),
    )

    adaptive_runs = (
        db_session.query(orm.WateringRun)
        .filter(
            orm.WateringRun.zone_id == adaptive_zone.id,
            orm.WateringRun.schedule_id.is_(None),
            orm.WateringRun.trigger_type == TriggerType.SCHEDULED.value,
        )
        .all()
    )
    assert len(adaptive_runs) == 1
    assert adaptive_runs[0].scheduled_time == time(5, 34)


def test_database_rejects_duplicate_adaptive_occurrence_key(db_session) -> None:
    zone = orm.Zone(
        name="Teich",
        description="",
        gpio_chip="/dev/gpiochip0",
        gpio_line=4,
        active=True,
        max_duration_minutes=20,
    )
    db_session.add(zone)
    db_session.flush()
    runs = WateringRunRepository(db_session)
    occurrence_key = f"adaptive:{zone.id}:2026-05-21:05:30:00"
    runs.create_planned_run(
        zone_id=zone.id,
        schedule_id=None,
        trigger_type=TriggerType.SCHEDULED,
        duration_minutes=4,
        scheduled_for=datetime(2026, 5, 21).date(),
        scheduled_time=time(5, 30),
        occurrence_key=occurrence_key,
    )

    try:
        runs.create_planned_run(
            zone_id=zone.id,
            schedule_id=None,
            trigger_type=TriggerType.SCHEDULED,
            duration_minutes=4,
            scheduled_for=datetime(2026, 5, 21).date(),
            scheduled_time=time(5, 34),
            occurrence_key=occurrence_key,
        )
    except IntegrityError:
        db_session.rollback()
    else:
        raise AssertionError("Duplicate adaptive occurrence key was accepted.")


def test_adaptive_run_keeps_planning_reason_when_weather_execution_reason_is_recorded(db_session, monkeypatch) -> None:
    settings = WeatherService(db_session, TEST_SETTINGS).get_settings()
    settings.weather_enabled = True
    zone = orm.Zone(
        name="Teich",
        description="",
        gpio_chip="/dev/gpiochip0",
        gpio_line=4,
        active=True,
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
    )
    db_session.add(zone)
    db_session.flush()
    planning_reason = f"{ADAPTIVE_REASON_PREFIX} Adaptiver Lauf geplant: 4 Minuten im Fenster 05:30."
    run = WateringRunRepository(db_session).create_planned_run(
        zone_id=zone.id,
        schedule_id=None,
        trigger_type=TriggerType.SCHEDULED,
        source_type=RunSource.ADAPTIVE_RULE,
        duration_minutes=4,
        scheduled_for=datetime(2026, 5, 21).date(),
        scheduled_time=time(5, 30),
        reason=planning_reason,
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

    class AtSlot(datetime):
        @classmethod
        def now(cls, tz=None):
            value = datetime(2026, 5, 21, 3, 30, tzinfo=UTC)
            return value if tz else value.replace(tzinfo=None)

    monkeypatch.setattr("app.application.watering_service.datetime", AtSlot)
    WateringService(db_session, TEST_SETTINGS, SimulatedGpioAdapter()).execute_planned_runs()
    db_session.refresh(run)

    assert run.status == RunStatus.RUNNING.value
    assert run.reason == planning_reason
    assert run.planning_reason == planning_reason
    assert run.execution_reason is not None
    assert "zone profile adjusted duration" in run.execution_reason
