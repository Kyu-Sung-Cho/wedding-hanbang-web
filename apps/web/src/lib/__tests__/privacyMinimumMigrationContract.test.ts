import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const readNormalized = (relativePath: string) =>
  readFileSync(resolve(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
const migration = readNormalized(
  "supabase/migrations/20260713100000_privacy_minimum_cohort_profiles_survey.sql"
);
const productionPreflight = readNormalized(
  "scripts/sql/supabase-production-preflight.sql"
);
const postDeployContract = readNormalized(
  "scripts/sql/supabase-post-deploy-contract.sql"
);
const safeShip = readNormalized("scripts/supabase-ship-safe.ps1");

const extractPrivacyContractCtes = (sql: string) => {
  const start = sql.indexOf("), privacy_required_constraints(");
  const contract = sql.indexOf("), privacy_minimum_contract AS (", start);
  const end = sql.indexOf("\n), ", contract);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(contract).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(contract);

  return sql.slice(start, end + 2);
};

describe("privacy minimum forward migration", () => {
  it("uses the bounded CLI-owned forward transaction without destructive cascades", () => {
    expect(migration).not.toMatch(/^BEGIN;$/gm);
    expect(migration).not.toMatch(/^COMMIT;$/gm);
    expect(migration).toContain("SET lock_timeout = '5s';");
    expect(migration).toContain("SET statement_timeout = '120s';");
    expect(migration).not.toMatch(/\bCASCADE\b/i);
    expect(migration).toContain(
      "LOCK TABLE public.cohort_contracts IN ACCESS EXCLUSIVE MODE;"
    );
    expect(migration).toContain(
      "LOCK TABLE public.customer_survey_responses IN ACCESS EXCLUSIVE MODE;"
    );
    expect(migration).toContain(
      "REVOKE ALL (%s) ON TABLE %I.%I FROM PUBLIC, anon, authenticated, service_role"
    );
    expect(migration).toContain(
      "REVOKE ALL (%s) ON TABLE public.cohort_room_contributor_stats FROM PUBLIC, anon, authenticated, service_role"
    );
  });

  it("uses one latest valid quote per distinct member and hides every small cell", () => {
    expect(migration).toContain(
      "SELECT DISTINCT ON (\n    contract.room_id,\n    contract.category,\n    contract.user_id"
    );
    expect(migration).toContain(
      "CASE WHEN count(*) >= 5 THEN count(*) END AS sample_size"
    );
    expect(migration).toContain(
      "WHEN count(*) >= 5 THEN round(avg(latest.base_price))::integer"
    );
    expect(migration).toContain(
      "WHEN count(latest.extra_price) >= 5"
    );
    expect(migration.match(/AND count\(latest\.extra_price\) = count\(\*\)/g)).toHaveLength(2);
    expect(migration).toMatch(
      /WHEN count\(latest\.extra_price\) >= 5\s+AND count\(latest\.extra_price\) = count\(\*\)\s+THEN round\(\s+avg\(latest\.base_price \+ latest\.extra_price\)\s+FILTER \(WHERE latest\.extra_price IS NOT NULL\)/
    );
    expect(migration).not.toContain(
      "avg(latest.base_price + COALESCE(latest.extra_price, 0))"
    );
    expect(migration).toContain(
      "CASE WHEN count(*) >= 5 THEN count(*) END AS contributor_count"
    );
    expect(migration).toContain("count(*) >= 5 AS threshold_met");
    expect(migration).toContain("WITH (security_invoker = on)");
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.cohort_stats TO service_role;"
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.cohort_room_contributor_stats TO service_role;"
    );
    expect(migration).not.toMatch(
      /GRANT SELECT ON TABLE public\.cohort_(?:stats|room_contributor_stats)\s+TO (?:anon|authenticated)/
    );
  });

  it("keeps raw cohort quotes owner-only and binds writes to active membership", () => {
    for (const constraint of [
      "cohort_contracts_base_price_range",
      "cohort_contracts_extra_price_range",
      "cohort_contracts_vendor_name_length",
      "cohort_contracts_notes_length",
    ]) {
      expect(migration).toContain(`VALIDATE CONSTRAINT ${constraint};`);
    }
    expect(migration).toMatch(
      /CREATE POLICY cohort_contracts_select_own[\s\S]*?TO authenticated[\s\S]*?USING \(user_id = auth\.uid\(\)\);/
    );
    expect(migration).toMatch(
      /CREATE POLICY cohort_contracts_insert_active_member[\s\S]*?user_id = auth\.uid\(\)[\s\S]*?public\.is_cohort_member\(room_id\)/
    );
    expect(migration).toMatch(
      /CREATE POLICY cohort_contracts_update_active_member[\s\S]*?USING \([\s\S]*?public\.is_cohort_member\(room_id\)[\s\S]*?WITH CHECK \([\s\S]*?public\.is_cohort_member\(room_id\)/
    );
    expect(migration).toContain("NEW.created_at := pg_catalog.statement_timestamp();");
    expect(migration).toContain("NEW.id IS DISTINCT FROM OLD.id");
    expect(migration).toContain("NEW.user_id IS DISTINCT FROM OLD.user_id");
    expect(migration).toContain("NEW.room_id IS DISTINCT FROM OLD.room_id");
    expect(migration).toContain("SET search_path = pg_catalog, pg_temp");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.enforce_cohort_contract_server_fields()"
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_cohort_contract_server_fields\(\)[\s\S]*?LANGUAGE plpgsql\s+SET search_path = pg_catalog, pg_temp/
    );
  });

  it("exposes only author-card columns while keeping activity stats and achievements own-only", () => {
    expect(migration).toMatch(
      /GRANT SELECT \(\s*user_id,\s*nickname,\s*avatar_url,\s*badge,\s*rank\s*\) ON public\.community_profiles TO anon, authenticated;/
    );
    expect(migration).not.toMatch(
      /GRANT SELECT ON TABLE public\.community_profiles\s+TO (?:anon|authenticated)/
    );
    expect(migration).not.toContain(
      "CREATE POLICY community_profiles_insert_own"
    );
    expect(migration).not.toContain(
      "CREATE POLICY community_profiles_update_own"
    );
    expect(migration).not.toMatch(
      /GRANT (?:INSERT|UPDATE) \([\s\S]*?\) ON public\.community_profiles TO authenticated;/
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_my_community_activity_stats\(\)[\s\S]*?RETURNS TABLE\(\s*post_count integer,\s*comment_count integer,\s*total_upvotes_received integer\s*\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET row_security = off[\s\S]*?profile\.user_id = auth\.uid\(\)/
    );
    expect(migration).not.toContain("SELECT profile.*");
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(1);
    expect(migration).toContain(
      "ALTER FUNCTION public.get_my_community_activity_stats() OWNER TO postgres;"
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.get_my_community_activity_stats()"
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_my_community_activity_stats()\n  TO authenticated;"
    );
    expect(migration).toMatch(
      /CREATE POLICY community_achievements_select_own[\s\S]*?TO authenticated[\s\S]*?USING \(user_id = auth\.uid\(\)\);/
    );
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.community_achievements"
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.community_achievements TO authenticated;"
    );
  });

  it("removes public vendor aggregates from the Data API", () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "vendor_tags_select" ON public.community_vendor_tags;'
    );
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.community_vendor_tags"
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.community_vendor_tags TO service_role;"
    );
    expect(migration).not.toMatch(
      /GRANT SELECT ON TABLE public\.community_vendor_tags TO (?:anon|authenticated)/
    );
  });

  it("scrubs legacy survey identifiers and rejects every future non-null value", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.redact_customer_survey_identifiers()"
    );
    expect(migration).toContain("NEW.q23_contact := NULL;");
    expect(migration).toContain("NEW.user_agent := NULL;");
    expect(migration).toMatch(
      /CREATE TRIGGER customer_survey_identifiers_are_redacted\s+BEFORE INSERT OR UPDATE\s+ON public\.customer_survey_responses/
    );
    expect(migration).toMatch(
      /UPDATE public\.customer_survey_responses\s+SET q23_contact = NULL,\s+user_agent = NULL\s+WHERE q23_contact IS NOT NULL\s+OR user_agent IS NOT NULL;/
    );
    expect(migration).toContain("CHECK (q23_contact IS NULL)");
    expect(migration).toContain("CHECK (user_agent IS NULL)");
    expect(migration).toContain(
      "VALIDATE CONSTRAINT customer_survey_q23_contact_is_null;"
    );
    expect(migration).toContain(
      "VALIDATE CONSTRAINT customer_survey_user_agent_is_null;"
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.redact_customer_survey_identifiers()"
    );
  });

  it("binds the new catalog and data boundary into preflight and post-deploy release evidence", () => {
    for (const sql of [productionPreflight, postDeployContract]) {
      expect(sql).toContain("privacy_required_constraints(");
      expect(sql).toContain("privacy_required_policies(");
      expect(sql).toContain("privacy_required_functions(");
      expect(sql).toContain("privacy_required_triggers(");
      expect(sql).toContain("privacy_required_view_columns(");
      expect(sql).toContain("privacy_profile_column_acl AS (");
      expect(sql).toContain("privacy_expected_table_acl(");
      expect(sql).toContain("privacy_expected_effective_acl AS (");
      expect(sql).toContain("privacy_effective_acl AS (");
      expect(sql).toContain("privacy_minimum_contract AS (");
      expect(sql).toContain("('cohort_contracts', 'PUBLIC', ARRAY[]::text[])");
      expect(sql).toContain("('community_profiles', 'PUBLIC', ARRAY[]::text[])");
      expect(sql).toContain("('community_achievements', 'PUBLIC', ARRAY[]::text[])");
      expect(sql).toContain("('community_vendor_tags', 'PUBLIC', ARRAY[]::text[])");
      expect(sql).toContain("view_row.reloptions = ARRAY['security_invoker=true']::text[]");
      expect(sql).toContain("constraint_row.convalidated");
      expect(sql).toContain("trigger_row.tgtype = 23");
      expect(sql).toContain("pg_get_userbyid(procedure_row.proowner) = 'postgres'");
      expect(sql).toContain("WHERE exact IS DISTINCT FROM true");
      expect(sql).toContain(
        "casewhencount\\*>=5thenroundavglatest\\.base_price::integer"
      );
      expect(sql).toContain(
        "casewhencountlatest\\.extra_price>=5andcountlatest\\.extra_price=count\\*thenroundavglatest\\.extra_price::integer"
      );
      expect(sql).toContain(
        "casewhencountlatest\\.extra_price>=5andcountlatest\\.extra_price=count\\*thenroundavglatest\\.base_price\\+latest\\.extra_pricefilterwherelatest\\.extra_priceisnotnull::integer"
      );
      expect(sql).toContain(
        "orderbycontract.room_id,contract.category,contract.user_id,contract.created_atdescnullslast,contract.iddesc"
      );
      expect(sql).toContain("contract.extra_price<=1000000");
      expect(sql).toContain("pg_catalog.has_table_privilege(");
      expect(sql).toContain("pg_catalog.has_any_column_privilege(");
      expect(sql).toContain(
        "'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',"
      );
      expect(sql).toContain(
        "AND coalesce((SELECT exact FROM privacy_effective_acl), false)"
      );
    }

    expect(productionPreflight).toContain(
      "AS privacy_minimum_contract_exact"
    );
    expect(productionPreflight).toContain(
      "AS privacy_minimum_invalid_cohort_rows"
    );
    expect(postDeployContract).toContain(
      "'privacy_minimum_contract_exact', coalesce(("
    );
    expect(postDeployContract).toMatch(
      /'privacy_minimum_contract_exact', coalesce\(\(\s*SELECT exact FROM privacy_minimum_contract/
    );
    expect(safeShip).toContain(
      '$privacyMinimumPending = "20260713100000" -in $PendingVersions'
    );
    expect(safeShip).toContain(
      "$Preflight.dynamic_sources.privacy_minimum_contract_exact -ne $true"
    );
    expect(safeShip).toContain(
      "$Contract.privacy_minimum_contract_exact -ne $true"
    );
    expect(extractPrivacyContractCtes(productionPreflight)).toBe(
      extractPrivacyContractCtes(postDeployContract)
    );
  });
});
