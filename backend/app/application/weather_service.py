from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.domain.policies import WeatherPolicyInput, WeatherPolicyResult, evaluate_weather_policy
from app.infrastructure.db.orm import AppSetting, Schedule, WeatherDecision, WeatherForecastCache, Zone
from app.infrastructure.db.repositories import AppSettingRepository
from app.infrastructure.weather.open_meteo_client import OpenMeteoClient, WeatherForecastSummary


class CachedWeatherUnavailableError(RuntimeError):
    def __init__(self, message: str, *, checked_at: datetime | None = None):
        super().__init__(message)
        self.checked_at = checked_at


@dataclass(slots=True)
class ForecastLookup:
    summary: WeatherForecastSummary | None
    source_status: str
    checked_at: datetime | None
    error: str | None = None


class WeatherService:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings
        self.repo = AppSettingRepository(session)
        self.client = OpenMeteoClient(settings.weather_api_base_url)

    def get_settings(self) -> AppSetting:
        current = self.repo.get()
        if current:
            return current
        entity = AppSetting(
            id=1,
            location_name="Mein Garten",
            postal_code=None,
            latitude=self.settings.default_latitude,
            longitude=self.settings.default_longitude,
            weather_enabled=self.settings.weather_enabled,
            weather_window_hours=self.settings.weather_default_window_hours,
            weather_probability_threshold=self.settings.weather_default_probability_threshold,
            weather_precipitation_mm_threshold=self.settings.weather_default_precipitation_mm_threshold,
            weather_fail_mode=self.settings.weather_fail_mode,
            winter_mode_active=False,
            winter_disable_manual_start=True,
            winter_pause_schedules=True,
            safety_shutdown_on_winter=True,
            system_paused_until=None,
            safety_stop_active=False,
            safety_stop_reason=None,
        )
        self.repo.upsert(entity)
        self.session.commit()
        self.session.refresh(entity)
        return entity

    def update_settings(self, payload: dict) -> AppSetting:
        current = self.get_settings()
        for key, value in payload.items():
            setattr(current, key, value)
        self.session.commit()
        self.session.refresh(current)
        return current

    def evaluate(self, *, zone: Zone, schedule: Schedule | None) -> tuple[WeatherPolicyResult, WeatherForecastSummary | None, AppSetting]:
        app_settings = self.get_settings()
        enabled = app_settings.weather_enabled and (
            zone.weather_enabled
            or (schedule.weather_enabled if schedule else False)
            or getattr(zone, "scheduling_mode", "static") == "adaptive"
        )
        probability_threshold = (
            (schedule.weather_probability_threshold if schedule and schedule.weather_probability_threshold is not None else None)
            or zone.weather_probability_threshold
            or app_settings.weather_probability_threshold
        )
        precipitation_threshold = (
            (schedule.weather_precipitation_mm_threshold if schedule and schedule.weather_precipitation_mm_threshold is not None else None)
            or zone.weather_precipitation_mm_threshold
            or app_settings.weather_precipitation_mm_threshold
        )

        try:
            summary = self.fetch_forecast_cached(
                latitude=app_settings.latitude,
                longitude=app_settings.longitude,
                hours=app_settings.weather_window_hours,
            )
            result = evaluate_weather_policy(
                WeatherPolicyInput(
                    enabled=enabled,
                    probability_threshold=probability_threshold,
                    precipitation_mm_threshold=precipitation_threshold,
                    probability_max=summary.probability_max,
                    precipitation_sum_mm=summary.precipitation_sum_mm,
                    fail_mode=app_settings.weather_fail_mode,
                )
            )
            return result, summary, app_settings
        except Exception as exc:  # noqa: BLE001
            result = evaluate_weather_policy(
                WeatherPolicyInput(
                    enabled=enabled,
                    probability_threshold=probability_threshold,
                    precipitation_mm_threshold=precipitation_threshold,
                    probability_max=None,
                    precipitation_sum_mm=None,
                    fail_mode=app_settings.weather_fail_mode,
                    api_error=str(exc),
                )
            )
            return result, None, app_settings

    def try_fetch_current_summary(self, *, app_settings: AppSetting) -> WeatherForecastSummary | None:
        return self.try_fetch_current_lookup(app_settings=app_settings).summary

    def try_fetch_current_lookup(self, *, app_settings: AppSetting) -> ForecastLookup:
        try:
            summary = self.fetch_forecast_cached(
                latitude=app_settings.latitude,
                longitude=app_settings.longitude,
                hours=app_settings.weather_window_hours,
            )
            checked_at = self._cached_checked_at(
                latitude=app_settings.latitude,
                longitude=app_settings.longitude,
                hours=app_settings.weather_window_hours,
            )
            source_status = self._source_status(checked_at=checked_at, weather_enabled=app_settings.weather_enabled)
            return ForecastLookup(summary=summary, source_status=source_status, checked_at=checked_at)
        except CachedWeatherUnavailableError as exc:
            return ForecastLookup(summary=None, source_status="unavailable", checked_at=exc.checked_at, error=str(exc))
        except Exception as exc:  # noqa: BLE001
            checked_at = self._cached_checked_at(
                latitude=app_settings.latitude,
                longitude=app_settings.longitude,
                hours=app_settings.weather_window_hours,
            )
            return ForecastLookup(summary=None, source_status="unavailable", checked_at=checked_at, error=str(exc))

    def fetch_forecast_cached(self, *, latitude: float, longitude: float, hours: int) -> WeatherForecastSummary:
        key = self._cache_key(latitude=latitude, longitude=longitude, hours=hours)
        now = datetime.now(UTC)
        cached = self.session.scalar(select(WeatherForecastCache).where(WeatherForecastCache.cache_key == key))
        if cached and self._as_aware(cached.fetched_at) >= now - timedelta(minutes=self.settings.weather_cache_ttl_minutes):
            if self._is_error_cache(cached.summary_json):
                raise CachedWeatherUnavailableError(
                    cached.summary_json.get("error") or "weather api error cached",
                    checked_at=self._as_aware(cached.fetched_at),
                )
            return self._summary_from_cache(cached.summary_json)
        if (
            cached
            and self._recent_failed_attempt(cached.summary_json, now=now)
            and self._as_aware(cached.fetched_at) >= now - timedelta(hours=self.settings.weather_cache_stale_fallback_hours)
            and not self._is_error_cache(cached.summary_json)
        ):
            return self._summary_from_cache(cached.summary_json)

        try:
            summary = self.client.fetch_forecast(latitude=latitude, longitude=longitude, hours=hours)
        except Exception as exc:
            if (
                cached
                and not self._is_error_cache(cached.summary_json)
                and self._as_aware(cached.fetched_at) >= now - timedelta(hours=self.settings.weather_cache_stale_fallback_hours)
            ):
                cached.summary_json = {
                    **cached.summary_json,
                    "_last_error": str(exc),
                    "_last_attempt_at": now.isoformat(),
                }
                self.session.flush()
                return self._summary_from_cache(cached.summary_json)
            self._store_forecast_error(
                cached=cached,
                key=key,
                latitude=latitude,
                longitude=longitude,
                hours=hours,
                error=str(exc),
                fetched_at=now,
            )
            raise

        payload = self._summary_to_cache(summary)
        if cached:
            cached.summary_json = payload
            cached.fetched_at = now
            cached.latitude = latitude
            cached.longitude = longitude
            cached.forecast_window_hours = hours
        else:
            self.session.add(
                WeatherForecastCache(
                    cache_key=key,
                    latitude=latitude,
                    longitude=longitude,
                    forecast_window_hours=hours,
                    summary_json=payload,
                    fetched_at=now,
                )
            )
        self.session.flush()
        return summary

    def build_live_overview(
        self,
        *,
        app_settings: AppSetting,
        weather_enabled: bool,
        probability_threshold: int,
        precipitation_threshold_mm: float,
        forecast_summary: WeatherForecastSummary | None,
        checked_at: datetime | None = None,
        source_status: str | None = None,
        api_error: str | None = None,
    ) -> dict:
        policy = evaluate_weather_policy(
            WeatherPolicyInput(
                enabled=weather_enabled,
                probability_threshold=probability_threshold,
                precipitation_mm_threshold=precipitation_threshold_mm,
                probability_max=forecast_summary.probability_max if forecast_summary else None,
                precipitation_sum_mm=forecast_summary.precipitation_sum_mm if forecast_summary else None,
                fail_mode=app_settings.weather_fail_mode,
                api_error=None if forecast_summary else api_error or "live forecast unavailable",
            )
        )
        checked_at = checked_at or datetime.now(UTC)
        raw_reason = policy.reason if forecast_summary else f"weather api error: {api_error or 'live forecast unavailable'}"
        display_decision = policy.decision if forecast_summary else "error"
        overview = self.build_overview(
            app_settings=app_settings,
            weather_enabled=weather_enabled,
            decision=display_decision,
            raw_reason=raw_reason,
            checked_at=checked_at,
            probability_max=forecast_summary.probability_max if forecast_summary else None,
            precipitation_sum_mm=forecast_summary.precipitation_sum_mm if forecast_summary else None,
            probability_threshold=probability_threshold,
            precipitation_threshold_mm=precipitation_threshold_mm,
            current_weather_code=forecast_summary.current_weather_code if forecast_summary else None,
            current_is_day=forecast_summary.current_is_day if forecast_summary else None,
            current_temperature_c=forecast_summary.current_temperature_c if forecast_summary else None,
            temperature_max_24h_c=forecast_summary.temperature_max_24h_c if forecast_summary else None,
            precipitation_last_24h_mm=forecast_summary.precipitation_last_24h_mm if forecast_summary else None,
            precipitation_next_24h_mm=forecast_summary.precipitation_next_24h_mm if forecast_summary else None,
            cloud_cover_avg_pct=forecast_summary.cloud_cover_avg_pct if forecast_summary else None,
        )
        if source_status:
            overview["source_status"] = source_status
        return overview

    def humanize_reason(
        self,
        *,
        decision: str | None,
        raw_reason: str | None,
        probability_max: float | None,
        precipitation_sum_mm: float | None,
        probability_threshold: int,
        precipitation_threshold_mm: float,
        fail_mode: str,
        enabled: bool,
    ) -> str:
        if not enabled:
            return "Wettersteuerung ist ausgeschaltet."
        if decision == "skip":
            return (
                f"Regen erwartet: bis zu {self.format_probability(probability_max)} Regenwahrscheinlichkeit "
                f"und {self.format_precipitation(precipitation_sum_mm)} Niederschlag. "
                f"Die eingestellten Grenzen liegen bei {probability_threshold} % und {self.format_precipitation(precipitation_threshold_mm)}."
            )
        if raw_reason and raw_reason.startswith("weather api error:"):
            if fail_mode == "deny":
                return "Wetterdaten konnten wegen eines API-Fehlers nicht abgerufen werden. Wegen der Einstellung „Nicht bewässern“ wird der Lauf sicherheitshalber nicht gestartet."
            return "Wetterdaten konnten wegen eines API-Fehlers nicht abgerufen werden. Wegen der aktuellen Einstellung würde die Anlage trotzdem bewässern."
        if raw_reason and raw_reason.startswith("weather api error overridden:"):
            return "Wetterdaten fehlen. Wegen der Einstellung „Trotzdem bewässern“ wurde der Lauf freigegeben."
        if decision == "allow":
            return (
                f"Kein kritischer Regen erwartet: bis zu {self.format_probability(probability_max)} Regenwahrscheinlichkeit "
                f"und {self.format_precipitation(precipitation_sum_mm)} Niederschlag. "
                f"Die Grenzen liegen bei {probability_threshold} % und {self.format_precipitation(precipitation_threshold_mm)}."
            )
        if decision == "error":
            return "Wetterdaten konnten nicht geprüft werden."
        return "Für diesen Bereich liegt noch keine Wetterentscheidung vor."

    @staticmethod
    def _cache_key(*, latitude: float, longitude: float, hours: int) -> str:
        return f"{latitude:.4f}:{longitude:.4f}:{hours}"

    @staticmethod
    def _as_aware(value: datetime) -> datetime:
        return value if value.tzinfo else value.replace(tzinfo=UTC)

    @staticmethod
    def _summary_to_cache(summary: WeatherForecastSummary) -> dict:
        return {
            "probability_max": summary.probability_max,
            "precipitation_sum_mm": summary.precipitation_sum_mm,
            "current_weather_code": summary.current_weather_code,
            "current_is_day": summary.current_is_day,
            "current_temperature_c": summary.current_temperature_c,
            "temperature_max_24h_c": summary.temperature_max_24h_c,
            "precipitation_last_24h_mm": summary.precipitation_last_24h_mm,
            "precipitation_next_24h_mm": summary.precipitation_next_24h_mm,
            "cloud_cover_avg_pct": summary.cloud_cover_avg_pct,
            "raw_response": summary.raw_response,
        }

    def _store_forecast_error(
        self,
        *,
        cached: WeatherForecastCache | None,
        key: str,
        latitude: float,
        longitude: float,
        hours: int,
        error: str,
        fetched_at: datetime,
    ) -> None:
        payload = {"source_status": "unavailable", "error": error}
        if cached:
            cached.summary_json = payload
            cached.fetched_at = fetched_at
            cached.latitude = latitude
            cached.longitude = longitude
            cached.forecast_window_hours = hours
        else:
            self.session.add(
                WeatherForecastCache(
                    cache_key=key,
                    latitude=latitude,
                    longitude=longitude,
                    forecast_window_hours=hours,
                    summary_json=payload,
                    fetched_at=fetched_at,
                )
            )
        self.session.flush()

    def _cached_checked_at(self, *, latitude: float, longitude: float, hours: int) -> datetime | None:
        key = self._cache_key(latitude=latitude, longitude=longitude, hours=hours)
        cached = self.session.scalar(select(WeatherForecastCache).where(WeatherForecastCache.cache_key == key))
        return self._as_aware(cached.fetched_at) if cached else None

    @staticmethod
    def _is_error_cache(payload: dict) -> bool:
        return payload.get("source_status") == "unavailable" and "error" in payload

    def _recent_failed_attempt(self, payload: dict, *, now: datetime) -> bool:
        raw_attempt = payload.get("_last_attempt_at")
        if not raw_attempt:
            return False
        try:
            attempted_at = datetime.fromisoformat(str(raw_attempt))
        except ValueError:
            return False
        attempted_at = self._as_aware(attempted_at)
        return attempted_at >= now - timedelta(minutes=self.settings.weather_cache_ttl_minutes)

    @staticmethod
    def _summary_from_cache(payload: dict) -> WeatherForecastSummary:
        return WeatherForecastSummary(
            probability_max=payload.get("probability_max"),
            precipitation_sum_mm=payload.get("precipitation_sum_mm"),
            current_weather_code=payload.get("current_weather_code"),
            current_is_day=payload.get("current_is_day"),
            current_temperature_c=payload.get("current_temperature_c"),
            temperature_max_24h_c=payload.get("temperature_max_24h_c"),
            precipitation_last_24h_mm=payload.get("precipitation_last_24h_mm"),
            precipitation_next_24h_mm=payload.get("precipitation_next_24h_mm"),
            cloud_cover_avg_pct=payload.get("cloud_cover_avg_pct"),
            raw_response=payload.get("raw_response") or {},
        )

    def build_overview(
        self,
        *,
        app_settings: AppSetting,
        weather_enabled: bool,
        decision: str | None,
        raw_reason: str | None,
        checked_at: datetime | None,
        probability_max: float | None,
        precipitation_sum_mm: float | None,
        probability_threshold: int,
        precipitation_threshold_mm: float,
        current_weather_code: int | None = None,
        current_is_day: bool | None = None,
        current_temperature_c: float | None = None,
        temperature_max_24h_c: float | None = None,
        precipitation_last_24h_mm: float | None = None,
        precipitation_next_24h_mm: float | None = None,
        cloud_cover_avg_pct: float | None = None,
        irrigation_recommendation: dict | None = None,
    ) -> dict:
        normalized_decision = self._normalize_decision(
            weather_enabled=weather_enabled,
            decision=decision,
            checked_at=checked_at,
        )
        source_status = self._source_status(checked_at=checked_at, weather_enabled=weather_enabled)
        if raw_reason and raw_reason.startswith("weather api error:"):
            source_status = "unavailable"
        reason_human = self.humanize_reason(
            decision=normalized_decision,
            raw_reason=raw_reason,
            probability_max=probability_max,
            precipitation_sum_mm=precipitation_sum_mm,
            probability_threshold=probability_threshold,
            precipitation_threshold_mm=precipitation_threshold_mm,
            fail_mode=app_settings.weather_fail_mode,
            enabled=weather_enabled,
        )

        headline, summary_text = self._headline_and_summary(
            decision=normalized_decision,
            weather_enabled=weather_enabled,
            probability_max=probability_max,
            precipitation_sum_mm=precipitation_sum_mm,
            hours=app_settings.weather_window_hours,
            reason_human=reason_human,
        )

        return {
            "weather_enabled": weather_enabled,
            "decision": normalized_decision,
            "headline": headline,
            "summary_text": summary_text,
            "current_condition_label": self.describe_weather_code(current_weather_code, current_is_day),
            "current_weather_code": current_weather_code,
            "current_is_day": current_is_day,
            "current_temperature_c": current_temperature_c,
            "temperature_max_24h_c": temperature_max_24h_c,
            "precipitation_last_24h_mm": precipitation_last_24h_mm,
            "precipitation_next_24h_mm": precipitation_next_24h_mm,
            "cloud_cover_avg_pct": cloud_cover_avg_pct,
            "forecast_window_hours": app_settings.weather_window_hours,
            "precipitation_probability_max": probability_max,
            "precipitation_sum_mm": precipitation_sum_mm,
            "probability_threshold": probability_threshold,
            "precipitation_threshold_mm": precipitation_threshold_mm,
            "fail_mode": app_settings.weather_fail_mode,
            "source_status": source_status,
            "checked_at": checked_at,
            "reason_human": reason_human,
            "irrigation_recommendation": irrigation_recommendation,
        }

    def overview_from_decision(
        self,
        *,
        app_settings: AppSetting,
        weather_enabled: bool,
        probability_threshold: int,
        precipitation_threshold_mm: float,
        decision: WeatherDecision | None,
    ) -> dict:
        return self.build_overview(
            app_settings=app_settings,
            weather_enabled=weather_enabled,
            decision=decision.decision if decision else None,
            raw_reason=decision.reason if decision else None,
            checked_at=decision.checked_at if decision else None,
            probability_max=decision.precipitation_probability_max if decision else None,
            precipitation_sum_mm=decision.precipitation_sum_mm if decision else None,
            probability_threshold=probability_threshold,
            precipitation_threshold_mm=precipitation_threshold_mm,
            current_temperature_c=(decision.raw_response or {}).get("current", {}).get("temperature_2m") if decision else None,
            temperature_max_24h_c=(decision.raw_response or {}).get("irrigation_weather", {}).get("temperature_max_24h_c") if decision else None,
            precipitation_last_24h_mm=(decision.raw_response or {}).get("irrigation_weather", {}).get("precipitation_last_24h_mm") if decision else None,
            precipitation_next_24h_mm=(decision.raw_response or {}).get("irrigation_weather", {}).get("precipitation_next_24h_mm") if decision else None,
            cloud_cover_avg_pct=(decision.raw_response or {}).get("irrigation_weather", {}).get("cloud_cover_avg_pct") if decision else None,
            irrigation_recommendation=(decision.raw_response or {}).get("irrigation_recommendation") if decision else None,
        )

    @staticmethod
    def format_probability(value: float | None) -> str:
        if value is None:
            return "unbekannt"
        return f"{round(value)} %"

    @staticmethod
    def format_precipitation(value: float | None) -> str:
        if value is None:
            return "unbekannt"
        formatted = f"{value:.1f}".replace(".", ",")
        return f"{formatted} mm"

    @staticmethod
    def _normalize_decision(*, weather_enabled: bool, decision: str | None, checked_at: datetime | None) -> str:
        if not weather_enabled:
            return "inactive"
        if decision in {"allow", "skip", "error"}:
            return decision
        if checked_at is None:
            return "unknown"
        return "unknown"

    @staticmethod
    def _source_status(*, checked_at: datetime | None, weather_enabled: bool) -> str:
        if not weather_enabled or checked_at is None:
            return "unavailable"
        if checked_at.tzinfo is None:
            checked_at = checked_at.replace(tzinfo=UTC)
        if checked_at >= datetime.now(UTC) - timedelta(minutes=30):
            return "fresh"
        return "stale"

    def _headline_and_summary(
        self,
        *,
        decision: str,
        weather_enabled: bool,
        probability_max: float | None,
        precipitation_sum_mm: float | None,
        hours: int,
        reason_human: str,
    ) -> tuple[str, str]:
        if not weather_enabled:
            return ("Wettersteuerung aus", "Wetter wird für automatische Entscheidungen derzeit nicht berücksichtigt.")
        fact_line = (
            f"Nächste {hours} Std.: {self.format_probability(probability_max)} Regenwahrscheinlichkeit · "
            f"{self.format_precipitation(precipitation_sum_mm)}"
        )
        if decision == "skip":
            return ("Regen erwartet", f"Automatische Bewässerung wird übersprungen. {fact_line}")
        if decision == "error":
            return ("Wetterdaten fehlen", reason_human)
        if decision == "allow":
            return ("Bewässerung wetterseitig möglich", f"Kein kritischer Regen erwartet. {fact_line}")
        return ("Wetter wird geprüft", reason_human)

    @staticmethod
    def describe_weather_code(code: int | None, is_day: bool | None) -> str | None:
        if code is None:
            return None
        if code == 0:
            return "Sonnig" if is_day is not False else "Klar"
        if code in {1, 2}:
            return "Leicht bewölkt"
        if code == 3:
            return "Bewölkt"
        if code in {45, 48}:
            return "Neblig"
        if code in {51, 53, 55, 56, 57}:
            return "Nieselregen"
        if code in {61, 63, 65, 66, 67, 80, 81, 82}:
            return "Regnerisch"
        if code in {71, 73, 75, 77, 85, 86}:
            return "Schnee"
        if code in {95, 96, 99}:
            return "Gewitter"
        return "Wetterlage unbekannt"
