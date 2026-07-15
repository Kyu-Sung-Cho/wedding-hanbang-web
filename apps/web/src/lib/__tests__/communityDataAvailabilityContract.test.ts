import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("community data availability trust boundary", () => {
  it("fails every public author-enriched read closed instead of fabricating an anonymous profile", () => {
    const routes = [
      "src/app/api/community/posts/route.ts",
      "src/app/api/community/search/route.ts",
      "src/app/api/community/posts/[id]/route.ts",
      "src/app/api/community/comments/route.ts",
      "src/app/api/community/posts/voted/route.ts",
    ];

    for (const path of routes) {
      const source = read(path);
      expect(source).toContain("requireCommunityAuthor");
      expect(source).toContain("CommunityAuthorProfileUnavailableError");
      expect(source).toContain("status: 503");
      expect(source).not.toContain("fallbackCommunityAuthor");
    }
  });

  it("keeps an unavailable SSR seed distinct and exposes a retry path", () => {
    const types = read("src/types/community.types.ts");
    const initialFeed = read("src/lib/community/initialFeed.ts");
    const page = read("src/app/(community)/community/page.tsx");
    const client = read("src/components/community/CommunityLandingClient.tsx");

    expect(types).toContain('status: "unavailable"; message: string');
    expect(initialFeed).toContain("unavailableInitialFeed()");
    expect(page).toContain("InitialCommunityFeedResult");
    expect(client).toContain('initialFeed?.status === "unavailable"');
    expect(client).toContain("retryFeedError");
    expect(client).toContain("setInitialFeedError(null)");
  });
});
