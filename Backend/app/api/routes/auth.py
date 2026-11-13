from fastapi import APIRouter, Depends, Request, Response

from app.services.auth import authenticate, sign_in, sign_out
from schemas import AuthRequest, UserOut

router = APIRouter(prefix="/auth", tags=["Account"])


@router.post("/register", response_model=UserOut)
async def register(body: AuthRequest, request: Request, response: Response) -> UserOut:
    return await sign_in(request, response, body.username, body.password, register=True)


@router.post("/login", response_model=UserOut)
async def login(body: AuthRequest, request: Request, response: Response) -> UserOut:
    return await sign_in(request, response, body.username, body.password, register=False)


@router.get("/me", response_model=UserOut)
async def me(response: Response, user: UserOut = Depends(authenticate)) -> UserOut:
    response.headers["Cache-Control"] = "no-store"
    return user


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, str]:
    return await sign_out(request, response)
