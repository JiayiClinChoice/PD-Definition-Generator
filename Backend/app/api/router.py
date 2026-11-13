from fastapi import APIRouter, Depends

from .dependencies import require_same_site_request
from .routes.auth import router as auth_router
from .routes.projects import router as project_router
from .routes.system import router as system_router

api_router = APIRouter(dependencies=[Depends(require_same_site_request)])
api_router.include_router(auth_router)
api_router.include_router(system_router)
api_router.include_router(project_router)
