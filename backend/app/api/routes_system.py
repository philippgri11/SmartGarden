from fastapi import APIRouter, Depends

from app.api.dependencies import get_app_settings
from app.application.kubernetes_status_service import KubernetesStatusService
from app.application.schemas import SystemPodsResponse
from app.config import Settings


router = APIRouter(prefix="/system", tags=["system"])


@router.get("/pods", response_model=SystemPodsResponse)
def get_system_pods(app_settings: Settings = Depends(get_app_settings)) -> SystemPodsResponse:
    return SystemPodsResponse.model_validate(KubernetesStatusService(app_settings).snapshot())
