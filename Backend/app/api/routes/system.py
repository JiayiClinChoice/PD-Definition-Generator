from fastapi import APIRouter

router = APIRouter(tags=["System"])


@router.get("/healthz")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
