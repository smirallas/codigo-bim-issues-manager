"""Contexto interno del MCP: credenciales propias y conexión APS del mismo usuario."""

import json
import time
from typing import Any

from authlib.jose import JoseError, JsonWebToken
from cryptography.fernet import InvalidToken
from fastapi import APIRouter, Request

from app.auth.router import SESSION_COOKIE, auth_service
from app.auth.service import AuthFailure, fingerprint

router = APIRouter(prefix="/mcp", tags=["mcp authentication"])
API_AUDIENCE = "issues-manager-api"
codec = JsonWebToken(["HS256"])


def context_claims(request: Request, purpose: str) -> dict[str, Any]:
    """Solo acepta JWT internos de 30 segundos; un bearer APS/MCP no sirve en la API."""
    config = auth_service(request).settings
    secret = config.mcp_internal_secret.get_secret_value()
    bearer = request.headers.get("authorization", "")
    if len(secret) < 43 or not bearer.startswith("Bearer ") or len(bearer) > 16384:
        raise AuthFailure("invalid_mcp_context")
    try:
        claims = codec.decode(
            bearer[7:],
            secret,
            claims_options={
                "iss": {"essential": True, "value": config.mcp_issuer},
                "aud": {"essential": True, "value": API_AUDIENCE},
                "exp": {"essential": True},
                "iat": {"essential": True},
                "sub": {"essential": True},
            },
        )
        claims.validate(leeway=0)
        now = int(time.time())
        if (
            claims.get("purpose") != purpose
            or claims["iat"] > now
            or claims["exp"] - claims["iat"] > 30
        ):
            raise ValueError("Invalid context lifetime")
        return dict(claims)
    except (JoseError, ValueError, TypeError, KeyError) as exc:
        raise AuthFailure("invalid_mcp_context") from exc


@router.get("/bind")
def bind(request: Request) -> dict[str, Any]:
    """Revalida la sesión visible y sella su referencia; nunca devuelve credenciales APS."""
    context_claims(request, "bind")
    session_id = request.cookies.get(SESSION_COOKIE, "")
    auth = auth_service(request)
    info = auth.session_info(session_id)
    binding = auth._encrypt(
        json.dumps({"session": session_id, "sub": info.subject, "exp": info.expires_at})
    )
    return {
        "subject": info.subject,
        "connection": fingerprint(session_id),
        "name": info.name,
        "expires_at": info.expires_at,
        "binding": binding,
    }


def delegated_session(request: Request) -> tuple[str, str]:
    """Reconstruye la conexión privada y revalida acceso, perfil y caducidad en FastAPI."""
    claims = context_claims(request, "delegate")
    auth = auth_service(request)
    try:
        binding = json.loads(auth._decrypt(claims["binding"]))
        if binding["exp"] <= int(time.time()) or binding["sub"] != claims["sub"]:
            raise ValueError("Invalid binding")
        session_id = binding["session"]
        info, access = auth._validated_session(session_id)
        if info.subject != claims["sub"]:
            raise ValueError("Invalid identity")
        return session_id, access
    except (InvalidToken, ValueError, TypeError, KeyError) as exc:
        raise AuthFailure("invalid_mcp_context") from exc
