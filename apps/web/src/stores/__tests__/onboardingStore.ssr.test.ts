// @vitest-environment node

import { describe, expect, it } from "vitest";

/**
 * 온보딩 화면은 "use client"지만 서버에서 첫 HTML을 그린다. 그 순간에는
 * `sessionStorage`가 없다 — 스토어가 그걸 그냥 만지면 온보딩 진입 자체가 500이
 * 된다. 저장을 붙이면서 생긴 위험이라 같이 못 박아 둔다.
 */
describe("onboardingStore SSR", () => {
  it("window 없는 환경에서 스토어를 만들고 값을 바꿔도 터지지 않는다", async () => {
    expect(typeof window).toBe("undefined");

    const { useOnboardingStore } = await import("../onboardingStore");

    expect(useOnboardingStore.getState().currentStep).toBe(1);
    expect(() => useOnboardingStore.getState().setRole("bride")).not.toThrow();
    expect(useOnboardingStore.getState().role).toBe("bride");
  });
});
