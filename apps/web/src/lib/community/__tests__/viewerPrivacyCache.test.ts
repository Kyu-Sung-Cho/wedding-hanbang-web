import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  claimGuestCommunityDraftForViewer,
  communityPostDraftKey,
  markGuestCommunityDraftHandoff,
  purgeCommunityBrowserPrivacyCache,
  scopedCommunitySessionCacheKey,
} from "@/lib/community/viewerPrivacyCache";

describe("community viewer privacy cache", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("uses different cache and draft keys for A, B, and guest", () => {
    const base = "community:landing:weekly-top-posts:5";
    expect(new Set([
      scopedCommunitySessionCacheKey(base, "user-a"),
      scopedCommunitySessionCacheKey(base, "user-b"),
      scopedCommunitySessionCacheKey(base, null),
    ]).size).toBe(3);
    expect(new Set([
      communityPostDraftKey("user-a"),
      communityPostDraftKey("user-b"),
      communityPostDraftKey(null),
    ]).size).toBe(3);
  });

  it("purges private community caches without deleting non-private guide preference", () => {
    sessionStorage.setItem("community:viewer:user-a:landing", "A");
    localStorage.setItem(communityPostDraftKey("user-a"), "A-draft");
    localStorage.setItem("community_post_draft", "legacy-A-draft");
    localStorage.setItem("hanbang_community_guide_seen", "true");

    purgeCommunityBrowserPrivacyCache();

    expect(sessionStorage.getItem("community:viewer:user-a:landing")).toBeNull();
    expect(localStorage.getItem(communityPostDraftKey("user-a"))).toBeNull();
    expect(localStorage.getItem("community_post_draft")).toBeNull();
    expect(localStorage.getItem("hanbang_community_guide_seen")).toBe("true");
  });

  it("preserves only an explicit guest login handoff and claims it into B's scope", () => {
    localStorage.setItem(communityPostDraftKey(null), "guest-draft");
    localStorage.setItem(communityPostDraftKey("user-a"), "A-draft");
    expect(markGuestCommunityDraftHandoff()).toBe(true);

    purgeCommunityBrowserPrivacyCache({ preserveGuestDraftHandoff: true });

    expect(localStorage.getItem(communityPostDraftKey(null))).toBe("guest-draft");
    expect(localStorage.getItem(communityPostDraftKey("user-a"))).toBeNull();
    expect(claimGuestCommunityDraftForViewer("user-b")).toBe(true);
    expect(localStorage.getItem(communityPostDraftKey(null))).toBeNull();
    expect(localStorage.getItem(communityPostDraftKey("user-b"))).toBe("guest-draft");

    purgeCommunityBrowserPrivacyCache();
    expect(claimGuestCommunityDraftForViewer("user-c")).toBe(false);
  });

  it("forces landing local state and weekly cache to follow the active viewer", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/community/CommunityLandingClient.tsx"),
      "utf8",
    );

    expect(source).toContain("key={communityViewerScope}");
    expect(source).toContain("scopedCommunitySessionCacheKey(");
    expect(source).not.toContain(
      'withSessionCache("community:landing:weekly-top-posts:5"',
    );
  });

  it("keeps an explicit guest draft handoff through the guest-to-user auth event", () => {
    const source = readFileSync(
      join(process.cwd(), "src/hooks/useAuthSessionSync.ts"),
      "utf8",
    );

    expect(source).toContain("currentUserId === null && nextUserId !== null");
    expect(source).toContain("bindViewer(nextUserId)");
  });
});
