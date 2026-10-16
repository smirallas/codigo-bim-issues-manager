import { describe, expect, it, vi } from "vitest";
import { disconnect, loadAuth, type UserSession } from "./auth";

const session: UserSession = {
  user: {
    subject: "synthetic-subject",
    email: "allowed@example.test",
    name: "Usuario de prueba",
  },
  csrf_token: "synthetic-csrf",
  expires_at: 9999999999,
};

describe("E01 session", () => {
  it("keeps login closed when server configuration is missing", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ configured: false }));
    expect(await loadAuth(request)).toEqual({ status: "unconfigured" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("uses the backend session without storing tokens", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(Response.json(session));
    expect(await loadAuth(request)).toEqual({
      status: "authenticated",
      session,
    });
    expect(request).toHaveBeenLastCalledWith(
      "/api/auth/session",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
  it.each([401, 403])(
    "shows the server denial for status %s",
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ configured: true }))
        .mockResolvedValueOnce(
          Response.json({ error: "access_denied" }, { status }),
        );
      expect(await loadAuth(request)).toEqual({
        status: "anonymous",
        error: "access_denied",
      });
    },
  );
  it("reports an invalid session contract", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ configured: true }))
      .mockResolvedValueOnce(Response.json({ user: {} }));
    expect(await loadAuth(request)).toEqual({ status: "unavailable" });
  });
  it("reports a network error", async () => {
    expect(
      await loadAuth(
        vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
      ),
    ).toEqual({ status: "unavailable" });
  });
  it("sends CSRF on POST and preserves uncertain provider revocation", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        local_disconnected: true,
        provider_revocation: "unconfirmed",
      }),
    );
    expect(await disconnect(session, request)).toBe(false);
    expect(request).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: { "X-CSRF-Token": session.csrf_token },
      }),
    );
  });
  it("does not treat failed logout as disconnected", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: "invalid_csrf" }, { status: 403 }),
      );
    await expect(disconnect(session, request)).rejects.toThrow(
      "disconnect_failed",
    );
  });
});
