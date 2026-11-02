# Issues Manager · Código BIM

Ejemplo educativo de la serie de Código BIM sobre las APIs de Autodesk Forma y la gestión de incidencias. React/TypeScript, FastAPI/Python y MCP por Streamable HTTP. Codex consulta y prepara operaciones con su propia autorización MCP, vinculada a la conexión Autodesk individual de FastAPI. La persona revisa y aprueba el contenido en la web antes de que el agente pueda ejecutar una incidencia individual.

## Código completo de cada artículo

Cada etiqueta conserva el código tal como queda al terminar un artículo. `main` contiene el trabajo más reciente; para seguir un artículo, utiliza la etiqueta que lleva su nombre.

| Orden | Artículo | Código al terminarlo |
| --- | --- | --- |
| Introducción | [De un Excel a Issues Manager: por qué estoy reconstruyendo esta herramienta](https://codigobim.com/de-un-excel-a-issues-manager-por-que-estoy-reconstruyendo-esta-herramienta/) | [Índice de versiones](docs/versiones.md); sin etiqueta anterior al login |
| 1 | [Login con Autodesk en FastAPI: sesión y acceso restringido](https://codigobim.com/login-con-autodesk-en-fastapi-sesion-y-acceso-restringido/) | [login-autodesk-fastapi](https://github.com/smirallas/codigo-bim-issues-manager/tree/login-autodesk-fastapi) |
| 2 | [Consultar tus proyectos de Autodesk con Data Management API](https://codigobim.com/consultar-tus-proyectos-de-autodesk-con-data-management-api/) | [consultar-proyectos-autodesk-data-management-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/consultar-proyectos-autodesk-data-management-api) |
| 3 | [Miembros y permisos de Autodesk: comprobar responsables con Issues API](https://codigobim.com/miembros-permisos-autodesk-issues-api/) | [miembros-permisos-autodesk-issues-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/miembros-permisos-autodesk-issues-api) |
| 4 | [Crear y actualizar incidencias de Autodesk con Issues API](https://codigobim.com/crear-actualizar-incidencias-autodesk-issues-api/) | [crear-actualizar-incidencias-autodesk-issues-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/crear-actualizar-incidencias-autodesk-issues-api) |
| 5 | [Importar incidencias desde Excel con Autodesk Issues API](https://codigobim.com/importar-incidencias-excel-autodesk-issues-api/) | [importar-incidencias-excel-autodesk-issues-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/importar-incidencias-excel-autodesk-issues-api) |
| 6 | [Diseñar herramientas MCP sobre una API con FastAPI](https://codigobim.com/disenar-herramientas-mcp-fastapi/) | [disenar-herramientas-mcp-fastapi](https://github.com/smirallas/codigo-bim-issues-manager/tree/disenar-herramientas-mcp-fastapi) |
| 7 | [Autenticar el cliente MCP con tu cuenta Autodesk](https://codigobim.com/autenticar-cliente-mcp-autodesk/) | [autenticar-cliente-mcp-autodesk](https://github.com/smirallas/codigo-bim-issues-manager/tree/autenticar-cliente-mcp-autodesk) |
| 8 | [Crear incidencias en Autodesk desde Codex con aprobación humana](https://codigobim.com/crear-incidencias-autodesk-codex/) | [crear-incidencias-autodesk-codex](https://github.com/smirallas/codigo-bim-issues-manager/tree/crear-incidencias-autodesk-codex) |
| Cierre reproducible local | Ocho entregas completas | [issues-manager-serie-completa](https://github.com/smirallas/codigo-bim-issues-manager/tree/issues-manager-serie-completa) · [Guía de reproducción](https://github.com/smirallas/codigo-bim-issues-manager/blob/issues-manager-serie-completa/docs/reproducir.md) |
| Ampliación complementaria | [Preparar passthrough billing en Autodesk APS con Issues Manager](https://codigobim.com/preparar-passthrough-billing-autodesk-aps/) | [preparar-passthrough-billing-autodesk-aps](https://github.com/smirallas/codigo-bim-issues-manager/tree/preparar-passthrough-billing-autodesk-aps) |
| Cierre editorial (sin numerar) | [¿Hace falta desarrollar un backend propio para trabajar con Autodesk APS?](https://codigobim.com/hace-falta-desarrollar-un-backend-propio-para-trabajar-con-autodesk-aps/) | [issues-manager-serie-completa](https://github.com/smirallas/codigo-bim-issues-manager/tree/issues-manager-serie-completa) · [Guía de reproducción](https://github.com/smirallas/codigo-bim-issues-manager/blob/issues-manager-serie-completa/docs/reproducir.md) |

```powershell
git clone https://github.com/smirallas/codigo-bim-issues-manager.git
cd codigo-bim-issues-manager
git switch --detach login-autodesk-fastapi
```

Para reproducir el cierre local de las ocho entregas, utiliza `issues-manager-serie-completa` y su [guía de reproducción](docs/reproducir.md). El código de cada capítulo es público y se enlaza directamente desde el artículo, sin requerir suscripción. Las etiquetas conservan su alcance histórico; no certifican preparación para producción. [Versiones y comprobaciones](docs/versiones.md).

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
- Ejecutar desde Codex una incidencia individual previamente aprobada en la web sobre su contenido exacto y recuperar el resultado guardado.
- Ejecutar pruebas sin credenciales reales y ensayar los contratos MCP con datos sintéticos.

Esta versión incorpora operaciones individuales con Issues API e importación desde una plantilla Excel. Las etiquetas anteriores conservan su alcance. El MCP expone once herramientas. El modo predeterminado `disabled` bloquea las llamadas y `fixtures` usa solo datos sintéticos. En `autodesk`, exige una credencial propia de quince minutos antes de consultar datos; FastAPI revalida la conexión individual y la lista de acceso. La ejecución individual desde MCP exige una aprobación independiente del contenido exacto en la web autenticada. No incluye adjuntos, pushpins, visor, campos personalizados ni eliminación. La actualización de responsable queda fuera; al crear, si se elige uno, se resuelve por identidad Autodesk y se revalida su empresa cuando corresponde.

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

Las dependencias conservan sus propias licencias y avisos, distribuidos con cada paquete; la licencia MIT del ejemplo no los sustituye. Los lockfiles identifican las versiones. No se redistribuye código de DataForge ni material del portal Autodesk.

## Reproducir y cerrar la serie

La [guía de reproducción](docs/reproducir.md) separa el arranque sin credenciales, el ensayo sintético y la conexión real a Autodesk. Incluye el uso de datos persistentes, recuperación de resultados y límites antes de plantear un despliegue. Para retomar el punto de un artículo, utiliza siempre su etiqueta; el cierre reproducible se identifica como `issues-manager-serie-completa`.

## Herramientas MCP

Ampliación opcional: [preparar passthrough billing](docs/passthrough-billing.md) añade la selección de contexto al inicio OAuth para aplicaciones elegibles. Está desactivada por defecto y no acredita facturación al cliente ni completa su incorporación en Autodesk.

Código del caso práctico: [preparar-passthrough-billing-autodesk-aps](https://github.com/smirallas/codigo-bim-issues-manager/tree/preparar-passthrough-billing-autodesk-aps). Las etiquetas anteriores de la serie conservan su configuración original.

[Autorización y configuración del cliente](docs/autenticacion-mcp.md): credenciales MCP separadas de APS, descubrimiento OAuth, cliente preinscrito, consentimiento y contexto interno validado por FastAPI. El cliente SDK local está en `/client` solo en modo `autodesk`. La guía de [operaciones desde Codex](docs/operaciones-mcp.md) configura su cliente OAuth y explica la revisión web independiente antes de ejecutar. El [ensayo sintético de contratos](docs/herramientas-mcp.md) sigue disponible en modo `fixtures`, sin escrituras Autodesk.
