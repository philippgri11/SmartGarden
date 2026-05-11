from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.application.schedule_service import ScheduleService
from app.application.schemas import ScheduleCreate, ScheduleResponse, ScheduleUpdate
from app.domain.services import parse_weekdays


router = APIRouter(prefix="/schedules", tags=["schedules"])


def _to_response(entity) -> ScheduleResponse:
    return ScheduleResponse(
        id=entity.id,
        zone_id=entity.zone_id,
        active=entity.active,
        weekdays=sorted(parse_weekdays(entity.weekdays)),
        start_time=entity.start_time,
        duration_minutes=entity.duration_minutes,
        interval_hours=entity.interval_hours,
        window_start=entity.window_start,
        window_end=entity.window_end,
        weather_enabled=entity.weather_enabled,
        weather_probability_threshold=entity.weather_probability_threshold,
        weather_precipitation_mm_threshold=entity.weather_precipitation_mm_threshold,
        created_at=entity.created_at,
        updated_at=entity.updated_at,
    )


@router.get("", response_model=list[ScheduleResponse])
def list_schedules(db: Session = Depends(get_db)) -> list[ScheduleResponse]:
    return [_to_response(item) for item in ScheduleService(db).list_schedules()]


@router.post("", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(payload: ScheduleCreate, db: Session = Depends(get_db)) -> ScheduleResponse:
    try:
        entity = ScheduleService(db).create_schedule(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(entity)


@router.put("/{schedule_id}", response_model=ScheduleResponse)
def update_schedule(schedule_id: int, payload: ScheduleUpdate, db: Session = Depends(get_db)) -> ScheduleResponse:
    entity = ScheduleService(db).update_schedule(schedule_id, payload)
    if not entity:
        raise HTTPException(status_code=404, detail="schedule not found")
    return _to_response(entity)


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(schedule_id: int, db: Session = Depends(get_db)) -> Response:
    deleted = ScheduleService(db).delete_schedule(schedule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="schedule not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

