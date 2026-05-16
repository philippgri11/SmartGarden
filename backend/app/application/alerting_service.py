from __future__ import annotations

import logging
import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

from sqlalchemy.orm import Session

from app.config import Settings
from app.infrastructure.db import orm
from app.infrastructure.db.repositories import SystemAlertRepository


logger = logging.getLogger(__name__)


class AlertingService:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings
        self.alerts = SystemAlertRepository(session)

    def record_and_notify(
        self,
        *,
        fingerprint: str,
        severity: str,
        title: str,
        message: str,
        component: str,
        now: datetime | None = None,
    ) -> orm.SystemAlert:
        timestamp = now or datetime.now(UTC)
        alert = self.alerts.record(
            fingerprint=fingerprint,
            severity=severity,
            title=title,
            message=message,
            component=component,
            now=timestamp,
        )
        if self._should_notify(alert, timestamp):
            if self._send_mail(title=title, message=message, severity=severity, component=component):
                alert.last_notified_at = timestamp
                self.session.flush()
        return alert

    def _should_notify(self, alert: orm.SystemAlert, now: datetime) -> bool:
        if not self._mail_configured():
            return False
        if alert.last_notified_at is None:
            return True
        last_notified = alert.last_notified_at
        if last_notified.tzinfo is None:
            last_notified = last_notified.replace(tzinfo=UTC)
        cooldown = timedelta(minutes=max(1, self.settings.watchdog_alert_cooldown_minutes))
        return now - last_notified >= cooldown

    def _mail_configured(self) -> bool:
        return bool(self.settings.smtp_host and self.settings.smtp_from and self._recipients())

    def _recipients(self) -> list[str]:
        return [item.strip() for item in self.settings.watchdog_alert_recipients.split(",") if item.strip()]

    def _send_mail(self, *, title: str, message: str, severity: str, component: str) -> bool:
        if not self._mail_configured():
            logger.warning("watchdog alert mail not configured", extra={"title": title})
            return False
        recipients = self._recipients()
        email = EmailMessage()
        email["From"] = self.settings.smtp_from
        email["To"] = ", ".join(recipients)
        email["Subject"] = f"[SmartGarden {severity.upper()}] {title}"
        email.set_content(f"Komponente: {component}\nSchweregrad: {severity}\n\n{message}\n")
        try:
            with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=10) as smtp:
                if self.settings.smtp_use_tls:
                    smtp.starttls()
                if self.settings.smtp_username:
                    smtp.login(self.settings.smtp_username, self.settings.smtp_password or "")
                smtp.send_message(email)
            return True
        except Exception:  # noqa: BLE001
            logger.exception("failed to send watchdog alert mail", extra={"title": title, "recipients": recipients})
            return False
