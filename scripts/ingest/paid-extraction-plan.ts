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
import { estimateExtractionCostUsd } from "./ledger.js";
import { AiLedgerSnapshotSchema, type AiLedgerSnapshot } from "./ledger.js";
import { FIXED_EIGHT_ORDERED_UNIT_IDS } from "./pilot-pass-receipt.js";
import {
  PaidExecutionDomainBindingSchema,
  type PaidExecutionDomainBinding,
} from "./paid-execution-domain.js";

export const MAX_FIXED_EIGHT_APPROVED_COST_USD = 20;
export const PAID_EXTRACTION_PRICING_SCHEDULE = "openai-standard-2026-07-09" as const;

const APPROVAL_DIRECTORY = "paid-extraction-plans";
const MAX_APPROVAL_BYTES = 2 * 1024 * 1024;
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ModelSchema = z.enum(ALLOWED_EXTRACTION_MODELS);
const SafeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const CostSchema = z.number().finite().nonnegative().max(1_000_000);

function exactExtractionCostUsd(
  model: ExtractionModel,
  inputTokens: number,
  outputTokens: number,
): number {
  return estimateExtractionCostUsd(model, inputTokens, outputTokens);
}

function currentModelRates(model: ExtractionModel): {
  input_usd_per_million: number;
  output_usd_per_million: number;
} {
  return {
    input_usd_per_million: exactExtractionCostUsd(model, 1_000_000, 0),
    output_usd_per_million: exactExtractionCostUsd(model, 0, 1_000_000),
  };
}

function addMismatch(
  context: z.RefinementCtx,
  pathSegments: Array<string | number>,
  message: string,
): void {
  context.addIssue({ code: "custom", path: pathSegments, message });
}

export const PaidExtractionPlanUnitSchema = z.object({
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
    addMismatch(context, ["request_count"], "request_count must equal ordered request_hashes length");
  }
  if (unit.request_count !== unit.authorized_request_hashes_by_batch.length) {
    addMismatch(
      context,
      ["authorized_request_hashes_by_batch"],
      "authorized request hash sets must align one-for-one with planned batches",
    );
  }
  for (const [batchIndex, authorizedHashes] of unit.authorized_request_hashes_by_batch.entries()) {
    if (authorizedHashes[0] !== unit.request_hashes[batchIndex]) {
      addMismatch(
        context,
        ["authorized_request_hashes_by_batch", batchIndex],
        "the initial planned request hash must be the first authorized hash",
      );
    }
    if (new Set(authorizedHashes).size !== authorizedHashes.length) {
      addMismatch(
        context,
        ["authorized_request_hashes_by_batch", batchIndex],
        "authorized request hashes must be unique within a batch",
      );
    }
  }
  if (unit.maximum_input_tokens < unit.estimated_input_tokens) {
    addMismatch(context, ["maximum_input_tokens"], "maximum input tokens cannot be below the estimate");
  }
  if (unit.maximum_output_tokens < unit.estimated_output_tokens) {
    addMismatch(context, ["maximum_output_tokens"], "maximum output tokens cannot be below the estimate");
  }
});

const PaidExtractionCostSchema = z.object({
  pricing_schedule: z.literal(PAID_EXTRACTION_PRICING_SCHEDULE),
  input_usd_per_million: CostSchema,
  output_usd_per_million: CostSchema,
  authorized_ceiling_usd: z.number().finite().nonnegative().max(MAX_FIXED_EIGHT_APPROVED_COST_USD),
  request_count: z.number().int().min(1).max(8 * 96),
  estimated_input_tokens: SafeCountSchema,
  estimated_output_tokens: SafeCountSchema,
  maximum_input_tokens: SafeCountSchema,
  maximum_output_tokens: SafeCountSchema,
  estimated_cost_usd: CostSchema,
  maximum_cost_usd: CostSchema,
}).strict();

export const PaidExtractionPlanPayloadSchema = z.object({
  execution_domain: PaidExecutionDomainBindingSchema,
  prior_durable_ledger: AiLedgerSnapshotSchema,
  ordered_unit_ids: z.array(Sha256Schema).length(8),
  model: ModelSchema,
  prompt_version: z.string().min(1).max(100),
  prompt_hash: Sha256Schema,
  processing_version: Sha256Schema,
  scanner_parser_version: z.string().min(1).max(100),
  units: z.array(PaidExtractionPlanUnitSchema).length(8),
  cost: PaidExtractionCostSchema,
}).strict().superRefine((payload, context) => {
  const genesis = payload.execution_domain.genesis_ledger;
  if (
    payload.prior_durable_ledger.byte_count < genesis.byte_count
    || payload.prior_durable_ledger.row_count < genesis.row_count
    || payload.prior_durable_ledger.cumulative_cost_usd < genesis.cumulative_cost_usd
  ) {
    addMismatch(
      context,
      ["prior_durable_ledger"],
      "paid extraction approval ledger cannot precede the execution-domain genesis",
    );
  }
  if (
    payload.prior_durable_ledger.byte_count === genesis.byte_count
    && (
      payload.prior_durable_ledger.content_sha256 !== genesis.content_sha256
      || payload.prior_durable_ledger.row_count !== genesis.row_count
      || payload.prior_durable_ledger.cumulative_cost_usd !== genesis.cumulative_cost_usd
    )
  ) {
    addMismatch(
      context,
      ["prior_durable_ledger"],
      "paid extraction approval ledger at genesis must exactly match the execution domain",
    );
  }
  const expectedIds = [...FIXED_EIGHT_ORDERED_UNIT_IDS];
  const orderedIdsMatch = payload.ordered_unit_ids.every(
    (unitId, index) => unitId === expectedIds[index],
  );
  if (!orderedIdsMatch) {
    addMismatch(context, ["ordered_unit_ids"], "paid extraction approval requires the exact fixed-eight order");
  }
  const unitIdsMatch = payload.units.every(
    (unit, index) => unit.unit_id === expectedIds[index],
  );
  if (!unitIdsMatch) {
    addMismatch(context, ["units"], "paid extraction approval units must match the exact fixed-eight order");
  }
  if (
    payload.prompt_version !== EXTRACTION_PROMPT_VERSION
    || payload.prompt_hash !== EXTRACTION_PROMPT_HASH
    || payload.processing_version !== EXTRACTION_PROCESSING_VERSION
  ) {
    addMismatch(context, ["prompt_hash"], "paid extraction approval uses a stale extraction contract");
  }

  const rates = currentModelRates(payload.model);
  if (
    payload.cost.input_usd_per_million !== rates.input_usd_per_million
    || payload.cost.output_usd_per_million !== rates.output_usd_per_million
  ) {
    addMismatch(context, ["cost"], "paid extraction approval rate card does not match the selected model");
  }

  for (const [index, unit] of payload.units.entries()) {
    const expectedEstimatedCost = exactExtractionCostUsd(
      payload.model,
      unit.estimated_input_tokens,
      unit.estimated_output_tokens,
    );
    const expectedMaximumCost = exactExtractionCostUsd(
      payload.model,
      unit.maximum_input_tokens,
      unit.maximum_output_tokens,
    );
    if (unit.estimated_cost_usd !== expectedEstimatedCost) {
      addMismatch(context, ["units", index, "estimated_cost_usd"], "unit estimated cost is not token-derived");
    }
    if (unit.maximum_cost_usd !== expectedMaximumCost) {
      addMismatch(context, ["units", index, "maximum_cost_usd"], "unit maximum cost is not token-derived");
    }
    if (unit.maximum_cost_usd < unit.estimated_cost_usd) {
      addMismatch(context, ["units", index, "maximum_cost_usd"], "unit maximum cost cannot be below its estimate");
    }
  }

  const totals = payload.units.reduce((result, unit) => ({
    requestCount: result.requestCount + unit.request_count,
    estimatedInputTokens: result.estimatedInputTokens + unit.estimated_input_tokens,
    estimatedOutputTokens: result.estimatedOutputTokens + unit.estimated_output_tokens,
    maximumInputTokens: result.maximumInputTokens + unit.maximum_input_tokens,
    maximumOutputTokens: result.maximumOutputTokens + unit.maximum_output_tokens,
  }), {
    requestCount: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    maximumInputTokens: 0,
    maximumOutputTokens: 0,
  });
  const aggregateCounts = [
    totals.requestCount,
    totals.estimatedInputTokens,
    totals.estimatedOutputTokens,
    totals.maximumInputTokens,
    totals.maximumOutputTokens,
  ];
  if (aggregateCounts.some((count) => !Number.isSafeInteger(count))) {
    addMismatch(context, ["cost"], "aggregate request and token totals must remain safe integers");
    return;
  }
  const expectedEstimatedCost = exactExtractionCostUsd(
    payload.model,
    totals.estimatedInputTokens,
    totals.estimatedOutputTokens,
  );
  const expectedMaximumCost = exactExtractionCostUsd(
    payload.model,
    totals.maximumInputTokens,
    totals.maximumOutputTokens,
  );
  const exactTotals =
    payload.cost.request_count === totals.requestCount
    && payload.cost.estimated_input_tokens === totals.estimatedInputTokens
    && payload.cost.estimated_output_tokens === totals.estimatedOutputTokens
    && payload.cost.maximum_input_tokens === totals.maximumInputTokens
    && payload.cost.maximum_output_tokens === totals.maximumOutputTokens
    && payload.cost.estimated_cost_usd === expectedEstimatedCost
    && payload.cost.maximum_cost_usd === expectedMaximumCost;
  if (!exactTotals) {
    addMismatch(context, ["cost"], "aggregate cost and token totals must be exactly derived from the eight units");
  }
  if (payload.cost.maximum_cost_usd < payload.cost.estimated_cost_usd) {
    addMismatch(context, ["cost", "maximum_cost_usd"], "maximum cost cannot be below the estimate");
  }
  if (payload.cost.estimated_cost_usd > payload.cost.authorized_ceiling_usd) {
    addMismatch(context, ["cost", "estimated_cost_usd"], "estimated cost exceeds the authorized ceiling");
  }
  if (payload.cost.maximum_cost_usd > payload.cost.authorized_ceiling_usd) {
    addMismatch(context, ["cost", "maximum_cost_usd"], "maximum cost exceeds the authorized ceiling");
  }
});

export const PaidExtractionPlanApprovalSchema = z.object({
  schema_version: z.literal(3),
  kind: z.literal("fixed_eight_paid_extraction_plan_approval"),
  payload: PaidExtractionPlanPayloadSchema,
  plan_sha256: Sha256Schema,
}).strict();

export type PaidExtractionPlanUnit = z.infer<typeof PaidExtractionPlanUnitSchema>;
export type PaidExtractionPlanPayload = z.infer<typeof PaidExtractionPlanPayloadSchema>;
export type PaidExtractionPlanApproval = z.infer<typeof PaidExtractionPlanApprovalSchema>;

export interface PaidExtractionPlanUnitInput {
  unitId: string;
  sourceFingerprint: string;
  artifactFingerprint: string;
  converterVersion: string;
  requestHashes: string[];
  /**
   * Ordered allow-list for each batch. The first hash must be the initial
   * request hash. Static retry variants may be added by the caller; dynamic
   * unplanned repair payloads remain unauthorized.
   */
  authorizedRequestHashesByBatch?: string[][];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  maximumInputTokens: number;
  maximumOutputTokens: number;
}

export interface CreatePaidExtractionPlanApprovalInput {
  executionDomain: PaidExecutionDomainBinding;
  model: ExtractionModel;
  scannerParserVersion: string;
  authorizedCostCeilingUsd: number;
  priorDurableLedger: AiLedgerSnapshot;
  units: PaidExtractionPlanUnitInput[];
}

function approvalPayload(input: CreatePaidExtractionPlanApprovalInput): PaidExtractionPlanPayload {
  const units = input.units.map((unit) => ({
    unit_id: unit.unitId,
    source_fingerprint: unit.sourceFingerprint,
    artifact_fingerprint: unit.artifactFingerprint,
    converter_version: unit.converterVersion,
    request_count: unit.requestHashes.length,
    request_hashes: [...unit.requestHashes],
    authorized_request_hashes_by_batch: unit.authorizedRequestHashesByBatch
      ?.map((hashes) => [...hashes])
      ?? unit.requestHashes.map((requestHash) => [requestHash]),
    estimated_input_tokens: unit.estimatedInputTokens,
    estimated_output_tokens: unit.estimatedOutputTokens,
    maximum_input_tokens: unit.maximumInputTokens,
    maximum_output_tokens: unit.maximumOutputTokens,
    estimated_cost_usd: exactExtractionCostUsd(
      input.model,
      unit.estimatedInputTokens,
      unit.estimatedOutputTokens,
    ),
    maximum_cost_usd: exactExtractionCostUsd(
      input.model,
      unit.maximumInputTokens,
      unit.maximumOutputTokens,
    ),
  }));
  const totals = units.reduce((result, unit) => ({
    requestCount: result.requestCount + unit.request_count,
    estimatedInputTokens: result.estimatedInputTokens + unit.estimated_input_tokens,
    estimatedOutputTokens: result.estimatedOutputTokens + unit.estimated_output_tokens,
    maximumInputTokens: result.maximumInputTokens + unit.maximum_input_tokens,
    maximumOutputTokens: result.maximumOutputTokens + unit.maximum_output_tokens,
  }), {
    requestCount: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    maximumInputTokens: 0,
    maximumOutputTokens: 0,
  });
  const rates = currentModelRates(input.model);
  return PaidExtractionPlanPayloadSchema.parse({
    execution_domain: input.executionDomain,
    prior_durable_ledger: input.priorDurableLedger,
    ordered_unit_ids: [...FIXED_EIGHT_ORDERED_UNIT_IDS],
    model: input.model,
    prompt_version: EXTRACTION_PROMPT_VERSION,
    prompt_hash: EXTRACTION_PROMPT_HASH,
    processing_version: EXTRACTION_PROCESSING_VERSION,
    scanner_parser_version: input.scannerParserVersion,
    units,
    cost: {
      pricing_schedule: PAID_EXTRACTION_PRICING_SCHEDULE,
      input_usd_per_million: rates.input_usd_per_million,
      output_usd_per_million: rates.output_usd_per_million,
      authorized_ceiling_usd: input.authorizedCostCeilingUsd,
      request_count: totals.requestCount,
      estimated_input_tokens: totals.estimatedInputTokens,
      estimated_output_tokens: totals.estimatedOutputTokens,
      maximum_input_tokens: totals.maximumInputTokens,
      maximum_output_tokens: totals.maximumOutputTokens,
      estimated_cost_usd: exactExtractionCostUsd(
        input.model,
        totals.estimatedInputTokens,
        totals.estimatedOutputTokens,
      ),
      maximum_cost_usd: exactExtractionCostUsd(
        input.model,
        totals.maximumInputTokens,
        totals.maximumOutputTokens,
      ),
    },
  });
}

export function createFixedEightPaidExtractionPlanApproval(
  input: CreatePaidExtractionPlanApprovalInput,
): PaidExtractionPlanApproval {
  const payload = approvalPayload(input);
  return PaidExtractionPlanApprovalSchema.parse({
    schema_version: 3,
    kind: "fixed_eight_paid_extraction_plan_approval",
    payload,
    plan_sha256: canonicalSha256(payload),
  });
}

export function validateFixedEightPaidExtractionPlanApproval(
  value: unknown,
  expectedPlanSha256?: string,
): PaidExtractionPlanApproval {
  const approval = PaidExtractionPlanApprovalSchema.parse(value);
  const actualPlanSha256 = canonicalSha256(approval.payload);
  if (actualPlanSha256 !== approval.plan_sha256) {
    throw new Error("paid extraction plan SHA-256 does not match its canonical payload");
  }
  if (expectedPlanSha256 !== undefined) {
    const expected = Sha256Schema.parse(expectedPlanSha256);
    if (approval.plan_sha256 !== expected) {
      throw new Error("paid extraction plan does not match the explicitly approved SHA-256");
    }
  }
  return approval;
}

export function assertFixedEightPaidExtractionPlanApprovalMatches(
  value: unknown,
  currentInput: CreatePaidExtractionPlanApprovalInput,
  expectedPlanSha256?: string,
): PaidExtractionPlanApproval {
  const approval = validateFixedEightPaidExtractionPlanApproval(value, expectedPlanSha256);
  const current = createFixedEightPaidExtractionPlanApproval(currentInput);
  if (approval.plan_sha256 !== current.plan_sha256) {
    throw new Error("paid extraction plan no longer matches the current source, model, requests, or cost");
  }
  return approval;
}

function normalizedPlanSha256(value: string): string {
  return Sha256Schema.parse(value.trim());
}

export function fixedEightPaidExtractionPlanPath(
  stateDir: string,
  planSha256: string,
): string {
  const normalized = normalizedPlanSha256(planSha256);
  return path.join(path.resolve(stateDir), APPROVAL_DIRECTORY, `${normalized}.json`);
}

export async function writeFixedEightPaidExtractionPlanApproval(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const approval = validateFixedEightPaidExtractionPlanApproval(value);
  try {
    return await writeContentAddressedJsonNoOverwrite(
      stateDir,
      APPROVAL_DIRECTORY,
      `${approval.plan_sha256}.json`,
      approval,
    );
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
    const existing = await readFixedEightPaidExtractionPlanApprovalBytes(
      stateDir,
      approval.plan_sha256,
    );
    const expectedBytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`, "utf8");
    if (!existing.bytes.equals(expectedBytes)) {
      throw new Error("existing paid extraction plan bytes do not match the approved artifact");
    }
    return existing.path;
  }
}

async function readFixedEightPaidExtractionPlanApprovalBytes(
  stateDir: string,
  expectedPlanSha256: string,
): Promise<{ approval: PaidExtractionPlanApproval; bytes: Buffer; path: string }> {
  const normalized = normalizedPlanSha256(expectedPlanSha256);
  const artifactPath = fixedEightPaidExtractionPlanPath(stateDir, normalized);
  const verifiedPath = await verifyDeterministicStateArtifactPath({
    stateDir,
    artifactPath,
    expectedRelativePath: path.join(APPROVAL_DIRECTORY, `${normalized}.json`),
  });
  const bytes = await readFile(verifiedPath);
  if (bytes.byteLength > MAX_APPROVAL_BYTES) {
    throw new Error(`paid extraction plan exceeds ${MAX_APPROVAL_BYTES} bytes`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("paid extraction plan is not valid JSON");
  }
  return {
    approval: validateFixedEightPaidExtractionPlanApproval(raw, normalized),
    bytes,
    path: verifiedPath,
  };
}

export async function readFixedEightPaidExtractionPlanApproval(
  stateDir: string,
  expectedPlanSha256: string,
): Promise<PaidExtractionPlanApproval> {
  return (await readFixedEightPaidExtractionPlanApprovalBytes(
    stateDir,
    expectedPlanSha256,
  )).approval;
}

export function assertPaidExtractionPlannedRequestHashes(
  approvalValue: PaidExtractionPlanApproval,
  unitId: string,
  requestHashes: readonly string[],
): PaidExtractionPlanUnit {
  const approval = validateFixedEightPaidExtractionPlanApproval(
    approvalValue,
    approvalValue.plan_sha256,
  );
  const unit = approval.payload.units.find((candidate) => candidate.unit_id === unitId);
  if (!unit
    || unit.request_hashes.length !== requestHashes.length
    || unit.request_hashes.some((requestHash, index) => requestHash !== requestHashes[index])) {
    throw new Error("paid_plan_planned_batch_request_hash_mismatch");
  }
  return unit;
}

export function assertPaidExtractionAttemptRequestAuthorized(
  approvalValue: PaidExtractionPlanApproval,
  unitId: string,
  batchIndex: number,
  requestHash: string,
): void {
  const approval = validateFixedEightPaidExtractionPlanApproval(
    approvalValue,
    approvalValue.plan_sha256,
  );
  const unit = approval.payload.units.find((candidate) => candidate.unit_id === unitId);
  const authorized = unit?.authorized_request_hashes_by_batch[batchIndex];
  if (!authorized?.includes(Sha256Schema.parse(requestHash))) {
    throw new Error("paid_plan_attempt_request_hash_not_authorized");
  }
}
