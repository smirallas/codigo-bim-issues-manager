"""E08: aprobación humana del contenido exacto de un plan."""

import sqlalchemy as sa
from alembic import op

revision = "0004_plan_approval"
down_revision = "0003_import_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("issue_plans", sa.Column("approval_digest", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("issue_plans", "approval_digest")
