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

/**
 * 옛 방식으로 만든 준비 공간에도 새 방식 화면에서 합류할 수 있다.
 *
 * ## 무엇이 막혀 있었나 (2026-08-31 운영 실측)
 *
 * `join_neutral_preparation_space_server` 는 대상 공간이 `member_model_version <> 2`
 * 이면 `LEGACY_PREPARATION_SPACE` 로 거절한다. 운영의 커플 57쌍 중 **55쌍이 model 1**
 * 이고 그중 **17쌍이 "혼자 + 초대 열림"** 이었다 — 8월 하순 전에 시작한 사람은
 * 배우자를 연결할 방법이 아예 없었다.
 *
 * 거절 문구는 "코드를 만든 분에게 새 코드를 요청해 주세요" 인데, 새 코드를 받아도
 * **같은 공간이라 똑같이 거절된다.** 시키는 대로 하면 영원히 안 된다.
 *
 * 그리고 그 거절은 `couple_invite_join_attempts` 에 기록을 남기기 **전에** 일어난다.
 * 그래서 DB 에는 시도 흔적조차 없었고, 사용자에게는 "아무 일도 안 일어나는" 것으로
 * 보였다.
 *
 * ## 역할을 왜 안 물어보나
 *
 * 옛 공간은 자리가 둘이고, 초대가 열려 있다는 것은 한 자리가 비었다는 뜻이다.
 * 신랑이 차 있으면 들어오는 사람은 신부다 — 고를 것이 없다.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
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

/** 운영이 실제로 보내는 몸통 — `buildNeutralPreparationSpaceSubmission` 의 join 형태. */
function joinBody() {
  return {
    membershipMode: "neutral_preparation_space",
    coupleAction: "join",
    partnerInviteCode: CODE,
    weddingDate: null,
    venue: null,
    totalBudget: null,
    progress: {},
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/onboarding", {
    method: "POST",
    // 브라우저가 실제로 붙이는 헤더. 없으면 라우트가 403 으로 막는다.
    headers: { "Content-Type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

/** 새 방식 RPC 가 옛 공간을 거절하는 실제 응답. */
const LEGACY_REJECTION = {
  data: {
    success: false,
    joined: false,
    idempotent: false,
    error_code: "LEGACY_PREPARATION_SPACE",
    error: "This space uses roles.",
  },
  error: null,
};

/**
 * 옛 경로가 성공했을 때의 응답.
 *
 * 모양을 지어내지 않고 `parseMembershipRpcResponse` 가 요구하는 것에서 유도했다 —
 * `invite_code` 를 빼먹었더니 파서가 `INVALID_RPC_RESPONSE` 로 떨어뜨려 "성공했는데도
 * 다음 역할을 또 시도"하는 헛초록불이 날 뻔했다.
 */
const LEGACY_JOIN_SUCCESS = {
  data: {
    success: true,
    joined: true,
    idempotent: false,
    couple_id: COUPLE_ID,
    invite_code: CODE,
    role: "bride",
  },
  error: null,
};

/** `join_couple` 이 호출 순서대로 돌려줄 응답. 마지막 값은 이후 호출에 계속 쓰인다. */
function setup(authRpcSequence: unknown[]) {
  let callIndex = 0;
  const authClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
            email: "user@example.com",
            created_at: "2026-08-30T00:00:00.000Z", user_metadata: { name: "테스트", terms_agreed: true, privacy_agreed: true },
          },
        },
      }),
    },
    rpc: vi.fn(async () => authRpcSequence[Math.min(callIndex++, authRpcSequence.length - 1)]),
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(authClient as never);

  // 합류가 성공한 뒤 계획 저장·프로필 완료가 이어진다. 그 단계가 죽으면 200 이
  // 안 나오므로, 그쪽이 실제로 읽는 최소한을 채워 둔다(route.test.ts 의 모양).
  const tableResults: Record<string, QueryResult> = {
    profiles: { data: { id: USER_ID, couple_id: COUPLE_ID }, error: null },
    wedding_journeys: {
      data: {
        id: "journey-1",
        wedding_date: null,
        venue: null,
        total_budget: 0,
        progress: {},
        state_revision: 1,
      },
      error: null,
    },
  };
  const admin = {
    from: vi.fn((table: string) =>
      new FakeQuery(tableResults[table] ?? { data: null, error: null })),
    rpc: vi.fn().mockResolvedValue(LEGACY_REJECTION),
  };
  vi.mocked(createClient).mockReturnValue(admin as never);
  return { authClient, admin };
}

describe("옛 방식 공간에도 새 방식 화면에서 합류한다", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "2026-09-01T00:00:00.000Z");
    vi.clearAllMocks();
    vi.stubEnv("AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED", "true");
  });

  /** 역할이 맞지 않을 때 RPC 가 주는 응답. 자리별 코드는 없고 이 하나뿐이다. */
  const WRONG_ROLE = {
    data: {
      success: false,
      joined: false,
      idempotent: false,
      error_code: "INVALID_INVITE_CODE",
      error: "Invalid invite code.",
    },
    error: null,
  };

  it("신부 자리가 비었으면 첫 시도로 붙는다", async () => {
    const { authClient } = setup([LEGACY_JOIN_SUCCESS]);

    const response = await POST(request(joinBody()));

    expect(authClient.rpc).toHaveBeenCalledTimes(1);
    expect(authClient.rpc).toHaveBeenCalledWith("join_couple", {
      p_invite_code: CODE,
      p_role: "bride",
    });
    expect(response.status).toBe(200);
  });

  it("신부가 차 있으면 신랑으로 한 번 더 시도한다", async () => {
    const { authClient } = setup([
      WRONG_ROLE,
      { ...LEGACY_JOIN_SUCCESS, data: { ...LEGACY_JOIN_SUCCESS.data, role: "groom" } },
    ]);

    const response = await POST(request(joinBody()));

    expect(authClient.rpc).toHaveBeenCalledTimes(2);
    expect(authClient.rpc).toHaveBeenNthCalledWith(2, "join_couple", {
      p_invite_code: CODE,
      p_role: "groom",
    });
    expect(response.status).toBe(200);
  });

  it("두 자리 다 안 되면 두 번만 시도하고 오류를 준다", async () => {
    // 한도가 10분에 10번이다. 무한히 시도하면 사용자의 남은 시도를 태운다.
    const { authClient } = setup([WRONG_ROLE]);

    const response = await POST(request(joinBody()));

    expect(authClient.rpc).toHaveBeenCalledTimes(2);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("RPC 가 아예 실패하면 두 번째를 시도하지 않는다", async () => {
    // 전송 자체가 실패한 것은 역할 문제가 아니다. 다시 걸어도 같은 결과다.
    const { authClient } = setup([{ data: null, error: { code: "57014" } }]);

    await POST(request(joinBody()));

    expect(authClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("새 방식 공간이면 되부르지 않는다", async () => {
    // 새 경로가 성공하면 옛 경로를 부를 이유가 없다.
    const { authClient, admin } = setup([LEGACY_JOIN_SUCCESS]);
    admin.rpc.mockResolvedValue({
      data: { success: true, joined: true, idempotent: false, couple_id: COUPLE_ID },
      error: null,
    });

    await POST(request(joinBody()));

    expect(authClient.rpc).not.toHaveBeenCalled();
  });

  it("다른 이유로 거절되면 되부르지 않는다", async () => {
    // 만료·이미 연결됨은 역할 문제가 아니다. 되부르면 한도만 태우고 같은 답이 온다.
    const { authClient, admin } = setup([LEGACY_JOIN_SUCCESS]);
    admin.rpc.mockResolvedValue({
      data: {
        success: false, joined: false, idempotent: false,
        error_code: "INVITE_CODE_EXPIRED", error: "Invite code expired.",
      },
      error: null,
    });

    const response = await POST(request(joinBody()));

    expect(authClient.rpc).not.toHaveBeenCalled();
    expect(response.status).toBe(410);
  });
});
