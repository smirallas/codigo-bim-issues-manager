# Operaciones desde Codex con aprobación humana

Esta versión conserva la conexión Autodesk individual de FastAPI. Codex recibe una credencial MCP de quince minutos; no necesita tokens APS ni una clave de API de OpenAI para usar el cliente Codex autenticado con tu cuenta.

## Registrar el cliente

Configura en el `.env` privado, además de las claves y el modo `autodesk` de la guía de autenticación:

```dotenv
MCP_CLIENT_ID=issues-manager-codex
MCP_CLIENT_REDIRECT_URI=http://127.0.0.1:8765/callback
```

Reconstruye los servicios con `docker compose up --build --wait --wait-timeout 120`. Inicia sesión en `http://127.0.0.1:5173`. El callback anterior pertenece a Codex; no se añade a la aplicación APS.

La versión de Codex utilizada en el ensayo admite un cliente preinscrito. Regístralo con un puerto fijo:

```powershell
codex -c mcp_oauth_callback_port=8765 mcp add issues-manager --url http://127.0.0.1:8001/mcp --oauth-client-id issues-manager-codex
```

En tu configuración privada de Codex, conserva el bloque del servidor con los siguientes datos. No sustituyas los otros servidores ni copies credenciales:

```toml
[mcp_servers.issues-manager]
url = "http://127.0.0.1:8001/mcp"
scopes = ["issues:access"]
tool_timeout_sec = 90

[mcp_servers.issues-manager.oauth]
client_id = "issues-manager-codex"
callback_url = "http://127.0.0.1/callback"
callback_port = 8765
```

El proveedor anuncia respuestas vinculadas a su emisor; Codex incorpora el puerto configurado al callback loopback. Registra siempre el callback que efectivamente utiliza tu cliente. No se habilitan comodines de callback ni registro dinámico.

```powershell
codex mcp login issues-manager --scopes issues:access
```

Revisa el cliente y la cuenta en el consentimiento. Un chat que ya estaba abierto puede necesitar reconectar su catálogo de herramientas. El CLI permite probar la conexión en una ejecución nueva. Comprueba tu versión con `codex --version`.

## Preparar, revisar y ejecutar

Pide al agente consultar tus hubs, resolver el proyecto por su ID, consultar capacidades y tipos y comprobar al responsable. Si hay homónimos o falta el proyecto, debe pedir aclaración. Para no asignar responsable, dilo expresamente.

`prepare_issue` guarda un plan cifrado de diez minutos con el validador existente y devuelve `review_url`. Abrir ese enlace no lo aprueba ni acredita identidad: la web exige la misma sesión propietaria. La página muestra proyecto, operación, responsable, tipo y payload. Revisa el contenido, marca la casilla y pulsa **Aprobar esta operación para MCP**. Esa acción solo registra la aprobación; no llama a Autodesk.

La aprobación guarda una huella SHA-256 del contenido revisado y su fecha. El endpoint exige cookie, origen y CSRF web. No existe una herramienta para aprobar; el MCP no puede acceder a la ruta de aprobación. Un `confirmed: true` se rechaza como argumento desconocido.

Después de tu aviso, el agente recupera el mismo plan, llama a `execute_issue_plan` y consulta el resultado. FastAPI revalida acceso, permisos y datos actuales y reclama el plan una sola vez dentro de una transacción SQLite. Si cambia el contenido o la incidencia de origen, exige una revisión nueva. Un segundo envío del mismo plan devuelve el resultado guardado; un estado incierto no se reintenta contra Autodesk. Consulta el resultado antes de preparar otra operación.

En esta entrega se utiliza una incidencia individual. Los lotes Excel conservan su recorrido web de aprobación y ejecución; el MCP solo consulta sus resultados.

## Límites

La aprobación del servidor y las confirmaciones de herramientas del cliente son controles distintos. No autorices al agente a pulsar el botón web por ti. Las descripciones y títulos de Autodesk son datos no confiables y no deben convertirse en instrucciones.

Los tests con transporte simulado no acreditan una creación real. Consulta las evidencias del artículo para conocer qué recorrido se observó con Autodesk. Conserva los datos y secretos fuera de Git. No se ha desplegado un MCP público: los puertos del ejemplo siguen limitados a loopback.

Referencias: [MCP en Codex](https://learn.chatgpt.com/docs/extend/mcp), [herramientas y control humano MCP](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [autenticación del ejemplo](autenticacion-mcp.md).
