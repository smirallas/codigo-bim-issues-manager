import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";
import type { ContractApi } from "./contracts.js";

/** E06 publica contratos; ningún adaptador conecta todavía con Autodesk. */
export function createMcpServer(api?: ContractApi): McpServer {
  const server = new McpServer(
    { name: "issue-manager", version: "0.6.0" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, api);
  return server;
}
