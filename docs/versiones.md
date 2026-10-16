# Versiones de los artículos

Cada etiqueta anotada e inmutable conserva el código completo al terminar un artículo. `main` puede avanzar; el enlace del artículo debe apuntar a `/tree/<etiqueta>`.

| Artículo                                                   | Etiqueta                                                                                                     | Contenido                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Login con Autodesk en FastAPI: sesión y acceso restringido | [login-autodesk-fastapi](https://github.com/smirallas/codigo-bim-issues-manager/tree/login-autodesk-fastapi) | Base local y login Autodesk con acceso restringido, sesión, renovación y desconexión. |

El login, la identidad, la denegación, la cancelación, la desconexión y la renovación se han observado con APS real. La caducidad absoluta de ocho horas queda pendiente de comprobación manual. Las pruebas automatizadas cubren la caducidad con datos sintéticos; no sustituyen esa comprobación real.

La etiqueta conserva una implementación, no acredita preparación para producción ni completa una aceptación pendiente. El artículo está programado para el 20 de octubre de 2026: publicar código no publica el artículo.

## Seguir el código de un artículo

```powershell
git switch --detach login-autodesk-fastapi
# Para experimentar sin mover la etiqueta:
git switch -c mi-prueba-login
```

No mover ni reutilizar una etiqueta publicada. Una corrección posterior que cambie el código enlazado recibirá otra etiqueta, por ejemplo `login-autodesk-fastapi-v2`, y el artículo se actualizará para enlazarla.

Los siguientes artículos utilizarán nombres descriptivos cuando exista su código. No se crean versiones anticipadas ni una etiqueta retrospectiva de la base anterior al login: no se conserva una instantánea verificable de esa etapa.
