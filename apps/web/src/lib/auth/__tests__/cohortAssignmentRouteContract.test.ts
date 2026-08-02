// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cohortRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/cohort/route.ts"),
  "utf8",
);
const weddingDateRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/profile/wedding-date/route.ts"),
  "utf8",
);
const autoAssignRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/community/cohort/auto-assign/route.ts"),
  "utf8",
);

function postHandler(source: string) {
  const start = source.indexOf("export async function POST");
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

describe("cohort assignment route contract", () => {
  it.each([
    ["explicit cohort", cohortRoute],
    ["wedding date", weddingDateRoute],
    ["automatic cohort", autoAssignRoute],
  ])("routes %s assignment through the canonical RPC only", (_name, source) => {
    const post = postHandler(source);
    expect(post).toMatch(/\.rpc\(\s*["']community_assign_cohort["']/);
    expect(post).toContain("p_user_id: user.id");
    expect(post).toContain("typeof roomId !== \"string\"");
    expect(post).toContain("!isUuid(roomId)");
    expect(post).not.toMatch(/\.from\(["']cohort_members["']\)[\s\S]*?\.(?:insert|update|upsert|delete)\(/);
    expect(post).not.toMatch(/\.from\(["']cohort_rooms["']\)[\s\S]*?\.(?:insert|update|upsert|delete)\(/);
    expect(post).not.toContain("refreshMemberCount(");
    expect(post).toContain("checkRateLimitPersistent(");
    expect(post).toContain('rateLimitKey("community:cohort:assign",');
    expect(post).toContain("{ failClosed: true }");
  });

  it.each([
    ["explicit cohort", cohortRoute],
    ["wedding date", weddingDateRoute],
  ])("keeps %s quarter normalization and response fields", (_name, source) => {
    const post = postHandler(source);
    expect(post).toContain("const quarter = monthToQuarter(month)");
    expect(post).toContain("const normalizedMonth = quarterToMonth(quarter)");
    expect(post).toContain("p_month: normalizedMonth");
    expect(post).toContain("room_id: roomId");
    expect(post).toContain("month: normalizedMonth");
    expect(post).toContain("Number.isInteger(year)");
    expect(post).toContain("Number.isInteger(month)");
  });
});
