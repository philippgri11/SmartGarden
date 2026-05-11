"""manual sequence runs

Revision ID: 0007_manual_sequence_runs
Revises: 0006_expand_garden_map_image_url
Create Date: 2026-05-11 09:15:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_manual_sequence_runs"
down_revision = "0006_expand_garden_map_image_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("watering_runs", sa.Column("sequence_group_id", sa.String(length=64), nullable=True))
    op.add_column("watering_runs", sa.Column("sequence_order", sa.Integer(), nullable=True))
    op.create_index("ix_watering_runs_sequence_group_id", "watering_runs", ["sequence_group_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_watering_runs_sequence_group_id", table_name="watering_runs")
    op.drop_column("watering_runs", "sequence_order")
    op.drop_column("watering_runs", "sequence_group_id")
