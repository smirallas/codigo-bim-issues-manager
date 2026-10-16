import { createHttpApp } from "./http.js";

const host = process.env.MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.MCP_PORT ?? "8001");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid MCP_PORT");
const app = createHttpApp({
  apiBaseUrl: process.env.API_BASE_URL ?? "http://127.0.0.1:8000",
  allowedHosts: (process.env.MCP_ALLOWED_HOSTS ?? "127.0.0.1,localhost").split(
    ",",
  ),
  allowedOrigins: (
    process.env.MCP_ALLOWED_ORIGINS ??
    "http://127.0.0.1:5173,http://localhost:5173"
  ).split(","),
});
const server = app.listen(port, host, () => {
  console.info(`Issues Manager E00 MCP: http://${host}:${port}/mcp`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
