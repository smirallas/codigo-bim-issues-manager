from fastapi import APIRouter, Request, Response

from app.imports.schemas import ImportReview
from app.imports.service import ImportService
from app.imports.workbook import MAX_BYTES, template
from app.issues.router import write_access
from app.projects.router import credentials, owner_session
from app.projects.service import ProjectFailure

router = APIRouter(prefix="/projects", tags=["imports"])


def service(request: Request) -> ImportService:
    return ImportService(request.app.state.issue_service)


@router.get("/imports/template")
def download_template(request: Request) -> Response:
    credentials(request)
    return Response(
        template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="incidencias.xlsx"'},
    )


@router.post("/hubs/{hub_id}/{project_id}/imports", response_model=ImportReview)
async def prepare(request: Request, hub_id: str, project_id: str) -> ImportReview:
    session, access = write_access(request)
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise ProjectFailure("excel_size_limit", 413)
    # La lectura y APS síncronos se ejecutan fuera del bucle asíncrono.
    from starlette.concurrency import run_in_threadpool

    return await run_in_threadpool(
        service(request).prepare, session, access, hub_id, project_id, bytes(data)
    )


@router.get("/imports/{identifier}", response_model=ImportReview)
def review(request: Request, identifier: str) -> ImportReview:
    credentials(request)
    return service(request).review(owner_session(request), identifier)


@router.post("/imports/{identifier}/approve", response_model=ImportReview)
def approve(request: Request, identifier: str) -> ImportReview:
    session, _ = write_access(request)
    return service(request).approve(session, identifier)


@router.post("/imports/{identifier}/rows/{number}/execute", response_model=ImportReview)
def execute(request: Request, identifier: str, number: int) -> ImportReview:
    session, access = write_access(request)
    return service(request).execute_row(session, access, identifier, number)
