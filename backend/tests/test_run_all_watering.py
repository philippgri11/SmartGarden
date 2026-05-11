from datetime import UTC, datetime, timedelta

from app.application.runtime_service import RuntimeService
from app.application.watering_service import WateringService
from app.config import Settings
from app.domain.models import RunStatus, TriggerType
from app.infrastructure.db import orm
from app.infrastructure.gpio.simulated import SimulatedGpioAdapter


TEST_SETTINGS = Settings(
    environment="test",
    database_url="sqlite+pysqlite:///:memory:",
    frontend_origin="http://localhost:8080",
    gpio_mode="simulated",
    scheduler_enabled=False,
)


def build_zone(name: str, gpio_line: int, default_minutes: int) -> orm.Zone:
    return orm.Zone(
        name=name,
        description=f"{name} Beschreibung",
        gpio_chip="/dev/gpiochip0",
        gpio_line=gpio_line,
        active=True,
        default_manual_duration_minutes=default_minutes,
        max_duration_minutes=max(default_minutes, 10),
        weather_enabled=False,
        last_known_gpio_state=False,
    )


def test_run_all_sequence_uses_latest_map_shape_order_and_appends_unmapped_areas(db_session) -> None:
    teich = build_zone("Teich", 1, 4)
    terrasse = build_zone("Terrasse", 2, 3)
    rasen = build_zone("Rasenfläche", 3, 8)
    db_session.add_all([teich, terrasse, rasen])
    db_session.flush()

    garden_map = orm.GardenMap(name="Gartenplan", width=1200, height=800)
    db_session.add(garden_map)
    db_session.flush()
    db_session.add_all(
        [
            orm.ZoneMapShape(garden_map_id=garden_map.id, zone_id=terrasse.id, name="Terrasse", geometry_json={"type": "Feature", "geometry": {"type": "Polygon", "coordinates": []}, "properties": {}}),
            orm.ZoneMapShape(garden_map_id=garden_map.id, zone_id=teich.id, name="Teich", geometry_json={"type": "Feature", "geometry": {"type": "Polygon", "coordinates": []}, "properties": {}}),
        ]
    )
    db_session.commit()

    service = WateringService(db_session, TEST_SETTINGS, SimulatedGpioAdapter())
    sequence_group_id, queued_count, skipped_count = service.create_run_all_sequence()

    runs = list(
        db_session.query(orm.WateringRun)
        .filter(orm.WateringRun.sequence_group_id == sequence_group_id)
        .order_by(orm.WateringRun.sequence_order.asc())
        .all()
    )

    assert queued_count == 3
    assert skipped_count == 0
    assert [run.zone_id for run in runs] == [terrasse.id, teich.id, rasen.id]
    assert [run.requested_duration_minutes for run in runs] == [3, 4, 8]


def test_run_all_sequence_marks_conflicting_scheduled_runs_as_skipped(db_session) -> None:
    zone = build_zone("Teich", 1, 4)
    db_session.add(zone)
    db_session.flush()
    schedule = orm.Schedule(
        zone_id=zone.id,
        active=True,
        weekdays="mon",
        start_time=(datetime.now(UTC) + timedelta(minutes=2)).time().replace(microsecond=0),
        duration_minutes=2,
        interval_hours=None,
        window_start=None,
        window_end=None,
        weather_enabled=False,
    )
    db_session.add(schedule)
    db_session.flush()

    scheduled_run = orm.WateringRun(
        zone_id=zone.id,
        schedule_id=schedule.id,
        trigger_type=TriggerType.SCHEDULED.value,
        status=RunStatus.PLANNED.value,
        requested_duration_minutes=2,
        scheduled_for=datetime.now(UTC).date(),
        scheduled_time=(datetime.now(UTC) + timedelta(minutes=2)).time().replace(microsecond=0),
    )
    db_session.add(scheduled_run)
    db_session.commit()

    service = WateringService(db_session, TEST_SETTINGS, SimulatedGpioAdapter())
    sequence_group_id, _, skipped_count = service.create_run_all_sequence()
    db_session.refresh(scheduled_run)

    assert skipped_count == 1
    assert scheduled_run.status == RunStatus.SKIPPED.value
    assert scheduled_run.sequence_group_id == sequence_group_id
    assert "Gesamtbewässerung" in (scheduled_run.reason or "")


def test_runtime_summary_exposes_manual_sequence_progress(db_session) -> None:
    zone = build_zone("Rasenfläche", 3, 5)
    db_session.add(zone)
    db_session.commit()

    service = WateringService(db_session, TEST_SETTINGS, SimulatedGpioAdapter())
    sequence_group_id, _, _ = service.create_run_all_sequence()
    run = db_session.query(orm.WateringRun).filter(orm.WateringRun.sequence_group_id == sequence_group_id).one()
    run.status = RunStatus.RUNNING.value
    run.started_at = datetime.now(UTC)
    db_session.commit()

    summary = RuntimeService(db_session, TEST_SETTINGS).snapshot()["summary"]

    assert summary["manual_sequence_active"] is True
    assert summary["manual_sequence_current_area_name"] == "Rasenfläche"
    assert summary["headline"] == "Gesamtbewässerung läuft"
