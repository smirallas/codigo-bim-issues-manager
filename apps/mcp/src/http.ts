import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Express, RequestHandler } from "express";
import { createMcpServer } from "./server.js";
import type { ContractApi } from "./contracts.js";
import { demoHtml } from "./demo.js";

export interface HttpOptions {
  apiBaseUrl: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  contractApi?: ContractApi;
  fixtureDemo?: boolean;
}

/** Transporte sin sesión. Solo /ready consulta la API real; los contratos son sintéticos. */
export function createHttpApp(options: HttpOptions): Express {
  const app = createMcpExpressApp({ allowedHosts: options.allowedHosts });
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (
      req.headers.origin &&
      !options.allowedOrigins.includes(req.headers.origin)
    ) {
      res.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "mcp" });
  });
  if (options.fixtureDemo && options.contractApi)
    app.get("/demo", (_req, res) => {
      res.set("Cache-Control", "no-store").type("html").send(demoHtml);
    });
  app.get("/ready", async (_req, res) => {
    try {
      const response = await fetch(new URL("/ready", options.apiBaseUrl), {
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("API unavailable");
      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("status" in body) ||
        body.status !== "ready"
      ) {
        throw new Error("Invalid readiness response");
      }
      res.json({ status: "ready", checks: { api: "ok" } });
    } catch {
      res.status(503).json({ status: "not_ready", checks: { api: "error" } });
    }
  });

  const handleMcp: RequestHandler = async (req, res) => {
    const server = createMcpServer(options.contractApi);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(500).json({ error: "mcp_request_failed" });
      await server.close();
    }
  };
  app.post("/mcp", handleMcp);
  app.get("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").end();
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").end();
  });
  return app;
}
