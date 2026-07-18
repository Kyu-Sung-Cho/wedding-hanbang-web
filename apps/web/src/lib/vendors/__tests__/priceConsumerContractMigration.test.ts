// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718190000_price_consumer_contract.sql",
  ),
  "utf8",
);

describe("price consumer database contract", () => {
  it("keeps draft snapshots out of every public disclosure projection", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE VIEW public\.v_public_official_prices[\s\S]*snapshot\.published IS TRUE/iu,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE VIEW public\.v_public_official_price_options[\s\S]*snapshot\.published IS TRUE/iu,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE VIEW public\.v_public_agency_packages[\s\S]*snapshot\.published IS TRUE/iu,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE VIEW public\.v_public_prices[\s\S]*snapshot\.published IS TRUE/iu,
    );
  });

  it("provides owned persistence for combos and alerts without splitting legacy favorites", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.wishlists");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.combos");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.price_alerts");
    expect(migration).toMatch(
      /CREATE POLICY price_consumer_owner_all[\s\S]*auth\.uid\(\) = user_id/iu,
    );
    expect(migration).toContain("sync_price_wishlist_with_legacy_favorite");
    expect(migration).toMatch(/ON CONFLICT \(user_id, vendor_id\) DO NOTHING/iu);
  });

  it("makes analytics server-weighted, PII-key constrained, and append-only", () => {
    expect(migration).toContain("vendor_event_weight");
    expect(migration).toContain("vendor_event_context_is_safe");
    expect(migration).toMatch(
      /ARRAY\(SELECT jsonb_object_keys\(p_context\)\)[\s\S]*<@ ARRAY\[[\s\S]*'zero_result'[\s\S]*\]::text\[\]/iu,
    );
    expect(migration).toContain("EVENTS_ARE_APPEND_ONLY");
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.events[\s\S]*GRANT SELECT, INSERT ON TABLE public\.events TO service_role/iu,
    );
  });

  it("aggregates KST calendar days idempotently and includes qualified demand", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.vendor_demand_daily");
    expect(migration).toContain("aggregate_vendor_demand_daily");
    expect(migration).toContain("AT TIME ZONE 'Asia/Seoul'");
    expect(migration).toMatch(/ON CONFLICT \(day, vendor_id\) DO UPDATE/iu);
    expect(migration).toMatch(
      /EXISTS \([\s\S]*wedding_journeys[\s\S]*wedding_date IS NOT NULL/iu,
    );
    expect(migration).toContain("0 19 * * *");
  });

  it("installs the daily demand cron contract inactive for the release fence", () => {
    expect(migration).toContain("vendor-demand-daily-kst");
    expect(migration).toContain("current_database()");
    expect(migration).toContain("current_user::text");
    expect(migration).toMatch(/active\s+IS\s+FALSE/iu);
    expect(migration).toMatch(/active\s*=\s*false/iu);
    expect(migration).toContain("cron.schedule_in_database");
    expect(migration).not.toMatch(/INSERT INTO cron\.job/iu);
  });

  it("keeps price snapshot publication and current selection as separate facts", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS published boolean");
    expect(migration).toMatch(
      /UPDATE public\.price_snapshots[\s\S]*SET published = true[\s\S]*is_current IS TRUE/iu,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.mark_price_snapshot_published[\s\S]*NEW\.is_current IS TRUE[\s\S]*NEW\.published := true/iu,
    );
    expect(migration).toContain("guard_price_snapshot_publication_write");
  });
});
