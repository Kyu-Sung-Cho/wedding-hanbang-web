import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  readdir,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import {
  canonicalJsonSha256ExcludingField,
  prepareDeterministicStateArtifactWritePath,
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "./artifact-integrity.js";
import {
  assertAiLedgerSnapshotIsExactPrefix,
  AiLedgerSnapshotSchema,
  readAiLedgerState,
  type AiLedgerState,
} from "./ledger.js";
import { sha256Text, syncDirectoryMetadata } from "./io.js";
import {
  ExtractionBatchCheckpointSchema,
  type ExtractionBatchCheckpoint,
} from "./schemas.js";
import { listPendingPaidCallIntents } from "./paid-call-journal.js";

const AUTHORITY_DIRECTORY_NAME = ".wedding-hanbang-paid-execution-v1";
const DOMAIN_FILE_NAME = "domain.json";
const CLAIM_DIRECTORY_NAME = "claims";
const CLAIM_TEMP_DIRECTORY_NAME = "claim-publish-tmp";
const AUTHORITY_ANCHOR_SUFFIX = ".initialized.json";
const STATE_BINDING_RELATIVE_PATH = path.join(
  ".cache",
  "paid-execution-domain-binding.json",
);
const MAX_DOMAIN_BYTES = 64 * 1024;
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const CanonicalPathSchema = z.string().min(1).max(4_096);

export const PaidExecutionDomainBindingSchema = z.object({
  domain_id: z.string().uuid(),
  authority_root_realpath: CanonicalPathSchema,
  authoritative_state_dir_realpath: CanonicalPathSchema,
  genesis_ledger: AiLedgerSnapshotSchema,
}).strict();

const PaidExecutionDomainManifestSchema = PaidExecutionDomainBindingSchema.extend({
  schema_version: z.literal(1),
  kind: z.literal("wedding_hanbang_paid_execution_domain"),
  content_sha256: Sha256Schema,
  created_at: z.string().datetime(),
}).strict();

const PaidExecutionDomainAnchorSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("wedding_hanbang_paid_execution_domain_anchor"),
  content_sha256: Sha256Schema,
  domain_id: z.string().uuid(),
  authority_root_realpath: CanonicalPathSchema,
  domain_manifest_sha256: Sha256Schema,
}).strict();

const PaidExecutionDomainStateBindingSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("wedding_hanbang_paid_execution_domain_state_binding"),
  content_sha256: Sha256Schema,
  domain_manifest_sha256: Sha256Schema,
  binding: PaidExecutionDomainBindingSchema,
}).strict();

export const PaidExecutionClaimSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("wedding_hanbang_paid_provider_attempt_claim"),
  content_sha256: Sha256Schema,
  claim_id: Sha256Schema,
  domain_id: z.string().uuid(),
  authoritative_state_dir_realpath: CanonicalPathSchema,
  paid_plan_sha256: Sha256Schema,
  run_id: z.string().uuid(),
  unit_id: Sha256Schema,
  extraction_fingerprint: Sha256Schema,
  batch_index: z.number().int().nonnegative(),
  attempt: z.number().int().positive().max(4),
  request_hash: Sha256Schema,
  model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
  reserved_cost_usd: z.number().finite().nonnegative(),
  created_at: z.string().datetime(),
}).strict();

export type PaidExecutionDomainBinding = z.infer<typeof PaidExecutionDomainBindingSchema>;
export type PaidExecutionClaim = z.infer<typeof PaidExecutionClaimSchema>;
type PaidExecutionDomainManifest = z.infer<typeof PaidExecutionDomainManifestSchema>;

export interface ClaimPaidExecutionAttemptInput {
  runId: string;
  unitId: string;
  extractionFingerprint: string;
  batchIndex: number;
  attempt: number;
  requestHash: string;
  paidPlanSha256: string;
  model: PaidExecutionClaim["model"];
  reservedCostUsd: number;
  createdAt?: string;
}

export interface PaidExecutionDomainLocationOptions {
  /** Test-only seam. Production callers must omit this deterministic override. */
  authorityRoot?: string;
}

export interface PaidExecutionDomainContext {
  binding: PaidExecutionDomainBinding;
  current_ledger: AiLedgerState["snapshot"];
  claim_count: number;
  pending_claim_count: number;
  pending_reserved_cost_usd: number;
  cumulative_committed_cost_usd: number;
  local_authority_only: true;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    ? error.code
    : undefined;
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function authorityRoot(options: PaidExecutionDomainLocationOptions): string {
  return path.resolve(
    options.authorityRoot ?? path.join(os.homedir(), AUTHORITY_DIRECTORY_NAME),
  );
}

function authorityAnchorPath(root: string): string {
  return `${root}${AUTHORITY_ANCHOR_SUFFIX}`;
}

async function canonicalStateDirectory(stateDir: string): Promise<string> {
  const resolved = path.resolve(stateDir);
  const state = await lstat(resolved);
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw new Error("paid_execution_authoritative_state_directory_invalid");
  }
  return realpath(resolved);
}

async function assertOrdinaryDirectory(
  directoryPath: string,
  code: string,
): Promise<string> {
  const state = await lstat(directoryPath);
  if (state.isSymbolicLink() || !state.isDirectory()) throw new Error(code);
  const canonical = await realpath(directoryPath);
  if (!samePath(canonical, directoryPath)) throw new Error(code);
  return canonical;
}

async function createAuthorityRootExclusively(root: string): Promise<boolean> {
  const parent = path.dirname(root);
  await assertOrdinaryDirectory(parent, "paid_execution_domain_parent_invalid");
  try {
    await mkdir(root, { mode: 0o700 });
    await syncDirectoryMetadata(parent);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

async function publishJsonExclusively(
  filePath: string,
  value: unknown,
  temporaryDirectory = path.dirname(filePath),
): Promise<void> {
  const temporaryPath = path.join(
    temporaryDirectory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, filePath);
    await syncDirectoryMetadata(path.dirname(filePath));
  } finally {
    try {
      await unlink(temporaryPath);
      await syncDirectoryMetadata(temporaryDirectory);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
}

async function readVerifiedJsonFile(
  filePath: string,
  missingCode: string,
): Promise<Record<string, unknown>> {
  const fileState = await lstat(filePath).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") throw new Error(missingCode);
    throw error;
  });
  if (fileState.isSymbolicLink() || !fileState.isFile()) {
    throw new Error("paid_execution_domain_control_file_not_regular");
  }
  const fileRealPath = await realpath(filePath);
  if (!samePath(fileRealPath, filePath)) {
    throw new Error("paid_execution_domain_control_file_reparse_point");
  }
  const bytes = await readFile(fileRealPath);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOMAIN_BYTES) {
    throw new Error("paid_execution_domain_control_file_truncated_or_oversized");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("paid_execution_domain_control_file_invalid_json");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("paid_execution_domain_control_file_schema_invalid");
  }
  verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
  return raw as Record<string, unknown>;
}

function bindingFromManifest(manifest: PaidExecutionDomainManifest): PaidExecutionDomainBinding {
  return PaidExecutionDomainBindingSchema.parse({
    domain_id: manifest.domain_id,
    authority_root_realpath: manifest.authority_root_realpath,
    authoritative_state_dir_realpath: manifest.authoritative_state_dir_realpath,
    genesis_ledger: manifest.genesis_ledger,
  });
}

async function initializeAuthority(
  root: string,
  stateRealPath: string,
  ledgerState: AiLedgerState,
): Promise<PaidExecutionDomainManifest> {
  const canonicalRoot = await assertOrdinaryDirectory(root, "paid_execution_domain_root_invalid");
  const claimsDirectory = path.join(canonicalRoot, CLAIM_DIRECTORY_NAME);
  const claimTempDirectory = path.join(canonicalRoot, CLAIM_TEMP_DIRECTORY_NAME);
  try {
    await mkdir(claimsDirectory, { mode: 0o700 });
    await mkdir(claimTempDirectory, { mode: 0o700 });
    await syncDirectoryMetadata(canonicalRoot);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    throw new Error("paid_execution_domain_partial_initialization");
  }
  const candidate = {
    schema_version: 1 as const,
    kind: "wedding_hanbang_paid_execution_domain" as const,
    content_sha256: "0".repeat(64),
    domain_id: randomUUID(),
    authority_root_realpath: canonicalRoot,
    authoritative_state_dir_realpath: stateRealPath,
    genesis_ledger: ledgerState.snapshot,
    created_at: new Date().toISOString(),
  };
  candidate.content_sha256 = canonicalJsonSha256ExcludingField(candidate, "content_sha256");
  const manifest = PaidExecutionDomainManifestSchema.parse(candidate);
  await publishJsonExclusively(path.join(canonicalRoot, DOMAIN_FILE_NAME), manifest);
  const anchorCandidate = {
    schema_version: 1 as const,
    kind: "wedding_hanbang_paid_execution_domain_anchor" as const,
    content_sha256: "0".repeat(64),
    domain_id: manifest.domain_id,
    authority_root_realpath: canonicalRoot,
    domain_manifest_sha256: manifest.content_sha256,
  };
  anchorCandidate.content_sha256 = canonicalJsonSha256ExcludingField(
    anchorCandidate,
    "content_sha256",
  );
  const anchor = PaidExecutionDomainAnchorSchema.parse(anchorCandidate);
  await publishJsonExclusively(authorityAnchorPath(root), anchor);
  return manifest;
}

async function readExistingAuthority(root: string): Promise<PaidExecutionDomainManifest> {
  const canonicalRoot = await assertOrdinaryDirectory(root, "paid_execution_domain_root_invalid");
  await assertOrdinaryDirectory(
    path.join(canonicalRoot, CLAIM_DIRECTORY_NAME),
    "paid_execution_domain_claim_store_missing_or_invalid",
  );
  await assertOrdinaryDirectory(
    path.join(canonicalRoot, CLAIM_TEMP_DIRECTORY_NAME),
    "paid_execution_domain_claim_temp_store_missing_or_invalid",
  );
  const manifest = PaidExecutionDomainManifestSchema.parse(await readVerifiedJsonFile(
    path.join(canonicalRoot, DOMAIN_FILE_NAME),
    "paid_execution_domain_manifest_missing",
  ));
  if (!samePath(manifest.authority_root_realpath, canonicalRoot)) {
    throw new Error("paid_execution_domain_authority_root_mismatch");
  }
  const anchor = PaidExecutionDomainAnchorSchema.parse(await readVerifiedJsonFile(
    authorityAnchorPath(root),
    "paid_execution_domain_anchor_missing_deleted_or_partial",
  ));
  if (
    anchor.domain_id !== manifest.domain_id
    || !samePath(anchor.authority_root_realpath, canonicalRoot)
    || anchor.domain_manifest_sha256 !== manifest.content_sha256
  ) {
    throw new Error("paid_execution_domain_anchor_mismatch");
  }
  return manifest;
}

async function readStateBinding(
  stateRealPath: string,
  allowMissing: boolean,
): Promise<z.infer<typeof PaidExecutionDomainStateBindingSchema> | null> {
  const bindingPath = path.join(stateRealPath, STATE_BINDING_RELATIVE_PATH);
  let verifiedPath: string;
  try {
    verifiedPath = await verifyDeterministicStateArtifactPath({
      stateDir: stateRealPath,
      artifactPath: bindingPath,
      expectedRelativePath: STATE_BINDING_RELATIVE_PATH,
    });
  } catch (error) {
    if (allowMissing && errorCode(error) === "ENOENT") return null;
    if (errorCode(error) === "ENOENT") {
      throw new Error("paid_execution_domain_state_binding_missing_manual_reconciliation");
    }
    throw error;
  }
  return PaidExecutionDomainStateBindingSchema.parse(await readVerifiedJsonFile(
    verifiedPath,
    "paid_execution_domain_state_binding_missing_manual_reconciliation",
  ));
}

async function writeStateBinding(
  stateRealPath: string,
  manifest: PaidExecutionDomainManifest,
): Promise<void> {
  const bindingPath = path.join(stateRealPath, STATE_BINDING_RELATIVE_PATH);
  await prepareDeterministicStateArtifactWritePath({
    stateDir: stateRealPath,
    artifactPath: bindingPath,
    expectedRelativePath: STATE_BINDING_RELATIVE_PATH,
  });
  const candidate = {
    schema_version: 1 as const,
    kind: "wedding_hanbang_paid_execution_domain_state_binding" as const,
    content_sha256: "0".repeat(64),
    domain_manifest_sha256: manifest.content_sha256,
    binding: bindingFromManifest(manifest),
  };
  candidate.content_sha256 = canonicalJsonSha256ExcludingField(candidate, "content_sha256");
  await publishJsonExclusively(
    bindingPath,
    PaidExecutionDomainStateBindingSchema.parse(candidate),
  );
}

async function existingAuthorityOrMissing(root: string): Promise<PaidExecutionDomainManifest> {
  try {
    return await readExistingAuthority(root);
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw new Error("paid_execution_domain_missing");
    throw error;
  }
}

function paidAttemptClaimId(input: ClaimPaidExecutionAttemptInput): string {
  const identity = {
    paid_plan_sha256: input.paidPlanSha256,
    request_hash: input.requestHash,
    unit_id: input.unitId,
    extraction_fingerprint: input.extractionFingerprint,
    batch_index: input.batchIndex,
    attempt: input.attempt,
  };
  return canonicalJsonSha256ExcludingField(
    { ...identity, ignored_hash_field: "0".repeat(64) },
    "ignored_hash_field",
  );
}

async function readClaims(
  manifest: PaidExecutionDomainManifest,
): Promise<PaidExecutionClaim[]> {
  const claimsDirectory = path.join(manifest.authority_root_realpath, CLAIM_DIRECTORY_NAME);
  await assertOrdinaryDirectory(
    claimsDirectory,
    "paid_execution_domain_claim_store_missing_or_invalid",
  );
  const names = await readdir(claimsDirectory);
  const claims: PaidExecutionClaim[] = [];
  for (const name of names.sort((left, right) => left.localeCompare(right, "en"))) {
    const match = /^([a-f0-9]{64})\.json$/u.exec(name);
    if (!match) throw new Error(`paid_execution_claim_store_unknown_entry:${name}`);
    const claim = PaidExecutionClaimSchema.parse(await readVerifiedJsonFile(
      path.join(claimsDirectory, name),
      `paid_execution_claim_missing:${match[1]}`,
    ));
    if (
      claim.claim_id !== match[1]
      || claim.domain_id !== manifest.domain_id
      || !samePath(
        claim.authoritative_state_dir_realpath,
        manifest.authoritative_state_dir_realpath,
      )
      || claim.claim_id !== paidAttemptClaimId({
        runId: claim.run_id,
        unitId: claim.unit_id,
        extractionFingerprint: claim.extraction_fingerprint,
        batchIndex: claim.batch_index,
        attempt: claim.attempt,
        requestHash: claim.request_hash,
        paidPlanSha256: claim.paid_plan_sha256,
        model: claim.model,
        reservedCostUsd: claim.reserved_cost_usd,
        createdAt: claim.created_at,
      })
    ) {
      throw new Error("paid_execution_claim_identity_mismatch");
    }
    claims.push(claim);
  }
  return claims;
}

function ledgerRowMatchesClaim(
  entry: AiLedgerState["entries"][number],
  claim: PaidExecutionClaim,
): boolean {
  return entry.schema_version === 3
    && entry.provider_mode === "production_paid"
    && entry.paid_plan_sha256 === claim.paid_plan_sha256
    && entry.run_id === claim.run_id
    && entry.unit_id === claim.unit_id
    && entry.fingerprint === claim.extraction_fingerprint
    && entry.batch_index === claim.batch_index
    && entry.attempt === claim.attempt
    && entry.request_hash === claim.request_hash
    && entry.model === claim.model
    && entry.reserved_cost_usd === claim.reserved_cost_usd;
}

function checkpointFingerprint(checkpoint: ExtractionBatchCheckpoint): string {
  return sha256Text(JSON.stringify({
    schema_version: 3,
    provider_mode: checkpoint.provider_mode,
    paid_plan_sha256: checkpoint.paid_plan_sha256,
    unit_id: checkpoint.unit_id,
    batch_index: checkpoint.batch_index,
    prompt_version: checkpoint.prompt_version,
    prompt_hash: checkpoint.prompt_hash,
    processing_version: checkpoint.processing_version,
    scanner_parser_version: checkpoint.scanner_parser_version,
    converter_version: checkpoint.converter_version,
    model: checkpoint.model,
    canonical_identity: checkpoint.canonical_identity,
    artifact_fingerprint: checkpoint.artifact_fingerprint,
    extraction_fingerprint: checkpoint.extraction_fingerprint,
    request_hash: checkpoint.request_hash,
  }));
}

function checkpointResultHash(checkpoint: ExtractionBatchCheckpoint): string {
  return sha256Text(JSON.stringify({
    data: checkpoint.data,
    attempts: checkpoint.attempts,
    input_tokens: checkpoint.input_tokens,
    output_tokens: checkpoint.output_tokens,
    request_id: checkpoint.request_id,
    attempt_request_hashes: checkpoint.attempt_request_hashes,
    successful_request_hash: checkpoint.successful_request_hash,
    success_ledger_id: checkpoint.success_ledger_id,
    successful_input_tokens: checkpoint.successful_input_tokens,
    successful_output_tokens: checkpoint.successful_output_tokens,
  }));
}

function rawCheckpointRelatesToClaim(
  raw: Record<string, unknown>,
  claim: PaidExecutionClaim,
): boolean {
  return raw.paid_plan_sha256 === claim.paid_plan_sha256
    && raw.unit_id === claim.unit_id
    && raw.batch_index === claim.batch_index;
}

async function readPaidBatchCheckpoints(
  stateRealPath: string,
  claims: readonly PaidExecutionClaim[],
  genesisLedgerIds: ReadonlySet<string>,
): Promise<ExtractionBatchCheckpoint[]> {
  const directory = path.join(stateRealPath, ".cache", "extract-batches");
  try {
    await assertOrdinaryDirectory(directory, "paid_execution_checkpoint_directory_invalid");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const checkpoints: ExtractionBatchCheckpoint[] = [];
  for (const name of (await readdir(directory)).sort((left, right) => left.localeCompare(right, "en"))) {
    const match = /^([a-f0-9]{64})\.json$/u.exec(name);
    if (!match) throw new Error(`paid_execution_checkpoint_directory_unknown_entry:${name}`);
    const checkpointPath = path.join(directory, name);
    const verifiedPath = await verifyDeterministicStateArtifactPath({
      stateDir: stateRealPath,
      artifactPath: checkpointPath,
      expectedRelativePath: path.join(".cache", "extract-batches", name),
    });
    const bytes = await readFile(verifiedPath);
    if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024 * 1024) {
      throw new Error("paid_execution_checkpoint_truncated_or_oversized");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("paid_execution_checkpoint_invalid_json");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("paid_execution_checkpoint_schema_invalid");
    }
    const rawRecord = raw as Record<string, unknown>;
    const relevantToClaim = claims.some((claim) => rawCheckpointRelatesToClaim(rawRecord, claim));
    const belongsToGenesis = typeof rawRecord.success_ledger_id === "string"
      && genesisLedgerIds.has(rawRecord.success_ledger_id);
    if (rawRecord.schema_version !== 3) {
      if (relevantToClaim) {
        throw new Error("paid_execution_claim_relevant_checkpoint_is_not_v3");
      }
      // Legacy checkpoints have no production-plan binding and cannot prove a
      // post-genesis claim. They remain immutable historical state but are not
      // part of this authority's completion proof.
      continue;
    }
    if (rawRecord.provider_mode === "test_only" && !relevantToClaim) {
      continue;
    }
    if (belongsToGenesis && !relevantToClaim) {
      continue;
    }
    if (rawRecord.provider_mode !== "production_paid") {
      throw new Error("paid_execution_v3_checkpoint_provider_mode_invalid");
    }
    verifyJsonContentHash(rawRecord, "content_sha256");
    const checkpoint = ExtractionBatchCheckpointSchema.parse(rawRecord);
    if (
      checkpoint.checkpoint_fingerprint !== match[1]
      || checkpointFingerprint(checkpoint) !== checkpoint.checkpoint_fingerprint
      || checkpointResultHash(checkpoint) !== checkpoint.result_hash
      || checkpoint.attempt_request_hashes.length !== checkpoint.attempts
      || checkpoint.attempt_request_hashes[0] !== checkpoint.request_hash
      || checkpoint.attempt_request_hashes[checkpoint.attempts - 1]
        !== checkpoint.successful_request_hash
    ) {
      throw new Error("paid_execution_checkpoint_identity_or_result_mismatch");
    }
    checkpoints.push(checkpoint);
  }
  return checkpoints;
}

function checkpointDurablyCompletesClaim(
  checkpoint: ExtractionBatchCheckpoint,
  claim: PaidExecutionClaim,
  ledgerEntry: AiLedgerState["entries"][number],
): boolean {
  if (
    checkpoint.provider_mode !== "production_paid"
    || checkpoint.paid_plan_sha256 !== claim.paid_plan_sha256
    || checkpoint.unit_id !== claim.unit_id
    || checkpoint.batch_index !== claim.batch_index
    || checkpoint.model !== claim.model
    || checkpoint.extraction_fingerprint !== claim.extraction_fingerprint
    || checkpoint.attempts < claim.attempt
    || checkpoint.attempt_request_hashes[claim.attempt - 1] !== claim.request_hash
  ) return false;
  return ledgerEntry.success
    ? checkpoint.success_ledger_id === ledgerEntry.ledger_id
      && checkpoint.successful_request_hash === claim.request_hash
      && ledgerEntry.attempt === checkpoint.attempts
      && checkpoint.successful_input_tokens === ledgerEntry.input_tokens
      && checkpoint.successful_output_tokens === ledgerEntry.output_tokens
      && checkpoint.request_id === ledgerEntry.request_id
    : checkpoint.attempts > claim.attempt;
}

async function contextFor(
  stateDir: string,
  manifest: PaidExecutionDomainManifest,
  options: { allowPendingClaims?: boolean } = {},
): Promise<PaidExecutionDomainContext> {
  const stateRealPath = await canonicalStateDirectory(stateDir);
  if (!samePath(stateRealPath, manifest.authoritative_state_dir_realpath)) {
    throw new Error("paid_execution_authoritative_state_directory_mismatch");
  }
  const ledgerState = await readAiLedgerState(stateRealPath);
  assertAiLedgerSnapshotIsExactPrefix(manifest.genesis_ledger, ledgerState);
  const stateBinding = await readStateBinding(stateRealPath, false);
  const expectedBinding = bindingFromManifest(manifest);
  if (
    !stateBinding
    || stateBinding.domain_manifest_sha256 !== manifest.content_sha256
    || canonicalJsonSha256ExcludingField(
      { ...stateBinding.binding, content_sha256: "0".repeat(64) },
      "content_sha256",
    ) !== canonicalJsonSha256ExcludingField(
      { ...expectedBinding, content_sha256: "0".repeat(64) },
      "content_sha256",
    )
  ) {
    throw new Error("paid_execution_domain_state_binding_mismatch_manual_reconciliation");
  }
  const claims = await readClaims(manifest);
  const genesisLedgerIds = new Set(
    ledgerState.entries.slice(0, manifest.genesis_ledger.row_count).map((entry) => entry.ledger_id),
  );
  const checkpoints = await readPaidBatchCheckpoints(
    stateRealPath,
    claims,
    genesisLedgerIds,
  );
  const temporaryClaimFiles = await readdir(path.join(
    manifest.authority_root_realpath,
    CLAIM_TEMP_DIRECTORY_NAME,
  ));
  if (temporaryClaimFiles.length > 0) {
    throw new Error("paid_execution_claim_publish_incomplete_manual_reconciliation");
  }
  const ledgerDelta = ledgerState.entries.slice(manifest.genesis_ledger.row_count);
  for (const entry of ledgerDelta) {
    if (entry.schema_version !== 3 || entry.provider_mode !== "production_paid") {
      throw new Error("paid_execution_domain_ledger_delta_not_production_paid");
    }
    const matches = claims.filter((claim) => ledgerRowMatchesClaim(entry, claim));
    if (matches.length !== 1) {
      throw new Error("paid_execution_domain_ledger_row_missing_exact_global_claim");
    }
  }
  const pendingClaims = claims.filter((claim) => {
    const matchingLedgerRows = ledgerDelta.filter((entry) => ledgerRowMatchesClaim(entry, claim));
    if (matchingLedgerRows.length !== 1) return true;
    return !checkpoints.some((checkpoint) => checkpointDurablyCompletesClaim(
      checkpoint,
      claim,
      matchingLedgerRows[0] as AiLedgerState["entries"][number],
    ));
  });
  if (pendingClaims.length > 0 && !options.allowPendingClaims) {
    throw new Error(
      `paid_execution_claim_requires_manual_reconciliation:${pendingClaims.map((claim) => claim.claim_id).join(",")}`,
    );
  }
  return {
    binding: bindingFromManifest(manifest),
    current_ledger: ledgerState.snapshot,
    claim_count: claims.length,
    pending_claim_count: pendingClaims.length,
    pending_reserved_cost_usd: pendingClaims.reduce(
      (sum, claim) => sum + claim.reserved_cost_usd,
      0,
    ),
    cumulative_committed_cost_usd: manifest.genesis_ledger.cumulative_cost_usd + Math.max(
      claims.reduce((sum, claim) => sum + claim.reserved_cost_usd, 0),
      ledgerState.snapshot.cumulative_cost_usd - manifest.genesis_ledger.cumulative_cost_usd,
    ),
    local_authority_only: true,
  };
}

async function claimPaidExecutionAttemptInternal(
  stateDir: string,
  expectedBindingValue: unknown,
  input: ClaimPaidExecutionAttemptInput,
  options: PaidExecutionDomainLocationOptions = {},
): Promise<PaidExecutionClaim> {
  const expectedBinding = PaidExecutionDomainBindingSchema.parse(expectedBindingValue);
  const manifest = await existingAuthorityOrMissing(authorityRoot(options));
  const context = await contextFor(stateDir, manifest, { allowPendingClaims: true });
  assertExecutionDomainBindingMatches(context.binding, expectedBinding);
  if (context.pending_claim_count > 0) {
    const ledgerState = await readAiLedgerState(stateDir);
    const claims = await readClaims(manifest);
    const checkpoints = await readPaidBatchCheckpoints(
      context.binding.authoritative_state_dir_realpath,
      claims,
      new Set(ledgerState.entries.slice(
        0,
        context.binding.genesis_ledger.row_count,
      ).map((entry) => entry.ledger_id)),
    );
    const ledgerDelta = ledgerState.entries.slice(context.binding.genesis_ledger.row_count);
    const localIntents = await listPendingPaidCallIntents(stateDir);
    const unsafePending = claims.filter((claim) => {
      const rows = ledgerDelta.filter((entry) => ledgerRowMatchesClaim(entry, claim));
      if (
        rows.length === 1
        && checkpoints.some((checkpoint) => checkpointDurablyCompletesClaim(
          checkpoint,
          claim,
          rows[0] as AiLedgerState["entries"][number],
        ))
      ) return false;
      const row = rows[0];
      const hasExactLocalIntent = localIntents.some((intent) =>
        intent.run_id === claim.run_id
        && intent.unit_id === claim.unit_id
        && intent.extraction_fingerprint === claim.extraction_fingerprint
        && intent.batch_index === claim.batch_index
        && intent.attempt === claim.attempt
        && intent.request_hash === claim.request_hash
        && intent.paid_plan_sha256 === claim.paid_plan_sha256
      );
      return rows.length !== 1
        || row.success
        || !["rate_limit", "invalid_response"].includes(row.error_category ?? "")
        || !hasExactLocalIntent
        || claim.paid_plan_sha256 !== input.paidPlanSha256
        || claim.run_id !== input.runId
        || claim.unit_id !== input.unitId
        || claim.extraction_fingerprint !== input.extractionFingerprint
        || claim.batch_index !== input.batchIndex
        || claim.attempt >= input.attempt;
    });
    if (unsafePending.length > 0) {
      throw new Error(
        `paid_execution_claim_requires_manual_reconciliation:${unsafePending.map((claim) => claim.claim_id).join(",")}`,
      );
    }
  }
  const existingClaims = await readClaims(await existingAuthorityOrMissing(authorityRoot(options)));
  const crossPlanReplay = existingClaims.find((existing) =>
    existing.paid_plan_sha256 !== input.paidPlanSha256
    && existing.unit_id === input.unitId
    && existing.extraction_fingerprint === input.extractionFingerprint
    && existing.batch_index === input.batchIndex
    && existing.attempt === input.attempt
    && existing.request_hash === input.requestHash
  );
  if (crossPlanReplay) {
    throw new Error(
      `paid_execution_cross_plan_replay_requires_manual_reconciliation:${crossPlanReplay.claim_id}`,
    );
  }
  const claimId = paidAttemptClaimId(input);
  const candidate = {
    schema_version: 1 as const,
    kind: "wedding_hanbang_paid_provider_attempt_claim" as const,
    content_sha256: "0".repeat(64),
    claim_id: claimId,
    domain_id: context.binding.domain_id,
    authoritative_state_dir_realpath: context.binding.authoritative_state_dir_realpath,
    paid_plan_sha256: input.paidPlanSha256,
    run_id: input.runId,
    unit_id: input.unitId,
    extraction_fingerprint: input.extractionFingerprint,
    batch_index: input.batchIndex,
    attempt: input.attempt,
    request_hash: input.requestHash,
    model: input.model,
    reserved_cost_usd: input.reservedCostUsd,
    created_at: input.createdAt ?? new Date().toISOString(),
  };
  candidate.content_sha256 = canonicalJsonSha256ExcludingField(candidate, "content_sha256");
  const claim = PaidExecutionClaimSchema.parse(candidate);
  const claimPath = path.join(
    context.binding.authority_root_realpath,
    CLAIM_DIRECTORY_NAME,
    `${claim.claim_id}.json`,
  );
  try {
    await publishJsonExclusively(
      claimPath,
      claim,
      path.join(context.binding.authority_root_realpath, CLAIM_TEMP_DIRECTORY_NAME),
    );
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    // Validate the incumbent. Whether it is identical or corrupt, a process
    // cannot know if the provider accepted the earlier attempt.
    await readClaims(await existingAuthorityOrMissing(authorityRoot(options)));
    throw new Error(`paid_execution_claim_requires_manual_reconciliation:${claim.claim_id}`);
  }
  const persistedClaims = await readClaims(await existingAuthorityOrMissing(authorityRoot(options)));
  const persisted = persistedClaims.find((item) => item.claim_id === claim.claim_id);
  if (!persisted || persisted.content_sha256 !== claim.content_sha256) {
    throw new Error("paid_execution_claim_changed_during_publication");
  }
  return persisted;
}

async function initializePaidExecutionDomainInternal(
  stateDir: string,
  options: PaidExecutionDomainLocationOptions = {},
): Promise<PaidExecutionDomainContext> {
  const stateRealPath = await canonicalStateDirectory(stateDir);
  const ledgerState = await readAiLedgerState(stateRealPath);
  // Complete every read-only validation that can fail on pre-existing state
  // before creating the external authority. Legacy/test-only/pre-genesis
  // checkpoints are classified here and cannot strand a fresh domain.
  await readPaidBatchCheckpoints(
    stateRealPath,
    [],
    new Set(ledgerState.entries.map((entry) => entry.ledger_id)),
  );
  if (await readStateBinding(stateRealPath, true)) {
    throw new Error(
      "paid_execution_domain_reinitialization_blocked_by_state_binding_manual_reconciliation",
    );
  }
  const root = authorityRoot(options);
  try {
    await lstat(root);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    try {
      await lstat(authorityAnchorPath(root));
      throw new Error("paid_execution_domain_deleted_or_partial");
    } catch (anchorError) {
      if (errorCode(anchorError) !== "ENOENT") throw anchorError;
    }
  }
  const created = await createAuthorityRootExclusively(root);
  if (!created) {
    throw new Error("paid_execution_domain_already_initialized_or_partial");
  }
  const manifest = await initializeAuthority(root, stateRealPath, ledgerState);
  await writeStateBinding(stateRealPath, manifest);
  return contextFor(stateRealPath, manifest);
}

async function loadPaidExecutionDomainForPlanningInternal(
  stateDir: string,
  options: PaidExecutionDomainLocationOptions = {},
): Promise<PaidExecutionDomainContext> {
  const manifest = await existingAuthorityOrMissing(authorityRoot(options));
  return contextFor(stateDir, manifest);
}

async function verifyPaidExecutionDomainForPlanInternal(
  stateDir: string,
  expectedBindingValue: unknown,
  options: PaidExecutionDomainLocationOptions = {},
): Promise<PaidExecutionDomainContext> {
  const expectedBinding = PaidExecutionDomainBindingSchema.parse(expectedBindingValue);
  const manifest = await existingAuthorityOrMissing(authorityRoot(options));
  const context = await contextFor(stateDir, manifest);
  assertExecutionDomainBindingMatches(context.binding, expectedBinding);
  return context;
}

function assertExecutionDomainBindingMatches(
  actual: PaidExecutionDomainBinding,
  expected: PaidExecutionDomainBinding,
): void {
  if (
    canonicalJsonSha256ExcludingField(
      { ...actual, content_sha256: "0".repeat(64) },
      "content_sha256",
    ) !== canonicalJsonSha256ExcludingField(
      { ...expected, content_sha256: "0".repeat(64) },
      "content_sha256",
    )
  ) {
    throw new Error("paid_execution_domain_plan_binding_mismatch");
  }
}

/** Explicit one-time production initialization. Planning never calls this. */
export async function initializePaidExecutionDomain(
  stateDir: string,
): Promise<PaidExecutionDomainContext> {
  return initializePaidExecutionDomainInternal(stateDir);
}

export async function loadPaidExecutionDomainForPlanning(
  stateDir: string,
): Promise<PaidExecutionDomainContext> {
  return loadPaidExecutionDomainForPlanningInternal(stateDir);
}

export async function getPaidExecutionDomainStatus(
  stateDir: string,
): Promise<PaidExecutionDomainContext> {
  const manifest = await existingAuthorityOrMissing(authorityRoot({}));
  return contextFor(stateDir, manifest, { allowPendingClaims: true });
}

export async function verifyPaidExecutionDomainForPlan(
  stateDir: string,
  expectedBindingValue: unknown,
): Promise<PaidExecutionDomainContext> {
  return verifyPaidExecutionDomainForPlanInternal(stateDir, expectedBindingValue);
}

export async function claimPaidExecutionAttempt(
  stateDir: string,
  expectedBindingValue: unknown,
  input: ClaimPaidExecutionAttemptInput,
): Promise<PaidExecutionClaim> {
  return claimPaidExecutionAttemptInternal(stateDir, expectedBindingValue, input);
}

function assertTestOnlyLocationOverride(): void {
  if (!process.env.NODE_TEST_CONTEXT) {
    throw new Error("test_only_paid_execution_domain_override_requires_node_test_runner");
  }
}

export async function initializePaidExecutionDomainForTests(
  stateDir: string,
  options: PaidExecutionDomainLocationOptions,
): Promise<PaidExecutionDomainContext> {
  assertTestOnlyLocationOverride();
  return initializePaidExecutionDomainInternal(stateDir, options);
}

export async function loadPaidExecutionDomainForPlanningForTests(
  stateDir: string,
  options: PaidExecutionDomainLocationOptions,
): Promise<PaidExecutionDomainContext> {
  assertTestOnlyLocationOverride();
  return loadPaidExecutionDomainForPlanningInternal(stateDir, options);
}

export async function verifyPaidExecutionDomainForPlanForTests(
  stateDir: string,
  expectedBindingValue: unknown,
  options: PaidExecutionDomainLocationOptions,
): Promise<PaidExecutionDomainContext> {
  assertTestOnlyLocationOverride();
  return verifyPaidExecutionDomainForPlanInternal(stateDir, expectedBindingValue, options);
}

export async function claimPaidExecutionAttemptForTests(
  stateDir: string,
  expectedBindingValue: unknown,
  input: ClaimPaidExecutionAttemptInput,
  options: PaidExecutionDomainLocationOptions,
): Promise<PaidExecutionClaim> {
  assertTestOnlyLocationOverride();
  return claimPaidExecutionAttemptInternal(stateDir, expectedBindingValue, input, options);
}
