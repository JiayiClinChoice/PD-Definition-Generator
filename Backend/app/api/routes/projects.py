from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from configs import settings
from database import get_db
from database.models import Project
from database.domain_services import (
    get_all_projects,
    get_project_by_id,
    initialize_project,
    remove_project,
    rename_project,
    set_fields,
    set_metadata,
    set_pd_categories,
    get_workspace,
    save_manual_results,
)
from schemas import (
    DefinitionOutList,
    FactOutList,
    FieldUpdateList,
    PDCategoryUpdateList,
    ProjectInfoOut,
    ProjectInitialOut,
    ProtocolMetadata,
    RequirementsUpdateRequest,
    WorkspaceOut,
)

from app.api.dependencies import (
    get_client, get_current_user_id, project_agent_operation_guard, require_client_header,
)
from app.services.project_workflows import (
    attach_and_validate_protocol,
    extract_and_save_facts,
    generate_and_save_definitions,
    revise_and_save_definitions,
    revise_and_save_facts,
)

router = APIRouter(tags=["Project"])

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/markdown",
    "text/plain",
}


@router.get("/projects", response_model=list[ProjectInfoOut])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> list[Project]:
    return await get_all_projects(db, user_id)


@router.get("/project/{project_id}", response_model=ProjectInfoOut)
async def get_project_info(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> Project:
    return await get_project_by_id(db, project_id, user_id)


@router.get("/project/{project_id}/workspace", response_model=WorkspaceOut)
async def get_project_workspace(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> WorkspaceOut:
    return await get_workspace(db, project_id, user_id)


@router.put("/project/{project_id}/facts", response_model=FactOutList)
async def save_project_facts(
    project_id: int,
    facts: FactOutList,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> FactOutList:
    await save_manual_results(db, project_id, user_id, facts)
    workspace = await get_workspace(db, project_id, user_id)
    return FactOutList(facts=workspace.facts)


@router.put("/project/{project_id}/definitions", response_model=DefinitionOutList)
async def save_project_definitions(
    project_id: int,
    definitions: DefinitionOutList,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> DefinitionOutList:
    await save_manual_results(db, project_id, user_id, definitions)
    workspace = await get_workspace(db, project_id, user_id)
    return DefinitionOutList(definitions=workspace.definitions)


@router.post("/project/initial", response_model=ProjectInitialOut)
async def create_project(
    name: str = Query(default="New Project", min_length=1),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> Project:
    return await initialize_project(db, name, user_id)


@router.delete("/project/{project_id}")
async def delete_project(
    project_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> bool:
    async with project_agent_operation_guard(db, project_id, user_id) as token:
        async with db.begin():
            project = await get_project_by_id(db, project_id, user_id)
        if project.file_id:
            from ai.service import delete_file

            await delete_file(get_client(request), project.file_id)
        return await remove_project(db, project_id, user_id, operation_token=token)


@router.put("/project/{project_id}/rename", response_model=ProjectInfoOut)
async def rename_project_name(
    project_id: int,
    new_name: str = Query(min_length=1),
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> Project:
    return await rename_project(db, project_id, new_name, user_id)


@router.post("/project/{project_id}/attach", response_model=ProjectInfoOut)
async def attach_protocol_file(
    project_id: int,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    client: AsyncOpenAI = Depends(get_client),
    user_id: int = Depends(get_current_user_id),
) -> Project:
    async with db.begin():
        project = await get_project_by_id(db, project_id, user_id)
    if project.file_id:
        raise HTTPException(status_code=409, detail="Project already has a file attached")
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing file name")
    if Path(file.filename).suffix.lower() not in {".pdf", ".doc", ".docx", ".md", ".txt"} or (
        file.content_type not in ALLOWED_CONTENT_TYPES | {"application/octet-stream", None}
    ):
        raise HTTPException(status_code=415, detail="Invalid file type")

    file_size = file.size or 0
    if file_size == 0:
        raise HTTPException(status_code=400, detail="上传的文件为空。")
    if file_size > settings.agent_max_file_size_bytes:
        raise HTTPException(status_code=413, detail="File size exceeds limit")

    await file.seek(0)
    await attach_and_validate_protocol(
        db,
        client,
        project_id=project_id,
        user_id=user_id,
        file=file,
    )
    return await get_project_by_id(db, project_id, user_id)


@router.put("/project/{project_id}/metadata", response_model=ProjectInfoOut)
async def update_project_metadata(
    project_id: int,
    metadata: ProtocolMetadata,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> Project:
    return await set_metadata(db, project_id, user_id, metadata)


@router.put("/project/{project_id}/pd_categories", response_model=PDCategoryUpdateList)
async def update_pd_categories(
    project_id: int,
    pd_categories: PDCategoryUpdateList,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> PDCategoryUpdateList:
    await set_pd_categories(db, project_id, user_id, pd_categories)
    return pd_categories


@router.post("/project/{project_id}/extract_facts", response_model=FactOutList)
@router.get(
    "/project/{project_id}/facts", response_model=FactOutList, deprecated=True,
    dependencies=[Depends(require_client_header)],
)
async def get_project_facts(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    client: AsyncOpenAI = Depends(get_client),
    user_id: int = Depends(get_current_user_id),
) -> FactOutList:
    return await extract_and_save_facts(
        db,
        client,
        project_id=project_id,
        user_id=user_id,
    )


@router.put("/project/{project_id}/revise_facts", response_model=FactOutList)
async def revise_project_facts(
    project_id: int,
    request: RequirementsUpdateRequest,
    db: AsyncSession = Depends(get_db),
    client: AsyncOpenAI = Depends(get_client),
    user_id: int = Depends(get_current_user_id),
) -> FactOutList:
    return await revise_and_save_facts(
        db,
        client,
        project_id=project_id,
        user_id=user_id,
        requirements=request.requirements,
    )


@router.put("/project/{project_id}/update_fields", response_model=FieldUpdateList)
async def update_project_fields(
    project_id: int,
    fields: FieldUpdateList,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> FieldUpdateList:
    rows = await set_fields(db, project_id, user_id, fields)
    return FieldUpdateList(
        fields = [{
            "ord": row.ord,
            "name": row.name,
            "label": row.label,
            "meaning": row.meaning,
            "required": row.required,
            "allowed_values": row.allowed_values,
            "requirements": row.requirements,
            "example": row.example,
        } for row in rows]
    )


@router.post("/project/{project_id}/generate_definitions", response_model=DefinitionOutList)
@router.get(
    "/project/{project_id}/definitions", response_model=DefinitionOutList, deprecated=True,
    dependencies=[Depends(require_client_header)],
)
async def get_project_definitions(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    client: AsyncOpenAI = Depends(get_client),
    user_id: int = Depends(get_current_user_id),
) -> DefinitionOutList:
    return await generate_and_save_definitions(
        db,
        client,
        project_id=project_id,
        user_id=user_id,
    )


@router.put("/project/{project_id}/revise_definitions", response_model=DefinitionOutList)
async def revise_project_definitions(
    project_id: int,
    request: RequirementsUpdateRequest,
    db: AsyncSession = Depends(get_db),
    client: AsyncOpenAI = Depends(get_client),
    user_id: int = Depends(get_current_user_id),
) -> DefinitionOutList:
    return await revise_and_save_definitions(
        db,
        client,
        project_id=project_id,
        user_id=user_id,
        requirements=request.requirements,
    )