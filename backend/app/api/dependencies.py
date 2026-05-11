from collections.abc import Generator

from fastapi import Depends
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.infrastructure.db.session import get_db_session


def get_db(session: Session = Depends(get_db_session)) -> Generator[Session, None, None]:
    yield session


def get_app_settings() -> Settings:
    return get_settings()

