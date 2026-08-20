import { beforeEach, describe, expect, it } from "vitest";

import { findPreparationStageOption } from "@hanbang/shared";
import { useOnboardingStore } from "@/stores/onboardingStore";

function statusOf(key: string) {
  return useOnboardingStore
    .getState()
    .progressChecklist.find((item) => item.key === key)?.status;
}

describe("onboardingStore 준비 단계", () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it("단계를 고르면 그 단계의 제안값으로 19항목을 채운다", () => {
    useOnboardingStore.getState().setPreparationStage("venue_booked");

    const suggested = findPreparationStageOption("venue_booked")?.suggested ?? {};
    expect(Object.keys(suggested).length).toBeGreaterThan(0);
    for (const [key, status] of Object.entries(suggested)) {
      expect(statusOf(key)).toBe(status);
    }
  });

  // 새로고침하면 화면은 단계 선택으로 돌아오지만 고른 단계는 선택된 채 보인다.
  // 그 카드를 한 번 더 누른 사람이 앞서 적어둔 답을 잃으면 안 된다.
  it("같은 단계를 다시 고르면 사용자가 직접 고친 항목을 건드리지 않는다", () => {
    useOnboardingStore.getState().setPreparationStage("venue_booked");
    // 제안값(완료)을 사용자가 직접 되돌리고, 다른 항목도 손으로 표시한다.
    useOnboardingStore.getState().setChecklistItemStatus("venue", "not_started");
    useOnboardingStore.getState().setChecklistItemStatus("studio", "in_progress");
    useOnboardingStore.getState().setChecklistItemStatus("dress", "not_applicable");
    useOnboardingStore.getState().setChecklistItemStatus("ring", "completed");
    useOnboardingStore.getState().setChecklistItemCost("ring", 300);

    useOnboardingStore.getState().setPreparationStage("venue_booked");

    expect(useOnboardingStore.getState().preparationStage).toBe("venue_booked");
    expect(statusOf("venue")).toBe("not_started");
    expect(statusOf("studio")).toBe("in_progress");
    expect(statusOf("dress")).toBe("not_applicable");
    expect(statusOf("ring")).toBe("completed");
    expect(
      useOnboardingStore
        .getState()
        .progressChecklist.find((item) => item.key === "ring")?.cost,
    ).toBe(300);
  });

  // 반대로 단계를 실제로 바꿨으면 앞 단계의 제안이 남아 있으면 안 된다. 고른 적
  // 없는 상태를 자기가 고른 것처럼 보게 되기 때문이다.
  it("다른 단계로 바꾸면 제안값으로 다시 채운다", () => {
    useOnboardingStore.getState().setPreparationStage("venue_booked");
    useOnboardingStore.getState().setChecklistItemStatus("studio", "in_progress");

    useOnboardingStore.getState().setPreparationStage("just_started");

    expect(useOnboardingStore.getState().preparationStage).toBe("just_started");
    expect(statusOf("venue")).toBe("not_started");
    expect(statusOf("studio")).toBe("not_started");
  });
});
