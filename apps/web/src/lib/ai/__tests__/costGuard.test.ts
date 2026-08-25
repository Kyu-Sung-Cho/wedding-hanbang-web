import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkAmoraCostGuard,
  reserveAmoraProviderCall,
  reserveAmoraTurn,
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
    const r = await checkAmoraCostGuard(makeAdmin({ global: 10, couple: 100 }), BASE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("couple_quota");
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

  it("demo는 커플 lifetime cap을 우회하지만 global 사용량을 원자 예약한다", async () => {
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true, reason: null } });

    const r = await reserveAmoraTurn(admin, { ...BASE, quotaScope: "demo" });

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
      p_couple_cap: 100,
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
        counts: { global: 10, couple: 5 },
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
      p_couple_cap: 100,
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
      p_couple_cap: 100,
      p_global_cap: 300,
      p_reserve_cost_microusd: 212_000,
      p_global_cost_cap_microusd: 20_000_000,
    });
  });
});
