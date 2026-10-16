import hashlib
import logging
import secrets
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from app.auth.models import AutodeskConnection, OAuthAttempt, WebSession
from app.auth.provider import APS_SCOPE, USERINFO_URL
from app.auth.router import LOGIN_COOKIE, SESSION_COOKIE
from app.auth.service import AuthFailure, fingerprint
from app.config import Settings
from app.logging import RedactQueryFilter
from app.main import create_app
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select, update
from sqlalchemy.orm import Session


class AutodeskFixture:
    """Proveedor sintético: nunca envía solicitudes a Autodesk."""

    def __init__(self) -> None:
        self.profile: dict[str, object] = {
            "sub": "synthetic-subject",
            "email": "allowed@example.test",
            "email_verified": True,
            "name": "Usuario de prueba",
        }
        self.requests: list[httpx.Request] = []
        self.refreshes = 0
        self.refresh_failure = False
        self.revoke_failure = False
        self.profile_failure = False

    def respond(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if str(request.url) == USERINFO_URL:
            return httpx.Response(503 if self.profile_failure else 200, json=self.profile)
        if request.url.path == "/authentication/v2/token":
            data = parse_qs(request.content.decode())
            assert request.headers["authorization"].startswith("Basic ")
            if data["grant_type"] == ["refresh_token"]:
                self.refreshes += 1
                if self.refresh_failure:
                    return httpx.Response(400, json={"error": "invalid_grant"})
                return httpx.Response(
                    200,
                    json={
                        "access_token": "synthetic-access-renewed",
                        "refresh_token": "synthetic-refresh-renewed",
                        "expires_in": 3600,
                        "token_type": "Bearer",
                    },
                )
            assert data["redirect_uri"] == ["http://127.0.0.1:8000/auth/autodesk/callback"]
            assert len(data["code_verifier"][0]) >= 43
            return httpx.Response(
                200,
                json={
                    "access_token": "synthetic-access",
                    "refresh_token": "synthetic-refresh",
                    "expires_in": 3600,
                    "token_type": "Bearer",
                },
            )
        if request.url.path == "/authentication/v2/revoke":
            return httpx.Response(503 if self.revoke_failure else 200)
        raise AssertionError(f"Unexpected fixture endpoint {request.url.host}{request.url.path}")


@pytest.fixture
def auth(tmp_path: Path) -> Iterator[tuple[TestClient, AutodeskFixture, Settings]]:
    provider = AutodeskFixture()
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite+pysqlite:///{tmp_path}/issues.db",
        aps_client_id="synthetic-client",
        aps_client_secret=secrets.token_urlsafe(32),
        token_encryption_key=Fernet.generate_key().decode(),
        access_allowed_emails="allowed@example.test",
    )
    with TestClient(
        create_app(settings, httpx.MockTransport(provider.respond)),
        base_url="http://127.0.0.1:8000",
    ) as client:
        yield client, provider, settings


def begin(client: TestClient) -> str:
    response = client.get("/auth/login", follow_redirects=False)
    assert response.status_code == 303
    return parse_qs(urlsplit(response.headers["location"]).query)["state"][0]


def finish(client: TestClient, state: str) -> httpx.Response:
    return client.get(
        "/auth/autodesk/callback",
        params={"state": state, "code": "synthetic-code"},
        follow_redirects=False,
    )


def login(client: TestClient) -> None:
    assert finish(client, begin(client)).headers["location"] == "http://127.0.0.1:5173/"


def test_login_uses_only_identity_scope_pkce_and_browser_bound_state(auth) -> None:
    client, provider, settings = auth
    response = client.get("/auth/login", follow_redirects=False)
    params = parse_qs(urlsplit(response.headers["location"]).query)
    assert params["scope"] == [APS_SCOPE]
    assert params["code_challenge_method"] == ["S256"]
    assert "client_secret" not in params
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]
    assert response.headers["cache-control"] == "no-store"
    assert provider.requests == []
    with Session(client.app.state.database_engine) as db:
        attempt = db.get(OAuthAttempt, fingerprint(params["state"][0]))
        assert attempt is not None
        assert attempt.browser_hash == fingerprint(client.cookies[LOGIN_COOKIE])
        verifier = (
            Fernet(settings.token_encryption_key.get_secret_value().encode())
            .decrypt(attempt.verifier_encrypted.encode())
            .decode()
        )
        import base64

        assert params["code_challenge"] == [
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        ]


def test_success_exposes_only_session_identity_and_encrypts_credentials(auth) -> None:
    client, _, settings = auth
    state = begin(client)
    callback = finish(client, state)
    assert callback.headers["location"] == "http://127.0.0.1:5173/"
    assert callback.headers["referrer-policy"] == "no-referrer"
    assert "HttpOnly" in callback.headers["set-cookie"]
    raw_id = client.cookies[SESSION_COOKIE]
    response = client.get("/auth/session")
    assert response.status_code == 200
    assert response.json()["user"]["subject"] == "synthetic-subject"
    assert set(response.json()) == {"user", "csrf_token", "expires_at"}
    schema = client.get("/openapi.json").json()
    assert set(schema["components"]["schemas"]["SessionResponse"]["properties"]) == {
        "user",
        "csrf_token",
        "expires_at",
    }
    assert "synthetic-access" not in response.text
    with Session(client.app.state.database_engine) as db:
        assert db.get(WebSession, raw_id) is None
        connection = db.get(AutodeskConnection, fingerprint(raw_id))
        assert connection and "synthetic-access" not in connection.access_encrypted
        assert (
            Fernet(settings.token_encryption_key.get_secret_value().encode()).decrypt(
                connection.refresh_encrypted.encode()
            )
            == b"synthetic-refresh"
        )
        assert db.get(OAuthAttempt, fingerprint(state)) is None
    assert "invalid_callback" in finish(client, state).headers["location"]


@pytest.mark.parametrize(
    "profile",
    [
        {"email": "other@example.test"},
        {"email_verified": False},
        {"email_verified": "true"},
        {"sub": ""},
        {"email_verified": None},
    ],
)
def test_denied_or_unverifiable_identity_never_creates_session(auth, profile) -> None:
    client, provider, _ = auth
    provider.profile.update(profile)
    response = finish(client, begin(client))
    assert "auth_error=" in response.headers["location"]
    assert SESSION_COOKIE not in client.cookies
    assert client.get("/auth/session").status_code == 401


def test_state_cannot_be_used_from_another_browser(auth) -> None:
    client, provider, _ = auth
    state = begin(client)
    binding = client.cookies[LOGIN_COOKIE]
    client.cookies.clear()
    assert "invalid_callback" in finish(client, state).headers["location"]
    assert provider.requests == []
    client.cookies.set(LOGIN_COOKIE, binding)
    assert "auth_error" not in finish(client, state).headers["location"]


def test_expired_state_rejected_before_any_provider_call(auth) -> None:
    client, provider, _ = auth
    state = begin(client)
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(OAuthAttempt).values(expires_at=0))
    assert "invalid_callback" in finish(client, state).headers["location"]
    assert provider.requests == []


def test_cancellation_consumes_state_and_does_not_reflect_provider_description(auth) -> None:
    client, provider, _ = auth
    state = begin(client)
    response = client.get(
        "/auth/autodesk/callback",
        params={"state": state, "error": "access_denied", "error_description": "untrusted-text"},
        follow_redirects=False,
    )
    assert response.headers["location"].endswith("auth_error=cancelled")
    assert "untrusted-text" not in response.text + str(response.headers)
    assert provider.requests == []
    assert "invalid_callback" in finish(client, state).headers["location"]


def test_duplicate_callback_arguments_are_rejected(auth) -> None:
    client, provider, _ = auth
    state = begin(client)
    response = client.get(
        f"/auth/autodesk/callback?state={state}&state=other&code=fixture", follow_redirects=False
    )
    assert "invalid_callback" in response.headers["location"]
    assert provider.requests == []


def test_access_is_rechecked_when_allowlist_changes(auth) -> None:
    client, _, settings = auth
    login(client)
    settings.access_allowed_emails = "someone-else@example.test"
    assert client.get("/auth/session").status_code == 403
    assert client.get("/auth/session").status_code == 401


def test_exact_domain_is_allowed_but_not_subdomains_or_suffixes(auth) -> None:
    client, provider, settings = auth
    settings.access_allowed_emails = ""
    settings.access_allowed_domains = "EXAMPLE.TEST"
    login(client)
    for email in ("user@sub.example.test", "user@example.test.attacker.test"):
        provider.profile["email"] = email
        assert "access_denied" in finish(client, begin(client)).headers["location"]


def test_expired_session_does_not_refresh(auth) -> None:
    client, provider, _ = auth
    login(client)
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(WebSession).values(expires_at=0))
    response = client.get("/auth/session")
    assert response.status_code == 401
    assert response.json()["error"] == "session_expired"
    assert provider.refreshes == 0


def test_expired_access_token_is_refreshed_and_rotated(auth) -> None:
    client, provider, settings = auth
    login(client)
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(AutodeskConnection).values(expires_at=0))
    assert client.get("/auth/session").status_code == 200
    assert client.get("/auth/session").status_code == 200
    assert provider.refreshes == 1
    with Session(client.app.state.database_engine) as db:
        connection = db.scalar(select(AutodeskConnection))
        assert (
            Fernet(settings.token_encryption_key.get_secret_value().encode()).decrypt(
                connection.refresh_encrypted.encode()
            )
            == b"synthetic-refresh-renewed"
        )


def test_failed_refresh_removes_local_connection(auth) -> None:
    client, provider, _ = auth
    login(client)
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(AutodeskConnection).values(expires_at=0))
    provider.refresh_failure = True
    response = client.get("/auth/session")
    assert response.status_code == 401
    assert response.json()["error"] == "reconnect_required"
    with Session(client.app.state.database_engine) as db:
        assert db.scalar(select(AutodeskConnection)) is None


def test_concurrent_requests_refresh_only_once(auth) -> None:
    from concurrent.futures import ThreadPoolExecutor

    client, provider, _ = auth
    login(client)
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(AutodeskConnection).values(expires_at=0))
    session_id = client.cookies[SESSION_COOKIE]
    service = client.app.state.auth_service
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(service.session_info, [session_id, session_id]))
    assert all(result.subject == "synthetic-subject" for result in results)
    assert provider.refreshes == 1


def test_new_login_rotates_session_and_old_cookie_cannot_be_replayed(auth) -> None:
    client, _, _ = auth
    login(client)
    old_session = client.cookies[SESSION_COOKIE]
    login(client)
    assert old_session != client.cookies[SESSION_COOKIE]
    assert client.get("/auth/session").status_code == 200
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE, old_session)
    assert client.get("/auth/session").status_code == 401


def test_profile_failure_closes_access_without_exposing_provider_payload(auth) -> None:
    client, provider, _ = auth
    login(client)
    provider.profile_failure = True
    response = client.get("/auth/session")
    assert response.status_code == 401
    assert response.json() == {"error": "reconnect_required"}


def test_changed_subject_or_revoked_profile_cannot_reuse_session(auth) -> None:
    client, provider, _ = auth
    login(client)
    provider.profile["sub"] = "other-subject"
    assert client.get("/auth/session").status_code == 403


@pytest.mark.parametrize(
    "origin,csrf",
    [(None, "valid"), ("https://untrusted.test", "valid"), ("http://127.0.0.1:5173", "invalid")],
)
def test_disconnect_rejects_csrf_and_untrusted_or_missing_origin(auth, origin, csrf) -> None:
    client, _, _ = auth
    login(client)
    token = client.get("/auth/session").json()["csrf_token"]
    headers = {"X-CSRF-Token": token if csrf == "valid" else "invalid"}
    if origin:
        headers["Origin"] = origin
    assert client.post("/auth/logout", headers=headers).status_code == 403
    assert client.get("/auth/session").status_code == 200


@pytest.mark.parametrize("revoke_failure", [False, True])
def test_disconnect_always_removes_local_access_and_reports_remote_result(
    auth, revoke_failure
) -> None:
    client, provider, _ = auth
    login(client)
    token = client.get("/auth/session").json()["csrf_token"]
    provider.revoke_failure = revoke_failure
    response = client.post(
        "/auth/logout", headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": token}
    )
    assert response.json() == {
        "local_disconnected": True,
        "provider_revocation": "unconfirmed" if revoke_failure else "confirmed",
    }
    assert client.get("/auth/session").status_code == 401
    hints = [
        parse_qs(request.content.decode())["token_type_hint"][0]
        for request in provider.requests
        if request.url.path.endswith("/revoke")
    ]
    assert hints == ["refresh_token", "access_token"]


def test_bearer_and_declared_user_do_not_authenticate(auth) -> None:
    client, _, _ = auth
    assert (
        client.get(
            "/auth/session",
            headers={"Authorization": "Bearer synthetic-access", "X-User-Id": "synthetic-subject"},
        ).status_code
        == 401
    )


def test_migrations_are_additive_and_repeatable(auth) -> None:
    client, _, _ = auth
    from app.migrations import migrate_database

    migrate_database(client.app.state.database_engine)
    assert set(inspect(client.app.state.database_engine).get_table_names()) == {
        "alembic_version",
        "oauth_attempts",
        "web_sessions",
        "autodesk_connections",
    }


def test_access_log_discards_oauth_query() -> None:
    record = logging.LogRecord(
        "uvicorn.access",
        20,
        "",
        1,
        "%s %s %s %s %s",
        ("client", "GET", "/auth/autodesk/callback?code=sensitive&state=sensitive", "1.1", 303),
        None,
    )
    assert RedactQueryFilter().filter(record)
    assert "sensitive" not in record.getMessage()


def test_missing_config_is_closed_and_does_not_leak_secrets(tmp_path: Path) -> None:
    settings = Settings(_env_file=None, database_url=f"sqlite+pysqlite:///{tmp_path}/empty.db")
    with TestClient(create_app(settings)) as client:
        assert client.get("/auth/config").json() == {"configured": False}
        assert client.get("/auth/login").status_code == 503
        assert client.get("/auth/session").status_code == 401


def test_non_ascii_csrf_is_a_denial_instead_of_server_error(auth) -> None:
    client, _, _ = auth
    login(client)
    with pytest.raises(AuthFailure) as caught:
        client.app.state.auth_service.disconnect(client.cookies[SESSION_COOKIE], "no-válido")
    assert caught.value.status == 403


def test_new_login_purges_expired_sessions_and_credentials(auth) -> None:
    client, _, _ = auth
    login(client)
    with Session(client.app.state.database_engine) as db, db.begin():
        db.execute(update(WebSession).values(expires_at=0))
    begin(client)
    with Session(client.app.state.database_engine) as db:
        assert db.scalar(select(WebSession)) is None
        assert db.scalar(select(AutodeskConnection)) is None


def test_existing_session_survives_application_restart(auth) -> None:
    client, provider, settings = auth
    login(client)
    raw_id = client.cookies[SESSION_COOKIE]
    with TestClient(
        create_app(settings, httpx.MockTransport(provider.respond)),
        base_url="http://127.0.0.1:8000",
    ) as restarted:
        restarted.cookies.set(SESSION_COOKIE, raw_id)
        assert restarted.get("/auth/session").json()["user"]["subject"] == "synthetic-subject"


@pytest.mark.parametrize(
    "values",
    [
        {"access_allowed_domains": "*.example.test"},
        {"web_origin": "http://public.example.test"},
        {"aps_callback_url": "http://attacker.test/auth/autodesk/callback"},
        {"token_encryption_key": "invalid"},
    ],
)
def test_invalid_auth_config_fails_validation(values) -> None:
    with pytest.raises(ValueError):
        Settings(_env_file=None, **values)
