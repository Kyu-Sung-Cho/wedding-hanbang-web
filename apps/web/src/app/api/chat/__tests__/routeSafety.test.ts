import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class PersistenceError extends Error {
    readonly code = "AI_MESSAGE_PERSISTENCE_FAILED";
  }
  class ClaimError extends Error {
    readonly code = "CHAT_REQUEST_CLAIM_FAILED";
  }
  return {
    authenticatedUser: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
    profile: {
      couple_id: "10000000-0000-4000-8000-000000000001",
      role: "bride",
      is_admin: false,
    },
    reserve: vi.fn(),
    findPersisted: vi.fn(),
    reconcile: vi.fn(),
    claim: vi.fn(),
    provider: vi.fn(),
    rateLimit: vi.fn(),
    PersistenceError,
    ClaimError,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mocks.authenticatedUser },
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
  rateLimitSubjectKey: vi.fn(() => "chat-demo-session:test"),
  checkRateLimitPersistent: mocks.rateLimit,
}));

vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
  getSignedDemoSessionFromCookieHeader: vi.fn(() => null),
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

import { POST } from "@/app/api/chat/route";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000099";

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    mocks.authenticatedUser = { id: "00000000-0000-4000-8000-000000000001" };
    mocks.profile.couple_id = COUPLE_ID;
    mocks.profile.role = "bride";
    mocks.reserve.mockResolvedValue({ allowed: true, remaining: 99 });
    mocks.findPersisted.mockResolvedValue(null);
    mocks.reconcile.mockResolvedValue(true);
    mocks.claim.mockResolvedValue({ action: "acquired", attemptCount: 1, reclaimed: false });
    mocks.rateLimit.mockResolvedValue(null);
  });

  it("rejects an unauthenticated request before reading a chunked attachment body", async () => {
    mocks.authenticatedUser = null;
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new Uint8Array(1_000_000));
      },
    }, { highWaterMark: 0 });
    const unauthenticatedRequest = {
      body,
      headers: new Headers(),
    } as Request;

    const response = await POST(unauthenticatedRequest);

    expect(response.status).toBe(401);
    expect(pullCount).toBe(0);
    expect(mocks.findPersisted).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("returns an ingress limit before reading or parsing an authenticated chunked body", async () => {
    mocks.rateLimit.mockResolvedValueOnce(new Response("limited", { status: 429 }));
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new Uint8Array(1_000_000));
      },
    }, { highWaterMark: 0 });
    const limitedRequest = {
      body,
      headers: new Headers(),
    } as Request;
    const jsonParse = vi.spyOn(JSON, "parse");

    try {
      const response = await POST(limitedRequest);

      expect(response.status).toBe(429);
      expect(await response.text()).toBe("limited");
      expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
      expect(pullCount).toBe(0);
      expect(jsonParse).not.toHaveBeenCalled();
      expect(mocks.findPersisted).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
    } finally {
      jsonParse.mockRestore();
    }
  });

  it("rejects malformed messages before claim, quota reservation, or provider work", async () => {
    const response = await POST(request(validBody({ messages: [{ role: "system", content: "x" }] })));
    expect(response.status).toBe(400);
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
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
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
    expect(await response.json()).toMatchObject({ code: "CHAT_REQUEST_IN_PROGRESS" });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
