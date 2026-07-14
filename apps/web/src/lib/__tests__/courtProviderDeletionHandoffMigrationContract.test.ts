import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260714100000_preserve_court_provider_audit_on_graph_deletion.sql",
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

describe("Court provider deletion handoff migration", () => {
  it("keeps the handoff service-only, bounded, and free of subject or payload columns", () => {
    const table = between(
      "CREATE TABLE public.court_provider_deletion_handoffs (",
      "ALTER TABLE public.court_provider_deletion_handoffs ENABLE ROW LEVEL SECURITY;",
    );
    for (const forbidden of [
      "case_id",
      "user_id",
      "couple_id",
      "profile_id",
      "quota_scope_id",
      "input_hash",
      "request_hash",
      "prompt_version",
      "schema_version",
      "mode",
      "category",
      "tone",
      "safety_level",
      "safety_categories",
      "result_json",
      "missions_json",
      "statement",
      "title",
    ]) {
      expect(table).not.toMatch(new RegExp(`\\b${forbidden}\\b`, "u"));
    }
    expect(table).toContain("expires_at <= created_at + pg_catalog.make_interval(days => 90)");
    expect(table.match(/pg_catalog\.statement_timestamp\(\)/gu)).toHaveLength(2);
    expect(table).not.toContain("pg_catalog.clock_timestamp() + pg_catalog.make_interval(days => 90)");
    expect(table).toMatch(
      /handoff_state = 'audit_pending'[\s\S]{0,220}provider_input_tokens IS NOT NULL[\s\S]{0,100}provider_output_tokens IS NOT NULL/u,
    );
    expect(table).toMatch(
      /handoff_state = 'audited'[\s\S]{0,220}provider_input_tokens IS NOT NULL[\s\S]{0,100}provider_output_tokens IS NOT NULL/u,
    );
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.court_provider_deletion_handoffs\n  FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(migration).not.toContain(
      "GRANT SELECT ON TABLE public.court_provider_deletion_handoffs TO service_role;",
    );
  });

  it("detaches exact-once audit evidence from the cascading reservation", () => {
    expect(migration).toContain(
      "DROP CONSTRAINT court_provider_audit_logs_request_key_fkey;",
    );
    expect(migration).not.toContain("DROP CONSTRAINT court_provider_audit_logs_ai_interaction_id_fkey");
  });

  it("runs before the case cascade and refunds every unstarted reservation", () => {
    const trigger = between(
      "CREATE OR REPLACE FUNCTION public.handoff_court_provider_attempts_before_case_delete()",
      "ALTER FUNCTION public.handoff_court_provider_attempts_before_case_delete()",
    );
    expect(migration).toContain(
      "CREATE TRIGGER court_case_provider_handoff_before_delete\n  BEFORE DELETE ON public.court_cases",
    );
    expect(trigger).toContain("FOR UPDATE OF verdict, reservation");
    expect(trigger).toContain("ORDER BY verdict.id");
    expect(trigger).toContain("public.settle_court_provider_failure_internal(");
    expect(trigger).toContain("'case_deleted_before_provider_start'");
    expect(trigger).toContain("v_failure_state IS DISTINCT FROM 'failed_unstarted'");
    expect(trigger.indexOf("public.settle_court_provider_failure_internal(")).toBeLessThan(
      trigger.indexOf("INSERT INTO public.court_provider_deletion_handoffs"),
    );
  });

  it("copies only opaque attempt and payload-free paid usage into the handoff", () => {
    const trigger = between(
      "CREATE OR REPLACE FUNCTION public.handoff_court_provider_attempts_before_case_delete()",
      "ALTER FUNCTION public.handoff_court_provider_attempts_before_case_delete()",
    );
    expect(trigger).toContain("v_attempt.provider_state IN ('started', 'failed_unknown')");
    expect(trigger).toContain("v_attempt.provider_audit_state = 'pending'");
    expect(trigger).toContain("v_attempt.provider_audit_state = 'audited'");
    expect(trigger).not.toContain("staged_result_json");
    expect(trigger).not.toContain("staged_missions_json");
    expect(trigger).not.toContain("provider_high_risk_categories");
    expect(trigger).not.toContain("audit_user_id");
    expect(trigger).not.toContain("audit_couple_id");
    expect(trigger).toContain("SET user_id = NULL, couple_id = NULL");
    expect(trigger).toContain("'payload_redacted_at', v_handoff.created_at");
    expect(trigger).toContain("v_expected_state IN ('audit_pending', 'audited')");
    expect(trigger).toContain("v_audit.created_at + pg_catalog.make_interval(years => 1)");
    expect(trigger).toContain("DELETE FROM public.court_provider_audit_logs");
    expect(trigger).toContain("The retention job lawfully removed this already-complete audit");
  });

  it("settles deleted normal and high-risk responses without storing categories or recalling a provider", () => {
    const unstaged = between(
      "CREATE FUNCTION public.settle_court_unstaged_provider_result(",
      "ALTER FUNCTION public.settle_court_unstaged_provider_result(",
    );
    const highRisk = between(
      "CREATE FUNCTION public.settle_court_high_risk_provider_result(",
      "ALTER FUNCTION public.settle_court_high_risk_provider_result(",
    );
    expect(unstaged).toContain("'subject_deleted', true");
    expect(unstaged).toContain("handoff_state = 'audit_pending'");
    expect(unstaged).not.toContain("INSERT INTO public.court_verdicts");
    expect(highRisk).toContain("'safety_categories', pg_catalog.to_jsonb(p_categories)");
    expect(highRisk).not.toContain("SET safety_categories");
    expect(highRisk).not.toContain("provider_high_risk_categories");
    expect(migration).not.toMatch(/openai|responses\.create|chat\.completions/iu);
  });

  it("keeps an audited settlement replay reachable after finalization releases its lease", () => {
    const unstaged = between(
      "CREATE FUNCTION public.settle_court_unstaged_provider_result(",
      "ALTER FUNCTION public.settle_court_unstaged_provider_result(",
    );

    expect(unstaged).toContain(
      "IF NOT FOUND THEN\n    RAISE EXCEPTION 'court deleted-subject provider identity mismatch'",
    );
    expect(unstaged).toContain(
      "IF v_handoff.handoff_state IN ('provider_unknown', 'audit_pending')\n    AND v_handoff.lease_token IS DISTINCT FROM p_lease_token",
    );
    expect(unstaged).not.toContain(
      "IF NOT FOUND OR v_handoff.lease_token IS DISTINCT FROM p_lease_token",
    );
    expect(unstaged.indexOf("IF v_handoff.handoff_state IN ('audit_pending', 'audited')")).toBeGreaterThan(
      unstaged.indexOf("IF NOT FOUND THEN"),
    );
  });

  it("serializes every live-versus-deleted wrapper on the parent case lock", () => {
    for (const [start, end] of [
      [
        "CREATE FUNCTION public.settle_court_unstaged_provider_result(",
        "ALTER FUNCTION public.settle_court_unstaged_provider_result(",
      ],
      [
        "CREATE FUNCTION public.settle_court_high_risk_provider_result(",
        "ALTER FUNCTION public.settle_court_high_risk_provider_result(",
      ],
      [
        "CREATE FUNCTION public.write_court_provider_audit(",
        "ALTER FUNCTION public.write_court_provider_audit(text, jsonb, numeric)",
      ],
      [
        "CREATE FUNCTION public.finalize_court_provider_audit(",
        "ALTER FUNCTION public.finalize_court_provider_audit(uuid, text)",
      ],
    ] as const) {
      const wrapper = between(start, end);
      expect(wrapper).toContain("FOR UPDATE OF court_case");
      expect(wrapper).not.toMatch(/IF EXISTS\s*\(/u);
      expect(wrapper).toContain("'subject_deleted', false");
    }
    const highRisk = between(
      "CREATE FUNCTION public.settle_court_high_risk_provider_result(",
      "ALTER FUNCTION public.settle_court_high_risk_provider_result(",
    );
    expect(highRisk.indexOf("FROM public.profiles AS profile")).toBeLessThan(
      highRisk.indexOf("FROM public.court_cases AS court_case"),
    );
  });

  it("writes and finalizes an already-redacted audit with an exact metadata allowlist", () => {
    const writer = between(
      "CREATE FUNCTION public.write_court_provider_audit(",
      "ALTER FUNCTION public.write_court_provider_audit(text, jsonb, numeric)",
    );
    const finalizer = between(
      "CREATE FUNCTION public.finalize_court_provider_audit(",
      "ALTER FUNCTION public.finalize_court_provider_audit(uuid, text)",
    );
    expect(writer).toContain(
      "NULL, NULL, NULL, NULL, 'couple_court_verdict',\n    NULL, NULL, NULL, NULL, NULL, NULL",
    );
    for (const allowed of [
      "'source', 'couple_court_judge'",
      "'quota_class', 'provider_call'",
      "'request_usage'",
      "'account_deleted', true",
      "'payload_redacted_at'",
    ]) {
      expect(writer).toContain(allowed);
      expect(finalizer).toContain(allowed);
    }
    for (const forbidden of [
      "'mode'",
      "'category'",
      "'tone'",
      "'input_hash'",
      "'prompt_version'",
      "'schema_version'",
      "'safety_level'",
      "'safety_categories'",
    ]) {
      expect(writer).not.toContain(forbidden);
      expect(finalizer).not.toContain(forbidden);
    }
    expect(finalizer).toContain("SET user_id = NULL, couple_id = NULL");
    expect(finalizer).toContain("handoff_state = 'audited'");
    expect(finalizer).toContain("v_reused := v_handoff.handoff_state = 'audited'");
    expect(finalizer).toContain("'subject_deleted', true");
    expect(finalizer).not.toContain("'provider_state', 'failed_invalid'");
    expect(writer).toContain("v_audit.cost_usd IS DISTINCT FROM v_canonical_cost");
    expect(writer).toContain("court live provider audit cost evidence mismatch");
    expect(writer).toContain("IF v_handoff.handoff_state = 'audited' THEN");
    expect(writer).toContain("court_provider_audit_evidence_missing");
    // A live request may lose the case lock to deletion after building its
    // original identity. The deleted branch must ignore those subject fields
    // while still inserting a hard-coded NULL/redacted row.
    for (const subjectField of ["user_id", "couple_id", "session_id", "message_id"]) {
      expect(writer).not.toContain(`p_audit_identity->>'${subjectField}' IS NOT NULL`);
    }
    expect(writer).toContain("v_audit.metadata IS DISTINCT FROM v_metadata");
    expect(writer).toContain("'payload_redacted_at', v_handoff.created_at");
    expect(finalizer).toContain("'payload_redacted_at', v_handoff.created_at");
    expect(writer).toContain("handoff.expires_at > pg_catalog.clock_timestamp()");
    expect(finalizer).toContain("handoff.expires_at > pg_catalog.clock_timestamp()");
  });

  it("canonicalizes every provider audit cost to the ledger's numeric(10,6) domain", () => {
    const writer = between(
      "CREATE FUNCTION public.write_court_provider_audit(",
      "ALTER FUNCTION public.write_court_provider_audit(text, jsonb, numeric)",
    );

    expect(migration).toContain("audit_cost_usd numeric(10,6) CHECK (");
    expect(migration).toContain(
      "audit_cost_usd >= 0 AND audit_cost_usd <= 9999.999999",
    );
    expect(writer).toContain("v_canonical_cost numeric(10,6);");
    expect(writer).toContain("p_cost_usd > 9999.999999");
    expect(writer).toContain(
      "v_canonical_cost := pg_catalog.round(p_cost_usd, 6)::numeric(10,6);",
    );
    expect(writer).toContain(
      "p_request_key, p_audit_identity, v_canonical_cost",
    );
    expect(writer).toContain("v_audit.cost_usd IS DISTINCT FROM v_canonical_cost");
    expect(writer).toContain("v_handoff.audit_cost_usd IS DISTINCT FROM v_canonical_cost");
    expect(writer).toContain("v_canonical_cost, v_metadata");
    expect(writer).toContain("SET audit_cost_usd = v_canonical_cost");
    expect(writer).not.toContain("IS DISTINCT FROM p_cost_usd");
    expect(writer).not.toContain("SET audit_cost_usd = p_cost_usd");
  });

  it("uses an owner-only refund core for JWT-less cascading deletion", () => {
    const core = between(
      "CREATE FUNCTION public.settle_court_provider_failure_internal(",
      "ALTER FUNCTION public.settle_court_provider_failure_internal(uuid, text)",
    );
    const wrapper = between(
      "CREATE OR REPLACE FUNCTION public.settle_court_provider_failure(\n",
      "ALTER FUNCTION public.settle_court_provider_failure(uuid, text)",
    );
    const trigger = between(
      "CREATE OR REPLACE FUNCTION public.handoff_court_provider_attempts_before_case_delete()",
      "ALTER FUNCTION public.handoff_court_provider_attempts_before_case_delete()",
    );
    expect(core).not.toContain("auth.role()");
    expect(core).toContain("provider_state = 'failed_unstarted'");
    expect(wrapper).toContain("COALESCE(auth.role(), '') <> 'service_role'");
    expect(wrapper).toContain("public.settle_court_provider_failure_internal(");
    expect(trigger).toContain("public.settle_court_provider_failure_internal(");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.settle_court_provider_failure_internal(uuid, text)\n  FROM PUBLIC, anon, authenticated, service_role;",
    );
  });
});
