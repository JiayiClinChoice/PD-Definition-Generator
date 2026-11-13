from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, HTTPException, Request
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Protocol

from database.domain_services import (
    claim_project_agent_operation,
    get_project_by_id,
    release_project_agent_operation,
)
from app.services.auth import authenticate
from schemas import UserOut


def get_client(request: Request) -> AsyncOpenAI:
    client = request.app.state.client
    if client is None:
        raise HTTPException(503, "AI 服务尚未配置，请联系管理员配置模型后重试。")
    return client


async def get_current_user_id(
    user: UserOut = Depends(authenticate),
) -> int:
    return user.id


def require_same_site_request(request: Request) -> None:
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        require_client_header(request)


def require_client_header(request: Request) -> None:
    if request.headers.get("X-Requested-With") != "ProtocolDeviationGenerator":
        raise HTTPException(403, "缺少请求来源验证。")


class ProjectWithFile(Protocol):
    file_id: str


async def require_project_with_file(
    db: AsyncSession,
    project_id: int,
    user_id: int,
) -> ProjectWithFile:
    project = await get_project_by_id(db, project_id, user_id)
    if not project.file_id or project.file_valid != 1:
        raise HTTPException(status_code=409, detail="请先上传并验证有效的方案文件。")
    return project


@asynccontextmanager
async def project_agent_operation_guard(
    db: AsyncSession,
    project_id: int,
    user_id: int,
):
    token = await claim_project_agent_operation(db, project_id, user_id)
    try:
        yield token
    finally:
        await release_project_agent_operation(db, project_id, user_id, token)
