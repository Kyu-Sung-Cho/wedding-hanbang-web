import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkAmoraCostGuard,
  reserveAmoraProviderCall,
  reserveAmoraTurn,
  resolveGrandfatheredCoupleDailyCap,
} from "../costGuard";

// chat_messages 카운트를 흉내내는 가짜 Supabase 클라이언트.
// .from().select(...,{head,count}).eq().eq()/.gte() 체인이 최종적으로
// { count, error }를 resolve 하도록 구성. 호출별로 다른 count를 주입한다.
function makeAdmin(counts: { global?: number; couple?: number; error?: boolean }) {
  return {
    from() {
      let isGlobalQuery = false;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      // 전역 쿼리만 .gte(created_at)를 사용 → 이 호출이 있으면 global로 식별
      builder.gte = () => {
        isGlobalQuery = true;
        return builder;
      };
      // await 가능하게 thenable 로 만든다
      builder.then = (resolve: (v: { count: number | null; error: unknown }) => void) => {
        if (counts.error) return resolve({ count: null, error: { message: "boom" } });
        const count = isGlobalQuery ? (counts.global ?? 0) : (counts.couple ?? 0);
        return resolve({ count, error: null });
      };
      return builder;
    },
  } as never;
}

const BASE = { coupleId: "c1", isAdmin: false, maxCostMicrousd: 254_400 };

describe("checkAmoraCostGuard", () => {
  const ENV = process.env;
  beforeEach(() => {
    process.env = { ...ENV };
    delete process.env.AMORA_COST_GUARD_ENABLED;
    delete process.env.AMORA_COUPLE_QUOTA_ENABLED;
    delete process.env.AMORA_FREE_MESSAGES_PER_COUPLE;
    delete process.env.AMORA_GLOBAL_DAILY_MESSAGE_CAP;
    delete process.env.AMORA_GLOBAL_DAILY_COST_CAP_USD;
    vi.resetModules();
  });
  afterEach(() => {
    process.env = ENV;
  });

  it("관리자도 global daily hard cap은 우회하지 않는다", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ global: 300, couple: 9999 }), {
      ...BASE,
      isAdmin: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("global_daily");
  });

  it("관리자는 global cap 아래에서 커플 lifetime cap을 우회한다", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ global: 10, couple: 100 }), {
      ...BASE,
      isAdmin: true,
    });
    expect(r.allowed).toBe(true);
  });

  it("demo도 global daily hard cap은 우회하지 않는다", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ global: 300, couple: 0 }), {
      ...BASE,
      quotaScope: "demo",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("global_daily");
  });

  it("demo는 global cap 아래에서 커플 lifetime cap을 우회한다", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ global: 10, couple: 100 }), {
      ...BASE,
      quotaScope: "demo",
    });
    expect(r.allowed).toBe(true);
  });

  it.each([
    ["admin", { ...BASE, isAdmin: true }],
    ["demo", { ...BASE, quotaScope: "demo" as const }],
  ])("%s 사전 게이트는 global 장부 조회 실패 시 fail-closed 한다", async (_label, params) => {
    const r = await checkAmoraCostGuard(makeAdmin({ error: true }), params);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("guard_unavailable");
  });

  it("정상 범위 내면 통과", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ global: 10, couple: 5 }), BASE);
    expect(r.allowed).toBe(true);
  });

  it("전역 일일 상한 도달 시 차단", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ global: 300, couple: 0 }), BASE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("global_daily");
  });

  it("커플 누적 상한 도달 시 차단", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ global: 10, couple: 50 }), BASE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("couple_quota");
    expect(r.message).toContain("예산·체크리스트·일정·견적 진단");
  });

  it("카운트 에러 시 미계측 호출을 막기 위해 fail-closed", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ error: true }), BASE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("guard_unavailable");
  });
});

// 원자 예약 경로용 가짜 클라이언트 — rpc()와, 폴백 검증용 from() 체인을 함께 제공.
// rpc: "error"면 { data: null, error } 반환, "throw"면 예외, 객체면 정상 응답 row.
function makeReserveAdmin(opts: {
  rpc: { allowed: boolean; reason?: string | null } | "error" | "throw";
  counts?: { global?: number; couple?: number; error?: boolean };
}) {
  const base = makeAdmin(opts.counts ?? {}) as { from: () => unknown };
  const rpcSpy = vi.fn(async () => {
    if (opts.rpc === "throw") throw new Error("rpc boom");
    if (opts.rpc === "error") return { data: null, error: { message: "function not found" } };
    // Supabase는 RETURNS TABLE을 행 배열로 돌려준다
    return { data: [opts.rpc], error: null };
  });
  return { admin: { from: base.from, rpc: rpcSpy } as never, rpcSpy };
}

describe("reserveAmoraTurn (원자 예약)", () => {
  const ENV = process.env;
  beforeEach(() => {
    process.env = { ...ENV };
    delete process.env.AMORA_COST_GUARD_ENABLED;
    delete process.env.AMORA_COUPLE_QUOTA_ENABLED;
    delete process.env.AMORA_GLOBAL_DAILY_COST_CAP_USD;
  });
  afterEach(() => {
    process.env = ENV;
  });

  it("관리자는 커플 lifetime cap만 우회하고 global daily hard cap에는 거부된다", async () => {
    const { admin, rpcSpy } = makeReserveAdmin({
      rpc: { allowed: false, reason: "global_daily" },
    });
    const r = await reserveAmoraTurn(admin, { ...BASE, isAdmin: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("global_daily");
    expect(rpcSpy).toHaveBeenCalledWith("reserve_amora_turn", {
      p_couple_id: "c1",
      p_couple_cap: 2_147_483_647,
      p_global_cap: 300,
      p_reserve_cost_microusd: 254_400,
      p_global_cost_cap_microusd: 20_000_000,
    });
  });

  // 2026-08-26: 체험이 **실사용자와 같은 전역 천장**을 받던 것을 낮췄다. 체험에는
  // 커플당 하루 상한이 걸리지 않아(standard 가 아니면 즉시 통과) 막는 것이 IP당
  // 시간당 60회뿐이었고, 구경하는 사람이 몰리면 가입한 사람이 첫 메시지부터 막혔다.
  // 이 검사의 원래 의도(커플 lifetime cap 은 우회하되 전역은 원자 예약한다)는
  // 그대로이고, 천장 값만 낮아진다.
  it("demo는 커플 lifetime cap을 우회하되 전역은 더 낮은 천장으로 원자 예약한다", async () => {
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true, reason: null } });

    const r = await reserveAmoraTurn(admin, { ...BASE, quotaScope: "demo" });

    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeUndefined();
    expect(rpcSpy).toHaveBeenCalledWith("reserve_amora_turn", {
      p_couple_id: "c1",
      p_couple_cap: 2_147_483_647,
      // 기본 전역 300 보다 낮다 — 그 차이가 가입한 사람에게 남는 몫이다.
      p_global_cap: 150,
      p_reserve_cost_microusd: 254_400,
      p_global_cost_cap_microusd: 4_000_000,
    });
  });

  it("demo도 global daily hard cap에는 거부된다", async () => {
    const { admin } = makeReserveAdmin({
      rpc: { allowed: false, reason: "global_daily" },
    });

    const r = await reserveAmoraTurn(admin, { ...BASE, quotaScope: "demo" });

    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("global_daily");
  });

  it.each([
    ["admin", { ...BASE, isAdmin: true }],
    ["demo", { ...BASE, quotaScope: "demo" as const }],
  ])("%s 원자 예약은 장부 장애 시 fail-closed 한다", async (_label, params) => {
    const { admin } = makeReserveAdmin({ rpc: "error" });

    const r = await reserveAmoraTurn(admin, params);

    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("guard_unavailable");
  });

  it("RPC allowed=true면 통과", async () => {
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true, reason: null } });
    const r = await reserveAmoraTurn(admin, BASE);
    expect(r.allowed).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith("reserve_amora_turn", {
      p_couple_id: "c1",
      p_couple_cap: 50,
      p_global_cap: 300,
      p_reserve_cost_microusd: 254_400,
      p_global_cost_cap_microusd: 20_000_000,
    });
  });

  it("커플별 한도만 끄면 일반 계정도 글로벌 예약을 계속 거친다", async () => {
    process.env.AMORA_COUPLE_QUOTA_ENABLED = "false";
    vi.resetModules();
    const mod = await import("../costGuard");
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true, reason: null } });

    const r = await mod.reserveAmoraTurn(admin, BASE);

    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeUndefined();
    expect(rpcSpy).toHaveBeenCalledWith("reserve_amora_turn", {
      p_couple_id: "c1",
      p_couple_cap: 2_147_483_647,
      p_global_cap: 300,
      p_reserve_cost_microusd: 254_400,
      p_global_cost_cap_microusd: 20_000_000,
    });
  });

  it("릴리스 평가는 별도 원장으로 글로벌 예약을 유지하고 커플 한도만 적용하지 않는다", async () => {
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true, reason: null } });

    const r = await reserveAmoraTurn(admin, { ...BASE, quotaScope: "release_eval" });

    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeUndefined();
    expect(rpcSpy).toHaveBeenCalledWith("reserve_amora_turn", {
      p_couple_id: "c1",
      p_couple_cap: 2_147_483_647,
      p_global_cap: 300,
      p_reserve_cost_microusd: 254_400,
      p_global_cost_cap_microusd: 20_000_000,
    });
  });

  it.each(["error", "throw"] as const)(
    "릴리스 평가는 원자 예약 RPC %s 시 읽기전용 폴백 없이 fail-closed 한다",
    async (rpc) => {
      const { admin } = makeReserveAdmin({
        rpc,
        counts: { global: 10, couple: 0 },
      });

      const r = await reserveAmoraTurn(admin, {
        ...BASE,
        quotaScope: "release_eval",
      });

      expect(r.allowed).toBe(false);
      expect(r.reason).toBe("guard_unavailable");
    },
  );

  it("전역 상한 도달 시 차단 + 사용자 메시지", async () => {
    const { admin } = makeReserveAdmin({ rpc: { allowed: false, reason: "global_daily" } });
    const r = await reserveAmoraTurn(admin, BASE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("global_daily");
    expect(r.message).toBeTruthy();
  });

  it("전역 USD 예약 예산 도달 시 별도 사유로 차단한다", async () => {
    const { admin } = makeReserveAdmin({
      rpc: { allowed: false, reason: "global_daily_budget" },
    });

    const r = await reserveAmoraTurn(admin, BASE);

    // 구분은 `reason` 이 진다. 예전에는 여기서 문구까지 고정했는데, 그 문구가
    // "안전 예산" 이라는 **내부 용어**여서 테스트가 그 유출을 지키고 있었다.
    expect(r).toMatchObject({ allowed: false, reason: "global_budget" });
    // 사용자에게 필요한 것은 원인이 아니라 **언제 다시 되는가** 다.
    expect(r.message).toContain("내일");
    expect(r.message).not.toContain("예산");
    expect(r.message).not.toContain("잠시 후");
  });

  it("유효하지 않은 최악 비용은 RPC 전에 fail-closed 한다", async () => {
    const { admin, rpcSpy } = makeReserveAdmin({
      rpc: { allowed: true, reason: null },
    });

    const r = await reserveAmoraTurn(admin, { ...BASE, maxCostMicrousd: 0 });

    expect(r).toMatchObject({ allowed: false, reason: "guard_unavailable" });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("커플 상한 도달 시 차단", async () => {
    const { admin } = makeReserveAdmin({ rpc: { allowed: false, reason: "couple_quota" } });
    const r = await reserveAmoraTurn(admin, BASE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("couple_quota");
  });

  it.each(["error", "throw"] as const)(
    "일반 상담도 원자 예약 RPC %s 시 읽기전용 폴백 없이 fail-closed 한다",
    async (rpc) => {
      const { admin } = makeReserveAdmin({
        rpc,
        // 읽기전용 수치가 여유로워도 원자성이 없으면 provider를 허용하면 안 된다.
        counts: { global: 5, couple: 5 },
      });

      const r = await reserveAmoraTurn(admin, BASE);

      expect(r.allowed).toBe(false);
      expect(r.reason).toBe("guard_unavailable");
    },
  );

  it("알 수 없는 reason은 미계측 호출을 막기 위해 fail-closed", async () => {
    const { admin } = makeReserveAdmin({ rpc: { allowed: false, reason: "invalid_args" } });
    const r = await reserveAmoraTurn(admin, BASE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("guard_unavailable");
  });

  it("가드 비활성 시 통과 + RPC 미호출", async () => {
    process.env.AMORA_COST_GUARD_ENABLED = "false";
    vi.resetModules();
    const mod = await import("../costGuard");
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: false, reason: "couple_quota" } });
    const r = await mod.reserveAmoraTurn(admin, BASE);
    expect(r.allowed).toBe(true);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("백그라운드 케어 호출은 실제 커플 무료 상담 카운터를 소모하지 않는다", async () => {
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true, reason: null } });

    const r = await reserveAmoraTurn(admin, { ...BASE, quotaScope: "background" });

    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeUndefined();
    expect(rpcSpy).toHaveBeenCalledWith("reserve_amora_turn", {
      p_couple_id: "00000000-0000-4000-8000-000000000002",
      p_couple_cap: 2_147_483_647,
      p_global_cap: 300,
      p_reserve_cost_microusd: 254_400,
      p_global_cost_cap_microusd: 20_000_000,
    });
  });

  it.each([
    ["NaN"],
    ["1.5"],
    ["0"],
    ["-1"],
    ["2147483648"],
  ])("잘못된 비용 상한 %s는 int4 안전 기본값으로 대체한다", async (invalidCap) => {
    process.env.AMORA_FREE_MESSAGES_PER_COUPLE = invalidCap;
    process.env.AMORA_GLOBAL_DAILY_MESSAGE_CAP = invalidCap;
    vi.resetModules();
    const mod = await import("../costGuard");
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true, reason: null } });

    const r = await mod.reserveAmoraTurn(admin, BASE);

    expect(r.allowed).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith("reserve_amora_turn", {
      p_couple_id: "c1",
      p_couple_cap: 50,
      p_global_cap: 300,
      p_reserve_cost_microusd: 254_400,
      p_global_cost_cap_microusd: 20_000_000,
    });
  });

  it("배포에서 지정한 USD 일일 상한을 정확한 micro-USD 정수로 전달한다", async () => {
    process.env.AMORA_GLOBAL_DAILY_COST_CAP_USD = "12.5";
    vi.resetModules();
    const mod = await import("../costGuard");
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true, reason: null } });

    await mod.reserveAmoraTurn(admin, BASE);

    expect(rpcSpy).toHaveBeenCalledWith(
      "reserve_amora_turn",
      expect.objectContaining({ p_global_cost_cap_microusd: 12_500_000 }),
    );
  });

  it.each(["NaN", "0", "-1", "100000000000000000000"])(
    "잘못된 USD 일일 상한 %s는 $20 안전 기본값으로 되돌린다",
    async (invalidCap) => {
      process.env.AMORA_GLOBAL_DAILY_COST_CAP_USD = invalidCap;
      vi.resetModules();
      const mod = await import("../costGuard");
      const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true, reason: null } });

      await mod.reserveAmoraTurn(admin, BASE);

      expect(rpcSpy).toHaveBeenCalledWith(
        "reserve_amora_turn",
        expect.objectContaining({ p_global_cost_cap_microusd: 20_000_000 }),
      );
    },
  );
});

describe("reserveAmoraProviderCall", () => {
  const ENV = process.env;
  beforeEach(() => {
    process.env = { ...ENV };
    delete process.env.AMORA_COST_GUARD_ENABLED;
    delete process.env.AMORA_COUPLE_QUOTA_ENABLED;
    delete process.env.AMORA_GLOBAL_DAILY_COST_CAP_USD;
  });
  afterEach(() => {
    process.env = ENV;
  });

  it("reserves exactly one provider-call receipt under the logical request", async () => {
    const { admin, rpcSpy } = makeReserveAdmin({
      rpc: { allowed: true, reason: null },
    });

    const result = await reserveAmoraProviderCall(admin, {
      ...BASE,
      receiptId: "30000000-0000-4000-8000-000000000001",
      claimToken: "40000000-0000-4000-8000-000000000001",
      requestKey: "request_123",
      maxCostMicrousd: 212_000,
    });

    expect(result.allowed).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith("reserve_amora_provider_call", {
      p_receipt_id: "30000000-0000-4000-8000-000000000001",
      p_claim_token: "40000000-0000-4000-8000-000000000001",
      p_request_key: "request_123",
      p_cost_couple_id: "c1",
      p_couple_cap: 50,
      p_global_cap: 300,
      p_reserve_cost_microusd: 212_000,
      p_global_cost_cap_microusd: 20_000_000,
    });
  });

  it("returns the smaller of lifetime remaining and today's daily remaining for quota warning banners", async () => {
    const { admin } = makeReserveAdmin({
      rpc: { allowed: true, reason: null, remaining: 44 } as never,
      // global in makeAdmin mocks the .gte(created_at) query used by countCoupleTurnsToday (6 turns already used today -> 10 - (6 + 1) = 3 remaining today)
      counts: { global: 6 },
    });

    const result = await reserveAmoraProviderCall(admin, {
      ...BASE,
      receiptId: "30000000-0000-4000-8000-000000000001",
      claimToken: "40000000-0000-4000-8000-000000000001",
      requestKey: "request_123",
      maxCostMicrousd: 212_000,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });
});

describe("서버에서 확인한 팀 테스트 한도 예외", () => {
  const TEAM = { ...BASE, isQuotaExempt: true };
  const RECEIPT = {
    receiptId: "30000000-0000-4000-8000-000000000001",
    claimToken: "40000000-0000-4000-8000-000000000001",
    requestKey: "team_request_123",
  };

  beforeEach(() => {
    vi.stubEnv("AMORA_COST_GUARD_ENABLED", "true");
    vi.stubEnv("AMORA_COUPLE_QUOTA_ENABLED", "true");
    vi.stubEnv("AMORA_COUPLE_DAILY_CAP_ENABLED", "true");
    vi.stubEnv("AMORA_FREE_MESSAGES_PER_COUPLE", "100");
    vi.stubEnv("AMORA_COUPLE_DAILY_CAP", "80");
    vi.stubEnv("AMORA_GLOBAL_DAILY_MESSAGE_CAP", "300");
    vi.stubEnv("AMORA_GLOBAL_DAILY_COST_CAP_USD", "20");
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("전역과 커플 한도가 소진되어도 팀의 사전 확인은 통과한다", async () => {
    const guard = await import("../costGuard");

    const result = await guard.checkAmoraCostGuard(
      makeAdmin({ global: 9_999, couple: 9_999 }),
      TEAM,
    );

    expect(result).toEqual({ allowed: true });
  });

  it.each(["true", "false"])("팀은 전체 가드 %s일 때도 턴 예약을 유지한다", async (guardEnabled) => {
    vi.stubEnv("AMORA_COST_GUARD_ENABLED", guardEnabled);
    const guard = await import("../costGuard");
    const { admin, rpcSpy } = makeReserveAdmin({
      rpc: { allowed: true },
      counts: { global: 9_999, couple: 9_999 },
    });

    const result = await guard.reserveAmoraTurn(admin, TEAM);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeUndefined();
    expect(rpcSpy).toHaveBeenCalledExactlyOnceWith("reserve_amora_turn", {
      p_couple_id: "c1",
      p_couple_cap: 2_147_483_647,
      p_global_cap: 2_147_483_647,
      p_reserve_cost_microusd: TEAM.maxCostMicrousd,
      p_global_cost_cap_microusd: Number.MAX_SAFE_INTEGER,
    });
  });

  it.each(["true", "false"])("실제 채팅은 전체 가드 %s일 때도 팀 receipt를 예약한다", async (guardEnabled) => {
    vi.stubEnv("AMORA_COST_GUARD_ENABLED", guardEnabled);
    const guard = await import("../costGuard");
    const { admin, rpcSpy } = makeReserveAdmin({
      rpc: { allowed: true },
      counts: { global: 9_999, couple: 9_999 },
    });

    const result = await guard.reserveAmoraProviderCall(admin, { ...TEAM, ...RECEIPT });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeUndefined();
    expect(rpcSpy).toHaveBeenCalledExactlyOnceWith("reserve_amora_provider_call", {
      p_receipt_id: RECEIPT.receiptId,
      p_claim_token: RECEIPT.claimToken,
      p_request_key: RECEIPT.requestKey,
      p_cost_couple_id: "c1",
      p_couple_cap: 2_147_483_647,
      p_global_cap: 2_147_483_647,
      p_reserve_cost_microusd: TEAM.maxCostMicrousd,
      p_global_cost_cap_microusd: Number.MAX_SAFE_INTEGER,
    });
  });

  it("예외가 false인 일반 사용자는 커플 일일 제한을 유지한다", async () => {
    const guard = await import("../costGuard");
    const { admin, rpcSpy } = makeReserveAdmin({
      rpc: { allowed: true },
      counts: { global: 80 },
    });

    const result = await guard.reserveAmoraProviderCall(admin, {
      ...TEAM,
      ...RECEIPT,
      isQuotaExempt: false,
    });

    expect(result).toMatchObject({ allowed: false, reason: "couple_daily" });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it.each([0, -1, 0.5, Number.NaN])(
    "팀도 유효하지 않은 턴 비용 %s로 예약할 수 없다",
    async (maxCostMicrousd) => {
      const guard = await import("../costGuard");
      const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true } });

      const result = await guard.reserveAmoraTurn(admin, { ...TEAM, maxCostMicrousd });

      expect(result).toMatchObject({ allowed: false, reason: "guard_unavailable" });
      expect(rpcSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    { receiptId: "invalid-receipt" },
    { claimToken: "invalid-claim" },
    { requestKey: "" },
    { maxCostMicrousd: 0 },
  ])("팀도 유효하지 않은 provider 예약 인자는 차단한다: %j", async (invalid) => {
    const guard = await import("../costGuard");
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true } });

    const result = await guard.reserveAmoraProviderCall(admin, {
      ...TEAM,
      ...RECEIPT,
      ...invalid,
    });

    expect(result).toMatchObject({ allowed: false, reason: "guard_unavailable" });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it.each(["error", "throw"] as const)(
    "팀도 두 예약 RPC의 %s에서는 미계측 호출을 차단한다",
    async (rpc) => {
      const guard = await import("../costGuard");
      const turn = makeReserveAdmin({ rpc });
      const provider = makeReserveAdmin({ rpc });

      const turnResult = await guard.reserveAmoraTurn(turn.admin, TEAM);
      const providerResult = await guard.reserveAmoraProviderCall(provider.admin, {
        ...TEAM,
        ...RECEIPT,
      });

      expect(turnResult).toMatchObject({ allowed: false, reason: "guard_unavailable" });
      expect(providerResult).toMatchObject({ allowed: false, reason: "guard_unavailable" });
      expect(turn.rpcSpy).toHaveBeenCalledOnce();
      expect(provider.rpcSpy).toHaveBeenCalledOnce();
    },
  );

  it.each(["invalid_receipt", "stale_claim", "receipt_not_prepared", "invalid_call_sequence"])(
    "팀도 DB가 거부한 receipt 상태 %s를 우회할 수 없다",
    async (reason) => {
      const guard = await import("../costGuard");
      const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: false, reason } });

      const result = await guard.reserveAmoraProviderCall(admin, { ...TEAM, ...RECEIPT });

      expect(result).toMatchObject({ allowed: false, reason: "guard_unavailable" });
      expect(rpcSpy).toHaveBeenCalledOnce();
    },
  );
});

describe("기존 계정 면제(Grandfathering) 및 신규 계정 파트너 연결 보너스(+30회 / 일일 +5회)", () => {
  const RECEIPT = {
    receiptId: "30000000-0000-4000-8000-000000000001",
    claimToken: "40000000-0000-4000-8000-000000000001",
    requestKey: "policy_request_123",
  };

  // 환경변수를 바꾸는 검사가 중간에 실패해도 다음 검사로 값이 새지 않게 한다.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makePolicyAdmin(opts: {
    coupleRow: {
      created_at: string;
      bride_id?: string | null;
      groom_id?: string | null;
      membership_sealed_at?: string | null;
    } | null;
    usedToday?: number;
    coupleTotal?: number;
    globalToday?: number;
    rpcResult?: { allowed: boolean; reason?: string | null; remaining?: number };
  }) {
    const rpcSpy = vi.fn(async () => ({
      data: [opts.rpcResult ?? { allowed: true, reason: null }],
      error: null,
    }));

    return {
      rpcSpy,
      admin: {
        rpc: rpcSpy,
        from(table: string) {
          if (table === "couples") {
            const chain: Record<string, unknown> = {};
            chain.select = () => chain;
            chain.eq = () => chain;
            chain.maybeSingle = async () => ({ data: opts.coupleRow, error: null });
            return chain;
          }
          let hasCoupleFilter = false;
          let hasGteFilter = false;
          const builder: Record<string, unknown> = {};
          builder.select = () => builder;
          builder.eq = (col: string) => {
            if (col === "couple_id") hasCoupleFilter = true;
            return builder;
          };
          builder.gte = () => {
            hasGteFilter = true;
            return builder;
          };
          builder.maybeSingle = async () => ({ data: null, error: null });
          builder.then = (resolve: (v: { count: number; error: null }) => void) => {
            if (hasCoupleFilter && hasGteFilter) {
              return resolve({ count: opts.usedToday ?? 0, error: null });
            }
            if (hasCoupleFilter) {
              return resolve({ count: opts.coupleTotal ?? 0, error: null });
            }
            return resolve({ count: opts.globalToday ?? 0, error: null });
          };
          return builder;
        },
      } as never,
    };
  }

  it("기준 시각 이전에 이미 만들어진 기존 계정(2026-10-19)에는 신규 계정용 한도(일일 10회 / 누적 50회)를 적용하지 않는다", async () => {
    const { admin, rpcSpy } = makePolicyAdmin({
      coupleRow: {
        created_at: "2026-10-19T12:00:00.000Z",
        bride_id: "u1",
        groom_id: null,
      },
      usedToday: 45, // 신규 일일 한도(10)를 넘어도 기존 계정은 통과
      coupleTotal: 120, // 신규 누적 한도(50)를 넘어도 기존 계정은 통과
    });

    const precheck = await checkAmoraCostGuard(admin, BASE);
    expect(precheck.allowed).toBe(true);

    const providerRes = await reserveAmoraProviderCall(admin, {
      ...BASE,
      ...RECEIPT,
    });
    expect(providerRes.allowed).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith(
      "reserve_amora_provider_call",
      expect.objectContaining({
        p_couple_cap: 2_147_483_647,
        p_global_cap: 300,
      }),
    );
  });

  it("기준 시각 이후 새로 가입한 단독 계정(파트너 미연결)은 기본 한도(일일 10회 / 누적 50회)가 적용된다", async () => {
    const { admin, rpcSpy } = makePolicyAdmin({
      coupleRow: {
        created_at: "2026-10-21T01:00:00.000Z",
        bride_id: "u1",
        groom_id: null,
        membership_sealed_at: null,
      },
      usedToday: 10,
    });

    const dailyDenied = await reserveAmoraProviderCall(admin, {
      ...BASE,
      ...RECEIPT,
    });
    expect(dailyDenied.allowed).toBe(false);
    expect(dailyDenied.reason).toBe("couple_daily");
    expect(dailyDenied.message).toContain("+30회");
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("기준 시각 이후 새로 가입한 계정이 파트너를 연결하면 보너스 한도(일일 15회 / 누적 80회)가 자동 적용된다", async () => {
    const { admin, rpcSpy } = makePolicyAdmin({
      coupleRow: {
        created_at: "2026-10-21T01:00:00.000Z",
        bride_id: "u1",
        groom_id: "u2",
        membership_sealed_at: "2026-10-21T02:00:00.000Z",
      },
      usedToday: 12, // 기본 10회는 넘었지만 파트너 연결 보너스(15회) 아래이므로 통과!
      coupleTotal: 65, // 기본 50회는 넘었지만 파트너 연결 보너스(80회) 아래이므로 통과!
    });

    const precheck = await checkAmoraCostGuard(admin, BASE);
    expect(precheck.allowed).toBe(true);

    const providerRes = await reserveAmoraProviderCall(admin, {
      ...BASE,
      ...RECEIPT,
    });
    expect(providerRes.allowed).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith(
      "reserve_amora_provider_call",
      expect.objectContaining({
        p_couple_cap: 80,
      }),
    );
  });

  // 2026-10-20 면제는 기존 커플에게서 누적 한도와 함께 **하루 상한까지** 걷어 냈다.
  // 전역 하루 상한만 남으면 한 커플이 그날 전 서비스를 멈출 수 있다. 그래서 면제 전에
  // 모든 커플에게 걸려 있던 하루 80회를 천장으로 둔다. 누적 한도는 계속 면제다.
  const GRANDFATHERED_ROW = {
    created_at: "2026-10-19T12:00:00.000Z",
    bride_id: "u1",
    groom_id: "u2",
  };
  // 횟수는 그 커플의 모든 대화를 두 사람 합쳐서 센다. 그래서 "이 대화에서"라고 하지 않는다.
  const GRANDFATHERED_DAILY_MESSAGE =
    "오늘 쓸 수 있는 상담 횟수를 다 썼어요. 내일 다시 이어서 도와드릴게요.";

  it("기준 시각 이전 계정도 하루 천장(80회)에 닿으면 막고 provider 예약을 시도하지 않는다", async () => {
    const { admin, rpcSpy } = makePolicyAdmin({
      coupleRow: GRANDFATHERED_ROW,
      usedToday: 80,
      coupleTotal: 710, // 누적은 신규 한도(50)를 한참 넘는다
    });

    const result = await reserveAmoraProviderCall(admin, { ...BASE, ...RECEIPT });

    expect(result).toMatchObject({ allowed: false, reason: "couple_daily" });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("기준 시각 이전 계정은 천장 바로 아래(79회)에서 통과하고 누적 한도는 계속 면제된다", async () => {
    const { admin, rpcSpy } = makePolicyAdmin({
      coupleRow: GRANDFATHERED_ROW,
      usedToday: 79,
      coupleTotal: 710,
    });

    const result = await reserveAmoraProviderCall(admin, { ...BASE, ...RECEIPT });

    expect(result.allowed).toBe(true);
    // 누적 한도가 없으니 "무료 상담이 N회 남았어요" 배너에 쓸 잔여 횟수도 없다.
    expect(result.remaining).toBeUndefined();
    expect(rpcSpy).toHaveBeenCalledWith(
      "reserve_amora_provider_call",
      expect.objectContaining({
        p_couple_cap: 2_147_483_647,
        p_global_cap: 300,
      }),
    );
  });

  it("기존 계정이 천장에 닿았을 때 신규 계정 문구(하루 10회·파트너 보너스)를 보내지 않는다", async () => {
    const { admin } = makePolicyAdmin({
      coupleRow: GRANDFATHERED_ROW,
      usedToday: 120,
    });

    const result = await reserveAmoraProviderCall(admin, { ...BASE, ...RECEIPT });

    // 사유 코드는 같아도 "하루 10회"와 파트너 연결 보너스는 이 커플에게 사실이 아니다.
    expect(result.message).toBe(GRANDFATHERED_DAILY_MESSAGE);
    for (const wrong of ["10회", "15회", "+30회", "파트너", "무료", "이 대화"]) {
      expect(result.message).not.toContain(wrong);
    }
  });

  it("운영 설정(AMORA_COUPLE_QUOTA_ENABLED=false)에서도 기존 계정 하루 천장이 걸린다", async () => {
    // 운영 환경 검사(scripts/check-amora-production-env.mjs)가 요구하는 두 값이다.
    vi.stubEnv("AMORA_COUPLE_QUOTA_ENABLED", "false");
    vi.stubEnv("AMORA_COST_GUARD_ENABLED", "true");
    vi.resetModules();
    const guard = await import("../costGuard");
    const { admin, rpcSpy } = makePolicyAdmin({
      coupleRow: GRANDFATHERED_ROW,
      usedToday: 80,
    });

    const result = await guard.reserveAmoraProviderCall(admin, { ...BASE, ...RECEIPT });

    expect(result).toMatchObject({ allowed: false, reason: "couple_daily" });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("PostgREST 가 주는 시각 형식의 기존 계정도 기존 계정으로 판정한다", async () => {
    // PostgREST 는 timestamptz 를 마이크로초와 `+00:00` 꼴로 돌려준다.
    const coupleRow = {
      created_at: "2026-08-25T04:12:13.442123+00:00",
      bride_id: "u1",
      groom_id: "u2",
      membership_sealed_at: "2026-08-26T01:00:00+00:00",
    };
    const below = makePolicyAdmin({ coupleRow, usedToday: 45 });
    const atCeiling = makePolicyAdmin({ coupleRow, usedToday: 80 });

    // 신규 계정으로 읽혔다면 45회에서 이미 막혔다(파트너 연결 커플도 하루 15회).
    const allowed = await reserveAmoraProviderCall(below.admin, { ...BASE, ...RECEIPT });
    const denied = await reserveAmoraProviderCall(atCeiling.admin, { ...BASE, ...RECEIPT });

    expect(allowed.allowed).toBe(true);
    expect(denied).toMatchObject({
      allowed: false,
      reason: "couple_daily",
      message: GRANDFATHERED_DAILY_MESSAGE,
    });
  });

  it("기존 계정 하루 천장은 reserveAmoraTurn 경로에도 걸린다", async () => {
    const { admin, rpcSpy } = makePolicyAdmin({
      coupleRow: GRANDFATHERED_ROW,
      usedToday: 80,
    });

    const result = await reserveAmoraTurn(admin, BASE);

    expect(result).toMatchObject({ allowed: false, reason: "couple_daily" });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("관리자·팀 테스트 계정·백그라운드 호출은 기존 계정 하루 천장을 적용받지 않는다", async () => {
    const overCeiling = () => makePolicyAdmin({
      coupleRow: GRANDFATHERED_ROW,
      usedToday: 500,
    }).admin;

    const asAdmin = await reserveAmoraProviderCall(overCeiling(), {
      ...BASE,
      ...RECEIPT,
      isAdmin: true,
    });
    const asTeam = await reserveAmoraProviderCall(overCeiling(), {
      ...BASE,
      ...RECEIPT,
      isQuotaExempt: true,
    });
    const asBackground = await reserveAmoraProviderCall(overCeiling(), {
      ...BASE,
      ...RECEIPT,
      quotaScope: "background",
    });

    expect(asAdmin.allowed).toBe(true);
    expect(asTeam.allowed).toBe(true);
    expect(asBackground.allowed).toBe(true);
  });

  it("AMORA_GRANDFATHERED_COUPLE_DAILY_CAP 으로 천장을 바꿀 수 있다", async () => {
    vi.stubEnv("AMORA_GRANDFATHERED_COUPLE_DAILY_CAP", "120");
    vi.resetModules();
    const guard = await import("../costGuard");
    const below = makePolicyAdmin({ coupleRow: GRANDFATHERED_ROW, usedToday: 119 });
    const atCeiling = makePolicyAdmin({ coupleRow: GRANDFATHERED_ROW, usedToday: 120 });

    const allowed = await guard.reserveAmoraProviderCall(below.admin, { ...BASE, ...RECEIPT });
    const denied = await guard.reserveAmoraProviderCall(atCeiling.admin, { ...BASE, ...RECEIPT });

    // 기본 천장(80)이었다면 119회는 막혔다.
    expect(allowed.allowed).toBe(true);
    expect(denied).toMatchObject({ allowed: false, reason: "couple_daily" });
    expect(atCeiling.rpcSpy).not.toHaveBeenCalled();
  });

  it("AMORA_COUPLE_DAILY_CAP 이 천장보다 크면 기존 계정 천장이 그 값을 따라간다", async () => {
    // 순수 함수가 맞아도 모듈이 운영 값을 넘기지 않으면 아무 일도 안 일어난다.
    vi.stubEnv("AMORA_COUPLE_DAILY_CAP", "150");
    vi.resetModules();
    const guard = await import("../costGuard");
    const below = makePolicyAdmin({ coupleRow: GRANDFATHERED_ROW, usedToday: 154 });
    const atCeiling = makePolicyAdmin({ coupleRow: GRANDFATHERED_ROW, usedToday: 155 });

    const allowed = await guard.reserveAmoraProviderCall(below.admin, { ...BASE, ...RECEIPT });
    const denied = await guard.reserveAmoraProviderCall(atCeiling.admin, { ...BASE, ...RECEIPT });

    // 천장이 기본값(80)에 묶여 있었다면 154회는 막혔다.
    expect(allowed.allowed).toBe(true);
    expect(denied).toMatchObject({ allowed: false, reason: "couple_daily" });
  });

  it("하루 상한 스위치를 끄면 기존 계정 천장도 꺼진다", async () => {
    vi.stubEnv("AMORA_COUPLE_DAILY_CAP_ENABLED", "false");
    vi.resetModules();
    const guard = await import("../costGuard");
    const { admin } = makePolicyAdmin({
      coupleRow: GRANDFATHERED_ROW,
      usedToday: 500,
    });

    const result = await guard.reserveAmoraProviderCall(admin, { ...BASE, ...RECEIPT });

    expect(result.allowed).toBe(true);
  });

  it("기존 계정 천장은 신규 계정이 받을 수 있는 하루 한도보다 낮아지지 않는다", () => {
    // 운영의 AMORA_COUPLE_DAILY_CAP 은 되읽을 수 없다. 그 값이 천장보다 크면
    // 기존 커플이 신규 커플보다 먼저 막히므로, 천장이 그 값(+파트너 연결 5회)을 따라간다.
    expect(resolveGrandfatheredCoupleDailyCap({
      configuredCap: 80,
      newCoupleDailyCap: 10,
      partnerLinkBonusDaily: 5,
    })).toBe(80);
    expect(resolveGrandfatheredCoupleDailyCap({
      configuredCap: 80,
      newCoupleDailyCap: 150,
      partnerLinkBonusDaily: 5,
    })).toBe(155);
    // 더한 값도 int4 상한에서 멈춘다(신규 커플의 하루 한도 계산과 같은 방식).
    expect(resolveGrandfatheredCoupleDailyCap({
      configuredCap: 2_147_483_647,
      newCoupleDailyCap: 2_147_483_647,
      partnerLinkBonusDaily: 5,
    })).toBe(2_147_483_647);
  });
});
