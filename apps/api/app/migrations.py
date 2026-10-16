from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine


def migrate_database(engine: Engine) -> None:
    """Aplica las migraciones versionadas antes de aceptar sesiones de la demo local."""
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
