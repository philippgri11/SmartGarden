from __future__ import annotations

from abc import ABC, abstractmethod

from app.infrastructure.db.orm import Zone


class GpioAdapter(ABC):
    @abstractmethod
    def initialize(self, zones: list[Zone]) -> None:
        raise NotImplementedError

    @abstractmethod
    def activate_zone(self, zone: Zone) -> None:
        raise NotImplementedError

    @abstractmethod
    def deactivate_zone(self, zone: Zone) -> None:
        raise NotImplementedError

    @abstractmethod
    def deactivate_all(self, zones: list[Zone]) -> None:
        raise NotImplementedError

    @abstractmethod
    def get_zone_state(self, zone: Zone) -> bool:
        raise NotImplementedError

