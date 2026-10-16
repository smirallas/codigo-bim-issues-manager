# Configurar el login Autodesk

FastAPI concentra el intercambio OAuth. La web recibe una sesión, nunca tokens APS. Crea una aplicación **Traditional Web App** en [Autodesk Platform Services](https://aps.autodesk.com/) y registra exactamente este callback local:

```text
http://127.0.0.1:8000/auth/autodesk/callback
```

No mezcles `localhost` y `127.0.0.1`: el navegador debe enviar la cookie del intento OAuth al mismo hostname. El scope de esta versión es `user-profile:read`; no solicita acceso a proyectos ni escrituras.

## Preparar el archivo privado

Con Python y uv instalados, desde la raíz:

```powershell
uv sync --frozen --all-packages
uv run --frozen python scripts/init_local_env.py
```

El script crea `.env` desde `.env.example`, genera una clave Fernet propia sin imprimirla y no sobrescribe un archivo existente. No compartas `.env` ni pegues secretos en capturas, incidencias o comentarios del repositorio.

| Variable                      | Configuración                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `APS_CLIENT_ID`               | Identificador de tu aplicación APS.                                                 |
| `APS_CLIENT_SECRET`           | Secreto de esa aplicación; solo backend.                                            |
| `APS_CALLBACK_URL`            | Callback exacto registrado arriba.                                                  |
| `WEB_ORIGIN`                  | `http://127.0.0.1:5173` para esta configuración local.                              |
| `ACCESS_ALLOWED_EMAILS`       | Correos exactos separados por comas.                                                |
| `ACCESS_ALLOWED_DOMAINS`      | Dominios exactos separados por comas, sin `@`, comodines ni subdominios implícitos. |
| `ISSUES_TOKEN_ENCRYPTION_KEY` | Clave Fernet propia generada por el script; mantenerla entre arranques.             |
| `ISSUES_SESSION_TTL_SECONDS`  | `28800`: sesión absoluta de ocho horas, sin extensión al renovar.                   |
| `ISSUES_COOKIE_SECURE`        | `false` solo para HTTP local; con HTTPS debe ser `true`.                            |

Configura al menos un correo o dominio autorizado. La API exige un perfil oficial con identificador estable y correo verificado; una identidad indicada por el cliente no acredita acceso.

Después de completar `.env`, recrea los servicios:

```powershell
docker compose up --build --wait --wait-timeout 120
```

No compartas la salida de `docker compose config` sin `--quiet`: interpola los secretos.

## Sesión, renovación y límites

El navegador guarda una cookie HttpOnly y SameSite=Lax. SQLite conserva el hash de sesión y los tokens cifrados por conexión. La ruta de sesión revalida perfil y lista de acceso; renueva el access token cuando quedan 30 segundos o menos. La duración del token la devuelve APS. La renovación no amplía las ocho horas de sesión.

La desconexión exige origen y CSRF, elimina el acceso local e intenta revocar las credenciales en Autodesk. Una revocación no confirmada se comunica como tal; no mantiene la sesión local. No cierra la sesión global Autodesk ni la de otros navegadores.

La base SQLite serializa renovaciones y este ejemplo no está preparado para alta concurrencia ni despliegue público. El MCP sigue sin autenticación de producto y con catálogo vacío: no añadir datos privados antes de implementar esa parte de la serie.

Referencia: [autenticación oficial APS](https://aps.autodesk.com/en/docs/oauth/v2/).
