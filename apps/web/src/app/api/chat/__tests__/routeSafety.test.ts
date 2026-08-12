import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class PersistenceError extends Error {
    readonly code = "AI_MESSAGE_PERSISTENCE_FAILED";
  }
  class ClaimError extends Error {
    readonly code = "CHAT_REQUEST_CLAIM_FAILED";
  }
  class PrivacyContextError extends Error {
    constructor(readonly code:
      | "AMORA_PRIVACY_CONTEXT_UNAVAILABLE"
      | "AMORA_PRIVACY_CONTEXT_CHANGED") {
      super(code);
      this.name = "AmoraPrivacyContextError";
    }
  }
  return {
    profile: {
      couple_id: "10000000-0000-4000-8000-000000000001",
      role: "bride",
      is_admin: false,
    },
    reserve: vi.fn(),
    findPersisted: vi.fn(),
    reconcile: vi.fn(),
    claim: vi.fn(),
    rateLimit: vi.fn(),
    provider: vi.fn(),
    enqueueMemory: vi.fn(),
    verifyMemoryRepair: vi.fn(),
    getPrivacyEpoch: vi.fn(),
    PersistenceError,
    ClaimError,
    PrivacyContextError,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      })),
    },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { ...mocks.profile }, error: null })),
        })),
      })),
    })),
  })),
}));

vi.mock("@/utils/rateLimit", () => ({
  rateLimitKey: vi.fn(() => "chat:test"),
  checkRateLimitPersistent: mocks.rateLimit,
}));

vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
}));

vi.mock("@/lib/ai/costGuard", () => ({
  reserveAmoraTurn: mocks.reserve,
}));

vi.mock("@/lib/ai/chatMessagePersistence", () => ({
  AiMessagePersistenceError: mocks.PersistenceError,
  findPersistedAiMessage: mocks.findPersisted,
  persistAiMessage: vi.fn(),
}));

vi.mock("@/lib/ai/chatRequestClaim", () => ({
  ChatRequestClaimError: mocks.ClaimError,
  claimChatRequest: mocks.claim,
  reconcileChatRequest: mocks.reconcile,
  completeChatRequest: vi.fn(),
  failChatRequest: vi.fn(),
}));

vi.mock("@/lib/ai/openai", () => ({
  chatWithToolsStream: mocks.provider,
  buildToolResultInput: vi.fn(),
  buildMultimodalContent: vi.fn(),
}));

vi.mock("@/lib/ai/amoraMemoryQueue", () => ({
  AmoraPrivacyContextError: mocks.PrivacyContextError,
  getAmoraPrivacyContextSnapshot: vi.fn(),
  getAmoraPrivacyEpoch: mocks.getPrivacyEpoch,
  assertAmoraPrivacyContextSnapshotCurrent: vi.fn(),
  enqueueAmoraMemoryJob: mocks.enqueueMemory,
}));

vi.mock("@/lib/ai/amoraMemoryRepair", () => ({
  verifyAmoraMemoryEnqueueRepairCandidate: mocks.verifyMemoryRepair,
}));

import { POST } from "@/app/api/chat/route";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000099";

function request(
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ role: "user", content: "안녕하세요" }],
    coupleId: COUPLE_ID,
    clientRequestId: REQUEST_ID,
    visibility: "shared",
    ...overrides,
  };
}

describe("POST /api/chat safety ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile.couple_id = COUPLE_ID;
    mocks.profile.role = "bride";
    mocks.reserve.mockResolvedValue({ allowed: true, remaining: 99 });
    mocks.findPersisted.mockResolvedValue(null);
    mocks.reconcile.mockResolvedValue(true);
    mocks.claim.mockResolvedValue({ action: "acquired", attemptCount: 1, reclaimed: false });
    mocks.rateLimit.mockResolvedValue(null);
    mocks.enqueueMemory.mockResolvedValue("disabled");
    mocks.verifyMemoryRepair.mockResolvedValue({ status: "unavailable" });
    mocks.getPrivacyEpoch.mockResolvedValue(7);
  });

  it("rejects malformed messages before claim, quota reservation, or provider work", async () => {
    const response = await POST(request(validBody({ messages: [{ role: "system", content: "x" }] })));
    expect(response.status).toBe(400);
    expect(mocks.findPersisted).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects an account-switched v2 stream before claim, quota, or provider work", async () => {
    const response = await POST(request(validBody(), {
      "X-Hanbang-Mutation-Contract-Version": "2",
      "X-Hanbang-Expected-Actor-User-Id": "00000000-0000-4000-8000-000000000002",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MUTATION_ACTOR_CHANGED",
    });
    expect(mocks.findPersisted).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects a malformed confirmed action id before claim, quota, or provider work", async () => {
    const response = await POST(request(validBody({ confirmedActionId: "not-a-uuid" })));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_CONFIRMED_ACTION_ID",
    });
    expect(mocks.findPersisted).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects partner-private visibility before claim or quota reservation", async () => {
    const response = await POST(request(validBody({ visibility: "groom_private" })));
    expect(response.status).toBe(403);
    expect(mocks.findPersisted).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("reconciles and replays a committed message without quota, model, or tools", async () => {
    mocks.findPersisted.mockResolvedValue({
      id: "20000000-0000-4000-8000-000000000001",
      createdAt: "2026-07-14T00:00:00.000Z",
      content: "이미 저장된 답변",
      metadata: { suggestions: ["다음 단계"] },
      stageTag: "planning_0",
      specialistType: null,
      visibility: "shared",
      reused: true,
    });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("이미 저장된 답변");
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      coupleId: COUPLE_ID,
      messageId: "20000000-0000-4000-8000-000000000001",
      visibility: "shared",
    }));
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("withholds a persisted replay when the request-bound privacy epoch changes", async () => {
    const privatePersistedContent = "PRIVATE_PERSISTED_REPLAY_MUST_NOT_FLASH";
    mocks.findPersisted.mockResolvedValue({
      id: "20000000-0000-4000-8000-000000000031",
      createdAt: "2026-07-14T00:00:00.000Z",
      content: privatePersistedContent,
      metadata: { suggestions: ["PRIVATE_REPLAY_SUGGESTION"] },
      stageTag: "planning_0",
      specialistType: null,
      visibility: "shared",
      reused: true,
    });
    mocks.getPrivacyEpoch
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(8);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request(validBody()));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(JSON.parse(body)).toMatchObject({
      code: "AMORA_PRIVACY_CONTEXT_CHANGED",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(body).not.toContain(privatePersistedContent);
    expect(body).not.toContain("PRIVATE_REPLAY_SUGGESTION");
    expect(mocks.getPrivacyEpoch).toHaveBeenCalledTimes(2);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("recovers an exact persisted retry before an ordinary 429", async () => {
    mocks.findPersisted.mockResolvedValue({
      id: "20000000-0000-4000-8000-000000000021",
      createdAt: "2026-07-14T00:00:00.000Z",
      content: "429보다 먼저 복구된 답변",
      metadata: { memory_eligible: false },
      stageTag: null,
      specialistType: "general",
      visibility: "shared",
      reused: true,
    });
    mocks.rateLimit.mockResolvedValue(new Response("limited", { status: 429 }));

    const response = await POST(request(validBody()));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("429보다 먼저 복구된 답변");
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("recovers an exact persisted retry before validating a malformed resent attachment", async () => {
    mocks.findPersisted.mockResolvedValue({
      id: "20000000-0000-4000-8000-000000000022",
      createdAt: "2026-07-14T00:00:00.000Z",
      content: "재첨부 오류보다 먼저 복구된 답변",
      metadata: { memory_eligible: false },
      stageTag: null,
      specialistType: "general",
      visibility: "shared",
      reused: true,
    });

    const response = await POST(request(validBody({
      attachments: [{
        kind: "image",
        fileName: "remote.png",
        url: "https://example.test/private.png",
      }],
    })));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("재첨부 오류보다 먼저 복구된 답변");
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("keeps the exact retry contract across repeated persisted memory enqueue failures", async () => {
    mocks.findPersisted.mockResolvedValue({
      id: "20000000-0000-4000-8000-000000000011",
      createdAt: "2026-07-14T00:00:00.000Z",
      content: "이미 저장된 웨딩 답변",
      metadata: {
        question_scope: "W0_wedding_core",
        memory_eligible: true,
      },
      stageTag: "planning_0",
      specialistType: null,
      visibility: "shared",
      reused: true,
    });
    mocks.enqueueMemory
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("queued");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const first = await POST(request(validBody()));
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({
      code: "AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED",
      retryable: true,
      retryPolicy: "same_request",
    });

    const second = await POST(request(validBody()));
    expect(second.status).toBe(503);
    await expect(second.json()).resolves.toMatchObject({
      code: "AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED",
      retryable: true,
      retryPolicy: "same_request",
    });

    const retry = await POST(request(validBody()));
    expect(retry.status).toBe(200);
    expect(await retry.text()).toContain("이미 저장된 웨딩 답변");
    expect(mocks.enqueueMemory).toHaveBeenCalledTimes(3);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("replays a persisted eligible answer when its exact durable repair proof is confirmed", async () => {
    mocks.findPersisted.mockResolvedValue({
      id: "20000000-0000-4000-8000-000000000012",
      createdAt: "2026-07-14T00:00:00.000Z",
      content: "복구 큐가 보장한 저장 답변",
      metadata: {
        question_scope: "W0_wedding_core",
        memory_eligible: true,
      },
      stageTag: "planning_0",
      specialistType: null,
      visibility: "shared",
      reused: true,
    });
    mocks.enqueueMemory.mockResolvedValueOnce("failed");
    mocks.verifyMemoryRepair.mockResolvedValueOnce({ status: "confirmed" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request(validBody()));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("복구 큐가 보장한 저장 답변");
    expect(mocks.verifyMemoryRepair).toHaveBeenCalledWith(expect.objectContaining({
      coupleId: COUPLE_ID,
      userId: "00000000-0000-4000-8000-000000000001",
      visibility: "shared",
      toMessageId: "20000000-0000-4000-8000-000000000012",
    }));
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("fails closed instead of regenerating when a persisted response cannot be reconciled", async () => {
    mocks.findPersisted.mockResolvedValue({
      id: "20000000-0000-4000-8000-000000000002",
      createdAt: "2026-07-14T00:00:00.000Z",
      content: "이미 저장된 답변",
      metadata: {},
      stageTag: "planning_0",
      specialistType: null,
      visibility: "shared",
      reused: true,
    });
    mocks.reconcile.mockRejectedValue(new Error("database unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request(validBody()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHAT_REPLAY_RECONCILIATION_FAILED",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("fails closed when reconciliation explicitly reports that no matching claim exists", async () => {
    mocks.findPersisted.mockResolvedValue({
      id: "20000000-0000-4000-8000-000000000003",
      createdAt: "2026-07-14T00:00:00.000Z",
      content: "이미 저장된 안전 응답",
      metadata: { response_origin: "deterministic_crisis_safety" },
      stageTag: null,
      specialistType: null,
      visibility: "shared",
      reused: true,
    });
    mocks.reconcile.mockResolvedValue(false);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request(validBody()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHAT_REPLAY_RECONCILIATION_FAILED",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("returns an observable in-progress response without spending quota", async () => {
    mocks.claim.mockResolvedValue({ action: "in_progress", attemptCount: 1, retryAfterMs: 2000 });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.json()).toMatchObject({
      code: "CHAT_REQUEST_IN_PROGRESS",
      retryable: true,
      retryPolicy: "same_request",
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("marks an immutable request-key conflict as new-message-only", async () => {
    mocks.claim.mockResolvedValue({ action: "conflict", attemptCount: 1 });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "CHAT_REQUEST_CONFLICT",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("marks a completed claim without its exact persisted answer as new-message-only", async () => {
    mocks.claim.mockResolvedValue({
      action: "completed",
      attemptCount: 1,
      messageId: "20000000-0000-4000-8000-000000000099",
    });
    mocks.findPersisted.mockResolvedValue(null);

    const response = await POST(request(validBody()));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "CHAT_REPLAY_INCONSISTENT",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
