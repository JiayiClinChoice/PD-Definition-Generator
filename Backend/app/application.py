from __future__ import annotations

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI

from ai.service import create_ai_client
from database import init_db
from configs import settings

from .api.router import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    app.state.client = None
    if settings.agent_api_key and settings.agent_api_url and settings.agent_model:
        async with create_ai_client() as client:
            app.state.client = client
            yield
    else:
        logging.getLogger(__name__).warning("AI service is not configured; account and project management remain available.")
        yield


def create_app() -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    app.include_router(api_router)
    return app
