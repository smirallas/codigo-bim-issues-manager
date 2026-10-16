import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** Expone solo el catálogo vacío de E00; no registra herramientas de negocio. */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "issue-manager-e00", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  // El SDK registra este manejador al añadir la primera herramienta; E00 no tiene ninguna.
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [],
  }));
  return server;
}
