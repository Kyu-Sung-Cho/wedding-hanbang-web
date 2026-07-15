import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260713106000_atomic_budget_category_mutations.sql",
  ),
  "utf8",
);

describe("atomic budget category migration", () => {
  it("serializes partner writes on the journey row and returns authoritative progress", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.mutate_journey_budget_category");
    expect(migration).toMatch(
      /SELECT progress[\s\S]*?FROM public\.wedding_journeys[\s\S]*?WHERE couple_id = p_couple_id[\s\S]*?FOR UPDATE;/,
    );
    expect(migration.indexOf("FOR UPDATE;")).toBeLessThan(
      migration.indexOf("UPDATE public.wedding_journeys"),
    );
    expect(migration).toContain("'progress', v_progress");
    expect(migration).toContain("'categoryKey', p_category_key");
  });

  it("merges only budget-owned fields without replacing status, checklist, or unrelated progress", () => {
    expect(migration).toContain("v_category := v_category - v_remove_fields;");
    expect(migration).toContain("v_category := v_category || p_set_fields");
    expect(migration).toContain(
      "v_progress := jsonb_set(v_progress, ARRAY[p_category_key], v_category, true);",
    );
    expect(migration).not.toMatch(/v_progress\s*:=\s*p_set_fields/);
    expect(migration).not.toMatch(/v_progress\s*-\s*p_category_key/);
  });

  it("validates keys, amounts, payer, metadata, reset fields, and visibility again in SQL", () => {
    expect(migration).toContain("invalid budget category key");
    expect(migration).toContain("invalid budget category amount");
    expect(migration).toContain("invalid budget category payer");
    expect(migration).toContain("invalid budget category label");
    expect(migration).toContain("p_category_key !~ '^custom_'");
    expect(migration).toContain("~ '[[:cntrl:]]'");
    expect(migration).toContain("unsupported budget category set field");
    expect(migration).toContain("unsupported budget category remove field");
    expect(migration).toContain("ARRAY['budget', 'spent', 'cost', 'payer', 'label']");
    expect(migration).toContain("v_remove_fields := array_append(v_remove_fields, 'cost');");
    expect(migration).toContain("p_visibility NOT IN ('visible', 'hidden')");
  });

  it("is service-only even though the API checks authenticated couple ownership", () => {
    expect(migration).toContain("COALESCE(auth.role(), '') <> 'service_role'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.mutate_journey_budget_category\(uuid, text, jsonb, text\[\], text\)[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mutate_journey_budget_category\(uuid, text, jsonb, text\[\], text\)[\s\S]*?TO service_role;/,
    );
  });
});
