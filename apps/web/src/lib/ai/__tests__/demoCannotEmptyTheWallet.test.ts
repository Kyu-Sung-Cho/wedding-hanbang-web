import { describe, expect, it, vi } from "vitest";

import { resolveGlobalCaps, reserveAmoraProviderCall } from "@/lib/ai/costGuard";

/**
 * 체험(비로그인)이 가입한 사람의 하루치를 다 쓰지 못하게 한다.
 *
 * ## 무엇이 문제였나
 *
 * 체험은 실사용자와 **같은 전역 하루 지갑**을 썼다. 게다가 커플당 하루 상한은 체험에
 * 걸리지 않는다(`denyIfCoupleUsedTodayUp` 이 `standard` 가 아니면 즉시 null).
 * 막는 것은 IP당 시간당 60회뿐이다.
 *
 * 그래서 출시 공지 후 구경하는 사람이 몰리면 **가입한 사람이 첫 메시지부터** "오늘
 * 아모라 상담이 많아 잠시 쉬어가고 있어요" 를 본다. 카운터 키가 `global:<KST날짜>` 라
 * 자정까지 풀리지 않는다.
 *
 * ## 왜 이 모양인가
 *
 * 전역 카운터 키는 RPC 안에 박혀 있어 지갑을 물리적으로 쪼개려면 마이그레이션이
 * 필요하다. 대신 **같은 카운터에 체험만 낮은 천장**을 넘긴다 — RPC 가
 * `IF v_global_count >= p_global_cap` 으로 비교하므로
 * (`20260716097000_amora_atomic_cost_budget.sql:164`) 체험이 먼저 멈추고, 두 천장의
 * 차이가 실사용자에게 보장되는 몫이 된다.
 *
 * ## 처음 쓴 방법은 두 번 틀렸다
 *
 * **첫째**, 커플당 하루 상한처럼 `ai_interactions_log` 를 세려고 했다. 그런데 체험은
 * 그 표에 `couple_id` 를 남기지 않는다 — 2026-08-26 운영 실측으로 체험 합성 ID 의
 * `chat_turn` 은 0건인데 `amora_turn_counters` 는 89턴이었다. 그대로 갔으면 배선은
 * 됐는데 상한이 한 번도 안 걸리는 상태로 배포했을 것이다.
 *
 * **둘째**, 환경변수 조합별로 재려고 `vi.resetModules()` + 동적 import 를 썼다.
 * 단독 실행과 `src/lib/ai/__tests__` 전체(163파일)에서는 통과했는데, **783개 파일을
 * 한 번에 도는 전체 스위트에서만** 이렇게 죽었다:
 *
 *     FAIL demoCannotEmptyTheWallet.test.ts
 *     Error: Cannot find module '/@id/.../demoCannotEmptyTheWallet.test.ts'
 *
 * 모듈 리셋이 테스트 파일 자신을 레지스트리에서 지운 것이다. 그래서 상한 계산을
 * 순수 함수(`resolveGlobalCaps`)로 빼서 **모듈을 다시 읽지 않고** 조합을 재고,
 * 배선은 RPC 인자로 따로 확인한다.
 */

describe("체험은 실사용자보다 낮은 천장을 본다", () => {
  const CAPS = {
    globalTurns: 450,
    globalCostMicrousd: 12_000_000,
    demoTurns: 150,
    demoCostMicrousd: 4_000_000,
  };

  it("가입한 사람은 전체 상한을 그대로 받는다", () => {
    expect(resolveGlobalCaps({ quotaScope: "standard", ...CAPS })).toEqual({
      turns: 450,
      costMicrousd: 12_000_000,
    });
  });

  it("체험은 낮은 상한을 받는다", () => {
    expect(resolveGlobalCaps({ quotaScope: "demo", ...CAPS })).toEqual({
      turns: 150,
      costMicrousd: 4_000_000,
    });
  });

  it("체험이 다 써도 가입한 사람에게 300턴이 남는다", () => {
    const demo = resolveGlobalCaps({ quotaScope: "demo", ...CAPS });
    const real = resolveGlobalCaps({ quotaScope: "standard", ...CAPS });
    // RPC 가 `v_global_count >= p_global_cap` 로 비교하므로, 두 천장의 차이가
    // 그대로 실사용자에게 보장되는 몫이다.
    expect(real.turns - demo.turns).toBe(300);
  });

  it.each(["background", "release_eval", undefined])(
    "%s 은 건드리지 않는다",
    (scope) => {
      expect(resolveGlobalCaps({ quotaScope: scope, ...CAPS }).turns).toBe(450);
    },
  );
});

describe("설정을 잘못해도 분리가 조용히 사라지지 않는다", () => {
  it("체험 몫을 전역보다 크게 잡아도 전역을 넘지 않는다", () => {
    expect(
      resolveGlobalCaps({
        quotaScope: "demo",
        globalTurns: 450,
        globalCostMicrousd: 12_000_000,
        demoTurns: 9_999,
        demoCostMicrousd: 999_000_000,
      }),
    ).toEqual({ turns: 450, costMicrousd: 12_000_000 });
  });
});

describe("실제 예약 경로에 배선돼 있다", () => {
  // 순수 함수가 맞아도 **채팅이 타는 경로**가 그것을 안 쓰면 아무 일도 안 일어난다.
  // 오늘 그 실수를 이미 했다. RPC 에 넘어가는 인자를 직접 본다.
  function makeAdmin(calls: Record<string, unknown>[]) {
    return {
      rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
        calls.push(args);
        return { data: [{ allowed: true, reason: null }], error: null };
      }),
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ gte: vi.fn(async () => ({ count: 0, error: null })) })),
          })),
        })),
      })),
    } as never;
  }

  const BASE = {
    coupleId: "00000000-0000-4000-8000-000000000000",
    isAdmin: false,
    receiptId: "11111111-1111-4111-8111-111111111111",
    claimToken: "22222222-2222-4222-8222-222222222222",
    requestKey: "probe-request-key",
    maxCostMicrousd: 88_400,
  };

  it("체험 요청은 실사용자보다 낮은 p_global_cap 으로 예약한다", async () => {
    const demoCalls: Record<string, unknown>[] = [];
    const realCalls: Record<string, unknown>[] = [];
    await reserveAmoraProviderCall(makeAdmin(demoCalls), { ...BASE, quotaScope: "demo" } as never);
    await reserveAmoraProviderCall(makeAdmin(realCalls), { ...BASE, quotaScope: "standard" } as never);

    expect(demoCalls[0], "체험 예약이 RPC 에 안 갔다").toBeTruthy();
    expect(realCalls[0], "일반 예약이 RPC 에 안 갔다").toBeTruthy();
    expect(Number(demoCalls[0].p_global_cap))
      .toBeLessThan(Number(realCalls[0].p_global_cap));
    expect(Number(demoCalls[0].p_global_cost_cap_microusd))
      .toBeLessThan(Number(realCalls[0].p_global_cost_cap_microusd));
  });
});
