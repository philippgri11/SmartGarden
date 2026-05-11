from __future__ import annotations

import logging

from app.infrastructure.db.orm import Zone
from app.infrastructure.gpio.base import GpioAdapter


logger = logging.getLogger(__name__)


class RealGpioAdapter(GpioAdapter):
    def __init__(self) -> None:
        self._state: dict[int, bool] = {}

    def initialize(self, zones: list[Zone]) -> None:
        for zone in zones:
            self._state[zone.id] = False
        logger.warning(
            "real gpio adapter initialized in placeholder mode; implement libgpiod binding before production usage",
            extra={"zone_count": len(zones)},
        )

    def activate_zone(self, zone: Zone) -> None:
        self._state[zone.id] = True
        logger.info("real gpio activate placeholder", extra={"zone_id": zone.id, "gpio_chip": zone.gpio_chip, "gpio_line": zone.gpio_line})

    def deactivate_zone(self, zone: Zone) -> None:
        self._state[zone.id] = False
        logger.info("real gpio deactivate placeholder", extra={"zone_id": zone.id, "gpio_chip": zone.gpio_chip, "gpio_line": zone.gpio_line})

    def deactivate_all(self, zones: list[Zone]) -> None:
        for zone in zones:
            self._state[zone.id] = False
        logger.warning("real gpio deactivate all placeholder", extra={"zone_count": len(zones)})

    def get_zone_state(self, zone: Zone) -> bool:
        return self._state.get(zone.id, False)

