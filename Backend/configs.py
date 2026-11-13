from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    app_host: str = "127.0.0.1"
    app_port: int = Field(default=8001, ge=1, le=65535)
    app_reload: bool = True

    agent_api_key: str = ""
    agent_api_url: str = ""
    agent_model: str = ""

    database_path: Path = BASE_DIR / "database" / "app.db"

    agent_max_file_size_bytes: int = Field(default=50 * 1024 * 1024, ge=1)
    agent_request_timeout_seconds: int = Field(default=300, ge=1)
    agent_max_retries: int = Field(default=2, ge=0, le=5)
    agent_claim_timeout_seconds: int = Field(default=1800, ge=1)

    auth_cookie_secure: bool = False
    auth_session_days: int = Field(default=14, ge=1)
    auth_throttle_limit: int = Field(default=5, ge=1)
    auth_throttle_window_minutes: int = Field(default=15, ge=1)
    auth_throttle_cooldown_minutes: int = Field(default=15, ge=1)
    auth_ip_attempt_limit: int = Field(default=30, ge=1)

    @field_validator("agent_api_key", "agent_api_url", "agent_model", mode="before")
    @classmethod
    def strip_ai_config(cls, value: str | None) -> str:
        return (value or "").strip()

    @field_validator("database_path")
    @classmethod
    def validate_database_path(cls, value: Path) -> Path:
        if not value.is_absolute():
            raise ValueError("DATABASE_PATH must be an absolute path.")
        return value

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
