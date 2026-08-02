// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  hasSignedDemoSessionFromCookieHeader: vi.fn(),
  isTrustedMutationRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: mocks.hasSignedDemoSessionFromCookieHeader,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string, _request: Request, userId?: string) =>
    `${scope}:${userId ?? "anonymous"}`,
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: mocks.isTrustedMutationRequest,
}));

import { DELETE, GET, PATCH, POST } from "./route";

const USER_ID = "10000000-0000-4000-8000-000000000041";
const PARTNER_ID = "10000000-0000-4000-8000-000000000042";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "10000000-0000-4000-8000-000000000031";
const NOTE_ID = "50000000-0000-4000-8000-000000000001";

function request(method: string, body?: unknown): Request {
  return new Request("https://hanbang.ai/api/amora/notes", {
    method,
    headers: {
      authorization: "Bearer native-session-token",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function profileQuery(coupleId: string | null = COUPLE_ID) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: coupleId ? { couple_id: coupleId } : null,
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { select, eq, maybeSingle };
}

function authenticatedClient(from: ReturnType<typeof vi.fn>) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
      }),
    },
    from,
  };
}

describe("Amora saved-note privacy and write boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.hasSignedDemoSessionFromCookieHeader.mockReturnValue(false);
    mocks.isTrustedMutationRequest.mockReturnValue(true);
  });

  it.each([
    ["POST", POST, { content: "note" }],
    ["PATCH", PATCH, { id: NOTE_ID, memo: "memo" }],
    ["DELETE", DELETE, { id: NOTE_ID }],
  ] as const)("rejects an untrusted %s before authentication or service access", async (
    method,
    handler,
    body,
  ) => {
    mocks.isTrustedMutationRequest.mockReturnValue(false);

    const response = await handler(request(method, body));

    expect(response.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("lists a partner-saved note only through the explicitly resolved couple scope", async () => {
    const profile = profileQuery();
    const limit = vi.fn().mockResolvedValue({
      data: [{
        id: NOTE_ID,
        message_id: MESSAGE_ID,
        content: "partner note",
        memo: null,
        saved_by: PARTNER_ID,
        created_at: "2026-08-02T00:00:00.000Z",
      }],
      error: null,
    });
    const order = vi.fn(() => ({ limit }));
    const notesCoupleEq = vi.fn(() => ({ order }));
    const notesSelect = vi.fn(() => ({ eq: notesCoupleEq }));
    const from = vi.fn((table: string) => {
      if (table === "profiles") return profile;
      if (table === "amora_saved_notes") return { select: notesSelect };
      throw new Error(`unexpected table ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));

    const response = await GET(
      new NextRequest("https://hanbang.ai/api/amora/notes"),
    );

    expect(response.status).toBe(200);
    expect(notesCoupleEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      notes: [{
        id: NOTE_ID,
        messageId: MESSAGE_ID,
        content: "partner note",
        memo: null,
        savedByMe: false,
        createdAt: "2026-08-02T00:00:00.000Z",
      }],
    });
  });

  it("verifies source-message access and inserts only server-derived identity", async () => {
    const profile = profileQuery();
    const sourceMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: MESSAGE_ID, couple_id: COUPLE_ID },
      error: null,
    });
    const sourceCoupleEq = vi.fn(() => ({ maybeSingle: sourceMaybeSingle }));
    const sourceIdEq = vi.fn(() => ({ eq: sourceCoupleEq }));
    const sourceSelect = vi.fn(() => ({ eq: sourceIdEq }));
    const countCoupleEq = vi.fn().mockResolvedValue({ count: 2, error: null });
    const countSelect = vi.fn(() => ({ eq: countCoupleEq }));
    const from = vi.fn((table: string) => {
      if (table === "profiles") return profile;
      if (table === "chat_messages") return { select: sourceSelect };
      if (table === "amora_saved_notes") return { select: countSelect };
      throw new Error(`unexpected authenticated table ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));

    const adminMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: NOTE_ID },
      error: null,
    });
    const adminSelect = vi.fn(() => ({ maybeSingle: adminMaybeSingle }));
    const adminInsert = vi.fn(() => ({ select: adminSelect }));
    const adminFrom = vi.fn(() => ({ insert: adminInsert }));
    mocks.createAdminClient.mockReturnValue({ from: adminFrom });

    const response = await POST(request("POST", {
      messageId: MESSAGE_ID,
      content: "  useful answer  ",
      memo: "  review together  ",
      couple_id: OTHER_COUPLE_ID,
      saved_by: PARTNER_ID,
    }));

    expect(response.status).toBe(200);
    expect(sourceIdEq).toHaveBeenCalledWith("id", MESSAGE_ID);
    expect(sourceCoupleEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(countCoupleEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(adminFrom).toHaveBeenCalledWith("amora_saved_notes");
    expect(adminInsert).toHaveBeenCalledWith({
      couple_id: COUPLE_ID,
      saved_by: USER_ID,
      message_id: MESSAGE_ID,
      content: "useful answer",
      memo: "review together",
    });
    expect(JSON.stringify(adminInsert.mock.calls)).not.toContain(OTHER_COUPLE_ID);
  });

  it("rejects an unreadable or cross-couple source message before service access", async () => {
    const profile = profileQuery();
    const sourceMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const sourceCoupleEq = vi.fn(() => ({ maybeSingle: sourceMaybeSingle }));
    const sourceIdEq = vi.fn(() => ({ eq: sourceCoupleEq }));
    const sourceSelect = vi.fn(() => ({ eq: sourceIdEq }));
    const from = vi.fn((table: string) => {
      if (table === "profiles") return profile;
      if (table === "chat_messages") return { select: sourceSelect };
      throw new Error(`unexpected authenticated table ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));

    const response = await POST(request("POST", {
      messageId: MESSAGE_ID,
      content: "forged note",
    }));

    expect(response.status).toBe(404);
    expect(sourceCoupleEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("maps the authoritative database cap to a stable conflict response", async () => {
    const profile = profileQuery();
    const countCoupleEq = vi.fn().mockResolvedValue({ count: 299, error: null });
    const countSelect = vi.fn(() => ({ eq: countCoupleEq }));
    const from = vi.fn((table: string) => {
      if (table === "profiles") return profile;
      if (table === "amora_saved_notes") return { select: countSelect };
      throw new Error(`unexpected authenticated table ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));

    const adminMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23514", message: "SAVED_NOTES_LIMIT" },
    });
    const adminSelect = vi.fn(() => ({ maybeSingle: adminMaybeSingle }));
    const adminInsert = vi.fn(() => ({ select: adminSelect }));
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ insert: adminInsert })),
    });

    const response = await POST(request("POST", { content: "note" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "SAVED_NOTES_LIMIT",
    });
  });

  it("allows a same-couple partner update but double-filters the service write", async () => {
    const profile = profileQuery();
    const lookupMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: NOTE_ID, couple_id: COUPLE_ID },
      error: null,
    });
    const lookupCoupleEq = vi.fn(() => ({ maybeSingle: lookupMaybeSingle }));
    const lookupIdEq = vi.fn(() => ({ eq: lookupCoupleEq }));
    const lookupSelect = vi.fn(() => ({ eq: lookupIdEq }));
    const from = vi.fn((table: string) => {
      if (table === "profiles") return profile;
      if (table === "amora_saved_notes") return { select: lookupSelect };
      throw new Error(`unexpected authenticated table ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));

    const adminMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: NOTE_ID },
      error: null,
    });
    const adminSelect = vi.fn(() => ({ maybeSingle: adminMaybeSingle }));
    const adminCoupleEq = vi.fn(() => ({ select: adminSelect }));
    const adminIdEq = vi.fn(() => ({ eq: adminCoupleEq }));
    const adminUpdate = vi.fn(() => ({ eq: adminIdEq }));
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ update: adminUpdate })),
    });

    const response = await PATCH(request("PATCH", {
      id: NOTE_ID,
      memo: "  partner memo  ",
      couple_id: OTHER_COUPLE_ID,
    }));

    expect(response.status).toBe(200);
    expect(lookupIdEq).toHaveBeenCalledWith("id", NOTE_ID);
    expect(lookupCoupleEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(adminUpdate).toHaveBeenCalledWith({ memo: "partner memo" });
    expect(adminIdEq).toHaveBeenCalledWith("id", NOTE_ID);
    expect(adminCoupleEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
  });

  it("blocks saved-note IDOR before constructing a service client", async () => {
    const profile = profileQuery();
    const lookupMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const lookupCoupleEq = vi.fn(() => ({ maybeSingle: lookupMaybeSingle }));
    const lookupIdEq = vi.fn(() => ({ eq: lookupCoupleEq }));
    const lookupSelect = vi.fn(() => ({ eq: lookupIdEq }));
    const from = vi.fn((table: string) => {
      if (table === "profiles") return profile;
      if (table === "amora_saved_notes") return { select: lookupSelect };
      throw new Error(`unexpected authenticated table ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));

    const response = await PATCH(request("PATCH", {
      id: NOTE_ID,
      memo: "forged",
    }));

    expect(response.status).toBe(404);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("blocks saved-note delete IDOR before constructing a service client", async () => {
    const profile = profileQuery();
    const lookupMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const lookupCoupleEq = vi.fn(() => ({ maybeSingle: lookupMaybeSingle }));
    const lookupIdEq = vi.fn(() => ({ eq: lookupCoupleEq }));
    const lookupSelect = vi.fn(() => ({ eq: lookupIdEq }));
    const from = vi.fn((table: string) => {
      if (table === "profiles") return profile;
      if (table === "amora_saved_notes") return { select: lookupSelect };
      throw new Error(`unexpected authenticated table ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));

    const response = await DELETE(request("DELETE", { id: NOTE_ID }));

    expect(response.status).toBe(404);
    expect(lookupIdEq).toHaveBeenCalledWith("id", NOTE_ID);
    expect(lookupCoupleEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("deletes only the authenticated couple/id pair through the service client", async () => {
    const profile = profileQuery();
    const lookupMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: NOTE_ID, couple_id: COUPLE_ID },
      error: null,
    });
    const lookupCoupleEq = vi.fn(() => ({ maybeSingle: lookupMaybeSingle }));
    const lookupIdEq = vi.fn(() => ({ eq: lookupCoupleEq }));
    const lookupSelect = vi.fn(() => ({ eq: lookupIdEq }));
    const from = vi.fn((table: string) => {
      if (table === "profiles") return profile;
      if (table === "amora_saved_notes") return { select: lookupSelect };
      throw new Error(`unexpected authenticated table ${table}`);
    });
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient(from));

    const adminCoupleEq = vi.fn().mockResolvedValue({ error: null });
    const adminIdEq = vi.fn(() => ({ eq: adminCoupleEq }));
    const adminDelete = vi.fn(() => ({ eq: adminIdEq }));
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ delete: adminDelete })),
    });

    const response = await DELETE(request("DELETE", { id: NOTE_ID }));

    expect(response.status).toBe(200);
    expect(adminIdEq).toHaveBeenCalledWith("id", NOTE_ID);
    expect(adminCoupleEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
  });
});
