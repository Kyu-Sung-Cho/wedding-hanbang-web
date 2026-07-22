// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = resolve(process.cwd(), "../../supabase/migrations");

function readMigration(name: string): string {
  return readFileSync(resolve(migrationDirectory, name), "utf8");
}

function executableSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

const boundedLockMigrations = [
  "20260716090000_amora_memory_engine_v2.sql",
  "20260716091000_care_explicit_consent.sql",
  "20260716092000_amora_mediation_confirmation.sql",
  "20260716093000_amora_care_queue.sql",
  "20260716094000_couple_roster_epoch.sql",
  "20260716095000_amora_care_delivery_policy.sql",
  "20260716096000_amora_tool_retry_fence.sql",
  "20260716097000_amora_atomic_cost_budget.sql",
  "20260716099000_wedding_journey_singleton.sql",
  "20260716102000_booking_projection_outbox.sql",
  "20260716109000_booking_outcome_atomic.sql",
  "20260716110000_amora_crash_recovery_atomicity.sql",
  "20260716111000_community_upload_attachment_lifecycle.sql",
  "20260716113000_account_deletion_storage_saga.sql",
  "20260716114000_current_couple_membership_privacy_fence.sql",
  "20260716115000_rate_limit_pseudonym_retention.sql",
  "20260716116000_ai_log_retention_contract.sql",
] as const;

const validatedConstraints = [
  ["20260716090000_amora_memory_engine_v2.sql", "decision_nodes_source_message_id_fkey"],
  ["20260716090000_amora_memory_engine_v2.sql", "decision_nodes_superseded_by_fkey"],
  ["20260716090000_amora_memory_engine_v2.sql", "decision_nodes_source_actor_role_check"],
  ["20260716092000_amora_mediation_confirmation.sql", "amora_mediation_acceptances_proposal_resolution_not_null"],
  ["20260716092000_amora_mediation_confirmation.sql", "amora_mediation_acceptances_proposal_version_not_null"],
  ["20260716092000_amora_mediation_confirmation.sql", "amora_mediation_acceptances_roster_fingerprint_not_null"],
  ["20260716092000_amora_mediation_confirmation.sql", "amora_mediation_acceptances_proposal_resolution_check"],
  ["20260716092000_amora_mediation_confirmation.sql", "amora_mediation_acceptances_roster_fingerprint_check"],
  ["20260716093000_amora_care_queue.sql", "profiles_care_consent_state_valid"],
  ["20260716094000_couple_roster_epoch.sql", "amora_care_jobs_roster_member_ids_valid"],
  ["20260716095000_amora_care_delivery_policy.sql", "profiles_care_consent_state_valid"],
  ["20260716096000_amora_tool_retry_fence.sql", "amora_chat_request_claims_user_message_id_fkey"],
  ["20260716097000_amora_atomic_cost_budget.sql", "amora_turn_counters_reserved_cost_nonnegative"],
  ["20260716097000_amora_atomic_cost_budget.sql", "ai_log_amora_receipt_shape"],
  ["20260716099000_wedding_journey_singleton.sql", "wedding_journeys_couple_id_not_null"],
  ["20260716110000_amora_crash_recovery_atomicity.sql", "amora_chat_request_tool_round_journal_shape"],
  ["20260716110000_amora_crash_recovery_atomicity.sql", "amora_tool_atomic_attempt_shape"],
  ["20260716111000_community_upload_attachment_lifecycle.sql", "community_upload_sessions_completion_state"],
  ["20260716111000_community_upload_attachment_lifecycle.sql", "community_upload_sessions_attachment_state"],
  ["20260716111000_community_upload_attachment_lifecycle.sql", "community_upload_sessions_cleanup_claim_state"],
] as const;

const transactionOwnedMigrations = [
  ...readdirSync(migrationDirectory)
    .filter((name) => /^20260716\d{6}_.+\.sql$/.test(name))
    .filter((name) => name.slice(0, 14) >= "20260716090000")
    .filter((name) => name.slice(0, 14) <= "20260716117000"),
  "20260718208000_atomic_weighted_rate_limit.sql",
].sort();

function constraintDefinition(sql: string, constraintName: string): string {
  const startPattern = new RegExp(`ADD\\s+CONSTRAINT\\s+${constraintName}\\b`, "i");
  const match = startPattern.exec(sql);
  expect(match, `${constraintName} must be created by the migration`).not.toBeNull();

  const tail = sql.slice((match?.index ?? 0) + (match?.[0].length ?? 0));
  const boundaries = [
    tail.search(/\bADD\s+CONSTRAINT\b/i),
    tail.search(/\bALTER\s+TABLE\b/i),
    tail.indexOf(";"),
  ].filter((index) => index >= 0);
  const end = boundaries.length > 0 ? Math.min(...boundaries) : tail.length;
  return tail.slice(0, end);
}

describe("Amora production migration lock safety", () => {
  it("owns one explicit transaction per migration artifact", () => {
    for (const name of transactionOwnedMigrations) {
      const sql = executableSql(readMigration(name)).trim();

      expect(sql, `${name} must begin its own transaction`).toMatch(/^BEGIN\s*;/i);
      expect(sql, `${name} must commit its own transaction`).toMatch(/COMMIT\s*;$/i);
      expect(sql.match(/^\s*BEGIN\s*;/gim), `${name} must have one top-level BEGIN`)
        .toHaveLength(1);
      expect(sql.match(/^\s*COMMIT\s*;/gim), `${name} must have one top-level COMMIT`)
        .toHaveLength(1);
    }
  });

  it("keeps transaction-incompatible commands out of self-transactional migrations", () => {
    const incompatible = /\b(?:CREATE(?:\s+UNIQUE)?\s+INDEX\s+CONCURRENTLY|DROP\s+INDEX\s+CONCURRENTLY|REINDEX(?:\s+\w+)?\s+CONCURRENTLY|REFRESH\s+MATERIALIZED\s+VIEW\s+CONCURRENTLY|VACUUM|CLUSTER|CREATE\s+DATABASE|DROP\s+DATABASE|ALTER\s+SYSTEM|PREPARE\s+TRANSACTION)\b/i;

    for (const name of transactionOwnedMigrations) {
      expect(executableSql(readMigration(name)), name).not.toMatch(incompatible);
    }
  });

  it("bounds every migration that performs release-time table DDL or backfill", () => {
    for (const name of boundedLockMigrations) {
      const sql = executableSql(readMigration(name));
      const firstTableOperation = sql.search(
        /\b(?:ALTER\s+TABLE|CREATE\s+TABLE|CREATE(?:\s+UNIQUE)?\s+INDEX|UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/i,
      );
      const header = sql.slice(0, firstTableOperation < 0 ? sql.length : firstTableOperation);

      expect(header, `${name} needs a top-level lock timeout`).toMatch(
        /SET\s+LOCAL\s+lock_timeout\s*=\s*'5s'\s*;/i,
      );
      expect(header, `${name} needs a top-level statement timeout`).toMatch(
        /SET\s+LOCAL\s+statement_timeout\s*=\s*'(?:30|60)s'\s*;/i,
      );
    }
  });

  it("never takes an explicit ACCESS EXCLUSIVE table lock", () => {
    const releaseMigrations = readdirSync(migrationDirectory)
      .filter((name) => /^20260716\d{6}_.+\.sql$/.test(name))
      .filter((name) => name.slice(0, 14) >= "20260716090000")
      .filter((name) => name.slice(0, 14) <= "20260716116000");

    for (const name of releaseMigrations) {
      expect(executableSql(readMigration(name)), name).not.toMatch(
        /LOCK\s+TABLE[\s\S]*?ACCESS\s+EXCLUSIVE/i,
      );
    }
  });

  it("adds existing-table constraints as NOT VALID before write-compatible validation", () => {
    for (const [name, constraintName] of validatedConstraints) {
      const sql = executableSql(readMigration(name));
      expect(constraintDefinition(sql, constraintName), `${name}: ${constraintName}`).toMatch(
        /\bNOT\s+VALID\b/i,
      );
      expect(sql, `${name}: ${constraintName} must be validated`).toMatch(
        new RegExp(`VALIDATE\\s+CONSTRAINT\\s+${constraintName}\\s*;`, "i"),
      );
    }
  });

  it("touches only legacy default-on profiles during the one-time consent reset", () => {
    const sql = executableSql(readMigration(
      "20260716091000_care_explicit_consent.sql",
    ));
    expect(sql).toMatch(
      /UPDATE\s+public\.profiles[\s\S]*?WHERE\s+care_notifications_enabled\s+IS\s+DISTINCT\s+FROM\s+false\s+AND\s+care_notifications_consented_at\s+IS\s+NULL\s*;/i,
    );
  });

  it("builds the wedding-journey unique index before attaching the constraint", () => {
    const sql = executableSql(readMigration(
      "20260716099000_wedding_journey_singleton.sql",
    ));
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+wedding_journeys_couple_id_key/i);
    expect(sql).toMatch(
      /ADD\s+CONSTRAINT\s+wedding_journeys_couple_id_key\s+UNIQUE\s+USING\s+INDEX\s+wedding_journeys_couple_id_key/i,
    );
    expect(sql).not.toMatch(
      /ADD\s+CONSTRAINT\s+wedding_journeys_couple_id_key\s+UNIQUE\s*\(\s*couple_id\s*\)/i,
    );
  });
});
