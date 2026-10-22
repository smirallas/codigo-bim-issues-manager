import time

import pytest
from app.auth.mcp import API_AUDIENCE, codec
from app.auth.router import SESSION_COOKIE
from pydantic import SecretStr
from test_auth import auth as auth
from test_auth import begin, finish
from test_issues import BASE, prepare
from test_issues import issues as issues

SECRET = "synthetic-internal-secret-" * 3


def bearer(settings, purpose="bind", **overrides):
    now = int(time.time())
    claims = {
        "iss": settings.mcp_issuer,
        "aud": API_AUDIENCE,
        "iat": now,
        "exp": now + 30,
        "sub": "mcp-service",
        "purpose": purpose,
    }
    claims.update(overrides)
    return {"authorization": "Bearer " + codec.encode({"alg": "HS256"}, claims, SECRET).decode()}


def connected(auth):
    client, provider, settings = auth
    settings.mcp_internal_secret = SecretStr(SECRET)
    finish(client, begin(client))
    response = client.get("/mcp/bind", headers=bearer(settings))
    assert response.status_code == 200
    assert "synthetic-access" not in response.text
    return client, provider, settings, response.json()


@pytest.mark.parametrize(
    "change",
    [
        {"exp": 1},
        {"iss": "https://wrong.test"},
        {"aud": "http://127.0.0.1:8001/mcp"},
        {"purpose": "delegate"},
        {"exp": int(time.time()) + 1000},
    ],
)
def test_bind_rejects_wrong_context(auth, change):
    client, _, settings = auth
    settings.mcp_internal_secret = SecretStr(SECRET)
    finish(client, begin(client))
    assert client.get("/mcp/bind", headers=bearer(settings, **change)).status_code == 401


def test_mcp_context_is_separate_from_web_and_aps(auth):
    client, _, settings, binding = connected(auth)
    for token in ("", "synthetic-access", "arbitrary-mcp-token"):
        assert (
            client.get(
                "/mcp-api/projects/mcp-identity", headers={"authorization": f"Bearer {token}"}
            ).status_code
            == 401
        )
    headers = bearer(settings, "delegate", sub=binding["subject"], binding=binding["binding"])
    client.cookies.clear()
    assert client.get("/mcp-api/projects/mcp-identity", headers=headers).status_code == 200
    assert client.get("/auth/session", headers=headers).status_code == 401
    assert (
        client.post("/mcp-api/projects/issue-plans/example/execute", headers=headers).status_code
        == 403
    )
    assert (
        client.post("/mcp-api/projects/imports/example/approve", headers=headers).status_code == 403
    )


def test_binding_cannot_be_swapped_between_users(auth):
    client, _, settings, binding = connected(auth)
    bad = bearer(settings, "delegate", sub="other-user", binding=binding["binding"])
    assert client.get("/mcp-api/projects/mcp-identity", headers=bad).status_code == 401


def test_disconnect_cuts_off_mcp_before_credential_expiry(auth):
    client, _, settings, binding = connected(auth)
    headers = bearer(settings, "delegate", sub=binding["subject"], binding=binding["binding"])
    session = client.get("/auth/session").json()
    response = client.post(
        "/auth/logout",
        headers={"origin": settings.web_origin, "x-csrf-token": session["csrf_token"]},
    )
    assert response.status_code == 200
    assert client.get("/mcp-api/projects/mcp-identity", headers=headers).status_code == 401


def test_removed_allowlist_cuts_off_mcp(auth):
    client, _, settings, binding = connected(auth)
    settings.access_allowed_emails = "another@example.test"
    headers = bearer(settings, "delegate", sub=binding["subject"], binding=binding["binding"])
    assert client.get("/mcp-api/projects/mcp-identity", headers=headers).status_code == 403


def test_binding_remains_private_per_connection(auth):
    client, _, settings, binding = connected(auth)
    original = client.cookies.get(SESSION_COOKIE)
    finish(client, begin(client))
    assert client.cookies.get(SESSION_COOKIE) != original
    headers = bearer(settings, "delegate", sub=binding["subject"], binding=binding["binding"])
    assert client.get("/mcp-api/projects/mcp-identity", headers=headers).status_code == 401


def test_web_and_mcp_share_plan_ownership_without_crossing_connections(issues):
    client, fixture, _ = issues
    settings = client.app.state.auth_service.settings
    settings.mcp_internal_secret = SecretStr(SECRET)
    first_binding = client.get("/mcp/bind", headers=bearer(settings)).json()
    plan = prepare(issues).json()
    first_headers = bearer(
        settings, "delegate", sub=first_binding["subject"], binding=first_binding["binding"]
    )
    path = f"/mcp-api/projects/issue-plans/{plan['id']}"
    assert client.get(path, headers=first_headers).status_code == 200
    # Otra conexión activa de la misma identidad no hereda planes de la primera.
    client.cookies.clear()
    finish(client, begin(client))
    second_binding = client.get("/mcp/bind", headers=bearer(settings)).json()
    second_headers = bearer(
        settings, "delegate", sub=second_binding["subject"], binding=second_binding["binding"]
    )
    assert client.get(path, headers=second_headers).status_code == 404
    assert client.get(path, headers=first_headers).status_code == 200
    assert (
        client.post(
            f"/mcp-api{BASE}/issue-plans",
            headers=first_headers,
            json={
                "operation": "update",
                "issue_id": "22222222-2222-4222-8222-222222222222",
                "title": "Prepared only",
            },
        ).status_code
        == 200
    )
    assert fixture.writes == []
