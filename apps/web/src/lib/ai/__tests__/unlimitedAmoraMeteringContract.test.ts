import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260713101000_unlimited_amora_test_stage_metering.sql"
  ),
  "utf8"
).replace(/\r\n/g, "\n");

describe("unlimited Amora test-stage metering contract", () => {
  it("keeps idempotent provider reservations without a couple or global cap check", () => {
    expect(migration).toContain("reserve_amora_usage_unlimited_v1");
    expect(migration).toContain("amora_usage_reservations");
    expect(migration).toContain("amora_request_claims");
    expect(migration).toContain("provider_ordinal");
    expect(migration).toContain("reused");
    expect(migration).toContain("SET count = count + 1");
    expect(migration).not.toContain("v_global_count >=");
    expect(migration).not.toContain("v_couple_provider_count >=");
    expect(migration).not.toContain("'global_daily'::text");
    expect(migration).not.toContain("'couple_provider_daily'::text");
  });

  it("keeps unlimited non-chat provider calls metered and service-role only", () => {
    expect(migration).toContain("meter_amora_provider_usage_unlimited_v1");
    expect(migration).toContain("service_role_required");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION");
  });

  it("keeps rolling old application RPCs unlimited while preserving v2 reservations", () => {
    const functionSql = (name: string, revokeSignature: string) => {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
      const end = migration.indexOf(
        `REVOKE ALL ON FUNCTION public.${revokeSignature}`,
        start
      );

      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return migration.slice(start, end);
    };

    const legacyReserve = functionSql(
      "reserve_amora_usage(",
      "reserve_amora_usage(uuid, integer, integer, boolean)"
    );
    const v2Reserve = functionSql(
      "reserve_amora_usage_v2(",
      "reserve_amora_usage_v2("
    );
    const legacyCheck = functionSql(
      "check_amora_usage(",
      "check_amora_usage(uuid, integer, integer, boolean)"
    );
    const oldestReserve = functionSql(
      "reserve_amora_turn(",
      "reserve_amora_turn(uuid, integer, integer)"
    );

    for (const sql of [legacyReserve, oldestReserve, v2Reserve, legacyCheck]) {
      expect(sql).not.toContain("'global_daily'::text");
      expect(sql).not.toContain("'couple_provider_daily'::text");
      expect(sql).not.toContain("'couple_quota'::text");
    }

    expect(legacyReserve).toContain(
      "public.meter_amora_provider_usage_unlimited_v1(p_couple_id)"
    );
    expect(oldestReserve).toContain("FROM public.reserve_amora_usage(");
    expect(legacyCheck).toMatch(/RETURN QUERY SELECT\s+true,\s+NULL::text/);

    expect(v2Reserve).toContain("FROM public.amora_request_claims");
    expect(v2Reserve).toContain("FROM public.amora_usage_reservations");
    expect(v2Reserve).toContain("INSERT INTO public.amora_usage_reservations");
    expect(v2Reserve).toContain("v_existing.counted_user_turn <> p_count_user_turn");
    expect(v2Reserve).toContain(
      "CASE WHEN p_count_user_turn THEN 'pending' ELSE NULL END"
    );
    expect(v2Reserve).toContain("reused");

    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.reserve_amora_usage\(uuid, integer, integer, boolean\)\s+FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.reserve_amora_usage\(uuid, integer, integer, boolean\)\s+TO service_role;/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.reserve_amora_turn\(uuid, integer, integer\)\s+FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.reserve_amora_turn\(uuid, integer, integer\)\s+TO service_role;/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.reserve_amora_usage_v2\([\s\S]*?FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.reserve_amora_usage_v2\([\s\S]*?TO service_role;/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.check_amora_usage\(uuid, integer, integer, boolean\)\s+FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.check_amora_usage\(uuid, integer, integer, boolean\)\s+TO service_role;/
    );
  });
});
