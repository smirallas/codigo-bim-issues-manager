import { once } from "node:events";
import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpApp } from "./http.js";

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

describe("E00 Streamable HTTP", () => {
  it("connects the SDK client and lists an empty catalog", async () => {
    const client = new Client({ name: "e00-test", version: "0.0.0" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)),
      );
      expect(client.getServerVersion()?.name).toBe("issue-manager-e00");
      expect((await client.listTools()).tools).toEqual([]);
      await client.ping();
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
