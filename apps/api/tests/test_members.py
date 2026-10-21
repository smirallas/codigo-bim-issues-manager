import secrets
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from app.auth.models import AutodeskConnection, WebSession
from app.main import create_app
from app.members.service import MemberService, construction_project_id
from app.projects.service import PROJECT_TYPE, ProjectFailure, ProjectService
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session
from test_auth import login
from test_projects import ProjectsFixture, entry

PROJECT = "b.11111111-1111-4111-8111-111111111111"
BASE = f"/projects/hubs/b.hub/{PROJECT}"


def user(identifier="one", name="Alex", company="company-a", status="active") -> dict:
    return {
        "id": f"acc-{identifier}",
        "autodeskId": identifier,
        "name": name,
        "email": f"{identifier}@example.test",
        "companyId": company,
        "companyName": company,
        "status": status,
        "accessLevels": {"projectAdmin": False, "accountAdmin": False},
        "phone": {"number": "private-not-returned"},
    }


class MembersFixture(ProjectsFixture):
    def __init__(self):
        super().__init__()
        self.users = [user(), user("two", company="company-b")]
        self.profile = dict(self.profile)
        self.issue_profile = {
            "id": "one",
            "isProjectAdmin": False,
            "permissionLevels": ["create"],
            "issues": {
                "new": {
                    "permittedActions": ["assign_same_company"],
                    "permittedAttributes": ["title", "assignedTo", "assignedToType"],
                    "permittedStatuses": ["open"],
                }
            },
        }
        self.admin_status = 200
        self.issue_status = 200
        self.page_size = 1
        self.raw_page = None

    def respond(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.startswith("/construction/"):
            self.requests.append(request)
            assert request.method == "GET"
            assert request.headers["authorization"] in {
                "Bearer synthetic-access",
                "Bearer synthetic-access-renewed",
            }
            assert "user-id" not in request.headers
            assert "b." not in path
            if "/admin/" in path:
                if self.admin_status != 200:
                    return httpx.Response(
                        self.admin_status, json={"secret": "private-not-returned"}
                    )
                if self.raw_page is not None:
                    return httpx.Response(200, json=self.raw_page)
                offset = int(request.url.params["offset"])
                return httpx.Response(
                    200,
                    json={
                        "results": self.users[offset : offset + self.page_size],
                        "pagination": {
                            "offset": offset,
                            "limit": self.page_size,
                            "totalResults": len(self.users),
                            "nextUrl": "https://attacker.example.test/steal",
                        },
                    },
                )
            return httpx.Response(self.issue_status, json=self.issue_profile)
        if path == "/project/v1/hubs/b.hub/projects":
            self.requests.append(request)
            return httpx.Response(
                200,
                json={"data": [entry("projects", PROJECT, PROJECT_TYPE)] if self.visible else []},
            )
        return super().respond(request)


@pytest.fixture
def members(tmp_path: Path) -> Iterator[tuple[TestClient, MembersFixture]]:
    from app.config import Settings
    from cryptography.fernet import Fernet

    fixture = MembersFixture()
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite+pysqlite:///{tmp_path}/issues.db",
        aps_client_id="synthetic-client",
        aps_client_secret=secrets.token_urlsafe(32),
        token_encryption_key=Fernet.generate_key().decode(),
        access_allowed_emails="allowed@example.test",
    )
    with TestClient(
        create_app(settings, httpx.MockTransport(fixture.respond)), base_url="http://127.0.0.1:8000"
    ) as client:
        yield client, fixture


@pytest.mark.parametrize("suffix", ["members", "capabilities", "assignee-check?query=one"])
def test_member_routes_require_session_and_no_store(members, suffix):
    client, fixture = members
    response = client.get(f"{BASE}/{suffix}")
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    assert not fixture.requests


def test_list_paginates_safely_and_minimizes_profile_data(members):
    client, fixture = members
    login(client)
    response = client.get(f"{BASE}/members")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 2
    assert "private-not-returned" not in response.text
    assert "synthetic-access" not in response.text
    assert all(
        r.url.host in {"developer.api.autodesk.com", "api.userprofile.autodesk.com"}
        for r in fixture.requests
    )
    assert len([r for r in fixture.requests if "/admin/" in r.url.path]) == 2


def test_every_operation_revalidates_project_access(members):
    client, fixture = members
    login(client)
    assert client.get(f"{BASE}/members").status_code == 200
    fixture.visible = False
    for suffix in ["members", "capabilities", "assignee-check?query=one"]:
        fixture.requests.clear()
        assert client.get(f"{BASE}/{suffix}").status_code == 404
        assert not any("/construction/" in r.url.path for r in fixture.requests)


def test_same_company_and_homonyms_require_explicit_identity(members):
    client, fixture = members
    login(client)
    assert client.get(f"{BASE}/assignee-check?query=Alex&by=name").status_code == 409
    allowed = client.get(f"{BASE}/assignee-check?query=one").json()
    assert allowed["eligible"] and allowed["member"]["autodesk_id"] == "one"
    denied = client.get(f"{BASE}/assignee-check?query=two").json()
    assert not denied["eligible"] and denied["reason"] == "assignment_other_company"
    assert client.get(f"{BASE}/assignee-check?query=missing").status_code == 404
    assert client.get(f"{BASE}/assignee-check?query=one&by=email").status_code == 422


@pytest.mark.parametrize("company", [None, ""])
def test_unknown_company_does_not_grant_assignment(members, company):
    client, fixture = members
    fixture.users[0]["companyId"] = company
    login(client)
    response = client.get(f"{BASE}/assignee-check?query=one").json()
    assert not response["eligible"]
    assert response["reason"] == "company_not_confirmed"


def test_explicit_all_and_fresh_permission_downgrade(members):
    client, fixture = members
    login(client)
    new = fixture.issue_profile["issues"]["new"]
    new["permittedActions"] = ["assign_all"]
    assert client.get(f"{BASE}/assignee-check?query=two").json()["eligible"]
    new["permittedActions"] = []
    fixture.issue_profile["isProjectAdmin"] = True
    denied = client.get(f"{BASE}/assignee-check?query=two").json()
    assert denied["reason"] == "assignment_not_confirmed" and not denied["eligible"]
    new["permittedActions"] = ["assign_all"]
    new["permittedAttributes"] = ["title"]
    assert not client.get(f"{BASE}/assignee-check?query=two").json()["eligible"]


def test_admin_membership_and_issues_capabilities_stay_separate(members):
    client, fixture = members
    login(client)
    fixture.issue_profile["isProjectAdmin"] = True
    member = client.get(f"{BASE}/members").json()["items"][0]
    assert member["project_admin"] is False and member["account_admin"] is False
    assert client.get(f"{BASE}/capabilities").json()["project_admin"] is True
    fixture.issue_profile["issues"]["new"]["permittedActions"] = []
    assert not client.get(f"{BASE}/assignee-check?query=one").json()["eligible"]


@pytest.mark.parametrize("new", [None, {}])
def test_read_only_or_missing_new_cannot_create(members, new):
    client, fixture = members
    login(client)
    fixture.issue_profile["permissionLevels"] = ["read"]
    fixture.issue_profile["issues"]["new"] = new
    result = client.get(f"{BASE}/capabilities").json()
    assert not result["can_create"] and result["assignment"] == "unavailable"


def test_member_routes_share_real_session_validation_and_refresh(members):
    client, fixture = members
    login(client)
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(AutodeskConnection).values(expires_at=int(time.time()) - 1))
    assert client.get(f"{BASE}/members").status_code == 200
    assert fixture.refreshes == 1
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(WebSession).values(expires_at=int(time.time()) - 1))
    fixture.requests.clear()
    assert client.get(f"{BASE}/capabilities").json()["error"] == "session_expired"
    assert not fixture.requests


def test_changed_demo_allowlist_identity_blocks_member_reads(members):
    client, fixture = members
    login(client)
    fixture.profile["email"] = "denied@example.test"
    fixture.requests.clear()
    assert client.get(f"{BASE}/members").status_code == 403
    assert not any("/construction/" in r.url.path for r in fixture.requests)


def test_no_members_and_no_issues_permissions_are_independent(members):
    client, fixture = members
    login(client)
    fixture.users = []
    fixture.issue_profile["issues"] = {}
    assert client.get(f"{BASE}/members").json() == {"items": []}
    assert not client.get(f"{BASE}/capabilities").json()["can_create"]


def test_unique_name_resolves_to_autodesk_identity_not_admin_id(members):
    client, fixture = members
    login(client)
    fixture.users[0]["name"] = "Unique Name"
    result = client.get(f"{BASE}/assignee-check?by=name&query=Unique%20Name").json()
    assert result["eligible"] and result["member"]["autodesk_id"] == "one"
    fixture.users[0]["autodeskId"] = None
    result = client.get(f"{BASE}/assignee-check?by=name&query=Unique%20Name").json()
    assert not result["eligible"] and result["reason"] == "assignee_inactive"


@pytest.mark.parametrize(
    "profile",
    [
        {},
        {"id": "one", "permissionLevels": "create"},
        {"id": "one", "isProjectAdmin": "true"},
        {"id": "one", "issues": {"new": {"permittedActions": {"assign_all": True}}}},
    ],
)
def test_malformed_issue_profiles_never_grant_permissions(members, profile):
    client, fixture = members
    login(client)
    fixture.issue_profile = profile
    assert client.get(f"{BASE}/capabilities").status_code == 502


@pytest.mark.parametrize("status", ["pending", "deleted"])
def test_pending_deleted_and_missing_identity_are_not_eligible(members, status):
    client, fixture = members
    fixture.users[0]["status"] = status
    login(client)
    assert client.get(f"{BASE}/assignee-check?query=one").json()["reason"] == "assignee_inactive"
    fixture.users[0]["status"] = "active"
    fixture.users[0]["autodeskId"] = None
    assert client.get(f"{BASE}/assignee-check?by=name&query=Alex").status_code == 409


@pytest.mark.parametrize("status", [401, 403, 404, 429, 500, 302])
def test_admin_failures_do_not_block_independent_capabilities_or_leak(members, status):
    client, fixture = members
    login(client)
    fixture.admin_status = status
    response = client.get(f"{BASE}/members")
    assert response.status_code == (status if status in {401, 403, 404, 429} else 502)
    assert "private-not-returned" not in response.text
    assert client.get(f"{BASE}/capabilities").status_code == 200


def test_issues_denied_is_not_no_members_or_privileged_fallback(members):
    client, fixture = members
    login(client)
    fixture.issue_status = 403
    response = client.get(f"{BASE}/capabilities")
    assert response.status_code == 403
    assert response.json()["error"] == "aps_issues_access_denied"
    assert client.get(f"{BASE}/members").status_code == 200


@pytest.mark.parametrize(
    "page",
    [
        {"results": [], "pagination": {"offset": 1, "limit": 100, "totalResults": 1}},
        {"results": [], "pagination": {"offset": 0, "limit": 0, "totalResults": 1}},
        {"results": [], "pagination": {"offset": 0, "limit": 100, "totalResults": 1}},
        {"results": [], "pagination": {"offset": 0, "limit": 100, "totalResults": 10001}},
    ],
)
def test_invalid_or_incomplete_pages_are_not_successful_empty_lists(members, page):
    client, fixture = members
    fixture.raw_page = page
    login(client)
    assert client.get(f"{BASE}/members").status_code == 502


def test_uuid_conversion_is_local_and_does_not_strip_arbitrary_dots():
    assert construction_project_id(PROJECT) == PROJECT[2:]
    for invalid in ["b.foo.bar", "b.project", PROJECT[2:], "../other"]:
        with pytest.raises(ProjectFailure):
            construction_project_id(invalid)


def test_transport_timeouts_are_sanitized():
    def timeout(request):
        raise httpx.ReadTimeout("secret", request=request)

    transport = httpx.MockTransport(timeout)
    service = MemberService(ProjectService(transport), transport)
    with pytest.raises(ProjectFailure) as error:
        service._capabilities("synthetic-access", PROJECT[2:])
    assert error.value.code == "aps_unavailable"
