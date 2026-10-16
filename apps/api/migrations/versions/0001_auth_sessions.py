"""E01: intentos OAuth caducables, sesiones opacas y conexiones APS cifradas."""

import sqlalchemy as sa
from alembic import op

revision = "0001_auth_sessions"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oauth_attempts",
        sa.Column("state_hash", sa.String(64), primary_key=True),
        sa.Column("browser_hash", sa.String(64), nullable=False),
        sa.Column("verifier_encrypted", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
    )
    op.create_table(
        "web_sessions",
        sa.Column("id_hash", sa.String(64), primary_key=True),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("csrf_token", sa.String(128), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
    )
    op.create_table(
        "autodesk_connections",
        sa.Column(
            "session_hash", sa.String(64), sa.ForeignKey("web_sessions.id_hash"), primary_key=True
        ),
        sa.Column("access_encrypted", sa.Text(), nullable=False),
        sa.Column("refresh_encrypted", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("autodesk_connections")
    op.drop_table("web_sessions")
    op.drop_table("oauth_attempts")
