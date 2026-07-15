import { beforeEach, describe, expect, it } from "vitest";
import { useOnboardingStore } from "../onboardingStore";

describe("onboarding budget", () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it("starts undecided instead of preselecting a 2,000만원 budget", () => {
    expect(useOnboardingStore.getState().approximateBudget).toBe(0);
  });
});
