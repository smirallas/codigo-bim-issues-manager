"""Prepara configuración privada sin sobrescribirla ni imprimir la clave de cifrado."""

from pathlib import Path

from cryptography.fernet import Fernet


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    destination = root / ".env"
    if destination.exists():
        print("La configuración privada .env ya existe; no se ha modificado.")
        return
    example = (root / ".env.example").read_text(encoding="utf-8")
    key = Fernet.generate_key().decode()
    content = example.replace(
        "ISSUES_TOKEN_ENCRYPTION_KEY=\n", f"ISSUES_TOKEN_ENCRYPTION_KEY={key}\n"
    )
    with destination.open("x", encoding="utf-8", newline="\n") as output:
        output.write(content)
    print("Creado .env privado con clave propia. Completa APS y la lista de acceso en ese archivo.")


if __name__ == "__main__":
    main()
