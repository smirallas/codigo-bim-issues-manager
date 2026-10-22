import { describe, expect, it, vi } from "vitest";
import { issueRequest } from "./issues";

const issue = {
  id: "uuid",
  title: "Example",
  description: null,
  status: "open",
  issueSubtypeId: null,
  assignedTo: null,
  assignedToType: null,
  updatedAt: null,
  published: true,
  deleted: false,
  permittedActions: [],
  permittedAttributes: [],
  permittedStatuses: [],
};
const response = (value: unknown, status = 200) =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(value), { status }));
describe("issue contracts and write transport", () => {
  it("queries a paginated page without inventing an empty collection", async () => {
    const value = {
      results: [issue],
      pagination: { offset: 25, limit: 25, totalResults: 26 },
    };
    await expect(
      issueRequest(
        "list",
        "hubs/h/p/issues?offset=25",
        undefined,
        undefined,
        undefined,
        response(value),
      ),
    ).resolves.toEqual(value);
  });
  it.each([
    {},
    { results: [], pagination: {} },
    {
      results: [{ ...issue, permittedAttributes: true }],
      pagination: { offset: 0, limit: 25, totalResults: 1 },
    },
  ])("rejects malformed issue responses", async (value) => {
    await expect(
      issueRequest(
        "list",
        "hubs/h/p/issues",
        undefined,
        undefined,
        undefined,
        response(value),
      ),
    ).rejects.toThrow("no es válida");
  });
  it("sends the immutable plan reference with CSRF, never an edited execution payload", async () => {
    const fetcher = response({
      state: "succeeded",
      verified: true,
      issue_id: "uuid",
      issue,
      error: null,
    });
    await issueRequest(
      "execute",
      "issue-plans/plan/execute",
      undefined,
      undefined,
      "synthetic-csrf",
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/projects/issue-plans/plan/execute",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: undefined,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "synthetic-csrf",
        },
      }),
    );
  });
  it("preserves an uncertain write instead of retrying", async () => {
    const fetcher = response({
      state: "uncertain",
      verified: false,
      issue_id: null,
      issue: null,
      error: "issue_write_uncertain",
    });
    expect(
      (
        await issueRequest(
          "execute",
          "issue-plans/p/execute",
          undefined,
          undefined,
          "csrf",
          fetcher,
        )
      ).state,
    ).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not turn an APS denial into an empty list", async () => {
    await expect(
      issueRequest(
        "list",
        "hubs/h/p/issues",
        undefined,
        undefined,
        undefined,
        response({ error: "aps_issues_access_denied" }, 403),
      ),
    ).rejects.toThrow("denegado");
  });
  it("discards a response after project cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      issueRequest(
        "types",
        "hubs/h/p/issue-types",
        controller.signal,
        undefined,
        undefined,
        response([]),
      ),
    ).rejects.toThrow();
  });
});
