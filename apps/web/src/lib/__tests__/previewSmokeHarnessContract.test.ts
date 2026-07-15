import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("preview-only smoke fixture boundary", () => {
  it("requires an expiring database-admin preview allowlist and exact request host", () => {
    const migration = read(
      "supabase/migrations/20260713123000_preview_smoke_fixture_harness.sql",
    );

    expect(migration).toContain("CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres");
    expect(migration).toContain("ALTER SCHEMA private OWNER TO postgres");
    expect(migration).toContain("CREATE TABLE private.preview_smoke_projects");
    expect(migration).toContain("enabled_until <= created_at + interval '24 hours'");
    expect(migration).toContain("REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("REVOKE ALL ON TABLE private.preview_smoke_projects");
    expect(migration).toContain("ALTER TABLE private.preview_smoke_projects OWNER TO postgres");
    expect(migration).toContain("ALTER TABLE private.preview_smoke_fixture_couples OWNER TO postgres");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION private.assert_preview_smoke_authorized");
    expect(migration).toContain("COALESCE(auth.role(), '') <> 'service_role'");
    expect(migration).toContain("current_setting('request.headers', true)");
    expect(migration).toContain("v_request_host <> p_project_ref || '.supabase.co'");
    expect(migration).toContain("enabled_until > clock_timestamp()");
    expect(migration).toContain("pg_catalog.has_any_column_privilege");
    expect(migration).toContain("pg_catalog.aclexplode(attribute_row.attacl)");
    expect(migration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[^;]*private\.preview_smoke_projects[^;]*service_role/i,
    );
  });

  it("keeps the database production denylist exact with release targets", () => {
    const migration = read(
      "supabase/migrations/20260713123000_preview_smoke_fixture_harness.sql",
    );
    const releaseTargets = JSON.parse(read("scripts/release-targets.json")) as {
      productionSupabaseProjectRefs: string[];
    };
    const constraint = migration.match(
      /CONSTRAINT preview_smoke_projects_production_ref_check\s+CHECK \(project_ref <> ALL \(ARRAY\[([\s\S]*?)\]::text\[\]\)\)/,
    );
    const sqlDenylist = [...(constraint?.[1] ?? "").matchAll(/'([a-z0-9]+)'/g)]
      .map((match) => match[1]);

    expect(sqlDenylist).toEqual(releaseTargets.productionSupabaseProjectRefs);
    for (const productionRef of releaseTargets.productionSupabaseProjectRefs) {
      expect(migration.split(`'${productionRef}'`).length - 1).toBeGreaterThanOrEqual(2);
    }
  });

  it("exposes only constrained fixture, evidence, and cleanup RPCs to service_role", () => {
    const migration = read(
      "supabase/migrations/20260713123000_preview_smoke_fixture_harness.sql",
    );

    for (const fn of [
      "assert_preview_smoke_ready",
      "prepare_preview_lifecycle_smoke_fixture",
      "inspect_preview_amora_smoke_turn",
      "cleanup_preview_smoke_fixture",
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${fn}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role;`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([\\s\\S]*?TO service_role;`),
      );
    }

    expect(migration).toContain("p_operation IN ('assert_blocked_invite', 'set_legacy_invite', 'create_zero_member')");
    expect(migration).toContain("@example.invalid");
    expect(migration).toContain("v_created_at < clock_timestamp() - interval '24 hours'");
    expect(migration).toContain("privilege escalation fixture is forbidden");
    expect(migration).toContain("ARRAY['search_path=\"\"', 'row_security=off']::text[]");
    expect(migration).toContain("LOCK TABLE private.preview_smoke_fixture_couples");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("profile.couple_id = ANY(v_couple_ids)");
    expect(migration).toContain("v_couples_deleted <> pg_catalog.cardinality(v_couple_ids)");
    for (const helper of [
      "private.assert_preview_smoke_authorized(text)",
      "private.assert_preview_smoke_user(uuid)",
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${helper}`);
    }
    expect(migration).toContain("DELETE FROM public.couples");
    expect(migration).toContain("DELETE FROM public.amora_request_claims");
  });

  it("keeps smoke scripts fail-closed and removes direct service table mutations", () => {
    const amora = read("scripts/amora-openai-smoke.mjs");
    const lifecycle = read("scripts/supabase-lifecycle-smoke.mjs");

    for (const script of [amora, lifecycle]) {
      expect(script).toContain("assertApprovedPreviewTarget");
      expect(script).toContain('rpc("assert_preview_smoke_ready"');
      expect(script).not.toContain("async function deleteWhere");
      expect(script).not.toMatch(
        /\/rest\/v1\/(?:profiles|couples|wedding_journeys|chat_messages|ai_interactions_log|amora_usage_reservations|amora_request_claims)[^`"']*[`"'][\s\S]{0,180}?method:\s*["'](?:POST|PATCH|DELETE)["']/,
      );
      expect(script).toContain('rpc("cleanup_preview_smoke_fixture"');
    }

    expect(amora).toContain('rpc("inspect_preview_amora_smoke_turn"');
    expect(lifecycle).toContain('rpc("prepare_preview_lifecycle_smoke_fixture"');
  });
});
