# Issues Manager · Código BIM

Ejemplo educativo de la serie de Código BIM sobre las APIs de Autodesk Forma y la gestión de incidencias. React/TypeScript, FastAPI/Python y una base MCP por Streamable HTTP. La serie llegará a un servidor MCP para un agente de IA; esa funcionalidad todavía no está implementada.

## Código completo de cada artículo

Cada etiqueta conserva el código tal como queda al terminar un artículo. `main` contiene el trabajo más reciente; para seguir un artículo, utiliza la etiqueta que lleva su nombre.

| Artículo                                                    | Código completo al terminarlo                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login con Autodesk en FastAPI: sesión y acceso restringido  | [login-autodesk-fastapi](https://github.com/smirallas/codigo-bim-issues-manager/tree/login-autodesk-fastapi)                                                     |
| Consultar tus proyectos de Autodesk con Data Management API | [consultar-proyectos-autodesk-data-management-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/consultar-proyectos-autodesk-data-management-api) |

```powershell
git clone https://github.com/smirallas/codigo-bim-issues-manager.git
cd codigo-bim-issues-manager
git switch --detach login-autodesk-fastapi
```

La etiqueta identifica una versión reproducible del código, no una certificación de producción. [Versiones y comprobaciones](docs/versiones.md).

Miembros y permisos de Autodesk: comprobar responsables con Issues API → [miembros-permisos-autodesk-issues-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/miembros-permisos-autodesk-issues-api).

## Qué puedes hacer con esta versión

- Iniciar sesión con tu cuenta Autodesk mediante OAuth 3-legged y PKCE, con los permisos de lectura `user-profile:read`, `data:read` y `account:read`.
- Restringir el acceso por correo o dominio, comprobado en el servidor.
- Mantener una sesión web, renovar las credenciales y desconectar Autodesk.
- Conservar los tokens cifrados por conexión en SQLite, con migraciones.
- Consultar hubs y proyectos ACC/Forma accesibles, y seleccionar un proyecto tras comprobarlo de nuevo en el servidor.
- Consultar miembros y capacidades de Issues por separado, y comprobar un posible responsable por identidad Autodesk sin asignarlo.
- Ejecutar pruebas sin credenciales reales y arrancar la base MCP con catálogo vacío.

Esta versión incorpora miembros y capacidades de Issues. Las etiquetas de los artículos anteriores conservan las versiones de login y selección de proyectos. Todavía no permite consultar o modificar incidencias, importar Excel ni utilizar herramientas de negocio MCP. El MCP no autentica usuarios y no debe recibir datos privados.

## Arranque local con Docker

Requisitos: Git y Docker con Compose. Los puertos se publican solo en `127.0.0.1`.

```powershell
docker compose up --build --wait --wait-timeout 120
```

Abre <http://127.0.0.1:5173>. Sin configuración APS la aplicación arranca y mantiene el login deshabilitado. Para habilitarlo sigue la [configuración APS](docs/configuracion-aps.md).

| Servicio | Dirección                    |
| -------- | ---------------------------- |
| Web      | <http://127.0.0.1:5173>      |
| API      | <http://127.0.0.1:8000/docs> |
| MCP      | `http://127.0.0.1:8001/mcp`  |

El nombre Compose `issues-manager-e00` conserva el volumen histórico `issues-manager-e00_api-data`. `docker compose down` conserva los datos; `down -v` los elimina. La web usa `vite preview`; las imágenes son para desarrollo local, no un despliegue de producción.

## Desarrollo y comprobaciones

Versiones del ejemplo: Node 22.23.1, pnpm 9.15.9, Python 3.12.13 y uv 0.11.25. Manifiestos y lockfiles fijan las dependencias.

```powershell
pnpm install --frozen-lockfile
uv sync --frozen --all-packages
uv run --frozen python scripts/init_local_env.py
./scripts/check.ps1
```

El script ejecuta formato, lint, tipos, pruebas y builds. Las pruebas usan transportes simulados y SQLite temporal; no requieren credenciales ni consultan Autodesk. Una fixture OAuth del cliente MCP explora el protocolo y no habilita autenticación de producto.

Para desarrollar sin Docker, abre tres terminales desde la raíz:

```powershell
uv run --frozen --directory apps/api uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
pnpm dev:web
```

```powershell
pnpm dev:mcp
```

Con los servicios arrancados, `pnpm smoke` comprueba API, SQLite, proxy web y conexión MCP con catálogo vacío. El MCP nativo admite su propio `apps/mcp/.env`; no necesita ni debe recibir los secretos APS de la API.

## Contenido del repositorio

Código fuente, tests, migraciones, manifiestos, lockfiles, configuración de ejemplo, scripts y documentación para reproducir el ejemplo. Quedan fuera archivos privados, bases de datos, sesiones, capturas, artículos, registros de pruebas reales, documentación interna, dependencias y archivos generados. `.gitignore` parte de una lista de rutas permitidas.

Se adaptan patrones de un proyecto propio, DataForge: conexión individual, canje y renovación HTTP y separación de claves. No se distribuyen la plataforma de origen ni sus credenciales.

## Licencia

[MIT](LICENSE), Copyright 2026 Sergio Mirallas. Las cuentas y servicios Autodesk requieren su propia configuración y condiciones; este repositorio no concede acceso a proyectos de terceros.
