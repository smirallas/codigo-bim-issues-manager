# Versiones de los artículos

Cada etiqueta anotada e inmutable conserva el código completo al terminar un artículo. `main` puede avanzar; el enlace del artículo debe apuntar a `/tree/<etiqueta>`.

| Artículo                                                    | Etiqueta                                                                                                                                                         | Contenido                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Login con Autodesk en FastAPI: sesión y acceso restringido  | [login-autodesk-fastapi](https://github.com/smirallas/codigo-bim-issues-manager/tree/login-autodesk-fastapi)                                                     | Base local y login Autodesk con acceso restringido, sesión, renovación y desconexión.       |
| Consultar tus proyectos de Autodesk con Data Management API | [consultar-proyectos-autodesk-data-management-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/consultar-proyectos-autodesk-data-management-api) | Hubs y proyectos ACC/Forma accesibles, paginación, avisos y selección validada en servidor. |

El login, la identidad, la denegación, la cancelación, la desconexión y la renovación se han observado con APS real. La caducidad absoluta de ocho horas queda pendiente de comprobación manual. Las pruebas automatizadas cubren la caducidad con datos sintéticos; no sustituyen esa comprobación real.

La consulta y selección de un proyecto de ejemplo se han comprobado con APS real, después de habilitar la integración en la cuenta. Una petición directa con un identificador ficticio ha recibido 404. Los casos de vacío definitivo, denegación 403 y paginación se prueban con datos sintéticos; esa prueba no acredita todos los escenarios posibles en Autodesk.

La entrega de miembros y capacidades corresponde a [miembros-permisos-autodesk-issues-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/miembros-permisos-autodesk-issues-api): consulta Admin, perfil Issues y comprobación de responsables sin escrituras. Lectura y comprobación compatible observadas con una cuenta administradora; la misma identidad, después de bajar a miembro, conserva lectura y queda limitada a asignación dentro de su empresa. Al no tener empresa asignada, la comprobación se bloquea por información insuficiente. Homónimos y empresas distintas se prueban con datos sintéticos; no se ha intentado una escritura de asignación para provocar un rechazo real de Autodesk.

Las etiquetas conservan una implementación, no acreditan preparación para producción ni completan una aceptación pendiente. Publicar código no publica un artículo.

La entrega de operaciones individuales corresponde a [crear-actualizar-incidencias-autodesk-issues-api](https://github.com/smirallas/codigo-bim-issues-manager/tree/crear-actualizar-incidencias-autodesk-issues-api): catálogo de tipos activos, listado/detalle, preparación y aprobación de creación, actualización limitada a título, descripción y estado, revalidación y resultados cifrados. Requiere aceptar `data:write` mediante un nuevo login.

El 22 de octubre de 2026 se comprobó con Autodesk real una única incidencia sintética en Snowdon Towers: creación asignada al usuario autorizado, relectura y actualización del mismo ID hasta estado cerrado, también contrastado en la interfaz de Autodesk. Cerrar no elimina; la incidencia permanece en el proyecto. Se mantuvo el valor predeterminado de publicación del proveedor, sin activar su publicación desde esta aplicación.

El pase de esta versión incluye 132 pruebas API, 46 web y 8 MCP (186 en total), formato, lint, tipos y builds. Docker y smoke local correctos. Payload inválido, permiso retirado, denegación de escritura, homónimos y fallos de red se verifican con transportes sintéticos; no se provocó una denegación real cambiando permisos en Autodesk. No hay adjuntos, visor, importación Excel ni escrituras MCP.

## Seguir el código de un artículo

```powershell
git switch --detach login-autodesk-fastapi
# Para experimentar sin mover la etiqueta:
git switch -c mi-prueba-login
```

No mover ni reutilizar una etiqueta publicada. Una corrección posterior que cambie el código enlazado recibirá otra etiqueta, por ejemplo `login-autodesk-fastapi-v2`, y el artículo se actualizará para enlazarla.

Los siguientes artículos utilizarán nombres descriptivos cuando exista su código. No se crean versiones anticipadas ni una etiqueta retrospectiva de la base anterior al login: no se conserva una instantánea verificable de esa etapa.

## Importar incidencias desde Excel

Etiqueta `importar-incidencias-excel-autodesk-issues-api`: plantilla XLSX de seis columnas, límites de archivo y filas, normalización de fechas, resolución de tipos y responsables, errores por fila y aprobación de revisión cifrada. Cada creación reutiliza el servicio E04 y conserva su resultado. Solo creaciones nuevas; no se modifica una incidencia existente desde Excel.

Prueba real del 22 de octubre de 2026 en Snowdon Towers: un archivo con una fila válida y otra sin título. La válida creó una única incidencia sintética cerrada y sin responsable; la otra quedó bloqueada. Relectura verificada y contraste en Autodesk, confirmado por Sergio. Recuperación del resultado guardado comprobada sin otro envío. No se borró ni se publicó la incidencia.

Pase final: 153 pruebas API, 53 web y 8 MCP, 214 en total; formato, lint, tipos, builds, Docker y smoke correctos. Homónimos, fechas, columnas ausentes, aislamiento, caducidad, permisos retirados, resultados parciales y fallos inciertos se prueban con datos sintéticos. No se provocaron fallos de red reales ni se midió una importación masiva. El archivo nuevo puede duplicar datos de otro lote y no hay transacción global ni rollback de filas aceptadas. MCP conserva catálogo vacío: E06 no está implementada.

## Diseñar herramientas MCP sobre una API con FastAPI

Etiqueta `disenar-herramientas-mcp-fastapi`: once contratos por Streamable HTTP, esquemas Zod, rutas cerradas y salidas estructuradas. Modo predeterminado bloqueado; modo fixtures con API interna simulada y página de ensayo HTTP. La preparación, revisión y ejecución bloqueada se han observado en navegador con datos sintéticos. No acredita autenticación MCP ni consultas Autodesk desde MCP, y no hay agente conectado. Guía: [herramientas MCP](herramientas-mcp.md).

La ejecución se mantiene bloqueada porque el endpoint web no conserva una aprobación humana independiente verificable para MCP. La entrega de autenticación sigue pendiente. La web y su conexión Autodesk no se modifican.

## Autenticar el cliente MCP con tu cuenta Autodesk

Etiqueta `autenticar-cliente-mcp-autodesk`: autorización propia del cliente con oidc-provider, PKCE S256, consentimiento y recurso MCP explícito. Token opaco de quince minutos, sin refresh MCP, estado OAuth cifrado persistente y contexto interno de audiencia distinta validado por FastAPI. Las consultas y preparaciones reutilizan la conexión APS de la sesión web del mismo usuario. Ejecución MCP bloqueada; sin agente conectado. [Configuración y recorrido](autenticacion-mcp.md).

Prueba real: consentimiento completado por Sergio, consulta de su hub y listado de Snowdon Towers desde el cliente SDK MCP. Bloqueo de ejecución comprobado. Después de desconectar Autodesk con revocación confirmada, otra consulta MCP fue rechazada cuando su token todavía estaba vigente (más de trece minutos restantes antes de la desconexión). También se observó rechazo de una credencial MCP vencida sin modificar sus fechas. No se crearon ni modificaron incidencias.

Emisor y audiencia incorrectos, PKCE, código reutilizado, cuenta denegada, cambio de conexión, privacidad de planes, dos identidades y persistencia tras reinicio se prueban con datos sintéticos. Estas comprobaciones no sustituyen una prueba real con dos cuentas Autodesk. La caducidad absoluta web de E01 sigue siendo una verificación distinta y pendiente. SQLite de Node 22 conserva su aviso experimental.

## Crear incidencias en Autodesk desde Codex con aprobación humana

Etiqueta `crear-incidencias-autodesk-codex`: cliente Codex por Streamable HTTP y OAuth, preparación privada, revisión web de los datos exactos y ejecución individual mediante el mismo servicio de FastAPI. La aprobación queda ligada a la huella del contenido y solo puede registrarse desde la sesión web propietaria. MCP vuelve a validar permisos y conserva resultados; no hay herramienta MCP para aprobar ni ejecución de lotes por el agente. [Configuración y recorrido](operaciones-mcp.md).

Prueba real del 23 de octubre de 2026: Codex consultó Snowdon Towers, preparó una operación y Sergio aprobó su contenido en la web. Se creó una única incidencia sintética #3, cerrada, General / General y sin responsable. Relectura verificada y contraste visual en Autodesk. Un reenvío autorizado del mismo plan completado devolvió el resultado guardado y el mismo ID, sin otra creación. Una petición ambigua no preparó ni ejecutó nada. No se borró ni se publicó la incidencia.

Pase final: 175 pruebas API, 54 web y 54 MCP (283 en total), formato, lint, tipos, builds, Docker y smoke correctos. Aprobación ausente, contenido alterado, permisos retirados, aislamiento y fallos inciertos se prueban con datos sintéticos. El ensayo real utiliza una identidad Autodesk y no demuestra todos los escenarios multiusuario. La caducidad absoluta web de E01 sigue pendiente. Esta versión funciona en local; no acredita un despliegue público.

## Cierre reproducible de la serie

Etiqueta `issues-manager-serie-completa`: README conciliado con las funciones verificadas, enlaces a las ocho versiones, guía de reproducción y límites, licencias de dependencias conservadas y título web sin numeración antigua. No añade operaciones de negocio ni cambia los permisos de Autodesk. Las etiquetas de los artículos se conservan sin moverse.

Comprobación del 23 de octubre de 2026 desde una copia nueva descargada de GitHub, sin `.env`, bases ni credenciales heredadas: instalación con lockfiles, 283 pruebas y todos los checks correctos. Tres servicios Docker saludables en un proyecto Compose y volúmenes propios, con puertos loopback alternativos. Login cerrado sin APS y smoke de once herramientas con ejecución bloqueada. Tras generar claves nuevas se comprobó que una segunda invocación conserva la configuración, y pasó el smoke del modo fixtures sin llamadas Autodesk.

Parada y arranque de esa instalación con `down` y `up`, conservando sus volúmenes: marcador local de prueba y migración `0004_plan_approval` presentes, cero planes de incidencias y smoke correcto. Se usaron cachés de construcción de Docker; no se acredita una compilación sin caché ni una segunda integración real con Autodesk. El cierre es local y no incluye alojamiento público. [Reproducir la solución](reproducir.md).
