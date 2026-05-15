from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "irrigation-control"
    environment: Literal["development", "test", "production"] = "development"
    api_prefix: str = "/api"
    host: str = "0.0.0.0"
    port: int = 8000
    frontend_origin: str = "http://localhost:4200"

    database_url: str | None = None
    database_host: str = "postgres"
    database_port: int = 5432
    database_name: str = "irrigation"
    database_user: str = "postgres"
    database_password: str = Field(default="postgres", repr=False)
    sqlalchemy_echo: bool = False

    gpio_mode: Literal["simulated", "real"] = "simulated"
    gpio_safe_shutdown_on_start: bool = True
    gpio_default_chip: str = "/dev/gpiochip0"
    gpio_active_low: bool = False

    weather_enabled: bool = True
    weather_api_base_url: str = "https://api.open-meteo.com/v1/forecast"
    weather_fail_mode: Literal["allow", "deny"] = "allow"
    weather_default_window_hours: int = 6
    weather_default_probability_threshold: int = 70
    weather_default_precipitation_mm_threshold: float = 2.0
    weather_cache_ttl_minutes: int = 30
    weather_cache_stale_fallback_hours: int = 24

    openai_api_key: str | None = Field(default=None, repr=False)
    openai_model: str = "gpt-4.1-mini"
    openai_transcription_model: str = "whisper-1"
    openai_timeout_seconds: float = 20.0
    zone_assistant_use_openai: bool = True

    scheduler_enabled: bool = False
    scheduler_poll_seconds: int = 2
    scheduler_due_grace_minutes: int = 10
    scheduler_default_run_timeout_minutes: int = 60
    scheduler_lock_key: int = 420420

    max_global_concurrent_runs: int = 1

    default_latitude: float = 52.52
    default_longitude: float = 13.405

    log_level: str = "INFO"

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+psycopg://{self.database_user}:{self.database_password}"
            f"@{self.database_host}:{self.database_port}/{self.database_name}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
