"""add garden maps and zone map shapes"""

from alembic import op
import sqlalchemy as sa


revision = "0003_garden_maps_and_shapes"
down_revision = "0002_gpio_state_and_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "garden_maps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
        sa.Column("image_url", sa.String(length=1024), nullable=True),
        sa.Column("width", sa.Integer(), nullable=False, server_default="1000"),
        sa.Column("height", sa.Integer(), nullable=False, server_default="800"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_table(
        "zone_map_shapes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("garden_map_id", sa.Integer(), sa.ForeignKey("garden_maps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("zone_id", sa.Integer(), sa.ForeignKey("zones.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("geometry_json", sa.JSON(), nullable=False),
        sa.Column("style_json", sa.JSON(), nullable=True),
        sa.Column("label_position_x", sa.Float(), nullable=True),
        sa.Column("label_position_y", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )


def downgrade() -> None:
    op.drop_table("zone_map_shapes")
    op.drop_table("garden_maps")
