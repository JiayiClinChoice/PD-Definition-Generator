from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class UserOut(BaseModel):
    id: int
    username: str


class AuthRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-z0-9._@-]+$")
    password: str = Field(min_length=3, max_length=128)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ProjectInitialOut(ORMModel):
    id: int
    name: str
    file_valid: int


class ProjectInfoOut(ORMModel):
    id: int
    name: str
    file_name: str | None
    file_valid: int
    title: str | None
    protocol_no: str | None
    version: str | None
    version_date: str | None
    sponsor: str | None


class ProtocolMetadata(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: Annotated[str, Field(min_length=1)]
    protocol_no: Annotated[str, Field(min_length=1)]
    version: Annotated[str, Field(min_length=1)]
    version_date: Annotated[str, Field(min_length=1)]
    sponsor: Annotated[str, Field(min_length=1)]


class ValidationResult(BaseModel):
    file_valid: bool
    meta_data: ProtocolMetadata | None = None

    @model_validator(mode="after")
    def validate_metadata(self) -> "ValidationResult":
        if self.file_valid and self.meta_data is None:
            raise ValueError("A valid protocol must include protocol metadata.")
        return self


class RequirementsUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    requirements: Annotated[str, Field(min_length=1)]


class PDCategoryUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    ord: Annotated[int, Field(ge=1)]
    name: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(min_length=1, max_length=400)]
    method: Annotated[str, Field(min_length=1, max_length=400)]


class PDCategoryUpdateList(BaseModel):
    categories: Annotated[list[PDCategoryUpdate], Field(min_length=1)]

    @model_validator(mode="after")
    def unique_categories(self) -> "PDCategoryUpdateList":
        if len({item.ord for item in self.categories}) != len(self.categories):
            raise ValueError("分类序号不能重复。")
        if len({item.name.casefold() for item in self.categories}) != len(self.categories):
            raise ValueError("分类名称不能重复。")
        return self


class FactOut(BaseModel):
    position: int
    pd_category_ord: int
    pd_category_name: str
    content: str
    source: str | None = None
    checked: Literal[0, 1] = 0


class FactOutList(BaseModel):
    facts: list[FactOut]


class FieldUpdate(BaseModel):
    ord: Annotated[int, Field(ge=1)]
    name: Annotated[str, Field(min_length=1)]
    label: str
    meaning: str
    required: bool
    allowed_values: list[str] = Field(default_factory=list)
    requirements: str | None = None
    example: list[str] = Field(default_factory=list)


class FieldUpdateList(BaseModel):
    fields: Annotated[list[FieldUpdate], Field(min_length=1)]

    @model_validator(mode="after")
    def unique_fields(self) -> "FieldUpdateList":
        if len({item.ord for item in self.fields}) != len(self.fields):
            raise ValueError("字段序号不能重复。")
        if len({item.name for item in self.fields}) != len(self.fields):
            raise ValueError("字段名称不能重复。")
        return self


class DefinitionOut(BaseModel):
    checked: Literal[0, 1] = 0
    position: int
    pd_category_name: str
    pd_ord: str
    requirements: str
    description: str
    review_method: str | None = None
    severity: str | None = None
    note: str | None = None


class DefinitionOutList(BaseModel):
    definitions: list[DefinitionOut]


class WorkspaceOut(BaseModel):
    project: ProjectInfoOut
    categories: list[PDCategoryUpdate]
    fields: list[FieldUpdate]
    facts: list[FactOut]
    definitions: list[DefinitionOut]
