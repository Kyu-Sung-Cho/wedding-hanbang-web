import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  checkCommunityWriteAccess: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn((prefix: string, _request: Request, userId?: string) =>
    `${prefix}:${userId ?? "anonymous"}`,
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { POST as publish } from "./route";
import { GET as readDecision } from "./[threadId]/route";
import { POST as resolveDecision } from "./[threadId]/resolve/route";
import { POST as withdraw } from "./[threadId]/withdraw/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const QUESTION_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const COMMAND_ID = "44444444-4444-4444-8444-444444444444";
const ANSWER_ID = "55555555-5555-4555-8555-555555555555";
const SELECTION_ID = "66666666-6666-4666-8666-666666666666";
const IDEMPOTENCY_KEY = "77777777-7777-4777-8777-777777777777";

function authenticatedClient() {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
  };
}

function mutationRequest(path: string, body: unknown) {
  return new NextRequest(`https://hanbang.ai${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": IDEMPOTENCY_KEY,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function validPublishBody() {
  return {
    questionId: QUESTION_ID,
    title: "계약서 밖 추가 비용을 확인하고 싶어요",
    content:
      "계약 전에 포함 범위를 확인한 실제 경험과 확인 순서를 알고 싶어요.",
    topicCategory: "contract_extra_cost",
    experienceScope: "extra_charge",
    coarseRegion: "서울",
    preparationStage: "contract_review",
    contractPhase: "before_contract",
    desiredAnswer: "추가 비용을 발견한 시점과 확인 문구",
    commercialRelationship: "none",
    sponsorshipDetail: null,
  };
}

describe("DecisionThread HTTP command boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue(authenticatedClient());
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("keeps an unsupplied question private and retryable", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          status: "private_waitlist",
          question_id: QUESTION_ID,
          command_id: COMMAND_ID,
          operation_key: IDEMPOTENCY_KEY,
          replayed: false,
        },
        error: null,
      })),
    });

    const response = await publish(
      mutationRequest("/api/community/decision-threads", validPublishBody()),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "private_waitlist",
      questionId: QUESTION_ID,
      commandId: COMMAND_ID,
      operationKey: IDEMPOTENCY_KEY,
      replayed: false,
    });
  });

  it("fails closed when the publication receipt belongs to another question", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          status: "private_waitlist",
          question_id: "88888888-8888-4888-8888-888888888888",
          command_id: COMMAND_ID,
          operation_key: IDEMPOTENCY_KEY,
          replayed: false,
        },
        error: null,
      })),
    });
    const response = await publish(
      mutationRequest("/api/community/decision-threads", validPublishBody()),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_DECISION_STATE_UNCONFIRMED",
    });
  });

  it("fails closed when the publication receipt belongs to another operation key", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          status: "private_waitlist",
          question_id: QUESTION_ID,
          command_id: COMMAND_ID,
          operation_key: "88888888-8888-4888-8888-888888888888",
          replayed: false,
        },
        error: null,
      })),
    });
    const response = await publish(
      mutationRequest("/api/community/decision-threads", validPublishBody()),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_DECISION_STATE_UNCONFIRMED",
    });
  });

  it("restores an owner-only waitlist projection after an app restart", async () => {
    const projection = {
      status: "private_waitlist",
      intake: {
        questionId: QUESTION_ID,
        title: validPublishBody().title,
        content: validPublishBody().content,
      },
      thread: null,
      post: null,
      answers: [],
      viewer: {
        isAuthor: true,
        canAnswer: false,
        canResolve: false,
        canRecordOutcome: false,
        canWithdraw: true,
        selection: [],
        outcomes: [],
      },
    };
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({ data: projection, error: null })),
    });
    const response = await readDecision(
      new NextRequest(
        `https://hanbang.ai/api/community/decision-threads/${QUESTION_ID}`,
      ),
      { params: Promise.resolve({ threadId: QUESTION_ID }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    await expect(response.json()).resolves.toEqual(projection);
  });

  it("fails closed if a camelCase internal identity enters the read RPC", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          status: "private_waitlist",
          intake: {
            questionId: QUESTION_ID,
            title: validPublishBody().title,
            responderRequestId: ANSWER_ID,
          },
          thread: null,
          post: null,
          answers: [],
          viewer: { isAuthor: true, canWithdraw: true },
        },
        error: null,
      })),
    });
    const response = await readDecision(
      new NextRequest(
        `https://hanbang.ai/api/community/decision-threads/${QUESTION_ID}`,
      ),
      { params: Promise.resolve({ threadId: QUESTION_ID }) },
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_DECISION_STATE_UNCONFIRMED",
    });
  });

  it("returns the exact durable publication receipt for a lost-response replay", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "published",
          question_id: QUESTION_ID,
          thread_id: QUESTION_ID,
          post_id: POST_ID,
          publication_version: 1,
          current_state: "open",
          current_version: 1,
          command_id: COMMAND_ID,
          operation_key: IDEMPOTENCY_KEY,
          replayed: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          status: "published",
          question_id: QUESTION_ID,
          thread_id: QUESTION_ID,
          post_id: POST_ID,
          publication_version: 1,
          current_state: "open",
          current_version: 1,
          command_id: COMMAND_ID,
          operation_key: IDEMPOTENCY_KEY,
          replayed: false,
        },
        error: null,
      });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const first = await publish(
      mutationRequest("/api/community/decision-threads", validPublishBody()),
    );
    const replay = await publish(
      mutationRequest("/api/community/decision-threads", validPublishBody()),
    );

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    const firstBody = await first.json();
    const replayBody = await replay.json();
    expect(replayBody).toEqual(firstBody);
  });

  it("returns a terminal durable receipt even when current write access is blocked", async () => {
    const receipt = {
      status: "published",
      question_id: QUESTION_ID,
      thread_id: QUESTION_ID,
      post_id: POST_ID,
      publication_version: 1,
      current_state: "open",
      current_version: 1,
      command_id: COMMAND_ID,
      operation_key: IDEMPOTENCY_KEY,
      replayed: false,
    };
    const maybeSingle = vi.fn(async () => ({
      data: { status: "succeeded", result_payload: receipt },
      error: null,
    }));
    const eqIdempotency = vi.fn(() => ({ maybeSingle }));
    const eqOperation = vi.fn(() => ({ eq: eqIdempotency }));
    const eqActor = vi.fn(() => ({ eq: eqOperation }));
    const select = vi.fn(() => ({ eq: eqActor }));
    const rpc = vi.fn(async () => ({ data: receipt, error: null }));
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select })),
      rpc,
    });
    mocks.checkCommunityWriteAccess.mockResolvedValue({
      allowed: false,
      code: "COMMUNITY_ACCOUNT_SUSPENDED",
      message: "현재 커뮤니티 쓰기를 사용할 수 없어요.",
      status: 403,
    });

    const response = await publish(
      mutationRequest("/api/community/decision-threads", validPublishBody()),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      status: "published",
      questionId: QUESTION_ID,
      threadId: QUESTION_ID,
      postId: POST_ID,
      publicationVersion: 1,
      currentState: "open",
      currentVersion: 1,
      commandId: COMMAND_ID,
      operationKey: IDEMPOTENCY_KEY,
      replayed: false,
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("rejects exact dates before the service RPC", async () => {
    const rpc = vi.fn();
    mocks.createAdminClient.mockReturnValue({ rpc });
    const response = await publish(
      mutationRequest("/api/community/decision-threads", {
        ...validPublishBody(),
        content: "2026-08-04에 계약한 실제 상황을 그대로 공개할게요.",
      }),
    );
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a same-key different-payload conflict to 409", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: "23505", message: "IDEMPOTENCY_CONFLICT" },
      })),
    });
    const response = await publish(
      mutationRequest("/api/community/decision-threads", validPublishBody()),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_DECISION_CONFLICT",
    });
  });

  it("returns persisted answer and selection ids from final resolution", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          status: "resolved",
          thread_id: QUESTION_ID,
          state: "resolved",
          version: 4,
          next_action: "계약서 포함 범위를 서면으로 다시 확인하기",
          answer_ids: [ANSWER_ID],
          selection_ids: [SELECTION_ID],
          command_id: COMMAND_ID,
          operation_key: IDEMPOTENCY_KEY,
          replayed: false,
        },
        error: null,
      })),
    });
    const response = await resolveDecision(
      mutationRequest(`/api/community/decision-threads/${QUESTION_ID}/resolve`, {
        expectedVersion: 3,
        answerIds: [ANSWER_ID],
        nextAction: "계약서 포함 범위를 서면으로 다시 확인하기",
        reason: "현재 계약 단계에 직접 적용할 수 있어요",
      }),
      { params: Promise.resolve({ threadId: QUESTION_ID }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      answerIds: [ANSWER_ID],
      selectionIds: [SELECTION_ID],
    });
  });

  it("fails closed when a mutation receipt targets another thread", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          status: "resolved",
          thread_id: "88888888-8888-4888-8888-888888888888",
          state: "resolved",
          version: 4,
          next_action: "계약서 포함 범위를 서면으로 다시 확인하기",
          answer_ids: [ANSWER_ID],
          selection_ids: [SELECTION_ID],
          command_id: COMMAND_ID,
          operation_key: IDEMPOTENCY_KEY,
          replayed: false,
        },
        error: null,
      })),
    });
    const response = await resolveDecision(
      mutationRequest(`/api/community/decision-threads/${QUESTION_ID}/resolve`, {
        expectedVersion: 3,
        answerIds: [ANSWER_ID],
        nextAction: "계약서 포함 범위를 서면으로 다시 확인하기",
        reason: "현재 계약 단계에 직접 적용할 수 있어요",
      }),
      { params: Promise.resolve({ threadId: QUESTION_ID }) },
    );
    expect(response.status).toBe(503);
  });

  it("fails closed when a mutation receipt belongs to another operation key", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          status: "resolved",
          thread_id: QUESTION_ID,
          state: "resolved",
          version: 4,
          next_action: "계약의 포함 범위를 서면으로 다시 확인하기",
          answer_ids: [ANSWER_ID],
          selection_ids: [SELECTION_ID],
          command_id: COMMAND_ID,
          operation_key: "88888888-8888-4888-8888-888888888888",
          replayed: false,
        },
        error: null,
      })),
    });
    const response = await resolveDecision(
      mutationRequest(`/api/community/decision-threads/${QUESTION_ID}/resolve`, {
        expectedVersion: 3,
        answerIds: [ANSWER_ID],
        nextAction: "계약의 포함 범위를 서면으로 다시 확인하기",
        reason: "현재 계약 단계에 직접 적용할 수 있어요.",
      }),
      { params: Promise.resolve({ threadId: QUESTION_ID }) },
    );
    expect(response.status).toBe(503);
  });

  it("returns a stable 409 stale receipt and allows waitlist self-withdraw", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          status: "stale",
          question_id: QUESTION_ID,
          thread_id: QUESTION_ID,
          state: "answered",
          current_version: 3,
          command_id: COMMAND_ID,
          operation_key: IDEMPOTENCY_KEY,
          replayed: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          status: "withdrawn",
          question_id: QUESTION_ID,
          thread_id: null,
          state: null,
          version: null,
          source_unavailable_at: null,
          command_id: COMMAND_ID,
          operation_key: IDEMPOTENCY_KEY,
          replayed: false,
        },
        error: null,
      });
    mocks.createAdminClient.mockReturnValue({ rpc });
    const stale = await withdraw(
      mutationRequest(`/api/community/decision-threads/${QUESTION_ID}/withdraw`, {
        expectedVersion: 2,
        reason: "더 이상 공개 질문을 유지하지 않아요",
      }),
      { params: Promise.resolve({ threadId: QUESTION_ID }) },
    );
    const waitlist = await withdraw(
      mutationRequest(`/api/community/decision-threads/${QUESTION_ID}/withdraw`, {
        expectedVersion: null,
        reason: "답변 대기 요청을 취소할게요",
      }),
      { params: Promise.resolve({ threadId: QUESTION_ID }) },
    );
    expect(stale.status).toBe(409);
    expect(waitlist.status).toBe(200);
    await expect(waitlist.json()).resolves.toMatchObject({
      status: "withdrawn",
      threadId: null,
    });
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
  });
});
