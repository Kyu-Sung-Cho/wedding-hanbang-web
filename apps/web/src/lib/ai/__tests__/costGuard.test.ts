import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkAmoraCostGuard } from "../costGuard";

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

const BASE = { coupleId: "c1", isDemo: false, isAdmin: false };

describe("checkAmoraCostGuard", () => {
  const ENV = process.env;
  beforeEach(() => {
    process.env = { ...ENV };
    delete process.env.AMORA_COST_GUARD_ENABLED;
    delete process.env.AMORA_FREE_MESSAGES_PER_COUPLE;
    delete process.env.AMORA_GLOBAL_DAILY_MESSAGE_CAP;
    vi.resetModules();
  });
  afterEach(() => {
    process.env = ENV;
  });

  it("데모는 카운트 없이 통과", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ global: 9999, couple: 9999 }), { ...BASE, isDemo: true });
    expect(r.allowed).toBe(true);
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

  it("카운트 에러 시 fail-open (통과)", async () => {
    const r = await checkAmoraCostGuard(makeAdmin({ error: true }), BASE);
    expect(r.allowed).toBe(true);
  });
});
