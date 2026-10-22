import { useEffect, useRef, useState } from "react";
import { loadAuth } from "./auth";
import { importMessage, importRequest, type ImportReview } from "./imports";
import { IssueHttpError, issueMessage } from "./issues";
import type { Selection } from "./projects";

export function ProjectImport({ selection }: { selection: Selection }) {
  const [file, setFile] = useState<File>();
  const [review, setReview] = useState<ImportReview>();
  const [approval, setApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const key = useRef("");
  const path = `hubs/${encodeURIComponent(selection.hub.id)}/${encodeURIComponent(selection.project.id)}/imports`;
  useEffect(() => {
    alive.current = true;
    void loadAuth().then(async (auth) => {
      if (auth.status !== "authenticated" || !alive.current) return;
      key.current = `excel-plan:${auth.session.user.subject}:${selection.project.id}`;
      const id = sessionStorage.getItem(key.current);
      if (id) {
        try {
          const saved = await importRequest(
            `imports/${encodeURIComponent(id)}`,
          );
          if (alive.current && saved.project_id === selection.project.id)
            setReview(saved);
        } catch {
          if (alive.current)
            setError(
              "No se ha recuperado el lote. No lo vuelvas a enviar sin comprobar el proyecto.",
            );
        }
      }
    });
    return () => {
      alive.current = false;
    };
  }, [selection.project.id]);

  async function run(action: "prepare" | "execute" | "review") {
    setBusy(true);
    setError("");
    try {
      const auth = await loadAuth();
      if (auth.status !== "authenticated")
        throw new Error("Vuelve a iniciar sesión.");
      const csrf = auth.session.csrf_token;
      if (action === "prepare" && file) {
        const data = await importRequest(path, csrf, file);
        sessionStorage.setItem(key.current, data.id);
        if (alive.current) {
          setReview(data);
          setApproval(false);
        }
      } else if (review) {
        const base = `imports/${encodeURIComponent(review.id)}`;
        let data = await importRequest(
          action === "execute" ? `${base}/approve` : base,
          action === "execute" ? csrf : undefined,
        );
        if (alive.current) setReview(data);
        if (action === "execute") {
          for (const row of data.rows) {
            if (!alive.current) break;
            if (row.plan?.state === "prepared" && !row.error) {
              data = await importRequest(
                `${base}/rows/${row.row}/execute`,
                csrf,
              );
              if (alive.current) setReview(data);
            }
          }
        }
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof IssueHttpError
            ? (importMessage(e.code) ?? e.message)
            : "No se conoce si ha terminado el envío. Consulta el resultado guardado antes de preparar otro lote.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const pending =
    review?.rows.filter((r) => r.plan?.state === "prepared" && !r.error)
      .length ?? 0;
  return (
    <section className="excel-import" aria-labelledby="excel-heading">
      <h2 id="excel-heading">Importar incidencias desde Excel</h2>
      <p>
        Solo crea incidencias nuevas. Una hoja «Incidencias», seis columnas,
        máximo 25 filas y 1 MiB. Fecha Excel o YYYY-MM-DD; sin fórmulas ni
        macros. Preparar consulta Autodesk, pero no crea incidencias.
      </p>
      <a href="/api/projects/imports/template" download>
        Descargar plantilla Excel
      </a>
      <p>
        Copia el tipo completo «categoría / subtipo» de la consulta de
        incidencias. Responsable opcional: Autodesk ID, correo o nombre exacto;
        un nombre ambiguo queda bloqueado.
      </p>
      <label>
        Archivo Excel (.xlsx)
        <input
          type="file"
          accept=".xlsx"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0]);
            setReview(undefined);
            setApproval(false);
          }}
        />
      </label>
      <button disabled={busy || !file} onClick={() => void run("prepare")}>
        Preparar Excel · no envía incidencias
      </button>
      {error && <p role="alert">{error}</p>}
      {review && (
        <>
          <h3>Revisión del lote · {review.project_name}</h3>
          <p>
            {review.rows.length} filas; {pending} pendientes válidas. Caduca:{" "}
            {new Date(review.expires_at * 1000).toLocaleString("es-ES")}. Las
            filas bloqueadas no se envían.
          </p>
          {review.rows.map((row) => (
            <article key={row.row} className="import-row">
              <h4>
                Fila {row.row} · {row.values.titulo || "Sin título"}
              </h4>
              {row.error ? (
                <p role="status">
                  Bloqueada:{" "}
                  {importMessage(row.error) ?? issueMessage(row.error)}
                </p>
              ) : (
                <>
                  <p>
                    Tipo: {row.plan?.content.subtype_name}. Responsable:{" "}
                    {row.plan?.content.assignee_name ?? "Sin asignar"}.
                  </p>
                  <pre>
                    {JSON.stringify(row.plan?.content.payload, null, 2)}
                  </pre>
                  <p>
                    Resultado:{" "}
                    {row.plan?.state === "prepared"
                      ? "Pendiente de envío"
                      : row.plan?.state}
                    .{" "}
                    {row.plan?.result?.verified ? "Relectura comprobada." : ""}{" "}
                    {row.plan?.result?.issue_id
                      ? `ID: ${row.plan.result.issue_id}`
                      : ""}
                  </p>
                  {row.plan?.result?.error && (
                    <p>{issueMessage(row.plan.result.error)}</p>
                  )}
                </>
              )}
            </article>
          ))}
          <label>
            <input
              type="checkbox"
              checked={approval}
              disabled={busy}
              onChange={(e) => setApproval(e.target.checked)}
            />
            He revisado este proyecto y los datos exactos de todas las filas
            válidas. Autorizo crear esas incidencias.
          </label>
          <button
            disabled={
              busy ||
              !approval ||
              !pending ||
              Date.now() >= review.expires_at * 1000
            }
            onClick={() => void run("execute")}
          >
            Confirmar y enviar {pending} filas válidas
          </button>
          <button disabled={busy} onClick={() => void run("review")}>
            Consultar resultado del Excel guardado
          </button>
          <p>
            Si se pierde la respuesta, consulta el resultado. Ninguna fila
            enviada se reintenta automáticamente; un resultado incierto requiere
            comprobar Autodesk. Un archivo nuevo puede duplicar incidencias ya
            creadas.
          </p>
        </>
      )}
      {busy && (
        <p role="status">
          Procesando. No prepares otro lote; el resultado se guarda por fila.
        </p>
      )}
    </section>
  );
}
