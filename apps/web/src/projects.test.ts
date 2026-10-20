import { describe, expect, it, vi } from "vitest";
import { queryProjects } from "./projects";

const hub = { id: "b.hub", name: "Hub sintético" };
const project = { id: "b.project", name: "Proyecto sintético" };

describe("project queries", () => {
  it("retains identifiers and uses the local cookie, never an APS token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [project], excluded: 1, incomplete: false }),
        ),
      );
    await expect(
      queryProjects(hub.id, undefined, undefined, fetcher),
    ).resolves.toEqual({ items: [project], excluded: 1, incomplete: false });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/projects/hubs/b.hub",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers");
  });

  it("accepts a genuinely empty collection", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [], excluded: 0, incomplete: false }),
        ),
      );
    await expect(
      queryProjects(undefined, undefined, undefined, fetcher),
    ).resolves.toEqual({ items: [], excluded: 0, incomplete: false });
  });

  it("keeps regional warnings alongside the resources that are accessible", async () => {
    const data = { items: [hub], excluded: 0, incomplete: true };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(data)));
    await expect(
      queryProjects(undefined, undefined, undefined, fetcher),
    ).resolves.toEqual(data);
  });

  it.each([401, 403, 429, 502])(
    "does not turn HTTP %s into an empty list",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: "aps_access_denied" }), {
          status,
        }),
      );
      await expect(
        queryProjects(undefined, undefined, undefined, fetcher),
      ).rejects.toThrow("Autodesk ha denegado");
    },
  );

  it("validates the selected context returned by the server", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ hub, project })));
    await expect(
      queryProjects(hub.id, project.id, undefined, fetcher),
    ).resolves.toEqual({ hub, project });
  });

  it("rejects a selection for a different project", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ hub, project })));
    await expect(
      queryProjects(hub.id, "b.other", undefined, fetcher),
    ).rejects.toThrow();
  });

  it("rejects malformed success payloads", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [{ token: "not-a-project" }] })),
      );
    await expect(
      queryProjects(undefined, undefined, undefined, fetcher),
    ).rejects.toThrow();
  });

  it("propagates cancellation to prevent stale selection results", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [], excluded: 0, incomplete: false }),
        ),
      );
    await queryProjects(undefined, undefined, controller.signal, fetcher);
    controller.abort();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
