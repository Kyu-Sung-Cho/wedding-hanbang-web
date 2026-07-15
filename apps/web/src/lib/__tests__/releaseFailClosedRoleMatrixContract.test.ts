import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const readRepo = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const postDeploy = readRepo("scripts/sql/supabase-post-deploy-contract.sql");
const preflight = readRepo("scripts/sql/supabase-production-preflight.sql");
const shipSafe = readRepo("scripts/supabase-ship-safe.ps1");

describe("fail-closed release role matrix", () => {
  it("post-deploy requires the closed vendor catalog Data API boundary", () => {
    expect(postDeploy).toContain("vendor_catalog_lockdown_status AS (");
    expect(postDeploy).toContain("'vendor_catalog_lockdown_exact'");
    expect(postDeploy).toContain("has_any_column_privilege(");
    expect(postDeploy).toContain(
      "'authenticated', 'public.community_posts', 'vendor_id', 'SELECT'"
    );
    expect(postDeploy).toContain("vendor_favorites_select_own");
    expect(postDeploy).toContain("vendor_photo_likes_select_own");
  });

  it("post-deploy requires every disabled browser write surface to stay closed", () => {
    expect(postDeploy).toContain("disabled_browser_write_lockdown_status AS (");
    for (const marker of [
      "cohort_browser_lockdown_exact",
      "journey_browser_write_lockdown_exact",
      "chat_browser_write_lockdown_exact",
      "community_browser_write_lockdown_exact",
      "disabled_browser_write_lockdown_exact",
    ]) {
      expect(postDeploy).toContain(`'${marker}'`);
    }
    expect(postDeploy).toContain("public.is_cohort_member(uuid)");
    for (const signature of [
      "public.community_vote_post(uuid,uuid,smallint)",
      "public.community_vote_comment(uuid,uuid,smallint)",
      "public.community_record_login(uuid)",
      "public.community_cast_poll_vote(uuid,uuid,uuid)",
      "public.community_increment_view(uuid)",
      "public.community_update_bookmark_count(uuid)",
      "public.community_increment_profile_count(uuid,text)",
      "public.community_decrement_profile_count(uuid,text)",
      "public.community_award_xp(uuid,text,integer,uuid)",
      "public.community_unlock_achievement(uuid,text)",
      "public.community_update_progress(uuid,integer,text,text)",
    ]) {
      expect(postDeploy).toContain(signature);
      expect(preflight).toContain(signature);
    }
    expect(postDeploy).toContain("community_bookmarks_select_own");
    expect(postDeploy).toContain("community-(images|videos)");
  });

  it("keeps the privacy minimum compatible with service-only cohort data", () => {
    expect(postDeploy).not.toContain(
      "('cohort_contracts', 'cohort_contracts_select_own'"
    );
    expect(postDeploy).not.toContain(
      "('cohort_contracts', 'authenticated',\n      ARRAY['DELETE'"
    );
    expect(postDeploy).toMatch(
      /'community_profiles', 'community_achievements',\s*'community_vendor_tags'/
    );
    expect(postDeploy).toMatch(/AND 2 = \(\s*SELECT count\(\*\) FROM pg_catalog\.pg_policies/);
  });

  it("preflight exposes mutually exclusive legacy and closed release states", () => {
    for (const marker of [
      "vendor_catalog_lockdown_legacy_exact",
      "vendor_catalog_lockdown_exact",
      "disabled_browser_write_lockdown_legacy_exact",
      "cohort_browser_lockdown_exact",
      "journey_browser_write_lockdown_exact",
      "chat_browser_write_lockdown_exact",
      "community_browser_write_lockdown_exact",
      "disabled_browser_write_lockdown_exact",
    ]) {
      expect(preflight).toContain(`AS ${marker}`);
    }
  });

  it("keeps retained private reads and service ownership exact", () => {
    for (const contractSql of [preflight, postDeploy]) {
      expect(contractSql).toContain("= 'is_couple_membercouple_id'");
      expect(contractSql).toMatch(
        /has_any_column_privilege\(\s*'anon', 'public\.wedding_journeys'/
      );
      expect(contractSql).toMatch(
        /'service_role',\s*to_regclass\('public\.' \|\| relation\.table_name\)/
      );
    }
    expect(preflight).toMatch(
      /community_bookmarks_select_own[\s\S]*?AND 1 = \([\s\S]*?community_bookmarks/
    );
  });

  it("ship-safe accepts only one complete state while a closing migration is pending", () => {
    expect(shipSafe).toContain(
      '$vendorCatalogPending = "20260713104000" -in $PendingVersions'
    );
    expect(shipSafe).toContain(
      '$disabledBrowserWritePending = "20260713105000" -in $PendingVersions'
    );
    expect(shipSafe).toContain("vendor catalog state is partial or ambiguous");
    expect(shipSafe).toContain(
      "disabled browser-write state is partial or ambiguous"
    );
    expect(shipSafe).toContain(
      "$vendorCatalogLegacy -eq $vendorCatalogClosed"
    );
    expect(shipSafe).toContain(
      "$disabledBrowserWriteLegacy -eq $disabledBrowserWriteClosed"
    );
  });

  it("post-deploy requires the service-only hashed atomic journey RPC pair", () => {
    expect(postDeploy).toContain("atomic_journey_rpc_contract_exact");
    expect(postDeploy).toContain("217b8691f857b169fa8c314f38640bd6");
    expect(postDeploy).toContain("fffd63cefb9c2060940e5609236edcb6");
    expect(shipSafe).toContain(
      "$Contract.atomic_journey_rpc_contract_exact -ne $true"
    );
  });
});
