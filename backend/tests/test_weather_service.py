from app.application.weather_service import WeatherService
from app.infrastructure.weather.open_meteo_client import WeatherForecastSummary

from conftest import TEST_SETTINGS


def test_humanize_reason_describes_skip_in_german(db_session) -> None:
    service = WeatherService(db_session, TEST_SETTINGS)

    reason = service.humanize_reason(
        decision="skip",
        raw_reason="skip due to forecast probability=80 precipitation_mm=3.2",
        probability_max=80,
        precipitation_sum_mm=3.2,
        probability_threshold=70,
        precipitation_threshold_mm=2.0,
        fail_mode="allow",
        enabled=True,
    )

    assert "Regen erwartet" in reason
    assert "80 %" in reason
    assert "3,2 mm" in reason


def test_humanize_reason_describes_fail_closed_in_german(db_session) -> None:
    service = WeatherService(db_session, TEST_SETTINGS)

    reason = service.humanize_reason(
        decision="error",
        raw_reason="weather api error: timeout",
        probability_max=None,
        precipitation_sum_mm=None,
        probability_threshold=70,
        precipitation_threshold_mm=2.0,
        fail_mode="deny",
        enabled=True,
    )

    assert "Wetterdaten fehlen" in reason
    assert "Nicht bewässern" in reason


def test_build_overview_marks_disabled_weather_as_inactive(db_session) -> None:
    service = WeatherService(db_session, TEST_SETTINGS)
    settings = service.get_settings()

    overview = service.build_overview(
        app_settings=settings,
        weather_enabled=False,
        decision=None,
        raw_reason=None,
        checked_at=None,
        probability_max=None,
        precipitation_sum_mm=None,
        probability_threshold=70,
        precipitation_threshold_mm=2.0,
    )

    assert overview["decision"] == "inactive"
    assert overview["headline"] == "Wettersteuerung aus"
    assert overview["source_status"] == "unavailable"


def test_build_live_overview_uses_current_forecast_values(db_session) -> None:
    service = WeatherService(db_session, TEST_SETTINGS)
    settings = service.get_settings()

    overview = service.build_live_overview(
        app_settings=settings,
        weather_enabled=True,
        probability_threshold=70,
        precipitation_threshold_mm=2.0,
        forecast_summary=WeatherForecastSummary(
            probability_max=55,
            precipitation_sum_mm=0.4,
            current_weather_code=0,
            current_is_day=True,
            current_temperature_c=22.4,
            raw_response={},
        ),
    )

    assert overview["decision"] == "allow"
    assert overview["precipitation_probability_max"] == 55
    assert overview["precipitation_sum_mm"] == 0.4
    assert "55 %" in overview["summary_text"]
