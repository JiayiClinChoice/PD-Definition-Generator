from __future__ import annotations

import logging

from fastapi import HTTPException, UploadFile
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from ai.service import (
    AIRequestContext,
    delete_file,
    generate_definition,
    regenerate_definition,
    revise_fact,
    search_fact,
    upload_file,
    validate_protocol,
)
from database.domain_services import (
    get_definition_dict,
    get_facts_dict,
    get_project_by_id,
    get_fields_json,
    get_pd_categories_json,
    set_definitions,
    set_facts,
    set_validate_status,
)
from schemas import DefinitionOutList, FactOutList, PromptPreview, PromptPreviewRequest
from ai.conversation import build_conversation
from database.prompt_services import load_prompts

from app.api.dependencies import project_agent_operation_guard, require_project_with_file

logger = logging.getLogger(__name__)


async def cleanup_uploaded_file(client: AsyncOpenAI, file_id: str) -> None:
    try:
        await delete_file(client, file_id)
    except HTTPException:
        logger.exception("Could not clean up an uploaded file after a failed protocol operation.")


async def attach_and_validate_protocol(
    db: AsyncSession,
    client: AsyncOpenAI,
    *,
    project_id: int,
    user_id: int,
    file: UploadFile,
) -> None:
    uploaded_file_id = ""
    async with project_agent_operation_guard(db, project_id, user_id):
        async with db.begin():
            project = await get_project_by_id(db, project_id, user_id)
            if project.file_id:
                raise HTTPException(409, "此项目已经关联方案文件。")
            context = AIRequestContext(db, project_id, await load_prompts(db, project_id))
        uploaded_file_id = await upload_file(client, file)

        try:
            validate_result = await validate_protocol(client, uploaded_file_id, context=context)
        except (HTTPException, ValueError, SQLAlchemyError):
            if uploaded_file_id:
                await cleanup_uploaded_file(client, uploaded_file_id)
            raise

        try:
            await set_validate_status(
                db=db,
                project_id=project_id,
                user_id=user_id,
                file_id=uploaded_file_id,
                file_name=file.filename or "",
                file_valid=validate_result.file_valid,
                metadata=validate_result.meta_data,
            )
        except (SQLAlchemyError, HTTPException):
            if uploaded_file_id:
                await cleanup_uploaded_file(client, uploaded_file_id)
            raise


async def extract_and_save_facts(
    db: AsyncSession,
    client: AsyncOpenAI,
    *,
    project_id: int,
    user_id: int,
) -> FactOutList:
    async with project_agent_operation_guard(db, project_id, user_id):
        async with db.begin():
            project = await require_project_with_file(db, project_id, user_id)
            categories = await get_pd_categories_json(db, project_id, user_id)
            context = AIRequestContext(db, project_id, await load_prompts(db, project_id))
        result = await search_fact(client, project.file_id, categories, context=context)
        await set_facts(db, project_id, user_id, result)
        return result


async def revise_and_save_facts(
    db: AsyncSession,
    client: AsyncOpenAI,
    *,
    project_id: int,
    user_id: int,
    requirements: str,
) -> FactOutList:
    async with project_agent_operation_guard(db, project_id, user_id):
        async with db.begin():
            project = await require_project_with_file(db, project_id, user_id)
            categories = await get_pd_categories_json(db, project_id, user_id)
            facts = await get_facts_dict(db, project_id, user_id)
            if facts["all"] == "[]":
                raise HTTPException(409, "请先提取事实。")
            context = AIRequestContext(db, project_id, await load_prompts(db, project_id))
        result = await revise_fact(client, project.file_id, categories, facts, requirements, context=context)
        await set_facts(db, project_id, user_id, result)
        return result


async def generate_and_save_definitions(
    db: AsyncSession,
    client: AsyncOpenAI,
    *,
    project_id: int,
    user_id: int,
) -> DefinitionOutList:
    async with project_agent_operation_guard(db, project_id, user_id):
        async with db.begin():
            project = await require_project_with_file(db, project_id, user_id)
            categories = await get_pd_categories_json(db, project_id, user_id)
            facts = await get_facts_dict(db, project_id, user_id)
            fields = await get_fields_json(db, project_id, user_id)
            if facts["all"] == "[]":
                raise HTTPException(409, "请先提取并保存事实。")
            context = AIRequestContext(db, project_id, await load_prompts(db, project_id))
        result = await generate_definition(client, project.file_id, categories, facts, fields, context=context)
        await set_definitions(db, project_id, user_id, result)
        return result


async def revise_and_save_definitions(
    db: AsyncSession,
    client: AsyncOpenAI,
    *,
    project_id: int,
    user_id: int,
    requirements: str,
) -> DefinitionOutList:
    async with project_agent_operation_guard(db, project_id, user_id):
        async with db.begin():
            project = await require_project_with_file(db, project_id, user_id)
            categories = await get_pd_categories_json(db, project_id, user_id)
            facts = await get_facts_dict(db, project_id, user_id)
            fields = await get_fields_json(db, project_id, user_id)
            definitions = await get_definition_dict(db, project_id, user_id)
            if definitions["all"] == "[]":
                raise HTTPException(409, "请先生成定义。")
            context = AIRequestContext(db, project_id, await load_prompts(db, project_id))
        result = await regenerate_definition(
            client,
            project.file_id,
            categories,
            facts,
            fields,
            definitions,
            requirements,
            context=context,
        )
        await set_definitions(db, project_id, user_id, result)
        return result


async def preview_ai_request(
    db: AsyncSession, project_id: int, user_id: int, request: PromptPreviewRequest,
) -> PromptPreview:
    async with db.begin():
        project = await get_project_by_id(db, project_id, user_id)
        if request.operation == "validate":
            if project.file_id:
                raise HTTPException(409, "此项目已经关联方案文件。")
            return build_conversation(request.prompts, "validate", "<待上传的方案文件>")
        project_with_file = await require_project_with_file(db, project_id, user_id)
        categories = await get_pd_categories_json(db, project_id, user_id)
        facts = await get_facts_dict(db, project_id, user_id)
        fields = await get_fields_json(db, project_id, user_id)
        definitions = await get_definition_dict(db, project_id, user_id)
        if request.operation in {"revise_facts", "generate", "revise_definitions"} and facts["all"] == "[]":
            raise HTTPException(409, "请先提取并保存事实。")
        if request.operation == "revise_definitions" and definitions["all"] == "[]":
            raise HTTPException(409, "请先生成定义。")
        return build_conversation(
            request.prompts, request.operation, project_with_file.file_id,
            categories, facts, fields, definitions, request.requirements,
        )
