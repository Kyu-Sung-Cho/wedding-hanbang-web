import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  prepareDeterministicStateArtifactWritePath,
  verifyDeterministicStateArtifactPath,
} from "./artifact-integrity.js";
import { sha256Text, syncDirectoryMetadata } from "./io.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const AiLedgerEntryFields = {
  ledger_id: z.string().regex(/^[a-f0-9]{64}$/),
  run_id: z.string().uuid(),
  unit_id: z.string().regex(/^[a-f0-9]{64}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  prompt_version: z.string().max(100),
  model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
  batch_index: z.number().int().nonnegative(),
  attempt: z.number().int().positive().max(4),
  request_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  request_id: z.string().max(200).nullable(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative(),
  reserved_cost_usd: z.number().nonnegative().optional(),
  charge_basis: z.enum(["usage_reported", "reservation_upper_bound"]).optional(),
  latency_ms: z.number().int().nonnegative(),
  success: z.boolean(),
  error_category: z.enum([
    "rate_limit",
    "provider_5xx",
    "timeout",
    "network",
    "invalid_response",
    "unknown",
  ]).nullable(),
  // Ownership failures intentionally retain only locator metadata. Never put
  // the source_quote payload or source cell value in the audit ledger.
  rejected_locator: z.string().min(1).max(500).regex(/^[^\r\n]+$/u).nullable().optional(),
  allowed_locator_count: z.number().int().nonnegative().nullable().optional(),
  allowed_locator_set_sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable().optional(),
  locator_violation: z.enum(["not_in_request", "not_exact_single_cell"]).nullable().optional(),
  rejected_occurrence_index: z.number().int().nonnegative().nullable().optional(),
  attempted_at: z.string().datetime(),
} as const;

/**
 * Version 2 is retained strictly for reading the pre-approval historical
 * ledger. New appends must use version 3 so a test audit row can never be
 * mistaken for a paid production call and every paid row names its approval.
 */
export const LegacyAiLedgerEntrySchema = z.object({
  schema_version: z.literal(2),
  ...AiLedgerEntryFields,
}).strict();

export const NewAiLedgerEntrySchema = z.object({
  schema_version: z.literal(3),
  ...AiLedgerEntryFields,
  request_hash: Sha256Schema,
  provider_mode: z.enum(["production_paid", "test_only"]),
  paid_plan_sha256: Sha256Schema.nullable(),
  cached_input_tokens: z.number().int().nonnegative().nullable(),
  cache_write_input_tokens: z.number().int().nonnegative().nullable(),
}).strict().superRefine((entry, context) => {
  if (entry.provider_mode === "production_paid" && entry.paid_plan_sha256 === null) {
    context.addIssue({
      code: "custom",
      path: ["paid_plan_sha256"],
      message: "production paid ledger rows require paid_plan_sha256",
    });
  }
  if (entry.provider_mode === "test_only" && entry.paid_plan_sha256 !== null) {
    context.addIssue({
      code: "custom",
      path: ["paid_plan_sha256"],
      message: "test-only ledger rows cannot claim a paid plan",
    });
  }
  if ((entry.cached_input_tokens === null) !== (entry.cache_write_input_tokens === null)) {
    context.addIssue({
      code: "custom",
      path: ["cached_input_tokens"],
      message: "cache token details must either both be reported or both be null",
    });
  }
  if (
    entry.cached_input_tokens !== null
    && entry.cache_write_input_tokens !== null
    && entry.cached_input_tokens + entry.cache_write_input_tokens > entry.input_tokens
  ) {
    context.addIssue({
      code: "custom",
      path: ["cached_input_tokens"],
      message: "cache read and write tokens cannot exceed total input tokens",
    });
  }
});

export const AiLedgerEntrySchema = z.union([
  LegacyAiLedgerEntrySchema,
  NewAiLedgerEntrySchema,
]);

export type AiLedgerEntry = z.infer<typeof AiLedgerEntrySchema>;
export type NewAiLedgerEntry = z.infer<typeof NewAiLedgerEntrySchema>;

export const AiLedgerSnapshotSchema = z.object({
  relative_path: z.literal(".cache/ai-ledger.ndjson"),
  content_sha256: Sha256Schema,
  byte_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  row_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  cumulative_cost_usd: z.number().finite().nonnegative(),
}).strict();

export type AiLedgerSnapshot = z.infer<typeof AiLedgerSnapshotSchema>;
export interface AiLedgerState {
  entries: AiLedgerEntry[];
  bytes: Buffer;
  snapshot: AiLedgerSnapshot;
}

const MODEL_RATES_PER_MILLION: Record<AiLedgerEntry["model"], { input: number; output: number }> = {
  "gpt-5.6-terra": { input: 2.5, output: 15 },
  "gpt-5.6-luna": { input: 1, output: 6 },
};

export const GPT_5_6_LONG_CONTEXT_INPUT_THRESHOLD_TOKENS = 272_000;
export const GPT_5_6_LONG_CONTEXT_INPUT_PRICE_MULTIPLIER = 2;
export const GPT_5_6_LONG_CONTEXT_OUTPUT_PRICE_MULTIPLIER = 1.5;

export interface ExtractionInputTokenDetails {
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
}

function isNonnegativeIntegerTokenCount(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function legacyExtractionCostUsd(
  model: AiLedgerEntry["model"],
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = MODEL_RATES_PER_MILLION[model];
  return ((inputTokens * rate.input) + (outputTokens * rate.output)) / 1_000_000;
}

export function estimateExtractionCostUsd(
  model: AiLedgerEntry["model"],
  inputTokens: number,
  outputTokens: number,
  inputDetails?: ExtractionInputTokenDetails,
): number {
  if (!isNonnegativeIntegerTokenCount(inputTokens) || !isNonnegativeIntegerTokenCount(outputTokens)) {
    throw new Error("extraction token counts must be non-negative integers");
  }
  const rate = MODEL_RATES_PER_MILLION[model];
  const hasConsistentDetails = inputDetails !== undefined
    && isNonnegativeIntegerTokenCount(inputDetails.cachedInputTokens)
    && isNonnegativeIntegerTokenCount(inputDetails.cacheWriteInputTokens)
    && inputDetails.cachedInputTokens + inputDetails.cacheWriteInputTokens <= inputTokens;
  const inputRateEquivalentTokens = hasConsistentDetails
    ? (
      inputTokens
      - inputDetails.cachedInputTokens
      - inputDetails.cacheWriteInputTokens
      + (inputDetails.cacheWriteInputTokens * 1.25)
      + (inputDetails.cachedInputTokens * 0.1)
    )
    // Missing or contradictory provider details must not make the cost fence
    // optimistic. GPT-5.6 cache writes are the most expensive input class.
    : inputTokens * 1.25;
  const usesLongContextPricing = inputTokens > GPT_5_6_LONG_CONTEXT_INPUT_THRESHOLD_TOKENS;
  const inputMultiplier = usesLongContextPricing
    ? GPT_5_6_LONG_CONTEXT_INPUT_PRICE_MULTIPLIER
    : 1;
  const outputMultiplier = usesLongContextPricing
    ? GPT_5_6_LONG_CONTEXT_OUTPUT_PRICE_MULTIPLIER
    : 1;
  return (
    (inputRateEquivalentTokens * rate.input * inputMultiplier)
    + (outputTokens * rate.output * outputMultiplier)
  ) / 1_000_000;
}

function effectiveLedgerCostUsd(entry: AiLedgerEntry): number {
  if (entry.schema_version === 2) {
    // Historical v2 rows recorded all input at 1x and cannot be rewritten.
    // Carry them forward at the larger 1.25x cache-write bound so a new plan
    // cannot inherit an understated budget while the raw-byte hash stays bound.
    return Math.max(
      entry.estimated_cost_usd,
      estimateExtractionCostUsd(entry.model, entry.input_tokens, entry.output_tokens),
    );
  }
  return entry.estimated_cost_usd;
}

export function createLedgerId(runId: string, fingerprint: string, batchIndex: number, attempt: number): string {
  return sha256Text(`${runId}\0${fingerprint}\0${batchIndex}\0${attempt}`);
}

export function validateAiLedgerEntryIntegrity(entry: AiLedgerEntry): AiLedgerEntry {
  const expectedLedgerId = createLedgerId(
    entry.run_id,
    entry.fingerprint,
    entry.batch_index,
    entry.attempt,
  );
  if (entry.ledger_id !== expectedLedgerId) {
    throw new Error("AI ledger_id가 행의 실행 신원에서 재계산한 값과 다릅니다.");
  }
  if ((entry.success && entry.error_category !== null) || (!entry.success && entry.error_category === null)) {
    throw new Error("AI ledger success와 error_category가 서로 모순됩니다.");
  }
  const usageReportedCost = entry.schema_version === 2
    ? legacyExtractionCostUsd(entry.model, entry.input_tokens, entry.output_tokens)
    : estimateExtractionCostUsd(
      entry.model,
      entry.input_tokens,
      entry.output_tokens,
      entry.cached_input_tokens !== null && entry.cache_write_input_tokens !== null
        ? {
          cachedInputTokens: entry.cached_input_tokens,
          cacheWriteInputTokens: entry.cache_write_input_tokens,
        }
        : undefined,
    );
  if (entry.charge_basis === "reservation_upper_bound") {
    if (
      entry.reserved_cost_usd === undefined
      || entry.estimated_cost_usd !== entry.reserved_cost_usd
      || usageReportedCost !== 0
    ) {
      throw new Error("AI ledger reservation_upper_bound 비용 근거가 일치하지 않습니다.");
    }
  } else if (entry.estimated_cost_usd !== usageReportedCost) {
    throw new Error("AI ledger usage 기반 비용이 토큰 수에서 재계산한 값과 다릅니다.");
  }
  return entry;
}

export async function appendAiLedgerEntry(stateDir: string, entry: NewAiLedgerEntry): Promise<void> {
  const parsed = validateAiLedgerEntryIntegrity(NewAiLedgerEntrySchema.parse(entry));
  const ledgerDirectory = path.join(path.resolve(stateDir), ".cache");
  const ledgerPath = path.join(ledgerDirectory, "ai-ledger.ndjson");
  await prepareDeterministicStateArtifactWritePath({
    stateDir,
    artifactPath: ledgerPath,
    expectedRelativePath: path.join(".cache", "ai-ledger.ndjson"),
  });
  try {
    await verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath: ledgerPath,
      expectedRelativePath: path.join(".cache", "ai-ledger.ndjson"),
    });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const handle = await open(ledgerPath, "a");
  try {
    await handle.writeFile(`${JSON.stringify(parsed)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectoryMetadata(ledgerDirectory);
}

function parseAiLedgerBytes(bytes: Buffer): AiLedgerEntry[] {
  const content = bytes.toString("utf8");
  const entries: AiLedgerEntry[] = [];
  const ledgerIds = new Set<string>();
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`AI ledger ${index + 1}행이 JSON이 아닙니다.`);
    }
    const parsed = AiLedgerEntrySchema.safeParse(value);
    if (!parsed.success) throw new Error(`AI ledger ${index + 1}행 검증 실패: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    let verified: AiLedgerEntry;
    try {
      verified = validateAiLedgerEntryIntegrity(parsed.data);
    } catch (error) {
      throw new Error(
        `AI ledger ${index + 1}행 무결성 검증 실패: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
    if (ledgerIds.has(verified.ledger_id)) {
      throw new Error(`AI ledger ${index + 1}행에 중복 ledger_id가 있습니다.`);
    }
    ledgerIds.add(verified.ledger_id);
    entries.push(verified);
  }
  return entries;
}

async function readAiLedgerBytes(stateDir: string): Promise<Buffer> {
  const ledgerPath = path.join(path.resolve(stateDir), ".cache", "ai-ledger.ndjson");
  try {
    const verifiedPath = await verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath: ledgerPath,
      expectedRelativePath: path.join(".cache", "ai-ledger.ndjson"),
    });
    return await readFile(verifiedPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return Buffer.alloc(0);
    throw error;
  }
}

export async function readAiLedgerState(stateDir: string): Promise<{
  entries: AiLedgerEntry[];
  bytes: Buffer;
  snapshot: AiLedgerSnapshot;
}> {
  const bytes = await readAiLedgerBytes(stateDir);
  const entries = parseAiLedgerBytes(bytes);
  const snapshot = AiLedgerSnapshotSchema.parse({
    relative_path: ".cache/ai-ledger.ndjson",
    content_sha256: createHash("sha256").update(bytes).digest("hex"),
    byte_count: bytes.byteLength,
    row_count: entries.length,
    cumulative_cost_usd: entries.reduce((sum, entry) => sum + effectiveLedgerCostUsd(entry), 0),
  });
  return { entries, bytes, snapshot };
}

export function assertAiLedgerSnapshotIsExactPrefix(
  expectedValue: AiLedgerSnapshot,
  current: AiLedgerState,
): void {
  const expected = AiLedgerSnapshotSchema.parse(expectedValue);
  if (current.bytes.byteLength < expected.byte_count) {
    throw new Error("paid_plan_prior_ledger_was_truncated");
  }
  const prefix = current.bytes.subarray(0, expected.byte_count);
  const prefixSha256 = createHash("sha256").update(prefix).digest("hex");
  const prefixRows = prefix.toString("utf8").split(/\r?\n/u)
    .filter((line) => line.trim().length > 0).length;
  const prefixCost = current.entries.slice(0, prefixRows).reduce(
    (sum, entry) => sum + effectiveLedgerCostUsd(entry),
    0,
  );
  if (
    prefixSha256 !== expected.content_sha256
    || prefixRows !== expected.row_count
    || prefixCost !== expected.cumulative_cost_usd
  ) {
    throw new Error("paid_plan_prior_ledger_snapshot_mismatch");
  }
}

export async function readAiLedger(stateDir: string): Promise<AiLedgerEntry[]> {
  return (await readAiLedgerState(stateDir)).entries;
}
