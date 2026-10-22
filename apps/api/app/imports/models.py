from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.models import Base


class ImportPlan(Base):
    __tablename__ = "import_plans"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_hash: Mapped[str] = mapped_column(String(64), index=True)
    content_encrypted: Mapped[str] = mapped_column(Text)
    errors_encrypted: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[int]
    approved_at: Mapped[int | None]
