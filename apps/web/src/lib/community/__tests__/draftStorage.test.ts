import { beforeEach, describe, expect, it } from "vitest";

import {
  clearCommunityPostDrafts,
  communityPostDraftKey,
  readOwnedCommunityPostDraft,
} from "../draftStorage";

describe("community post draft privacy", () => {
  beforeEach(() => localStorage.clear());

  it("never restores the legacy account-unbound draft", () => {
    localStorage.setItem("community_post_draft", JSON.stringify({ title: "private" }));

    expect(readOwnedCommunityPostDraft(localStorage, "user-b")).toBeNull();
    expect(localStorage.getItem("community_post_draft")).toBeNull();
  });

  it("restores only a fresh draft owned by the current account", () => {
    const now = Date.now();
    const key = communityPostDraftKey("user-a");
    localStorage.setItem(key, JSON.stringify({ ownerId: "user-b", savedAt: now, title: "B" }));
    expect(readOwnedCommunityPostDraft(localStorage, "user-a", now)).toBeNull();

    localStorage.setItem(key, JSON.stringify({ ownerId: "user-a", savedAt: now, title: "A" }));
    expect(readOwnedCommunityPostDraft<{ ownerId: string; savedAt: number; title: string }>(
      localStorage,
      "user-a",
      now,
    )?.title).toBe("A");
  });

  it("purges every account draft on logout or account switch", () => {
    localStorage.setItem(communityPostDraftKey("user-a"), "A");
    localStorage.setItem(communityPostDraftKey("user-b"), "B");
    localStorage.setItem("unrelated", "keep");

    clearCommunityPostDrafts(localStorage);

    expect(localStorage.getItem(communityPostDraftKey("user-a"))).toBeNull();
    expect(localStorage.getItem(communityPostDraftKey("user-b"))).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
});
