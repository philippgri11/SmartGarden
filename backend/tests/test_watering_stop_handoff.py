from datetime import UTC, datetime

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


class RecordingGpioAdapter(SimulatedGpioAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.deactivated_zone_ids: list[int] = []

    def deactivate_zone(self, zone: orm.Zone) -> None:
        self.deactivated_zone_ids.append(zone.id)
        super().deactivate_zone(zone)


def test_api_stop_marks_running_run_for_scheduler_handoff(db_session) -> None:
    zone = orm.Zone(
        name="Rasen",
        description="",
        gpio_chip="/dev/gpiochip0",
        gpio_line=12,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=10,
        weather_enabled=False,
    )
    db_session.add(zone)
    db_session.flush()
    run = orm.WateringRun(
        zone_id=zone.id,
        trigger_type=TriggerType.MANUAL.value,
        status=RunStatus.RUNNING.value,
        requested_duration_minutes=5,
        started_at=datetime.now(UTC),
    )
    db_session.add(run)
    db_session.commit()

    gpio = RecordingGpioAdapter()
    service = WateringService(db_session, TEST_SETTINGS, gpio)

    assert service.request_stop_zone(zone.id) == 1
    db_session.refresh(run)
    assert run.status == RunStatus.RUNNING.value
    assert run.stop_requested is True
    assert gpio.deactivated_zone_ids == []

    service.sync_active_runs()
    db_session.refresh(run)
    assert run.status == RunStatus.CANCELLED.value
    assert gpio.deactivated_zone_ids == [zone.id]


def test_stop_all_keeps_running_runs_until_scheduler_closes_gpio(db_session) -> None:
    zone = orm.Zone(
        name="Beet",
        description="",
        gpio_chip="/dev/gpiochip0",
        gpio_line=13,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=10,
        weather_enabled=False,
    )
    db_session.add(zone)
    db_session.flush()
    running = orm.WateringRun(
        zone_id=zone.id,
        trigger_type=TriggerType.SCHEDULED.value,
        status=RunStatus.RUNNING.value,
        requested_duration_minutes=5,
        started_at=datetime.now(UTC),
    )
    planned = orm.WateringRun(
        zone_id=zone.id,
        trigger_type=TriggerType.SCHEDULED.value,
        status=RunStatus.PLANNED.value,
        requested_duration_minutes=5,
    )
    db_session.add_all([running, planned])
    db_session.commit()

    gpio = RecordingGpioAdapter()
    service = WateringService(db_session, TEST_SETTINGS, gpio)

    assert service.request_stop_all() == 2
    db_session.refresh(running)
    db_session.refresh(planned)
    assert running.status == RunStatus.RUNNING.value
    assert running.stop_requested is True
    assert planned.status == RunStatus.CANCELLED.value
    assert gpio.deactivated_zone_ids == []
