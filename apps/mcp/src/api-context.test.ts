import { afterEach, expect, it, vi } from "vitest";
import { authenticatedApi } from "./api-context.js";
const options = {
  issuer: "http://127.0.0.1:8001",
  apiBaseUrl: "http://api:8000",
  internalSecret: "synthetic-internal-".repeat(4),
};
const user = {
  subject: "user",
  connection: "conn",
  name: "Synthetic",
  expires_at: 9999999999,
  binding: "sealed",
};
afterEach(() => vi.unstubAllGlobals());
it("preserves missing human approval from the API and never calls its approval route", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: "human_approval_required" }), {
      status: 409,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const api = authenticatedApi(options, user);
  await expect(
    api.request("POST", "/projects/issue-plans/plan/execute"),
  ).rejects.toThrow("human_approval_required");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    api.request("POST", "/projects/issue-plans/plan/approve"),
  ).rejects.toThrow("resource_unavailable");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
