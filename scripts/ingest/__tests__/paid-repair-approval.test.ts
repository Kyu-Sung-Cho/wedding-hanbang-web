import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertFailedUnitRepairApprovalMatches,
  createFailedUnitRepairApproval,
  failedUnitRepairApprovalPath,
  readFailedUnitRepairApproval,
  validateFailedUnitRepairApproval,
  writeFailedUnitRepairApproval,
  type CreateFailedUnitRepairApprovalInput,
} from "../paid-repair-approval.js";
import {
  createFixedEightPaidExtractionPlanApproval,
  writeFixedEightPaidExtractionPlanApproval,
  type CreatePaidExtractionPlanApprovalInput,
} from "../paid-extraction-plan.js";
import { canonicalSha256 } from "../gate-integrity.js";
import {
  FIXED_EIGHT_BLOCKING_UNIT_IDS,
  FIXED_EIGHT_NON_BLOCKING_UNIT_IDS,
  FIXED_EIGHT_ORDERED_UNIT_IDS,
} from "../pilot-pass-receipt.js";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function priorPlanInput(): CreatePaidExtractionPlanApprovalInput {
  return {
    executionDomain: {
      domain_id: "33333333-3333-4333-8333-333333333333",
      authority_root_realpath: path.resolve(os.tmpdir(), "repair-authority"),
      authoritative_state_dir_realpath: path.resolve(os.tmpdir(), "repair-state"),
      genesis_ledger: {
        relative_path: ".cache/ai-ledger.ndjson",
        content_sha256: digest(""),
        byte_count: 0,
        row_count: 0,
        cumulative_cost_usd: 0,
      },
    },
    model: "gpt-5.6-luna",
    scannerParserVersion: "scanner-prior",
    authorizedCostCeilingUsd: 20,
    priorDurableLedger: {
      relative_path: ".cache/ai-ledger.ndjson",
      content_sha256: digest(""),
      byte_count: 0,
      row_count: 0,
      cumulative_cost_usd: 0,
    },
    units: FIXED_EIGHT_ORDERED_UNIT_IDS.map((unitId, index) => ({
      unitId,
      sourceFingerprint: digest(`source:${index}`),
      artifactFingerprint: digest(`conversion:${index}`),
      converterVersion: "converter-prior",
      requestHashes: [digest(`prior-request:${index}:0`), digest(`prior-request:${index}:1`)],
      estimatedInputTokens: 2_000 + index,
      estimatedOutputTokens: 400 + index,
      maximumInputTokens: 4_000 + index,
      maximumOutputTokens: 1_000 + index,
    })),
  };
}

async function createEvidence(
  stateDir: string,
  failedBlockingUnitIds: readonly string[] = [
    FIXED_EIGHT_BLOCKING_UNIT_IDS[0],
    FIXED_EIGHT_BLOCKING_UNIT_IDS[2],
  ],
): Promise<{
  plan: ReturnType<typeof createFixedEightPaidExtractionPlanApproval>;
  score: Record<string, unknown>;
  scoreContent: string;
  scoreRelativePath: string;
  scoreSha256: string;
}> {
  const plan = createFixedEightPaidExtractionPlanApproval(priorPlanInput());
  await writeFixedEightPaidExtractionPlanApproval(stateDir, plan);
  const score = {
    schema_version: 1,
    generated_at: "2026-07-20T01:02:03.004Z",
    verification: {
      mode: "strict_validated_artifacts",
      validated_artifacts_required: true,
      deterministic_artifact_paths_required: true,
      artifact_content_hashes_required: true,
      paid_plan_sha256: plan.plan_sha256,
    },
    gate: {
      status: "fail",
      verification_mode: "strict_validated_artifacts",
      validated_artifacts_required: true,
      eligible_for_25_unit_batch: false,
      blocking_unit_ids: [...FIXED_EIGHT_BLOCKING_UNIT_IDS],
      non_blocking_unit_ids: [...FIXED_EIGHT_NON_BLOCKING_UNIT_IDS],
      blocking_passed_units: 7 - failedBlockingUnitIds.length,
      blocking_failed_units: failedBlockingUnitIds.length,
      blocking_blocked_units: 0,
    },
    units: plan.payload.units.map((planUnit, index) => {
      const failed = failedBlockingUnitIds.includes(planUnit.unit_id);
      return {
        unit_id: planUnit.unit_id,
        prompt_version: plan.payload.prompt_version,
        model: plan.payload.model,
        status: failed ? "fail" : "pass",
        price_gate: { passed: !failed },
        provenance: {
          paid_plan_sha256: plan.plan_sha256,
          source_fingerprint: planUnit.source_fingerprint,
          conversion_fingerprint: planUnit.artifact_fingerprint,
          extraction_fingerprint: digest(`extraction:${index}`),
          extraction_content_sha256: digest(`extraction-content:${index}`),
          validation_fingerprint: digest(`validation:${index}`),
          validation_content_sha256: digest(`validation-content:${index}`),
          model: plan.payload.model,
          prompt_version: plan.payload.prompt_version,
          prompt_hash: plan.payload.prompt_hash,
          processing_version: plan.payload.processing_version,
          scanner_parser_version: plan.payload.scanner_parser_version,
          converter_version: planUnit.converter_version,
          request_hashes: [...planUnit.request_hashes],
        },
      };
    }),
  };
  const scoreContent = `${JSON.stringify(score, null, 2)}\n`;
  const scoreRelativePath = "scoring/score-2026-07-20T01-02-03-004Z.json";
  await mkdir(path.join(stateDir, "scoring"), { recursive: true });
  await writeFile(path.join(stateDir, ...scoreRelativePath.split("/")), scoreContent, "utf8");
  return {
    plan,
    score,
    scoreContent,
    scoreRelativePath,
    scoreSha256: digest(scoreContent),
  };
}

function repairInput(
  stateDir: string,
  evidence: Awaited<ReturnType<typeof createEvidence>>,
): CreateFailedUnitRepairApprovalInput {
  const selectedUnitId = FIXED_EIGHT_BLOCKING_UNIT_IDS[2];
  const priorUnit = evidence.plan.payload.units.find((unit) => unit.unit_id === selectedUnitId);
  assert.ok(priorUnit);
  return {
    stateDir,
    priorPlanSha256: evidence.plan.plan_sha256,
    priorScoreReportRelativePath: evidence.scoreRelativePath,
    expectedPriorScoreReportSha256: evidence.scoreSha256,
    expectedFailedBlockingUnitIds: [
      FIXED_EIGHT_BLOCKING_UNIT_IDS[0],
      FIXED_EIGHT_BLOCKING_UNIT_IDS[2],
    ],
    selectedUnitIds: [selectedUnitId],
    model: "gpt-5.6-terra",
    scannerParserVersion: "scanner-current",
    authorizedCostCeilingUsd: 2,
    units: [{
      unitId: selectedUnitId,
      sourceFingerprint: priorUnit.source_fingerprint,
      artifactFingerprint: priorUnit.artifact_fingerprint,
      converterVersion: priorUnit.converter_version,
      requestHashes: [digest("repair-request:2:0"), digest("repair-request:2:1")],
      estimatedInputTokens: 3_000,
      estimatedOutputTokens: 500,
      maximumInputTokens: 5_000,
      maximumOutputTokens: 1_500,
    }],
  };
}

test("repair approval binds prior exact-eight evidence and permits only an ordered subset of failed blocking units", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-repair-approval-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const evidence = await createEvidence(stateDir);
  const approval = await createFailedUnitRepairApproval(repairInput(stateDir, evidence));

  assert.equal(approval.approval_sha256, canonicalSha256(approval.payload));
  assert.equal(approval.payload.prior_plan_sha256, evidence.plan.plan_sha256);
  assert.equal(approval.payload.prior_score_report.sha256, evidence.scoreSha256);
  assert.equal(approval.payload.prior_score_report.relative_path, evidence.scoreRelativePath);
  assert.deepEqual(approval.payload.prior_score_report.failed_blocking_unit_ids, [
    FIXED_EIGHT_BLOCKING_UNIT_IDS[0],
    FIXED_EIGHT_BLOCKING_UNIT_IDS[2],
  ]);
  assert.deepEqual(approval.payload.ordered_unit_ids, [FIXED_EIGHT_BLOCKING_UNIT_IDS[2]]);
  assert.equal(approval.payload.units[0]?.source_fingerprint, evidence.plan.payload.units[2]?.source_fingerprint);
  assert.equal(approval.payload.cost.request_count, 2);
  assert.ok(approval.payload.cost.maximum_cost_usd <= approval.payload.cost.authorized_ceiling_usd);
  assert.doesNotMatch(JSON.stringify(approval), /stateDir|absolute|OPENAI_API_KEY|\\Users\\/u);
});

test("repair approval rejects passed units, hidden failures, duplicate/reordered selection, and source drift", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-repair-selection-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const evidence = await createEvidence(stateDir);

  const hiddenFailure = repairInput(stateDir, evidence);
  hiddenFailure.expectedFailedBlockingUnitIds = [FIXED_EIGHT_BLOCKING_UNIT_IDS[2]];
  await assert.rejects(
    createFailedUnitRepairApproval(hiddenFailure),
    /explicit failed blocking unit IDs/u,
  );

  const passedUnit = repairInput(stateDir, evidence);
  const passedUnitPlan = evidence.plan.payload.units[1];
  assert.ok(passedUnitPlan);
  passedUnit.selectedUnitIds = [passedUnitPlan.unit_id];
  passedUnit.units = [{
    ...passedUnit.units[0]!,
    unitId: passedUnitPlan.unit_id,
    sourceFingerprint: passedUnitPlan.source_fingerprint,
    artifactFingerprint: passedUnitPlan.artifact_fingerprint,
  }];
  await assert.rejects(createFailedUnitRepairApproval(passedUnit), /only actually failed/u);

  const duplicateSelection = repairInput(stateDir, evidence);
  duplicateSelection.selectedUnitIds = [
    FIXED_EIGHT_BLOCKING_UNIT_IDS[2],
    FIXED_EIGHT_BLOCKING_UNIT_IDS[2],
  ];
  duplicateSelection.units = [duplicateSelection.units[0]!, duplicateSelection.units[0]!];
  await assert.rejects(createFailedUnitRepairApproval(duplicateSelection), /unique and retain/u);

  const sourceDrift = repairInput(stateDir, evidence);
  sourceDrift.units[0]!.sourceFingerprint = digest("different-source");
  await assert.rejects(createFailedUnitRepairApproval(sourceDrift), /source\/conversion provenance/u);
});

test("repair approval fails closed when strict score provenance, plan binding, or artifact bytes are missing", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-repair-provenance-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const evidence = await createEvidence(stateDir);
  const scorePath = path.join(stateDir, ...evidence.scoreRelativePath.split("/"));
  const rawScore = structuredClone(evidence.score) as {
    verification: { paid_plan_sha256?: string };
    units: Array<{ provenance?: unknown }>;
  };
  delete rawScore.units[0]!.provenance;
  const missingProvenanceContent = `${JSON.stringify(rawScore, null, 2)}\n`;
  await writeFile(scorePath, missingProvenanceContent, "utf8");
  const missingProvenance = repairInput(stateDir, evidence);
  missingProvenance.expectedPriorScoreReportSha256 = digest(missingProvenanceContent);
  await assert.rejects(createFailedUnitRepairApproval(missingProvenance), /provenance|invalid_type/iu);

  await writeFile(scorePath, evidence.scoreContent, "utf8");
  const wrongHash = repairInput(stateDir, evidence);
  wrongHash.expectedPriorScoreReportSha256 = digest("wrong-score");
  await assert.rejects(createFailedUnitRepairApproval(wrongHash), /content SHA-256/u);

  const wrongPlanBindingScore = structuredClone(evidence.score) as {
    verification: { paid_plan_sha256: string };
  };
  wrongPlanBindingScore.verification.paid_plan_sha256 = digest("other-plan");
  const wrongPlanContent = `${JSON.stringify(wrongPlanBindingScore, null, 2)}\n`;
  await writeFile(scorePath, wrongPlanContent, "utf8");
  const wrongPlan = repairInput(stateDir, evidence);
  wrongPlan.expectedPriorScoreReportSha256 = digest(wrongPlanContent);
  await assert.rejects(createFailedUnitRepairApproval(wrongPlan), /does not bind the prior/u);

  await rm(path.join(stateDir, "paid-extraction-plans", `${evidence.plan.plan_sha256}.json`));
  await assert.rejects(createFailedUnitRepairApproval(wrongPlan), /ENOENT|no such file/iu);
});

test("approval validation rejects self-rehashed forged scope and unchanged failed requests", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-repair-forgery-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const evidence = await createEvidence(stateDir);
  const input = repairInput(stateDir, evidence);
  const approval = await createFailedUnitRepairApproval(input);

  const forged = structuredClone(approval);
  forged.payload.ordered_unit_ids = [FIXED_EIGHT_BLOCKING_UNIT_IDS[1]];
  forged.approval_sha256 = canonicalSha256(forged.payload);
  assert.throws(() => validateFailedUnitRepairApproval(forged), /only actually failed|unit details/u);

  const unchanged = repairInput(stateDir, evidence);
  const selectedPrior = evidence.plan.payload.units[2];
  assert.ok(selectedPrior);
  unchanged.model = evidence.plan.payload.model;
  unchanged.units[0]!.requestHashes = [...selectedPrior.request_hashes];
  await assert.rejects(createFailedUnitRepairApproval(unchanged), /repay the unchanged/u);
});

test("content-addressed repair approval is readable and exact-match validation detects current drift", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-repair-publish-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const evidence = await createEvidence(stateDir);
  const input = repairInput(stateDir, evidence);
  const approval = await createFailedUnitRepairApproval(input);
  const outputPath = await writeFailedUnitRepairApproval(stateDir, approval);

  assert.equal(outputPath, failedUnitRepairApprovalPath(stateDir, approval.approval_sha256));
  assert.deepEqual(
    await readFailedUnitRepairApproval(stateDir, approval.approval_sha256),
    approval,
  );
  assert.equal(await writeFailedUnitRepairApproval(stateDir, approval), outputPath);
  assert.deepEqual(
    await assertFailedUnitRepairApprovalMatches(approval, input, approval.approval_sha256),
    approval,
  );

  const requestDrift = structuredClone(input);
  requestDrift.units[0]!.requestHashes[0] = digest("new-current-request");
  await assert.rejects(
    assertFailedUnitRepairApprovalMatches(approval, requestDrift, approval.approval_sha256),
    /no longer matches/u,
  );

  await writeFile(outputPath, JSON.stringify(approval), "utf8");
  await assert.rejects(
    writeFailedUnitRepairApproval(stateDir, approval),
    /bytes do not match/u,
  );
  await writeFile(outputPath, `${JSON.stringify(approval, null, 2)}\n`, "utf8");

  const stored = JSON.parse(await readFile(outputPath, "utf8"));
  stored.payload.units[0].request_hashes[0] = digest("tampered-stored-request");
  await writeFile(outputPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  await assert.rejects(
    readFailedUnitRepairApproval(stateDir, approval.approval_sha256),
    /SHA-256/u,
  );
});
