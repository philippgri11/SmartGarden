"""Add weather forecast cache."""

from alembic import op
import sqlalchemy as sa


revision = "0010_weather_forecast_cache"
down_revision = "0009_adaptive_irrigation_plan"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "weather_forecast_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cache_key", sa.String(length=180), nullable=False, unique=True),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("forecast_window_hours", sa.Integer(), nullable=False),
        sa.Column("summary_json", sa.JSON(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("weather_forecast_cache")
