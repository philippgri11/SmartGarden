from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.schemas import ZoneCreate, ZoneUpdate
from app.domain.services import next_schedule_occurrence
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import WateringRunRepository, ZoneRepository


class ZoneService:
    def __init__(self, session: Session):
        self.session = session
        self.zones = ZoneRepository(session)
        self.runs = WateringRunRepository(session)

    def list_zones(self) -> list[dict]:
        running_zone_ids = {run.zone_id for run in self.runs.list_running()}
        now = datetime.now(UTC)
        results: list[dict] = []
        for zone in self.zones.list():
            zone_runs = list(
                self.session.scalars(
                    select(orm.WateringRun)
                    .where(orm.WateringRun.zone_id == zone.id)
                    .order_by(orm.WateringRun.created_at.desc())
                    .limit(10)
                )
            )
            last_run = next((run for run in zone_runs if run.status != "planned"), zone_runs[0] if zone_runs else None)
            next_candidates = [
                next_schedule_occurrence(schedule, now)
                for schedule in zone.schedules
                if schedule.active
            ]
            next_candidates = [candidate for candidate in next_candidates if candidate is not None]
            last_weather_decision = last_run.weather_decisions[0] if last_run and last_run.weather_decisions else None
            results.append(
                {
                    **zone.__dict__,
                    "irrigation_profile": zone.irrigation_profile_json,
                    "running": zone.id in running_zone_ids,
                    "next_watering_at": min(next_candidates) if next_candidates else None,
                    "last_watering_at": (
                        last_run.finished_at if last_run and last_run.finished_at else (last_run.started_at if last_run else None)
                    ),
                    "last_run_status": last_run.status if last_run else None,
                    "last_weather_decision": last_weather_decision.decision if last_weather_decision else None,
                    "last_weather_reason": last_weather_decision.reason if last_weather_decision else None,
                    "active_shape_count": len(zone.map_shapes),
                }
            )
        return results

    def create_zone(self, payload: ZoneCreate) -> orm.Zone:
        self._validate_gpio_mapping(payload)
        data = payload.model_dump()
        profile = data.pop("irrigation_profile", None)
        adaptive_plan = data.pop("adaptive_irrigation_plan", None)
        zone = orm.Zone(**data, irrigation_profile_json=profile, adaptive_irrigation_plan_json=adaptive_plan)
        self.zones.add(zone)
        self.session.commit()
        self.session.refresh(zone)
        return zone

    def update_zone(self, zone_id: int, payload: ZoneUpdate) -> orm.Zone | None:
        zone = self.zones.get(zone_id)
        if not zone:
            return None
        self._validate_gpio_mapping(payload, zone_id=zone_id)
        data = payload.model_dump()
        profile = data.pop("irrigation_profile", None)
        adaptive_plan = data.pop("adaptive_irrigation_plan", None)
        for key, value in data.items():
            setattr(zone, key, value)
        zone.irrigation_profile_json = profile
        zone.adaptive_irrigation_plan_json = adaptive_plan
        self.session.commit()
        self.session.refresh(zone)
        return zone

    def delete_zone(self, zone_id: int) -> bool:
        zone = self.zones.get(zone_id)
        if not zone:
            return False
        self.zones.delete(zone)
        self.session.commit()
        return True

    def _validate_gpio_mapping(self, payload: ZoneCreate, *, zone_id: int | None = None) -> None:
        if payload.gpio_line < 0 or payload.gpio_line > 53:
            raise ValueError("GPIO-Line muss auf diesem Raspberry Pi zwischen 0 und 53 liegen.")
        if not payload.active:
            return
        for existing in self.zones.list():
            if zone_id is not None and existing.id == zone_id:
                continue
            if existing.active and existing.gpio_chip == payload.gpio_chip and existing.gpio_line == payload.gpio_line:
                raise ValueError(
                    f"GPIO {payload.gpio_chip} Line {payload.gpio_line} wird bereits von Bereich '{existing.name}' verwendet."
                )
