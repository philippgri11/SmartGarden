from __future__ import annotations

from copy import deepcopy
import base64
import json
import logging
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.application.schemas import (
    AdaptiveIrrigationPlan,
    ZoneAdaptivePlanResponse,
    ZoneAssistantTranscriptionRequest,
    ZoneAssistantTranscriptionResponse,
    ZoneIrrigationProfile,
    ZoneProfileAdjustmentRequest,
    ZoneProfileDiffItem,
    ZoneProfileSuggestionResponse,
)
from app.config import Settings, get_settings
from app.infrastructure.db import orm

logger = logging.getLogger(__name__)

FIELD_LABELS = {
    "zoneType": "Zonentyp",
    "plantType": "Pflanzentyp",
    "sunExposure": "Sonnenlage",
    "rainExposure": "Regeneinwirkung",
    "rainEffectiveness": "Regenwirksamkeit",
    "waterNeedLevel": "Wasserbedarf",
    "baseWaterNeedMmPerDay": "Basiswasserbedarf",
    "temperatureSensitivity": "Hitzereaktion",
    "sunSensitivity": "Sonnenreaktion",
    "containerFactor": "Gefäß-/Beetfaktor",
    "dryingSpeed": "Trocknungsgeschwindigkeit",
    "wateringFrequencyPreference": "Bewässerungsrhythmus",
    "preferredTimeWindow": "Bevorzugte Zeit",
    "strategy": "Strategie",
    "riskProfile": "Risikoprofil",
}

DISPLAY_LABELS = {
    "zoneType": {"lawn": "Rasen", "bed": "Beet", "raised_bed": "Hochbeet", "container": "Kübel", "greenhouse": "Gewächshaus", "hedge": "Hecke", "other": "Sonstiges"},
    "plantType": {"grass": "Gras", "vegetables": "Gemüse", "flowers": "Blumen", "herbs": "Kräuter", "shrubs": "Sträucher", "trees": "Bäume", "mixed": "Gemischt", "unknown": "Unbekannt"},
    "sunExposure": {"shade": "Schatten", "partial_shade": "Halbschatten", "sunny": "Sonnig", "full_sun": "Volle Sonne"},
    "rainExposure": {"none": "Kein Regen", "low": "Wenig Regen", "medium": "Teilweise Regen", "high": "Viel Regen", "full": "Voller Regen"},
    "waterNeedLevel": {"low": "Niedrig", "medium": "Mittel", "high": "Hoch", "very_high": "Sehr hoch"},
    "dryingSpeed": {"slow": "Langsam", "normal": "Normal", "fast": "Schnell", "very_fast": "Sehr schnell"},
    "wateringFrequencyPreference": {"rare_deep": "Selten und tief", "normal": "Normal", "frequent_short": "Häufig und kurz"},
    "preferredTimeWindow": {"early_morning": "Früh morgens", "morning": "Morgens", "evening": "Abends", "morning_and_evening": "Morgens und abends"},
    "strategy": {"water_saving": "Wassersparend", "balanced": "Ausgewogen", "growth_oriented": "Wachstumsorientiert"},
    "riskProfile": {"avoid_overwatering": "Überwässerung vermeiden", "balanced": "Ausgewogen", "avoid_drought_stress": "Trockenstress vermeiden"},
}

RAIN_EFFECTIVENESS = {
    "greenhouse": {"none": 0.0, "low": 0.0, "medium": 0.0, "high": 0.0, "full": 0.0},
    "container": {"none": 0.05, "low": 0.15, "medium": 0.3, "high": 0.45, "full": 0.5},
    "raised_bed": {"none": 0.15, "low": 0.35, "medium": 0.55, "high": 0.7, "full": 0.8},
    "bed": {"none": 0.2, "low": 0.4, "medium": 0.6, "high": 0.8, "full": 0.9},
    "lawn": {"none": 0.2, "low": 0.5, "medium": 0.75, "high": 0.9, "full": 1.0},
    "hedge": {"none": 0.2, "low": 0.4, "medium": 0.55, "high": 0.7, "full": 0.85},
    "other": {"none": 0.2, "low": 0.35, "medium": 0.55, "high": 0.7, "full": 0.85},
}
BASE_MM = {"shade": 2.0, "partial_shade": 2.8, "sunny": 3.6, "full_sun": 4.4}
ZONE_MM = {"lawn": 3.7, "bed": 3.0, "raised_bed": 4.4, "container": 4.8, "greenhouse": 5.0, "hedge": 2.8, "other": 3.2}
PLANT_MM = {"grass": 0.4, "vegetables": 0.9, "flowers": 0.2, "herbs": 0.3, "shrubs": 0.0, "trees": -0.2, "mixed": 0.2, "unknown": 0.0}
TEMP_SENS = {"shade": 0.7, "partial_shade": 0.9, "sunny": 1.15, "full_sun": 1.4}
SUN_SENS = {"shade": 0.6, "partial_shade": 0.85, "sunny": 1.2, "full_sun": 1.55}
DRYING_LEVEL = {"slow": 0, "normal": 1, "fast": 2, "very_fast": 3}


def _clamp(value: float, low: float, high: float) -> float:
    return round(max(low, min(high, value)), 2)


def _contains_any(text: str, *terms: str) -> bool:
    return any(term in text for term in terms)


class ZoneProfileService:
    def __init__(self, session: Session, settings: Settings | None = None):
        self.session = session
        self.settings = settings or get_settings()

    def suggest(self, description: str, current_profile: ZoneIrrigationProfile | None = None) -> ZoneProfileSuggestionResponse:
        profile = self._suggest_with_openai(description, current_profile=current_profile) or self._build_profile(description, current_profile=current_profile)
        warnings = self.validate_profile(profile)
        return ZoneProfileSuggestionResponse(
            profile=profile,
            warnings=warnings,
            explanation=profile.explanation,
            summary=self._summary(profile),
            diff=[],
        )

    def adjust_zone(self, zone: orm.Zone, payload: ZoneProfileAdjustmentRequest) -> ZoneProfileSuggestionResponse:
        current = payload.current_profile or ZoneIrrigationProfile.model_validate(zone.irrigation_profile_json or self._build_profile(zone.zone_profile_description or zone.description or zone.name).model_dump())
        updated = self._adjust_with_openai(current, payload.instruction, payload.description or zone.zone_profile_description or zone.description or zone.name) or self._apply_adjustment(current, payload.instruction, payload.description or zone.zone_profile_description or zone.description or zone.name)
        warnings = self.validate_profile(updated)
        diff = self._diff(current, updated)
        return ZoneProfileSuggestionResponse(
            profile=updated,
            warnings=warnings,
            explanation=updated.explanation,
            summary=self._summary(updated),
            diff=diff,
        )

    def suggest_adaptive_plan(self, *, description: str | None, profile: ZoneIrrigationProfile, max_duration_minutes: int) -> ZoneAdaptivePlanResponse:
        plan = self._suggest_plan_with_openai(description=description, profile=profile, max_duration_minutes=max_duration_minutes) or self._build_adaptive_plan(description or "", profile, max_duration_minutes)
        warnings = self.validate_adaptive_plan(profile, plan)
        return ZoneAdaptivePlanResponse(
            plan=plan,
            warnings=warnings,
            explanation=plan.explanation,
            summary=self._adaptive_plan_summary(plan),
        )

    def transcribe_audio(self, payload: ZoneAssistantTranscriptionRequest) -> ZoneAssistantTranscriptionResponse:
        if not self.settings.openai_api_key:
            raise ValueError("OpenAI API key missing")
        try:
            audio_bytes = base64.b64decode(payload.audio_base64, validate=True)
        except Exception as exc:  # noqa: BLE001
            raise ValueError("invalid audio payload") from exc
        files = {
            "file": (payload.filename or "zone-description.webm", audio_bytes, payload.mime_type or "audio/webm"),
        }
        data = {"model": self.settings.openai_transcription_model, "language": "de"}
        try:
            response = httpx.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
                data=data,
                files=files,
                timeout=self.settings.openai_timeout_seconds,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.warning("OpenAI transcription failed with status %s", exc.response.status_code)
            raise ValueError(f"OpenAI-Transkription fehlgeschlagen ({exc.response.status_code}).") from exc
        except httpx.RequestError as exc:
            logger.warning("OpenAI transcription request failed: %s", exc)
            raise ValueError("OpenAI-Transkription ist aktuell nicht erreichbar.") from exc
        return ZoneAssistantTranscriptionResponse(text=str(response.json().get("text", "")).strip())

    def validate_profile(self, profile: ZoneIrrigationProfile) -> list[str]:
        warnings: list[str] = []
        if profile.zoneType == "greenhouse" and profile.rainEffectiveness > 0.1:
            warnings.append("Du hast ein Gewächshaus mit spürbarer Regenwirksamkeit konfiguriert. Das ist eher ungewöhnlich.")
        if profile.zoneType == "container" and profile.rainExposure == "none" and profile.rainEffectiveness > 0.2:
            warnings.append("Du hast einen Kübel ohne Regenkontakt mit relativ hoher Regenanrechnung konfiguriert. Bitte prüfen.")
        if profile.zoneType == "lawn" and profile.wateringFrequencyPreference != "rare_deep":
            warnings.append("Für Rasen ist eher eine seltene, tiefere Bewässerung üblich.")
        if profile.zoneType == "container" and profile.wateringFrequencyPreference != "frequent_short":
            warnings.append("Für Kübel ist meist eine häufigere, kürzere Bewässerung sinnvoll.")
        if profile.zoneType == "container" and profile.containerFactor < 1.3:
            warnings.append("Für Kübel ist ein höherer Gefäßfaktor oft realistischer.")
        return warnings

    def validate_adaptive_plan(self, profile: ZoneIrrigationProfile, plan: AdaptiveIrrigationPlan) -> list[str]:
        warnings: list[str] = []
        if profile.zoneType == "lawn" and not plan.avoidMidday:
            warnings.append("Rasen sollte normalerweise nicht in der Mittagshitze beregnet werden.")
        if profile.zoneType == "container" and not plan.allowSecondDailyRun and profile.dryingSpeed in {"fast", "very_fast"}:
            warnings.append("Schnell trocknende Kübel brauchen an heißen Tagen eventuell morgens und abends einen Lauf.")
        if plan.minDurationMinutes > plan.baseDurationMinutes:
            warnings.append("Die Mindestdauer ist höher als die Basisdauer. Bitte prüfen.")
        if plan.maxDurationMinutes > plan.baseDurationMinutes * 4:
            warnings.append("Die maximale adaptive Laufzeit liegt deutlich über der Basisdauer. Bitte prüfen.")
        return warnings

    def _suggest_with_openai(self, description: str, current_profile: ZoneIrrigationProfile | None = None) -> ZoneIrrigationProfile | None:
        return self._call_openai(
            user_input=json.dumps(
                {
                    "mode": "suggest",
                    "description": description,
                    "currentProfile": current_profile.model_dump() if current_profile else None,
                },
                ensure_ascii=False,
            )
        )

    def _adjust_with_openai(self, current_profile: ZoneIrrigationProfile, instruction: str, description: str) -> ZoneIrrigationProfile | None:
        return self._call_openai(
            user_input=json.dumps(
                {
                    "mode": "adjust",
                    "description": description,
                    "instruction": instruction,
                    "currentProfile": current_profile.model_dump(),
                },
                ensure_ascii=False,
            )
        )

    def _suggest_plan_with_openai(self, *, description: str | None, profile: ZoneIrrigationProfile, max_duration_minutes: int) -> AdaptiveIrrigationPlan | None:
        if self.settings.environment == "test" or not self.settings.zone_assistant_use_openai or not self.settings.openai_api_key:
            return None
        instructions = (
            "Du bist ein Bewaesserungsplan-Assistent. Erzeuge genau ein JSON-Objekt fuer einen adaptiven, "
            "regelbasierten Bewaesserungsplan. Der Plan darf keine Ventile steuern und wird erst nach Nutzerfreigabe aktiv. "
            "Er muss erklaerbar sein: rules und explanation muessen auf Deutsch fuer normale Nutzer verstaendlich sein. "
            "Statische Zeiten vermeiden; nutze Zeitfenster, Mindestabstaende und Wetterformeln."
        )
        payload = {
            "model": self.settings.openai_model,
            "instructions": instructions,
            "input": json.dumps(
                {
                    "description": description,
                    "profile": profile.model_dump(),
                    "maxDurationMinutes": max_duration_minutes,
                },
                ensure_ascii=False,
            ),
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "adaptive_irrigation_plan",
                    "strict": True,
                    "schema": self._openai_plan_schema(),
                }
            },
        }
        try:
            response = httpx.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {self.settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=self.settings.openai_timeout_seconds,
            )
            response.raise_for_status()
            content = self._extract_response_text(response.json())
            if not content:
                return None
            return AdaptiveIrrigationPlan.model_validate_json(content)
        except Exception as exc:  # pragma: no cover
            logger.warning("Adaptive plan OpenAI call failed, using rule fallback: %s", exc)
            return None

    def _call_openai(self, user_input: str) -> ZoneIrrigationProfile | None:
        if self.settings.environment == "test" or not self.settings.zone_assistant_use_openai or not self.settings.openai_api_key:
            return None

        instructions = (
            "Du bist ein fachlicher Bewässerungszonen-Assistent. Erzeuge genau ein JSON-Objekt mit fachlichen "
            "Zonenparametern. Triff keine Bewässerungsentscheidung und steuere keine Ventile. Werte muessen innerhalb "
            "der erlaubten Bereiche liegen. Bei Anpassungen veraendere nur fachlich begruendbare Felder. Die explanation "
            "muss fuer normale Benutzer verstaendlich auf Deutsch sein."
        )
        payload = {
            "model": self.settings.openai_model,
            "instructions": instructions,
            "input": user_input,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "zone_irrigation_profile",
                    "strict": True,
                    "schema": self._openai_profile_schema(),
                }
            },
        }
        try:
            response = httpx.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {self.settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=self.settings.openai_timeout_seconds,
            )
            response.raise_for_status()
            content = self._extract_response_text(response.json())
            if not content:
                return None
            return ZoneIrrigationProfile.model_validate_json(content)
        except Exception as exc:  # pragma: no cover - network failures depend on deployment
            logger.warning("Zone assistant OpenAI call failed, using rule fallback: %s", exc)
            return None

    def _extract_response_text(self, data: dict[str, Any]) -> str | None:
        if isinstance(data.get("output_text"), str):
            return data["output_text"]
        for item in data.get("output", []):
            if item.get("type") != "message":
                continue
            for content in item.get("content", []):
                if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                    return content["text"]
        return None

    def _openai_profile_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "zoneType", "plantType", "sunExposure", "rainExposure", "rainEffectiveness",
                "waterNeedLevel", "baseWaterNeedMmPerDay", "temperatureSensitivity", "sunSensitivity",
                "containerFactor", "dryingSpeed", "wateringFrequencyPreference", "preferredTimeWindow",
                "strategy", "riskProfile", "explanation",
            ],
            "properties": {
                "zoneType": {"type": "string", "enum": ["lawn", "bed", "raised_bed", "container", "greenhouse", "hedge", "other"]},
                "plantType": {"type": "string", "enum": ["grass", "vegetables", "flowers", "herbs", "shrubs", "trees", "mixed", "unknown"]},
                "sunExposure": {"type": "string", "enum": ["shade", "partial_shade", "sunny", "full_sun"]},
                "rainExposure": {"type": "string", "enum": ["none", "low", "medium", "high", "full"]},
                "rainEffectiveness": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                "waterNeedLevel": {"type": "string", "enum": ["low", "medium", "high", "very_high"]},
                "baseWaterNeedMmPerDay": {"type": "number", "minimum": 0.0, "maximum": 20.0},
                "temperatureSensitivity": {"type": "number", "minimum": 0.5, "maximum": 2.0},
                "sunSensitivity": {"type": "number", "minimum": 0.5, "maximum": 2.0},
                "containerFactor": {"type": "number", "minimum": 1.0, "maximum": 2.5},
                "dryingSpeed": {"type": "string", "enum": ["slow", "normal", "fast", "very_fast"]},
                "wateringFrequencyPreference": {"type": "string", "enum": ["rare_deep", "normal", "frequent_short"]},
                "preferredTimeWindow": {"type": "string", "enum": ["early_morning", "morning", "evening", "morning_and_evening"]},
                "strategy": {"type": "string", "enum": ["water_saving", "balanced", "growth_oriented"]},
                "riskProfile": {"type": "string", "enum": ["avoid_overwatering", "balanced", "avoid_drought_stress"]},
                "explanation": {"type": "string", "minLength": 1},
            },
        }

    def _openai_plan_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "irrigationMethod", "preferredTimeWindows", "avoidMidday", "allowSecondDailyRun",
                "minIntervalHours", "baseDurationMinutes", "minDurationMinutes", "maxDurationMinutes",
                "rainSkipThresholdMm", "rainDelayThresholdMm", "heatThresholdC", "highNeedThresholdMm",
                "rules", "explanation",
            ],
            "properties": {
                "irrigationMethod": {"type": "string", "enum": ["sprinkler", "drip", "soaker_hose", "manual", "unknown"]},
                "preferredTimeWindows": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string", "enum": ["early_morning", "morning", "evening", "morning_and_evening"]},
                },
                "avoidMidday": {"type": "boolean"},
                "allowSecondDailyRun": {"type": "boolean"},
                "minIntervalHours": {"type": "integer", "minimum": 1, "maximum": 72},
                "baseDurationMinutes": {"type": "integer", "minimum": 1, "maximum": 240},
                "minDurationMinutes": {"type": "integer", "minimum": 1, "maximum": 240},
                "maxDurationMinutes": {"type": "integer", "minimum": 1, "maximum": 240},
                "rainSkipThresholdMm": {"type": "number", "minimum": 0, "maximum": 50},
                "rainDelayThresholdMm": {"type": "number", "minimum": 0, "maximum": 50},
                "heatThresholdC": {"type": "number", "minimum": 0, "maximum": 50},
                "highNeedThresholdMm": {"type": "number", "minimum": 0, "maximum": 20},
                "rules": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                "explanation": {"type": "string", "minLength": 1},
            },
        }

    def _build_adaptive_plan(self, description: str, profile: ZoneIrrigationProfile, max_duration_minutes: int) -> AdaptiveIrrigationPlan:
        text = description.lower()
        irrigation_method = self._detect_irrigation_method(text)
        frequent = profile.wateringFrequencyPreference == "frequent_short" or profile.zoneType in {"container", "greenhouse"}
        rare_deep = profile.wateringFrequencyPreference == "rare_deep" or profile.zoneType == "lawn"
        allow_second = frequent or profile.dryingSpeed == "very_fast"
        preferred = self._plan_windows(profile, irrigation_method)
        base_duration = self._base_duration(profile, max_duration_minutes, rare_deep=rare_deep, frequent=frequent)
        plan = AdaptiveIrrigationPlan(
            irrigationMethod=irrigation_method,
            preferredTimeWindows=preferred,
            avoidMidday=irrigation_method != "drip",
            allowSecondDailyRun=allow_second,
            minIntervalHours=30 if rare_deep else (8 if allow_second else 18),
            baseDurationMinutes=base_duration,
            minDurationMinutes=max(1, round(base_duration * (0.35 if frequent else 0.45))),
            maxDurationMinutes=max(base_duration, min(max_duration_minutes, round(base_duration * (2.2 if allow_second else 1.8)))),
            rainSkipThresholdMm=2.5 if profile.rainEffectiveness < 0.4 else (5.0 if rare_deep else 3.5),
            rainDelayThresholdMm=1.5 if profile.rainEffectiveness < 0.4 else 2.0,
            heatThresholdC=26.0 if frequent else 28.0,
            highNeedThresholdMm=2.2 if frequent else 3.2,
            rules=self._adaptive_rules(profile, irrigation_method, allow_second),
            explanation=(
                "Aus dem Zonenprofil wurde ein adaptiver Regelplan erzeugt. Der Scheduler prüft nur die freigegebenen "
                "Zeitfenster, rechnet Regen über die Regenwirksamkeit an und passt die Laufzeit mit Hitze-, Sonnen- "
                "und Austrocknungsfaktoren an. Manuelle Starts bleiben unverändert möglich."
            ),
        )
        return plan

    def _detect_irrigation_method(self, text: str) -> str:
        if _contains_any(text, "tröpfchen", "tropf", "drip"):
            return "drip"
        if _contains_any(text, "perlschlauch", "schwitzschlauch"):
            return "soaker_hose"
        if _contains_any(text, "sprenger", "regner", "rasensprenger"):
            return "sprinkler"
        return "unknown"

    def _plan_windows(self, profile: ZoneIrrigationProfile, irrigation_method: str) -> list[str]:
        if profile.preferredTimeWindow == "morning_and_evening":
            return ["morning_and_evening"]
        if profile.zoneType == "lawn":
            return ["early_morning"]
        if profile.zoneType in {"container", "greenhouse"} and profile.dryingSpeed in {"fast", "very_fast"}:
            return ["morning_and_evening"]
        if irrigation_method == "drip" and profile.zoneType != "lawn":
            return [profile.preferredTimeWindow]
        return [profile.preferredTimeWindow if profile.preferredTimeWindow != "evening" else "early_morning"]

    def _base_duration(self, profile: ZoneIrrigationProfile, max_duration_minutes: int, *, rare_deep: bool, frequent: bool) -> int:
        base = profile.baseWaterNeedMmPerDay * 2.0
        if rare_deep:
            base *= 1.8
        if frequent:
            base *= 0.9
        if profile.strategy == "water_saving":
            base *= 0.85
        elif profile.strategy == "growth_oriented":
            base *= 1.15
        return max(1, min(round(base), max_duration_minutes))

    def _adaptive_rules(self, profile: ZoneIrrigationProfile, irrigation_method: str, allow_second: bool) -> list[str]:
        rules = [
            "Regen der letzten 24 Stunden wird nur mit der Regenwirksamkeit der Zone vom Bedarf abgezogen.",
            "Hitze und Sonne erhöhen die Laufzeit stärker, wenn Hitzereaktion oder Sonnenreaktion hoch sind.",
            "Bei ausreichend wirksamem Regen wird der automatische Lauf ausgelassen oder verschoben.",
        ]
        if profile.zoneType == "lawn":
            rules.append("Rasen wird nur früh am Morgen geplant, damit keine Mittagshitze auf nasse Halme trifft.")
        if irrigation_method == "drip":
            rules.append("Tröpfchenbewässerung darf flexibler sein, weil wenig Wasser auf Blätter verdunstet.")
        if allow_second:
            rules.append("Bei hohem Netto-Bedarf darf am selben Tag ein zweiter kurzer Lauf geplant werden.")
        return rules

    def _adaptive_plan_summary(self, plan: AdaptiveIrrigationPlan) -> list[str]:
        return [
            f"Fenster: {', '.join(DISPLAY_LABELS['preferredTimeWindow'].get(item, item) for item in plan.preferredTimeWindows)}",
            f"Basisdauer: {plan.baseDurationMinutes} Minuten",
            f"Abstand: mindestens {plan.minIntervalHours} Stunden",
            "zweiter Lauf moeglich" if plan.allowSecondDailyRun else "maximal ein automatischer Lauf pro Tag",
        ]

    def _build_profile(self, description: str, current_profile: ZoneIrrigationProfile | None = None) -> ZoneIrrigationProfile:
        text = description.lower()
        zone_type = self._detect_zone_type(text, current_profile.zoneType if current_profile else None)
        plant_type = self._detect_plant_type(text, current_profile.plantType if current_profile else None)
        sun_exposure = self._detect_sun_exposure(text, current_profile.sunExposure if current_profile else None)
        rain_exposure = self._detect_rain_exposure(text, zone_type, current_profile.rainExposure if current_profile else None)
        drying_speed = self._detect_drying_speed(text, zone_type, current_profile.dryingSpeed if current_profile else None)

        rain_effectiveness = RAIN_EFFECTIVENESS[zone_type][rain_exposure]
        container_factor = self._container_factor(zone_type, drying_speed, text)
        base_mm = ZONE_MM[zone_type] + PLANT_MM[plant_type]
        base_mm = (base_mm + BASE_MM[sun_exposure]) / 2
        base_mm += {"slow": -0.5, "normal": 0.0, "fast": 0.6, "very_fast": 1.2}[drying_speed]
        if zone_type == "greenhouse":
            base_mm += 0.5
        if zone_type == "container":
            base_mm += 0.6
        base_mm = _clamp(base_mm, 1.0, 7.0)

        temperature_sensitivity = _clamp(TEMP_SENS[sun_exposure] + (0.2 if zone_type in {"container", "greenhouse", "raised_bed"} else 0.0) + (0.15 if drying_speed in {"fast", "very_fast"} else 0.0) + (0.1 if zone_type == "greenhouse" else 0.0), 0.5, 2.0)
        sun_sensitivity = _clamp(SUN_SENS[sun_exposure] + (0.2 if zone_type == "container" else 0.0) + (0.1 if drying_speed in {"fast", "very_fast"} else 0.0), 0.5, 2.0)
        water_need_level = self._water_need_level(base_mm)
        watering_frequency = self._watering_frequency(zone_type, drying_speed)
        preferred_time = self._preferred_time(zone_type, watering_frequency, text)
        strategy = self._strategy(text, zone_type)
        risk_profile = self._risk_profile(text, zone_type, plant_type)
        explanation = self._explanation(zone_type, plant_type, sun_exposure, rain_exposure, drying_speed, strategy, risk_profile)

        return ZoneIrrigationProfile(
            zoneType=zone_type,
            plantType=plant_type,
            sunExposure=sun_exposure,
            rainExposure=rain_exposure,
            rainEffectiveness=rain_effectiveness,
            waterNeedLevel=water_need_level,
            baseWaterNeedMmPerDay=base_mm,
            temperatureSensitivity=temperature_sensitivity,
            sunSensitivity=sun_sensitivity,
            containerFactor=container_factor,
            dryingSpeed=drying_speed,
            wateringFrequencyPreference=watering_frequency,
            preferredTimeWindow=preferred_time,
            strategy=strategy,
            riskProfile=risk_profile,
            explanation=explanation,
        )

    def _apply_adjustment(self, current: ZoneIrrigationProfile, instruction: str, description: str) -> ZoneIrrigationProfile:
        profile = deepcopy(current.model_dump())
        text = instruction.lower()
        notes: list[str] = []
        if _contains_any(text, "trocknet schneller", "schneller aus", "abends oft trocken", "erde trocken"):
            profile["baseWaterNeedMmPerDay"] = _clamp(profile["baseWaterNeedMmPerDay"] + 0.9, 0.0, 20.0)
            profile["temperatureSensitivity"] = _clamp(profile["temperatureSensitivity"] + 0.2, 0.5, 2.0)
            profile["sunSensitivity"] = _clamp(profile["sunSensitivity"] + 0.2, 0.5, 2.0)
            profile["dryingSpeed"] = "fast" if profile["dryingSpeed"] in {"slow", "normal"} else "very_fast"
            notes.append("Die neue Beschreibung deutet auf schnellere Austrocknung hin.")
        if _contains_any(text, "bei hitze", "blätter hängen", "hitz"):
            profile["temperatureSensitivity"] = _clamp(profile["temperatureSensitivity"] + 0.25, 0.5, 2.0)
            profile["riskProfile"] = "avoid_drought_stress"
            notes.append("Hitzeempfindlichkeit wurde erhöht, um Trockenstress vorzubeugen.")
        if _contains_any(text, "nachmittagssonne", "vollen sonne", "volle sonne", "ganzen nachmittag sonne"):
            profile["sunSensitivity"] = _clamp(profile["sunSensitivity"] + 0.3, 0.5, 2.0)
            profile["sunExposure"] = "full_sun"
            notes.append("Starke Sonne erhöht den Einfluss der Sonneneinstrahlung.")
        if _contains_any(text, "wassersparender", "weniger wasser", "zu viel bewässert", "zu viel wasser"):
            profile["strategy"] = "water_saving"
            profile["baseWaterNeedMmPerDay"] = _clamp(profile["baseWaterNeedMmPerDay"] - 0.6, 0.0, 20.0)
            profile["riskProfile"] = "balanced" if profile["riskProfile"] == "avoid_drought_stress" else "avoid_overwatering"
            notes.append("Die Strategie wurde etwas wassersparender eingestellt.")
        if _contains_any(text, "regen bringt kaum", "unter dem dach", "regen kommt kaum", "regen spielt keine rolle"):
            profile["rainExposure"] = "none" if _contains_any(text, "keine rolle", "unter dem dach", "kaum") else "low"
            profile["rainEffectiveness"] = 0.0 if profile["zoneType"] == "greenhouse" else 0.1
            notes.append("Regen wird für diese Zone deutlich schwächer angerechnet.")
        profile_model = ZoneIrrigationProfile.model_validate(profile)
        if notes:
            profile_model.explanation = " ".join(notes)
        else:
            profile_model.explanation = self._build_profile(description, current_profile=profile_model).explanation
        return profile_model

    def _detect_zone_type(self, text: str, fallback: str | None) -> str:
        if _contains_any(text, "gewächshaus", "greenhouse"):
            return "greenhouse"
        if _contains_any(text, "hochbeet"):
            return "raised_bed"
        if _contains_any(text, "kübel", "topf", "balkonkasten", "pflanzkübel", "terrasse"):
            return "container"
        if _contains_any(text, "rasen"):
            return "lawn"
        if _contains_any(text, "hecke"):
            return "hedge"
        if _contains_any(text, "beet", "stauden", "blumenbeet"):
            return "bed"
        return fallback or "other"

    def _detect_plant_type(self, text: str, fallback: str | None) -> str:
        if _contains_any(text, "rasen", "grass"):
            return "grass"
        if _contains_any(text, "tomate", "paprika", "gemüse", "gurke"):
            return "vegetables"
        if _contains_any(text, "kräuter", "basilikum", "thymian"):
            return "herbs"
        if _contains_any(text, "stauden", "blumen", "rose"):
            return "flowers"
        if _contains_any(text, "hecke", "strauch"):
            return "shrubs"
        if _contains_any(text, "baum"):
            return "trees"
        if _contains_any(text, "gemischt", "mix"):
            return "mixed"
        return fallback or "unknown"

    def _detect_sun_exposure(self, text: str, fallback: str | None) -> str:
        if _contains_any(text, "ganzen tag sonne", "volle sonne", "voller sonne", "in voller sonne", "vollsonne", "fast den ganzen tag in der sonne"):
            return "full_sun"
        if _contains_any(text, "sehr sonnig", "sonnig", "südterrasse", "nachmittagssonne"):
            return "sunny"
        if _contains_any(text, "halbschatten", "teilweise sonne", "morgens sonne"):
            return "partial_shade"
        if _contains_any(text, "schattig", "im schatten", "nur wenig sonne"):
            return "shade"
        return fallback or "partial_shade"

    def _detect_rain_exposure(self, text: str, zone_type: str, fallback: str | None) -> str:
        if zone_type == "greenhouse" or _contains_any(text, "regen spielt keine rolle"):
            return "none"
        if _contains_any(text, "unter dem dach", "regen kommt kaum", "regen fast nicht"):
            return "none"
        if _contains_any(text, "regen kommt wenig"):
            return "low"
        if _contains_any(text, "teilweise", "bedingt"):
            return "medium"
        if _contains_any(text, "regen kommt gut ran", "regen kommt gut an"):
            return "high"
        if _contains_any(text, "regen kommt vollständig an", "vollständig an", "freistehend"):
            return "full"
        return fallback or ("medium" if zone_type in {"bed", "hedge", "other"} else "high")

    def _detect_drying_speed(self, text: str, zone_type: str, fallback: str | None) -> str:
        if _contains_any(text, "sehr schnell aus", "sehr schnell trocken", "extrem schnell"):
            return "very_fast"
        if _contains_any(text, "trocknet schnell", "schnell aus", "oft trocken"):
            return "fast"
        if _contains_any(text, "bleibt lange feucht", "lange feucht", "trocknet langsam"):
            return "slow"
        if zone_type in {"container", "greenhouse", "raised_bed"}:
            return "fast"
        return fallback or "normal"

    def _container_factor(self, zone_type: str, drying_speed: str, text: str) -> float:
        if zone_type == "container":
            if _contains_any(text, "balkonkasten", "klein"):
                return 2.0
            if _contains_any(text, "großer kübel", "große kübel"):
                return 1.5
            return 1.7 if drying_speed in {"fast", "very_fast"} else 1.5
        if zone_type == "raised_bed":
            return 1.3
        return 1.0

    def _watering_frequency(self, zone_type: str, drying_speed: str) -> str:
        if zone_type == "lawn":
            return "rare_deep"
        if zone_type == "container":
            return "frequent_short"
        if zone_type == "greenhouse":
            return "frequent_short" if drying_speed in {"fast", "very_fast"} else "normal"
        return "normal" if drying_speed in {"slow", "normal"} else "frequent_short"

    def _preferred_time(self, zone_type: str, watering_frequency: str, text: str) -> str:
        if _contains_any(text, "abends"):
            return "evening"
        if zone_type in {"container", "greenhouse"} and watering_frequency == "frequent_short":
            return "morning_and_evening"
        return "early_morning"

    def _strategy(self, text: str, zone_type: str) -> str:
        if _contains_any(text, "wasserspar", "wenig wasser"):
            return "water_saving"
        if _contains_any(text, "wachstum", "ertrag") or zone_type in {"greenhouse", "raised_bed"}:
            return "growth_oriented"
        return "balanced"

    def _risk_profile(self, text: str, zone_type: str, plant_type: str) -> str:
        if _contains_any(text, "trockenstress", "blätter hängen") or zone_type in {"container", "greenhouse"} or plant_type == "vegetables":
            return "avoid_drought_stress"
        if _contains_any(text, "nass", "staunässe"):
            return "avoid_overwatering"
        return "balanced"

    def _water_need_level(self, base_mm: float) -> str:
        if base_mm < 2.5:
            return "low"
        if base_mm < 4.0:
            return "medium"
        if base_mm < 5.5:
            return "high"
        return "very_high"

    def _summary(self, profile: ZoneIrrigationProfile) -> list[str]:
        return [
            f"{DISPLAY_LABELS['zoneType'][profile.zoneType]} mit {DISPLAY_LABELS['plantType'][profile.plantType]}",
            f"Sonnenlage: {DISPLAY_LABELS['sunExposure'][profile.sunExposure]}",
            f"Wasserbedarf: {DISPLAY_LABELS['waterNeedLevel'][profile.waterNeedLevel]}",
            f"Bevorzugt: {DISPLAY_LABELS['preferredTimeWindow'][profile.preferredTimeWindow]}",
        ]

    def _diff(self, before: ZoneIrrigationProfile, after: ZoneIrrigationProfile) -> list[ZoneProfileDiffItem]:
        before_data = before.model_dump()
        after_data = after.model_dump()
        diff: list[ZoneProfileDiffItem] = []
        for field, label in FIELD_LABELS.items():
            if before_data[field] == after_data[field]:
                continue
            diff.append(ZoneProfileDiffItem(
                field=field,
                label=label,
                before_display=self._display(field, before_data[field]),
                after_display=self._display(field, after_data[field]),
            ))
        return diff

    def _display(self, field: str, value: Any) -> str:
        labels = DISPLAY_LABELS.get(field)
        if labels and isinstance(value, str):
            return labels.get(value, value)
        if field == "rainEffectiveness":
            return f"{value:.2f}"
        if field == "baseWaterNeedMmPerDay":
            return f"{value:.1f} mm/Tag"
        if field in {"temperatureSensitivity", "sunSensitivity", "containerFactor"}:
            return f"{value:.1f}"
        return str(value)

    def _explanation(self, zone_type: str, plant_type: str, sun_exposure: str, rain_exposure: str, drying_speed: str, strategy: str, risk_profile: str) -> str:
        zone = DISPLAY_LABELS['zoneType'][zone_type].lower()
        plant = DISPLAY_LABELS['plantType'][plant_type].lower()
        sun = DISPLAY_LABELS['sunExposure'][sun_exposure].lower()
        rain = DISPLAY_LABELS['rainExposure'][rain_exposure].lower()
        drying = DISPLAY_LABELS['dryingSpeed'][drying_speed].lower()
        strategy_text = DISPLAY_LABELS['strategy'][strategy].lower()
        risk_text = DISPLAY_LABELS['riskProfile'][risk_profile].lower()
        return f"Die Zone wurde als {zone} mit {plant} erkannt. Die Lage entspricht {sun}, Regen wirkt {rain.lower()}, und die Zone trocknet {drying} aus. Daher wurden Wasserbedarf und Reaktion auf Sonne und Temperatur passend angesetzt. Die Strategie ist {strategy_text}, mit Fokus auf {risk_text}."
