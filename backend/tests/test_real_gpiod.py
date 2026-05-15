from app.infrastructure.db import orm
from app.infrastructure.gpio.real_gpiod import RealGpioAdapter


class FakeProcess:
    def __init__(self, *, returncode: int | None = None, stderr: str = "") -> None:
        self.returncode = returncode
        self.stderr = stderr
        self.terminated = False
        self.killed = False

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = -15

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    def wait(self, timeout: int | None = None) -> int | None:
        return self.returncode

    def communicate(self) -> tuple[str, str]:
        return "", self.stderr


def build_zone(*, zone_id: int = 7, chip: str = "/dev/gpiochip0", line: int = 12) -> orm.Zone:
    return orm.Zone(id=zone_id, name="Testzone", description="", gpio_chip=chip, gpio_line=line, active=True)


def test_real_gpiod_uses_gpioset_and_holds_active_low_line(monkeypatch) -> None:
    commands: list[list[str]] = []
    processes: list[FakeProcess] = []

    def fake_popen(command, stdout=None, stderr=None, text=None):  # noqa: ANN001
        commands.append(command)
        process = FakeProcess()
        processes.append(process)
        return process

    monkeypatch.setattr("app.infrastructure.gpio.real_gpiod.subprocess.Popen", fake_popen)

    zone = build_zone()
    adapter = RealGpioAdapter(active_low=True, settle_seconds=0)
    adapter.initialize([zone])
    adapter.activate_zone(zone)
    adapter.deactivate_zone(zone)

    assert commands == [
        ["gpioset", "--chip", "/dev/gpiochip0", "--consumer", "smartgarden-zone-7", "--active-low", "12=active"],
        ["gpioset", "--chip", "/dev/gpiochip0", "--consumer", "smartgarden-zone-7", "--active-low", "12=inactive"],
    ]
    assert processes[0].terminated is True
    assert adapter.get_zone_state(zone) is False


def test_real_gpiod_deactivates_previous_line_after_gpio_mapping_change(monkeypatch) -> None:
    commands: list[list[str]] = []

    def fake_popen(command, stdout=None, stderr=None, text=None):  # noqa: ANN001
        commands.append(command)
        return FakeProcess()

    monkeypatch.setattr("app.infrastructure.gpio.real_gpiod.subprocess.Popen", fake_popen)

    zone = build_zone(line=12)
    adapter = RealGpioAdapter(settle_seconds=0)
    adapter.initialize([zone])
    adapter.activate_zone(zone)
    zone.gpio_line = 13
    adapter.deactivate_zone(zone)

    assert commands[-2:] == [
        ["gpioset", "--chip", "/dev/gpiochip0", "--consumer", "smartgarden-zone-7", "13=inactive"],
        ["gpioset", "--chip", "/dev/gpiochip0", "--consumer", "smartgarden-zone-7", "12=inactive"],
    ]
