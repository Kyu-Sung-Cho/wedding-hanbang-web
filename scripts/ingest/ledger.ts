import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { sha256Text } from "./io.js";

export const AiLedgerEntrySchema = z.object({
  schema_version: z.literal(2),
  ledger_id: z.string().regex(/^[a-f0-9]{64}$/),
  run_id: z.string().uuid(),
  unit_id: z.string().regex(/^[a-f0-9]{64}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  prompt_version: z.string().max(100),
  model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
  batch_index: z.number().int().nonnegative(),
  attempt: z.number().int().positive().max(4),
  request_id: z.string().max(200).nullable(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative(),
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
  attempted_at: z.string().datetime(),
});

export type AiLedgerEntry = z.infer<typeof AiLedgerEntrySchema>;

const MODEL_RATES_PER_MILLION: Record<AiLedgerEntry["model"], { input: number; output: number }> = {
  "gpt-5.6-terra": { input: 2.5, output: 15 },
  "gpt-5.6-luna": { input: 1, output: 6 },
};

export function estimateExtractionCostUsd(
  model: AiLedgerEntry["model"],
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = MODEL_RATES_PER_MILLION[model];
  return ((inputTokens * rate.input) + (outputTokens * rate.output)) / 1_000_000;
}

export function createLedgerId(runId: string, fingerprint: string, batchIndex: number, attempt: number): string {
  return sha256Text(`${runId}\0${fingerprint}\0${batchIndex}\0${attempt}`);
}

export async function appendAiLedgerEntry(stateDir: string, entry: AiLedgerEntry): Promise<void> {
  const parsed = AiLedgerEntrySchema.parse(entry);
  const ledgerDirectory = path.join(path.resolve(stateDir), ".cache");
  await mkdir(ledgerDirectory, { recursive: true });
  await appendFile(path.join(ledgerDirectory, "ai-ledger.ndjson"), `${JSON.stringify(parsed)}\n`, "utf8");
}

export async function readAiLedger(stateDir: string): Promise<AiLedgerEntry[]> {
  let content: string;
  try {
    content = await readFile(path.join(path.resolve(stateDir), ".cache", "ai-ledger.ndjson"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const entries = new Map<string, AiLedgerEntry>();
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
    entries.set(parsed.data.ledger_id, parsed.data);
  }
  return [...entries.values()];
}
