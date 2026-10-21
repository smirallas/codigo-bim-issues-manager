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
from app.auth.service import AuthFailure, AuthService
from app.config import Settings
from app.database import check_database, create_database_engine
from app.logging import protect_access_logs
from app.members.router import router as members_router
from app.members.service import MemberService
from app.migrations import migrate_database
from app.projects.router import auth_error, project_error
from app.projects.router import router as projects_router
from app.projects.service import ProjectFailure, ProjectService


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
    """Compone E03; el transporte inyectable permite probar APS sin credenciales reales."""
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
            app.state.project_service = ProjectService(provider_transport)
            app.state.member_service = MemberService(app.state.project_service, provider_transport)
            yield
        finally:
            engine.dispose()

    app = FastAPI(title="Issues Manager API", version="0.0.0", lifespan=lifespan)
    protect_access_logs()
    app.include_router(auth_router)
    app.include_router(projects_router)
    app.include_router(members_router)
    app.add_exception_handler(ProjectFailure, project_error)  # type: ignore[arg-type]
    app.add_exception_handler(AuthFailure, auth_error)  # type: ignore[arg-type]

    @app.exception_handler(OperationalError)
    async def database_busy(_request: Request, _error: OperationalError) -> JSONResponse:
        return JSONResponse({"error": "temporarily_unavailable"}, status_code=503)

    @app.middleware("http")
    async def auth_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        if request.url.path.startswith(("/auth/", "/projects/")):
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
