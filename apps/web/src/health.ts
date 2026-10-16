export type ApiStatus = "loading" | "ok" | "unavailable";

/** Consulta únicamente la salud de nuestra API, sin identidad ni datos APS. */
export async function checkApiHealth(
  request: typeof fetch = fetch,
): Promise<Exclude<ApiStatus, "loading">> {
  try {
    const response = await request("/api/health", {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return "unavailable";
    const body: unknown = await response.json();
    return typeof body === "object" &&
      body !== null &&
      "status" in body &&
      body.status === "ok" &&
      "service" in body &&
      body.service === "api"
      ? "ok"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}
