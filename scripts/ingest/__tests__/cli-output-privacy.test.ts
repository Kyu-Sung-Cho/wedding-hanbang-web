import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  formatIngestCliFailure,
  ingestCliErrorCode,
  summarizeIngestStatus,
  summarizeScoreReport,
} from "../cli-output.js";
import type { IngestStatus } from "../status.js";

function fixtureStatus(): IngestStatus {
  const stages = {
    scanned: 0,
    converted: 0,
    needs_manual_conversion: 0,
    extracted: 0,
    validated: 0,
    loaded: 0,
    error: 1,
  };
  return {
    total_units: 1,
    durable_by_stage: { ...stages },
    current_by_stage: { ...stages },
    stale_by_stage: { ...stages },
    durable_manual_source_files: 0,
    durable_failed_units: 1,
    historical_pending_review_units: 0,
    current_pending_review_units: 0,
    current_strict_load_eligible_units: 0,
    historical_extraction_input_tokens: 0,
    historical_extraction_output_tokens: 0,
    durable_ledger_estimated_cost_usd: 0,
    durable_local_extracted_units: 0,
    current_local_extracted_units: 0,
    durable_local_validated_units: 0,
    current_local_validated_units: 0,
    current_local_review_load_eligible_units: 0,
    historical_local_extraction_input_tokens: 0,
    historical_local_extraction_output_tokens: 0,
    durable_local_extraction_cost_usd: 0,
    historical_validation_issues: 0,
    current_validation_issues: 0,
    failed_unit_details: [{
      unit_id: "private-linkable-unit-identifier",
      error_codes: ["extract_failed"],
    }],
  };
}

test("ingest status CLI summary keeps counts but removes unit identifiers", () => {
  const summary = summarizeIngestStatus(fixtureStatus());
  const serialized = JSON.stringify(summary);
  assert.equal(summary.failed_error_code_counts.extract_failed, 1);
  assert.doesNotMatch(serialized, /private-linkable-unit-identifier/u);
  assert.doesNotMatch(serialized, /failed_unit_details/u);
});

test("score CLI summary removes paths, identities, detailed units, and raw payload fields", () => {
  const secret = "must-never-enter-cli-output";
  const summary = summarizeScoreReport({
    schema_version: 1,
    verification: {
      mode: "strict_validated_artifacts",
      validated_artifacts_required: true,
      paid_plan_sha256: "a".repeat(64),
      provider_response: { access_token: secret },
    },
    ground_truth: {
      path: `C:\\private\\${secret}.json`,
      inventory_occurrences: 2,
      adjudication: {
        path: `C:\\private\\${secret}-adjudication.json`,
        verified_decisions: 1,
      },
    },
    gate: {
      status: "blocked",
      blocking_unit_ids: ["12345678-1234-4234-8234-123456789abc"],
      non_blocking_unit_ids: ["linkable-unit"],
      blocked_units: 1,
    },
    units: [{
      display_name: "private vendor",
      email: "person@example.com",
      raw_response: secret,
    }],
  });
  const serialized = JSON.stringify(summary);
  assert.equal(summary.unit_result_count, 1);
  assert.equal(summary.unit_results_redacted, true);
  assert.equal(
    (summary.verification as Record<string, unknown>).paid_plan_sha256,
    "[redacted]",
  );
  assert.doesNotMatch(
    serialized,
    /must-never|private vendor|person@example\.com|12345678|linkable-unit|C:\\private/u,
  );
});

test("ingest failures expose only fixed diagnostic codes", () => {
  const secret = "Bearer must-never-enter-cli-output";
  const unexpected = new Error(`provider failed: ${secret}`);
  assert.equal(ingestCliErrorCode(unexpected), "INGEST_OPERATION_FAILED");
  assert.equal(formatIngestCliFailure(unexpected), "INGEST_BLOCKED [INGEST_OPERATION_FAILED]\n");
  assert.doesNotMatch(formatIngestCliFailure(unexpected), /must-never|Bearer/u);
  assert.equal(
    ingestCliErrorCode(new Error("paid_openai_cli_disabled: ignored detail")),
    "PAID_OPENAI_CLI_DISABLED",
  );
});

test("the real ingest CLI never echoes a secret-bearing invalid command", () => {
  const secret = "Bearer-must-never-enter-cli-output";
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", path.resolve("scripts/ingest/index.ts"), `unknown_${secret}`],
    { cwd: path.resolve(), encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^INGEST_BLOCKED \[INGEST_OPERATION_FAILED\]\r?\n$/u);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /must-never|Bearer/u);
});

test("ingest executable output boundaries do not print raw errors or whole result objects", async () => {
  const root = path.resolve("scripts/ingest");
  const files = [
    "build-fixed-eight-ground-truth.ts",
    "compile-adjudication.ts",
    "index.ts",
    "price-demo-seed.ts",
  ];
  for (const file of files) {
    const source = await readFile(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /error\.stack|String\(error\)/u, file);
    assert.doesNotMatch(
      source,
      /process\.stderr\.write\([\s\S]{0,200}error\.message/u,
      file,
    );
    assert.doesNotMatch(
      source,
      /(?:process\.stdout\.write|console\.log)\([\s\S]{0,120}JSON\.stringify\((?:result|report|value)\b/u,
      file,
    );
  }

  const indexSource = await readFile(path.join(root, "index.ts"), "utf8");
  assert.doesNotMatch(indexSource, /target_project_ref:\s*(?:result|prepared)/u);
  assert.doesNotMatch(indexSource, /print\(\{[\s\S]{0,160}\.\.\.result/u);

  const statusSource = await readFile(path.join(root, "status.ts"), "utf8");
  const formatterStart = statusSource.indexOf("export function formatIngestStatus");
  const formatterEnd = statusSource.indexOf("export async function getIngestStatus");
  const formatter = statusSource.slice(formatterStart, formatterEnd);
  assert.doesNotMatch(formatter, /detail\.unit_id/u);
});
