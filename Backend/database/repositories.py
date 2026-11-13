from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Fact, FieldProtocol, PDCategory, PDDefinition, Project, User


async def get_user_by_key(db: AsyncSession, user_key: str) -> User | None:
    result = await db.execute(select(User).where(User.user_key == user_key))
    return result.scalar_one_or_none()


async def add_user(db: AsyncSession, user_key: str) -> User:
    user = User(user_key=user_key)
    db.add(user)
    await db.flush()
    return user


async def list_projects_by_owner(db: AsyncSession, owner_id: int) -> list[Project]:
    result = await db.execute(
        select(Project)
        .where(Project.owner_id == owner_id)
        .order_by(Project.id.desc())
    )
    return list(result.scalars().all())


async def get_project_by_owner_and_id(
    db: AsyncSession,
    project_id: int,
    owner_id: int,
) -> Project | None:
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.owner_id == owner_id)
    )
    return result.scalar_one_or_none()


async def try_claim_project_agent_operation(
    db: AsyncSession,
    project_id: int,
    owner_id: int,
    token: str,
    started_at: datetime,
    expire_before: datetime,
) -> int | None:
    result = await db.execute(
        update(Project)
        .where(
            Project.id == project_id,
            Project.owner_id == owner_id,
            (
                (Project.agent_operate_token.is_(None))
                | (Project.agent_operate_started_at.is_(None))
                | (Project.agent_operate_started_at < expire_before)
            ),
        )
        .values(agent_operate_token=token, agent_operate_started_at=started_at)
        .returning(Project.id)
    )
    return result.scalar_one_or_none()


async def release_project_agent_operation(
    db: AsyncSession,
    project_id: int,
    owner_id: int,
    token: str,
) -> bool:
    result = await db.execute(
        update(Project)
        .where(
            Project.id == project_id,
            Project.owner_id == owner_id,
            Project.agent_operate_token == token,
        )
        .values(agent_operate_token=None, agent_operate_started_at=None)
        .returning(Project.id)
    )
    return result.scalar_one_or_none() is not None


async def add_project(db: AsyncSession, project: Project) -> None:
    db.add(project)


async def delete_project(db: AsyncSession, project: Project) -> None:
    await db.delete(project)


async def list_pd_categories(db: AsyncSession, project_id: int) -> list[PDCategory]:
    result = await db.execute(
        select(PDCategory)
        .where(PDCategory.project_id == project_id)
        .order_by(PDCategory.ord)
    )
    return list(result.scalars().all())


async def delete_project_facts(db: AsyncSession, project_id: int) -> None:
    await db.execute(delete(Fact).where(Fact.project_id == project_id))


async def list_project_facts(db: AsyncSession, project_id: int) -> list[Fact]:
    result = await db.execute(
        select(Fact)
        .where(Fact.project_id == project_id)
        .order_by(Fact.position)
    )
    return list(result.scalars().all())


async def update_field_protocol(
    db: AsyncSession,
    project_id: int,
    *,
    ord: int,
    name: str,
    meaning: str,
    allowed_values: list[str],
    requirements: str | None,
    example: list[str],
) -> int:
    result = await db.execute(
        update(FieldProtocol)
        .where(
            FieldProtocol.project_id == project_id,
            FieldProtocol.ord == ord,
            FieldProtocol.name == name,
        )
        .values(
            meaning=meaning,
            allowed_values=allowed_values,
            requirements=requirements,
            example=example,
        )
    )
    return result.rowcount or 0


async def list_project_fields(db: AsyncSession, project_id: int) -> list[FieldProtocol]:
    result = await db.execute(
        select(FieldProtocol)
        .where(FieldProtocol.project_id == project_id)
        .order_by(FieldProtocol.ord)
    )
    return list(result.scalars().all())


async def delete_project_definitions(db: AsyncSession, project_id: int) -> None:
    await db.execute(delete(PDDefinition).where(PDDefinition.project_id == project_id))


async def list_project_definitions(db: AsyncSession, project_id: int) -> list[PDDefinition]:
    result = await db.execute(
        select(PDDefinition)
        .where(PDDefinition.project_id == project_id)
        .order_by(PDDefinition.position)
    )
    return list(result.scalars().all())
