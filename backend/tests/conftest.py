from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_app_settings, get_db
from app.config import Settings
from app.infrastructure.db.base import Base
from app.main import app


TEST_SETTINGS = Settings(
    environment="test",
    database_url="sqlite+pysqlite:///:memory:",
    frontend_origin="http://localhost:8080",
    gpio_mode="simulated",
    scheduler_enabled=False,
)


@pytest.fixture()
def db_engine():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record) -> None:  # type: ignore[no-untyped-def]
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    try:
        yield engine
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture()
def db_session(db_engine) -> Generator[Session, None, None]:
    testing_session_local = sessionmaker(
        bind=db_engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        class_=Session,
    )
    session = testing_session_local()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_engine) -> Generator[TestClient, None, None]:
    testing_session_local = sessionmaker(
        bind=db_engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        class_=Session,
    )

    def override_get_db() -> Generator[Session, None, None]:
        session = testing_session_local()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_app_settings] = lambda: TEST_SETTINGS

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def create_zone_payload(name: str, gpio_line: int, *, active: bool = True, default_minutes: int = 5) -> dict:
    return {
        "name": name,
        "description": f"{name} Beschreibung",
        "gpio_chip": "/dev/gpiochip0",
        "gpio_line": gpio_line,
        "active": active,
        "default_manual_duration_minutes": default_minutes,
        "max_duration_minutes": max(default_minutes, 10),
        "weather_enabled": False,
        "weather_probability_threshold": None,
        "weather_precipitation_mm_threshold": None,
    }
