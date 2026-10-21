import { ProjectRequestError } from "./projects";

export type Member = {
  id: string;
  autodesk_id: string | null;
  name: string;
  email: string | null;
  company_id: string | null;
  company_name: string | null;
  status: string;
  project_admin: boolean | null;
  account_admin: boolean | null;
};
export type Capabilities = {
  user_id: string;
  project_admin: boolean;
  permission_levels: string[];
  can_create: boolean;
  assignment: "all" | "same_company" | "unavailable";
  permitted_actions: string[];
  permitted_attributes: string[];
  permitted_statuses: string[];
};
export type AssigneeCheck = {
  member: Member;
  eligible: boolean;
  reason: string;
};

export const assigneeReasons: Record<string, string> = {
  eligible:
    "Responsable compatible con las capacidades consultadas para una incidencia nueva. No se ha creado ni asignado ninguna incidencia.",
  assignee_inactive:
    "Este miembro no está activo o no tiene identidad Autodesk disponible.",
  issue_creation_not_permitted:
    "La consulta no confirma permiso para crear incidencias.",
  assignment_not_confirmed:
    "Autodesk no confirma esta capacidad de asignación.",
  company_not_confirmed:
    "Falta confirmar la empresa del usuario o del responsable. No se presupone que coincidan.",
  assignment_other_company:
    "Solo puedes asignar a tu empresa; este miembro pertenece a otra.",
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
function member(value: unknown): value is Member {
  if (!record(value)) return false;
  return (
    ["id", "name", "status"].every(
      (key) => typeof value[key] === "string" && value[key] !== "",
    ) &&
    ["project_admin", "account_admin"].every(
      (key) => value[key] === null || typeof value[key] === "boolean",
    ) &&
    ["autodesk_id", "email", "company_id", "company_name"].every(
      (key) => value[key] === null || typeof value[key] === "string",
    )
  );
}
function capabilities(value: unknown): value is Capabilities {
  if (!record(value)) return false;
  return (
    typeof value.user_id === "string" &&
    value.user_id !== "" &&
    typeof value.project_admin === "boolean" &&
    typeof value.can_create === "boolean" &&
    ["all", "same_company", "unavailable"].includes(String(value.assignment)) &&
    [
      "permission_levels",
      "permitted_actions",
      "permitted_attributes",
      "permitted_statuses",
    ].every((key) => strings(value[key]))
  );
}

type Results = {
  members: Member[];
  capabilities: Capabilities;
  "assignee-check": AssigneeCheck;
};

export async function queryMembers<K extends keyof Results>(
  hub: string,
  project: string,
  kind: K,
  signal: AbortSignal,
  query?: string,
  fetcher: typeof fetch = fetch,
): Promise<Results[K]> {
  let path = `/api/projects/hubs/${encodeURIComponent(hub)}/${encodeURIComponent(project)}/${kind}`;
  if (kind === "assignee-check")
    path += `?by=id&query=${encodeURIComponent(query ?? "")}`;
  const response = await fetcher(path, {
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw new ProjectRequestError(
      record(data) && typeof data.error === "string"
        ? data.error
        : "unavailable",
    );
  if (record(data)) {
    if (
      kind === "members" &&
      Array.isArray(data.items) &&
      data.items.every(member)
    )
      return data.items as Results[K];
    if (kind === "capabilities" && capabilities(data))
      return data as Results[K];
    if (
      kind === "assignee-check" &&
      member(data.member) &&
      data.member.autodesk_id === query &&
      typeof data.eligible === "boolean" &&
      typeof data.reason === "string" &&
      data.reason in assigneeReasons &&
      data.eligible === (data.reason === "eligible")
    )
      return data as Results[K];
  }
  throw new ProjectRequestError("invalid_response");
}
