"""add gpio state and events"""

from alembic import op
import sqlalchemy as sa


revision = "0002_gpio_state_and_events"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "zones",
        sa.Column("last_known_gpio_state", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "zones",
        sa.Column("last_gpio_changed_at", sa.DateTime(timezone=True), nullable=True),
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


def downgrade() -> None:
    op.drop_table("gpio_events")
    op.drop_column("zones", "last_gpio_changed_at")
    op.drop_column("zones", "last_known_gpio_state")
