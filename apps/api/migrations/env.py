from alembic import context
from app.auth.models import Base

# La conexión la entrega el bootstrap; no hay credenciales ni URL duplicada en este archivo.
connection = context.config.attributes["connection"]
context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
with context.begin_transaction():
    context.run_migrations()
