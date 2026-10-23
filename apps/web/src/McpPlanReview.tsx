import { useEffect, useState } from "react";
import { loadAuth } from "./auth";
import { issueRequest, type PlanReview } from "./issues";

/** La revisión se carga con la cookie propia; el enlace no acredita identidad ni aprueba. */
export function McpPlanReview({ id }: { id: string }) {
  const [plan, setPlan] = useState<PlanReview>();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void issueRequest(
      "review",
      `issue-plans/${encodeURIComponent(id)}`,
      controller.signal,
    )
      .then(setPlan)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "No se pudo consultar la revisión.",
          );
      });
    return () => controller.abort();
  }, [id]);

  async function approve() {
    if (!plan?.content_digest || !accepted) return;
    setBusy(true);
    setError("");
    try {
      const auth = await loadAuth();
      if (auth.status !== "authenticated")
        throw new Error("Vuelve a iniciar sesión.");
      const updated = await issueRequest(
        "approve",
        `issue-plans/${encodeURIComponent(plan.id)}/approve`,
        undefined,
        { content_digest: plan.content_digest },
        auth.session.csrf_token,
      );
      setPlan(updated);
      setAccepted(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo aprobar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mcp-review" aria-label="Revisión de la operación MCP">
      <h2>Revisa la operación del agente</h2>
      <p>
        Aprobar permite al cliente MCP ejecutar este contenido hasta su
        vencimiento. Este botón no envía la incidencia a Autodesk.
      </p>
      {error && <p role="alert">{error}</p>}
      {!plan && !error && <p>Cargando revisión…</p>}
      {plan && (
        <>
          <p>
            <strong>Proyecto:</strong> {plan.content.project_name}
          </p>
          <p>
            <strong>Operación:</strong>{" "}
            {plan.content.request.operation === "create"
              ? "Crear incidencia"
              : "Actualizar incidencia"}
          </p>
          <p>
            <strong>Responsable:</strong>{" "}
            {plan.content.assignee_name ?? "Sin responsable"}
          </p>
          <p>
            <strong>Tipo:</strong>{" "}
            {plan.content.subtype_name ?? "Se conserva el existente"}
          </p>
          <p>
            <strong>Vence:</strong>{" "}
            {new Date(plan.expires_at * 1000).toLocaleString("es-ES")}
          </p>
          <h3>Datos que se enviarán</h3>
          <pre>{JSON.stringify(plan.content.payload, null, 2)}</pre>
          {plan.content.before && (
            <>
              <h3>Incidencia antes del cambio</h3>
              <pre>{JSON.stringify(plan.content.before, null, 2)}</pre>
            </>
          )}
          <p>
            <small>Referencia: {plan.id}</small>
          </p>
          {plan.result ? (
            <>
              <h3>Resultado guardado</h3>
              <pre>{JSON.stringify(plan.result, null, 2)}</pre>
            </>
          ) : plan.approved_at ? (
            <p role="status">
              Contenido aprobado. Vuelve al agente para ejecutar esta revisión.
            </p>
          ) : (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  disabled={busy}
                />{" "}
                He revisado el proyecto y los datos exactos de esta operación.
              </label>
              <button
                disabled={
                  !accepted ||
                  busy ||
                  plan.state !== "prepared" ||
                  plan.expires_at <= Date.now() / 1000
                }
                onClick={() => {
                  void approve();
                }}
              >
                {busy
                  ? "Guardando aprobación…"
                  : "Aprobar esta operación para MCP"}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
