// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function routeSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function selectedColumns(source: string, constantName: string): string[] {
  const match = new RegExp(
    `const ${constantName} =\\s*"([^"]+)"`,
  ).exec(source);
  if (!match?.[1]) throw new Error(`Missing select allowlist: ${constantName}`);
  return match[1].split(",").map((column) => column.trim());
}

const profileRoute = routeSource("src/app/api/community/profile/route.ts");
const cohortRoute = routeSource("src/app/api/community/cohort/route.ts");
const messageRoute = routeSource(
  "src/app/api/community/cohort/[id]/messages/route.ts",
);

describe("community API response select allowlists", () => {
  it("never spreads every current or future database column into responses", () => {
    for (const source of [profileRoute, cohortRoute, messageRoute]) {
      expect(source).not.toMatch(/\.select\(\s*["'`]\s*\*\s*["'`]/);
    }
  });

  it("pins the own-profile response contract without schema-only XP or update fields", () => {
    const columns = selectedColumns(
      profileRoute,
      "COMMUNITY_PROFILE_RESPONSE_COLUMNS",
    );
    expect(columns).toEqual([
      "user_id:community_public_id",
      "nickname",
      "avatar_url",
      "badge",
      "post_count",
      "comment_count",
      "total_upvotes_received",
      "created_at",
      "rank",
      "wedding_year",
      "wedding_month",
      "wedding_completed",
      "progress_percent",
      "region",
      "warning_count",
      "is_suspended",
    ]);
    expect(profileRoute.match(/\.select\(COMMUNITY_PROFILE_RESPONSE_COLUMNS\)/g))
      .toHaveLength(6);
    for (const schemaOnlyColumn of ["total_xp", "level", "updated_at"]) {
      expect(columns).not.toContain(schemaOnlyColumn);
    }
  });

  it("pins the complete existing cohort-room response contract", () => {
    expect(selectedColumns(cohortRoute, "COHORT_ROOM_RESPONSE_COLUMNS")).toEqual([
      "id",
      "year",
      "month",
      "room_number",
      "name",
      "member_count",
      "message_count",
      "is_active",
      "created_at",
    ]);
    expect(cohortRoute.match(/\.select\(COHORT_ROOM_RESPONSE_COLUMNS\)/g))
      .toHaveLength(1);
  });

  it("pins the complete existing cohort-message response contract", () => {
    expect(selectedColumns(
      messageRoute,
      "COHORT_MESSAGE_RESPONSE_COLUMNS",
    )).toEqual([
      "id",
      "room_id",
      "author_id",
      "content",
      "thread_topic",
      "images",
      "reply_to",
      "is_deleted",
      "created_at",
    ]);
    expect(messageRoute.match(/\.select\(COHORT_MESSAGE_RESPONSE_COLUMNS\)/g))
      .toHaveLength(2);
  });
});
