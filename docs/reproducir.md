# Reproducir Issues Manager

El repositorio contiene un ejemplo local de una sola instancia. La etiqueta `issues-manager-serie-completa` reúne el cierre reproducible; las etiquetas de los artículos conservan su código sin moverse. No incluye cuentas, proyectos, credenciales ni datos de la demostración.

## Empezar sin credenciales

Necesitas Git y Docker con Compose. Con los puertos 8000, 5173 y 8001 libres:

```powershell
git clone https://github.com/smirallas/codigo-bim-issues-manager.git
cd codigo-bim-issues-manager
git switch --detach issues-manager-serie-completa
docker compose up --build --wait --wait-timeout 120
docker compose ps
```

Abre http://127.0.0.1:5173. Sin `.env`, la web arranca, mantiene cerrado el login Autodesk y MCP funciona en modo `disabled`. Un health check correcto acredita el arranque, no el acceso a un proyecto. Las migraciones crean SQLite en un volumen nuevo. Una compilación puede usar las cachés de Docker; reproducir no significa compilar sin caché.

## Configurar tu conexión

Para generar claves locales necesitas Python y uv, además de Node/pnpm para el desarrollo y los checks. Versiones del ejemplo: Python 3.12.13, uv 0.11.25, Node 22.23.1 y pnpm 9.15.9. Sigue las versiones fijadas y no regeneres los lockfiles al instalar.

```powershell
pnpm install --frozen-lockfile
uv sync --frozen --all-packages
uv run --frozen python scripts/init_local_env.py
```

El último comando crea `.env` con claves propias sin mostrarlas. Si ya existe, lo conserva; `--add-mcp` completa solo claves MCP ausentes. No compartas las claves entre instalaciones ni cambies la clave de cifrado de un volumen que quieras conservar.

Completa la [configuración APS](configuracion-aps.md): callback exacto, cuenta permitida, permisos e integración habilitada en el hub. Reconstruye los servicios tras cambiar el entorno. Para Codex, sigue [operaciones MCP](operaciones-mcp.md). El callback de Codex y el callback de APS son distintos. Consulta las capacidades efectivas del proyecto; iniciar sesión no concede permisos adicionales.

## Comprobar sin escribir en Autodesk

```powershell
./scripts/check.ps1
pnpm smoke
```

Los checks usan transportes simulados y bases temporales. El smoke consulta los servicios locales: en modo `autodesk` comprueba rechazo anónimo y descubrimiento OAuth, sin consultar Autodesk. El [modo fixtures](herramientas-mcp.md) permite ensayar los contratos con datos sintéticos y mantiene bloqueadas las escrituras. No copies credenciales reales para probarlo.

Para una prueba real hace falta tu consentimiento OAuth y acceso al proyecto. Preparar no escribe; revisa el contenido en la web y aprueba antes de ejecutar. No autorices al agente a pulsar la aprobación por ti. La lista de pruebas realizadas y sus límites está en [versiones](versiones.md).

## Datos, parada y recuperación

```powershell
docker compose down
docker compose up --wait --wait-timeout 120
```

`down` conserva los volúmenes `api-data` y `mcp-data`. El nombre Compose predeterminado sigue siendo `issues-manager-e00` para mantener los datos anteriores. `down -v` elimina los volúmenes y no forma parte del cierre normal. Conserva los volúmenes y las claves correspondientes si necesitas una copia de seguridad; el repositorio no es esa copia. Otro nombre de proyecto Compose usa otros volúmenes, pero necesitará puertos diferentes si ambas instalaciones están activas.

Una operación completada devuelve el resultado guardado al reenviar el mismo plan. Si figura `uncertain` o queda `running` tras una interrupción, consulta el plan y contrasta Autodesk antes de decidir; no se reintenta automáticamente. Un plan o archivo nuevo puede duplicar datos de otro anterior. Cerrar una incidencia no la borra, ni equivale a publicarla en Autodesk.

## Alcance del cierre

Solo puertos loopback y desarrollo local con `vite preview`. No se ha preparado alojamiento público. Antes de alojar la aplicación habría que comprobar HTTPS, cookies seguras, callbacks, emisores y audiencias OAuth, orígenes, restricción de acceso, protección de claves, copias y operación del almacenamiento. Cambiar la URL por sí solo no completa ese trabajo.

No incluye visor, adjuntos, pushpins, campos personalizados, borrado, actualización de responsable ni ejecución de lotes Excel desde MCP. La prueba real del agente utilizó una identidad Autodesk; las pruebas multiusuario sintéticas no equivalen a una aceptación real con dos cuentas. Sergio ha confirmado manualmente que la sesión web de E01 caduca; no se dispone de una nueva traza con los instantes de inicio y rechazo para medir el plazo exacto.

La licencia MIT cubre el código propio del ejemplo. Cada dependencia conserva su licencia y sus avisos dentro del paquete instalado; al redistribuir paquetes o imágenes, conserva esos textos. Las condiciones de Autodesk y de los clientes externos siguen siendo independientes.
