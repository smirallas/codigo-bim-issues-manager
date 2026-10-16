export interface UserSession {
  user: { subject: string; email: string; name: string };
  csrf_token: string;
  expires_at: number;
}

export type AuthState =
  | { status: "loading" }
  | { status: "unconfigured" }
  | { status: "anonymous"; error?: string }
  | { status: "authenticated"; session: UserSession }
  | { status: "unavailable" };

export const authMessages: Record<string, string> = {
  invalid_callback:
    "El retorno de Autodesk no es válido o ha caducado. Inicia sesión de nuevo.",
  cancelled: "Has cancelado el acceso en Autodesk.",
  provider_error:
    "No se ha podido verificar la respuesta de Autodesk. Inténtalo de nuevo.",
  access_denied:
    "Esta cuenta no tiene acceso a la demostración o su correo no está verificado.",
  session_expired: "La sesión ha caducado. Vuelve a iniciar sesión.",
  reconnect_required:
    "La conexión Autodesk ya no está disponible. Vuelve a iniciar sesión.",
  not_configured: "Falta completar la configuración APS privada del servidor.",
};

function isSession(value: unknown): value is UserSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<UserSession>;
  return (
    typeof v.csrf_token === "string" &&
    typeof v.expires_at === "number" &&
    typeof v.user?.subject === "string" &&
    typeof v.user.email === "string" &&
    typeof v.user.name === "string"
  );
}

/** Recupera solo identidad y CSRF de nuestra sesión; no recibe credenciales APS. */
export async function loadAuth(
  request: typeof fetch = fetch,
): Promise<AuthState> {
  try {
    const configResponse = await request("/api/auth/config", {
      signal: AbortSignal.timeout(5000),
    });
    if (!configResponse.ok) return { status: "unavailable" };
    const config: unknown = await configResponse.json();
    if (
      typeof config !== "object" ||
      config === null ||
      !("configured" in config) ||
      typeof config.configured !== "boolean"
    ) {
      return { status: "unavailable" };
    }
    if (!config.configured) return { status: "unconfigured" };
    const response = await request("/api/auth/session", {
      credentials: "same-origin",
      signal: AbortSignal.timeout(25000),
    });
    const value: unknown = await response.json();
    if (response.ok && isSession(value))
      return { status: "authenticated", session: value };
    if (
      (response.status === 401 || response.status === 403) &&
      typeof value === "object" &&
      value !== null &&
      "error" in value
    ) {
      return {
        status: "anonymous",
        error: typeof value.error === "string" ? value.error : undefined,
      };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** La desconexión exige CSRF y conserva la incertidumbre de una revocación remota. */
export async function disconnect(
  session: UserSession,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const response = await request("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-CSRF-Token": session.csrf_token },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error("disconnect_failed");
  const result: unknown = await response.json();
  if (
    typeof result !== "object" ||
    result === null ||
    !("local_disconnected" in result) ||
    result.local_disconnected !== true
  ) {
    throw new Error("disconnect_failed");
  }
  return (
    "provider_revocation" in result &&
    result.provider_revocation === "confirmed"
  );
}
