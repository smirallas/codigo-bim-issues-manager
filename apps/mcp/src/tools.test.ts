import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "./server.js";
import { contractApiForMode, createFixtureApi } from "./fixtures.js";
import { type ContractApi } from "./contracts.js";

const cleanups: Array<() => Promise<void>> = [];
async function connect(api?: ContractApi) {
  const server = createMcpServer(api),
    client = new Client({ name: "contract-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});
const context = { hub_id: "b.demo-hub", project_id: "b.demo-project" };
const input = {
  ...context,
  request: {
    operation: "create",
    title: "Ensayo",
    status: "closed",
    subtype_id: "demo-subtype",
  },
};
describe("E06 contracts", () => {
  it("declares schemas, effects and synthetic scope for every tool", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(new Set(tools.map((t) => t.name)).size).toBe(11);
    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description).toContain("sintético");
      expect(tool.annotations?.openWorldHint).toBe(false);
    }
    expect(
      tools.find((t) => t.name === "prepare_issue")?.annotations?.readOnlyHint,
    ).toBe(false);
  });
  it.each([
    ["list_hubs", {}, "items"],
    ["list_projects", { hub_id: context.hub_id }, "items"],
    ["get_project_context", context, "capabilities"],
    ["list_members", context, "items"],
    ["list_issue_types", context, "items"],
    ["list_issues", context, "pagination"],
    ["get_issue", { ...context, issue_id: "demo-issue" }, "title"],
    ["get_import_result", { import_id: "demo-import" }, "rows"],
  ] as const)(
    "returns validated synthetic data for %s",
    async (name, args, key) => {
      const client = await connect(createFixtureApi());
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        mode: "fixtures",
        ok: true,
        data: { [key]: expect.anything() },
      });
    },
  );
  it.each([
    ["list_hubs", { user_id: "other" }],
    ["list_projects", { hub_id: "https://evil.invalid/" }],
    ["list_issues", { ...context, offset: -1 }],
    ["list_issues", { ...context, offset: 0.5 }],
    ["get_issue", { ...context, issue_id: "../secret" }],
    ["get_issue", { ...context, issue_id: ".." }],
    [
      "prepare_issue",
      { ...input, request: { ...input.request, title: "x".repeat(101) } },
    ],
    [
      "prepare_issue",
      { ...input, request: { ...input.request, due_date: "2026-02-30" } },
    ],
    [
      "prepare_issue",
      { ...input, request: { ...input.request, confirmed: true } },
    ],
    ["execute_issue_plan", { plan_id: "demo", confirmed: true }],
    ["get_import_result", { import_id: "file:///private.xlsx" }],
  ] as const)(
    "rejects invalid or extra arguments before the adapter: %s",
    async (name, args) => {
      const request = vi.fn();
      const client = await connect({ request });
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("maps preparation to a fixed internal route and body without executing", async () => {
    const fixture = createFixtureApi();
    const request = vi.fn(fixture.request);
    const client = await connect({ request });
    const result = await client.callTool({
      name: "prepare_issue",
      arguments: input,
    });
    expect(result.isError).toBe(false);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "POST",
      "/projects/hubs/b.demo-hub/b.demo-project/issue-plans",
      input.request,
    );
  });
  it("retains immutable preparation and blocks execution without calling an API", async () => {
    const fixture = createFixtureApi();
    const request = vi.fn(fixture.request);
    const client = await connect({ request });
    const result = await client.callTool({
      name: "prepare_issue",
      arguments: input,
    });
    const plan = (result.structuredContent as { data: { id: string } }).data;
    const review = await client.callTool({
      name: "review_issue_plan",
      arguments: { plan_id: plan.id },
    });
    expect(review.structuredContent).toEqual(result.structuredContent);
    request.mockClear();
    for (let i = 0; i < 2; i++)
      expect(
        (
          await client.callTool({
            name: "execute_issue_plan",
            arguments: { plan_id: plan.id },
          })
        ).structuredContent,
      ).toMatchObject({
        ok: false,
        error: { code: "human_approval_not_available" },
      });
    expect(request).not.toHaveBeenCalled();
  });
  it("returns empty subsequent pages without looping", async () => {
    const client = await connect(createFixtureApi());
    expect(
      (
        await client.callTool({
          name: "list_issues",
          arguments: { ...context, offset: 100 },
        })
      ).structuredContent,
    ).toMatchObject({
      data: { results: [], pagination: { offset: 100, totalResults: 1 } },
    });
  });
  it("rejects an unknown project rather than borrowing context", async () => {
    const client = await connect(createFixtureApi());
    expect(
      (
        await client.callTool({
          name: "get_project_context",
          arguments: { ...context, project_id: "b.other" },
        })
      ).structuredContent,
    ).toMatchObject({ ok: false, error: { code: "resource_unavailable" } });
  });
  it("expires synthetic preparations and separates fixture instances", async () => {
    let now = 1000;
    const api = createFixtureApi(() => now);
    const client = await connect(api);
    const result = await client.callTool({
      name: "prepare_issue",
      arguments: input,
    });
    const plan = (result.structuredContent as { data: { id: string } }).data;
    await expect(
      createFixtureApi().request("GET", `/projects/issue-plans/${plan.id}`),
    ).rejects.toThrow("resource_unavailable");
    now = 1600;
    expect(
      (
        await client.callTool({
          name: "review_issue_plan",
          arguments: { plan_id: plan.id },
        })
      ).structuredContent,
    ).toMatchObject({ error: { code: "plan_expired" } });
  });
  it("does not leak upstream errors or unexpected fields", async () => {
    const client = await connect({
      request: async () => {
        throw new Error("secret upstream token");
      },
    });
    const result = await client.callTool({ name: "list_hubs", arguments: {} });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.structuredContent).toMatchObject({
      error: { code: "upstream_unavailable" },
    });
    const invalid = await connect({
      request: async () => ({ items: "wrong" }),
    });
    expect(
      (await invalid.callTool({ name: "list_hubs", arguments: {} }))
        .structuredContent,
    ).toMatchObject({ error: { code: "invalid_api_response" } });
    const extra = await connect({
      request: async () => ({
        items: [],
        excluded: 0,
        incomplete: false,
        access_token: "never-return",
      }),
    });
    expect(
      JSON.stringify(
        await extra.callTool({ name: "list_hubs", arguments: {} }),
      ),
    ).not.toContain("never-return");
  });
  it("has no live mode or implicit fixture fallback", () => {
    expect(contractApiForMode("disabled")).toBeUndefined();
    expect(contractApiForMode("fixtures")).toBeDefined();
    expect(() => contractApiForMode("live")).toThrow("Invalid MCP_DATA_MODE");
  });
});
