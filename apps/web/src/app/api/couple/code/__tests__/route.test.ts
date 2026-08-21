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
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

type DbError = { code?: string; message?: string };
type QueryResult = { data: unknown; error: DbError | null };
type QueryHandler = {
  single?: QueryResult;
  maybeSingle?: QueryResult;
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

function request(
  method: "GET" | "POST",
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost/api/couple/code", { method, headers });
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

  it.each(["GET", "POST"] as const)(
    "%s rejects an account-switched v2 request before privileged access",
    async (method) => {
      const actorHeaders = {
        [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
        [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: PARTNER_ID,
      };

      const response = method === "GET"
        ? await GET(request(method, actorHeaders))
        : await POST(request(method, actorHeaders));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: "MUTATION_ACTOR_CHANGED",
      });
      expect(createAdminClientSpy).not.toHaveBeenCalled();
    },
  );

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

  it("rotates an expired code instead of disclosing it as active", async () => {
    const { admin, filters } = setup({
      profiles: [profileSuccess],
      couples: [
        {
          single: {
            data: couple({
              invite_code: "WH-OLD123",
              invite_code_expires_at: "2026-08-08T00:00:00.000Z",
            }),
            error: null,
          },
        },
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
    await expect(response.json()).resolves.toEqual({
      inviteCode: "WH-NEW123",
      isFullyLinked: false,
      isMembershipSealed: false,
      // 새 코드에도 7일 창이 붙는다. 시각은 실행 시점이라 모양만 본다.
      inviteCodeExpiresAt: expect.any(String),
      // 만료로 돌린 것도 재발급이다 — 예전 코드는 죽었다고 말해야 한다.
      inviteCodeReissued: true,
    });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(filters).toContainEqual(["eq", "invite_code", "WH-OLD123"]);
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
