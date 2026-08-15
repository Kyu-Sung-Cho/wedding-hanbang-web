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
import { buildAmoraFirstUsePromotionSourceSeal } from "@/lib/ai/amoraFirstUsePromotion";
import { resolveAmoraScheduleCareFollowUp } from "@/lib/care/scheduleCareFollowUp";
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
vi.mock("@/lib/care/scheduleCareFollowUp", () => ({
  resolveAmoraScheduleCareFollowUp: vi.fn(),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const ACTION_ID = "30000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const SOURCE_MESSAGE_ID = "60000000-0000-4000-8000-000000000001";
const PROMOTION_ID = "70000000-0000-4000-8000-000000000001";
const FOLLOW_UP_CARD_ID = "80000000-0000-4000-8000-000000000001";
const FOLLOW_UP_PROMPT = [
  "어제 상견례에서 실제로 합의된 것과 아직 이야기 중인 것을 나만 아모라와 정리할게요.",
  "",
  "어제 분위기 어땠어? 실제로 합의된 내용과 아직 의견만 나온 내용을 나눠서 정리해볼까?",
  "",
  "내 답:",
].join("\n");
const FOLLOW_UP_CONTENT = `${FOLLOW_UP_PROMPT} 실제로 합의된 것은 예식 시기를 다시 확인하는 거예요.`;

function resolvedFollowUp(prompt = FOLLOW_UP_PROMPT) {
  return {
    ok: true,
    value: {
      recipientUserId: USER_ID,
      coupleId: COUPLE_ID,
      actorRole: "bride" as const,
      privacyEpoch: 5,
      binding: {
        cardId: FOLLOW_UP_CARD_ID,
        cardRevision: 2,
        sourceRevision: 7,
      },
      expiresAt: "2026-08-15T15:00:00.000Z",
      sourceKey: "schedule:opaque:d_after",
      sourceStateDigest: "a".repeat(64),
      sourceEventId: "private-event-id-not-for-metadata",
      momentType: "sanggyeonrye" as const,
      attentionWindow: "dAfter" as const,
      eventTitle: "상견례",
      eventDate: "2026-08-14 12:30",
      question: "어제 분위기 어땠어?",
      prompt,
    },
  } as const;
}

function followUpRequest(overrides: Record<string, unknown> = {}, v2 = true) {
  return postRequest({
    coupleId: COUPLE_ID,
    content: FOLLOW_UP_CONTENT,
    clientRequestId: REQUEST_ID,
    requestedVisibility: "bride_private",
    providerAttachmentCount: 0,
    scheduleCareFollowUp: {
      cardId: FOLLOW_UP_CARD_ID,
      cardRevision: 2,
      sourceRevision: 7,
    },
    ...overrides,
  }, v2 ? {
    Authorization: "Bearer mobile-access-token",
    "X-Amora-Ingest-Contract-Version": "2",
    "X-Amora-Expected-Actor-User-Id": USER_ID,
  } : {
    Origin: "http://localhost",
  });
}
const CLEARED_AT = "2026-07-31T01:02:03.000Z";
const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/chat/messages/route.ts"),
  "utf8",
);

function request(
  body: unknown = { coupleId: COUPLE_ID, mode: "delete_private" },
  trusted = true,
  actorHeaders: Record<string, string> = {},
) {
  return new Request("http://localhost/api/chat/messages", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(trusted ? { Origin: "http://localhost" } : { Origin: "https://attacker.invalid" }),
      ...actorHeaders,
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
  safetyHoldRpcError?: unknown;
  promotionSourceData?: Record<string, unknown> | null;
  promotionSourceError?: unknown;
  promotionSharedData?: Record<string, unknown> | null;
  promotionSharedError?: unknown;
  promotionRpcData?: Record<string, unknown> | null;
  promotionRpcError?: unknown;
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

const firstUseDraft = {
  action: "예식 시기 후보 두 개 적기",
  reason: "먼저 범위를 줄이면 장소를 찾기 쉬워져요.",
  completionCriterion: "가능한 시기 두 개를 적으면 끝나요.",
};
const firstUseSharedText = [
  "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
  `지금 할 한 가지: ${firstUseDraft.action}`,
  `이유: ${firstUseDraft.reason}`,
  `완료 기준: ${firstUseDraft.completionCriterion}`,
  "저장 전에는 확인 카드만 보여줘.",
].join("\n");
const firstUseSourceContent = [
  "한 가지만 먼저 해볼게요.",
  `지금 할 한 가지: ${firstUseDraft.action}`,
  `이유: ${firstUseDraft.reason}`,
  `완료 기준: ${firstUseDraft.completionCriterion}`,
].join("\n");
const firstUseSourceSeal = buildAmoraFirstUsePromotionSourceSeal({
  content: firstUseSourceContent,
  grounding: {
    version: 1,
    sourceRevision: 7,
    confirmed: [],
    unknowns: [{ key: "current_progress", label: "이미 마친 준비와 아직 남은 준비" }],
  },
  sourceRevision: 7,
  criterionDecisionId: null,
  privacyEpoch: 5,
  rosterFingerprint: "a".repeat(32),
});

function canonicalFirstUseSourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SOURCE_MESSAGE_ID,
    couple_id: COUPLE_ID,
    sender_id: null,
    sender_type: "ai",
    sender_role: null,
    role: "assistant",
    content: firstUseSourceContent,
    metadata: {
      amora_first_use_action_promotion_v1: firstUseSourceSeal?.metadata,
    },
    stage_tag: null,
    specialist_type: "general",
    visibility: "bride_private",
    segment_id: "50000000-0000-4000-8000-000000000001",
    created_at: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

function canonicalFirstUseSharedRow(overrides: Record<string, unknown> = {}) {
  return canonicalUserRow({
    content: firstUseSharedText,
    metadata: {
      client_request_id: REQUEST_ID,
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
      amora_first_use_promotion_id: PROMOTION_ID,
    },
    ...overrides,
  });
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
  const messageByIdMaybeSingle = vi.fn(async (id: string) => ({
    data: id === SOURCE_MESSAGE_ID
      ? options.promotionSourceData === undefined
        ? canonicalFirstUseSourceRow()
        : options.promotionSourceData
      : options.promotionSharedData === undefined
        ? null
        : options.promotionSharedData,
    error: id === SOURCE_MESSAGE_ID
      ? options.promotionSourceError ?? null
      : options.promotionSharedError ?? null,
  }));
  const messageSelectEq = vi.fn((field: string, value: string) => {
    if (field === "id") {
      return { maybeSingle: () => messageByIdMaybeSingle(value) };
    }
    return { eq: reconcileEqRequest };
  });
  const messageSelect = vi.fn(() => ({ eq: messageSelectEq }));

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
  const rpc = vi.fn(async (name: string) => name === "ingest_amora_first_use_action_promotion_v1"
    ? {
        data: options.promotionRpcData ?? null,
        error: options.promotionRpcError ?? null,
      }
    : {
        data: options.safetyHoldRpcError
          ? null
          : {
              version: 1,
              recipientUserId: USER_ID,
              coupleId: COUPLE_ID,
              privacyEpoch: 5,
              active: true,
              expiresAt: "2026-09-13T00:00:00.000Z",
            },
        error: options.safetyHoldRpcError ?? null,
      });
  vi.mocked(createAdminClient).mockReturnValue({
    from,
    rpc,
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
    messageByIdMaybeSingle,
    storageFrom,
    infoImage,
    downloadImage,
    downloadImageStream,
    rpc,
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

  it("rejects an account-switched v2 delete before RPC or service-role access", async () => {
    const rpc = mockAuthenticatedRpc({ data: null, error: null });

    const response = await DELETE(request(undefined, true, {
      "X-Hanbang-Mutation-Contract-Version": "2",
      "X-Hanbang-Expected-Actor-User-Id": GROOM_ID,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MUTATION_ACTOR_CHANGED",
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
    vi.mocked(resolveAmoraScheduleCareFollowUp).mockResolvedValue({
      ok: false,
      reason: "source_unavailable",
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

  it("revalidates and persists one exact current D+1 binding only in the owner's private AI lane", async () => {
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "continue",
      classification: null,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
      partnerDeliveryHeld: false,
      response: null,
    });
    vi.mocked(resolveAmoraScheduleCareFollowUp).mockResolvedValue(resolvedFollowUp());
    const metadata = {
      client_request_id: REQUEST_ID,
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
      amora_schedule_care_follow_up_v1: {
        version: 1,
        card_id: FOLLOW_UP_CARD_ID,
        card_revision: 2,
        source_revision: 7,
      },
    };
    const admin = mockPostAdmin({
      insertData: canonicalUserRow({
        content: FOLLOW_UP_CONTENT,
        visibility: "bride_private",
        metadata,
      }),
    });

    const response = await POST(followUpRequest());

    expect(response.status).toBe(201);
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({
      couple_id: COUPLE_ID,
      sender_id: USER_ID,
      content: FOLLOW_UP_CONTENT,
      visibility: "bride_private",
      metadata,
    }));
    const body = await response.json();
    expect(body.message.metadata).toEqual(metadata);
    const durable = JSON.stringify(body.message.metadata);
    expect(durable).not.toContain("상견례");
    expect(durable).not.toContain("어제 분위기");
    expect(durable).not.toContain("실제로 합의된");
    expect(durable).not.toContain("예식 시기");
    expect(durable).not.toContain("schedule:opaque");
    expect(durable).not.toContain("private-event-id");
  });

  it("recovers an exact committed D+1 row before source revalidation on the same immutable retry", async () => {
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "continue",
      classification: null,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
      partnerDeliveryHeld: false,
      response: null,
    });
    vi.mocked(resolveAmoraScheduleCareFollowUp).mockResolvedValue({
      ok: false,
      reason: "card_stale",
    });
    const metadata = {
      client_request_id: REQUEST_ID,
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
      amora_schedule_care_follow_up_v1: {
        version: 1,
        card_id: FOLLOW_UP_CARD_ID,
        card_revision: 2,
        source_revision: 7,
      },
    };
    const admin = mockPostAdmin({
      reconcileData: canonicalUserRow({
        content: FOLLOW_UP_CONTENT,
        visibility: "bride_private",
        metadata,
      }),
    });

    const response = await POST(followUpRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "persisted",
      reused: true,
      effectiveVisibility: "bride_private",
      message: { id: MESSAGE_ID, metadata },
    });
    expect(resolveAmoraScheduleCareFollowUp).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(admin.storageFrom).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("fails closed before source revalidation when a D+1 request id belongs to another binding", async () => {
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "continue",
      classification: null,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
      partnerDeliveryHeld: false,
      response: null,
    });
    const admin = mockPostAdmin({
      reconcileData: canonicalUserRow({
        content: FOLLOW_UP_CONTENT,
        visibility: "bride_private",
        metadata: {
          client_request_id: REQUEST_ID,
          amora_ingest_contract_version: 1,
          ai_response_requested: true,
          provider_attachment_state: "none",
          provider_attachment_count: 0,
          amora_schedule_care_follow_up_v1: {
            version: 1,
            card_id: FOLLOW_UP_CARD_ID,
            card_revision: 3,
            source_revision: 7,
          },
        },
      }),
    });

    const response = await POST(followUpRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_REQUEST_CONFLICT",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(resolveAmoraScheduleCareFollowUp).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(admin.storageFrom).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("does not recover a D+1 retry row carrying raw source context outside the opaque binding", async () => {
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "continue",
      classification: null,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
      partnerDeliveryHeld: false,
      response: null,
    });
    const admin = mockPostAdmin({
      reconcileData: canonicalUserRow({
        content: FOLLOW_UP_CONTENT,
        visibility: "bride_private",
        metadata: {
          client_request_id: REQUEST_ID,
          amora_ingest_contract_version: 1,
          ai_response_requested: true,
          provider_attachment_state: "none",
          provider_attachment_count: 0,
          amora_schedule_care_follow_up_v1: {
            version: 1,
            card_id: FOLLOW_UP_CARD_ID,
            card_revision: 2,
            source_revision: 7,
          },
          event_title: "raw source title must never persist",
        },
      }),
    });

    const response = await POST(followUpRequest());

    expect(response.status).toBe(409);
    expect(resolveAmoraScheduleCareFollowUp).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(admin.storageFrom).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["scope_changed", 403],
    ["privacy_unavailable", 503],
    ["source_unavailable", 503],
    ["journey_stale", 409],
    ["card_stale", 409],
    ["signal_stale", 409],
    ["moment_stale", 409],
  ] as const)(
    "does not consume a rate bucket or write when D+1 resolution is %s",
    async (reason, status) => {
      vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
        disposition: "continue",
        classification: null,
        effectiveVisibility: "bride_private",
        safetyPrivacyRedirected: false,
        partnerDeliveryHeld: false,
        response: null,
      });
      vi.mocked(resolveAmoraScheduleCareFollowUp).mockResolvedValue({ ok: false, reason });
      const admin = mockPostAdmin();

      const response = await POST(followUpRequest());

      expect(response.status).toBe(status);
      expect(checkRateLimitPersistent).not.toHaveBeenCalled();
      expect(admin.storageFrom).not.toHaveBeenCalled();
      expect(admin.insert).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["missing answer", FOLLOW_UP_PROMPT],
    ["prefix edited", FOLLOW_UP_CONTENT.replace("나만", "함께")],
    ["text inserted before prefix", `앞 문장 ${FOLLOW_UP_CONTENT}`],
    ["different prompt", `${FOLLOW_UP_PROMPT.replace("상견례", "예식장")} 답`],
  ])("rejects a %s without rate, attachment, or message writes", async (_label, content) => {
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "continue",
      classification: null,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
      partnerDeliveryHeld: false,
      response: null,
    });
    vi.mocked(resolveAmoraScheduleCareFollowUp).mockResolvedValue(resolvedFollowUp());
    const admin = mockPostAdmin();

    const response = await POST(followUpRequest({ content }));

    expect(response.status).toBe(409);
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(admin.storageFrom).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["shared lane", { requestedVisibility: "shared" }, true],
    ["partner target", { target: "partner", requestedVisibility: "shared" }, true],
    ["legacy actor contract", {}, false],
    [
      "extra binding field",
      {
        scheduleCareFollowUp: {
          cardId: FOLLOW_UP_CARD_ID,
          cardRevision: 2,
          sourceRevision: 7,
          eventTitle: "상견례",
        },
      },
      true,
    ],
    ["extra top-level field", { eventTitle: "상견례" }, true],
  ] as const)("rejects %s before source resolution or persistence", async (_label, overrides, v2) => {
    const admin = mockPostAdmin();

    const response = await POST(followUpRequest(overrides, v2));

    expect([400, 426]).toContain(response.status);
    expect(resolveAmoraScheduleCareFollowUp).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("requires the current zero-attachment AI envelope for a D+1 private ingest", async () => {
    vi.mocked(planAmoraCrisisDelivery).mockReturnValue({
      disposition: "continue",
      classification: null,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
      partnerDeliveryHeld: false,
      response: null,
    });
    const admin = mockPostAdmin();

    const response = await POST(followUpRequest({
      providerAttachmentCount: undefined,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "SCHEDULE_CARE_FOLLOW_UP_REQUEST_INVALID",
    });
    expect(resolveAmoraScheduleCareFollowUp).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("atomically promotes one current private source without exposing its id in shared metadata", async () => {
    const sharedRow = canonicalFirstUseSharedRow();
    const admin = mockPostAdmin({
      promotionSharedData: sharedRow,
      promotionRpcData: {
        version: 1,
        promotionId: PROMOTION_ID,
        sharedMessageId: MESSAGE_ID,
        reused: false,
      },
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: firstUseSharedText,
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 0,
      firstUseSourceMessageId: SOURCE_MESSAGE_ID,
    }, {
      Authorization: "Bearer mobile-access-token",
      Origin: "http://localhost",
      "X-Amora-Ingest-Contract-Version": "2",
      "X-Amora-Expected-Actor-User-Id": USER_ID,
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      outcome: "persisted",
      reused: false,
      effectiveVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        metadata: { amora_first_use_promotion_id: PROMOTION_ID },
      },
    });
    expect(JSON.stringify(body)).not.toContain(SOURCE_MESSAGE_ID);
    expect(admin.insert).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith(
      "ingest_amora_first_use_action_promotion_v1",
      {
        p_couple_id: COUPLE_ID,
        p_owner_user_id: USER_ID,
        p_source_private_message_id: SOURCE_MESSAGE_ID,
        p_client_request_id: REQUEST_ID,
        p_content: firstUseSharedText,
        p_source_content_digest: firstUseSourceSeal?.metadata.sourceContentDigest,
        p_canonical_action_input: firstUseDraft,
        p_action_digest: firstUseSourceSeal?.metadata.actionDigest,
        p_shared_content_digest: firstUseSourceSeal?.metadata.sharedContentDigest,
      },
    );
  });

  it("reuses the one canonical shared row for the same private source on another request", async () => {
    const earlierRequestId = "20000000-0000-4000-8000-000000000099";
    const admin = mockPostAdmin({
      promotionSharedData: canonicalFirstUseSharedRow({
        metadata: {
          ...canonicalFirstUseSharedRow().metadata,
          client_request_id: earlierRequestId,
        },
      }),
      promotionRpcData: {
        version: 1,
        promotionId: PROMOTION_ID,
        sharedMessageId: MESSAGE_ID,
        reused: true,
      },
    });

    const response = await POST(postRequest({
      coupleId: COUPLE_ID,
      content: firstUseSharedText,
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 0,
      firstUseSourceMessageId: SOURCE_MESSAGE_ID,
    }, {
      Authorization: "Bearer mobile-access-token",
      Origin: "http://localhost",
      "X-Amora-Ingest-Contract-Version": "2",
      "X-Amora-Expected-Actor-User-Id": USER_ID,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "persisted",
      reused: true,
      reusedBy: "first_use_source",
      message: { id: MESSAGE_ID },
    });
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("rejects stale, edited, or client-forged first-use provenance without a generic insert", async () => {
    const staleAdmin = mockPostAdmin({
      promotionRpcError: { message: "AMORA_FIRST_USE_PROMOTION_JOURNEY_CHANGED" },
    });
    const base = {
      coupleId: COUPLE_ID,
      content: firstUseSharedText,
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      providerAttachmentCount: 0,
      firstUseSourceMessageId: SOURCE_MESSAGE_ID,
    };
    const headers = {
      Authorization: "Bearer mobile-access-token",
      Origin: "http://localhost",
      "X-Amora-Ingest-Contract-Version": "2",
      "X-Amora-Expected-Actor-User-Id": USER_ID,
    };

    const stale = await POST(postRequest(base, headers));
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "FIRST_USE_PROMOTION_STALE",
    });
    expect(staleAdmin.insert).not.toHaveBeenCalled();

    const editedAdmin = mockPostAdmin();
    const edited = await POST(postRequest({
      ...base,
      content: `${firstUseSharedText} 바꿈`,
    }, headers));
    expect(edited.status).toBe(409);
    expect(editedAdmin.rpc).not.toHaveBeenCalledWith(
      "ingest_amora_first_use_action_promotion_v1",
      expect.anything(),
    );
    expect(editedAdmin.insert).not.toHaveBeenCalled();

    const forgedAdmin = mockPostAdmin();
    const forged = await POST(postRequest({
      ...base,
      sourceRevision: 7,
    }, headers));
    expect(forged.status).toBe(400);
    expect(forgedAdmin.rpc).not.toHaveBeenCalled();
    expect(forgedAdmin.insert).not.toHaveBeenCalled();
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
      "X-Amora-Ingest-Contract-Version": "2",
      "X-Amora-Expected-Actor-User-Id": USER_ID,
    });

    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(createClientFromRequest).toHaveBeenCalledWith(req);
  });

  it("temporarily accepts a headerless legacy Bearer ingest during the mixed-fleet phase", async () => {
    mockPostAdmin();
    const req = postRequest(undefined, {
      Authorization: "Bearer mobile-access-token",
    });

    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(createClientFromRequest).toHaveBeenCalledWith(req);
  });

  it("rejects a v2 native Bearer ingest without a draft actor binding", async () => {
    const admin = mockPostAdmin();
    const response = await POST(postRequest(undefined, {
      Authorization: "Bearer mobile-access-token",
      "X-Amora-Ingest-Contract-Version": "2",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHAT_ACTOR_BINDING_REQUIRED",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(planAmoraCrisisDelivery).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("rejects a native ingest when the draft actor differs from the Bearer owner", async () => {
    const admin = mockPostAdmin();
    const response = await POST(postRequest(undefined, {
      Authorization: "Bearer mobile-access-token",
      "X-Amora-Ingest-Contract-Version": "2",
      "X-Amora-Expected-Actor-User-Id": GROOM_ID,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHAT_ACTOR_CHANGED",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(planAmoraCrisisDelivery).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("rejects a generic account-switched v2 ingest before classification or service writes", async () => {
    const admin = mockPostAdmin();
    const response = await POST(postRequest(undefined, {
      Origin: "http://localhost",
      "X-Hanbang-Mutation-Contract-Version": "2",
      "X-Hanbang-Expected-Actor-User-Id": GROOM_ID,
      "X-Amora-Ingest-Contract-Version": "2",
      "X-Amora-Expected-Actor-User-Id": USER_ID,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MUTATION_ACTOR_CHANGED",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(planAmoraCrisisDelivery).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
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
      durableSafetyFenceConfirmed: true,
    });
    expect(JSON.stringify(payload)).not.toContain(rawDisclosure);
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
    expect(admin.messageSelect).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith(
      "seal_amora_mediation_private_safety_hold",
      { p_couple_id: COUPLE_ID, p_recipient_user_id: USER_ID },
    );
  });

  it("keeps fixed W5 guidance compatible with a legacy client when the durable seal fails", async () => {
    const admin = mockPostAdmin({
      safetyHoldRpcError: { code: "SERVICE_UNAVAILABLE", message: "unavailable" },
    });
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
      content: "지금 위험해요",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "ephemeral_safety",
      response: "고정 안전 안내",
      durableSafetyFenceConfirmed: false,
    });
    expect(admin.insert).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("returns the same no-write W5 safety envelope as 503 to a v2 client when the durable seal fails", async () => {
    const admin = mockPostAdmin({
      safetyHoldRpcError: { code: "SERVICE_UNAVAILABLE", message: "unavailable" },
    });
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
      content: "지금 위험해요",
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
    }, {
      Origin: "http://localhost",
      "x-amora-ingest-contract-version": "2",
      "x-amora-expected-actor-user-id": USER_ID,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "ephemeral_safety",
      response: "고정 안전 안내",
      durableSafetyFenceConfirmed: false,
    });
    expect(admin.insert).not.toHaveBeenCalled();
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
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
    ["legacy", { Origin: "http://localhost" }, 200],
    ["v2", {
      Origin: "http://localhost",
      "x-amora-ingest-contract-version": "2",
      "x-amora-expected-actor-user-id": USER_ID,
    }, 503],
  ])(
    "keeps a %s W2 safety response private and write-free when the durable seal fails",
    async (_contract, headers, expectedStatus) => {
      const admin = mockPostAdmin({
        safetyHoldRpcError: { code: "SERVICE_UNAVAILABLE", message: "unavailable" },
      });
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
        content: "상대에게 보내기 전에 안전하게 확인해줘",
        clientRequestId: REQUEST_ID,
        requestedVisibility: "shared",
        target: "ai",
      }, headers));

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toMatchObject({
        outcome: "ephemeral_safety",
        effectiveVisibility: "bride_private",
        safetyPrivacyRedirected: true,
        durableSafetyFenceConfirmed: false,
        rawDisclosurePersisted: false,
      });
      expect(checkRateLimitPersistent).not.toHaveBeenCalled();
      expect(admin.insert).not.toHaveBeenCalled();
    },
  );

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
    expect(admin.rpc).toHaveBeenCalledWith(
      "seal_amora_mediation_private_safety_hold",
      { p_couple_id: COUPLE_ID, p_recipient_user_id: USER_ID },
    );
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
