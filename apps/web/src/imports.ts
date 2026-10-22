import { IssueHttpError, isPlanReview, type PlanReview } from "./issues";

export type ImportReview = {
  id: string;
  hub_id: string;
  project_id: string;
  project_name: string;
  expires_at: number;
  approved_at: number | null;
  rows: {
    row: number;
    values: Record<string, string>;
    error: string | null;
    plan: PlanReview | null;
  }[];
};

function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function validReview(data: unknown): data is ImportReview {
  if (
    !record(data) ||
    !["id", "hub_id", "project_id", "project_name"].every(
      (k) => typeof data[k] === "string",
    ) ||
    typeof data.expires_at !== "number" ||
    (data.approved_at !== null && typeof data.approved_at !== "number") ||
    !Array.isArray(data.rows) ||
    data.rows.length > 25
  )
    return false;
  return data.rows.every(
    (row) =>
      record(row) &&
      Number.isInteger(row.row) &&
      record(row.values) &&
      Object.values(row.values).every((v) => typeof v === "string") &&
      (row.error === null || typeof row.error === "string") &&
      (row.plan === null || isPlanReview(row.plan)),
  );
}

/** Cada llamada ejecuta como máximo una fila; no reintenta tras una respuesta perdida. */
export async function importRequest(
  path: string,
  csrf?: string,
  file?: File,
  fetcher: typeof fetch = fetch,
): Promise<ImportReview> {
  const response = await fetcher(`/api/projects/${path}`, {
    method: csrf ? "POST" : "GET",
    credentials: "same-origin",
    headers: csrf
      ? { "X-CSRF-Token": csrf, "Content-Type": "application/octet-stream" }
      : undefined,
    body: file,
    signal: AbortSignal.timeout(file ? 300000 : 90000),
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw new IssueHttpError(
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : "excel_invalid",
      response.status,
    );
  if (!validReview(data))
    throw new Error("La respuesta de importación no es válida.");
  return data;
}

const errors: Record<string, string> = {
  excel_columns_required:
    "Utiliza las seis columnas de la plantilla, en el mismo orden.",
  excel_sheet_required:
    "El archivo debe tener una sola hoja llamada Incidencias.",
  excel_dimensions_limit: "Máximo 25 filas y seis columnas de la plantilla.",
  excel_size_limit:
    "El archivo supera 1 MiB o su contenido descomprimido supera el límite.",
  excel_active_content: "No se admiten macros ni enlaces externos del libro.",
  excel_formula_or_link:
    "La fila contiene una fórmula, un error o un enlace. Sustitúyelo por un valor.",
  excel_cell_invalid: "La celda no contiene texto o fecha admitidos.",
  excel_date_invalid: "Fecha inválida: usa una fecha Excel o YYYY-MM-DD.",
  excel_row_invalid:
    "Revisa título (1–100), descripción (máximo 1.000) y estado.",
  excel_type_not_unique:
    "El tipo no identifica una única opción activa. Copia categoría / subtipo de la consulta.",
  excel_assignee_not_unique:
    "No se encuentra un responsable único. Utiliza su correo o Autodesk ID.",
  excel_approval_required:
    "Aprueba la revisión completa antes de enviar filas.",
  excel_no_valid_rows: "No hay filas válidas para enviar.",
  excel_row_blocked: "Esta fila está bloqueada y no se enviará.",
  excel_empty: "El archivo no contiene filas de datos.",
  excel_invalid:
    "No se puede leer este archivo XLSX. Descarga la plantilla y prueba con datos simples.",
};
export function importMessage(code: string): string | undefined {
  return errors[code];
}
