from __future__ import annotations

import logging
import subprocess
import time

from app.infrastructure.db.orm import Zone
from app.infrastructure.gpio.base import GpioAdapter


logger = logging.getLogger(__name__)


class RealGpioAdapter(GpioAdapter):
    def __init__(self, *, active_low: bool = False, settle_seconds: float = 0.1) -> None:
        self.active_low = active_low
        self.settle_seconds = settle_seconds
        self._state: dict[int, bool] = {}
        self._zone_lines: dict[int, tuple[str, int]] = {}
        self._line_processes: dict[tuple[str, int], subprocess.Popen] = {}
        self._line_states: dict[tuple[str, int], bool] = {}

    def initialize(self, zones: list[Zone]) -> None:
        for zone in zones:
            self._state[zone.id] = False
            self._zone_lines[zone.id] = self._line_key(zone)
        logger.info("real gpio adapter initialized", extra={"zone_count": len(zones), "active_low": self.active_low})

    def activate_zone(self, zone: Zone) -> None:
        self._apply_zone_state(zone, True)
        self._state[zone.id] = True
        logger.info("real gpio activated", extra={"zone_id": zone.id, "gpio_chip": zone.gpio_chip, "gpio_line": zone.gpio_line})

    def deactivate_zone(self, zone: Zone) -> None:
        current_key = self._line_key(zone)
        previous_key = self._zone_lines.get(zone.id)
        self._apply_line_state(current_key, False, zone_id=zone.id)
        if previous_key and previous_key != current_key:
            self._apply_line_state(previous_key, False, zone_id=zone.id)
        self._zone_lines[zone.id] = current_key
        self._state[zone.id] = False
        logger.info("real gpio deactivated", extra={"zone_id": zone.id, "gpio_chip": zone.gpio_chip, "gpio_line": zone.gpio_line})

    def deactivate_all(self, zones: list[Zone]) -> None:
        for zone in zones:
            self.deactivate_zone(zone)
            self._state[zone.id] = False
        for key in list(self._line_processes):
            if self._line_states.get(key) is True:
                self._apply_line_state(key, False, zone_id=None)
        logger.warning("real gpio deactivate all", extra={"zone_count": len(zones)})

    def get_zone_state(self, zone: Zone) -> bool:
        return self._state.get(zone.id, False)

    def _apply_zone_state(self, zone: Zone, active: bool) -> None:
        key = self._line_key(zone)
        previous_key = self._zone_lines.get(zone.id)
        if previous_key and previous_key != key:
            self._apply_line_state(previous_key, False, zone_id=zone.id)
        self._apply_line_state(key, active, zone_id=zone.id)
        self._zone_lines[zone.id] = key

    def _apply_line_state(self, key: tuple[str, int], active: bool, *, zone_id: int | None) -> None:
        current = self._line_processes.get(key)
        if current is not None and current.poll() is None and self._line_states.get(key) == active:
            return
        self._stop_process(key)
        chip, line = key
        command = [
            "gpioset",
            "--chip",
            chip,
            "--consumer",
            f"smartgarden-zone-{zone_id}" if zone_id is not None else "smartgarden",
        ]
        if self.active_low:
            command.append("--active-low")
        command.append(f"{line}={'active' if active else 'inactive'}")
        try:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        except FileNotFoundError as exc:
            raise RuntimeError("gpioset is not installed in the irrigation container") from exc
        time.sleep(self.settle_seconds)
        if process.poll() is not None:
            _, stderr = process.communicate()
            raise RuntimeError(f"gpioset failed for {chip} line {line}: {stderr.strip() or 'unknown error'}")
        self._line_processes[key] = process
        self._line_states[key] = active

    def _stop_process(self, key: tuple[str, int]) -> None:
        process = self._line_processes.pop(key, None)
        self._line_states.pop(key, None)
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)

    @staticmethod
    def _line_key(zone: Zone) -> tuple[str, int]:
        return zone.gpio_chip, int(zone.gpio_line)
