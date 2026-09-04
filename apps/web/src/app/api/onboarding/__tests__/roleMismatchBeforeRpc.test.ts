/**
 * 합류자가 역할을 반대로 고르면 "코드가 틀렸다"가 아니라 "반대 역할" 로 안내한다.
 *
 * 2026-09-04 출시 전날 실측: 신부가 만든 유효한 코드에 신랑이 역할만 '신부'로 고르자
 * DB(`join_couple_invite_core`)가 같은 역할은 못 들어간다며 INVALID_INVITE_CODE 를 돌려주고,
 * 화면은 "초대 코드가 올바르지 않습니다" 라고 했다. 코드는 맞는데 오타를 의심하게 만들고,
 * 실패 한 번마다 합류 재시도 한도(10회/10분)만 태웠다.
 *
 * 라우트가 코드로 커플을 먼저 찾아, 고른 역할의 자리가 **다른 사람**으로 차 있고 반대
 * 자리가 비어 있으면 RPC 를 부르기 전에 ROLE_MISMATCH 로 답한다. 본인 재합류(멱등)와
 * 중립 공간은 그대로 DB 가 판정한다.
 */
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClientFromRequest } from "@/lib/supabase/server";

import { POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/memory/record-decision", () => ({
  recordDecision: vi.fn().mockResolvedValue({ nodeId: "decision-1" }),
}));
vi.mock("@/lib/ai/stage-router", () => ({ determineStage: vi.fn(() => "planning") }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "onboarding:user-1"),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "12345678-1234-4234-9234-123456789abc";
const CODE = "WH-23EF80971A41";

type QueryResult = { data?: unknown; error?: { code?: string } | null };

class FakeQuery implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  is() { return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  insert() { return this; }
  update() { return this; }
  upsert() { return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  single() { return Promise.resolve(this.result); }
  then<R1 = QueryResult, R2 = never>(
    onfulfilled?: ((value: QueryResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function request(body: unknown) {
  return new Request("http://localhost/api/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

/** 옛 방식(역할 있음) 합류 몸통. */
function legacyJoinBody(role: "bride" | "groom") {
  return {
    role,
    coupleAction: "join",
    partnerInviteCode: CODE,
    weddingDate: null,
    venue: null,
    totalBudget: null,
    progress: {},
  };
}

const JOIN_SUCCESS = {
  data: {
    success: true, joined: true, idempotent: false,
    couple_id: COUPLE_ID, invite_code: CODE, role: "groom",
  },
  error: null,
};

function setup(couplesRow: { bride_id: string | null; groom_id: string | null } | null) {
  const authClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
            email: "user@example.com",
            user_metadata: { name: "테스트", terms_agreed: true, privacy_agreed: true },
          },
        },
      }),
    },
    rpc: vi.fn(async () => JOIN_SUCCESS),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(authClient as never);
  const tableResults: Record<string, QueryResult> = {
    profiles: { data: { id: USER_ID, couple_id: null }, error: null },
    couples: { data: couplesRow, error: null },
    wedding_journeys: {
      data: { couple_id: COUPLE_ID, wedding_date: null, venue: null, total_budget: 0, progress: {}, state_revision: 1 },
      error: null,
    },
  };
  const admin = {
    from: vi.fn((table: string) => new FakeQuery(tableResults[table] ?? { data: null, error: null })),
    rpc: vi.fn(async () => JOIN_SUCCESS),
  };
  vi.mocked(createClient).mockReturnValue(admin as never);
  return { authClient, admin };
}

describe("역할을 반대로 고른 합류", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED", "false");
  });

  it("신부 자리가 남으로 차 있고 신랑 자리가 비었는데 '신부'를 고르면 RPC 전에 반대 역할을 안내한다", async () => {
    const { authClient } = setup({ bride_id: OWNER_ID, groom_id: null });

    const response = await POST(request(legacyJoinBody("bride")));
    const body = await response.json() as { error?: string; code?: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("ROLE_MISMATCH");
    expect(body.error).toContain("반대 역할");
    expect(body.error).not.toContain("올바르지 않습니다");
    expect(authClient.rpc).not.toHaveBeenCalled();
  });

  it("반대 역할(신랑)을 고르면 그대로 RPC 로 간다", async () => {
    const { authClient } = setup({ bride_id: OWNER_ID, groom_id: null });

    const response = await POST(request(legacyJoinBody("groom")));

    expect(authClient.rpc).toHaveBeenCalledWith("join_couple", { p_invite_code: CODE, p_role: "groom" });
    // 뒤따르는 여정 저장은 이 목이 다 흉내내지 않는다 — 여기서 잰 것은 "가로막지 않았다" 뿐.
    expect(response.status).not.toBe(409);
  });

  it("본인이 이미 그 자리면(재합류) 가로막지 않는다", async () => {
    const { authClient } = setup({ bride_id: USER_ID, groom_id: null });

    await POST(request(legacyJoinBody("bride")));

    expect(authClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("코드로 커플을 못 찾으면 판정은 DB 에 맡긴다", async () => {
    const { authClient } = setup(null);

    await POST(request(legacyJoinBody("bride")));

    expect(authClient.rpc).toHaveBeenCalledTimes(1);
  });
});
