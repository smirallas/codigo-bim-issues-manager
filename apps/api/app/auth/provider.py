from typing import cast

import httpx
from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.httpx_client import OAuth2Client
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.config import Settings

AUTHORIZE_URL = "https://developer.api.autodesk.com/authentication/v2/authorize"
EXCHANGE_URL = "https://developer.api.autodesk.com/authentication/v2/token"
REVOKE_URL = "https://developer.api.autodesk.com/authentication/v2/revoke"
USERINFO_URL = "https://api.userprofile.autodesk.com/userinfo"
APS_SCOPE = "user-profile:read data:read account:read data:write"
CLIENT_AUTH_METHOD = "client_secret_basic"


class Profile(BaseModel):
    model_config = ConfigDict(strict=True)
    sub: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=320)
    email_verified: StrictBool
    name: str = Field(default="", max_length=255)


class TokenData(BaseModel):
    access_token: str = Field(min_length=1)
    refresh_token: str = Field(min_length=1)
    expires_in: int = Field(gt=0)
    token_type: str


class AutodeskProvider:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self.settings = settings
        self.transport = transport

    def _client(self) -> OAuth2Client:
        return OAuth2Client(
            client_id=self.settings.aps_client_id,
            client_secret=self.settings.aps_client_secret.get_secret_value(),
            token_endpoint_auth_method=CLIENT_AUTH_METHOD,
            revocation_endpoint_auth_method=CLIENT_AUTH_METHOD,
            redirect_uri=self.settings.aps_callback_url,
            scope=APS_SCOPE,
            code_challenge_method="S256",
            timeout=10,
            follow_redirects=False,
            trust_env=False,
            transport=self.transport,
        )

    def authorization_url(self, state: str, verifier: str) -> str:
        """Authlib construye la petición 3-legged con PKCE; el secreto nunca va a la URL."""
        # Solo una aplicación preparada para passthrough debe pedir el contexto de consumo.
        prompt = "select_usage_context" if self.settings.aps_select_usage_context else "login"
        with self._client() as client:
            url, _ = client.create_authorization_url(
                AUTHORIZE_URL, state=state, code_verifier=verifier, prompt=prompt
            )
        return cast(str, url)

    def exchange_code(self, code: str, verifier: str) -> TokenData:
        with self._client() as client:
            token = client.fetch_token(
                EXCHANGE_URL, grant_type="authorization_code", code=code, code_verifier=verifier
            )
        return self._tokens(token)

    def refresh(self, refresh_token: str) -> TokenData:
        with self._client() as client:
            token = dict(client.refresh_token(EXCHANGE_URL, refresh_token=refresh_token))
        token.setdefault("refresh_token", refresh_token)
        return self._tokens(token)

    @staticmethod
    def _tokens(value: object) -> TokenData:
        token = TokenData.model_validate(value)
        if token.token_type.casefold() != "bearer":
            raise ValueError("Unsupported token type")
        return token

    def profile(self, access_token: str) -> Profile:
        """Consulta el origen oficial, sin aceptar identidad ni correos del navegador."""
        with httpx.Client(transport=self.transport, timeout=10, trust_env=False) as client:
            response = client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
            response.raise_for_status()
            return Profile.model_validate(response.json())

    def revoke(self, access_token: str, refresh_token: str) -> bool:
        """Intenta revocar ambos tokens; una respuesta incierta no se anuncia como éxito remoto."""
        confirmed = True
        for token, hint in ((refresh_token, "refresh_token"), (access_token, "access_token")):
            try:
                with self._client() as client:
                    response = client.revoke_token(REVOKE_URL, token=token, token_type_hint=hint)
                    response.raise_for_status()
            except (httpx.HTTPError, OAuthError, ValueError):
                confirmed = False
        return confirmed
