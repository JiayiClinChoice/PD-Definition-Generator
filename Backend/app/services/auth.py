from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from configs import settings
from database import AsyncSessionFactory
from database.models import Account, AuthAttempt, LoginSession, User
from schemas import UserOut

COOKIE_NAME = "pd_session"
ITERATIONS = 600_000


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), ITERATIONS)
    return f"{salt}${digest.hex()}"


async def authenticate(request: Request) -> UserOut:
    token = request.cookies.get(COOKIE_NAME)
    if not token or len(token) > 128:
        raise HTTPException(401, "请先登录。")
    async with AsyncSessionFactory() as db, db.begin():
        account = await db.scalar(
            select(Account)
            .join(LoginSession, LoginSession.user_id == Account.user_id)
            .where(
                LoginSession.token_hash == hash_token(token),
                LoginSession.expires_at > now(),
            )
        )
        if account is None:
            raise HTTPException(401, "登录已过期，请重新登录。")
        return UserOut(id=account.user_id, username=account.username)


async def sign_in(
    request: Request, response: Response, username: str, password: str, *, register: bool
) -> UserOut:
    ip = request.client.host if request.client else "unknown"
    timestamp = now()
    window = max(settings.auth_throttle_window_minutes, settings.auth_throttle_cooldown_minutes)
    cutoff = timestamp - timedelta(minutes=window)
    async with AsyncSessionFactory() as db, db.begin():
        await db.execute(delete(AuthAttempt).where(AuthAttempt.created_at < cutoff))
        attempts = await db.scalar(
            select(func.count()).select_from(AuthAttempt).where(AuthAttempt.username == username)
        )
        ip_attempts = await db.scalar(
            select(func.count()).select_from(AuthAttempt).where(AuthAttempt.ip == ip)
        )
        if (attempts or 0) >= settings.auth_throttle_limit or (
            ip_attempts or 0
        ) >= settings.auth_ip_attempt_limit:
            raise HTTPException(429, "尝试次数过多，请稍后重试。", headers={"Retry-After": str(window * 60)})
        db.add(AuthAttempt(username=username, ip=ip, created_at=timestamp))

    async with AsyncSessionFactory() as db:
        try:
            async with db.begin():
                account = await db.scalar(select(Account).where(Account.username == username))
                if register:
                    if account is not None:
                        raise HTTPException(409, "用户名已被使用。")
                    user = User(user_key=f"account:{username}")
                    db.add(user)
                    await db.flush()
                    account = Account(
                        user_id=user.id,
                        username=username,
                        password_hash=await run_in_threadpool(hash_password, password),
                    )
                    db.add(account)
                else:
                    salt = account.password_hash.split("$")[0] if account else "0" * 32
                    candidate = await run_in_threadpool(hash_password, password, salt)
                    if account is None or not hmac.compare_digest(candidate, account.password_hash):
                        raise HTTPException(401, "用户名或密码不正确。")

                token = secrets.token_urlsafe(32)
                previous = request.cookies.get(COOKIE_NAME)
                await db.execute(
                    delete(LoginSession).where(
                        or_(
                            LoginSession.expires_at <= timestamp,
                            LoginSession.token_hash == hash_token(previous or ""),
                        )
                    )
                )
                db.add(LoginSession(
                    token_hash=hash_token(token),
                    user_id=account.user_id,
                    expires_at=timestamp + timedelta(days=settings.auth_session_days),
                ))
                await db.execute(delete(AuthAttempt).where(AuthAttempt.username == username))
                result = UserOut(id=account.user_id, username=account.username)
        except IntegrityError as exc:
            raise HTTPException(409, "用户名已被使用。") from exc

    response.set_cookie(
        COOKIE_NAME, token, httponly=True, secure=settings.auth_cookie_secure,
        samesite="strict", max_age=settings.auth_session_days * 86400, path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return result


async def sign_out(request: Request, response: Response) -> dict[str, str]:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        async with AsyncSessionFactory() as db, db.begin():
            await db.execute(delete(LoginSession).where(LoginSession.token_hash == hash_token(token)))
    response.delete_cookie(COOKIE_NAME, path="/", secure=settings.auth_cookie_secure, samesite="strict")
    response.headers["Cache-Control"] = "no-store"
    return {"status": "success"}
