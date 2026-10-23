import { z } from "zod";

// Los identificadores son datos, nunca fragmentos de URL, rutas ni identidades.
export const id = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_.-]+$/)
  .refine((value) => value !== "." && value !== "..", "Invalid path segment");
export const context = { hub_id: id, project_id: id };
export const resource = z.object({ id, name: z.string() });
export const resources = z.object({
  items: z.array(resource),
  excluded: z.number().int().nonnegative(),
  incomplete: z.boolean(),
});
export const capabilities = z.object({
  user_id: id,
  project_admin: z.boolean(),
  permission_levels: z.array(z.string()),
  can_create: z.boolean(),
  assignment: z.enum(["all", "same_company", "unavailable"]),
  permitted_actions: z.array(z.string()),
  permitted_attributes: z.array(z.string()),
  permitted_statuses: z.array(z.string()),
});
export const issue = z.object({
  id,
  displayId: z.number().int().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: z.string(),
  assignedTo: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});
export const planInput = z
  .object({
    operation: z.enum(["create", "update"]),
    issue_id: id.optional(),
    title: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(1000).optional(),
    status: z.string().min(1).max(100).optional(),
    subtype_id: id.optional(),
    assignee_id: id.optional(),
    due_date: z.string().date().optional(),
  })
  .strict();
export const writeResult = z.object({
  state: z.enum(["succeeded", "rejected", "uncertain", "running"]),
  issue_id: id.nullable(),
  issue: issue.nullable(),
  verified: z.boolean(),
  error: z.string().nullable(),
});
export const planReview = z.object({
  id,
  expires_at: z.number().int(),
  state: z.string(),
  content: z.object({
    hub_id: id,
    project_id: id,
    project_name: z.string(),
    // FastAPI conserva los campos opcionales como null en la revisión guardada.
    // El esquema de entrada de prepare_issue sigue siendo estricto y separado.
    request: planInput.extend({
      issue_id: planInput.shape.issue_id.nullable(),
      title: planInput.shape.title.nullable(),
      description: planInput.shape.description.nullable(),
      status: planInput.shape.status.nullable(),
      subtype_id: planInput.shape.subtype_id.nullable(),
      assignee_id: planInput.shape.assignee_id.nullable(),
      due_date: planInput.shape.due_date.nullable(),
    }),
    // Solo campos del contrato público, nunca cuerpos arbitrarios del proveedor.
    payload: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      issueSubtypeId: id.optional(),
      assignedTo: id.optional(),
      assignedToType: z.literal("user").optional(),
      dueDate: z.string().optional(),
    }),
    before: issue.nullable(),
    assignee_name: z.string().nullable(),
    subtype_name: z.string().nullable(),
  }),
  result: writeResult.nullable(),
  content_digest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  approved_at: z.number().int().nullable().optional(),
  review_url: z.string().url().optional(),
});
export const importReview = z.object({
  id,
  hub_id: id,
  project_id: id,
  project_name: z.string(),
  expires_at: z.number().int(),
  approved_at: z.number().int().nullable(),
  rows: z
    .array(
      z.object({
        row: z.number().int().min(2),
        values: z.record(z.string()),
        error: z.string().nullable(),
        plan: planReview.nullable(),
      }),
    )
    .max(25),
});

/** Puerto de la API; la identidad viene del transporte, nunca de argumentos del modelo. */
export interface ContractApi {
  readonly mode?: "autodesk";
  readonly reviewOrigin?: string;
  request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<unknown>;
}
export class ContractFailure extends Error {
  constructor(
    public readonly code:
      | "resource_unavailable"
      | "plan_expired"
      | "fixture_limit"
      | "authentication_required"
      | "upstream_unavailable"
      | "human_approval_required"
      | "plan_changed_review_again"
      | "issue_changed_review_again"
      | "permission_denied"
      | "invalid_api_response",
  ) {
    super(code);
  }
}
