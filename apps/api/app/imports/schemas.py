from pydantic import BaseModel, Field

from app.issues.schemas import PlanReview


class ImportRow(BaseModel):
    row: int
    values: dict[str, str]
    error: str | None = None
    plan: PlanReview | None = None


class ImportReview(BaseModel):
    id: str
    hub_id: str
    project_id: str
    project_name: str
    expires_at: int
    approved_at: int | None = None
    rows: list[ImportRow] = Field(max_length=25)
