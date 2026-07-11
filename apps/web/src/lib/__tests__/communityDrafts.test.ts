import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  },
}));

import {
  DRAFT_MAX_AGE_MS,
  clearCommunityPostDraft,
  loadCommunityPostDraft,
  loadQuickReviewDraft,
  saveCommunityPostDraft,
  saveQuickReviewDraft,
} from "../../../../mobile/src/lib/communityDrafts";

describe("mobile community drafts", () => {
  beforeEach(() => {
    storage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps drafts isolated per signed-in account", async () => {
    await saveCommunityPostDraft("user-a", {
      category: "free",
      adDisclosure: "general",
      sponsorDetail: "",
      title: "아직 작성 중",
      content: "로그인 뒤에도 남아야 하는 본문",
    });

    await expect(loadCommunityPostDraft("user-a")).resolves.toMatchObject({
      title: "아직 작성 중",
    });
    await expect(loadCommunityPostDraft("user-b")).resolves.toBeNull();
  });

  it("expires old drafts and removes malformed payloads", async () => {
    await saveQuickReviewDraft("user-a", {
      vendorName: "테스트 업체",
      category: "venue",
      rating: 5,
      review: "좋았어요",
      adDisclosure: "general",
    });

    vi.setSystemTime(Date.now() + DRAFT_MAX_AGE_MS + 1);
    await expect(loadQuickReviewDraft("user-a")).resolves.toBeNull();
    expect(storage.size).toBe(0);
  });

  it("rejects unsafe account identifiers and clears submitted drafts", async () => {
    expect(() =>
      saveCommunityPostDraft("../other-account", {
        category: "free",
        adDisclosure: "general",
        sponsorDetail: "",
        title: "title",
        content: "content",
      }),
    ).toThrow("invalid_draft_owner");

    await saveCommunityPostDraft("user-a", {
      category: "free",
      adDisclosure: "general",
      sponsorDetail: "",
      title: "title",
      content: "content",
    });
    await clearCommunityPostDraft("user-a");
    await expect(loadCommunityPostDraft("user-a")).resolves.toBeNull();
  });
});
