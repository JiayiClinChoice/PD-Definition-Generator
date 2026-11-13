from __future__ import annotations

import json
from typing import TYPE_CHECKING, NoReturn, TypeVar

from fastapi import HTTPException
from openai import APIError, APITimeoutError, AsyncOpenAI
from pydantic import BaseModel

from configs import settings
from schemas import DefinitionOutList, FactOutList, ValidationResult

from . import prompt

if TYPE_CHECKING:
    from fastapi import UploadFile


StructuredModel = TypeVar("StructuredModel", bound=BaseModel)


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
            file=(file.filename, file.file, file.content_type),
            purpose="assistants",
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
    messages: list[dict],
    text_format: type[StructuredModel],
) -> StructuredModel:
    _require_ai_settings()
    request = {
        "model": settings.agent_model,
        "instructions": prompt.SYSTEM0,
        "input": messages,
        "text_format": text_format,
        "store": False,
    }

    try:
        response = await client.responses.parse(**request)
    except APITimeoutError as exc:
        raise HTTPException(status_code=504, detail="AI request timeout") from exc
    except APIError as exc:
        _raise_upstream_error(exc.message)

    if response.status != "completed":
        _raise_upstream_error("AI response not completed")
    if response.output_parsed is None:
        _raise_upstream_error("AI response parsing failed")

    return text_format.model_validate(response.output_parsed)


async def validate_protocol(client: AsyncOpenAI, file_id: str) -> ValidationResult:
    return await _parse_structured(
        client,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "input_file", "file_id": file_id},
                    {"type": "input_text", "text": prompt.VALID0},
                ],
            }
        ],
        text_format=ValidationResult,
    )


async def search_fact(client: AsyncOpenAI, file_id: str, categories: str) -> FactOutList:
    return await _parse_structured(
        client,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "input_file", "file_id": file_id},
                    {
                        "type": "input_text",
                        "text": prompt.GET_FACT0.substitute(categories=categories),
                    },
                ],
            }
        ],
        text_format=FactOutList,
    )


async def revise_fact(
    client: AsyncOpenAI,
    file_id: str,
    categories: str,
    facts: dict[str, str],
    requirements: str,
) -> FactOutList:
    return await _parse_structured(
        client,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "input_file", "file_id": file_id},
                    {
                        "type": "input_text",
                        "text": prompt.GET_FACT0.substitute(categories=categories),
                    },
                ],
            },
            {
                "role": "assistant",
                "content": json.dumps({"facts": json.loads(facts["all"])}, ensure_ascii=False),
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": prompt.GET_FACT1.substitute(
                            requirements=requirements,
                            checked_facts=facts["checked"],
                        ),
                    }
                ],
            },
        ],
        text_format=FactOutList,
    )


async def generate_definition(
    client: AsyncOpenAI,
    file_id: str,
    categories: str,
    facts: dict[str, str],
    field_protocol: str,
) -> DefinitionOutList:
    return await _parse_structured(
        client,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "input_file", "file_id": file_id},
                    {
                        "type": "input_text",
                        "text": prompt.GET_FACT0.substitute(categories=categories),
                    },
                ],
            },
            {
                "role": "assistant",
                "content": json.dumps({"facts": json.loads(facts["all"])}, ensure_ascii=False),
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": prompt.GET_DEFINITION0.substitute(field_protocol=field_protocol),
                    }
                ],
            },
        ],
        text_format=DefinitionOutList,
    )


async def regenerate_definition(
    client: AsyncOpenAI,
    file_id: str,
    categories: str,
    facts: dict[str, str],
    field_protocol: str,
    definitions: dict[str, str],
    requirements: str,
) -> DefinitionOutList:
    return await _parse_structured(
        client,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "input_file", "file_id": file_id},
                    {
                        "type": "input_text",
                        "text": prompt.GET_FACT0.substitute(categories=categories),
                    },
                ],
            },
            {
                "role": "assistant",
                "content": json.dumps({"facts": json.loads(facts["all"])}, ensure_ascii=False),
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": prompt.GET_DEFINITION0.substitute(field_protocol=field_protocol),
                    }
                ],
            },
            {
                "role": "assistant",
                "content": json.dumps(
                    {"definitions": json.loads(definitions["all"])},
                    ensure_ascii=False,
                ),
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": prompt.GET_PD_DEFINITION1.substitute(
                            requirements=requirements,
                            checked_definitions=definitions["checked"],
                        ),
                    }
                ],
            },
        ],
        text_format=DefinitionOutList,
    )
