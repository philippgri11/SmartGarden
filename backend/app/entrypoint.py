from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Sequence

from sqlalchemy import create_engine, text

from app.config import get_settings
from app.seed_local import seed_local_data


def run_migrations() -> None:
    settings = get_settings()
    lock_key = settings.scheduler_lock_key + 1000
    engine = create_engine(settings.resolved_database_url, future=True, isolation_level="AUTOCOMMIT")

    with engine.connect() as connection:
        connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": lock_key})
        try:
            subprocess.run(["alembic", "upgrade", "head"], check=True)
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": lock_key})


def exec_process(command: Sequence[str]) -> None:
    os.execvp(command[0], list(command))


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: python -m app.entrypoint [api|worker|watchdog|seed-local]")

    target = sys.argv[1]
    run_migrations()

    if target == "api":
        exec_process(["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"])
    if target == "worker":
        exec_process([sys.executable, "-m", "app.worker"])
    if target == "watchdog":
        exec_process([sys.executable, "-m", "app.watchdog"])
    if target == "seed-local":
        seed_local_data()
        return

    raise SystemExit(f"unknown entrypoint target: {target}")


if __name__ == "__main__":
    main()
