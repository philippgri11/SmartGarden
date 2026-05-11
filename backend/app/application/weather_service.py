from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.config import Settings
from app.domain.policies import WeatherPolicyInput, WeatherPolicyResult, evaluate_weather_policy
from app.infrastructure.db.orm import AppSetting, Schedule, WeatherDecision, Zone
from app.infrastructure.db.repositories import AppSettingRepository
from app.infrastructure.weather.open_meteo_client import OpenMeteoClient, WeatherForecastSummary


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
        enabled = app_settings.weather_enabled and (zone.weather_enabled or (schedule.weather_enabled if schedule else False))
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
            summary = self.client.fetch_forecast(
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
        try:
            return self.client.fetch_forecast(
                latitude=app_settings.latitude,
                longitude=app_settings.longitude,
                hours=app_settings.weather_window_hours,
            )
        except Exception:  # noqa: BLE001
            return None

    def build_live_overview(
        self,
        *,
        app_settings: AppSetting,
        weather_enabled: bool,
        probability_threshold: int,
        precipitation_threshold_mm: float,
        forecast_summary: WeatherForecastSummary | None,
    ) -> dict:
        policy = evaluate_weather_policy(
            WeatherPolicyInput(
                enabled=weather_enabled,
                probability_threshold=probability_threshold,
                precipitation_mm_threshold=precipitation_threshold_mm,
                probability_max=forecast_summary.probability_max if forecast_summary else None,
                precipitation_sum_mm=forecast_summary.precipitation_sum_mm if forecast_summary else None,
                fail_mode=app_settings.weather_fail_mode,
                api_error=None if forecast_summary else "live forecast unavailable",
            )
        )
        checked_at = datetime.now(UTC)
        raw_reason = policy.reason if forecast_summary else "weather api error: live forecast unavailable"
        return self.build_overview(
            app_settings=app_settings,
            weather_enabled=weather_enabled,
            decision=policy.decision,
            raw_reason=raw_reason,
            checked_at=checked_at,
            probability_max=forecast_summary.probability_max if forecast_summary else None,
            precipitation_sum_mm=forecast_summary.precipitation_sum_mm if forecast_summary else None,
            probability_threshold=probability_threshold,
            precipitation_threshold_mm=precipitation_threshold_mm,
            current_weather_code=forecast_summary.current_weather_code if forecast_summary else None,
            current_is_day=forecast_summary.current_is_day if forecast_summary else None,
            current_temperature_c=forecast_summary.current_temperature_c if forecast_summary else None,
        )

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
                return "Wetterdaten fehlen. Wegen der Einstellung „Nicht bewässern“ wird der Lauf sicherheitshalber nicht gestartet."
            return "Wetterdaten fehlen, die Anlage würde wegen der aktuellen Einstellung trotzdem bewässern."
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
    ) -> dict:
        normalized_decision = self._normalize_decision(
            weather_enabled=weather_enabled,
            decision=decision,
            checked_at=checked_at,
        )
        source_status = self._source_status(checked_at=checked_at, weather_enabled=weather_enabled)
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
            "forecast_window_hours": app_settings.weather_window_hours,
            "precipitation_probability_max": probability_max,
            "precipitation_sum_mm": precipitation_sum_mm,
            "probability_threshold": probability_threshold,
            "precipitation_threshold_mm": precipitation_threshold_mm,
            "fail_mode": app_settings.weather_fail_mode,
            "source_status": source_status,
            "checked_at": checked_at,
            "reason_human": reason_human,
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
