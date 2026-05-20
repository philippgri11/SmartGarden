from __future__ import annotations

from dataclasses import dataclass

from app.application.schemas import ZoneIrrigationProfile


@dataclass(frozen=True, slots=True)
class ZoneIrrigationModelConfig:
    """Calibration knobs for zone-based automatic watering decisions."""

    neutral_temperature_c: float = 22.0
    heat_pressure_span_c: float = 14.0
    min_temperature_pressure: float = -0.5
    max_temperature_pressure: float = 1.0
    temperature_influence: float = 0.35
    min_temperature_factor: float = 0.75
    max_temperature_factor: float = 1.7

    neutral_sun_index: float = 0.45
    sun_influence: float = 0.4
    min_sun_factor: float = 0.75
    max_sun_factor: float = 1.5

    container_influence: float = 0.25
    strategy_water_saving_factor: float = 0.9
    strategy_balanced_factor: float = 1.0
    strategy_growth_oriented_factor: float = 1.08
    drying_slow_factor: float = 0.9
    drying_normal_factor: float = 1.0
    drying_fast_factor: float = 1.1
    drying_very_fast_factor: float = 1.2

    forecast_rain_weight: float = 0.5
    min_base_need_divisor_mm: float = 0.1
    min_duration_multiplier: float = 0.35
    max_duration_multiplier: float = 1.6
    drought_stress_min_multiplier: float = 0.6
    overwatering_max_multiplier: float = 1.2
    skip_net_need_threshold_mm: float = 0.6
    min_adjusted_duration_minutes: int = 1


@dataclass(slots=True)
class ZoneWeatherFacts:
    temperature_max_c: float | None
    rain_last_24h_mm: float | None
    rain_next_24h_mm: float | None
    cloud_cover_avg_pct: float | None


@dataclass(slots=True)
class ZoneIrrigationRecommendation:
    decision: str
    adjusted_duration_minutes: int
    scheduled_duration_minutes: int
    estimated_need_mm: float
    effective_rain_mm: float
    net_need_mm: float
    multiplier: float
    explanation: str
    details: list[str]

    def as_dict(self) -> dict:
        return {
            "decision": self.decision,
            "adjusted_duration_minutes": self.adjusted_duration_minutes,
            "scheduled_duration_minutes": self.scheduled_duration_minutes,
            "estimated_need_mm": self.estimated_need_mm,
            "effective_rain_mm": self.effective_rain_mm,
            "net_need_mm": self.net_need_mm,
            "multiplier": self.multiplier,
            "explanation": self.explanation,
            "details": self.details,
        }


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def build_zone_irrigation_recommendation(
    *,
    profile: ZoneIrrigationProfile,
    weather: ZoneWeatherFacts,
    scheduled_duration_minutes: int,
    max_duration_minutes: int,
    model_config: ZoneIrrigationModelConfig | None = None,
) -> ZoneIrrigationRecommendation:
    config = model_config or ZoneIrrigationModelConfig()
    base_need = profile.baseWaterNeedMmPerDay
    temp = weather.temperature_max_c
    rain_last = weather.rain_last_24h_mm or 0.0
    rain_next = weather.rain_next_24h_mm or 0.0
    cloud = weather.cloud_cover_avg_pct

    if temp is None:
        temp_factor = 1.0
        temp_text = "Keine belastbare Tageshöchsttemperatur verfügbar, Temperatur bleibt neutral."
    else:
        temp_pressure = _clamp(
            (temp - config.neutral_temperature_c) / config.heat_pressure_span_c,
            config.min_temperature_pressure,
            config.max_temperature_pressure,
        )
        temp_factor = _clamp(
            1.0 + temp_pressure * config.temperature_influence * profile.temperatureSensitivity,
            config.min_temperature_factor,
            config.max_temperature_factor,
        )
        temp_text = f"Tageshöchsttemperatur ca. {temp:.0f} °C, Hitzereaktion {profile.temperatureSensitivity:.1f}."

    if cloud is None:
        sun_factor = 1.0
        sun_text = "Keine Wolkendaten verfügbar, Sonnenwirkung bleibt neutral."
    else:
        sun_index = _clamp(1.0 - cloud / 100.0, 0.0, 1.0)
        sun_factor = _clamp(
            1.0 + (sun_index - config.neutral_sun_index) * config.sun_influence * profile.sunSensitivity,
            config.min_sun_factor,
            config.max_sun_factor,
        )
        sun_text = f"Bewölkung ca. {cloud:.0f} %, Sonnenreaktion {profile.sunSensitivity:.1f}."

    container_factor = 1.0 + (profile.containerFactor - 1.0) * config.container_influence
    strategy_factor = {
        "water_saving": config.strategy_water_saving_factor,
        "balanced": config.strategy_balanced_factor,
        "growth_oriented": config.strategy_growth_oriented_factor,
    }[profile.strategy]
    drying_factor = {
        "slow": config.drying_slow_factor,
        "normal": config.drying_normal_factor,
        "fast": config.drying_fast_factor,
        "very_fast": config.drying_very_fast_factor,
    }[profile.dryingSpeed]

    estimated_need = base_need * temp_factor * sun_factor * container_factor * strategy_factor * drying_factor
    effective_rain = (rain_last + rain_next * config.forecast_rain_weight) * profile.rainEffectiveness
    net_need = max(0.0, estimated_need - effective_rain)
    multiplier = _clamp(
        net_need / max(base_need, config.min_base_need_divisor_mm),
        config.min_duration_multiplier,
        config.max_duration_multiplier,
    )

    if profile.riskProfile == "avoid_drought_stress":
        multiplier = max(multiplier, config.drought_stress_min_multiplier)
    elif profile.riskProfile == "avoid_overwatering":
        multiplier = min(multiplier, config.overwatering_max_multiplier)

    adjusted = round(scheduled_duration_minutes * multiplier)
    adjusted = max(config.min_adjusted_duration_minutes, min(adjusted, max_duration_minutes))
    decision = "allow"
    if net_need < config.skip_net_need_threshold_mm and profile.riskProfile != "avoid_drought_stress":
        decision = "skip"
        adjusted = 0

    details = [
        f"Basisbedarf {base_need:.1f} mm/Tag.",
        temp_text,
        sun_text,
        f"Regen: letzte 24h {rain_last:.1f} mm, nächste 24h {rain_next:.1f} mm, Anrechnung {profile.rainEffectiveness:.2f} = {effective_rain:.1f} mm wirksam.",
        f"Netto-Bedarf {net_need:.1f} mm, daraus Laufzeitfaktor {multiplier:.2f}.",
    ]
    if decision == "skip":
        explanation = (
            "Der wirksame Regen deckt den geschätzten Bedarf dieser Zone weitgehend ab. "
            "Der automatische Lauf wird deshalb übersprungen."
        )
    else:
        explanation = (
            f"Der automatische Lauf wird von {scheduled_duration_minutes} auf {adjusted} Minuten gesetzt. "
            f"Grund ist ein geschätzter Netto-Wasserbedarf von {net_need:.1f} mm nach Regenanrechnung."
        )

    return ZoneIrrigationRecommendation(
        decision=decision,
        adjusted_duration_minutes=adjusted,
        scheduled_duration_minutes=scheduled_duration_minutes,
        estimated_need_mm=round(estimated_need, 2),
        effective_rain_mm=round(effective_rain, 2),
        net_need_mm=round(net_need, 2),
        multiplier=round(multiplier, 2),
        explanation=explanation,
        details=details,
    )
