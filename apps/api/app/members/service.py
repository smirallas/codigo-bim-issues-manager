import time
from typing import Literal
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field

from app.projects.service import APS_ORIGIN, ProjectFailure, ProjectService


class Member(BaseModel):
    id: str
    autodesk_id: str | None
    name: str
    email: str | None
    company_id: str | None
    company_name: str | None
    status: str
    project_admin: bool | None
    account_admin: bool | None


class MemberList(BaseModel):
    items: list[Member]


class Capabilities(BaseModel):
    user_id: str
    project_admin: bool
    permission_levels: list[str]
    can_create: bool
    assignment: Literal["all", "same_company", "unavailable"]
    permitted_actions: list[str]
    permitted_attributes: list[str]
    permitted_statuses: list[str]


class AssigneeCheck(BaseModel):
    member: Member
    eligible: bool
    reason: str


class AccessLevels(BaseModel):
    model_config = ConfigDict(strict=True)
    projectAdmin: bool | None = None
    accountAdmin: bool | None = None


class ProjectUser(BaseModel):
    model_config = ConfigDict(strict=True)
    id: str = Field(min_length=1, max_length=255)
    autodeskId: str | None = Field(default=None, max_length=255)
    name: str = Field(default="", max_length=1024)
    firstName: str = Field(default="", max_length=255)
    lastName: str = Field(default="", max_length=255)
    email: str | None = Field(default=None, max_length=320)
    companyId: str | None = Field(default=None, max_length=255)
    companyName: str | None = Field(default=None, max_length=1024)
    status: str = Field(min_length=1, max_length=100)
    accessLevels: AccessLevels = Field(default_factory=AccessLevels)

    def public(self) -> Member:
        # No enviamos direcciones, teléfonos ni otros datos del perfil administrativo.
        return Member(
            id=self.id,
            autodesk_id=self.autodeskId or None,
            name=self.name or f"{self.firstName} {self.lastName}".strip() or "Sin nombre",
            email=self.email,
            company_id=self.companyId or None,
            company_name=self.companyName,
            status=self.status,
            project_admin=self.accessLevels.projectAdmin,
            account_admin=self.accessLevels.accountAdmin,
        )


class Pagination(BaseModel):
    model_config = ConfigDict(strict=True)
    limit: int = Field(gt=0, le=200)
    offset: int = Field(ge=0)
    totalResults: int = Field(ge=0, le=10000)


class MembersPage(BaseModel):
    results: list[ProjectUser]
    pagination: Pagination


class NewIssue(BaseModel):
    model_config = ConfigDict(strict=True)
    permittedActions: list[str] = Field(default_factory=list, max_length=200)
    permittedAttributes: list[str] = Field(default_factory=list, max_length=200)
    permittedStatuses: list[str] = Field(default_factory=list, max_length=200)


class IssuePermissions(BaseModel):
    new: NewIssue | None = None


class IssuesProfile(BaseModel):
    model_config = ConfigDict(strict=True)
    id: str = Field(min_length=1, max_length=255)
    isProjectAdmin: bool = False
    permissionLevels: list[str] = Field(default_factory=list, max_length=100)
    issues: IssuePermissions = Field(default_factory=IssuePermissions)


def construction_project_id(value: str) -> str:
    """Convierte solo el ID que estas dos APIs exigen sin el prefijo de Data Management."""
    if not value.startswith("b."):
        raise ProjectFailure("invalid_resource", 400)
    try:
        return str(UUID(value[2:]))
    except ValueError:
        raise ProjectFailure("invalid_resource", 400) from None


class MemberService:
    def __init__(self, projects: ProjectService, transport: httpx.BaseTransport | None = None):
        self.projects = projects
        self.transport = transport

    def _get(self, client: httpx.Client, path: str, access: str) -> object:
        try:
            response = client.get(APS_ORIGIN + path, headers={"Authorization": f"Bearer {access}"})
            codes = {
                401: "aps_reconnect_required",
                403: "aps_members_access_denied"
                if "/admin/" in path
                else "aps_issues_access_denied",
                404: "resource_unavailable",
                429: "aps_rate_limited",
            }
            if response.status_code in codes:
                raise ProjectFailure(codes[response.status_code], response.status_code)
            if response.status_code != 200:
                raise ProjectFailure("aps_unavailable")
            return response.json()
        except httpx.HTTPError:
            raise ProjectFailure("aps_unavailable") from None
        except ValueError:
            raise ProjectFailure("aps_invalid_response") from None

    def _members(self, access: str, project_id: str) -> MemberList:
        items: dict[str, Member] = {}
        offset = 0
        deadline = time.monotonic() + 20
        with httpx.Client(
            transport=self.transport, timeout=10, trust_env=False, follow_redirects=False
        ) as client:
            for _ in range(100):
                if time.monotonic() >= deadline:
                    raise ProjectFailure("aps_collection_too_large")
                data = self._get(
                    client,
                    f"/construction/admin/v1/projects/{project_id}/users?limit=100&offset={offset}",
                    access,
                )
                try:
                    page = MembersPage.model_validate(data)
                except ValueError:
                    raise ProjectFailure("aps_invalid_response") from None
                if page.pagination.offset != offset or len(page.results) > page.pagination.limit:
                    raise ProjectFailure("aps_invalid_pagination")
                for member in page.results:
                    public = member.public()
                    if member.id in items and items[member.id] != public:
                        raise ProjectFailure("aps_partial_response")
                    items[member.id] = public
                offset += page.pagination.limit
                if offset >= page.pagination.totalResults:
                    if len(items) != page.pagination.totalResults:
                        raise ProjectFailure("aps_partial_response")
                    return MemberList(items=list(items.values()))
                # Se construye la siguiente consulta localmente; nunca se sigue una URL ajena.
            raise ProjectFailure("aps_collection_too_large")

    def _capabilities(self, access: str, project_id: str) -> Capabilities:
        with httpx.Client(
            transport=self.transport, timeout=10, trust_env=False, follow_redirects=False
        ) as client:
            data = self._get(
                client, f"/construction/issues/v1/projects/{project_id}/users/me", access
            )
        try:
            profile = IssuesProfile.model_validate(data)
        except ValueError:
            raise ProjectFailure("aps_invalid_response") from None
        new = profile.issues.new
        can_create = new is not None and "create" in profile.permissionLevels
        actions = new.permittedActions if new else []
        attributes = new.permittedAttributes if new else []
        assignment: Literal["all", "same_company", "unavailable"] = "unavailable"
        # Ser administrador no sustituye las capacidades devueltas por Issues.
        if can_create and {"assignedTo", "assignedToType"}.issubset(attributes):
            if "assign_all" in actions:
                assignment = "all"
            elif "assign_same_company" in actions:
                assignment = "same_company"
        return Capabilities(
            user_id=profile.id,
            project_admin=profile.isProjectAdmin,
            permission_levels=profile.permissionLevels,
            can_create=can_create,
            assignment=assignment,
            permitted_actions=actions,
            permitted_attributes=attributes,
            permitted_statuses=new.permittedStatuses if new else [],
        )

    def members(self, access: str, hub_id: str, project_id: str) -> MemberList:
        clean = construction_project_id(project_id)
        self.projects.select(access, hub_id, project_id)
        return self._members(access, clean)

    def capabilities(self, access: str, hub_id: str, project_id: str) -> Capabilities:
        clean = construction_project_id(project_id)
        self.projects.select(access, hub_id, project_id)
        return self._capabilities(access, clean)

    def check_assignee(
        self, access: str, hub_id: str, project_id: str, query: str, by: Literal["id", "name"]
    ) -> AssigneeCheck:
        """Comprueba un posible responsable de una incidencia nueva, sin asignarla ni crearla."""
        clean = construction_project_id(project_id)
        self.projects.select(access, hub_id, project_id)
        members = self._members(access, clean).items
        matches = [
            member
            for member in members
            if (
                member.autodesk_id == query
                if by == "id"
                else member.name.casefold() == query.casefold()
            )
        ]
        if not matches:
            raise ProjectFailure("assignee_not_found", 404)
        if len(matches) != 1:
            raise ProjectFailure("assignee_ambiguous", 409)
        target = matches[0]
        profile = self._capabilities(access, clean)
        reason = "eligible"
        if target.status != "active" or not target.autodesk_id:
            reason = "assignee_inactive"
        elif not profile.can_create:
            reason = "issue_creation_not_permitted"
        elif profile.assignment == "unavailable":
            reason = "assignment_not_confirmed"
        elif profile.assignment == "same_company":
            current = [
                m for m in members if m.autodesk_id == profile.user_id and m.status == "active"
            ]
            if len(current) != 1 or not current[0].company_id or not target.company_id:
                reason = "company_not_confirmed"
            elif current[0].company_id != target.company_id:
                reason = "assignment_other_company"
        return AssigneeCheck(member=target, eligible=reason == "eligible", reason=reason)
