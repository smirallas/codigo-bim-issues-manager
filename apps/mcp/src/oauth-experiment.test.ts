import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  type OAuthClientProvider,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { expect, it, vi } from "vitest";

/** Fixture aislada: prueba descubrimiento y PKCE del cliente; no implementa un login. */
it("discovers the separate OAuth server and redirects with PKCE and the MCP resource", async () => {
  const app = createMcpExpressApp();
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const resource = `${baseUrl}/mcp`;
  const metadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;

  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({
      resource,
      authorization_servers: [baseUrl],
      scopes_supported: ["fixture:read"],
    });
  });
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });
  app.post(
    "/mcp",
    requireBearerAuth({
      verifier: {
        verifyAccessToken: async () => {
          throw new InvalidTokenError("Fixture rejects every token");
        },
      },
      resourceMetadataUrl: metadataUrl,
    }),
    (_req, res) => {
      res.status(500).end();
    },
  );

  let verifier = "";
  const redirectToAuthorization = vi.fn();
  const provider: OAuthClientProvider = {
    redirectUrl: "http://127.0.0.1:9999/callback",
    clientMetadata: {
      redirect_uris: ["http://127.0.0.1:9999/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    clientInformation: () => ({ client_id: "fixture-client" }),
    tokens: () => undefined,
    saveTokens: vi.fn(),
    state: () => "fixture-state",
    redirectToAuthorization,
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
  };
  const client = new Client({ name: "e00-oauth-fixture", version: "0.0.0" });
  try {
    const challenge = await fetch(resource, { method: "POST" });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("www-authenticate")).toContain(
      `resource_metadata="${metadataUrl}"`,
    );
    await expect(
      client.connect(
        new StreamableHTTPClientTransport(new URL(resource), {
          authProvider: provider,
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(redirectToAuthorization).toHaveBeenCalledOnce();
    const authorizationUrl = redirectToAuthorization.mock.calls[0][0] as URL;
    expect(authorizationUrl.origin).toBe(baseUrl);
    expect(authorizationUrl.searchParams.get("resource")).toBe(resource);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("fixture-state");
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(provider.saveTokens).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});
