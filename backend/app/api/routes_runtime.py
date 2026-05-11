from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_app_settings, get_db
from app.application.runtime_service import RuntimeService
from app.application.schemas import RuntimeSnapshotResponse
from app.config import Settings


router = APIRouter(prefix="/runtime", tags=["runtime"])


@router.get("", response_model=RuntimeSnapshotResponse)
def get_runtime_snapshot(
    db: Session = Depends(get_db),
    app_settings: Settings = Depends(get_app_settings),
) -> RuntimeSnapshotResponse:
    snapshot = RuntimeService(db, app_settings).snapshot()
    return RuntimeSnapshotResponse.model_validate(snapshot)
