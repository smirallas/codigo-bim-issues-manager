from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

import pytest
from app.config import Settings
from app.database import create_database_engine
from app.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(_env_file=None, database_url=f"sqlite+pysqlite:///{tmp_path}/issues.db")
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def test_health_and_file_database(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok", "service": "api"}
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "checks": {"database": "ok"}}
    assert Path(client.app.state.database_engine.url.database).is_file()


def test_database_failure_is_not_ready(client: TestClient) -> None:
    with patch("app.main.check_database", side_effect=OperationalError("probe", {}, Exception())):
        response = client.get("/ready")
    assert response.status_code == 503
    assert response.json()["checks"]["database"] == "error"
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize("path", ["/projects", "/issues"])
def test_future_routes_are_absent(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 404


def test_in_memory_database_is_rejected() -> None:
    with pytest.raises(ValueError, match="file-backed"):
        create_database_engine("sqlite+pysqlite:///:memory:")
