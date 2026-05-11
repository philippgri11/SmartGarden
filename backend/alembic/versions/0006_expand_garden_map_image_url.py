"""expand garden map image storage

Revision ID: 0006_expand_garden_map_image_url
Revises: 0005_user_friendly_system_state
Create Date: 2026-05-10
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_expand_garden_map_image_url"
down_revision = "0005_user_friendly_system_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("garden_maps", "image_url", existing_type=sa.String(length=1024), type_=sa.Text(), existing_nullable=True)


def downgrade() -> None:
    op.alter_column("garden_maps", "image_url", existing_type=sa.Text(), type_=sa.String(length=1024), existing_nullable=True)
