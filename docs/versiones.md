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

## Seguir el código de un artículo

```powershell
git switch --detach login-autodesk-fastapi
# Para experimentar sin mover la etiqueta:
git switch -c mi-prueba-login
```

No mover ni reutilizar una etiqueta publicada. Una corrección posterior que cambie el código enlazado recibirá otra etiqueta, por ejemplo `login-autodesk-fastapi-v2`, y el artículo se actualizará para enlazarla.

Los siguientes artículos utilizarán nombres descriptivos cuando exista su código. No se crean versiones anticipadas ni una etiqueta retrospectiva de la base anterior al login: no se conserva una instantánea verificable de esa etapa.
