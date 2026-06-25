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
    expect(communityCategoryFeedPath("is_normal")).toBe(
      "/wedding?category=is_normal&feed=all#community-feed",
    );
  });
});
