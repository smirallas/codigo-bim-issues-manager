"""E05: revisión privada de Excel y aprobación de sus filas válidas."""

import sqlalchemy as sa
from alembic import op

revision = "0003_import_plans"
down_revision = "0002_issue_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "import_plans",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("session_hash", sa.String(64), nullable=False, index=True),
        sa.Column("content_encrypted", sa.Text(), nullable=False),
        sa.Column("errors_encrypted", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("approved_at", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("import_plans")
