// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { createChatImageObjectPathV2 } from "@/lib/chat/attachmentStorage";
import { AMORA_MAX_TOTAL_ATTACHMENT_BYTES } from "@/lib/ai/amoraAttachments";
import { DELETE, POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "private-delete-test"),
}));
vi.mock("@hanbang/shared/amora-crisis-delivery", () => ({
  planAmoraCrisisDelivery: vi.fn(),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const ACTION_ID = "30000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const CLEARED_AT = "2026-07-31T01:02:03.000Z";
const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/chat/messages/route.ts"),
  "utf8",
);

function request(
  body: unknown = { coupleId: COUPLE_ID, mode: "delete_private" },
  trusted = true,
) {
  return new Request("http://localhost/api/chat/messages", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(trusted ? { Origin: "http://localhost" } : { Origin: "https://attacker.invalid" }),
    },
    body: JSON.stringify(body),
  });
}

function postRequest(
  body: unknown = {
    coupleId: COUPLE_ID,
    content: "예식장 비교 기준을 정리해줘",
    clientRequestId: REQUEST_ID,
    requestedVisibility: "shared",
  },
  headers: Record<string, string> = { Origin: "http://localhost" },
) {
  return new Request("http://localhost/api/chat/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function mockPostAuthentication(userId: string | null = USER_ID) {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  } as never);
}

type PostAdminOptions = {
  role?: "bride" | "groom" | null;
  profileCoupleId?: string | null;
  coupleBrideId?: string | null;
  coupleGroomId?: string | null;
  insertData?: Record<string, unknown> | null;
  insertError?: unknown;
  reconcileData?: Record<string, unknown> | null;
  reconcileError?: unknown;
  imageDownloadData?: Blob | null;
  imageDownloadError?: unknown;
};

function canonicalUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    couple_id: COUPLE_ID,
    sender_id: USER_ID,
    sender_type: "bride",
    sender_role: null,
    role: "user",
    content: "예식장 비교 기준을 정리해줘",
    metadata: { client_request_id: REQUEST_ID },
    stage_tag: null,
    specialist_type: null,
    visibility: "shared",
    segment_id: "50000000-0000-4000-8000-000000000001",
    created_at: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

function mockPostAdmin(options: PostAdminOptions = {}) {
  const profileSingle = vi.fn().mockResolvedValue({
    data: {
      couple_id: options.profileCoupleId === undefined
        ? COUPLE_ID
        : options.profileCoupleId,
      role: options.role === undefined ? "bride" : options.role,
    },
    error: null,
  });
  const profileEq = vi.fn(() => ({ single: profileSingle }));
  const profileSelect = vi.fn(() => ({ eq: profileEq }));

  const coupleSingle = vi.fn().mockResolvedValue({
    data: {
      bride_id: options.coupleBrideId === undefined ? USER_ID : options.coupleBrideId,
      groom_id: options.coupleGroomId === undefined ? GROOM_ID : options.coupleGroomId,
    },
    error: null,
  });
  const coupleEq = vi.fn(() => ({ single: coupleSingle }));
  const coupleSelect = vi.fn(() => ({ eq: coupleEq }));

  const insertSingle = vi.fn().mockResolvedValue({
    data: options.insertData === undefined ? canonicalUserRow() : options.insertData,
    error: options.insertError ?? null,
  });
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  const reconcileMaybeSingle = vi.fn().mockResolvedValue({
    data: options.reconcileData ?? null,
    error: options.reconcileError ?? null,
  });
  const reconcileEqRequest = vi.fn(() => ({ maybeSingle: reconcileMaybeSingle }));
  const reconcileEqCouple = vi.fn(() => ({ eq: reconcileEqRequest }));
  const messageSelect = vi.fn(() => ({ eq: reconcileEqCouple }));

  const from = vi.fn((table: string) => {
    if (table === "profiles") return { select: profileSelect };
    if (table === "couples") return { select: coupleSelect };
    if (table === "chat_messages") return { insert, select: messageSelect };
    throw new Error(`unexpected table: ${table}`);
  });
  const infoImage = vi.fn().mockResolvedValue({
    data: options.imageDownloadData
      ? {
          size: options.imageDownloadData.size,
          contentType: options.imageDownloadData.type,
        }
      : null,
    error: options.imageDownloadError ?? null,
  });
  const downloadImageStream = vi.fn().mockResolvedValue({
    data: options.imageDownloadData?.stream() ?? null,
    error: options.imageDownloadError ?? null,
  });
  const downloadImage = vi.fn(() => ({ asStream: downloadImageStream }));
  const storageFrom = vi.fn((bucket: string) => {
    if (bucket !== "chat-image") throw new Error(`unexpected bucket: ${bucket}`);
    return { info: infoImage, download: downloadImage };
  });
  vi.mocked(createAdminClient).mockReturnValue({
    from,
    storage: { from: storageFrom },
  } as never);
  return {
    from,
    insert,
    insertSelect,
    insertSingle,
    messageSelect,
    coupleSelect,
    reconcileMaybeSingle,
    storageFrom,
    infoImage,
    downloadImage,
    downloadImageStream,
  };
}

function mockAuthenticatedRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
      }),
    },
    rpc,
  } as never);
  return rpc;
}

describe("/api/chat/messages atomic own view reset", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each(["shared", "private"])("returns the DB cursor for %s without service profile writes", async (scope) => {
    const rpc = mockAuthenticatedRpc({ data: { success: true, scope, clearedAt: CLEARED_AT, privacyEpoch: 8 }, error: null });
    const response = await DELETE(request({ coupleId: COUPLE_ID, mode: `view_reset_${scope}` }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, mode: `view_reset_${scope}`, clearedAt: CLEARED_AT });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(rpc).toHaveBeenCalledWith("reset_own_amora_chat_view", { p_couple_id: COUPLE_ID, p_scope: scope });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it.each([
    { data: null, error: { code: "42883" }, status: 503 },
    { data: null, error: { code: "42501" }, status: 403 },
    { data: { success: true, scope: "shared", clearedAt: CLEARED_AT }, error: null, status: 503 },
    { data: { success: true, scope: "private", clearedAt: CLEARED_AT, privacyEpoch: 8 }, error: null, status: 503 },
    { data: { success: true, scope: "shared", clearedAt: "invalid", privacyEpoch: 8 }, error: null, status: 503 },
  ])("fails closed for unavailable, denied or incomplete reset results %#", async ({ data, error, status }) => {
    mockAuthenticatedRpc({ data, error });
    const response = await DELETE(request({ coupleId: COUPLE_ID }));
    expect(response.status).toBe(status);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("/api/chat/messages private hard delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the one authenticated atomic RPC and never creates a service client", async () => {
    const rpc = mockAuthenticatedRpc({
      data: {
        success: true,
        visibility: "bride_private",
        cleared_at: CLEARED_AT,
        deleted_messages: 4,
      },
      error: null,
    });

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      mode: "delete_private",
      deleted: 4,
      clearedAt: CLEARED_AT,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "hard_delete_current_user_private_chat",
      { p_couple_id: COUPLE_ID },
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects cross-site cookie mutations before the RPC", async () => {
    const rpc = mockAuthenticatedRpc({
      data: null,
      error: null,
    });

    const response = await DELETE(request(undefined, false));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNTRUSTED_MUTATION_REQUEST",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("maps the database current-membership fence to a bounded 403", async () => {
    const rpc = mockAuthenticatedRpc({
      data: null,
      error: {
        code: "42501",
        message: "PRIVATE_CHAT_HARD_DELETE_SCOPE_DENIED",
      },
    });

    const response = await DELETE(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "PRIVATE_CHAT_DELETE_SCOPE_DENIED",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic RPC result is incomplete", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = mockAuthenticatedRpc({
      data: { success: true, deleted_messages: 1 },
      error: null,
    });

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "PRIVATE_CHAT_DELETE_INVALID_RESULT",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("contains no split raw-delete implementation for delete_private", () => {
    expect(routeSource).toContain("hard_delete_current_user_private_chat");
    expect(routeSource).not.toMatch(
      /case\s+"delete_private"[\s\S]*?from\("chat_messages"\)[\s\S]*?\.delete/,
    );
    expect(routeSource).not.toContain("const myVisibility = role ===");
  });
});

describe("/api/chat/messages server-authoritative AI ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostAuthentication();
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "continue",
      classification: null,
      effectiveVisibility: "shared",
      safetyPrivacyRedirected: false,
      partnerDeliveryHeld: false,
      response: null,
    });
  });

  it("accepts same-origin cookie auth and writes one canonical AI-target user row", async () => {
    const admin = mockPostAdmin();
    const req = postRequest();

    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      outcome: "persisted",
      reused: false,
      effectiveVisibility: "shared",
      safetyPrivacyRedirected: false,
      message: { id: MESSAGE_ID, visibility: "shared" },
    });
    expect(createClientFromRequest).toHaveBeenCalledWith(req);
    expect(planAmoraCrisisDelivery).toHaveBeenCalledWith({
      userText: "예식장 비교 기준을 정리해줘",
      requestedVisibility: "shared",
      target: "ai",
      senderRole: "bride",
      // 평범한 발화라 false. 이 필드가 빠지면 안전 판정 한 갈래가 통째로 안 보인다.
      externalSafetySignal: false,
    });
    expect(admin.insert).toHaveBeenCalledWith({
      couple_id: COUPLE_ID,
      sender_id: USER_ID,
      sender_type: "bride",
      role: "user",
      content: "예식장 비교 기준을 정리해줘",
      metadata: { client_request_id: REQUEST_ID },
      visibility: "shared",
    });
  });

  it("bounds an oversized chunked ingest body before classification or persistence", async () => {
    const chunk = new Uint8Array(128 * 1024 + 1);
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(chunk);
          return;
        }
        throw new Error("oversized ingest tail must not be consumed");
      },
    });
    const oversized = new Request("http://localhost/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    oversized.headers.delete("content-length");

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(planAmoraCrisisDelivery).not.toHaveBeenCalled();
  });

  it("accepts native Bearer auth through createClientFromRequest", async () => {
    mockPostAdmin();
    const req = postRequest(undefined, {
      Authorization: "Bearer mobile-access-token",
    });

    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(createClientFromRequest).toHaveBeenCalledWith(req);
  });

  it("stores a server-bound zero attachment count for safe cold-start recovery", async () => {
    const row = canonicalUserRow({
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "none",
        provider_attachment_count: 0,
      },
    });
    const admin = mockPostAdmin({ insertData: row });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "예식장 비교 기준을 정리해줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 0,
    }));

    expect(response.status).toBe(201);
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "none",
        provider_attachment_count: 0,
      },
    }));
  });

  it("requires a client upgrade before a positive-count v1 attachment can create a row", async () => {
    const imagePath = `${COUPLE_ID}/${USER_ID}/${MESSAGE_ID}.webp`;
    const row = canonicalUserRow({
      content: "첨부를 함께 확인해줘",
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "present",
        provider_attachment_count: 1,
        imagePaths: [imagePath],
      },
    });
    const admin = mockPostAdmin({ insertData: row });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "첨부를 함께 확인해줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 1,
      imagePaths: [imagePath],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "CLIENT_UPGRADE_REQUIRED",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("requires a client upgrade when a legacy AI image omits the attachment contract", async () => {
    const imagePath = `${COUPLE_ID}/${USER_ID}/${MESSAGE_ID}.webp`;
    const admin = mockPostAdmin();

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "Check the attached image",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      imagePaths: [imagePath],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "CLIENT_UPGRADE_REQUIRED",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(admin.infoImage).not.toHaveBeenCalled();
    expect(admin.downloadImage).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("stores an ordered v2 manifest that binds provider attachments to their exact bytes", async () => {
    const manifest = [{
      mediaType: "image/png",
      byteLength: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    }];
    const imagePath = await createChatImageObjectPathV2({
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      attachmentIndex: 0,
      mediaType: manifest[0].mediaType,
      sha256: manifest[0].sha256,
    });
    expect(imagePath).not.toBeNull();
    const row = canonicalUserRow({
      content: "첨부를 정확히 확인해줘",
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 2,
        ai_response_requested: true,
        provider_attachment_state: "present",
        provider_attachment_count: 1,
        provider_attachment_manifest: [{
          media_type: "image/png",
          byte_length: 5,
          sha256: manifest[0].sha256,
        }],
        imagePaths: [imagePath],
      },
    });
    const admin = mockPostAdmin({
      insertData: row,
      imageDownloadData: new Blob(["hello"], { type: "image/png" }),
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "첨부를 정확히 확인해줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 1,
      providerAttachmentManifest: manifest,
      imagePaths: [imagePath],
    }));

    expect(response.status).toBe(201);
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        amora_ingest_contract_version: 2,
        provider_attachment_count: 1,
        provider_attachment_manifest: [{
          media_type: "image/png",
          byte_length: 5,
          sha256: manifest[0].sha256,
        }],
      }),
    }));
  });

  it("rejects a v2 image path that belongs to different attachment bytes", async () => {
    const admin = mockPostAdmin();

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "泥⑤?瑜??뺥솗???뺤씤?댁쨾",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 1,
      providerAttachmentManifest: [{
        mediaType: "image/png",
        byteLength: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      }],
      imagePaths: [`${COUPLE_ID}/${USER_ID}/${MESSAGE_ID}.png`],
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PROVIDER_ATTACHMENT_IMAGE_PATH_BINDING",
    });
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("rejects a v2 image object whose stored bytes differ from its manifest before insert", async () => {
    const manifest = [{
      mediaType: "image/png",
      byteLength: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    }];
    const imagePath = await createChatImageObjectPathV2({
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      attachmentIndex: 0,
      mediaType: manifest[0].mediaType,
      sha256: manifest[0].sha256,
    });
    expect(imagePath).not.toBeNull();
    const row = canonicalUserRow({
      content: "첨부 이미지와 분석 바이트를 함께 확인해줘",
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 2,
        ai_response_requested: true,
        provider_attachment_state: "present",
        provider_attachment_count: 1,
        provider_attachment_manifest: [{
          media_type: manifest[0].mediaType,
          byte_length: manifest[0].byteLength,
          sha256: manifest[0].sha256,
        }],
        imagePaths: [imagePath],
      },
    });
    const admin = mockPostAdmin({
      insertData: row,
      imageDownloadData: new Blob(["world"], { type: "image/png" }),
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "첨부 이미지와 분석 바이트를 함께 확인해줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 1,
      providerAttachmentManifest: manifest,
      imagePaths: [imagePath],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROVIDER_ATTACHMENT_STORAGE_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(admin.downloadImage).toHaveBeenCalledWith(imagePath);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("rejects a missing v2 image object before insert", async () => {
    const manifest = [{
      mediaType: "image/png",
      byteLength: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    }];
    const imagePath = await createChatImageObjectPathV2({
      coupleId: COUPLE_ID,
      senderId: USER_ID,
      clientRequestId: REQUEST_ID,
      attachmentIndex: 0,
      mediaType: manifest[0].mediaType,
      sha256: manifest[0].sha256,
    });
    const admin = mockPostAdmin({
      imageDownloadError: { statusCode: 404, message: "object not found" },
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "Check the attached image",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 1,
      providerAttachmentManifest: manifest,
      imagePaths: [imagePath],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROVIDER_ATTACHMENT_STORAGE_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(admin.infoImage).toHaveBeenCalledWith(imagePath);
    expect(admin.downloadImage).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["empty list", []],
    ["uppercase digest", [{
      mediaType: "image/png",
      byteLength: 5,
      sha256: "2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824",
    }]],
    ["unsupported media type", [{
      mediaType: "text/plain",
      byteLength: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    }]],
    ["zero byte length", [{
      mediaType: "image/png",
      byteLength: 0,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    }]],
    ["unexpected key", [{
      mediaType: "image/png",
      byteLength: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      fileName: "private-name.png",
    }]],
  ])("rejects a malformed v2 provider manifest: %s", async (_label, providerAttachmentManifest) => {
    const admin = mockPostAdmin();

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "첨부를 정확히 확인해줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 1,
      providerAttachmentManifest,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PROVIDER_ATTACHMENT_MANIFEST",
    });
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("rejects a v2 manifest whose combined declared bytes exceed the provider limit", async () => {
    const admin = mockPostAdmin();
    const oversizedPart = Math.floor(AMORA_MAX_TOTAL_ATTACHMENT_BYTES / 2) + 1;

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "두 첨부를 함께 확인해줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 2,
      providerAttachmentManifest: [
        {
          mediaType: "application/pdf",
          byteLength: oversizedPart,
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
        {
          mediaType: "application/pdf",
          byteLength: oversizedPart,
          sha256: "486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7",
        },
      ],
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PROVIDER_ATTACHMENT_MANIFEST",
    });
    expect(admin.downloadImage).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated and cross-site cookie mutations before classification", async () => {
    mockPostAuthentication(null);
    let response = await POST(postRequest());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(planAmoraCrisisDelivery).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockPostAuthentication();
    response = await POST(postRequest(undefined, {
      Origin: "https://attacker.invalid",
    }));
    expect(response.status).toBe(403);
    expect(planAmoraCrisisDelivery).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a stale profile when the authenticated user is no longer in the current couple roster", async () => {
    const admin = mockPostAdmin({
      coupleBrideId: "00000000-0000-4000-8000-000000000099",
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHAT_SCOPE_DENIED",
    });
    expect(planAmoraCrisisDelivery).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("keeps W5 local-only before rate limiting or attachment processing", async () => {
    const rawDisclosure = "즉시 위험한 원문";
    const admin = mockPostAdmin();
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "local_safety_hold",
      safetyResolution: "immediate_crisis",
      classification: { kind: "interpersonal_danger" },
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: false,
      response: "고정 안전 안내",
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: rawDisclosure,
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      imagePaths: ["../../invalid-before-safety.webp"],
      confirmedActionId: ACTION_ID,
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      outcome: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: false,
      safetyResolution: "immediate_crisis",
      classification: "interpersonal_danger",
      response: "고정 안전 안내",
      rawDisclosurePersisted: false,
    });
    expect(JSON.stringify(payload)).not.toContain(rawDisclosure);
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
    expect(admin.messageSelect).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid 20,000-character multibyte W5 message through deterministic safety routing", async () => {
    const content = `${"가".repeat(19_950)} 즉시 위험해요`;
    expect(Array.from(content).length).toBeLessThanOrEqual(20_000);
    expect(Buffer.byteLength(content, "utf8")).toBeGreaterThan(32 * 1024);
    const admin = mockPostAdmin();
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "local_safety_hold",
      safetyResolution: "immediate_crisis",
      classification: { kind: "interpersonal_danger" },
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: false,
      response: "고정 안전 안내",
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content,
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "ephemeral_safety",
      classification: "interpersonal_danger",
      response: "고정 안전 안내",
    });
    expect(planAmoraCrisisDelivery).toHaveBeenCalledWith(expect.objectContaining({
      userText: content,
    }));
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["persisted", canonicalUserRow({ content: "정책 변경 뒤 잡힌 위험 원문" }), null, true],
    ["unknown", null, { code: "FETCH_ERROR", message: "network" }, null],
  ])(
    "does not make a false no-storage claim when a W5 retry is %s",
    async (_label, reconcileData, reconcileError, expectedPersisted) => {
      const admin = mockPostAdmin({ reconcileData, reconcileError });
      vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
        disposition: "local_safety_hold",
        safetyResolution: "immediate_crisis",
        classification: { kind: "interpersonal_danger" },
        effectiveVisibility: "bride_private",
        safetyPrivacyRedirected: true,
        partnerDeliveryHeld: false,
        response: "고정 안전 안내",
      });

      const response = await POST(postRequest({
        coupleId: COUPLE_ID,
        content: "정책 변경 뒤 잡힌 위험 원문",
        clientRequestId: REQUEST_ID,
        requestedVisibility: "shared",
      }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        outcome: "ephemeral_safety",
        rawDisclosurePersisted: expectedPersisted,
      });
      expect(admin.insert).not.toHaveBeenCalled();
      expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    },
  );

  it("routes W2 to the sender private lane and strips shared-action metadata", async () => {
    const row = canonicalUserRow({
      content: "통제받는 느낌이 들어",
      visibility: "bride_private",
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "discarded_by_safety_policy",
        provider_attachment_count: 0,
      },
    });
    const admin = mockPostAdmin({ insertData: row });
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "private_safety_route",
      safetyResolution: "non_immediate_safety",
      classification: null,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: false,
      response: null,
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "통제받는 느낌이 들어",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      confirmedActionId: ACTION_ID,
      imagePaths: [`${COUPLE_ID}/${USER_ID}/${MESSAGE_ID}.webp`],
      providerAttachmentCount: 1,
      providerAttachmentManifest: [{
        mediaType: "image/webp",
        byteLength: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      }],
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "persisted",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      safetyResolution: "non_immediate_safety",
      message: { visibility: "bride_private" },
    });
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({
      visibility: "bride_private",
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "discarded_by_safety_policy",
        provider_attachment_count: 0,
      },
    }));
  });

  it("rejects an attachment count smaller than the bound image path set", async () => {
    const admin = mockPostAdmin();

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "사진을 함께 봐줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      imagePaths: [`${COUPLE_ID}/${USER_ID}/${MESSAGE_ID}.webp`],
      providerAttachmentCount: 0,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PROVIDER_ATTACHMENT_COUNT",
    });
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("derives and persists a safe partner delivery on the server", async () => {
    const partnerRow = canonicalUserRow({
      content: "오늘 예식장 후보 같이 볼래?",
      metadata: {
        target: "partner",
        client_request_id: REQUEST_ID,
        partner_recipient_id: GROOM_ID,
      },
    });
    const admin = mockPostAdmin({ insertData: partnerRow });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "오늘 예식장 후보 같이 볼래?",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      target: "partner",
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "persisted",
      effectiveVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        metadata: {
          target: "partner",
          client_request_id: REQUEST_ID,
          partner_recipient_id: GROOM_ID,
        },
      },
    });
    expect(planAmoraCrisisDelivery).toHaveBeenCalledWith({
      userText: "오늘 예식장 후보 같이 볼래?",
      requestedVisibility: "shared",
      target: "partner",
      senderRole: "bride",
      externalSafetySignal: false,
    });
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({
      visibility: "shared",
      metadata: {
        target: "partner",
        client_request_id: REQUEST_ID,
        partner_recipient_id: GROOM_ID,
      },
    }));
  });

  it.each([
    "화나면 물건을 던지고 저를 때린 적도 있어요",
    "손찌검을 한 적이 있어요",
    "목을 조른 적도 있어요",
  ])(
    "passes the second safety branch to the delivery policy: %s",
    async (content) => {
      // 안전 판정은 두 갈래이고 planAmoraCrisisDelivery 안쪽은 한 갈래만 본다.
      // 이 문장들은 그 안쪽 갈래(classifyAmoraCrisis / assessAmoraSafetyText)에 전혀
      // 걸리지 않는다 — lib/ai/__tests__/mediationSafetyLaneGap.test.ts 가 그 사실을
      // 고정하고 있다. 호출자가 신호를 안 넘기면 이 발화는 requestedVisibility 그대로
      // 공유 레인에 저장되고, target=partner면 상대에게 전달된다.
      mockPostAdmin({ insertData: canonicalUserRow({ content }) });

      await POST(postRequest({
        coupleId: COUPLE_ID,
        content,
        clientRequestId: REQUEST_ID,
        requestedVisibility: "shared",
        target: "ai",
      }));

      expect(planAmoraCrisisDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ userText: content, externalSafetySignal: true }),
      );
    },
  );

  it("holds a server-classified W2 partner delivery locally without a write", async () => {
    const admin = mockPostAdmin();
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "local_safety_hold",
      safetyResolution: "non_immediate_safety",
      classification: null,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      partnerDeliveryHeld: true,
      response: "상대방에게 보내지 않고 안전 확인을 먼저 도와드릴게요.",
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "서버에서 새로 잡힌 위험 신호",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      target: "partner",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyResolution: "non_immediate_safety",
      partnerDeliveryHeld: true,
      rawDisclosurePersisted: false,
    });
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it.each([
    { code: "23505", message: "duplicate key" },
    { code: "FETCH_ERROR", message: "result uncertain" },
  ])("reconciles an idempotent $code insert outcome", async (insertError) => {
    mockPostAdmin({
      insertData: null,
      insertError,
      reconcileData: canonicalUserRow(),
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "persisted",
      reused: true,
      message: { id: MESSAGE_ID },
    });
  });

  it("reuses the same durable v2 row only when the ordered attachment manifest matches", async () => {
    const manifest = [{
      mediaType: "application/pdf",
      byteLength: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    }];
    mockPostAdmin({
      insertData: null,
      insertError: { code: "23505", message: "duplicate key" },
      reconcileData: canonicalUserRow({
        metadata: {
          client_request_id: REQUEST_ID,
          amora_ingest_contract_version: 2,
          ai_response_requested: true,
          provider_attachment_state: "present",
          provider_attachment_count: 1,
          provider_attachment_manifest: [{
            media_type: manifest[0].mediaType,
            byte_length: manifest[0].byteLength,
            sha256: manifest[0].sha256,
          }],
        },
      }),
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "예식장 비교 기준을 정리해줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 1,
      providerAttachmentManifest: manifest,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "persisted",
      reused: true,
    });
  });

  it("returns 409 when the same request id is retried with a different v2 attachment hash", async () => {
    mockPostAdmin({
      insertData: null,
      insertError: { code: "23505", message: "duplicate key" },
      reconcileData: canonicalUserRow({
        metadata: {
          client_request_id: REQUEST_ID,
          amora_ingest_contract_version: 2,
          ai_response_requested: true,
          provider_attachment_state: "present",
          provider_attachment_count: 1,
          provider_attachment_manifest: [{
            media_type: "application/pdf",
            byte_length: 5,
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          }],
        },
      }),
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "예식장 비교 기준을 정리해줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 1,
      providerAttachmentManifest: [{
        mediaType: "application/pdf",
        byteLength: 5,
        sha256: "3733cd977ff8eb18b987357e22ced99f46097f31ecb239e878ae63760e83e4d5",
      }],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_REQUEST_CONFLICT",
      retryPolicy: "new_message",
    });
  });

  it("returns 409 when a request id is already bound to a different row", async () => {
    mockPostAdmin({
      insertData: null,
      insertError: { code: "23505", message: "duplicate key" },
      reconcileData: canonicalUserRow({ content: "다른 원문" }),
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_REQUEST_CONFLICT",
      retryable: false,
      retryPolicy: "new_message",
    });
  });

  it.each([
    ["AI target", { client_request_id: REQUEST_ID }],
    [
      "another recipient",
      {
        target: "partner",
        client_request_id: REQUEST_ID,
        partner_recipient_id: "00000000-0000-4000-8000-000000000099",
      },
    ],
  ])("returns 409 when a partner retry reconciles to %s", async (_label, metadata) => {
    mockPostAdmin({
      insertData: null,
      insertError: { code: "23505", message: "duplicate key" },
      reconcileData: canonicalUserRow({
        content: "오늘 예식장 후보 같이 볼래?",
        metadata,
      }),
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "오늘 예식장 후보 같이 볼래?",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      target: "partner",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_REQUEST_CONFLICT",
      retryPolicy: "new_message",
    });
  });

  it("fails closed when an uncertain insert cannot be reconciled", async () => {
    mockPostAdmin({
      insertData: null,
      insertError: { code: "FETCH_ERROR", message: "network" },
      reconcileError: { code: "FETCH_ERROR", message: "network" },
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_PERSISTENCE_UNKNOWN",
      retryable: true,
      retryPolicy: "same_request",
    });
  });

  it("rejects client-controlled sender identity and malformed ordinary attachments", async () => {
    mockPostAdmin();
    let response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "상대에게 보내줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      target: "partner",
      senderId: GROOM_ID,
    }));
    expect(response.status).toBe(400);
    expect(planAmoraCrisisDelivery).not.toHaveBeenCalled();

    response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "사진을 봐줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      imagePaths: [`${COUPLE_ID}/${GROOM_ID}/${MESSAGE_ID}.webp`],
    }));
    expect(response.status).toBe(400);
    expect(planAmoraCrisisDelivery).toHaveBeenCalledTimes(1);
    expect(checkRateLimitPersistent).toHaveBeenCalledTimes(1);
  });

  it("rejects another role's private lane after server classification", async () => {
    const admin = mockPostAdmin();
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "continue",
      classification: null,
      effectiveVisibility: "groom_private",
      safetyPrivacyRedirected: false,
      partnerDeliveryHeld: false,
      response: null,
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: "비공개로 정리해줘",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "groom_private",
    }));

    expect(response.status).toBe(403);
    expect(planAmoraCrisisDelivery).toHaveBeenCalledTimes(1);
    expect(admin.insert).not.toHaveBeenCalled();
  });
});
