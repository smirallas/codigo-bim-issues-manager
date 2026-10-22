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
  type ContractApi,
} from "./contracts.js";

const error = z.object({ code: z.string(), message: z.string() });
const messages: Record<string, string> = {
  authentication_required:
    "El acceso a datos reales requiere la autenticación de E07. Para ensayar usa MCP_DATA_MODE=fixtures; solo contiene datos sintéticos.",
  resource_unavailable:
    "El recurso no está disponible en este contexto sintético.",
  plan_expired:
    "La preparación sintética ha caducado. Prepara otra y revisa su contenido.",
  fixture_limit: "Se ha alcanzado el límite de preparaciones sintéticas.",
  upstream_unavailable:
    "No se ha podido consultar el contrato de la API. No se reintenta automáticamente.",
  invalid_api_response: "La respuesta no cumple el contrato esperado.",
  human_approval_not_available:
    "E06 no ejecuta incidencias. La aprobación humana verificable y la ejecución MCP quedan para E08.",
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
      mode: z.enum(["disabled", "fixtures"]),
      ok: z.boolean(),
      data: data.optional(),
      error: error.optional(),
    });
    server.registerTool(
      name,
      {
        description: `${description} E06: ensayo sintético; no accede a Autodesk real.`,
        inputSchema: input,
        outputSchema: output,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          idempotentHint: readOnly,
          openWorldHint: false,
        },
      },
      async (args) => {
        let value: z.infer<typeof output>;
        try {
          if (!api) throw new ContractFailure("authentication_required");
          const parsed = data.safeParse(await run(args));
          value = parsed.success
            ? { mode: "fixtures", ok: true, data: parsed.data }
            : {
                mode: "fixtures",
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
            mode: api ? "fixtures" : "disabled",
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
    (a) => api!.request("POST", `${path(a)}/issue-plans`, a.request),
  );
  tool(
    "review_issue_plan",
    "Recupera la preparación y su resultado guardado; nunca la reenvía.",
    z.object({ plan_id: id }).strict(),
    planReview,
    true,
    (a) => get(`/projects/issue-plans/${encodeURIComponent(a.plan_id)}`),
  );
  // No enlazar al /execute web: E04 no registra aún aprobación humana independiente para MCP.
  tool(
    "execute_issue_plan",
    "Contrato reservado: siempre bloqueado en E06. No admite confirmed ni registra aprobación.",
    z.object({ plan_id: id }).strict(),
    z.object({}),
    false,
    async () => {
      throw new ExecutionDisabled();
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
