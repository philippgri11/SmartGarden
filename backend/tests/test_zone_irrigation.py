from app.application.schemas import ZoneIrrigationProfile
from app.domain.zone_irrigation import ZoneWeatherFacts, build_zone_irrigation_recommendation


def test_zone_irrigation_increases_duration_for_hot_sunny_raised_bed() -> None:
    profile = ZoneIrrigationProfile(
        zoneType="raised_bed",
        plantType="vegetables",
        sunExposure="full_sun",
        rainExposure="high",
        rainEffectiveness=0.7,
        waterNeedLevel="high",
        baseWaterNeedMmPerDay=4.8,
        temperatureSensitivity=1.4,
        sunSensitivity=1.5,
        containerFactor=1.3,
        dryingSpeed="fast",
        wateringFrequencyPreference="normal",
        preferredTimeWindow="early_morning",
        strategy="balanced",
        riskProfile="avoid_drought_stress",
        explanation="Testprofil",
    )

    result = build_zone_irrigation_recommendation(
        profile=profile,
        weather=ZoneWeatherFacts(
            temperature_max_c=32,
            rain_last_24h_mm=0,
            rain_next_24h_mm=0,
            cloud_cover_avg_pct=10,
        ),
        scheduled_duration_minutes=10,
        max_duration_minutes=20,
    )

    assert result.decision == "allow"
    assert result.adjusted_duration_minutes > 10
    assert result.net_need_mm > profile.baseWaterNeedMmPerDay
    assert result.details


def test_zone_irrigation_skips_when_effective_rain_covers_need() -> None:
    profile = ZoneIrrigationProfile(
        zoneType="lawn",
        plantType="grass",
        sunExposure="partial_shade",
        rainExposure="full",
        rainEffectiveness=1.0,
        waterNeedLevel="medium",
        baseWaterNeedMmPerDay=3.5,
        temperatureSensitivity=1.0,
        sunSensitivity=0.9,
        containerFactor=1.0,
        dryingSpeed="normal",
        wateringFrequencyPreference="rare_deep",
        preferredTimeWindow="early_morning",
        strategy="balanced",
        riskProfile="balanced",
        explanation="Testprofil",
    )

    result = build_zone_irrigation_recommendation(
        profile=profile,
        weather=ZoneWeatherFacts(
            temperature_max_c=19,
            rain_last_24h_mm=8,
            rain_next_24h_mm=2,
            cloud_cover_avg_pct=90,
        ),
        scheduled_duration_minutes=10,
        max_duration_minutes=20,
    )

    assert result.decision == "skip"
    assert result.adjusted_duration_minutes == 0
    assert result.effective_rain_mm > result.estimated_need_mm
