from __future__ import annotations

import logging
import time

from app.application.watchdog_service import WatchdogService
from app.config import get_settings
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.gpio.factory import build_gpio_adapter
from app.logging_config import configure_logging


logger = logging.getLogger(__name__)


def main() -> None:
    settings = get_settings()
    configure_logging(settings)
    if not settings.watchdog_enabled:
        logger.info("watchdog disabled by configuration")
        return
    gpio = build_gpio_adapter(settings)
    logger.info("watchdog started", extra={"poll_seconds": settings.watchdog_poll_seconds})
    while True:
        session = SessionLocal()
        try:
            WatchdogService(session, settings, gpio).tick()
        except Exception:  # noqa: BLE001
            logger.exception("watchdog tick failed")
            session.rollback()
        finally:
            session.close()
        time.sleep(settings.watchdog_poll_seconds)


if __name__ == "__main__":
    main()
