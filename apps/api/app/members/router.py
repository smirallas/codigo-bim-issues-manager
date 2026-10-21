from typing import Literal

from fastapi import APIRouter, Query, Request

from app.members.service import AssigneeCheck, Capabilities, MemberList, MemberService
from app.projects.router import credentials

router = APIRouter(prefix="/projects/hubs/{hub_id}/{project_id}", tags=["members"])


@router.get("/members", response_model=MemberList)
def members(request: Request, hub_id: str, project_id: str) -> MemberList:
    _, access = credentials(request)
    service: MemberService = request.app.state.member_service
    return service.members(access, hub_id, project_id)


@router.get("/capabilities", response_model=Capabilities)
def capabilities(request: Request, hub_id: str, project_id: str) -> Capabilities:
    _, access = credentials(request)
    service: MemberService = request.app.state.member_service
    return service.capabilities(access, hub_id, project_id)


@router.get("/assignee-check", response_model=AssigneeCheck)
def assignee_check(
    request: Request,
    hub_id: str,
    project_id: str,
    query: str = Query(min_length=1, max_length=255),
    by: Literal["id", "name"] = "id",
) -> AssigneeCheck:
    _, access = credentials(request)
    service: MemberService = request.app.state.member_service
    return service.check_assignee(access, hub_id, project_id, query, by)
