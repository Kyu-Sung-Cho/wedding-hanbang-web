import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function handlerSource(source: string, verb: string): string {
  const start = source.indexOf(`export async function ${verb}`);
  if (start < 0) return "";
  const next = source.indexOf("export async function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

const READ_ONLY_ROUTES = [
  "../app/api/community/cohort/route.ts",
  "../app/api/community/profile/route.ts",
] as const;

describe("community safe-method boundary", () => {
  for (const route of READ_ONLY_ROUTES) {
    it(`keeps GET ${route} free of database mutation primitives`, () => {
      const source = readFileSync(resolve(HERE, route), "utf8");
      const get = handlerSource(source, "GET");

      expect(get).not.toBe("");
      expect(get).not.toMatch(/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
    });
  }

  it("does not silently repair ambiguous cohort membership during a read", () => {
    const source = readFileSync(
      resolve(HERE, "../app/api/community/cohort/route.ts"),
      "utf8",
    );
    const get = handlerSource(source, "GET");

    expect(get).toContain("COHORT_MEMBERSHIP_CONFLICT");
    expect(get).not.toContain("refreshMemberCount(");
  });

  it("creates a missing community profile only through an explicit trusted POST", () => {
    const source = readFileSync(
      resolve(HERE, "../app/api/community/profile/route.ts"),
      "utf8",
    );
    const get = handlerSource(source, "GET");
    const post = handlerSource(source, "POST");

    expect(get).toContain("profile: null");
    expect(get).not.toContain("createCommunityProfile(");
    expect(post).toContain("createCommunityProfile(");
    expect(post.indexOf("isTrustedMutationRequest(")).toBeLessThan(
      post.indexOf("createClientFromRequest("),
    );
  });
});
