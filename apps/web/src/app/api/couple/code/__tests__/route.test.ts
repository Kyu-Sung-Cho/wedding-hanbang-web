import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientFromRequestSpy, createAdminClientSpy } = vi.hoisted(() => ({
  createClientFromRequestSpy: vi.fn(),
  createAdminClientSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: createClientFromRequestSpy,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: createAdminClientSpy,
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

import { GET, POST } from "../route";

type DbError = { code?: string; message?: string };
type QueryResult = { data: unknown; error: DbError | null };
type CountResult = { count: number | null; error: DbError | null };
type QueryHandler = {
  single?: QueryResult;
  maybeSingle?: QueryResult;
  /**
   * `select(..., { count: "exact", head: true })` 처럼 종결 메서드 없이 그대로
   * await 되는 질의의 답. 합류 시 지워질 개수를 세는 경로가 이 모양이다.
   */
  count?: CountResult;
  onIn?: (column: string, values: unknown) => void;
  onOr?: (expression: string) => void;
  onUpdate?: (payload: unknown) => void;
  onFilter?: (method: "eq" | "is", column: string, value: unknown) => void;
};

class FakeQuery {
  constructor(private readonly handler: QueryHandler) {}

  select() { return this; }
  update(payload: unknown) {
    this.handler.onUpdate?.(payload);
    return this;
  }
  eq(column: string, value: unknown) {
    this.handler.onFilter?.("eq", column, value);
    return this;
  }
  is(column: string, value: unknown) {
    this.handler.onFilter?.("is", column, value);
    return this;
  }
  in(column: string, values: unknown) {
    this.handler.onIn?.(column, values);
    return this;
  }
  or(expression: string) {
    this.handler.onOr?.(expression);
    return this;
  }
  /**
   * 종결 메서드 없이 `await` 되는 질의를 흉내낸다. 이걸 넣지 않으면 개수 세는
   * 경로가 예외로 빠져 **항상 null** 이 되고, 서버가 숫자를 싣는지 아무도 못 잰다
   * (실제로 이 파일의 기존 16개는 그 상태로 전부 초록이었다).
   */
  then(
    resolve: (value: CountResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) {
    try {
      return Promise.resolve(resolve(this.handler.count ?? { count: 0, error: null }));
    } catch (error) {
      return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
    }
  }
  single() {
    return Promise.resolve(
      this.handler.single ?? { data: null, error: null },
    );
  }
  maybeSingle() {
    return Promise.resolve(
      this.handler.maybeSingle ?? { data: null, error: null },
    );
  }
}

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

const profileSuccess: QueryHandler = {
  single: { data: { couple_id: COUPLE_ID }, error: null },
};

function couple(
  overrides: Partial<{
    invite_code: string | null;
    bride_id: string | null;
    groom_id: string | null;
    membership_sealed_at: string | null;
    invite_code_expires_at: string | null;
  }> = {},
) {
  return {
    invite_code: "WH-ABC123",
    bride_id: USER_ID,
    groom_id: null,
    membership_sealed_at: null,
    // 기본은 넉넉히 남은 코드. 만료 케이스는 테스트에서 명시적으로 넣는다.
    invite_code_expires_at: new Date(Date.now() + 6 * 86400000).toISOString(),
    ...overrides,
  };
}

function setup(
  handlers: Record<string, QueryHandler[]>,
  rpcResult: QueryResult = { data: "WH-NEW123", error: null },
) {
  const updates: unknown[] = [];
  const filters: Array<["eq" | "is", string, unknown]> = [];
  const fromCalls: string[] = [];
  const admin = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const handler = handlers[table]?.shift();
      if (!handler) throw new Error(`unexpected ${table} query`);
      return new FakeQuery({
        ...handler,
        onUpdate: (payload) => {
          updates.push(payload);
          handler.onUpdate?.(payload);
        },
        onFilter: (method, column, value) => {
          filters.push([method, column, value]);
          handler.onFilter?.(method, column, value);
        },
      });
    }),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
  createAdminClientSpy.mockReturnValue(admin);
  return { admin, updates, filters, fromCalls };
}

function request(method: "GET" | "POST") {
  return new Request("http://localhost/api/couple/code", { method });
}

describe("/api/couple/code roster epoch fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"a".repeat(40)}`;
    createClientFromRequestSpy.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
    });
  });

  it("GET returns no invite code and performs no regeneration for a sealed pair", async () => {
    const { admin, updates } = setup({
      profiles: [profileSuccess],
      couples: [{
        single: {
          data: couple({
            bride_id: USER_ID,
            groom_id: PARTNER_ID,
            membership_sealed_at: "2026-07-16T00:00:00Z",
          }),
          error: null,
        },
      }],
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      inviteCode: null,
      isFullyLinked: true,
      isMembershipSealed: true,
      inviteCodeExpiresAt: null,
      inviteCodeReissued: false,
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("POST cannot regenerate a code after a sealed member has left", async () => {
    const { admin, updates } = setup({
      profiles: [profileSuccess],
      couples: [{
        single: {
          data: couple({
            invite_code: "WH-RAW123",
            bride_id: USER_ID,
            groom_id: null,
            membership_sealed_at: "2026-07-16T00:00:00Z",
          }),
          error: null,
        },
      }],
    });

    const response = await POST(request("POST"));

    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("inviteCode");
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("fails closed when invite-code generation fails", async () => {
    const { updates } = setup(
      {
        profiles: [profileSuccess],
        couples: [{
          single: {
            data: couple({ invite_code: null }),
            error: null,
          },
        }],
      },
      { data: null, error: { code: "XX000", message: "generator failed" } },
    );

    const response = await GET(request("GET"));

    expect(response.status).toBe(500);
    expect(updates).toEqual([]);
  });

  it("rejects a malformed generated code instead of using a local fallback", async () => {
    const { updates } = setup(
      {
        profiles: [profileSuccess],
        couples: [{ single: { data: couple(), error: null } }],
      },
      { data: "bad-code", error: null },
    );

    const response = await POST(request("POST"));

    expect(response.status).toBe(500);
    expect(updates).toEqual([]);
  });

  it("persists a missing code with a sealed-state compare-and-swap", async () => {
    const { filters, updates } = setup({
      profiles: [profileSuccess],
      couples: [
        { single: { data: couple({ invite_code: null }), error: null } },
        {
          maybeSingle: {
            data: couple({ invite_code: "WH-NEW123" }),
            error: null,
          },
        },
      ],
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      inviteCode: "WH-NEW123",
      isFullyLinked: false,
      isMembershipSealed: false,
      inviteCodeReissued: false,
    });
    expect(updates).toHaveLength(1);
    expect(filters).toContainEqual(["is", "membership_sealed_at", null]);
    expect(filters).toContainEqual(["is", "invite_code", null]);
  });

  it("rotates an unsealed code only when the expected old code still matches", async () => {
    const { filters } = setup({
      profiles: [profileSuccess],
      couples: [
        { single: { data: couple({ invite_code: "WH-OLD123" }), error: null } },
        {
          maybeSingle: {
            data: couple({ invite_code: "WH-NEW123" }),
            error: null,
          },
        },
      ],
    });

    const response = await POST(request("POST"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      inviteCode: "WH-NEW123",
      // 직접 재발급을 눌렀으면 이미 보낸 코드는 죽었다 — 다시 보내라고 말해야 한다.
      inviteCodeReissued: true,
    });
    expect(filters).toContainEqual(["is", "membership_sealed_at", null]);
    expect(filters).toContainEqual(["eq", "invite_code", "WH-OLD123"]);
  });

  // 20260812030000 이 모든 살아있는 코드에 7일 창을 박았다. 운영 기준 19개가
  // 2026-08-27 에 한꺼번에 만료된다. 앱이 이걸 안 보면 화면엔 코드가 보이는데
  // 상대는 "초대 코드가 올바르지 않습니다"를 받는다 — 파트너 연결은 이 제품에서
  // 가장 크게 새는 구간이라 조용히 죽으면 안 된다.
  it("만료된 코드는 조용히 새 코드로 갈아끼운다", async () => {
    const expiredCode = "WH-EXPIRED001";
    const { filters } = setup({
      profiles: [profileSuccess],
      couples: [
        {
          single: {
            data: couple({
              invite_code: expiredCode,
              invite_code_expires_at: new Date(Date.now() - 1000).toISOString(),
            }),
            error: null,
          },
        },
        { maybeSingle: { data: couple({ invite_code: "WH-FRESH0001" }), error: null } },
      ],
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ inviteCode: "WH-FRESH0001" });
    // 만료된 기존 코드를 기대값으로 CAS 해야 한다 — null 로 하면 아무것도 안 바뀐다
    expect(filters).toContainEqual(["eq", "invite_code", expiredCode]);
  });

  it("아직 안 만료된 코드는 괜히 회전시키지 않는다", async () => {
    const { fromCalls } = setup({
      profiles: [profileSuccess],
      couples: [
        {
          single: {
            data: couple({
              invite_code: "WH-STILLGOOD",
              invite_code_expires_at: new Date(Date.now() + 86400000).toISOString(),
            }),
            error: null,
          },
        },
      ],
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ inviteCode: "WH-STILLGOOD" });
    // 멀쩡한 코드를 회전시키면 상대가 이미 받은 코드가 죽는다
    expect(fromCalls.filter((name) => name === "couples")).toHaveLength(1);
  });

  it("만료 컬럼이 없는 DB 에서도 커플 카드가 죽지 않는다", async () => {
    // 앱이 마이그레이션보다 먼저 나가는 일은 이 저장소에서 실제로 있었다.
    const { fromCalls } = setup({
      profiles: [profileSuccess],
      couples: [
        { single: { data: null, error: { code: "42703", message: "column does not exist" } } },
        // 폴백은 좁은 컬럼만 돌려준다 — 없는 컬럼이 값으로 돌아올 리 없다.
        {
          single: {
            data: {
              invite_code: "WH-LEGACYOK1",
              bride_id: USER_ID,
              groom_id: null,
              membership_sealed_at: null,
            },
            error: null,
          },
        },
      ],
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      inviteCode: "WH-LEGACYOK1",
      // 모르는 것을 "안 바뀌었다"거나 "언제까지"라고 지어내지 않는다.
      inviteCodeExpiresAt: null,
      inviteCodeReissued: false,
    });
    expect(fromCalls.filter((name) => name === "couples").length).toBeGreaterThanOrEqual(2);
  });

  // 조용히 갈아끼우는 것만으로는 부족하다. 초대한 쪽이 이미 문자로 보낸 코드가
  // 죽은 줄 모르면 새 코드를 다시 보내지 않고, 상대는 계속 실패한다.
  it("자동 회전 뒤에는 '코드가 새로 발급됐다'를 함께 알린다", async () => {
    setup({
      profiles: [profileSuccess],
      couples: [
        {
          single: {
            data: couple({
              invite_code: "WH-EXPIRED001",
              invite_code_expires_at: new Date(Date.now() - 1000).toISOString(),
            }),
            error: null,
          },
        },
        {
          maybeSingle: {
            data: couple({
              invite_code: "WH-FRESH0001",
              invite_code_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
            }),
            error: null,
          },
        },
      ],
    });

    const response = await GET(request("GET"));

    await expect(response.json()).resolves.toMatchObject({
      inviteCode: "WH-FRESH0001",
      inviteCodeReissued: true,
    });
  });

  // 20260812030000:81-91 은 invite_code 를 그대로 둔 채 invite_code_issued_at 만
  // 찍은 행도 만들었다. 그걸 재발급으로 읽으면, 코드가 바뀐 적 없는 사람에게
  // "예전 코드는 더 이상 쓸 수 없다"는 거짓말을 하게 된다.
  it("바뀐 적 없는 코드에 재발급 딱지를 붙이지 않는다", async () => {
    setup({
      profiles: [profileSuccess],
      couples: [{
        single: {
          data: couple({
            invite_code: "WH-UNCHANGED1",
            invite_code_expires_at: new Date(Date.now() + 86400000).toISOString(),
          }),
          error: null,
        },
      }],
    });

    const response = await GET(request("GET"));

    await expect(response.json()).resolves.toMatchObject({
      inviteCode: "WH-UNCHANGED1",
      inviteCodeReissued: false,
    });
  });

  // 코드가 아예 없어서 처음 발급하는 경우는 보낸 적도 없으니 할 말이 아니다.
  it("처음 발급하는 코드는 재발급이 아니다", async () => {
    setup({
      profiles: [profileSuccess],
      couples: [
        { single: { data: couple({ invite_code: null }), error: null } },
        { maybeSingle: { data: couple({ invite_code: "WH-FIRST00001" }), error: null } },
      ],
    });

    const response = await GET(request("GET"));

    await expect(response.json()).resolves.toMatchObject({
      inviteCode: "WH-FIRST00001",
      inviteCodeReissued: false,
    });
  });

  it("checks profile and couple lookup errors before privileged writes", async () => {
    const profileFailure = setup({
      profiles: [{
        single: { data: null, error: { code: "XX000", message: "lookup failed" } },
      }],
    });
    const profileResponse = await GET(request("GET"));
    expect(profileResponse.status).toBe(500);
    expect(profileFailure.fromCalls).toEqual(["profiles"]);

    vi.clearAllMocks();
    createClientFromRequestSpy.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
    });
    const coupleFailure = setup({
      profiles: [profileSuccess],
      couples: [{
        single: { data: null, error: { code: "XX000", message: "lookup failed" } },
      }],
    });
    const coupleResponse = await GET(request("GET"));
    expect(coupleResponse.status).toBe(500);
    expect(coupleFailure.admin.rpc).not.toHaveBeenCalled();
    expect(coupleFailure.updates).toEqual([]);
  });

  it("does not return a stale code when sealing wins the GET regeneration race", async () => {
    const { admin } = setup({
      profiles: [profileSuccess],
      couples: [
        { single: { data: couple({ invite_code: null }), error: null } },
        { maybeSingle: { data: null, error: null } },
        {
          single: {
            data: couple({
              invite_code: "WH-RAW123",
              groom_id: PARTNER_ID,
              membership_sealed_at: "2026-07-16T00:00:00Z",
            }),
            error: null,
          },
        },
      ],
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      inviteCode: null,
      isFullyLinked: true,
      isMembershipSealed: true,
      inviteCodeExpiresAt: null,
      inviteCodeReissued: false,
    });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns a conflict when sealing wins the POST regeneration race", async () => {
    const { filters } = setup({
      profiles: [profileSuccess],
      couples: [
        { single: { data: couple({ invite_code: "WH-OLD123" }), error: null } },
        { maybeSingle: { data: null, error: null } },
        {
          single: {
            data: couple({
              invite_code: "WH-OLD123",
              groom_id: PARTNER_ID,
              membership_sealed_at: "2026-07-16T00:00:00Z",
            }),
            error: null,
          },
        },
      ],
    });

    const response = await POST(request("POST"));

    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("inviteCode");
    expect(filters).toContainEqual(["is", "membership_sealed_at", null]);
    expect(filters).toContainEqual(["eq", "invite_code", "WH-OLD123"]);
  });

  it("does not report success when the compare-and-swap update errors", async () => {
    setup({
      profiles: [profileSuccess],
      couples: [
        { single: { data: couple({ invite_code: null }), error: null } },
        {
          maybeSingle: {
            data: null,
            error: { code: "XX000", message: "write failed" },
          },
        },
      ],
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(500);
  });
});

/**
 * 배우자가 합류하면 지워지는 것을 서버가 세어 보낸다.
 *
 * 커플 구성이 바뀌면 `trg_reset_amora_memory_after_membership_change`
 * (20260716090000:265) 가 그 범위의 자동 메모·대화 요약·프로필을 지운다. 그
 * 판단은 옳다 — 새로 들어온 사람이 자기가 없던 시절의 추론을 "우리 커플의
 * 사실"로 물려받으면 안 된다. 고치는 것은 **아무도 그 말을 안 하던 것**이다.
 *
 * 2026-08-30 운영 실측: 커플 58쌍 중 21쌍이 혼자, 합류 시 자동 메모 89 + 요약 6.
 * 확인·수정한 것은 0건이고 확정한 예산·일정 41건은 트리거 조건에 걸리지 않는다.
 */
describe("합류 시 지워질 것을 초대 응답이 알려준다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientFromRequestSpy.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
    });
  });

  function purgeHandlers(memories: number, summaries: number, profiles: number) {
    return {
      decision_nodes: [{ count: { count: memories, error: null } }],
      chat_summaries: [{ count: { count: summaries, error: null } }],
      amora_couple_profiles: [{ count: { count: profiles, error: null } }],
    };
  }

  it("혼자인 커플에게는 개수를 실어 보낸다", async () => {
    setup({
      profiles: [profileSuccess],
      couples: [{ single: { data: couple(), error: null } }],
      ...purgeHandlers(12, 3, 1),
    });

    const body = await (await GET(request("GET"))).json();
    expect(body.pendingPartnerJoinPurge).toEqual({
      memories: 12, summaries: 3, profiles: 1, total: 16,
    });
  });

  it("트리거와 같은 범위·같은 조건으로 센다", async () => {
    // 화면이 보여줄 숫자가 트리거의 DELETE 와 다르면 없느니만 못하다.
    // 트리거는 `shared` 에 더해 **값이 바뀌는 슬롯의 레인**을 지운다 — 합류하면
    // 비어 있던 쪽(여기서는 groom)이 채워진다. 그리고 자동 메모만 지운다
    // (`memory_key` 가 있거나 `extracted_by` 가 붙은 것).
    const lanes: unknown[] = [];
    const expressions: string[] = [];
    setup({
      profiles: [profileSuccess],
      couples: [{ single: { data: couple(), error: null } }],
      decision_nodes: [{
        count: { count: 1, error: null },
        onIn: (_column, values) => lanes.push(values),
        onOr: (expression) => expressions.push(expression),
      }],
      chat_summaries: [{ count: { count: 0, error: null }, onIn: (_c, v) => lanes.push(v) }],
      amora_couple_profiles: [{ count: { count: 0, error: null }, onIn: (_c, v) => lanes.push(v) }],
    });

    await GET(request("GET"));

    for (const lane of lanes) {
      expect(lane).toEqual(["shared", "groom_private"]);
    }
    expect(expressions).toEqual([
      "memory_key.not.is.null,metadata->>extracted_by.not.is.null",
    ]);
  });

  it("세지 못해도 초대 코드는 그대로 나간다", async () => {
    // 이 숫자는 초대 코드보다 덜 중요하다. 못 세면 경고만 빠지고 카드는 산다.
    setup({
      profiles: [profileSuccess],
      couples: [{ single: { data: couple(), error: null } }],
      decision_nodes: [{ count: { count: null, error: { code: "42P01" } } }],
      chat_summaries: [{ count: { count: 0, error: null } }],
      amora_couple_profiles: [{ count: { count: 0, error: null } }],
    });

    const response = await GET(request("GET"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.inviteCode).toBe("WH-ABC123");
    expect(body.pendingPartnerJoinPurge).toBeNull();
  });

  it("이미 두 명이면 세지도 않는다", async () => {
    // 합류할 사람이 없으므로 물어볼 필요가 없다. 세러 가면 핸들러가 없어 터진다.
    const { fromCalls } = setup({
      profiles: [profileSuccess],
      couples: [{ single: { data: couple({ groom_id: PARTNER_ID }), error: null } }],
    });

    const body = await (await GET(request("GET"))).json();
    expect(body.isFullyLinked).toBe(true);
    expect(body.pendingPartnerJoinPurge).toBeUndefined();
    expect(fromCalls).not.toContain("decision_nodes");
  });
});
