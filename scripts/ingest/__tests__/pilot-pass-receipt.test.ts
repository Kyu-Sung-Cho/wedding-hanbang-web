import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FIXED_EIGHT_BLOCKING_UNIT_IDS,
  FIXED_EIGHT_GROUND_TRUTH_BINDING,
  FIXED_EIGHT_MAY_UNREADABLE_CELL_BINDINGS,
  FIXED_EIGHT_NON_BLOCKING_UNIT_IDS,
  FIXED_EIGHT_ORDERED_UNIT_IDS,
  createFixedEightPassReceipt,
  validateFixedEightPassReceipt,
  writeFixedEightPassReceipt,
} from "../pilot-pass-receipt.js";
import { canonicalSha256 } from "../gate-integrity.js";

const hash = (character: string): string => character.repeat(64);
const PLAN_SHA256 = hash("a");

function unitProvenance(unitId: string) {
  return {
    unit_id: unitId,
    paid_plan_sha256: PLAN_SHA256,
    source_fingerprint: hash("d"),
    conversion_fingerprint: hash("e"),
    extraction_fingerprint: hash("f"),
    extraction_content_sha256: hash("3"),
    validation_fingerprint: hash("4"),
    validation_content_sha256: hash("5"),
    model: "gpt-5.6-luna" as const,
    prompt_version: "prompt-v1",
    prompt_hash: hash("1"),
    processing_version: hash("2"),
    scanner_parser_version: "scanner-v1",
    converter_version: "converter-v1",
    request_hashes: [hash("6")],
  };
}

function scoreReport(overrides: Record<string, unknown> = {}): string {
  const units = FIXED_EIGHT_ORDERED_UNIT_IDS.map((unitId, index) => {
    const { unit_id: _unitId, ...provenance } = unitProvenance(unitId);
    const isMay = index === FIXED_EIGHT_ORDERED_UNIT_IDS.length - 1;
    return {
      unit_id: unitId,
      prompt_version: "prompt-v1",
      model: "gpt-5.6-luna",
      provenance,
      status: isMay ? "fail" : "pass",
      price_gate: {
        passed: !isMay,
        hallucinated_amounts: [],
        missing_readable_amounts: [],
        unsupported_structured_amounts: [],
        linking_errors: [],
        manual_linkage_reviews: [],
        blocking_validation_issues: [],
        unsafe_unreadable_extractions: [],
        actual_coverage_gaps: isMay ? [{ reason: "non-blocking image coverage review" }] : [],
      },
      semantic_gate: {
        required: true,
        passed: !isMay,
        expected_status: "captured",
        actual_status: isMay ? "missing" : "captured",
      },
      semantic_capture: {
        status: isMay ? "missing" : "captured",
        misses: isMay ? ["pricing_basis"] : [],
      },
      unreadable_cells: isMay
        ? FIXED_EIGHT_MAY_UNREADABLE_CELL_BINDINGS.map((binding) => ({
          source_locator: binding.source_locator,
          visible_amounts_krw: [...binding.visible_amounts_krw],
        }))
        : [],
      unreadable_handling: {
        any_needs_review: isMay,
        known_cell_dispositions: isMay
          ? FIXED_EIGHT_MAY_UNREADABLE_CELL_BINDINGS.map((binding) => ({
            source_locator: binding.source_locator,
            visible_amounts_krw: [...binding.visible_amounts_krw],
            needs_review: true,
            amounts_remain_unstructured: true,
          }))
          : [],
        all_known_cells_safely_disposed: true,
      },
    };
  });
  return `${JSON.stringify({
    schema_version: 1,
    generated_at: "2026-07-20T00:00:00.000Z",
    verification: {
      mode: "strict_validated_artifacts",
      validated_artifacts_required: true,
      paid_plan_sha256: PLAN_SHA256,
    },
    ground_truth: {
      sha256: FIXED_EIGHT_GROUND_TRUTH_BINDING.base_sha256,
      inventory_occurrences: FIXED_EIGHT_GROUND_TRUTH_BINDING.base_occurrences,
      base_readable_occurrences: FIXED_EIGHT_GROUND_TRUTH_BINDING.base_readable_occurrences,
      effective_readable_occurrences: FIXED_EIGHT_GROUND_TRUTH_BINDING.effective_readable_occurrences,
      overlay_sha256: FIXED_EIGHT_GROUND_TRUTH_BINDING.overlay_sha256,
      overlay_readable_occurrences: FIXED_EIGHT_GROUND_TRUTH_BINDING.overlay_readable_occurrences,
      unreadable_cells: FIXED_EIGHT_GROUND_TRUTH_BINDING.unreadable_cells,
      adjudication: {
        sha256: FIXED_EIGHT_GROUND_TRUTH_BINDING.adjudication_sha256,
        human_required_occurrences: FIXED_EIGHT_GROUND_TRUTH_BINDING.human_required_occurrences,
      },
    },
    gate: {
      status: "pass",
      verification_mode: "strict_validated_artifacts",
      validated_artifacts_required: true,
      eligible_for_25_unit_batch: true,
      blocking_unit_ids: FIXED_EIGHT_BLOCKING_UNIT_IDS,
      non_blocking_unit_ids: FIXED_EIGHT_NON_BLOCKING_UNIT_IDS,
      blocking_passed_units: 7,
      blocking_failed_units: 0,
      blocking_blocked_units: 0,
      criteria: {
        hallucinated_amounts: 0,
        missing_readable_amounts: 0,
        unsupported_structured_amounts: 0,
        linking_errors: 0,
        manual_linkage_reviews: 0,
        blocking_validation_issues: 0,
        actual_coverage_gaps: 0,
        unreadable_amounts_must_remain_unstructured: true,
      },
      semantic_criteria: {
        required_for_expected_units: true,
        required_status: "captured",
      },
    },
    units,
    ...overrides,
  }, null, 2)}\n`;
}

function validInput() {
  return {
    issuedAt: "2026-07-20T00:01:00.000Z",
    orderedUnitIds: [...FIXED_EIGHT_ORDERED_UNIT_IDS],
    nonBlockingUnitIds: [...FIXED_EIGHT_NON_BLOCKING_UNIT_IDS],
    units: FIXED_EIGHT_ORDERED_UNIT_IDS.map(unitProvenance),
    groundTruth: { ...FIXED_EIGHT_GROUND_TRUTH_BINDING },
    scoreReportContent: scoreReport(),
  };
}

test("a passing fixed-eight report produces a receipt that binds every immutable input", () => {
  const receipt = createFixedEightPassReceipt(validInput());

  assert.equal(receipt.schema_version, 2);
  assert.equal(receipt.kind, "fixed_eight_pilot_pass_receipt");
  assert.match(receipt.receipt_sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(receipt.payload.ordered_unit_ids, FIXED_EIGHT_ORDERED_UNIT_IDS);
  assert.deepEqual(receipt.payload.blocking_unit_ids, FIXED_EIGHT_BLOCKING_UNIT_IDS);
  assert.deepEqual(receipt.payload.non_blocking_unit_ids, FIXED_EIGHT_NON_BLOCKING_UNIT_IDS);
  assert.equal(receipt.payload.units[0]?.conversion_fingerprint, hash("e"));
  assert.equal(receipt.payload.units[0]?.extraction_content_sha256, hash("3"));
  assert.equal(receipt.payload.units[0]?.validation_fingerprint, hash("4"));
  assert.equal(receipt.payload.units[0]?.validation_content_sha256, hash("5"));
  assert.equal(receipt.payload.units[0]?.prompt_hash, hash("1"));
  assert.equal(receipt.payload.ground_truth.effective_readable_occurrences, 2_404);
  assert.equal(receipt.payload.score_report.status, "pass");
  assert.equal(receipt.payload.score_report.unit_statuses.at(-1)?.status, "fail");
  assert.equal(receipt.payload.score_report.unit_statuses.at(-1)?.semantic_gate_passed, false);
  assert.equal(receipt.payload.score_report.unit_statuses.at(-1)?.semantic_capture_status, "missing");
});

test("receipt issuance rejects selection drift, duplicate evidence, failed zero gates, and an unscoreable May unit", () => {
  const subset = validInput();
  subset.orderedUnitIds.pop();
  assert.throws(() => createFixedEightPassReceipt(subset), /fixed ordered unit IDs/u);

  const superset = validInput();
  (superset.orderedUnitIds as string[]).push(hash("9"));
  assert.throws(() => createFixedEightPassReceipt(superset), /fixed ordered unit IDs/u);

  const duplicateProvenance = validInput();
  duplicateProvenance.units[1] = duplicateProvenance.units[0]!;
  assert.throws(() => createFixedEightPassReceipt(duplicateProvenance), /pilot provenance/u);

  const missingScoreUnit = validInput();
  const missingReport = JSON.parse(missingScoreUnit.scoreReportContent) as { units: unknown[] };
  missingReport.units.pop();
  missingScoreUnit.scoreReportContent = JSON.stringify(missingReport);
  assert.throws(() => createFixedEightPassReceipt(missingScoreUnit), /score report units/u);

  const failedBlockingZeroGate = validInput();
  const failedReport = JSON.parse(failedBlockingZeroGate.scoreReportContent) as {
    units: Array<{ price_gate: { actual_coverage_gaps: unknown[] } }>;
  };
  failedReport.units[0]!.price_gate.actual_coverage_gaps.push({});
  failedBlockingZeroGate.scoreReportContent = JSON.stringify(failedReport);
  assert.throws(() => createFixedEightPassReceipt(failedBlockingZeroGate), /zero criterion/u);

  const blockingManualLinkageReview = validInput();
  const manualReviewReport = JSON.parse(blockingManualLinkageReview.scoreReportContent) as {
    units: Array<{ price_gate: { manual_linkage_reviews: unknown[] } }>;
  };
  manualReviewReport.units[0]!.price_gate.manual_linkage_reviews.push({ code: "visual_review" });
  blockingManualLinkageReview.scoreReportContent = JSON.stringify(manualReviewReport);
  assert.throws(() => createFixedEightPassReceipt(blockingManualLinkageReview), /zero criterion/u);

  const blockedMay = validInput();
  const blockedReport = JSON.parse(blockedMay.scoreReportContent) as {
    units: Array<{ status: string }>;
  };
  blockedReport.units[7]!.status = "blocked";
  blockedMay.scoreReportContent = JSON.stringify(blockedReport);
  assert.throws(() => createFixedEightPassReceipt(blockedMay), /May image unit must be scoreable/u);

  const unsafeMay = validInput();
  const unsafeMayReport = JSON.parse(unsafeMay.scoreReportContent) as {
    units: Array<{ price_gate: { unsafe_unreadable_extractions: unknown[] } }>;
  };
  unsafeMayReport.units[7]!.price_gate.unsafe_unreadable_extractions.push({ krw: 33_000 });
  unsafeMay.scoreReportContent = JSON.stringify(unsafeMayReport);
  assert.throws(() => createFixedEightPassReceipt(unsafeMay), /extracted a known unreadable amount/u);

  const unboundMay = validInput();
  const unboundMayReport = JSON.parse(unboundMay.scoreReportContent) as {
    units: Array<{ unreadable_cells: unknown[] }>;
  };
  unboundMayReport.units[7]!.unreadable_cells.pop();
  unboundMay.scoreReportContent = JSON.stringify(unboundMayReport);
  assert.throws(() => createFixedEightPassReceipt(unboundMay), /not bound to the two known unreadable cells/u);

  const undisposedMay = validInput();
  const undisposedMayReport = JSON.parse(undisposedMay.scoreReportContent) as {
    units: Array<{
      unreadable_handling: {
        all_known_cells_safely_disposed: boolean;
        known_cell_dispositions: Array<{ needs_review: boolean }>;
      };
    }>;
  };
  undisposedMayReport.units[7]!.unreadable_handling.all_known_cells_safely_disposed = false;
  undisposedMayReport.units[7]!.unreadable_handling.known_cell_dispositions[0]!.needs_review = false;
  undisposedMay.scoreReportContent = JSON.stringify(undisposedMayReport);
  assert.throws(() => createFixedEightPassReceipt(undisposedMay), /lacks a needs_review disposition/u);
});

test("receipt issuance rejects a stale passing status when a blocking semantic expectation is missing", () => {
  const staleSemanticGate = validInput();
  const report = JSON.parse(staleSemanticGate.scoreReportContent) as {
    units: Array<{
      status: string;
      semantic_gate: { passed: boolean; actual_status: string };
      semantic_capture: { status: string; misses: string[] };
    }>;
  };
  report.units[0]!.status = "pass";
  report.units[0]!.semantic_gate.passed = false;
  report.units[0]!.semantic_gate.actual_status = "missing";
  report.units[0]!.semantic_capture.status = "missing";
  report.units[0]!.semantic_capture.misses = ["policies"];
  staleSemanticGate.scoreReportContent = JSON.stringify(report);

  assert.throws(
    () => createFixedEightPassReceipt(staleSemanticGate),
    /semantic capture/u,
  );
});

test("receipt files are state-contained, named by payload hash, tamper-evident, and never overwritten", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-pilot-receipt-"));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const input = validInput();
  const receipt = createFixedEightPassReceipt(input);
  const evidence = { scoreReportContent: input.scoreReportContent };
  const outputPath = await writeFixedEightPassReceipt(stateDir, receipt, evidence);

  assert.equal(path.dirname(outputPath), path.join(stateDir, "gate-receipts"));
  assert.equal(path.basename(outputPath), `fixed-eight-pass-${receipt.receipt_sha256}.json`);
  assert.deepEqual(
    validateFixedEightPassReceipt(JSON.parse(await readFile(outputPath, "utf8")), evidence),
    receipt,
  );
  await assert.rejects(writeFixedEightPassReceipt(stateDir, receipt, evidence), /EEXIST/u);

  const tampered = structuredClone(receipt);
  tampered.payload.units[0]!.source_fingerprint = hash("9");
  assert.throws(() => validateFixedEightPassReceipt(tampered, evidence), /SHA-256/u);
});

test("receipt publication rejects a journal-directory link that resolves outside state", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-pilot-state-link-"));
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-pilot-outside-"));
  t.after(async () => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(outsideDir, { recursive: true, force: true }),
  ]));
  await symlink(outsideDir, path.join(stateDir, "gate-receipts"), "junction");

  await assert.rejects(
    (() => {
      const input = validInput();
      return writeFixedEightPassReceipt(
        stateDir,
        createFixedEightPassReceipt(input),
        { scoreReportContent: input.scoreReportContent },
      );
    })(),
    /resolves outside state directory/u,
  );
});

test("receipt validation requires the exact score bytes and rejects recomputed-hash unit-status forgery", () => {
  const input = validInput();
  const receipt = createFixedEightPassReceipt(input);
  assert.throws(
    () => validateFixedEightPassReceipt(receipt, { scoreReportContent: `${input.scoreReportContent} ` }),
    /score report content SHA-256 or byte length/u,
  );

  const forged = structuredClone(receipt);
  [forged.payload.score_report.unit_statuses[0], forged.payload.score_report.unit_statuses[1]] = [
    forged.payload.score_report.unit_statuses[1]!,
    forged.payload.score_report.unit_statuses[0]!,
  ];
  forged.receipt_sha256 = canonicalSha256(forged.payload);
  assert.throws(
    () => validateFixedEightPassReceipt(forged, { scoreReportContent: input.scoreReportContent }),
    /score unit statuses must exactly match/u,
  );

  const forgedSemantic = structuredClone(receipt);
  forgedSemantic.payload.score_report.unit_statuses[0]!.semantic_gate_passed = false;
  forgedSemantic.payload.score_report.unit_statuses[0]!.semantic_capture_status = "missing";
  forgedSemantic.receipt_sha256 = canonicalSha256(forgedSemantic.payload);
  assert.throws(
    () => validateFixedEightPassReceipt(forgedSemantic, { scoreReportContent: input.scoreReportContent }),
    /semantic capture statuses must all be captured/u,
  );
});

test("receipt provenance requires 64-character extraction content and validation hashes", () => {
  const invalidContentHash = validInput();
  invalidContentHash.units[0]!.extraction_content_sha256 = "short";
  assert.throws(() => createFixedEightPassReceipt(invalidContentHash), /Invalid string/u);

  const invalidValidationFingerprint = validInput();
  invalidValidationFingerprint.units[0]!.validation_fingerprint = "short";
  assert.throws(() => createFixedEightPassReceipt(invalidValidationFingerprint), /Invalid string/u);
});

test("legacy-compatible or optional validation scoring can never mint a pass receipt", () => {
  for (const mutate of [
    (report: Record<string, any>) => { report.verification.mode = "legacy_compatible"; },
    (report: Record<string, any>) => { report.verification.validated_artifacts_required = false; },
    (report: Record<string, any>) => { report.gate.verification_mode = "legacy_compatible"; },
    (report: Record<string, any>) => { report.gate.validated_artifacts_required = false; },
  ]) {
    const input = validInput();
    const report = JSON.parse(input.scoreReportContent) as Record<string, any>;
    mutate(report);
    input.scoreReportContent = JSON.stringify(report);
    assert.throws(
      () => createFixedEightPassReceipt(input),
      /strict_validated_artifacts|expected true/u,
    );
  }
});

test("a self-consistent substitute ground truth cannot mint the fixed-eight receipt", () => {
  const substitute = validInput();
  (substitute.groundTruth as { base_sha256: string }).base_sha256 = hash("9");
  const report = JSON.parse(substitute.scoreReportContent) as {
    ground_truth: { sha256: string };
  };
  report.ground_truth.sha256 = hash("9");
  substitute.scoreReportContent = JSON.stringify(report);

  assert.throws(
    () => createFixedEightPassReceipt(substitute),
    /approved immutable fixed-eight ground truth/u,
  );
});
