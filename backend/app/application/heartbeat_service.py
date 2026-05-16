from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.infrastructure.db import orm
from app.infrastructure.db.repositories import SystemHeartbeatRepository


class HeartbeatService:
    def __init__(self, session: Session):
        self.heartbeats = SystemHeartbeatRepository(session)

    def beat(self, *, component: str, status: str = "ok", details: dict | None = None, now: datetime | None = None) -> orm.SystemHeartbeat:
        timestamp = now or datetime.now(UTC)
        return self.heartbeats.beat(component=component, status=status, details=details, now=timestamp)

    def get(self, component: str) -> orm.SystemHeartbeat | None:
        return self.heartbeats.get(component)

    def list(self) -> list[orm.SystemHeartbeat]:
        return self.heartbeats.list()
