import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260714103000_audit_court_provider_handoff_reveals.sql",
  ),
  "utf8",
).replace(/\r/gu, "");

function between(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing ${end}`).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

describe("Court provider request-key reveal audit migration", () => {
  it("creates an append-only, payload-free, one-year audit ledger", () => {
    const table = between(
      "CREATE TABLE public.court_provider_request_key_reveal_audits (",
      "CREATE INDEX court_provider_request_key_reveal_audits_target_idx",
    );

    expect(table).toContain("target_scope text NOT NULL");
    expect(table).toContain("target_scope IN ('live_reservation', 'deleted_handoff')");
    expect(table).toContain("target_id uuid NOT NULL");
    expect(table).toContain(
      "actor_admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL",
    );
    expect(table).toContain("action text NOT NULL CHECK (action = 'request_key_revealed')");
    expect(table).toContain("pg_catalog.make_interval(years => 1)");
    expect(table).not.toMatch(/\n\s+request_key\s+(text|uuid|jsonb)/);
    for (const forbiddenColumn of [
      "case_id",
      "subject_id",
      "user_input",
      "payload",
      "model",
      "tokens",
      "cost_usd",
      "free_text",
    ]) {
      expect(table).not.toContain(forbiddenColumn);
    }

    expect(migration).toContain(
      "ALTER TABLE public.court_provider_request_key_reveal_audits ENABLE ROW LEVEL SECURITY;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.court_provider_request_key_reveal_audits\n  FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.court_provider_request_key_reveal_audits TO service_role;",
    );
    expect(migration).not.toMatch(
      /GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]*court_provider_request_key_reveal_audits/i,
    );
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.court_provider_deletion_handoffs FROM service_role;",
    );
  });

  it("lists only minimal actionable identities after active-admin validation", () => {
    const deletedList = between(
      "CREATE FUNCTION public.list_court_provider_deletion_handoffs(",
      "ALTER FUNCTION public.list_court_provider_deletion_handoffs(uuid, integer)",
    );
    const liveList = between(
      "CREATE FUNCTION public.list_court_provider_reconciliations(",
      "ALTER FUNCTION public.list_court_provider_reconciliations(uuid, integer)",
    );

    for (const list of [deletedList, liveList]) {
      expect(list).toContain("COALESCE(auth.role(), '') <> 'service_role'");
      expect(list).toContain("profile.account_deleting_at IS NULL");
      expect(list).toContain("profile.is_admin = true");
      expect(list).toContain("FOR SHARE;");
      expect(list).toContain("SET search_path = pg_catalog, pg_temp");
      expect(list).not.toContain("request_key");
      expect(list).not.toContain("case_id");
      expect(list).not.toContain("audit_user_id");
      expect(list).not.toContain("staged_result_json");
    }
    expect(deletedList).toContain("handoff.handoff_state = 'provider_unknown'");
    expect(deletedList).toContain("handoff.expires_at > pg_catalog.clock_timestamp()");
    expect(liveList).toContain("reservation.provider_state = 'failed_unknown'");
    expect(liveList).toContain("IS DISTINCT FROM 'safety_escalation_failed'");
    expect(liveList).toContain("reservation.provider_state = 'failed_invalid'");
    expect(liveList).toContain("reservation.provider_error_code = 'provider_result_unstaged'");
    expect(liveList).toContain("reservation.provider_audit_state = 'audited'");

    for (const signature of [
      "public.list_court_provider_deletion_handoffs(uuid, integer)",
      "public.list_court_provider_reconciliations(uuid, integer)",
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon, authenticated;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature}\n  TO service_role;`,
      );
    }
  });

  it("reveals one live or deleted key only after atomically appending an audit", () => {
    const deletedReveal = between(
      "CREATE FUNCTION public.reveal_court_provider_deletion_handoff_request_key(",
      "ALTER FUNCTION public.reveal_court_provider_deletion_handoff_request_key(",
    );
    const liveReveal = between(
      "CREATE FUNCTION public.reveal_court_provider_reconciliation_request_key(",
      "ALTER FUNCTION public.reveal_court_provider_reconciliation_request_key(",
    );

    for (const reveal of [deletedReveal, liveReveal]) {
      expect(reveal).toContain("COALESCE(auth.role(), '') <> 'service_role'");
      expect(reveal).toContain("p_confirmation IS DISTINCT FROM 'REVEAL_PROVIDER_REQUEST_KEY'");
      expect(reveal).toContain("profile.account_deleting_at IS NULL");
      expect(reveal).toContain("profile.is_admin = true");
      expect(reveal).toContain("FOR UPDATE;");
      expect(reveal).toContain(
        "INSERT INTO public.court_provider_request_key_reveal_audits (",
      );
      expect(reveal.indexOf(
        "INSERT INTO public.court_provider_request_key_reveal_audits (",
      )).toBeLessThan(reveal.indexOf("RETURN pg_catalog.jsonb_build_object("));
      const auditInsert = betweenWithin(
        reveal,
        "INSERT INTO public.court_provider_request_key_reveal_audits (",
        ")\n  RETURNING revealed_at INTO v_revealed_at;",
      );
      expect(auditInsert).not.toMatch(/\n\s+request_key\s*,/);
      expect(auditInsert).not.toContain("v_handoff.request_key");
      expect(auditInsert).not.toContain("v_reservation.request_key");
      expect(auditInsert).not.toContain("case_id");
      expect(reveal).toContain("'request_key'");
      expect(reveal).toContain("'revealed_at'");
      expect(reveal).not.toContain("'case_id'");
      expect(reveal).not.toContain("'audit_id'");
    }
    expect(deletedReveal).toContain("'deleted_handoff'");
    expect(liveReveal).toContain("'live_reservation'");
    expect(liveReveal).toContain("IS DISTINCT FROM 'safety_escalation_failed'");

    for (const signature of [
      "public.reveal_court_provider_deletion_handoff_request_key(\n  uuid, uuid, text\n)",
      "public.reveal_court_provider_reconciliation_request_key(\n  uuid, uuid, text\n)",
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`,
      );
    }
  });

  it("deletes expired audit rows in bounded batches on an hourly cron", () => {
    const retention = between(
      "CREATE FUNCTION public.enforce_court_provider_request_key_reveal_audit_retention(",
      "ALTER FUNCTION public.enforce_court_provider_request_key_reveal_audit_retention(integer)",
    );

    expect(retention).toContain("p_batch_size NOT BETWEEN 1 AND 10000");
    expect(retention).toContain(
      "PERFORM pg_catalog.pg_advisory_xact_lock(20260714103000::bigint);",
    );
    expect(retention).toContain("FOR UPDATE OF audit SKIP LOCKED");
    expect(retention).toContain(
      "DELETE FROM public.court_provider_request_key_reveal_audits AS audit",
    );
    expect(migration).toContain(
      "'enforce-court-provider-request-key-reveal-audit-retention',\n    '37 * * * *',\n    'SELECT public.enforce_court_provider_request_key_reveal_audit_retention(1000);'",
    );
  });
});

function betweenWithin(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing ${end}`).toBeGreaterThan(startIndex);
  return value.slice(startIndex, endIndex);
}
