from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_app_settings, get_db
from app.application.map_service import MapService
from app.application.schemas import (
    GardenMapCreate,
    GardenMapResponse,
    GardenMapUpdate,
    GardenMapViewResponse,
    ZoneMapShapeCreate,
    ZoneMapShapeResponse,
    ZoneMapShapeUpdate,
    ZoneMapShapeViewResponse,
)
from app.config import Settings


router = APIRouter(prefix="/maps", tags=["maps"])


@router.get("", response_model=list[GardenMapResponse])
def list_maps(db: Session = Depends(get_db)) -> list[GardenMapResponse]:
    return [GardenMapResponse.model_validate(entity, from_attributes=True) for entity in MapService(db).list_maps()]


@router.post("", response_model=GardenMapResponse, status_code=status.HTTP_201_CREATED)
def create_map(payload: GardenMapCreate, db: Session = Depends(get_db)) -> GardenMapResponse:
    entity = MapService(db).create_map(payload)
    return GardenMapResponse.model_validate(entity, from_attributes=True)


@router.put("/{map_id}", response_model=GardenMapResponse)
def update_map(map_id: int, payload: GardenMapUpdate, db: Session = Depends(get_db)) -> GardenMapResponse:
    try:
        entity = MapService(db).update_map(map_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not entity:
        raise HTTPException(status_code=404, detail="garden map not found")
    return GardenMapResponse.model_validate(entity, from_attributes=True)


@router.delete("/{map_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_map(map_id: int, db: Session = Depends(get_db)) -> Response:
    deleted = MapService(db).delete_map(map_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="garden map not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{map_id}/view", response_model=GardenMapViewResponse)
def get_map_view(
    map_id: int,
    db: Session = Depends(get_db),
    app_settings: Settings = Depends(get_app_settings),
) -> GardenMapViewResponse:
    try:
        entity, shapes = MapService(db, app_settings).get_map_view(map_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return GardenMapViewResponse(
        map=GardenMapResponse.model_validate(entity, from_attributes=True),
        shapes=[ZoneMapShapeViewResponse.model_validate(shape) for shape in shapes],
    )


@router.post("/shapes", response_model=ZoneMapShapeResponse, status_code=status.HTTP_201_CREATED)
def create_shape(payload: ZoneMapShapeCreate, db: Session = Depends(get_db)) -> ZoneMapShapeResponse:
    try:
        entity = MapService(db).create_shape(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ZoneMapShapeResponse.model_validate(entity, from_attributes=True)


@router.put("/shapes/{shape_id}", response_model=ZoneMapShapeResponse)
def update_shape(shape_id: int, payload: ZoneMapShapeUpdate, db: Session = Depends(get_db)) -> ZoneMapShapeResponse:
    try:
        entity = MapService(db).update_shape(shape_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not entity:
        raise HTTPException(status_code=404, detail="shape not found")
    return ZoneMapShapeResponse.model_validate(entity, from_attributes=True)


@router.delete("/shapes/{shape_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shape(shape_id: int, db: Session = Depends(get_db)) -> Response:
    deleted = MapService(db).delete_shape(shape_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="shape not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
