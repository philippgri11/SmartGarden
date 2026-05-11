from app.config import Settings
from app.infrastructure.gpio.base import GpioAdapter
from app.infrastructure.gpio.real_gpiod import RealGpioAdapter
from app.infrastructure.gpio.simulated import SimulatedGpioAdapter


def build_gpio_adapter(settings: Settings) -> GpioAdapter:
    if settings.gpio_mode == "real":
        return RealGpioAdapter()
    return SimulatedGpioAdapter()

