// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260718203000_price_consumer_cross_contract_hardening.sql",
);

describe("price consumer cross-contract hardening migration", () => {
  it("converts legacy publication dates to UTC instants and stamps new publication with now()", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /ALTER COLUMN published_at TYPE timestamptz[\s\S]*AT TIME ZONE 'UTC'/iu,
    );
    expect(migration).toMatch(
      /NEW\.published_at := COALESCE\(NEW\.published_at, now\(\)\)/iu,
    );
  });

  it("keeps raw events append-only and canonicalizes vendor and agency reads", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const vendorDedupe = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.decide_vendor_dedupe_candidate("),
      migration.indexOf("$decide_vendor_dedupe_candidate$;")
        + "$decide_vendor_dedupe_candidate$;".length,
    );

    expect(vendorDedupe).not.toMatch(/UPDATE public\.events/iu);
    expect(migration).toContain("CREATE OR REPLACE VIEW public.v_events_canonical");
    expect(migration).toMatch(
      /event_row\.vendor_id AS source_vendor_id,[\s\S]*canonical_price_vendor_id\(event_row\.vendor_id\) AS vendor_id/iu,
    );
    expect(migration).toMatch(
      /event_row\.agency_id AS source_agency_id,[\s\S]*canonical_price_agency_id\(event_row\.agency_id\) AS agency_id/iu,
    );
    expect(migration).toMatch(
      /FROM public\.v_events_canonical AS event_row[\s\S]*GROUP BY event_row\.vendor_id/iu,
    );
  });

  it("unions consumer vendor references, rewrites combo identities, and fails closed on immutable prices", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("merge_price_consumer_vendor_references");
    expect(migration).toContain("merge_price_consumer_agency_references");
    expect(migration).toContain("rewrite_price_combo_identity");
    expect(migration).toContain("PRICE_CONSUMER_VENDOR_REFERENCE_REWRITE_INCOMPLETE");
    expect(migration).toContain("VENDOR_DEDUPE_PRICE_REFERENCE_REQUIRES_NEW_SNAPSHOT");
    expect(migration).toContain("AGENCY_DEDUPE_PRICE_REFERENCE_REQUIRES_NEW_SNAPSHOT");
    expect(migration).toContain("combos_canonical_reference_fence");
    expect(migration).toMatch(
      /FUNCTION public\.enforce_price_combo_canonical_references\(\)[\s\S]*SECURITY DEFINER/iu,
    );
    expect(migration).toMatch(
      /BEFORE INSERT OR UPDATE OF merged_into_vendor_id ON public\.vendors/iu,
    );
    expect(migration).toMatch(
      /BEFORE INSERT OR UPDATE OF merged_into_agency_id ON public\.agencies/iu,
    );
  });

  it("fails closed on conflicting or unclassified agency provenance", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("AGENCY_DEDUPE_CORPORATE_NAME_CONFLICT");
    expect(migration).toContain("AGENCY_DEDUPE_SOURCE_FILE_CONFLICT");
    expect(migration).toContain("AGENCY_DEDUPE_HOMEPAGE_URL_CONFLICT");
    expect(migration).toContain("AGENCY_DEDUPE_DISCLOSURE_URL_CONFLICT");
    expect(migration).toContain("AGENCY_DEDUPE_UNMERGED_COLUMN_CONFLICT");
    expect(migration).toMatch(
      /to_jsonb\(losing_row\)\s*-\s*ARRAY\[[\s\S]*'corporate_name'[\s\S]*'disclosure_url'[\s\S]*'is_active'/iu,
    );
  });

  it("serializes vendor dedupe and daily aggregation on the same transaction lock", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const vendorDedupe = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.decide_vendor_dedupe_candidate("),
      migration.indexOf("$decide_vendor_dedupe_candidate$;")
        + "$decide_vendor_dedupe_candidate$;".length,
    );
    const aggregate = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.aggregate_vendor_demand_daily("),
      migration.indexOf("$aggregate_vendor_demand_daily$;")
        + "$aggregate_vendor_demand_daily$;".length,
    );
    const lockCall = "pg_catalog.pg_advisory_xact_lock(20260718, 20300)";

    expect(vendorDedupe.indexOf(lockCall)).toBeGreaterThan(-1);
    expect(vendorDedupe.indexOf(lockCall)).toBeLessThan(
      vendorDedupe.indexOf("IF p_decision NOT IN"),
    );
    expect(aggregate.indexOf(lockCall)).toBeGreaterThan(-1);
    expect(aggregate.indexOf(lockCall)).toBeLessThan(
      aggregate.indexOf("IF p_day IS NULL"),
    );
    expect(migration).toContain("STAGING_TWO_SESSION_VENDOR_DEDUPE_AGGREGATE_GATE");
  });

  it("makes both favorite stores insert/delete sets and scopes the cron repair", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const cronContract = migration.slice(
      migration.indexOf("DO $price_demand_cron_contract$"),
      migration.indexOf("$price_demand_cron_contract$;")
        + "$price_demand_cron_contract$;".length,
    );

    expect(migration).toMatch(
      /REVOKE UPDATE ON TABLE public\.wishlists[\s\S]*authenticated, service_role/iu,
    );
    expect(migration).not.toContain("CREATE POLICY price_consumer_owner_all ON public.wishlists");
    expect(migration).toMatch(
      /ALTER TABLE public\.vendor_favorites FORCE ROW LEVEL SECURITY/iu,
    );
    expect(migration).toMatch(
      /REVOKE UPDATE ON TABLE public\.vendor_favorites[\s\S]*authenticated, service_role/iu,
    );
    expect(migration).not.toMatch(
      /CREATE POLICY\s+"?vendor_favorites_manage"?[\s\S]*?FOR ALL/iu,
    );
    expect(migration).toContain("PRICE_DEMAND_CRON_EXTENSION_REQUIRED");
    expect(migration).toContain("PRICE_DEMAND_CRON_TIMEZONE_NOT_UTC");
    expect(migration).toContain("'0 19 * * *'");
    expect(migration).toContain("cron.unschedule($1)");
    expect(migration).toContain("PRICE_DEMAND_CRON_POSTCONDITION_FAILED");
    expect(cronContract).toMatch(/active\s+IS\s+FALSE/iu);
    expect(cronContract).toMatch(/active\s*=\s*false/iu);
    expect(cronContract).not.toMatch(/active\s+IS\s+TRUE/iu);
    expect(cronContract).not.toContain("SELECT cron.schedule(");
    expect(cronContract).toContain("cron.schedule_in_database");
    expect(cronContract).not.toMatch(/INSERT INTO cron\.job/iu);
    expect(cronContract.match(/database = current_database\(\)/gu)).toHaveLength(4);
    expect(cronContract.match(/username = current_user::text/gu)).toHaveLength(4);
  });
});
