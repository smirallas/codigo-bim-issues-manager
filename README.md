# Issues Manager · Código BIM

Ejemplo educativo de la serie de Código BIM sobre las APIs de Autodesk Forma y la gestión de incidencias. React/TypeScript, FastAPI/Python y una base MCP por Streamable HTTP. El MCP ofrece autorización propia del cliente, vinculada a la conexión Autodesk individual de FastAPI. El recorrido con un agente y la ejecución MCP siguen pendientes.

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

Crear y actualizar incidencias de Autodesk con Issues API → [crear-actualizar-incidencias-autodesk-issues-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/crear-actualizar-incidencias-autodesk-issues-api).

Importar incidencias desde Excel con Autodesk Issues API → [importar-incidencias-excel-autodesk-issues-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/importar-incidencias-excel-autodesk-issues-api).

Autenticar el cliente MCP con tu cuenta Autodesk → [autenticar-cliente-mcp-autodesk](https://github.com/smirallas/codigo-bim-issues-manager/tree/autenticar-cliente-mcp-autodesk).

## Qué puedes hacer con esta versión

- Iniciar sesión con tu cuenta Autodesk mediante OAuth 3-legged y PKCE, con `user-profile:read`, `data:read`, `account:read` y `data:write`.
- Restringir el acceso por correo o dominio, comprobado en el servidor.
- Mantener una sesión web, renovar las credenciales y desconectar Autodesk.
- Conservar los tokens cifrados por conexión en SQLite, con migraciones.
- Consultar hubs y proyectos ACC/Forma accesibles, y seleccionar un proyecto tras comprobarlo de nuevo en el servidor.
- Consultar miembros y capacidades de Issues por separado, y comprobar un posible responsable por identidad Autodesk sin asignarlo.
- Consultar tipos activos e incidencias paginadas, preparar una creación y actualizar título, descripción o estado según los permisos de cada incidencia.
- Importar una plantilla Excel de hasta 25 filas: validar, revisar, aprobar las filas válidas y recuperar resultados sin reenviar las ya procesadas.
- Revisar una preparación inmutable durante diez minutos antes de confirmar su envío. Se revalidan contexto, permisos y datos; el resultado queda guardado y el mismo plan no vuelve a escribir.
- Autorizar un cliente MCP mediante OAuth, PKCE y consentimiento; consultar datos y preparar revisiones con su propia conexión Autodesk.
- Ejecutar pruebas sin credenciales reales y ensayar los contratos MCP con datos sintéticos.

Esta versión incorpora operaciones individuales con Issues API e importación desde una plantilla Excel. Las etiquetas anteriores conservan su alcance. El MCP expone once herramientas. El modo predeterminado `disabled` bloquea las llamadas y `fixtures` usa solo datos sintéticos. En `autodesk`, exige una credencial propia de quince minutos antes de consultar datos; FastAPI revalida la conexión individual y la lista de acceso. La ejecución de incidencias desde MCP sigue bloqueada. No incluye adjuntos, pushpins, visor, campos personalizados ni eliminación. La actualización de responsable queda fuera; al crear, si se elige uno, se resuelve por identidad Autodesk y se revalida su empresa cuando corresponde.

Las preparaciones y resultados se cifran en SQLite y se vinculan a la sesión autenticada. La confirmación web exige origen y CSRF; no se acepta un payload nuevo en la ejecución. Tras un timeout o fallo remoto ambiguo, se conserva un resultado incierto y no se reenvía. Comprueba Autodesk antes de preparar otra operación: no se garantiza ausencia absoluta de duplicados entre planes distintos. Un proceso interrumpido puede dejar el plan en «running»; tampoco se reejecuta. La comprobación de cambios antes de PATCH evita sobrescribir una revisión obsoleta detectada, pero no es un bloqueo transaccional en Autodesk.

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

El script ejecuta formato, lint, tipos, pruebas y builds. Las pruebas usan transportes simulados y SQLite temporal; no requieren credenciales ni consultan Autodesk. Las pruebas OAuth completan consentimiento y PKCE contra un proveedor local con identidades sintéticas; no prueban por sí solas el acceso Autodesk real.

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

Con los servicios arrancados, `pnpm smoke` comprueba API, SQLite y proxy web. En modo autenticado verifica el rechazo anónimo y el descubrimiento OAuth sin consultar Autodesk; en los otros modos verifica el catálogo y el bloqueo de ejecución. El MCP nativo admite su propio `apps/mcp/.env`; no necesita ni debe recibir los secretos APS de la API.

## Importación Excel

Selecciona un proyecto y descarga la plantilla desde «Importar incidencias desde Excel». Preparar el archivo muestra datos y errores por fila, sin escrituras. Después se aprueban las filas válidas y cada una se envía mediante el servicio de incidencias, con permisos revalidados y resultados persistentes. [Columnas, límites y recuperación](docs/importar-excel.md). No se importan archivos arbitrarios ni se ejecutan fórmulas. Un lote nuevo puede duplicar incidencias: consulta siempre el resultado guardado tras una respuesta perdida.

## Contenido del repositorio

Código fuente, tests, migraciones, manifiestos, lockfiles, configuración de ejemplo, scripts y documentación para reproducir el ejemplo. Quedan fuera archivos privados, bases de datos, sesiones, capturas, artículos, registros de pruebas reales, documentación interna, dependencias y archivos generados. `.gitignore` parte de una lista de rutas permitidas.

Se adaptan patrones de un proyecto propio, DataForge: conexión individual, canje y renovación HTTP y separación de claves. No se distribuyen la plataforma de origen ni sus credenciales.

## Licencia

[MIT](LICENSE), Copyright 2026 Sergio Mirallas. Las cuentas y servicios Autodesk requieren su propia configuración y condiciones; este repositorio no concede acceso a proyectos de terceros.

## Herramientas MCP

[Autorización y configuración del cliente](docs/autenticacion-mcp.md): credenciales MCP separadas de APS, descubrimiento OAuth, cliente preinscrito, consentimiento y contexto interno validado por FastAPI. El cliente SDK local está en `/client` solo en modo `autodesk`. No hay agente conectado ni ejecución MCP. El [ensayo sintético de contratos](docs/herramientas-mcp.md) sigue disponible en modo `fixtures`.
