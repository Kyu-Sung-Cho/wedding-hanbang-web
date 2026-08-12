import { beforeEach, describe, expect, it } from "vitest";

import { useOnboardingStore } from "@/stores/onboardingStore";

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "20000000-0000-4000-8000-000000000002";

describe("onboarding draft owner", () => {
  beforeEach(() => {
    useOnboardingStore.setState({ ownerUserId: USER_A });
    useOnboardingStore.getState().reset();
  });

  it("preserves a same-owner draft and erases it before binding another account", () => {
    const store = useOnboardingStore.getState();
    store.setRole("bride");
    store.setCoupleAction("join");
    store.setPartnerInviteCode("WH-SECRET123456");
    store.setBudget(50_000_000);

    store.bindOwner(USER_A);
    expect(useOnboardingStore.getState()).toMatchObject({
      ownerUserId: USER_A,
      role: "bride",
      coupleAction: "join",
      partnerInviteCode: "WH-SECRET123456",
      approximateBudget: 50_000_000,
    });

    store.bindOwner(USER_B);
    expect(useOnboardingStore.getState()).toMatchObject({
      ownerUserId: USER_B,
      currentStep: 1,
      role: null,
      coupleAction: null,
      partnerInviteCode: "",
      approximateBudget: 0,
    });
  });

  it("synchronously removes every account-owned draft before an owner is reverified", () => {
    const store = useOnboardingStore.getState();
    store.setStep(4);
    store.setRole("groom");
    store.setCoupleAction("join");
    store.setPartnerInviteCode("WH-PRIVATE987654");
    store.setWeddingDate("2027-05-21");
    store.setVenue("A 계정 예식장");
    store.setBudget(80_000_000);
    store.setWeddingStyle("classic");
    store.togglePriority("venue");

    store.clearOwner();

    expect(useOnboardingStore.getState()).toMatchObject({
      ownerUserId: null,
      currentStep: 1,
      role: null,
      coupleAction: null,
      partnerInviteCode: "",
      weddingDate: null,
      venue: null,
      approximateBudget: 0,
      preferences: {
        weddingStyle: null,
        priorities: [],
        budgetTendency: null,
        guestCount: null,
      },
    });
  });
});
