import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/authStore";

/**
 * 파트너가 합류해도 먼저 시작한 사람 화면은 계속 "혼자 준비 중" 이었다.
 *
 *     A 가 초대 코드를 카톡으로 보낸다 → 라운지에서 기다린다
 *     B 가 가입·인증·합류를 마친다(보통 2~10분)
 *     A 의 화면: "혼자 준비 / 원할 때 파트너를 초대할 수 있어요"  ← 그대로
 *
 * A 는 코드가 안 먹혔다고 오해해 코드를 다시 보내거나 재발급한다. 제품이
 * 약속하는 "두 사람이 같은 화면을 본다" 의 첫 순간이 도착하지 않는다.
 *
 * 원인이 둘이었다.
 *   1) `refreshJourney` 가 journey 만 갱신하고 partner 를 건드리지 않았다.
 *   2) 실시간 구독이 `wedding_journeys` 만 들었는데, 파트너 합류로 바뀌는 것은
 *      `couples` 행이라 애초에 깨어나지 않았다.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";

function meResponse(partner: unknown) {
  return {
    ok: true,
    json: async () => ({
      user: { id: USER_ID },
      journey: { id: "j1", couple_id: "c1", progress: {} },
      partner,
      couple: { id: "c1" },
    }),
  };
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: USER_ID } as never,
    journey: { id: "j1", couple_id: "c1", progress: {} } as never,
    partner: null,
    couple: null,
    isDemo: false,
  });
});

describe("파트너 합류가 화면에 도착한다", () => {
  it("새로고침이 partner 를 세운다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => meResponse({ id: "p1", name: "신랑" })));
    const ok = await useAuthStore.getState().refreshJourney(USER_ID);
    expect(ok).toBe(true);
    expect(useAuthStore.getState().partner).toEqual({ id: "p1", name: "신랑" });
    vi.unstubAllGlobals();
  });

  it("아직 합류 전이면 partner 는 null 로 둔다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => meResponse(null)));
    await useAuthStore.getState().refreshJourney(USER_ID);
    expect(useAuthStore.getState().partner).toBeNull();
    vi.unstubAllGlobals();
  });

  it("다른 사람 응답이면 아무것도 세우지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        user: { id: "99999999-9999-4999-8999-999999999999" },
        journey: null,
        partner: { id: "p1" },
      }),
    })));
    const ok = await useAuthStore.getState().refreshJourney(USER_ID);
    expect(ok).toBe(false);
    expect(useAuthStore.getState().partner).toBeNull();
    vi.unstubAllGlobals();
  });
});
