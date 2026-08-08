import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  hasActiveAccountDeletion: vi.fn(async () => false),
  checkCommunityWriteAccess: vi.fn(async () => ({ allowed: true })),
  claimCommunityUploadSession: vi.fn(),
  markCommunityUploadCompleted: vi.fn(async () => true),
  rejectCommunityUploadSession: vi.fn(async () => true),
  expireIssuedCommunityUploadSession: vi.fn(async () => true),
  verifyRuntimeSupabaseServiceDestination: vi.fn(),
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn((prefix: string, _request: Request, userId?: string) =>
    `${prefix}:${userId ?? "anonymous"}`),
  isTrustedMutationRequest: vi.fn(() => true),
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
vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));
vi.mock("@/lib/supabase/destinationFence", () => ({
  verifyRuntimeSupabaseServiceDestination: mocks.verifyRuntimeSupabaseServiceDestination,
}));
vi.mock("@/lib/community/uploadSession", () => ({
  claimCommunityUploadSession: mocks.claimCommunityUploadSession,
  markCommunityUploadCompleted: mocks.markCommunityUploadCompleted,
  rejectCommunityUploadSession: mocks.rejectCommunityUploadSession,
  expireIssuedCommunityUploadSession: mocks.expireIssuedCommunityUploadSession,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: mocks.isTrustedMutationRequest,
}));

import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${USER_ID}/${UPLOAD_ID}.png`;
const CLAIM_TOKEN = "44444444-4444-4444-8444-444444444444";
const CLEAN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const SOURCE_BYTES = Buffer.concat([
  CLEAN_PNG,
  Buffer.alloc(1_234 - CLEAN_PNG.byteLength, 0x41),
]);
const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const oldMediaPublishing = process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function request(body: unknown = { uploadId: UPLOAD_ID }) {
  return new Request("http://localhost/api/community/upload/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: UPLOAD_ID,
    user_id: USER_ID,
    staging_path: PATH,
    final_bucket: "community-images",
    final_path: PATH,
    declared_mime_type: "image/png",
    declared_size: SOURCE_BYTES.byteLength,
    status: "finalizing",
    claim_token: CLAIM_TOKEN,
    finalize_started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    actual_size: null,
    actual_mime_type: null,
    content_sha256: null,
    sanitized_at: null,
    completed_at: null,
    attached_at: null,
    token_cleanup_at: null,
    ...overrides,
  };
}

function objectInfo(
  bucket: string,
  size: number,
  path = PATH,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "object-id",
    version: "version",
    name: path,
    bucketId: bucket,
    size,
    contentType: "image/png",
    ...overrides,
  };
}

function storageHarness(options: {
  stagingInfo?: Record<string, unknown> | null;
  stagingBytes?: Uint8Array;
  stagingPresent?: boolean;
  finalBytes?: Uint8Array | null;
  uploadError?: boolean;
  removeError?: boolean;
  existsError?: boolean;
} = {}) {
  let stagingPresent = options.stagingPresent ?? true;
  const stagingBytes = Buffer.from(options.stagingBytes ?? SOURCE_BYTES);
  let finalBytes = options.finalBytes === undefined
    ? null
    : options.finalBytes === null ? null : Buffer.from(options.finalBytes);

  const stagingInfo = vi.fn(async () => {
    if (!stagingPresent || options.stagingInfo === null) {
      return { data: null, error: { message: "not found" } };
    }
    return {
      data: options.stagingInfo ?? objectInfo(
        "community-media-staging",
        stagingBytes.byteLength,
      ),
      error: null,
    };
  });
  const stagingDownload = vi.fn(async () => stagingPresent
    ? { data: new Blob([stagingBytes]), error: null }
    : { data: null, error: { message: "not found" } });
  const exists = vi.fn(async () => options.existsError
    ? { data: null, error: { message: "exists failed" } }
    : { data: stagingPresent, error: null });
  const remove = vi.fn(async () => {
    if (options.removeError) return { data: null, error: { message: "remove failed" } };
    stagingPresent = false;
    return { data: [], error: null };
  });

  const finalInfo = vi.fn(async () => finalBytes
    ? { data: objectInfo("community-images", finalBytes.byteLength), error: null }
    : { data: null, error: { message: "not found" } });
  const finalDownload = vi.fn(async () => finalBytes
    ? { data: new Blob([finalBytes]), error: null }
    : { data: null, error: { message: "not found" } });
  const upload = vi.fn(async (_path: string, body: Uint8Array) => {
    if (options.uploadError) return { data: null, error: { message: "upload failed" } };
    finalBytes = Buffer.from(body);
    return { data: { path: PATH }, error: null };
  });
  const getPublicUrl = vi.fn(() => ({
    data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/community-images/${PATH}` },
  }));
  const from = vi.fn((bucket: string) => bucket === "community-media-staging"
    ? { info: stagingInfo, download: stagingDownload, exists, remove }
    : { info: finalInfo, download: finalDownload, upload, getPublicUrl });
  const admin = { storage: { from } };
  mocks.createAdminClient.mockReturnValue(admin);
  return {
    admin,
    from,
    stagingInfo,
    stagingDownload,
    finalInfo,
    finalDownload,
    upload,
    exists,
    remove,
    getPublicUrl,
    finalBytes: () => finalBytes,
  };
}

function pngRange(status = 206, contentRange = `bytes 0-63/${SOURCE_BYTES.byteLength}`) {
  return new Response(SOURCE_BYTES.subarray(0, 64), {
    status,
    headers: contentRange ? { "content-range": contentRange } : {},
  });
}

describe("POST /api/community/upload/finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    mocks.verifyRuntimeSupabaseServiceDestination.mockReturnValue({
      url: "https://project.supabase.co",
      projectRef: "projectprojectproject1",
      keyKind: "opaque",
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
    });
    mocks.claimCommunityUploadSession.mockImplementation(
      async (_admin, _uploadId, _userId, proposedClaim) => session({ claim_token: proposedClaim }),
    );
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.hasActiveAccountDeletion.mockResolvedValue(false);
    vi.stubGlobal("fetch", vi.fn(async () => pngRange()));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("claims no upload session after account deletion begins", async () => {
    storageHarness();
    mocks.hasActiveAccountDeletion.mockResolvedValue(true);

    const response = await POST(request() as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCOUNT_DELETION_PENDING",
    });
    expect(mocks.claimCommunityUploadSession).not.toHaveBeenCalled();
  });

  afterEach(() => {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    if (oldMediaPublishing === undefined) {
      delete process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED;
    } else {
      process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED = oldMediaPublishing;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails closed before claiming a session when controlled-beta media is off", async () => {
    process.env.COMMUNITY_MEDIA_PUBLISHING_ENABLED = "false";

    const response = await POST(request() as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_MEDIA_PUBLISHING_DISABLED",
    });
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(mocks.claimCommunityUploadSession).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fully decodes and sanitizes staging, publishes exact re-encoded bytes, then checkpoints their hash", async () => {
    const storage = storageHarness();

    const response = await POST(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ url: expect.stringContaining(PATH), type: "image" });
    expect(fetch).toHaveBeenCalledWith(
      `https://project.supabase.co/storage/v1/object/authenticated/community-media-staging/${USER_ID}/${UPLOAD_ID}.png`,
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({ Range: "bytes=0-63" }),
      }),
    );
    expect(storage.stagingDownload).toHaveBeenCalledWith(PATH);
    expect(storage.upload).toHaveBeenCalledWith(
      PATH,
      expect.anything(),
      expect.objectContaining({
        cacheControl: "0",
        contentType: "image/png",
        upsert: true,
      }),
    );
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
    expect(storage.finalDownload).toHaveBeenCalledWith(PATH);
    const published = storage.finalBytes();
    expect(published).not.toBeNull();
    expect(published!.includes(Buffer.from("AAAA"))).toBe(false);
    expect(mocks.markCommunityUploadCompleted).toHaveBeenCalledWith(
      storage.admin,
      expect.objectContaining({ id: UPLOAD_ID }),
      published!.byteLength,
      "image/png",
      sha256(published!),
    );
  });

  it("fails closed on the persistent finalize cost gate before any service storage access", async () => {
    const blocked = new Response(JSON.stringify({ error: "too many" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(blocked as never);
    const storage = storageHarness();

    const response = await POST(request() as never);

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `${"community:upload:finalize:burst"}:${USER_ID}`,
      { maxRequests: 30, windowMs: 10 * 60 * 1000 },
      { failClosed: true },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(storage.from).not.toHaveBeenCalled();
    expect(mocks.claimCommunityUploadSession).not.toHaveBeenCalled();
  });

  it("validates every byte and the durable hash before returning a completed replay", async () => {
    const contentHash = sha256(CLEAN_PNG);
    mocks.claimCommunityUploadSession.mockResolvedValue(session({
      status: "completed",
      claim_token: null,
      actual_size: CLEAN_PNG.byteLength,
      actual_mime_type: "image/png",
      content_sha256: contentHash,
      sanitized_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }));
    const storage = storageHarness({ stagingPresent: false, finalBytes: CLEAN_PNG });

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(storage.finalDownload).toHaveBeenCalledWith(PATH);
    expect(storage.stagingDownload).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.getPublicUrl).toHaveBeenCalledOnce();
  });

  it("never returns a completed URL when final bytes differ from the durable hash", async () => {
    mocks.claimCommunityUploadSession.mockResolvedValue(session({
      status: "completed",
      claim_token: null,
      actual_size: CLEAN_PNG.byteLength,
      actual_mime_type: "image/png",
      content_sha256: sha256(CLEAN_PNG),
      sanitized_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }));
    const corrupt = Buffer.from(CLEAN_PNG);
    corrupt[corrupt.length - 1] ^= 0xff;
    const storage = storageHarness({ stagingPresent: false, finalBytes: corrupt });

    const response = await POST(request() as never);

    expect(response.status).toBe(503);
    expect(storage.finalDownload).toHaveBeenCalledWith(PATH);
    expect(storage.getPublicUrl).not.toHaveBeenCalled();
  });

  it("deletes and rejects staging when metadata differs from the signed declaration", async () => {
    const storage = storageHarness({
      stagingInfo: objectInfo("community-media-staging", SOURCE_BYTES.byteLength + 1),
    });

    const response = await POST(request() as never);

    expect(response.status).toBe(422);
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
    expect(mocks.rejectCommunityUploadSession).toHaveBeenCalledWith(
      storage.admin,
      expect.objectContaining({ id: UPLOAD_ID }),
      "metadata_mismatch",
      true,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("fails closed, deletes, and rejects when Storage ignores Range or omits Content-Range", async () => {
    for (const rangeResponse of [pngRange(200), pngRange(206, "")]) {
      vi.mocked(fetch).mockResolvedValueOnce(rangeResponse);
      const storage = storageHarness();

      const response = await POST(request() as never);

      expect(response.status).toBe(422);
      expect(storage.remove).toHaveBeenCalledWith([PATH]);
      expect(mocks.rejectCommunityUploadSession).toHaveBeenCalledWith(
        storage.admin,
        expect.any(Object),
        "range_validation_failed",
        true,
      );
    }
  });

  it("fails closed without storage mutation or secret disclosure when destination verification fails", async () => {
    const secretMarker = "service-role-secret-must-not-leak";
    mocks.verifyRuntimeSupabaseServiceDestination.mockImplementation(() => {
      throw new Error(secretMarker);
    });
    const storage = storageHarness();

    const response = await POST(request() as never);
    const bodyText = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(bodyText).not.toContain(secretMarker);
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(mocks.rejectCommunityUploadSession).not.toHaveBeenCalled();
  });

  it("deletes and rejects a ranged object whose signature does not match", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      { status: 206, headers: { "content-range": `bytes 0-5/${SOURCE_BYTES.byteLength}` } },
    ));
    const storage = storageHarness();

    const response = await POST(request() as never);

    expect(response.status).toBe(422);
    expect(mocks.rejectCommunityUploadSession).toHaveBeenCalledWith(
      storage.admin,
      expect.any(Object),
      "signature_mismatch",
      true,
    );
  });

  it("does not inspect or complete another request's active finalization lease", async () => {
    mocks.claimCommunityUploadSession.mockResolvedValue(session({
      claim_token: "55555555-5555-4555-8555-555555555555",
    }));
    const storage = storageHarness({ stagingPresent: false, finalBytes: CLEAN_PNG });

    const response = await POST(request() as never);

    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(storage.finalInfo).not.toHaveBeenCalled();
    expect(storage.finalDownload).not.toHaveBeenCalled();
    expect(mocks.markCommunityUploadCompleted).not.toHaveBeenCalled();
  });

  it("deletes and durably expires an unclaimed session after token expiry", async () => {
    mocks.claimCommunityUploadSession.mockResolvedValue(session({
      status: "issued",
      claim_token: null,
      finalize_started_at: null,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    }));
    const storage = storageHarness();

    const response = await POST(request() as never);

    expect(response.status).toBe(410);
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
    expect(mocks.expireIssuedCommunityUploadSession).toHaveBeenCalledWith(
      storage.admin,
      expect.objectContaining({ status: "issued", claim_token: null }),
      true,
    );
  });

  it("recovers after a prior publish/crash only by downloading, sanitizing, and re-verifying final bytes", async () => {
    const storage = storageHarness({ stagingPresent: false, finalBytes: SOURCE_BYTES });

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(storage.finalDownload).toHaveBeenCalledTimes(2);
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(storage.finalBytes()!.includes(Buffer.from("AAAA"))).toBe(false);
    expect(mocks.markCommunityUploadCompleted).toHaveBeenCalledOnce();
  });

  it("fails closed when neither staging nor a fully decodable final object exists", async () => {
    const storage = storageHarness({ stagingPresent: false, finalBytes: Buffer.from("not-image") });

    const response = await POST(request() as never);

    expect(response.status).toBe(503);
    expect(storage.finalDownload).toHaveBeenCalledWith(PATH);
    expect(storage.getPublicUrl).not.toHaveBeenCalled();
    expect(mocks.markCommunityUploadCompleted).not.toHaveBeenCalled();
  });
});
