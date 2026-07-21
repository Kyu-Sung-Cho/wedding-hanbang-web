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
import {
  estimateExtractionCostUsd,
  GPT_5_6_LONG_CONTEXT_INPUT_PRICE_MULTIPLIER,
  GPT_5_6_LONG_CONTEXT_INPUT_THRESHOLD_TOKENS,
  GPT_5_6_LONG_CONTEXT_OUTPUT_PRICE_MULTIPLIER,
} from "./ledger.js";
import { AiLedgerSnapshotSchema, type AiLedgerSnapshot } from "./ledger.js";
import { FIXED_EIGHT_ORDERED_UNIT_IDS } from "./pilot-pass-receipt.js";
import {
  MAX_FIXED_EIGHT_APPROVED_COST_USD,
  MAX_PAID_EXTRACTION_ABSOLUTE_COST_NANO_USD,
  MAX_PAID_EXTRACTION_ABSOLUTE_COST_USD,
  PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH,
  PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
  PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
  costUsdToNanoUsdCeil,
  limitUsdToNanoUsdFloor,
} from "./paid-extraction-budget.js";
import {
  PaidExecutionDomainBindingSchema,
  type PaidExecutionDomainBinding,
} from "./paid-execution-domain.js";

export {
  MAX_FIXED_EIGHT_APPROVED_COST_USD,
  MAX_PAID_EXTRACTION_ABSOLUTE_COST_NANO_USD,
  MAX_PAID_EXTRACTION_ABSOLUTE_COST_USD,
  PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH,
  PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
  PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
};
export const PAID_EXTRACTION_PRICING_SCHEDULE = "openai-standard-long-context-2026-07-20" as const;
export const MAX_PAID_EXTRACTION_BATCH_UNITS = 25;
export const MAX_PAID_EXTRACTION_REQUESTS_PER_UNIT = 256;
const MAX_FIXED_EIGHT_REQUESTS_PER_UNIT = 96;

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
    input_usd_per_million: exactExtractionCostUsd(model, 1, 0) * 1_000_000,
    output_usd_per_million: exactExtractionCostUsd(model, 0, 1) * 1_000_000,
  };
}

function plannedAggregateCostUsd(
  model: ExtractionModel,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = currentModelRates(model);
  return (
    (inputTokens * rates.input_usd_per_million)
    + (outputTokens * rates.output_usd_per_million)
  ) / 1_000_000;
}

function addMismatch(
  context: z.RefinementCtx,
  pathSegments: Array<string | number>,
  message: string,
): void {
  context.addIssue({ code: "custom", path: pathSegments, message });
}

const PaidExtractionAuthorizedRequestReservationSchema = z.object({
  request_hash: Sha256Schema,
  maximum_input_tokens: SafeCountSchema,
  maximum_output_tokens: SafeCountSchema,
  maximum_cost_usd: CostSchema,
  maximum_cost_nano_usd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((reservation, context) => {
  if (reservation.maximum_input_tokens !== PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND) {
    addMismatch(context, ["maximum_input_tokens"], "reservation must use the provider context-window input bound");
  }
  if (reservation.maximum_output_tokens !== PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP) {
    addMismatch(context, ["maximum_output_tokens"], "reservation must use the request output-token cap");
  }
});

const PaidExtractionPlannedRequestEstimateSchema = z.object({
  request_hash: Sha256Schema,
  estimated_input_tokens: SafeCountSchema.max(GPT_5_6_LONG_CONTEXT_INPUT_THRESHOLD_TOKENS),
  estimated_output_tokens: SafeCountSchema.max(PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP),
  estimated_cost_usd: CostSchema,
}).strict();

export const PaidExtractionPlanUnitSchema = z.object({
  unit_id: Sha256Schema,
  extraction_fingerprint: Sha256Schema,
  source_fingerprint: Sha256Schema,
  artifact_fingerprint: Sha256Schema,
  converter_version: z.string().min(1).max(100),
  request_count: z.number().int().min(1).max(MAX_PAID_EXTRACTION_REQUESTS_PER_UNIT),
  request_hashes: z.array(Sha256Schema).min(1).max(MAX_PAID_EXTRACTION_REQUESTS_PER_UNIT),
  authorized_request_hashes_by_batch: z.array(
    z.array(Sha256Schema).min(1).max(4),
  ).min(1).max(MAX_PAID_EXTRACTION_REQUESTS_PER_UNIT),
  authorized_request_reservations_by_batch: z.array(
    z.array(PaidExtractionAuthorizedRequestReservationSchema).min(1).max(4),
  ).min(1).max(MAX_PAID_EXTRACTION_REQUESTS_PER_UNIT),
  planned_request_estimates: z.array(PaidExtractionPlannedRequestEstimateSchema)
    .min(1)
    .max(MAX_PAID_EXTRACTION_REQUESTS_PER_UNIT),
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
  if (unit.request_count !== unit.authorized_request_reservations_by_batch.length) {
    addMismatch(
      context,
      ["authorized_request_reservations_by_batch"],
      "authorized request reservations must align one-for-one with planned batches",
    );
  }
  if (
    unit.request_count !== unit.planned_request_estimates.length
    || unit.planned_request_estimates.some(
      (estimate, index) => estimate.request_hash !== unit.request_hashes[index],
    )
  ) {
    addMismatch(
      context,
      ["planned_request_estimates"],
      "planned request estimates must exactly align with initial request hashes",
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
    const reservations = unit.authorized_request_reservations_by_batch[batchIndex];
    if (
      !reservations
      || reservations.length !== authorizedHashes.length
      || reservations.some(
        (reservation, requestIndex) => reservation.request_hash !== authorizedHashes[requestIndex],
      )
    ) {
      addMismatch(
        context,
        ["authorized_request_reservations_by_batch", batchIndex],
        "authorized request reservations must exactly match the ordered request hash allow-list",
      );
    }
  }
  if (unit.maximum_input_tokens < unit.estimated_input_tokens) {
    addMismatch(context, ["maximum_input_tokens"], "maximum input tokens cannot be below the estimate");
  }
  if (unit.maximum_output_tokens < unit.estimated_output_tokens) {
    addMismatch(context, ["maximum_output_tokens"], "maximum output tokens cannot be below the estimate");
  }
  const derivedMaximumInputTokens = unit.authorized_request_reservations_by_batch.reduce(
    (sum, batch) => sum + (Math.max(...batch.map((request) => request.maximum_input_tokens))
      * PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH),
    0,
  );
  const derivedEstimatedInputTokens = unit.planned_request_estimates.reduce(
    (sum, request) => sum + request.estimated_input_tokens,
    0,
  );
  const derivedEstimatedOutputTokens = unit.planned_request_estimates.reduce(
    (sum, request) => sum + request.estimated_output_tokens,
    0,
  );
  if (
    !Number.isSafeInteger(derivedEstimatedInputTokens)
    || unit.estimated_input_tokens !== derivedEstimatedInputTokens
  ) {
    addMismatch(context, ["estimated_input_tokens"], "unit estimated input must sum request estimates");
  }
  if (
    !Number.isSafeInteger(derivedEstimatedOutputTokens)
    || unit.estimated_output_tokens !== derivedEstimatedOutputTokens
  ) {
    addMismatch(context, ["estimated_output_tokens"], "unit estimated output must sum request estimates");
  }
  const derivedMaximumOutputTokens = unit.authorized_request_reservations_by_batch.reduce(
    (sum, batch) => sum + (Math.max(...batch.map((request) => request.maximum_output_tokens))
      * PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH),
    0,
  );
  if (
    !Number.isSafeInteger(derivedMaximumInputTokens)
    || unit.maximum_input_tokens !== derivedMaximumInputTokens
  ) {
    addMismatch(
      context,
      ["maximum_input_tokens"],
      "unit maximum input must be exactly derived from per-request reservations and retry attempts",
    );
  }
  if (
    !Number.isSafeInteger(derivedMaximumOutputTokens)
    || unit.maximum_output_tokens !== derivedMaximumOutputTokens
  ) {
    addMismatch(
      context,
      ["maximum_output_tokens"],
      "unit maximum output must be exactly derived from per-request reservations and retry attempts",
    );
  }
});

const PaidExtractionCostSchema = z.object({
  approval_policy: z.literal("sequential_runtime_fence_v1"),
  pricing_schedule: z.literal(PAID_EXTRACTION_PRICING_SCHEDULE),
  input_usd_per_million: CostSchema,
  output_usd_per_million: CostSchema,
  long_context_input_threshold_tokens: z.literal(GPT_5_6_LONG_CONTEXT_INPUT_THRESHOLD_TOKENS),
  long_context_input_price_multiplier: z.literal(GPT_5_6_LONG_CONTEXT_INPUT_PRICE_MULTIPLIER),
  long_context_output_price_multiplier: z.literal(GPT_5_6_LONG_CONTEXT_OUTPUT_PRICE_MULTIPLIER),
  authorized_ceiling_usd: z.number().finite().nonnegative()
    .max(MAX_FIXED_EIGHT_APPROVED_COST_USD),
  request_count: z.number().int().min(1)
    .max(MAX_PAID_EXTRACTION_BATCH_UNITS * MAX_PAID_EXTRACTION_REQUESTS_PER_UNIT),
  estimated_input_tokens: SafeCountSchema,
  estimated_output_tokens: SafeCountSchema,
  maximum_input_tokens: SafeCountSchema,
  maximum_output_tokens: SafeCountSchema,
  estimated_cost_usd: CostSchema,
  maximum_cost_usd: CostSchema,
  maximum_single_attempt_cost_usd: CostSchema,
  maximum_single_attempt_cost_nano_usd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  absolute_domain_limit_nano_usd: z.number().int().nonnegative()
    .max(MAX_PAID_EXTRACTION_ABSOLUTE_COST_NANO_USD),
  domain_committed_at_plan_nano_usd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  authorized_incremental_nano_usd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  completion_not_guaranteed: z.boolean(),
}).strict();

export const PaidExtractionPlanPayloadSchema = z.object({
  execution_domain: PaidExecutionDomainBindingSchema,
  prior_durable_ledger: AiLedgerSnapshotSchema,
  ordered_unit_ids: z.array(Sha256Schema).min(1).max(MAX_PAID_EXTRACTION_BATCH_UNITS),
  model: ModelSchema,
  prompt_version: z.string().min(1).max(100),
  prompt_hash: Sha256Schema,
  processing_version: Sha256Schema,
  scanner_parser_version: z.string().min(1).max(100),
  provider_call_contract: z.object({
    input_token_bound: z.literal(PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND),
    max_output_tokens: z.literal(PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP),
    service_tier: z.literal("default"),
    reasoning_effort: z.literal("none"),
    tools_enabled: z.literal(false),
    cache_write_input_price_multiplier: z.literal(1.25),
  }).strict(),
  units: z.array(PaidExtractionPlanUnitSchema).min(1).max(MAX_PAID_EXTRACTION_BATCH_UNITS),
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
  const orderedIdsMatch = payload.ordered_unit_ids.length === payload.units.length
    && payload.units.every(
      (unit, index) => unit.unit_id === payload.ordered_unit_ids[index],
    );
  if (!orderedIdsMatch || new Set(payload.ordered_unit_ids).size !== payload.ordered_unit_ids.length) {
    addMismatch(
      context,
      ["ordered_unit_ids"],
      "paid extraction approval units must exactly match the unique caller-selected order",
    );
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
    for (const [requestIndex, estimate] of unit.planned_request_estimates.entries()) {
      const expectedRequestCost = exactExtractionCostUsd(
        payload.model,
        estimate.estimated_input_tokens,
        estimate.estimated_output_tokens,
      );
      if (estimate.estimated_cost_usd !== expectedRequestCost) {
        addMismatch(
          context,
          ["units", index, "planned_request_estimates", requestIndex, "estimated_cost_usd"],
          "planned request estimate cost is not token-derived",
        );
      }
    }
    for (const [batchIndex, reservations] of unit.authorized_request_reservations_by_batch.entries()) {
      for (const [requestIndex, reservation] of reservations.entries()) {
        const expectedReservationCost = exactExtractionCostUsd(
          payload.model,
          reservation.maximum_input_tokens,
          reservation.maximum_output_tokens,
        );
        if (reservation.maximum_cost_usd !== expectedReservationCost) {
          addMismatch(
            context,
            [
              "units",
              index,
              "authorized_request_reservations_by_batch",
              batchIndex,
              requestIndex,
              "maximum_cost_usd",
            ],
            "authorized request reservation cost is not token-derived",
          );
        }
        if (reservation.maximum_cost_nano_usd !== costUsdToNanoUsdCeil(expectedReservationCost)) {
          addMismatch(
            context,
            [
              "units",
              index,
              "authorized_request_reservations_by_batch",
              batchIndex,
              requestIndex,
              "maximum_cost_nano_usd",
            ],
            "authorized request reservation nano-USD is not cost-derived",
          );
        }
      }
    }
    const expectedEstimatedCost = unit.planned_request_estimates.reduce(
      (sum, request) => sum + request.estimated_cost_usd,
      0,
    );
    const expectedMaximumCost = unit.authorized_request_reservations_by_batch.reduce(
      (sum, batch) => sum + (Math.max(...batch.map((request) => request.maximum_cost_usd))
        * PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH),
      0,
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
  const expectedEstimatedCost = payload.units.reduce(
    (sum, unit) => sum + unit.estimated_cost_usd,
    0,
  );
  const expectedMaximumCost = payload.units.reduce(
    (sum, unit) => sum + unit.maximum_cost_usd,
    0,
  );
  const maximumSingleAttemptCost = Math.max(...payload.units.flatMap(
    (unit) => unit.authorized_request_reservations_by_batch.flatMap(
      (batch) => batch.map((request) => request.maximum_cost_usd),
    ),
  ));
  const exactTotals =
    payload.cost.request_count === totals.requestCount
    && payload.cost.estimated_input_tokens === totals.estimatedInputTokens
    && payload.cost.estimated_output_tokens === totals.estimatedOutputTokens
    && payload.cost.maximum_input_tokens === totals.maximumInputTokens
    && payload.cost.maximum_output_tokens === totals.maximumOutputTokens
    && payload.cost.estimated_cost_usd === expectedEstimatedCost
    && payload.cost.maximum_cost_usd === expectedMaximumCost
    && payload.cost.maximum_single_attempt_cost_usd === maximumSingleAttemptCost
    && payload.cost.maximum_single_attempt_cost_nano_usd
      === costUsdToNanoUsdCeil(maximumSingleAttemptCost)
    && payload.cost.completion_not_guaranteed
      === (expectedMaximumCost > payload.cost.authorized_ceiling_usd);
  if (!exactTotals) {
    addMismatch(context, ["cost"], "aggregate cost and token totals must be exactly derived from the selected units");
  }
  if (payload.cost.maximum_cost_usd < payload.cost.estimated_cost_usd) {
    addMismatch(context, ["cost", "maximum_cost_usd"], "maximum cost cannot be below the estimate");
  }
  if (payload.cost.estimated_cost_usd > payload.cost.authorized_ceiling_usd) {
    addMismatch(context, ["cost", "estimated_cost_usd"], "estimated cost exceeds the authorized ceiling");
  }
  if (payload.cost.maximum_single_attempt_cost_usd > payload.cost.authorized_ceiling_usd) {
    addMismatch(
      context,
      ["cost", "maximum_single_attempt_cost_usd"],
      "maximum single-attempt reservation exceeds the authorized ceiling",
    );
  }
  const expectedCommittedNanoUsd = costUsdToNanoUsdCeil(
    payload.prior_durable_ledger.cumulative_cost_usd,
  );
  if (
    payload.cost.domain_committed_at_plan_nano_usd < expectedCommittedNanoUsd
    || payload.cost.authorized_incremental_nano_usd
      !== limitUsdToNanoUsdFloor(payload.cost.authorized_ceiling_usd)
    || payload.cost.absolute_domain_limit_nano_usd
      !== payload.cost.domain_committed_at_plan_nano_usd
        + payload.cost.authorized_incremental_nano_usd
  ) {
    addMismatch(context, ["cost"], "nano-USD domain authorization fields are inconsistent");
  }
  if (
    costUsdToNanoUsdCeil(payload.cost.estimated_cost_usd)
      > payload.cost.authorized_incremental_nano_usd
  ) {
    addMismatch(context, ["cost", "estimated_cost_usd"], "estimated cost exceeds nano-USD authorization");
  }
  if (
    payload.cost.maximum_single_attempt_cost_nano_usd
      > payload.cost.authorized_incremental_nano_usd
  ) {
    addMismatch(
      context,
      ["cost", "maximum_single_attempt_cost_nano_usd"],
      "single attempt exceeds nano-USD authorization",
    );
  }
});

const FixedEightPaidExtractionPlanPayloadSchema = PaidExtractionPlanPayloadSchema.superRefine(
  (payload, context) => {
    const expectedIds = [...FIXED_EIGHT_ORDERED_UNIT_IDS];
    const exactOrder = payload.ordered_unit_ids.length === expectedIds.length
      && payload.ordered_unit_ids.every((unitId, index) => unitId === expectedIds[index]);
    if (!exactOrder) {
      addMismatch(
        context,
        ["ordered_unit_ids"],
        "paid extraction approval requires the exact fixed-eight order",
      );
    }
    if (payload.units.some((unit) => unit.request_count > MAX_FIXED_EIGHT_REQUESTS_PER_UNIT)) {
      addMismatch(
        context,
        ["units"],
        "fixed-eight paid extraction approval exceeds its historical per-unit request limit",
      );
    }
    if (
      payload.cost.authorized_ceiling_usd > MAX_FIXED_EIGHT_APPROVED_COST_USD
      || payload.cost.absolute_domain_limit_nano_usd
        > MAX_FIXED_EIGHT_APPROVED_COST_USD * 1_000_000_000
    ) {
      addMismatch(
        context,
        ["cost"],
        "fixed-eight paid extraction approval exceeds its historical $20 limit",
      );
    }
  },
);

export const PaidExtractionPlanApprovalSchema = z.object({
  schema_version: z.literal(4),
  kind: z.literal("fixed_eight_paid_extraction_plan_approval"),
  payload: FixedEightPaidExtractionPlanPayloadSchema,
  plan_sha256: Sha256Schema,
}).strict();

export const PaidExtractionBatchPlanApprovalSchema = z.object({
  schema_version: z.literal(5),
  kind: z.literal("paid_extraction_batch_plan_approval"),
  payload: PaidExtractionPlanPayloadSchema,
  plan_sha256: Sha256Schema,
}).strict();

/**
 * A completed pilot score must remain able to refer to the exact plan that
 * produced it after the extraction prompt advances. Parse just the three
 * versioned extraction-contract fields as opaque historical identities here;
 * every other schema-v4 field is still validated below by the full current
 * plan schema after substituting only those identities.
 */
const HistoricalPaidExtractionPlanApprovalEnvelopeSchema = z.object({
  schema_version: z.literal(4),
  kind: z.literal("fixed_eight_paid_extraction_plan_approval"),
  payload: z.object({
    prompt_version: z.string().min(1).max(100),
    prompt_hash: Sha256Schema,
    processing_version: Sha256Schema,
  }).passthrough(),
  plan_sha256: Sha256Schema,
}).strict();

export type PaidExtractionPlanUnit = z.infer<typeof PaidExtractionPlanUnitSchema>;
export type PaidExtractionPlanPayload = z.infer<typeof PaidExtractionPlanPayloadSchema>;
export type PaidExtractionPlanApproval = z.infer<typeof PaidExtractionPlanApprovalSchema>;
export type PaidExtractionBatchPlanApproval = z.infer<
  typeof PaidExtractionBatchPlanApprovalSchema
>;
export type AnyPaidExtractionPlanApproval =
  | PaidExtractionPlanApproval
  | PaidExtractionBatchPlanApproval;

function paidExtractionBatchPlanSha256(payload: PaidExtractionPlanPayload): string {
  return canonicalSha256({
    schema_version: 5,
    kind: "paid_extraction_batch_plan_approval",
    payload,
  });
}
export interface PaidExtractionAttemptReservation {
  maximumInputTokens: number;
  maximumOutputTokens: number;
  maximumCostUsd: number;
}

export interface PaidExtractionPlanUnitInput {
  unitId: string;
  extractionFingerprint: string;
  sourceFingerprint: string;
  artifactFingerprint: string;
  converterVersion: string;
  requestHashes: string[];
  /**
   * Ordered allow-list for each batch. The first hash must be the initial
   * request hash. Static retry variants may be added by the caller; dynamic
   * unplanned repair payloads remain unauthorized.
   */
  authorizedRequestReservationsByBatch: Array<Array<{
    requestHash: string;
    maximumInputTokens: number;
    maximumOutputTokens: number;
  }>>;
  plannedRequestEstimates: Array<{
    requestHash: string;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
  }>;
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
  domainCommittedCostNanoUsd: number;
  priorDurableLedger: AiLedgerSnapshot;
  units: PaidExtractionPlanUnitInput[];
}

function approvalPayload(input: CreatePaidExtractionPlanApprovalInput): PaidExtractionPlanPayload {
  if (input.units.length < 1 || input.units.length > MAX_PAID_EXTRACTION_BATCH_UNITS) {
    throw new Error(
      `paid extraction batch must contain at least 1 and at most ${MAX_PAID_EXTRACTION_BATCH_UNITS} units`,
    );
  }
  const units = input.units.map((unit) => {
    const authorizedRequestReservationsByBatch = unit.authorizedRequestReservationsByBatch.map(
      (batch) => batch.map((request) => ({
        request_hash: request.requestHash,
        maximum_input_tokens: request.maximumInputTokens,
        maximum_output_tokens: request.maximumOutputTokens,
        maximum_cost_usd: exactExtractionCostUsd(
          input.model,
          request.maximumInputTokens,
          request.maximumOutputTokens,
        ),
        maximum_cost_nano_usd: costUsdToNanoUsdCeil(exactExtractionCostUsd(
          input.model,
          request.maximumInputTokens,
          request.maximumOutputTokens,
        )),
      })),
    );
    const plannedRequestEstimates = unit.plannedRequestEstimates.map((request) => ({
      request_hash: request.requestHash,
      estimated_input_tokens: request.estimatedInputTokens,
      estimated_output_tokens: request.estimatedOutputTokens,
      estimated_cost_usd: exactExtractionCostUsd(
        input.model,
        request.estimatedInputTokens,
        request.estimatedOutputTokens,
      ),
    }));
    return ({
    unit_id: unit.unitId,
    extraction_fingerprint: unit.extractionFingerprint,
    source_fingerprint: unit.sourceFingerprint,
    artifact_fingerprint: unit.artifactFingerprint,
    converter_version: unit.converterVersion,
    request_count: unit.requestHashes.length,
    request_hashes: [...unit.requestHashes],
    authorized_request_hashes_by_batch: authorizedRequestReservationsByBatch.map(
      (batch) => batch.map((request) => request.request_hash),
    ),
    authorized_request_reservations_by_batch: authorizedRequestReservationsByBatch,
    planned_request_estimates: plannedRequestEstimates,
    estimated_input_tokens: unit.estimatedInputTokens,
    estimated_output_tokens: unit.estimatedOutputTokens,
    maximum_input_tokens: unit.maximumInputTokens,
    maximum_output_tokens: unit.maximumOutputTokens,
    estimated_cost_usd: plannedRequestEstimates.reduce(
      (sum, request) => sum + request.estimated_cost_usd,
      0,
    ),
    maximum_cost_usd: authorizedRequestReservationsByBatch.reduce(
      (sum, batch) => sum + (Math.max(...batch.map((request) => request.maximum_cost_usd))
        * PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH),
      0,
    ),
  });
  });
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
  const maximumSingleAttemptCostUsd = Math.max(...units.flatMap(
    (unit) => unit.authorized_request_reservations_by_batch.flatMap(
      (batch) => batch.map((request) => request.maximum_cost_usd),
    ),
  ));
  const maximumSingleAttemptCostNanoUsd = costUsdToNanoUsdCeil(maximumSingleAttemptCostUsd);
  const domainCommittedAtPlanNanoUsd = z.number().int().nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .parse(input.domainCommittedCostNanoUsd);
  const authorizedIncrementalNanoUsd = limitUsdToNanoUsdFloor(input.authorizedCostCeilingUsd);
  const maximumCostUsd = units.reduce((sum, unit) => sum + unit.maximum_cost_usd, 0);
  const estimatedCostUsd = units.reduce((sum, unit) => sum + unit.estimated_cost_usd, 0);
  return PaidExtractionPlanPayloadSchema.parse({
    execution_domain: input.executionDomain,
    prior_durable_ledger: input.priorDurableLedger,
    ordered_unit_ids: input.units.map((unit) => unit.unitId),
    model: input.model,
    prompt_version: EXTRACTION_PROMPT_VERSION,
    prompt_hash: EXTRACTION_PROMPT_HASH,
    processing_version: EXTRACTION_PROCESSING_VERSION,
    scanner_parser_version: input.scannerParserVersion,
    provider_call_contract: {
      input_token_bound: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
      max_output_tokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
      service_tier: "default",
      reasoning_effort: "none",
      tools_enabled: false,
      cache_write_input_price_multiplier: 1.25,
    },
    units,
    cost: {
      approval_policy: "sequential_runtime_fence_v1",
      pricing_schedule: PAID_EXTRACTION_PRICING_SCHEDULE,
      input_usd_per_million: rates.input_usd_per_million,
      output_usd_per_million: rates.output_usd_per_million,
      long_context_input_threshold_tokens: GPT_5_6_LONG_CONTEXT_INPUT_THRESHOLD_TOKENS,
      long_context_input_price_multiplier: GPT_5_6_LONG_CONTEXT_INPUT_PRICE_MULTIPLIER,
      long_context_output_price_multiplier: GPT_5_6_LONG_CONTEXT_OUTPUT_PRICE_MULTIPLIER,
      authorized_ceiling_usd: input.authorizedCostCeilingUsd,
      request_count: totals.requestCount,
      estimated_input_tokens: totals.estimatedInputTokens,
      estimated_output_tokens: totals.estimatedOutputTokens,
      maximum_input_tokens: totals.maximumInputTokens,
      maximum_output_tokens: totals.maximumOutputTokens,
      estimated_cost_usd: estimatedCostUsd,
      maximum_cost_usd: maximumCostUsd,
      maximum_single_attempt_cost_usd: maximumSingleAttemptCostUsd,
      maximum_single_attempt_cost_nano_usd: maximumSingleAttemptCostNanoUsd,
      absolute_domain_limit_nano_usd: domainCommittedAtPlanNanoUsd
        + authorizedIncrementalNanoUsd,
      domain_committed_at_plan_nano_usd: domainCommittedAtPlanNanoUsd,
      authorized_incremental_nano_usd: authorizedIncrementalNanoUsd,
      completion_not_guaranteed: maximumCostUsd > input.authorizedCostCeilingUsd,
    },
  });
}

export function createFixedEightPaidExtractionPlanApproval(
  input: CreatePaidExtractionPlanApprovalInput,
): PaidExtractionPlanApproval {
  const payload = approvalPayload(input);
  return PaidExtractionPlanApprovalSchema.parse({
    schema_version: 4,
    kind: "fixed_eight_paid_extraction_plan_approval",
    payload,
    plan_sha256: canonicalSha256(payload),
  });
}

export function createPaidExtractionBatchPlanApproval(
  input: CreatePaidExtractionPlanApprovalInput,
): PaidExtractionBatchPlanApproval {
  const payload = approvalPayload(input);
  return PaidExtractionBatchPlanApprovalSchema.parse({
    schema_version: 5,
    kind: "paid_extraction_batch_plan_approval",
    payload,
    plan_sha256: paidExtractionBatchPlanSha256(payload),
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

export function validatePaidExtractionBatchPlanApproval(
  value: unknown,
  expectedPlanSha256?: string,
): PaidExtractionBatchPlanApproval {
  const approval = PaidExtractionBatchPlanApprovalSchema.parse(value);
  const actualPlanSha256 = paidExtractionBatchPlanSha256(approval.payload);
  if (actualPlanSha256 !== approval.plan_sha256) {
    throw new Error("paid extraction batch plan SHA-256 does not match its canonical payload");
  }
  if (expectedPlanSha256 !== undefined) {
    const expected = Sha256Schema.parse(expectedPlanSha256);
    if (approval.plan_sha256 !== expected) {
      throw new Error("paid extraction batch plan does not match the explicitly approved SHA-256");
    }
  }
  return approval;
}

export function validatePaidExtractionPlanApproval(
  value: unknown,
  expectedPlanSha256?: string,
): AnyPaidExtractionPlanApproval {
  if (
    typeof value === "object"
    && value !== null
    && "kind" in value
    && value.kind === "fixed_eight_paid_extraction_plan_approval"
  ) {
    return validateFixedEightPaidExtractionPlanApproval(value, expectedPlanSha256);
  }
  return validatePaidExtractionBatchPlanApproval(value, expectedPlanSha256);
}

/**
 * Validate a previously executed schema-v4 plan without requiring its prompt
 * identity to equal the prompt compiled into the current checkout.
 *
 * The original canonical payload hash is checked first. Then only the opaque
 * historical prompt/version triplet is replaced for a second parse through
 * the full schema-v4 validator. That keeps the embedded pricing schedule,
 * provider-call contract, fixed-eight order, fingerprints, reservations, and
 * all token/cost arithmetic subject to the same strict validation as a current
 * plan. The returned value restores the exact historical identities and hash.
 */
export function validateHistoricalFixedEightPaidExtractionPlanApproval(
  value: unknown,
  expectedPlanSha256?: string,
): PaidExtractionPlanApproval {
  const historical = HistoricalPaidExtractionPlanApprovalEnvelopeSchema.parse(value);
  const actualPlanSha256 = canonicalSha256(historical.payload);
  if (actualPlanSha256 !== historical.plan_sha256) {
    throw new Error("historical paid extraction plan SHA-256 does not match its canonical payload");
  }
  if (expectedPlanSha256 !== undefined) {
    const expected = Sha256Schema.parse(expectedPlanSha256);
    if (historical.plan_sha256 !== expected) {
      throw new Error("historical paid extraction plan does not match the explicitly approved SHA-256");
    }
  }

  const currentContractPayload = {
    ...historical.payload,
    prompt_version: EXTRACTION_PROMPT_VERSION,
    prompt_hash: EXTRACTION_PROMPT_HASH,
    processing_version: EXTRACTION_PROCESSING_VERSION,
  };
  const currentContractValidated = PaidExtractionPlanApprovalSchema.parse({
    schema_version: historical.schema_version,
    kind: historical.kind,
    payload: currentContractPayload,
    plan_sha256: canonicalSha256(currentContractPayload),
  });

  return {
    ...currentContractValidated,
    payload: {
      ...currentContractValidated.payload,
      prompt_version: historical.payload.prompt_version,
      prompt_hash: historical.payload.prompt_hash,
      processing_version: historical.payload.processing_version,
    },
    plan_sha256: historical.plan_sha256,
  };
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

export function assertPaidExtractionBatchPlanApprovalMatches(
  value: unknown,
  currentInput: CreatePaidExtractionPlanApprovalInput,
  expectedPlanSha256?: string,
): PaidExtractionBatchPlanApproval {
  const approval = validatePaidExtractionBatchPlanApproval(value, expectedPlanSha256);
  const current = createPaidExtractionBatchPlanApproval(currentInput);
  if (approval.plan_sha256 !== current.plan_sha256) {
    throw new Error(
      "paid extraction batch plan no longer matches the current ordered sources, model, requests, or cost",
    );
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

export function paidExtractionBatchPlanPath(
  stateDir: string,
  planSha256: string,
): string {
  return fixedEightPaidExtractionPlanPath(stateDir, planSha256);
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

export async function writePaidExtractionBatchPlanApproval(
  stateDir: string,
  value: unknown,
): Promise<string> {
  const approval = validatePaidExtractionBatchPlanApproval(value);
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
    const existing = await readPaidExtractionPlanApprovalBytes(
      stateDir,
      approval.plan_sha256,
    );
    const expectedBytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`, "utf8");
    if (!existing.bytes.equals(expectedBytes)) {
      throw new Error("existing paid extraction batch plan bytes do not match the approved artifact");
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

async function readPaidExtractionPlanApprovalBytes(
  stateDir: string,
  expectedPlanSha256: string,
): Promise<{ approval: AnyPaidExtractionPlanApproval; bytes: Buffer; path: string }> {
  const normalized = normalizedPlanSha256(expectedPlanSha256);
  const artifactPath = paidExtractionBatchPlanPath(stateDir, normalized);
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
    approval: validatePaidExtractionPlanApproval(raw, normalized),
    bytes,
    path: verifiedPath,
  };
}

export async function readPaidExtractionPlanApproval(
  stateDir: string,
  expectedPlanSha256: string,
): Promise<AnyPaidExtractionPlanApproval> {
  return (await readPaidExtractionPlanApprovalBytes(stateDir, expectedPlanSha256)).approval;
}

export function assertPaidExtractionPlannedRequestHashes(
  approvalValue: AnyPaidExtractionPlanApproval,
  unitId: string,
  requestHashes: readonly string[],
): PaidExtractionPlanUnit {
  const approval = validatePaidExtractionPlanApproval(
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
  approvalValue: AnyPaidExtractionPlanApproval,
  unitId: string,
  batchIndex: number,
  requestHash: string,
): void {
  const approval = validatePaidExtractionPlanApproval(
    approvalValue,
    approvalValue.plan_sha256,
  );
  const unit = approval.payload.units.find((candidate) => candidate.unit_id === unitId);
  const authorized = unit?.authorized_request_hashes_by_batch[batchIndex];
  if (!authorized?.includes(Sha256Schema.parse(requestHash))) {
    throw new Error("paid_plan_attempt_request_hash_not_authorized");
  }
}

export function assertPaidExtractionAttemptReservationAuthorized(
  approvalValue: AnyPaidExtractionPlanApproval,
  unitId: string,
  batchIndex: number,
  requestHash: string,
  reservation: PaidExtractionAttemptReservation,
): void {
  const approval = validatePaidExtractionPlanApproval(
    approvalValue,
    approvalValue.plan_sha256,
  );
  const normalizedRequestHash = Sha256Schema.parse(requestHash);
  const unit = approval.payload.units.find((candidate) => candidate.unit_id === unitId);
  const authorized = unit?.authorized_request_reservations_by_batch[batchIndex]?.find(
    (candidate) => candidate.request_hash === normalizedRequestHash,
  );
  if (!authorized) {
    throw new Error("paid_plan_attempt_request_hash_not_authorized");
  }
  const runtimeMaximumInputTokens = SafeCountSchema.parse(reservation.maximumInputTokens);
  const runtimeMaximumOutputTokens = SafeCountSchema.parse(reservation.maximumOutputTokens);
  const runtimeMaximumCostUsd = CostSchema.parse(reservation.maximumCostUsd);
  const tokenDerivedRuntimeCost = exactExtractionCostUsd(
    approval.payload.model,
    runtimeMaximumInputTokens,
    runtimeMaximumOutputTokens,
  );
  if (runtimeMaximumCostUsd !== tokenDerivedRuntimeCost) {
    throw new Error("paid_plan_attempt_reservation_cost_not_token_derived");
  }
  if (
    runtimeMaximumInputTokens !== authorized.maximum_input_tokens
    || runtimeMaximumOutputTokens !== authorized.maximum_output_tokens
    || runtimeMaximumCostUsd !== authorized.maximum_cost_usd
  ) {
    throw new Error("paid_plan_attempt_reservation_does_not_exactly_match_authorized_maximum");
  }
}
