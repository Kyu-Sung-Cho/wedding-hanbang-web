import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const readRepo = (path: string) =>
  readFileSync(resolve(repoRoot, path), "utf8").replace(/\r\n/g, "\n");

const migration = readRepo(
  "supabase/migrations/20260713122000_lock_service_role_table_acl.sql",
);
const preflight = readRepo("scripts/sql/supabase-production-preflight.sql");
const postDeploy = readRepo("scripts/sql/supabase-post-deploy-contract.sql");
const ship = readRepo("scripts/supabase-ship-safe.ps1");

const expectedTables = [
  "amora_turn_counters",
  "amora_usage_reservations",
  "rate_limit_buckets",
  "couples",
  "account_deletions",
  "customer_survey_responses",
  "chat_feedback",
  "chat_summaries",
  "amora_actions",
  "wedding_code_responses",
  "community_upload_reservations",
  "account_deletion_jobs",
  "amora_request_claims",
  "amora_provider_leases",
] as const;

describe("service role table least-privilege contract", () => {
  it("rebuilds both table and column ACLs without unsafe privileges", () => {
    for (const table of expectedTables) {
      expect(migration).toContain(`'${table}'`);
    }

    expect(migration).not.toMatch(
      /GRANT ALL(?: PRIVILEGES)? ON TABLE[^;]+TO service_role/i,
    );
    expect(migration).toContain(
      "'SELECT', 'INSERT', 'UPDATE', 'DELETE',\n      'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'",
    );
    expect(migration).toContain("PUBLIC table ACL remains on %");
    expect(migration).toContain("AND NOT privilege_row.is_grantable");
    expect(migration).toContain("AND grantor.rolname = 'postgres'");
    expect(migration).toContain(
      "explicit service_role column ACL remains on %",
    );
  });

  it("grants only the reviewed direct DML matrix", () => {
    expect(migration).toContain(
      "GRANT SELECT, DELETE ON TABLE public.rate_limit_buckets TO service_role;",
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.couples TO service_role;",
    );
    expect(migration).toContain(
      "GRANT UPDATE ON TABLE public.account_deletions TO service_role;",
    );
    expect(migration).toContain(
      "GRANT SELECT, DELETE ON TABLE public.chat_feedback TO service_role;",
    );
    expect(migration).toContain(
      "GRANT SELECT, INSERT, DELETE ON TABLE public.chat_summaries TO service_role;",
    );
    expect(migration).toContain(
      "GRANT SELECT, UPDATE ON TABLE public.account_deletion_jobs TO service_role;",
    );
    expect(migration).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.amora_request_claims\n  TO service_role;",
    );
    expect(migration).not.toMatch(
      /GRANT[^;]+ON TABLE public\.(?:amora_turn_counters|amora_usage_reservations|customer_survey_responses|amora_actions|wedding_code_responses|community_upload_reservations|amora_provider_leases)\s+TO service_role;/,
    );
  });

  it("wires the exact 14-table state into preflight, postdeploy, and ship", () => {
    for (const sql of [preflight, postDeploy]) {
      expect(sql).toContain(
        "service_role_table_acl_expected(table_name, expected_privileges)",
      );
      expect(sql).toContain("count(*) = 14 AND bool_and(");
      expect(sql).toContain("privilege_row.is_grantable");
      expect(sql).toContain("grantor.rolname = 'postgres'");
      expect(sql).toContain("'MAINTAIN'");
    }

    expect(ship).toContain('Version = "20260713122000"');
    expect(ship).toContain(
      'Replaceable = "service_role_table_acl_replaceable"',
    );
    expect(ship).toContain('Exact = "service_role_table_acl_exact"');
    expect(ship).toContain(
      "$Contract.service_role_table_acl_exact -ne $true",
    );
  });
});
