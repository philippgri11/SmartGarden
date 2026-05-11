from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.infrastructure.db import orm
from app.infrastructure.db.repositories import GpioEventRepository, ZoneRepository


class GpioStateService:
    def __init__(self, session: Session):
        self.session = session
        self.zones = ZoneRepository(session)
        self.events = GpioEventRepository(session)

    def record_state(self, *, zone_id: int, state: bool, source: str, reason: str | None = None) -> None:
        changed_at = datetime.now(timezone.utc)
        self.session.execute(
            update(orm.Zone)
            .where(orm.Zone.id == zone_id)
            .values(last_known_gpio_state=state, last_gpio_changed_at=changed_at)
        )
        self.events.create(zone_id=zone_id, state=state, source=source, reason=reason)
        self.session.flush()

    def record_all_off(self, *, source: str, reason: str | None = None) -> None:
        changed_at = datetime.now(timezone.utc)
        for zone in self.zones.list():
            self.session.execute(
                update(orm.Zone)
                .where(orm.Zone.id == zone.id)
                .values(last_known_gpio_state=False, last_gpio_changed_at=changed_at)
            )
            self.events.create(zone_id=zone.id, state=False, source=source, reason=reason)
        self.session.flush()
