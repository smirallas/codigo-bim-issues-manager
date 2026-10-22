"""E04: preparaciones inmutables y resultados privados de escrituras individuales."""

import sqlalchemy as sa
from alembic import op

revision = "0002_issue_plans"
down_revision = "0001_auth_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "issue_plans",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("session_hash", sa.String(64), nullable=False, index=True),
        sa.Column("content_encrypted", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("approved_at", sa.Integer(), nullable=True),
        sa.Column("result_encrypted", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("issue_plans")
