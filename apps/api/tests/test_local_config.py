import runpy
from pathlib import Path

helper = runpy.run_path(str(Path(__file__).resolve().parents[3] / "scripts/init_local_env.py"))


def test_mcp_upgrade_preserves_existing_credentials_and_is_idempotent():
    original = (
        "APS_CLIENT_SECRET=private-aps-value\nISSUES_TOKEN_ENCRYPTION_KEY=private-fernet\n"
        "MCP_DATA_MODE=fixtures\nISSUES_MCP_INTERNAL_SECRET=\nMCP_STORAGE_KEY='private-mcp-key'\n"
    )
    upgrade = helper["add_mcp_secrets"]
    updated = upgrade(original)
    assert "APS_CLIENT_SECRET=private-aps-value\n" in updated
    assert "ISSUES_TOKEN_ENCRYPTION_KEY=private-fernet\n" in updated
    assert "MCP_STORAGE_KEY='private-mcp-key'\n" in updated
    assert "MCP_DATA_MODE=fixtures\n" in updated
    assert "ISSUES_MCP_INTERNAL_SECRET=\n" not in updated
    assert upgrade(updated) == updated


def test_new_mcp_secrets_are_distinct_and_not_static():
    upgrade = helper["add_mcp_secrets"]
    first = dict(line.split("=", 1) for line in upgrade("").splitlines())
    second = dict(line.split("=", 1) for line in upgrade("").splitlines())
    assert len(first["MCP_STORAGE_KEY"]) >= 43
    assert first["MCP_STORAGE_KEY"] != first["ISSUES_MCP_INTERNAL_SECRET"]
    assert first != second
