from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from time import perf_counter
from typing import TYPE_CHECKING, NoReturn, TypeVar

from fastapi import HTTPException
from openai import APIError, APITimeoutError, AsyncOpenAI
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from configs import settings
from database.models import AIInteraction
from schemas import DefinitionOutList, FactOutList, ProjectPrompts, ValidationResult

from .conversation import build_conversation
from .prompt import Operation

if TYPE_CHECKING:
    from fastapi import UploadFile

StructuredModel = TypeVar("StructuredModel", bound=BaseModel)


@dataclass(frozen=True)
class AIRequestContext:
    db: AsyncSession
    project_id: int
    prompts: ProjectPrompts


def _raise_upstream_error(message: str, status_code: int = 502) -> NoReturn:
    raise HTTPException(status_code=status_code, detail=message)


def _require_ai_settings() -> None:
    if not settings.agent_api_key or not settings.agent_api_url or not settings.agent_model:
        raise HTTPException(status_code=503, detail="AI service is not configured")


def create_ai_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.agent_api_key,
        base_url=settings.agent_api_url,
        timeout=settings.agent_request_timeout_seconds,
        max_retries=settings.agent_max_retries,
    )


async def upload_file(client: AsyncOpenAI, file: "UploadFile") -> str:
    _require_ai_settings()
    try:
        await file.seek(0)
        uploaded_file = await client.files.create(
            file=(file.filename, file.file, file.content_type), purpose="assistants",
        )
        return uploaded_file.id
    except APIError as exc:
        _raise_upstream_error(exc.message)


async def delete_file(client: AsyncOpenAI, file_id: str) -> None:
    _require_ai_settings()
    try:
        await client.files.delete(file_id)
    except APIError as exc:
        _raise_upstream_error(exc.message)


async def _parse_structured(
    client: AsyncOpenAI,
    *,
    context: AIRequestContext,
    operation: Operation,
    file_id: str,
    text_format: type[StructuredModel],
    categories: str = "[]",
    facts: dict[str, str] | None = None,
    field_protocol: str = "[]",
    definitions: dict[str, str] | None = None,
    requirements: str = "",
) -> StructuredModel:
    _require_ai_settings()
    preview = build_conversation(
        context.prompts, operation, file_id, categories, facts, field_protocol,
        definitions, requirements,
    )
    conversation = [
        {"role": "system", "content": preview.instructions},
        *preview.messages,
    ]
    record = AIInteraction(
        project_id=context.project_id, operation=operation, model=settings.agent_model,
        created_at=datetime.now(timezone.utc), status="pending", conversation=conversation,
    )
    async with context.db.begin():
        context.db.add(record)
    # Do not let response assembly implicitly start a transaction during network I/O.
    context.db.expunge(record)
    started = perf_counter()
    try:
        try:
            raw_response = await client.responses.with_raw_response.parse(
                model=settings.agent_model, instructions=preview.instructions,
                input=preview.messages, text_format=text_format, store=False,
            )
            record.response = {"raw_text": raw_response.http_response.text}
            response_body = raw_response.http_response.json()
            if not isinstance(response_body, dict):
                _raise_upstream_error("AI response is not a JSON object")
            record.response = response_body
            output = response_body.get("output", [])
            if isinstance(output, list) and all(isinstance(item, dict) for item in output):
                record.conversation = [*conversation, *output]
            response = raw_response.parse()
        except APITimeoutError as exc:
            raise HTTPException(status_code=504, detail="AI request timeout") from exc
        except APIError as exc:
            record.response = {"error": exc.body}
            _raise_upstream_error(exc.message)
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="AI response parsing failed") from exc

        if response.status != "completed":
            _raise_upstream_error("AI response not completed")
        if response.output_parsed is None:
            _raise_upstream_error("AI response parsing failed")
        try:
            result = text_format.model_validate(response.output_parsed)
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="AI response parsing failed") from exc
        record.status = "completed"
        return result
    except BaseException as exc:
        # Persist failures/cancellation, then propagate them unchanged.
        record.status = "failed"
        record.error = str(exc)
        raise
    finally:
        record.duration_ms = max(0, round((perf_counter() - started) * 1000))
        async with context.db.begin():
            context.db.add(record)


async def validate_protocol(
    client: AsyncOpenAI, file_id: str, *, context: AIRequestContext,
) -> ValidationResult:
    return await _parse_structured(
        client, context=context, operation="validate", file_id=file_id,
        text_format=ValidationResult,
    )


async def search_fact(
    client: AsyncOpenAI, file_id: str, categories: str, *, context: AIRequestContext,
) -> FactOutList:
    return await _parse_structured(
        client, context=context, operation="extract", file_id=file_id,
        categories=categories, text_format=FactOutList,
    )


async def revise_fact(
    client: AsyncOpenAI, file_id: str, categories: str,
    facts: dict[str, str], requirements: str, *, context: AIRequestContext,
) -> FactOutList:
    return await _parse_structured(
        client, context=context, operation="revise_facts", file_id=file_id,
        categories=categories, facts=facts, requirements=requirements, text_format=FactOutList,
    )


async def generate_definition(
    client: AsyncOpenAI, file_id: str, categories: str,
    facts: dict[str, str], field_protocol: str, *, context: AIRequestContext,
) -> DefinitionOutList:
    return await _parse_structured(
        client, context=context, operation="generate", file_id=file_id,
        categories=categories, facts=facts, field_protocol=field_protocol,
        text_format=DefinitionOutList,
    )


async def regenerate_definition(
    client: AsyncOpenAI, file_id: str, categories: str,
    facts: dict[str, str], field_protocol: str, definitions: dict[str, str],
    requirements: str, *, context: AIRequestContext,
) -> DefinitionOutList:
    return await _parse_structured(
        client, context=context, operation="revise_definitions", file_id=file_id,
        categories=categories, facts=facts, field_protocol=field_protocol,
        definitions=definitions, requirements=requirements, text_format=DefinitionOutList,
    )
