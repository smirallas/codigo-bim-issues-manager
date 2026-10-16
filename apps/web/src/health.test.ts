import { describe, expect, it, vi } from "vitest";
import { checkApiHealth } from "./health";

describe("API health", () => {
  it("uses the same-origin proxy and checks the response contract", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: "ok", service: "api" }));
    expect(await checkApiHealth(request)).toBe("ok");
    expect(request).toHaveBeenCalledWith("/api/health", expect.any(Object));
  });

  it.each([
    Response.json({ status: "ok", service: "other" }),
    Response.json({ status: "error" }, { status: 503 }),
    new Response("invalid JSON"),
  ])("reports an unusable API response", async (response) => {
    expect(
      await checkApiHealth(vi.fn<typeof fetch>().mockResolvedValue(response)),
    ).toBe("unavailable");
  });

  it("reports a connection failure", async () => {
    expect(
      await checkApiHealth(
        vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
      ),
    ).toBe("unavailable");
  });
});
