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
