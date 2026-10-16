from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class OAuthAttempt(Base):
    __tablename__ = "oauth_attempts"
    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    browser_hash: Mapped[str] = mapped_column(String(64))
    verifier_encrypted: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[int]


class WebSession(Base):
    __tablename__ = "web_sessions"
    id_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(255))
    csrf_token: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[int]


class AutodeskConnection(Base):
    __tablename__ = "autodesk_connections"
    session_hash: Mapped[str] = mapped_column(ForeignKey("web_sessions.id_hash"), primary_key=True)
    access_encrypted: Mapped[str] = mapped_column(Text)
    refresh_encrypted: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[int]
