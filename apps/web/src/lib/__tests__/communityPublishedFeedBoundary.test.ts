import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("community published-feed boundary", () => {
  it("keeps drafts and held posts out of normal web/mobile feeds", () => {
    const webRoute = read("src/app/api/community/posts/route.ts");
    const votedRoute = read("src/app/api/community/posts/voted/route.ts");
    const mobileFeed = read("../mobile/app/(tabs)/community.tsx");
    const publicRules = read("src/lib/community/publicPostRules.ts");

    for (const source of [webRoute, votedRoute, mobileFeed]) {
      expect(source).not.toContain("and(visibility.eq.draft");
      expect(source).not.toContain("and(under_review.eq.true");
    }
    expect(publicRules).toContain('PUBLIC_COMMUNITY_POST_VISIBILITY = "public"');
    expect(publicRules).toContain("PUBLIC_COMMUNITY_POST_UNDER_REVIEW = false");
    expect(webRoute).toContain('["public", "members"]');
    expect(webRoute).toContain(
      '.eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview)',
    );
    expect(votedRoute).toContain('["public", "members"]');
    expect(votedRoute).toContain('.eq("community_posts.under_review", false)');
    expect(votedRoute).toContain('.eq("under_review", false)');
    expect(mobileFeed).toContain("/api/community/posts?sort=new");
    expect(mobileFeed).not.toContain('.from("community_posts")');
    expect(webRoute).toContain('sort !== "my_posts"');
    expect(webRoute).toContain('query.eq("author_public_id", viewerActorId)');
  });
});
