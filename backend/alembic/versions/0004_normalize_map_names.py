"""normalize blank garden map and shape names

Revision ID: 0004_normalize_map_names
Revises: 0003_garden_maps_and_shapes
Create Date: 2026-05-10 16:14:00
"""

from alembic import op


revision = "0004_normalize_map_names"
down_revision = "0003_garden_maps_and_shapes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE garden_maps
        SET name = 'Karte ' || id
        WHERE btrim(COALESCE(name, '')) = '';
        """
    )
    op.execute(
        """
        UPDATE zone_map_shapes
        SET name = 'Zone ' || zone_id || ' Flaeche ' || id
        WHERE btrim(COALESCE(name, '')) = '';
        """
    )
    op.create_check_constraint(
        "ck_garden_maps_name_not_blank",
        "garden_maps",
        "btrim(name) <> ''",
    )
    op.create_check_constraint(
        "ck_zone_map_shapes_name_not_blank",
        "zone_map_shapes",
        "btrim(name) <> ''",
    )


def downgrade() -> None:
    op.drop_constraint("ck_zone_map_shapes_name_not_blank", "zone_map_shapes", type_="check")
    op.drop_constraint("ck_garden_maps_name_not_blank", "garden_maps", type_="check")
