import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  capabilities,
  context,
  ContractFailure,
  id,
  importReview,
  issue,
  planInput,
  planReview,
  resource,
  resources,
  writeResult,
  type ContractApi,
} from "./contracts.js";

const error = z.object({ code: z.string(), message: z.string() });
const messages: Record<string, string> = {
  authentication_required:
    "Autoriza el cliente MCP con una sesión Autodesk vigente y una cuenta permitida. El modo fixtures solo contiene datos sintéticos.",
  resource_unavailable: "El recurso no está disponible para esta conexión.",
  plan_expired:
    "La preparación ha caducado. Prepara otra y revisa su contenido.",
  fixture_limit: "Se ha alcanzado el límite de preparaciones sintéticas.",
  upstream_unavailable:
    "No se ha podido consultar el contrato de la API. No se reintenta automáticamente.",
  invalid_api_response: "La respuesta no cumple el contrato esperado.",
  human_approval_not_available:
    "El ensayo sintético no ejecuta incidencias en Autodesk.",
  human_approval_required:
    "Abre review_url y aprueba el contenido exacto en la web antes de ejecutar. El modelo no puede aprobar.",
  plan_changed_review_again:
    "El plan ha cambiado. Revisa y aprueba su contenido de nuevo.",
  issue_changed_review_again:
    "La incidencia o sus permisos han cambiado. Prepara otra revisión.",
  permission_denied: "La cuenta ya no tiene permiso para esa operación.",
};

/** Herramientas pequeñas sobre rutas cerradas de FastAPI, sin proxy genérico. */
export function registerTools(server: McpServer, api?: ContractApi): void {
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    input: z.ZodObject<S>,
    data: z.ZodTypeAny,
    readOnly: boolean,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ): void {
    const output = z.object({
      mode: z.enum(["disabled", "fixtures", "autodesk"]),
      ok: z.boolean(),
      data: data.optional(),
      error: error.optional(),
    });
    server.registerTool(
      name,
      {
        description: `${description} ${api?.mode === "autodesk" ? "Contexto Autodesk individual; ejecución solo tras aprobación web verificable." : "Ensayo sintético sin datos Autodesk reales."}`,
        inputSchema: input,
        outputSchema: output,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: name === "execute_issue_plan",
          idempotentHint: readOnly,
          openWorldHint: api?.mode === "autodesk",
        },
      },
      async (args) => {
        let value: z.infer<typeof output>;
        try {
          if (!api) throw new ContractFailure("authentication_required");
          const parsed = data.safeParse(await run(args));
          value = parsed.success
            ? { mode: api.mode ?? "fixtures", ok: true, data: parsed.data }
            : {
                mode: api.mode ?? "fixtures",
                ok: false,
                error: {
                  code: "invalid_api_response",
                  message: messages.invalid_api_response,
                },
              };
        } catch (cause) {
          const code =
            cause instanceof ContractFailure
              ? cause.code
              : cause instanceof ExecutionDisabled
                ? "human_approval_not_available"
                : "upstream_unavailable";
          value = {
            mode: api ? (api.mode ?? "fixtures") : "disabled",
            ok: false,
            error: { code, message: messages[code] },
          };
        }
        return {
          isError: !value.ok,
          structuredContent: value,
          content: [{ type: "text" as const, text: JSON.stringify(value) }],
        };
      },
    );
  }
  const path = (a: { hub_id: string; project_id: string }) =>
    `/projects/hubs/${encodeURIComponent(a.hub_id)}/${encodeURIComponent(a.project_id)}`;
  const get = (url: string) => api!.request("GET", url);
  const withReview = (value: unknown) => {
    const parsed = planReview.safeParse(value);
    if (!parsed.success) throw new ContractFailure("invalid_api_response");
    const plan = parsed.data;
    return api?.mode === "autodesk"
      ? {
          ...plan,
          review_url: `${(api.reviewOrigin ?? "http://127.0.0.1:5173").replace(/\/$/, "")}/?review_plan=${encodeURIComponent(plan.id)}`,
        }
      : plan;
  };
  tool(
    "list_hubs",
    "Lista hubs compatibles, avisos de exclusión y listado incompleto.",
    z.object({}).strict(),
    resources,
    true,
    () => get("/projects/hubs"),
  );
  tool(
    "list_projects",
    "Lista proyectos de un hub explícito; conserva sus identificadores.",
    z.object({ hub_id: id }).strict(),
    resources,
    true,
    (a) => get(`/projects/hubs/${encodeURIComponent(a.hub_id)}`),
  );
  tool(
    "get_project_context",
    "Valida proyecto y consulta capacidades; no persiste selección.",
    z.object(context).strict(),
    z.object({
      selection: z.object({ hub: resource, project: resource }),
      capabilities,
    }),
    true,
    async (a) => ({
      selection: await get(path(a)),
      capabilities: await get(`${path(a)}/capabilities`),
    }),
  );
  tool(
    "list_members",
    "Consulta miembros; aparecer en la lista no demuestra que sean asignables.",
    z.object(context).strict(),
    z.object({
      items: z.array(
        z.object({
          id,
          autodesk_id: id.nullable(),
          name: z.string(),
          email: z.string().nullable(),
          company_id: id.nullable(),
          company_name: z.string().nullable(),
          status: z.string(),
          project_admin: z.boolean().nullable(),
          account_admin: z.boolean().nullable(),
        }),
      ),
    }),
    true,
    (a) => get(`${path(a)}/members`),
  );
  tool(
    "list_issue_types",
    "Devuelve subtipos activos por ID y nombre completo.",
    z.object(context).strict(),
    z.object({ items: z.array(resource) }),
    true,
    async (a) => ({ items: await get(`${path(a)}/issue-types`) }),
  );
  tool(
    "list_issues",
    "Consulta una página de incidencias; solicita la siguiente con offset, no con una URL.",
    z
      .object({
        ...context,
        offset: z.number().int().min(0).max(100000).default(0),
      })
      .strict(),
    z.object({
      results: z.array(issue),
      pagination: z.object({
        offset: z.number().int().nonnegative(),
        limit: z.number().int().min(1).max(200),
        totalResults: z.number().int().min(0).max(100000),
      }),
    }),
    true,
    (a) => get(`${path(a)}/issues?offset=${a.offset}`),
  );
  tool(
    "get_issue",
    "Consulta una incidencia del proyecto explícito.",
    z.object({ ...context, issue_id: id }).strict(),
    issue,
    true,
    (a) => get(`${path(a)}/issues/${encodeURIComponent(a.issue_id)}`),
  );
  tool(
    "prepare_issue",
    "Solicita una preparación, sin crear ni actualizar una incidencia. La API decide permisos y campos admitidos.",
    z.object({ ...context, request: planInput }).strict(),
    planReview,
    false,
    async (a) =>
      withReview(
        await api!.request("POST", `${path(a)}/issue-plans`, a.request),
      ),
  );
  tool(
    "review_issue_plan",
    "Recupera la preparación y su resultado guardado; nunca la reenvía.",
    z.object({ plan_id: id }).strict(),
    planReview,
    true,
    async (a) =>
      withReview(
        await get(`/projects/issue-plans/${encodeURIComponent(a.plan_id)}`),
      ),
  );
  // La API exige la aprobación web guardada; un argumento del modelo no la sustituye.
  tool(
    "execute_issue_plan",
    "Ejecuta una revisión aprobada en review_url. Si falta aprobación, no escribe. No admite confirmed. Reenvíos consultan el resultado guardado; resultados inciertos no se reintentan.",
    z.object({ plan_id: id }).strict(),
    writeResult,
    false,
    async (a) => {
      if (api?.mode !== "autodesk") throw new ExecutionDisabled();
      return api.request(
        "POST",
        `/projects/issue-plans/${encodeURIComponent(a.plan_id)}/execute`,
      );
    },
  );
  tool(
    "get_import_result",
    "Consulta un lote ya preparado. No admite archivo, URL ni ruta del ordenador; no aprueba ni ejecuta filas.",
    z.object({ import_id: id }).strict(),
    importReview,
    true,
    (a) => get(`/projects/imports/${encodeURIComponent(a.import_id)}`),
  );
}
class ExecutionDisabled extends Error {}
