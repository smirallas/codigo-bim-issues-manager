from pathlib import Path

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url


def create_database_engine(database_url: str) -> Engine:
    """Prepara SQLite en disco; las tablas se gestionan mediante migraciones versionadas."""
    url = make_url(database_url)
    if url.drivername != "sqlite+pysqlite" or not url.database or url.database == ":memory:":
        raise ValueError("E00 requires a file-backed sqlite+pysqlite database")
    Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    return create_engine(url, connect_args={"check_same_thread": False, "timeout": 3})


def check_database(engine: Engine) -> None:
    """Comprueba la conexión local sin escribir datos de negocio."""
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
