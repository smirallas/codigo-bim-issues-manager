# Importar incidencias desde una plantilla Excel

Con la aplicación arrancada, inicia sesión con Autodesk, selecciona hub y proyecto y abre «Importar incidencias desde Excel». Descarga la plantilla desde ese bloque: se genera sin datos privados y funciona sin macros. Solo se admiten creaciones nuevas, no actualizaciones de incidencias existentes.

Una sola hoja llamada `Incidencias`, con estas seis columnas en este orden:

| Columna      | Valor                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- |
| titulo       | Obligatorio, 1–100 caracteres.                                                                |
| descripcion  | Opcional, hasta 1.000 caracteres.                                                             |
| tipo         | Nombre completo de una opción activa, por ejemplo `General / General`, o su ID de subtipo.    |
| estado       | Valor técnico permitido por Autodesk, por ejemplo `open` o `closed`; no su traducción visual. |
| responsable  | Opcional: Autodesk ID, correo o nombre exacto de un miembro. Los homónimos se bloquean.       |
| fecha_limite | Opcional: fecha Excel o texto `YYYY-MM-DD`. Se envía como `dueDate` solo si está permitido.   |

El ejemplo de la plantilla es sintético: sustituye sus datos y comprueba su tipo/estado contra tu proyecto. El responsable se resuelve con los miembros actuales y vuelve a validarse mediante E03. No se infieren empresas ni permisos a partir de su nombre.

Máximo 25 filas de datos, archivo de 1 MiB y contenido descomprimido de 8 MiB. No se admiten columnas extra, fórmulas, errores Excel, macros ni relaciones externas. No se ejecuta contenido del archivo ni se sigue ninguna URL. Solo se conserva la revisión normalizada cifrada, no el fichero original.

«Preparar Excel» consulta tipos, miembros cuando hacen falta y permisos, pero no crea incidencias. La revisión enumera todas las filas y sus datos exactos, errores y contexto de proyecto. Las filas inválidas quedan bloqueadas; puedes corregir el archivo y preparar otro plan, o aprobar únicamente las válidas. La revisión caduca a los diez minutos, contados desde la primera preparación individual.

Marca la aprobación y confirma el número de filas válidas. La web registra la aprobación del lote y envía las filas secuencialmente mediante el mismo servicio de E04. Cada fila revalida permisos y datos antes de reclamarse una sola vez. La escritura y su relectura conservan un resultado independiente; no hay transacción global ni rollback de las filas ya aceptadas.

Si se corta la conexión, utiliza «Consultar resultado del Excel guardado». Recargar recupera la referencia de la revisión en esta sesión del navegador, sin ejecutar automáticamente. Una fila enviada, rechazada o incierta no se repite. Las pendientes solo se ejecutan mediante una nueva confirmación explícita y mientras la revisión siga vigente. Si un proceso se interrumpe después de reclamar una fila, puede permanecer `running`: comprueba Autodesk antes de preparar otro lote. Un archivo o preparación nuevos pueden duplicar datos ya creados.

La aplicación no promete deduplicación entre lotes, ejecución exactamente una vez en Autodesk ni bloqueo de ediciones externas. La lista de resultados distingue aceptación, verificación por relectura, rechazo e incertidumbre. Las escrituras de pruebas sobre proyectos reales requieren autorización expresa; los tests automatizados usan datos sintéticos.

Referencias: [openpyxl y seguridad XML](https://openpyxl.readthedocs.io/en/stable/), [creación de Issues](https://aps.autodesk.com/en/docs/acc/v1/reference/http/issues-issues-POST/) y [contrato oficial de Autodesk](https://github.com/autodesk-platform-services/aps-sdk-openapi/blob/main/construction/issues/Issues.yaml).
