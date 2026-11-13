from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import MetaData, event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from configs import settings


engine = create_async_engine(
    f"sqlite+aiosqlite:///{settings.database_path}",
    echo=False,
)


@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection: Any, connection_record: Any) -> None:
    del connection_record
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


AsyncSessionFactory = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    db = AsyncSessionFactory()
    try:
        yield db
    finally:
        await db.close()


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


from . import models


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
