from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass(slots=True)
class WeatherForecastSummary:
    probability_max: float | None
    precipitation_sum_mm: float | None
    current_weather_code: int | None
    current_is_day: bool | None
    current_temperature_c: float | None
    raw_response: dict


class OpenMeteoClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url

    def fetch_forecast(self, *, latitude: float, longitude: float, hours: int) -> WeatherForecastSummary:
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "hourly": "precipitation_probability,precipitation",
            "current": "temperature_2m,is_day,weather_code",
            "forecast_days": 2,
            "timezone": "auto",
        }
        with httpx.Client(timeout=10.0) as client:
            response = client.get(self.base_url, params=params)
            response.raise_for_status()
            data = response.json()

        hourly = data.get("hourly", {})
        current = data.get("current", {})
        probabilities = hourly.get("precipitation_probability", [])[:hours]
        precipitation = hourly.get("precipitation", [])[:hours]
        probability_max = max(probabilities) if probabilities else None
        precipitation_sum_mm = round(sum(precipitation), 2) if precipitation else None
        return WeatherForecastSummary(
            probability_max=probability_max,
            precipitation_sum_mm=precipitation_sum_mm,
            current_weather_code=current.get("weather_code"),
            current_is_day=bool(current.get("is_day")) if current.get("is_day") is not None else None,
            current_temperature_c=current.get("temperature_2m"),
            raw_response=data,
        )
