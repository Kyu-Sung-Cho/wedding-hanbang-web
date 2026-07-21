import { randomUUID } from "node:crypto";
import { link, open, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  canonicalJsonSha256ExcludingField,
  prepareDeterministicStateArtifactWritePath,
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "./artifact-integrity.js";
import {
  readJsonFile,
  sha256Text,
  syncDirectoryMetadata,
  unlinkFileDurably,
} from "./io.js";
import { readAiLedgerState } from "./ledger.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const PaidCallIntentSchema = z.object({
  schema_version: z.literal(2),
  kind: z.literal("openai_extraction_paid_call_intent"),
  provider_mode: z.literal("production_paid"),
  content_sha256: Sha256Schema,
  intent_id: Sha256Schema,
  run_id: z.string().uuid(),
  unit_id: Sha256Schema,
  extraction_fingerprint: Sha256Schema,
  batch_index: z.number().int().nonnegative(),
  attempt: z.number().int().positive().max(4),
  request_hash: Sha256Schema,
  paid_plan_sha256: Sha256Schema,
  model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
  reserved_cost_usd: z.number().finite().nonnegative(),
  created_at: z.string().datetime(),
}).strict();

export type PaidCallIntent = z.infer<typeof PaidCallIntentSchema>;

export interface BeginPaidCallIntentInput {
  runId: string;
  unitId: string;
  extractionFingerprint: string;
  batchIndex: number;
  attempt: number;
  requestHash: string;
  paidPlanSha256: string;
  model: PaidCallIntent["model"];
  reservedCostUsd: number;
  createdAt?: string;
}

function intentId(input: Pick<
  BeginPaidCallIntentInput,
  "unitId" | "extractionFingerprint" | "batchIndex" | "attempt" | "requestHash" | "paidPlanSha256"
>): string {
  return sha256Text([
    input.unitId,
    input.extractionFingerprint,
    String(input.batchIndex),
    String(input.attempt),
    input.requestHash,
    input.paidPlanSha256,
  ].join("\0"));
}

function intentRelativePath(id: string): string {
  return path.join(".cache", "paid-call-intents", `${id}.json`);
}

function intentPath(stateDir: string, id: string): string {
  return path.join(path.resolve(stateDir), intentRelativePath(id));
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    ? error.code
    : undefined;
}

/**
 * Publishes a fully-written JSON file without ever replacing the destination.
 *
 * `rename` is intentionally not used here because it replaces an existing
 * destination on supported platforms. A same-directory hard link is atomic
 * and fails with EEXIST when another caller has already claimed the
 * deterministic intent path. Node exposes the same no-replace behavior on
 * Windows; directory fsync is still attempted through the platform-aware
 * durability helper.
 */
async function publishJsonFileExclusively(
  artifactPath: string,
  value: unknown,
): Promise<"published" | "already_exists"> {
  const directory = path.dirname(artifactPath);
  const temporaryPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    try {
      await handle.close();
      await unlinkFileDurably(temporaryPath);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "paid call intent temporary file write and cleanup failed",
      );
    }
    throw error;
  }
  await handle.close();

  try {
    await link(temporaryPath, artifactPath);
  } catch (error) {
    try {
      await unlinkFileDurably(temporaryPath);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "paid call intent exclusive publish and cleanup failed",
      );
    }
    if (errorCode(error) === "EEXIST") return "already_exists";
    throw error;
  }

  try {
    // Persist the new deterministic directory entry before removing the
    // temporary link. If this fails, the intent remains present and future
    // callers fail closed instead of issuing an unjournaled paid request.
    await syncDirectoryMetadata(directory);
  } catch (error) {
    try {
      await unlinkFileDurably(temporaryPath);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "paid call intent directory sync and cleanup failed",
      );
    }
    throw error;
  }
  await unlinkFileDurably(temporaryPath);
  return "published";
}

async function readVerifiedIntent(
  stateDir: string,
  artifactPath: string,
  expectedIntentId: string,
): Promise<PaidCallIntent> {
  const verifiedPath = await verifyDeterministicStateArtifactPath({
    stateDir,
    artifactPath,
    expectedRelativePath: intentRelativePath(expectedIntentId),
  });
  const raw = await readJsonFile(verifiedPath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("paid_call_intent_schema_invalid");
  }
  verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
  const intent = PaidCallIntentSchema.parse(raw);
  if (intent.intent_id !== expectedIntentId) {
    throw new Error("paid_call_intent_identity_mismatch");
  }
  return intent;
}

export async function listPendingPaidCallIntents(stateDir: string): Promise<PaidCallIntent[]> {
  const directory = path.join(path.resolve(stateDir), ".cache", "paid-call-intents");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const intents: PaidCallIntent[] = [];
  for (const name of names.sort((left, right) => left.localeCompare(right, "en"))) {
    const match = /^([a-f0-9]{64})\.json$/u.exec(name);
    if (!match) throw new Error(`paid_call_intent_directory_contains_unknown_entry:${name}`);
    intents.push(await readVerifiedIntent(stateDir, path.join(directory, name), match[1]));
  }
  return intents;
}

export async function assertNoOrphanedPaidCallIntents(stateDir: string): Promise<void> {
  const pending = await listPendingPaidCallIntents(stateDir);
  if (pending.length === 0) return;
  throw new Error(
    `orphaned_paid_call_intent_requires_manual_reconciliation:${pending.map((item) => item.intent_id).join(",")}`,
  );
}

export async function beginPaidCallIntent(
  stateDir: string,
  input: BeginPaidCallIntentInput,
): Promise<PaidCallIntent> {
  const id = intentId(input);
  const artifactPath = intentPath(stateDir, id);
  try {
    await readVerifiedIntent(stateDir, artifactPath, id);
    throw new Error(`paid_call_intent_already_pending:${id}`);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const candidate = {
    schema_version: 2 as const,
    kind: "openai_extraction_paid_call_intent" as const,
    provider_mode: "production_paid" as const,
    content_sha256: "0".repeat(64),
    intent_id: id,
    run_id: input.runId,
    unit_id: input.unitId,
    extraction_fingerprint: input.extractionFingerprint,
    batch_index: input.batchIndex,
    attempt: input.attempt,
    request_hash: input.requestHash,
    paid_plan_sha256: input.paidPlanSha256,
    model: input.model,
    reserved_cost_usd: input.reservedCostUsd,
    created_at: input.createdAt ?? new Date().toISOString(),
  };
  candidate.content_sha256 = canonicalJsonSha256ExcludingField(candidate, "content_sha256");
  const intent = PaidCallIntentSchema.parse(candidate);
  await prepareDeterministicStateArtifactWritePath({
    stateDir,
    artifactPath,
    expectedRelativePath: intentRelativePath(id),
  });
  const publication = await publishJsonFileExclusively(artifactPath, intent);
  if (publication === "already_exists") {
    // Re-read through all deterministic-path, reparse-point, schema, identity,
    // and content-hash checks. A valid incumbent is an ordinary concurrency
    // loser; anything else is an integrity failure and remains fail-closed.
    await readVerifiedIntent(stateDir, artifactPath, id);
    throw new Error(`paid_call_intent_already_pending:${id}`);
  }
  const persisted = await readVerifiedIntent(stateDir, artifactPath, id);
  if (persisted.content_sha256 !== intent.content_sha256) {
    throw new Error("paid_call_intent_changed_during_publication");
  }
  return persisted;
}

export async function settlePaidCallIntent(
  stateDir: string,
  intent: PaidCallIntent,
): Promise<void> {
  const artifactPath = intentPath(stateDir, intent.intent_id);
  const persisted = await readVerifiedIntent(stateDir, artifactPath, intent.intent_id);
  if (persisted.content_sha256 !== intent.content_sha256) {
    throw new Error("paid_call_intent_changed_before_settlement");
  }
  await unlinkFileDurably(artifactPath);
}

export async function reconcileFailedPaidCallIntent(
  stateDir: string,
  intentValue: PaidCallIntent,
): Promise<void> {
  const intent = PaidCallIntentSchema.parse(intentValue);
  const persisted = await readVerifiedIntent(
    stateDir,
    intentPath(stateDir, intent.intent_id),
    intent.intent_id,
  );
  if (persisted.content_sha256 !== intent.content_sha256) {
    throw new Error("paid_call_intent_changed_before_failed_reconciliation");
  }
  const ledgerState = await readAiLedgerState(stateDir);
  const matchingRows = ledgerState.entries.filter((entry) =>
    entry.schema_version === 3
    && entry.provider_mode === "production_paid"
    && entry.paid_plan_sha256 === persisted.paid_plan_sha256
    && entry.run_id === persisted.run_id
    && entry.unit_id === persisted.unit_id
    && entry.fingerprint === persisted.extraction_fingerprint
    && entry.batch_index === persisted.batch_index
    && entry.attempt === persisted.attempt
    && entry.request_hash === persisted.request_hash
    && entry.model === persisted.model
    && entry.reserved_cost_usd === persisted.reserved_cost_usd
  );
  if (matchingRows.length !== 1 || matchingRows[0]?.success !== false) {
    throw new Error(
      `paid_call_intent_failed_reconciliation_requires_one_exact_failed_ledger_row:${intent.intent_id}`,
    );
  }
  await settlePaidCallIntent(stateDir, persisted);
}

/** Keep all attempt intents pending until the successful checkpoint is durable. */
export async function persistCheckpointThenSettlePaidCallIntents(
  stateDir: string,
  intents: readonly PaidCallIntent[],
  persistCheckpoint: () => Promise<void>,
): Promise<void> {
  const uniqueIds = new Set(intents.map((intent) => intent.intent_id));
  if (uniqueIds.size !== intents.length) {
    throw new Error("paid_call_intent_set_contains_duplicate_ids");
  }
  for (const intent of intents) {
    const persisted = await readVerifiedIntent(
      stateDir,
      intentPath(stateDir, intent.intent_id),
      intent.intent_id,
    );
    if (persisted.content_sha256 !== intent.content_sha256) {
      throw new Error("paid_call_intent_changed_before_checkpoint");
    }
  }
  await persistCheckpoint();
  for (const intent of intents) {
    await settlePaidCallIntent(stateDir, intent);
  }
}
