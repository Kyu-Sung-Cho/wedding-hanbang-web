// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function routeFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

const webRoot = resolve(process.cwd(), "src");
const expectedPersistentRoutes = [
  "app/api/bookings/route.ts",
  "app/api/bookings/[id]/outcome/route.ts",
  "app/api/community/comments/route.ts",
  "app/api/community/comments/[id]/vote/route.ts",
  "app/api/community/polls/[pollId]/vote/route.ts",
  "app/api/community/posts/route.ts",
  "app/api/community/posts/[id]/bookmark/route.ts",
  "app/api/community/posts/[id]/report/route.ts",
  "app/api/community/posts/[id]/view/route.ts",
  "app/api/community/posts/[id]/vote/route.ts",
  "app/api/community/profile/route.ts",
  "app/api/community/search/route.ts",
  "app/api/community/cohort/[id]/messages/route.ts",
  "app/api/community/cohort/[id]/members/[userId]/report/route.ts",
] as const;

describe("distributed abuse-control boundary", () => {
  it.each(expectedPersistentRoutes)("uses an awaited shared limiter in %s", (relativePath) => {
    const source = readFileSync(resolve(webRoot, relativePath), "utf8");
    expect(source).toContain("checkRateLimitPersistent");
    expect(source).toMatch(/await\s+checkRateLimitPersistent\s*\(/);
  });

  it("does not leave an instance-local limiter in any community API route", () => {
    const communityRoot = resolve(webRoot, "app/api/community");
    const localOnly = routeFiles(communityRoot)
      .filter((path) => /\bcheckRateLimit\s*\(/.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(communityRoot.length + 1));

    expect(localOnly).toEqual([]);
  });

  it("keeps message sends and both mediation mutations on the shared limiter", () => {
    const messages = readFileSync(resolve(webRoot, "app/api/messages/route.ts"), "utf8");
    const mediation = readFileSync(
      resolve(webRoot, "app/api/amora/mediation/accept/route.ts"),
      "utf8",
    );

    expect(messages).toMatch(
      /export async function POST[\s\S]*await checkRateLimitPersistent\s*\([\s\S]*messages:send/,
    );
    expect(mediation.match(/await checkRateLimitPersistent\s*\(/g)).toHaveLength(2);
    expect(mediation).not.toContain("request.json()");
  });

  it("bounds view-counter storage amplification before using a post-scoped bucket", () => {
    const source = readFileSync(
      resolve(webRoot, "app/api/community/posts/[id]/view/route.ts"),
      "utf8",
    );

    expect(source).toMatch(/if\s*\(!isUuid\(id\)\)/);
    expect(source).toContain('rateLimitKey("community:view:ingress", req)');
    expect(source).toContain('rateLimitKey(`community:view:post:${id}`, req)');
    expect(source.indexOf("if (!isUuid(id))")).toBeLessThan(
      source.indexOf('rateLimitKey("community:view:ingress", req)'),
    );
  });
});
