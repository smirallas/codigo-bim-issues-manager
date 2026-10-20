import { useEffect, useState } from "react";
import { checkApiHealth, type ApiStatus } from "./health";
import { authMessages, disconnect, loadAuth, type AuthState } from "./auth";
import { ProjectBrowser } from "./ProjectBrowser";

const statusText: Record<ApiStatus, string> = {
  loading: "Comprobando la API…",
  ok: "API disponible.",
  unavailable:
    "La API no está disponible. Comprueba el servicio y su configuración.",
};

export function App() {
  const [status, setStatus] = useState<ApiStatus>("loading");
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void checkApiHealth().then((result) => {
      if (active) setStatus(result);
    });
    const callbackError = new URLSearchParams(window.location.search).get(
      "auth_error",
    );
    if (callbackError) {
      setNotice(authMessages[callbackError] ?? authMessages.provider_error);
      window.history.replaceState(null, "", window.location.pathname);
    }
    void loadAuth().then((result) => {
      if (active) setAuth(result);
    });
    return () => {
      active = false;
    };
  }, []);

  async function logout(): Promise<void> {
    if (auth.status !== "authenticated") return;
    setBusy(true);
    try {
      const confirmed = await disconnect(auth.session);
      setAuth({ status: "anonymous" });
      setNotice(
        confirmed
          ? "Sesión desconectada y revocación confirmada por Autodesk."
          : "Sesión local desconectada. No se ha podido confirmar la revocación en Autodesk; revisa el acceso de la aplicación en tu cuenta.",
      );
    } catch {
      setNotice(
        "No se ha podido completar la desconexión. Comprueba la conexión y vuelve a intentarlo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">Código BIM · E02</p>
      <h1>Issues Manager</h1>
      <aside aria-label="Aviso de demostración">
        <strong>Demostración técnica en desarrollo.</strong> Las operaciones
        pueden crear o modificar incidencias reales en Autodesk. Utiliza
        únicamente proyectos de prueba y revisa los datos antes de confirmar.
      </aside>
      <h2>Accede con tu cuenta Autodesk</h2>
      <p>
        El acceso está limitado a las cuentas autorizadas para esta
        demostración.
      </p>
      {notice && <p role="alert">{notice}</p>}
      {auth.status === "loading" && <p>Comprobando la sesión…</p>}
      {auth.status === "unconfigured" && (
        <p className="auth-panel">
          Falta completar la configuración APS privada del servidor. El inicio
          de sesión está deshabilitado.
        </p>
      )}
      {auth.status === "unavailable" && (
        <p role="alert">
          No se ha podido comprobar la sesión. Recarga la página cuando la API
          esté disponible.
        </p>
      )}
      {auth.status === "anonymous" && (
        <section className="auth-panel">
          {auth.error && authMessages[auth.error] && (
            <p role="alert">{authMessages[auth.error]}</p>
          )}
          <a className="button" href="/api/auth/login">
            Iniciar sesión con Autodesk
          </a>
        </section>
      )}
      {auth.status === "authenticated" && (
        <section className="auth-panel" aria-label="Sesión Autodesk">
          <p>
            <strong>{auth.session.user.name || "Cuenta Autodesk"}</strong>
            <br />
            {auth.session.user.email}
          </p>
          <p>Acceso autorizado a la demostración.</p>
          <button
            disabled={busy}
            onClick={() => {
              void logout();
            }}
          >
            {busy ? "Desconectando…" : "Desconectar Autodesk"}
          </button>
        </section>
      )}
      {auth.status === "authenticated" && <ProjectBrowser />}
      <p role="status">{statusText[status]}</p>
      <p>
        Puedes iniciar sesión y seleccionar un proyecto accesible. Las
        operaciones con incidencias se incorporarán en entregas posteriores.
      </p>
    </main>
  );
}
