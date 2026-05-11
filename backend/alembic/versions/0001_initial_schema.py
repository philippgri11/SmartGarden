"""initial schema"""

from alembic import op
import sqlalchemy as sa


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "zones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("gpio_chip", sa.String(length=255), nullable=False),
        sa.Column("gpio_line", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("max_duration_minutes", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("weather_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("weather_probability_threshold", sa.Integer(), nullable=True),
        sa.Column("weather_precipitation_mm_threshold", sa.Float(), nullable=True),
        sa.Column("last_known_gpio_state", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("last_gpio_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("zone_id", sa.Integer(), sa.ForeignKey("zones.id", ondelete="CASCADE"), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("weekdays", sa.String(length=64), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("interval_hours", sa.Integer(), nullable=True),
        sa.Column("window_start", sa.Time(), nullable=True),
        sa.Column("window_end", sa.Time(), nullable=True),
        sa.Column("weather_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("weather_probability_threshold", sa.Integer(), nullable=True),
        sa.Column("weather_precipitation_mm_threshold", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_table(
        "watering_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("zone_id", sa.Integer(), sa.ForeignKey("zones.id", ondelete="CASCADE"), nullable=False),
        sa.Column("schedule_id", sa.Integer(), sa.ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True),
        sa.Column("trigger_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("scheduled_for", sa.Date(), nullable=True),
        sa.Column("scheduled_time", sa.Time(), nullable=True),
        sa.Column("requested_duration_minutes", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("stop_requested", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("schedule_id", "scheduled_for", "scheduled_time", name="uq_watering_run_schedule_slot"),
    )
    op.create_table(
        "weather_decisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("watering_run_id", sa.Integer(), sa.ForeignKey("watering_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("forecast_window_hours", sa.Integer(), nullable=False),
        sa.Column("precipitation_probability_max", sa.Float(), nullable=True),
        sa.Column("precipitation_sum_mm", sa.Float(), nullable=True),
        sa.Column("decision", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("raw_response", sa.JSON(), nullable=True),
    )
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("weather_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("weather_window_hours", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("weather_probability_threshold", sa.Integer(), nullable=False, server_default="70"),
        sa.Column("weather_precipitation_mm_threshold", sa.Float(), nullable=False, server_default="2"),
        sa.Column("weather_fail_mode", sa.String(length=16), nullable=False, server_default="allow"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_table(
        "gpio_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("zone_id", sa.Integer(), sa.ForeignKey("zones.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.execute(
        sa.text(
            "INSERT INTO app_settings (id, latitude, longitude, weather_enabled, weather_window_hours, weather_probability_threshold, weather_precipitation_mm_threshold, weather_fail_mode) VALUES (1, 52.52, 13.405, true, 6, 70, 2.0, 'allow')"
        )
    )


def downgrade() -> None:
    op.drop_table("gpio_events")
    op.drop_table("weather_decisions")
    op.drop_table("watering_runs")
    op.drop_table("schedules")
    op.drop_table("zones")
    op.drop_table("app_settings")
