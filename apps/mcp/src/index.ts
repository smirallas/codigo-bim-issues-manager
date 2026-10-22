import { createHttpApp } from "./http.js";
import { contractApiForMode } from "./fixtures.js";

const host = process.env.MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.MCP_PORT ?? "8001");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid MCP_PORT");
const app = createHttpApp({
  contractApi: contractApiForMode(process.env.MCP_DATA_MODE ?? "disabled"),
  fixtureDemo: process.env.MCP_DATA_MODE === "fixtures",
  apiBaseUrl: process.env.API_BASE_URL ?? "http://127.0.0.1:8000",
  allowedHosts: (process.env.MCP_ALLOWED_HOSTS ?? "127.0.0.1,localhost").split(
    ",",
  ),
  allowedOrigins: (
    process.env.MCP_ALLOWED_ORIGINS ??
    "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8001,http://localhost:8001"
  ).split(","),
});
const server = app.listen(port, host, () => {
  console.info(
    `Issues Manager MCP (${process.env.MCP_DATA_MODE ?? "disabled"}): http://${host}:${port}/mcp`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
