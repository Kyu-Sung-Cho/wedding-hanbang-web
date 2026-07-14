import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260713110100_block_deleting_admin_privileges.sql",
);

function policyBody(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = migration.match(
    new RegExp(`CREATE POLICY "${escaped}"[\\s\\S]*?;`, "u"),
  );
  expect(match, `missing policy ${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

describe("deleting administrator privilege fence", () => {
  it.each([
    "관리자: 전체 정산 관리",
    "vendor_leads_admin_all",
    "amora_quote_checks_admin_select",
    "community_agent_personas_admin_select",
    "community_agent_personas_admin_write",
    "community_agent_drafts_admin_select",
    "community_agent_drafts_admin_write",
    "community_agent_activity_admin_select",
    "community_agent_activity_admin_write",
    "community_agent_daily_state_admin_select",
    "community_agent_daily_state_admin_write",
    "community_agent_automation_runs_admin_select",
    "community_agent_automation_runs_admin_write",
  ])("requires an active profile in %s", (name) => {
    const body = policyBody(name);
    expect(body).toContain("profile.is_admin = true");
    expect(body).toContain("profile.account_deleting_at IS NULL");
  });

  it("uses the same fail-closed boundary in every direct app admin check", () => {
    const sources = [
      read("apps/web/src/lib/utils/adminAuth.ts"),
      read("apps/web/src/app/api/admin/auth/route.ts"),
      read("apps/web/src/app/api/community/comments/[id]/route.ts"),
      read("apps/web/src/app/api/community/posts/[id]/route.ts"),
    ];

    for (const source of sources) {
      expect(source).toContain("is_admin, account_deleting_at");
      expect(source).toMatch(/account_deleting_at\s*(?:===|!==)\s*null/u);
    }
  });

  it("keeps the disabled conflict path fenced before any future re-enable", () => {
    const source = read("apps/web/src/app/api/chat/check-couple-conflict/route.ts");
    expect(source).toContain("is_admin, account_deleting_at");
    expect(source).toContain('reason: "account_inactive"');
    expect(source.indexOf('reason: "account_inactive"')).toBeLessThan(
      source.indexOf("reserveAmoraProviderCall(admin"),
    );
  });
});
