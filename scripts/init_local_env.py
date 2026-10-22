"""Prepara configuración privada sin sobrescribirla ni imprimir la clave de cifrado."""

import argparse
import re
import secrets
from pathlib import Path

from cryptography.fernet import Fernet


def add_mcp_secrets(content: str) -> str:
    """Añade solo claves MCP ausentes/vacías; conserva APS, Fernet y valores existentes."""
    for variable in ("ISSUES_MCP_INTERNAL_SECRET", "MCP_STORAGE_KEY"):
        pattern = rf"^{variable}=(.*)$"
        found = re.search(pattern, content, flags=re.MULTILINE)
        if found and found.group(1).strip().strip("\"'"):
            continue
        assignment = f"{variable}={secrets.token_urlsafe(48)}"
        if found:
            content = content[: found.start()] + assignment + content[found.end() :]
        else:
            separator = "" if not content or content.endswith("\n") else "\n"
            content += separator + assignment + "\n"
    return content


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--add-mcp",
        action="store_true",
        help="Añadir claves MCP a .env sin cambiar la configuración existente",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    destination = root / ".env"
    if destination.exists():
        if args.add_mcp:
            content = destination.read_text(encoding="utf-8")
            updated = add_mcp_secrets(content)
            if updated != content:
                destination.write_text(updated, encoding="utf-8", newline="\n")
            print(
                "Claves MCP preparadas; se conserva la configuración existente. Sin mostrar claves."
            )
            return
        print("La configuración privada .env ya existe; no se ha modificado.")
        return
    example = (root / ".env.example").read_text(encoding="utf-8")
    key = Fernet.generate_key().decode()
    content = example.replace(
        "ISSUES_TOKEN_ENCRYPTION_KEY=\n", f"ISSUES_TOKEN_ENCRYPTION_KEY={key}\n"
    )
    content = add_mcp_secrets(content)
    with destination.open("x", encoding="utf-8", newline="\n") as output:
        output.write(content)
    print("Creado .env privado con clave propia. Completa APS y la lista de acceso en ese archivo.")


if __name__ == "__main__":
    main()
