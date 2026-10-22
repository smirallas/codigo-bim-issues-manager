import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(
  new URL("../apps/mcp/package.json", import.meta.url),
);
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js"))
    .href
);
const { StreamableHTTPClientTransport } = await import(
  pathToFileURL(
    require.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ).href
);

// Solo puertos locales; nunca consulta Autodesk ni envía escrituras de negocio.
for (const url of [
  "http://127.0.0.1:8000/ready",
  "http://127.0.0.1:5173/api/ready",
  "http://127.0.0.1:8001/ready",
]) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, url);
  assert.equal((await response.json()).status, "ready", url);
  console.info(`OK ${url}`);
}
const html = await fetch("http://127.0.0.1:5173").then((r) => r.text());
assert.match(html, /Issues Manager/);
const challenge = await fetch("http://127.0.0.1:8001/mcp", { method: "POST" });
if (challenge.status === 401) {
  assert.match(challenge.headers.get("www-authenticate"), /resource_metadata/);
  const metadata = await fetch(
    "http://127.0.0.1:8001/.well-known/oauth-protected-resource/mcp",
  ).then((r) => r.json());
  assert.equal(metadata.resource, "http://127.0.0.1:8001/mcp");
  assert.deepEqual(metadata.scopes_supported, ["issues:access"]);
  console.info(
    "OK OAuth MCP: anonymous access rejected, discovery and scope available; no Autodesk call",
  );
} else {
  const client = new Client({
    name: "issue-manager-e00-smoke",
    version: "0.0.0",
  });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8001/mcp")),
    );
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 11);
    assert.ok(tools.some((tool) => tool.name === "prepare_issue"));
    const result = await client.callTool({
      name: "execute_issue_plan",
      arguments: { plan_id: "demo-smoke" },
    });
    assert.equal(result.isError, true);
    console.info(
      "OK Streamable HTTP: initialize + tools/list (11), execution blocked",
    );
  } finally {
    await client.close();
  }
}
