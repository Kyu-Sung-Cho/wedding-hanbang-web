import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const readRootFile = (path: string) => readFileSync(resolve(root, path), "utf8");

const courtBase = readRootFile(
  "supabase/migrations/20260713110000_create_couple_court.sql",
);
const serviceOnlyFunctions = readRootFile(
  "supabase/migrations/20260711145000_lock_service_only_function_acl.sql",
);
const handoff = readRootFile(
  "supabase/migrations/20260714100000_preserve_court_provider_audit_on_graph_deletion.sql",
);
const operations = readRootFile(
  "supabase/migrations/20260714102000_operationalize_court_provider_deletion_handoffs.sql",
);
const revealAudit = readRootFile(
  "supabase/migrations/20260714103000_audit_court_provider_handoff_reveals.sql",
);
const preflight = readRootFile("scripts/sql/supabase-production-preflight.sql");
const postDeploy = readRootFile("scripts/sql/supabase-post-deploy-contract.sql");
const cronPreflight = readRootFile(
  "scripts/sql/supabase-dependency-cron-preflight.sql",
);
const safeShip = readRootFile("scripts/supabase-ship-safe.ps1");

type FunctionContract = {
  source: string;
  sourceName: string;
  signature: string;
  sourceMd5: string;
};

const functionContracts: FunctionContract[] = [
  {
    source: handoff,
    sourceName: "settle_court_provider_failure_internal",
    signature: "public.settle_court_provider_failure_internal(uuid,text)",
    sourceMd5: "7e2fb50315c4552e2048c0fe17db370a",
  },
  {
    source: handoff,
    sourceName: "settle_court_provider_failure",
    signature: "public.settle_court_provider_failure(uuid,text)",
    sourceMd5: "f31008554a1e23b840674bbcfd634a0a",
  },
  {
    source: handoff,
    sourceName: "handoff_court_provider_attempts_before_case_delete",
    signature: "public.handoff_court_provider_attempts_before_case_delete()",
    sourceMd5: "4a60d39c0e0059451559e46d8bd9837b",
  },
  {
    source: courtBase,
    sourceName: "settle_court_unstaged_provider_result",
    signature:
      "public.settle_court_unstaged_provider_result_live(uuid,uuid,text,text,text,integer,integer,integer,integer)",
    sourceMd5: "86f7199746ac3fb7d19b12c629b7c5e2",
  },
  {
    source: handoff,
    sourceName: "settle_court_unstaged_provider_result",
    signature:
      "public.settle_court_unstaged_provider_result(uuid,uuid,text,text,text,integer,integer,integer,integer)",
    sourceMd5: "55e200a85ab23811e1de8ac0f699bb0f",
  },
  {
    source: courtBase,
    sourceName: "settle_court_high_risk_provider_result",
    signature:
      "public.settle_court_high_risk_provider_result_live(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)",
    sourceMd5: "df11c175cf296be4faeb8918eb5ba589",
  },
  {
    source: handoff,
    sourceName: "settle_court_high_risk_provider_result",
    signature:
      "public.settle_court_high_risk_provider_result(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)",
    sourceMd5: "c25632c52a04e56677ced9e0629f8c1e",
  },
  {
    source: courtBase,
    sourceName: "write_court_provider_audit",
    signature: "public.write_court_provider_audit_live(text,jsonb,numeric)",
    sourceMd5: "58e16d0d0323e86cb6b132f7fa7dc62e",
  },
  {
    source: handoff,
    sourceName: "write_court_provider_audit",
    signature: "public.write_court_provider_audit(text,jsonb,numeric)",
    sourceMd5: "4ee8cc03e1b68332882856c0ea2fb6e0",
  },
  {
    source: courtBase,
    sourceName: "finalize_court_provider_audit",
    signature: "public.finalize_court_provider_audit_live(uuid,text)",
    sourceMd5: "179562b354f34b518327b1228d0baa1e",
  },
  {
    source: handoff,
    sourceName: "finalize_court_provider_audit",
    signature: "public.finalize_court_provider_audit(uuid,text)",
    sourceMd5: "948e284af8b1991a25c3eda178bed604",
  },
  {
    source: courtBase,
    sourceName: "claim_court_provider_audit_recovery",
    signature: "public.claim_court_provider_audit_recovery_live(uuid,integer)",
    sourceMd5: "41b7ea2a658a52bccb3e37795281128d",
  },
  {
    source: operations,
    sourceName: "claim_court_provider_audit_recovery",
    signature: "public.claim_court_provider_audit_recovery(uuid,integer)",
    sourceMd5: "36340ba20f40fd6f8cab0491d03990ec",
  },
  {
    source: courtBase,
    sourceName: "record_court_provider_audit_recovery_failure",
    signature:
      "public.record_court_provider_audit_recovery_failure_live(uuid,uuid,uuid,text)",
    sourceMd5: "e01e0ecec59db41b376271c68973a312",
  },
  {
    source: operations,
    sourceName: "record_court_provider_audit_recovery_failure",
    signature:
      "public.record_court_provider_audit_recovery_failure(uuid,uuid,uuid,text)",
    sourceMd5: "4ad83a53a4a60dee093fab369d520c4f",
  },
  {
    source: operations,
    sourceName: "resolve_court_provider_deletion_handoff",
    signature:
      "public.resolve_court_provider_deletion_handoff(uuid,uuid,text,text,text,integer,integer,integer,integer,numeric)",
    sourceMd5: "7c774ec3289924fcae465251e8c18d0b",
  },
  {
    source: operations,
    sourceName: "enforce_court_provider_deletion_handoff_retention",
    signature:
      "public.enforce_court_provider_deletion_handoff_retention(integer)",
    sourceMd5: "605f4f2ccf181a0de3861ad819a7dcb7",
  },
  {
    source: serviceOnlyFunctions,
    sourceName: "enforce_ai_interaction_retention",
    signature: "public.enforce_ai_interaction_retention_live()",
    sourceMd5: "85cb9b5ccafca3cca9b3cdf74ee4eddc",
  },
  {
    source: operations,
    sourceName: "enforce_ai_interaction_retention",
    signature: "public.enforce_ai_interaction_retention()",
    sourceMd5: "806dc01af7ffe1047f9ffd381bf539c2",
  },
  {
    source: serviceOnlyFunctions,
    sourceName: "redact_old_ai_interactions",
    signature: "public.redact_old_ai_interactions(interval)",
    sourceMd5: "571f7b3674ee36b941bb19064f8b1cb0",
  },
  {
    source: revealAudit,
    sourceName: "list_court_provider_deletion_handoffs",
    signature: "public.list_court_provider_deletion_handoffs(uuid,integer)",
    sourceMd5: "f3b9c678533ed27570420f01fb50d190",
  },
  {
    source: revealAudit,
    sourceName: "list_court_provider_reconciliations",
    signature: "public.list_court_provider_reconciliations(uuid,integer)",
    sourceMd5: "6455d31459a942fce5bb88bcf35cb5bc",
  },
  {
    source: revealAudit,
    sourceName: "reveal_court_provider_deletion_handoff_request_key",
    signature:
      "public.reveal_court_provider_deletion_handoff_request_key(uuid,uuid,text)",
    sourceMd5: "6a91b7a0a9c3a0191a7d87b7b5623d37",
  },
  {
    source: revealAudit,
    sourceName: "reveal_court_provider_reconciliation_request_key",
    signature:
      "public.reveal_court_provider_reconciliation_request_key(uuid,uuid,text)",
    sourceMd5: "658c9c2eadfc38e07fcbffc536a6c443",
  },
  {
    source: revealAudit,
    sourceName: "enforce_court_provider_request_key_reveal_audit_retention",
    signature:
      "public.enforce_court_provider_request_key_reveal_audit_retention(integer)",
    sourceMd5: "e87a1188dffd2880a2291c2e5005524b",
  },
];

function extractFunctionBody(source: string, functionName: string): string {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION public\\.${escapedName}\\s*\\(`,
    "u",
  );
  const start = source.search(marker);
  expect(start, `missing function ${functionName}`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("AS $$", start);
  const bodyEnd = source.indexOf("$$;", bodyStart + "AS $$".length);
  expect(bodyStart, `missing body for ${functionName}`).toBeGreaterThan(start);
  expect(bodyEnd, `missing body end for ${functionName}`).toBeGreaterThan(
    bodyStart,
  );
  return source.slice(bodyStart + "AS $$".length, bodyEnd).replace(/\r/gu, "");
}

function digest(algorithm: "md5" | "sha256", value: string): string {
  return createHash(algorithm).update(value.replace(/\r/gu, "")).digest("hex");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("Court provider deletion-handoff release contracts", () => {
  it("pins the immutable release migrations", () => {
    expect(digest("sha256", handoff)).toBe(
      "c18144a131ef1f5f267887d085aaf5dae07a8232c31fd472d27b9e42f46fcdfb",
    );
    expect(digest("sha256", operations)).toBe(
      "79d90c550301c9efbd13c182453b469524439af0ab8d2b66c14896844f5a8140",
    );
    expect(digest("sha256", revealAudit)).toBe(
      "79b673fd6270b39aa61114b5f0f731a263686fb9b3f31cd546e13639e0828308",
    );
  });

  it("derives every provider function hash from migration source", () => {
    for (const contract of functionContracts) {
      expect(
        digest("md5", extractFunctionBody(contract.source, contract.sourceName)),
        contract.signature,
      ).toBe(contract.sourceMd5);
    }
  });

  it("keeps production preflight and post-deploy function contracts synchronized", () => {
    for (const contract of functionContracts) {
      const exactRow = new RegExp(
        `${escapeRegex(contract.signature)}[\\s\\S]{0,700}${contract.sourceMd5}`,
        "u",
      );
      expect(preflight, contract.signature).toMatch(exactRow);
      expect(postDeploy, contract.signature).toMatch(exactRow);
    }
  });

  it("fences non-idempotent creators and exact live-body renames before writes", () => {
    const creatorMustBeAbsent = [
      "public.settle_court_provider_failure_internal(uuid,text)",
      "public.settle_court_unstaged_provider_result_live(uuid,uuid,text,text,text,integer,integer,integer,integer)",
      "public.settle_court_high_risk_provider_result_live(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)",
      "public.write_court_provider_audit_live(text,jsonb,numeric)",
      "public.finalize_court_provider_audit_live(uuid,text)",
      "public.claim_court_provider_audit_recovery_live(uuid,integer)",
      "public.record_court_provider_audit_recovery_failure_live(uuid,uuid,uuid,text)",
      "public.enforce_ai_interaction_retention_live()",
      "public.resolve_court_provider_deletion_handoff(uuid,uuid,text,text,text,integer,integer,integer,integer,numeric)",
      "public.enforce_court_provider_deletion_handoff_retention(integer)",
      "public.list_court_provider_deletion_handoffs(uuid,integer)",
      "public.list_court_provider_reconciliations(uuid,integer)",
      "public.reveal_court_provider_deletion_handoff_request_key(uuid,uuid,text)",
      "public.reveal_court_provider_reconciliation_request_key(uuid,uuid,text)",
      "public.enforce_court_provider_request_key_reveal_audit_retention(integer)",
    ];
    const preservedSources = [
      [
        "public.settle_court_unstaged_provider_result(uuid,uuid,text,text,text,integer,integer,integer,integer)",
        "86f7199746ac3fb7d19b12c629b7c5e2",
      ],
      [
        "public.settle_court_high_risk_provider_result(uuid,uuid,uuid,text,text,text[],text,integer,integer,integer,integer)",
        "df11c175cf296be4faeb8918eb5ba589",
      ],
      [
        "public.write_court_provider_audit(text,jsonb,numeric)",
        "58e16d0d0323e86cb6b132f7fa7dc62e",
      ],
      [
        "public.finalize_court_provider_audit(uuid,text)",
        "179562b354f34b518327b1228d0baa1e",
      ],
      [
        "public.claim_court_provider_audit_recovery(uuid,integer)",
        "41b7ea2a658a52bccb3e37795281128d",
      ],
      [
        "public.record_court_provider_audit_recovery_failure(uuid,uuid,uuid,text)",
        "e01e0ecec59db41b376271c68973a312",
      ],
      [
        "public.enforce_ai_interaction_retention()",
        "85cb9b5ccafca3cca9b3cdf74ee4eddc",
      ],
      [
        "public.redact_old_ai_interactions(interval)",
        "571f7b3674ee36b941bb19064f8b1cb0",
      ],
    ] as const;
    const requirementStart = preflight.indexOf(
      "dependency_function_migration_requirements(",
    );
    const requirementEnd = preflight.indexOf(
      "dependency_function_status AS (",
      requirementStart,
    );
    expect(requirementStart).toBeGreaterThanOrEqual(0);
    expect(requirementEnd).toBeGreaterThan(requirementStart);
    const requirements = preflight.slice(requirementStart, requirementEnd);

    for (const signature of creatorMustBeAbsent) {
      expect(requirements, signature).toMatch(
        new RegExp(`${escapeRegex(signature)}[\\s\\S]{0,80}true, false`, "u"),
      );
    }
    for (const [signature, sourceMd5] of preservedSources) {
      expect(requirements, signature).toMatch(
        new RegExp(
          `${escapeRegex(signature)}[\\s\\S]{0,100}false, true[\\s\\S]{0,80}${sourceMd5}`,
          "u",
        ),
      );
    }

    expect(preflight).toContain("END AS pre_forward_exact");
    expect(preflight).toContain(
      "'public.handoff_court_provider_attempts_before_case_delete()'\n           AS creator_requires_absence",
    );
    expect(preflight).toContain(
      "'court_case_provider_handoff_before_delete'\n           AS creator_requires_absence",
    );
    for (const marker of [
      "$status.forward_requires_presence -eq $true",
      "$status.pre_forward_exact -ne $true",
      "$status.creator_requires_absence -eq $true",
    ]) {
      expect(safeShip).toContain(marker);
    }
  });

  it("gates every table stage with the final least-privilege ACL", () => {
    for (const contract of [preflight, postDeploy]) {
      const fragmentContractStart = contract.indexOf(
        "court_provider_required_constraint_fragments(",
      );
      const fragmentContractEnd = contract.indexOf(
        "court_provider_required_named_indexes(",
        fragmentContractStart,
      );
      const fragmentStatusStart = contract.indexOf(
        "FROM court_provider_required_constraint_fragments expected",
      );
      const fragmentStatusEnd = contract.indexOf(
        "AND (SELECT count(*) FROM pg_catalog.pg_index",
        fragmentStatusStart,
      );
      expect(fragmentContractStart).toBeGreaterThanOrEqual(0);
      expect(fragmentContractEnd).toBeGreaterThan(fragmentContractStart);
      expect(fragmentStatusStart).toBeGreaterThanOrEqual(0);
      expect(fragmentStatusEnd).toBeGreaterThan(fragmentStatusStart);
      const fragmentContract = contract.slice(
        fragmentContractStart,
        fragmentContractEnd,
      );
      const fragmentStatus = contract.slice(
        fragmentStatusStart,
        fragmentStatusEnd,
      );

      expect(contract).toMatch(
        /\('handoff_1000',[\s\S]{0,180}\bfalse,/u,
      );
      expect(contract).toMatch(
        /\('handoff_1020',[\s\S]{0,180}\bfalse,/u,
      );
      expect(contract).toMatch(
        /\('handoff_1030',[\s\S]{0,180}\bfalse,/u,
      );
      expect(fragmentContract).toMatch(
        /'court_provider_deletion_handoffs_lifecycle_check',[\s\S]{0,180}\b2,\s*'20260714100000'/u,
      );
      expect(fragmentContract).toMatch(
        /'court_provider_deletion_handoffs_resolution_check',[\s\S]{0,180}\b1,\s*'20260714102000'/u,
      );
      expect(fragmentContract).toContain(
        "'audit_modelisnotnullandprovider_input_tokensisnotnullandprovider_output_tokensisnotnull'",
      );
      expect(contract).toContain(
        "'court_provider_deletion_handoffs_provider_cached_input_tokens_c'",
      );
      expect(contract).toContain(
        "'court_provider_deletion_handoffs_provider_cache_write_input_tok'",
      );
      expect(fragmentStatus).toContain(
        "expected.introduced_version <= stage.max_version",
      );
      expect(contract).toContain(
        "has_table_privilege('service_role', table_row.oid, 'SELECT')",
      );
      expect(contract).toMatch(
        /has_any_column_privilege\(\s*'service_role',\s*table_row\.oid,\s*'SELECT'\s*\)\s*=\s*stage\.expected_service_select/u,
      );
      expect(contract).toMatch(
        /'service_role',\s*table_row\.oid,\s*'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'/u,
      );
      expect(contract).toMatch(
        /has_any_column_privilege\(\s*'service_role',\s*table_row\.oid,\s*'INSERT,UPDATE,REFERENCES'\s*\)/u,
      );
    }
  });

  it("keeps both hourly retention jobs exact in all release gates", () => {
    const jobs = [
      [
        "enforce-court-provider-deletion-handoff-retention",
        "7 * * * *",
        "SELECT public.enforce_court_provider_deletion_handoff_retention(1000);",
      ],
      [
        "enforce-court-provider-request-key-reveal-audit-retention",
        "37 * * * *",
        "SELECT public.enforce_court_provider_request_key_reveal_audit_retention(1000);",
      ],
    ] as const;

    for (const contract of [preflight, cronPreflight, postDeploy]) {
      for (const [jobName, schedule, command] of jobs) {
        const exactJob = new RegExp(
          `${escapeRegex(jobName)}[\\s\\S]{0,160}${escapeRegex(schedule)}[\\s\\S]{0,240}${escapeRegex(command)}`,
          "u",
        );
        expect(contract, jobName).toMatch(exactJob);
      }
    }
  });
});
