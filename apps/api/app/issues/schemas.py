from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Issue(BaseModel):
    model_config = ConfigDict(strict=True)
    id: str = Field(min_length=1, max_length=255)
    displayId: int | None = None
    title: str = Field(max_length=10000)
    description: str | None = Field(default=None, max_length=10000)
    issueSubtypeId: str | None = None
    status: str
    assignedTo: str | None = None
    assignedToType: str | None = None
    published: bool = False
    deleted: bool = False
    updatedAt: str | None = None
    dueDate: str | None = None
    permittedAttributes: list[str] = Field(default_factory=list, max_length=200)
    permittedStatuses: list[str] = Field(default_factory=list, max_length=200)
    permittedActions: list[str] = Field(default_factory=list, max_length=200)


class Pagination(BaseModel):
    model_config = ConfigDict(strict=True)
    offset: int = Field(ge=0)
    limit: int = Field(gt=0, le=200)
    totalResults: int = Field(ge=0, le=100000)


class IssuesPage(BaseModel):
    results: list[Issue]
    pagination: Pagination


class Subtype(BaseModel):
    model_config = ConfigDict(strict=True)
    id: str
    title: str
    isActive: bool
    isReadOnly: bool = False


class IssueType(BaseModel):
    model_config = ConfigDict(strict=True)
    id: str
    title: str
    isActive: bool
    subtypes: list[Subtype] = Field(default_factory=list)


class TypesPage(BaseModel):
    results: list[IssueType]
    pagination: Pagination


class TypeOption(BaseModel):
    id: str
    name: str


class PlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    operation: Literal["create", "update"]
    issue_id: str | None = Field(default=None, min_length=1, max_length=255)
    title: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, min_length=1, max_length=100)
    subtype_id: str | None = Field(default=None, min_length=1, max_length=255)
    assignee_id: str | None = Field(default=None, min_length=1, max_length=255)
    due_date: str | None = None

    @model_validator(mode="after")
    def valid_operation(self) -> "PlanInput":
        if self.due_date is not None:
            if date.fromisoformat(self.due_date).isoformat() != self.due_date:
                raise ValueError("Use YYYY-MM-DD")
        if self.operation == "create":
            if not self.title or not self.status or not self.subtype_id or self.issue_id:
                raise ValueError("Creation requires title, status and subtype, without issue_id")
        elif (
            not self.issue_id
            or self.subtype_id is not None
            or self.assignee_id is not None
            or self.due_date is not None
            or not any(v is not None for v in (self.title, self.description, self.status))
        ):
            raise ValueError("Update requires an issue and changed title, description or status")
        return self

    def payload(self) -> dict[str, object]:
        result: dict[str, object] = {
            k: v
            for k, v in (
                ("title", self.title),
                ("description", self.description),
                ("status", self.status),
            )
            if v is not None
        }
        if self.operation == "create":
            result["issueSubtypeId"] = self.subtype_id
            if self.due_date:
                result["dueDate"] = self.due_date
            if self.assignee_id:
                result.update(assignedTo=self.assignee_id, assignedToType="user")
        return result


class PlanContent(BaseModel):
    hub_id: str
    project_id: str
    project_name: str
    request: PlanInput
    payload: dict[str, object]
    before: Issue | None
    assignee_name: str | None
    subtype_name: str | None


class WriteResult(BaseModel):
    state: Literal["succeeded", "rejected", "uncertain", "running"]
    issue_id: str | None = None
    issue: Issue | None = None
    verified: bool = False
    error: str | None = None


class PlanReview(BaseModel):
    id: str
    expires_at: int
    state: str
    content: PlanContent
    result: WriteResult | None = None
    content_digest: str = ""
    approved_at: int | None = None


class PlanApproval(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    content_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
