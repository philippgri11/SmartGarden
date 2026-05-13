from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx


@dataclass(slots=True)
class WeatherForecastSummary:
    probability_max: float | None
    precipitation_sum_mm: float | None
    current_weather_code: int | None
    current_is_day: bool | None
    current_temperature_c: float | None
    temperature_max_24h_c: float | None
    precipitation_last_24h_mm: float | None
    precipitation_next_24h_mm: float | None
    cloud_cover_avg_pct: float | None
    raw_response: dict


class OpenMeteoClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url

    def fetch_forecast(self, *, latitude: float, longitude: float, hours: int) -> WeatherForecastSummary:
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "hourly": "temperature_2m,cloud_cover,precipitation_probability,precipitation",
            "current": "temperature_2m,is_day,weather_code",
            "past_days": 1,
            "forecast_days": 2,
            "timezone": "auto",
        }
        with httpx.Client(timeout=10.0) as client:
            response = client.get(self.base_url, params=params)
            response.raise_for_status()
            data = response.json()

        hourly = data.get("hourly", {})
        current = data.get("current", {})
        hourly_times = self._parse_times(hourly.get("time", []))
        current_time = self._parse_time(current.get("time")) or datetime.now()
        next_indices = [index for index, item_time in enumerate(hourly_times) if current_time <= item_time < current_time + timedelta(hours=hours)]
        next_24_indices = [index for index, item_time in enumerate(hourly_times) if current_time <= item_time < current_time + timedelta(hours=24)]
        last_24_indices = [index for index, item_time in enumerate(hourly_times) if current_time - timedelta(hours=24) <= item_time < current_time]
        if not next_indices:
            next_indices = list(range(min(hours, len(hourly.get("precipitation", [])))))
            next_24_indices = list(range(min(24, len(hourly.get("precipitation", [])))))
            last_24_indices = []

        probabilities = self._values_at(hourly.get("precipitation_probability", []), next_indices)
        precipitation = self._values_at(hourly.get("precipitation", []), next_indices)
        precipitation_next_24 = self._values_at(hourly.get("precipitation", []), next_24_indices)
        precipitation_last_24 = self._values_at(hourly.get("precipitation", []), last_24_indices)
        temperatures_next_24 = self._values_at(hourly.get("temperature_2m", []), next_24_indices)
        clouds_next_24 = self._values_at(hourly.get("cloud_cover", []), next_24_indices)
        probability_max = max(probabilities) if probabilities else None
        precipitation_sum_mm = round(sum(precipitation), 2) if precipitation else None
        precipitation_next_24h_mm = round(sum(precipitation_next_24), 2) if precipitation_next_24 else precipitation_sum_mm
        precipitation_last_24h_mm = round(sum(precipitation_last_24), 2) if precipitation_last_24 else None
        temperature_max_24h_c = round(max(temperatures_next_24), 1) if temperatures_next_24 else current.get("temperature_2m")
        cloud_cover_avg_pct = round(sum(clouds_next_24) / len(clouds_next_24), 1) if clouds_next_24 else None
        return WeatherForecastSummary(
            probability_max=probability_max,
            precipitation_sum_mm=precipitation_sum_mm,
            current_weather_code=current.get("weather_code"),
            current_is_day=bool(current.get("is_day")) if current.get("is_day") is not None else None,
            current_temperature_c=current.get("temperature_2m"),
            temperature_max_24h_c=temperature_max_24h_c,
            precipitation_last_24h_mm=precipitation_last_24h_mm,
            precipitation_next_24h_mm=precipitation_next_24h_mm,
            cloud_cover_avg_pct=cloud_cover_avg_pct,
            raw_response=data,
        )

    @staticmethod
    def _parse_time(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    def _parse_times(self, values: list[str]) -> list[datetime]:
        return [parsed for value in values if (parsed := self._parse_time(value)) is not None]

    @staticmethod
    def _values_at(values: list[float | int | None], indices: list[int]) -> list[float]:
        result: list[float] = []
        for index in indices:
            if index >= len(values) or values[index] is None:
                continue
            result.append(float(values[index]))
        return result
