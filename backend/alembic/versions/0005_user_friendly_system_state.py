"""user friendly system state

Revision ID: 0005_user_friendly_system_state
Revises: 0004_normalize_map_names
Create Date: 2026-05-10 16:32:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_user_friendly_system_state"
down_revision = "0004_normalize_map_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("zones", sa.Column("default_manual_duration_minutes", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE zones
        SET default_manual_duration_minutes = LEAST(GREATEST(COALESCE(max_duration_minutes, 5), 1), 5)
        WHERE default_manual_duration_minutes IS NULL;
        """
    )
    op.alter_column("zones", "default_manual_duration_minutes", nullable=False)

    op.add_column("app_settings", sa.Column("location_name", sa.String(length=160), nullable=True))
    op.add_column("app_settings", sa.Column("postal_code", sa.String(length=32), nullable=True))
    op.add_column("app_settings", sa.Column("winter_mode_active", sa.Boolean(), nullable=True))
    op.add_column("app_settings", sa.Column("winter_disable_manual_start", sa.Boolean(), nullable=True))
    op.add_column("app_settings", sa.Column("winter_pause_schedules", sa.Boolean(), nullable=True))
    op.add_column("app_settings", sa.Column("safety_shutdown_on_winter", sa.Boolean(), nullable=True))
    op.add_column("app_settings", sa.Column("system_paused_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("app_settings", sa.Column("safety_stop_active", sa.Boolean(), nullable=True))
    op.add_column("app_settings", sa.Column("safety_stop_reason", sa.Text(), nullable=True))
    op.execute(
        """
        UPDATE app_settings
        SET
          location_name = COALESCE(NULLIF(BTRIM(location_name), ''), 'Mein Garten'),
          winter_mode_active = COALESCE(winter_mode_active, FALSE),
          winter_disable_manual_start = COALESCE(winter_disable_manual_start, TRUE),
          winter_pause_schedules = COALESCE(winter_pause_schedules, TRUE),
          safety_shutdown_on_winter = COALESCE(safety_shutdown_on_winter, TRUE),
          safety_stop_active = COALESCE(safety_stop_active, FALSE);
        """
    )
    op.alter_column("app_settings", "location_name", nullable=False)
    op.alter_column("app_settings", "winter_mode_active", nullable=False)
    op.alter_column("app_settings", "winter_disable_manual_start", nullable=False)
    op.alter_column("app_settings", "winter_pause_schedules", nullable=False)
    op.alter_column("app_settings", "safety_shutdown_on_winter", nullable=False)
    op.alter_column("app_settings", "safety_stop_active", nullable=False)


def downgrade() -> None:
    op.drop_column("app_settings", "safety_stop_reason")
    op.drop_column("app_settings", "safety_stop_active")
    op.drop_column("app_settings", "system_paused_until")
    op.drop_column("app_settings", "safety_shutdown_on_winter")
    op.drop_column("app_settings", "winter_pause_schedules")
    op.drop_column("app_settings", "winter_disable_manual_start")
    op.drop_column("app_settings", "winter_mode_active")
    op.drop_column("app_settings", "postal_code")
    op.drop_column("app_settings", "location_name")
    op.drop_column("zones", "default_manual_duration_minutes")
