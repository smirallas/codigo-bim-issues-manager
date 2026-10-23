import { ProjectRequestError } from "./projects";

export type Issue = {
  id: string;
  displayId: number | null;
  title: string;
  description: string | null;
  issueSubtypeId: string | null;
  status: string;
  assignedTo: string | null;
  assignedToType: string | null;
  updatedAt: string | null;
  published: boolean;
  deleted: boolean;
  permittedAttributes: string[];
  permittedStatuses: string[];
  permittedActions: string[];
};
export type TypeOption = { id: string; name: string };
export type IssuesPage = {
  results: Issue[];
  pagination: { offset: number; limit: number; totalResults: number };
};
export type PlanInput = {
  operation: "create" | "update";
  issue_id?: string;
  title?: string;
  description?: string;
  status?: string;
  subtype_id?: string;
  assignee_id?: string;
};
export type WriteResult = {
  state: "succeeded" | "rejected" | "uncertain" | "running";
  issue_id: string | null;
  issue: Issue | null;
  verified: boolean;
  error: string | null;
};
export type PlanReview = {
  id: string;
  state: string;
  expires_at: number;
  content_digest?: string;
  approved_at?: number | null;
  content: {
    project_name: string;
    project_id: string;
    hub_id: string;
    request: PlanInput;
    payload: Record<string, unknown>;
    before: Issue | null;
    assignee_name: string | null;
    subtype_name: string | null;
  };
  result: WriteResult | null;
};

const messages: Record<string, string> = {
  issue_creation_not_permitted:
    "Autodesk no confirma permiso de creación para tu cuenta.",
  issue_fields_not_permitted:
    "Autodesk no permite modificar alguno de esos campos. Actualiza la consulta y revisa los permisos.",
  issue_status_not_permitted:
    "Ese estado no está permitido para esta operación.",
  issue_subtype_unavailable:
    "El tipo ya no está activo o disponible. Actualiza los tipos.",
  issue_changed_review_again:
    "La incidencia o sus permisos han cambiado. Consulta y prepara de nuevo la revisión.",
  issue_no_changes: "No hay cambios para enviar.",
  plan_expired: "La revisión ha caducado. Prepara otra antes de confirmar.",
  plan_unavailable:
    "Esta revisión no pertenece a tu sesión o ya no está disponible.",
  plan_already_claimed:
    "El envío ya se inició. Consulta su resultado; no lo repitas.",
  plan_changed_review_again:
    "El contenido ha cambiado. Recarga y revisa antes de aprobar.",
  human_approval_required: "La operación necesita aprobación en la web.",
  aps_issue_write_denied: "Autodesk ha denegado la escritura para esta cuenta.",
  aps_issue_payload_rejected:
    "Autodesk ha rechazado los datos. Revisa el formulario antes de preparar otro envío.",
  issue_write_uncertain:
    "No se conoce el resultado del envío. Comprueba la incidencia en Autodesk antes de preparar otra operación; no se repetirá automáticamente.",
  issue_reread_failed:
    "Autodesk aceptó el envío, pero la relectura no pudo completarse. Consulta el ID indicado antes de continuar.",
  company_not_confirmed:
    "Falta la empresa del usuario o del responsable. No se confirma la asignación.",
  assignment_other_company:
    "Tu cuenta solo puede asignar a su empresa y el responsable pertenece a otra.",
};
export function issueMessage(code: string): string {
  return messages[code] ?? new ProjectRequestError(code).message;
}

export class IssueHttpError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(issueMessage(code));
  }
}
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function strings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function issue(v: unknown): v is Issue {
  return (
    record(v) &&
    ["id", "title", "status"].every((k) => typeof v[k] === "string") &&
    [
      "description",
      "issueSubtypeId",
      "assignedTo",
      "assignedToType",
      "updatedAt",
    ].every((k) => v[k] === null || typeof v[k] === "string") &&
    ["published", "deleted"].every((k) => typeof v[k] === "boolean") &&
    ["permittedAttributes", "permittedActions", "permittedStatuses"].every(
      (k) => strings(v[k]),
    )
  );
}
function result(v: unknown): v is WriteResult {
  return (
    record(v) &&
    ["succeeded", "rejected", "uncertain", "running"].includes(
      String(v.state),
    ) &&
    typeof v.verified === "boolean" &&
    (v.issue === null || issue(v.issue))
  );
}
export function isPlanReview(v: unknown): v is PlanReview {
  return (
    record(v) &&
    typeof v.id === "string" &&
    typeof v.expires_at === "number" &&
    typeof v.state === "string" &&
    record(v.content) &&
    typeof v.content.project_name === "string" &&
    record(v.content.request) &&
    record(v.content.payload) &&
    (v.content.before === null || issue(v.content.before)) &&
    (v.result === null || result(v.result))
  );
}
type Responses = {
  types: TypeOption[];
  list: IssuesPage;
  detail: Issue;
  prepare: PlanReview;
  review: PlanReview;
  approve: PlanReview;
  execute: WriteResult;
};
/** Usa la sesión local y CSRF para preparar/ejecutar; nunca reintenta escrituras. */
export async function issueRequest<K extends keyof Responses>(
  kind: K,
  path: string,
  signal?: AbortSignal,
  body?: PlanInput | { content_digest: string },
  csrf?: string,
  fetcher: typeof fetch = fetch,
): Promise<Responses[K]> {
  const write = kind === "prepare" || kind === "execute" || kind === "approve";
  const response = await fetcher(`/api/projects/${path}`, {
    credentials: "same-origin",
    method: write ? "POST" : "GET",
    headers: write
      ? { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" }
      : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000),
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw new IssueHttpError(
      record(data) && typeof data.error === "string"
        ? data.error
        : response.status === 422
          ? "aps_issue_payload_rejected"
          : "unavailable",
      response.status,
    );
  let valid = false;
  if (kind === "types")
    valid =
      Array.isArray(data) &&
      data.every(
        (v) =>
          record(v) && typeof v.id === "string" && typeof v.name === "string",
      );
  if (kind === "detail") valid = issue(data);
  if (kind === "list")
    valid =
      record(data) &&
      Array.isArray(data.results) &&
      data.results.every(issue) &&
      record(data.pagination) &&
      ["offset", "limit", "totalResults"].every((k) =>
        Number.isInteger(
          data.pagination && (data.pagination as Record<string, unknown>)[k],
        ),
      );
  if (kind === "prepare" || kind === "review" || kind === "approve")
    valid = isPlanReview(data);
  if (kind === "execute") valid = result(data);
  if (!valid) throw new Error("La respuesta de incidencias no es válida.");
  signal?.throwIfAborted();
  return data as Responses[K];
}
