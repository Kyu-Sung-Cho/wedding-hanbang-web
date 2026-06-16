import { describe, expect, it } from "vitest";
import { canUseServerInitialCommunityFeed, normalizeCommunityFeedQuery } from "../feedQuery";

describe("community feed query", () => {
  it("allows server initial feed for the default latest community home", () => {
    expect(canUseServerInitialCommunityFeed(normalizeCommunityFeedQuery())).toBe(true);
    expect(canUseServerInitialCommunityFeed(normalizeCommunityFeedQuery({ sort: "new", period: "week" }))).toBe(true);
    expect(canUseServerInitialCommunityFeed(normalizeCommunityFeedQuery({ feed: "all" }))).toBe(true);
  });

  it("does not use server initial feed for filtered or non-latest feeds", () => {
    expect(canUseServerInitialCommunityFeed(normalizeCommunityFeedQuery({ search: "스드메" }))).toBe(false);
    expect(canUseServerInitialCommunityFeed(normalizeCommunityFeedQuery({ category: "free" }))).toBe(false);
    expect(canUseServerInitialCommunityFeed(normalizeCommunityFeedQuery({ tag: "계약" }))).toBe(false);
    expect(canUseServerInitialCommunityFeed(normalizeCommunityFeedQuery({ author_id: "user-1" }))).toBe(false);
    expect(canUseServerInitialCommunityFeed(normalizeCommunityFeedQuery({ sort: "hot" }))).toBe(false);
    expect(canUseServerInitialCommunityFeed(normalizeCommunityFeedQuery({ sort: "top" }))).toBe(false);
  });
});
