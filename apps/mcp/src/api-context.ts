import { SignJWT } from "jose";
import { z } from "zod";
import { ContractFailure, type ContractApi } from "./contracts.js";

export const bindingSchema = z.object({
  subject: z.string().min(1),
  connection: z.string().min(1),
  name: z.string(),
  expires_at: z.number().int(),
  binding: z.string().min(1),
});
export type UserBinding = z.infer<typeof bindingSchema>;
export interface ContextOptions {
  issuer: string;
  apiBaseUrl: string;
  internalSecret: string;
  webOrigin?: string;
}

/** Credencial interna corta y de audiencia diferente: no propaga el bearer del cliente. */
export async function internalToken(
  options: ContextOptions,
  purpose: "bind" | "delegate",
  user?: UserBinding,
): Promise<string> {
  return new SignJWT({ purpose, ...(user ? { binding: user.binding } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(options.issuer)
    .setAudience("issues-manager-api")
    .setSubject(user?.subject ?? "mcp-service")
    .setIssuedAt()
    .setExpirationTime("30s")
    .sign(new TextEncoder().encode(options.internalSecret));
}

export async function bindBrowser(
  options: ContextOptions,
  cookie: string,
): Promise<UserBinding> {
  const response = await fetch(new URL("/mcp/bind", options.apiBaseUrl), {
    headers: {
      authorization: `Bearer ${await internalToken(options, "bind")}`,
      cookie,
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new ContractFailure("authentication_required");
  return bindingSchema.parse(await response.json());
}

export function authenticatedApi(
  options: ContextOptions,
  user: UserBinding,
): ContractApi {
  return {
    mode: "autodesk",
    reviewOrigin: options.webOrigin ?? "http://127.0.0.1:5173",
    async request(method, path, body) {
      if (
        !path.startsWith("/projects/") ||
        path.includes("..") ||
        (path.includes("/execute") &&
          !(
            method === "POST" &&
            /^\/projects\/issue-plans\/[A-Za-z0-9_.-]+\/execute$/.test(path)
          )) ||
        path.includes("/approve")
      )
        throw new ContractFailure("resource_unavailable");
      try {
        const response = await fetch(
          new URL(`/mcp-api${path}`, options.apiBaseUrl),
          {
            method,
            headers: {
              authorization: `Bearer ${await internalToken(options, "delegate", user)}`,
              "content-type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: "error",
            signal: AbortSignal.timeout(30000),
          },
        );
        if (response.status === 401)
          throw new ContractFailure("authentication_required");
        if (response.status === 403)
          throw new ContractFailure("permission_denied");
        if (response.status === 404)
          throw new ContractFailure("resource_unavailable");
        if (!response.ok) {
          const failure = z
            .object({
              error: z.enum([
                "human_approval_required",
                "plan_changed_review_again",
                "issue_changed_review_again",
                "plan_expired",
              ]),
            })
            .safeParse(await response.json());
          throw new ContractFailure(
            failure.success ? failure.data.error : "upstream_unavailable",
          );
        }
        return (await response.json()) as unknown;
      } catch (error) {
        if (error instanceof ContractFailure) throw error;
        throw new ContractFailure("upstream_unavailable");
      }
    },
  };
}
