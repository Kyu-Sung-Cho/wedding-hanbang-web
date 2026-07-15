import { describe, expect, it } from "vitest";
import {
  PUBLIC_COMMUNITY_POST_QUERY_FILTERS,
  canReadCommunityPost,
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

  it("keeps under-review posts readable only to the author or an admin", () => {
    const row = post({ under_review: true });

    expect(canReadCommunityPost(row)).toBe(false);
    expect(canReadCommunityPost(row, { actorId: "viewer-2", isAuthenticated: true })).toBe(false);
    expect(canReadCommunityPost(row, { actorId: "author-1", isAuthenticated: true })).toBe(true);
    expect(canReadCommunityPost(row, { actorId: "viewer-2", isAuthenticated: true, isAdmin: true })).toBe(true);
  });

  it("keeps members and draft visibility rules in one place", () => {
    expect(canReadCommunityPost(post({ visibility: "members" }))).toBe(false);
    expect(canReadCommunityPost(post({ visibility: "members" }), { actorId: null, isAuthenticated: true })).toBe(true);
    expect(canReadCommunityPost(post({ visibility: "draft" }), { actorId: "viewer-1", isAuthenticated: true })).toBe(false);
    expect(canReadCommunityPost(post({ visibility: "draft" }), { actorId: "author-1", isAuthenticated: true })).toBe(true);
  });
});
