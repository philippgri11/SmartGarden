from sqlalchemy import select

from app.infrastructure.db import orm
from app.seed_local import seed_local_data_in_session

from conftest import TEST_SETTINGS


def test_local_seed_is_idempotent(db_session) -> None:
    seed_local_data_in_session(db_session, TEST_SETTINGS)
    seed_local_data_in_session(db_session, TEST_SETTINGS)

    zones = list(db_session.scalars(select(orm.Zone).order_by(orm.Zone.name.asc())))
    schedules = list(db_session.scalars(select(orm.Schedule).order_by(orm.Schedule.zone_id.asc(), orm.Schedule.start_time.asc())))

    assert [zone.name for zone in zones] == ["Rasenfläche", "Teich", "Terrasse"]
    assert len(schedules) == 3
