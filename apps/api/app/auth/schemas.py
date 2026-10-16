from typing import Literal

from pydantic import BaseModel


class AuthConfigResponse(BaseModel):
    configured: bool


class UserIdentity(BaseModel):
    subject: str
    email: str
    name: str


class SessionResponse(BaseModel):
    user: UserIdentity
    csrf_token: str
    expires_at: int


class DisconnectResponse(BaseModel):
    local_disconnected: Literal[True] = True
    provider_revocation: Literal["confirmed", "unconfirmed"]
