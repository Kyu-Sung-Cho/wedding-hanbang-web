import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAdminClientSpy,
  createClientFromRequestSpy,
  persistentLimitSpy,
} = vi.hoisted(() => ({
  createAdminClientSpy: vi.fn(),
  createClientFromRequestSpy: vi.fn(),
  persistentLimitSpy: vi.fn(async () => null),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientSpy,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: createClientFromRequestSpy,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: persistentLimitSpy,
  rateLimitKey: vi.fn(() => "chat:image-cleanup:test-user"),
}));

import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PARTNER_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "33333333-3333-4333-8333-333333333333";
const FILE_ID = "55555555-5555-4555-8555-555555555555";
const IMAGE_PATH = `${COUPLE_ID}/${USER_ID}/${FILE_ID}.png`;

type QueryResult = {
  data: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
};

class MaybeSingleQuery {
  readonly filters: Array<[string, unknown]> = [];

  constructor(public result: QueryResult) {}

  select() { return this; }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  contains(column: string, value: unknown) {
    this.filters.push([`contains:${column}`, value]);
    return this;
  }

  limit() { return this; }

  maybeSingle() { return Promise.resolve(this.result); }
}

function cleanupRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/chat/image-cleanup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function mockAuthenticatedUser(userId: string | null = USER_ID) {
  createClientFromRequestSpy.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  });
}

function mockHappyAdmin(options: {
  bindingResults?: QueryResult[];
  createdAt?: string;
  infoError?: Record<string, unknown> | null;
  removeError?: Record<string, unknown> | null;
} = {}) {
  const profileQuery = new MaybeSingleQuery({
    data: { id: USER_ID, couple_id: COUPLE_ID, role: "bride" },
    error: null,
  });
  const coupleQuery = new MaybeSingleQuery({
    data: { id: COUPLE_ID, bride_id: USER_ID, groom_id: PARTNER_ID },
    error: null,
  });
  const bindingQueries: MaybeSingleQuery[] = [];
  const info = vi.fn(async () => ({
    data: options.infoError ? null : {
      id: FILE_ID,
      name: IMAGE_PATH,
      bucketId: "chat-image",
      createdAt: options.createdAt ?? new Date().toISOString(),
    },
    error: options.infoError ?? null,
  }));
  const remove = vi.fn(async () => ({ data: [], error: options.removeError ?? null }));
  const from = vi.fn((table: string) => {
    if (table === "profiles") return profileQuery;
    if (table === "couples") return coupleQuery;
    if (table === "chat_messages") {
      const result = options.bindingResults?.[bindingQueries.length]
        ?? { data: null, error: null };
      const query = new MaybeSingleQuery(result);
      bindingQueries.push(query);
      return query;
    }
    throw new Error(`unexpected table: ${table}`);
  });
  const storageFrom = vi.fn((bucket: string) => {
    if (bucket !== "chat-image") throw new Error(`unexpected bucket: ${bucket}`);
    return { info, remove };
  });
  createAdminClientSpy.mockReturnValue({
    from,
    storage: { from: storageFrom },
  });
  return {
    bindingQueries,
    coupleQuery,
    from,
    info,
    profileQuery,
    remove,
    storageFrom,
  };
}

describe("POST /api/chat/image-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistentLimitSpy.mockResolvedValue(null);
    mockAuthenticatedUser();
  });

  it("deletes a fresh unbound upload only after revalidating its actor and couple", async () => {
    const admin = mockHappyAdmin();

    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: [IMAGE_PATH], alreadyAbsent: [] });
    expect(admin.profileQuery.filters).toEqual([["id", USER_ID]]);
    expect(admin.coupleQuery.filters).toEqual([["id", COUPLE_ID]]);
    expect(admin.bindingQueries).toHaveLength(2);
    expect(admin.bindingQueries[0]?.filters).toContainEqual([
      "contains:metadata",
      { imagePaths: [IMAGE_PATH] },
    ]);
    expect(admin.info).toHaveBeenCalledWith(IMAGE_PATH);
    expect(admin.remove).toHaveBeenCalledWith([IMAGE_PATH]);
  });

  it("fails closed before service access when the authenticated account changed", async () => {
    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: PARTNER_ID,
      paths: [`${COUPLE_ID}/${PARTNER_ID}/${FILE_ID}.png`],
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ACTOR_CHANGED" });
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("requires an authenticated current user", async () => {
    mockAuthenticatedUser(null);

    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("rejects another user's path before authentication-backed service access", async () => {
    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [`${COUPLE_ID}/${PARTNER_ID}/${FILE_ID}.png`],
    }));

    expect(response.status).toBe(400);
    expect(createClientFromRequestSpy).not.toHaveBeenCalled();
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it.each([
    `${COUPLE_ID}/${USER_ID}/../${FILE_ID}.png`,
    `${COUPLE_ID}/${USER_ID}/%2e%2e%2f${FILE_ID}.png`,
    `${COUPLE_ID}/${USER_ID}/${FILE_ID}%2fpayload.png`,
    `${COUPLE_ID}/${USER_ID}\\${FILE_ID}.png`,
    `${COUPLE_ID}/${USER_ID}/A5555555-5555-4555-8555-555555555555.png`,
  ])("rejects non-canonical or traversal path %s", async (path) => {
    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [path],
    }));

    expect(response.status).toBe(400);
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("rejects duplicate or oversized batches instead of broadening deletion", async () => {
    const duplicateResponse = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH, IMAGE_PATH],
    }));
    const oversizedResponse = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: Array.from({ length: 6 }, (_, index) => (
        `${COUPLE_ID}/${USER_ID}/55555555-5555-4555-8555-55555555555${index}.png`
      )),
    }));

    expect(duplicateResponse.status).toBe(400);
    expect(oversizedResponse.status).toBe(400);
    expect(createAdminClientSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the authoritative profile no longer belongs to the requested couple", async () => {
    const admin = mockHappyAdmin();
    admin.profileQuery.result = {
      data: {
        id: USER_ID,
        couple_id: "99999999-9999-4999-8999-999999999999",
        role: "bride",
      },
      error: null,
    };

    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "COUPLE_CHANGED" });
    expect(admin.storageFrom).not.toHaveBeenCalled();
  });

  it("fails closed when the user no longer occupies the authoritative couple slot", async () => {
    const admin = mockHappyAdmin();
    admin.coupleQuery.result = {
      data: { id: COUPLE_ID, bride_id: PARTNER_ID, groom_id: null },
      error: null,
    };

    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "COUPLE_MEMBERSHIP_CHANGED" });
    expect(admin.storageFrom).not.toHaveBeenCalled();
  });

  it("refuses an object already bound in chat message metadata", async () => {
    const admin = mockHappyAdmin({
      bindingResults: [{ data: { id: "message-1" }, error: null }],
    });

    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ATTACHMENT_ALREADY_BOUND" });
    expect(admin.info).not.toHaveBeenCalled();
    expect(admin.remove).not.toHaveBeenCalled();
  });

  it("rechecks binding immediately before deletion and lets a concurrent ingest win", async () => {
    const admin = mockHappyAdmin({
      bindingResults: [
        { data: null, error: null },
        { data: { id: "message-raced" }, error: null },
      ],
    });

    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ATTACHMENT_ALREADY_BOUND" });
    expect(admin.info).toHaveBeenCalledWith(IMAGE_PATH);
    expect(admin.remove).not.toHaveBeenCalled();
  });

  it("refuses an old upload even when it remains unbound", async () => {
    const admin = mockHappyAdmin({
      createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    });

    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "UPLOAD_NOT_FRESH" });
    expect(admin.remove).not.toHaveBeenCalled();
  });

  it("is idempotent when a prior cleanup already removed the unbound upload", async () => {
    const admin = mockHappyAdmin({
      infoError: { status: 404, message: "Object not found" },
    });
    const body = {
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    };

    const first = await POST(cleanupRequest(body));
    const second = await POST(cleanupRequest(body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual({ deleted: [], alreadyAbsent: [IMAGE_PATH] });
    expect(await second.json()).toEqual({ deleted: [], alreadyAbsent: [IMAGE_PATH] });
    expect(admin.remove).not.toHaveBeenCalled();
  });

  it("fails closed when binding or storage state cannot be verified", async () => {
    const bindingFailure = mockHappyAdmin({
      bindingResults: [{ data: null, error: { code: "DB_DOWN" } }],
    });
    const bindingResponse = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    }));
    expect(bindingResponse.status).toBe(503);
    expect(bindingFailure.remove).not.toHaveBeenCalled();

    vi.clearAllMocks();
    persistentLimitSpy.mockResolvedValue(null);
    mockAuthenticatedUser();
    const storageFailure = mockHappyAdmin({
      infoError: { status: 503, message: "Storage unavailable" },
    });
    const storageResponse = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    }));
    expect(storageResponse.status).toBe(503);
    expect(storageFailure.remove).not.toHaveBeenCalled();
  });

  it("never reports deletion success when the service-role remove fails", async () => {
    const admin = mockHappyAdmin({
      removeError: { status: 503, message: "Storage unavailable" },
    });

    const response = await POST(cleanupRequest({
      coupleId: COUPLE_ID,
      expectedActorUserId: USER_ID,
      paths: [IMAGE_PATH],
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "STORAGE_DELETE_FAILED" });
    expect(admin.remove).toHaveBeenCalledWith([IMAGE_PATH]);
  });

  it("requires same-origin browser metadata before reading authentication", async () => {
    const response = await POST(new Request("http://localhost/api/chat/image-cleanup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.invalid",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({
        coupleId: COUPLE_ID,
        expectedActorUserId: USER_ID,
        paths: [IMAGE_PATH],
      }),
    }));

    expect(response.status).toBe(403);
    expect(createClientFromRequestSpy).not.toHaveBeenCalled();
  });
});
