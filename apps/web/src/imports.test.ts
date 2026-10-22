import { describe, expect, it, vi } from "vitest";
import { importRequest } from "./imports";

const value = {
  id: "plan",
  hub_id: "hub",
  project_id: "project",
  project_name: "Synthetic",
  expires_at: 100,
  approved_at: null,
  rows: [
    {
      row: 2,
      values: { titulo: "Blocked" },
      error: "excel_row_invalid",
      plan: null,
    },
  ],
};
const response = (v: unknown, status = 200) =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(v), { status }));
describe("Excel transport", () => {
  it("uploads only file bytes with session and CSRF", async () => {
    const fetcher = response(value);
    const file = new File(["synthetic"], "example.xlsx");
    await expect(
      importRequest("hubs/h/p/imports", "csrf", file, fetcher),
    ).resolves.toEqual(value);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/projects/hubs/h/p/imports",
      expect.objectContaining({
        method: "POST",
        body: file,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-CSRF-Token": "csrf",
        },
      }),
    );
  });
  it("retrieves results with GET and no approval", async () => {
    const fetcher = response(value);
    await importRequest("imports/plan", undefined, undefined, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/projects/imports/plan",
      expect.objectContaining({ method: "GET", headers: undefined }),
    );
  });
  it("does not retry an ambiguous request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("Lost response"));
    await expect(
      importRequest("imports/plan/rows/2/execute", "csrf", undefined, fetcher),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { ...value, rows: [{}] },
    { ...value, rows: [{ ...value.rows[0], plan: { id: "incomplete" } }] },
  ])("rejects incomplete responses", async (v) => {
    await expect(
      importRequest("imports/plan", undefined, undefined, response(v)),
    ).rejects.toThrow("no es válida");
  });
  it("preserves a provider rejection code", async () => {
    await expect(
      importRequest(
        "imports/plan/approve",
        "csrf",
        undefined,
        response({ error: "plan_expired" }, 409),
      ),
    ).rejects.toMatchObject({ code: "plan_expired", status: 409 });
  });
});
