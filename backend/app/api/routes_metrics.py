from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.domain.models import RunStatus
from app.infrastructure.db import orm


router = APIRouter(tags=["metrics"])


@router.get("/metrics")
def metrics(db: Session = Depends(get_db)) -> Response:
    now = datetime.now(UTC)
    run_counts = dict(
        db.execute(
            select(orm.WateringRun.status, func.count(orm.WateringRun.id))
            .group_by(orm.WateringRun.status)
        ).all()
    )
    running_runs = int(run_counts.get(RunStatus.RUNNING.value, 0))
    planned_runs = int(run_counts.get(RunStatus.PLANNED.value, 0))
    app_settings = db.get(orm.AppSetting, 1)
    safety_stop = app_settings.safety_stop_active if app_settings else False
    heartbeats = db.execute(select(orm.SystemHeartbeat.component, orm.SystemHeartbeat.last_seen_at)).all()
    alerts_open = db.scalar(select(func.count(orm.SystemAlert.id)).where(orm.SystemAlert.resolved_at.is_(None))) or 0

    lines = [
        "# HELP irrigation_running_runs Currently running watering runs.",
        "# TYPE irrigation_running_runs gauge",
        f"irrigation_running_runs {running_runs}",
        "# HELP irrigation_planned_runs Currently planned watering runs.",
        "# TYPE irrigation_planned_runs gauge",
        f"irrigation_planned_runs {planned_runs}",
        "# HELP irrigation_safety_stop_active Safety stop state.",
        "# TYPE irrigation_safety_stop_active gauge",
        f"irrigation_safety_stop_active {1 if safety_stop else 0}",
        "# HELP irrigation_open_alerts Open watchdog alerts.",
        "# TYPE irrigation_open_alerts gauge",
        f"irrigation_open_alerts {int(alerts_open)}",
        "# HELP irrigation_component_heartbeat_age_seconds Seconds since component heartbeat.",
        "# TYPE irrigation_component_heartbeat_age_seconds gauge",
    ]
    for component, last_seen_at in heartbeats:
        last_seen = last_seen_at.replace(tzinfo=UTC) if last_seen_at.tzinfo is None else last_seen_at.astimezone(UTC)
        age = max(0, int((now - last_seen).total_seconds()))
        lines.append(f'irrigation_component_heartbeat_age_seconds{{component="{component}"}} {age}')
    return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")
