import { once } from "node:events";
import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpApp } from "./http.js";
import { createFixtureApi } from "./fixtures.js";

const servers: Server[] = [];
async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let baseUrl: string;
let apiAvailable: boolean;
beforeEach(async () => {
  apiAvailable = true;
  const apiBaseUrl = await listen(
    createServer((_req, res) => {
      res.writeHead(apiAvailable ? 200 : 503, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ status: apiAvailable ? "ready" : "not_ready" }));
    }),
  );
  baseUrl = await listen(
    createServer(
      createHttpApp({
        apiBaseUrl,
        allowedHosts: ["127.0.0.1"],
        allowedOrigins: ["http://127.0.0.1:5173"],
      }),
    ),
  );
});
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

describe("Streamable HTTP", () => {
  it("connects the SDK client and lists the E06 contracts with access disabled", async () => {
    const client = new Client({ name: "e00-test", version: "0.0.0" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)),
      );
      expect(client.getServerVersion()?.name).toBe("issue-manager");
      expect((await client.listTools()).tools).toHaveLength(11);
      const result = await client.callTool({
        name: "list_hubs",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        mode: "disabled",
        error: { code: "authentication_required" },
      });
      await client.ping();
    } finally {
      await client.close();
    }
  });

  it("calls fixture tools through HTTP without cookies, APS tokens or a transport session", async () => {
    const fixtureUrl = await listen(
      createServer(
        createHttpApp({
          apiBaseUrl: "http://127.0.0.1:1",
          allowedHosts: ["127.0.0.1"],
          allowedOrigins: [],
          contractApi: createFixtureApi(),
        }),
      ),
    );
    const client = new Client({ name: "fixture-http", version: "1" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${fixtureUrl}/mcp`)),
      );
      expect(
        (await client.callTool({ name: "list_hubs", arguments: {} }))
          .structuredContent,
      ).toMatchObject({
        mode: "fixtures",
        ok: true,
        data: { items: [{ id: "b.demo-hub" }] },
      });
      const prepared = await client.callTool({
        name: "prepare_issue",
        arguments: {
          hub_id: "b.demo-hub",
          project_id: "b.demo-project",
          request: {
            operation: "create",
            title: "Ensayo",
            status: "closed",
            subtype_id: "demo-subtype",
          },
        },
      });
      const plan = (prepared.structuredContent as { data: { id: string } })
        .data;
      expect(
        (
          await client.callTool({
            name: "review_issue_plan",
            arguments: { plan_id: plan.id },
          })
        ).isError,
      ).toBe(false);
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
    } finally {
      await client.close();
    }
  });

  it("negotiates the SDK v1 protocol without a transport session", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "fixture", version: "0" },
        },
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).result.protocolVersion).toBe("2025-11-25");
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("checks its API dependency and reports failure separately from liveness", async () => {
    expect((await fetch(`${baseUrl}/ready`)).status).toBe(200);
    apiAvailable = false;
    expect((await fetch(`${baseUrl}/ready`)).status).toBe(503);
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
  });

  it("rejects an unknown origin", async () => {
    expect(
      (
        await fetch(`${baseUrl}/mcp`, {
          method: "POST",
          headers: { Origin: "https://untrusted.example" },
        })
      ).status,
    ).toBe(403);
  });
  it("does not expose the fixture page in disabled mode", async () => {
    expect((await fetch(`${baseUrl}/demo`)).status).toBe(404);
  });

  it("rejects an unknown host", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      get(
        `${baseUrl}/health`,
        { headers: { Host: "untrusted.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      ).on("error", reject);
    });
    expect(status).toBe(403);
  });

  it.each(["GET", "DELETE"])(
    "does not open a %s stream or session",
    async (method) => {
      expect((await fetch(`${baseUrl}/mcp`, { method })).status).toBe(405);
    },
  );
});
