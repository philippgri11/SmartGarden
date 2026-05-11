from __future__ import annotations

from datetime import datetime, time
from typing import Literal

from pydantic import BaseModel, Field, field_validator


AreaStatus = Literal["disabled", "active", "watering", "scheduled-soon", "paused", "error"]
AreaRunState = Literal["idle", "queued", "running", "stopping"]
WeatherOverviewDecision = Literal["allow", "skip", "error", "inactive", "unknown"]
WeatherOverviewSourceStatus = Literal["fresh", "stale", "unavailable"]


class ZoneCreate(BaseModel):
    name: str
    description: str | None = None
    gpio_chip: str = "/dev/gpiochip0"
    gpio_line: int
    active: bool = True
    default_manual_duration_minutes: int = Field(default=5, ge=1, le=240)
    max_duration_minutes: int = Field(default=10, ge=1, le=240)
    weather_enabled: bool = False
    weather_probability_threshold: int | None = Field(default=None, ge=0, le=100)
    weather_precipitation_mm_threshold: float | None = Field(default=None, ge=0)


class ZoneUpdate(ZoneCreate):
    pass


class AreaRuntimeResponse(ZoneCreate):
    id: int
    created_at: datetime
    updated_at: datetime
    status: AreaStatus
    run_state: AreaRunState
    running: bool = False
    current_run_id: int | None = None
    current_run_status: str | None = None
    current_run_started_at: datetime | None = None
    current_run_requested_duration_minutes: int | None = None
    current_run_remaining_seconds: int | None = None
    current_run_stop_requested: bool = False
    last_known_gpio_state: bool = False
    last_gpio_changed_at: datetime | None = None
    next_watering_at: datetime | None = None
    last_watering_at: datetime | None = None
    last_run_status: str | None = None
    last_weather_decision: str | None = None
    last_weather_reason: str | None = None
    weather_decision_effective: bool = False
    weather_decision: WeatherOverviewDecision | None = None
    weather_reason_human: str | None = None
    weather_snapshot: "WeatherOverviewResponse | None" = None
    manual_start_allowed: bool = False
    manual_start_block_reason: str | None = None
    active_shape_count: int = 0

    model_config = {"from_attributes": True}


class ZoneResponse(AreaRuntimeResponse):
    pass


class ScheduleCreate(BaseModel):
    zone_id: int
    active: bool = True
    weekdays: list[str]
    start_time: time
    duration_minutes: int = Field(ge=1, le=240)
    interval_hours: int | None = Field(default=None, ge=1, le=24)
    window_start: time | None = None
    window_end: time | None = None
    weather_enabled: bool = False
    weather_probability_threshold: int | None = Field(default=None, ge=0, le=100)
    weather_precipitation_mm_threshold: float | None = Field(default=None, ge=0)


class ScheduleUpdate(ScheduleCreate):
    pass


class ScheduleResponse(BaseModel):
    id: int
    zone_id: int
    active: bool
    weekdays: list[str]
    start_time: time
    duration_minutes: int
    interval_hours: int | None
    window_start: time | None
    window_end: time | None
    weather_enabled: bool
    weather_probability_threshold: int | None
    weather_precipitation_mm_threshold: float | None
    created_at: datetime
    updated_at: datetime


class ManualRunCreate(BaseModel):
    duration_minutes: int = Field(default=5, ge=1, le=240)
    reason: str | None = None


class WateringRunResponse(BaseModel):
    id: int
    zone_id: int
    schedule_id: int | None
    trigger_type: Literal["manual", "scheduled"]
    status: str
    scheduled_for: datetime | None = None
    requested_duration_minutes: int
    sequence_group_id: str | None = None
    sequence_order: int | None = None
    started_at: datetime | None
    finished_at: datetime | None
    duration_seconds: int | None
    stop_requested: bool
    reason: str | None
    created_at: datetime


class WeatherDecisionResponse(BaseModel):
    id: int
    watering_run_id: int
    checked_at: datetime
    latitude: float
    longitude: float
    forecast_window_hours: int
    precipitation_probability_max: float | None
    precipitation_sum_mm: float | None
    decision: str
    reason: str
    reason_human: str | None = None
    raw_response: dict | None


class WeatherOverviewResponse(BaseModel):
    weather_enabled: bool
    decision: WeatherOverviewDecision
    headline: str
    summary_text: str
    current_condition_label: str | None = None
    current_weather_code: int | None = None
    current_is_day: bool | None = None
    current_temperature_c: float | None = None
    forecast_window_hours: int
    precipitation_probability_max: float | None
    precipitation_sum_mm: float | None
    probability_threshold: int
    precipitation_threshold_mm: float
    fail_mode: Literal["allow", "deny"]
    source_status: WeatherOverviewSourceStatus
    checked_at: datetime | None
    reason_human: str


class SettingsResponse(BaseModel):
    location_name: str
    postal_code: str | None
    latitude: float
    longitude: float
    weather_enabled: bool
    weather_window_hours: int
    weather_probability_threshold: int
    weather_precipitation_mm_threshold: float
    weather_fail_mode: Literal["allow", "deny"]
    winter_mode_active: bool
    winter_disable_manual_start: bool
    winter_pause_schedules: bool
    safety_shutdown_on_winter: bool
    system_paused_until: datetime | None
    safety_stop_active: bool
    safety_stop_reason: str | None

    model_config = {"from_attributes": True}


class SettingsUpdate(SettingsResponse):
    pass


class PauseSystemRequest(BaseModel):
    hours: int = Field(default=24, ge=1, le=168)


class WinterModeUpdate(BaseModel):
    active: bool
    disable_manual_start: bool = True
    pause_schedules: bool = True
    safety_shutdown: bool = True


class SystemSummaryResponse(BaseModel):
    status: Literal["ok", "running", "paused", "winter", "attention"]
    headline: str
    detail: str
    current_water_status: str
    next_watering_at: datetime | None
    weather_status: str
    weather_overview: WeatherOverviewResponse
    active_schedule_count: int
    running_zone_count: int
    winter_mode_active: bool
    safety_stop_active: bool
    system_paused_until: datetime | None
    last_run_zone_name: str | None
    last_run_finished_at: datetime | None
    last_run_status: str | None
    manual_sequence_active: bool = False
    manual_sequence_current_area_name: str | None = None
    manual_sequence_total_areas: int = 0
    manual_sequence_completed_areas: int = 0
    manual_sequence_skipped_schedule_count: int = 0
    manual_sequence_notice: str | None = None

    model_config = {"from_attributes": True}


class RuntimeSnapshotResponse(BaseModel):
    generated_at: datetime
    settings: SettingsResponse
    summary: SystemSummaryResponse
    areas: list[AreaRuntimeResponse]


class RunAllAreasResponse(BaseModel):
    message: str
    queued_run_count: int
    skipped_schedule_count: int
    sequence_group_id: str


class GpioEventResponse(BaseModel):
    id: int
    zone_id: int
    state: bool
    source: str
    reason: str | None
    created_at: datetime


class GardenMapCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    image_url: str | None = None
    width: int = Field(default=1000, ge=100, le=10000)
    height: int = Field(default=800, ge=100, le=10000)

    @field_validator("name")
    @classmethod
    def normalize_map_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name must not be empty")
        return normalized

    @field_validator("image_url")
    @classmethod
    def normalize_image_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class GardenMapUpdate(GardenMapCreate):
    pass


class GardenMapResponse(GardenMapCreate):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ZoneMapShapeCreate(BaseModel):
    garden_map_id: int
    zone_id: int
    name: str = Field(min_length=1, max_length=120)
    geometry_json: dict
    style_json: dict | None = None
    label_position_x: float | None = None
    label_position_y: float | None = None

    @field_validator("name")
    @classmethod
    def normalize_shape_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name must not be empty")
        return normalized


class ZoneMapShapeUpdate(ZoneMapShapeCreate):
    pass


class ZoneMapShapeResponse(ZoneMapShapeCreate):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ZoneMapZoneStatusResponse(AreaRuntimeResponse):
    zone_id: int


class ZoneMapShapeViewResponse(ZoneMapShapeResponse):
    zone_status: ZoneMapZoneStatusResponse


class GardenMapViewResponse(BaseModel):
    map: GardenMapResponse
    shapes: list[ZoneMapShapeViewResponse]
