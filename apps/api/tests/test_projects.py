import secrets
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from app.auth.models import AutodeskConnection, WebSession
from app.config import Settings
from app.main import create_app
from app.projects.service import HUB_TYPE, PROJECT_TYPE, ProjectFailure, ProjectService
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session
from test_auth import AutodeskFixture, login


def entry(kind: str, identifier: str, extension: str, project_type: str = "ACC") -> dict:
    return {
        "type": kind,
        "id": identifier,
        "attributes": {
            "name": f"Synthetic {identifier}",
            "extension": {"type": extension, "data": {"projectType": project_type}},
        },
    }


class ProjectsFixture(AutodeskFixture):
    def __init__(self) -> None:
        super().__init__()
        self.status = 200
        self.visible = True

    def respond(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/project/v1/"):
            self.requests.append(request)
            assert request.headers["authorization"] in {
                "Bearer synthetic-access",
                "Bearer synthetic-access-renewed",
            }
            if self.status != 200:
                return httpx.Response(self.status, json={"secret": "must-not-leak"})
            if request.url.path == "/project/v1/hubs":
                return httpx.Response(200, json={"data": [entry("hubs", "b.hub", HUB_TYPE)]})
            assert request.url.path == "/project/v1/hubs/b.hub/projects"
            return httpx.Response(
                200,
                json={
                    "data": [entry("projects", "b.project", PROJECT_TYPE)] if self.visible else []
                },
            )
        return super().respond(request)


@pytest.fixture
def projects(tmp_path: Path) -> Iterator[tuple[TestClient, ProjectsFixture]]:
    fixture = ProjectsFixture()
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite+pysqlite:///{tmp_path}/issues.db",
        aps_client_id="synthetic-client",
        aps_client_secret=secrets.token_urlsafe(32),
        token_encryption_key=Fernet.generate_key().decode(),
        access_allowed_emails="allowed@example.test",
    )
    with TestClient(
        create_app(settings, httpx.MockTransport(fixture.respond)),
        base_url="http://127.0.0.1:8000",
    ) as client:
        yield client, fixture


@pytest.mark.parametrize(
    "path", ["/projects/hubs", "/projects/hubs/b.hub", "/projects/hubs/b.hub/b.project"]
)
def test_all_routes_require_session(projects, path: str) -> None:
    client, fixture = projects
    response = client.get(path)
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    assert fixture.requests == []


def test_select_revalidates_membership_and_preserves_identifiers(projects) -> None:
    client, fixture = projects
    login(client)
    response = client.get("/projects/hubs/b.hub/b.project")
    assert response.status_code == 200
    assert response.json()["hub"]["id"] == "b.hub"
    assert response.json()["project"]["id"] == "b.project"
    assert "synthetic-access" not in response.text
    assert client.get("/projects/hubs/b.hub/b.foreign").status_code == 404
    assert client.get("/projects/hubs/b.foreign/b.project").status_code == 404
    fixture.visible = False
    assert client.get("/projects/hubs/b.hub").json() == {
        "items": [],
        "excluded": 0,
        "incomplete": False,
    }
    assert client.get("/projects/hubs/b.hub/b.project").status_code == 404


@pytest.mark.parametrize("status", [401, 403, 404, 429, 500, 302])
def test_upstream_errors_are_not_empty_lists_or_leaked_payloads(projects, status: int) -> None:
    client, fixture = projects
    login(client)
    fixture.status = status
    response = client.get("/projects/hubs")
    assert response.status_code == (status if status in {401, 403, 404, 429} else 502)
    assert "error" in response.json()
    assert "must-not-leak" not in response.text
    assert "items" not in response.json()


def test_session_expiry_and_refresh_apply_to_project_routes(projects) -> None:
    client, fixture = projects
    login(client)
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(AutodeskConnection).values(expires_at=int(time.time()) - 1))
    assert client.get("/projects/hubs").status_code == 200
    assert fixture.refreshes == 1
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(WebSession).values(expires_at=int(time.time()) - 1))
    fixture.requests.clear()
    response = client.get("/projects/hubs")
    assert response.status_code == 401
    assert response.json()["error"] == "session_expired"
    assert fixture.requests == []


def test_changed_allowlist_identity_blocks_projects(projects) -> None:
    client, fixture = projects
    login(client)
    fixture.profile["email"] = "denied@example.test"
    fixture.requests.clear()
    assert client.get("/projects/hubs").status_code == 403
    assert not any(r.url.path.startswith("/project/") for r in fixture.requests)


@pytest.mark.parametrize("first_empty", [True, False])
def test_pagination_filters_all_pages_and_deduplicates(first_empty: bool) -> None:
    calls: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if not request.url.query:
            return httpx.Response(
                200,
                json={
                    "data": []
                    if first_empty
                    else [entry("projects", "b.legacy", PROJECT_TYPE, "BIM360")],
                    "links": {"next": {"href": "?page[number]=1"}},
                },
            )
        return httpx.Response(
            200,
            json={
                "data": [entry("projects", "b.acc", PROJECT_TYPE)] * 2,
                "links": {"next": None},
            },
        )

    service = ProjectService(httpx.MockTransport(respond))
    result = service._projects("synthetic-token", "b.hub")
    assert [item.id for item in result.items] == ["b.acc"]
    assert result.excluded == (0 if first_empty else 1)
    assert len(calls) == 2


@pytest.mark.parametrize(
    "next_url",
    [
        "https://evil.example/project/v1/hubs",
        "//evil.example/project/v1/hubs",
        "https://developer.api.autodesk.com.evil.example/project/v1/hubs",
        "https://developer.api.autodesk.com/other",
        "http://developer.api.autodesk.com/project/v1/hubs",
        "/project/v1/hubs",
    ],
)
def test_untrusted_or_looping_pagination_never_receives_token(next_url: str) -> None:
    calls = []

    def respond(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"data": [], "links": {"next": {"href": next_url}}})

    with pytest.raises(ProjectFailure) as caught:
        ProjectService(httpx.MockTransport(respond)).hubs("synthetic-token")
    assert caught.value.code == "aps_invalid_pagination"
    assert len(calls) == 1


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"data": None},
        {"data": [{"type": "hubs", "id": "b.hub", "attributes": {}}]},
    ],
)
def test_invalid_or_partial_response_is_not_empty_success(body: dict) -> None:
    service = ProjectService(httpx.MockTransport(lambda _: httpx.Response(200, json=body)))
    with pytest.raises(ProjectFailure):
        service.hubs("synthetic-token")


def test_only_compatible_hubs_are_returned() -> None:
    body = {
        "data": [
            entry("hubs", "a.fusion", "hubs:autodesk.core:Hub"),
            entry("hubs", "b.hub", HUB_TYPE),
        ]
    }
    service = ProjectService(httpx.MockTransport(lambda _: httpx.Response(200, json=body)))
    assert service.hubs("synthetic-token").model_dump() == {
        "items": [{"id": "b.hub", "name": "Synthetic b.hub"}],
        "excluded": 1,
        "incomplete": False,
    }


@pytest.mark.parametrize("visible", [True, False])
def test_regional_warnings_preserve_results_without_claiming_complete_list(visible: bool) -> None:
    body = {
        "data": [entry("hubs", "b.hub", HUB_TYPE)] if visible else [],
        "meta": {"warnings": [{"HttpStatusCode": "403", "ErrorCode": "BIM360DM_ERROR"}]},
    }
    service = ProjectService(httpx.MockTransport(lambda _: httpx.Response(200, json=body)))
    result = service.hubs("synthetic-token")
    assert result.incomplete is True
    assert len(result.items) == int(visible)
    if visible:
        assert service._hub("synthetic-token", "b.hub").id == "b.hub"
    with pytest.raises(ProjectFailure) as caught:
        service._hub("synthetic-token", "b.other")
    assert caught.value.code == "aps_partial_response"


def test_path_injection_rejected_before_remote_project_lookup(projects) -> None:
    client, fixture = projects
    login(client)
    fixture.requests.clear()
    assert client.get("/projects/hubs/b.hub%3Fquery").status_code == 400
    assert not any(r.url.path.startswith("/project/") for r in fixture.requests)
