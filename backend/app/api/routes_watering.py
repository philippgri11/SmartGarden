from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db, get_app_settings
from app.application.runtime_service import RuntimeService
from app.application.schemas import (
    GpioEventResponse,
    ManualRunCreate,
    PauseSystemRequest,
    RunAllAreasResponse,
    RuntimeSnapshotResponse,
    SettingsResponse,
    SettingsUpdate,
    SystemSummaryResponse,
    WinterModeUpdate,
)
from app.application.system_service import SystemService
from app.infrastructure.db.repositories import GpioEventRepository
from app.application.watering_service import WateringService
from app.application.weather_service import WeatherService
from app.config import Settings
from app.infrastructure.gpio.factory import build_gpio_adapter


router = APIRouter(tags=["watering"])


@router.post("/zones/{zone_id}/start", status_code=status.HTTP_202_ACCEPTED)
def start_zone(zone_id: int, payload: ManualRunCreate, db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> dict:
    service = WateringService(db, app_settings, build_gpio_adapter(app_settings))
    try:
        run = service.create_manual_run(zone_id, payload.duration_minutes, payload.reason)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"message": "manual run queued", "run_id": run.id}


@router.post("/zones/{zone_id}/stop")
def stop_zone(zone_id: int, db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> dict:
    service = WateringService(db, app_settings, build_gpio_adapter(app_settings))
    return {"stops_requested": service.request_stop_zone(zone_id)}


@router.post("/watering/stop-all")
def stop_all(db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> dict:
    service = WateringService(db, app_settings, build_gpio_adapter(app_settings))
    return {"stops_requested": service.request_stop_all()}


@router.post("/watering/run-all", response_model=RunAllAreasResponse, status_code=status.HTTP_202_ACCEPTED)
def run_all_areas(db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> RunAllAreasResponse:
    service = WateringService(db, app_settings, build_gpio_adapter(app_settings))
    try:
        sequence_group_id, queued_count, skipped_count = service.create_run_all_sequence()
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return RunAllAreasResponse(
        message="Gesamtbewässerung wurde vorbereitet.",
        queued_run_count=queued_count,
        skipped_schedule_count=skipped_count,
        sequence_group_id=sequence_group_id,
    )


@router.post("/system/release-safety-stop")
def release_safety_stop(db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> dict:
    service = WateringService(db, app_settings, build_gpio_adapter(app_settings))
    service.release_safety_stop()
    return {"message": "safety stop released"}


@router.post("/system/pause")
def pause_system(payload: PauseSystemRequest, db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> SettingsResponse:
    entity = SystemService(db, app_settings, build_gpio_adapter(app_settings)).pause_for_hours(payload.hours)
    return SettingsResponse.model_validate(entity, from_attributes=True)


@router.post("/system/clear-pause")
def clear_pause(db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> SettingsResponse:
    entity = SystemService(db, app_settings, build_gpio_adapter(app_settings)).clear_pause()
    return SettingsResponse.model_validate(entity, from_attributes=True)


@router.post("/system/winter-mode")
def set_winter_mode(payload: WinterModeUpdate, db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> SettingsResponse:
    entity = SystemService(db, app_settings, build_gpio_adapter(app_settings)).set_winter_mode(
        active=payload.active,
        disable_manual_start=payload.disable_manual_start,
        pause_schedules=payload.pause_schedules,
        safety_shutdown=payload.safety_shutdown,
    )
    return SettingsResponse.model_validate(entity, from_attributes=True)


@router.get("/system/summary", response_model=SystemSummaryResponse)
def get_system_summary(db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> SystemSummaryResponse:
    summary = RuntimeService(db, app_settings).snapshot()["summary"]
    return SystemSummaryResponse.model_validate(summary)


@router.get("/system/runtime", response_model=RuntimeSnapshotResponse)
def get_system_runtime(db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> RuntimeSnapshotResponse:
    snapshot = RuntimeService(db, app_settings).snapshot()
    return RuntimeSnapshotResponse.model_validate(snapshot)


@router.get("/watering/runs")
def list_runs(db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> list[dict]:
    service = WateringService(db, app_settings, build_gpio_adapter(app_settings))
    weather_service = WeatherService(db, app_settings)
    current_settings = weather_service.get_settings()
    runs = service.recent_runs()
    return [
        {
            "id": run.id,
            "zone_id": run.zone_id,
            "schedule_id": run.schedule_id,
            "trigger_type": run.trigger_type,
            "source_type": run.source_type,
            "occurrence_key": run.occurrence_key,
            "status": run.status,
            "scheduled_for": f"{run.scheduled_for}T{run.scheduled_time}" if run.scheduled_for and run.scheduled_time else None,
            "requested_duration_minutes": run.requested_duration_minutes,
            "sequence_group_id": run.sequence_group_id,
            "sequence_order": run.sequence_order,
            "started_at": run.started_at,
            "finished_at": run.finished_at,
            "duration_seconds": run.duration_seconds,
            "stop_requested": run.stop_requested,
            "reason": run.reason,
            "planning_reason": run.planning_reason,
            "execution_reason": run.execution_reason,
            "created_at": run.created_at,
            "weather_decisions": [
                {
                    "id": decision.id,
                    "decision": decision.decision,
                    "reason": decision.reason,
                    "reason_human": weather_service.humanize_reason(
                        decision=decision.decision,
                        raw_reason=decision.reason,
                        probability_max=decision.precipitation_probability_max,
                        precipitation_sum_mm=decision.precipitation_sum_mm,
                        probability_threshold=current_settings.weather_probability_threshold,
                        precipitation_threshold_mm=current_settings.weather_precipitation_mm_threshold,
                        fail_mode=current_settings.weather_fail_mode,
                        enabled=current_settings.weather_enabled,
                    ),
                    "checked_at": decision.checked_at,
                    "precipitation_probability_max": decision.precipitation_probability_max,
                    "precipitation_sum_mm": decision.precipitation_sum_mm,
                }
                for decision in run.weather_decisions
            ],
        }
        for run in runs
    ]


@router.get("/gpio/events", response_model=list[GpioEventResponse])
def list_gpio_events(db: Session = Depends(get_db)) -> list[GpioEventResponse]:
    events = GpioEventRepository(db).list_recent(limit=100)
    return [GpioEventResponse.model_validate(event, from_attributes=True) for event in events]


@router.get("/settings", response_model=SettingsResponse)
def get_settings_endpoint(db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> SettingsResponse:
    entity = WeatherService(db, app_settings).get_settings()
    return SettingsResponse.model_validate(entity, from_attributes=True)


@router.put("/settings", response_model=SettingsResponse)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db), app_settings: Settings = Depends(get_app_settings)) -> SettingsResponse:
    entity = WeatherService(db, app_settings).update_settings(payload.model_dump())
    return SettingsResponse.model_validate(entity, from_attributes=True)
