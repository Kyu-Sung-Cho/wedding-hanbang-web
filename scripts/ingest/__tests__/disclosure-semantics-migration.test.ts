import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260720120000_disclosure_semantic_staging.sql",
);

test("disclosure semantics have a private pending-only service-role staging table", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const linkGuard = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.guard_disclosure_semantic_draft_snapshot()"),
    sql.indexOf("$guard_disclosure_semantic_draft_snapshot$;"),
  );

  assert.match(sql, /CREATE TABLE public\.disclosure_semantic_staging/iu);
  assert.match(sql, /UNIQUE\s*\(snapshot_id,\s*source_record_key\)/iu);
  assert.match(sql, /CHECK\s*\(review_status = 'pending'\)/iu);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/iu);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/iu);
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.disclosure_semantic_staging\s+FROM PUBLIC, anon, authenticated, service_role/iu,
  );
  assert.match(
    sql,
    /GRANT SELECT, INSERT ON TABLE public\.disclosure_semantic_staging\s+TO service_role/iu,
  );
  assert.doesNotMatch(
    sql,
    /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*disclosure_semantic_staging[^;]*\b(?:anon|authenticated)\b/iu,
  );
  assert.doesNotMatch(
    sql,
    /GRANT\s+(?:UPDATE|DELETE|ALL)[^;]*disclosure_semantic_staging[^;]*\bservice_role\b/iu,
  );
  assert.doesNotMatch(sql, /CREATE\s+(?:OR REPLACE\s+)?VIEW[^;]*semantic/iu);
  assert.match(sql, /disclosure_semantic_subject_contract/iu);
  assert.match(sql, /schema_version smallint NOT NULL CHECK \(schema_version = 2\)/iu);
  assert.match(sql, /partner_record_ref text/iu);
  assert.match(sql, /partner_vendor_id uuid REFERENCES public\.vendors\(id\) ON DELETE RESTRICT/iu);
  assert.match(sql, /official_price_id uuid REFERENCES public\.official_prices\(id\) ON DELETE RESTRICT/iu);
  assert.match(sql, /source_agency jsonb/iu);
  assert.match(sql, /partner_link_status text NOT NULL/iu);
  assert.match(sql, /idx_disclosure_semantic_staging_partner_ref/iu);
  assert.match(sql, /idx_disclosure_semantic_staging_partner_vendor/iu);
  assert.match(sql, /idx_disclosure_semantic_staging_official_price/iu);
  assert.match(sql, /disclosure_source_agency_is_safe/iu);
  assert.match(sql, /disclosure_semantic_evidence_keys_are_safe/iu);
  assert.match(sql, /disclosure_semantic_source_object_keys_check/iu);
  assert.match(sql, /cardinality\(source_object_keys\)\s*=\s*cardinality\(source_file_ids\)/iu);
  assert.match(sql, /\(xlsx\|docx\|hwp\|pdf\|png\)/iu);
  assert.match(sql, /DISCLOSURE_SEMANTIC_DRAFT_SNAPSHOT_REQUIRED/iu);
  assert.match(sql, /DISCLOSURE_SEMANTIC_PRICE_LINK_MISMATCH/iu);
  assert.match(sql, /price\.snapshot_id = NEW\.snapshot_id/iu);
  assert.match(sql, /price\.vendor_id = NEW\.partner_vendor_id/iu);
  assert.match(sql, /snapshot\.published, snapshot\.is_current, snapshot\.published_at/iu);
  assert.match(sql, /snapshot_published IS NOT FALSE/iu);
  assert.match(sql, /FOR UPDATE/iu);
  assert.match(
    sql,
    /CREATE TRIGGER disclosure_semantic_draft_snapshot_fence\s+BEFORE INSERT OR UPDATE OF[\s\S]*partner_vendor_id[\s\S]*official_price_id/iu,
  );
  assert.match(sql, /guard_and_sync_disclosure_semantic_price_link/iu);
  assert.match(
    sql,
    /CREATE TRIGGER disclosure_semantic_price_link_sync\s+AFTER UPDATE OF vendor_id, snapshot_id ON public\.official_prices/iu,
  );
  assert.match(sql, /DISCLOSURE_SEMANTIC_PRICE_SNAPSHOT_IMMUTABLE/iu);
  assert.match(
    sql,
    /UPDATE public\.disclosure_semantic_staging\s+SET partner_vendor_id = NEW\.vendor_id/iu,
  );
  assert.match(sql, /patch_vendor_dedupe_semantic_links/iu);
  assert.match(
    sql,
    /\('public\.disclosure_semantic_staging'::regclass, 'partner_vendor_id'\)/iu,
  );
  assert.match(
    sql,
    /SET partner_vendor_id = p_preserved_vendor_id\s+WHERE partner_vendor_id = losing_vendor_id/iu,
  );
  assert.match(sql, /COALESCE\s*\(\s*\(\s*record_kind = 'vendor_policy'/iu);
  assert.match(sql, /vendor_category IS NOT NULL/iu);
  assert.match(sql, /title IS NOT NULL/iu);
  assert.match(sql, /summary IS NOT NULL/iu);
  assert.match(sql, /DISCLOSURE_SEMANTIC_PRIVILEGE_POSTCONDITION_FAILED/iu);
  assert.ok(
    linkGuard.indexOf("FROM public.official_prices AS price")
      < linkGuard.indexOf("FROM public.price_snapshots AS snapshot"),
    "price-backed semantic writes must lock price before snapshot to match price UPDATE lock order",
  );
});
