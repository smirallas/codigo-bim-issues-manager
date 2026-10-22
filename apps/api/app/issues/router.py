import secrets

from fastapi import APIRouter, Query, Request

from app.auth.router import SESSION_COOKIE, auth_service
from app.auth.service import AuthFailure
from app.issues.schemas import Issue, IssuesPage, PlanInput, PlanReview, TypeOption, WriteResult
from app.issues.service import IssueService
from app.projects.router import credentials

router = APIRouter(prefix="/projects", tags=["issues"])
CONTEXT = "/hubs/{hub_id}/{project_id}"


def service(request: Request) -> IssueService:
    result: IssueService = request.app.state.issue_service
    return result


def write_access(request: Request) -> tuple[str, str]:
    auth = auth_service(request)
    if request.headers.get("origin") != auth.settings.web_origin.rstrip("/"):
        raise AuthFailure("invalid_origin", 403)
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        raise AuthFailure("unauthenticated")
    info, access = auth._validated_session(session_id)
    if not secrets.compare_digest(
        info.csrf_token.encode(), request.headers.get("x-csrf-token", "").encode()
    ):
        raise AuthFailure("invalid_csrf", 403)
    return session_id, access


@router.get(CONTEXT + "/issue-types", response_model=list[TypeOption])
def types(request: Request, hub_id: str, project_id: str) -> list[TypeOption]:
    _, access = credentials(request)
    return service(request).types(access, hub_id, project_id)


@router.get(CONTEXT + "/issues", response_model=IssuesPage)
def issues(
    request: Request, hub_id: str, project_id: str, offset: int = Query(default=0, ge=0, le=100000)
) -> IssuesPage:
    _, access = credentials(request)
    return service(request).list(access, hub_id, project_id, offset)


@router.get(CONTEXT + "/issues/{issue_id}", response_model=Issue)
def detail(request: Request, hub_id: str, project_id: str, issue_id: str) -> Issue:
    _, access = credentials(request)
    return service(request).detail(access, hub_id, project_id, issue_id)


@router.post(CONTEXT + "/issue-plans", response_model=PlanReview)
def prepare(request: Request, hub_id: str, project_id: str, body: PlanInput) -> PlanReview:
    session_id, access = write_access(request)
    return service(request).prepare(session_id, access, hub_id, project_id, body)


@router.get("/issue-plans/{plan_id}", response_model=PlanReview)
def review(request: Request, plan_id: str) -> PlanReview:
    credentials(request)
    return service(request).review(request.cookies[SESSION_COOKIE], plan_id)


@router.post("/issue-plans/{plan_id}/execute", response_model=WriteResult)
def execute(request: Request, plan_id: str) -> WriteResult:
    session_id, access = write_access(request)
    return service(request).execute(session_id, access, plan_id)
