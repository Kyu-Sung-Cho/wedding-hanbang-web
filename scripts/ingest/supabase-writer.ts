import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  validateStorageUploadClaim,
  type BeginStorageUploadAttemptResult,
  type StorageJournalObject,
  type StorageUploadClaim,
} from "./batch-safety-journal.js";
import { assertDisclosureStagingProjectRef } from "./destination.js";
import { canonicalSha256 } from "./gate-integrity.js";
import { sha256Text } from "./io.js";
import {
  buildDisclosureSemanticContentFingerprint,
  buildDisclosureSemanticSourceRecordKey,
  buildOfficialPriceContentFingerprint,
  assertStagingEnvironmentDestination,
  buildStagingBatches,
  stagingLoadPlanSha256,
  stagingDisclosureSemantics,
  StagingRollbackIncompleteError,
  StagingStorageIntentsUnsettledError,
} from "./load.js";
import { buildPartnerVendorRecords } from "./partner-dedupe.js";
import { normalizeVendorName } from "./scan.js";
import {
  DisclosureSemanticStagingSchema,
  type DisclosureSemanticStaging,
} from "./schemas.js";
import type {
  StagingAgencyPackage,
  StagingAbortContext,
  StagingAbortResult,
  StagingBatchReceiptContext,
  StagingBatchWriteContext,
  StagingDedupeFinalizeContext,
  StagingInvalidationContext,
  StagingInvalidationResult,
  StagingEnvironment,
  StagingDedupeCandidate,
  StagingLoadPlan,
  StagingStorageIntent,
  StagingStorageRollbackCompletionContext,
  StagingStorageRollbackCompletionResult,
  StagingStorageOutcome,
  StagingOfficialPrice,
  StagingWriter,
  StagingWriterResult,
  PreviewStorageObject,
} from "./load.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function idFrom(value: unknown, context: string): string {
  if (!isRecord(value) || typeof value.id !== "string") throw new Error(`${context}: 반환 ID가 없습니다.`);
  return value.id;
}

export class StagingDatabaseError extends Error {
  readonly code: string;

  constructor(context: string, code: string, cause?: unknown) {
    super(`${context} failed (DB code: ${code})`, { cause });
    this.name = "StagingDatabaseError";
    this.code = code;
  }
}

function databaseError(context: string, error: unknown): never {
  const code = isRecord(error) && typeof error.code === "string" ? error.code.slice(0, 40) : "unknown";
  throw new StagingDatabaseError(context, code, error);
}

function databaseErrorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "unknown";
}

export interface SqlStateRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export async function withSqlStateRetry<T extends { data: unknown; error: unknown }>(
  context: string,
  operation: () => Promise<T>,
  options: SqlStateRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 50;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error("SQLSTATE retry maxAttempts must be between 1 and 5");
  }
  if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 5_000) {
    throw new Error("SQLSTATE retry baseDelayMs must be between 0 and 5000");
  }
  const sleep = options.sleep ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: T;
    try {
      response = await operation();
    } catch (error) {
      const code = error instanceof StagingDatabaseError
        ? error.code
        : databaseErrorCode(error);
      if (code !== "55P03" || attempt === maxAttempts) throw error;
      await sleep(baseDelayMs * (2 ** (attempt - 1)));
      continue;
    }
    if (!response.error) return response;
    const code = databaseErrorCode(response.error);
    if (code !== "55P03" || attempt === maxAttempts) databaseError(context, response.error);
    await sleep(baseDelayMs * (2 ** (attempt - 1)));
  }
  throw new Error("unreachable SQLSTATE retry state");
}

function contentType(extension: string): string {
  if (extension === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "hwp") return "application/x-hwp";
  return "application/octet-stream";
}

function storageDuplicate(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return error.statusCode === "409"
    || error.status === 409
    || (typeof error.message === "string" && /duplicate|already exists/i.test(error.message));
}

function deterministicLedgerUuid(ledgerId: string): string {
  const hex = ledgerId.slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

async function logAiLedger(client: SupabaseClient, plan: StagingLoadPlan): Promise<string[]> {
  const logged: string[] = [];
  for (const entry of plan.ai_ledger) {
    const { error } = await client.from("ai_interactions_log").upsert({
      id: deterministicLedgerUuid(entry.ledger_id),
      session_id: "disclosure_ingest",
      interaction_type: "disclosure_extraction",
      specialist_type: null,
      user_input: null,
      ai_output: null,
      tool_name: "disclosure_extraction",
      tool_input: null,
      tool_output: null,
      latency_ms: entry.latency_ms,
      success: entry.success,
      error_message: entry.error_category,
      model: entry.model,
      tokens_input: entry.input_tokens,
      tokens_output: entry.output_tokens,
      cost_usd: entry.estimated_cost_usd,
      metadata: {
        ingest_call_id: entry.ledger_id,
        ingest_ledger_id: entry.ledger_id,
        ingest_run_id: entry.run_id,
        unit_id: entry.unit_id,
        fingerprint: entry.fingerprint,
        prompt_version: entry.prompt_version,
        request_id: entry.request_id,
        batch_index: entry.batch_index,
        attempt: entry.attempt,
        source: "local_disclosure_ingest",
      },
      created_at: entry.attempted_at,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) databaseError("AI 상호작용 ledger 적재", error);
    logged.push(entry.ledger_id);
  }
  return logged;
}

function sha256Buffer(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function customStorageMetadata(
  metadata: Record<string, unknown>,
  snakeCaseKey: string,
  camelCaseKey: string,
): unknown {
  return metadata[snakeCaseKey] ?? metadata[camelCaseKey];
}

interface StorageUploadOwnershipContext {
  runSha256: string;
  firstObjectIndex: number;
  claimObject: (
    object: StagingStorageIntent,
    objectIndex: number,
  ) => Promise<{ claim: StorageUploadClaim; fresh: boolean }>;
  recordClaim: (claim: StorageUploadClaim, objectIndex: number) => Promise<string>;
  startUpload: (
    claim: StorageUploadClaim,
    objectIndex: number,
    freshClaim: boolean,
  ) => Promise<BeginStorageUploadAttemptResult>;
  recordObject: (
    object: StorageJournalObject,
    objectIndex: number,
    claim: StorageUploadClaim,
    uploadAttempt: number,
  ) => Promise<string>;
}

async function verifyRemoteStorageObject(
  storage: ReturnType<SupabaseClient["storage"]["from"]>,
  objectKey: string,
  expectedSha256: string,
  expectedBytes: number,
  label: "raw" | "preview",
): Promise<void> {
  const existing = await storage.download(objectKey);
  if (existing.error) databaseError("remote disclosure Storage verification", existing.error);
  if (!existing.data || existing.data.size !== expectedBytes) {
    throw new Error(`Remote ${label} Storage object size mismatch.`);
  }
  const existingContent = new Uint8Array(await existing.data.arrayBuffer());
  if (sha256Buffer(existingContent) !== expectedSha256) {
    throw new Error(`Remote ${label} Storage object hash mismatch.`);
  }
}

async function remoteStorageObjectOwnedByRun(
  storage: ReturnType<SupabaseClient["storage"]["from"]>,
  objectKey: string,
  expectedSha256: string,
  expectedBytes: number,
  runSha256: string,
  expectedUploadClaim?: StorageUploadClaim,
): Promise<boolean> {
  const info = await storage.info(objectKey);
  if (info.error || !info.data || !isRecord(info.data.metadata)) {
    if (info.error) databaseError("remote disclosure Storage ownership verification", info.error);
    throw new Error("Remote Storage object ownership metadata is unavailable.");
  }
  const metadata = info.data.metadata;
  const reportedSize = typeof info.data.size === "number"
    ? info.data.size
    : typeof metadata.size === "number"
      ? metadata.size
      : Number(metadata.size);
  if (reportedSize !== expectedBytes) {
    throw new Error("Remote Storage ownership metadata has a different object size.");
  }
  const owner = customStorageMetadata(metadata, "ingest_run_sha256", "ingestRunSha256");
  if (owner === undefined || owner === null || owner === "") return false;
  if (
    customStorageMetadata(metadata, "ingest_sha256", "ingestSha256") !== expectedSha256
    || Number(customStorageMetadata(metadata, "ingest_bytes", "ingestBytes")) !== expectedBytes
  ) {
    throw new Error("Remote Storage object has conflicting ingest ownership metadata.");
  }
  if (
    owner === runSha256
    && expectedUploadClaim?.claim_action === "upload"
    && (
      customStorageMetadata(metadata, "ingest_claim_token", "ingestClaimToken")
        !== expectedUploadClaim.claim_token
      || Number(customStorageMetadata(metadata, "ingest_claim_epoch", "ingestClaimEpoch"))
        !== expectedUploadClaim.claim_epoch
      || customStorageMetadata(metadata, "ingest_claimant_id", "ingestClaimantId")
        !== expectedUploadClaim.claimant_id
    )
  ) {
    throw new Error("Remote Storage object was not created by the exact active upload claim.");
  }
  // A content-addressed object may have been created by an earlier run and be
  // safely reused by this one. Ownership remains with its original creator;
  // this run records it as pre-existing and must never delete it on abort.
  return owner === runSha256;
}

export async function uploadRawObjects(
  client: SupabaseClient,
  bucket: string,
  plan: StagingLoadPlan,
  ownership: StorageUploadOwnershipContext,
): Promise<StorageJournalObject[]> {
  if (bucket !== "disclosure-raw") {
    throw new Error("Immutable disclosure sources may only be uploaded to disclosure-raw.");
  }
  const journal: StorageJournalObject[] = [];
  const storage = client.storage.from(bucket);
  for (const raw of plan.raw_objects) {
    const objectIndex = ownership.firstObjectIndex + journal.length;
    const intent = {
      bucket: "disclosure-raw" as const,
      object_key: raw.storage_path,
      sha256: raw.sha256,
      bytes: raw.bytes,
    };
    const content = await readFile(raw.absolute_path);
    if (sha256Buffer(content) !== raw.sha256 || content.byteLength !== raw.bytes) {
      throw new Error(`Storage 업로드 직전 원본 hash가 변경되었습니다: ${raw.source_path}`);
    }
    const resolvedClaim = await ownership.claimObject(intent, objectIndex);
    const claim = validateStorageUploadClaim(resolvedClaim.claim);
    if (
      claim.bucket !== intent.bucket
      || claim.object_key !== intent.object_key
      || claim.sha256 !== intent.sha256
      || claim.bytes !== intent.bytes
    ) {
      throw new Error("Storage upload claim does not bind the exact prepared raw object.");
    }
    if (resolvedClaim.fresh) await ownership.recordClaim(claim, objectIndex);
    let uploadError: unknown = null;
    let uploadAttempt = 0;
    if (claim.claim_action === "upload") {
      const uploadStart = await ownership.startUpload(claim, objectIndex, resolvedClaim.fresh);
      uploadAttempt = uploadStart.uploadAttempt;
      if (uploadStart.shouldUpload) {
        const upload = await storage.upload(
          raw.storage_path,
          content,
          {
            contentType: contentType(raw.ext),
            upsert: false,
            metadata: {
              ingest_run_sha256: ownership.runSha256,
              ingest_sha256: raw.sha256,
              ingest_bytes: raw.bytes,
              ingest_claim_token: claim.claim_token,
              ingest_claim_epoch: claim.claim_epoch,
              ingest_claimant_id: claim.claimant_id,
            },
          },
        );
        uploadError = upload.error;
        if (upload.error && !storageDuplicate(upload.error)) {
          databaseError("disclosure raw Storage upload", upload.error);
        }
      }
    }
    await verifyRemoteStorageObject(storage, raw.storage_path, raw.sha256, raw.bytes, "raw");
    const created = await remoteStorageObjectOwnedByRun(
      storage,
      raw.storage_path,
      raw.sha256,
      raw.bytes,
      ownership.runSha256,
      claim,
    );
    if (claim.claim_action === "upload" && !uploadError && !created) {
      throw new Error("A newly uploaded Storage object lacks exact run ownership metadata.");
    }
    const mutation = {
      bucket: "disclosure-raw",
      object_key: raw.storage_path,
      sha256: raw.sha256,
      bytes: raw.bytes,
      created,
    } as const;
    await ownership.recordObject(mutation, objectIndex, claim, uploadAttempt);
    journal.push(mutation);
  }
  return journal;
}

function databaseBatchPayload(plan: StagingLoadPlan): Record<string, unknown> {
  return {
    ...plan,
    raw_objects: plan.raw_objects.map(({ absolute_path: _absolutePath, ...raw }) => raw),
    preview_objects: plan.preview_objects.map(({ absolute_path: _AbsolutePath, ...preview }) => preview),
  };
}

function assertPreviewTransportMetadata(preview: PreviewStorageObject): void {
  if (
    !/^[a-f0-9]{64}$/u.test(preview.sha256)
    || !Number.isSafeInteger(preview.bytes)
    || preview.bytes < 0
    || preview.bytes > 2 * 1024 * 1024
    || !/^[a-f0-9]{64}\.txt$/u.test(preview.storage_path)
    || preview.storage_path !== `${preview.sha256}.txt`
    || preview.source_label.length === 0
    || preview.source_label.length > 255
    || /[\\/]/u.test(preview.source_label)
  ) {
    throw new Error("Derived disclosure preview metadata is invalid.");
  }
}

function canonicalPreviewTransportMetadata(
  previews: readonly PreviewStorageObject[],
): PreviewStorageObject[] {
  // Validate every occurrence before reading a file or making a remote call.
  // Occurrences retain provenance in the database payload; Storage transports
  // collapse only by their immutable content-addressed object identity.
  for (const preview of previews) assertPreviewTransportMetadata(preview);
  const canonical = new Map<string, PreviewStorageObject>();
  for (const preview of previews) {
    const existing = canonical.get(preview.storage_path);
    if (!existing) {
      canonical.set(preview.storage_path, preview);
      continue;
    }
    if (existing.sha256 !== preview.sha256 || existing.bytes !== preview.bytes) {
      throw new Error("Duplicate preview transport has conflicting content-address metadata.");
    }
  }
  return [...canonical.values()];
}

interface PreparedPreviewTransportObject {
  preview: PreviewStorageObject;
  content: Buffer;
}

async function preparePreviewTransportObjects(
  plan: StagingLoadPlan,
): Promise<PreparedPreviewTransportObject[]> {
  canonicalPreviewTransportMetadata(plan.preview_objects);
  const prepared = new Map<string, PreparedPreviewTransportObject>();
  for (const preview of plan.preview_objects) {
    const content = await readFile(preview.absolute_path);
    let previewText: string;
    try {
      previewText = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new Error(`Derived preview text is not valid UTF-8: ${preview.source_label}`);
    }
    if (previewText.includes("\0")) {
      throw new Error(`Derived preview text contains a forbidden NUL byte: ${preview.source_label}`);
    }
    if (sha256Buffer(content) !== preview.sha256 || content.byteLength !== preview.bytes) {
      throw new Error(`Derived preview content-address identity changed: ${preview.source_label}`);
    }
    const existing = prepared.get(preview.storage_path);
    if (existing && !existing.content.equals(content)) {
      throw new Error("Duplicate preview transport has conflicting actual content-address identity.");
    }
    if (!existing) prepared.set(preview.storage_path, { preview, content });
  }
  return [...prepared.values()];
}

export function storageIntentsForPlan(plan: StagingLoadPlan): StagingStorageIntent[] {
  const previewTransports = canonicalPreviewTransportMetadata(plan.preview_objects);
  return [
    ...plan.raw_objects.map((raw) => ({
      bucket: "disclosure-raw" as const,
      object_key: raw.storage_path,
      sha256: raw.sha256,
      bytes: raw.bytes,
    })),
    ...previewTransports.map((preview) => ({
      bucket: "disclosure-preview" as const,
      object_key: preview.storage_path,
      sha256: preview.sha256,
      bytes: preview.bytes,
    })),
  ];
}

function officialPriceHasStructuredPrice(row: StagingOfficialPrice): boolean {
  return row.price_min_krw !== null
    || row.price_max_krw !== null
    || row.options.some((option) =>
      option.price_min_krw !== null || option.price_max_krw !== null
    );
}

function assertPendingOnlyBatchWithLocalCompatibility(
  plan: StagingLoadPlan,
  localCompatibilityUnitIds: ReadonlySet<string> | null,
): void {
  if (plan.units.length < 1 || plan.units.length > 25) {
    throw new Error("atomic disclosure staging batches must contain between 1 and 25 units");
  }
  const fingerprintPattern = /^[a-f0-9]{64}$/u;
  if (
    new Set(plan.units.map((unit) => unit.unit_id)).size !== plan.units.length
    || plan.units.some((unit) =>
      !fingerprintPattern.test(unit.unit_id)
      || !fingerprintPattern.test(unit.source_fingerprint)
      || !fingerprintPattern.test(unit.conversion_fingerprint)
      || !fingerprintPattern.test(unit.extraction_fingerprint)
      || !fingerprintPattern.test(unit.validation_fingerprint)
    )
  ) {
    throw new Error("atomic disclosure staging requires unique units with exact immutable artifact fingerprints");
  }
  const rows = [
    ...plan.agency_packages,
    ...plan.official_prices,
    ...plan.disclosure_semantics,
  ];
  if (rows.length === 0) throw new Error("an atomic disclosure staging batch cannot be empty");
  if (rows.some((row) => row.review_status !== "pending")) {
    throw new Error("atomic disclosure staging is pending-only");
  }
  if (plan.dedupe_candidates.length !== 0) {
    throw new Error("cross-batch dedupe candidates may only be written by the finalizer");
  }
  for (const row of plan.official_prices) {
    if (row.category === "other") {
      throw new Error(
        "an official price must resolve to one of the four consumer explorer categories before staging",
      );
    }
    sanitizeVendorAliasProposals(row.alias_proposals);
    const identityOnly = !officialPriceHasStructuredPrice(row);
    const markedIdentityOnly = row.validation_issue_codes.includes("identity_only_no_price");
    if (identityOnly && (row.needs_review !== true || !markedIdentityOnly)) {
      throw new Error(
        "an unpriced vendor identity must remain review-only and carry identity_only_no_price",
      );
    }
    const safelyRetainedLocalIdentityMarker = localCompatibilityUnitIds?.has(row.unit_id) === true
      && row.review_status === "pending"
      && row.needs_review === true
      && row.validation_issue_codes.includes("local_deterministic_review_only")
      && row.validation_issue_codes.includes(
        "visual_transcription_human_confirmed_pending_admin_review",
      );
    if (!identityOnly && markedIdentityOnly && !safelyRetainedLocalIdentityMarker) {
      throw new Error("identity_only_no_price cannot mark an official price with a structured price");
    }
  }
}

export function assertPendingOnlyBatch(plan: StagingLoadPlan): void {
  assertPendingOnlyBatchWithLocalCompatibility(plan, null);
}

function exactAtomicBatchResponse(value: unknown, context: StagingBatchWriteContext): {
  batchReceiptSha256: string;
  loadedUnitIds: string[];
  loggedLedgerIds: string[];
} {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) throw new Error("atomic disclosure staging RPC returned no receipt");
  const receipt = row.batch_receipt_sha256;
  const loadedUnitIds = row.loaded_unit_ids;
  const loggedLedgerIds = row.logged_ledger_ids;
  if (
    typeof receipt !== "string"
    || !/^[a-f0-9]{64}$/u.test(receipt)
    || !Array.isArray(loadedUnitIds)
    || loadedUnitIds.some((unitId) => typeof unitId !== "string")
    || !Array.isArray(loggedLedgerIds)
    || loggedLedgerIds.some((ledgerId) => typeof ledgerId !== "string")
    || !isDeepStrictEqual(loadedUnitIds, context.unit_ids)
  ) {
    throw new Error("atomic disclosure staging RPC receipt is invalid or belongs to another batch");
  }
  return {
    batchReceiptSha256: receipt,
    loadedUnitIds: loadedUnitIds as string[],
    loggedLedgerIds: loggedLedgerIds as string[],
  };
}

function exactStoragePrepareResponse(value: unknown, expectedObjectCount: number): void {
  const row = Array.isArray(value) ? value[0] : value;
  if (
    !isRecord(row)
    || row.prepared_object_count !== expectedObjectCount
    || typeof row.already_prepared !== "boolean"
  ) {
    throw new Error("atomic disclosure Storage prepare RPC returned an invalid receipt");
  }
}

function exactStorageClaimResponse(
  value: unknown,
  object: StagingStorageIntent,
  expectedClaimantId: string,
): StorageUploadClaim {
  const row = Array.isArray(value) ? value[0] : value;
  const rawEpoch = isRecord(row) ? row.claim_epoch : null;
  const claimEpoch = typeof rawEpoch === "string" && /^[1-9][0-9]{0,15}$/u.test(rawEpoch)
    ? Number(rawEpoch)
    : rawEpoch;
  if (
    !isRecord(row)
    || typeof row.claim_token !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(row.claim_token)
    || !Number.isSafeInteger(claimEpoch)
    || (claimEpoch as number) < 1
    || (row.claim_action !== "upload" && row.claim_action !== "verify")
    || !["intent", "confirmed_created", "confirmed_preexisting", "confirmed_inherited"].includes(
      row.ownership_state as string,
    )
    || typeof row.claim_expires_at !== "string"
    || !Number.isFinite(Date.parse(row.claim_expires_at))
    || row.claimant_id !== expectedClaimantId
    || row.already_claimed !== false
  ) {
    throw new Error("atomic disclosure Storage claim RPC returned an invalid lease");
  }
  return {
    ...object,
    claim_token: row.claim_token,
    claim_epoch: claimEpoch as number,
    claimant_id: expectedClaimantId,
    claim_action: row.claim_action,
    claim_expires_at: new Date(row.claim_expires_at).toISOString(),
  };
}

function exactStorageOutcomeResponse(
  value: unknown,
  expectedState: "confirmed_created" | "confirmed_preexisting",
): void {
  const row = Array.isArray(value) ? value[0] : value;
  if (
    !isRecord(row)
    || (
      row.ownership_state !== expectedState
      && !(expectedState === "confirmed_preexisting" && row.ownership_state === "confirmed_inherited")
    )
    || typeof row.already_recorded !== "boolean"
  ) {
    throw new Error("atomic disclosure Storage outcome RPC returned an invalid receipt");
  }
}

export async function stageAtomicDisclosureBatch(
  client: SupabaseClient,
  environment: StagingEnvironment,
  plan: StagingLoadPlan,
  context: StagingBatchWriteContext,
): Promise<StagingWriterResult> {
  assertStagingEnvironmentDestination(environment);
  if (
    context.target_project_ref !== environment.projectRef
    || !/^[a-f0-9]{64}$/u.test(context.run_sha256)
    || !/^[a-f0-9]{64}$/u.test(context.full_plan_sha256)
    || context.batch_plan_sha256 !== stagingLoadPlanSha256(plan)
    || context.unit_ids.length !== plan.units.length
    || plan.units.some((unit, index) => unit.unit_id !== context.unit_ids[index])
    || context.batch_index < 1
    || context.batch_index > context.batch_count
    || new Set(context.local_pending_only_unit_ids).size !== context.local_pending_only_unit_ids.length
    || context.local_pending_only_unit_ids.some((unitId) => !/^[a-f0-9]{64}$/u.test(unitId))
    || !["paid_pilot_gate", "local_validated_pending_only"].includes(context.authorization_kind)
    || !/^[a-f0-9]{64}$/u.test(context.authorization_sha256)
    || ((context.local_pending_only_unit_ids.length > 0)
      !== (context.authorization_kind === "local_validated_pending_only"))
    || context.batch_sha256 !== canonicalSha256({
      schema_version: 1,
      batch_index: context.batch_index,
      batch_count: context.batch_count,
      full_plan_sha256: context.full_plan_sha256,
      unit_ids: context.unit_ids,
      batch_plan_sha256: context.batch_plan_sha256,
    })
  ) {
    throw new Error("atomic disclosure staging context does not match the exact batch plan");
  }
  assertPendingOnlyBatchWithLocalCompatibility(
    plan,
    context.authorization_kind === "local_validated_pending_only"
      ? new Set(context.local_pending_only_unit_ids)
      : null,
  );
  assertPlanSourceObjectKeys(plan);
  assertDisclosureSemanticPlanRows(plan);
  assertDisclosureSemanticLinkPlan(plan);
  const preparedPreviewTransports = await preparePreviewTransportObjects(plan);
  const currentBatchUnitIds = new Set(plan.units.map((unit) => unit.unit_id));
  const currentLocalIds = context.local_pending_only_unit_ids.filter((unitId) =>
    currentBatchUnitIds.has(unitId)
  );
  const markedLocalIds = plan.warnings
    .filter((warning) => warning.startsWith("local_deterministic_review_only:"))
    .map((warning) => warning.slice("local_deterministic_review_only:".length));
  if (!isDeepStrictEqual(currentLocalIds, markedLocalIds)) {
    throw new Error("atomic disclosure staging local pending-only markers do not match authorization");
  }
  const localSet = new Set(currentLocalIds);
  const localRows = [
    ...plan.agency_packages,
    ...plan.official_prices,
    ...plan.disclosure_semantics,
  ].filter((row) => localSet.has(row.unit_id));
  if (localSet.size > 0 && localRows.some((row) =>
    row.review_status !== "pending"
    || row.needs_review !== true
    || !row.validation_issue_codes.includes("local_deterministic_review_only")
  )) {
    throw new Error("local deterministic rows are review-only and cannot be bulk-approval eligible");
  }

  // This read is intentionally before Storage or database mutation. An
  // existing snapshot must be a draft; absence is valid on a fresh dedicated
  // staging project because the prepare RPC bootstraps and owns the draft in
  // the same transaction as the run journal.
  const snapshot = await client
    .from("price_snapshots")
    .select("id,published,published_at,is_current")
    .eq("source", plan.snapshot_source)
    .eq("period_label", plan.snapshot)
    .maybeSingle();
  if (snapshot.error) databaseError("draft disclosure snapshot preflight", snapshot.error);
  if (
    snapshot.data !== null
    && (
      !isRecord(snapshot.data)
      || typeof snapshot.data.id !== "string"
      || snapshot.data.published !== false
      || snapshot.data.published_at !== null
      || snapshot.data.is_current !== false
    )
  ) {
    throw new Error("atomic disclosure staging requires an unpublished, non-current draft snapshot");
  }

  const storageIntents = storageIntentsForPlan(plan);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    context.storage_claimant_id,
  )) {
    throw new Error("atomic disclosure Storage claimant identity is invalid");
  }
  await context.record_storage_intent(storageIntents);
  const prepared = await withSqlStateRetry(
    "atomic disclosure Storage prepare",
    async () => client.rpc("prepare_vendor_disclosure_batch_storage_atomic", {
      p_target_project_ref: context.target_project_ref,
      p_run_sha256: context.run_sha256,
      p_full_plan_sha256: context.full_plan_sha256,
      p_batch_index: context.batch_index,
      p_batch_count: context.batch_count,
      p_snapshot_source: plan.snapshot_source,
      p_snapshot_period: plan.snapshot,
      p_authorization_kind: context.authorization_kind,
      p_authorization_sha256: context.authorization_sha256,
      p_local_pending_only_unit_ids: context.local_pending_only_unit_ids,
      p_storage_intents: storageIntents,
    }),
  );
  exactStoragePrepareResponse(prepared.data, storageIntents.length);
  const claimStorageObject = async (
    object: StagingStorageIntent,
    objectIndex: number,
  ): Promise<{ claim: StorageUploadClaim; fresh: boolean }> => {
    if (objectIndex < 1 || objectIndex > storageIntents.length) {
      throw new Error("Storage claim object index is outside the exact prepared intent set");
    }
    const localClaim = await context.read_storage_claim(object, objectIndex);
    if (localClaim) {
      return { claim: validateStorageUploadClaim(localClaim), fresh: false };
    }
    const claimed = await withSqlStateRetry(
      "atomic disclosure Storage upload claim",
      async () => client.rpc("claim_vendor_disclosure_storage_object_atomic", {
        p_target_project_ref: context.target_project_ref,
        p_run_sha256: context.run_sha256,
        p_batch_index: context.batch_index,
        p_bucket_id: object.bucket,
        p_object_name: object.object_key,
        p_object_sha256: object.sha256,
        p_object_bytes: object.bytes,
        p_claimant_id: context.storage_claimant_id,
      }),
    );
    return {
      claim: exactStorageClaimResponse(claimed.data, object, context.storage_claimant_id),
      fresh: true,
    };
  };
  const recordStorageObject = async (
    object: StorageJournalObject,
    objectIndex: number,
    claim: StorageUploadClaim,
    uploadAttempt: number,
  ): Promise<string> => {
    // Persist locally first. If the remote receipt call is interrupted, the
    // created-object journal is still sufficient for an explicit abort to
    // inspect the object; it is never silently treated as pre-existing.
    const journalPath = await context.record_storage_object(
      object,
      objectIndex,
      claim,
      uploadAttempt,
    );
    const recorded = await withSqlStateRetry(
      "atomic disclosure Storage outcome",
      async () => client.rpc("record_vendor_disclosure_storage_object_atomic", {
        p_target_project_ref: context.target_project_ref,
        p_run_sha256: context.run_sha256,
        p_batch_index: context.batch_index,
        p_bucket_id: object.bucket,
        p_object_name: object.object_key,
        p_object_sha256: object.sha256,
        p_object_bytes: object.bytes,
        p_created_by_run: object.created,
        p_claim_token: claim.claim_token,
        p_claim_epoch: claim.claim_epoch,
        p_claimant_id: claim.claimant_id,
      }),
    );
    exactStorageOutcomeResponse(
      recorded.data,
      object.created ? "confirmed_created" : "confirmed_preexisting",
    );
    return journalPath;
  };
  const rawJournal = await uploadRawObjects(client, environment.bucket, plan, {
    runSha256: context.run_sha256,
    firstObjectIndex: 1,
    claimObject: claimStorageObject,
    recordClaim: context.record_storage_claim,
    startUpload: context.record_storage_upload_started,
    recordObject: recordStorageObject,
  });
  const previewJournal = await uploadPreparedPreviewObjects(
    client,
    environment.previewBucket,
    preparedPreviewTransports,
    {
      runSha256: context.run_sha256,
      firstObjectIndex: rawJournal.length + 1,
      claimObject: claimStorageObject,
      recordClaim: context.record_storage_claim,
      startUpload: context.record_storage_upload_started,
      recordObject: recordStorageObject,
    },
  );
  await context.record_storage_journal([...rawJournal, ...previewJournal]);

  const storageMutations = [...rawJournal, ...previewJournal];
  const applied = await withSqlStateRetry(
    "atomic disclosure staging batch",
    async () => client.rpc("stage_vendor_disclosure_batch_atomic", {
      p_target_project_ref: context.target_project_ref,
      p_run_sha256: context.run_sha256,
      p_full_plan_sha256: context.full_plan_sha256,
      p_batch_plan_sha256: context.batch_plan_sha256,
      p_batch_sha256: context.batch_sha256,
      p_batch_index: context.batch_index,
      p_batch_count: context.batch_count,
      p_snapshot_source: plan.snapshot_source,
      p_snapshot_period: plan.snapshot,
      p_authorization_kind: context.authorization_kind,
      p_authorization_sha256: context.authorization_sha256,
      p_local_pending_only_unit_ids: context.local_pending_only_unit_ids,
      p_storage_objects: storageMutations,
      p_payload: databaseBatchPayload(plan),
    }),
  );
  const receipt = exactAtomicBatchResponse(applied.data, context);
  return {
    loadedUnitIds: receipt.loadedUnitIds,
    skippedUnitIds: [],
    loggedLedgerIds: receipt.loggedLedgerIds,
    atomicBatchReceiptSha256: receipt.batchReceiptSha256,
  };
}

export async function verifyAtomicDisclosureBatchReceipt(
  client: SupabaseClient,
  environment: StagingEnvironment,
  context: StagingBatchReceiptContext,
  expectedReceiptSha256: string,
): Promise<StagingWriterResult> {
  assertStagingEnvironmentDestination(environment);
  if (
    context.target_project_ref !== environment.projectRef
    || !/^[a-f0-9]{64}$/u.test(context.run_sha256)
    || !/^[a-f0-9]{64}$/u.test(context.full_plan_sha256)
    || !/^[a-f0-9]{64}$/u.test(context.batch_plan_sha256)
    || !/^[a-f0-9]{64}$/u.test(context.batch_sha256)
    || !/^[a-f0-9]{64}$/u.test(expectedReceiptSha256)
    || context.batch_index < 1
    || context.batch_index > context.batch_count
    || context.unit_ids.length < 1
    || context.unit_ids.length > 25
  ) {
    throw new Error("remote batch receipt verification context is invalid");
  }
  const verified = await withSqlStateRetry(
    "remote atomic disclosure batch receipt verification",
    async () => client.rpc("verify_vendor_disclosure_batch_receipt_atomic", {
      p_target_project_ref: context.target_project_ref,
      p_run_sha256: context.run_sha256,
      p_full_plan_sha256: context.full_plan_sha256,
      p_batch_plan_sha256: context.batch_plan_sha256,
      p_batch_sha256: context.batch_sha256,
      p_batch_index: context.batch_index,
      p_batch_count: context.batch_count,
      p_expected_receipt_sha256: expectedReceiptSha256,
      p_unit_ids: context.unit_ids,
    }),
  );
  const receipt = exactAtomicBatchResponse(verified.data, {
    ...context,
    storage_claimant_id: "00000000-0000-4000-8000-000000000000",
    record_storage_intent: async () => "",
    read_storage_claim: async () => null,
    record_storage_claim: async () => "",
    record_storage_upload_started: async () => ({
      uploadAttempt: 1,
      shouldUpload: true,
      journalPath: "",
    }),
    record_storage_object: async () => "",
    record_storage_journal: async () => "",
  });
  if (receipt.batchReceiptSha256 !== expectedReceiptSha256) {
    throw new Error("remote atomic disclosure batch receipt differs from local execution evidence");
  }
  return {
    loadedUnitIds: receipt.loadedUnitIds,
    skippedUnitIds: [],
    loggedLedgerIds: receipt.loggedLedgerIds,
    atomicBatchReceiptSha256: receipt.batchReceiptSha256,
  };
}

function exactNonNegativeCount(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`atomic disclosure abort receipt has an invalid ${key}`);
  }
  return value as number;
}

function exactRollbackStorageObject(value: unknown): StagingStorageIntent {
  if (!isRecord(value)) throw new Error("atomic disclosure abort returned a malformed Storage object");
  const bucket = value.bucket;
  const objectKey = value.object_key;
  const sha256 = value.sha256;
  const rawBytes = value.bytes;
  const bytes = typeof rawBytes === "string" && /^[0-9]{1,9}$/u.test(rawBytes)
    ? Number(rawBytes)
    : rawBytes;
  if (
    (bucket !== "disclosure-raw" && bucket !== "disclosure-preview")
    || typeof objectKey !== "string"
    || typeof sha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(sha256)
    || !objectKey.startsWith(`${sha256}.`)
    || !/^[a-f0-9]{64}\.(?:xlsx|docx|hwp|pdf|png|txt)$/u.test(objectKey)
    || !Number.isSafeInteger(bytes)
    || (bytes as number) < 0
    || (bytes as number) > 52_428_800
  ) {
    throw new Error("atomic disclosure abort returned an invalid Storage object identity");
  }
  return { bucket, object_key: objectKey, sha256, bytes: bytes as number };
}

function exactStorageOutcome(value: unknown): StagingStorageOutcome {
  const object = exactRollbackStorageObject(value);
  if (!isRecord(value) || ![
    "intent",
    "confirmed_created",
    "confirmed_preexisting",
    "confirmed_inherited",
    "delete_authorized",
    "deleted",
    "retained_shared",
    "ambiguous",
  ].includes(value.state as string)) {
    throw new Error("atomic disclosure abort returned an invalid Storage outcome");
  }
  return { ...object, state: value.state as StagingStorageOutcome["state"] };
}

function exactAbortResponse(value: unknown): StagingAbortResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (
    !isRecord(row)
    || typeof row.run_found !== "boolean"
    || typeof row.already_aborted !== "boolean"
    || !Array.isArray(row.storage_rollback_objects)
    || !Array.isArray(row.storage_object_outcomes)
  ) {
    throw new Error("atomic disclosure abort RPC returned no valid receipt");
  }
  const storageRollbackObjects = row.storage_rollback_objects.map(exactRollbackStorageObject);
  const storageObjectOutcomes = row.storage_object_outcomes.map(exactStorageOutcome);
  const storageRollbackReceiptSha256 = row.storage_rollback_receipt_sha256;
  if (
    (row.run_found && (
      typeof storageRollbackReceiptSha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(storageRollbackReceiptSha256)
    ))
    || (!row.run_found && storageRollbackReceiptSha256 !== null)
  ) {
    throw new Error("atomic disclosure abort returned an invalid Storage rollback receipt SHA-256");
  }
  const objectIdentities = storageRollbackObjects.map((object) => `${object.bucket}\0${object.object_key}`);
  const outcomeIdentities = storageObjectOutcomes.map((object) => `${object.bucket}\0${object.object_key}`);
  if (new Set(objectIdentities).size !== objectIdentities.length) {
    throw new Error("atomic disclosure abort returned duplicate Storage object identities");
  }
  if (new Set(outcomeIdentities).size !== outcomeIdentities.length) {
    throw new Error("atomic disclosure abort returned duplicate Storage outcome identities");
  }
  const outcomesByIdentity = new Map(
    storageObjectOutcomes.map((object) => [`${object.bucket}\0${object.object_key}`, object]),
  );
  if (storageRollbackObjects.some((object) => {
    const outcome = outcomesByIdentity.get(`${object.bucket}\0${object.object_key}`);
    return !outcome || outcome.state !== "delete_authorized" || !isDeepStrictEqual(
      { bucket: outcome.bucket, object_key: outcome.object_key, sha256: outcome.sha256, bytes: outcome.bytes },
      object,
    );
  }) || storageObjectOutcomes.some((outcome) =>
    outcome.state === "delete_authorized"
      && !objectIdentities.includes(`${outcome.bucket}\0${outcome.object_key}`)
  )) {
    throw new Error("atomic disclosure abort Storage authorization and outcome sets disagree");
  }
  if (!row.run_found && (storageRollbackObjects.length > 0 || storageObjectOutcomes.length > 0)) {
    throw new Error("a missing staging run cannot return Storage ownership outcomes");
  }
  return {
    runFound: row.run_found,
    deletedPackageCount: exactNonNegativeCount(row, "deleted_package_count"),
    deletedPriceCount: exactNonNegativeCount(row, "deleted_price_count"),
    deletedSemanticCount: exactNonNegativeCount(row, "deleted_semantic_count"),
    deletedVendorCount: exactNonNegativeCount(row, "deleted_vendor_count"),
    deletedAgencyCount: exactNonNegativeCount(row, "deleted_agency_count"),
    deletedTimeslotCount: exactNonNegativeCount(row, "deleted_timeslot_count"),
    deletedLedgerCount: exactNonNegativeCount(row, "deleted_ledger_count"),
    retainedIdentityCount: exactNonNegativeCount(row, "retained_identity_count"),
    retainedLedgerCount: exactNonNegativeCount(row, "retained_ledger_count"),
    storageRollbackObjects,
    storageObjectOutcomes,
    storageRollbackReceiptSha256: storageRollbackReceiptSha256 as string | null,
    ambiguousStorageObjectCount: storageObjectOutcomes.filter((object) => object.state === "ambiguous").length,
    retainedStorageObjectCount: storageObjectOutcomes.filter((object) => object.state === "retained_shared").length,
    alreadyMissingStorageObjectCount: storageObjectOutcomes.filter((object) => object.state === "deleted").length,
    manualStorageDeletionRequiredCount: storageRollbackObjects.length,
    alreadyAborted: row.already_aborted,
    completedStorageObjectCount: 0,
  };
}

function assertLocalCreatedStorageAccounting(
  outcomes: readonly StagingStorageOutcome[],
  localObjects: readonly StorageJournalObject[],
): void {
  const outcomesByIdentity = new Map(
    outcomes.map((object) => [`${object.bucket}\0${object.object_key}`, object]),
  );
  for (const local of localObjects) {
    const outcome = outcomesByIdentity.get(`${local.bucket}\0${local.object_key}`);
    if (
      !local.created
      || !outcome
      || !isDeepStrictEqual(
        { bucket: local.bucket, object_key: local.object_key, sha256: local.sha256, bytes: local.bytes },
        { bucket: outcome.bucket, object_key: outcome.object_key, sha256: outcome.sha256, bytes: outcome.bytes },
      )
      || !["delete_authorized", "deleted", "retained_shared", "ambiguous"].includes(outcome.state)
    ) {
      throw new Error("a durable local created-object journal lacks an exact terminal database ownership outcome");
    }
  }
}

export async function abortAtomicDisclosureRun(
  client: SupabaseClient,
  environment: StagingEnvironment,
  context: StagingAbortContext,
): Promise<StagingAbortResult> {
  assertStagingEnvironmentDestination(environment);
  if (
    context.target_project_ref !== environment.projectRef
    || !/^[a-f0-9]{64}$/u.test(context.run_sha256)
    || !/^[a-f0-9]{64}$/u.test(context.full_plan_sha256)
    || context.reason.trim().length < 1
    || context.reason.length > 500
    || context.locally_created_storage_objects.length > 32_000
    || context.locally_created_storage_objects.some((object) => !object.created)
  ) {
    throw new Error("atomic disclosure abort context is invalid");
  }
  const localIdentities = new Set<string>();
  for (const object of context.locally_created_storage_objects) {
    const exact = exactRollbackStorageObject({
      bucket: object.bucket,
      object_key: object.object_key,
      sha256: object.sha256,
      bytes: object.bytes,
    });
    const identity = `${exact.bucket}\0${exact.object_key}`;
    if (localIdentities.has(identity)) {
      throw new Error("atomic disclosure abort context contains duplicate Storage objects");
    }
    localIdentities.add(identity);
  }
  // This RPC commits the database rollback first. No Storage deletion occurs
  // unless its signed receipt names an exact run-created object.
  let aborted: Awaited<ReturnType<typeof client.rpc>>;
  try {
    aborted = await withSqlStateRetry(
      "atomic disclosure run abort",
      async () => client.rpc("abort_vendor_disclosure_ingest_run_atomic", {
        p_target_project_ref: context.target_project_ref,
        p_run_sha256: context.run_sha256,
        p_full_plan_sha256: context.full_plan_sha256,
        p_reason: context.reason.trim(),
      }),
    );
  } catch (error) {
    const databaseCause = error instanceof StagingDatabaseError ? error.cause : error;
    const databaseMessage = isRecord(databaseCause) && typeof databaseCause.message === "string"
      ? databaseCause.message
      : "";
    if (
      error instanceof StagingDatabaseError
      && error.code === "55000"
      && (
        databaseMessage.includes("DISCLOSURE_ABORT_STORAGE_INTENTS_UNSETTLED")
        || databaseMessage.includes("DISCLOSURE_ABORT_STORAGE_UPLOAD_CLAIMS_UNSETTLED")
      )
    ) {
      const rawCount = isRecord(databaseCause) && typeof databaseCause.details === "string"
        ? databaseCause.details
        : "";
      throw new StagingStorageIntentsUnsettledError(
        /^(?:0|[1-9][0-9]{0,4})$/u.test(rawCount) ? Number(rawCount) : null,
      );
    }
    throw error;
  }
  const receipt = exactAbortResponse(aborted.data);
  assertLocalCreatedStorageAccounting(
    receipt.storageObjectOutcomes,
    context.locally_created_storage_objects,
  );
  // Supabase Storage exposes name-based remove, not an atomic
  // compare-and-delete/version precondition. Deleting here after a separate
  // info/hash read could remove a replacement written in the gap. Preserve
  // every authorized object and return the exact receipt for a fenced manual
  // reconciliation instead.
  if (
    receipt.ambiguousStorageObjectCount > 0
    || receipt.manualStorageDeletionRequiredCount > 0
  ) {
    throw new StagingRollbackIncompleteError(receipt);
  }
  return receipt;
}

function exactStorageRollbackCompletionResponse(
  value: unknown,
): StagingStorageRollbackCompletionResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row) || typeof row.already_completed !== "boolean") {
    throw new Error("atomic Storage rollback completion RPC returned no valid receipt");
  }
  const completedObjectCount = exactNonNegativeCount(row, "completed_object_count");
  if (row.already_completed && completedObjectCount !== 0) {
    throw new Error("an already-completed Storage rollback cannot report newly completed objects");
  }
  return {
    completedObjectCount,
    alreadyCompleted: row.already_completed,
  };
}

export async function completeAtomicDisclosureStorageRollback(
  client: SupabaseClient,
  environment: StagingEnvironment,
  context: StagingStorageRollbackCompletionContext,
): Promise<StagingStorageRollbackCompletionResult> {
  assertStagingEnvironmentDestination(environment);
  if (
    context.target_project_ref !== environment.projectRef
    || !/^[a-f0-9]{64}$/u.test(context.run_sha256)
    || !/^[a-f0-9]{64}$/u.test(context.full_plan_sha256)
    || !/^[a-f0-9]{64}$/u.test(context.storage_rollback_receipt_sha256)
    || context.storage_rollback_objects.length > 32_000
  ) {
    throw new Error("atomic Storage rollback completion context is invalid");
  }
  const normalizedObjects = context.storage_rollback_objects
    .map((object) => exactRollbackStorageObject(object))
    .sort((left, right) =>
      `${left.bucket}\0${left.object_key}`.localeCompare(`${right.bucket}\0${right.object_key}`)
    );
  const identities = normalizedObjects.map((object) => `${object.bucket}\0${object.object_key}`);
  if (new Set(identities).size !== identities.length
    || !isDeepStrictEqual(normalizedObjects, context.storage_rollback_objects)) {
    throw new Error("atomic Storage rollback completion requires the exact canonical authorized set");
  }
  const completed = await withSqlStateRetry(
    "atomic disclosure Storage rollback completion",
    async () => client.rpc("complete_vendor_disclosure_storage_rollback_atomic", {
      p_target_project_ref: context.target_project_ref,
      p_run_sha256: context.run_sha256,
      p_full_plan_sha256: context.full_plan_sha256,
      p_storage_rollback_receipt_sha256: context.storage_rollback_receipt_sha256,
      p_storage_objects: normalizedObjects,
    }),
  );
  const result = exactStorageRollbackCompletionResponse(completed.data);
  if (!result.alreadyCompleted && result.completedObjectCount !== normalizedObjects.length) {
    throw new Error("atomic Storage rollback completion count differs from the authorized receipt set");
  }
  return result;
}

function exactInvalidationResponse(value: unknown): StagingInvalidationResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (
    !isRecord(row)
    || typeof row.invalidated !== "boolean"
    || typeof row.already_invalidated !== "boolean"
    || row.invalidated === row.already_invalidated
    || typeof row.invalidation_receipt_sha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(row.invalidation_receipt_sha256)
  ) {
    throw new Error("atomic completed-run invalidation RPC returned no valid receipt");
  }
  return {
    invalidated: row.invalidated,
    alreadyInvalidated: row.already_invalidated,
    invalidationReceiptSha256: row.invalidation_receipt_sha256,
  };
}

export async function invalidateAtomicDisclosureRun(
  client: SupabaseClient,
  environment: StagingEnvironment,
  context: StagingInvalidationContext,
): Promise<StagingInvalidationResult> {
  assertStagingEnvironmentDestination(environment);
  if (
    context.target_project_ref !== environment.projectRef
    || !/^[a-f0-9]{64}$/u.test(context.run_sha256)
    || !/^[a-f0-9]{64}$/u.test(context.full_plan_sha256)
    || context.reason.trim().length < 1
    || context.reason.length > 500
  ) {
    throw new Error("atomic completed-run invalidation context is invalid");
  }
  const invalidated = await withSqlStateRetry(
    "atomic completed disclosure run invalidation",
    async () => client.rpc("invalidate_vendor_disclosure_completed_run_atomic", {
      p_target_project_ref: context.target_project_ref,
      p_run_sha256: context.run_sha256,
      p_full_plan_sha256: context.full_plan_sha256,
      p_reason: context.reason.trim(),
    }),
  );
  return exactInvalidationResponse(invalidated.data);
}

export async function finalizeAtomicDisclosureDedupe(
  client: SupabaseClient,
  plan: StagingLoadPlan,
  context: StagingDedupeFinalizeContext,
): Promise<void> {
  assertDisclosureStagingProjectRef(context.target_project_ref);
  const exactBatchHashes = buildStagingBatches(plan).map((batch) => batch.batch_sha256);
  if (
    stagingLoadPlanSha256(plan) !== context.full_plan_sha256
    || canonicalSha256(plan.dedupe_candidates) !== context.dedupe_candidates_sha256
    || !isDeepStrictEqual(exactBatchHashes, context.completed_batch_sha256s)
    || plan.dedupe_candidates.some((candidate) => candidate.status !== "pending")
  ) {
    throw new Error("dedupe finalizer context does not match the exact completed staging run");
  }
  const snapshot = await client
    .from("price_snapshots")
    .select("id,published,published_at,is_current")
    .eq("source", plan.snapshot_source)
    .eq("period_label", plan.snapshot)
    .maybeSingle();
  if (snapshot.error) databaseError("dedupe draft snapshot preflight", snapshot.error);
  if (
    !isRecord(snapshot.data)
    || typeof snapshot.data.id !== "string"
    || snapshot.data.published !== false
    || snapshot.data.published_at !== null
    || snapshot.data.is_current !== false
  ) {
    throw new Error("dedupe finalization requires an existing unpublished, non-current draft snapshot");
  }
  const finalized = await withSqlStateRetry(
    "atomic disclosure dedupe finalizer",
    async () => client.rpc("finalize_vendor_disclosure_dedupe_atomic", {
      p_target_project_ref: context.target_project_ref,
      p_run_sha256: context.run_sha256,
      p_full_plan_sha256: context.full_plan_sha256,
      p_dedupe_candidates_sha256: context.dedupe_candidates_sha256,
      p_completed_batch_sha256s: context.completed_batch_sha256s,
      p_candidates: plan.dedupe_candidates,
    }),
  );
  const row = Array.isArray(finalized.data) ? finalized.data[0] : finalized.data;
  if (
    !isRecord(row)
    || !Number.isSafeInteger(row.staged_candidate_count)
    || (row.staged_candidate_count as number) < 0
    || typeof row.already_finalized !== "boolean"
  ) {
    throw new Error("atomic disclosure dedupe finalizer returned an invalid receipt");
  }
}

export async function uploadPreviewObjects(
  client: SupabaseClient,
  bucket: string,
  plan: StagingLoadPlan,
  ownership: StorageUploadOwnershipContext,
): Promise<StorageJournalObject[]> {
  if (bucket !== "disclosure-preview") {
    throw new Error("Derived disclosure text may only be uploaded to disclosure-preview.");
  }
  const prepared = await preparePreviewTransportObjects(plan);
  return uploadPreparedPreviewObjects(client, bucket, prepared, ownership);
}

async function uploadPreparedPreviewObjects(
  client: SupabaseClient,
  bucket: string,
  prepared: readonly PreparedPreviewTransportObject[],
  ownership: StorageUploadOwnershipContext,
): Promise<StorageJournalObject[]> {
  if (bucket !== "disclosure-preview") {
    throw new Error("Derived disclosure text may only be uploaded to disclosure-preview.");
  }
  const journal: StorageJournalObject[] = [];
  const storage = client.storage.from(bucket);
  for (const { preview, content } of prepared) {
    if (sha256Buffer(content) !== preview.sha256 || content.byteLength !== preview.bytes) {
      throw new Error(`Storage 업로드 직전 preview hash가 변경되었습니다: ${preview.source_label}`);
    }
    const objectIndex = ownership.firstObjectIndex + journal.length;
    const intent = {
      bucket: "disclosure-preview" as const,
      object_key: preview.storage_path,
      sha256: preview.sha256,
      bytes: preview.bytes,
    };
    const resolvedClaim = await ownership.claimObject(intent, objectIndex);
    const claim = validateStorageUploadClaim(resolvedClaim.claim);
    if (
      claim.bucket !== intent.bucket
      || claim.object_key !== intent.object_key
      || claim.sha256 !== intent.sha256
      || claim.bytes !== intent.bytes
    ) {
      throw new Error("Storage upload claim does not bind the exact prepared preview object.");
    }
    if (resolvedClaim.fresh) await ownership.recordClaim(claim, objectIndex);
    let uploadError: unknown = null;
    let uploadAttempt = 0;
    if (claim.claim_action === "upload") {
      const uploadStart = await ownership.startUpload(claim, objectIndex, resolvedClaim.fresh);
      uploadAttempt = uploadStart.uploadAttempt;
      if (uploadStart.shouldUpload) {
        const upload = await storage.upload(
          preview.storage_path,
          content,
          {
            contentType: "text/plain",
            upsert: false,
            metadata: {
              ingest_run_sha256: ownership.runSha256,
              ingest_sha256: preview.sha256,
              ingest_bytes: preview.bytes,
              ingest_claim_token: claim.claim_token,
              ingest_claim_epoch: claim.claim_epoch,
              ingest_claimant_id: claim.claimant_id,
            },
          },
        );
        uploadError = upload.error;
        if (upload.error && !storageDuplicate(upload.error)) {
          databaseError("disclosure preview Storage upload", upload.error);
        }
      }
    }
    await verifyRemoteStorageObject(
      storage,
      preview.storage_path,
      preview.sha256,
      preview.bytes,
      "preview",
    );
    const created = await remoteStorageObjectOwnedByRun(
      storage,
      preview.storage_path,
      preview.sha256,
      preview.bytes,
      ownership.runSha256,
      claim,
    );
    if (claim.claim_action === "upload" && !uploadError && !created) {
      throw new Error("A newly uploaded preview object lacks exact run ownership metadata.");
    }
    const mutation = {
      bucket: "disclosure-preview",
      object_key: preview.storage_path,
      sha256: preview.sha256,
      bytes: preview.bytes,
      created,
    } as const;
    await ownership.recordObject(mutation, objectIndex, claim, uploadAttempt);
    journal.push(mutation);
  }
  return journal;
}

async function ensureSnapshot(client: SupabaseClient, plan: StagingLoadPlan): Promise<string> {
  const existing = await client
    .from("price_snapshots")
    .select("id")
    .eq("source", plan.snapshot_source)
    .eq("period_label", plan.snapshot)
    .maybeSingle();
  if (existing.error) databaseError("가격 snapshot 조회", existing.error);
  if (existing.data) return idFrom(existing.data, "가격 snapshot 조회");

  const inserted = await client
    .from("price_snapshots")
    .insert({ period_label: plan.snapshot, source: plan.snapshot_source, is_current: false })
    .select("id")
    .single();
  if (inserted.error) databaseError("가격 snapshot 생성", inserted.error);
  return idFrom(inserted.data, "가격 snapshot 생성");
}

const DISCLOSURE_SEMANTIC_SELECT_COLUMNS = [
  "id",
  "snapshot_id",
  "schema_version",
  "unit_id",
  "record_kind",
  "semantic_type",
  "subject_kind",
  "subject_name",
  "subject_normalized_name",
  "partner_record_ref",
  "partner_vendor_id",
  "official_price_id",
  "source_agency",
  "partner_link_status",
  "vendor_category",
  "region_code",
  "title",
  "content_verbatim",
  "summary",
  "review_status",
  "needs_review",
  "validation_issue_codes",
  "source_file_ids",
  "source_file",
  "source_object_keys",
  "source_preview_keys",
  "source_quote",
  "source_fingerprint",
  "validation_fingerprint",
  "confidence",
  "source_record_key",
  "content_fingerprint",
].join(",");

function disclosureSemanticDatabasePayload(
  snapshotId: string,
  row: DisclosureSemanticStaging,
  links: Pick<ResolvedDisclosureSemanticPersistenceRow, "partnerVendorId" | "officialPriceId">,
): Record<string, unknown> {
  return {
    snapshot_id: snapshotId,
    ...row,
    partner_vendor_id: links.partnerVendorId,
    official_price_id: links.officialPriceId,
  };
}

function parseAndVerifyDisclosureSemantic(
  unsafeRow: DisclosureSemanticStaging,
): DisclosureSemanticStaging {
  const row = DisclosureSemanticStagingSchema.parse(unsafeRow);
  if (buildDisclosureSemanticSourceRecordKey(row) !== row.source_record_key) {
    throw new Error("disclosure semantic source record key does not match its immutable locator identity");
  }
  if (buildDisclosureSemanticContentFingerprint(row) !== row.content_fingerprint) {
    throw new Error("disclosure semantic content fingerprint does not match its immutable payload");
  }
  return row;
}

export function assertDisclosureSemanticPlanRows(plan: StagingLoadPlan): void {
  if (plan.schema_version !== 2) {
    throw new Error("staging plan schema_version 2 is required for disclosure semantics");
  }
  if (!Array.isArray(plan.disclosure_semantics)) {
    throw new Error("staging plan is missing the disclosure_semantics contract");
  }
  const unitById = new Map(plan.units.map((unit) => [unit.unit_id, unit]));
  const contentBySourceKey = new Map<string, string>();
  const actualRows: DisclosureSemanticStaging[] = [];
  for (const unsafeRow of plan.disclosure_semantics) {
    const row = parseAndVerifyDisclosureSemantic(unsafeRow);
    actualRows.push(row);
    const unit = unitById.get(row.unit_id);
    if (!unit) throw new Error("disclosure semantic row must reference a staged unit");
    if (row.record_kind === "vendor_policy") {
      const partnerRecords = buildPartnerVendorRecords(
        unit.unit_id,
        unit.region_code,
        unit.data.partner_vendors,
      );
      const partnerRecordIndex = partnerRecords.findIndex(
        (candidate) => candidate.record_ref === row.partner_record_ref,
      );
      const partnerRecord = partnerRecords[partnerRecordIndex];
      const partnerSource = partnerRecordIndex < 0
        ? undefined
        : unit.data.partner_vendors[partnerRecordIndex];
      const sourceBackedIdentity = Boolean(
        partnerSource
        && partnerSource.source_quote.trim().length > 0
        && (partnerSource.source_file_ids?.length ?? 0) > 0,
      );
      if (
        !partnerRecord
        || partnerRecord.vendor_name !== row.subject_name
        || partnerRecord.normalized_name !== row.subject_normalized_name
        || partnerRecord.category !== row.vendor_category
        || (partnerRecord.stageable || sourceBackedIdentity
          ? "price_row_staged"
          : "policy_only_pending_identity")
          !== row.partner_link_status
      ) {
        throw new Error("disclosure vendor policy must preserve its exact partner-record identity and linkage state");
      }
      const expectedSourceAgency = unit.kind_hint === "agency" ? {
        name: unit.raw_name,
        normalized_name: unit.normalized_name,
        corporate_name: unit.corporate_name,
        region_code: unit.region_code,
        source_file: row.source_file,
      } : null;
      if (!isDeepStrictEqual(row.source_agency, expectedSourceAgency)) {
        throw new Error("disclosure vendor policy source agency must match its scan-derived unit identity");
      }
    } else if (
      row.subject_name !== unit.raw_name
      || row.subject_normalized_name !== unit.normalized_name
      || row.subject_kind !== (unit.kind_hint === "agency" ? "agency" : "vendor")
    ) {
      throw new Error("disclosure document section subject must match its scan-derived unit identity");
    }
    const previous = contentBySourceKey.get(row.source_record_key);
    if (previous !== undefined && previous !== row.content_fingerprint) {
      throw new Error("one semantic source record key cannot identify different immutable payloads");
    }
    contentBySourceKey.set(row.source_record_key, row.content_fingerprint);
  }
  const expectedRows = plan.units.flatMap((unit) => stagingDisclosureSemantics(unit));
  const canonicalRows = (rows: DisclosureSemanticStaging[]): string[] => rows
    .map((row) => JSON.stringify(row))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (!isDeepStrictEqual(canonicalRows(actualRows), canonicalRows(expectedRows))) {
    throw new Error(
      "disclosure semantic plan must exactly match reconstructed unit semantics; additional, missing, or modified rows are blocked",
    );
  }
}

export function assertDisclosureSemanticLinkPlan(plan: StagingLoadPlan): void {
  const priceRowsByPartnerRef = new Map<string, StagingOfficialPrice[]>();
  for (const price of plan.official_prices) {
    if (!price.partner_record_ref) continue;
    const rows = priceRowsByPartnerRef.get(price.partner_record_ref) ?? [];
    rows.push(price);
    priceRowsByPartnerRef.set(price.partner_record_ref, rows);
  }
  for (const [partnerRef, prices] of priceRowsByPartnerRef) {
    if (prices.length !== 1) {
      throw new Error(`partner record ref must identify exactly one staged official price: ${partnerRef}`);
    }
  }
  for (const row of plan.disclosure_semantics) {
    if (row.record_kind !== "vendor_policy") continue;
    const partnerRef = row.partner_record_ref;
    if (!partnerRef) throw new Error("vendor policy is missing its partner record ref");
    const linkedPrices = priceRowsByPartnerRef.get(partnerRef) ?? [];
    if (row.partner_link_status === "price_row_staged") {
      if (linkedPrices.length !== 1) {
        throw new Error("price_row_staged policy requires one exact staged official price before persisted IDs preflight");
      }
      const [price] = linkedPrices;
      if (
        price.unit_id !== row.unit_id
        || price.vendor_name !== row.subject_name
        || normalizeVendorName(price.vendor_name) !== row.subject_normalized_name
        || price.category !== row.vendor_category
        || price.region_code !== row.region_code
      ) {
        throw new Error("price_row_staged policy does not match its exact staged official price identity");
      }
    } else if (linkedPrices.length !== 0) {
      throw new Error("policy_only_pending_identity cannot reference a staged official price");
    }
  }
}

export interface PersistedPartnerPriceLink {
  partnerVendorId: string;
  officialPriceId: string;
}

export interface ResolvedDisclosureSemanticPersistenceRow {
  row: DisclosureSemanticStaging;
  partnerVendorId: string | null;
  officialPriceId: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function resolveDisclosureSemanticPersistenceRows(
  rows: DisclosureSemanticStaging[],
  persistedPriceLinks: Map<string, PersistedPartnerPriceLink>,
  policyOnlyVendorIds: Map<string, string>,
): ResolvedDisclosureSemanticPersistenceRow[] {
  return rows.map((row) => {
    if (row.record_kind === "document_section") {
      return { row, partnerVendorId: null, officialPriceId: null };
    }
    const partnerRef = row.partner_record_ref;
    if (!partnerRef) throw new Error("vendor policy cannot resolve without a partner record ref");
    if (row.partner_link_status === "price_row_staged") {
      const link = persistedPriceLinks.get(partnerRef);
      if (
        !link
        || !UUID_PATTERN.test(link.partnerVendorId)
        || !UUID_PATTERN.test(link.officialPriceId)
      ) {
        throw new Error("price_row_staged policy could not resolve its persisted vendor and official price IDs");
      }
      return { row, ...link };
    }
    const partnerVendorId = policyOnlyVendorIds.get(partnerRef);
    if (!partnerVendorId || !UUID_PATTERN.test(partnerVendorId)) {
      throw new Error("policy-only vendor policy could not resolve its persisted vendor ID");
    }
    if (persistedPriceLinks.has(partnerRef)) {
      throw new Error("policy-only vendor policy unexpectedly resolved an official price ID");
    }
    return { row, partnerVendorId, officialPriceId: null };
  });
}

async function findExistingDisclosureSemantic(
  client: SupabaseClient,
  snapshotId: string,
  sourceRecordKey: string,
): Promise<Record<string, unknown> | null> {
  const existing = await client
    .from("disclosure_semantic_staging")
    .select(DISCLOSURE_SEMANTIC_SELECT_COLUMNS)
    .eq("snapshot_id", snapshotId)
    .eq("source_record_key", sourceRecordKey)
    .maybeSingle();
  if (existing.error) databaseError("공시 의미정보 staging 조회", existing.error);
  return existing.data as Record<string, unknown> | null;
}

function reconcileExistingDisclosureSemantic(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
): string {
  const id = idFrom(existing, "공시 의미정보 staging 조회");
  const { id: _id, ...stored } = existing;
  if (!isDeepStrictEqual(stored, expected)) {
    throw new Error(
      "existing disclosure semantic source key has different immutable content; staging is blocked",
    );
  }
  return id;
}

export async function persistDisclosureSemantic(
  client: SupabaseClient,
  snapshotId: string,
  unsafeRow: DisclosureSemanticStaging,
  links: Pick<ResolvedDisclosureSemanticPersistenceRow, "partnerVendorId" | "officialPriceId">,
): Promise<string> {
  const row = parseAndVerifyDisclosureSemantic(unsafeRow);
  if (
    row.record_kind === "document_section"
    && (links.partnerVendorId !== null || links.officialPriceId !== null)
  ) {
    throw new Error("document semantic records cannot carry durable vendor or official-price links");
  }
  const [resolved] = resolveDisclosureSemanticPersistenceRows(
    [row],
    row.partner_record_ref && links.officialPriceId ? new Map([[row.partner_record_ref, {
      partnerVendorId: links.partnerVendorId ?? "",
      officialPriceId: links.officialPriceId,
    }]]) : new Map(),
    row.partner_record_ref && links.partnerVendorId && !links.officialPriceId
      ? new Map([[row.partner_record_ref, links.partnerVendorId]])
      : new Map(),
  );
  const payload = disclosureSemanticDatabasePayload(snapshotId, row, resolved);
  const existing = await findExistingDisclosureSemantic(
    client,
    snapshotId,
    row.source_record_key,
  );
  if (existing) return reconcileExistingDisclosureSemantic(existing, payload);

  const inserted = await client
    .from("disclosure_semantic_staging")
    .insert(payload)
    .select("id")
    .single();
  if (inserted.error && databaseErrorCode(inserted.error) === "23505") {
    const raced = await findExistingDisclosureSemantic(client, snapshotId, row.source_record_key);
    if (raced) return reconcileExistingDisclosureSemantic(raced, payload);
  }
  if (inserted.error) databaseError("공시 의미정보 staging 적재", inserted.error);
  return idFrom(inserted.data, "공시 의미정보 staging 적재");
}

type StagingAgencyIdentity = Pick<
  StagingAgencyPackage,
  "agency_name" | "agency_normalized_name" | "agency_corporate_name" | "region_code" | "source_file"
>;

async function ensureAgency(client: SupabaseClient, row: StagingAgencyIdentity): Promise<string> {
  const candidates = await collectBoundedPages<unknown>(async (from, to) => {
    const page = await client
      .from("agencies")
      .select("id,name,normalized_name,aliases")
      .eq("region_code", row.region_code)
      .is("merged_into_agency_id", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (page.error) databaseError("대행사 후보 조회", page.error);
    return Array.isArray(page.data) ? page.data : [];
  });
  const matches = candidates.filter((candidate) => {
    if (!isRecord(candidate) || typeof candidate.name !== "string") return false;
    return [candidate.name, ...stringArray(candidate.aliases)]
      .some((name) => normalizeVendorName(name) === row.agency_normalized_name);
  });
  if (matches.length > 1) {
    throw new Error(`대행사 후보가 여러 개라 자동 매칭하지 않았습니다: ${row.agency_name}`);
  }
  if (matches[0]) return idFrom(matches[0], "대행사 조회");
  const inserted = await client.from("agencies").insert({
    name: row.agency_name,
    normalized_name: row.agency_normalized_name,
    corporate_name: row.agency_corporate_name,
    region_code: row.region_code,
    source_file: row.source_file,
    aliases: [],
  }).select("id").single();
  if (inserted.error) databaseError("대행사 staging 생성", inserted.error);
  return idFrom(inserted.data, "대행사 staging 생성");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export type VendorDatabaseCategory = "studio" | "dress" | "makeup" | "venue" | "other";

export function vendorDatabaseCategory(category: StagingOfficialPrice["category"]): VendorDatabaseCategory {
  return category === "hall" ? "venue" : category;
}

export function deterministicVendorSlug(
  vendorName: string,
  category: StagingOfficialPrice["category"],
  regionCode: string,
): string {
  const databaseCategory = vendorDatabaseCategory(category);
  const safeRegion = regionCode.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  const identity = `${normalizeVendorName(vendorName)}\0${databaseCategory}\0${regionCode}`;
  return `${databaseCategory}-${safeRegion}-${sha256Text(identity).slice(0, 12)}`;
}

export function activeVendorNameMatches(
  candidate: { name: string; aliases?: unknown; status?: unknown },
  targetNormalizedName: string,
): boolean {
  if (candidate.status !== undefined && candidate.status !== "pending" && candidate.status !== "approved") return false;
  return [candidate.name, ...stringArray(candidate.aliases)]
    .some((name) => normalizeVendorName(name) === targetNormalizedName);
}

export async function collectBoundedPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 500,
  maximumRows = 10_000,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || !Number.isSafeInteger(maximumRows) || maximumRows < pageSize) {
    throw new Error("invalid bounded pagination limits");
  }
  const rows: T[] = [];
  for (let from = 0; from < maximumRows; from += pageSize) {
    const requested = Math.min(pageSize, maximumRows - from);
    const page = await fetchPage(from, from + requested - 1);
    if (page.length > requested) throw new Error("vendor pagination returned more rows than requested");
    rows.push(...page);
    if (page.length < requested) return rows;
  }
  const overflow = await fetchPage(maximumRows, maximumRows);
  if (overflow.length > 0) {
    throw new Error(`active vendor candidate count exceeds the fail-closed limit of ${maximumRows}`);
  }
  return rows;
}

export function sanitizeVendorAliasProposals(aliases: string[]): Array<{
  alias: string;
  normalized_alias: string;
}> {
  const sanitized: string[] = [];
  const seen = new Set<string>();
  for (const value of aliases) {
    const alias = value.normalize("NFKC").trim();
    if (alias.length < 1 || alias.length > 200) {
      throw new Error("vendor alias proposals must be 1-200 trimmed characters");
    }
    const normalizedAlias = normalizeVendorName(alias);
    if (normalizedAlias.length < 1 || normalizedAlias.length > 200) {
      throw new Error("vendor alias proposals must have a valid normalized identity");
    }
    if (seen.has(normalizedAlias)) continue;
    seen.add(normalizedAlias);
    sanitized.push(alias);
  }
  if (sanitized.length > 100) throw new Error("vendor alias proposals exceed the 100 item limit");
  return sanitized.map((alias) => ({
    alias,
    normalized_alias: normalizeVendorName(alias),
  }));
}

export async function stageVendorAliasProposals(
  client: SupabaseClient,
  officialPriceId: string,
  vendorId: string,
  aliases: string[],
): Promise<void> {
  const proposals = sanitizeVendorAliasProposals(aliases);
  const existing = await client.from("vendor_alias_proposals")
    .select("id,vendor_id,alias,normalized_alias,status")
    .eq("official_price_id", officialPriceId);
  if (existing.error) databaseError("vendor alias proposal replay query", existing.error);

  const existingByIdentity = new Map<string, Record<string, unknown>>();
  for (const proposal of Array.isArray(existing.data) ? existing.data.filter(isRecord) : []) {
    if (typeof proposal.normalized_alias !== "string" || existingByIdentity.has(proposal.normalized_alias)) {
      throw new Error("stored vendor alias proposals have an invalid or duplicate identity");
    }
    existingByIdentity.set(proposal.normalized_alias, proposal);
  }
  const desiredIdentities = new Set(proposals.map((proposal) => proposal.normalized_alias));
  if ([...existingByIdentity.keys()].some((identity) => !desiredIdentities.has(identity))) {
    throw new Error("stored vendor alias proposal set differs from immutable staged content");
  }
  for (const proposal of proposals) {
    const stored = existingByIdentity.get(proposal.normalized_alias);
    if (stored && (stored.vendor_id !== vendorId || stored.alias !== proposal.alias)) {
      throw new Error("stored vendor alias proposal differs from immutable staged content");
    }
  }

  const missing = proposals.filter((proposal) => !existingByIdentity.has(proposal.normalized_alias));
  if (missing.length > 0) {
    const inserted = await client.from("vendor_alias_proposals").upsert(
      missing.map((proposal) => ({
        official_price_id: officialPriceId,
        vendor_id: vendorId,
        alias: proposal.alias,
        normalized_alias: proposal.normalized_alias,
        status: "pending",
      })),
      { onConflict: "official_price_id,normalized_alias", ignoreDuplicates: true },
    );
    if (inserted.error) databaseError("vendor alias proposal staging", inserted.error);
  }

  const verified = await client.from("vendor_alias_proposals")
    .select("vendor_id,alias,normalized_alias,status")
    .eq("official_price_id", officialPriceId);
  if (verified.error) databaseError("vendor alias proposal replay verification", verified.error);
  const verifiedRows = Array.isArray(verified.data) ? verified.data.filter(isRecord) : [];
  if (verifiedRows.length !== proposals.length || proposals.some((proposal) => !verifiedRows.some((stored) =>
    stored.vendor_id === vendorId
      && stored.alias === proposal.alias
      && stored.normalized_alias === proposal.normalized_alias
      && (stored.status === "pending" || stored.status === "approved" || stored.status === "rejected")
  ))) {
    throw new Error("vendor alias proposal replay verification failed");
  }
}

type StagingVendorIdentity = Pick<
  StagingOfficialPrice,
  "vendor_name" | "category" | "region_code"
>;

async function ensureVendor(client: SupabaseClient, row: StagingVendorIdentity): Promise<string> {
  const databaseCategory = vendorDatabaseCategory(row.category);
  const allCandidates = await collectBoundedPages<unknown>(async (from, to) => {
    const page = await client
      .from("vendors")
      .select("id,name,aliases,status")
      .eq("category", databaseCategory)
      .eq("region_code", row.region_code)
      .in("status", ["pending", "approved"])
      .order("id", { ascending: true })
      .range(from, to);
    if (page.error) databaseError("vendor candidate page query", page.error);
    return Array.isArray(page.data) ? page.data : [];
  });
  const target = normalizeVendorName(row.vendor_name);
  const matches = allCandidates.filter((candidate) => {
    if (!isRecord(candidate) || typeof candidate.name !== "string") return false;
    return activeVendorNameMatches({
      name: candidate.name,
      aliases: candidate.aliases,
      status: candidate.status,
    }, target);
  });
  if (matches.length > 1) throw new Error(`업체 후보가 여러 개라 자동 매칭하지 않았습니다: ${row.vendor_name}`);
  if (matches[0]) {
    return idFrom(matches[0], "업체 후보 조회");
  }

  const slug = deterministicVendorSlug(row.vendor_name, row.category, row.region_code);
  const slugCollision = await client.from("vendors")
    .select("id,name,aliases,status,category,region_code")
    .eq("slug", slug)
    .maybeSingle();
  if (slugCollision.error) databaseError("업체 slug 충돌 조회", slugCollision.error);
  if (slugCollision.data) {
    if (
      isRecord(slugCollision.data)
      && typeof slugCollision.data.name === "string"
      && slugCollision.data.category === databaseCategory
      && slugCollision.data.region_code === row.region_code
      && activeVendorNameMatches({
        name: slugCollision.data.name,
        aliases: slugCollision.data.aliases,
        status: slugCollision.data.status,
      }, target)
    ) {
      return idFrom(slugCollision.data, "업체 slug 조회");
    }
    throw new Error("deterministic vendor slug collision; automatic vendor creation is blocked");
  }

  const inserted = await client.from("vendors").insert({
    owner_id: null,
    name: row.vendor_name,
    slug,
    category: databaseCategory,
    location: "",
    region_code: row.region_code,
    aliases: [],
    status: "pending",
    attributes: {},
    enrichment_status: "pending",
  }).select("id").single();
  if (inserted.error && databaseErrorCode(inserted.error) === "23505") {
    throw new Error("deterministic vendor slug collision during insert; automatic vendor creation is blocked");
  }
  if (inserted.error) databaseError("업체 staging 생성", inserted.error);
  return idFrom(inserted.data, "업체 staging 생성");
}

async function insertAgencyPackage(
  client: SupabaseClient,
  snapshotId: string,
  row: StagingAgencyPackage,
): Promise<string> {
  const agencyId = await ensureAgency(client, row);
  const existing = await client.from("official_agency_packages")
    .select("id,category_scope,price_min_krw,price_max_krw,vat_note,price_note,source_quote,source_object_keys,source_preview_keys,options,confidence,needs_review,validation_issue_codes")
    .eq("snapshot_id", snapshotId)
    .eq("agency_id", agencyId)
    .eq("package_name", row.package_name)
    .eq("source_file", row.source_file)
    .maybeSingle();
  if (existing.error) databaseError("대행사 패키지 중복 확인", existing.error);
  if (existing.data) {
    const same = isRecord(existing.data)
      && existing.data.price_min_krw === row.price_min_krw
      && existing.data.price_max_krw === row.price_max_krw
      && JSON.stringify(existing.data.category_scope) === JSON.stringify(row.category_scope)
      && existing.data.vat_note === row.vat_note
      && existing.data.price_note === row.price_note
      && existing.data.source_quote === row.source_quote
      && JSON.stringify(existing.data.source_object_keys) === JSON.stringify(row.source_object_keys)
      && JSON.stringify(existing.data.source_preview_keys) === JSON.stringify(row.source_preview_keys)
      && JSON.stringify(existing.data.options) === JSON.stringify(row.options)
      && existing.data.confidence === row.confidence
      && existing.data.needs_review === row.needs_review
      && JSON.stringify(existing.data.validation_issue_codes) === JSON.stringify(row.validation_issue_codes);
    if (!same) {
      throw new Error("agency package identity already exists with different staged values; automatic overwrite is blocked");
    }
    return agencyId;
  }
  const inserted = await client.from("official_agency_packages").insert({
    snapshot_id: snapshotId,
    agency_id: agencyId,
    package_name: row.package_name,
    category_scope: row.category_scope,
    price_min_krw: row.price_min_krw,
    price_max_krw: row.price_max_krw,
    vat_note: row.vat_note,
    price_note: row.price_note,
    options: row.options,
    review_status: "pending",
    needs_review: row.needs_review,
    validation_issue_codes: row.validation_issue_codes,
    source_file: row.source_file,
    source_object_keys: row.source_object_keys,
    source_preview_keys: row.source_preview_keys,
    source_quote: row.source_quote,
    confidence: row.confidence,
  });
  if (inserted.error) databaseError("대행사 패키지 staging 적재", inserted.error);
  return agencyId;
}

async function insertPriceOptions(
  client: SupabaseClient,
  officialPriceId: string,
  row: StagingOfficialPrice,
): Promise<void> {
  const existing = await client.from("official_price_options")
    .select("name,price_min_krw,price_max_krw,unit,condition,raw_text,source_file,source_quote,source_object_keys,confidence")
    .eq("official_price_id", officialPriceId);
  if (existing.error) databaseError("공시 옵션 중복 확인", existing.error);
  const existingByIdentity = new Map<string, Record<string, unknown>>();
  for (const option of Array.isArray(existing.data) ? existing.data.filter(isRecord) : []) {
    const identity = `${option.name ?? ""}\0${option.unit ?? ""}\0${option.condition ?? ""}`;
    if (existingByIdentity.has(identity)) {
      throw new Error("duplicate stored option identity; automatic continuation is blocked");
    }
    existingByIdentity.set(identity, option);
  }
  for (const option of row.options) {
    const identity = `${option.name}\0${option.unit ?? ""}\0${option.condition ?? ""}`;
    const stored = existingByIdentity.get(identity);
    if (stored) {
      const same = stored.price_min_krw === option.price_min_krw
        && stored.price_max_krw === option.price_max_krw
        && stored.raw_text === option.raw_text
        && stored.source_file === option.source_file
        && stored.source_quote === option.source_quote
        && JSON.stringify(stored.source_object_keys) === JSON.stringify(option.source_object_keys)
        && stored.confidence === row.confidence;
      if (!same) {
        throw new Error("official price option identity already exists with different staged values; automatic overwrite is blocked");
      }
      continue;
    }
    const inserted = await client.from("official_price_options").insert({
      official_price_id: officialPriceId,
      name: option.name,
      price_min_krw: option.price_min_krw,
      price_max_krw: option.price_max_krw,
      unit: option.unit,
      condition: option.condition,
      raw_text: option.raw_text,
      source_file: option.source_file,
      source_object_keys: option.source_object_keys,
      source_quote: option.source_quote,
      confidence: row.confidence,
    });
    if (inserted.error) databaseError("공시 옵션 staging 적재", inserted.error);
  }
}

function stagedPriceParentMatches(
  stored: Record<string, unknown>,
  vendorId: string,
  agencyId: string | null,
  row: StagingOfficialPrice,
): boolean {
  const storedContentFingerprint = buildOfficialPriceContentFingerprint({
    vendor_id: stored.vendor_id,
    agency_id: stored.agency_id,
    category: stored.category,
    item_name: stored.item_name,
    base_spec: stored.base_spec,
    price_min_krw: stored.price_min_krw,
    price_max_krw: stored.price_max_krw,
    vat_note: stored.vat_note,
    price_note: stored.price_note,
    validation_issue_codes: stored.validation_issue_codes,
    source_file: stored.source_file,
    source_object_keys: stored.source_object_keys,
    source_preview_keys: stored.source_preview_keys,
    source_quote: stored.source_quote,
    confidence: stored.confidence,
  });
  const stagedContentFingerprint = buildOfficialPriceContentFingerprint({
    vendor_id: vendorId,
    agency_id: agencyId,
    category: row.category,
    item_name: row.item_name,
    base_spec: row.base_spec,
    price_min_krw: row.price_min_krw,
    price_max_krw: row.price_max_krw,
    vat_note: row.vat_note,
    price_note: row.price_note,
    validation_issue_codes: row.validation_issue_codes,
    source_file: row.source_file,
    source_object_keys: row.source_object_keys,
    source_preview_keys: row.source_preview_keys,
    source_quote: row.source_quote,
    confidence: row.confidence,
  });
  return stored.source_record_key === row.source_record_key
    && storedContentFingerprint === stagedContentFingerprint;
}

function optionIdentity(option: { name?: unknown; unit?: unknown; condition?: unknown }): string {
  return `${option.name ?? ""}\0${option.unit ?? ""}\0${option.condition ?? ""}`;
}

function stagedOptionMatches(
  stored: Record<string, unknown>,
  option: StagingOfficialPrice["options"][number],
  row: StagingOfficialPrice,
): boolean {
  return stored.name === option.name
    && stored.price_min_krw === option.price_min_krw
    && stored.price_max_krw === option.price_max_krw
    && stored.unit === option.unit
    && stored.condition === option.condition
    && stored.raw_text === option.raw_text
    && stored.source_file === option.source_file
    && stored.source_quote === option.source_quote
    && JSON.stringify(stored.source_object_keys) === JSON.stringify(option.source_object_keys)
    && stored.confidence === row.confidence;
}

export async function reconcileExistingOfficialPrice(
  client: SupabaseClient,
  storedPrice: Record<string, unknown>,
  vendorId: string,
  row: StagingOfficialPrice,
  agencyId: string | null = null,
): Promise<void> {
  if (!stagedPriceParentMatches(storedPrice, vendorId, agencyId, row)) {
    throw new Error("existing official price immutable staged content mismatch");
  }

  const existing = await client.from("official_price_options")
    .select("name,price_min_krw,price_max_krw,unit,condition,raw_text,source_file,source_quote,source_object_keys,confidence")
    .eq("official_price_id", idFrom(storedPrice, "공시 가격 중복 확인"));
  if (existing.error) databaseError("공시 옵션 중복 확인", existing.error);
  const existingByIdentity = new Map<string, Record<string, unknown>>();
  for (const option of Array.isArray(existing.data) ? existing.data.filter(isRecord) : []) {
    const identity = optionIdentity(option);
    if (existingByIdentity.has(identity)) {
      throw new Error("duplicate stored option identity; automatic continuation is blocked");
    }
    existingByIdentity.set(identity, option);
  }

  const expectedIdentities = new Set<string>();
  for (const option of row.options) {
    const identity = optionIdentity(option);
    if (expectedIdentities.has(identity)) {
      throw new Error("duplicate staged option identity; automatic continuation is blocked");
    }
    expectedIdentities.add(identity);
    const stored = existingByIdentity.get(identity);
    if (stored && !stagedOptionMatches(stored, option, row)) {
      throw new Error("existing official price option immutable staged content mismatch");
    }
  }
  if ([...existingByIdentity.keys()].some((identity) => !expectedIdentities.has(identity))) {
    throw new Error("existing official price option set differs from immutable staged content");
  }

  const pendingUnedited = storedPrice.review_status === "pending"
    && storedPrice.edited_by_admin === false;
  const missingOptions = row.options.filter((option) =>
    !existingByIdentity.has(optionIdentity(option))
  );
  if (!pendingUnedited) {
    if (missingOptions.length > 0) {
      throw new Error("reviewed or edited official price option set is immutable and differs from staged content");
    }
    return;
  }
  if (storedPrice.needs_review !== row.needs_review) {
    throw new Error("pending official price review state differs from staged content");
  }

  for (const option of missingOptions) {
    const inserted = await client.from("official_price_options").insert({
      official_price_id: idFrom(storedPrice, "공시 가격 중복 확인"),
      name: option.name,
      price_min_krw: option.price_min_krw,
      price_max_krw: option.price_max_krw,
      unit: option.unit,
      condition: option.condition,
      raw_text: option.raw_text,
      source_file: option.source_file,
      source_object_keys: option.source_object_keys,
      source_quote: option.source_quote,
      confidence: row.confidence,
    });
    if (inserted.error) databaseError("공시 옵션 staging 복구", inserted.error);
  }
}

async function insertOfficialPrice(
  client: SupabaseClient,
  snapshotId: string,
  row: StagingOfficialPrice,
): Promise<{ vendorId: string; agencyId: string | null; officialPriceId: string }> {
  const vendorId = await ensureVendor(client, row);
  const agencyId = row.source_agency
    ? await ensureAgency(client, {
      agency_name: row.source_agency.name,
      agency_normalized_name: row.source_agency.normalized_name,
      agency_corporate_name: row.source_agency.corporate_name,
      region_code: row.source_agency.region_code,
      source_file: row.source_agency.source_file,
    })
    : null;
  const existing = await client.from("official_prices")
    .select("id,vendor_id,agency_id,category,item_name,base_spec,price_min_krw,price_max_krw,vat_note,price_note,review_status,needs_review,validation_issue_codes,source_file,source_object_keys,source_preview_keys,source_quote,confidence,source_record_key,edited_by_admin")
    .eq("snapshot_id", snapshotId)
    .eq("source_record_key", row.source_record_key)
    .maybeSingle();
  if (existing.error) databaseError("공시 가격 중복 확인", existing.error);
  if (existing.data) {
    if (!isRecord(existing.data)) {
      throw new Error("같은 source_record_key의 기존 가격 행 형식을 확인할 수 없습니다.");
    }
    await reconcileExistingOfficialPrice(client, existing.data, vendorId, row, agencyId);
    await stageVendorAliasProposals(
      client,
      idFrom(existing.data, "공시 가격 중복 확인"),
      vendorId,
      row.alias_proposals,
    );
    return {
      vendorId,
      agencyId,
      officialPriceId: idFrom(existing.data, "공시 가격 중복 확인"),
    };
  }

  const inserted = await client.from("official_prices").insert({
    snapshot_id: snapshotId,
    vendor_id: vendorId,
    agency_id: agencyId,
    category: row.category,
    item_name: row.item_name,
    base_spec: row.base_spec,
    price_min_krw: row.price_min_krw,
    price_max_krw: row.price_max_krw,
    vat_note: row.vat_note,
    price_note: row.price_note,
    review_status: "pending",
    needs_review: row.needs_review,
    validation_issue_codes: row.validation_issue_codes,
    source_file: row.source_file,
    source_object_keys: row.source_object_keys,
    source_preview_keys: row.source_preview_keys,
    source_quote: row.source_quote,
    confidence: row.confidence,
    source_record_key: row.source_record_key,
    edited_by_admin: false,
  }).select("id").single();
  if (inserted.error) databaseError("공시 가격 staging 적재", inserted.error);
  const officialPriceId = idFrom(inserted.data, "공시 가격 staging 적재");
  await insertPriceOptions(client, officialPriceId, row);
  await stageVendorAliasProposals(client, officialPriceId, vendorId, row.alias_proposals);
  return { vendorId, agencyId, officialPriceId };
}

export function canonicalVendorPair(leftVendorId: string, rightVendorId: string): [string, string] {
  return leftVendorId.localeCompare(rightVendorId, "en") <= 0
    ? [leftVendorId, rightVendorId]
    : [rightVendorId, leftVendorId];
}

export function resolveStagedVendorDedupePair(
  candidate: StagingDedupeCandidate,
  unitVendorIds: Map<string, string>,
  partnerVendorIds: Map<string, string>,
): [string, string] | null {
  if (candidate.entity_kind !== "vendor") return null;
  const hasLeftRef = candidate.left_record_ref !== undefined;
  const hasRightRef = candidate.right_record_ref !== undefined;
  if (hasLeftRef !== hasRightRef) throw new Error("vendor dedupe candidate row refs must be provided as a pair");
  const left = hasLeftRef
    ? partnerVendorIds.get(candidate.left_record_ref as string)
    : unitVendorIds.get(candidate.left_unit_id);
  const right = hasRightRef
    ? partnerVendorIds.get(candidate.right_record_ref as string)
    : unitVendorIds.get(candidate.right_unit_id);
  if (hasLeftRef && (!left || !right)) {
    throw new Error("vendor dedupe candidate could not resolve its persisted partner row refs");
  }
  if (!left || !right || left === right) return null;
  return canonicalVendorPair(left, right);
}

async function persistDedupeCandidate(
  client: SupabaseClient,
  candidate: StagingDedupeCandidate,
  unitVendorIds: Map<string, string>,
  partnerVendorIds: Map<string, string>,
): Promise<void> {
  const pair = resolveStagedVendorDedupePair(candidate, unitVendorIds, partnerVendorIds);
  if (!pair) return;
  const [leftVendorId, rightVendorId] = pair;
  const { error } = await client.from("vendor_dedupe_candidates").upsert({
    left_vendor_id: leftVendorId,
    right_vendor_id: rightVendorId,
    reason: candidate.reason,
    similarity: Math.max(0, Math.min(1, candidate.similarity)),
    status: "pending",
  }, { onConflict: "left_vendor_id,right_vendor_id", ignoreDuplicates: true });
  if (error) databaseError("업체 중복 후보 staging 적재", error);
}

async function persistAgencyDedupeCandidate(
  client: SupabaseClient,
  candidate: StagingDedupeCandidate,
  unitAgencyIds: Map<string, string>,
): Promise<void> {
  if (candidate.entity_kind !== "agency") return;
  const left = unitAgencyIds.get(candidate.left_unit_id);
  const right = unitAgencyIds.get(candidate.right_unit_id);
  if (!left || !right || left === right) return;
  const [leftAgencyId, rightAgencyId] = canonicalVendorPair(left, right);
  const { error } = await client.from("agency_dedupe_candidates").upsert({
    left_agency_id: leftAgencyId,
    right_agency_id: rightAgencyId,
    reason: candidate.reason,
    similarity: Math.max(0, Math.min(1, candidate.similarity)),
    status: "pending",
  }, { onConflict: "left_agency_id,right_agency_id", ignoreDuplicates: true });
  if (error) databaseError("대행사 중복 후보 staging 적재", error);
}

export function assertPlanSourceObjectKeys(plan: StagingLoadPlan): void {
  const rawKeyPattern = /^[a-f0-9]{64}\.(?:xlsx|docx|hwp|pdf|png)$/u;
  const rawExtensions = new Set(["xlsx", "docx", "hwp", "pdf", "png"]);
  const referencedRawKeys = new Set(plan.units.flatMap((unit) => unit.source_object_keys));
  const rawIdentities = new Set<string>();
  for (const raw of plan.raw_objects) {
    if (
      !/^[a-f0-9]{64}$/u.test(raw.sha256)
      || !rawExtensions.has(raw.ext)
      || !rawKeyPattern.test(raw.storage_path)
      || raw.storage_path !== `${raw.sha256}.${raw.ext}`
      || !Number.isSafeInteger(raw.bytes)
      || raw.bytes < 0
      || raw.bytes > 50 * 1024 * 1024
    ) {
      throw new Error("raw object metadata must be bounded and content-addressed before external I/O");
    }
    if (rawIdentities.has(raw.storage_path)) {
      throw new Error("raw object upload plan contains a duplicate object identity");
    }
    rawIdentities.add(raw.storage_path);
    if (!referencedRawKeys.has(raw.storage_path)) {
      throw new Error("raw object upload plan contains an unreferenced object");
    }
  }
  const available = new Set(plan.raw_objects.map((raw) => raw.storage_path));
  const availablePreviews = new Set(plan.preview_objects.map((preview) => preview.storage_path));
  const previewMappings = new Set(plan.preview_objects.map((preview) =>
    `${preview.storage_path}\0${preview.source_object_key}`
  ));
  const unitRecords = new Map(plan.units.map((unit) => [unit.unit_id, unit.source_records]));
  const keyPattern = /^[a-f0-9]{64}\.(?:xlsx|docx|hwp|pdf|png)$/;
  const previewKeyPattern = /^[a-f0-9]{64}\.txt$/;
  const referencedPreviewKeys = new Set(plan.units.flatMap((unit) => unit.source_preview_keys));
  canonicalPreviewTransportMetadata(plan.preview_objects);
  const locallyBackedPreviewKeys = new Set(plan.preview_objects
    .filter((preview) => available.has(preview.source_object_key))
    .map((preview) => preview.storage_path));
  for (const preview of plan.preview_objects) {
    if (!keyPattern.test(preview.source_object_key)) {
      throw new Error("preview provenance contains an invalid immutable raw object key");
    }
    if (!referencedPreviewKeys.has(preview.storage_path)) {
      throw new Error("preview object upload plan contains an unreferenced object");
    }
    if (
      !available.has(preview.source_object_key)
      && !locallyBackedPreviewKeys.has(preview.storage_path)
    ) {
      throw new Error(
        "a foreign preview occurrence requires an identical locally backed transport in the same batch",
      );
    }
  }
  for (const unit of plan.units) {
    const missingOwnPreviewMapping = unit.source_preview_keys.find((previewKey) =>
      !unit.source_object_keys.some((sourceObjectKey) =>
        previewMappings.has(`${previewKey}\0${sourceObjectKey}`)
      )
    );
    if (
      unit.source_object_keys.length === 0
      || new Set(unit.source_object_keys).size !== unit.source_object_keys.length
      || unit.source_object_keys.some((key) => !keyPattern.test(key) || !available.has(key))
      || new Set(unit.source_preview_keys).size !== unit.source_preview_keys.length
      || unit.source_preview_keys.some((key) => !previewKeyPattern.test(key) || !availablePreviews.has(key))
      || missingOwnPreviewMapping !== undefined
    ) {
      const detail = missingOwnPreviewMapping === undefined
        ? "raw or preview object set is invalid"
        : `preview ${missingOwnPreviewMapping} has no occurrence mapped to this unit's own raw source`;
      throw new Error(
        `each staging unit must reference an exact, unique set of planned raw and preview objects: ${unit.unit_id} (${detail})`,
      );
    }
  }
  const priceRows = [...plan.agency_packages, ...plan.official_prices];
  const rowProvenance = priceRows.flatMap((row) => [
    { unit_id: row.unit_id, source_file: row.source_file, source_file_ids: null, source_object_keys: row.source_object_keys, source_preview_keys: row.source_preview_keys, requires_preview: true },
    ...row.options.map((option) => ({
      unit_id: row.unit_id,
      source_file: option.source_file,
      source_file_ids: option.source_file_ids,
      source_object_keys: option.source_object_keys,
      source_preview_keys: [] as string[],
      requires_preview: false,
    })),
  ]).concat(plan.disclosure_semantics.map((row) => ({
    unit_id: row.unit_id,
    source_file: row.source_file,
    source_file_ids: row.source_file_ids,
    source_object_keys: row.source_object_keys,
    source_preview_keys: row.source_preview_keys,
    requires_preview: true,
  })));
  for (const row of rowProvenance) {
    const records = unitRecords.get(row.unit_id);
    const selected = records?.filter((record) => row.source_object_keys.includes(record.source_object_key)) ?? [];
    let sourceLabels: string[] = [];
    try {
      const parsed = JSON.parse(row.source_file);
      sourceLabels = Array.isArray(parsed) && parsed.every((value) => typeof value === "string")
        ? parsed
        : [row.source_file];
    } catch {
      sourceLabels = [row.source_file];
    }
    const previewRecords = selected.filter((record) => record.source_preview_key !== null);
    const expectedPreviews = previewRecords.map((record) => record.source_preview_key as string);
    if (
      row.source_object_keys.length === 0
      || row.source_object_keys.some((key) => !keyPattern.test(key) || !available.has(key))
      || !records
      || selected.length !== row.source_object_keys.length
      || selected.some((record, index) => record.source_object_key !== row.source_object_keys[index])
      || (row.source_file_ids !== null && (
        row.source_file_ids.length !== selected.length
        || selected.some((record, index) => record.source_file_id !== row.source_file_ids?.[index])
      ))
      || selected.some((record, index) => record.source_file !== sourceLabels[index])
      || sourceLabels.length !== selected.length
    ) {
      throw new Error("staging row provenance must preserve a canonical source subset backed by the upload plan");
    }
    if (row.requires_preview && (
      row.source_preview_keys.length > 16
      || row.source_preview_keys.some((key) => !previewKeyPattern.test(key) || !availablePreviews.has(key))
      || expectedPreviews.length !== row.source_preview_keys.length
      || expectedPreviews.some((key, index) => key !== row.source_preview_keys[index])
      || row.source_preview_keys.some((key, index) =>
        !previewMappings.has(`${key}\0${previewRecords[index]?.source_object_key ?? ""}`)
      )
    )) {
      throw new Error("staging source_preview_keys must preserve canonical preview order and be backed by the private upload plan");
    }
  }
  const rowUnitIds = new Set([
    ...priceRows.map((row) => row.unit_id),
    ...plan.disclosure_semantics.map((row) => row.unit_id),
  ]);
  if (plan.units.some((unit) => !rowUnitIds.has(unit.unit_id))) {
    throw new Error("a unit without a staging price/package/semantic row cannot be marked loaded");
  }
}

export function createSupabaseStagingWriter(environment: StagingEnvironment): StagingWriter {
  assertStagingEnvironmentDestination(environment);
  const client = createClient(environment.url, environment.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    stage: async (plan, context): Promise<StagingWriterResult> => {
      if (!context) throw new Error("atomic staging batch context is required; legacy non-atomic writes are forbidden");
      return stageAtomicDisclosureBatch(client, environment, plan, context);
    },
    verifyBatchReceipt: async (context, expectedReceiptSha256): Promise<StagingWriterResult> =>
      verifyAtomicDisclosureBatchReceipt(client, environment, context, expectedReceiptSha256),
    abortRun: async (context): Promise<StagingAbortResult> =>
      abortAtomicDisclosureRun(client, environment, context),
    completeStorageRollback: async (context): Promise<StagingStorageRollbackCompletionResult> =>
      completeAtomicDisclosureStorageRollback(client, environment, context),
    invalidateRun: async (context): Promise<StagingInvalidationResult> =>
      invalidateAtomicDisclosureRun(client, environment, context),
    finalizeDedupe: async (plan, context): Promise<void> => {
      if (context.target_project_ref !== environment.projectRef) {
        throw new Error("dedupe finalizer target does not match the configured staging project");
      }
      await finalizeAtomicDisclosureDedupe(client, plan, context);
    },
  };
}
