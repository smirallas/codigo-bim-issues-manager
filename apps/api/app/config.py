from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ISSUES_",
        env_file=Path(__file__).resolve().parents[3] / ".env",
        extra="ignore",
        populate_by_name=True,
        hide_input_in_errors=True,
    )

    database_url: str = "sqlite+pysqlite:///./data/issues.db"
    aps_client_id: str = Field(default="", validation_alias="APS_CLIENT_ID")
    aps_client_secret: SecretStr = Field(
        default=SecretStr(""), validation_alias="APS_CLIENT_SECRET"
    )
    aps_callback_url: str = Field(
        default="http://127.0.0.1:8000/auth/autodesk/callback", validation_alias="APS_CALLBACK_URL"
    )
    aps_select_usage_context: bool = Field(
        default=False, validation_alias="APS_SELECT_USAGE_CONTEXT"
    )
    web_origin: str = Field(default="http://127.0.0.1:5173", validation_alias="WEB_ORIGIN")
    access_allowed_emails: str = Field(default="", validation_alias="ACCESS_ALLOWED_EMAILS")
    access_allowed_domains: str = Field(default="", validation_alias="ACCESS_ALLOWED_DOMAINS")
    token_encryption_key: SecretStr = SecretStr("")
    session_ttl_seconds: int = Field(default=28800, ge=300, le=86400)
    cookie_secure: bool = False
    mcp_internal_secret: SecretStr = SecretStr("")
    mcp_issuer: str = "http://127.0.0.1:8001"

    @model_validator(mode="after")
    def validate_auth_settings(self) -> "Settings":
        """Evita callbacks arbitrarios, comodines y cookies inseguras fuera de loopback."""
        web, callback = urlsplit(self.web_origin), urlsplit(self.aps_callback_url)
        for url in (web, callback):
            if url.username or url.password or url.query or url.fragment or not url.hostname:
                raise ValueError("Invalid authentication URL")
            local = url.hostname in {"127.0.0.1", "localhost", "::1"}
            if url.scheme != "https" and not (local and url.scheme == "http"):
                raise ValueError("Authentication URLs require HTTPS outside loopback")
            if not local and not self.cookie_secure:
                raise ValueError("Secure cookies are required outside loopback")
        if web.path not in {"", "/"} or web.hostname != callback.hostname:
            raise ValueError("Web and callback must use the same hostname for the session cookie")
        if callback.path not in {"/auth/autodesk/callback", "/api/auth/autodesk/callback"}:
            raise ValueError("Unsupported callback path")
        if self.token_encryption_key.get_secret_value():
            Fernet(self.token_encryption_key.get_secret_value().encode())
        if any("*" in value or "@" in value for value in self.allowed_domains):
            raise ValueError("Allowed domains must be exact domain names")
        if any(value.count("@") != 1 or "*" in value for value in self.allowed_emails):
            raise ValueError("Allowed emails must be exact email addresses")
        return self

    @property
    def allowed_emails(self) -> set[str]:
        return {
            value.strip().casefold()
            for value in self.access_allowed_emails.split(",")
            if value.strip()
        }

    @property
    def allowed_domains(self) -> set[str]:
        return {
            value.strip().casefold()
            for value in self.access_allowed_domains.split(",")
            if value.strip()
        }

    @property
    def login_configured(self) -> bool:
        return bool(
            self.aps_client_id
            and self.aps_client_secret.get_secret_value()
            and self.token_encryption_key.get_secret_value()
            and (self.allowed_emails or self.allowed_domains)
        )
