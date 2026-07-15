import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260713111000_budget_manual_record_contract.sql",
  ),
  "utf8",
);

describe("budget manual-record forward migration", () => {
  it("overrides the existing atomic RPC while preserving its row lock and result", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.mutate_journey_budget_category",
    );
    expect(migration).toMatch(
      /SELECT progress[\s\S]*?FROM public\.wedding_journeys[\s\S]*?WHERE couple_id = p_couple_id[\s\S]*?FOR UPDATE;/,
    );
    expect(migration.indexOf("FOR UPDATE;")).toBeLessThan(
      migration.indexOf("UPDATE public.wedding_journeys"),
    );
    expect(migration).toContain("'progress', v_progress");
    expect(migration).toContain("'categoryKey', p_category_key");
  });

  it("allows only the new manual facts and label to be set", () => {
    expect(migration).toContain(
      "ARRAY['budget', 'contractedTotal', 'paidToDate', 'nextPaymentAmount', 'nextPaymentDate', 'label']",
    );
    expect(migration).toContain(
      "ARRAY['budget', 'contractedTotal', 'paidToDate', 'nextPaymentAmount', 'nextPaymentDate', 'spent', 'cost', 'payer', 'label']",
    );
    expect(migration).not.toMatch(/ARRAY\['budget',[^\]]*'spent'[^\]]*\]\) <> '\{\}'::jsonb/);
    expect(migration).not.toContain("v_remove_fields := array_append(v_remove_fields, 'cost')");
  });

  it("validates integer money, real date-only values, and the merged paid invariant", () => {
    expect(migration).toContain(
      "ARRAY['budget', 'contractedTotal', 'paidToDate', 'nextPaymentAmount']",
    );
    expect(migration).toContain("v_amount > 10000000000");
    expect(migration).toContain("v_amount <> trunc(v_amount)");
    expect(migration).toContain("invalid next payment date");
    expect(migration).toContain("v_next_payment_date::date");
    expect(migration).toContain("paid to date exceeds contracted total");

    const mergedCategory = migration.indexOf("v_category := v_category || p_set_fields");
    const invariant = migration.indexOf("paid to date exceeds contracted total");
    const update = migration.indexOf("UPDATE public.wedding_journeys");
    expect(mergedCategory).toBeGreaterThan(-1);
    expect(migration.slice(mergedCategory, invariant)).toContain(
      "ARRAY['budget', 'contractedTotal', 'paidToDate', 'nextPaymentAmount']",
    );
    expect(invariant).toBeGreaterThan(mergedCategory);
    expect(invariant).toBeLessThan(update);
  });

  it("does not rewrite legacy values and remains service-only", () => {
    expect(migration).not.toMatch(/'paidToDate'\s*,\s*v_category\s*->\s*'spent'/);
    expect(migration).not.toMatch(/'contractedTotal'\s*,\s*v_category\s*->\s*'cost'/);
    expect(migration).not.toMatch(/'[^']+'\s*,\s*v_category\s*->\s*'payer'/);
    expect(migration).toContain("COALESCE(auth.role(), '') <> 'service_role'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.mutate_journey_budget_category\(uuid, text, jsonb, text\[\], text\)[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mutate_journey_budget_category\(uuid, text, jsonb, text\[\], text\)[\s\S]*?TO service_role;/,
    );
  });
});
