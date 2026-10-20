import hashlib
import secrets
import time
from dataclasses import dataclass

import httpx
from authlib.integrations.base_client.errors import OAuthError
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Engine, delete, select, text
from sqlalchemy.orm import Session

from app.auth.models import AutodeskConnection, OAuthAttempt, WebSession
from app.auth.provider import AutodeskProvider, Profile, TokenData
from app.config import Settings


class AuthFailure(Exception):
    def __init__(self, code: str, status: int = 401) -> None:
        self.code = code
        self.status = status


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class SessionInfo:
    subject: str
    email: str
    name: str
    csrf_token: str
    expires_at: int


class AuthService:
    def __init__(self, engine: Engine, settings: Settings, provider: AutodeskProvider) -> None:
        self.engine = engine
        self.settings = settings
        self.provider = provider

    def _cipher(self) -> Fernet:
        if not self.settings.login_configured:
            raise AuthFailure("not_configured", 503)
        return Fernet(self.settings.token_encryption_key.get_secret_value().encode())

    def _encrypt(self, value: str) -> str:
        return self._cipher().encrypt(value.encode()).decode()

    def _decrypt(self, value: str) -> str:
        return self._cipher().decrypt(value.encode()).decode()

    def _allowed(self, profile: Profile) -> bool:
        email = profile.email.strip().casefold()
        if not profile.email_verified or email.count("@") != 1 or any(c.isspace() for c in email):
            return False
        local, domain = email.split("@")
        return bool(
            local
            and domain
            and (email in self.settings.allowed_emails or domain in self.settings.allowed_domains)
        )

    def start_login(self) -> tuple[str, str]:
        """Guarda una transacción caducable y vinculada al navegador, sin usar una sesión JWT."""
        self._cipher()
        state, browser, verifier = (secrets.token_urlsafe(48) for _ in range(3))
        now = int(time.time())
        with Session(self.engine) as db, db.begin():
            db.execute(delete(OAuthAttempt).where(OAuthAttempt.expires_at <= now))
            expired = select(WebSession.id_hash).where(WebSession.expires_at <= now)
            db.execute(
                delete(AutodeskConnection).where(AutodeskConnection.session_hash.in_(expired))
            )
            db.execute(delete(WebSession).where(WebSession.expires_at <= now))
            db.add(
                OAuthAttempt(
                    state_hash=fingerprint(state),
                    browser_hash=fingerprint(browser),
                    verifier_encrypted=self._encrypt(verifier),
                    expires_at=now + 600,
                )
            )
        return self.provider.authorization_url(state, verifier), browser

    def complete_login(
        self,
        state: str,
        browser: str,
        code: str | None,
        error: str | None,
        old_session: str | None = None,
    ) -> str:
        """Consume state una sola vez y autoriza la identidad devuelta por Autodesk."""
        self._cipher()
        with Session(self.engine) as db, db.begin():
            verifier_enc = db.execute(
                delete(OAuthAttempt)
                .where(
                    OAuthAttempt.state_hash == fingerprint(state),
                    OAuthAttempt.browser_hash == fingerprint(browser),
                    OAuthAttempt.expires_at > int(time.time()),
                )
                .returning(OAuthAttempt.verifier_encrypted)
            ).scalar_one_or_none()
        if verifier_enc is None:
            raise AuthFailure("invalid_callback", 400)
        if error:
            raise AuthFailure("cancelled" if error == "access_denied" else "provider_error", 400)
        if not code:
            raise AuthFailure("invalid_callback", 400)
        tokens: TokenData | None = None
        try:
            tokens = self.provider.exchange_code(code, self._decrypt(verifier_enc))
            profile = self.provider.profile(tokens.access_token)
        except (httpx.HTTPError, OAuthError, ValueError, InvalidToken) as exc:
            if tokens:
                self.provider.revoke(tokens.access_token, tokens.refresh_token)
            raise AuthFailure("provider_error", 502) from exc
        if not self._allowed(profile):
            self.provider.revoke(tokens.access_token, tokens.refresh_token)
            raise AuthFailure("access_denied", 403)
        session_id = secrets.token_urlsafe(48)
        now = int(time.time())
        with Session(self.engine) as db, db.begin():
            if old_session:
                self._delete_session(db, fingerprint(old_session))
            session_hash = fingerprint(session_id)
            db.add(
                WebSession(
                    id_hash=session_hash,
                    subject=profile.sub,
                    email=profile.email.strip().casefold(),
                    name=profile.name,
                    csrf_token=secrets.token_urlsafe(32),
                    expires_at=now + self.settings.session_ttl_seconds,
                )
            )
            db.flush()
            db.add(self._connection(session_hash, tokens, now))
        return session_id

    def _connection(self, session_hash: str, tokens: TokenData, now: int) -> AutodeskConnection:
        return AutodeskConnection(
            session_hash=session_hash,
            access_encrypted=self._encrypt(tokens.access_token),
            refresh_encrypted=self._encrypt(tokens.refresh_token),
            expires_at=now + tokens.expires_in,
        )

    @staticmethod
    def _delete_session(db: Session, session_hash: str) -> None:
        db.execute(
            delete(AutodeskConnection).where(AutodeskConnection.session_hash == session_hash)
        )
        db.execute(delete(WebSession).where(WebSession.id_hash == session_hash))

    def session_info(self, session_id: str) -> SessionInfo:
        return self._validated_session(session_id)[0]

    def authorized_access(self, session_id: str) -> str:
        """Credencial solo para adaptadores del servidor, tras revalidar la sesión."""
        return self._validated_session(session_id)[1]

    def _validated_session(self, session_id: str) -> tuple[SessionInfo, str]:
        """Revalida acceso y perfil; serializa la renovación para no reutilizar refresh tokens."""
        self._cipher()
        session_hash = fingerprint(session_id)
        failure: AuthFailure | None = None
        result: SessionInfo | None = None
        with Session(self.engine) as db:
            # SQLite serializa este tramo incluso entre procesos de la demo de una instancia.
            db.execute(text("BEGIN IMMEDIATE"))
            session = db.get(WebSession, session_hash)
            connection = db.get(AutodeskConnection, session_hash)
            if not session or not connection:
                raise AuthFailure("unauthenticated")
            now = int(time.time())
            if session.expires_at <= now:
                failure = AuthFailure("session_expired")
            else:
                try:
                    access = self._decrypt(connection.access_encrypted)
                    if connection.expires_at <= now + 30:
                        tokens = self.provider.refresh(self._decrypt(connection.refresh_encrypted))
                        access = tokens.access_token
                        connection.access_encrypted = self._encrypt(access)
                        connection.refresh_encrypted = self._encrypt(tokens.refresh_token)
                        connection.expires_at = now + tokens.expires_in
                    profile = self.provider.profile(access)
                    if profile.sub != session.subject or not self._allowed(profile):
                        failure = AuthFailure("access_denied", 403)
                    else:
                        session.email = profile.email.strip().casefold()
                        session.name = profile.name
                        result = SessionInfo(
                            session.subject,
                            session.email,
                            session.name,
                            session.csrf_token,
                            session.expires_at,
                        )
                except (httpx.HTTPError, OAuthError, ValueError, InvalidToken):
                    failure = AuthFailure("reconnect_required")
            if failure:
                self._delete_session(db, session_hash)
            db.commit()
        if failure:
            raise failure
        if result is None:
            raise AuthFailure("unauthenticated")
        return result, access

    def disconnect(self, session_id: str, csrf_token: str) -> bool:
        """Elimina primero el acceso local, aunque la revocación remota no pueda confirmarse."""
        with Session(self.engine) as db, db.begin():
            session_hash = fingerprint(session_id)
            session = db.get(WebSession, session_hash)
            if not session:
                raise AuthFailure("unauthenticated")
            if not secrets.compare_digest(session.csrf_token.encode(), csrf_token.encode()):
                raise AuthFailure("invalid_csrf", 403)
            connection = db.get(AutodeskConnection, session_hash)
            tokens: tuple[str, str] | None = None
            if connection:
                try:
                    tokens = (
                        self._decrypt(connection.access_encrypted),
                        self._decrypt(connection.refresh_encrypted),
                    )
                except (InvalidToken, AuthFailure):
                    pass
            self._delete_session(db, session_hash)
        return bool(tokens and self.provider.revoke(*tokens))
