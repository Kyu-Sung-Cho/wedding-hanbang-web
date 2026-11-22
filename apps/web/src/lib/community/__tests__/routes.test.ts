import { describe, expect, it } from "vitest";
import {
  communityCategoryFeedPath,
  communityPostLinkProps,
  communityPostPath,
  isCommunityCategory,
} from "@/lib/community/routes";

describe("community routes", () => {
  it("builds one canonical public detail href from the listed post id", () => {
    expect(communityPostPath("post-123")).toBe("/wedding/community/post/post-123");
    expect(communityPostPath("post-123", "comments")).toBe("/wedding/community/post/post-123#comments");
    expect(communityPostLinkProps("post-123")).toEqual({
      href: "/community/post/post-123",
      as: "/wedding/community/post/post-123",
      prefetch: false,
    });
  });

  it("uses the same category keys for category feed links", () => {
    expect(isCommunityCategory("is_normal")).toBe(true);
    expect(isCommunityCategory("missing")).toBe(false);
    // 2026-11-22 커뮤니티를 닫으면서 `/wedding` 이 피드가 아니게 됐다(`lib/weddingPaths.ts`).
    // 커뮤니티 주소는 이제 `/wedding/community` 아래 '닫았어요' 화면으로 간다.
    expect(communityCategoryFeedPath("is_normal")).toBe(
      "/wedding/community?category=is_normal&feed=all#community-feed",
    );
  });
});
