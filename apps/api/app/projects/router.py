from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth.router import SESSION_COOKIE, auth_service
from app.auth.service import AuthFailure
from app.projects.service import ProjectFailure, ProjectService, ResourceList, Selection

router = APIRouter(prefix="/projects", tags=["projects"])


def credentials(request: Request) -> tuple[ProjectService, str]:
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        raise AuthFailure("unauthenticated")
    service: ProjectService = request.app.state.project_service
    return service, auth_service(request).authorized_access(session_id)


@router.get("/hubs", response_model=ResourceList)
def hubs(request: Request) -> ResourceList:
    service, access = credentials(request)
    return service.hubs(access)


@router.get("/hubs/{hub_id}", response_model=ResourceList)
def projects(request: Request, hub_id: str) -> ResourceList:
    service, access = credentials(request)
    return service.projects(access, hub_id)


@router.get("/hubs/{hub_id}/{project_id}", response_model=Selection)
def selection(request: Request, hub_id: str, project_id: str) -> Selection:
    """Valida un contexto de lectura; no persiste selección ni modifica Autodesk."""
    service, access = credentials(request)
    return service.select(access, hub_id, project_id)


async def project_error(request: Request, exc: ProjectFailure) -> JSONResponse:
    return JSONResponse({"error": exc.code}, status_code=exc.status)


async def auth_error(request: Request, exc: AuthFailure) -> JSONResponse:
    response = JSONResponse({"error": exc.code}, status_code=exc.status)
    if exc.status == 401 or exc.code == "access_denied":
        response.delete_cookie(SESSION_COOKIE, path="/")
    return response
