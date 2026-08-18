import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { buildPreparationActionReceiptPage } from "@/lib/amora/preparationActionReceipt";
import { buildPreparationScheduleDecisionReceiptPage } from "@/lib/amora/preparationScheduleDecisionReceipt";
import { GET, PUT } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "preparation-topic-message-refs:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
vi.mock("@/lib/amora/preparationActionReceipt", () => ({
  buildPreparationActionReceiptPage: vi.fn(),
}));
vi.mock("@/lib/amora/preparationScheduleDecisionReceipt", () => ({
  buildPreparationScheduleDecisionReceiptPage: vi.fn(),
}));

const RECIPIENT = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "33333333-3333-4333-8333-333333333333";
const REF = "44444444-4444-4444-8444-444444444444";
const MESSAGE = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const ACTION_ID = "a2000000-0000-4000-8000-000000000099";
const SOURCE_MESSAGE = "a3000000-0000-4000-8000-000000000099";
const RECEIPT_MESSAGE = "a4000000-0000-4000-8000-000000000099";
const RECEIPT_REQUEST_KEY = `chat:${RECIPIENT}:a5000000-0000-4000-8000-000000000099`;
const SCHEDULE_DECISION = "a6000000-0000-4000-8000-000000000099";

const collection = {
  version: 1,
  state: "ready",
  recipientUserId: RECIPIENT,
  coupleId: COUPLE,
  references: [{
    refId: REF,
    topicKey: "venue",
    messageId: MESSAGE,
    audience: "couple_shared",
    revision: 1,
    savedAt: "2026-08-16T02:00:00.000Z",
    sourceCreatedAt: "2026-08-15T02:00:00.000Z",
    excerpt: "Compare the venue contracts before choosing.",
    canRemove: true,
    canOpenOriginal: true,
  }],
  partial: false,
};

const notesRpcPage = {
  version: 1,
  state: "ready",
  recipientUserId: RECIPIENT,
  coupleId: COUPLE,
  snapshotAt: "2026-08-18T08:00:00.000Z",
  entries: [{
    refId: REF,
    topicKey: "venue",
    messageId: MESSAGE,
    audience: "owner_private",
    revision: 2,
    savedAt: "2026-08-18T07:00:00.000Z",
    sourceCreatedAt: "2026-08-18T06:00:00.000Z",
    questionExcerpt: "예식장 계약 전에 무엇을 확인해야 할까?",
    answerExcerpt: "대관 범위와 취소 조건을 서면에서 먼저 확인해요.",
    canRemove: true,
    canOpenOriginal: true,
  }],
  nextBoundary: {
    savedAt: "2026-08-18T07:00:00.000Z",
    refId: REF,
  },
  partial: false,
};

const state = {
  version: 1,
  state: "ready",
  recipientUserId: RECIPIENT,
  coupleId: COUPLE,
  reference: {
    topicKey: "venue",
    messageId: MESSAGE,
    refId: REF,
    audience: "couple_shared",
    savedState: "saved",
    revision: 1,
  },
};

function query(data: unknown, error: unknown = null) {
  const builder = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data, error });
  return builder;
}

function adminQuery(data: unknown, error: unknown = null) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown> = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    not: vi.fn(),
    in: vi.fn(),
    lte: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn().mockResolvedValue({ data, error }),
    then: vi.fn((resolve) => Promise.resolve(resolve({ data, error }))),
  };
  for (const method of ["select", "eq", "is", "not", "in", "lte", "or", "order", "limit"] as const) {
    builder[method].mockReturnValue(builder);
  }
  return builder;
}

function installClient(options: {
  userId?: string | null;
  role?: "bride" | "groom";
  brideId?: string | null;
  groomId?: string | null;
  profileError?: unknown;
  privacyEpoch?: unknown;
  privacyError?: unknown;
} = {}) {
  const userId = options.userId === undefined ? RECIPIENT : options.userId;
  const role = options.role ?? "bride";
  const profile = query({ couple_id: COUPLE, role }, options.profileError ?? null);
  const couple = query({
    bride_id: options.brideId === undefined ? RECIPIENT : options.brideId,
    groom_id: options.groomId === undefined ? PARTNER : options.groomId,
  });
  const rpc = vi.fn().mockResolvedValue({
    data: options.privacyEpoch === undefined ? 7 : options.privacyEpoch,
    error: options.privacyError ?? null,
  });
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId === null ? null : { id: userId } },
      }),
    },
    from: vi.fn((name: string) => name === "profiles" ? profile : couple),
    rpc,
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
  return client;
}

function headers(actor = RECIPIENT) {
  return {
    "content-type": "application/json",
    "sec-fetch-site": "same-origin",
    [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
    [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: actor,
  };
}

function getRequest(suffix = "", actor = RECIPIENT) {
  return new Request(
    `http://localhost/api/amora/preparation-topic-message-refs${suffix}`,
    { headers: headers(actor) },
  );
}

function putRequest(body: unknown, suffix = "", actor = RECIPIENT) {
  return new Request(
    `http://localhost/api/amora/preparation-topic-message-refs${suffix}`,
    { method: "PUT", headers: headers(actor), body: JSON.stringify(body) },
  );
}

describe("/api/amora/preparation-topic-message-refs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
    installClient();
  });

  it("lists a bounded recipient-and-couple-bound collection without caching", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: collection, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toContain("Authorization");
    await expect(response.json()).resolves.toEqual(collection);
    expect(rpc).toHaveBeenCalledWith(
      "list_amora_preparation_topic_message_refs_v1",
      {
        p_couple_id: COUPLE,
        p_recipient_user_id: RECIPIENT,
        p_expected_privacy_epoch: 7,
        p_limit: 80,
      },
    );
  });

  it("reads a notes-only question-and-answer page and round-trips one opaque cursor", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: notesRpcPage, error: null })
      .mockResolvedValueOnce({
        data: { ...notesRpcPage, entries: [], nextBoundary: null },
        error: null,
      });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const first = await GET(getRequest("?view=notes&q=%EC%98%88%EC%8B%9D%EC%9E%A5%20%20%20%EA%B3%84%EC%95%BD&limit=12"));
    const firstPayload = await first.json();

    expect(first.status).toBe(200);
    expect(firstPayload).toEqual({
      ...notesRpcPage,
      nextBoundary: undefined,
      nextCursor: expect.stringMatching(/^np1\.[A-Za-z0-9_-]{16,512}$/u),
    });
    expect(firstPayload).not.toHaveProperty("nextBoundary");
    expect(rpc).toHaveBeenNthCalledWith(1,
      "list_amora_preparation_notes_v1",
      {
        p_couple_id: COUPLE,
        p_recipient_user_id: RECIPIENT,
        p_expected_privacy_epoch: 7,
        p_query: "예식장 계약",
        p_snapshot_at: null,
        p_cursor_saved_at: null,
        p_cursor_ref_id: null,
        p_limit: 12,
      },
    );

    const second = await GET(getRequest(
      `?view=notes&q=%EC%98%88%EC%8B%9D%EC%9E%A5%20%EA%B3%84%EC%95%BD&limit=12&cursor=${encodeURIComponent(firstPayload.nextCursor)}`,
    ));
    expect(second.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(2,
      "list_amora_preparation_notes_v1",
      {
        p_couple_id: COUPLE,
        p_recipient_user_id: RECIPIENT,
        p_expected_privacy_epoch: 7,
        p_query: "예식장 계약",
        p_snapshot_at: notesRpcPage.snapshotAt,
        p_cursor_saved_at: notesRpcPage.nextBoundary.savedAt,
        p_cursor_ref_id: REF,
        p_limit: 12,
      },
    );
  });

  it("reads only strictly verified server-authoritative action receipts and rechecks identity", async () => {
    const receiptRows = [{
      id: RECEIPT_MESSAGE,
      couple_id: COUPLE,
      sender_id: null,
      sender_type: "ai",
      sender_role: null,
      role: "assistant",
      content: '"예식장 계약 조건 다시 확인"을 아모라 행동 카드로 저장했어요.',
      metadata: {
        client_request_id: RECEIPT_REQUEST_KEY,
        in_reply_to_user_message_id: MESSAGE,
        confirmed_amora_action_id: ACTION_ID,
        source_amora_action_message_id: SOURCE_MESSAGE,
        response_origin: "server_authoritative_provider_backed_add_action_application",
      },
      visibility: "shared",
      stage_tag: null,
      specialist_type: "general",
      created_at: "2026-08-17T07:00:00.000Z",
    }];
    const sourceRows = [
      { id: SOURCE_MESSAGE },
      { id: MESSAGE },
    ];
    const executionRows = [{
      couple_id: COUPLE,
      request_key: RECEIPT_REQUEST_KEY,
      pending_action_id: ACTION_ID,
    }];
    const receiptBuilder = adminQuery(receiptRows);
    const sourceBuilder = adminQuery(sourceRows);
    let chatReadCount = 0;
    const from = vi.fn((table: string) => {
      if (table === "chat_messages") {
        chatReadCount += 1;
        return chatReadCount === 1 ? receiptBuilder : sourceBuilder;
      }
      if (table === "amora_tool_executions") return adminQuery(executionRows);
      if (table === "amora_first_use_action_proposal_bindings") return adminQuery([]);
      return adminQuery(null, { code: "unexpected" });
    });
    vi.mocked(createAdminClient).mockReturnValue({ from } as never);
    vi.mocked(buildPreparationActionReceiptPage).mockReturnValue({
      entries: [{
        receiptMessageId: RECEIPT_MESSAGE,
        actionId: "act_1234567890abcdef_1234567890abcdef12345678",
        topicKey: "venue",
        title: "예식장 계약 조건 다시 확인",
        displayMessage: receiptRows[0].content,
        appliedAt: receiptRows[0].created_at,
        scope: "couple_shared",
        canOpenAction: true,
      }],
      nextBoundary: null,
      partial: false,
    });

    const response = await GET(getRequest(
      "?view=action-receipts&q=%EC%98%88%EC%8B%9D%EC%9E%A5&limit=12",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      entries: [{ actionId: "act_1234567890abcdef_1234567890abcdef12345678" }],
      nextCursor: null,
      partial: false,
    });
    expect(from).toHaveBeenCalledWith("chat_messages");
    expect(from).toHaveBeenCalledWith("amora_tool_executions");
    expect(receiptBuilder.or).toHaveBeenCalledWith(
      "metadata->>target.is.null,metadata->>target.neq.partner",
    );
    expect(sourceBuilder.or).toHaveBeenCalledWith(
      "metadata->>target.is.null,metadata->>target.neq.partner",
    );
    expect(buildPreparationActionReceiptPage).toHaveBeenCalledWith(
      expect.objectContaining({
        coupleId: COUPLE,
        recipientUserId: RECIPIENT,
        query: "예식장",
        limit: 12,
        receiptMessages: receiptRows,
        sourceAndConfirmationMessages: sourceRows,
        executions: executionRows,
      }),
    );
    expect(vi.mocked(createClientFromRequest)).toHaveBeenCalledTimes(2);
  });

  it("rejects an action-receipt cursor page that repeats its boundary", async () => {
    const from = vi.fn(() => adminQuery([]));
    vi.mocked(createAdminClient).mockReturnValue({ from } as never);
    vi.mocked(buildPreparationActionReceiptPage).mockReturnValue({
      entries: [],
      nextBoundary: {
        appliedAt: "2026-08-17T07:00:00.000Z",
        receiptMessageId: RECEIPT_MESSAGE,
      },
      partial: false,
    });

    const first = await GET(getRequest("?view=action-receipts&limit=12"));
    const firstPayload = await first.json();
    expect(first.status).toBe(200);
    expect(firstPayload.nextCursor).toMatch(/^ap1\.[A-Za-z0-9_-]{16,512}$/u);

    const repeated = await GET(getRequest(
      `?view=action-receipts&limit=12&cursor=${encodeURIComponent(firstPayload.nextCursor)}`,
    ));
    expect(repeated.status).toBe(503);
    await expect(repeated.json()).resolves.toEqual({
      code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE",
    });
  });

  it("reads only current-journey-bound schedule decisions and rechecks identity", async () => {
    const journey = {
      progress: {
        __events: [{
          id: "meeting-event",
          date: "2026-09-05",
          title: "양가 부모님 첫 만남",
          categoryKey: "meeting",
          status: "planned",
        }],
      },
      state_revision: 8,
    };
    const decisionRows = [{
      id: SCHEDULE_DECISION,
      couple_id: COUPLE,
      category: "meeting",
      decision_type: "scheduled",
      source: "schedule",
      chosen_value: { eventId: "meeting-event" },
      user_confirmed_at: "2026-08-17T07:00:00.000Z",
      decided_at: "2026-08-17T07:01:00.000Z",
    }];
    const journeyBuilder = adminQuery(journey);
    const decisionBuilder = adminQuery(decisionRows);
    const from = vi.fn((table: string) => {
      if (table === "wedding_journeys") return journeyBuilder;
      if (table === "decision_nodes") return decisionBuilder;
      return adminQuery(null, { code: "unexpected" });
    });
    vi.mocked(createAdminClient).mockReturnValue({ from } as never);
    vi.mocked(buildPreparationScheduleDecisionReceiptPage).mockReturnValue({
      entries: [{
        decisionId: SCHEDULE_DECISION,
        eventId: "meeting-event",
        topicKey: "meeting",
        title: "일정 추가 · 양가 부모님 첫 만남",
        date: "2026-09-05",
        confirmedAt: "2026-08-17T07:00:00.000Z",
        scope: "couple_shared",
        canOpenSchedule: true,
      }],
      nextBoundary: null,
      partial: false,
    });

    const response = await GET(getRequest(
      "?view=schedule-decisions&q=%EC%83%81%EA%B2%AC%EB%A1%80&limit=12",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      state: "ready",
      recipientUserId: RECIPIENT,
      coupleId: COUPLE,
      currentJourneyRevision: 8,
      entries: [{ decisionId: SCHEDULE_DECISION, eventId: "meeting-event" }],
      nextCursor: null,
      partial: false,
    });
    expect(from).toHaveBeenCalledWith("wedding_journeys");
    expect(from).toHaveBeenCalledWith("decision_nodes");
    expect(decisionBuilder.eq).toHaveBeenCalledWith("visibility", "shared");
    expect(decisionBuilder.eq).toHaveBeenCalledWith("source", "schedule");
    expect(decisionBuilder.eq).toHaveBeenCalledWith("decision_type", "scheduled");
    expect(buildPreparationScheduleDecisionReceiptPage).toHaveBeenCalledWith(
      expect.objectContaining({
        coupleId: COUPLE,
        recipientUserId: RECIPIENT,
        query: "상견례",
        currentJourneyRevision: 8,
        progress: journey.progress,
        decisionRows,
        limit: 12,
      }),
    );
    expect(vi.mocked(createClientFromRequest)).toHaveBeenCalledTimes(2);
  });

  it("rejects a notes cursor page that changes snapshot or fails to advance", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: notesRpcPage, error: null })
      .mockResolvedValueOnce({ data: notesRpcPage, error: null })
      .mockResolvedValueOnce({
        data: {
          ...notesRpcPage,
          snapshotAt: "2026-08-18T09:00:00.000Z",
          entries: [],
          nextBoundary: null,
        },
        error: null,
      });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const first = await GET(getRequest("?view=notes&limit=12"));
    const firstPayload = await first.json();
    expect(first.status).toBe(200);

    const repeated = await GET(getRequest(
      `?view=notes&limit=12&cursor=${encodeURIComponent(firstPayload.nextCursor)}`,
    ));
    expect(repeated.status).toBe(503);

    const changedSnapshot = await GET(getRequest(
      `?view=notes&limit=12&cursor=${encodeURIComponent(firstPayload.nextCursor)}`,
    ));
    expect(changedSnapshot.status).toBe(503);
  });

  it("reads exact state only for one canonical topic and one source message", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: state, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(getRequest(`?topicKey=venue&messageId=${MESSAGE}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(state);
    expect(rpc).toHaveBeenCalledWith(
      "get_amora_preparation_topic_message_ref_state_v1",
      {
        p_couple_id: COUPLE,
        p_recipient_user_id: RECIPIENT,
        p_topic_key: "venue",
        p_message_id: MESSAGE,
        p_expected_privacy_epoch: 7,
      },
    );
  });

  it("sets only the exact requested state with optimistic revision and request id", async () => {
    const receipt = { ...state, reused: false };
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const body = {
      topicKey: "venue",
      messageId: MESSAGE,
      desiredState: "saved",
      expectedRevision: 0,
      requestId: REQUEST_ID,
    };

    const response = await PUT(putRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(receipt);
    expect(rpc).toHaveBeenCalledWith(
      "set_amora_preparation_topic_message_ref_v1",
      {
        p_couple_id: COUPLE,
        p_actor_user_id: RECIPIENT,
        p_topic_key: "venue",
        p_message_id: MESSAGE,
        p_desired_state: "saved",
        p_expected_revision: 0,
        p_request_id: REQUEST_ID,
        p_expected_privacy_epoch: 7,
      },
    );
  });

  it.each([
    "?topicKey=venue",
    `?messageId=${MESSAGE}`,
    `?topicKey=venue&topicKey=dress&messageId=${MESSAGE}`,
    `?topicKey=venue&messageId=${MESSAGE}&ownerId=${RECIPIENT}`,
    `?topicKey=guessed&messageId=${MESSAGE}`,
    "?view=notes&view=notes",
    "?view=notes&cursor=raw-timestamp",
    "?view=notes&limit=25",
    "?view=notes&unsupported=true",
    "?view=action-receipts&view=action-receipts",
    "?view=action-receipts&cursor=raw-timestamp",
    "?view=action-receipts&limit=25",
    "?view=action-receipts&unsupported=true",
    "?view=schedule-decisions&cursor=raw-timestamp",
    "?view=schedule-decisions&limit=25",
    "?view=schedule-decisions&unsupported=true",
  ])("rejects an ambiguous or expanding query before auth: %s", async (suffix) => {
    const response = await GET(getRequest(suffix));
    expect(response.status).toBe(400);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects extra mutation fields, query input, untrusted origin, and account switch", async () => {
    const body = {
      topicKey: "venue",
      messageId: MESSAGE,
      desiredState: "saved",
      expectedRevision: 0,
      requestId: REQUEST_ID,
    };
    expect((await PUT(putRequest({ ...body, content: "do not copy this" }))).status)
      .toBe(400);
    expect((await PUT(putRequest(body, "?topicKey=venue"))).status).toBe(400);

    vi.mocked(isTrustedMutationRequest).mockReturnValueOnce(false);
    expect((await PUT(putRequest(body))).status).toBe(403);
    expect((await PUT(putRequest(body, "", PARTNER))).status).toBe(409);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("bounds mutation bytes and rejects invalid JSON before the service RPC", async () => {
    const invalidJson = new Request(
      "http://localhost/api/amora/preparation-topic-message-refs",
      { method: "PUT", headers: headers(), body: "{" },
    );
    const oversized = new Request(
      "http://localhost/api/amora/preparation-topic-message-refs",
      { method: "PUT", headers: headers(), body: `{"padding":"${"x".repeat(2_100)}"}` },
    );

    expect((await PUT(invalidJson)).status).toBe(400);
    expect((await PUT(oversized)).status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed for authentication, roster, privacy epoch, and rate limit", async () => {
    installClient({ userId: null });
    expect((await GET(getRequest())).status).toBe(401);

    installClient({ brideId: PARTNER });
    expect((await GET(getRequest())).status).toBe(409);

    installClient({ privacyEpoch: null, privacyError: { code: "PGRST" } });
    expect((await GET(getRequest())).status).toBe(503);

    installClient();
    vi.mocked(checkRateLimit).mockReturnValueOnce(NextResponse.json(
      { code: "RATE_LIMITED" },
      { status: 429 },
    ));
    const limited = await GET(getRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toContain("no-store");
    expect(limited.headers.get("vary")).toContain("Authorization");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("treats a context database outage as retryable, not as an identity change", async () => {
    installClient({ profileError: { code: "XX000" } });

    const response = await GET(getRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["P0002", 404, "AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND"],
    ["40001", 409, "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONFLICT"],
    ["PT409", 409, "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONFLICT"],
    ["22023", 400, "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_INVALID"],
    ["XX000", 503, "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE"],
  ])("maps SQLSTATE %s without exposing service details", async (code, status, publicCode) => {
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: "private source details" },
      }),
    } as never);

    const response = await GET(getRequest());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ code: publicCode });
  });

  it("rejects foreign or privacy-expanding service output", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: { ...collection, sourceDigest: "must-not-escape" },
        error: null,
      }),
    } as never);

    const response = await GET(getRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE",
    });
  });

  it("distinguishes an empty saved-ref collection from an infrastructure failure", async () => {
    const empty = { ...collection, references: [] };
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: empty, error: null }),
    } as never);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(empty);
  });

  it("rejects a service receipt for a state different from the caller intent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: {
          ...state,
          reference: {
            ...state.reference,
            refId: null,
            savedState: "removed",
            revision: 2,
          },
          reused: false,
        },
        error: null,
      }),
    } as never);

    const response = await PUT(putRequest({
      topicKey: "venue",
      messageId: MESSAGE,
      desiredState: "saved",
      expectedRevision: 1,
      requestId: REQUEST_ID,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE",
    });
  });
});
