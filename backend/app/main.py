from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes_health import router as health_router
from app.api.routes_maps import router as maps_router
from app.api.routes_metrics import router as metrics_router
from app.api.routes_runtime import router as runtime_router
from app.api.routes_schedules import router as schedules_router
from app.api.routes_watering import router as watering_router
from app.api.routes_zones import router as zones_router
from app.config import get_settings
from app.logging_config import configure_logging


settings = get_settings()
configure_logging(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(title="Irrigation Control API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(metrics_router)
app.include_router(zones_router, prefix=settings.api_prefix)
app.include_router(schedules_router, prefix=settings.api_prefix)
app.include_router(watering_router, prefix=settings.api_prefix)
app.include_router(maps_router, prefix=settings.api_prefix)
app.include_router(runtime_router, prefix=settings.api_prefix)
