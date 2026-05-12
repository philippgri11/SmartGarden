from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_app_settings, get_db
from app.application.runtime_service import RuntimeService
from app.application.schemas import (
    ZoneCreate,
    ZoneAdaptivePlanRequest,
    ZoneAdaptivePlanResponse,
    ZoneAssistantTranscriptionRequest,
    ZoneAssistantTranscriptionResponse,
    ZoneProfileAdjustmentRequest,
    ZoneProfileSuggestionRequest,
    ZoneProfileSuggestionResponse,
    ZoneResponse,
    ZoneUpdate,
)
from app.application.zone_profile_service import ZoneProfileService
from app.application.zone_service import ZoneService
from app.config import Settings


router = APIRouter(prefix="/zones", tags=["zones"])


@router.post("/assistant/suggest", response_model=ZoneProfileSuggestionResponse)
def suggest_zone_profile(
    payload: ZoneProfileSuggestionRequest,
    db: Session = Depends(get_db),
    app_settings: Settings = Depends(get_app_settings),
) -> ZoneProfileSuggestionResponse:
    return ZoneProfileService(db, app_settings).suggest(payload.description, payload.current_profile)


@router.post("/{zone_id}/assistant/adjust", response_model=ZoneProfileSuggestionResponse)
def adjust_zone_profile(
    zone_id: int,
    payload: ZoneProfileAdjustmentRequest,
    db: Session = Depends(get_db),
    app_settings: Settings = Depends(get_app_settings),
) -> ZoneProfileSuggestionResponse:
    zone = ZoneService(db).zones.get(zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="zone not found")
    return ZoneProfileService(db, app_settings).adjust_zone(zone, payload)


@router.post("/assistant/adaptive-plan", response_model=ZoneAdaptivePlanResponse)
def suggest_adaptive_plan(
    payload: ZoneAdaptivePlanRequest,
    db: Session = Depends(get_db),
    app_settings: Settings = Depends(get_app_settings),
) -> ZoneAdaptivePlanResponse:
    return ZoneProfileService(db, app_settings).suggest_adaptive_plan(
        description=payload.description,
        profile=payload.profile,
        max_duration_minutes=payload.max_duration_minutes,
    )


@router.post("/assistant/transcribe", response_model=ZoneAssistantTranscriptionResponse)
def transcribe_zone_audio(
    payload: ZoneAssistantTranscriptionRequest,
    db: Session = Depends(get_db),
    app_settings: Settings = Depends(get_app_settings),
) -> ZoneAssistantTranscriptionResponse:
    try:
        return ZoneProfileService(db, app_settings).transcribe_audio(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=list[ZoneResponse])
def list_zones(
    db: Session = Depends(get_db),
    app_settings: Settings = Depends(get_app_settings),
) -> list[ZoneResponse]:
    service = RuntimeService(db, app_settings)
    return [ZoneResponse.model_validate(item) for item in service.list_areas()]


@router.post("", response_model=ZoneResponse, status_code=status.HTTP_201_CREATED)
def create_zone(
    payload: ZoneCreate,
    db: Session = Depends(get_db),
    app_settings: Settings = Depends(get_app_settings),
) -> ZoneResponse:
    zone = ZoneService(db).create_zone(payload)
    area_snapshot = RuntimeService(db, app_settings).area_snapshots_by_zone_id().get(zone.id)
    return ZoneResponse.model_validate(area_snapshot)


@router.put("/{zone_id}", response_model=ZoneResponse)
def update_zone(
    zone_id: int,
    payload: ZoneUpdate,
    db: Session = Depends(get_db),
    app_settings: Settings = Depends(get_app_settings),
) -> ZoneResponse:
    zone = ZoneService(db).update_zone(zone_id, payload)
    if not zone:
        raise HTTPException(status_code=404, detail="zone not found")
    area_snapshot = RuntimeService(db, app_settings).area_snapshots_by_zone_id().get(zone.id)
    return ZoneResponse.model_validate(area_snapshot)


@router.delete("/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_zone(zone_id: int, db: Session = Depends(get_db)) -> Response:
    deleted = ZoneService(db).delete_zone(zone_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="zone not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
