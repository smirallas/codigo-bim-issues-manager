import json
import secrets
import time

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.service import fingerprint
from app.imports.models import ImportPlan
from app.imports.schemas import ImportReview, ImportRow
from app.imports.workbook import parse
from app.issues.schemas import PlanInput
from app.issues.service import IssueService
from app.projects.service import ProjectFailure


class ImportService:
    def __init__(self, issues: IssueService):
        self.issues = issues

    def prepare(
        self, session: str, access: str, hub: str, project: str, data: bytes
    ) -> ImportReview:
        """Resuelve filas con E03/E04 sin escribir y cifra la revisión completa por sesión."""
        parsed = parse(data)
        selection = self.issues.members.projects.select(access, hub, project)
        options = self.issues.types(access, hub, project)
        members = None
        if any(values["responsable"] for _, values, _ in parsed):
            members = self.issues.members.members(access, hub, project).items
        rows = []
        for number, values, error in parsed:
            row = ImportRow(row=number, values=values, error=error)
            if error:
                rows.append(row)
                continue
            try:
                types = [
                    o
                    for o in options
                    if o.id == values["tipo"] or o.name.casefold() == values["tipo"].casefold()
                ]
                if len(types) != 1:
                    raise ProjectFailure("excel_type_not_unique", 422)
                assignee = None
                if values["responsable"]:
                    query = values["responsable"].casefold()
                    matches = [
                        m
                        for m in members or []
                        if query
                        in {
                            m.name.casefold(),
                            (m.email or "").casefold(),
                            (m.autodesk_id or "").casefold(),
                        }
                    ]
                    if len(matches) != 1 or not matches[0].autodesk_id:
                        raise ProjectFailure("excel_assignee_not_unique", 422)
                    assignee = matches[0].autodesk_id
                request = PlanInput(
                    operation="create",
                    title=values["titulo"],
                    description=values["descripcion"],
                    status=values["estado"],
                    subtype_id=types[0].id,
                    assignee_id=assignee,
                    due_date=values["fecha_limite"] or None,
                )
                row.plan = self.issues.prepare(session, access, hub, project, request)
            except ValueError:
                row.error = "excel_row_invalid"
            except ProjectFailure as exc:
                # Los fallos transitorios o de autenticación detienen la preparación completa.
                if exc.status >= 500 or exc.status in {401, 429}:
                    raise
                row.error = exc.code
            rows.append(row)
        expiry = min((r.plan.expires_at for r in rows if r.plan), default=int(time.time()) + 600)
        review = ImportReview(
            id=secrets.token_urlsafe(32),
            hub_id=hub,
            project_id=project,
            project_name=selection.project.name,
            expires_at=expiry,
            rows=rows,
        )
        with Session(self.issues.engine) as db, db.begin():
            db.add(
                ImportPlan(
                    id=review.id,
                    session_hash=fingerprint(session),
                    content_encrypted=self.issues._seal(review.model_dump_json()),
                    errors_encrypted=self.issues._seal("{}"),
                    expires_at=expiry,
                    approved_at=None,
                )
            )
        return review

    def review(self, session: str, identifier: str) -> ImportReview:
        """Reúne la revisión original y los resultados individuales sin reejecutar filas."""
        with Session(self.issues.engine) as db:
            row = db.get(ImportPlan, identifier)
            if row is None or row.session_hash != fingerprint(session):
                raise ProjectFailure("plan_unavailable", 404)
            review = ImportReview.model_validate_json(self.issues._open(row.content_encrypted))
            errors = json.loads(self.issues._open(row.errors_encrypted))
            review.approved_at = row.approved_at
        for item in review.rows:
            if item.plan:
                item.plan = self.issues.review(session, item.plan.id)
            item.error = errors.get(str(item.row), item.error)
        return review

    def approve(self, session: str, identifier: str) -> ImportReview:
        """Registra la aprobación del contenido inmutable mientras siga vigente."""
        review = self.review(session, identifier)
        if not any(r.plan and not r.error for r in review.rows):
            raise ProjectFailure("excel_no_valid_rows", 409)
        with Session(self.issues.engine) as db:
            db.execute(text("BEGIN IMMEDIATE"))
            row = db.get(ImportPlan, identifier)
            if row is None or row.session_hash != fingerprint(session):
                raise ProjectFailure("plan_unavailable", 404)
            if row.expires_at <= int(time.time()):
                raise ProjectFailure("plan_expired", 409)
            if row.approved_at is None:
                row.approved_at = int(time.time())
            db.commit()
        return self.review(session, identifier)

    def execute_row(self, session: str, access: str, identifier: str, number: int) -> ImportReview:
        """Ejecuta una fila del lote aprobado; conserva rechazos y no repite incertidumbres."""
        review = self.review(session, identifier)
        if review.approved_at is None:
            raise ProjectFailure("excel_approval_required", 409)
        item = next((r for r in review.rows if r.row == number), None)
        if item is None or item.plan is None:
            raise ProjectFailure("excel_row_blocked", 409)
        if item.error:
            return review
        try:
            # E04 reclama cada fila una sola vez, revalida permisos y conserva su resultado.
            self.issues.execute(session, access, item.plan.id)
        except ProjectFailure as exc:
            if exc.code == "plan_already_claimed":
                return self.review(session, identifier)
            # Un rechazo previo al envío queda registrado; nunca se vuelve a intentar esa fila.
            with Session(self.issues.engine) as db:
                db.execute(text("BEGIN IMMEDIATE"))
                row = db.get(ImportPlan, identifier)
                if row is None:
                    raise ProjectFailure("plan_unavailable", 404) from None
                errors = json.loads(self.issues._open(row.errors_encrypted))
                errors[str(number)] = exc.code
                row.errors_encrypted = self.issues._seal(json.dumps(errors))
                db.commit()
        return self.review(session, identifier)
