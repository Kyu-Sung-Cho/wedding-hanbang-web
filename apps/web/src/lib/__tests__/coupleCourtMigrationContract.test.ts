import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260713110000_create_couple_court.sql",
  ),
  "utf8",
);

function between(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing end marker: ${end}`).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

describe("Couple Court migration contract", () => {
  it("owns one bounded transaction and never mutates a remote database itself", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(migration).toContain("SET LOCAL lock_timeout = '5s';");
    expect(migration).toContain("SET LOCAL statement_timeout = '120s';");
    expect(migration).not.toMatch(/supabase\s+db\s+(?:push|reset)|psql\s/i);
  });

  it("creates the normalized private and public relations", () => {
    for (const table of [
      "court_cases",
      "court_participants",
      "court_invites",
      "court_statements",
      "court_verdicts",
      "court_provider_reservations",
      "court_missions",
      "court_mission_completions",
      "court_followups",
      "court_case_events",
      "court_public_posts",
      "court_public_consents",
      "court_votes",
      "court_comments",
      "court_reports",
    ]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("keeps workflow, safety, and publication as orthogonal state axes", () => {
    const cases = between(
      "CREATE TABLE public.court_cases",
      "CREATE TABLE public.court_participants",
    );
    expect(cases).toContain("workflow_status text");
    expect(cases).toContain("safety_level text");
    expect(cases).toContain("safety_review_status text");
    expect(cases).not.toContain("public_review");
    expect(cases).not.toContain("public_published");
    expect(cases).not.toContain("flagged");

    const publicPosts = between(
      "CREATE TABLE public.court_public_posts",
      "CREATE UNIQUE INDEX court_public_posts_one_active_per_case",
    );
    for (const status of [
      "awaiting_consents",
      "pending_review",
      "published",
      "hidden",
      "rejected",
    ]) {
      expect(publicPosts).toContain(`'${status}'`);
    }
  });

  it("uses the final product enums and preserves development mock isolation", () => {
    for (const category of [
      "budget",
      "planning_roles",
      "venue",
      "studio_dress_makeup",
      "family",
      "guests_invitations",
      "honeymoon",
      "home_setup",
      "communication",
      "formalwear_shooting",
      "ceremony_events",
      "other",
    ]) {
      expect(migration).toContain(`'${category}'`);
    }
    for (const retired of [
      "guest_scale",
      "venue_date",
      "styling",
      "gifts_dowry",
      "housing",
      "social_time",
      "married_life",
    ]) {
      expect(migration).not.toContain(`'${retired}'`);
    }
    expect(migration).toContain("'gpt-5.6-terra'");
    expect(migration).toContain("'couple-court-development-mock-v1'");
    expect(migration).toContain("'couple_court_verdict'");
  });

  it("provides a bounded exactly-once key for successful AI audit writes", () => {
    expect(migration).toContain(
      "ALTER TABLE public.ai_interactions_log\n  ADD COLUMN idempotency_key text",
    );
    expect(migration).toContain("ai_interactions_log_idempotency_key_check");
    expect(migration).toContain("idempotency_key ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("ai_interactions_log_idempotency_key_unique");
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX ai_interactions_log_idempotency_key_unique\s+ON public\.ai_interactions_log\(idempotency_key\)\s+WHERE idempotency_key IS NOT NULL;/,
    );
  });

  it("keeps base case and participant identity rows behind the service boundary", () => {
    const participants = between(
      "CREATE TABLE public.court_participants",
      "CREATE TABLE public.court_invites",
    );
    expect(participants).toContain("UNIQUE (id, case_id)");
    expect(participants).toContain("court_participants_one_active_role");
    expect(participants).toContain("court_participants_one_active_user");
    expect(participants).toContain("WHERE participation_status = 'active'");
    expect(participants).not.toContain("UNIQUE (case_id, role)");
    expect(participants).not.toContain("UNIQUE (case_id, user_id)");

    const participantHelper = between(
      "CREATE OR REPLACE FUNCTION public.is_court_participant",
      "CREATE OR REPLACE FUNCTION public.is_court_statement_owner",
    );
    expect(participantHelper).toContain("participant.user_id = auth.uid()");
    expect(participantHelper).toContain("participant.participation_status = 'active'");
    expect(participantHelper).not.toContain("couple_id");

    expect(migration).not.toContain(
      "GRANT SELECT ON TABLE public.court_cases TO authenticated",
    );
    expect(migration).not.toContain(
      "GRANT SELECT ON TABLE public.court_participants TO authenticated",
    );
    expect(migration).not.toContain("CREATE POLICY court_cases_participant_select");
    expect(migration).not.toContain("CREATE POLICY court_participants_case_select");
    expect(migration).toMatch(
      /CREATE POLICY court_statements_owner_select[\s\S]*?public\.is_court_statement_owner\(case_id, participant_id\)/,
    );
    expect(migration).not.toMatch(
      /CREATE POLICY court_[\s\S]{0,300}is_couple_member/,
    );
  });

  it("keeps submitted statements immutable and private to their author", () => {
    expect(migration).toContain("CREATE TRIGGER court_statements_are_immutable");
    expect(migration).toContain("submitted court statements are immutable");
    expect(migration).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT SELECT ON TABLE public.court_statements TO authenticated");
    expect(migration).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE)[^;]*court_statements[^;]*authenticated/i);

    const submit = between(
      "CREATE OR REPLACE FUNCTION public.submit_court_statement",
      "CREATE OR REPLACE FUNCTION public.issue_court_invite",
    );
    expect(submit).toContain(
      "v_case.workflow_status NOT IN ('verdict_ready', 'mission_active', 'resolved')",
    );
    expect(submit).toContain("verdict.generation_status = 'ready'");
    expect(submit).toContain("court_statement_locked");
    expect(migration).toContain("submitted_safety_level text NOT NULL");
    expect(migration).toContain("submitted_safety_categories text[] NOT NULL");
    const statementTable = between(
      "CREATE TABLE public.court_statements",
      "CREATE TABLE public.court_verdicts",
    );
    const participantTable = between(
      "CREATE TABLE public.court_participants",
      "CREATE TABLE public.court_invites",
    );
    expect(statementTable).toContain("submission_request_id uuid NOT NULL");
    expect(statementTable).toContain("UNIQUE (participant_id, submission_request_id)");
    expect(participantTable).not.toContain("submission_request_id");
    expect(submit).toContain("p_submission_request_id uuid");
    expect(submit).toContain("v_request_statement public.court_statements%ROWTYPE");
    expect(submit).toContain(
      "statement.submission_request_id = p_submission_request_id",
    );
    expect(submit).toContain("ORDER BY statement.revision DESC");
    expect(submit).toContain(
      "v_request_statement.submitted_safety_level IS DISTINCT FROM p_safety_level",
    );
    expect(submit).toContain(
      "IS DISTINCT FROM v_submitted_safety_categories",
    );
    expect(submit).toContain("court_statement_submission_request_mismatch");
    expect(submit).toContain("'statement_id', v_request_statement.id");
    expect(submit).toContain("'reused', true");
    expect(submit).toContain("'reused', false");
    expect(submit.indexOf("'reused', true")).toBeLessThan(
      submit.indexOf("court_statement_locked"),
    );
  });

  it("uses durable request IDs for lossless case creation and statement retries", () => {
    const cases = between(
      "CREATE TABLE public.court_cases",
      "CREATE TABLE public.court_participants",
    );
    expect(cases).toContain("creation_request_id uuid NOT NULL");
    expect(cases).toContain("UNIQUE (creator_user_id, creation_request_id)");

    const createCase = between(
      "CREATE OR REPLACE FUNCTION public.create_court_case_with_applicant",
      "CREATE OR REPLACE FUNCTION public.submit_court_statement",
    );
    expect(createCase).toContain("p_creation_request_id uuid");
    expect(createCase).toContain(
      "court_case.creation_request_id = p_creation_request_id",
    );
    expect(createCase).toContain("v_existing_case.origin_mode IS DISTINCT FROM p_mode");
    expect(createCase).toContain("court_case_creation_request_mismatch");
    expect(createCase).toContain("'reused', true");
    expect(createCase).toContain("'reused', false");
  });

  it("stores only a bounded one-use invite hash and claims it atomically", () => {
    const invites = between(
      "CREATE TABLE public.court_invites",
      "CREATE UNIQUE INDEX court_invites_one_open_per_case",
    );
    expect(invites).toContain("token_hash text NOT NULL UNIQUE");
    expect(invites).toContain("token_hash ~ '^[a-f0-9]{64}$'");
    expect(invites).not.toMatch(/\btoken\s+text\b/);
    expect(invites).toContain("expires_at <= created_at + interval '7 days'");
    expect(invites).toContain("rejected_at timestamptz");
    expect(invites).toContain("rejected_by_user_id uuid");
    expect(invites).toContain("OR consumed_at IS NOT NULL");
    expect(invites).toContain("rejected_at IS NOT NULL OR rejected_by_user_id IS NULL");
    expect(invites).toContain("+ (rejected_at IS NOT NULL)::integer <= 1");
    expect(migration).toContain(
      "WHERE consumed_at IS NULL AND revoked_at IS NULL AND rejected_at IS NULL",
    );
    const inviteRevocations = [
      ...migration.matchAll(
        /UPDATE public\.court_invites(?: AS \w+)?\s+SET revoked_at[\s\S]*?;/g,
      ),
    ];
    expect(inviteRevocations.length).toBeGreaterThan(0);
    for (const revocation of inviteRevocations) {
      expect(revocation[0]).toContain("rejected_at IS NULL");
    }

    const accept = between(
      "CREATE OR REPLACE FUNCTION public.accept_court_invite",
      "CREATE OR REPLACE FUNCTION public.leave_court_case",
    );
    expect(accept).toContain("FOR UPDATE");
    expect(accept).toContain("consumed_at IS NOT NULL");
    expect(accept).toContain("revoked_at IS NOT NULL");
    expect(accept).toContain("rejected_at IS NOT NULL");
    expect(accept).toContain("expires_at <= pg_catalog.clock_timestamp()");
    expect(accept).toContain("v_applicant_user_id = p_user_id");
    expect(accept).toContain("court_invite_expired");
    expect(accept).toContain("court_invite_used");
    expect(accept).toContain("court_invite_revoked");
    expect(accept).toContain("court_invite_rejected");
    expect(accept).toContain("court_invite_couple_mismatch");
    expect(accept).toContain("v_applicant_couple_id IS DISTINCT FROM v_case.couple_id");
    expect(accept).toContain("v_invitee_couple_id IS DISTINCT FROM v_case.couple_id");
    expect(accept).toContain("v_invite.consumed_by_user_id = p_user_id");
    expect(accept).toContain("'reused', true");
    expect(accept).toContain("participation_status = 'active'");
    expect(accept).toContain("INSERT INTO public.court_participants");
    expect(accept).not.toContain("SET user_id = p_user_id");
    expect(accept).toContain("ORDER BY profile.id");
    expect(accept).toContain("FOR UPDATE");

    const cancel = between(
      "CREATE OR REPLACE FUNCTION public.cancel_court_invite",
      "CREATE OR REPLACE FUNCTION public.reject_court_invite",
    );
    expect(cancel).toContain("v_case.creator_user_id IS DISTINCT FROM p_user_id");
    expect(cancel).toContain("participant.role = 'applicant'");
    expect(cancel).toContain("invite.consumed_at IS NULL");
    expect(cancel).toContain("invite.revoked_at IS NULL");
    expect(cancel).toContain("invite.rejected_at IS NULL");
    expect(cancel).toContain("'invite_revoked'");

    const reject = between(
      "CREATE OR REPLACE FUNCTION public.reject_court_invite",
      "CREATE OR REPLACE FUNCTION public.accept_court_invite",
    );
    expect(reject).toContain("FOR UPDATE");
    expect(reject).toContain("court_invite_used");
    expect(reject).toContain("court_invite_revoked");
    expect(reject).toContain("court_invite_rejected");
    expect(reject).toContain("v_invite.rejected_by_user_id = p_user_id");
    expect(reject).toContain("'reused', true");
    expect(reject).toContain("court_invite_expired");
    expect(reject).toContain("court applicant cannot reject their own invite");
    expect(reject).toContain("court_invite_couple_mismatch");
    expect(reject).toContain("SET rejected_at = v_rejected_at");
    expect(reject).toContain("rejected_by_user_id = p_user_id");
    expect(reject).toContain("'invite_rejected'");
    expect(reject).toContain("'to_status', v_case.workflow_status");
    expect(reject).not.toContain("UPDATE public.court_cases");
  });

  it("supports a safe solo provisional verdict to couple mediation transition", () => {
    const issue = between(
      "CREATE OR REPLACE FUNCTION public.issue_court_invite",
      "CREATE OR REPLACE FUNCTION public.cancel_court_invite",
    );
    expect(issue).toContain("v_case.mode = 'solo'");
    expect(issue).toContain("v_case.workflow_status IN ('verdict_ready', 'mission_active', 'resolved')");
    expect(issue).toContain("a provisional verdict is required before inviting a partner");
    expect(issue).not.toContain("SET mode = 'couple'");
    expect(issue).not.toMatch(
      /UPDATE public\.court_cases[\s\S]*?SET[\s\S]{0,120}workflow_status = 'awaiting_partner'/,
    );
    expect(issue).toContain("'to_status', v_case.workflow_status");
    expect(issue).not.toMatch(/DELETE FROM public\.court_verdicts/);

    const accept = between(
      "CREATE OR REPLACE FUNCTION public.accept_court_invite",
      "CREATE OR REPLACE FUNCTION public.leave_court_case",
    );
    expect(accept).toContain("SET generation_status = 'superseded'");
    expect(accept).toContain("solo_provisional_verdict_id = v_provisional_verdict_id");
    expect(accept).toContain("mode = 'couple'");
    expect(accept).toContain("workflow_status = 'awaiting_partner_statement'");

    const submit = between(
      "CREATE OR REPLACE FUNCTION public.submit_court_statement",
      "CREATE OR REPLACE FUNCTION public.issue_court_invite",
    );
    expect(submit).toContain("IF v_has_previous OR v_participant.role = 'partner' THEN");
    expect(submit).toContain("SET generation_status = 'superseded'");
    expect(submit).toContain("superseded_at = pg_catalog.clock_timestamp()");
    expect(submit).not.toMatch(/DELETE FROM public\.court_verdicts AS verdict/);

    const leave = between(
      "CREATE OR REPLACE FUNCTION public.leave_court_case",
      "CREATE OR REPLACE FUNCTION public.mark_court_case_safety",
    );
    expect(leave).toContain("participant.role = 'partner'");
    expect(leave).toContain("court_partner_leave_locked");
    expect(leave).toContain("statement.participant_id = v_partner.id");
    expect(leave).toContain("SET generation_status = 'ready'");
    expect(leave).toContain("participation_status = 'left'");
    expect(leave).toContain("mode = v_next_mode");
    expect(leave).toContain("workflow_status = v_next_status");
    expect(leave).toContain("participant.participation_status = 'left'");
    expect(leave).toContain("'reused', true");
  });

  it("claims, completes, and fails verdict generation with a lease and unique content identity", () => {
    const verdicts = between(
      "CREATE TABLE public.court_verdicts",
      "CREATE TABLE public.court_missions",
    );
    expect(verdicts).toContain("generation_version integer NOT NULL");
    expect(verdicts).toContain("UNIQUE (case_id, generation_version)");
    expect(verdicts).toContain("court_verdicts_active_content_unique");
    expect(verdicts).toContain("WHERE generation_status IN ('in_progress', 'ready')");
    expect(verdicts).toContain("court_verdicts_one_ready_per_case");
    expect(verdicts).toContain("lease_expires_at timestamptz");
    expect(verdicts).toContain("lease_token uuid");
    expect(verdicts).toContain("terminal_lease_token uuid");
    expect(verdicts).toContain(
      "generation_status IN ('in_progress', 'ready', 'failed', 'superseded')",
    );
    expect(verdicts).toContain("superseded_at timestamptz");

    const claim = between(
      "CREATE OR REPLACE FUNCTION public.claim_court_verdict",
      "CREATE OR REPLACE FUNCTION public.complete_court_verdict",
    );
    expect(claim).toContain("FOR UPDATE");
    expect(claim).toContain("'claim_status', 'replay'");
    expect(claim).toContain("'claim_status', 'in_progress'");
    expect(claim).toContain("'claim_status', 'staged'");
    expect(claim).toContain("'request_key', v_provider_reservation.request_key");
    expect(claim).toContain("'audit_user_id', v_provider_reservation.audit_user_id");
    expect(claim).toContain(
      "'audit_couple_id', v_provider_reservation.audit_couple_id",
    );
    expect(claim).toContain(
      "v_provider_reservation.audit_preflight_safety_level",
    );
    expect(claim).toContain("'audit_model', v_provider_reservation.audit_model");
    expect(claim).toContain("'staged_at', v_provider_reservation.staged_at");
    expect(claim).toContain("'request_key', v_provider_reservation.request_key");
    expect(claim).toContain("'claim_status', 'execute'");
    expect(claim).toContain("'lease_token', v_lease_token");
    expect(claim).toContain("v_lease_token := pg_catalog.gen_random_uuid()");
    expect(claim).toContain("v_case.safety_level = 'high_risk'");
    expect(claim).toContain("verdict.generation_status IN ('in_progress', 'ready')");
    expect(claim).toContain("court_provider_manual_reconciliation_required");
    expect(claim).toContain("reservation.provider_state = 'result_staged'");
    expect(claim).toContain("'missions_json', v_provider_reservation.staged_missions_json");
    expect(claim).toContain("'lease_expires_at', v_lease_expires_at");

    const complete = between(
      "CREATE OR REPLACE FUNCTION public.complete_court_verdict",
      "CREATE OR REPLACE FUNCTION public.fail_court_verdict",
    );
    expect(complete).toContain("public.court_verdict_result_is_valid(p_result_json)");
    expect(complete).toContain("public.court_missions_json_is_valid(p_missions_json)");
    expect(complete).toContain("p_result_json -> 'missions' IS DISTINCT FROM p_missions_json");
    expect(complete).toContain("v_verdict.lease_token IS DISTINCT FROM p_lease_token");
    expect(complete).toContain("terminal_lease_token = lease_token");
    expect(complete).toContain("v_result_safety_level = 'sensitive'");
    expect(complete).toContain("v_result_safety_categories text[]");
    expect(complete).toContain(
      "public.court_safety_categories_are_valid(v_result_safety_categories)",
    );
    expect(complete).toContain("v_effective_safety_categories text[]");
    expect(complete).toContain(
      "v_case.safety_categories || v_result_safety_categories",
    );
    expect(complete).toContain("safety_categories = v_effective_safety_categories");
    expect(complete).toContain(
      "pg_catalog.to_jsonb(v_effective_safety_categories)",
    );
    expect(complete).toContain("SET safety_level = 'sensitive'");
    expect(complete).toContain("'reason_code', 'generated_sensitive'");
    expect(complete).toContain("result_json = public.court_redacted_verdict_result('sensitive')");
    expect(complete).toContain("DELETE FROM public.court_public_posts");
    expect(complete.indexOf("SET safety_level = 'sensitive'")).toBeLessThan(
      complete.indexOf("SET generation_status = 'ready'"),
    );
    expect(complete.indexOf("INSERT INTO public.court_missions")).toBeLessThan(
      complete.indexOf("SET generation_status = 'ready'"),
    );
    expect(complete).toContain("court_provider_stage_required");
    expect(complete).toContain("provider_state <> 'result_staged'");
    expect(complete).toContain(
      "staged_result_json IS DISTINCT FROM p_result_json",
    );
    expect(complete).toContain(
      "staged_missions_json IS DISTINCT FROM p_missions_json",
    );
    expect(complete).toContain("SET provider_state = 'completed'");
    expect(complete).toContain("staged_result_json = NULL");
    expect(complete).toContain("staged_missions_json = NULL");
  });

  it("recovers a case-wide staged verdict before release identity matching and supports lookup-only claims", () => {
    const claim = between(
      "CREATE OR REPLACE FUNCTION public.claim_court_verdict",
      "CREATE OR REPLACE FUNCTION public.reserve_court_verdict_provider_call",
    );
    expect(claim).toContain("p_allow_new_claim boolean DEFAULT true");
    expect(claim).toContain("p_allow_new_claim IS NULL");

    const stagedStart = claim.indexOf("-- A paid provider response is durable");
    const exactStart = claim.indexOf(
      "AND verdict.input_hash = p_input_hash",
      stagedStart,
    );
    expect(stagedStart).toBeGreaterThanOrEqual(0);
    expect(exactStart).toBeGreaterThan(stagedStart);

    const stagedRecovery = claim.slice(stagedStart, exactStart);
    expect(stagedRecovery).toContain(
      "JOIN public.court_provider_reservations AS reservation",
    );
    expect(stagedRecovery).toContain("verdict.case_id = p_case_id");
    expect(stagedRecovery).toContain("verdict.generation_status = 'in_progress'");
    expect(stagedRecovery).toContain("reservation.provider_state = 'result_staged'");
    expect(stagedRecovery).toContain("FOR UPDATE OF verdict, reservation");
    expect(stagedRecovery).not.toContain("verdict.input_hash = p_input_hash");
    expect(stagedRecovery).not.toContain("verdict.prompt_version = p_prompt_version");
    expect(stagedRecovery).not.toContain("verdict.schema_version = p_schema_version");
    expect(stagedRecovery).not.toContain("v_verdict.model IS DISTINCT FROM p_model");
    expect(stagedRecovery).toContain("'input_hash', v_verdict.input_hash");
    expect(stagedRecovery).toContain("'prompt_version', v_verdict.prompt_version");
    expect(stagedRecovery).toContain("'schema_version', v_verdict.schema_version");
    expect(stagedRecovery).toContain("'model', v_provider_reservation.staged_model");

    const crossReleaseStart = claim.indexOf(
      "-- A deployment can replace the prompt/schema identity",
      exactStart,
    );
    const crossReleaseAllowGate = claim.indexOf(
      "IF NOT p_allow_new_claim THEN",
      crossReleaseStart,
    );
    const crossReleaseSettlement = claim.indexOf(
      "v_provider_settlement_state := public.settle_court_provider_failure",
      crossReleaseAllowGate,
    );
    const crossReleaseTerminalUpdate = claim.indexOf(
      "UPDATE public.court_verdicts",
      crossReleaseSettlement,
    );
    const crossReleaseFailureEvent = claim.indexOf(
      "'reason_code', 'release_identity_changed_before_provider_start'",
      crossReleaseTerminalUpdate,
    );
    const currentIdentityAllowGate = claim.indexOf(
      "IF NOT p_allow_new_claim THEN",
      crossReleaseAllowGate + 1,
    );
    const newClaimBoundary = claim.indexOf(
      "v_lease_expires_at := pg_catalog.clock_timestamp()",
      currentIdentityAllowGate,
    );
    expect(crossReleaseStart).toBeGreaterThan(exactStart);
    expect(crossReleaseAllowGate).toBeGreaterThan(crossReleaseStart);
    expect(crossReleaseSettlement).toBeGreaterThan(crossReleaseAllowGate);
    expect(crossReleaseTerminalUpdate).toBeGreaterThan(crossReleaseSettlement);
    expect(crossReleaseFailureEvent).toBeGreaterThan(crossReleaseTerminalUpdate);
    expect(currentIdentityAllowGate).toBeGreaterThan(crossReleaseFailureEvent);
    expect(newClaimBoundary).toBeGreaterThan(currentIdentityAllowGate);
    expect(claim.indexOf("'claim_status', 'replay'")).toBeLessThan(crossReleaseAllowGate);
    expect(claim.indexOf("'claim_status', 'staged'")).toBeLessThan(crossReleaseAllowGate);
    expect(claim.indexOf("'claim_status', 'in_progress'")).toBeLessThan(crossReleaseAllowGate);
    expect(claim.slice(crossReleaseAllowGate, crossReleaseSettlement)).toContain(
      "'claim_status', 'unavailable'",
    );
    expect(claim.slice(currentIdentityAllowGate, newClaimBoundary)).toContain(
      "'claim_status', 'unavailable'",
    );

    // The cross-release lookup may retire only an expired attempt that never
    // crossed the provider boundary, and only after the lookup-only fence.
    const crossReleaseLookup = claim.slice(crossReleaseStart, crossReleaseAllowGate);
    expect(crossReleaseLookup).toContain("verdict.generation_status = 'in_progress'");
    expect(crossReleaseLookup).toContain("FOR UPDATE");
    expect(crossReleaseLookup).toContain("v_verdict.lease_expires_at > pg_catalog.clock_timestamp()");
    expect(crossReleaseLookup).toContain(
      "v_provider_reservation.provider_state IN ('started', 'failed_unknown')",
    );
    expect(crossReleaseLookup).toContain(
      "v_provider_reservation.provider_state <> 'reserved'",
    );
    expect(crossReleaseLookup).not.toMatch(
      /(?:INSERT INTO|UPDATE public\.|DELETE FROM public\.)/,
    );
    const crossReleaseMutation = claim.slice(
      crossReleaseAllowGate,
      currentIdentityAllowGate,
    );
    expect(crossReleaseMutation).toContain(
      "v_provider_reservation.provider_state = 'reserved'",
    );
    expect(crossReleaseMutation).toContain(
      "v_provider_settlement_state IS DISTINCT FROM 'failed_unstarted'",
    );
    expect(crossReleaseMutation).toContain("SET generation_status = 'failed'");
    expect(crossReleaseMutation).toContain("terminal_lease_token = lease_token");
    expect(crossReleaseMutation).toContain("lease_token = NULL");
    expect(crossReleaseMutation).toContain("lease_expires_at = NULL");
    expect(crossReleaseMutation).toContain("v_verdict.id := NULL");
    expect(crossReleaseMutation).not.toContain("attempt_count = attempt_count + 1");
    expect(crossReleaseMutation).not.toContain("SET workflow_status = 'statements_complete'");

    const newGeneration = claim.slice(currentIdentityAllowGate);
    expect(newGeneration).toContain(
      "COALESCE(pg_catalog.max(verdict.generation_version), 0) + 1",
    );
    expect(newGeneration).toContain("SET workflow_status = 'judging'");

    const eightArgSignature =
      "uuid, uuid, text, text, text, text, integer, boolean";
    for (const prefix of [
      "ALTER FUNCTION",
      "REVOKE ALL ON FUNCTION",
      "GRANT EXECUTE ON FUNCTION",
    ]) {
      expect(migration.replace(/\s+/g, " ")).toContain(
        `${prefix} public.claim_court_verdict( ${eightArgSignature} )`,
      );
    }
  });

  it("reserves at most one paid provider boundary per verdict and fails closed after start", () => {
    const reservations = between(
      "CREATE TABLE public.court_provider_reservations",
      "CREATE TABLE public.court_missions",
    );
    expect(reservations).toContain("verdict_id uuid PRIMARY KEY");
    expect(reservations).toContain("request_key text NOT NULL UNIQUE");
    expect(reservations).toContain("request_hash text NOT NULL");
    expect(reservations).toContain("quota_scope_kind IN ('couple', 'user')");
    expect(reservations).toContain(
      "audit_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL",
    );
    expect(reservations).toContain(
      "audit_couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL",
    );
    expect(reservations).toContain("audit_preflight_safety_level text NOT NULL");
    expect(reservations).toContain(
      "'reserved', 'started', 'result_staged', 'completed'",
    );
    expect(reservations).toContain(
      "'failed_unstarted', 'failed_invalid', 'failed_unknown', 'retry_allowed'",
    );
    expect(reservations).toContain("staged_result_json jsonb");
    expect(reservations).toContain("staged_missions_json jsonb");
    expect(reservations).toContain("staged_model text");
    expect(reservations).toContain("audit_model text");
    expect(reservations).toContain("provider_audit_state text NOT NULL");
    expect(reservations).toContain("provider_audit_pending_at timestamptz");
    expect(reservations).toContain("provider_audited_at timestamptz");
    expect(reservations).toContain("provider_audit_recovery_lease_token uuid");
    expect(reservations).toContain("provider_audit_recovery_attempt_count integer NOT NULL");
    expect(reservations).toContain("provider_high_risk_categories text[]");
    expect(reservations).toContain("provider_input_tokens integer");
    expect(reservations).toContain("provider_output_tokens integer");
    expect(reservations).toContain("provider_cached_input_tokens integer");
    expect(reservations).toContain("provider_cache_write_input_tokens integer");
    expect(reservations).toContain("court_provider_reservations_usage_check");
    expect(reservations).toContain("reconciled_by_user_id uuid");
    expect(reservations).toContain("reconciliation_action = 'allow_retry'");
    expect(reservations).toContain("reconciliation_confirmation text");
    expect(migration).toContain("court_provider_reservations_reconciliation_queue_idx");
    expect(migration).toContain("court_provider_reservations_audit_recovery_queue_idx");
    expect(migration).not.toContain(
      "GRANT SELECT ON TABLE public.court_provider_reservations TO authenticated",
    );

    const reserve = between(
      "CREATE OR REPLACE FUNCTION public.reserve_court_verdict_provider_call",
      "CREATE OR REPLACE FUNCTION public.mark_court_verdict_provider_started",
    );
    expect(reserve).toContain("FROM public.reserve_amora_usage(");
    expect(reserve).toContain("p_couple_daily_cap integer DEFAULT 30");
    expect(reserve).toContain("p_global_daily_cap integer DEFAULT 60");
    expect(reserve).toContain("p_audit_preflight_safety_level text");
    expect(reserve).toContain("v_existing.audit_user_id IS DISTINCT FROM p_user_id");
    expect(reserve).toContain(
      "v_existing.audit_couple_id IS DISTINCT FROM v_case.couple_id",
    );
    expect(reserve).toContain("IS DISTINCT FROM p_audit_preflight_safety_level");
    expect(reserve).toContain(
      "p_user_id, v_case.couple_id, p_audit_preflight_safety_level",
    );
    expect(reserve).toContain("WHERE reservation.verdict_id = p_verdict_id");
    expect(reserve).toContain("court_provider_reservation_mismatch");
    expect(reserve).toContain("'reason', 'provider_result_unknown'");
    expect(reserve).toContain("'allowed', false");
    expect(reserve).toContain("'retry_disposition', 'manual_reconciliation_required'");
    expect(reserve).toContain("'idempotency_key', v_existing.request_key");
    expect(reserve).toContain("v_scope_id := v_case.creator_user_id");
    expect(reserve).toContain("court provider couple scope is inconsistent");

    const started = between(
      "CREATE OR REPLACE FUNCTION public.mark_court_verdict_provider_started",
      "CREATE OR REPLACE FUNCTION public.complete_court_verdict",
    );
    expect(started).toContain("provider_state = 'started'");
    expect(started).toContain("court_provider_manual_reconciliation_required");
    expect(started).toContain("AND provider_state = 'reserved'");

    const stage = between(
      "CREATE OR REPLACE FUNCTION public.stage_court_verdict_provider_result",
      "CREATE OR REPLACE FUNCTION public.complete_court_verdict",
    );
    expect(stage).toContain("public.court_verdict_result_is_valid(p_result_json)");
    expect(stage).toContain("public.court_missions_json_is_valid(p_missions_json)");
    expect(stage).toContain("p_result_json -> 'missions' IS DISTINCT FROM p_missions_json");
    expect(stage).toContain(
      "public.court_safety_categories_are_valid(v_result_safety_categories)",
    );
    expect(stage).toContain("p_audit_model text");
    expect(stage).toContain("audit_model = p_audit_model");
    expect(stage).toContain("p_input_tokens integer DEFAULT NULL");
    expect(stage).toContain("p_output_tokens integer DEFAULT NULL");
    expect(stage).toContain("p_cached_input_tokens integer DEFAULT NULL");
    expect(stage).toContain("p_cache_write_input_tokens integer DEFAULT NULL");
    expect(stage).toContain("provider_input_tokens = p_input_tokens");
    expect(stage).toContain("'usage', pg_catalog.jsonb_build_object(");
    expect(stage).toContain("court_provider_result_high_risk");
    expect(stage).toContain("cannot lower provider preflight safety");
    expect(stage).toContain("v_reservation.provider_state = 'result_staged'");
    expect(stage).toContain("court_provider_staged_result_mismatch");
    expect(stage).toContain("SET provider_state = 'result_staged'");
    expect(stage).toContain("provider_audit_state = 'pending'");
    expect(stage).toContain("provider_audit_pending_at = v_staged_at");
    expect(stage).not.toContain("lease_expires_at <= pg_catalog.clock_timestamp()");

    const claim = between(
      "CREATE OR REPLACE FUNCTION public.claim_court_verdict",
      "CREATE OR REPLACE FUNCTION public.reserve_court_verdict_provider_call",
    );
    expect(claim).toContain("'claim_status', 'staged'");
    expect(claim).toContain("v_provider_reservation.provider_input_tokens");
    expect(claim).toContain("v_provider_reservation.provider_output_tokens");
    expect(claim).toContain("v_provider_reservation.provider_cached_input_tokens");
    expect(claim).toContain(
      "v_provider_reservation.provider_cache_write_input_tokens",
    );
    expect(claim).toContain(
      "v_provider_reservation.provider_state IN ('started', 'failed_unknown')",
    );
    expect(claim).toContain("court_provider_attempt_terminal");

    const fail = between(
      "CREATE OR REPLACE FUNCTION public.fail_court_verdict",
      "CREATE OR REPLACE FUNCTION public.set_court_mission_status",
    );
    expect(fail).toContain(
      "public.settle_court_provider_failure(p_verdict_id, p_error_code)",
    );
    expect(fail).toContain("v_provider_state = 'result_staged'");
    expect(fail).toContain("RETURN false");
    expect(fail).toContain("v_verdict.error_code IS DISTINCT FROM p_error_code");

    const settlement = between(
      "CREATE OR REPLACE FUNCTION public.settle_court_provider_failure",
      "CREATE TABLE public.court_missions",
    );
    expect(settlement).toContain("v_reservation.provider_state = 'reserved'");
    expect(settlement).toContain("SET count = GREATEST(count - 1, 0)");
    expect(settlement).toContain("WHERE key = v_global_key");
    expect(settlement).toContain("WHERE key = v_scope_key");
    expect(settlement).toContain("provider_state = 'failed_unstarted'");
    expect(settlement).toContain("p_error_code IN (");
    expect(settlement).toContain("'structured_output_invalid'");
    expect(settlement).toContain("'safety_high_risk'");
    expect(settlement).toContain("'safety_level_changed'");
    expect(settlement).toContain("'court_archived'");
    expect(settlement).toContain("staged_at = NULL");
    expect(settlement).toContain("staged_model = NULL");
    expect(settlement).toContain(
      "audit_model = CASE WHEN v_reservation.provider_state = 'result_staged'",
    );
    expect(settlement).toContain(
      "provider_audit_state = CASE WHEN v_reservation.provider_state = 'result_staged'",
    );
    expect(settlement).toContain(
      "THEN v_reservation.provider_audit_state ELSE 'not_required' END",
    );
    expect(settlement).toContain(
      "THEN v_reservation.provider_audited_at ELSE NULL END",
    );
    expect(settlement).toContain(
      "THEN v_reservation.provider_input_tokens ELSE NULL END",
    );
    expect(settlement).toContain(
      "THEN v_reservation.provider_cache_write_input_tokens",
    );
    expect(settlement).toContain("THEN 'failed_invalid'");
    expect(settlement).toContain("ELSE 'failed_unknown'");
    expect(settlement).toContain("court_provider_counter_missing");

    const reconcile = between(
      "CREATE OR REPLACE FUNCTION public.reconcile_court_provider_failure",
      "CREATE OR REPLACE FUNCTION public.set_court_mission_status",
    );
    expect(reconcile).toContain("profile.is_admin = true");
    expect(reconcile).toContain("p_action IS DISTINCT FROM 'allow_retry'");
    expect(reconcile).toContain("ALLOW_RETRY_AFTER_PROVIDER_REVIEW");
    expect(reconcile).toContain("v_reservation.provider_state <> 'failed_unknown'");
    expect(reconcile).toContain("court_provider_safety_remediation_required");
    expect(reconcile).toContain("SET provider_state = 'retry_allowed'");
    expect(reconcile).toContain("reconciliation_confirmation = p_confirmation");
    expect(reconcile).toContain("'provider_reconciled'");
    expect(reconcile).toContain("'reused', true");
    expect(migration).toContain("guard_delete_court_provider_audit_users");
  });

  it("durably recovers paid-call audits without retaining high-risk verdict prose", () => {
    const highRisk = between(
      "CREATE OR REPLACE FUNCTION public.settle_court_high_risk_provider_result",
      "CREATE OR REPLACE FUNCTION public.finalize_court_provider_audit",
    );
    expect(highRisk).toContain("p_categories text[]");
    expect(highRisk).toContain("p_audit_model text");
    expect(highRisk).not.toContain("p_result_json");
    expect(highRisk).not.toContain("p_missions_json");
    expect(highRisk).toContain("provider_state = 'failed_invalid'");
    expect(highRisk).toContain("provider_audit_state = 'pending'");
    expect(highRisk).toContain("staged_result_json = NULL");
    expect(highRisk).toContain("staged_missions_json = NULL");
    expect(highRisk).toContain("provider_high_risk_categories = v_categories");
    expect(highRisk).toContain("SET safety_level = 'high_risk'");
    expect(highRisk).toContain("DELETE FROM public.court_public_posts");
    expect(highRisk).toContain("court_high_risk_provider_settlement_mismatch");
    expect(highRisk).toContain("'reused', true");

    const finalize = between(
      "CREATE OR REPLACE FUNCTION public.finalize_court_provider_audit",
      "CREATE OR REPLACE FUNCTION public.claim_court_provider_audit_recovery",
    );
    expect(finalize).toContain("FROM public.ai_interactions_log AS interaction");
    expect(finalize).toContain("interaction.idempotency_key = p_request_key");
    expect(finalize).toContain("v_audit.interaction_type IS DISTINCT FROM 'couple_court_verdict'");
    expect(finalize).toContain("v_audit.success IS DISTINCT FROM true");
    expect(finalize).toContain("v_audit.error_message IS NOT NULL");
    expect(finalize).toContain("v_audit.user_input IS NOT NULL");
    expect(finalize).toContain("v_audit.ai_output IS NOT NULL");
    expect(finalize).toContain("v_audit.model IS DISTINCT FROM v_reservation.audit_model");
    expect(finalize).toContain("v_audit.tokens_input IS DISTINCT FROM");
    expect(finalize).toContain("v_audit.metadata IS DISTINCT FROM v_expected_metadata");
    expect(finalize).toContain("v_schema_name := CASE v_verdict.schema_version");
    expect(finalize).toContain("WHEN '1.0' THEN 'couple_court_verdict_v1'");
    expect(finalize).toContain("court_provider_audit_schema_unsupported");
    expect(finalize).toContain("'schema_name', v_schema_name");
    expect(finalize).toContain("'cache_write_input_tokens'");
    expect(finalize).toContain("'cache_read_input_tokens'");
    expect(finalize).toContain("provider_audit_state = 'audited'");
    expect(finalize).toContain("provider_audit_recovery_lease_token = NULL");
    expect(finalize).toContain("court_provider_audit_evidence_mismatch");

    const recovery = between(
      "CREATE OR REPLACE FUNCTION public.claim_court_provider_audit_recovery",
      "CREATE OR REPLACE FUNCTION public.record_court_provider_audit_recovery_failure",
    );
    expect(recovery).toContain("profile.is_admin = true");
    expect(recovery).toContain("FOR UPDATE OF reservation SKIP LOCKED");
    expect(recovery).toContain("provider_audit_recovery_lease_token = v_lease_token");
    expect(recovery).toContain("provider_audit_recovery_attempt_count + 1");
    expect(recovery).toContain("'request_key', v_reservation.request_key");
    expect(recovery).not.toContain("request_hash");
    expect(recovery).not.toContain("staged_result_json");
    expect(recovery).not.toContain("staged_missions_json");

    const recoveryFailure = between(
      "CREATE OR REPLACE FUNCTION public.record_court_provider_audit_recovery_failure",
      "CREATE OR REPLACE FUNCTION public.complete_court_verdict",
    );
    expect(recoveryFailure).toContain("profile.is_admin = true");
    expect(recoveryFailure).toContain(
      "provider_audit_recovery_last_error_code = p_error_code",
    );
    expect(recoveryFailure).toContain(
      "provider_audit_recovery_lease_token\n      IS DISTINCT FROM p_recovery_lease_token",
    );

    const complete = between(
      "CREATE OR REPLACE FUNCTION public.complete_court_verdict",
      "CREATE OR REPLACE FUNCTION public.fail_court_verdict",
    );
    expect(complete).toContain("provider_audit_state <> 'audited'");
    expect(complete).toContain("provider_audited_at IS NULL");

    const remove = between(
      "CREATE OR REPLACE FUNCTION public.delete_court_case",
      "CREATE OR REPLACE FUNCTION public.claim_court_verdict",
    );
    expect(remove).toContain("v_case.workflow_status = 'judging'");
    expect(remove).toContain("court_delete_requires_archive");
    expect(remove).toContain("reservation.provider_audit_state = 'pending'");
    expect(remove).toContain("court_provider_audit_pending");

    expect(migration).toContain(
      "FOREIGN KEY (couple_id) REFERENCES public.couples(id) ON DELETE SET NULL",
    );
  });

  it("writes statement and followup safety atomically and gates the 72-hour check-in", () => {
    const submit = between(
      "CREATE OR REPLACE FUNCTION public.submit_court_statement",
      "CREATE OR REPLACE FUNCTION public.issue_court_invite",
    );
    expect(submit).toContain("p_safety_level text");
    expect(submit).toContain("p_safety_categories text[]");
    expect(submit).toContain("v_safety_result := public.mark_court_case_safety(");
    expect(submit.indexOf("INSERT INTO public.court_statements")).toBeLessThan(
      submit.indexOf("v_safety_result := public.mark_court_case_safety("),
    );

    const followupTable = between(
      "CREATE TABLE public.court_followups",
      "CREATE TABLE public.court_case_events",
    );
    expect(followupTable).toContain("ON DELETE SET NULL (verdict_id)");
    expect(followupTable).toContain("court_followups_one_per_participant_verdict");

    const followup = between(
      "CREATE OR REPLACE FUNCTION public.create_court_followup",
      "CREATE OR REPLACE FUNCTION public.prepare_court_public_snapshot",
    );
    expect(followup).toContain("p_safety_level text");
    expect(followup).toContain("p_safety_categories text[]");
    expect(followup).toContain("v_verdict.completed_at + interval '72 hours'");
    expect(followup).toContain("court_followup_too_early");
    expect(followup).toContain("court_followup_already_recorded");
    expect(followup).toContain("v_safety_path := p_safety_level <> 'normal'");
    expect(followup).not.toContain(
      "v_safety_path := v_case.safety_level <> 'normal'",
    );
    expect(followup).toContain("v_verdict_id := NULL");
    expect(followup).toContain("v_safety_result := public.mark_court_case_safety(");
    expect(followup.indexOf("INSERT INTO public.court_followups")).toBeLessThan(
      followup.indexOf("v_safety_result := public.mark_court_case_safety("),
    );
  });

  it("atomically escalates AI preflight safety above every active judgment lease", () => {
    const escalate = between(
      "CREATE OR REPLACE FUNCTION public.escalate_court_case_safety_from_ai_preflight",
      "CREATE OR REPLACE FUNCTION public.archive_court_case",
    );
    expect(escalate).toContain("SET safety_level = 'high_risk'");
    expect(escalate).toContain("generation_status = 'failed'");
    expect(escalate).toContain("terminal_lease_token = verdict.lease_token");
    expect(escalate).toContain("DELETE FROM public.court_verdicts AS verdict");
    expect(escalate).toContain("DELETE FROM public.court_public_posts");
    expect(escalate).toContain("'reason_code', 'ai_preflight'");
  });

  it("archives an active generation without stranding a staged private result", () => {
    const archive = between(
      "CREATE OR REPLACE FUNCTION public.archive_court_case",
      "CREATE OR REPLACE FUNCTION public.delete_court_case",
    );
    expect(archive).toContain(
      "public.settle_court_provider_failure(verdict.id, 'court_archived')",
    );
    expect(archive).toContain("terminal_lease_token = verdict.lease_token");
    expect(archive).toContain("generation_status = 'failed'");
    expect(archive).toContain("error_code = 'court_archived'");
    expect(archive).toContain("lease_token = NULL");
    expect(archive).toContain("lease_expires_at = NULL");
    expect(archive.indexOf("settle_court_provider_failure")).toBeLessThan(
      archive.indexOf("SET workflow_status = 'archived'"),
    );

    const settlement = between(
      "CREATE OR REPLACE FUNCTION public.settle_court_provider_failure",
      "CREATE TABLE public.court_missions",
    );
    expect(settlement).toContain("staged_result_json = NULL");
    expect(settlement).toContain("staged_missions_json = NULL");
    expect(settlement).toContain(
      "THEN v_reservation.provider_audit_state ELSE 'not_required' END",
    );
    expect(settlement).toContain(
      "THEN v_reservation.audit_model ELSE NULL END",
    );
    expect(settlement).toContain(
      "THEN v_reservation.provider_input_tokens ELSE NULL END",
    );

    const complete = between(
      "CREATE OR REPLACE FUNCTION public.complete_court_verdict",
      "CREATE OR REPLACE FUNCTION public.fail_court_verdict",
    );
    expect(complete).toContain("v_case.workflow_status <> 'judging'");
  });

  it("allows only the active applicant who created a case to archive it", () => {
    const archive = between(
      "CREATE OR REPLACE FUNCTION public.archive_court_case",
      "CREATE OR REPLACE FUNCTION public.claim_court_verdict",
    );
    expect(archive).toContain("v_case.creator_user_id IS DISTINCT FROM p_user_id");
    expect(archive).toContain("participant.role = 'applicant'");
    expect(archive).toContain("only the court applicant can archive a case");
    expect(archive).toContain("active court applicant is required");
  });

  it("permanently deletes the complete case graph only for its active applicant", () => {
    const remove = between(
      "CREATE OR REPLACE FUNCTION public.delete_court_case",
      "CREATE OR REPLACE FUNCTION public.claim_court_verdict",
    );
    expect(remove).toContain("v_case.creator_user_id IS DISTINCT FROM p_user_id");
    expect(remove).toContain("participant.role = 'applicant'");
    expect(remove).toContain("participant.participation_status = 'active'");
    expect(remove).toContain("v_case.mode = 'couple' AND EXISTS");
    expect(remove).toContain("partner.role = 'partner'");
    expect(remove).toContain("court_delete_requires_joint_policy");
    expect(remove).toContain("DELETE FROM public.amora_actions AS action");
    expect(remove).toContain("action.source = 'court'");
    expect(remove).toContain("DELETE FROM public.court_cases AS court_case");
    expect(remove.indexOf("DELETE FROM public.amora_actions AS action")).toBeLessThan(
      remove.indexOf("DELETE FROM public.court_cases AS court_case"),
    );
    expect(remove).toContain("'deleted', true");
  });

  it("keeps participant safety marking monotonic and idempotent", () => {
    const mark = between(
      "CREATE OR REPLACE FUNCTION public.mark_court_case_safety",
      "CREATE OR REPLACE FUNCTION public.escalate_court_case_safety_from_ai_preflight",
    );
    expect(mark).toContain("GREATEST(v_current_rank, v_next_rank)");
    expect(mark).toContain("'safety_level', v_effective_level");
    expect(mark).toContain(
      "v_case.safety_level = 'normal' AND v_effective_level = 'sensitive'",
    );
    expect(mark).toContain("'safety_level_changed'");
    expect(mark).toContain("terminal_lease_token = verdict.lease_token");
    expect(mark).toContain("DELETE FROM public.court_verdicts AS verdict");
    expect(mark).toContain("SET generation_status = 'superseded'");
    expect(mark).toContain("verdict.generation_status IN ('ready', 'superseded')");
    expect(mark).toContain("SET solo_provisional_verdict_id = NULL");
    expect(mark).toContain("public.settle_court_provider_failure(");
    expect(mark).toContain("verdict.id,");
    expect(mark).toContain("IF v_effective_level <> 'normal' THEN");
    expect(mark).toContain("result_json = public.court_redacted_verdict_result('sensitive')");
    expect(mark).toContain("DELETE FROM public.court_public_posts");
    expect(mark).not.toContain("cannot be lowered by a participant flow");
  });

  it("retains only a deterministic safety stub for sensitive verdict history", () => {
    const redacted = between(
      "CREATE OR REPLACE FUNCTION public.court_redacted_verdict_result",
      "CREATE OR REPLACE FUNCTION public.court_missions_json_is_valid",
    );
    expect(redacted).toContain("p_safety_level IN ('sensitive', 'high_risk')");
    expect(redacted).toContain("'redacted', true");
    expect(redacted).toContain("'caseSummary', ''");
    expect(redacted).toContain("'sharedFacts', '[]'::jsonb");
    expect(redacted).toContain("'missions', '[]'::jsonb");
    expect(redacted).toContain("'limitations', pg_catalog.jsonb_build_array('safety_redacted')");
    expect(redacted).toContain("ELSE NULL END");
  });

  it("normalizes mission ownership, completion and idempotent Amora action links", () => {
    expect(migration).toContain("owner_role IN ('applicant', 'partner', 'both')");
    expect(migration).toContain("related_feature text NOT NULL CHECK (related_feature = 'task')");
    expect(migration).toContain("(v_item ->> 'relatedFeature') <> 'task'");
    expect(migration).toContain("court_missions_amora_action_unique");
    expect(migration).toContain("v_action_source IS DISTINCT FROM 'court'");
    expect(migration).toContain("v_action_created_by IS DISTINCT FROM p_user_id");
    const atomicAction = between(
      "CREATE OR REPLACE FUNCTION public.create_or_link_court_mission_action",
      "CREATE OR REPLACE FUNCTION public.create_court_followup",
    );
    expect(atomicAction).toContain("v_profile_couple_id IS DISTINCT FROM v_case.couple_id");
    expect(atomicAction).toContain("INSERT INTO public.amora_actions");
    expect(atomicAction).toContain("UPDATE public.court_missions");
    expect(atomicAction).toContain("ON CONFLICT (id) DO NOTHING");
    expect(atomicAction).toContain("shared court action confirmation is required");
    expect(atomicAction).toContain("court mission couple scope is inconsistent");
    expect(migration).toContain(
      "'chat', 'quote', 'schedule', 'budget', 'guardrail', 'manual', 'court'",
    );
  });

  it("binds publication consent to an immutable exact snapshot version", () => {
    expect(migration).toContain("CREATE TRIGGER court_public_posts_snapshot_immutable");
    expect(migration).toContain(
      "UNIQUE (public_post_id, participant_id, snapshot_hash)",
    );
    const snapshotValidator = between(
      "CREATE OR REPLACE FUNCTION public.court_public_snapshot_is_valid",
      "CREATE OR REPLACE FUNCTION public.court_redacted_verdict_result",
    );
    expect(snapshotValidator).toContain("'snapshotVersion', 'category', 'tone', 'mode'");
    expect(snapshotValidator).toContain("(p_snapshot ->> 'tone') IN ('gentle', 'practical', 'spicy')");
    const prepare = between(
      "CREATE OR REPLACE FUNCTION public.prepare_court_public_snapshot",
      "CREATE OR REPLACE FUNCTION public.set_court_public_consent",
    );
    expect(prepare).toContain("v_case.safety_level <> 'normal'");
    expect(prepare).toContain("p_snapshot_json ->> 'tone' IS DISTINCT FROM v_case.tone");
    expect(prepare).toContain("v_latest_post.snapshot_hash = p_snapshot_hash");
    expect(prepare).toContain(
      "v_latest_post.sanitized_snapshot_json IS DISTINCT FROM p_snapshot_json",
    );
    expect(prepare).toContain("court_public_snapshot_hash_mismatch");
    expect(prepare).toContain("v_expected_version := COALESCE(v_latest_post.snapshot_version, 0) + 1");
    expect(prepare).toContain("court_public_snapshot_version_exhausted");
    expect(prepare).toContain("p_snapshot_hash, v_expected_version");
    expect(prepare).toContain("'reused', true");
    expect(prepare).not.toContain("p_snapshot_version <> v_expected_version");
    expect(prepare).toContain("SET revoked_at = COALESCE");

    const publish = between(
      "CREATE OR REPLACE FUNCTION public.publish_court_public_post",
      "CREATE OR REPLACE FUNCTION public.withdraw_court_public_post",
    );
    expect(publish).toContain("v_post.moderation_status <> 'approved'");
    expect(publish).toContain("WHEN 'solo' THEN 1 ELSE 2 END");
    expect(publish).toContain("v_participant_count <> v_required_participant_count");
    expect(publish).toContain("v_consent_count <> v_required_participant_count");
  });

  it("requires an active admin moderation decision before publication", () => {
    const review = between(
      "CREATE OR REPLACE FUNCTION public.review_court_public_post",
      "CREATE OR REPLACE FUNCTION public.publish_court_public_post",
    );
    expect(review).toContain("profile.is_admin = true");
    expect(review).toContain("p_decision NOT IN ('approve', 'reject', 'hidden')");
    expect(review).toContain("only a safe pending-review snapshot can be approved");
    expect(review).toContain("'public_reviewed'");
    expect(review).not.toContain("GRANT EXECUTE");
  });

  it("exposes only published safe projections without private identifiers", () => {
    const publicFeed = between(
      "CREATE OR REPLACE VIEW public.court_public_feed",
      "CREATE OR REPLACE VIEW public.court_public_comment_feed",
    );
    expect(publicFeed).toContain("post.status = 'published'");
    expect(publicFeed).toContain("post.safety_level = 'normal'");
    expect(publicFeed).toContain("post.moderation_status = 'approved'");
    expect(publicFeed).toContain("court_case.safety_level = 'normal'");
    expect(publicFeed).toContain("court_case.workflow_status <> 'archived'");
    expect(publicFeed).toContain("AS vote_counts");
    const publicProjection = publicFeed.slice(0, publicFeed.indexOf("FROM public.court_public_posts"));
    expect(publicProjection).not.toMatch(/\bcase_id\b/);
    expect(publicProjection).not.toMatch(/\buser_id\b/);

    const commentFeed = between(
      "CREATE OR REPLACE VIEW public.court_public_comment_feed",
      "ALTER VIEW public.court_public_feed OWNER TO postgres",
    );
    expect(commentFeed).toContain("comment.moderation_status = 'visible'");
    expect(commentFeed).toContain("court_case.safety_level = 'normal'");
    const commentProjection = commentFeed.slice(0, commentFeed.indexOf("FROM public.court_comments"));
    expect(commentProjection).not.toMatch(/\buser_id\b/);
  });

  it("shares the account-deletion lock and keeps event metadata allowlisted", () => {
    for (const trigger of [
      "guard_delete_court_cases",
      "guard_delete_court_participants",
      "guard_delete_court_invite_consumers",
      "guard_delete_court_invite_rejecters",
      "guard_delete_court_provider_reconcilers",
      "guard_delete_court_public_reviewers",
      "guard_delete_court_votes",
      "guard_delete_court_comments",
      "guard_delete_court_comment_reviewers",
      "guard_delete_court_reporters",
      "guard_delete_court_report_reviewers",
    ]) {
      expect(migration).toContain(`CREATE TRIGGER ${trigger}`);
    }
    expect(migration).toContain("public.guard_account_deletion_user_reference");
    expect(migration).toContain("CREATE TRIGGER court_profile_deletion_hides_publication");
    expect(migration).toContain("CREATE CONSTRAINT TRIGGER court_participant_removal_deletes_case");
    expect(migration).toContain("CREATE TRIGGER court_case_removal_deletes_actions");
    expect(migration).toContain("CREATE TRIGGER court_verdict_removal_deletes_actions");
    expect(migration).toContain("DELETE FROM public.court_cases AS court_case");
    expect(migration).toMatch(/DELETE FROM public\.court_cases\s+WHERE id = OLD\.case_id/);
    expect(migration).toMatch(
      /WHERE participant\.user_id = NEW\.id\s+AND participant\.participation_status = 'active'/,
    );
    expect(migration).toMatch(
      /delete_court_case_after_participant_removal[\s\S]*?IF OLD\.participation_status <> 'active'/,
    );
    expect(migration).toMatch(
      /DELETE FROM public\.amora_actions AS action[\s\S]*?mission\.amora_action_id = action\.id[\s\S]*?action\.source = 'court'/,
    );

    const metadataGuard = between(
      "CREATE OR REPLACE FUNCTION public.court_event_metadata_is_safe",
      "CREATE OR REPLACE FUNCTION public.court_verdict_result_is_valid",
    );
    for (const rawKey of [
      "title",
      "facts",
      "feelings",
      "expectations",
      "token",
      "email",
      "phone",
      "user_id",
      "case_id",
    ]) {
      expect(metadataGuard).not.toContain(`'${rawKey}'`);
    }
  });

  it("keeps provisional/formal verdicts and missions behind the server boundary", () => {
    expect(migration).not.toContain("GRANT SELECT ON TABLE public.court_verdicts TO authenticated");
    expect(migration).not.toContain("GRANT SELECT ON TABLE public.court_missions TO authenticated");
    expect(migration).not.toContain("GRANT SELECT ON TABLE public.court_mission_completions TO authenticated");
    expect(migration).not.toContain("CREATE POLICY court_verdicts_participant_ready_select");
  });

  it("provides an admin-only moderation path for comments, locks, and reports", () => {
    for (const name of [
      "review_court_public_comment",
      "set_court_public_comments_enabled",
      "review_court_public_report",
    ]) {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
      const end = migration.indexOf("$$;", start);
      const body = migration.slice(start, end);
      expect(body, name).toContain("profile.is_admin = true");
    }
    expect(migration).toContain("comment.moderation_status = 'visible'");
    expect(migration).toContain("p_decision NOT IN ('start_review', 'dismiss', 'hide_content')");
    expect(migration).toContain("'public_comment_reviewed'");
    expect(migration).toContain("'public_comments_toggled'");
    expect(migration).toContain("'public_report_reviewed'");
  });

  it("keeps all state-changing RPCs service-only with hardened definer paths", () => {
    const rpcNames = [
      "create_court_case_with_applicant",
      "submit_court_statement",
      "issue_court_invite",
      "cancel_court_invite",
      "reject_court_invite",
      "accept_court_invite",
      "leave_court_case",
      "mark_court_case_safety",
      "escalate_court_case_safety_from_ai_preflight",
      "archive_court_case",
      "delete_court_case",
      "claim_court_verdict",
      "settle_court_provider_failure",
      "reserve_court_verdict_provider_call",
      "mark_court_verdict_provider_started",
      "stage_court_verdict_provider_result",
      "settle_court_high_risk_provider_result",
      "finalize_court_provider_audit",
      "claim_court_provider_audit_recovery",
      "record_court_provider_audit_recovery_failure",
      "complete_court_verdict",
      "fail_court_verdict",
      "reconcile_court_provider_failure",
      "set_court_mission_status",
      "link_court_mission_action",
      "create_or_link_court_mission_action",
      "create_court_followup",
      "prepare_court_public_snapshot",
      "set_court_public_consent",
      "review_court_public_post",
      "publish_court_public_post",
      "withdraw_court_public_post",
      "cast_court_public_vote",
      "create_court_public_comment",
      "review_court_public_comment",
      "set_court_public_comments_enabled",
      "review_court_public_report",
      "report_court_public_content",
    ];
    for (const name of rpcNames) {
      const start = `CREATE OR REPLACE FUNCTION public.${name}(`;
      const bodyStart = migration.indexOf(start);
      const bodyEnd = migration.indexOf("$$;", bodyStart) + 3;
      const body = migration.slice(bodyStart, bodyEnd);
      expect(bodyStart, name).toBeGreaterThanOrEqual(0);
      expect(body, name).toContain("SECURITY DEFINER");
      expect(body, name).toContain("SET search_path = pg_catalog, pg_temp");
      expect(body, name).toContain("auth.role()");
      expect(body, name).toContain("'service_role'");
      expect(migration, name).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*?TO service_role;`),
      );
      expect(migration, name).not.toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*?TO (?:anon|authenticated)`),
      );
    }
  });
});
