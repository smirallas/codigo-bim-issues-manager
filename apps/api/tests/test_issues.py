import json
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import pytest
from app.config import Settings
from app.issues.models import IssuePlan
from app.main import create_app
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session
from test_auth import login
from test_members import BASE, MembersFixture

ISSUE = "22222222-2222-4222-8222-222222222222"
SUBTYPE = "33333333-3333-4333-8333-333333333333"


class IssuesFixture(MembersFixture):
    def __init__(self):
        super().__init__()
        self.issue_profile["issues"]["new"]["permittedAttributes"] = [
            "title",
            "description",
            "status",
            "issueSubtypeId",
            "assignedTo",
            "assignedToType",
        ]
        self.issue_profile["issues"]["new"]["permittedStatuses"] = ["open", "closed"]
        self.value = {
            "id": ISSUE,
            "displayId": 7,
            "title": "Synthetic issue",
            "description": "",
            "issueSubtypeId": SUBTYPE,
            "status": "open",
            "updatedAt": "2026-10-21T10:00:00Z",
            "published": True,
            "deleted": False,
            "permittedAttributes": ["title", "description", "status"],
            "permittedStatuses": ["open", "closed"],
            "permittedActions": [],
        }
        self.writes = []
        self.write_status = None
        self.timeout = False
        self.reread_denied = False
        self.raw_types = None

    def respond(self, request):
        path = request.url.path
        if path.endswith("/issue-types"):
            self.requests.append(request)
            return httpx.Response(
                200,
                json=self.raw_types
                or {
                    "results": [
                        {
                            "id": "category",
                            "title": "Quality",
                            "isActive": True,
                            "subtypes": [{"id": SUBTYPE, "title": "General", "isActive": True}],
                        }
                    ],
                    "pagination": {"offset": 0, "limit": 100, "totalResults": 1},
                },
            )
        if "/issues/" in path and (path.endswith("/issues") or path.endswith(ISSUE)):
            self.requests.append(request)
            if request.method in {"POST", "PATCH"}:
                self.writes.append(request)
                if self.timeout:
                    raise httpx.ReadTimeout("Synthetic timeout")
                if self.write_status:
                    return httpx.Response(self.write_status, json={"secret": "must-not-leak"})
                self.value.update(json.loads(request.content))
                return httpx.Response(201 if request.method == "POST" else 200, json=self.value)
            if path.endswith(ISSUE):
                return httpx.Response(403 if self.reread_denied else 200, json=self.value)
            offset = int(request.url.params["offset"])
            return httpx.Response(
                200,
                json={
                    "results": [self.value] if offset == 0 else [],
                    "pagination": {"offset": offset, "limit": 25, "totalResults": 1},
                },
            )
        return super().respond(request)


@pytest.fixture
def issues(tmp_path: Path):
    fixture = IssuesFixture()
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite+pysqlite:///{tmp_path}/issues.db",
        aps_client_id="synthetic",
        aps_client_secret=secrets.token_urlsafe(32),
        token_encryption_key=Fernet.generate_key().decode(),
        access_allowed_emails="allowed@example.test",
    )
    with TestClient(
        create_app(settings, httpx.MockTransport(fixture.respond)), base_url="http://127.0.0.1:8000"
    ) as client:
        login(client)
        csrf = client.get("/auth/session").json()["csrf_token"]
        yield client, fixture, {"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": csrf}


def prepare(issues, **changes):
    client, _, headers = issues
    payload = dict(
        operation="create",
        title="Synthetic example",
        description="Text",
        status="open",
        subtype_id=SUBTYPE,
    )
    payload.update(changes)
    return client.post(f"{BASE}/issue-plans", headers=headers, json=payload)


def execute(issues, identifier):
    client, _, headers = issues
    return client.post(f"/projects/issue-plans/{identifier}/execute", headers=headers)


def test_read_types_list_detail_and_no_tokens(issues):
    client, fixture, _ = issues
    for suffix in ["issue-types", "issues", f"issues/{ISSUE}"]:
        response = client.get(f"{BASE}/{suffix}")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert "synthetic-access" not in response.text
    assert not fixture.writes


def test_prepare_encrypted_approve_create_reread_and_replay(issues):
    client, fixture, _ = issues
    response = prepare(issues, assignee_id="one")
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan["content"]["assignee_name"] == "Alex"
    assert not fixture.writes
    with Session(client.app.state.database_engine) as db:
        stored = db.get(IssuePlan, plan["id"])
        assert "Synthetic example" not in stored.content_encrypted
        assert stored.approved_at is None
    result = execute(issues, plan["id"])
    assert result.json()["verified"] is True
    assert result.json()["state"] == "succeeded"
    assert len(fixture.writes) == 1
    assert json.loads(fixture.writes[0].content)["assignedToType"] == "user"
    assert execute(issues, plan["id"]).json() == result.json()
    assert len(fixture.writes) == 1


def test_update_uses_issue_permissions_and_preserves_other_fields(issues):
    client, fixture, headers = issues
    response = client.post(
        f"{BASE}/issue-plans",
        headers=headers,
        json={"operation": "update", "issue_id": ISSUE, "title": "Reviewed", "status": "closed"},
    )
    assert response.status_code == 200, response.text
    result = execute(issues, response.json()["id"])
    assert result.json()["verified"]
    assert fixture.writes[0].method == "PATCH"
    assert json.loads(fixture.writes[0].content) == {"title": "Reviewed", "status": "closed"}


@pytest.mark.parametrize(
    "field,value",
    [("title", " "), ("title", "a" * 101), ("description", "a" * 1001), ("unexpected", True)],
)
def test_invalid_payload_never_writes(issues, field, value):
    assert prepare(issues, **{field: value}).status_code == 422
    assert not issues[1].writes


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "https://attacker.test"},
        {"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": "wrong"},
    ],
)
def test_prepare_and_execute_require_origin_and_csrf(issues, headers):
    client, fixture, _ = issues
    plan = prepare(issues).json()
    assert (
        client.post(
            f"{BASE}/issue-plans", headers=headers, json=plan["content"]["request"]
        ).status_code
        == 403
    )
    assert (
        client.post(f"/projects/issue-plans/{plan['id']}/execute", headers=headers).status_code
        == 403
    )
    assert not fixture.writes


def test_expiry_and_foreign_session_block_execution(issues):
    client, fixture, _ = issues
    plan = prepare(issues).json()
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(IssuePlan).values(expires_at=int(time.time()) - 1))
    assert execute(issues, plan["id"]).status_code == 409
    login(client)
    assert client.get(f"/projects/issue-plans/{plan['id']}").status_code == 404
    assert not fixture.writes


def test_permission_removed_between_review_and_execution(issues):
    plan = prepare(issues).json()
    issues[1].issue_profile["issues"] = {}
    assert execute(issues, plan["id"]).status_code == 403
    assert not issues[1].writes


def test_updated_issue_invalidates_review(issues):
    client, fixture, headers = issues
    plan = client.post(
        f"{BASE}/issue-plans",
        headers=headers,
        json={"operation": "update", "issue_id": ISSUE, "title": "Updated"},
    ).json()
    fixture.value["updatedAt"] = "2026-10-22T10:00:00Z"
    assert execute(issues, plan["id"]).status_code == 409
    assert not fixture.writes


@pytest.mark.parametrize(
    "failure,expected",
    [
        (403, "rejected"),
        (400, "rejected"),
        (500, "uncertain"),
        (408, "uncertain"),
        (302, "uncertain"),
    ],
)
def test_failed_write_has_persistent_non_replayable_result(issues, failure, expected):
    plan = prepare(issues).json()
    issues[1].write_status = failure
    result = execute(issues, plan["id"])
    assert result.json()["state"] == expected
    assert "must-not-leak" not in result.text
    execute(issues, plan["id"])
    assert len(issues[1].writes) == 1


def test_timeout_remains_uncertain_without_automatic_retry(issues):
    plan = prepare(issues).json()
    issues[1].timeout = True
    assert execute(issues, plan["id"]).json()["state"] == "uncertain"
    assert execute(issues, plan["id"]).json()["state"] == "uncertain"
    assert len(issues[1].writes) == 1


def test_simultaneous_approval_sends_at_most_once(issues):
    plan = prepare(issues).json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: execute(issues, plan["id"]), range(2)))
    assert all(r.status_code in {200, 409} for r in responses)
    assert len(issues[1].writes) == 1


def test_unknown_company_does_not_become_same_company(issues):
    issues[1].users[0]["companyId"] = None
    assert prepare(issues, assignee_id="one").json()["error"] == "company_not_confirmed"
    assert not issues[1].writes


def test_deleted_issue_cannot_be_changed(issues):
    client, fixture, headers = issues
    fixture.value["deleted"] = True
    assert (
        client.post(
            f"{BASE}/issue-plans",
            headers=headers,
            json={"operation": "update", "issue_id": ISSUE, "title": "Updated"},
        ).status_code
        == 403
    )


def test_hidden_project_blocks_preparation(issues):
    issues[1].visible = False
    assert prepare(issues).status_code == 404
    assert not issues[1].writes


def test_read_permission_does_not_grant_update(issues):
    client, fixture, headers = issues
    fixture.value["permittedAttributes"] = []
    assert (
        client.post(
            f"{BASE}/issue-plans",
            headers=headers,
            json={"operation": "update", "issue_id": ISSUE, "title": "Updated"},
        ).status_code
        == 403
    )


def test_no_session_cannot_read_business_or_plans(issues):
    client, fixture, _ = issues
    client.cookies.clear()
    for suffix in ["issue-types", "issues", f"issues/{ISSUE}"]:
        assert client.get(f"{BASE}/{suffix}").status_code == 401
    assert client.get("/projects/issue-plans/unknown").status_code == 401
    assert not fixture.writes


def test_partial_types_never_look_complete(issues):
    client, fixture, _ = issues
    fixture.raw_types = {
        "results": [{"id": "one", "title": "Quality", "isActive": True, "subtypes": []}],
        "pagination": {"offset": 0, "limit": 100, "totalResults": 2},
    }
    response = client.get(f"{BASE}/issue-types")
    assert response.status_code == 502
    assert response.json()["error"] == "aps_partial_response"


def test_active_readonly_catalog_type_is_not_a_creation_permission(issues):
    client, fixture, _ = issues
    fixture.raw_types = {
        "results": [
            {
                "id": "one",
                "title": "General",
                "isActive": True,
                "subtypes": [
                    {"id": SUBTYPE, "title": "General", "isActive": True, "isReadOnly": True},
                    {"id": ISSUE, "title": "Inactive", "isActive": False, "isReadOnly": False},
                ],
            }
        ],
        "pagination": {"offset": 0, "limit": 100, "totalResults": 1},
    }
    assert client.get(f"{BASE}/issue-types").json() == [
        {"id": SUBTYPE, "name": "General / General"}
    ]
    assert prepare(issues).status_code == 200
    fixture.issue_profile["issues"] = {}
    assert prepare(issues).status_code == 403
    assert not fixture.writes


def test_invalid_status_and_inactive_subtype_never_write(issues):
    assert prepare(issues, status="invented").status_code == 403
    assert prepare(issues, subtype_id=ISSUE).status_code == 422
    assert not issues[1].writes


def test_interrupted_execution_is_not_replayed(issues):
    client, fixture, _ = issues
    plan = prepare(issues).json()
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(IssuePlan).values(state="running"))
    result = execute(issues, plan["id"]).json()
    assert result["state"] == "running"
    assert not fixture.writes
