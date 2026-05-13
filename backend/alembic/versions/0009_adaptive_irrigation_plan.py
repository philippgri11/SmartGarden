"""Add adaptive irrigation plan columns to zones."""

from alembic import op
import sqlalchemy as sa


revision = "0009_adaptive_irrigation_plan"
down_revision = "0008_zone_irrigation_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("zones", sa.Column("scheduling_mode", sa.String(length=32), nullable=False, server_default="static"))
    op.add_column("zones", sa.Column("adaptive_irrigation_plan_json", sa.JSON(), nullable=True))
    op.alter_column("zones", "scheduling_mode", server_default=None)


def downgrade() -> None:
    op.drop_column("zones", "adaptive_irrigation_plan_json")
    op.drop_column("zones", "scheduling_mode")
