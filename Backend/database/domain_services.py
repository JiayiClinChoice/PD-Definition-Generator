from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Sequence
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from configs import settings
from schemas import (
    DefinitionOutList,
    FactOutList,
    FieldUpdateList,
    PDCategoryUpdateList,
    ProtocolMetadata,
    WorkspaceOut,
)

from .default import DEFAULT_FIELD_PROTOCOL, DEFAULT_PD_CATEGORIES
from .models import Fact, FieldProtocol, PDCategory, PDDefinition, Project
from .repositories import (
    add_project,
    add_user,
    delete_project,
    delete_project_definitions,
    delete_project_facts,
    get_project_by_owner_and_id,
    get_user_by_key,
    list_pd_categories,
    list_project_definitions,
    list_project_facts,
    list_project_fields,
    list_projects_by_owner,
    release_project_agent_operation as repo_release_project_agent_operation,
    try_claim_project_agent_operation,
    update_field_protocol,
)

PROJECT_NOT_FOUND = "Project not found"


def require_editable(project: Project) -> None:
    if project.agent_operate_token:
        started = project.agent_operate_started_at
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
            seconds=settings.agent_claim_timeout_seconds
        )
        if started is None or started.replace(tzinfo=None) > cutoff:
            raise HTTPException(409, "AI 正在处理此项目，请等待完成后再修改。")


def require_project_name(name: str) -> str:
    name = name.strip()
    if not name or len(name) > 200:
        raise HTTPException(422, "项目名称需为 1–200 个字符。")
    return name

def _require_non_empty(items: Sequence[object], detail: str) -> None:
    if not items:
        raise HTTPException(status_code=400, detail=detail)


def _fact_to_dict(item: Fact) -> dict[str, object]:
    return {
        "position": item.position,
        "pd_category_ord": item.pd_category_ord,
        "pd_category_name": item.pd_category_name,
        "content": item.content,
        "source": item.source,
        "checked": item.checked,
    }


def _field_to_dict(item: FieldProtocol) -> dict[str, object]:
    return {
        "ord": item.ord,
        "name": item.name,
        "label": item.label,
        "meaning": item.meaning,
        "required": item.required,
        "allowed_values": item.allowed_values,
        "requirements": item.requirements,
        "example": item.example,
    }


def _definition_to_dict(item: PDDefinition) -> dict[str, object]:
    return {
        "checked": item.checked,
        "position": item.position,
        "pd_category_name": item.pd_category_name,
        "pd_ord": item.pd_ord,
        "requirements": item.requirements,
        "description": item.description,
        "review_method": item.review_method,
        "severity": item.severity,
        "note": item.note,
    }


async def ensure_user(db: AsyncSession, user_key: str) -> int:
    async with db.begin():
        user = await get_user_by_key(db, user_key)
        if user is not None:
            return user.id

        user = await add_user(db, user_key)
        return user.id


async def get_all_projects(db: AsyncSession, user_id: int) -> list[Project]:
    return await list_projects_by_owner(db, user_id)


async def get_project_by_id(db: AsyncSession, project_id: int, user_id: int) -> Project:
    project = await get_project_by_owner_and_id(db, project_id, user_id)
    if project is None:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    return project


async def claim_project_agent_operation(db: AsyncSession, project_id: int, user_id: int) -> str:
    token = str(uuid4())
    now = datetime.now(timezone.utc)
    expire_before = now - timedelta(seconds=settings.agent_claim_timeout_seconds)

    async with db.begin():
        claimed_project_id = await try_claim_project_agent_operation(
            db,
            project_id,
            user_id,
            token,
            now,
            expire_before,
        )

        if claimed_project_id is not None:
            return token

        await get_project_by_id(db, project_id, user_id)
        raise HTTPException(status_code=409, detail="Agent operation already in progress")


async def release_project_agent_operation(
    db: AsyncSession,
    project_id: int,
    user_id: int,
    token: str,
) -> bool:
    async with db.begin():
        return await repo_release_project_agent_operation(db, project_id, user_id, token)


async def initialize_project(db: AsyncSession, name: str, user_id: int) -> Project:
    async with db.begin():
        project = Project(name=require_project_name(name), owner_id=user_id)
        project.pd_categories = [PDCategory(**item) for item in DEFAULT_PD_CATEGORIES]
        project.field_protocol = [FieldProtocol(**item) for item in DEFAULT_FIELD_PROTOCOL]
        await add_project(db, project)
    return project


async def remove_project(
    db: AsyncSession, project_id: int, user_id: int, *, operation_token: str | None = None
) -> bool:
    async with db.begin():
        project = await get_project_by_id(db, project_id, user_id)
        if operation_token is None or project.agent_operate_token != operation_token:
            require_editable(project)
        await delete_project(db, project)
    return True


async def rename_project(db: AsyncSession, project_id: int, new_name: str, user_id: int) -> Project:
    async with db.begin():
        project = await get_project_by_id(db, project_id, user_id)
        require_editable(project)
        project.name = require_project_name(new_name)
    return project


async def set_validate_status(
    db: AsyncSession,
    project_id: int,
    user_id: int,
    file_id: str,
    file_name: str,
    file_valid: bool,
    metadata: ProtocolMetadata | None,
) -> Project:
    async with db.begin():
        project = await get_project_by_id(db, project_id, user_id)
        project.file_id = file_id
        project.file_name = file_name
        project.file_valid = 1 if file_valid else -1

        if metadata:
            for key, value in metadata.model_dump().items():
                setattr(project, key, value)
        else:
            project.title = None
            project.protocol_no = None
            project.version = None
            project.version_date = None
            project.sponsor = None
    return project


async def set_metadata(
    db: AsyncSession,
    project_id: int,
    user_id: int,
    metadata: ProtocolMetadata,
) -> Project:
    async with db.begin():
        project = await get_project_by_id(db, project_id, user_id)
        require_editable(project)
        for key, value in metadata.model_dump().items():
            setattr(project, key, value)
    return project


async def set_pd_categories(
    db: AsyncSession,
    project_id: int,
    user_id: int,
    pd_categories: PDCategoryUpdateList,
) -> list[PDCategory]:
    records = [PDCategory(project_id=project_id, **item.model_dump()) for item in pd_categories.categories]
    _require_non_empty(records, "Cannot set empty PD categories")

    async with db.begin():
        project = await get_project_by_id(db, project_id, user_id)
        require_editable(project)
        await delete_project_facts(db, project_id)
        project.pd_categories.clear()
        await db.flush()
        project.pd_categories = records
        await db.flush()
        return project.pd_categories


async def get_pd_categories_json(db: AsyncSession, project_id: int, user_id: int) -> str:
    await get_project_by_id(db, project_id, user_id)
    categories = await list_pd_categories(db, project_id)
    data = [
        {
            "ord": item.ord,
            "name": item.name,
            "description": item.description,
            "method": item.method,
        }
        for item in categories
    ]
    return json.dumps(data, ensure_ascii=False)


async def set_facts(
    db: AsyncSession,
    project_id: int,
    user_id: int,
    fact_list: FactOutList,
) -> list[Fact]:
    _require_non_empty(fact_list.facts, "Cannot set empty facts")

    async with db.begin():
        await get_project_by_id(db, project_id, user_id)
        confirmed = {
            (item.pd_category_ord, item.pd_category_name, item.content, item.source or "")
            for item in await list_project_facts(db, project_id) if item.checked == 1
        }
        for index, item in enumerate(fact_list.facts):
            item.position = index + 1
            item.checked = int((item.pd_category_ord, item.pd_category_name, item.content, item.source or "") in confirmed)
        facts = [Fact(project_id=project_id, **item.model_dump()) for item in fact_list.facts]
        await delete_project_facts(db, project_id)
        db.add_all(facts)
        await db.flush()
        return facts


async def get_facts_dict(db: AsyncSession, project_id: int, user_id: int) -> dict[str, str]:
    await get_project_by_id(db, project_id, user_id)
    facts = await list_project_facts(db, project_id)
    all_facts = [_fact_to_dict(item) for item in facts]
    checked_facts = [_fact_to_dict(item) for item in facts if item.checked == 1]
    return {
        "all": json.dumps(all_facts, ensure_ascii=False),
        "checked": json.dumps(checked_facts, ensure_ascii=False),
    }


async def set_fields(
    db: AsyncSession,
    project_id: int,
    user_id: int,
    field_list: FieldUpdateList,
) -> list[FieldProtocol]:
    async with db.begin():
        project = await get_project_by_id(db, project_id, user_id)
        require_editable(project)
        existing = await list_project_fields(db, project_id)
        if {(item.ord, item.name, item.label, item.required) for item in existing} != {
            (item.ord, item.name, item.label, item.required) for item in field_list.fields
        }:
            raise HTTPException(422, "生成结果使用固定字段结构，仅支持修改字段含义、允许值、要求及示例。")

        for item in field_list.fields:
            rowcount = await update_field_protocol(
                db,
                project_id,
                ord=item.ord,
                name=item.name,
                meaning=item.meaning,
                allowed_values=item.allowed_values,
                requirements=item.requirements,
                example=item.example,
            )
            if rowcount == 0:
                raise HTTPException(
                    status_code=404,
                    detail=f"Field protocol not found: ord={item.ord}, name={item.name}",
                )

        await db.flush()
        return await list_project_fields(db, project_id)


async def get_fields_json(db: AsyncSession, project_id: int, user_id: int) -> str:
    await get_project_by_id(db, project_id, user_id)
    fields = await list_project_fields(db, project_id)
    data = [_field_to_dict(item) for item in fields]
    return json.dumps(data, ensure_ascii=False)


async def set_definitions(
    db: AsyncSession,
    project_id: int,
    user_id: int,
    definition_list: DefinitionOutList,
) -> list[PDDefinition]:
    async with db.begin():
        await get_project_by_id(db, project_id, user_id)
        content_fields = ("pd_category_name", "pd_ord", "requirements", "description", "review_method", "severity", "note")
        confirmed = {
            tuple(getattr(item, field) or "" for field in content_fields)
            for item in await list_project_definitions(db, project_id) if item.checked == 1
        }
        for index, item in enumerate(definition_list.definitions):
            item.position = index + 1
            item.checked = int(tuple(getattr(item, field) or "" for field in content_fields) in confirmed)
        definitions = [
            PDDefinition(project_id=project_id, **item.model_dump())
            for item in definition_list.definitions
        ]
        _require_non_empty(definitions, "Cannot set empty definitions")
        await delete_project_definitions(db, project_id)
        db.add_all(definitions)
        await db.flush()
        return definitions


async def get_definition_dict(db: AsyncSession, project_id: int, user_id: int) -> dict[str, str]:
    await get_project_by_id(db, project_id, user_id)
    definitions = await list_project_definitions(db, project_id)
    all_definitions = [_definition_to_dict(item) for item in definitions]
    checked_definitions = [_definition_to_dict(item) for item in definitions if item.checked == 1]
    return {
        "all": json.dumps(all_definitions, ensure_ascii=False),
        "checked": json.dumps(checked_definitions, ensure_ascii=False),
    }


async def get_workspace(db: AsyncSession, project_id: int, user_id: int) -> WorkspaceOut:
    project = await get_project_by_id(db, project_id, user_id)
    categories = await list_pd_categories(db, project_id)
    fields = await list_project_fields(db, project_id)
    facts = await list_project_facts(db, project_id)
    definitions = await list_project_definitions(db, project_id)
    return WorkspaceOut(
        project=project,
        categories=[{
            "ord": item.ord, "name": item.name,
            "description": item.description, "method": item.method or "",
        } for item in categories],
        fields=[_field_to_dict(item) for item in fields],
        facts=[_fact_to_dict(item) for item in facts],
        definitions=[_definition_to_dict(item) for item in definitions],
    )


async def save_manual_results(
    db: AsyncSession,
    project_id: int,
    user_id: int,
    results: FactOutList | DefinitionOutList,
) -> None:
    async with db.begin():
        project = await get_project_by_id(db, project_id, user_id)
        require_editable(project)
        if isinstance(results, FactOutList):
            categories = {item.ord: item.name for item in await list_pd_categories(db, project_id)}
            for fact in results.facts:
                if categories.get(fact.pd_category_ord) != fact.pd_category_name:
                    raise HTTPException(422, "事实分类与项目配置不一致，请刷新。")
                if not fact.content.strip():
                    raise HTTPException(422, "事实内容不能为空。")
            await delete_project_facts(db, project_id)
            db.add_all([
                Fact(project_id=project_id, **{**item.model_dump(), "position": index + 1})
                for index, item in enumerate(results.facts)
            ])
        else:
            for definition in results.definitions:
                if not definition.pd_ord.strip() or not definition.description.strip():
                    raise HTTPException(422, "定义编号和描述不能为空。")
            if len({item.pd_ord for item in results.definitions}) != len(results.definitions):
                raise HTTPException(422, "定义编号不能重复。")
            await delete_project_definitions(db, project_id)
            db.add_all([
                PDDefinition(project_id=project_id, **{**item.model_dump(), "position": index + 1})
                for index, item in enumerate(results.definitions)
            ])
