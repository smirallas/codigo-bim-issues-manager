import secrets
import time
from uuid import UUID

import httpx
from cryptography.fernet import Fernet
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.auth.service import fingerprint
from app.issues.models import IssuePlan
from app.issues.schemas import (
    Issue,
    IssuesPage,
    PlanContent,
    PlanInput,
    PlanReview,
    TypeOption,
    TypesPage,
    WriteResult,
)
from app.members.service import MemberService, construction_project_id
from app.projects.service import APS_ORIGIN, ProjectFailure


def issue_uuid(value: str) -> str:
    try:
        return str(UUID(value))
    except ValueError:
        raise ProjectFailure("invalid_resource", 400) from None


class IssueService:
    def __init__(
        self,
        engine: Engine,
        members: MemberService,
        key: str,
        transport: httpx.BaseTransport | None = None,
    ):
        self.engine = engine
        self.members = members
        self.key = key
        self.transport = transport

    def _seal(self, value: str) -> str:
        return Fernet(self.key.encode()).encrypt(value.encode()).decode()

    def _open(self, value: str) -> str:
        return Fernet(self.key.encode()).decrypt(value.encode()).decode()

    def _path(self, access: str, hub: str, project: str) -> str:
        clean = construction_project_id(project)
        self.members.projects.select(access, hub, project)
        return f"/construction/issues/v1/projects/{clean}"

    def _get(self, access: str, path: str) -> object:
        with httpx.Client(
            transport=self.transport, timeout=15, trust_env=False, follow_redirects=False
        ) as client:
            return self.members._get(client, path, access)

    def types(self, access: str, hub: str, project: str) -> list[TypeOption]:
        """Ofrece subtipos activos del catálogo completo, sin inferir permisos de edición."""
        path = self._path(access, hub, project)
        options: dict[str, TypeOption] = {}
        categories: set[str] = set()
        total: int | None = None
        offset = 0
        deadline = time.monotonic() + 30
        for _ in range(100):
            if time.monotonic() > deadline:
                raise ProjectFailure("aps_collection_too_large")
            try:
                page = TypesPage.model_validate(
                    self._get(
                        access, f"{path}/issue-types?include=subtypes&limit=100&offset={offset}"
                    )
                )
            except ValueError:
                raise ProjectFailure("aps_invalid_response") from None
            if page.pagination.offset != offset or len(page.results) > page.pagination.limit:
                raise ProjectFailure("aps_invalid_pagination")
            if total is not None and total != page.pagination.totalResults:
                raise ProjectFailure("aps_partial_response")
            total = page.pagination.totalResults
            if not page.results and offset < page.pagination.totalResults:
                raise ProjectFailure("aps_partial_response")
            for category in page.results:
                if category.id in categories:
                    raise ProjectFailure("aps_partial_response")
                categories.add(category.id)
                if category.isActive:
                    for subtype in category.subtypes:
                        # isReadOnly describe el catálogo; no autoriza crear incidencias.
                        if subtype.isActive:
                            identifier = issue_uuid(subtype.id)
                            options[identifier] = TypeOption(
                                id=identifier, name=f"{category.title} / {subtype.title}"
                            )
            offset += page.pagination.limit
            if offset >= page.pagination.totalResults:
                if len(categories) != page.pagination.totalResults:
                    raise ProjectFailure("aps_partial_response")
                return list(options.values())
        raise ProjectFailure("aps_collection_too_large")

    def list(self, access: str, hub: str, project: str, offset: int) -> IssuesPage:
        """Devuelve una página explícita; un fallo de Autodesk nunca se convierte en lista vacía."""
        path = self._path(access, hub, project)
        try:
            page = IssuesPage.model_validate(
                self._get(access, f"{path}/issues?limit=25&offset={offset}")
            )
        except ValueError:
            raise ProjectFailure("aps_invalid_response") from None
        if page.pagination.offset != offset or len(page.results) > page.pagination.limit:
            raise ProjectFailure("aps_invalid_pagination")
        if not page.results and offset < page.pagination.totalResults:
            raise ProjectFailure("aps_partial_response")
        return page

    def detail(self, access: str, hub: str, project: str, identifier: str) -> Issue:
        """Revalida el proyecto y obtiene campos y permisos de la incidencia concreta."""
        path = self._path(access, hub, project)
        identifier = issue_uuid(identifier)
        try:
            issue = Issue.model_validate(self._get(access, f"{path}/issues/{identifier}"))
        except ValueError:
            raise ProjectFailure("aps_invalid_response") from None
        if issue.id != identifier:
            raise ProjectFailure("aps_invalid_response")
        return issue

    def validate(self, access: str, hub: str, project: str, request: PlanInput) -> PlanContent:
        """Resuelve el contenido permitido para esta identidad, sin escribir en Autodesk."""
        selection = self.members.projects.select(access, hub, project)
        payload = request.payload()
        before = None
        assignee_name = subtype_name = None
        if request.operation == "create":
            caps = self.members.capabilities(access, hub, project)
            if not caps.can_create:
                raise ProjectFailure("issue_creation_not_permitted", 403)
            attributes, statuses = caps.permitted_attributes, caps.permitted_statuses
            options = self.types(access, hub, project)
            option = next((v for v in options if v.id == request.subtype_id), None)
            if option is None:
                raise ProjectFailure("issue_subtype_unavailable", 422)
            subtype_name = option.name
            if request.assignee_id:
                check = self.members.check_assignee(access, hub, project, request.assignee_id, "id")
                if not check.eligible:
                    raise ProjectFailure(check.reason, 403)
                assignee_name = check.member.name
        else:
            if request.issue_id is None:
                raise ProjectFailure("invalid_resource", 400)
            before = self.detail(access, hub, project, request.issue_id)
            if before.deleted:
                raise ProjectFailure("issue_deleted", 403)
            attributes, statuses = before.permittedAttributes, before.permittedStatuses
            payload = {
                key: value for key, value in payload.items() if getattr(before, key) != value
            }
            if not payload:
                raise ProjectFailure("issue_no_changes", 422)
        if not set(payload).issubset(attributes):
            raise ProjectFailure("issue_fields_not_permitted", 403)
        if "status" in payload and payload["status"] not in statuses:
            raise ProjectFailure("issue_status_not_permitted", 403)
        return PlanContent(
            hub_id=hub,
            project_id=project,
            project_name=selection.project.name,
            request=request,
            payload=payload,
            before=before,
            assignee_name=assignee_name,
            subtype_name=subtype_name,
        )

    def prepare(
        self, session_id: str, access: str, hub: str, project: str, request: PlanInput
    ) -> PlanReview:
        """Guarda una revisión inmutable cifrada, privada por sesión y válida diez minutos."""
        content = self.validate(access, hub, project, request)
        now = int(time.time())
        row = IssuePlan(
            id=secrets.token_urlsafe(32),
            session_hash=fingerprint(session_id),
            content_encrypted=self._seal(content.model_dump_json()),
            expires_at=now + 600,
            state="prepared",
            approved_at=None,
            result_encrypted=None,
        )
        identifier = row.id
        with Session(self.engine) as db, db.begin():
            db.add(row)
        return PlanReview(id=identifier, expires_at=now + 600, state="prepared", content=content)

    def review(self, session_id: str, plan_id: str) -> PlanReview:
        """Recupera la revisión y su resultado para el propietario sin repetir el envío."""
        with Session(self.engine) as db:
            row = db.get(IssuePlan, plan_id)
            if row is None or row.session_hash != fingerprint(session_id):
                raise ProjectFailure("plan_unavailable", 404)
            content = PlanContent.model_validate_json(self._open(row.content_encrypted))
            result = (
                WriteResult.model_validate_json(self._open(row.result_encrypted))
                if row.result_encrypted
                else None
            )
            return PlanReview(
                id=row.id,
                expires_at=row.expires_at,
                state=row.state,
                content=content,
                result=result,
            )

    def execute(self, session_id: str, access: str, plan_id: str) -> WriteResult:
        """Revalida, reclama una vez la revisión aprobada y conserva incluso la incertidumbre."""
        review = self.review(session_id, plan_id)
        if review.state != "prepared":
            return review.result or WriteResult(state="running", error="plan_already_claimed")
        if review.expires_at <= int(time.time()):
            raise ProjectFailure("plan_expired", 409)
        content = review.content
        fresh = self.validate(access, content.hub_id, content.project_id, content.request)
        if fresh.payload != content.payload or fresh.before != content.before:
            raise ProjectFailure("issue_changed_review_again", 409)
        # Solo una petición reclama la preparación. Reiniciar tras un envío no lo repite.
        with Session(self.engine) as db:
            db.execute(text("BEGIN IMMEDIATE"))
            row = db.get(IssuePlan, plan_id)
            if row is None or row.state != "prepared":
                raise ProjectFailure("plan_already_claimed", 409)
            if row.expires_at <= int(time.time()):
                raise ProjectFailure("plan_expired", 409)
            row.state = "running"
            row.approved_at = int(time.time())
            db.commit()
        result = self._write(access, content)
        with Session(self.engine) as db, db.begin():
            row = db.get(IssuePlan, plan_id)
            if row is None:
                raise ProjectFailure("plan_unavailable", 404)
            row.state = result.state
            row.result_encrypted = self._seal(result.model_dump_json())
        return result

    def _write(self, access: str, content: PlanContent) -> WriteResult:
        project = construction_project_id(content.project_id)
        path = f"{APS_ORIGIN}/construction/issues/v1/projects/{project}/issues"
        method = "POST"
        if content.request.operation == "update":
            if content.request.issue_id is None:
                raise ProjectFailure("invalid_resource", 400)
            path += "/" + issue_uuid(content.request.issue_id)
            method = "PATCH"
        try:
            with httpx.Client(
                transport=self.transport, timeout=20, trust_env=False, follow_redirects=False
            ) as client:
                response = client.request(
                    method,
                    path,
                    headers={"Authorization": f"Bearer {access}"},
                    json=content.payload,
                )
            if 400 <= response.status_code < 500 and response.status_code != 408:
                code = {
                    401: "aps_reconnect_required",
                    403: "aps_issue_write_denied",
                    429: "aps_rate_limited",
                }.get(response.status_code, "aps_issue_payload_rejected")
                return WriteResult(state="rejected", error=code)
            expected = 201 if method == "POST" else 200
            if response.status_code != expected:
                return WriteResult(state="uncertain", error="issue_write_uncertain")
            issue = Issue.model_validate(response.json())
            issue_uuid(issue.id)
            if content.request.issue_id and issue.id != content.request.issue_id:
                return WriteResult(state="uncertain", error="issue_write_uncertain")
        except (httpx.HTTPError, ValueError, ProjectFailure):
            return WriteResult(state="uncertain", error="issue_write_uncertain")
        # La relectura distingue el acuse de escritura del estado observado después.
        try:
            observed = self.detail(access, content.hub_id, content.project_id, issue.id)
            verified = all(
                getattr(observed, key) == value for key, value in content.payload.items()
            )
            return WriteResult(
                state="succeeded", issue_id=issue.id, issue=observed, verified=verified
            )
        except ProjectFailure:
            return WriteResult(
                state="succeeded", issue_id=issue.id, issue=issue, error="issue_reread_failed"
            )
