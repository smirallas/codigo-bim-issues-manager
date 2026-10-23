# Preparar passthrough billing con Issues Manager

Ampliación opcional posterior a la serie. La aplicación sigue usando OAuth 3-legged, PKCE, la lista permitida y tokens cifrados por conexión. No incorpora cobro propio, un libro de facturación ni llamadas APS adicionales.

## Portal y decisión del propietario

En la aplicación del Developer Hub, el propietario puede iniciar la transición de financiación. Ese avance es irreversible y exige revisar los avisos y condiciones de Autodesk. No debe automatizarse la aceptación ni confundirse con completar la incorporación de un cliente.

La práctica de Código BIM del 23 de octubre de 2026 muestra Issue Manager en **In transition**. El portal señala que ambos modelos siguen activos y que el paso por el que el cliente añade la integración a su cuenta aún no está disponible. No se ha completado la transición ni se ha acreditado facturación a un cliente.

## Cambio en OAuth

Para una aplicación preparada y elegible, configura en el `.env` privado:

```dotenv
APS_SELECT_USAGE_CONTEXT=true
```

Reconstruye la API para aplicar el entorno:

```powershell
docker compose up --build --wait --wait-timeout 120 api
```

En `AutodeskProvider.authorization_url`, esta opción cambia el parámetro `prompt` de `login` a `select_usage_context`. El callback, los scopes, state y PKCE S256 se conservan. La opción está desactivada por defecto; activarla no cambia el estado de financiación en el portal ni convierte un cliente no incorporado en cliente financiador.

El intercambio del código y la renovación utilizan los endpoints y cuerpos habituales. No se añade una cabecera de facturación a las consultas de proyectos o incidencias. El contexto lo administra Autodesk en la autorización; la aplicación no infiere un equipo pagador a partir del proyecto ni envía un identificador de cliente inventado.

Si Autodesk devuelve un error o el usuario cancela, el callback consume el intento validado y no obtiene una sesión nueva ni reintenta sin el contexto. No existe una vuelta silenciosa a `prompt=login` para ocultar el fallo. La configuración del portal es irreversible aunque se cambie esta opción local.

## Comprobación y alcance

Las pruebas sintéticas verifican ambos prompts, conservación de PKCE/scopes/callback, cancelación y errores sin canje ni fallback, y canje/renovación normales. No prueban atribución monetaria. El navegador debe contrastar por separado el estado del portal y la experiencia OAuth disponible para la cuenta. Un login correcto por sí solo tampoco demuestra que se haya facturado consumo a un cliente.

En la práctica real, con la opción activa en la API, Autodesk mostró el consentimiento habitual y el usuario regresó a Issues Manager con acceso autorizado. No se observó una pantalla de selección de contexto de consumo. Por tanto, se verifican transición y continuidad del acceso, sin dar por completada la elección de un contexto financiador. Pase completo: 180 pruebas API, 54 web y 54 MCP (288), Docker y smoke correctos; sin escrituras nuevas de incidencias.

Referencias: [guía oficial para ISV](https://aps.autodesk.com/blog/passthrough-billing-guide-isvs), [anuncio oficial y fases de incorporación](https://aps.autodesk.com/blog/introducing-passthrough-billing-more-flexible-way-manage-api-usage-costs-aps), [explicación de Cody en Código BIM](https://codigobim.com/passthrough-billing-autodesk-aps/).
