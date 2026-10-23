import { generateKeyPairSync, randomBytes, timingSafeEqual } from "node:crypto";
import express, {
  type Express,
  type Request,
  type RequestHandler,
} from "express";
import { Provider, errors, interactionPolicy } from "oidc-provider";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  authenticatedApi,
  bindBrowser,
  bindingSchema,
  type ContextOptions,
} from "./api-context.js";
import { OAuthStore } from "./oauth-store.js";
import type { ContractApi } from "./contracts.js";

export const MCP_SCOPE = "issues:access";
export interface OAuthOptions extends ContextOptions {
  storageFile: string;
  storageKey: string;
  webOrigin: string;
  clients: { client_id: string; redirect_uris: string[] }[];
}
export function cookieValue(req: Request, name: string): string {
  return (
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function page(title: string, content: string): string {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title} · Issues Manager</title><style>body{font:18px/1.65 system-ui;background:#f7f4ec;color:#17383b;max-width:850px;margin:60px auto;padding:24px}main{background:white;padding:32px;border:1px solid #d5dfdc;border-radius:16px}button,a.button{display:inline-block;background:#16635e;color:white;padding:12px 20px;border:0;border-radius:6px;margin:12px 12px 12px 0;font:inherit;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}label{display:block}small{display:block;color:#52615f}</style><main><p>Código BIM · Issues Manager · E07</p><h1>${title}</h1>${content}</main></html>`;
}

/** oidc-provider gestiona códigos, PKCE y tokens; FastAPI acredita siempre la identidad APS. */
export async function installOAuth(
  app: Express,
  options: OAuthOptions,
): Promise<{
  provider: Provider;
  store: OAuthStore;
  guard: RequestHandler;
  api: (req: Request) => ContractApi;
}> {
  const issuer = new URL(options.issuer);
  if (
    issuer.pathname !== "/" ||
    issuer.search ||
    issuer.hash ||
    issuer.username ||
    issuer.password ||
    (issuer.protocol !== "https:" &&
      !(
        issuer.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(issuer.hostname)
      )) ||
    options.internalSecret.length < 43
  )
    throw new Error("Invalid MCP OAuth configuration");
  const resource = `${options.issuer}/mcp`;
  const store = new OAuthStore(options.storageFile, options.storageKey);
  const settings = store.adapter("Settings");
  let keys = await settings.find("signing");
  if (!keys) {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    keys = {
      extra: {
        keys: [
          {
            ...privateKey.export({ format: "jwk" }),
            kid: randomBytes(16).toString("hex"),
            use: "sig",
            alg: "RS256",
          },
        ],
      },
    };
    await settings.upsert("signing", keys, 10 * 365 * 86400);
  }
  const prompts = interactionPolicy.base();
  prompts
    .get("consent")!
    .checks.add(
      new interactionPolicy.Check(
        "explicit_mcp_consent",
        "Se requiere autorizar este cliente",
        (ctx) => !ctx.oidc.result?.consent,
      ),
    );
  const provider = new Provider(options.issuer, {
    adapter: (name) => store.adapter(name),
    clients: options.clients.map((c) => ({
      ...c,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    })),
    jwks: keys.extra as { keys: import("oidc-provider").JWKS["keys"] },
    cookies: {
      keys: [options.storageKey],
      short: {
        sameSite: "lax",
        httpOnly: true,
        secure: issuer.protocol === "https:",
      },
      long: {
        sameSite: "lax",
        httpOnly: true,
        secure: issuer.protocol === "https:",
      },
    },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => resource,
        useGrantedResource: () => false,
        getResourceServerInfo: (_ctx, indicator) => {
          if (indicator !== resource) throw new errors.InvalidTarget();
          return {
            scope: MCP_SCOPE,
            audience: resource,
            accessTokenTTL: 900,
            accessTokenFormat: "opaque",
          };
        },
      },
    },
    scopes: [],
    responseTypes: ["code"],
    pkce: { required: () => true },
    ttl: {
      AccessToken: 900,
      AuthorizationCode: 60,
      Interaction: 600,
      Session: 28800,
      Grant: 28800,
    },
    interactions: {
      policy: prompts,
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },
    findAccount: (_ctx, id) => ({ accountId: id, claims: () => ({ sub: id }) }),
    loadExistingGrant: (ctx) =>
      ctx.oidc.result?.consent?.grantId
        ? ctx.oidc.provider.Grant.find(ctx.oidc.result.consent.grantId)
        : undefined,
    renderError: (ctx) => {
      ctx.type = "html";
      ctx.body = page(
        "No se pudo autorizar",
        "<p>La solicitud no es válida o ha caducado. Vuelve al cliente e inicia otra conexión.</p>",
      );
    },
  });
  const bindingStore = store.adapter("Binding");
  const consents = store.adapter("Consent");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      // no-referrer convierte Origin en null en navegaciones POST del formulario.
      // Los callbacks con código mantienen no-referrer; solo estas páginas sin código usan same-origin.
      "Referrer-Policy":
        req.path === "/client" || req.path.startsWith("/interaction/")
          ? "same-origin"
          : "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  app.get(
    [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ],
    (_req, res) => {
      res.json({
        resource,
        authorization_servers: [options.issuer],
        scopes_supported: [MCP_SCOPE],
        bearer_methods_supported: ["header"],
      });
    },
  );
  app.get("/interaction/:uid", async (req, res) => {
    try {
      const detail = await provider.interactionDetails(req, res);
      const nonce = randomBytes(32).toString("base64url");
      res.cookie("mcp_consent", nonce, {
        httpOnly: true,
        sameSite: "strict",
        secure: issuer.protocol === "https:",
        maxAge: 600000,
        path: `/interaction/${detail.uid}`,
      });
      let identity;
      try {
        identity = await bindBrowser(
          options,
          `issues_session=${cookieValue(req, "issues_session")}`,
        );
      } catch {
        res
          .type("html")
          .send(
            page(
              "Conecta tu cuenta Autodesk",
              `<p>Necesitas una sesión autorizada de Issues Manager. Inicia sesión en la aplicación y vuelve después a esta pestaña para continuar.</p><a class="button" href="${escapeHtml(options.webOrigin)}" target="_blank" rel="noopener">Abrir Issues Manager</a><p><a href="/interaction/${detail.uid}">Ya he iniciado sesión, continuar</a></p>`,
            ),
          );
        return;
      }
      res
        .type("html")
        .send(
          page(
            "Autorizar el cliente MCP",
            `<p>Cuenta conectada: <strong>${escapeHtml(identity.name)}</strong>.</p><p>Cliente: <strong>${escapeHtml(String(detail.params.client_id))}</strong>.</p><p>Podrá consultar tus proyectos e incidencias y preparar revisiones con esta misma conexión Autodesk. Solo podrá crear o modificar una incidencia tras tu aprobación del contenido exacto en la web. El cliente no puede aprobar por ti.</p><p>La credencial MCP dura 15 minutos. Desconectar Autodesk o caducar la sesión de la aplicación corta también el acceso a los datos.</p><form method="post" action="/interaction/${detail.uid}"><input type="hidden" name="csrf" value="${nonce}"><button name="decision" value="allow">Autorizar cliente</button><button name="decision" value="deny">Cancelar</button></form>`,
          ),
        );
      await consents.upsert(
        nonce,
        {
          uid: detail.uid,
          extra: { subject: identity.subject, connection: identity.connection },
        },
        600,
      );
    } catch {
      res
        .status(400)
        .type("html")
        .send(
          page(
            "Solicitud caducada",
            "<p>Vuelve al cliente para empezar otra conexión.</p>",
          ),
        );
    }
  });
  app.post(
    "/interaction/:uid",
    express.urlencoded({ extended: false, limit: "4kb" }),
    async (req, res) => {
      try {
        const detail = await provider.interactionDetails(req, res);
        const nonce = cookieValue(req, "mcp_consent");
        const supplied = typeof req.body.csrf === "string" ? req.body.csrf : "";
        if (
          req.headers.origin !== options.issuer ||
          !nonce ||
          nonce.length !== supplied.length ||
          !timingSafeEqual(Buffer.from(nonce), Buffer.from(supplied))
        ) {
          res.status(403).end();
          return;
        }
        res.clearCookie("mcp_consent", { path: `/interaction/${detail.uid}` });
        if (req.body.decision !== "allow") {
          await provider.interactionFinished(
            req,
            res,
            { error: "access_denied" },
            { mergeWithLastSubmission: false },
          );
          return;
        }
        const identity = await bindBrowser(
          options,
          `issues_session=${cookieValue(req, "issues_session")}`,
        );
        if (identity.expires_at <= Date.now() / 1000)
          throw new Error("Expired session");
        const shown = await consents.find(nonce);
        await consents.destroy(nonce);
        if (
          shown?.uid !== detail.uid ||
          shown.extra?.subject !== identity.subject ||
          shown.extra?.connection !== identity.connection
        )
          throw new Error("Connection changed after consent screen");
        const grant = new provider.Grant({
          accountId: identity.subject,
          clientId: String(detail.params.client_id),
        });
        grant.addResourceScope(resource, MCP_SCOPE);
        const grantId = await grant.save();
        await bindingStore.upsert(
          grantId,
          { extra: identity, grantId },
          Math.max(1, identity.expires_at - Math.floor(Date.now() / 1000)),
        );
        await provider.interactionFinished(
          req,
          res,
          {
            login: { accountId: identity.subject, remember: false },
            consent: { grantId },
          },
          { mergeWithLastSubmission: false },
        );
      } catch {
        res
          .status(403)
          .type("html")
          .send(
            page(
              "Acceso denegado",
              "<p>La cuenta no está autorizada o su conexión ha caducado. Vuelve a Issues Manager.</p>",
            ),
          );
      }
    },
  );
  const guard = requireBearerAuth({
    requiredScopes: [MCP_SCOPE],
    resourceMetadataUrl: `${options.issuer}/.well-known/oauth-protected-resource/mcp`,
    verifier: {
      verifyAccessToken: async (token) => {
        const access = await provider.AccessToken.find(token);
        if (
          !access ||
          access.isExpired ||
          access.aud !== resource ||
          !access.accountId ||
          !access.grantId ||
          !access.clientId
        )
          throw new InvalidTokenError("Invalid MCP credential");
        const user = bindingSchema.safeParse(
          (await bindingStore.find(access.grantId))?.extra,
        );
        if (
          !user.success ||
          user.data.subject !== access.accountId ||
          user.data.expires_at <= Date.now() / 1000
        )
          throw new InvalidTokenError("Invalid connection");
        // Una credencial aún vigente tampoco da acceso tras desconectar Autodesk.
        const api = authenticatedApi(options, user.data);
        try {
          await api.request("GET", "/projects/mcp-identity");
        } catch {
          throw new InvalidTokenError("Reconnect Autodesk");
        }
        return {
          token,
          clientId: access.clientId,
          scopes: access.scope?.split(" ") ?? [],
          expiresAt: access.exp,
          resource: new URL(resource),
          extra: { binding: user.data },
        };
      },
    },
  });
  // El middleware del proveedor se monta al final, tras /mcp y el cliente de prueba.
  return {
    provider,
    store,
    guard,
    api: (req) =>
      authenticatedApi(options, bindingSchema.parse(req.auth?.extra?.binding)),
  };
}
