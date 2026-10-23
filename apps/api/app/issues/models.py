from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.models import Base


class IssuePlan(Base):
    __tablename__ = "issue_plans"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_hash: Mapped[str] = mapped_column(String(64), index=True)
    content_encrypted: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[int]
    state: Mapped[str] = mapped_column(String(32))
    approved_at: Mapped[int | None]
    approval_digest: Mapped[str | None] = mapped_column(String(64))
    result_encrypted: Mapped[str | None] = mapped_column(Text)
