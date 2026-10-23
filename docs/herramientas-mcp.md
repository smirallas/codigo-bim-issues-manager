# Ensayar herramientas MCP sobre la API

Esta guía describe exclusivamente el ensayo sintético de once contratos por Streamable HTTP con el SDK MCP 1.30.0. Su modo `fixtures` no autentica al cliente ni consulta Autodesk. La versión actual también ofrece el modo `autodesk`: consulta [la guía de autenticación MCP](autenticacion-mcp.md) y las [operaciones desde Codex](operaciones-mcp.md). Los bloqueos descritos aquí corresponden al ensayo sintético; en modo Autodesk se permite ejecutar un plan individual previamente aprobado en la web.

## Arrancar el ensayo

El modo predeterminado es `disabled`: se puede descubrir el catálogo, pero todas las llamadas devuelven `authentication_required`. No transmite cookies ni tokens APS, aunque la API esté configurada.

Para probar únicamente datos sintéticos desde PowerShell:

```powershell
$env:MCP_DATA_MODE = 'fixtures'
docker compose up --build --wait --wait-timeout 120 mcp
```

Abre <http://127.0.0.1:8001/demo> y pulsa «Ejecutar ensayo MCP». La página es un cliente HTTP fijo, sin un modelo de IA: negocia `initialize`, descubre `tools/list` y llama mediante `tools/call`. Muestra un hub y proyecto sintéticos, preparación, recuperación del mismo ID y ejecución bloqueada. No envía nada a Autodesk. El contexto es `b.demo-hub` / `b.demo-project`; no uses datos privados.

Para volver al modo predeterminado:

```powershell
Remove-Item Env:MCP_DATA_MODE
docker compose up --wait --wait-timeout 120 mcp
```

Configura `MCP_DATA_MODE=disabled` en `.env` si quieres volver al bloqueo: quitar una variable de PowerShell no anula el valor del archivo. E07 añade `autodesk` con autenticación obligatoria; no hay modo `live` y un valor desconocido detiene el arranque. `/demo` solo existe en fixtures. Los puertos Compose se limitan a loopback; este ensayo sin autenticación no es un despliegue remoto.

Sin Docker, `apps/mcp/.env` utiliza las mismas variables; ejecuta `pnpm dev:mcp`. Con otro puerto, añade su origen exacto a `MCP_ALLOWED_ORIGINS`. `/ready` sigue comprobando la API local; un transporte disponible no acredita permisos Autodesk.

## Catálogo

| Herramienta           | Entrada                     | Efecto y límite                                              |
| --------------------- | --------------------------- | ------------------------------------------------------------ |
| `list_hubs`           | Objeto vacío                | Lista compatible, exclusiones y aviso de listado incompleto. |
| `list_projects`       | `hub_id`                    | Lista proyectos del hub explícito.                           |
| `get_project_context` | `hub_id`, `project_id`      | Selección validada y capacidades; no persiste selección.     |
| `list_members`        | Contexto                    | Miembros; no demuestra asignabilidad.                        |
| `list_issue_types`    | Contexto                    | Opciones activas por ID/nombre completo.                     |
| `list_issues`         | Contexto, `offset` opcional | Una página, offset 0–100000; no sigue URLs.                  |
| `get_issue`           | Contexto, `issue_id`        | Un detalle.                                                  |
| `prepare_issue`       | Contexto, `request`         | POST simulado de preparación, sin escritura APS.             |
| `review_issue_plan`   | `plan_id`                   | Revisión/resultado guardado sin ejecutar.                    |
| `execute_issue_plan`  | `plan_id`                   | Siempre bloqueado; no conecta al ejecutor web.               |
| `get_import_result`   | `import_id`                 | Lote conocido, sin subir archivo ni aprobar filas.           |

`request` sigue el contrato `PlanInput` de FastAPI: create/update, ID de incidencia cuando corresponde y campos permitidos. La herramienta comprueba forma, longitudes y fecha ISO; la validación de negocio y autorización pertenecen a FastAPI. La fixture ilustra respuestas, no reproduce el validador ni demuestra permisos. `demo-import` contiene una fila inválida sin título.

No se admiten `user_id`, tokens, cookies, `confirmed`, URLs ni rutas del ordenador. Los argumentos desconocidos se rechazan. Las rutas son cerradas y los IDs se codifican. `ContractApi` es un puerto inyectable de ensayo sobre las rutas existentes; todavía no es un cliente autenticado de FastAPI. Su implementación de fixtures no usa red. Solo `/ready` consulta la dependencia API real.

Las salidas se validan con Zod, se reducen a los campos públicos definidos y se devuelven como `structuredContent` más su representación JSON en texto. El sobre contiene `mode`, `ok` y `data` o `error`. Los errores de operación usan `isError: true`; los argumentos inválidos los rechaza el SDK. No se exponen mensajes internos ni se reintenta automáticamente. Las anotaciones describen efectos, no autorizan operaciones.

## Preparar, aprobar y ejecutar

Las preparaciones sintéticas duran diez minutos, se guardan solo en memoria y tienen un límite de cien vigentes. Se pierden al reiniciar y son compartidas por quienes accedan al mismo proceso de ensayo: no acreditan aislamiento de usuarios. La persistencia cifrada de la web sigue en FastAPI.

En fixtures, la ejecución devuelve `human_approval_not_available` sin llamar a la API. La versión de autenticación y aprobación real utiliza otro recorrido: sesión propietaria, aprobación web sobre la huella del contenido y ejecución individual con revalidación. Un booleano del modelo no sustituye esa aprobación. El ensayo sintético conserva el bloqueo para no confundir una demostración con una escritura real. No se añade una subida de Excel por MCP.

## Verificar

`./scripts/check.ps1` ejecuta los checks del repositorio. Los tests MCP comprueban SDK/HTTP, esquemas, rutas/cuerpos, paginación, caducidad, errores y ejecución bloqueada con datos sintéticos. `pnpm smoke` comprueba los servicios, once herramientas y bloqueo de ejecución. La página permite observar llamadas HTTP reales con respuestas sintéticas, sin un agente ni APS.

Contratos: [herramientas MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) y [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). Un transporte sin sesiones no identifica al usuario.
