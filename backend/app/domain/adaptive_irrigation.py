from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta

from app.application.schemas import AdaptiveIrrigationPlan, ZoneIrrigationProfile
from app.domain.zone_irrigation import (
    ZoneIrrigationModelConfig,
    ZoneIrrigationRecommendation,
    ZoneWeatherFacts,
    build_zone_irrigation_recommendation,
)


ADAPTIVE_REASON_PREFIX = "adaptive irrigation:"

WINDOW_STARTS = {
    "early_morning": time(5, 30),
    "morning": time(7, 0),
    "evening": time(19, 0),
}
WINDOW_GRACE_MINUTES = 25


@dataclass(slots=True)
class AdaptivePlanDecision:
    should_plan: bool
    duration_minutes: int
    scheduled_at: datetime | None
    reason: str
    details: list[str]
    recommendation: ZoneIrrigationRecommendation | None = None


def expand_time_windows(plan: AdaptiveIrrigationPlan | dict) -> list[str]:
    parsed = plan if isinstance(plan, AdaptiveIrrigationPlan) else AdaptiveIrrigationPlan.model_validate(plan)
    windows: list[str] = []
    for item in parsed.preferredTimeWindows:
        if item == "morning_and_evening":
            windows.extend(["early_morning", "evening"])
        else:
            windows.append(item)
    if parsed.avoidMidday:
        windows = [item for item in windows if item in WINDOW_STARTS]
    return list(dict.fromkeys(windows)) or ["early_morning"]


def current_adaptive_slot(plan: AdaptiveIrrigationPlan | dict, *, now: datetime) -> datetime | None:
    parsed = plan if isinstance(plan, AdaptiveIrrigationPlan) else AdaptiveIrrigationPlan.model_validate(plan)
    for window in expand_time_windows(parsed):
        start_time = WINDOW_STARTS.get(window)
        if not start_time:
            continue
        slot = datetime.combine(now.date(), start_time, tzinfo=now.tzinfo)
        if slot <= now <= slot + timedelta(minutes=WINDOW_GRACE_MINUTES):
            return slot
    return None


def next_adaptive_slot(plan: AdaptiveIrrigationPlan | dict, *, now: datetime) -> datetime | None:
    parsed = plan if isinstance(plan, AdaptiveIrrigationPlan) else AdaptiveIrrigationPlan.model_validate(plan)
    candidates: list[datetime] = []
    for day_offset in range(0, 3):
        target_date = (now + timedelta(days=day_offset)).date()
        for window in expand_time_windows(parsed):
            start_time = WINDOW_STARTS.get(window)
            if not start_time:
                continue
            slot = datetime.combine(target_date, start_time, tzinfo=now.tzinfo)
            if slot > now:
                candidates.append(slot)
    return min(candidates) if candidates else None


def decide_adaptive_plan(
    *,
    profile: ZoneIrrigationProfile,
    plan: AdaptiveIrrigationPlan,
    weather: ZoneWeatherFacts,
    now: datetime,
    last_run_at: datetime | None,
    max_duration_minutes: int,
    already_watered_today: bool,
    model_config: ZoneIrrigationModelConfig | None = None,
) -> AdaptivePlanDecision:
    slot = current_adaptive_slot(plan, now=now)
    if slot is None:
        return AdaptivePlanDecision(False, 0, None, "Kein freigegebenes Bewässerungsfenster aktiv.", [])

    if last_run_at and last_run_at.tzinfo is None and now.tzinfo is not None:
        last_run_at = last_run_at.replace(tzinfo=now.tzinfo)
    if last_run_at and now - last_run_at < timedelta(hours=plan.minIntervalHours):
        hours_left = plan.minIntervalHours - ((now - last_run_at).total_seconds() / 3600)
        return AdaptivePlanDecision(
            False,
            0,
            slot,
            f"Mindestabstand noch nicht erreicht: ungefähr {hours_left:.1f} Stunden verbleiben.",
            ["Manuelle Starts bleiben davon unberührt."],
        )

    if already_watered_today and not plan.allowSecondDailyRun:
        return AdaptivePlanDecision(
            False,
            0,
            slot,
            "Heute wurde bereits automatisch bewässert und der Regelplan erlaubt keinen zweiten Lauf.",
            [],
        )

    recommendation = build_zone_irrigation_recommendation(
        profile=profile,
        weather=weather,
        scheduled_duration_minutes=plan.baseDurationMinutes,
        max_duration_minutes=min(plan.maxDurationMinutes, max_duration_minutes),
        model_config=model_config,
    )
    duration = max(plan.minDurationMinutes, min(recommendation.adjusted_duration_minutes, plan.maxDurationMinutes, max_duration_minutes))
    effective_rain = recommendation.effective_rain_mm
    rain_next = weather.rain_next_24h_mm or 0.0
    if effective_rain >= plan.rainSkipThresholdMm and profile.riskProfile != "avoid_drought_stress":
        return AdaptivePlanDecision(
            False,
            0,
            slot,
            f"Wirksamer Regen deckt den Bedarf: {effective_rain:.1f} mm zählen für diese Zone.",
            recommendation.details,
            recommendation,
        )
    if rain_next >= plan.rainDelayThresholdMm and recommendation.net_need_mm < plan.highNeedThresholdMm:
        return AdaptivePlanDecision(
            False,
            0,
            slot,
            f"Regen wird erwartet ({rain_next:.1f} mm) und der Netto-Bedarf ist noch nicht hoch genug.",
            recommendation.details,
            recommendation,
        )
    if recommendation.decision == "skip":
        return AdaptivePlanDecision(False, 0, slot, recommendation.explanation, recommendation.details, recommendation)

    reason = (
        f"Adaptiver Lauf geplant: {duration} Minuten im Fenster {slot.strftime('%H:%M')}. "
        f"{recommendation.explanation}"
    )
    return AdaptivePlanDecision(True, duration, slot, reason, recommendation.details, recommendation)
