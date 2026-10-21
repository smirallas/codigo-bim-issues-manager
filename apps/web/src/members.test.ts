import { describe, expect, it, vi } from "vitest";
import { queryMembers } from "./members";

const signal = () => new AbortController().signal;
const person = {
  id: "acc-one",
  autodesk_id: "one",
  name: "Alex",
  email: "one@example.test",
  company_id: "company",
  company_name: "Company",
  status: "active",
  project_admin: false,
  account_admin: false,
};
const caps = {
  user_id: "one",
  project_admin: false,
  permission_levels: ["create"],
  can_create: true,
  assignment: "same_company",
  permitted_actions: ["assign_same_company"],
  permitted_attributes: ["assignedTo", "assignedToType"],
  permitted_statuses: ["open"],
};
const response = (data: unknown, status = 200) =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(data), { status }));

describe("member and capability queries", () => {
  it("uses the local session and preserves both Autodesk and Admin identifiers", async () => {
    const fetcher = response({ items: [person] });
    await expect(
      queryMembers(
        "b.hub",
        "b.project",
        "members",
        signal(),
        undefined,
        fetcher,
      ),
    ).resolves.toEqual([person]);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/projects/hubs/b.hub/b.project/members",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers");
  });
  it("distinguishes a valid empty list from an API denial", async () => {
    await expect(
      queryMembers(
        "b.hub",
        "b.project",
        "members",
        signal(),
        undefined,
        response({ items: [] }),
      ),
    ).resolves.toEqual([]);
    await expect(
      queryMembers(
        "b.hub",
        "b.project",
        "members",
        signal(),
        undefined,
        response({ error: "aps_members_access_denied" }, 403),
      ),
    ).rejects.toThrow("lectura de miembros");
  });
  it("accepts specific capabilities without deriving them from the administrator flag", async () => {
    await expect(
      queryMembers(
        "h",
        "p",
        "capabilities",
        signal(),
        undefined,
        response(caps),
      ),
    ).resolves.toEqual(caps);
  });
  it("checks the exact Autodesk identity and accepts a denied outcome", async () => {
    const data = {
      member: person,
      eligible: false,
      reason: "assignment_other_company",
    };
    const fetcher = response(data);
    await expect(
      queryMembers("h", "p", "assignee-check", signal(), "one", fetcher),
    ).resolves.toEqual(data);
    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/projects/hubs/h/p/assignee-check?by=id&query=one",
    );
  });
  it.each([
    {
      member: { ...person, autodesk_id: "someone-else" },
      eligible: true,
      reason: "eligible",
    },
    { member: person, eligible: true, reason: "assignment_other_company" },
    { member: person, eligible: false, reason: "unknown" },
  ])("rejects mismatching or contradictory assignee checks", async (data) => {
    await expect(
      queryMembers("h", "p", "assignee-check", signal(), "one", response(data)),
    ).rejects.toThrow();
  });
  it.each([null, {}, { items: [{ ...person, status: null }] }])(
    "rejects malformed membership contracts",
    async (data) => {
      await expect(
        queryMembers("h", "p", "members", signal(), undefined, response(data)),
      ).rejects.toThrow();
    },
  );
  it.each([
    { ...caps, assignment: "all-powerful" },
    { ...caps, can_create: "true" },
    { ...caps, permitted_actions: [{}] },
  ])("rejects malformed capability contracts", async (data) => {
    await expect(
      queryMembers(
        "h",
        "p",
        "capabilities",
        signal(),
        undefined,
        response(data),
      ),
    ).rejects.toThrow();
  });
  it("passes aborts to the transport for stale project selection", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation((_url, options) => {
        expect(options?.signal?.aborted).toBe(true);
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      });
    await expect(
      queryMembers("h", "p", "members", controller.signal, undefined, fetcher),
    ).rejects.toThrow("Aborted");
  });
});
