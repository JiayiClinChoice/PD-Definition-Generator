from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from . import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_key: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)

    projects: Mapped[list["Project"]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class Account(Base):
    __tablename__ = "accounts"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)


class LoginSession(Base):
    __tablename__ = "login_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AuthAttempt(Base):
    __tablename__ = "auth_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    ip: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")

    file_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    agent_response_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    agent_operate_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    agent_operate_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    file_valid: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str | None] = mapped_column(String(400), nullable=True)
    protocol_no: Mapped[str | None] = mapped_column(String(200), nullable=True)
    version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    version_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sponsor: Mapped[str | None] = mapped_column(String(200), nullable=True)

    owner: Mapped["User"] = relationship(back_populates="projects")
    pd_categories: Mapped[list["PDCategory"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )
    pd_definitions: Mapped[list["PDDefinition"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    field_protocol: Mapped[list["FieldProtocol"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )


class PDCategory(Base):
    __tablename__ = "pd_categories"

    project_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    ord: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(400), nullable=False, default="")
    method: Mapped[str | None] = mapped_column(String(400), nullable=True)

    project: Mapped["Project"] = relationship(back_populates="pd_categories")
    facts: Mapped[list["Fact"]] = relationship(
        back_populates="pd_category",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class ProjectPrompt(Base):
    __tablename__ = "project_prompts"

    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)


class AIInteraction(Base):
    __tablename__ = "ai_interactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    operation: Mapped[str] = mapped_column(String(40), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    conversation: Mapped[list[dict]] = mapped_column(JSON, nullable=False)
    response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Fact(Base):
    __tablename__ = "facts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["pd_category_ord", "project_id"],
            ["pd_categories.ord", "pd_categories.project_id"],
            ondelete="CASCADE",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pd_category_ord: Mapped[int] = mapped_column(Integer, nullable=False)
    pd_category_name: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False, default="")
    source: Mapped[str | None] = mapped_column(String(400), nullable=True)
    checked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    pd_category: Mapped["PDCategory"] = relationship(back_populates="facts")


class FieldProtocol(Base):
    __tablename__ = "field_protocols"

    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    ord: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=True)
    meaning: Mapped[str] = mapped_column(String, nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    allowed_values: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    requirements: Mapped[str] = mapped_column(String, nullable=True)
    example: Mapped[list[str]] = mapped_column(JSON, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="field_protocol")


class PDDefinition(Base):
    __tablename__ = "pd_definitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pd_category_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    pd_ord: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    requirements: Mapped[str | None] = mapped_column(String, nullable=False, default="")
    description: Mapped[str] = mapped_column(String, nullable=False, default="")
    review_method: Mapped[str] = mapped_column(String(100), nullable=True)
    severity: Mapped[str] = mapped_column(String(50), nullable=True)
    note: Mapped[str] = mapped_column(String, nullable=True)
    checked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    project: Mapped["Project"] = relationship(back_populates="pd_definitions")
