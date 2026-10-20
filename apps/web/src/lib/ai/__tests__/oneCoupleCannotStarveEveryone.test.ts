import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 전역 상한 하나가 전 서비스 킬 스위치였다.
 *
 * 비용 가드에는 두 겹이 있었다 — **커플당 평생** 무료 한도와 **전역 하루** 상한.
 * 그 사이에 "한 커플이 하루에 얼마나" 가 없었다.
 *
 * 2026-08-25 운영 실측(읽기전용): 24시간 동안 한 커플이 **158턴**을 썼고
 * 두 번째 커플이 67턴이었다. 전역 기본 상한은 300이다. 그런 사용자 둘이면
 * 그날 **모든 사용자**가 "오늘 아모라 상담이 많아 잠시 쉬어가고 있어요" 를 본다.
 *
 * 공개 첫날에 이건 확률이 아니라 시간 문제다.
 *
 * ## 왜 원자적이지 않아도 되는가
 *
 * 이 한도의 목적은 지갑이 아니라 **공정성**이다. 경합으로 한두 턴이 더 나가도
 * 아무 일도 안 생긴다. 돈을 지키는 것은 전역 비용 상한이고 그건 여전히
 * `reserve_amora_turn` RPC 안에서 `FOR UPDATE` 로 원자적이다.
 *
 * 그래서 장부(`ai_interactions_log`)를 그 앞에서 읽는다. 마이그레이션이
 * 필요 없고, RPC 계약을 건드리지 않는다.
 */

const rpc = vi.fn();
const selectChain = { eq: vi.fn(), gte: vi.fn() };
let dailyCount: number | null = 0;
let dailyError: unknown = null;

vi.mock("@/lib/supabase/admin", () => ({
  getServiceClient: () => makeAdmin(),
}));

function makeAdmin() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => Promise.resolve({ count: dailyCount, error: dailyError }),
  };
  return {
    from: () => chain,
    rpc,
  } as never;
}

async function reserve(isAdmin = false) {
  const { reserveAmoraTurn } = await import("@/lib/ai/costGuard");
  return reserveAmoraTurn(makeAdmin(), {
    coupleId: "11111111-1111-4111-8111-111111111111",
    isAdmin,
    maxCostMicrousd: 50_000,
  });
}

beforeEach(() => {
  vi.resetModules();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [{ allowed: true }], error: null });
  selectChain.eq.mockReset();
  selectChain.gte.mockReset();
  dailyCount = 0;
  dailyError = null;
});

describe("커플당 하루 상한", () => {
  it("한도 아래면 통과하고 예약 RPC 까지 간다", async () => {
    dailyCount = 9;
    const result = await reserve();
    expect(result.allowed).toBe(true);
    expect(rpc).toHaveBeenCalled();
  });

  it("한도에 닿으면 막고 provider 예약을 아예 시도하지 않는다", async () => {
    // 막을 거면 돈 쓰는 자리에 가기 전에 막아야 한다.
    dailyCount = 10;
    const result = await reserve();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("couple_daily");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("사용자에게 내일 다시 된다고 알린다", async () => {
    dailyCount = 200;
    const result = await reserve();
    // "한도를 다 썼다" 로 끝나면 사용자는 제품이 끝났다고 읽는다.
    expect(result.message).toContain("내일");
    expect(result.message).toContain("예산·체크리스트·일정·견적 진단");
  });

  it("장부를 못 읽으면 통과시킨다", async () => {
    // 공정성 한도이지 지갑이 아니다. 조회 실패로 정상 사용자를 막는 쪽이 더 나쁘다.
    dailyCount = null;
    dailyError = { message: "boom" };
    const result = await reserve();
    expect(result.allowed).toBe(true);
  });

  it("관리자는 면제된다", async () => {
    dailyCount = 500;
    const result = await reserve(true);
    expect(result.allowed).toBe(true);
  });
});

describe("기존 계약을 깨지 않는다", () => {
  it("전역 상한 거부는 그대로 나온다", async () => {
    dailyCount = 0;
    rpc.mockResolvedValue({ data: [{ allowed: false, reason: "global_daily" }], error: null });
    const result = await reserve();
    expect(result.reason).toBe("global_daily");
  });

  it("전역 비용 상한 거부도 그대로다", async () => {
    dailyCount = 0;
    rpc.mockResolvedValue({ data: [{ allowed: false, reason: "global_daily_budget" }], error: null });
    const result = await reserve();
    expect(result.reason).toBe("global_budget");
  });

  it("커플 평생 무료 한도 거부도 그대로다", async () => {
    dailyCount = 0;
    rpc.mockResolvedValue({ data: [{ allowed: false, reason: "couple_quota" }], error: null });
    const result = await reserve();
    expect(result.reason).toBe("couple_quota");
  });
});

/**
 * **운영은 무료 한도를 꺼 둔 상태다.**
 *
 * `AMORA_COUPLE_QUOTA_ENABLED=false` 가 걸려 있다(2026-08-25 실측: 커플
 * 카운터가 710·397·193턴인데 기본 무료 한도는 100). 베타에서 무료 턴 제한을
 * 없애려고 켠 스위치다.
 *
 * 처음에 나는 하루 상한을 그 스위치에 묶었다. 그래서 배선하고 테스트하고
 * **배포까지 했는데 운영에서 아무 일도 하지 않았다** — 라이브로 158턴 쓴
 * 커플에게 요청을 보내 통과하는 것을 보고서야 알았다.
 *
 * 무료 턴을 얼마나 주느냐는 **요금** 결정이고, 한 커플이 전 서비스를 멈추지
 * 못하게 하는 것은 **가용성** 결정이다. 같은 스위치에 묶으면 안 된다.
 */
describe("무료 한도를 꺼도 하루 상한은 산다", () => {
  it("AMORA_COUPLE_QUOTA_ENABLED=false 에서도 막는다", async () => {
    vi.stubEnv("AMORA_COUPLE_QUOTA_ENABLED", "false");
    vi.resetModules();
    dailyCount = 158; // 운영에서 실제로 관측된 값
    const result = await reserve();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("couple_daily");
    vi.unstubAllEnvs();
  });

  it("자체 스위치로는 끌 수 있다", async () => {
    vi.stubEnv("AMORA_COUPLE_DAILY_CAP_ENABLED", "false");
    vi.resetModules();
    dailyCount = 500;
    const result = await reserve();
    expect(result.allowed).toBe(true);
    vi.unstubAllEnvs();
  });
});

/**
 * **채팅은 `reserveAmoraTurn` 을 부르지 않는다.**
 *
 * 아모라 채팅은 `reserveAmoraProviderCall` 을 탄다
 * (`amoraProviderCallLedger.ts` → `app/api/chat/route.ts` 의 `costGuard` 옵션).
 * `reserveAmoraTurn` 을 부르는 것은 커뮤니티 AI 댓글과 기억 컴파일뿐이다.
 *
 * 처음에 하루 상한을 `reserveAmoraTurn` 에만 넣었다. 테스트 10개가 초록이었고
 * PR 이 병합됐고 프로덕션 배포까지 성공했는데 — **주 제품에서 아무 일도 하지
 * 않았다.** 라이브로 138턴 쓴 커플에게 요청을 보내 통과하는 것을 보고 알았다.
 *
 * 오늘 같은 부류를 네 번째 겪는다(도구 목록·테스트 입력·환경변수·호출 경로).
 * 그래서 이 검사는 **채팅이 실제로 부르는 함수**를 직접 부른다.
 */
describe("채팅이 타는 경로에도 하루 상한이 걸린다", () => {
  async function reserveProviderCall(isAdmin = false) {
    const { reserveAmoraProviderCall } = await import("@/lib/ai/costGuard");
    return reserveAmoraProviderCall(makeAdmin(), {
      coupleId: "11111111-1111-4111-8111-111111111111",
      isAdmin,
      maxCostMicrousd: 50_000,
      receiptId: "22222222-2222-4222-8222-222222222222",
      claimToken: "33333333-3333-4333-8333-333333333333",
      requestKey: "chat:abc:def",
    });
  }

  it("한도에 닿으면 provider 예약 자체를 막는다", async () => {
    dailyCount = 138; // 운영에서 실제로 관측된 값
    const result = await reserveProviderCall();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("couple_daily");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("한도 아래면 통과한다", async () => {
    dailyCount = 9;
    rpc.mockResolvedValue({ data: [{ allowed: true }], error: null });
    const result = await reserveProviderCall();
    expect(result.allowed).toBe(true);
    expect(rpc).toHaveBeenCalled();
  });

  it("무료 한도를 꺼도 여기서도 산다", async () => {
    vi.stubEnv("AMORA_COUPLE_QUOTA_ENABLED", "false");
    vi.resetModules();
    dailyCount = 138;
    const result = await reserveProviderCall();
    expect(result.allowed).toBe(false);
    vi.unstubAllEnvs();
  });
});

/**
 * **비용 가드가 통째로 꺼져 있으면 하루 상한도 꺼진다 — 그리고 그게 맞다.**
 *
 * `AMORA_COST_GUARD_ENABLED=false` 는 긴급 스위치다. 켜면 커플 한도·전역
 * 일일 상한·전역 비용 상한이 전부 무효가 된다. 하루 상한만 살려 두면
 * "긴급 해제" 라는 계약이 깨진다.
 *
 * 문제는 **꺼진 상태가 아무 데도 안 보였다**는 것이다. 2026-08-25 에 하루
 * 상한을 세 번 만들어 세 번 배포했는데 운영에서 한 번도 동작하지 않았고,
 * 스위치·호출 경로를 차례로 의심하다 조건을 하나씩 지워 낸 뒤에야 이것이
 * 남았다. 그래서 모듈이 뜰 때 소리를 내게 했다.
 */
describe("비용 가드 전체 해제", () => {
  it("하루 상한도 함께 꺼진다", async () => {
    vi.stubEnv("AMORA_COST_GUARD_ENABLED", "false");
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    dailyCount = 500;
    const result = await reserve();
    expect(result.allowed).toBe(true);
    vi.unstubAllEnvs();
  });

  it("꺼져 있으면 소리를 낸다", async () => {
    vi.stubEnv("AMORA_COST_GUARD_ENABLED", "false");
    vi.resetModules();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import("@/lib/ai/costGuard");
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("DISABLED");
    expect(logged).toContain("AMORA_COST_GUARD_ENABLED=false");
    vi.unstubAllEnvs();
  });

  it("켜져 있으면 조용하다", async () => {
    vi.resetModules();
    // vitest 는 같은 대상의 spy 를 재사용한다 — 앞 검사의 호출이 남아 있다.
    vi.restoreAllMocks();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import("@/lib/ai/costGuard");
    expect(JSON.stringify(err.mock.calls)).not.toContain("DISABLED");
  });
});

/**
 * **지금 걸려 있는 값을 아무도 볼 수 없었다.**
 *
 * 이 상한들은 Vercel 에서 Sensitive 로 저장돼 값을 되읽을 수 없다. 그래서
 * "공개 규모에 이 값이 맞는가" 를 답할 수 없었고, 바꾸려면 무엇을 바꾸는지
 * 모르는 채로 덮어써야 했다.
 *
 * 2026-08-25 에 하루 상한이 안 먹는 원인을 찾느라 세 번 배포하고 네 번 눌러
 * 봤는데, 값이 보였다면 첫 번째에 알았다. 비밀이 아니라 설정 숫자다.
 */
describe("걸려 있는 값을 한 번은 말한다", () => {
  it("모듈이 뜰 때 설정을 찍는다", async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await import("@/lib/ai/costGuard");

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain("[costGuard] config");
    // 다섯 가지가 다 보여야 "무엇이 먼저 걸리는가" 를 답할 수 있다.
    for (const key of [
      "guardEnabled",
      "coupleLifetimeQuota",
      "coupleDailyCap",
      "globalDailyTurns",
      "globalDailyCostUsd",
    ]) {
      expect(logged).toContain(key);
    }
  });

  it("비용 상한이 몇 턴에 해당하는지 함께 말한다", async () => {
    // 턴 상한과 비용 상한 중 **어느 쪽이 먼저 걸리는가** 가 실제 질문이다.
    vi.resetModules();
    vi.restoreAllMocks();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await import("@/lib/ai/costGuard");
    expect(JSON.stringify(info.mock.calls)).toContain("costCapReachedAtTurns");
  });

  it("끈 것은 숫자가 아니라 off 로 말한다", async () => {
    // 0 이나 큰 숫자로 찍으면 "낮게 설정됨" 과 구분이 안 된다.
    vi.stubEnv("AMORA_COUPLE_DAILY_CAP_ENABLED", "false");
    vi.resetModules();
    vi.restoreAllMocks();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await import("@/lib/ai/costGuard");
    expect(JSON.stringify(info.mock.calls)).toContain('"coupleDailyCap":"off"');
    vi.unstubAllEnvs();
  });
});
