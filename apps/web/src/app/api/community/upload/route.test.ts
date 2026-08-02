import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  hasActiveAccountDeletion: vi.fn(async () => false),
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn((prefix: string, _request: Request, userId?: string) =>
    `${prefix}:${userId ?? "anonymous"}`
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/accountDeletion/communityStorageSaga", () => ({
  hasActiveAccountDeletion: mocks.hasActiveAccountDeletion,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function authenticated() {
  mocks.createClientFromRequest.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
  });
}

function jsonRequest(body: unknown, headers: HeadersInit = {}) {
  const request = new Request("http://localhost/api/community/upload", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "formData", {
    value: vi.fn(() => {
      throw new Error("multipart bytes must never reach the function");
    }),
  });
  return request;
}

function chunkedOversizeRequest(byteLength: number): Request {
  const firstChunkSize = Math.floor(byteLength / 2);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(firstChunkSize).fill(0x7b));
      controller.enqueue(new Uint8Array(byteLength - firstChunkSize).fill(0x7d));
      controller.close();
    },
  });
  return new Request("http://localhost/api/community/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function adminHarness(options: { signError?: boolean; insertError?: boolean } = {}) {
  const insertSingle = vi.fn(async () => ({
    data: options.insertError ? null : { id: "unused" },
    error: options.insertError ? { message: "db unavailable" } : null,
  }));
  const select = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn((value: unknown) => {
    void value;
    return { select };
  });
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const fromTable = vi.fn(() => ({ update }));
  const actorCheckRpc = vi.fn(async () => ({ data: true, error: null }));
  const rpc = vi.fn((name: string, args: unknown) => {
    if (name === "community_create_upload_session_for_actor") {
      return insert(args);
    }
    if (name === "community_check_active_write_actor") {
      return actorCheckRpc();
    }
    throw new Error(`unexpected RPC ${name}`);
  });
  const createSignedUploadUrl = vi.fn(async () => options.signError
    ? { data: null, error: { message: "storage unavailable" } }
    : {
        data: {
          token: "signed-upload-token",
          path: "server-returned-path-must-not-be-trusted",
          signedUrl: "https://private.invalid/must-not-be-returned",
        },
        error: null,
      });
  const storageFrom = vi.fn(() => ({ createSignedUploadUrl }));
  const admin = { from: fromTable, rpc, storage: { from: storageFrom } };
  mocks.createAdminClient.mockReturnValue(admin);
  return {
    admin,
    createSignedUploadUrl,
    fromTable,
    insert,
    select,
    insertSingle,
    rpc,
    actorCheckRpc,
    update,
    updateEq,
    storageFrom,
  };
}

describe("POST /api/community/upload (signed upload initiation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.hasActiveAccountDeletion.mockReset();
    mocks.hasActiveAccountDeletion.mockResolvedValue(false);
    authenticated();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed when the service client is not configured", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("missing service key");
    });

    const response = await POST(jsonRequest({ mimeType: "image/png", size: 8 }) as never);

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_UPLOAD_NOT_CONFIGURED",
    });
  });

  it("runs both persistent fail-closed rate gates before parsing JSON", async () => {
    const harness = adminHarness();
    const blocked = Response.json({ error: "blocked" }, { status: 503 });
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(blocked as never);
    const request = jsonRequest({ mimeType: "image/png", size: 8 });
    const text = vi.spyOn(request, "text");

    const response = await POST(request as never);

    expect(response.status).toBe(503);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `community:upload:burst:${USER_ID}`,
      { maxRequests: 20, windowMs: 10 * 60 * 1000 },
      { failClosed: true },
    );
    expect(text).not.toHaveBeenCalled();
    expect(harness.insert).not.toHaveBeenCalled();
  });

  it("returns 413 for a Content-Length-less chunked oversized strict body", async () => {
    const harness = adminHarness();
    const oversized = chunkedOversizeRequest(2 * 1024 + 1);

    const response = await POST(oversized as never);

    expect(oversized.headers.get("content-length")).toBeNull();
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
    });
    expect(harness.insert).not.toHaveBeenCalled();
    expect(harness.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("issues no durable session or signed token after account deletion begins", async () => {
    const harness = adminHarness();
    mocks.hasActiveAccountDeletion.mockResolvedValue(true);

    const response = await POST(
      jsonRequest({ mimeType: "image/png", size: 8 }) as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCOUNT_DELETION_PENDING",
    });
    expect(harness.insert).not.toHaveBeenCalled();
    expect(harness.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("closes the deletion race after durable session creation and before signing", async () => {
    const harness = adminHarness();
    mocks.hasActiveAccountDeletion
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const response = await POST(
      jsonRequest({ mimeType: "image/png", size: 8 }) as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCOUNT_DELETION_PENDING",
    });
    expect(harness.insert).toHaveBeenCalledTimes(1);
    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "rejected",
      rejection_code: "account_deletion_started",
    }));
    expect(harness.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(mocks.hasActiveAccountDeletion).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the post-session deletion fence is unavailable", async () => {
    const harness = adminHarness();
    mocks.hasActiveAccountDeletion
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(
      jsonRequest({ mimeType: "image/png", size: 8 }) as never,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCOUNT_DELETION_FENCE_UNAVAILABLE",
    });
    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "rejected",
      rejection_code: "account_deletion_fence_unavailable",
    }));
    expect(harness.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects non-JSON, unknown keys, unsupported MIME, and invalid byte sizes", async () => {
    const harness = adminHarness();
    const cases: Request[] = [
      new Request("http://localhost/api/community/upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: "--x--",
      }),
      jsonRequest({ mimeType: "image/png", size: 8, userId: "attacker" }),
      jsonRequest({ mimeType: "image/svg+xml", size: 8 }),
      jsonRequest({ mimeType: "image/png", size: 0 }),
      jsonRequest({ mimeType: "image/png", size: 5 * 1024 * 1024 + 1 }),
      jsonRequest({ mimeType: "image/gif", size: 6 * 1024 * 1024 + 1 }),
      jsonRequest({ mimeType: "video/mp4", size: 1024 }),
    ];

    for (const request of cases) {
      const response = await POST(request as never);
      expect(response.status).toBe(400);
    }
    expect(harness.insert).not.toHaveBeenCalled();
    expect(harness.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("creates a durable owner session before signing one exact private staging path", async () => {
    const harness = adminHarness();
    const request = jsonRequest({ mimeType: "image/png", size: 1234 });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      uploadId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      bucket: "community-media-staging",
      path: expect.stringMatching(new RegExp(`^${USER_ID}/[0-9a-f-]{36}\\.png$`, "i")),
      token: "signed-upload-token",
      expiresAt: expect.any(String),
    });
    expect(body).not.toHaveProperty("url");
    expect(body).not.toHaveProperty("signedUrl");
    expect(harness.rpc).toHaveBeenCalledWith(
      "community_create_upload_session_for_actor",
      expect.any(Object),
    );
    expect(harness.insert).toHaveBeenCalledWith(expect.objectContaining({
      p_actor_id: USER_ID,
      p_upload_id: body.uploadId,
      p_staging_path: body.path,
      p_final_path: expect.stringMatching(/^v2\/[0-9a-f-]{36}\.png$/i),
      p_final_bucket: "community-images",
      p_declared_mime_type: "image/png",
      p_declared_size: 1234,
    }));
    const session = harness.insert.mock.calls[0][0] as { p_final_path: string };
    expect(session.p_final_path).not.toContain(USER_ID);
    expect(session.p_final_path).not.toContain(body.uploadId);
    expect(harness.storageFrom).toHaveBeenCalledWith("community-media-staging");
    expect(harness.createSignedUploadUrl).toHaveBeenCalledWith(body.path, { upsert: false });
    expect(harness.insert.mock.invocationCallOrder[0]).toBeLessThan(
      harness.createSignedUploadUrl.mock.invocationCallOrder[0],
    );
    expect(request.formData).not.toHaveBeenCalled();
  });

  it("fails closed and rejects the session when signing fails", async () => {
    const harness = adminHarness({ signError: true });

    const response = await POST(jsonRequest({ mimeType: "image/webp", size: 4096 }) as never);

    expect(response.status).toBe(503);
    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "rejected",
      rejection_code: "signing_failed",
    }));
    expect(harness.updateEq).toHaveBeenCalledWith("id", expect.any(String));
  });

  it("does not issue a signed token if the durable session write fails", async () => {
    const harness = adminHarness({ insertError: true });

    const response = await POST(jsonRequest({ mimeType: "image/jpeg", size: 1024 }) as never);

    expect(response.status).toBe(503);
    expect(harness.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});
