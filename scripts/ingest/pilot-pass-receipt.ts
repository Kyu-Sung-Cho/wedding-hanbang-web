import { z } from "zod";

import {
  canonicalSha256,
  sha256Utf8,
  writeContentAddressedJsonNoOverwrite,
} from "./gate-integrity.js";

export const FIXED_EIGHT_ORDERED_UNIT_IDS = Object.freeze([
  "7f21b5176a0063d2746ce81345d347d4e2218081c19c540be722e9505eecb587",
  "0a7e35c83b56423e27308887c63be675f2d24123941d53b620d315c9f7fec89c",
  "fb24bede2e46a3ee18a1426f7f6c0d4a82b0b069a17bee736339f89a4d0d2f00",
  "467af65b41d314bbce9fddd38bff84961d33700d5e7da17f04e337afaa212ead",
  "0aea5091993fbb729d4c746d0e31ecb26ef40c7c44030349c2e255f2a0d4ee38",
  "9cd5e12d7941a7175b2388164081bb1c3886ea4b2badee4c80fff0ea18f9831c",
  "cb0858314e9ea894d1cb90fb213cdda0d8aa00b2b6cd5b7839b5b96b07480e29",
  "9bd413d45460d6f9e754a39d57592b25c1dc5adec8ea86bba0e432c83dce16a7",
] as const);

export const FIXED_EIGHT_BLOCKING_UNIT_IDS = Object.freeze(FIXED_EIGHT_ORDERED_UNIT_IDS.slice(0, 7));
export const FIXED_EIGHT_NON_BLOCKING_UNIT_IDS = Object.freeze([FIXED_EIGHT_ORDERED_UNIT_IDS[7]] as const);

export const FIXED_EIGHT_MAY_UNREADABLE_CELL_BINDINGS = Object.freeze([
  Object.freeze({
    source_locator: "image:1/리허설촬영구성/메이크업추가/기본추가",
    visible_amounts_krw: Object.freeze([33_000]),
  }),
  Object.freeze({
    source_locator: "image:1/리허설촬영구성/메이크업추가/헤어피스",
    visible_amounts_krw: Object.freeze([66_000]),
  }),
] as const);

export const FIXED_EIGHT_GROUND_TRUTH_BINDING = Object.freeze({
  base_sha256: "17a927f52d51774c9f3e149a3dba6fb3acfa0c5f79587d010089a00ac1988d75",
  base_occurrences: 2_342,
  base_readable_occurrences: 2_409,
  overlay_sha256: "aa574571c58b4b513854a69457e232f5689dc443ec9571785c5232c772459810",
  overlay_readable_occurrences: 67,
  unreadable_cells: 2,
  adjudication_sha256: "7c746d70d3bfc9c31c1af9689792fd0613fbca82ce480712a617681c65276afc",
  effective_readable_occurrences: 2_404,
  human_required_occurrences: 7,
});

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const UnitIdSchema = Sha256Schema;
const ModelSchema = z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]);

const UnitProvenanceSchema = z.object({
  unit_id: UnitIdSchema,
  paid_plan_sha256: Sha256Schema,
  source_fingerprint: Sha256Schema,
  conversion_fingerprint: Sha256Schema,
  extraction_fingerprint: Sha256Schema,
  extraction_content_sha256: Sha256Schema,
  validation_fingerprint: Sha256Schema,
  validation_content_sha256: Sha256Schema,
  model: ModelSchema,
  prompt_version: z.string().min(1).max(200),
  prompt_hash: Sha256Schema,
  processing_version: Sha256Schema,
  scanner_parser_version: z.string().min(1).max(200),
  converter_version: z.string().min(1).max(200),
  request_hashes: z.array(Sha256Schema).min(1).max(96),
}).strict();

const GroundTruthBindingSchema = z.object({
  base_sha256: Sha256Schema,
  base_occurrences: z.number().int().nonnegative(),
  base_readable_occurrences: z.number().int().nonnegative(),
  overlay_sha256: Sha256Schema,
  overlay_readable_occurrences: z.number().int().nonnegative(),
  unreadable_cells: z.number().int().nonnegative(),
  adjudication_sha256: Sha256Schema,
  effective_readable_occurrences: z.number().int().nonnegative(),
  human_required_occurrences: z.number().int().nonnegative(),
}).strict();

const ZeroCriteriaSchema = z.object({
  hallucinated_amounts: z.literal(0),
  missing_readable_amounts: z.literal(0),
  unsupported_structured_amounts: z.literal(0),
  linking_errors: z.literal(0),
  manual_linkage_reviews: z.literal(0),
  blocking_validation_issues: z.literal(0),
  actual_coverage_gaps: z.literal(0),
  unreadable_amounts_must_remain_unstructured: z.literal(true),
}).strict();

const ScoreUnitStatusSchema = z.object({
  unit_id: UnitIdSchema,
  prompt_version: z.string().min(1),
  model: ModelSchema,
  status: z.enum(["pass", "fail", "blocked"]),
  provenance: UnitProvenanceSchema.omit({ unit_id: true }).optional(),
  price_gate: z.object({
    passed: z.boolean(),
    hallucinated_amounts: z.array(z.unknown()),
    missing_readable_amounts: z.array(z.unknown()),
    unsupported_structured_amounts: z.array(z.unknown()),
    linking_errors: z.array(z.unknown()),
    manual_linkage_reviews: z.array(z.unknown()),
    blocking_validation_issues: z.array(z.unknown()),
    unsafe_unreadable_extractions: z.array(z.unknown()),
    actual_coverage_gaps: z.array(z.unknown()),
  }).passthrough(),
  unreadable_cells: z.array(z.object({
    source_locator: z.string().min(1),
    visible_amounts_krw: z.array(z.number().int().nonnegative()),
  }).passthrough()),
  unreadable_handling: z.object({
    any_needs_review: z.boolean(),
    known_cell_dispositions: z.array(z.object({
      source_locator: z.string().min(1),
      visible_amounts_krw: z.array(z.number().int().nonnegative()),
      needs_review: z.boolean(),
      amounts_remain_unstructured: z.boolean(),
    }).strict()),
    all_known_cells_safely_disposed: z.boolean(),
  }).passthrough(),
}).passthrough();

const ScoreReportSchema = z.object({
  schema_version: z.literal(1),
  verification: z.object({
    mode: z.literal("strict_validated_artifacts"),
    validated_artifacts_required: z.literal(true),
    paid_plan_sha256: Sha256Schema,
  }).passthrough(),
  ground_truth: z.object({
    sha256: Sha256Schema,
    inventory_occurrences: z.number().int().nonnegative(),
    base_readable_occurrences: z.number().int().nonnegative(),
    effective_readable_occurrences: z.number().int().nonnegative(),
    overlay_sha256: Sha256Schema,
    overlay_readable_occurrences: z.number().int().nonnegative(),
    unreadable_cells: z.number().int().nonnegative(),
    adjudication: z.object({
      sha256: Sha256Schema,
      human_required_occurrences: z.number().int().nonnegative(),
    }).passthrough(),
  }).passthrough(),
  gate: z.object({
    status: z.enum(["pass", "fail", "blocked"]),
    verification_mode: z.literal("strict_validated_artifacts"),
    validated_artifacts_required: z.literal(true),
    eligible_for_25_unit_batch: z.boolean(),
    blocking_unit_ids: z.array(UnitIdSchema),
    non_blocking_unit_ids: z.array(UnitIdSchema),
    blocking_passed_units: z.number().int().nonnegative(),
    blocking_failed_units: z.number().int().nonnegative(),
    blocking_blocked_units: z.number().int().nonnegative(),
    criteria: ZeroCriteriaSchema,
  }).passthrough(),
  units: z.array(ScoreUnitStatusSchema),
}).passthrough();

const ReceiptPayloadSchema = z.object({
  issued_at: z.string().datetime(),
  ordered_unit_ids: z.array(UnitIdSchema).length(8),
  blocking_unit_ids: z.array(UnitIdSchema).length(7),
  non_blocking_unit_ids: z.array(UnitIdSchema).length(1),
  units: z.array(UnitProvenanceSchema).length(8),
  ground_truth: GroundTruthBindingSchema,
  score_report: z.object({
    sha256: Sha256Schema,
    bytes: z.number().int().positive(),
    status: z.literal("pass"),
    eligible_for_25_unit_batch: z.literal(true),
    criteria: ZeroCriteriaSchema,
    unit_statuses: z.array(z.object({
      unit_id: UnitIdSchema,
      status: z.enum(["pass", "fail"]),
    }).strict()).length(8),
  }).strict(),
}).strict();

export const FixedEightPassReceiptSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("fixed_eight_pilot_pass_receipt"),
  payload: ReceiptPayloadSchema,
  receipt_sha256: Sha256Schema,
}).strict();

export type FixedEightPassReceipt = z.infer<typeof FixedEightPassReceiptSchema>;
export type FixedEightUnitProvenance = z.infer<typeof UnitProvenanceSchema>;
export type GroundTruthBinding = z.infer<typeof GroundTruthBindingSchema>;

export interface CreateFixedEightPassReceiptInput {
  issuedAt: string;
  orderedUnitIds: readonly string[];
  nonBlockingUnitIds: readonly string[];
  units: readonly FixedEightUnitProvenance[];
  groundTruth: GroundTruthBinding;
  scoreReportContent: string;
}

function assertExactOrder(actual: readonly string[], expected: readonly string[], label: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} must exactly match the fixed ordered unit IDs`);
  }
}

function parseScoreReport(content: string): z.infer<typeof ScoreReportSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("score report is not valid JSON");
  }
  return ScoreReportSchema.parse(raw);
}

function unreadableBindingKey(value: {
  source_locator: string;
  visible_amounts_krw: readonly number[];
}): string {
  return JSON.stringify([
    value.source_locator,
    [...value.visible_amounts_krw].sort((left, right) => left - right),
  ]);
}

function assertMayUnreadableCellsSafelyDisposed(
  unitScore: z.infer<typeof ScoreUnitStatusSchema>,
): void {
  if (unitScore.status === "blocked") {
    throw new Error("the May image unit must be scoreable even though it is non-blocking");
  }
  if (unitScore.price_gate.unsafe_unreadable_extractions.length > 0) {
    throw new Error("the May image unit extracted a known unreadable amount");
  }
  const expected = [...FIXED_EIGHT_MAY_UNREADABLE_CELL_BINDINGS]
    .map(unreadableBindingKey)
    .sort();
  const actualCells = unitScore.unreadable_cells.map(unreadableBindingKey).sort();
  if (actualCells.length !== expected.length || actualCells.some((value, index) => value !== expected[index])) {
    throw new Error("the May image unit is not bound to the two known unreadable cells");
  }
  const dispositions = unitScore.unreadable_handling.known_cell_dispositions;
  const actualDispositions = dispositions.map(unreadableBindingKey).sort();
  if (
    actualDispositions.length !== expected.length
    || actualDispositions.some((value, index) => value !== expected[index])
    || !unitScore.unreadable_handling.any_needs_review
    || !unitScore.unreadable_handling.all_known_cells_safely_disposed
    || dispositions.some((disposition) =>
      !disposition.needs_review || !disposition.amounts_remain_unstructured
    )
  ) {
    throw new Error("the May image unit lacks a needs_review disposition for every known unreadable cell");
  }
}

export function createFixedEightPassReceipt(
  input: CreateFixedEightPassReceiptInput,
): FixedEightPassReceipt {
  assertExactOrder(input.orderedUnitIds, FIXED_EIGHT_ORDERED_UNIT_IDS, "pilot selection");
  assertExactOrder(input.nonBlockingUnitIds, FIXED_EIGHT_NON_BLOCKING_UNIT_IDS, "non-blocking selection");
  const units = input.units.map((unit) => UnitProvenanceSchema.parse(unit));
  assertExactOrder(units.map((unit) => unit.unit_id), FIXED_EIGHT_ORDERED_UNIT_IDS, "pilot provenance");
  const groundTruth = GroundTruthBindingSchema.parse(input.groundTruth);
  if (canonicalSha256(groundTruth) !== canonicalSha256(FIXED_EIGHT_GROUND_TRUTH_BINDING)) {
    throw new Error("ground truth does not match the approved immutable fixed-eight ground truth");
  }
  const score = parseScoreReport(input.scoreReportContent);
  assertExactOrder(score.units.map((unit) => unit.unit_id), FIXED_EIGHT_ORDERED_UNIT_IDS, "score report units");
  assertExactOrder(score.gate.blocking_unit_ids, FIXED_EIGHT_BLOCKING_UNIT_IDS, "score blocking units");
  assertExactOrder(score.gate.non_blocking_unit_ids, FIXED_EIGHT_NON_BLOCKING_UNIT_IDS, "score non-blocking units");
  if (
    score.gate.status !== "pass"
    || !score.gate.eligible_for_25_unit_batch
    || score.gate.blocking_passed_units !== 7
    || score.gate.blocking_failed_units !== 0
    || score.gate.blocking_blocked_units !== 0
  ) {
    throw new Error("score report has not passed the exact seven-unit blocking gate");
  }
  for (const [index, unitScore] of score.units.entries()) {
    const provenance = units[index];
    const expectedScoreProvenance = provenance
      ? Object.fromEntries(Object.entries(provenance).filter(([key]) => key !== "unit_id"))
      : null;
    if (
      !provenance
      || score.verification.paid_plan_sha256 !== provenance.paid_plan_sha256
      || unitScore.prompt_version !== provenance.prompt_version
      || unitScore.model !== provenance.model
      || !unitScore.provenance
      || canonicalSha256(unitScore.provenance) !== canonicalSha256(expectedScoreProvenance)
    ) {
      throw new Error(`score provenance does not match extraction provenance: ${unitScore.unit_id}`);
    }
    if (index < 7) {
      const priceGate = unitScore.price_gate;
      const hasZeroFailures = [
        priceGate.hallucinated_amounts,
        priceGate.missing_readable_amounts,
        priceGate.unsupported_structured_amounts,
        priceGate.linking_errors,
        priceGate.manual_linkage_reviews,
        priceGate.blocking_validation_issues,
        priceGate.unsafe_unreadable_extractions,
        priceGate.actual_coverage_gaps,
      ].every((items) => items.length === 0);
      if (unitScore.status !== "pass" || !priceGate.passed || !hasZeroFailures) {
        throw new Error(`blocking pilot unit did not meet every zero criterion: ${unitScore.unit_id}`);
      }
    } else {
      assertMayUnreadableCellsSafelyDisposed(unitScore);
    }
  }
  if (
    score.ground_truth.sha256 !== groundTruth.base_sha256
    || score.ground_truth.inventory_occurrences !== groundTruth.base_occurrences
    || score.ground_truth.base_readable_occurrences !== groundTruth.base_readable_occurrences
    || score.ground_truth.overlay_sha256 !== groundTruth.overlay_sha256
    || score.ground_truth.overlay_readable_occurrences !== groundTruth.overlay_readable_occurrences
    || score.ground_truth.unreadable_cells !== groundTruth.unreadable_cells
    || score.ground_truth.adjudication.sha256 !== groundTruth.adjudication_sha256
    || score.ground_truth.effective_readable_occurrences !== groundTruth.effective_readable_occurrences
    || score.ground_truth.adjudication.human_required_occurrences !== groundTruth.human_required_occurrences
  ) {
    throw new Error("score report ground truth does not match the immutable ground-truth binding");
  }
  const payload = ReceiptPayloadSchema.parse({
    issued_at: input.issuedAt,
    ordered_unit_ids: [...FIXED_EIGHT_ORDERED_UNIT_IDS],
    blocking_unit_ids: [...FIXED_EIGHT_BLOCKING_UNIT_IDS],
    non_blocking_unit_ids: [...FIXED_EIGHT_NON_BLOCKING_UNIT_IDS],
    units,
    ground_truth: groundTruth,
    score_report: {
      sha256: sha256Utf8(input.scoreReportContent),
      bytes: Buffer.byteLength(input.scoreReportContent, "utf8"),
      status: "pass",
      eligible_for_25_unit_batch: true,
      criteria: score.gate.criteria,
      unit_statuses: score.units.map((unit) => ({ unit_id: unit.unit_id, status: unit.status })),
    },
  });
  return {
    schema_version: 1,
    kind: "fixed_eight_pilot_pass_receipt",
    payload,
    receipt_sha256: canonicalSha256(payload),
  };
}

function parseFixedEightPassReceiptEnvelope(value: unknown): FixedEightPassReceipt {
  const receipt = FixedEightPassReceiptSchema.parse(value);
  assertExactOrder(receipt.payload.ordered_unit_ids, FIXED_EIGHT_ORDERED_UNIT_IDS, "receipt pilot units");
  assertExactOrder(receipt.payload.blocking_unit_ids, FIXED_EIGHT_BLOCKING_UNIT_IDS, "receipt blocking units");
  assertExactOrder(receipt.payload.non_blocking_unit_ids, FIXED_EIGHT_NON_BLOCKING_UNIT_IDS, "receipt non-blocking units");
  assertExactOrder(receipt.payload.units.map((unit) => unit.unit_id), FIXED_EIGHT_ORDERED_UNIT_IDS, "receipt provenance");
  assertExactOrder(
    receipt.payload.score_report.unit_statuses.map((unit) => unit.unit_id),
    FIXED_EIGHT_ORDERED_UNIT_IDS,
    "receipt score unit statuses",
  );
  if (canonicalSha256(receipt.payload.ground_truth) !== canonicalSha256(FIXED_EIGHT_GROUND_TRUTH_BINDING)) {
    throw new Error("receipt does not bind the approved immutable fixed-eight ground truth");
  }
  if (receipt.payload.score_report.unit_statuses.slice(0, 7).some((unit) => unit.status !== "pass")) {
    throw new Error("receipt blocking unit statuses must all pass");
  }
  if (canonicalSha256(receipt.payload) !== receipt.receipt_sha256) {
    throw new Error("fixed-eight receipt SHA-256 does not match its payload");
  }
  return receipt;
}

export interface FixedEightReceiptEvidence {
  scoreReportContent: string;
}

export function validateFixedEightPassReceipt(
  value: unknown,
  evidence: FixedEightReceiptEvidence,
): FixedEightPassReceipt {
  const receipt = parseFixedEightPassReceiptEnvelope(value);
  const scoreReportSha256 = sha256Utf8(evidence.scoreReportContent);
  const scoreReportBytes = Buffer.byteLength(evidence.scoreReportContent, "utf8");
  if (
    scoreReportSha256 !== receipt.payload.score_report.sha256
    || scoreReportBytes !== receipt.payload.score_report.bytes
  ) {
    throw new Error("receipt score report content SHA-256 or byte length does not match exact evidence");
  }
  const expected = createFixedEightPassReceipt({
    issuedAt: receipt.payload.issued_at,
    orderedUnitIds: receipt.payload.ordered_unit_ids,
    nonBlockingUnitIds: receipt.payload.non_blocking_unit_ids,
    units: receipt.payload.units,
    groundTruth: receipt.payload.ground_truth,
    scoreReportContent: evidence.scoreReportContent,
  });
  if (canonicalSha256(expected.payload) !== canonicalSha256(receipt.payload)) {
    throw new Error("receipt payload does not match the exact score report evidence");
  }
  return receipt;
}

export async function writeFixedEightPassReceipt(
  stateDir: string,
  value: unknown,
  evidence: FixedEightReceiptEvidence,
): Promise<string> {
  const receipt = validateFixedEightPassReceipt(value, evidence);
  return writeContentAddressedJsonNoOverwrite(
    stateDir,
    "gate-receipts",
    `fixed-eight-pass-${receipt.receipt_sha256}.json`,
    receipt,
  );
}
