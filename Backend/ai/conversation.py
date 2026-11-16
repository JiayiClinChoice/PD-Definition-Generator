from __future__ import annotations

import json
from string import Template
from openai.types.responses import EasyInputMessageParam
from openai.types.responses.response_input_param import ResponseInputParam

from ai.prompt import Operation
from schemas import ProjectPrompts, PromptPreview


def build_conversation(
    prompts: ProjectPrompts,
    operation: Operation,
    file_id: str,
    categories: str = "[]",
    facts: dict[str, str] | None = None,
    field_protocol: str = "[]",
    definitions: dict[str, str] | None = None,
    requirements: str = "",
) -> PromptPreview:
    facts = facts if facts is not None else {"all": "[]", "checked": "[]"}
    definitions = definitions if definitions is not None else {"all": "[]", "checked": "[]"}

    def render(key: str, **values: str) -> str:
        return Template(getattr(prompts, key)).substitute(**values)

    def user(text: str) -> EasyInputMessageParam:
        return {"role": "user", "content": [{"type": "input_text", "text": text}]}

    first = render("validation") if operation == "validate" else render("extract", categories=categories)
    messages: ResponseInputParam = [{
        "role": "user",
        "content": [
            {"type": "input_file", "file_id": file_id},
            {"type": "input_text", "text": first},
        ],
    }]
    if operation in {"revise_facts", "generate", "revise_definitions"}:
        messages.append({
            "role": "assistant",
            "content": json.dumps({"facts": json.loads(facts["all"])}, ensure_ascii=False),
        })
    if operation == "revise_facts":
        messages.append(user(render(
            "revise_facts", requirements=requirements, checked_facts=facts["checked"],
        )))
    if operation in {"generate", "revise_definitions"}:
        messages.append(user(render("generate", field_protocol=field_protocol)))
    if operation == "revise_definitions":
        messages.append({
            "role": "assistant",
            "content": json.dumps({"definitions": json.loads(definitions["all"])}, ensure_ascii=False),
        })
        messages.append(user(render(
            "revise_definitions", requirements=requirements,
            checked_definitions=definitions["checked"],
        )))
    return PromptPreview(instructions=render("system"), messages=messages)
