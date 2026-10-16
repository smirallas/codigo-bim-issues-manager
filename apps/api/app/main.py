from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Literal

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.auth.provider import AutodeskProvider
from app.auth.router import router as auth_router
from app.auth.service import AuthService
from app.config import Settings
from app.database import check_database, create_database_engine
from app.logging import protect_access_logs
from app.migrations import migrate_database


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["api"] = "api"


class ReadyResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: dict[str, str]


def create_app(
    settings: Settings | None = None,
    provider_transport: httpx.BaseTransport | None = None,
) -> FastAPI:
    """Compone E01; el transporte inyectable permite probar OAuth sin credenciales reales."""
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_database_engine(config.database_url)
        app.state.database_engine = engine
        try:
            migrate_database(engine)
            app.state.auth_service = AuthService(
                engine, config, AutodeskProvider(config, provider_transport)
            )
            yield
        finally:
            engine.dispose()

    app = FastAPI(title="Issues Manager API", version="0.0.0", lifespan=lifespan)
    protect_access_logs()
    app.include_router(auth_router)

    @app.exception_handler(OperationalError)
    async def database_busy(_request: Request, _error: OperationalError) -> JSONResponse:
        return JSONResponse({"error": "temporarily_unavailable"}, status_code=503)

    @app.middleware("http")
    async def auth_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/auth/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/health")
    def health() -> HealthResponse:
        """Indica que la API responde, sin atribuirle conectividad con Autodesk."""
        return HealthResponse()

    @app.get("/ready")
    def ready(response: Response) -> ReadyResponse:
        """Distingue un proceso vivo de una conexión SQLite disponible."""
        try:
            check_database(app.state.database_engine)
        except SQLAlchemyError:
            response.status_code = 503
            return ReadyResponse(status="not_ready", checks={"database": "error"})
        return ReadyResponse(status="ready", checks={"database": "ok"})

    return app


app = create_app()
