export type Resource = { id: string; name: string };
export type ResourceList = {
  items: Resource[];
  excluded: number;
  incomplete: boolean;
};
export type Selection = { hub: Resource; project: Resource };

export const projectMessages: Record<string, string> = {
  unauthenticated: "La sesión ya no está disponible. Vuelve a iniciar sesión.",
  session_expired: "La sesión ha caducado. Vuelve a iniciar sesión.",
  reconnect_required: "Vuelve a conectar tu cuenta Autodesk.",
  access_denied: "Tu cuenta ya no tiene acceso a la demostración.",
  aps_reconnect_required:
    "Autodesk no acepta el token o sus permisos. Vuelve a conectar tu cuenta y autoriza la lectura de datos.",
  aps_access_denied:
    "Autodesk ha denegado la consulta. Revisa el consentimiento, la integración de la aplicación en la cuenta y tu acceso a Docs.",
  resource_unavailable:
    "El hub o proyecto ya no está disponible para esta cuenta. Actualiza la lista.",
  aps_rate_limited:
    "Autodesk ha limitado temporalmente las consultas. Espera un poco antes de volver a intentarlo.",
  aps_partial_response:
    "Autodesk ha devuelto advertencias y la lista puede estar incompleta. Revisa el acceso y vuelve a intentarlo.",
};

export class ProjectRequestError extends Error {
  constructor(public readonly code: string) {
    super(
      projectMessages[code] ??
        "No se ha podido completar la consulta. Vuelve a intentarlo más tarde.",
    );
  }
}

function resource(value: unknown): value is Resource {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.name === "string" &&
    row.name.length > 0
  );
}

export async function queryProjects(
  hubId?: string,
  projectId?: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ResourceList | Selection> {
  let path = "/api/projects/hubs";
  if (hubId) path += `/${encodeURIComponent(hubId)}`;
  if (projectId) path += `/${encodeURIComponent(projectId)}`;
  const timeout = AbortSignal.timeout(65000);
  const response = await fetcher(path, {
    credentials: "same-origin",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const code =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "unavailable";
    throw new ProjectRequestError(code);
  }
  if (!data || typeof data !== "object")
    throw new ProjectRequestError("invalid_response");
  if (projectId && "hub" in data && "project" in data) {
    if (
      resource(data.hub) &&
      resource(data.project) &&
      data.hub.id === hubId &&
      data.project.id === projectId
    )
      return { hub: data.hub, project: data.project };
  } else if (
    !projectId &&
    "items" in data &&
    Array.isArray(data.items) &&
    data.items.every(resource) &&
    "excluded" in data &&
    typeof data.excluded === "number" &&
    Number.isInteger(data.excluded) &&
    data.excluded >= 0 &&
    "incomplete" in data &&
    typeof data.incomplete === "boolean"
  ) {
    return {
      items: data.items,
      excluded: data.excluded,
      incomplete: data.incomplete,
    };
  }
  throw new ProjectRequestError("invalid_response");
}
