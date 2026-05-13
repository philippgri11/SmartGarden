"""add zone irrigation profile"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0008_zone_irrigation_profile"
down_revision = "0007_manual_sequence_runs"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = inspect(bind)
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if not _column_exists("zones", "zone_profile_description"):
        op.add_column("zones", sa.Column("zone_profile_description", sa.Text(), nullable=True))
    if not _column_exists("zones", "irrigation_profile_json"):
        op.add_column("zones", sa.Column("irrigation_profile_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    if _column_exists("zones", "irrigation_profile_json"):
        op.drop_column("zones", "irrigation_profile_json")
    if _column_exists("zones", "zone_profile_description"):
        op.drop_column("zones", "zone_profile_description")
