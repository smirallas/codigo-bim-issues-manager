import { randomUUID } from "node:crypto";
import { ContractFailure, planInput, type ContractApi } from "./contracts.js";

const root = "/projects/hubs/b.demo-hub/b.demo-project";
const hub = { id: "b.demo-hub", name: "Hub sintético · sin Autodesk" };
const project = { id: "b.demo-project", name: "Proyecto sintético MCP" };
const issue = {
  id: "demo-issue",
  displayId: 1,
  title: "Revisar hueco · ejemplo sintético",
  description: "Datos de ensayo, no pertenecen a un proyecto Autodesk.",
  status: "closed",
  assignedTo: null,
  dueDate: null,
};

/** Doble de la API interna para ensayar contratos. No hace peticiones de red. */
export function createFixtureApi(
  now: () => number = () => Math.floor(Date.now() / 1000),
): ContractApi {
  const plans = new Map<
    string,
    { expires_at: number; [key: string]: unknown }
  >();
  return {
    async request(method, path, body) {
      if (method === "GET") {
        if (path === "/projects/hubs")
          return { items: [hub], excluded: 0, incomplete: false };
        if (path === `/projects/hubs/${hub.id}`)
          return { items: [project], excluded: 0, incomplete: false };
        if (path === root) return { hub, project };
        if (path === `${root}/capabilities`)
          return {
            user_id: "demo-user",
            project_admin: false,
            permission_levels: ["view"],
            can_create: false,
            assignment: "unavailable",
            permitted_actions: [],
            permitted_attributes: [],
            permitted_statuses: [],
          };
        if (path === `${root}/members`)
          return {
            items: [
              {
                id: "demo-member",
                autodesk_id: "demo-user",
                name: "Persona de ejemplo",
                email: "demo@example.invalid",
                company_id: null,
                company_name: null,
                status: "active",
                project_admin: false,
                account_admin: false,
              },
            ],
          };
        if (path === `${root}/issue-types`)
          return [{ id: "demo-subtype", name: "General / General" }];
        if (path === `${root}/issues/${issue.id}`) return issue;
        if (path.startsWith(`${root}/issues?offset=`)) {
          const offset = Number(path.split("=")[1]);
          return {
            results: offset === 0 ? [issue] : [],
            pagination: { offset, limit: 100, totalResults: 1 },
          };
        }
        if (path === "/projects/imports/demo-import")
          return {
            id: "demo-import",
            hub_id: hub.id,
            project_id: project.id,
            project_name: project.name,
            expires_at: now() + 600,
            approved_at: null,
            rows: [
              {
                row: 2,
                values: { titulo: "" },
                error: "missing_title",
                plan: null,
              },
            ],
          };
        if (path.startsWith("/projects/issue-plans/")) {
          const value = plans.get(path.slice("/projects/issue-plans/".length));
          if (!value) throw new ContractFailure("resource_unavailable");
          if (value.expires_at <= now())
            throw new ContractFailure("plan_expired");
          return value;
        }
      }
      if (method === "POST" && path === `${root}/issue-plans`) {
        // La fixture ilustra el contrato, no reproduce el validador ni acredita permisos APS.
        const request = planInput.parse(body);
        for (const [key, value] of plans)
          if (value.expires_at <= now()) plans.delete(key);
        if (plans.size >= 100) throw new ContractFailure("fixture_limit");
        const value = {
          id: `demo-${randomUUID()}`,
          expires_at: now() + 600,
          state: "prepared",
          content: {
            hub_id: hub.id,
            project_id: project.id,
            project_name: project.name,
            request,
            payload: {},
            before: null,
            assignee_name: null,
            subtype_name: null,
          },
          result: null,
        };
        plans.set(value.id, value);
        return value;
      }
      throw new ContractFailure("resource_unavailable");
    },
  };
}

/** Fallar al arrancar ante modos desconocidos evita activar una integración por error. */
export function contractApiForMode(mode: string): ContractApi | undefined {
  if (mode === "disabled") return undefined;
  if (mode === "fixtures") return createFixtureApi();
  throw new Error("Invalid MCP_DATA_MODE: use disabled or fixtures");
}
