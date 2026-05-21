"""Add explicit watering run occurrence identity.

Revision ID: 0012_run_occurrence_identity
Revises: 0011_system_heartbeats_alerts
Create Date: 2026-05-21 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_run_occurrence_identity"
down_revision = "0011_system_heartbeats_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("watering_runs", sa.Column("source_type", sa.String(length=32), nullable=False, server_default="manual"))
    op.add_column("watering_runs", sa.Column("occurrence_key", sa.String(length=160), nullable=True))
    op.add_column("watering_runs", sa.Column("planning_reason", sa.Text(), nullable=True))
    op.add_column("watering_runs", sa.Column("execution_reason", sa.Text(), nullable=True))
    op.execute(
        """
        UPDATE watering_runs
        SET source_type = CASE
            WHEN trigger_type = 'manual' THEN 'manual'
            WHEN schedule_id IS NOT NULL THEN 'static_schedule'
            ELSE 'adaptive_rule'
        END
        """
    )
    op.execute("UPDATE watering_runs SET planning_reason = reason")
    op.create_index("ix_watering_runs_occurrence_key", "watering_runs", ["occurrence_key"], unique=True)
    op.alter_column("watering_runs", "source_type", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_watering_runs_occurrence_key", table_name="watering_runs")
    op.drop_column("watering_runs", "execution_reason")
    op.drop_column("watering_runs", "planning_reason")
    op.drop_column("watering_runs", "occurrence_key")
    op.drop_column("watering_runs", "source_type")
