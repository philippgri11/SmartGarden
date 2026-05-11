from app.config import get_settings
from app.logging_config import configure_logging
from app.infrastructure.scheduler.runner import SchedulerRunner


def main() -> None:
    settings = get_settings()
    configure_logging(settings)
    SchedulerRunner().run_forever()


if __name__ == "__main__":
    main()

