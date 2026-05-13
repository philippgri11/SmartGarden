from app.application.schemas import ZoneIrrigationProfile, ZoneProfileAdjustmentRequest
from app.application.zone_profile_service import ZoneProfileService
from app.infrastructure.db import orm


def test_suggest_lawn_full_sun(db_session) -> None:
    service = ZoneProfileService(db_session)
    result = service.suggest("Große Rasenfläche, bekommt fast den ganzen Tag Sonne, Regen kommt vollständig an.")

    assert result.profile.zoneType == "lawn"
    assert result.profile.plantType == "grass"
    assert result.profile.sunExposure == "full_sun"
    assert result.profile.rainEffectiveness >= 0.9
    assert result.profile.wateringFrequencyPreference == "rare_deep"


def test_suggest_container_under_roof(db_session) -> None:
    service = ZoneProfileService(db_session)
    result = service.suggest("Kübelpflanzen auf der Terrasse, stehen unter dem Dach, Regen kommt fast nicht an, im Sommer sehr sonnig.")

    assert result.profile.zoneType == "container"
    assert result.profile.rainEffectiveness <= 0.2
    assert result.profile.sunSensitivity >= 1.5
    assert result.profile.temperatureSensitivity >= 1.4
    assert result.profile.containerFactor >= 1.4
    assert result.profile.wateringFrequencyPreference == "frequent_short"


def test_suggest_understands_in_full_sun_wording(db_session) -> None:
    service = ZoneProfileService(db_session)
    result = service.suggest("Hochbeet mit Tomaten in voller Sonne, Regen kommt gut ran, Erde trocknet schnell aus.")

    assert result.profile.zoneType == "raised_bed"
    assert result.profile.plantType == "vegetables"
    assert result.profile.sunExposure == "full_sun"


def test_suggest_greenhouse(db_session) -> None:
    service = ZoneProfileService(db_session)
    result = service.suggest("Tomaten im Gewächshaus, Regen spielt keine Rolle, es wird sehr warm.")

    assert result.profile.zoneType == "greenhouse"
    assert result.profile.plantType == "vegetables"
    assert result.profile.rainEffectiveness == 0.0
    assert result.profile.temperatureSensitivity >= 1.3
    assert result.profile.riskProfile == "avoid_drought_stress"


def test_adjustment_increases_heat_and_sun_response(db_session) -> None:
    service = ZoneProfileService(db_session)
    zone = orm.Zone(
        name="Hochbeet Süd", gpio_chip="/dev/gpiochip0", gpio_line=12, active=True,
        default_manual_duration_minutes=5, max_duration_minutes=10, weather_enabled=True,
        irrigation_profile_json=ZoneIrrigationProfile(
            zoneType="raised_bed", plantType="vegetables", sunExposure="sunny", rainExposure="high",
            rainEffectiveness=0.7, waterNeedLevel="medium", baseWaterNeedMmPerDay=3.5,
            temperatureSensitivity=1.1, sunSensitivity=1.1, containerFactor=1.3, dryingSpeed="normal",
            wateringFrequencyPreference="normal", preferredTimeWindow="early_morning", strategy="balanced",
            riskProfile="balanced", explanation="Basis"
        ).model_dump()
    )
    db_session.add(zone)
    db_session.flush()

    response = service.adjust_zone(zone, ZoneProfileAdjustmentRequest(instruction="Die Pflanzen lassen bei Hitze schnell die Blätter hängen und die Erde ist abends oft trocken."))

    assert response.profile.baseWaterNeedMmPerDay > 3.5
    assert response.profile.sunSensitivity > 1.1
    assert response.profile.temperatureSensitivity > 1.1
    assert response.profile.dryingSpeed == "fast"
    assert any(item.label == "Hitzereaktion" for item in response.diff)
