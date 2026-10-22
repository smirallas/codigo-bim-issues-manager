# Autenticar el cliente MCP

E07 añade autorización OAuth del cliente. No conecta aún un agente de IA ni habilita escrituras de incidencias desde MCP.

## Tres relaciones independientes

- El navegador mantiene su sesión de Issues Manager (hasta ocho horas).
- FastAPI mantiene la conexión APS del mismo usuario, con access/refresh tokens cifrados. Continúa aplicando la lista de acceso y los permisos Autodesk.
- El cliente obtiene una credencial propia para `http://127.0.0.1:8001/mcp`, válida quince minutos. No es un token APS y no permite actuar en otras APIs.

La conexión MCP queda vinculada a la sesión Autodesk que se muestra durante su consentimiento. Si cambias de cuenta, desconectas Autodesk o caduca esa sesión, debes volver a autorizar el cliente. Renovar el access token APS no renueva ni cambia la credencial MCP.

## Configuración local

Primero completa [la configuración APS](configuracion-aps.md). E07 reutiliza ese login y sus scopes: no requiere otro Client ID APS ni otro callback Autodesk.

Desde la raíz ejecuta `uv sync --frozen --all-packages` y `uv run --frozen python scripts/init_local_env.py --add-mcp`. Si no hay `.env`, crea la configuración local con claves propias; si ya existe, añade solo las claves MCP ausentes o vacías. Conserva los secretos APS, la clave Fernet y los valores MCP existentes, sin mostrarlos. No sobrescribas tu configuración para actualizar. `ISSUES_MCP_INTERNAL_SECRET` y `MCP_STORAGE_KEY` son independientes de APS.

Configura:

```dotenv
MCP_DATA_MODE=autodesk
ISSUES_MCP_ISSUER=http://127.0.0.1:8001
WEB_ORIGIN=http://127.0.0.1:5173
```

`disabled` conserva el catálogo sin datos reales; `fixtures` conserva el ensayo sintético de la entrega anterior. Las credenciales solo se activan en `autodesk`. Compose conserva el estado OAuth cifrado en un volumen MCP separado del volumen API. No elimines volúmenes para actualizar.

```powershell
docker compose up --build --wait --wait-timeout 120
pnpm smoke
```

Abre Issues Manager en `http://127.0.0.1:5173`, inicia sesión con una cuenta permitida y después abre `http://127.0.0.1:8001/client`. Pulsa **Conectar cliente MCP**, revisa la cuenta y autoriza el cliente. **Consultar mis hubs** y **Consultar proyectos del hub** atraviesan el SDK MCP, Streamable HTTP, FastAPI y APS. El cliente de ensayo guarda sus tokens en el servidor, no los muestra ni permite introducir tokens APS.

## Descubrimiento y cliente preinscrito

Recurso: `http://127.0.0.1:8001/mcp`. Un acceso anónimo devuelve 401 y `WWW-Authenticate` con `resource_metadata`. La metadata está en `/.well-known/oauth-protected-resource/mcp`; anuncia el emisor local. `oidc-provider` publica `/.well-known/openid-configuration`, con autorización `/auth`, token `/token` y PKCE S256 obligatorio.

El scope `issues:access` permite consultas y preparación de revisiones; no permite aprobar ni ejecutar. El cliente de ensayo está preinscrito como `issues-manager-demo`, con callback exacto `http://127.0.0.1:8001/client/callback`. Son datos de cliente público, no secretos. No hay registro dinámico ni descarga de metadatos de clientes arbitrarios.

Para un cliente adicional configura `MCP_CLIENT_ID` y `MCP_CLIENT_REDIRECT_URI` antes del arranque; el cliente debe utilizar el mismo Client ID, callback exacto, PKCE, recurso y scope. Debe soportar este registro previo y guardar su credencial con seguridad. La conexión de Codex como agente y su configuración verificada corresponden a E08; el cliente SDK de ensayo no demuestra todavía compatibilidad con todos los clientes MCP.

## Qué se valida

El recurso acepta solo tokens opacos emitidos por su propio proveedor, vigentes, de la audiencia MCP y con el scope requerido. El emisor está fijado por configuración y por su almacén; no se aceptan JWT APS o tokens de otros emisores. Tras resolver el grant privado, FastAPI vuelve a comprobar la conexión.

MCP no reenvía el bearer del cliente a FastAPI. Genera un JWT interno HS256 de treinta segundos, con emisor configurado, audiencia distinta `issues-manager-api`, propósito y una referencia cifrada a la sesión. FastAPI valida todo ello, resuelve la identidad estable y revalida acceso y credenciales APS. Un `user_id` en los argumentos no acredita identidad. Los planes siguen siendo privados de esa conexión y usan los validadores existentes.

E07 no emite refresh tokens MCP. Al vencer los quince minutos se repite la autorización con la sesión web vigente. La ejecución continúa bloqueada tanto en la herramienta como en las rutas delegadas de FastAPI; `confirmed: true` no sirve como consentimiento.

## Límites

La demostración está preparada para una instancia y puertos loopback. SQLite de Node 22 está marcado experimental; versiones de runtime y dependencias están fijadas en el repositorio. No publiques los puertos en Internet para probarla: un despliegue requiere HTTPS y revisión explícita de URLs, orígenes, cookies y operación. No se ha desplegado un proveedor público ni un servicio multiinstancia.

No compartas tokens, cookies, claves ni los ficheros/volúmenes privados. Cambiar las claves de cifrado deja inaccesible el estado correspondiente. Conserva las claves junto con las copias privadas si necesitas restaurarlo.

Referencias: [autorización MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) y [configuración de oidc-provider](https://github.com/panva/node-oidc-provider/blob/v9.12.2/docs/README.md).
