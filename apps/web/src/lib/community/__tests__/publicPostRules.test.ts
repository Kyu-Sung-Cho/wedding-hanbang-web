import { describe, expect, it } from "vitest";
import {
  PUBLIC_COMMUNITY_POST_QUERY_FILTERS,
  canReadCommunityPost,
  communityReadablePostOrFilter,
  filterPublicCommunityPosts,
  isPublicCommunityPost,
  type CommunityPostAccessRow,
} from "../publicPostRules";

function post(overrides: Partial<CommunityPostAccessRow>): CommunityPostAccessRow {
  return {
    author_id: "author-1",
    visibility: "public",
    under_review: false,
    ...overrides,
  };
}

describe("public community post rules", () => {
  it("exposes public query filter values without coupling to a Supabase builder", () => {
    expect(PUBLIC_COMMUNITY_POST_QUERY_FILTERS).toEqual({
      visibility: "public",
      underReview: false,
    });
  });

  it("defines public posts as public visibility and not under review", () => {
    expect(isPublicCommunityPost(post({ visibility: "public", under_review: false }))).toBe(true);
    expect(isPublicCommunityPost(post({ visibility: "public", under_review: true }))).toBe(false);
    expect(isPublicCommunityPost(post({ visibility: "members", under_review: false }))).toBe(false);
    expect(isPublicCommunityPost(post({ visibility: "draft", under_review: false }))).toBe(false);
  });

  it("defensively removes non-public and under-review rows from public responses", () => {
    const publicPost = post({ author_id: "public-author" });
    const underReview = post({ author_id: "review-author", under_review: true });
    const membersOnly = post({ author_id: "member-author", visibility: "members" });

    expect(filterPublicCommunityPosts([publicPost, underReview, membersOnly]))
      .toEqual([publicPost]);
  });

  it("keeps under-review posts readable only to the author or an admin", () => {
    const row = post({ under_review: true });

    expect(canReadCommunityPost(row)).toBe(false);
    expect(canReadCommunityPost(row, { userId: "viewer-2" })).toBe(false);
    expect(canReadCommunityPost(row, { userId: "author-1" })).toBe(true);
    expect(canReadCommunityPost(row, { userId: "viewer-2", isAdmin: true })).toBe(true);
  });

  it("keeps members and draft visibility rules in one place", () => {
    expect(canReadCommunityPost(post({ visibility: "members" }))).toBe(false);
    expect(canReadCommunityPost(post({ visibility: "members" }), { userId: "viewer-1" })).toBe(true);
    expect(canReadCommunityPost(post({ visibility: "draft" }), { userId: "viewer-1" })).toBe(false);
    expect(canReadCommunityPost(post({ visibility: "draft" }), { userId: "author-1" })).toBe(true);
  });

  it("builds the authenticated readable post filter from the same rule", () => {
    const filter = communityReadablePostOrFilter("user-1");

    expect(filter).toContain("and(visibility.eq.public,under_review.eq.false)");
    expect(filter).toContain("and(visibility.eq.members,under_review.eq.false)");
    expect(filter).toContain("and(visibility.eq.draft,author_public_id.eq.user-1)");
    expect(filter).toContain("and(under_review.eq.true,author_public_id.eq.user-1)");
  });
});
