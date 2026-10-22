# Configurar el login Autodesk

FastAPI concentra el intercambio OAuth. La web recibe una sesión, nunca tokens APS. Crea una aplicación **Traditional Web App** en [Autodesk Platform Services](https://aps.autodesk.com/) y registra exactamente este callback local:

```text
http://127.0.0.1:8000/auth/autodesk/callback
```

No mezcles `localhost` y `127.0.0.1`: el navegador debe enviar la cookie del intento OAuth al mismo hostname. Esta versión solicita `user-profile:read data:read account:read data:write`: identidad, lectura de datos/miembros y escritura de incidencias. Las etiquetas anteriores conservan sus permisos originales. Para pasar a esta versión, desconecta y vuelve a conectar Autodesk y revisa el consentimiento de escritura; renovar el token anterior no amplía sus scopes. Mantén Client ID, secreto, callback y reglas de acceso.

## Habilitar la consulta de proyectos

Activa Data Management en la aplicación APS. El administrador de la cuenta de construcción debe registrar su Client ID en **Account Admin → Custom integrations** (la ubicación puede variar según el producto). No basta con que el login funcione: el usuario necesita acceso al proyecto y a **Docs → Files**.

Si vienes de la versión de login, desconecta Autodesk e inicia sesión otra vez para aceptar el permiso de lectura. Renovar el token anterior no añade permisos que no hayas consentido. No cambian el callback ni los secretos del archivo `.env`.

El selector muestra hubs de construcción y proyectos con `projectType` igual a `ACC`. Omite proyectos heredados BIM 360, Fusion y otros tipos: sus APIs de incidencias no son intercambiables con las de esta demo. Conserva íntegros los identificadores Data Management, incluido el prefijo `b.`. Seleccionar no escribe en Autodesk ni acredita permisos para crear incidencias.

Una lista vacía sin advertencias indica que la consulta ha terminado sin proyectos compatibles accesibles. Una denegación se muestra como error. Si Autodesk devuelve advertencias, se muestran los resultados disponibles con un aviso de lista posiblemente incompleta, sin afirmar un vacío definitivo. Una advertencia de otra región puede acompañar a hubs válidos. Comprueba consentimiento, habilitación de la integración y acceso a Docs antes de asumir que un proyecto no existe.

Referencias: [consulta oficial de proyectos](https://get-started.aps.autodesk.com/tutorials/acc-issues/data), [tipos de proyectos ACC](https://get-started.aps.autodesk.com/tutorials/acc-admin/data) y [comprobaciones de acceso Autodesk](https://aps.autodesk.com/blog/cant-access-autodesk-docs-api-dont-panic-follow-these-checks).

## Preparar el archivo privado

Para consultar miembros se utiliza `GET construction/admin/v1/projects/{projectId}/users`, con `account:read`. Las capacidades se consultan por separado mediante `GET construction/issues/v1/projects/{projectId}/users/me`, con `data:read`. Al actualizar desde la versión de proyectos, desconecta y vuelve a conectar Autodesk para revisar el nuevo consentimiento. Mantén el mismo Client ID y callback; comprueba que la aplicación tenga habilitado el acceso a las APIs de construcción. Un 403 se conserva como denegación de esa cuenta, sin recurrir a un token administrativo o 2-legged.

El selector conserva el ID Data Management completo. Solo al llamar a Admin e Issues se valida el UUID y se retira su prefijo `b.`, como requieren esos endpoints. La comprobación de responsable es de lectura: vuelve a consultar proyecto, miembros y capacidades, distingue nombres repetidos y limita la asignación por empresa cuando Autodesk así lo indica. No crea ni asigna incidencias ni acredita permisos para modificar cualquier incidencia existente.

Referencias: [miembros del proyecto](https://aps.autodesk.com/en/docs/acc/v1/reference/http/admin-projectsprojectId-users-GET/) y [capacidades del usuario en Issues](https://aps.autodesk.com/en/docs/acc/v1/reference/http/issues-users-me-GET/).

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
