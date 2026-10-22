import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { jwtVerify } from "jose";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { installOAuth, MCP_SCOPE } from "./oauth.js";
import { createHttpApp } from "./http.js";
import { OAuthStore } from "./oauth-store.js";

const servers: Server[] = [];
let origin: string;
let oauth: Awaited<ReturnType<typeof installOAuth>>;
let connected: boolean;
let user: string;
let businessRequests: number;
async function listen(server: Server) {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(async () => {
  connected = true;
  user = "user-one";
  businessRequests = 0;
  const apiBaseUrl = await listen(
    createServer(async (req, res) => {
      if (!connected) {
        res.writeHead(401).end();
        return;
      }
      res.setHeader("content-type", "application/json");
      if (req.url === "/mcp/bind")
        res.end(
          JSON.stringify({
            subject: user,
            connection: `connection-${user}`,
            name: "Persona sintética",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            binding: `sealed-${user}`,
          }),
        );
      else if (req.url === "/mcp-api/projects/mcp-identity")
        res.end(JSON.stringify({ status: "connected" }));
      else {
        const { payload } = await jwtVerify(
          (req.headers.authorization ?? "").slice(7),
          new TextEncoder().encode("synthetic-internal-key-".repeat(3)),
          { issuer: origin, audience: "issues-manager-api" },
        );
        const owner = String(payload.binding).replace("sealed-", "");
        businessRequests++;
        res.end(
          JSON.stringify({
            items: [{ id: owner, name: `Hub de ${owner}` }],
            excluded: 0,
            incomplete: false,
          }),
        );
      }
    }),
  );
  const app = createMcpExpressApp({ allowedHosts: ["127.0.0.1"] });
  origin = await listen(createServer(app));
  oauth = await installOAuth(app, {
    issuer: origin,
    apiBaseUrl,
    internalSecret: "synthetic-internal-key-".repeat(3),
    storageKey: "synthetic-storage-key-".repeat(3),
    storageFile: ":memory:",
    webOrigin: "http://127.0.0.1:5173",
    clients: [
      { client_id: "test-client", redirect_uris: [`${origin}/callback`] },
    ],
  });
  createHttpApp({
    app,
    apiBaseUrl,
    allowedHosts: ["127.0.0.1"],
    allowedOrigins: [origin],
    authenticated: oauth,
  });
  app.use(oauth.provider.callback());
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
  oauth?.store.close();
});

async function begin(extra: Record<string, string> = {}) {
  const verifier = "v".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: "test-client",
    redirect_uri: `${origin}/callback`,
    response_type: "code",
    scope: MCP_SCOPE,
    resource: `${origin}/mcp`,
    state: "test-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...extra,
  });
  const cookies = new Map<string, string>();
  async function request(url: string, options: RequestInit = {}) {
    const r = await fetch(new URL(url, origin), {
      ...options,
      redirect: "manual",
      headers: {
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...options.headers,
      },
    });
    for (const c of r.headers.getSetCookie()) {
      const first = c.split(";")[0];
      const p = first.indexOf("=");
      cookies.set(first.slice(0, p), first.slice(p + 1));
    }
    return r;
  }
  const start = await request(`/auth?${params}`);
  return { start, request, verifier };
}
async function authorize() {
  const f = await begin();
  expect(f.start.status).toBe(303);
  const interaction = f.start.headers.get("location")!;
  const screen = await f.request(interaction);
  const html = await screen.text();
  expect(html).toContain("Autorizar el cliente MCP");
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
  let r = await f.request(interaction, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf, decision: "allow" }),
  });
  for (
    let n = 0;
    n < 4 &&
    r.headers.get("location") &&
    !r.headers.get("location")!.startsWith(`${origin}/callback`);
    n++
  )
    r = await f.request(r.headers.get("location")!);
  const redirect = new URL(r.headers.get("location")!);
  expect(redirect.pathname).toBe("/callback");
  expect(redirect.searchParams.has("error")).toBe(false);
  const redeem = (verifier = f.verifier) =>
    fetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "test-client",
        redirect_uri: `${origin}/callback`,
        resource: `${origin}/mcp`,
        code: redirect.searchParams.get("code")!,
        code_verifier: verifier,
      }),
    });
  return { redeem };
}

it("advertises OAuth discovery and rejects missing, APS and foreign bearer credentials", async () => {
  const metadata = await (
    await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`)
  ).json();
  expect(metadata.resource).toBe(`${origin}/mcp`);
  for (const token of ["", "aps-access-token", "foreign-issuer-token"]) {
    const r = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("resource_metadata");
  }
  expect(businessRequests).toBe(0);
});
it("completes consent, PKCE and code exchange; an SDK request uses its own connection", async () => {
  const flow = await authorize();
  const response = await flow.redeem();
  expect(response.status).toBe(200);
  const token = await response.json();
  expect(token.expires_in).toBe(900);
  expect(token.refresh_token).toBeUndefined();
  const client = new Client({ name: "oauth-test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: {
          headers: { authorization: `Bearer ${token.access_token}` },
        },
      }),
    );
    const result = await client.callTool({ name: "list_hubs", arguments: {} });
    expect(result.structuredContent).toMatchObject({
      mode: "autodesk",
      ok: true,
    });
    expect(businessRequests).toBe(1);
  } finally {
    await client.close();
  }
  expect((await flow.redeem()).status).toBe(400);
});
it("rejects a wrong PKCE verifier", async () => {
  const flow = await authorize();
  expect((await flow.redeem("wrong".repeat(16))).status).toBe(400);
});
it("keeps two authenticated users on their own API binding", async () => {
  const first = await authorize();
  const one = await (await first.redeem()).json();
  user = "user-two";
  const second = await authorize();
  const two = await (await second.redeem()).json();
  for (const [tokens, owner] of [
    [one, "user-one"],
    [two, "user-two"],
  ] as const) {
    const client = new Client({ name: "isolation-test", version: "1" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
          requestInit: {
            headers: { authorization: `Bearer ${tokens.access_token}` },
          },
        }),
      );
      const result = await client.callTool({
        name: "list_hubs",
        arguments: {},
      });
      expect(result.structuredContent).toMatchObject({
        data: { items: [{ id: owner }] },
      });
    } finally {
      await client.close();
    }
  }
});
it("rejects unregistered callbacks and another resource", async () => {
  const bad = await begin({ redirect_uri: "https://evil.test/callback" });
  expect(bad.start.status).toBe(400);
  const resource = await begin({ resource: "https://other.test/mcp" });
  expect(
    resource.start.headers.get("location") ?? (await resource.start.text()),
  ).toContain("invalid_target");
});
it("requires the browser's consent nonce and matching origin", async () => {
  const f = await begin();
  const path = f.start.headers.get("location")!;
  await f.request(path);
  const r = await f.request(path, {
    method: "POST",
    headers: {
      origin: "https://evil.test",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "decision=allow&csrf=wrong",
  });
  expect(r.status).toBe(403);
});
it("keeps the strict Origin policy for forms without suppressing it in the browser", async () => {
  const f = await begin();
  const screen = await f.request(f.start.headers.get("location")!);
  expect(screen.headers.get("referrer-policy")).toBe("same-origin");
});
it("cancelling consent returns an OAuth error without a code", async () => {
  const f = await begin();
  const path = f.start.headers.get("location")!;
  const screen = await f.request(path);
  const csrf = (await screen.text()).match(/name="csrf" value="([^"]+)"/)![1];
  let response = await f.request(path, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf, decision: "deny" }),
  });
  for (
    let n = 0;
    n < 4 &&
    response.headers.get("location") &&
    !response.headers.get("location")!.startsWith(`${origin}/callback`);
    n++
  )
    response = await f.request(response.headers.get("location")!);
  const target = new URL(response.headers.get("location")!);
  expect(target.searchParams.get("error")).toBe("access_denied");
  expect(target.searchParams.has("code")).toBe(false);
});
it("requires a new review if the browser's Autodesk connection changes during consent", async () => {
  const f = await begin();
  const path = f.start.headers.get("location")!;
  const screen = await f.request(path);
  const csrf = (await screen.text()).match(/name="csrf" value="([^"]+)"/)![1];
  user = "other-user";
  const response = await f.request(path, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf, decision: "allow" }),
  });
  expect(response.status).toBe(403);
  expect(response.headers.has("location")).toBe(false);
});
it("disconnecting Autodesk rejects even an unexpired MCP credential", async () => {
  const flow = await authorize();
  const token = await (await flow.redeem()).json();
  connected = false;
  const r = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  expect(r.status).toBe(401);
  expect(businessRequests).toBe(0);
});
it("does not accept an expired access token or a token with the wrong audience", async () => {
  for (const bad of [
    { aud: `${origin}/mcp`, expiresIn: 0 },
    { aud: "https://other.test/mcp", expiresIn: 900 },
  ]) {
    const flow = await authorize();
    const raw = (await (await flow.redeem()).json()).access_token as string;
    const adapter = oauth.store.adapter("AccessToken");
    const record = await adapter.find(raw);
    if (!record) throw new Error("Missing synthetic access token");
    record.aud = bad.aud;
    record.exp = Math.floor(Date.now() / 1000) + bad.expiresIn;
    await adapter.upsert(raw, record, bad.expiresIn);
    expect(
      (
        await fetch(`${origin}/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${raw}` },
        })
      ).status,
    ).toBe(401);
  }
});
it("persists encrypted payloads and respects expiry and consumption", async () => {
  const store = new OAuthStore(
    ":memory:",
    "different-synthetic-storage-key-".repeat(2),
  );
  try {
    const a = store.adapter("AuthorizationCode");
    await a.upsert(
      "secret-code",
      { uid: "uid", grantId: "g", extra: { private: "secret" } },
      60,
    );
    await a.consume("secret-code");
    expect((await a.find("secret-code"))?.consumed).toBeTypeOf("number");
    expect((await a.findByUid("uid"))?.extra).toEqual({ private: "secret" });
    await a.revokeByGrantId("g");
    expect(await a.find("secret-code")).toBeUndefined();
    await a.upsert("expired", {}, -1);
    expect(await a.find("expired")).toBeUndefined();
  } finally {
    store.close();
  }
});
it("restores OAuth state after restart and does not store token IDs or payloads in plaintext", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-oauth-"));
  const file = join(dir, "state.db");
  const secret = "synthetic-state-key-".repeat(3);
  let store = new OAuthStore(file, secret);
  try {
    await store
      .adapter("AccessToken")
      .upsert(
        "private-token-id",
        { extra: { private: "private-binding" } },
        60,
      );
    store.close();
    store = new OAuthStore(file, secret);
    expect(
      (await store.adapter("AccessToken").find("private-token-id"))?.extra
        ?.private,
    ).toBe("private-binding");
    const raw = readFileSync(file).toString();
    expect(raw).not.toContain("private-token-id");
    expect(raw).not.toContain("private-binding");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
