from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from app.application.runtime_service import RuntimeService
from app.config import Settings
from app.application.schemas import GardenMapCreate, GardenMapUpdate, ZoneMapShapeCreate, ZoneMapShapeUpdate
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import GardenMapRepository, ZoneMapShapeRepository, ZoneRepository


class MapService:
    def __init__(self, session: Session, settings: Settings | None = None):
        self.session = session
        self.maps = GardenMapRepository(session)
        self.shapes = ZoneMapShapeRepository(session)
        self.zones = ZoneRepository(session)
        self.runtime = RuntimeService(session, settings) if settings is not None else None

    def list_maps(self) -> list[orm.GardenMap]:
        return self.maps.list()

    def create_map(self, payload: GardenMapCreate) -> orm.GardenMap:
        entity = orm.GardenMap(**payload.model_dump())
        self.maps.add(entity)
        try:
            self.session.commit()
        except (DataError, IntegrityError) as exc:
            self.session.rollback()
            raise ValueError("garden map could not be stored") from exc
        self.session.refresh(entity)
        return entity

    def update_map(self, map_id: int, payload: GardenMapUpdate) -> orm.GardenMap | None:
        entity = self.maps.get(map_id)
        if not entity:
            return None
        for key, value in payload.model_dump().items():
            setattr(entity, key, value)
        try:
            self.session.commit()
        except (DataError, IntegrityError) as exc:
            self.session.rollback()
            raise ValueError("garden map could not be stored") from exc
        self.session.refresh(entity)
        return entity

    def delete_map(self, map_id: int) -> bool:
        entity = self.maps.get(map_id)
        if not entity:
            return False
        self.maps.delete(entity)
        self.session.commit()
        return True

    def create_shape(self, payload: ZoneMapShapeCreate) -> orm.ZoneMapShape:
        if not self.maps.get(payload.garden_map_id):
            raise ValueError("garden map not found")
        if not self.zones.get(payload.zone_id):
            raise ValueError("zone not found")
        entity = orm.ZoneMapShape(**payload.model_dump())
        self.shapes.add(entity)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise ValueError("shape could not be stored") from exc
        self.session.refresh(entity)
        return entity

    def update_shape(self, shape_id: int, payload: ZoneMapShapeUpdate) -> orm.ZoneMapShape | None:
        entity = self.shapes.get(shape_id)
        if not entity:
            return None
        for key, value in payload.model_dump().items():
            setattr(entity, key, value)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise ValueError("shape could not be stored") from exc
        self.session.refresh(entity)
        return entity

    def delete_shape(self, shape_id: int) -> bool:
        entity = self.shapes.get(shape_id)
        if not entity:
            return False
        self.shapes.delete(entity)
        self.session.commit()
        return True

    def get_map_view(self, map_id: int) -> tuple[orm.GardenMap, list[dict]]:
        entity = self.maps.get(map_id)
        if not entity:
            raise ValueError("garden map not found")

        shapes = self.shapes.list_by_map(map_id)
        if self.runtime is None:
            raise ValueError("map settings unavailable")
        now = datetime.now(UTC)
        app_settings = self.runtime.weather.get_settings()
        area_snapshots = self.runtime.area_snapshots_by_zone_id(now=now, app_settings=app_settings)

        shape_views: list[dict] = []
        for shape in shapes:
            area_snapshot = area_snapshots.get(shape.zone_id)
            if not area_snapshot:
                continue

            shape_views.append(
                {
                    **shape.__dict__,
                    "zone_status": {
                        **area_snapshot,
                        "zone_id": area_snapshot["id"],
                    },
                }
            )

        return entity, shape_views
