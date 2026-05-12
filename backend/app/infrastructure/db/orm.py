from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.db.base import Base


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    gpio_chip: Mapped[str] = mapped_column(String(255), nullable=False, default="/dev/gpiochip0")
    gpio_line: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    default_manual_duration_minutes: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    max_duration_minutes: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    weather_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weather_probability_threshold: Mapped[int | None] = mapped_column(Integer)
    weather_precipitation_mm_threshold: Mapped[float | None] = mapped_column(Float)
    zone_profile_description: Mapped[str | None] = mapped_column(Text)
    irrigation_profile_json: Mapped[dict | None] = mapped_column(JSON)
    scheduling_mode: Mapped[str] = mapped_column(String(32), default="static", nullable=False)
    adaptive_irrigation_plan_json: Mapped[dict | None] = mapped_column(JSON)
    last_known_gpio_state: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_gpio_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    schedules: Mapped[list["Schedule"]] = relationship(back_populates="zone", cascade="all, delete-orphan", passive_deletes=True)
    runs: Mapped[list["WateringRun"]] = relationship(back_populates="zone", cascade="all, delete-orphan", passive_deletes=True)
    gpio_events: Mapped[list["GpioEvent"]] = relationship(back_populates="zone", cascade="all, delete-orphan", passive_deletes=True)
    map_shapes: Mapped[list["ZoneMapShape"]] = relationship(back_populates="zone", cascade="all, delete-orphan", passive_deletes=True)


class Schedule(Base):
    __tablename__ = "schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id", ondelete="CASCADE"), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weekdays: Mapped[str] = mapped_column(String(64), nullable=False)
    start_time: Mapped[time] = mapped_column(nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    interval_hours: Mapped[int | None] = mapped_column(Integer)
    window_start: Mapped[time | None]
    window_end: Mapped[time | None]
    weather_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weather_probability_threshold: Mapped[int | None] = mapped_column(Integer)
    weather_precipitation_mm_threshold: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    zone: Mapped["Zone"] = relationship(back_populates="schedules")
    runs: Mapped[list["WateringRun"]] = relationship(back_populates="schedule", passive_deletes=True)


class WateringRun(Base):
    __tablename__ = "watering_runs"
    __table_args__ = (UniqueConstraint("schedule_id", "scheduled_for", "scheduled_time", name="uq_watering_run_schedule_slot"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id", ondelete="CASCADE"), nullable=False)
    schedule_id: Mapped[int | None] = mapped_column(ForeignKey("schedules.id", ondelete="SET NULL"))
    trigger_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    scheduled_for: Mapped[date | None] = mapped_column(Date)
    scheduled_time: Mapped[time | None]
    requested_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    sequence_group_id: Mapped[str | None] = mapped_column(String(64))
    sequence_order: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    stop_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    zone: Mapped["Zone"] = relationship(back_populates="runs")
    schedule: Mapped["Schedule"] = relationship(back_populates="runs")
    weather_decisions: Mapped[list["WeatherDecision"]] = relationship(back_populates="watering_run", cascade="all, delete-orphan", passive_deletes=True)


class WeatherDecision(Base):
    __tablename__ = "weather_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    watering_run_id: Mapped[int] = mapped_column(ForeignKey("watering_runs.id", ondelete="CASCADE"), nullable=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    forecast_window_hours: Mapped[int] = mapped_column(Integer, nullable=False)
    precipitation_probability_max: Mapped[float | None] = mapped_column(Float)
    precipitation_sum_mm: Mapped[float | None] = mapped_column(Float)
    decision: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    raw_response: Mapped[dict | None] = mapped_column(JSON)

    watering_run: Mapped["WateringRun"] = relationship(back_populates="weather_decisions")


class AppSetting(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    location_name: Mapped[str] = mapped_column(String(160), default="Mein Garten", nullable=False)
    postal_code: Mapped[str | None] = mapped_column(String(32))
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    weather_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weather_window_hours: Mapped[int] = mapped_column(Integer, default=6, nullable=False)
    weather_probability_threshold: Mapped[int] = mapped_column(Integer, default=70, nullable=False)
    weather_precipitation_mm_threshold: Mapped[float] = mapped_column(Float, default=2.0, nullable=False)
    weather_fail_mode: Mapped[str] = mapped_column(String(16), default="allow", nullable=False)
    winter_mode_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    winter_disable_manual_start: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    winter_pause_schedules: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    safety_shutdown_on_winter: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    system_paused_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    safety_stop_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    safety_stop_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class GpioEvent(Base):
    __tablename__ = "gpio_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id", ondelete="CASCADE"), nullable=False)
    state: Mapped[bool] = mapped_column(Boolean, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    zone: Mapped["Zone"] = relationship(back_populates="gpio_events")


class GardenMap(Base):
    __tablename__ = "garden_maps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    image_url: Mapped[str | None] = mapped_column(Text)
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=1000)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=800)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    shapes: Mapped[list["ZoneMapShape"]] = relationship(back_populates="garden_map", cascade="all, delete-orphan", passive_deletes=True)


class ZoneMapShape(Base):
    __tablename__ = "zone_map_shapes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    garden_map_id: Mapped[int] = mapped_column(ForeignKey("garden_maps.id", ondelete="CASCADE"), nullable=False)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    geometry_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    style_json: Mapped[dict | None] = mapped_column(JSON)
    label_position_x: Mapped[float | None] = mapped_column(Float)
    label_position_y: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    zone: Mapped["Zone"] = relationship(back_populates="map_shapes")
    garden_map: Mapped["GardenMap"] = relationship(back_populates="shapes")
