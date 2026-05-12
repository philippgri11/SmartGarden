from __future__ import annotations

from dataclasses import dataclass

from app.application.schemas import ZoneIrrigationProfile


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
) -> ZoneIrrigationRecommendation:
    base_need = profile.baseWaterNeedMmPerDay
    temp = weather.temperature_max_c
    rain_last = weather.rain_last_24h_mm or 0.0
    rain_next = weather.rain_next_24h_mm or 0.0
    cloud = weather.cloud_cover_avg_pct

    if temp is None:
        temp_factor = 1.0
        temp_text = "Keine belastbare Tageshöchsttemperatur verfügbar, Temperatur bleibt neutral."
    else:
        temp_pressure = _clamp((temp - 22.0) / 14.0, -0.5, 1.0)
        temp_factor = _clamp(1.0 + temp_pressure * 0.35 * profile.temperatureSensitivity, 0.75, 1.7)
        temp_text = f"Tageshöchsttemperatur ca. {temp:.0f} °C, Hitzereaktion {profile.temperatureSensitivity:.1f}."

    if cloud is None:
        sun_factor = 1.0
        sun_text = "Keine Wolkendaten verfügbar, Sonnenwirkung bleibt neutral."
    else:
        sun_index = _clamp(1.0 - cloud / 100.0, 0.0, 1.0)
        sun_factor = _clamp(1.0 + (sun_index - 0.45) * 0.4 * profile.sunSensitivity, 0.75, 1.5)
        sun_text = f"Bewölkung ca. {cloud:.0f} %, Sonnenreaktion {profile.sunSensitivity:.1f}."

    container_factor = 1.0 + (profile.containerFactor - 1.0) * 0.25
    strategy_factor = {
        "water_saving": 0.9,
        "balanced": 1.0,
        "growth_oriented": 1.08,
    }[profile.strategy]
    drying_factor = {
        "slow": 0.9,
        "normal": 1.0,
        "fast": 1.1,
        "very_fast": 1.2,
    }[profile.dryingSpeed]

    estimated_need = base_need * temp_factor * sun_factor * container_factor * strategy_factor * drying_factor
    effective_rain = (rain_last + rain_next * 0.5) * profile.rainEffectiveness
    net_need = max(0.0, estimated_need - effective_rain)
    multiplier = _clamp(net_need / max(base_need, 0.1), 0.35, 1.6)

    if profile.riskProfile == "avoid_drought_stress":
        multiplier = max(multiplier, 0.6)
    elif profile.riskProfile == "avoid_overwatering":
        multiplier = min(multiplier, 1.2)

    adjusted = round(scheduled_duration_minutes * multiplier)
    adjusted = max(1, min(adjusted, max_duration_minutes))
    decision = "allow"
    if net_need < 0.6 and profile.riskProfile != "avoid_drought_stress":
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
