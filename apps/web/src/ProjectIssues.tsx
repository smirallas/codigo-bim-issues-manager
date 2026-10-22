import { useEffect, useRef, useState } from "react";
import { loadAuth } from "./auth";
import { queryMembers, type Capabilities, type Member } from "./members";
import { type Selection } from "./projects";
import {
  IssueHttpError,
  issueMessage,
  issueRequest,
  type Issue,
  type IssuesPage,
  type PlanInput,
  type PlanReview,
  type TypeOption,
  type WriteResult,
} from "./issues";

export function ProjectIssues({ selection }: { selection: Selection }) {
  const path = `hubs/${encodeURIComponent(selection.hub.id)}/${encodeURIComponent(selection.project.id)}`;
  const [page, setPage] = useState<IssuesPage>();
  const [offset, setOffset] = useState(0);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [caps, setCaps] = useState<Capabilities>();
  const [current, setCurrent] = useState<Issue>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [subtype, setSubtype] = useState("");
  const [assignee, setAssignee] = useState("");
  const [plan, setPlan] = useState<PlanReview>();
  const [result, setResult] = useState<WriteResult>();
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const active = useRef(true);
  const controller = useRef(new AbortController());
  const storageKey = useRef("");
  useEffect(() => {
    active.current = true;
    const c = new AbortController();
    controller.current = c;
    void issueRequest("types", `${path}/issue-types`, c.signal)
      .then(setTypes)
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message));
      });
    void queryMembers(
      selection.hub.id,
      selection.project.id,
      "members",
      c.signal,
    )
      .then(setMembers)
      .catch(() => {});
    void queryMembers(
      selection.hub.id,
      selection.project.id,
      "capabilities",
      c.signal,
    )
      .then((v) => {
        if (!c.signal.aborted) {
          setCaps(v);
          setStatus(
            v.permitted_statuses.includes("open")
              ? "open"
              : (v.permitted_statuses[0] ?? ""),
          );
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message));
      });
    void loadAuth().then(async (auth) => {
      if (auth.status !== "authenticated" || c.signal.aborted) return;
      storageKey.current = `issue-plan:${auth.session.user.subject}:${selection.project.id}`;
      const id = sessionStorage.getItem(storageKey.current);
      if (id) {
        try {
          const saved = await issueRequest(
            "review",
            `issue-plans/${encodeURIComponent(id)}`,
            c.signal,
          );
          if (!c.signal.aborted) {
            setPlan(saved);
            setResult(saved.result ?? undefined);
          }
        } catch {
          if (!c.signal.aborted)
            setNotice(
              "Hay una referencia de envío anterior no disponible en esta sesión. Comprueba Autodesk antes de repetirlo.",
            );
        }
      }
    });
    return () => {
      active.current = false;
      c.abort();
    };
  }, [path, selection.hub.id, selection.project.id]);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    void issueRequest("list", `${path}/issues?offset=${offset}`, c.signal)
      .then(setPage)
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message));
      });
    return () => c.abort();
  }, [path, offset, refresh]);

  function changed() {
    setPlan(undefined);
    setResult(undefined);
    setApproved(false);
  }
  function reset() {
    changed();
    setCurrent(undefined);
    setTitle("");
    setDescription("");
    setAssignee("");
    setStatus(
      caps?.permitted_statuses.includes("open")
        ? "open"
        : (caps?.permitted_statuses[0] ?? ""),
    );
  }
  async function open(id: string) {
    setBusy(true);
    setError("");
    try {
      const v = await issueRequest(
        "detail",
        `${path}/issues/${encodeURIComponent(id)}`,
        controller.current.signal,
      );
      if (!active.current) return;
      changed();
      setCurrent(v);
      setTitle(v.title);
      setDescription(v.description ?? "");
      setStatus(v.status);
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "No se pudo consultar.");
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function prepare() {
    setBusy(true);
    setError("");
    setResult(undefined);
    setApproved(false);
    try {
      const auth = await loadAuth();
      if (auth.status !== "authenticated")
        throw new Error("Vuelve a iniciar sesión.");
      let body: PlanInput;
      if (current) {
        body = {
          operation: "update",
          issue_id: current.id,
          ...(title !== current.title ? { title } : {}),
          ...(description !== (current.description ?? "")
            ? { description }
            : {}),
          ...(status !== current.status ? { status } : {}),
        };
      } else
        body = {
          operation: "create",
          title,
          description,
          status,
          subtype_id: subtype,
          ...(assignee ? { assignee_id: assignee } : {}),
        };
      const v = await issueRequest(
        "prepare",
        `${path}/issue-plans`,
        controller.current.signal,
        body,
        auth.session.csrf_token,
      );
      if (!active.current) return;
      setPlan(v);
      if (storageKey.current) sessionStorage.setItem(storageKey.current, v.id);
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "No se pudo preparar.");
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function execute() {
    if (!plan || !approved) return;
    setBusy(true);
    setError("");
    try {
      const auth = await loadAuth();
      if (auth.status !== "authenticated")
        throw new Error("Vuelve a iniciar sesión.");
      const v = await issueRequest(
        "execute",
        `issue-plans/${encodeURIComponent(plan.id)}/execute`,
        undefined,
        undefined,
        auth.session.csrf_token,
      );
      if (!active.current) return;
      setResult(v);
      setPlan({ ...plan, state: v.state, result: v });
      setApproved(false);
      setRefresh((n) => n + 1);
    } catch (e) {
      if (active.current) {
        if (e instanceof IssueHttpError && e.status < 500) {
          setPlan(undefined);
          setNotice(
            "El servidor ha rechazado la confirmación antes del envío. Consulta los datos y prepara otra revisión.",
          );
        } else {
          setResult({
            state: "uncertain",
            issue_id: null,
            issue: null,
            verified: false,
            error: "issue_write_uncertain",
          });
        }
        setError(e instanceof Error ? e.message : "Resultado incierto.");
      }
    } finally {
      if (active.current) {
        setBusy(false);
        setApproved(false);
      }
    }
  }
  async function recover() {
    if (!plan) return;
    setBusy(true);
    try {
      const v = await issueRequest(
        "review",
        `issue-plans/${encodeURIComponent(plan.id)}`,
        controller.current.signal,
      );
      if (active.current) {
        setPlan(v);
        setResult(v.result ?? undefined);
      }
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error ? e.message : "No se pudo consultar el resultado.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const statuses = current
    ? current.permittedStatuses
    : (caps?.permitted_statuses ?? []);
  return (
    <section className="issues-panel" aria-label="Incidencias del proyecto">
      <h2>Incidencias del proyecto</h2>
      <p>
        Consulta, prepara y revisa antes de confirmar. Solo se envían título,
        descripción, tipo, estado y, al crear, un responsable opcional. Sin
        adjuntos, visor ni eliminación.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
        Actualizar incidencias
      </button>
      {!page ? (
        <p role="status">Consultando incidencias…</p>
      ) : (
        <>
          <p>
            {page.pagination.totalResults} incidencias accesibles. Página desde{" "}
            {page.pagination.offset + 1}.
          </p>
          {page.results.length === 0 ? (
            <p>No hay incidencias en esta página.</p>
          ) : (
            <ul>
              {page.results.map((v) => (
                <li key={v.id}>
                  <button disabled={busy} onClick={() => void open(v.id)}>
                    #{v.displayId ?? "—"} · {v.title} · {v.status}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            disabled={busy || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            Anterior
          </button>{" "}
          <button
            disabled={
              busy ||
              offset + page.pagination.limit >= page.pagination.totalResults
            }
            onClick={() => setOffset(offset + page.pagination.limit)}
          >
            Siguiente
          </button>
        </>
      )}
      <h3>
        {current
          ? `Editar incidencia #${current.displayId ?? current.id}`
          : "Preparar una incidencia nueva"}
      </h3>
      <button disabled={busy} onClick={reset}>
        Nueva incidencia
      </button>
      {current && (
        <p>
          ID Autodesk: {current.id}. Publicada:{" "}
          {current.published ? "sí" : "no"}. Estado consultado: {current.status}
          . Los permisos son los de esta incidencia.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void prepare();
        }}
        onChange={changed}
      >
        <fieldset disabled={busy}>
          <label>
            Título
            <input
              required
              maxLength={100}
              value={title}
              disabled={
                !!current && !current.permittedAttributes.includes("title")
              }
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Descripción
            <textarea
              maxLength={1000}
              value={description}
              disabled={
                !!current &&
                !current.permittedAttributes.includes("description")
              }
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {!current && (
            <>
              <label>
                Tipo de incidencia
                <select
                  required
                  value={subtype}
                  onChange={(e) => setSubtype(e.target.value)}
                >
                  <option value="">Elige un tipo activo</option>
                  {types.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Responsable
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">Sin asignar</option>
                  {members
                    .filter((v) => v.status === "active" && v.autodesk_id)
                    .map((v) => (
                      <option key={v.id} value={v.autodesk_id ?? ""}>
                        {v.name} · {v.email ?? v.autodesk_id} ·{" "}
                        {v.company_name ?? "Sin empresa"}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          <label>
            Estado
            <select
              required
              value={status}
              disabled={
                !!current && !current.permittedAttributes.includes("status")
              }
              onChange={(e) => setStatus(e.target.value)}
            >
              {!statuses.includes(status) && (
                <option value={status}>
                  {status || "Sin estados disponibles"}
                </option>
              )}
              {statuses.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Preparar revisión · no envía a Autodesk</button>
        </fieldset>
      </form>
      {plan && (
        <section aria-label="Revisión antes del envío" className="issue-review">
          <h3>
            Revisa{" "}
            {plan.content.request.operation === "create"
              ? "la creación"
              : "la actualización"}
          </h3>
          <p>
            Proyecto: {plan.content.project_name}.{" "}
            {plan.content.request.issue_id &&
              `Incidencia: ${plan.content.request.issue_id}.`}{" "}
            Revisión válida hasta{" "}
            {new Date(plan.expires_at * 1000).toLocaleTimeString()}.
          </p>
          {plan.content.subtype_name && (
            <p>Tipo: {plan.content.subtype_name}</p>
          )}
          <p>
            Responsable:{" "}
            {plan.content.assignee_name ??
              (plan.content.request.operation === "create"
                ? "sin asignar"
                : "se conserva")}
          </p>
          <dl>
            {Object.entries(plan.content.payload).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {String(value)}
                  {plan.content.before && (
                    <small>
                      {" "}
                      · Antes:{" "}
                      {String(plan.content.before[key as keyof Issue] ?? "—")}
                    </small>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {plan.state === "prepared" && !result && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={busy}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                He revisado este contenido y autorizo enviarlo a Autodesk.
              </label>
              <button
                disabled={busy || !approved}
                onClick={() => void execute()}
              >
                Confirmar y enviar a Autodesk
              </button>
            </>
          )}
          <button disabled={busy} onClick={() => void recover()}>
            Consultar resultado guardado
          </button>
          {result && (
            <div role="status">
              <strong>
                {result.state === "succeeded"
                  ? result.verified
                    ? "Envío aceptado y relectura comprobada."
                    : "Envío aceptado; relectura pendiente de comprobar."
                  : result.state === "rejected"
                    ? "Envío rechazado por Autodesk."
                    : "Envío iniciado o de resultado incierto. No repetir."}
              </strong>
              {result.error && <p>{issueMessage(result.error)}</p>}
              {result.issue_id && <p>ID: {result.issue_id}</p>}
              {result.issue && (
                <p>
                  Resultado observado: {result.issue.title} ·{" "}
                  {result.issue.status}
                </p>
              )}
            </div>
          )}
        </section>
      )}
      {busy && <p role="status">Procesando…</p>}
    </section>
  );
}
