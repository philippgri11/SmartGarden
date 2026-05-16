from datetime import UTC, datetime, timedelta, time

from app.application.alerting_service import AlertingService
from app.application.heartbeat_service import HeartbeatService
from app.application.watchdog_service import WatchdogService
from app.config import Settings
from app.domain.adaptive_irrigation import ADAPTIVE_REASON_PREFIX
from app.domain.models import RunStatus, TriggerType
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import WateringRunRepository
from app.infrastructure.gpio.simulated import SimulatedGpioAdapter


def _zone(name: str = "Teich", line: int = 22) -> orm.Zone:
    return orm.Zone(
        name=name,
        description="",
        gpio_chip="/dev/gpiochip0",
        gpio_line=line,
        active=True,
        default_manual_duration_minutes=5,
        max_duration_minutes=10,
    )


def test_watchdog_triggers_safety_stop_for_duplicate_adaptive_runs(db_session) -> None:
    zone = _zone()
    db_session.add(zone)
    db_session.flush()
    runs = WateringRunRepository(db_session)
    for _ in range(2):
        runs.create_planned_run(
            zone_id=zone.id,
            schedule_id=None,
            trigger_type=TriggerType.SCHEDULED,
            duration_minutes=7,
            scheduled_for=datetime(2026, 5, 16).date(),
            scheduled_time=time(5, 36),
            reason=f"{ADAPTIVE_REASON_PREFIX} test",
        )
    db_session.commit()
    HeartbeatService(db_session).beat(component="scheduler", status="ok", now=datetime(2026, 5, 16, 6, 59, tzinfo=UTC))
    db_session.commit()

    violations = WatchdogService(db_session, Settings(environment="test", gpio_mode="simulated"), SimulatedGpioAdapter()).tick(
        now=datetime(2026, 5, 16, 7, 0, tzinfo=UTC)
    )

    assert [violation.fingerprint for violation in violations] == [f"duplicate-adaptive-{zone.id}-2026-05-16-05:36:00"]
    assert db_session.get(orm.AppSetting, 1).safety_stop_active is True
    assert all(run.status == RunStatus.CANCELLED.value for run in db_session.query(orm.WateringRun).all())
    assert db_session.query(orm.SystemAlert).one().last_notified_at is None
    assert db_session.get(orm.SystemHeartbeat, "watchdog").status == "alert"


def test_watchdog_triggers_safety_stop_for_overtime_run(db_session) -> None:
    zone = _zone()
    db_session.add(zone)
    db_session.flush()
    run = WateringRunRepository(db_session).create_planned_run(
        zone_id=zone.id,
        schedule_id=None,
        trigger_type=TriggerType.SCHEDULED,
        duration_minutes=5,
    )
    run.status = RunStatus.RUNNING.value
    run.started_at = datetime(2026, 5, 16, 5, 30, tzinfo=UTC)
    db_session.commit()

    settings = Settings(environment="test", gpio_mode="simulated", watchdog_run_safety_margin_seconds=30)
    violations = WatchdogService(db_session, settings, SimulatedGpioAdapter()).tick(now=datetime(2026, 5, 16, 5, 36, tzinfo=UTC))

    assert violations[0].fingerprint == f"run-overtime-{run.id}"
    assert run.status == RunStatus.CANCELLED.value
    assert run.duration_seconds == 360
    assert db_session.get(orm.AppSetting, 1).safety_stop_active is True


def test_watchdog_warns_for_stale_scheduler_without_open_runs(db_session) -> None:
    HeartbeatService(db_session).beat(
        component="scheduler",
        status="ok",
        now=datetime(2026, 5, 16, 5, 0, tzinfo=UTC),
    )
    db_session.commit()

    settings = Settings(environment="test", gpio_mode="simulated", scheduler_heartbeat_max_age_seconds=60)
    violations = WatchdogService(db_session, settings, SimulatedGpioAdapter()).tick(now=datetime(2026, 5, 16, 5, 2, 1, tzinfo=UTC))

    assert violations[0].fingerprint == "scheduler-heartbeat-stale"
    assert violations[0].severity == "warning"
    assert db_session.get(orm.AppSetting, 1) is None


def test_alerting_service_sends_configured_mail(db_session, monkeypatch) -> None:
    sent_messages = []

    class FakeSmtp:
        def __init__(self, host, port, timeout):
            self.host = host
            self.port = port
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return None

        def starttls(self):
            return None

        def login(self, username, password):
            sent_messages.append(("login", username, password))

        def send_message(self, message):
            sent_messages.append(("message", message))

    monkeypatch.setattr("smtplib.SMTP", FakeSmtp)
    settings = Settings(
        environment="test",
        smtp_host="smtp.example.test",
        smtp_from="smartgarden@example.test",
        smtp_username="user",
        smtp_password="secret",
        watchdog_alert_recipients="grill.wanzleben@freenet.de,philipp.grill@freenet.de",
    )

    AlertingService(db_session, settings).record_and_notify(
        fingerprint="test-alert",
        severity="critical",
        title="Testalarm",
        message="Etwas stimmt nicht.",
        component="watchdog",
        now=datetime(2026, 5, 16, 5, 0, tzinfo=UTC),
    )

    message = sent_messages[-1][1]
    assert message["To"] == "grill.wanzleben@freenet.de, philipp.grill@freenet.de"
    assert "Testalarm" in message["Subject"]
    assert db_session.query(orm.SystemAlert).one().last_notified_at == datetime(2026, 5, 16, 5, 0)


def test_alerting_service_does_not_mark_failed_mail_as_notified(db_session, monkeypatch) -> None:
    class FailingSmtp:
        def __init__(self, host, port, timeout):
            pass

        def __enter__(self):
            raise OSError("smtp unavailable")

        def __exit__(self, exc_type, exc, tb):
            return None

    monkeypatch.setattr("smtplib.SMTP", FailingSmtp)
    settings = Settings(
        environment="test",
        smtp_host="smtp.example.test",
        smtp_from="smartgarden@example.test",
        watchdog_alert_recipients="philipp.grill@freenet.de",
    )

    AlertingService(db_session, settings).record_and_notify(
        fingerprint="failed-mail",
        severity="critical",
        title="Testalarm",
        message="Etwas stimmt nicht.",
        component="watchdog",
        now=datetime(2026, 5, 16, 5, 0, tzinfo=UTC),
    )

    assert db_session.query(orm.SystemAlert).one().last_notified_at is None
