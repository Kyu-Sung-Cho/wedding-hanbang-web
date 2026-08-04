import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(() => "decision-publication-withdraw:test"),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { DELETE, GET } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const OUTCOME_ID = "33333333-3333-4333-8333-333333333333";
const OPERATION_KEY = "44444444-4444-4444-8444-444444444444";

function request(body: unknown = {}) {
  return new NextRequest(
    `https://hanbang.ai/api/community/decision-threads/${THREAD_ID}/outcomes/${OUTCOME_ID}/publication`,
    {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "idempotency-key": OPERATION_KEY,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(body),
    },
  );
}

function readRequest() {
  return new NextRequest(
    `https://hanbang.ai/api/community/decision-threads/${THREAD_ID}/outcomes/${OUTCOME_ID}/publication`,
  );
}

const context = {
  params: Promise.resolve({ threadId: THREAD_ID, outcomeId: OUTCOME_ID }),
};

describe("DELETE DecisionThread outcome publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: USER_ID } },
          error: null,
        })),
      },
    });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("returns the owner-only active publication state", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        outcomeId: OUTCOME_ID,
        threadId: THREAD_ID,
        revision: 2,
        publicationState: "pending_review",
        canWithdraw: true,
        updatedAt: "2026-08-04T03:00:00.000Z",
      },
      error: null,
    }));
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await GET(readRequest(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      publicationState: "pending_review",
      canWithdraw: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      "community_get_decision_outcome_publication_state",
      {
        p_actor_id: USER_ID,
        p_thread_id: THREAD_ID,
        p_outcome_id: OUTCOME_ID,
      },
    );
  });

  it("fails closed when publication activity contradicts its state", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          outcomeId: OUTCOME_ID,
          threadId: THREAD_ID,
          revision: 2,
          publicationState: "rejected",
          canWithdraw: true,
          updatedAt: "2026-08-04T03:00:00.000Z",
        },
        error: null,
      })),
    });

    const response = await GET(readRequest(), context);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_DECISION_STATE_UNCONFIRMED",
    });
  });

  it("returns only the verified withdrawal receipt", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        receiptVersion: 1,
        operationKey: OPERATION_KEY,
        outcomeId: OUTCOME_ID,
        threadId: THREAD_ID,
        revision: 2,
        publicationState: "withdrawn",
        withdrawnAt: "2026-08-04T04:00:00.000Z",
        replayed: false,
      },
      error: null,
    }));
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await DELETE(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "withdrawn",
      threadId: THREAD_ID,
      outcomeId: OUTCOME_ID,
      operationKey: OPERATION_KEY,
      revision: 2,
      withdrawnAt: "2026-08-04T04:00:00.000Z",
      replayed: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "community_withdraw_decision_outcome_publication",
      {
        p_actor_id: USER_ID,
        p_thread_id: THREAD_ID,
        p_outcome_id: OUTCOME_ID,
        p_operation_key: OPERATION_KEY,
      },
    );
  });

  it("replays the exact durable withdrawal through a closed rate gate", async () => {
    const durableReceipt = {
      receiptVersion: 1,
      operationKey: OPERATION_KEY,
      outcomeId: OUTCOME_ID,
      threadId: THREAD_ID,
      revision: 2,
      publicationState: "withdrawn",
      withdrawnAt: "2026-08-04T04:00:00.000Z",
      replayed: false,
    };
    const rpc = vi.fn(async (operation: string) => (
      operation === "community_has_completed_decision_publication_command"
        ? { data: true, error: null }
        : { data: durableReceipt, error: null }
    ));
    mocks.createAdminClient.mockReturnValue({ rpc });
    mocks.checkRateLimitPersistent.mockResolvedValue(
      NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 }),
    );

    const first = await DELETE(request(), context);
    const replay = await DELETE(request(), context);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(rpc).toHaveBeenCalledWith(
      "community_has_completed_decision_publication_command",
      {
        p_actor_id: USER_ID,
        p_operation: "author_withdraw",
        p_operation_key: OPERATION_KEY,
        p_outcome_id: OUTCOME_ID,
        p_payload: {
          threadId: THREAD_ID,
          outcomeId: OUTCOME_ID,
          reason: "consent_withdrawn",
        },
      },
    );
  });

  it("does not let a new withdrawal command bypass the rate gate", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    mocks.createAdminClient.mockReturnValue({ rpc });
    mocks.checkRateLimitPersistent.mockResolvedValue(
      NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 }),
    );
    const response = await DELETE(request(), context);
    expect(response.status).toBe(429);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the RPC adds an unreviewed field", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: {
          receiptVersion: 1,
          operationKey: OPERATION_KEY,
          outcomeId: OUTCOME_ID,
          threadId: THREAD_ID,
          revision: 2,
          publicationState: "withdrawn",
          withdrawnAt: "2026-08-04T04:00:00.000Z",
          replayed: false,
          authorId: USER_ID,
        },
        error: null,
      })),
    });

    const response = await DELETE(request(), context);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_DECISION_STATE_UNCONFIRMED",
    });
  });

  it("rejects any body fields before the service RPC", async () => {
    const rpc = vi.fn();
    mocks.createAdminClient.mockReturnValue({ rpc });
    const response = await DELETE(request({ reason: "skip-review" }), context);
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
