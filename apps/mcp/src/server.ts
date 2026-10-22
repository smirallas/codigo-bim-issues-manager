import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";
import type { ContractApi } from "./contracts.js";

/** Compone el catálogo sobre el puerto sintético o el contexto individual validado de E07. */
export function createMcpServer(api?: ContractApi): McpServer {
  const server = new McpServer(
    { name: "issue-manager", version: "0.7.0" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, api);
  return server;
}
