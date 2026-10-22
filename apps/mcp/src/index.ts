import { createHttpApp } from "./http.js";
import { contractApiForMode } from "./fixtures.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { installOAuth } from "./oauth.js";
import { installAuthClient } from "./auth-client.js";

const host = process.env.MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.MCP_PORT ?? "8001");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid MCP_PORT");
const mode = process.env.MCP_DATA_MODE ?? "disabled";
const allowedHosts = (
  process.env.MCP_ALLOWED_HOSTS ?? "127.0.0.1,localhost"
).split(",");
const shell = createMcpExpressApp({ allowedHosts });
const issuer = process.env.ISSUES_MCP_ISSUER ?? "http://127.0.0.1:8001";
const oauth =
  mode === "autodesk"
    ? await installOAuth(shell, {
        issuer,
        apiBaseUrl: process.env.API_BASE_URL ?? "http://127.0.0.1:8000",
        internalSecret: process.env.ISSUES_MCP_INTERNAL_SECRET ?? "",
        storageKey: process.env.MCP_STORAGE_KEY ?? "",
        storageFile: process.env.MCP_STORAGE_FILE ?? "./data/oauth.db",
        webOrigin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173",
        clients: [
          {
            client_id: "issues-manager-demo",
            redirect_uris: [`${issuer}/client/callback`],
          },
          ...(process.env.MCP_CLIENT_ID && process.env.MCP_CLIENT_REDIRECT_URI
            ? [
                {
                  client_id: process.env.MCP_CLIENT_ID,
                  redirect_uris: [process.env.MCP_CLIENT_REDIRECT_URI],
                },
              ]
            : []),
        ],
      })
    : undefined;
const app = createHttpApp({
  app: shell,
  authenticated: oauth,
  contractApi: mode === "autodesk" ? undefined : contractApiForMode(mode),
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
if (oauth) {
  installAuthClient(app, issuer, oauth.store);
  app.use(oauth.provider.callback());
}
const server = app.listen(port, host, () => {
  console.info(
    `Issues Manager MCP (${process.env.MCP_DATA_MODE ?? "disabled"}): http://${host}:${port}/mcp`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => oauth?.store.close());
    server.closeAllConnections();
  });
}
