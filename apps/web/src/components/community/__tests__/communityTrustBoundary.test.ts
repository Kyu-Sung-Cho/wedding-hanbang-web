// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("community trust boundary", () => {
  it("does not join a cohort merely because the landing page was opened", () => {
    const landing = source("src/components/community/CommunityLandingClient.tsx");

    expect(landing).not.toContain("/api/community/cohort/auto-assign");
  });

  it("keeps ads and sponsored posts out of search and ranked feeds", () => {
    const postsRoute = source("src/app/api/community/posts/route.ts");
    const searchRoute = source("src/app/api/community/search/route.ts");

    expect(postsRoute).toContain('sort === "top" || sort === "hot"');
    expect(postsRoute).toContain('query = query.eq("ad_disclosure", "general")');
    expect(searchRoute.match(/\.eq\("ad_disclosure", "general"\)/g)).toHaveLength(2);
  });

  it("does not describe the unverified public feed as human-authenticated", () => {
    const landing = source("src/components/community/CommunityLandingClient.tsx");

    expect(landing).not.toContain("실제 게시글");
    expect(landing).not.toContain("인증후기");
  });

  it("renders sponsored consideration as visible text instead of hover-only copy", () => {
    const badge = source("src/components/community/AdDisclosureBadge.tsx");
    const landing = source("src/components/community/CommunityLandingClient.tsx");
    const postCard = source("src/components/community/PostCard.tsx");

    expect(badge).toContain("받은 혜택:");
    expect(badge).not.toContain("group-hover:block");
    expect(landing).toContain("sponsorshipDetail={post.sponsorship_detail}");
    expect(postCard).toContain("sponsorshipDetail={post.sponsorship_detail}");
  });
});
