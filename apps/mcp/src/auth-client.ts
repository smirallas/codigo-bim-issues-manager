import { randomBytes } from "node:crypto";
import express, { type Express, type Request } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  auth,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthStore } from "./oauth-store.js";
import { cookieValue, escapeHtml, MCP_SCOPE, page } from "./oauth.js";

/** Cliente SDK de prueba con tokens en servidor, no en DOM, URLs ni almacenamiento web. */
export function installAuthClient(
  app: Express,
  issuer: string,
  store: OAuthStore,
): void {
  const data = store.adapter("DemoClient");
  const serverUrl = `${issuer}/mcp`;
  const redirectUrl = `${issuer}/client/callback`;
  const idFor = (req: Request) => cookieValue(req, "mcp_client");
  app.get("/client", async (req, res) => {
    let id = idFor(req);
    let record = id ? await data.find(id) : undefined;
    if (!record) {
      id = randomBytes(32).toString("base64url");
      record = { extra: { csrf: randomBytes(32).toString("base64url") } };
      await data.upsert(id, record, 28800);
    }
    res.cookie("mcp_client", id, {
      path: "/client",
      httpOnly: true,
      sameSite: "lax",
      secure: issuer.startsWith("https:"),
      maxAge: 28800000,
    });
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    );
    res
      .type("html")
      .send(
        page(
          "Cliente MCP autenticado",
          `<p>Prueba del SDK por Streamable HTTP. Las consultas usarán tu conexión Autodesk individual; aquí no hay un agente de IA.</p><p>${record.extra?.tokens ? "Credencial MCP guardada en el servidor. Comprueba el acceso con una consulta." : "Todavía no has autorizado este cliente."}</p><form method="post" action="/client/start"><input type="hidden" name="csrf" value="${escapeHtml(String(record.extra?.csrf))}"><button>Conectar cliente MCP</button></form><form method="post" action="/client/query"><input type="hidden" name="csrf" value="${escapeHtml(String(record.extra?.csrf))}"><button name="tool" value="list_hubs">Consultar mis hubs</button><label>ID del hub <input name="hub_id" autocomplete="off"></label><button name="tool" value="list_projects">Consultar proyectos del hub</button><button name="tool" value="execute_issue_plan">Comprobar bloqueo de escritura</button></form><p>Credencial MCP: 15 minutos. Sesión de la aplicación: hasta 8 horas. Tokens Autodesk: solo en FastAPI.</p>`,
        ),
      );
  });
  async function providerFor(
    req: Request,
    redirect: (url: URL) => void,
  ): Promise<OAuthClientProvider> {
    const id = idFor(req);
    const row = await data.find(id);
    if (!row?.extra) throw new Error("Client session expired");
    const extra = row.extra;
    return {
      redirectUrl,
      clientMetadata: {
        redirect_uris: [redirectUrl],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: MCP_SCOPE,
      },
      clientInformation: () => ({ client_id: "issues-manager-demo" }),
      state: () => String(extra.state),
      tokens: () => extra.tokens as OAuthTokens | undefined,
      saveTokens: async (tokens) => {
        extra.tokens = tokens;
        delete extra.verifier;
        delete extra.state;
        await data.upsert(id, { extra }, 28800);
      },
      redirectToAuthorization: redirect,
      saveCodeVerifier: async (value) => {
        extra.verifier = value;
        await data.upsert(id, { extra }, 28800);
      },
      codeVerifier: () => String(extra.verifier),
    };
  }
  app.post(
    ["/client/start", "/client/query"],
    express.urlencoded({ extended: false, limit: "4kb" }),
    async (req, res) => {
      const id = idFor(req),
        row = await data.find(id);
      if (
        req.headers.origin !== issuer ||
        !row?.extra ||
        typeof req.body.csrf !== "string" ||
        req.body.csrf !== row.extra.csrf
      ) {
        res.status(403).end();
        return;
      }
      try {
        if (req.path === "/client/start") {
          row.extra.state = randomBytes(32).toString("base64url");
          delete row.extra.tokens;
          await data.upsert(id, row, 28800);
          const provider = await providerFor(req, (url) =>
            res.redirect(303, url.href),
          );
          await auth(provider, { serverUrl, scope: MCP_SCOPE });
          return;
        }
        const tokens = row.extra.tokens as OAuthTokens | undefined;
        if (!tokens) throw new Error("Client unauthenticated");
        const client = new Client({
          name: "issues-manager-auth-test",
          version: "0.7.0",
        });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(serverUrl), {
              requestInit: {
                headers: { authorization: `Bearer ${tokens.access_token}` },
              },
            }),
          );
          const tool = String(req.body.tool);
          if (
            !["list_hubs", "list_projects", "execute_issue_plan"].includes(tool)
          )
            throw new Error("Invalid tool");
          const result = await client.callTool({
            name: tool,
            arguments:
              tool === "list_projects"
                ? { hub_id: String(req.body.hub_id) }
                : tool === "execute_issue_plan"
                  ? { plan_id: "e07-no-execution" }
                  : {},
          });
          res
            .type("html")
            .send(
              page(
                "Resultado del cliente MCP",
                `<p>Respuesta recibida por el SDK sobre HTTP.</p><pre>${escapeHtml(JSON.stringify(result.structuredContent, null, 2))}</pre><a href="/client">Volver al cliente</a>`,
              ),
            );
        } finally {
          await client.close();
        }
      } catch {
        res
          .status(401)
          .type("html")
          .send(
            page(
              "El acceso MCP no está disponible",
              "<p>La credencial ha caducado, la cuenta no está autorizada o se ha desconectado Autodesk. Inicia sesión y vuelve a autorizar el cliente.</p><a href='/client'>Volver al cliente</a>",
            ),
          );
      }
    },
  );
  app.get("/client/callback", async (req, res) => {
    try {
      const row = await data.find(idFor(req));
      if (
        !row?.extra?.state ||
        req.query.state !== row.extra.state ||
        typeof req.query.code !== "string" ||
        req.query.error
      )
        throw new Error("Invalid callback");
      await auth(
        await providerFor(req, () => {
          throw new Error("Unexpected redirect");
        }),
        { serverUrl, authorizationCode: req.query.code, scope: MCP_SCOPE },
      );
      res.redirect(303, "/client");
    } catch {
      res
        .status(400)
        .type("html")
        .send(
          page(
            "Autorización no completada",
            "<p>Se ha cancelado la autorización o la solicitud ya no es válida. No se ha conectado el cliente.</p><a href='/client'>Volver al cliente</a>",
          ),
        );
    }
  });
}
