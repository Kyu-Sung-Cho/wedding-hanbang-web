// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_CONSUMERS = [
  "src/hooks/useCommentsRealtime.ts",
  "src/app/(community)/community/cohort/[id]/page.tsx",
  "src/lib/community/authorProfiles.ts",
  "src/lib/community/publicPostDetail.ts",
  "src/app/api/community/notifications/route.ts",
  "src/app/api/community/cohort/[id]/messages/route.ts",
  "src/app/api/community/cohort/[id]/timeline/route.ts",
];

function readWeb(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("community public profile consumer boundary", () => {
  it("moves every browser and request-scoped identity lookup off the private base profile table", () => {
    for (const relativePath of WEB_CONSUMERS) {
      const source = readWeb(relativePath);
      expect(source, relativePath).not.toMatch(/\.from\(["']community_profiles["']\)/u);
      expect(source, relativePath).toMatch(/\.from\(["']community_public_profiles["']\)/u);
    }
  });

  it("never asks the public projection for wedding timing", () => {
    for (const relativePath of WEB_CONSUMERS) {
      const source = readWeb(relativePath);
      const selects = source.match(/\.from\(["']community_public_profiles["']\)[\s\S]{0,160}?\.select\([^)]*\)/gu) ?? [];
      expect(selects.length, relativePath).toBeGreaterThan(0);
      for (const select of selects) {
        expect(select, relativePath).not.toMatch(/wedding_(?:year|month)/u);
      }
    }
  });

  it("loads mobile cohort members through the active-member server API only", () => {
    const repositoryRoot = resolve(process.cwd(), "../..");
    const screen = readFileSync(
      resolve(repositoryRoot, "apps/mobile/app/community/cohort/[id].tsx"),
      "utf8",
    );
    const access = readFileSync(
      resolve(repositoryRoot, "apps/mobile/src/lib/communityCohortAccess.mjs"),
      "utf8",
    );
    const route = readWeb("src/app/api/community/cohort/[id]/members/route.ts");

    expect(screen).toContain("fetchCohortMembers({");
    expect(screen).not.toMatch(/\.from\(["'](?:cohort_members|community_profiles)["']\)/u);
    expect(access).toContain("/api/community/cohort/${roomId}/members");
    expect(route).toContain('.eq("user_id", user.id)');
    expect(route).toContain('.eq("is_active", true)');
    expect(route).toContain('.from("community_public_profiles")');
    expect(route).not.toMatch(/wedding_(?:year|month)/u);
  });
});
