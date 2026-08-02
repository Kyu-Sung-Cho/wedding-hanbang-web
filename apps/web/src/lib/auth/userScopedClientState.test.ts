import { beforeEach, describe, expect, it, vi } from "vitest";

const resets = vi.hoisted(() => ({
  chat: vi.fn(),
  community: vi.fn(),
  money: vi.fn(),
  onboarding: vi.fn(),
  feedback: vi.fn(),
  vendorEvents: vi.fn(),
  posthogIdentity: vi.fn(),
  legacyEvents: vi.fn(),
  notifications: vi.fn(),
  handoffs: vi.fn(),
  priceCombo: vi.fn(),
  priceImpressions: vi.fn(),
  sessionCacheClear: vi.fn(),
  sessionCacheActivate: vi.fn(),
  retiredWeddingCode: vi.fn(),
}));

vi.mock("@/stores/chatStore", () => ({
  useChatStore: { getState: () => ({ reset: resets.chat }) },
}));
vi.mock("@/stores/communityStore", () => ({
  useCommunityStore: { getState: () => ({ reset: resets.community }) },
}));
vi.mock("@/stores/moneyStore", () => ({
  useMoneyStore: { getState: () => ({ reset: resets.money }) },
}));
vi.mock("@/stores/onboardingStore", () => ({
  useOnboardingStore: { getState: () => ({ reset: resets.onboarding }) },
}));
vi.mock("@/lib/chat/feedbackStorage", () => ({
  clearChatFeedbackStorage: resets.feedback,
}));
vi.mock("@/lib/analytics/track", () => ({
  resetVendorEventIdentity: resets.vendorEvents,
}));
vi.mock("@/lib/analytics", () => ({
  resetAnalyticsIdentityBoundary: resets.posthogIdentity,
}));
vi.mock("@/hooks/useEventTracker", () => ({
  resetLegacyEventTrackerState: resets.legacyEvents,
}));
vi.mock("@/hooks/useNotifications", () => ({
  clearNotificationClientState: resets.notifications,
}));
vi.mock("@/lib/privacy/oneTimeHandoff", () => ({
  clearOneTimeHandoffs: resets.handoffs,
}));
vi.mock("@/lib/price/comboStore", () => ({
  clearPriceComboClientState: resets.priceCombo,
}));
vi.mock("@/lib/price/impressionStorage", () => ({
  clearPriceImpressionClientState: resets.priceImpressions,
}));
vi.mock("@/utils/sessionCache", () => ({
  clearSessionCacheClientState: resets.sessionCacheClear,
  activateSessionCacheActor: resets.sessionCacheActivate,
}));
vi.mock("@/lib/weddingCode/retiredStorage", () => ({
  clearRetiredWeddingCodeStorage: resets.retiredWeddingCode,
}));

import {
  clearUserScopedClientState,
  reconcileUserScopedClientActor,
  USER_SCOPED_ACTOR_STORAGE_KEY,
} from "./userScopedClientState";

describe("clearUserScopedClientState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears every web client container that can retain prior-account data", () => {
    clearUserScopedClientState();

    expect(resets.chat).toHaveBeenCalledOnce();
    expect(resets.community).toHaveBeenCalledOnce();
    expect(resets.money).toHaveBeenCalledOnce();
    expect(resets.onboarding).toHaveBeenCalledOnce();
    expect(resets.feedback).toHaveBeenCalledOnce();
    expect(resets.vendorEvents).toHaveBeenCalledOnce();
    expect(resets.posthogIdentity).toHaveBeenCalledOnce();
    expect(resets.legacyEvents).toHaveBeenCalledOnce();
    expect(resets.notifications).toHaveBeenCalledOnce();
    expect(resets.handoffs).toHaveBeenCalledOnce();
    expect(resets.retiredWeddingCode).toHaveBeenCalledOnce();
    expect(resets.priceCombo).toHaveBeenCalledOnce();
    expect(resets.priceImpressions).toHaveBeenCalledOnce();
    expect(resets.sessionCacheClear).toHaveBeenCalledOnce();
  });

  it("continues clearing later containers when one purge throws", () => {
    resets.chat.mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });

    expect(() => clearUserScopedClientState("user:account-a")).not.toThrow();
    expect(resets.community).toHaveBeenCalledOnce();
    expect(resets.priceCombo).toHaveBeenCalledWith(undefined, "user:account-a");
    expect(resets.sessionCacheClear).toHaveBeenCalledWith("user:account-a");
  });

  it("purges legacy state before committing the first verified actor", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };

    const result = reconcileUserScopedClientActor("user:account-a", storage);

    expect(result).toEqual({ changed: true, previousActorKey: null });
    expect(resets.community).toHaveBeenCalledOnce();
    expect(resets.priceCombo).toHaveBeenCalledWith(undefined, undefined);
    expect(resets.priceImpressions).toHaveBeenCalledWith(undefined);
    expect(values.get(USER_SCOPED_ACTOR_STORAGE_KEY)).toBe("user:account-a");
    expect(resets.sessionCacheActivate).toHaveBeenCalledWith("user:account-a");
  });

  it("keeps same-actor state but purges the previous actor before a switch", () => {
    const values = new Map<string, string>([[USER_SCOPED_ACTOR_STORAGE_KEY, "user:account-a"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };

    reconcileUserScopedClientActor("user:account-a", storage);
    expect(resets.community).not.toHaveBeenCalled();

    reconcileUserScopedClientActor("user:account-b", storage);
    expect(resets.community).toHaveBeenCalledOnce();
    expect(resets.priceCombo).toHaveBeenCalledWith(undefined, "user:account-a");
    expect(resets.priceImpressions).toHaveBeenCalledWith("user:account-a");
    expect(values.get(USER_SCOPED_ACTOR_STORAGE_KEY)).toBe("user:account-b");
  });
});
