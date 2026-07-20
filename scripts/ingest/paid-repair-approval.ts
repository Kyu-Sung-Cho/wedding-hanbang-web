import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { verifyDeterministicStateArtifactPath } from "./artifact-integrity.js";
import {
  ALLOWED_EXTRACTION_MODELS,
  EXTRACTION_PROCESSING_VERSION,
  EXTRACTION_PROMPT_HASH,
  EXTRACTION_PROMPT_VERSION,
  type ExtractionModel,
} from "./extraction-contract.js";
import {
  canonicalSha256,
  writeContentAddressedJsonNoOverwrite,
} from "./gate-integrity.js";
import { AiLedgerSnapshotSchema, estimateExtractionCostUsd } from "./ledger.js";
import {
  FIXED_EIGHT_BLOCKING_UNIT_IDS,
  FIXED_EIGHT_NON_BLOCKING_UNIT_IDS,
  FIXED_EIGHT_ORDERED_UNIT_IDS,
} from "./pilot-pass-receipt.js";
import { PaidExecutionDomainBindingSchema } from "./paid-execution-domain.js";

const REPAIR_APPROVAL_DIRECTORY = "paid-repair-approvals";
const PRIOR_PLAN_DIRECTORY = "paid-extraction-plans";
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
export const MAX_FIXED_EIGHT_REPAIR_COST_USD = 20;
export const PAID_REPAIR_PRICING_SCHEDULE = "openai-standard-2026-07-09" as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ModelSchema = z.enum(ALLOWED_EXTRACTION_MODELS);
const SafeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const CostSchema = z.number().finite().nonnegative().max(1_000_000);
const ScoreRelativePathSchema = z.string().regex(
  /^scoring\/score-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/u,
);

function addIssue(
  context: z.RefinementCtx,
  pathSegments: Array<string | number>,
  message: string,
): void {
  context.addIssue({ code: "custom", path: pathSegments, message });
}

function exactOrder(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return exactOrder(left, right);
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function modelRates(model: ExtractionModel): {
  input_usd_per_million: number;
  output_usd_per_million: number;
} {
  return {
    input_usd_per_million: estimateExtractionCostUsd(model, 1_000_000, 0),
    output_usd_per_million: estimateExtractionCostUsd(model, 0, 1_000_000),
  };
}

const HistoricalPlanUnitSchema = z.object({
  unit_id: Sha256Schema,
  source_fingerprint: Sha256Schema,
  artifact_fingerprint: Sha256Schema,
  converter_version: z.string().min(1).max(100),
  request_count: z.number().int().min(1).max(96),
  request_hashes: z.array(Sha256Schema).min(1).max(96),
  authorized_request_hashes_by_batch: z.array(
    z.array(Sha256Schema).min(1).max(4),
  ).min(1).max(96),
  estimated_input_tokens: SafeCountSchema,
  estimated_output_tokens: SafeCountSchema,
  maximum_input_tokens: SafeCountSchema,
  maximum_output_tokens: SafeCountSchema,
  estimated_cost_usd: CostSchema,
  maximum_cost_usd: CostSchema,
}).strict().superRefine((unit, context) => {
  if (unit.request_count !== unit.request_hashes.length) {
    addIssue(context, ["request_count"], "historical request count does not match request hashes");
  }
  if (unit.request_count !== unit.authorized_request_hashes_by_batch.length) {
    addIssue(context, ["authorized_request_hashes_by_batch"], "historical authorized hashes do not match request count");
  }
  if (unit.maximum_input_tokens < unit.estimated_input_tokens) {
    addIssue(context, ["maximum_input_tokens"], "historical maximum input is below its estimate");
  }
  if (unit.maximum_output_tokens < unit.estimated_output_tokens) {
    addIssue(context, ["maximum_output_tokens"], "historical maximum output is below its estimate");
  }
});

const HistoricalPlanSchema = z.object({
  schema_version: z.literal(3),
  kind: z.literal("fixed_eight_paid_extraction_plan_approval"),
  payload: z.object({
    execution_domain: PaidExecutionDomainBindingSchema,
    prior_durable_ledger: AiLedgerSnapshotSchema,
    ordered_unit_ids: z.array(Sha256Schema).length(8),
    model: ModelSchema,
    prompt_version: z.string().min(1).max(100),
    prompt_hash: Sha256Schema,
    processing_version: Sha256Schema,
    scanner_parser_version: z.string().min(1).max(100),
    units: z.array(HistoricalPlanUnitSchema).length(8),
    cost: z.object({
      pricing_schedule: z.string().min(1).max(100),
      input_usd_per_million: CostSchema,
      output_usd_per_million: CostSchema,
      authorized_ceiling_usd: CostSchema,
      request_count: SafeCountSchema,
      estimated_input_tokens: SafeCountSchema,
      estimated_output_tokens: SafeCountSchema,
      maximum_input_tokens: SafeCountSchema,
      maximum_output_tokens: SafeCountSchema,
      estimated_cost_usd: CostSchema,
      maximum_cost_usd: CostSchema,
    }).strict(),
  }).strict(),
  plan_sha256: Sha256Schema,
}).strict().superRefine((plan, context) => {
  if (!exactOrder(plan.payload.ordered_unit_ids, FIXED_EIGHT_ORDERED_UNIT_IDS)) {
    addIssue(context, ["payload", "ordered_unit_ids"], "historical plan is not the exact fixed eight");
  }
  if (!exactOrder(plan.payload.units.map((unit) => unit.unit_id), FIXED_EIGHT_ORDERED_UNIT_IDS)) {
    addIssue(context, ["payload", "units"], "historical plan units are not the exact fixed eight");
  }
  if (canonicalSha256(plan.payload) !== plan.plan_sha256) {
    addIssue(context, ["plan_sha256"], "historical plan SHA-256 does not match its canonical payload");
  }
});

const ScoreUnitProvenanceSchema = z.object({
  paid_plan_sha256: Sha256Schema,
  source_fingerprint: Sha256Schema,
  conversion_fingerprint: Sha256Schema,
  extraction_fingerprint: Sha256Schema,
  extraction_content_sha256: Sha256Schema,
  validation_fingerprint: Sha256Schema,
  validation_content_sha256: Sha256Schema,
  model: ModelSchema,
  prompt_version: z.string().min(1).max(100),
  prompt_hash: Sha256Schema,
  processing_version: Sha256Schema,
  scanner_parser_version: z.string().min(1).max(100),
  converter_version: z.string().min(1).max(100),
  request_hashes: z.array(Sha256Schema).min(1).max(96),
}).strict();

const StrictScoreUnitSchema = z.object({
  unit_id: Sha256Schema,
  prompt_version: z.string().min(1).max(100),
  model: ModelSchema,
  status: z.enum(["pass", "fail", "blocked"]),
  price_gate: z.object({
    passed: z.boolean(),
  }).passthrough(),
  provenance: ScoreUnitProvenanceSchema,
}).passthrough().superRefine((unit, context) => {
  if (unit.status === "pass" && !unit.price_gate.passed) {
    addIssue(context, ["price_gate", "passed"], "passing score unit has a failed price gate");
  }
  if (unit.status === "fail" && unit.price_gate.passed) {
    addIssue(context, ["price_gate", "passed"], "failed score unit has a passing price gate");
  }
  if (
    unit.model !== unit.provenance.model
    || unit.prompt_version !== unit.provenance.prompt_version
  ) {
    addIssue(context, ["provenance"], "score display fields do not match strict unit provenance");
  }
});

const StrictFailedScoreReportSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string().datetime(),
  verification: z.object({
    mode: z.literal("strict_validated_artifacts"),
    validated_artifacts_required: z.literal(true),
    deterministic_artifact_paths_required: z.literal(true),
    artifact_content_hashes_required: z.literal(true),
    paid_plan_sha256: Sha256Schema,
  }).passthrough(),
  gate: z.object({
    status: z.enum(["fail", "blocked"]),
    verification_mode: z.literal("strict_validated_artifacts"),
    validated_artifacts_required: z.literal(true),
    eligible_for_25_unit_batch: z.literal(false),
    blocking_unit_ids: z.array(Sha256Schema).length(7),
    non_blocking_unit_ids: z.array(Sha256Schema).length(1),
    blocking_passed_units: z.number().int().nonnegative().max(7),
    blocking_failed_units: z.number().int().nonnegative().max(7),
    blocking_blocked_units: z.number().int().nonnegative().max(7),
  }).passthrough(),
  units: z.array(StrictScoreUnitSchema).length(8),
}).passthrough();

export const FailedUnitRepairPlanUnitSchema = z.object({
  unit_id: Sha256Schema,
  source_fingerprint: Sha256Schema,
  artifact_fingerprint: Sha256Schema,
  converter_version: z.string().min(1).max(100),
  request_count: z.number().int().min(1).max(96),
  request_hashes: z.array(Sha256Schema).min(1).max(96),
  estimated_input_tokens: SafeCountSchema,
  estimated_output_tokens: SafeCountSchema,
  maximum_input_tokens: SafeCountSchema,
  maximum_output_tokens: SafeCountSchema,
  estimated_cost_usd: CostSchema,
  maximum_cost_usd: CostSchema,
}).strict().superRefine((unit, context) => {
  if (unit.request_count !== unit.request_hashes.length) {
    addIssue(context, ["request_count"], "request count must equal ordered request hashes length");
  }
  if (unit.maximum_input_tokens < unit.estimated_input_tokens) {
    addIssue(context, ["maximum_input_tokens"], "maximum input tokens cannot be below the estimate");
  }
  if (unit.maximum_output_tokens < unit.estimated_output_tokens) {
    addIssue(context, ["maximum_output_tokens"], "maximum output tokens cannot be below the estimate");
  }
});

const RepairCostSchema = z.object({
  pricing_schedule: z.literal(PAID_REPAIR_PRICING_SCHEDULE),
  input_usd_per_million: CostSchema,
  output_usd_per_million: CostSchema,
  authorized_ceiling_usd: z.number().finite().positive().max(MAX_FIXED_EIGHT_REPAIR_COST_USD),
  request_count: z.number().int().min(1).max(7 * 96),
  estimated_input_tokens: SafeCountSchema,
  estimated_output_tokens: SafeCountSchema,
  maximum_input_tokens: SafeCountSchema,
  maximum_output_tokens: SafeCountSchema,
  estimated_cost_usd: CostSchema,
  maximum_cost_usd: CostSchema,
}).strict();

const PriorScoreUnitBindingSchema = z.object({
  unit_id: Sha256Schema,
  status: z.enum(["pass", "fail", "blocked"]),
  provenance: ScoreUnitProvenanceSchema,
}).strict();

export const FailedUnitRepairApprovalPayloadSchema = z.object({
  prior_plan_sha256: Sha256Schema,
  prior_score_report: z.object({
    relative_path: ScoreRelativePathSchema,
    sha256: Sha256Schema,
    bytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
    failed_blocking_unit_ids: z.array(Sha256Schema).min(1).max(7),
    units: z.array(PriorScoreUnitBindingSchema).length(8),
  }).strict(),
  ordered_unit_ids: z.array(Sha256Schema).min(1).max(7),
  model: ModelSchema,
  prompt_version: z.string().min(1).max(100),
  prompt_hash: Sha256Schema,
  processing_version: Sha256Schema,
  scanner_parser_version: z.string().min(1).max(100),
  units: z.array(FailedUnitRepairPlanUnitSchema).min(1).max(7),
  cost: RepairCostSchema,
}).strict().superRefine((payload, context) => {
  if (!exactOrder(
    payload.prior_score_report.units.map((unit) => unit.unit_id),
    FIXED_EIGHT_ORDERED_UNIT_IDS,
  )) {
    addIssue(context, ["prior_score_report", "units"], "prior score provenance is not the exact fixed eight in order");
  }
  if (payload.prior_score_report.units.some(
    (unit) => unit.provenance.paid_plan_sha256 !== payload.prior_plan_sha256,
  )) {
    addIssue(context, ["prior_score_report", "units"], "prior score provenance does not bind the prior plan SHA-256");
  }
  const actualFailed = payload.prior_score_report.units
    .filter((unit) => FIXED_EIGHT_BLOCKING_UNIT_IDS.includes(
      unit.unit_id as (typeof FIXED_EIGHT_BLOCKING_UNIT_IDS)[number],
    ) && unit.status === "fail")
    .map((unit) => unit.unit_id);
  if (!exactOrder(payload.prior_score_report.failed_blocking_unit_ids, actualFailed)) {
    addIssue(context, ["prior_score_report", "failed_blocking_unit_ids"], "failed unit binding does not match score statuses");
  }
  const selectedInFixedOrder = FIXED_EIGHT_ORDERED_UNIT_IDS.filter(
    (unitId) => payload.ordered_unit_ids.includes(unitId),
  );
  if (!exactOrder(payload.ordered_unit_ids, selectedInFixedOrder)) {
    addIssue(context, ["ordered_unit_ids"], "repair units must retain fixed-eight order");
  }
  if (payload.ordered_unit_ids.some((unitId) => !actualFailed.includes(unitId))) {
    addIssue(context, ["ordered_unit_ids"], "repair may contain only actually failed blocking units");
  }
  if (!exactOrder(payload.units.map((unit) => unit.unit_id), payload.ordered_unit_ids)) {
    addIssue(context, ["units"], "repair unit details must match the selected ordered unit IDs");
  }
  if (
    payload.prompt_version !== EXTRACTION_PROMPT_VERSION
    || payload.prompt_hash !== EXTRACTION_PROMPT_HASH
    || payload.processing_version !== EXTRACTION_PROCESSING_VERSION
  ) {
    addIssue(context, ["prompt_hash"], "repair approval uses a stale current extraction contract");
  }

  const priorById = new Map(payload.prior_score_report.units.map((unit) => [unit.unit_id, unit]));
  for (const [index, unit] of payload.units.entries()) {
    const prior = priorById.get(unit.unit_id);
    if (
      !prior
      || unit.source_fingerprint !== prior.provenance.source_fingerprint
      || unit.artifact_fingerprint !== prior.provenance.conversion_fingerprint
      || unit.converter_version !== prior.provenance.converter_version
    ) {
      addIssue(context, ["units", index], "repair source/conversion provenance differs from the failed score unit");
    }
    const expectedEstimate = estimateExtractionCostUsd(
      payload.model,
      unit.estimated_input_tokens,
      unit.estimated_output_tokens,
    );
    const expectedMaximum = estimateExtractionCostUsd(
      payload.model,
      unit.maximum_input_tokens,
      unit.maximum_output_tokens,
    );
    if (unit.estimated_cost_usd !== expectedEstimate || unit.maximum_cost_usd !== expectedMaximum) {
      addIssue(context, ["units", index], "repair unit cost is not token-derived");
    }
  }

  const totals = payload.units.reduce((result, unit) => ({
    requestCount: result.requestCount + unit.request_count,
    estimatedInput: result.estimatedInput + unit.estimated_input_tokens,
    estimatedOutput: result.estimatedOutput + unit.estimated_output_tokens,
    maximumInput: result.maximumInput + unit.maximum_input_tokens,
    maximumOutput: result.maximumOutput + unit.maximum_output_tokens,
  }), { requestCount: 0, estimatedInput: 0, estimatedOutput: 0, maximumInput: 0, maximumOutput: 0 });
  if (Object.values(totals).some((value) => !Number.isSafeInteger(value))) {
    addIssue(context, ["cost"], "repair aggregate counts must remain safe integers");
    return;
  }
  const rates = modelRates(payload.model);
  const aggregateEstimate = estimateExtractionCostUsd(
    payload.model,
    totals.estimatedInput,
    totals.estimatedOutput,
  );
  const aggregateMaximum = estimateExtractionCostUsd(
    payload.model,
    totals.maximumInput,
    totals.maximumOutput,
  );
  if (
    payload.cost.input_usd_per_million !== rates.input_usd_per_million
    || payload.cost.output_usd_per_million !== rates.output_usd_per_million
    || payload.cost.request_count !== totals.requestCount
    || payload.cost.estimated_input_tokens !== totals.estimatedInput
    || payload.cost.estimated_output_tokens !== totals.estimatedOutput
    || payload.cost.maximum_input_tokens !== totals.maximumInput
    || payload.cost.maximum_output_tokens !== totals.maximumOutput
    || payload.cost.estimated_cost_usd !== aggregateEstimate
    || payload.cost.maximum_cost_usd !== aggregateMaximum
  ) {
    addIssue(context, ["cost"], "repair aggregate cost does not exactly match selected units");
  }
  if (
    payload.cost.estimated_cost_usd > payload.cost.authorized_ceiling_usd
    || payload.cost.maximum_cost_usd > payload.cost.authorized_ceiling_usd
  ) {
    addIssue(context, ["cost", "authorized_ceiling_usd"], "repair estimated or maximum cost exceeds its authorized ceiling");
  }

  const priorPromptHashes = new Set(payload.ordered_unit_ids.map(
    (unitId) => priorById.get(unitId)?.provenance.prompt_hash,
  ));
  const priorModels = new Set(payload.ordered_unit_ids.map(
    (unitId) => priorById.get(unitId)?.provenance.model,
  ));
  const everyRequestSetUnchanged = payload.units.every((unit) => {
    const prior = priorById.get(unit.unit_id);
    return prior && sameStringArray(unit.request_hashes, prior.provenance.request_hashes);
  });
  if (
    priorPromptHashes.size === 1
    && priorPromptHashes.has(payload.prompt_hash)
    && priorModels.size === 1
    && priorModels.has(payload.model)
    && everyRequestSetUnchanged
  ) {
    addIssue(context, ["prompt_hash"], "repair would repay the unchanged failed extraction contract");
  }
});

export const FailedUnitRepairApprovalSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("fixed_eight_failed_unit_repair_approval"),
  payload: FailedUnitRepairApprovalPayloadSchema,
  approval_sha256: Sha256Schema,
}).strict();

type HistoricalPlan = z.infer<typeof HistoricalPlanSchema>;
type StrictFailedScoreReport = z.infer<typeof StrictFailedScoreReportSchema>;
export type FailedUnitRepairApproval = z.infer<typeof FailedUnitRepairApprovalSchema>;
export type ScoreUnitProvenance = z.infer<typeof ScoreUnitProvenanceSchema>;

export interface FailedUnitRepairPlanUnitInput {
  unitId: string;
  sourceFingerprint: string;
  artifactFingerprint: string;
  converterVersion: string;
  requestHashes: string[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  maximumInputTokens: number;
  maximumOutputTokens: number;
}

export interface CreateFailedUnitRepairApprovalInput {
  stateDir: string;
  priorPlanSha256: string;
  priorScoreReportRelativePath: string;
  expectedPriorScoreReportSha256: string;
  expectedFailedBlockingUnitIds: string[];
  selectedUnitIds: string[];
  model: ExtractionModel;
  scannerParserVersion: string;
  authorizedCostCeilingUsd: number;
  units: FailedUnitRepairPlanUnitInput[];
}

async function readJsonEvidence(
  stateDir: string,
  relativePath: string,
  expectedSha256?: string,
): Promise<{ bytes: Buffer; value: unknown; resolvedPath: string }> {
  const resolvedStateDir = path.resolve(stateDir);
  const artifactPath = path.join(resolvedStateDir, ...relativePath.split("/"));
  const resolvedPath = await verifyDeterministicStateArtifactPath({
    stateDir: resolvedStateDir,
    artifactPath,
    expectedRelativePath: path.join(...relativePath.split("/")),
  });
  const bytes = await readFile(resolvedPath);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EVIDENCE_BYTES) {
    throw new Error(`repair evidence must contain 1..${MAX_EVIDENCE_BYTES} bytes`);
  }
  const actualSha256 = sha256Bytes(bytes);
  if (expectedSha256 !== undefined && actualSha256 !== Sha256Schema.parse(expectedSha256)) {
    throw new Error("repair evidence content SHA-256 does not match the explicitly approved digest");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("repair evidence is not valid JSON");
  }
  return { bytes, value, resolvedPath };
}

async function readHistoricalPlan(
  stateDir: string,
  planSha256: string,
): Promise<HistoricalPlan> {
  const normalized = Sha256Schema.parse(planSha256.trim());
  const evidence = await readJsonEvidence(
    stateDir,
    `${PRIOR_PLAN_DIRECTORY}/${normalized}.json`,
  );
  const plan = HistoricalPlanSchema.parse(evidence.value);
  if (plan.plan_sha256 !== normalized) {
    throw new Error("historical exact-eight plan does not match the explicitly approved SHA-256");
  }
  return plan;
}

function assertScoreMatchesHistoricalPlan(
  score: StrictFailedScoreReport,
  plan: HistoricalPlan,
): string[] {
  if (score.verification.paid_plan_sha256 !== plan.plan_sha256) {
    throw new Error("strict score report does not bind the prior exact-eight plan SHA-256");
  }
  if (!exactOrder(score.units.map((unit) => unit.unit_id), FIXED_EIGHT_ORDERED_UNIT_IDS)) {
    throw new Error("strict score report units are not the exact fixed eight in order");
  }
  if (!exactOrder(score.gate.blocking_unit_ids, FIXED_EIGHT_BLOCKING_UNIT_IDS)) {
    throw new Error("strict score report blocking units do not match the approved fixed seven");
  }
  if (!exactOrder(score.gate.non_blocking_unit_ids, FIXED_EIGHT_NON_BLOCKING_UNIT_IDS)) {
    throw new Error("strict score report non-blocking unit does not match the approved May image unit");
  }
  for (const [index, scoreUnit] of score.units.entries()) {
    const planUnit = plan.payload.units[index];
    const provenance = scoreUnit.provenance;
    if (
      !planUnit
      || provenance.paid_plan_sha256 !== plan.plan_sha256
      || provenance.source_fingerprint !== planUnit.source_fingerprint
      || provenance.conversion_fingerprint !== planUnit.artifact_fingerprint
      || provenance.model !== plan.payload.model
      || provenance.prompt_version !== plan.payload.prompt_version
      || provenance.prompt_hash !== plan.payload.prompt_hash
      || provenance.processing_version !== plan.payload.processing_version
      || provenance.scanner_parser_version !== plan.payload.scanner_parser_version
      || provenance.converter_version !== planUnit.converter_version
      || !sameStringArray(provenance.request_hashes, planUnit.request_hashes)
    ) {
      throw new Error(`strict score provenance does not match prior plan unit: ${scoreUnit.unit_id}`);
    }
  }
  const failedBlockingUnitIds = score.units
    .filter((unit) => FIXED_EIGHT_BLOCKING_UNIT_IDS.includes(
      unit.unit_id as (typeof FIXED_EIGHT_BLOCKING_UNIT_IDS)[number],
    ) && unit.status === "fail")
    .map((unit) => unit.unit_id);
  const blockedBlockingUnits = score.units.filter((unit) => FIXED_EIGHT_BLOCKING_UNIT_IDS.includes(
    unit.unit_id as (typeof FIXED_EIGHT_BLOCKING_UNIT_IDS)[number],
  ) && unit.status === "blocked");
  if (blockedBlockingUnits.length > 0) {
    throw new Error("blocked score units require provenance repair, not another paid extraction");
  }
  if (failedBlockingUnitIds.length === 0) {
    throw new Error("strict score report contains no failed blocking unit eligible for paid repair");
  }
  if (
    score.gate.status !== "fail"
    || score.gate.blocking_failed_units !== failedBlockingUnitIds.length
    || score.gate.blocking_blocked_units !== 0
    || score.gate.blocking_passed_units !== 7 - failedBlockingUnitIds.length
  ) {
    throw new Error("strict score gate counts do not match its unit statuses");
  }
  return failedBlockingUnitIds;
}

function repairPayload(
  input: CreateFailedUnitRepairApprovalInput,
  plan: HistoricalPlan,
  score: StrictFailedScoreReport,
  scoreBytes: Buffer,
  scoreRelativePath: string,
  actualFailedBlockingUnitIds: string[],
): z.input<typeof FailedUnitRepairApprovalPayloadSchema> {
  if (!exactOrder(input.expectedFailedBlockingUnitIds, actualFailedBlockingUnitIds)) {
    throw new Error("explicit failed blocking unit IDs do not exactly match the strict score report");
  }
  if (input.selectedUnitIds.length === 0) {
    throw new Error("paid repair selection cannot be empty");
  }
  const selectedInFixedOrder = FIXED_EIGHT_ORDERED_UNIT_IDS.filter(
    (unitId) => input.selectedUnitIds.includes(unitId),
  );
  if (!exactOrder(input.selectedUnitIds, selectedInFixedOrder)) {
    throw new Error("paid repair selection must be unique and retain fixed-eight order");
  }
  if (input.selectedUnitIds.some((unitId) => !actualFailedBlockingUnitIds.includes(unitId))) {
    throw new Error("paid repair selection may contain only actually failed blocking units");
  }
  if (!exactOrder(input.units.map((unit) => unit.unitId), input.selectedUnitIds)) {
    throw new Error("paid repair unit inputs do not match the selected unit IDs");
  }
  const units = input.units.map((unit) => ({
    unit_id: unit.unitId,
    source_fingerprint: unit.sourceFingerprint,
    artifact_fingerprint: unit.artifactFingerprint,
    converter_version: unit.converterVersion,
    request_count: unit.requestHashes.length,
    request_hashes: [...unit.requestHashes],
    estimated_input_tokens: unit.estimatedInputTokens,
    estimated_output_tokens: unit.estimatedOutputTokens,
    maximum_input_tokens: unit.maximumInputTokens,
    maximum_output_tokens: unit.maximumOutputTokens,
    estimated_cost_usd: estimateExtractionCostUsd(
      input.model,
      unit.estimatedInputTokens,
      unit.estimatedOutputTokens,
    ),
    maximum_cost_usd: estimateExtractionCostUsd(
      input.model,
      unit.maximumInputTokens,
      unit.maximumOutputTokens,
    ),
  }));
  const totals = units.reduce((result, unit) => ({
    requestCount: result.requestCount + unit.request_count,
    estimatedInput: result.estimatedInput + unit.estimated_input_tokens,
    estimatedOutput: result.estimatedOutput + unit.estimated_output_tokens,
    maximumInput: result.maximumInput + unit.maximum_input_tokens,
    maximumOutput: result.maximumOutput + unit.maximum_output_tokens,
  }), { requestCount: 0, estimatedInput: 0, estimatedOutput: 0, maximumInput: 0, maximumOutput: 0 });
  const rates = modelRates(input.model);
  return {
    prior_plan_sha256: plan.plan_sha256,
    prior_score_report: {
      relative_path: scoreRelativePath,
      sha256: sha256Bytes(scoreBytes),
      bytes: scoreBytes.byteLength,
      failed_blocking_unit_ids: actualFailedBlockingUnitIds,
      units: score.units.map((unit) => ({
        unit_id: unit.unit_id,
        status: unit.status,
        provenance: unit.provenance,
      })),
    },
    ordered_unit_ids: [...input.selectedUnitIds],
    model: input.model,
    prompt_version: EXTRACTION_PROMPT_VERSION,
    prompt_hash: EXTRACTION_PROMPT_HASH,
    processing_version: EXTRACTION_PROCESSING_VERSION,
    scanner_parser_version: input.scannerParserVersion,
    units,
    cost: {
      pricing_schedule: PAID_REPAIR_PRICING_SCHEDULE,
      input_usd_per_million: rates.input_usd_per_million,
      output_usd_per_million: rates.output_usd_per_million,
      authorized_ceiling_usd: input.authorizedCostCeilingUsd,
      request_count: totals.requestCount,
      estimated_input_tokens: totals.estimatedInput,
      estimated_output_tokens: totals.estimatedOutput,
      maximum_input_tokens: totals.maximumInput,
      maximum_output_tokens: totals.maximumOutput,
      estimated_cost_usd: estimateExtractionCostUsd(
        input.model,
        totals.estimatedInput,
        totals.estimatedOutput,
      ),
      maximum_cost_usd: estimateExtractionCostUsd(
        input.model,
        totals.maximumInput,
        totals.maximumOutput,
      ),
    },
  };
}

export async function createFailedUnitRepairApproval(
  input: CreateFailedUnitRepairApprovalInput,
): Promise<FailedUnitRepairApproval> {
  const priorPlanSha256 = Sha256Schema.parse(input.priorPlanSha256.trim());
  const scoreRelativePath = ScoreRelativePathSchema.parse(input.priorScoreReportRelativePath);
  const plan = await readHistoricalPlan(input.stateDir, priorPlanSha256);
  const scoreEvidence = await readJsonEvidence(
    input.stateDir,
    scoreRelativePath,
    input.expectedPriorScoreReportSha256,
  );
  const score = StrictFailedScoreReportSchema.parse(scoreEvidence.value);
  const actualFailedBlockingUnitIds = assertScoreMatchesHistoricalPlan(score, plan);
  const payload = FailedUnitRepairApprovalPayloadSchema.parse(repairPayload(
    input,
    plan,
    score,
    scoreEvidence.bytes,
    scoreRelativePath,
    actualFailedBlockingUnitIds,
  ));
  return FailedUnitRepairApprovalSchema.parse({
    schema_version: 1,
    kind: "fixed_eight_failed_unit_repair_approval",
    payload,
    approval_sha256: canonicalSha256(payload),
  });
}

export function validateFailedUnitRepairApproval(
  value: unknown,
  expectedApprovalSha256?: string,
): FailedUnitRepairApproval {
  const approval = FailedUnitRepairApprovalSchema.parse(value);
  if (canonicalSha256(approval.payload) !== approval.approval_sha256) {
    throw new Error("failed-unit repair approval SHA-256 does not match its canonical payload");
  }
  if (
    expectedApprovalSha256 !== undefined
    && approval.approval_sha256 !== Sha256Schema.parse(expectedApprovalSha256.trim())
  ) {
    throw new Error("failed-unit repair approval does not match the explicitly approved SHA-256");
  }
  return approval;
}

export async function assertFailedUnitRepairApprovalMatches(
  value: unknown,
  currentInput: CreateFailedUnitRepairApprovalInput,
  expectedApprovalSha256?: string,
): Promise<FailedUnitRepairApproval> {
  const approval = validateFailedUnitRepairApproval(value, expectedApprovalSha256);
  const current = await createFailedUnitRepairApproval(currentInput);
  if (approval.approval_sha256 !== current.approval_sha256) {
    throw new Error("failed-unit repair approval no longer matches prior evidence, current requests, or cost");
  }
  return approval;
}

export function failedUnitRepairApprovalPath(
  stateDir: string,
  approvalSha256: string,
): string {
  const normalized = Sha256Schema.parse(approvalSha256.trim());
  return path.join(
    path.resolve(stateDir),
    REPAIR_APPROVAL_DIRECTORY,
    `fixed-eight-repair-${normalized}.json`,
  );
}

export async function writeFailedUnitRepairApproval(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const approval = validateFailedUnitRepairApproval(value);
  const fileName = `fixed-eight-repair-${approval.approval_sha256}.json`;
  try {
    return await writeContentAddressedJsonNoOverwrite(
      stateDir,
      REPAIR_APPROVAL_DIRECTORY,
      fileName,
      approval,
    );
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const relativePath = `${REPAIR_APPROVAL_DIRECTORY}/${fileName}`;
    const existing = await readJsonEvidence(stateDir, relativePath);
    const expectedBytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`, "utf8");
    if (!existing.bytes.equals(expectedBytes)) {
      throw new Error("existing failed-unit repair approval bytes do not match the approved artifact");
    }
    validateFailedUnitRepairApproval(existing.value, approval.approval_sha256);
    return failedUnitRepairApprovalPath(stateDir, approval.approval_sha256);
  }
}

export async function readFailedUnitRepairApproval(
  stateDir: string,
  expectedApprovalSha256: string,
): Promise<FailedUnitRepairApproval> {
  const normalized = Sha256Schema.parse(expectedApprovalSha256.trim());
  const relativePath = `${REPAIR_APPROVAL_DIRECTORY}/fixed-eight-repair-${normalized}.json`;
  const evidence = await readJsonEvidence(stateDir, relativePath);
  return validateFailedUnitRepairApproval(evidence.value, normalized);
}
