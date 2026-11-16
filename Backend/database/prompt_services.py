from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from schemas import ProjectPrompts
from .domain_services import get_project_by_id, require_editable
from .models import AIInteraction
from .repositories import list_project_interactions, list_project_prompts, upsert_project_prompts


async def load_prompts(db: AsyncSession, project_id: int) -> ProjectPrompts:
    rows = await list_project_prompts(db, project_id)
    return ProjectPrompts.model_validate({row.key: row.content for row in rows})


async def get_prompts(db: AsyncSession, project_id: int, user_id: int) -> ProjectPrompts:
    await get_project_by_id(db, project_id, user_id)
    return await load_prompts(db, project_id)


async def save_prompts(
    db: AsyncSession, project_id: int, user_id: int, prompts: ProjectPrompts,
) -> ProjectPrompts:
    async with db.begin():
        project = await get_project_by_id(db, project_id, user_id)
        require_editable(project)
        await upsert_project_prompts(db, project_id, prompts.model_dump())
    return prompts


async def list_interactions(
    db: AsyncSession, project_id: int, user_id: int, *, offset: int, limit: int,
) -> list[AIInteraction]:
    await get_project_by_id(db, project_id, user_id)
    return await list_project_interactions(db, project_id, offset=offset, limit=limit)
