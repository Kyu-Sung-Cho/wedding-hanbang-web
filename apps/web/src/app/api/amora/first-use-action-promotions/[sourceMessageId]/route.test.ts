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
import { GET } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "first-use-promotion:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "55555555-5555-4555-8555-555555555555";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const PROMOTION_ID = "66666666-6666-4666-8666-666666666666";
const SHARED_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const CRITERION_ID = "77777777-7777-4777-8777-777777777777";

const action = "이번 주 예식 후보 범위를 둘이 정하기";
const reason = "장소를 찾기 전에 기준을 먼저 맞추면 선택이 쉬워져요.";
const completionCriterion = "지역과 예상 인원을 각각 하나씩 적으면 끝나요.";
const sharedText = [
  "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
  `지금 할 한 가지: ${action}`,
  `이유: ${reason}`,
  `완료 기준: ${completionCriterion}`,
  "저장 전에는 확인 카드만 보여줘.",
].join("\n");

function query(data: unknown, error: unknown = null) {
  const builder = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data, error });
  return builder;
}

function installClient() {
  const profile = query({ couple_id: COUPLE_ID, role: "bride" });
  const couple = query({ bride_id: OWNER_ID, groom_id: OTHER_ID });
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: OWNER_ID } } }),
    },
    from: vi.fn((name: string) => name === "profiles" ? profile : couple),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
  return client;
}

function request(actor = OWNER_ID, suffix = "") {
  return new Request(
    `http://localhost/api/amora/first-use-action-promotions/${SOURCE_ID}${suffix}`,
    {
      headers: {
        "sec-fetch-site": "same-origin",
        [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
        [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: actor,
      },
    },
  );
}

function context(sourceMessageId = SOURCE_ID) {
  return { params: Promise.resolve({ sourceMessageId }) };
}

describe("GET /api/amora/first-use-action-promotions/[sourceMessageId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(null);
    installClient();
  });

  it("returns a strict current-source preview without private narrative", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        version: 1,
        status: "ready",
        promotionId: null,
        sharedMessageId: null,
        sourceMessageId: SOURCE_ID,
        sourceRevision: 7,
        criterionDecisionId: CRITERION_ID,
        canonicalActionInput: { action, reason, completionCriterion },
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    const body = await response.json();
    expect(body).toEqual({
      version: 1,
      state: "ready",
      ownerUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      sourceMessageId: SOURCE_ID,
      sourceRevision: 7,
      criterionDecisionId: CRITERION_ID,
      canonicalDraft: { action, reason, completionCriterion, sharedText },
    });
    expect(rpc).toHaveBeenCalledWith(
      "read_amora_first_use_action_promotion_v1",
      {
        p_couple_id: COUPLE_ID,
        p_owner_user_id: OWNER_ID,
        p_source_private_message_id: SOURCE_ID,
      },
    );
    expect(JSON.stringify(body)).not.toContain("grounding");
  });

  it("returns the existing shared receipt instead of creating another draft", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: {
          version: 1,
          status: "promoted",
          promotionId: PROMOTION_ID,
          sharedMessageId: SHARED_MESSAGE_ID,
          sourceMessageId: SOURCE_ID,
        },
        error: null,
      }),
    } as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      state: "already_shared",
      ownerUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      sourceMessageId: SOURCE_ID,
      sharedMessageId: SHARED_MESSAGE_ID,
    });
  });

  it("rejects an invalid source, untrusted origin, actor switch, and query input before service access", async () => {
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const invalid = await GET(request(), context("not-a-uuid"));
    expect(invalid.status).toBe(404);

    vi.mocked(isTrustedMutationRequest).mockReturnValueOnce(false);
    const untrusted = await GET(request(), context());
    expect(untrusted.status).toBe(403);

    const switched = await GET(request(OTHER_ID), context());
    expect(switched.status).toBe(409);

    const queried = await GET(request(OWNER_ID, "?private=true"), context());
    expect(queried.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed for auth, roster, and rate-limit changes", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never);
    expect((await GET(request(), context())).status).toBe(401);

    const profile = query({ couple_id: COUPLE_ID, role: "bride" });
    const wrongCouple = query({ bride_id: OTHER_ID, groom_id: null });
    vi.mocked(createClientFromRequest).mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: OWNER_ID } } }),
      },
      from: vi.fn((name: string) => name === "profiles" ? profile : wrongCouple),
    } as never);
    expect((await GET(request(), context())).status).toBe(403);

    installClient();
    vi.mocked(checkRateLimit).mockReturnValueOnce(NextResponse.json(
      { code: "RATE_LIMITED" },
      { status: 429 },
    ));
    const limited = await GET(request(), context());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    ["AMORA_FIRST_USE_PROMOTION_CRITERION_CHANGED", 409, "FIRST_USE_PROMOTION_CRITERION_STALE"],
    ["AMORA_FIRST_USE_PROMOTION_JOURNEY_CHANGED", 409, "FIRST_USE_PROMOTION_STALE"],
    ["AMORA_FIRST_USE_PROMOTION_SCOPE_CHANGED", 403, "FIRST_USE_PROMOTION_IDENTITY_CHANGED"],
    ["AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID", 404, "FIRST_USE_PROMOTION_NOT_FOUND"],
    ["unexpected infrastructure failure", 503, "FIRST_USE_PROMOTION_UNAVAILABLE"],
  ])("maps a bounded RPC failure without leaking private source data", async (message, status, code) => {
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }),
    } as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ code });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    {
      version: 1,
      status: "ready",
      promotionId: null,
      sharedMessageId: null,
      sourceMessageId: OTHER_ID,
      sourceRevision: 7,
      criterionDecisionId: null,
      canonicalActionInput: { action, reason, completionCriterion },
    },
    {
      version: 1,
      status: "ready",
      promotionId: null,
      sharedMessageId: null,
      sourceMessageId: SOURCE_ID,
      sourceRevision: 7,
      criterionDecisionId: null,
      canonicalActionInput: {
        action,
        reason,
        completionCriterion,
        privateGrounding: "must not escape",
      },
    },
    {
      version: 1,
      status: "promoted",
      promotionId: PROMOTION_ID,
      sharedMessageId: SHARED_MESSAGE_ID,
      sourceMessageId: SOURCE_ID,
      privateText: "must not escape",
    },
  ])("rejects malformed, foreign, or privacy-expanding service output", async (data) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data, error: null }),
    } as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "FIRST_USE_PROMOTION_INVALID_RESPONSE",
    });
  });
});
