import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkAmoraCostGuard, reserveAmoraTurn } from "../costGuard";

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

const BASE = { coupleId: "c1", isAdmin: false };

describe("checkAmoraCostGuard", () => {
  const ENV = process.env;
  beforeEach(() => {
    process.env = { ...ENV };
    delete process.env.AMORA_COST_GUARD_ENABLED;
    delete process.env.AMORA_COUPLE_QUOTA_ENABLED;
    delete process.env.AMORA_FREE_MESSAGES_PER_COUPLE;
    delete process.env.AMORA_GLOBAL_DAILY_MESSAGE_CAP;
    vi.resetModules();
  });
  afterEach(() => {
    process.env = ENV;
  });

  it("관리자는 면제", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ global: 9999, couple: 9999 }), { ...BASE, isAdmin: true });
    expect(r.allowed).toBe(true);
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
  });
  afterEach(() => {
    process.env = ENV;
  });

  it("관리자는 면제 — RPC를 호출하지 않는다 (턴 미소모)", async () => {
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: false, reason: "couple_quota" } });
    const r = await reserveAmoraTurn(admin, { ...BASE, isAdmin: true });
    expect(r.allowed).toBe(true);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("RPC allowed=true면 통과", async () => {
    const { admin, rpcSpy } = makeReserveAdmin({ rpc: { allowed: true, reason: null } });
    const r = await reserveAmoraTurn(admin, BASE);
    expect(r.allowed).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith("reserve_amora_turn", {
      p_couple_id: "c1",
      p_couple_cap: 100,
      p_global_cap: 300,
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

  it("커플 상한 도달 시 차단", async () => {
    const { admin } = makeReserveAdmin({ rpc: { allowed: false, reason: "couple_quota" } });
    const r = await reserveAmoraTurn(admin, BASE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("couple_quota");
  });

  it("RPC 에러(미배포) 시 읽기전용 가드로 폴백 — 상한 초과면 차단", async () => {
    const { admin } = makeReserveAdmin({ rpc: "error", counts: { global: 10, couple: 100 } });
    const r = await reserveAmoraTurn(admin, BASE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("couple_quota");
  });

  it("RPC 에러(미배포) 시 읽기전용 가드로 폴백 — 정상 범위면 통과", async () => {
    const { admin } = makeReserveAdmin({ rpc: "error", counts: { global: 10, couple: 5 } });
    const r = await reserveAmoraTurn(admin, BASE);
    expect(r.allowed).toBe(true);
  });

  it("RPC 예외 시에도 폴백", async () => {
    const { admin } = makeReserveAdmin({ rpc: "throw", counts: { global: 10, couple: 5 } });
    const r = await reserveAmoraTurn(admin, BASE);
    expect(r.allowed).toBe(true);
  });

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
});
