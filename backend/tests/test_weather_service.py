import httpx
from datetime import UTC, datetime, timedelta

from app.application.weather_service import WeatherService
from app.infrastructure.db import orm
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

    assert "API-Fehlers" in reason
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
            temperature_max_24h_c=24.0,
            precipitation_last_24h_mm=0.0,
            precipitation_next_24h_mm=0.4,
            cloud_cover_avg_pct=20.0,
            raw_response={},
        ),
    )

    assert overview["decision"] == "allow"
    assert overview["precipitation_probability_max"] == 55
    assert overview["precipitation_sum_mm"] == 0.4
    assert "55 %" in overview["summary_text"]


def test_forecast_cache_reuses_fresh_response(db_session, monkeypatch) -> None:
    service = WeatherService(db_session, TEST_SETTINGS)
    calls = 0

    def fake_fetch_forecast(*, latitude: float, longitude: float, hours: int):
        nonlocal calls
        calls += 1
        return WeatherForecastSummary(
            probability_max=12,
            precipitation_sum_mm=0.0,
            current_weather_code=0,
            current_is_day=True,
            current_temperature_c=20,
            temperature_max_24h_c=22,
            precipitation_last_24h_mm=0,
            precipitation_next_24h_mm=0,
            cloud_cover_avg_pct=10,
            raw_response={"call": calls},
        )

    monkeypatch.setattr(service.client, "fetch_forecast", fake_fetch_forecast)

    first = service.fetch_forecast_cached(latitude=52.52, longitude=13.405, hours=6)
    second = service.fetch_forecast_cached(latitude=52.52, longitude=13.405, hours=6)

    assert calls == 1
    assert first.raw_response == second.raw_response


def test_forecast_cache_falls_back_to_stale_on_api_error(db_session, monkeypatch) -> None:
    service = WeatherService(db_session, TEST_SETTINGS)

    monkeypatch.setattr(
        service.client,
        "fetch_forecast",
        lambda *, latitude, longitude, hours: WeatherForecastSummary(
            probability_max=33,
            precipitation_sum_mm=1.2,
            current_weather_code=3,
            current_is_day=True,
            current_temperature_c=18,
            temperature_max_24h_c=19,
            precipitation_last_24h_mm=0.4,
            precipitation_next_24h_mm=1.2,
            cloud_cover_avg_pct=80,
            raw_response={"cached": True},
        ),
    )
    service.fetch_forecast_cached(latitude=52.52, longitude=13.405, hours=6)
    cached_row = db_session.query(orm.WeatherForecastCache).one()
    cached_row.fetched_at = datetime.now(UTC) - timedelta(minutes=TEST_SETTINGS.weather_cache_ttl_minutes + 1)
    db_session.commit()

    def fail_fetch(*, latitude: float, longitude: float, hours: int):
        raise httpx.HTTPStatusError("429", request=httpx.Request("GET", "https://example.test"), response=httpx.Response(429))

    monkeypatch.setattr(service.client, "fetch_forecast", fail_fetch)
    cached = service.fetch_forecast_cached(latitude=52.52, longitude=13.405, hours=6)

    assert cached.probability_max == 33
    assert cached.raw_response == {"cached": True}


def test_live_overview_shows_api_error_when_forecast_missing(db_session) -> None:
    service = WeatherService(db_session, TEST_SETTINGS)
    settings = service.get_settings()

    overview = service.build_live_overview(
        app_settings=settings,
        weather_enabled=True,
        probability_threshold=70,
        precipitation_threshold_mm=2,
        forecast_summary=None,
    )

    assert overview["decision"] == "error"
    assert overview["source_status"] == "unavailable"
    assert "API-Fehlers" in overview["reason_human"]
