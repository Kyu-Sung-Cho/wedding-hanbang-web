import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260714102000_operationalize_court_provider_deletion_handoffs.sql",
  ),
  "utf8",
);

function between(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing ${end}`).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

describe("Court provider deletion handoff operations migration", () => {
  it("wraps the live recovery claim with a service-only deleted-subject queue", () => {
    const claim = between(
      "CREATE FUNCTION public.claim_court_provider_audit_recovery(",
      "ALTER FUNCTION public.claim_court_provider_audit_recovery(uuid, integer)",
    );

    expect(migration).toContain(
      "RENAME TO claim_court_provider_audit_recovery_live;",
    );
    expect(claim).toContain("handoff.handoff_state = 'audit_pending'");
    expect(claim).toContain("FOR UPDATE OF handoff SKIP LOCKED");
    expect(claim).toContain("'subject_deleted', true");
    expect(claim).toContain("'request_key', v_handoff.request_key");
    expect(claim).toContain("'audit_cost_usd', v_handoff.audit_cost_usd");
    for (const fabricatedField of [
      "'audit_preflight_safety_level'",
      "'input_hash'",
      "'mode'",
      "'category'",
      "'tone'",
      "'prompt_version'",
      "'schema_version'",
    ]) {
      expect(claim).not.toContain(fabricatedField);
    }
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.claim_court_provider_audit_recovery(uuid, integer)\n  TO service_role;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.claim_court_provider_audit_recovery(uuid, integer)\n  FROM PUBLIC, anon, authenticated;",
    );
  });

  it("records recovery failures on either side of the deletion fence", () => {
    const failure = between(
      "CREATE FUNCTION public.record_court_provider_audit_recovery_failure(",
      "ALTER FUNCTION public.record_court_provider_audit_recovery_failure(\n  uuid, uuid, uuid, text\n)",
    );

    expect(migration).toContain(
      "RENAME TO record_court_provider_audit_recovery_failure_live;",
    );
    expect(failure.indexOf("FROM public.profiles AS profile")).toBeLessThan(
      failure.indexOf("FROM public.court_cases AS court_case"),
    );
    expect(failure).toContain("FOR UPDATE OF court_case");
    expect(failure).toContain(
      "public.record_court_provider_audit_recovery_failure_live(",
    );
    expect(failure).toContain(
      "handoff.recovery_lease_token IS DISTINCT FROM p_recovery_lease_token",
    );
    expect(failure).toContain(
      "handoff.recovery_lease_expires_at <= pg_catalog.clock_timestamp()",
    );
    expect(failure).toContain("recovery_last_error_code = p_error_code");
    expect(failure).toContain("'subject_deleted', true");
    expect(failure).not.toContain("'request_key'");
  });

  it("lets an active admin resolve an unknown deleted-subject charge exactly once", () => {
    const resolution = between(
      "CREATE FUNCTION public.resolve_court_provider_deletion_handoff(",
      "ALTER FUNCTION public.resolve_court_provider_deletion_handoff(\n",
    );

    expect(migration).toContain(
      "ADD CONSTRAINT court_provider_deletion_handoffs_verdict_id_key UNIQUE (verdict_id)",
    );
    expect(resolution).toContain("profile.account_deleting_at IS NULL");
    expect(resolution).toContain("profile.is_admin = true");
    expect(resolution).toContain("FOR UPDATE;");
    expect(resolution).toContain("p_action = 'confirm_no_charge'");
    expect(resolution).toContain("p_action = 'record_paid'");
    expect(resolution).toContain("OR p_input_tokens IS NULL");
    expect(resolution).toContain("OR p_output_tokens IS NULL");
    expect(resolution).toContain(
      "COALESCE(p_cached_input_tokens, 0) NOT BETWEEN 0 AND p_input_tokens",
    );
    expect(resolution).not.toContain(
      "(p_input_tokens IS NULL) <> (p_output_tokens IS NULL)",
    );
    expect(resolution).toContain("CONFIRM_PROVIDER_NO_CHARGE");
    expect(resolution).toContain("CONFIRM_PROVIDER_PAID");
    expect(resolution).toContain("handoff_state = 'provider_unknown'");
    expect(resolution).toContain("provider_resolution_action = p_action");
    expect(migration).toContain("provider_reported_cost_usd numeric(10,6)");
    expect(migration).toContain(
      "provider_resolution_action = 'confirm_no_charge'\n      AND handoff_state = 'resolved_no_charge'",
    );
    expect(migration).toContain(
      "provider_resolution_action = 'record_paid'\n      AND handoff_state IN ('audit_pending', 'audited')",
    );
    expect(migration).toContain(
      "AND audit_model IS NOT NULL\n      AND provider_input_tokens IS NOT NULL\n      AND provider_output_tokens IS NOT NULL",
    );
    expect(resolution).toContain("v_canonical_cost numeric(10,6);");
    expect(resolution).toContain("p_cost_usd > 9999.999999");
    expect(resolution).toContain(
      "v_canonical_cost := pg_catalog.round(p_cost_usd, 6)::numeric(10,6);",
    );
    expect(resolution).toContain(
      "v_handoff.provider_reported_cost_usd IS DISTINCT FROM v_canonical_cost",
    );
    expect(resolution).toContain("audit_cost_usd = v_canonical_cost");
    expect(resolution).toContain("provider_reported_cost_usd = v_canonical_cost");
    expect(resolution).not.toContain(
      "v_handoff.provider_reported_cost_usd IS DISTINCT FROM p_cost_usd",
    );
    expect(resolution).toContain("'reused', true");
    expect(resolution).not.toContain("'request_key'");
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.resolve_court_provider_deletion_handoff(\n",
    );
  });

  it("purges due handoffs while preserving only aggregate daily evidence", () => {
    const metricsTable = between(
      "CREATE TABLE public.court_provider_deletion_handoff_metrics (",
      "ALTER TABLE public.court_provider_deletion_handoff_metrics ENABLE ROW LEVEL SECURITY;",
    );
    const retention = between(
      "CREATE FUNCTION public.enforce_court_provider_deletion_handoff_retention(",
      "ALTER FUNCTION public.enforce_court_provider_deletion_handoff_retention(integer)",
    );

    expect(metricsTable).toContain("metric_day date NOT NULL");
    expect(metricsTable).toContain("metric_code text NOT NULL");
    expect(metricsTable).toContain("event_count bigint NOT NULL");
    for (const identifier of [
      "request_key",
      "verdict_id",
      "user_id",
      "couple_id",
      "case_id",
      "uuid",
    ]) {
      expect(metricsTable).not.toContain(identifier);
    }
    expect(retention).toContain("handoff.expires_at <= pg_catalog.clock_timestamp()");
    expect(retention).toContain("pg_catalog.make_interval(days => 90)");
    expect(retention).toContain("pg_catalog.make_interval(years => 1)");
    expect(retention).toContain("FOR UPDATE OF handoff SKIP LOCKED");
    expect(retention).toContain(
      "PERFORM pg_catalog.pg_advisory_xact_lock(20260714102000::bigint);",
    );
    expect(retention.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      retention.indexOf("FOR v_handoff IN"),
    );
    expect(retention.indexOf("FOR UPDATE OF handoff SKIP LOCKED")).toBeLessThan(
      retention.indexOf("FOR UPDATE OF audit_link, interaction"),
    );
    expect(retention).toContain("UPDATE public.ai_interactions_log");
    expect(retention).toContain("DELETE FROM public.court_provider_audit_logs");
    expect(retention).toContain("DELETE FROM public.court_provider_deletion_handoffs");
    expect(retention).toContain("INSERT INTO public.court_provider_deletion_handoff_metrics");
    expect(retention).toContain("ON CONFLICT (metric_day, metric_code) DO UPDATE");
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.court_provider_deletion_handoff_metrics\n  FROM PUBLIC, anon, authenticated;",
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.court_provider_deletion_handoff_metrics TO service_role;",
    );
  });

  it("fences generic AI retention and schedules hourly handoff cleanup", () => {
    const aiRetention = between(
      "CREATE FUNCTION public.enforce_ai_interaction_retention()",
      "ALTER FUNCTION public.enforce_ai_interaction_retention() OWNER TO postgres;",
    );

    expect(migration).toContain(
      "RENAME TO enforce_ai_interaction_retention_live;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.redact_old_ai_interactions(interval)\n  FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(aiRetention.indexOf(
      "public.enforce_court_provider_deletion_handoff_retention(10000)",
    )).toBeLessThan(aiRetention.indexOf(
      "public.enforce_ai_interaction_retention_live()",
    ));
    expect(aiRetention).toContain("court_provider_audit_logs AS audit_link");
    expect(aiRetention).toContain("court_provider_deletion_handoffs AS handoff");
    expect(aiRetention).toContain("pg_catalog.make_interval(days => 90)");
    expect(aiRetention).toContain("v_handoff_deleted");
    expect(aiRetention).toContain("live_result.deleted + v_handoff_deleted");
    expect(aiRetention).toContain(
      "RAISE EXCEPTION 'court provider deletion handoff retention fence is incomplete'",
    );
    expect(migration).toContain(
      "'enforce-court-provider-deletion-handoff-retention',\n    '7 * * * *',\n    'SELECT public.enforce_court_provider_deletion_handoff_retention(1000);'",
    );
  });
});
