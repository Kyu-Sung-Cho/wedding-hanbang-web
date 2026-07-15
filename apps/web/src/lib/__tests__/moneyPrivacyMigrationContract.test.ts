import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "../../supabase/migrations/20260713114000_retire_congratulatory_money.sql",
);

describe("retired congratulatory-money database boundary", () => {
  it("removes every browser read/write policy and blocks future inserts or updates", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.congratulatory_money FROM PUBLIC, anon, authenticated;/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT[\s\S]*TO\s+authenticated/i);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.reject_congratulatory_money_write()");
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE ON public\.congratulatory_money/i);
    expect(sql).toContain("congratulatory_money_retired");
    expect(sql).toMatch(
      /GRANT\s+SELECT \(id, owner_user_id, couple_id\), DELETE\s+ON TABLE public\.congratulatory_money TO service_role;/i,
    );
    expect(sql).not.toMatch(/GRANT SELECT, DELETE ON TABLE public\.congratulatory_money TO service_role;/i);
    expect(sql).not.toMatch(/DELETE FROM public\.congratulatory_money/i);
  });
});
