import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rmdir, stat, unlink } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import sharp from "sharp";

import {
  canonicalJsonSha256ExcludingField,
  prepareDeterministicStateArtifactWritePath,
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "./artifact-integrity.js";
import {
  ALLOWED_EXTRACTION_MODELS,
  currentExtractionFingerprint,
  EXTRACTION_PROCESSING_VERSION,
  EXTRACTION_PROMPT_HASH,
  EXTRACTION_RESPONSE_FORMAT,
  type ExtractionModel,
} from "./extraction-contract.js";
import {
  isPathWithin,
  readJsonFile,
  sha256File,
  sha256Text,
  syncDirectoryMetadata,
  writeJsonFile,
} from "./io.js";
import {
  appendAiLedgerEntry,
  assertAiLedgerSnapshotIsExactPrefix,
  createLedgerId,
  estimateExtractionCostUsd,
  readAiLedger,
  readAiLedgerState,
  type AiLedgerEntry,
  type AiLedgerSnapshot,
  type NewAiLedgerEntry,
} from "./ledger.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { decodeEvidenceQuote, encodeMergedEvidenceQuote } from "./merge-evidence.js";
import {
  assertNoOrphanedPaidCallIntents,
  beginPaidCallIntent,
  persistCheckpointThenSettlePaidCallIntents,
  type PaidCallIntent,
} from "./paid-call-journal.js";
import {
  assertFixedEightPaidExtractionPlanApprovalMatches,
  assertPaidExtractionAttemptReservationAuthorized,
  assertPaidExtractionPlannedRequestHashes,
  createFixedEightPaidExtractionPlanApproval,
  MAX_FIXED_EIGHT_APPROVED_COST_USD,
  PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH,
  PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
  PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
  readFixedEightPaidExtractionPlanApproval,
  writeFixedEightPaidExtractionPlanApproval,
  type CreatePaidExtractionPlanApprovalInput,
  type PaidExtractionPlanApproval,
  type PaidExtractionPlanUnitInput,
} from "./paid-extraction-plan.js";
import {
  claimPaidExecutionAttempt,
  claimPaidExecutionAttemptForTests,
  loadPaidExecutionDomainForPlanning,
  loadPaidExecutionDomainForPlanningForTests,
  verifyPaidExecutionDomainForPlan,
  verifyPaidExecutionDomainForPlanForTests,
  type PaidExecutionDomainBinding,
  type PaidExecutionDomainLocationOptions,
  type ClaimPaidExecutionAttemptInput,
} from "./paid-execution-domain.js";
import { FIXED_EIGHT_ORDERED_UNIT_IDS } from "./pilot-pass-receipt.js";
import { costUsdToNanoUsdCeil } from "./paid-extraction-budget.js";
import { EXTRACTION_INSTRUCTIONS, EXTRACTION_PROMPT_VERSION } from "./prompt.js";
import { sourceFileId, sourceFilesForArtifact } from "./provenance.js";
import {
  DisclosureExtractionSchema,
  ExtractionBatchCheckpointSchema,
  StrictExtractionArtifactSchema,
  type ExtractionArtifact,
  type ExtractionBatchCheckpoint,
  type StrictExtractionArtifact,
  type DisclosureExtraction,
} from "./schemas.js";
import type { IngestManifest, ManifestUnit, SourceFile } from "./types.js";
import {
  indexXlsxCellEvidence,
  matchSingleXlsxEvidenceQuote,
  normalizeEvidenceText,
  parseKoreanMoneyAmounts,
  scanSourceMoneyOccurrences,
} from "./validate.js";

const MAX_TEXT_CHARACTERS_PER_REQUEST = 8_000;
const MAX_IMAGES_PER_REQUEST = 5;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_REQUEST_RAW_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_REQUEST_BASE64_CHARACTERS = 50 * 1024 * 1024;
const MAX_REQUESTS_PER_UNIT = 96;
const MAX_OUTPUT_TOKENS = PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP;
const MAX_EXTRACTION_ATTEMPTS = PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH;
const DEFAULT_UNCACHED_PAID_CALL_LIMIT_USD = MAX_FIXED_EIGHT_APPROVED_COST_USD;
const ESTIMATED_IMAGE_INPUT_TOKENS = 4_096;
const MAXIMUM_IMAGE_INPUT_TOKENS = 16_384;
const TARGET_EXTRACTION_PAYLOAD_CHARACTERS = 3_000;
export type { ExtractionModel } from "./extraction-contract.js";

export interface ExtractionSourceReference {
  sourceFileId: string;
  sourcePath: string;
}

export interface ExtractionImageSourceReference {
  artifactId: string;
  sources: ExtractionSourceReference[];
  viewLabel?: string;
}

export interface ExtractionRequest {
  unitId: string;
  model: ExtractionModel;
  canonicalName: string;
  regionCode: string;
  kindHint: "agency" | "hall";
  text: string;
  imagePaths: string[];
  imageSourceRefs: ExtractionImageSourceReference[];
  repair?: ExtractionRepairConstraints;
}

export type ExtractionRepairConstraints = {
  reason: "static_validation_retry";
  allowedXlsxLocators: string[];
  allowedLocatorSetSha256: string;
  allowedSourceFileIds: string[];
  allowedSourceFileSetSha256: string;
} | {
  reason: "xlsx_locator_ownership";
  rejectedLocator: string;
  allowedXlsxLocators: string[];
  allowedLocatorSetSha256: string;
} | {
  reason: "source_file_ownership";
  rejectedSourceFileId: string;
  allowedSourceFileIds: string[];
  allowedSourceFileSetSha256: string;
} | {
  reason: "text_quote_contiguity";
  rejectedPath: string;
} | {
  reason: "structured_numeric_evidence";
  rejectedPath: string;
} | {
  reason: "image_money_evidence_mismatch";
  rejectedOccurrenceIndex: number;
} | {
  reason: "image_non_currency_percentage";
  rejectedOccurrenceIndex: number;
};

export interface ExtractionProviderResult {
  data: DisclosureExtraction;
  inputTokens: number;
  outputTokens: number;
  /** Null means the provider omitted or contradicted its cache breakdown. */
  cachedInputTokens?: number | null;
  /** Null means the provider omitted or contradicted its cache breakdown. */
  cacheWriteInputTokens?: number | null;
  /** False means total input/output usage itself was absent or malformed. */
  usageReported?: boolean;
  requestId?: string;
}

interface NormalizedProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  usageReported: boolean;
}

type ProviderUsageAudit = Partial<NormalizedProviderUsage> & {
  inputTokens: number;
  outputTokens: number;
  requestId?: string;
};

export interface ExtractionProvider {
  extract(request: ExtractionRequest): Promise<ExtractionProviderResult>;
}

/**
 * Declarative, network-free provider script used only to exercise the exact
 * fixed-eight authorization chain under node:test. It intentionally contains
 * no callback or provider object that could perform I/O.
 */
export interface FixedEightScriptedProviderScenarioForTests {
  responsesByCanonicalName: Readonly<Record<string, DisclosureExtraction>>;
  failFirstInvalidResponses?: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
  requestIdPrefix?: string;
}

export interface FixedEightScriptedExtractionResultForTests {
  manifest: IngestManifest;
  providerCalls: number;
  observedRepairs: Array<ExtractionRequest["repair"]>;
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export class ExtractionProviderResponseError extends Error {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number | null;
  readonly cacheWriteInputTokens: number | null;
  readonly usageReported: boolean;
  readonly requestId?: string;
  readonly rejectedLocator?: string;
  readonly allowedLocatorCount?: number;
  readonly allowedLocatorSetSha256?: string;
  readonly locatorViolation?: "not_in_request" | "not_exact_single_cell";
  readonly rejectedOccurrenceIndex?: number;
  readonly imageEvidenceViolation?: "non_currency_percentage" | "amount_quote_mismatch";
  readonly rejectedSourceFileId?: string;
  readonly allowedSourceFileCount?: number;
  readonly allowedSourceFileSetSha256?: string;
  readonly structuredEvidencePath?: string;
  readonly textQuoteEvidencePath?: string;

  constructor(
    message: string,
    audit: ProviderUsageAudit,
    ownershipAudit?: {
      rejectedLocator: string;
      allowedLocatorCount: number;
      allowedLocatorSetSha256: string;
      locatorViolation: "not_in_request" | "not_exact_single_cell";
    },
    imageAudit?: {
      rejectedOccurrenceIndex: number;
      violation?: "non_currency_percentage" | "amount_quote_mismatch";
    },
    sourceOwnershipAudit?: {
      rejectedSourceFileId: string;
      allowedSourceFileCount: number;
      allowedSourceFileSetSha256: string;
    },
    structuredEvidenceAudit?: { rejectedPath: string },
    textEvidenceAudit?: { rejectedPath: string },
  ) {
    super(message);
    this.name = "ExtractionProviderResponseError";
    const usage = normalizeProviderUsage(audit);
    this.inputTokens = usage.inputTokens;
    this.outputTokens = usage.outputTokens;
    this.cachedInputTokens = usage.cachedInputTokens;
    this.cacheWriteInputTokens = usage.cacheWriteInputTokens;
    this.usageReported = usage.usageReported;
    if (audit.requestId?.trim()) this.requestId = audit.requestId.slice(0, 200);
    if (ownershipAudit) {
      this.rejectedLocator = ownershipAudit.rejectedLocator;
      this.allowedLocatorCount = ownershipAudit.allowedLocatorCount;
      this.allowedLocatorSetSha256 = ownershipAudit.allowedLocatorSetSha256;
      this.locatorViolation = ownershipAudit.locatorViolation;
    }
    if (imageAudit && Number.isSafeInteger(imageAudit.rejectedOccurrenceIndex) && imageAudit.rejectedOccurrenceIndex >= 0) {
      this.rejectedOccurrenceIndex = imageAudit.rejectedOccurrenceIndex;
      this.imageEvidenceViolation = imageAudit.violation ?? "non_currency_percentage";
    }
    if (sourceOwnershipAudit) {
      this.rejectedSourceFileId = sourceOwnershipAudit.rejectedSourceFileId;
      this.allowedSourceFileCount = sourceOwnershipAudit.allowedSourceFileCount;
      this.allowedSourceFileSetSha256 = sourceOwnershipAudit.allowedSourceFileSetSha256;
    }
    if (structuredEvidenceAudit?.rejectedPath) {
      this.structuredEvidencePath = structuredEvidenceAudit.rejectedPath.slice(0, 500);
    }
    if (textEvidenceAudit?.rejectedPath) {
      this.textQuoteEvidencePath = textEvidenceAudit.rejectedPath.slice(0, 500);
    }
  }
}

export interface ExtractOptions {
  stateDir: string;
  /** Deprecated name retained for callers; selection is stratified, never sequential. */
  limit?: number;
  unitIds?: string[];
  /** Plan-only safety boundary; actual extraction always requires the approved fixed eight. */
  enforcePilotAuthorization?: boolean;
  /** Content hash emitted by `extract --plan`; required before any production paid call. */
  approvedPlanSha256?: string;
}

export interface ExtractDependencies {
  env?: NodeJS.ProcessEnv;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface ExtractInternalDependencies extends ExtractDependencies {
  provider?: ExtractionProvider;
  paidExecutionDomainAccess?: PaidExecutionDomainAccess;
}

interface PaidExecutionDomainAccess {
  loadForPlanning(stateDir: string): ReturnType<typeof loadPaidExecutionDomainForPlanning>;
  verifyForPlan(
    stateDir: string,
    binding: PaidExecutionDomainBinding,
  ): ReturnType<typeof verifyPaidExecutionDomainForPlan>;
  claimAttempt(
    stateDir: string,
    binding: PaidExecutionDomainBinding,
    input: ClaimPaidExecutionAttemptInput,
  ): ReturnType<typeof claimPaidExecutionAttempt>;
}

const productionPaidExecutionDomainAccess: PaidExecutionDomainAccess = {
  loadForPlanning: (stateDir) => loadPaidExecutionDomainForPlanning(stateDir),
  verifyForPlan: (stateDir, binding) => verifyPaidExecutionDomainForPlan(stateDir, binding),
  claimAttempt: (stateDir, binding, input) => claimPaidExecutionAttempt(
    stateDir,
    binding,
    input,
  ),
};

function testPaidExecutionDomainAccess(
  location: PaidExecutionDomainLocationOptions,
): PaidExecutionDomainAccess {
  return {
    loadForPlanning: (stateDir) => loadPaidExecutionDomainForPlanningForTests(stateDir, location),
    verifyForPlan: (stateDir, binding) => verifyPaidExecutionDomainForPlanForTests(
      stateDir,
      binding,
      location,
    ),
    claimAttempt: (stateDir, binding, input) => claimPaidExecutionAttemptForTests(
      stateDir,
      binding,
      input,
      location,
    ),
  };
}

type ExtractionProviderMode = "production_paid" | "test_only";

function isExtractionModel(value: string): value is ExtractionModel {
  return ALLOWED_EXTRACTION_MODELS.some((model) => model === value);
}

export function resolveExtractionModel(env: NodeJS.ProcessEnv = process.env): ExtractionModel {
  const configured = env.EXTRACTION_MODEL?.trim() || "gpt-5.6-luna";
  if (!isExtractionModel(configured)) {
    throw new Error(
      `EXTRACTION_MODEL은 gpt-5.6-luna 또는 gpt-5.6-terra만 허용합니다. 현재 값: ${configured}`,
    );
  }
  return configured;
}

export function resolveUncachedPaidCallLimitUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INGEST_MAX_UNCACHED_COST_USD?.trim();
  if (!raw) return DEFAULT_UNCACHED_PAID_CALL_LIMIT_USD;
  const parsed = Number(raw);
  if (
    !Number.isFinite(parsed)
    || parsed < 0
    || parsed > DEFAULT_UNCACHED_PAID_CALL_LIMIT_USD
  ) {
    throw new Error(
      `INGEST_MAX_UNCACHED_COST_USD must be between 0 and ${DEFAULT_UNCACHED_PAID_CALL_LIMIT_USD}`,
    );
  }
  return parsed;
}

function isExtractableUnit(
  unit: ManifestUnit,
  manifest: IngestManifest,
  targetModel?: ExtractionModel,
  targetProviderMode?: ExtractionProviderMode,
): boolean {
  if (!unit.conversion || unit.stage === "needs_manual_conversion" || unit.stage === "scanned" || unit.stage === "loaded") {
    return false;
  }
  if (unit.stage === "validated") {
    const extraction = unit.extraction;
    const converterVersion = unit.conversion.converter_version ?? "v1-legacy";
    const model = targetModel ?? extraction?.model;
    if (!extraction || !model || !manifest.scanner_parser_version) return true;
    const expectedFingerprint = currentExtractionFingerprint({
      scannerParserVersion: manifest.scanner_parser_version,
      converterVersion,
      model,
      rawName: unit.parsed.raw_name,
      regionCode: unit.parsed.region_code,
      kindHint: unit.parsed.kind_hint,
      sourceFingerprint: unit.source_fingerprint,
      artifactFingerprint: unit.conversion.artifact_fingerprint,
    });
    return extraction.model !== model
      || (targetProviderMode !== undefined && extraction.provider_mode !== targetProviderMode)
      || extraction.prompt_version !== EXTRACTION_PROMPT_VERSION
      || extraction.prompt_hash !== EXTRACTION_PROMPT_HASH
      || extraction.processing_version !== EXTRACTION_PROCESSING_VERSION
      || extraction.scanner_parser_version !== manifest.scanner_parser_version
      || extraction.converter_version !== converterVersion
      || extraction.fingerprint !== expectedFingerprint
      || !extraction.content_sha256;
  }
  return true;
}

function clearResolvedExtractionNotices(unit: ManifestUnit): void {
  unit.notices = unit.notices.filter((notice) => !notice.startsWith("extract 실패:"));
}

function extractionStratum(unit: ManifestUnit): number {
  const extensions = new Set(unit.source_files.map((source) => source.ext));
  const isImageEvidence = extensions.has("png")
    || (extensions.has("pdf")
      && (unit.conversion?.text_characters ?? 0) < 300
      && (unit.conversion?.image_artifacts.length ?? 0) > 0);
  if (isImageEvidence) return 0;
  if (extensions.has("docx")) return 1;
  if (extensions.has("pdf")) return 2;
  if (extensions.has("xlsx") && unit.parsed.kind_hint === "hall") return 3;
  if (extensions.has("xlsx") && unit.parsed.kind_hint === "agency") return 4;
  return 5;
}

export function selectExtractionUnits(
  manifest: IngestManifest,
  options: {
    unitIds?: string[];
    sampleSize?: number;
    model?: ExtractionModel;
    providerMode?: ExtractionProviderMode;
  } = {},
): ManifestUnit[] {
  const eligible = manifest.units.filter((unit) => isExtractableUnit(
    unit,
    manifest,
    options.model,
    options.providerMode,
  ));
  if (options.unitIds) {
    if (options.unitIds.length === 0) throw new Error("units_empty");
    if (new Set(options.unitIds).size !== options.unitIds.length) throw new Error("duplicate_unit_id");
    const byId = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
    return options.unitIds.map((unitId) => {
      if (!/^[a-f0-9]{64}$/u.test(unitId)) throw new Error(`invalid_unit_id:${unitId}`);
      const unit = byId.get(unitId);
      if (!unit) throw new Error(`unknown_unit_id:${unitId}`);
      if (!isExtractableUnit(unit, manifest, options.model, options.providerMode)) {
        throw new Error(`unit_not_extractable:${unitId}:${unit.stage}`);
      }
      return unit;
    });
  }

  const sampleSize = options.sampleSize ?? 8;
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 1 || sampleSize > 25) {
    throw new Error("sample_size_must_be_between_1_and_25");
  }
  const buckets = Array.from({ length: 6 }, () => [] as ManifestUnit[]);
  for (const unit of eligible) buckets[extractionStratum(unit)].push(unit);
  for (const bucket of buckets) bucket.sort((left, right) => left.unit_id.localeCompare(right.unit_id, "en"));
  const selected: ManifestUnit[] = [];
  while (selected.length < sampleSize && buckets.some((bucket) => bucket.length > 0)) {
    for (const bucket of buckets) {
      const unit = bucket.shift();
      if (unit) selected.push(unit);
      if (selected.length === sampleSize) break;
    }
  }
  return selected;
}

function mimeTypeForImage(filePath: string): string {
  const extension = path.extname(filePath).toLocaleLowerCase("en-US");
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

export function validateImageRequestPayloadLimits(
  rawBytes: number,
  base64Characters: number,
): void {
  if (!Number.isSafeInteger(rawBytes) || rawBytes < 0 || rawBytes > MAX_IMAGE_REQUEST_RAW_BYTES) {
    throw new Error("image_request_raw_bytes_limit");
  }
  if (
    !Number.isSafeInteger(base64Characters)
    || base64Characters < 0
    || base64Characters > MAX_IMAGE_REQUEST_BASE64_CHARACTERS
  ) {
    throw new Error("image_request_base64_payload_limit");
  }
}

export async function buildOpenAIResponseRequest(
  request: ExtractionRequest,
): Promise<ResponseCreateParamsNonStreaming> {
  if (request.imagePaths.length !== request.imageSourceRefs.length) {
    throw new Error("image_source_reference_count_mismatch");
  }
  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  > = [{
    type: "input_text",
    text: [
      "[스캔 매니페스트에서 확정된 신원 힌트]",
      `canonical_name: ${request.canonicalName}`,
      `region_code: ${request.regionCode}`,
      `kind_hint: ${request.kindHint}`,
      "[비신뢰 공시 원문 시작]",
      request.text || "이미지 원본만 제공되었습니다.",
      "[비신뢰 공시 원문 끝]",
    ].join("\n"),
  }];
  const imageMetadata = [] as Array<{ imagePath: string; bytes: number }>;
  let declaredRawBytes = 0;
  let declaredBase64Characters = 0;
  for (const imagePath of request.imagePaths) {
    const imageStat = await stat(imagePath);
    if (imageStat.size > MAX_IMAGE_BYTES) {
      throw new Error(`OpenAI 이미지 입력 20MB 제한을 넘습니다: ${path.basename(imagePath)}`);
    }
    declaredRawBytes += imageStat.size;
    declaredBase64Characters += Math.ceil(imageStat.size / 3) * 4;
    validateImageRequestPayloadLimits(declaredRawBytes, declaredBase64Characters);
    imageMetadata.push({ imagePath, bytes: imageStat.size });
  }
  let actualRawBytes = 0;
  let actualBase64Characters = 0;
  for (const [index, { imagePath, bytes }] of imageMetadata.entries()) {
    const image = await readFile(imagePath);
    if (image.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`OpenAI 이미지 입력 20MB 제한을 넘습니다: ${path.basename(imagePath)}`);
    }
    if (image.byteLength !== bytes) {
      throw new Error(`OpenAI 이미지 입력이 요청 작성 중 변경되었습니다: ${path.basename(imagePath)}`);
    }
    const base64 = image.toString("base64");
    actualRawBytes += image.byteLength;
    actualBase64Characters += base64.length;
    validateImageRequestPayloadLimits(actualRawBytes, actualBase64Characters);
    const sourceReference = request.imageSourceRefs[index];
    if (!/^[a-f0-9]{64}$/u.test(sourceReference.artifactId) || sourceReference.sources.length === 0) {
      throw new Error("image_source_reference_invalid");
    }
    if (sha256Bytes(image) !== sourceReference.artifactId) {
      throw new Error(`image_artifact_digest_changed_before_provider:${path.basename(imagePath)}`);
    }
    const sourceLines = sourceReference.sources.flatMap((source) => {
      if (!/^[a-f0-9]{64}$/u.test(source.sourceFileId) || !source.sourcePath.trim()) {
        throw new Error("image_source_reference_invalid");
      }
      return [
        `source_file_id: ${source.sourceFileId}`,
        `source_path: ${source.sourcePath.replace(/[\r\n]/gu, " ")}`,
      ];
    });
    content.push({
      type: "input_text",
      text: [
        "[비신뢰 이미지 원본 식별자]",
        `artifact_id: ${sourceReference.artifactId}`,
        ...(sourceReference.viewLabel ? [`image_view: ${sourceReference.viewLabel}`] : []),
        ...sourceLines,
        "다음 이미지는 위 원본 파일 식별자에 연결된 공시 증거입니다. 같은 source_file_id의 다른 image_view는 동일 원본의 확대 보기이므로 같은 발생을 중복 추출하지 마십시오.",
      ].join("\n"),
    });
    content.push({
      type: "input_image",
      image_url: `data:${mimeTypeForImage(imagePath)};base64,${base64}`,
      detail: "high",
    });
  }
  return {
    model: request.model,
    instructions: repairInstructions(request) ?? EXTRACTION_INSTRUCTIONS,
    input: [{ role: "user", content }],
    max_output_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    // GPT-5.6 rejects temperature when reasoning effort is non-zero. The
    // extraction contract requires temperature=0, so use the documented
    // non-reasoning mode rather than silently dropping determinism.
    reasoning: { effort: "none" },
    text: {
      format: EXTRACTION_RESPONSE_FORMAT,
      verbosity: "medium",
    },
    safety_identifier: `disclosure_${request.unitId.slice(0, 24)}`,
    service_tier: "default",
    store: false,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readAliasedTokenCount(
  records: Record<string, unknown>[],
  aliases: string[],
): { present: boolean; valid: boolean; value: number } {
  const observed: unknown[] = [];
  for (const record of records) {
    for (const alias of aliases) {
      if (hasOwn(record, alias)) observed.push(record[alias]);
    }
  }
  if (observed.length === 0) return { present: false, valid: false, value: 0 };
  if (observed.some((value) => !Number.isSafeInteger(value) || Number(value) < 0)) {
    return { present: true, valid: false, value: 0 };
  }
  const values = observed as number[];
  if (values.some((value) => value !== values[0])) {
    return { present: true, valid: false, value: 0 };
  }
  return { present: true, valid: true, value: values[0] as number };
}

function normalizeProviderUsage(value: unknown): NormalizedProviderUsage {
  const candidate = recordValue(value);
  if (!candidate) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      usageReported: false,
    };
  }
  const inputValid = Number.isSafeInteger(candidate.inputTokens) && Number(candidate.inputTokens) >= 0;
  const outputValid = Number.isSafeInteger(candidate.outputTokens) && Number(candidate.outputTokens) >= 0;
  const usageReported = candidate.usageReported !== false && inputValid && outputValid;
  if (!usageReported) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      usageReported: false,
    };
  }
  const inputTokens = candidate.inputTokens as number;
  const outputTokens = candidate.outputTokens as number;
  const cachedInputTokens = candidate.cachedInputTokens;
  const cacheWriteInputTokens = candidate.cacheWriteInputTokens;
  const detailsConsistent = Number.isSafeInteger(cachedInputTokens)
    && Number(cachedInputTokens) >= 0
    && Number.isSafeInteger(cacheWriteInputTokens)
    && Number(cacheWriteInputTokens) >= 0
    && Number(cachedInputTokens) + Number(cacheWriteInputTokens) <= inputTokens;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: detailsConsistent ? Number(cachedInputTokens) : null,
    cacheWriteInputTokens: detailsConsistent ? Number(cacheWriteInputTokens) : null,
    usageReported: true,
  };
}

function parseOpenAIResponseUsage(value: unknown): NormalizedProviderUsage {
  const usage = recordValue(value);
  if (!usage) return normalizeProviderUsage(null);
  const input = readAliasedTokenCount(
    [usage],
    ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"],
  );
  const output = readAliasedTokenCount(
    [usage],
    ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"],
  );
  const detailsRecords: Record<string, unknown>[] = [];
  let detailsContainerMalformed = false;
  for (const alias of [
    "input_tokens_details",
    "inputTokensDetails",
    "prompt_tokens_details",
    "promptTokensDetails",
  ]) {
    if (!hasOwn(usage, alias)) continue;
    const details = recordValue(usage[alias]);
    if (details) detailsRecords.push(details);
    else detailsContainerMalformed = true;
  }
  const cached = readAliasedTokenCount(detailsRecords, ["cached_tokens", "cachedTokens"]);
  const cacheWrite = readAliasedTokenCount(
    detailsRecords,
    ["cache_write_tokens", "cacheWriteTokens"],
  );
  const completeTotals = input.present && input.valid && output.present && output.valid;
  const completeDetails = !detailsContainerMalformed
    && detailsRecords.length > 0
    && cached.present
    && cached.valid
    && cacheWrite.present
    && cacheWrite.valid;
  return normalizeProviderUsage({
    inputTokens: input.value,
    outputTokens: output.value,
    usageReported: completeTotals,
    cachedInputTokens: completeDetails ? cached.value : null,
    cacheWriteInputTokens: completeDetails ? cacheWrite.value : null,
  });
}

function currentExtractionTarget(text: string): string {
  return /\[현재 청크 추출 대상 시작\]\n([\s\S]*?)\n\[현재 청크 추출 대상 끝\]/u.exec(text)?.[1] ?? text;
}

function allowedXlsxLocators(request: ExtractionRequest): string[] {
  const locators = new Set<string>();
  for (const line of currentExtractionTarget(request.text).split(/\r?\n/u)) {
    const cell = /^(.+)!([A-Z]+\d+):\s*/u.exec(line.trim());
    if (cell) locators.add(`${cell[1].normalize("NFKC")}!${cell[2].toUpperCase()}`);
  }
  return [...locators].sort((left, right) => left.localeCompare(right, "en"));
}

function allowedXlsxEvidenceLines(request: ExtractionRequest): ReturnType<typeof indexXlsxCellEvidence> {
  return indexXlsxCellEvidence(currentExtractionTarget(request.text));
}

function allowedSourceFileIds(request: ExtractionRequest): string[] {
  return [...new Set([
    ...[...request.text.matchAll(/^source_file_id:\s*([a-f0-9]{64})\s*$/gmu)].map((match) => match[1]),
    ...request.imageSourceRefs.flatMap((reference) => reference.sources.map((source) => source.sourceFileId)),
  ])].sort((left, right) => left.localeCompare(right, "en"));
}

function repairInstructions(request: ExtractionRequest): string | null {
  const repair = request.repair;
  if (!repair) return null;
  if (repair.reason === "static_validation_retry") {
    return [
      EXTRACTION_INSTRUCTIONS,
      "",
      "[trusted_static_validation_retry]",
      "직전 응답은 로컬 결정론적 검증을 통과하지 못했습니다. 오류 응답의 값이나 경로를 신뢰하지 말고 현재 요청 원문만 처음부터 다시 대조하십시오.",
      "모든 금액은 같은 레코드의 짧고 연속적인 source_quote에 실제로 적혀 있어야 하며, 근거 없는 값은 null + needs_review로 두십시오.",
      "이미지의 통화 단위 없는 퍼센트·숫자는 KRW로 해석하지 말고, money_occurrences는 raw_text와 source_quote의 동일한 통화 금액만 기록하십시오.",
      `allowed_locator_set_sha256: ${repair.allowedLocatorSetSha256}`,
      `allowed_source_file_set_sha256: ${repair.allowedSourceFileSetSha256}`,
      "XLSX source_quote는 아래 exact cell locator만 사용하십시오:",
      ...repair.allowedXlsxLocators.map((locator) => `- ${locator}`),
      "source_file_ids는 아래 ID만 사용하십시오:",
      ...repair.allowedSourceFileIds.map((sourceId) => `- ${sourceId}`),
      "[/trusted_static_validation_retry]",
    ].join("\n");
  }
  if (repair.reason === "image_non_currency_percentage") {
    return [
      EXTRACTION_INSTRUCTIONS,
      "",
      "[trusted_repair_constraints]",
      `직전 이미지 money_occurrences[${repair.rejectedOccurrenceIndex}]가 통화 표기 없는 퍼센트를 KRW로 잘못 추출해 거부되었습니다.`,
      "%는 비율이지 금액이 아니므로 원/만원/천원/KRW/₩ 표기 없는 퍼센트를 money_occurrences에 넣지 마십시오.",
      "잘못된 퍼센트 항목만 제거한 뒤, 이미지에 실제로 보이는 모든 통화 금액을 다시 전수 대조해 누락 없이 재출력하십시오.",
      "[/trusted_repair_constraints]",
    ].join("\n");
  }
  if (repair.reason === "image_money_evidence_mismatch") {
    return [
      EXTRACTION_INSTRUCTIONS,
      "",
      "[trusted_repair_constraints]",
      `직전 이미지 money_occurrences[${repair.rejectedOccurrenceIndex}]의 amount_krw가 raw_text와 source_quote 양쪽의 실제 통화 금액에 일치하지 않아 거부되었습니다.`,
      "각 money_occurrence의 amount_krw는 raw_text와 source_quote에 실제로 보이는 동일한 통화 금액이어야 합니다.",
      "단위가 범위 끝에 한 번만 적힌 공유-unit 범위는 최소·최대 발생 모두 raw_text/source_quote에 전체 연속 범위 표현을 복사하십시오(예: '0 ~ 최고 120만원').",
      "서로 다른 행·항목·금액의 source_quote를 붙이지 말고, 해당 발생의 짧은 연속 원문만 그대로 전사하십시오.",
      "잘못 연결된 발생을 고친 뒤 이미지 전체 통화 금액을 다시 전수 대조해 누락·중복 없이 재출력하십시오.",
      "[/trusted_repair_constraints]",
    ].join("\n");
  }
  if (repair.reason === "source_file_ownership") {
    return [
      EXTRACTION_INSTRUCTIONS,
      "",
      "[trusted_repair_constraints]",
      "직전 응답은 현재 요청에 포함되지 않은 source_file_id를 사용해 거부되었습니다.",
      `rejected_source_file_id_for_audit_only: ${repair.rejectedSourceFileId}`,
      `allowed_source_file_set_sha256: ${repair.allowedSourceFileSetSha256}`,
      "모든 source_file_ids에는 아래 현재 요청 허용 목록의 ID만 정확히 복사하십시오.",
      "다른 청크·다른 파일·unit 전체의 ID를 추측하거나 복사하지 마십시오.",
      "현재 요청에서 직접 뒷받침되지 않는 레코드는 제거하거나 null + needs_review로 두십시오.",
      "allowed_source_file_ids:",
      ...repair.allowedSourceFileIds.map((sourceId) => `- ${sourceId}`),
      "[/trusted_repair_constraints]",
    ].join("\n");
  }
  if (repair.reason === "structured_numeric_evidence") {
    return [
      EXTRACTION_INSTRUCTIONS,
      "",
      "[trusted_repair_constraints]",
      "직전 응답은 구조화 금액이 그 레코드 자신의 source_quote 금액으로 뒷받침되지 않아 거부되었습니다.",
      `rejected_record_path_for_audit_only: ${repair.rejectedPath}`,
      "각 numeric KRW 필드는 같은 레코드의 source_quote에 실제로 적힌 금액만 사용하십시오.",
      "홀명 셀만 인용한 채 식대·대관료를 넣지 마십시오. 한 홀의 값이 여러 셀에 나뉘면 같은 hall_name의 보완적 halls 레코드를 셀별로 분리하고 각 레코드에는 그 단일 셀의 값만 넣으십시오.",
      "현재 셀로 뒷받침되지 않는 numeric 필드는 null로 두고, 필요한 다른 셀은 그 셀이 현재 추출 대상일 때 별도 레코드로 출력하십시오.",
      "[/trusted_repair_constraints]",
    ].join("\n");
  }
  if (repair.reason === "text_quote_contiguity") {
    return [
      EXTRACTION_INSTRUCTIONS,
      "",
      "[trusted_repair_constraints]",
      "직전 응답은 떨어진 문단·문구를 이어 붙인 source_quote를 만들어 거부되었습니다.",
      `rejected_record_path_for_audit_only: ${repair.rejectedPath}`,
      "source_quote는 현재 추출 대상 안에 실제로 연속해서 존재하는 짧은 원문 조각을 글자 순서 그대로 복사하십시오.",
      "서로 떨어진 문장, 다른 문단, 다른 표 행을 요약·재작성·결합하지 마십시오.",
      "현재 청크에 연속 원문 근거가 없는 레코드는 제거하거나 null + needs_review로 두십시오.",
      "[/trusted_repair_constraints]",
    ].join("\n");
  }
  return [
    EXTRACTION_INSTRUCTIONS,
    "",
    "[trusted_repair_constraints]",
    "직전 응답은 현재 요청이 소유하지 않은 XLSX locator를 인용해 거부되었습니다.",
    `rejected_locator_for_audit_only: ${repair.rejectedLocator}`,
    `allowed_locator_set_sha256: ${repair.allowedLocatorSetSha256}`,
    "다시 출력할 때 source_quote의 XLSX locator는 아래 허용 목록에 있는 정확한 셀만 사용하십시오.",
    "source_quote는 현재 추출 대상의 단일 '시트!셀: 원문'만 사용하고, 콜론 뒤에는 그 셀 내용 전체 또는 필요한 연속 원문 조각을 그대로 복사하십시오. 떨어진 문구 결합, 여러 셀 합성, 세미콜론 연결, 범위 생성은 금지합니다.",
    "허용 목록에 없는 XLSX locator, 다른 청크의 셀, 새로 만든 범위는 인용하지 마십시오.",
    "현재 청크에 근거 셀이 없는 항목은 추론하지 말고 제거하거나 null + needs_review로 두십시오.",
    "allowed_xlsx_locators:",
    ...repair.allowedXlsxLocators.map((locator) => `- ${locator}`),
    "[/trusted_repair_constraints]",
  ].join("\n");
}

function evidenceRecords(value: unknown, result: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) evidenceRecords(item, result);
    return result;
  }
  const record = recordValue(value);
  if (!record) return result;
  if (typeof record.source_quote === "string") result.push(record);
  for (const child of Object.values(record)) {
    if (child !== record.source_quote && child !== record.source_file_ids) evidenceRecords(child, result);
  }
  return result;
}

type EvidenceModality = "text" | "image" | "mixed";

interface LocatedEvidenceRecord {
  path: string;
  record: Record<string, unknown>;
}

function locatedEvidenceRecords(
  value: unknown,
  currentPath = "",
  result: LocatedEvidenceRecord[] = [],
): LocatedEvidenceRecord[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => locatedEvidenceRecords(item, `${currentPath}[${index}]`, result));
    return result;
  }
  const record = recordValue(value);
  if (!record) return result;
  if (currentPath && typeof record.source_quote === "string") {
    result.push({ path: currentPath, record });
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "source_quote" || key === "source_file_ids") continue;
    locatedEvidenceRecords(child, currentPath ? `${currentPath}.${key}` : key, result);
  }
  return result;
}

function evidenceIdentity(sourceQuote: unknown, sourceFileIds: unknown): string | null {
  if (typeof sourceQuote !== "string" || !sourceQuote.trim()) return null;
  const ids = Array.isArray(sourceFileIds)
    ? sourceFileIds.filter((value): value is string => typeof value === "string").sort()
    : [];
  return sha256Text(JSON.stringify([
    sourceQuote.normalize("NFKC").replace(/\s+/gu, " ").trim(),
    ids,
  ]));
}

function extractionEvidenceModalities(
  merged: DisclosureExtraction,
  responses: DisclosureExtraction[],
  requests: ExtractionRequest[],
  deterministicTextLedger: NonNullable<DisclosureExtraction["money_occurrences"]>,
): NonNullable<ExtractionArtifact["evidence_modalities"]> {
  const origins = new Map<string, Set<Exclude<EvidenceModality, "mixed">>>();
  const addOrigin = (
    sourceQuote: unknown,
    sourceFileIds: unknown,
    modality: Exclude<EvidenceModality, "mixed">,
  ): void => {
    const identity = evidenceIdentity(sourceQuote, sourceFileIds);
    if (!identity) return;
    const modalities = origins.get(identity) ?? new Set<Exclude<EvidenceModality, "mixed">>();
    modalities.add(modality);
    origins.set(identity, modalities);
  };
  const addResponse = (
    response: DisclosureExtraction,
    modality: Exclude<EvidenceModality, "mixed">,
  ): void => {
    for (const { record } of locatedEvidenceRecords(response)) {
      addOrigin(record.source_quote, record.source_file_ids, modality);
    }
    addOrigin(response.hall.venue_fee_source_quote, response.hall.venue_fee_source_file_ids, modality);
    addOrigin(response.hall.meal_price_source_quote, response.hall.meal_price_source_file_ids, modality);
  };
  responses.forEach((response, index) => {
    const request = requests[index];
    const modality = request && !request.text.trim() && request.imagePaths.length > 0 ? "image" : "text";
    addResponse(response, modality);
  });
  for (const occurrence of deterministicTextLedger) {
    addOrigin(occurrence.source_quote, occurrence.source_file_ids, "text");
  }

  const entries = new Map<string, {
    path: string;
    source_file_id?: string;
    modality: EvidenceModality;
  }>();
  const modalityForIdentity = (identity: string | null): EvidenceModality | null => {
    const modalities = identity ? origins.get(identity) : undefined;
    if (!modalities || modalities.size === 0) return null;
    return modalities.size > 1 ? "mixed" : [...modalities][0];
  };
  const addFinal = (path: string, sourceQuote: unknown, sourceFileIds: unknown): void => {
    if (typeof sourceQuote === "string") {
      const decoded = decodeEvidenceQuote(sourceQuote);
      if (decoded.kind === "merged") {
        for (const fragment of decoded.fragments) {
          const modality = modalityForIdentity(evidenceIdentity(fragment.quote, [fragment.source_file_id]));
          if (!modality) continue;
          entries.set(`${path}\0${fragment.source_file_id}`, {
            path,
            source_file_id: fragment.source_file_id,
            modality,
          });
        }
        return;
      }
    }
    const modality = modalityForIdentity(evidenceIdentity(sourceQuote, sourceFileIds));
    if (!modality) return;
    entries.set(path, { path, modality });
  };
  for (const { path: recordPath, record } of locatedEvidenceRecords(merged)) {
    addFinal(recordPath, record.source_quote, record.source_file_ids);
  }
  addFinal("hall.venue_fee_krw", merged.hall.venue_fee_source_quote, merged.hall.venue_fee_source_file_ids);
  addFinal("hall.meal_price", merged.hall.meal_price_source_quote, merged.hall.meal_price_source_file_ids);
  return [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, entry]) => entry);
}

function assertBatchEvidenceOwnership(
  data: DisclosureExtraction,
  request: ExtractionRequest,
  audit: ProviderUsageAudit,
): void {
  const targetLines = allowedXlsxEvidenceLines(request);
  const targetCells = new Set(Object.keys(targetLines));
  const allowed = [...targetCells].sort((left, right) => left.localeCompare(right, "en"));
  const rejectXlsxQuote = (
    rejectedLocator: string,
    locatorViolation: "not_in_request" | "not_exact_single_cell",
  ): never => {
    const ownershipAudit = {
      rejectedLocator,
      allowedLocatorCount: allowed.length,
      allowedLocatorSetSha256: sha256Text(allowed.join("\n")),
      locatorViolation,
    };
    const reason = locatorViolation === "not_in_request"
      ? "현재 요청에 없는 XLSX 셀"
      : "현재 요청의 단일 XLSX 셀 원문과 일치하지 않는 합성 source_quote";
    throw new ExtractionProviderResponseError(
      `OpenAI 구조화 출력 검증에 실패했습니다: ${reason} (rejected_locator=${rejectedLocator})`,
      audit,
      ownershipAudit,
    );
  };
  const allowedSourceFileIdList = allowedSourceFileIds(request);
  const allowedSourceIds = new Set(allowedSourceFileIdList);
  const targetText = currentExtractionTarget(request.text);
  const targetMoneyOccurrences = targetText.trim()
    ? scanSourceMoneyOccurrences(targetText)
    : [];

  if (request.imagePaths.length > 0) {
    for (const [index, occurrence] of (data.money_occurrences ?? []).entries()) {
      const rawText = occurrence.raw_text.normalize("NFKC");
      if (/%/u.test(rawText) && !/(?:원|KRW|₩)/iu.test(rawText)) {
        throw new ExtractionProviderResponseError(
          `OpenAI 구조화 출력 검증에 실패했습니다: 통화 표기 없는 퍼센트를 image money_occurrence로 추출함 (occurrence_index=${index})`,
          audit,
          undefined,
          { rejectedOccurrenceIndex: index, violation: "non_currency_percentage" },
        );
      }
      const rawAmounts = parseKoreanMoneyAmounts(occurrence.raw_text);
      const quoteAmounts = parseKoreanMoneyAmounts(occurrence.source_quote);
      if (!rawAmounts.includes(occurrence.amount_krw) || !quoteAmounts.includes(occurrence.amount_krw)) {
        throw new ExtractionProviderResponseError(
          `OpenAI 구조화 출력 검증에 실패했습니다: image money_occurrence 금액과 raw_text/source_quote 불일치 (occurrence_index=${index})`,
          audit,
          undefined,
          { rejectedOccurrenceIndex: index, violation: "amount_quote_mismatch" },
        );
      }
    }
  }

  for (const { path: recordPath, record } of locatedEvidenceRecords(data)) {
    const isMoneyOccurrence = typeof record.amount_krw === "number" && typeof record.kind === "string";
    if (isMoneyOccurrence && request.imagePaths.length === 0) {
      // Text money_occurrences are non-authoritative and replaced from source
      // tokens after merge. Do not spend a repair retry on their model-provided
      // provenance because it is discarded deterministically.
      continue;
    }
    const sourceFileIds = Array.isArray(record.source_file_ids)
      ? record.source_file_ids.filter((value): value is string => typeof value === "string")
      : [];
    const rejectedSourceFileId = sourceFileIds.find((sourceId) => !allowedSourceIds.has(sourceId));
    if (rejectedSourceFileId) {
      throw new ExtractionProviderResponseError(
        "OpenAI 구조화 출력 검증에 실패했습니다: 현재 요청에 없는 source_file_id",
        audit,
        undefined,
        undefined,
        {
          rejectedSourceFileId,
          allowedSourceFileCount: allowedSourceFileIdList.length,
          allowedSourceFileSetSha256: sha256Text(allowedSourceFileIdList.join("\n")),
        },
      );
    }
    if (isMoneyOccurrence) {
      // Image occurrences already passed their dedicated raw/quote amount guard
      // above; after checking request-scoped provenance they need no generic
      // structured-record checks.
      continue;
    }
    if (targetCells.size > 0) {
      const quoteMatch = matchSingleXlsxEvidenceQuote(String(record.source_quote), targetLines);
      if (quoteMatch.kind === "reject") {
        rejectXlsxQuote(quoteMatch.locator, quoteMatch.violation);
      }
    }
    const structuredCurrencyValues = [...new Set(Object.entries(record).flatMap(([key, value]) =>
      /(?:price|fee|amount).*_krw$/u.test(key)
        && typeof value === "number"
        && Number.isSafeInteger(value)
        && value >= 0
        ? [value]
        : []
    ))];
    if (structuredCurrencyValues.length > 0) {
      const sourceQuote = String(record.source_quote);
      const sourceQuoteContent = /^.+?![A-Z]+\d+:\s*(.*)$/iu.exec(sourceQuote)?.[1] ?? sourceQuote;
      const quotedAmounts = parseKoreanMoneyAmounts(sourceQuote);
      const positiveStructuredValues = structuredCurrencyValues.filter((value) => value > 0);
      const imageOnlyRequest = request.imagePaths.length > 0 && !request.text.trim();
      const normalizedQuoteContent = normalizeEvidenceText(sourceQuoteContent);
      const quoteLocatorMatch = /^(.+?)!([A-Z]+\d+):/iu.exec(normalizeEvidenceText(sourceQuote));
      const quoteLocator = quoteLocatorMatch
        ? `${quoteLocatorMatch[1].normalize("NFKC")}!${quoteLocatorMatch[2].toUpperCase()}`
        : null;
      const supportsStructuredValue = (value: number): boolean => {
        if (quotedAmounts.includes(value)) return true;
        if (imageOnlyRequest) return false;
        return targetMoneyOccurrences.some((occurrence) =>
          occurrence.krw === value
          && (!quoteLocator || occurrence.source_locator === quoteLocator)
          && normalizedQuoteContent.includes(normalizeEvidenceText(occurrence.raw))
        );
      };
      const unsupported = positiveStructuredValues.some((value) => !supportsStructuredValue(value));
      if (unsupported) {
        throw new ExtractionProviderResponseError(
          "OpenAI 구조화 출력 검증에 실패했습니다: numeric KRW 필드가 자체 source_quote 금액으로 뒷받침되지 않음",
          audit,
          undefined,
          undefined,
          undefined,
          { rejectedPath: recordPath },
        );
      }
    }
    if (targetCells.size === 0) {
      const targetText = normalizeEvidenceText(currentExtractionTarget(request.text));
      const sourceQuote = normalizeEvidenceText(String(record.source_quote));
      if (targetText && sourceQuote && !targetText.includes(sourceQuote)) {
        throw new ExtractionProviderResponseError(
          "OpenAI 구조화 출력 검증에 실패했습니다: 비-XLSX source_quote가 현재 요청의 연속 원문 조각이 아님",
          audit,
          undefined,
          undefined,
          undefined,
          undefined,
          { rejectedPath: recordPath },
        );
      }
      continue;
    }
  }
}

export function parseOpenAIExtractionResponse(
  responseData: unknown,
  requestId?: string,
): ExtractionProviderResult {
  const response = recordValue(responseData);
  const usage = parseOpenAIResponseUsage(response?.usage);
  const responseRequestId = requestId?.trim()
    || (typeof response?._request_id === "string" ? response._request_id : undefined);
  const audit = {
    ...usage,
    ...(responseRequestId ? { requestId: responseRequestId } : {}),
  };
  if (typeof response?.output_text !== "string" || !response.output_text.trim()) {
    throw new ExtractionProviderResponseError("OpenAI 구조화 출력 검증에 실패했습니다: output_text 없음", audit);
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(response.output_text);
  } catch {
    throw new ExtractionProviderResponseError("OpenAI 구조화 출력 검증에 실패했습니다: JSON 아님", audit);
  }
  const parsed = DisclosureExtractionSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ExtractionProviderResponseError(
      `OpenAI 구조화 출력 검증에 실패했습니다: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      audit,
    );
  }
  return { data: parsed.data, ...audit };
}

function openAIExtractionProviderConfig(env: NodeJS.ProcessEnv): {
  apiKey: string;
  baseURL: "https://api.openai.com/v1";
} {
  if (env.INGEST_OPENAI_ENABLED !== "true") {
    throw new Error("실제 추출은 INGEST_OPENAI_ENABLED=true일 때만 허용합니다.");
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY가 필요합니다.");
  const canonicalBaseUrl = "https://api.openai.com/v1";
  const configuredBaseUrl = env.OPENAI_BASE_URL?.trim();
  if (configuredBaseUrl && configuredBaseUrl !== canonicalBaseUrl) {
    throw new Error("OPENAI_BASE_URL은 공식 OpenAI API 주소만 허용합니다.");
  }
  const forbiddenAmbientOptions = [
    "OPENAI_ADMIN_KEY",
    "OPENAI_CUSTOM_HEADERS",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT_ID",
  ] as const;
  const configuredForbiddenOption = forbiddenAmbientOptions.find((name) => env[name]?.trim());
  if (configuredForbiddenOption) {
    throw new Error(`${configuredForbiddenOption} is not allowed for the fixed-eight extraction pipeline`);
  }
  return { apiKey, baseURL: canonicalBaseUrl };
}

/** Safe, network-free preflight used by tests and deployment diagnostics. */
export function assertOpenAIExtractionProviderEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  void openAIExtractionProviderConfig(env);
}

function createOpenAIExtractionProvider(env: NodeJS.ProcessEnv = process.env): ExtractionProvider {
  const { apiKey, baseURL } = openAIExtractionProviderConfig(env);
  const client = new OpenAI({
    apiKey,
    adminAPIKey: null,
    baseURL,
    logLevel: "off",
    maxRetries: 0,
    organization: null,
    project: null,
    timeout: 120_000,
    webhookSecret: null,
  });

  return {
    extract: async (request) => {
      const promise = client.responses.create(await buildOpenAIResponseRequest(request));
      const response = await promise.withResponse();
      return parseOpenAIExtractionResponse(response.data, response.request_id ?? undefined);
    },
  };
}

function isWithin(parentDirectory: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentDirectory), path.resolve(candidatePath));
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

async function realPathInside(parentRealPath: string, candidatePath: string): Promise<string> {
  const candidateRealPath = await realpath(candidatePath);
  if (!isWithin(parentRealPath, candidateRealPath)) {
    throw new Error(`provenance realpath가 허용 루트 밖을 가리킵니다: ${candidatePath}`);
  }
  return candidateRealPath;
}

async function verifyProvenance(unit: ManifestUnit, manifest: IngestManifest): Promise<void> {
  if (!unit.conversion || unit.conversion.source_fingerprint !== unit.source_fingerprint) {
    throw new Error("변환 산출물이 현재 원본 fingerprint와 일치하지 않습니다. convert를 다시 실행하세요.");
  }
  const rawRootRealPath = await realpath(manifest.root_dir);
  for (const source of unit.source_files) {
    const expectedPath = path.resolve(manifest.root_dir, source.path);
    if (!isWithin(manifest.root_dir, expectedPath) || expectedPath !== path.resolve(source.absolute_path)) {
      throw new Error(`원본 provenance 경로가 올바르지 않습니다: ${source.path}`);
    }
    const expectedRealPath = await realPathInside(rawRootRealPath, expectedPath);
    const declaredRealPath = await realPathInside(rawRootRealPath, source.absolute_path);
    if (path.relative(expectedRealPath, declaredRealPath) !== "") {
      throw new Error(`원본 provenance realpath가 manifest와 일치하지 않습니다: ${source.path}`);
    }
    const digest = await sha256File(expectedPath);
    if (digest.sha256 !== source.sha256 || digest.bytes !== source.bytes) {
      throw new Error(`원본이 scan 이후 변경되었습니다: ${source.path}`);
    }
  }

  const convertedRoot = path.join(path.resolve(manifest.state_dir), ".converted");
  const convertedRootRealPath = await realpath(convertedRoot);
  const allowedRawImages = new Set(await Promise.all(
    unit.source_files
      .filter((source) => source.ext === "png")
      .map((source) => realPathInside(rawRootRealPath, source.absolute_path)),
  ));
  for (const artifactPath of unit.conversion.text_artifacts) {
    if (!isWithin(convertedRoot, artifactPath)) {
      throw new Error(`변환 텍스트가 허용 디렉터리 밖을 가리킵니다: ${artifactPath}`);
    }
    await realPathInside(convertedRootRealPath, artifactPath);
  }
  for (const artifactPath of unit.conversion.image_artifacts) {
    const isConvertedArtifact = isWithin(convertedRoot, artifactPath);
    const artifactRealPath = await realpath(artifactPath);
    if (
      (isConvertedArtifact && !isWithin(convertedRootRealPath, artifactRealPath))
      || (!isConvertedArtifact && !allowedRawImages.has(artifactRealPath))
    ) {
      throw new Error(`이미지 provenance가 허용 원본과 일치하지 않습니다: ${artifactPath}`);
    }
  }
  const artifactFingerprint = await computeArtifactFingerprint(unit);
  if (artifactFingerprint !== unit.conversion.artifact_fingerprint) {
    throw new Error("변환 산출물이 convert 이후 변경되었습니다. convert를 다시 실행하세요.");
  }
}

async function computeArtifactFingerprint(unit: ManifestUnit): Promise<string> {
  if (!unit.conversion) throw new Error("변환 산출물이 없습니다.");
  const paths = [...unit.conversion.text_artifacts, ...unit.conversion.image_artifacts]
    .sort((left, right) => left.localeCompare(right, "en"));
  const records = await Promise.all(paths.map(async (artifactPath) => {
    const digest = await sha256File(artifactPath);
    return `${path.resolve(artifactPath)}\0${digest.sha256}`;
  }));
  return sha256Text(records.join("\n"));
}

interface VerifiedConversionSnapshot {
  textByPath: Map<string, string>;
  digestByPath: Map<string, { sha256: string; bytes: number }>;
}

async function readVerifiedConversionSnapshot(
  unit: ManifestUnit,
): Promise<VerifiedConversionSnapshot> {
  if (!unit.conversion) throw new Error("conversion_missing_for_snapshot");
  const textByPath = new Map<string, string>();
  const digestByPath = new Map<string, { sha256: string; bytes: number }>();
  await Promise.all(unit.conversion.text_artifacts.map(async (artifactPath) => {
    const bytes = await readFile(artifactPath);
    const resolved = path.resolve(artifactPath);
    textByPath.set(resolved, bytes.toString("utf8"));
    digestByPath.set(resolved, { sha256: sha256Bytes(bytes), bytes: bytes.byteLength });
  }));
  await Promise.all(unit.conversion.image_artifacts.map(async (artifactPath) => {
    digestByPath.set(path.resolve(artifactPath), await sha256File(artifactPath));
  }));
  const records = [...unit.conversion.text_artifacts, ...unit.conversion.image_artifacts]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((artifactPath) => {
      const resolved = path.resolve(artifactPath);
      const digest = digestByPath.get(resolved);
      if (!digest) throw new Error(`conversion_snapshot_digest_missing:${artifactPath}`);
      return `${resolved}\0${digest.sha256}`;
    });
  if (sha256Text(records.join("\n")) !== unit.conversion.artifact_fingerprint) {
    throw new Error("conversion_changed_while_preparing_verified_snapshot");
  }
  return { textByPath, digestByPath };
}

function chunkText(text: string, maximumCharacters = MAX_TEXT_CHARACTERS_PER_REQUEST): string[] {
  if (text.length <= maximumCharacters) return text ? [text] : [];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maximumCharacters) {
    const candidate = remaining.slice(0, maximumCharacters);
    const boundary = Math.max(
      candidate.lastIndexOf("\n## "),
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
    );
    const splitAt = boundary > maximumCharacters / 2
      ? boundary
      : maximumCharacters;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function chunkLocatedTextLines(
  text: string,
  lineOffset: number,
  targetCharacters: number,
  maximumCharacters: number,
): string[] {
  const locatedRows = text.split(/\r?\n/u).flatMap((line, index) => {
    const prefix = `line:${lineOffset + index + 1}: `;
    const payloadLimit = maximumCharacters - prefix.length;
    if (payloadLimit < 1) throw new Error("line_locator_prefix_exceeds_request_limit");
    if (line.length <= payloadLimit) return [`${prefix}${line}`];
    const fragments: string[] = [];
    for (let start = 0; start < line.length; start += payloadLimit) {
      fragments.push(`${prefix}${line.slice(start, start + payloadLimit)}`);
    }
    return fragments;
  });
  const chunks: string[] = [];
  let current = "";
  for (const row of locatedRows) {
    const candidate = current ? `${current}\n${row}` : row;
    if (current && candidate.length > targetCharacters) {
      chunks.push(current);
      current = row;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

interface WorkbookMergeInheritance {
  sheet: string;
  startColumn: number;
  endColumn: number;
  startRow: number;
  endRow: number;
  anchorAddress: string;
  anchorValue: string;
}

function workbookColumnNumber(value: string): number {
  return [...value.toUpperCase()].reduce(
    (total, character) => total * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function workbookColumnName(value: number): string {
  let remaining = value;
  let result = "";
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode(65 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function workbookMergeInheritances(text: string): WorkbookMergeInheritance[] {
  const canonicalValues = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const cell = /^(.+)!([A-Z]+\d+):\s*(.*)$/u.exec(line.trim());
    if (cell) canonicalValues.set(`${cell[1]}!${cell[2].toUpperCase()}`, cell[3]);
  }
  const inheritances: WorkbookMergeInheritance[] = [];
  let currentSheet: string | null = null;
  for (const line of text.split(/\r?\n/u)) {
    const heading = /^##\s*시트:\s*(.+)$/u.exec(line.trim());
    if (heading) {
      currentSheet = heading[1].trim();
      continue;
    }
    if (!currentSheet) continue;
    const merge = /^병합 범위\s+([A-Z]+)(\d+):([A-Z]+)(\d+)\s*·\s*좌상단\s+([A-Z]+\d+)$/u.exec(line.trim());
    if (!merge) continue;
    const startColumn = workbookColumnNumber(merge[1]);
    const startRow = Number.parseInt(merge[2], 10);
    const endColumn = workbookColumnNumber(merge[3]);
    const endRow = Number.parseInt(merge[4], 10);
    const anchorAddress = merge[5].toUpperCase();
    const anchorValue = canonicalValues.get(`${currentSheet}!${anchorAddress}`);
    const area = (endColumn - startColumn + 1) * (endRow - startRow + 1);
    if (!anchorValue || !Number.isSafeInteger(area) || area > 512) continue;
    inheritances.push({
      sheet: currentSheet,
      startColumn,
      endColumn,
      startRow,
      endRow,
      anchorAddress,
      anchorValue,
    });
  }
  return inheritances;
}

function chunkAtomicWorkbookRows(
  text: string,
  targetCharacters: number,
  maximumCharacters: number,
): string[] {
  const lines = text.split(/\r?\n/u);
  if (!lines.some((line) => /^.+![A-Z]+\d+:\s*/u.test(line.trim()))) {
    return chunkText(text, targetCharacters);
  }

  const mergeInheritances = workbookMergeInheritances(text);
  const blocks: string[] = [];
  let rowKey: string | null = null;
  let rowLines: string[] = [];
  const flushRow = (): void => {
    if (rowLines.length > 0 && rowKey) {
      const [sheet, rowText] = rowKey.split("\0");
      const row = Number.parseInt(rowText, 10);
      const existingAddresses = new Set(rowLines.flatMap((line) => {
        const cell = /^.+!([A-Z]+\d+):\s*/u.exec(line.trim());
        return cell ? [cell[1].toUpperCase()] : [];
      }));
      const inheritedLines = mergeInheritances.flatMap((merge) => {
        if (merge.sheet !== sheet || row < merge.startRow || row > merge.endRow) return [];
        const result: string[] = [];
        for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
          const address = `${workbookColumnName(column)}${row}`;
          if (existingAddresses.has(address) || address === merge.anchorAddress) continue;
          const inheritedValue = merge.anchorValue.length <= 240
            ? merge.anchorValue
            : `${merge.anchorValue.slice(0, 237)}…`;
          result.push(
            `[병합 상속: ${sheet}!${merge.anchorAddress} -> ${row}행 ${address}] ${inheritedValue}`,
          );
        }
        return result;
      });
      blocks.push([...inheritedLines, ...rowLines].join("\n"));
    }
    rowKey = null;
    rowLines = [];
  };
  for (const line of lines) {
    const cell = /^(.+)!([A-Z]+)(\d+):\s*/u.exec(line.trim());
    if (!cell) {
      flushRow();
      if (line.trim()) blocks.push(line);
      continue;
    }
    const nextRowKey = `${cell[1]}\0${cell[3]}`;
    if (rowKey !== null && rowKey !== nextRowKey) flushRow();
    rowKey = nextRowKey;
    rowLines.push(line);
  }
  flushRow();

  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (block.length > maximumCharacters) {
      throw new Error("workbook_atomic_row_exceeds_request_limit");
    }
    const candidate = current ? `${current}\n${block}` : block;
    if (current && candidate.length > targetCharacters) {
      chunks.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function stripRedundantWorkbookMarkdown(text: string): string {
  return text
    .split(/\r?\n/u)
    .filter((line) => !/^\|.*\|\s*$/u.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function workbookInterpretationContext(text: string): string {
  const isInterpretationHeader = (payload: string): boolean => {
    if (!/(?:사업체명|업체명|기본가격|기본가|선택품목|옵션|위약금|환불|대관료|식대|보증인원|장식|도우미|헬퍼)/u.test(payload)) {
      return false;
    }
    // Interpretation context is repeated into every row chunk. Substantive
    // policy headings would therefore become out-of-chunk extraction evidence.
    // Keep compact column/header semantics only; the policy row itself is
    // extracted when its own atomic row is the current target.
    return payload.length <= 80
      && !/<br\s*\/?>/iu.test(payload)
      && !/(?:계약\s*해지|산정\s*기준|로부터|취소\s*시|환급\s*에\s*관한|배상|반환)/u.test(payload);
  };
  const selected = new Set<string>();
  const canonicalPayloads = new Map<string, string>();
  let currentSheet: string | null = null;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^##\s*시트:\s*(.+)$/u.exec(line);
    if (heading) {
      currentSheet = heading[1].trim();
      selected.add(line);
      continue;
    }
    const cell = /^(.+)!([A-Z]+)(\d+):\s*(.*)$/u.exec(line);
    if (cell?.[3] && cell[4]) {
      canonicalPayloads.set(`${cell[1]}!${cell[2]}${cell[3]}`, cell[4]);
    }
    const merge = currentSheet
      ? /^병합 범위\s+([A-Z]+\d+):([A-Z]+\d+)\s*·\s*좌상단\s+([A-Z]+\d+)$/u.exec(line)
      : null;
    if (merge && currentSheet) {
      const anchorPayload = canonicalPayloads.get(`${currentSheet}!${merge[3]}`);
      if (anchorPayload && isInterpretationHeader(anchorPayload)) {
        selected.add(`[병합 헤더: ${currentSheet}!${merge[1]}:${merge[2]} · 좌상단 ${merge[3]}] ${anchorPayload}`);
      }
      continue;
    }
    if (!cell || !cell[3] || !cell[4]) continue;
    const row = Number.parseInt(cell[3], 10);
    const payload = cell[4];
    if (row > 20) continue;
    const declaresUnit = /(?:금액\s*)?단위\s*[:：]?\s*(?:억|천만|백만|만|천)?\s*원|VAT/u.test(payload);
    const looksLikeHeader = isInterpretationHeader(payload);
    const containsMoney = /\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만|천)\s*원?|\d{1,3}(?:,\d{3})+\s*원/u.test(payload);
    if (declaresUnit || (looksLikeHeader && !containsMoney)) selected.add(line);
  }
  let context = [...selected].join("\n");
  if (context.length > 2_500) context = `${context.slice(0, 2_480)}\n[맥락 일부 생략]`;
  return context;
}

function toSourceReference(source: SourceFile): ExtractionSourceReference {
  return { sourceFileId: sourceFileId(source), sourcePath: source.path };
}

function evidenceLabel(
  artifactId: string,
  sources: ExtractionSourceReference[],
): string[] {
  return [
    `artifact_id: ${artifactId}`,
    ...sources.flatMap((source) => [
      `source_file_id: ${source.sourceFileId}`,
      `source_path: ${source.sourcePath.replace(/[\r\n]/gu, " ")}`,
    ]),
  ];
}

function labeledTextFragments(
  text: string,
  artifactId: string,
  sources: ExtractionSourceReference[],
  lineOffset: number | null,
): string[] {
  if (!text) return [];
  const extractionText = lineOffset === null ? stripRedundantWorkbookMarkdown(text) : text;
  const interpretationContext = lineOffset === null ? workbookInterpretationContext(extractionText) : "";
  const header = ["[비신뢰 원본 파일 증거 시작]", ...evidenceLabel(artifactId, sources)].join("\n");
  const footer = "[비신뢰 원본 파일 증거 끝]";
  const contextBlock = interpretationContext
    ? [
        "[해석 전용 표 맥락 시작 — 단위·열 의미에만 사용하고 항목이나 money_occurrences로 재추출 금지]",
        interpretationContext,
        "[해석 전용 표 맥락 끝]",
      ].join("\n")
    : "";
  const framingCharacters = header.length + footer.length + contextBlock.length + 160;
  const payloadLimit = Math.min(
    TARGET_EXTRACTION_PAYLOAD_CHARACTERS,
    MAX_TEXT_CHARACTERS_PER_REQUEST - framingCharacters,
  );
  if (payloadLimit < 1_000) throw new Error("source_evidence_label_too_large");
  const maximumPayloadCharacters = MAX_TEXT_CHARACTERS_PER_REQUEST - framingCharacters;
  const fragments = lineOffset === null
    ? chunkAtomicWorkbookRows(extractionText, payloadLimit, maximumPayloadCharacters)
    : chunkLocatedTextLines(extractionText, lineOffset, payloadLimit, maximumPayloadCharacters);
  return fragments.map((fragment, index) => [
    header,
    `[청크 ${index + 1}/${fragments.length}]`,
    contextBlock,
    "[현재 청크 추출 대상 시작]",
    fragment,
    "[현재 청크 추출 대상 끝]",
    footer,
  ].filter(Boolean).join("\n"));
}

function packTextFragments(fragments: string[]): string[] {
  // Each fragment already has provenance, table context, and a deliberately
  // small extraction target. Repacking fragments would recreate the oversized
  // requests that caused 16k-token truncation and sparse representative output.
  return [...fragments];
}

interface PreparedImageView {
  path: string;
  viewLabel: string;
  sourcePath: string;
}

const IMAGE_TILE_SCRATCH_DIRECTORY_NAME = "image-tile-tmp";
const IMAGE_TILE_SCRATCH_PREFIX = "tile-";
const IMAGE_TILE_SCRATCH_FILE_NAME = "tile.png";

function imageTileScratchRoot(stateDir: string): string {
  return path.join(
    path.resolve(stateDir),
    ".cache",
    IMAGE_TILE_SCRATCH_DIRECTORY_NAME,
  );
}

/**
 * Node's mkdtemp appends six random characters to the supplied prefix. Keep
 * this observable bound next to the implementation so the Windows long-path
 * regression can be tested on every platform without depending on Sharp to
 * expose its output path.
 */
export function imageTileScratchTemporaryPathUpperBound(stateDir: string): string {
  return path.join(
    imageTileScratchRoot(stateDir),
    `${IMAGE_TILE_SCRATCH_PREFIX}${"x".repeat(6)}`,
    IMAGE_TILE_SCRATCH_FILE_NAME,
  );
}

async function createImageTileScratchFilePath(
  stateDir: string,
): Promise<{ temporaryDirectory: string; temporaryPath: string }> {
  const scratchRoot = imageTileScratchRoot(stateDir);
  // This creates only ordinary state-owned parents and rejects a preseeded
  // symlink/junction before mkdtemp can place source-derived bytes there.
  await prepareDeterministicStateArtifactWritePath({
    stateDir,
    artifactPath: path.join(scratchRoot, ".path-check"),
    expectedRelativePath: path.join(
      ".cache",
      IMAGE_TILE_SCRATCH_DIRECTORY_NAME,
      ".path-check",
    ),
  });
  const temporaryDirectory = await mkdtemp(path.join(scratchRoot, IMAGE_TILE_SCRATCH_PREFIX));
  const temporaryPath = path.join(temporaryDirectory, IMAGE_TILE_SCRATCH_FILE_NAME);
  try {
    // Re-check the newly-created random directory as an ordinary, in-state,
    // same-volume path immediately before handing it to Sharp.
    await prepareDeterministicStateArtifactWritePath({
      stateDir,
      artifactPath: temporaryPath,
      expectedRelativePath: path.join(
        ".cache",
        IMAGE_TILE_SCRATCH_DIRECTORY_NAME,
        path.basename(temporaryDirectory),
        IMAGE_TILE_SCRATCH_FILE_NAME,
      ),
    });
    return { temporaryDirectory, temporaryPath };
  } catch (error) {
    await rmdir(temporaryDirectory).catch(() => undefined);
    throw error;
  }
}

async function prepareImageViews(
  imagePath: string,
  stateDir: string,
  expectedSourceDigest: { sha256: string; bytes: number },
): Promise<PreparedImageView[]> {
  const original = { path: imagePath, viewLabel: "original", sourcePath: imagePath };
  const assertSourceUnchanged = async (): Promise<void> => {
    const digest = await sha256File(imagePath);
    if (
      digest.sha256 !== expectedSourceDigest.sha256
      || digest.bytes !== expectedSourceDigest.bytes
    ) {
      throw new Error(`image_changed_while_preparing_views:${path.basename(imagePath)}`);
    }
  };
  await assertSourceUnchanged();
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(imagePath).metadata();
  } catch {
    // Tiling is an OCR enhancement. Preserve the pre-existing provider path
    // for formats/fixtures Sharp cannot decode; the provider remains the
    // authority that accepts or rejects the original image evidence.
    await assertSourceUnchanged();
    return [original];
  }
  const width = metadata.width;
  const height = metadata.height;
  if (
    !width
    || !height
    || width >= 1_000
    || height < 600
    || !["png", "jpeg", "webp"].includes(metadata.format ?? "")
  ) {
    await assertSourceUnchanged();
    return [original];
  }

  const tileVersion = "v1-three-vertical-overlap-width1600-sharpen";
  const tileDirectory = path.join(
    path.resolve(stateDir),
    ".cache",
    "image-tiles",
    sha256Text(`${expectedSourceDigest.sha256}\0${tileVersion}`),
  );
  const baseHeight = Math.ceil(height / 3);
  const overlap = Math.min(60, Math.floor(baseHeight / 5));
  const cropHeight = Math.min(height, baseHeight + overlap * 2);
  const tiles: PreparedImageView[] = [];
  for (let index = 0; index < 3; index += 1) {
    const idealTop = Math.floor((index * height) / 3) - overlap;
    const top = Math.max(0, Math.min(height - cropHeight, idealTop));
    const tilePath = path.join(tileDirectory, `${index + 1}-of-3.png`);
    await prepareDeterministicStateArtifactWritePath({
      stateDir,
      artifactPath: tilePath,
      expectedRelativePath: path.join(
        ".cache",
        "image-tiles",
        sha256Text(`${expectedSourceDigest.sha256}\0${tileVersion}`),
        `${index + 1}-of-3.png`,
      ),
    });
    const { temporaryDirectory, temporaryPath } = await createImageTileScratchFilePath(stateDir);
    try {
      await sharp(imagePath)
        .extract({ left: 0, top, width, height: cropHeight })
        .resize({ width: 1_600, kernel: sharp.kernel.lanczos3 })
        .sharpen()
        .png({ compressionLevel: 9 })
        .toFile(temporaryPath);
      const temporaryHandle = await open(temporaryPath, "r+");
      try {
        await temporaryHandle.sync();
      } finally {
        await temporaryHandle.close();
      }
      const generatedDigest = await sha256File(temporaryPath);
      let linked = false;
      try {
        await link(temporaryPath, tilePath);
        linked = true;
      } catch (linkError) {
        if (!(linkError instanceof Error) || !("code" in linkError) || linkError.code !== "EEXIST") {
          throw linkError;
        }
        await verifyDeterministicStateArtifactPath({
          stateDir,
          artifactPath: tilePath,
          expectedRelativePath: path.join(
            ".cache",
            "image-tiles",
            sha256Text(`${expectedSourceDigest.sha256}\0${tileVersion}`),
            `${index + 1}-of-3.png`,
          ),
        });
        const existingDigest = await sha256File(tilePath);
        if (
          existingDigest.sha256 !== generatedDigest.sha256
          || existingDigest.bytes !== generatedDigest.bytes
        ) {
          throw new Error(`image_tile_cache_content_mismatch:${index + 1}-of-3.png`);
        }
      }
      if (linked) await syncDirectoryMetadata(tileDirectory);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
      await rmdir(temporaryDirectory).catch(() => undefined);
    }
    tiles.push({
      path: tilePath,
      viewLabel: `enlarged vertical tile ${index + 1}/3 (same source; overlap may repeat rows)`,
      sourcePath: imagePath,
    });
  }
  await assertSourceUnchanged();
  return [original, ...tiles];
}

async function buildRequests(
  unit: ManifestUnit,
  model: ExtractionModel,
  stateDir: string,
): Promise<ExtractionRequest[]> {
  if (!unit.conversion) return [];
  const snapshot = await readVerifiedConversionSnapshot(unit);
  const textFragments: string[] = [];
  let lineOffset = 0;
  for (const filePath of unit.conversion.text_artifacts) {
    const resolved = path.resolve(filePath);
    const text = snapshot.textByPath.get(resolved);
    const digest = snapshot.digestByPath.get(resolved);
    if (text === undefined || !digest) throw new Error(`verified_text_snapshot_missing:${filePath}`);
    const artifactSources = sourceFilesForArtifact(unit, filePath);
    const sources = artifactSources.map(toSourceReference);
    const isWorkbook = artifactSources.some((source) => source.ext === "xlsx");
    textFragments.push(...labeledTextFragments(
      text,
      digest.sha256,
      sources,
      isWorkbook ? null : lineOffset,
    ));
    lineOffset += text.split(/\r?\n/u).length;
  }
  const textChunks = packTextFragments(textFragments);
  const preparedImageGroups = await Promise.all(
    unit.conversion.image_artifacts.map((imagePath) => {
      const expected = snapshot.digestByPath.get(path.resolve(imagePath));
      if (!expected) throw new Error(`verified_image_snapshot_missing:${imagePath}`);
      return prepareImageViews(imagePath, stateDir, expected);
    }),
  );
  const imageGroups: string[][] = [];
  const imageSourceRefGroups: ExtractionImageSourceReference[][] = [];
  for (const [groupIndex, views] of preparedImageGroups.entries()) {
    if (views.length > MAX_IMAGES_PER_REQUEST) {
      throw new Error("single_image_source_views_exceed_request_limit");
    }
    const imagePaths = views.map((view) => view.path);
    imageGroups.push(imagePaths);
    const originalPath = unit.conversion.image_artifacts[groupIndex];
    const expectedOriginal = originalPath
      ? snapshot.digestByPath.get(path.resolve(originalPath))
      : undefined;
    imageSourceRefGroups.push(await Promise.all(views.map(async (view) => {
      const digest = await sha256File(view.path);
      if (
        view.path === view.sourcePath
        && (!expectedOriginal
          || digest.sha256 !== expectedOriginal.sha256
          || digest.bytes !== expectedOriginal.bytes)
      ) {
        throw new Error(`verified_image_snapshot_changed:${view.path}`);
      }
      return {
        artifactId: digest.sha256,
        sources: sourceFilesForArtifact(unit, view.sourcePath).map(toSourceReference),
        viewLabel: view.viewLabel,
      };
    })));
  }
  const requestCount = Math.max(1, textChunks.length + imageGroups.length);
  if (requestCount > MAX_REQUESTS_PER_UNIT) {
    throw new Error(`한 unit의 추출 요청이 ${MAX_REQUESTS_PER_UNIT}개를 초과합니다. 원본을 사람 검토 후 분할하세요.`);
  }
  const base = {
    unitId: unit.unit_id,
    model,
    canonicalName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
  } as const;
  const requests: ExtractionRequest[] = [
    ...textChunks.map((text) => ({ ...base, text, imagePaths: [], imageSourceRefs: [] })),
    ...imageGroups.map((imagePaths, index) => ({
      ...base,
      text: "",
      imagePaths,
      imageSourceRefs: imageSourceRefGroups[index] ?? [],
    })),
  ];
  return requests.length > 0
    ? requests
    : [{ ...base, text: "", imagePaths: [], imageSourceRefs: [] }];
}

async function deterministicTextMoneyLedger(
  unit: ManifestUnit,
): Promise<NonNullable<DisclosureExtraction["money_occurrences"]>> {
  if (!unit.conversion) return [];
  const snapshot = await readVerifiedConversionSnapshot(unit);
  const ledger: NonNullable<DisclosureExtraction["money_occurrences"]> = [];
  let lineOffset = 0;
  for (const artifactPath of unit.conversion.text_artifacts) {
    const text = snapshot.textByPath.get(path.resolve(artifactPath));
    if (text === undefined) throw new Error(`verified_text_snapshot_missing:${artifactPath}`);
    const sourceFileIds = sourceFilesForArtifact(unit, artifactPath).map(sourceFileId);
    for (const occurrence of scanSourceMoneyOccurrences(text)) {
      const policyContext = /(?:위약|환불|취소|청약|계약금|계약\s*해지|해약)/u.test(occurrence.line_context);
      const localLine = /^line:(\d+)$/u.exec(occurrence.source_locator);
      const sourceLocator = localLine
        ? `line:${lineOffset + Number.parseInt(localLine[1], 10)}`
        : occurrence.source_locator;
      ledger.push({
        amount_krw: occurrence.krw,
        raw_text: occurrence.raw,
        source_quote: `${sourceLocator}: ${
          /^.+![A-Z]+\d+$/u.test(sourceLocator) ? occurrence.raw : occurrence.line_context
        }`,
        source_file_ids: sourceFileIds,
        kind: policyContext ? "policy" : "price",
        needs_review: false,
      });
    }
    lineOffset += text.split(/\r?\n/u).length;
  }
  return ledger;
}

function imageOnlyModelMoneyOccurrences(
  responses: DisclosureExtraction[],
  requests: ExtractionRequest[],
): NonNullable<DisclosureExtraction["money_occurrences"]> {
  return responses.flatMap((response, index) => {
    const request = requests[index];
    if (!request || request.text.trim() || request.imagePaths.length === 0) return [];
    return response.money_occurrences ?? [];
  });
}

function uniqueByValue<T>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function conflictingKeys<T>(
  items: T[],
  identity: (item: T) => string,
  variant: (item: T) => string,
): Set<string> {
  const values = new Map<string, Set<string>>();
  for (const item of items) {
    const key = identity(item);
    const existing = values.get(key) ?? new Set<string>();
    existing.add(variant(item));
    values.set(key, existing);
  }
  return new Set([...values.entries()].filter(([, entries]) => entries.size > 1).map(([key]) => key));
}

function mergeNullableNumber(values: Array<number | null>): { value: number | null; conflict: boolean } {
  const known = [...new Set(values.filter((value): value is number => value !== null))];
  return { value: known.length === 1 ? known[0] : null, conflict: known.length > 1 };
}

function mergeNullableIdentity(values: Array<string | null>): { value: string | null; conflict: boolean } {
  const known = new Map<string, string>();
  for (const value of values) {
    if (value === null) continue;
    const key = value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
    if (!known.has(key)) known.set(key, value);
  }
  return {
    value: known.size === 1 ? [...known.values()][0] : null,
    conflict: known.size > 1,
  };
}

function normalizedChunkIdentity(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("ko-KR");
}

function partnerChunkIdentity(
  item: DisclosureExtraction["partner_vendors"][number],
): string {
  return `${item.category}\0${normalizedChunkIdentity(item.vendor_name)}`;
}

type ExtractedPriceOption = DisclosureExtraction["partner_vendors"][number]["options"][number];
type ExtractedAgencyPackage = DisclosureExtraction["agency_packages"][number];

function mergeEvidenceQuote(
  records: Array<{ source_quote: string; source_file_ids?: string[] }>,
  maxLength: number,
): { quote: string | null; conflict: boolean } {
  const fragments = records.flatMap((record) => {
    const sourceIds = [...new Set(record.source_file_ids ?? [])];
    return sourceIds.length === 1
      ? [{ source_file_id: sourceIds[0], quote: record.source_quote }]
      : [];
  });
  if (fragments.length !== records.length) return { quote: null, conflict: true };
  const quote = encodeMergedEvidenceQuote(fragments, maxLength);
  return { quote, conflict: quote === null };
}

function mergeNullableNormalizedText(values: Array<string | null>): { value: string | null; conflict: boolean } {
  const known = new Map<string, string>();
  for (const value of values) {
    if (value === null) continue;
    const key = normalizedChunkIdentity(value);
    if (!known.has(key)) known.set(key, value);
  }
  return {
    value: known.size === 1 ? [...known.values()][0] : null,
    conflict: known.size > 1,
  };
}

function coalesceComplementaryOptions<T extends ExtractedPriceOption>(
  options: T[],
): { items: T[]; conflict: boolean } {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const option of uniqueByValue(options)) {
    const key = normalizedChunkIdentity(option.name);
    if (!groups.has(key)) order.push(key);
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }
  let conflict = false;
  const items = order.flatMap((key) => {
    const group = groups.get(key) ?? [];
    if (group.length <= 1) return group;
    const minimum = mergeNullableNumber(group.map((option) => option.price_min_krw));
    const maximum = mergeNullableNumber(group.map((option) => option.price_max_krw));
    const unit = mergeNullableNormalizedText(group.map((option) => option.unit));
    const condition = mergeNullableNormalizedText(group.map((option) => option.condition));
    const evidence = mergeEvidenceQuote(group, 1_000);
    if (minimum.conflict || maximum.conflict || unit.conflict || condition.conflict || evidence.conflict) {
      conflict = true;
      return group;
    }
    const base = group.find((option) =>
      option.price_min_krw !== null || option.price_max_krw !== null
    ) ?? group[0];
    return [{
      ...base,
      price_min_krw: minimum.value,
      price_max_krw: maximum.value,
      unit: unit.value,
      condition: condition.value,
      raw_text: [...new Set(group.map((option) => option.raw_text))].join("\n").slice(0, 2_000),
      source_quote: evidence.quote ?? base.source_quote,
      source_file_ids: [...new Set(group.flatMap((option) => option.source_file_ids ?? []))],
    }];
  });
  return { items, conflict };
}

function agencyPackageChunkIdentity(item: ExtractedAgencyPackage): string {
  return normalizedChunkIdentity(item.package_name);
}

function coalesceComplementaryAgencyPackages(
  items: DisclosureExtraction["agency_packages"],
): DisclosureExtraction["agency_packages"] {
  const groups = new Map<string, DisclosureExtraction["agency_packages"]>();
  const order: string[] = [];
  for (const item of uniqueByValue(items)) {
    const key = agencyPackageChunkIdentity(item);
    if (!groups.has(key)) order.push(key);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return order.flatMap((key) => {
    const group = groups.get(key) ?? [];
    if (group.length <= 1) return group;
    const minimum = mergeNullableNumber(group.map((item) => item.price_min_krw));
    const maximum = mergeNullableNumber(group.map((item) => item.price_max_krw));
    const vatNote = mergeNullableNormalizedText(group.map((item) => item.vat_note));
    const priceNote = mergeNullableNormalizedText(group.map((item) => item.price_note));
    const options = coalesceComplementaryOptions(group.flatMap((item) => item.options));
    const categoryVariants = new Map<string, ExtractedAgencyPackage["category_scope"]>();
    for (const item of group) {
      if (item.category_scope.length === 0) continue;
      const normalized = [...item.category_scope].sort();
      categoryVariants.set(JSON.stringify(normalized), normalized);
    }
    const parentEvidenceRows = group.filter((item) =>
      item.price_min_krw !== null
      || item.price_max_krw !== null
      || item.vat_note !== null
      || item.price_note !== null
    );
    const evidenceRows = parentEvidenceRows.length > 0 ? parentEvidenceRows : group;
    const evidence = evidenceRows.length === 1
      ? { quote: evidenceRows[0].source_quote, conflict: false }
      : mergeEvidenceQuote(evidenceRows, 1_000);
    if (
      minimum.conflict
      || maximum.conflict
      || vatNote.conflict
      || priceNote.conflict
      || options.conflict
      || categoryVariants.size > 1
      || evidence.conflict
    ) return group;
    const base = parentEvidenceRows[0] ?? group[0];
    return [{
      ...base,
      category_scope: categoryVariants.size === 1
        ? [...categoryVariants.values()][0]
        : base.category_scope,
      price_min_krw: minimum.value,
      price_max_krw: maximum.value,
      vat_note: vatNote.value,
      price_note: priceNote.value,
      options: options.items,
      source_quote: evidence.quote ?? base.source_quote,
      source_file_ids: [...new Set(evidenceRows.flatMap((item) => item.source_file_ids ?? []))],
      confidence: Math.min(...group.map((item) => item.confidence)),
      needs_review: group.some((item) => item.needs_review),
    }];
  });
}

function coalesceComplementaryPartnerVendors(
  items: DisclosureExtraction["partner_vendors"],
): DisclosureExtraction["partner_vendors"] {
  const groups = new Map<string, DisclosureExtraction["partner_vendors"]>();
  const order: string[] = [];
  for (const item of uniqueByValue(items)) {
    const key = partnerChunkIdentity(item);
    if (!groups.has(key)) order.push(key);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return order.flatMap((key) => {
    const group = groups.get(key) ?? [];
    if (group.length <= 1) return group;
    const options = coalesceComplementaryOptions(group.flatMap((item) => item.options));
    const compatibleNumber = (selector: (item: typeof group[number]) => number | null): boolean =>
      new Set(group.map(selector).filter((value): value is number => value !== null)).size <= 1;
    const compatibleText = (selector: (item: typeof group[number]) => string | null): boolean =>
      new Set(group.map(selector).filter((value): value is string => value !== null).map(normalizedChunkIdentity)).size <= 1;
    if (
      !compatibleNumber((item) => item.price_min_krw)
      || !compatibleNumber((item) => item.price_max_krw)
      || !compatibleText((item) => item.base_spec)
      || !compatibleText((item) => item.price_note)
      || options.conflict
    ) return group;
    const withBaseEvidence = group.find((item) =>
      item.price_min_krw !== null || item.price_max_krw !== null
    ) ?? group[0];
    return [{
      ...withBaseEvidence,
      old_names: [...new Set(group.flatMap((item) => item.old_names))],
      price_min_krw: group.find((item) => item.price_min_krw !== null)?.price_min_krw ?? null,
      price_max_krw: group.find((item) => item.price_max_krw !== null)?.price_max_krw ?? null,
      base_spec: group.find((item) => item.base_spec !== null)?.base_spec ?? null,
      price_note: group.find((item) => item.price_note !== null)?.price_note ?? null,
      options: options.items,
      policies: uniqueByValue(group.flatMap((item) => item.policies ?? [])),
      source_file_ids: [...new Set(group.flatMap((item) => item.source_file_ids ?? []))],
      confidence: Math.min(...group.map((item) => item.confidence)),
      needs_review: group.some((item) => item.needs_review),
    }];
  });
}

type ExtractedHall = NonNullable<DisclosureExtraction["halls"]>[number];

function hallChunkIdentity(item: ExtractedHall): string {
  return item.hall_name === null
    ? "\0unnamed-hall"
    : normalizedChunkIdentity(item.hall_name);
}

function coalesceComplementaryHalls(items: ExtractedHall[]): ExtractedHall[] {
  const groups = new Map<string, ExtractedHall[]>();
  const order: string[] = [];
  for (const item of uniqueByValue(items)) {
    const key = hallChunkIdentity(item);
    if (!groups.has(key)) order.push(key);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return order.flatMap((key) => {
    const group = groups.get(key) ?? [];
    if (group.length <= 1) return group;
    const options = coalesceComplementaryOptions(group.flatMap((item) => item.options));
    const evidence = mergeEvidenceQuote(group, 2_000);
    const compatibleNumber = (selector: (item: ExtractedHall) => number | null): boolean =>
      !mergeNullableNumber(group.map(selector)).conflict;
    const compatibleText = (selector: (item: ExtractedHall) => string | null): boolean =>
      new Set(group.map(selector).filter((value): value is string => value !== null).map(normalizedChunkIdentity)).size <= 1;
    if (
      !compatibleNumber((item) => item.guarantee_min)
      || !compatibleNumber((item) => item.meal_price_min_krw)
      || !compatibleNumber((item) => item.meal_price_max_krw)
      || !compatibleNumber((item) => item.venue_fee_min_krw)
      || !compatibleNumber((item) => item.venue_fee_max_krw)
      || !compatibleText((item) => item.venue_fee_note)
      || !compatibleNumber((item) => item.decoration_fee_min_krw)
      || !compatibleNumber((item) => item.decoration_fee_max_krw)
      || !compatibleText((item) => item.decoration_note)
      || options.conflict
      || evidence.conflict
    ) return group;
    const firstKnownNumber = (selector: (item: ExtractedHall) => number | null): number | null => {
      const item = group.find((candidate) => selector(candidate) !== null);
      return item ? selector(item) : null;
    };
    const firstKnownText = (selector: (item: ExtractedHall) => string | null): string | null => {
      const item = group.find((candidate) => selector(candidate) !== null);
      return item ? selector(item) : null;
    };
    const base = group[0];
    return [{
      ...base,
      guarantee_min: firstKnownNumber((item) => item.guarantee_min),
      meal_price_min_krw: firstKnownNumber((item) => item.meal_price_min_krw),
      meal_price_max_krw: firstKnownNumber((item) => item.meal_price_max_krw),
      venue_fee_min_krw: firstKnownNumber((item) => item.venue_fee_min_krw),
      venue_fee_max_krw: firstKnownNumber((item) => item.venue_fee_max_krw),
      venue_fee_note: firstKnownText((item) => item.venue_fee_note),
      decoration_fee_min_krw: firstKnownNumber((item) => item.decoration_fee_min_krw),
      decoration_fee_max_krw: firstKnownNumber((item) => item.decoration_fee_max_krw),
      decoration_note: firstKnownText((item) => item.decoration_note),
      options: options.items,
      source_quote: evidence.quote ?? base.source_quote,
      source_file_ids: [...new Set(group.flatMap((item) => item.source_file_ids))],
      confidence: Math.min(...group.map((item) => item.confidence)),
      needs_review: group.some((item) => item.needs_review),
    }];
  });
}

export function mergeExtractionChunks(results: DisclosureExtraction[]): DisclosureExtraction {
  const first = results[0];
  if (!first) throw new Error("추출 결과가 비어 있습니다.");
  const kinds = new Set(results.map((result) => result.doc_kind).filter((kind) => kind !== "unknown"));
  const hallSources = results.map((result) => result.hall);
  const allAgencyPackages = coalesceComplementaryAgencyPackages(
    results.flatMap((result) => result.agency_packages),
  );
  const agencyConflicts = conflictingKeys(
    allAgencyPackages,
    agencyPackageChunkIdentity,
    (item) => JSON.stringify(item),
  );
  const allPartnerVendors = coalesceComplementaryPartnerVendors(
    results.flatMap((result) => result.partner_vendors),
  );
  const partnerConflicts = conflictingKeys(
    allPartnerVendors,
    partnerChunkIdentity,
    (item) => JSON.stringify(item),
  );
  const allHallItems = uniqueByValue(hallSources.flatMap((hall) => hall.items));
  const allHalls = coalesceComplementaryHalls(results.flatMap((result) => result.halls ?? []));
  const hallConflicts = conflictingKeys(
    allHalls,
    hallChunkIdentity,
    (item) => JSON.stringify(item),
  );
  const allSections = uniqueByValue(results.flatMap((result) => result.sections ?? []));
  // Occurrence cardinality is evidence: two identical values at the same
  // locator may still be two tokens in the source. Never set-dedupe this list.
  const allMoneyOccurrences = results.flatMap((result) => result.money_occurrences ?? []);
  const hallItemConflicts = conflictingKeys(
    allHallItems,
    (item) => item.name,
    (item) => JSON.stringify(item),
  );
  const venueFee = mergeNullableNumber(hallSources.map((hall) => hall.venue_fee_krw));
  const mealMinimum = mergeNullableNumber(hallSources.map((hall) => hall.meal_price_min_krw));
  const mealMaximum = mergeNullableNumber(hallSources.map((hall) => hall.meal_price_max_krw));
  const businessName = mergeNullableIdentity(results.map((result) => result.business_name));
  const regionHint = mergeNullableIdentity(results.map((result) => result.region_hint));
  const identityConflictFields = [
    businessName.conflict ? "business_name" : null,
    regionHint.conflict ? "region_hint" : null,
  ].filter((field): field is string => field !== null);
  const hasIdentityConflict = identityConflictFields.length > 0;
  const venueFeeSourceQuote = venueFee.conflict || venueFee.value === null
    ? null
    : hallSources.find((hall) =>
      hall.venue_fee_krw === venueFee.value && hall.venue_fee_source_quote
    )?.venue_fee_source_quote ?? null;
  const venueFeeSourceFileIds = venueFee.conflict || venueFee.value === null
    ? []
    : hallSources.find((hall) =>
      hall.venue_fee_krw === venueFee.value && hall.venue_fee_source_quote
    )?.venue_fee_source_file_ids ?? [];
  const mealPriceSourceQuote = mealMinimum.conflict || mealMaximum.conflict
    || (mealMinimum.value === null && mealMaximum.value === null)
    ? null
    : hallSources.find((hall) =>
      (mealMinimum.value === null || hall.meal_price_min_krw === mealMinimum.value)
      && (mealMaximum.value === null || hall.meal_price_max_krw === mealMaximum.value)
      && hall.meal_price_source_quote
    )?.meal_price_source_quote ?? null;
  const mealPriceSourceFileIds = mealMinimum.conflict || mealMaximum.conflict
    || (mealMinimum.value === null && mealMaximum.value === null)
    ? []
    : hallSources.find((hall) =>
      (mealMinimum.value === null || hall.meal_price_min_krw === mealMinimum.value)
      && (mealMaximum.value === null || hall.meal_price_max_krw === mealMaximum.value)
      && hall.meal_price_source_quote
    )?.meal_price_source_file_ids ?? [];
  const hasNonIdentityConflict = kinds.size > 1
    || agencyConflicts.size > 0
    || partnerConflicts.size > 0
    || hallConflicts.size > 0
    || hallItemConflicts.size > 0
    || venueFee.conflict
    || mealMinimum.conflict
    || mealMaximum.conflict;
  const hasConflict = hasIdentityConflict || hasNonIdentityConflict;
  const conflictNote = [
    hasIdentityConflict
      ? `청크 간 ${identityConflictFields.join(", ")} 값이 충돌하여 단일 값을 선택하지 않고 전체 결과를 needs_review로 표시했습니다.`
      : "",
    hasNonIdentityConflict
      ? "청크 간 문서 종류, 비-null 금액 또는 동일 identity 행의 구조가 충돌하여 자동 선택하지 않고 needs_review로 표시했습니다."
      : "",
  ].filter(Boolean).join("\n");
  return {
    doc_kind: kinds.size === 0 ? "unknown" : kinds.size === 1 ? [...kinds][0] : "mixed",
    business_name: businessName.value,
    region_hint: regionHint.value,
    agency_packages: allAgencyPackages.map((item) => hasIdentityConflict || agencyConflicts.has(agencyPackageChunkIdentity(item))
      ? { ...item, needs_review: true, confidence: Math.min(item.confidence, 0.5) }
      : item),
    partner_vendors: allPartnerVendors.map((item) => hasIdentityConflict || partnerConflicts.has(partnerChunkIdentity(item))
      ? { ...item, needs_review: true, confidence: Math.min(item.confidence, 0.5) }
      : item),
    halls: allHalls.map((item) => hasIdentityConflict || hallConflicts.has(hallChunkIdentity(item))
      ? { ...item, needs_review: true, confidence: Math.min(item.confidence, 0.5) }
      : item),
    sections: allSections.map((item) => hasIdentityConflict
      ? { ...item, needs_review: true, confidence: Math.min(item.confidence, 0.5) }
      : item),
    money_occurrences: allMoneyOccurrences.map((item) => hasIdentityConflict
      ? { ...item, needs_review: true }
      : item),
    hall: {
      venue_fee_krw: venueFee.value,
      meal_price_min_krw: mealMinimum.value,
      meal_price_max_krw: mealMaximum.value,
      venue_fee_source_quote: venueFeeSourceQuote,
      meal_price_source_quote: mealPriceSourceQuote,
      venue_fee_source_file_ids: venueFeeSourceFileIds,
      meal_price_source_file_ids: mealPriceSourceFileIds,
      items: allHallItems.map((item) => hasIdentityConflict || hallItemConflicts.has(item.name)
        ? { ...item, needs_review: true, confidence: Math.min(item.confidence, 0.5) }
        : item),
      confidence: Math.min(...hallSources.map((hall) => hall.confidence)),
      needs_review: hasConflict || hallSources.some((hall) => hall.needs_review),
    },
    extraction_notes: [
      ...results.map((result) => result.extraction_notes).filter(Boolean),
      conflictNote,
    ].filter(Boolean).join("\n").slice(0, 4_000),
  };
}

function retryStatus(error: unknown): number | null {
  if (!(error instanceof Error) || !("status" in error) || typeof error.status !== "number") return null;
  return error.status;
}

function providerErrorStrings(error: unknown): string[] {
  const values: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 2 || !value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of ["code", "type", "message"]) {
      if (typeof record[key] === "string") values.push(record[key].toLowerCase());
    }
    visit(record.error, depth + 1);
    visit(record.cause, depth + 1);
  };
  visit(error, 0);
  return values;
}

export function isPermanentProviderBillingFailure(error: unknown): boolean {
  if (retryStatus(error) !== 429) return false;
  return providerErrorStrings(error).some((value) =>
    value.includes("insufficient_quota")
    || value.includes("billing_hard_limit_reached")
    || value.includes("billing hard limit")
  );
}

export function isRetryableExtractionProviderError(error: unknown): boolean {
  const status = retryStatus(error);
  return (status === 429 && !isPermanentProviderBillingFailure(error))
    || (status !== null && status >= 500 && status <= 599);
}

const MAX_RETRY_DELAY_MILLISECONDS = 60_000;

function retryAfterValue(error: unknown): string | null {
  if (!(error instanceof Error) || !("headers" in error)) return null;
  const headers = error.headers;
  if (headers instanceof Headers) return headers.get("retry-after");
  if (!headers || typeof headers !== "object") return null;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "retry-after") continue;
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value) && (typeof value[0] === "string" || typeof value[0] === "number")) {
      return String(value[0]);
    }
  }
  return null;
}

export function computeRetryDelayMilliseconds(
  error: unknown,
  retryIndex: number,
  nowMilliseconds = Date.now(),
): number {
  const boundedRetryIndex = Number.isSafeInteger(retryIndex) && retryIndex >= 0
    ? Math.min(retryIndex, 20)
    : 0;
  const exponentialDelay = 250 * (2 ** boundedRetryIndex);
  const retryAfter = retryAfterValue(error)?.trim();
  let providerDelay = 0;
  if (retryAfter && /^\d+(?:\.\d+)?$/u.test(retryAfter)) {
    const seconds = Number(retryAfter);
    providerDelay = Number.isFinite(seconds)
      ? Math.ceil(seconds * 1_000)
      : MAX_RETRY_DELAY_MILLISECONDS;
  } else if (retryAfter) {
    const parsedDate = Date.parse(retryAfter);
    if (Number.isFinite(parsedDate)) providerDelay = Math.max(0, parsedDate - nowMilliseconds);
  }
  return Math.min(
    MAX_RETRY_DELAY_MILLISECONDS,
    Math.max(0, exponentialDelay, Number.isFinite(providerDelay) ? providerDelay : 0),
  );
}

function safeRequestId(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if ("request_id" in error && typeof error.request_id === "string") return error.request_id.slice(0, 200);
  if ("requestId" in error && typeof error.requestId === "string") return error.requestId.slice(0, 200);
  return null;
}

function safeProviderUsage(error: unknown): NormalizedProviderUsage {
  if (!(error instanceof Error)) return normalizeProviderUsage(null);
  return normalizeProviderUsage(error);
}

function safeOwnershipAudit(error: unknown): {
  rejected_locator: string | null;
  allowed_locator_count: number | null;
  allowed_locator_set_sha256: string | null;
  locator_violation: "not_in_request" | "not_exact_single_cell" | null;
  rejected_occurrence_index: number | null;
} {
  if (!(error instanceof ExtractionProviderResponseError)) {
    return {
      rejected_locator: null,
      allowed_locator_count: null,
      allowed_locator_set_sha256: null,
      locator_violation: null,
      rejected_occurrence_index: null,
    };
  }
  return {
    rejected_locator: error.rejectedLocator ?? null,
    allowed_locator_count: error.allowedLocatorCount ?? null,
    allowed_locator_set_sha256: error.allowedLocatorSetSha256 ?? null,
    locator_violation: error.locatorViolation ?? null,
    rejected_occurrence_index: error.rejectedOccurrenceIndex ?? null,
  };
}

function repairRequestForInvalidResponse(
  request: ExtractionRequest,
  error: unknown,
): ExtractionRequest {
  if (
    error instanceof ExtractionProviderResponseError
    && error.textQuoteEvidencePath
  ) {
    return {
      ...request,
      repair: {
        reason: "text_quote_contiguity",
        rejectedPath: error.textQuoteEvidencePath,
      },
    };
  }
  if (
    error instanceof ExtractionProviderResponseError
    && error.structuredEvidencePath
  ) {
    return {
      ...request,
      repair: {
        reason: "structured_numeric_evidence",
        rejectedPath: error.structuredEvidencePath,
      },
    };
  }
  if (
    error instanceof ExtractionProviderResponseError
    && error.rejectedSourceFileId
    && error.allowedSourceFileCount !== undefined
    && error.allowedSourceFileSetSha256
  ) {
    const allowed = allowedSourceFileIds(request);
    if (
      allowed.length !== error.allowedSourceFileCount
      || sha256Text(allowed.join("\n")) !== error.allowedSourceFileSetSha256
    ) {
      throw new Error("source_file_repair_allowlist_integrity_failure");
    }
    return {
      ...request,
      repair: {
        reason: "source_file_ownership",
        rejectedSourceFileId: error.rejectedSourceFileId,
        allowedSourceFileIds: allowed,
        allowedSourceFileSetSha256: error.allowedSourceFileSetSha256,
      },
    };
  }
  if (
    error instanceof ExtractionProviderResponseError
    && error.rejectedOccurrenceIndex !== undefined
  ) {
    return {
      ...request,
      repair: {
        reason: error.imageEvidenceViolation === "amount_quote_mismatch"
          ? "image_money_evidence_mismatch"
          : "image_non_currency_percentage",
        rejectedOccurrenceIndex: error.rejectedOccurrenceIndex,
      },
    };
  }
  if (
    !(error instanceof ExtractionProviderResponseError)
    || !error.rejectedLocator
    || error.allowedLocatorCount === undefined
    || !error.allowedLocatorSetSha256
  ) {
    return request;
  }
  const allowed = allowedXlsxLocators(request);
  if (
    allowed.length !== error.allowedLocatorCount
    || sha256Text(allowed.join("\n")) !== error.allowedLocatorSetSha256
  ) {
    throw new Error("xlsx_locator_repair_allowlist_integrity_failure");
  }
  return {
    ...request,
    repair: {
      reason: "xlsx_locator_ownership",
      rejectedLocator: error.rejectedLocator,
      allowedXlsxLocators: allowed,
      allowedLocatorSetSha256: error.allowedLocatorSetSha256,
    },
  };
}

function staticValidationRetryRequest(request: ExtractionRequest): ExtractionRequest {
  const allowedLocators = allowedXlsxLocators(request);
  const allowedSourceIds = allowedSourceFileIds(request);
  return {
    ...request,
    repair: {
      reason: "static_validation_retry",
      allowedXlsxLocators: allowedLocators,
      allowedLocatorSetSha256: sha256Text(allowedLocators.join("\n")),
      allowedSourceFileIds: allowedSourceIds,
      allowedSourceFileSetSha256: sha256Text(allowedSourceIds.join("\n")),
    },
  };
}

function safeErrorCategory(error: unknown): "rate_limit" | "provider_5xx" | "timeout" | "network" | "invalid_response" | "unknown" {
  if (error instanceof ExtractionProviderResponseError) return "invalid_response";
  const status = retryStatus(error);
  if (isPermanentProviderBillingFailure(error)) return "unknown";
  if (status === 429) return "rate_limit";
  if (status !== null && status >= 500 && status <= 599) return "provider_5xx";
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "timeout";
  if (error instanceof Error && ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].some((code) => error.message.includes(code))) return "network";
  if (error instanceof Error && /구조화 출력|검증/u.test(error.message)) return "invalid_response";
  return "unknown";
}

interface AttemptAudit {
  attempt: number;
  requestHash: string;
  reservedCostUsd: number;
  latencyMs: number;
  result: ExtractionProviderResult | null;
  error: unknown;
}

export interface PaidCallCostReservation {
  maximumInputTokens: number;
  maximumOutputTokens: number;
  maximumCostUsd: number;
}

class UncachedPaidCallCostFenceError extends Error {
  constructor(limitUsd: number, committedUsd: number, reservedUsd: number) {
    super(
      `uncached_paid_call_cost_fence: limit_usd=${limitUsd.toFixed(6)} committed_usd=${committedUsd.toFixed(6)} next_call_reserve_usd=${reservedUsd.toFixed(6)}`,
    );
    this.name = "UncachedPaidCallCostFenceError";
  }
}

class PaidProviderUsageExceededReservationError extends Error {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number | null;
  readonly cacheWriteInputTokens: number | null;
  readonly usageReported: boolean;
  readonly requestId?: string;

  constructor(result: ExtractionProviderResult) {
    super("paid_provider_usage_exceeded_plan_reservation_manual_reconciliation");
    this.name = "PaidProviderUsageExceededReservationError";
    const usage = normalizeProviderUsage(result);
    this.inputTokens = usage.inputTokens;
    this.outputTokens = usage.outputTokens;
    this.cachedInputTokens = usage.cachedInputTokens;
    this.cacheWriteInputTokens = usage.cacheWriteInputTokens;
    this.usageReported = usage.usageReported;
    if (result.requestId) this.requestId = result.requestId;
  }
}

export function assertPaidProviderUsageWithinReservation(
  model: ExtractionModel,
  result: ExtractionProviderResult,
  reservation: PaidCallCostReservation,
): void {
  const usage = normalizeProviderUsage(result);
  const reportedCostUsd = usageReportedExtractionCostUsd(model, result).costUsd;
  if (
    usage.usageReported
    && (
      usage.inputTokens > reservation.maximumInputTokens
      || usage.outputTokens > reservation.maximumOutputTokens
      || (reportedCostUsd !== null
        && costUsdToNanoUsdCeil(reportedCostUsd)
          > costUsdToNanoUsdCeil(reservation.maximumCostUsd))
    )
  ) {
    throw new PaidProviderUsageExceededReservationError(result);
  }
}

function usageReportedExtractionCostUsd(
  model: ExtractionModel,
  value: unknown,
): { usage: NormalizedProviderUsage; costUsd: number | null } {
  const usage = normalizeProviderUsage(value);
  if (!usage.usageReported) return { usage, costUsd: null };
  return {
    usage,
    costUsd: estimateExtractionCostUsd(
      model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens !== null && usage.cacheWriteInputTokens !== null
        ? {
          cachedInputTokens: usage.cachedInputTokens,
          cacheWriteInputTokens: usage.cacheWriteInputTokens,
        }
        : undefined,
    ),
  };
}

class UncachedPaidCallCostFence {
  private committedUsd: number;

  constructor(
    private readonly model: ExtractionModel,
    private readonly limitUsd: number,
    initialCommittedUsd = 0,
  ) {
    this.committedUsd = initialCommittedUsd;
  }

  modelForUsageValidation(): ExtractionModel {
    return this.model;
  }

  reserve(request: ExtractionRequest, providerBounded = false): PaidCallCostReservation {
    const maximumInputTokens = providerBounded
      ? PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND
      : maximumRequestInputTokens(request);
    const maximumOutputTokens = providerBounded
      ? PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP
      : MAX_OUTPUT_TOKENS;
    const maximumCostUsd = estimateExtractionCostUsd(
      this.model,
      maximumInputTokens,
      maximumOutputTokens,
    );
    if (this.committedUsd + maximumCostUsd > this.limitUsd + Number.EPSILON) {
      throw new UncachedPaidCallCostFenceError(this.limitUsd, this.committedUsd, maximumCostUsd);
    }
    return { maximumInputTokens, maximumOutputTokens, maximumCostUsd };
  }

  settle(reservedUsd: number, value: unknown): void {
    const knownCost = usageReportedExtractionCostUsd(this.model, value).costUsd;
    // A failed/transport response may omit usage even if the upstream accepted
    // the request. Debit the reservation in that ambiguous case so retries
    // cannot silently exceed the configured ceiling.
    this.committedUsd += knownCost !== null && knownCost > 0 ? knownCost : reservedUsd;
  }
}

interface PaidCallAttemptHooks {
  begin(input: {
    attempt: number;
    requestHash: string;
    reservation: PaidCallCostReservation;
  }): Promise<PaidCallIntent>;
}

async function extractWithRetry(
  provider: ExtractionProvider,
  request: ExtractionRequest,
  sleep: (milliseconds: number) => Promise<void>,
  auditAttempt: (audit: AttemptAudit) => Promise<string>,
  costFence: UncachedPaidCallCostFence,
  hashRequest: (request: ExtractionRequest) => Promise<string>,
  invalidResponseRepair: (request: ExtractionRequest, error: unknown) => ExtractionRequest,
  paidCallHooks?: PaidCallAttemptHooks,
): Promise<{
  result: ExtractionProviderResult;
  attempts: number;
  billedInputTokens: number;
  billedOutputTokens: number;
  attemptRequestHashes: string[];
  successfulRequestHash: string;
  paidCallIntents: PaidCallIntent[];
  successLedgerId: string;
}> {
  let serverRetries = 0;
  let invalidResponseRetries = 0;
  let billedInputTokens = 0;
  let billedOutputTokens = 0;
  let attemptRequest = request;
  const attemptRequestHashes: string[] = [];
  const paidCallIntents: PaidCallIntent[] = [];
  for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt += 1) {
    const attemptRequestHash = await hashRequest(attemptRequest);
    attemptRequestHashes.push(attemptRequestHash);
    const costReservation = costFence.reserve(attemptRequest, paidCallHooks !== undefined);
    const costReservationUsd = costReservation.maximumCostUsd;
    const paidCallIntent = paidCallHooks
      ? await paidCallHooks.begin({
          attempt,
          requestHash: attemptRequestHash,
          reservation: costReservation,
        })
      : null;
    if (paidCallIntent) paidCallIntents.push(paidCallIntent);
    const startedAt = Date.now();
    let result: ExtractionProviderResult;
    try {
      const candidate = await provider.extract(attemptRequest);
      const candidateUsage = normalizeProviderUsage(candidate);
      const parsed = DisclosureExtractionSchema.safeParse(candidate.data);
      if (!parsed.success) {
        throw new ExtractionProviderResponseError(
          `OpenAI 구조화 출력 검증에 실패했습니다: ${parsed.error.issues[0]?.message ?? "unknown"}`,
          {
            ...candidateUsage,
            requestId: candidate.requestId,
          },
        );
      }
      result = { ...candidate, ...candidateUsage, data: parsed.data };
      assertBatchEvidenceOwnership(result.data, attemptRequest, {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedInputTokens: result.cachedInputTokens,
        cacheWriteInputTokens: result.cacheWriteInputTokens,
        usageReported: result.usageReported,
        ...(result.requestId ? { requestId: result.requestId } : {}),
      });
      if (paidCallHooks) assertPaidProviderUsageWithinReservation(
        costFence.modelForUsageValidation(),
        result,
        costReservation,
      );
    } catch (error) {
      const failedUsage = safeProviderUsage(error);
      costFence.settle(costReservationUsd, failedUsage);
      billedInputTokens += failedUsage.inputTokens;
      billedOutputTokens += failedUsage.outputTokens;
      await auditAttempt({
        attempt,
        requestHash: attemptRequestHash,
        reservedCostUsd: costReservationUsd,
        latencyMs: Date.now() - startedAt,
        result: null,
        error,
      });
      const category = safeErrorCategory(error);
      if (category === "invalid_response" && invalidResponseRetries < 1) {
        invalidResponseRetries += 1;
        attemptRequest = invalidResponseRepair(request, error);
        continue;
      }
      if (isRetryableExtractionProviderError(error) && category === "rate_limit" && serverRetries < 3) {
        await sleep(computeRetryDelayMilliseconds(error, serverRetries));
        serverRetries += 1;
        continue;
      }
      throw error;
    }
    billedInputTokens += result.inputTokens;
    billedOutputTokens += result.outputTokens;
    costFence.settle(costReservationUsd, result);
    const successLedgerId = await auditAttempt({
      attempt,
      requestHash: attemptRequestHash,
      reservedCostUsd: costReservationUsd,
      latencyMs: Date.now() - startedAt,
      result,
      error: null,
    });
    return {
      result,
      attempts: attempt,
      billedInputTokens,
      billedOutputTokens,
      attemptRequestHashes,
      successfulRequestHash: attemptRequestHash,
      paidCallIntents,
      successLedgerId,
    };
  }
  throw new Error("도달할 수 없는 재시도 상태입니다.");
}

interface ExtractionCacheIdentity {
  stateDir: string;
  fingerprint: string;
  unitId: string;
  sourceFingerprint: string;
  artifactFingerprint: string;
  scannerParserVersion: string;
  converterVersion: string;
  model: ExtractionModel;
  providerMode: ExtractionProviderMode;
  paidPlanSha256: string | null;
  canonicalIdentity: ExtractionBatchCheckpoint["canonical_identity"];
  unit: ManifestUnit;
  requests: ExtractionRequest[];
  batchIdentities: Array<{
    fingerprint: string;
    identity: BatchCheckpointIdentity;
  }>;
}

async function finalizeExtractionResponses(
  unit: ManifestUnit,
  responses: DisclosureExtraction[],
  requests: ExtractionRequest[],
): Promise<{
  data: DisclosureExtraction;
  evidenceModalities: NonNullable<ExtractionArtifact["evidence_modalities"]>;
}> {
  const merged = mergeExtractionChunks(responses);
  const textLedger = await deterministicTextMoneyLedger(unit);
  if ((unit.conversion?.text_artifacts.length ?? 0) > 0) {
    merged.money_occurrences = [
      ...textLedger,
      ...imageOnlyModelMoneyOccurrences(responses, requests),
    ];
  }
  const data = DisclosureExtractionSchema.parse(merged);
  return {
    data,
    evidenceModalities: extractionEvidenceModalities(
      data,
      responses,
      requests,
      textLedger,
    ),
  };
}

async function readCache(
  cachePath: string,
  expected: ExtractionCacheIdentity,
): Promise<StrictExtractionArtifact | null> {
  try {
    await verifyDeterministicStateArtifactPath({
      stateDir: expected.stateDir,
      artifactPath: cachePath,
      expectedRelativePath: path.join(".cache", "extract", `${expected.fingerprint}.json`),
    });
    const raw = await readJsonFile(cachePath);
    const parsed = StrictExtractionArtifactSchema.safeParse(raw);
    if (!parsed.success) throw new Error("extract_cache_invalid:schema_or_legacy_artifact");
    verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
    const artifact = parsed.data;
    if (
      artifact.fingerprint !== expected.fingerprint
      || artifact.unit_id !== expected.unitId
      || artifact.source_fingerprint !== expected.sourceFingerprint
      || artifact.artifact_fingerprint !== expected.artifactFingerprint
      || artifact.prompt_version !== EXTRACTION_PROMPT_VERSION
      || artifact.prompt_hash !== EXTRACTION_PROMPT_HASH
      || artifact.processing_version !== EXTRACTION_PROCESSING_VERSION
      || artifact.scanner_parser_version !== expected.scannerParserVersion
      || artifact.converter_version !== expected.converterVersion
      || artifact.model !== expected.model
      || artifact.provider_mode !== expected.providerMode
      || artifact.paid_plan_sha256 !== expected.paidPlanSha256
    ) {
      throw new Error("extract_cache_invalid:identity_mismatch");
    }
    let paidPlanUnit: PaidExtractionPlanApproval["payload"]["units"][number] | null = null;
    if (expected.providerMode === "production_paid" && expected.paidPlanSha256) {
      const paidPlan = await readFixedEightPaidExtractionPlanApproval(
        expected.stateDir,
        expected.paidPlanSha256,
      );
      paidPlanUnit = paidPlan.payload.units.find((unit) => unit.unit_id === expected.unitId) ?? null;
      if (!paidPlanUnit
        || paidPlan.payload.model !== expected.model
        || paidPlanUnit.source_fingerprint !== expected.sourceFingerprint
        || paidPlanUnit.artifact_fingerprint !== expected.artifactFingerprint
        || paidPlanUnit.converter_version !== expected.converterVersion
        || paidPlanUnit.request_hashes.length !== expected.batchIdentities.length
        || paidPlanUnit.request_hashes.some(
          (requestHash, index) => requestHash !== expected.batchIdentities[index]?.identity.requestHash,
        )) {
        throw new Error("extract_cache_invalid:paid_plan_unit_mismatch");
      }
    }
    if (expected.providerMode === "production_paid" && !paidPlanUnit) {
      throw new Error("extract_cache_invalid:paid_plan_unit_missing");
    }
    if (
      artifact.batch_checkpoint_fingerprints.length !== expected.batchIdentities.length
      || artifact.batch_checkpoint_result_hashes.length !== expected.batchIdentities.length
      || artifact.batch_checkpoint_fingerprints.some(
        (fingerprint, index) => fingerprint !== expected.batchIdentities[index]?.fingerprint,
      )
    ) {
      throw new Error("extract_cache_invalid:checkpoint_set_mismatch");
    }
    const checkpoints: ExtractionBatchCheckpoint[] = [];
    for (const [batchIndex, checkpointFingerprint] of artifact.batch_checkpoint_fingerprints.entries()) {
      const checkpointPath = path.join(
        path.resolve(expected.stateDir),
        ".cache",
        "extract-batches",
        `${checkpointFingerprint}.json`,
      );
      await verifyDeterministicStateArtifactPath({
        stateDir: expected.stateDir,
        artifactPath: checkpointPath,
        expectedRelativePath: path.join(
          ".cache",
          "extract-batches",
          `${checkpointFingerprint}.json`,
        ),
      });
      const checkpointRaw = await readJsonFile(checkpointPath);
      const checkpointParsed = ExtractionBatchCheckpointSchema.safeParse(checkpointRaw);
      if (!checkpointParsed.success) throw new Error("extract_cache_invalid:checkpoint_schema");
      verifyJsonContentHash(checkpointRaw as Record<string, unknown>, "content_sha256");
      const checkpoint = checkpointParsed.data;
      const expectedBatch = expected.batchIdentities[batchIndex];
      if (!expectedBatch) throw new Error("extract_cache_invalid:checkpoint_set_mismatch");
      const recomputedCheckpointFingerprint = batchCheckpointFingerprint({
        unitId: checkpoint.unit_id,
        batchIndex: checkpoint.batch_index,
        model: checkpoint.model,
        providerMode: checkpoint.provider_mode,
        paidPlanSha256: checkpoint.paid_plan_sha256,
        extractionFingerprint: checkpoint.extraction_fingerprint,
        canonicalIdentity: checkpoint.canonical_identity,
        artifactFingerprint: checkpoint.artifact_fingerprint,
        requestHash: checkpoint.request_hash,
        scannerParserVersion: checkpoint.scanner_parser_version,
        converterVersion: checkpoint.converter_version,
      });
      const recomputedResultHash = batchCheckpointResultHash({
        data: checkpoint.data,
        attempts: checkpoint.attempts,
        inputTokens: checkpoint.input_tokens,
        outputTokens: checkpoint.output_tokens,
        requestId: checkpoint.request_id,
        attemptRequestHashes: checkpoint.attempt_request_hashes,
        successfulRequestHash: checkpoint.successful_request_hash,
        successLedgerId: checkpoint.success_ledger_id,
        successfulInputTokens: checkpoint.successful_input_tokens,
        successfulOutputTokens: checkpoint.successful_output_tokens,
      });
      if (
        checkpoint.checkpoint_fingerprint !== checkpointFingerprint
        || recomputedCheckpointFingerprint !== checkpointFingerprint
        || checkpoint.result_hash !== artifact.batch_checkpoint_result_hashes[batchIndex]
        || recomputedResultHash !== checkpoint.result_hash
        || checkpoint.unit_id !== expected.unitId
        || checkpoint.batch_index !== batchIndex
        || checkpoint.prompt_version !== EXTRACTION_PROMPT_VERSION
        || checkpoint.prompt_hash !== EXTRACTION_PROMPT_HASH
        || checkpoint.processing_version !== EXTRACTION_PROCESSING_VERSION
        || checkpoint.scanner_parser_version !== expected.scannerParserVersion
        || checkpoint.converter_version !== expected.converterVersion
        || checkpoint.model !== expected.model
        || checkpoint.provider_mode !== expected.providerMode
        || checkpoint.paid_plan_sha256 !== expected.paidPlanSha256
        || checkpoint.extraction_fingerprint !== expected.fingerprint
        || checkpoint.artifact_fingerprint !== expected.artifactFingerprint
        || JSON.stringify(checkpoint.canonical_identity) !== JSON.stringify(expected.canonicalIdentity)
        || checkpoint.request_hash !== expectedBatch.identity.requestHash
        || checkpoint.attempt_request_hashes.length !== checkpoint.attempts
        || checkpoint.attempt_request_hashes[0] !== expectedBatch.identity.requestHash
        || checkpoint.successful_request_hash !== checkpoint.attempt_request_hashes.at(-1)
        || (paidPlanUnit !== null && checkpoint.attempt_request_hashes.some(
          (requestHash) => !paidPlanUnit.authorized_request_hashes_by_batch[batchIndex]?.includes(requestHash),
        ))
      ) {
        throw new Error("extract_cache_invalid:checkpoint_identity");
      }
      checkpoints.push(checkpoint);
    }
    await assertSuccessfulCheckpointLedgerBindings(expected.stateDir, artifact, checkpoints);
    const finalized = await finalizeExtractionResponses(
      expected.unit,
      checkpoints.map((checkpoint) => checkpoint.data),
      expected.requests,
    );
    if (
      !isDeepStrictEqual(artifact.data, finalized.data)
      || !isDeepStrictEqual(artifact.evidence_modalities ?? [], finalized.evidenceModalities)
      || artifact.attempts !== checkpoints.reduce((sum, checkpoint) => sum + checkpoint.attempts, 0)
      || artifact.input_tokens !== checkpoints.reduce((sum, checkpoint) => sum + checkpoint.input_tokens, 0)
      || artifact.output_tokens !== checkpoints.reduce((sum, checkpoint) => sum + checkpoint.output_tokens, 0)
    ) {
      throw new Error("extract_cache_invalid:finalization_mismatch");
    }
    return artifact;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

interface BatchCheckpointIdentity {
  unitId: string;
  batchIndex: number;
  model: ExtractionModel;
  providerMode: ExtractionProviderMode;
  paidPlanSha256: string | null;
  extractionFingerprint: string;
  canonicalIdentity: ExtractionBatchCheckpoint["canonical_identity"];
  artifactFingerprint: string;
  requestHash: string;
  scannerParserVersion: string;
  converterVersion: string;
}

function batchCheckpointFingerprint(identity: BatchCheckpointIdentity): string {
  return sha256Text(JSON.stringify({
    schema_version: 3,
    provider_mode: identity.providerMode,
    paid_plan_sha256: identity.paidPlanSha256,
    unit_id: identity.unitId,
    batch_index: identity.batchIndex,
    prompt_version: EXTRACTION_PROMPT_VERSION,
    prompt_hash: EXTRACTION_PROMPT_HASH,
    processing_version: EXTRACTION_PROCESSING_VERSION,
    scanner_parser_version: identity.scannerParserVersion,
    converter_version: identity.converterVersion,
    model: identity.model,
    canonical_identity: identity.canonicalIdentity,
    artifact_fingerprint: identity.artifactFingerprint,
    extraction_fingerprint: identity.extractionFingerprint,
    request_hash: identity.requestHash,
  }));
}

function batchCheckpointResultHash(result: {
  data: DisclosureExtraction;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  requestId: string | null;
  attemptRequestHashes: string[];
  successfulRequestHash: string;
  successLedgerId: string;
  successfulInputTokens: number;
  successfulOutputTokens: number;
}): string {
  return sha256Text(JSON.stringify({
    data: result.data,
    attempts: result.attempts,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    request_id: result.requestId,
    attempt_request_hashes: result.attemptRequestHashes,
    successful_request_hash: result.successfulRequestHash,
    success_ledger_id: result.successLedgerId,
    successful_input_tokens: result.successfulInputTokens,
    successful_output_tokens: result.successfulOutputTokens,
  }));
}

function isNewLedgerEntry(entry: AiLedgerEntry): entry is NewAiLedgerEntry {
  return entry.schema_version === 3;
}

function assertCheckpointSuccessLedgerMatch(
  checkpoint: ExtractionBatchCheckpoint,
  ledgerEntry: AiLedgerEntry | undefined,
): asserts ledgerEntry is NewAiLedgerEntry {
  if (!ledgerEntry || !isNewLedgerEntry(ledgerEntry)) {
    throw new Error("checkpoint_success_ledger_row_missing_or_legacy");
  }
  if (
    ledgerEntry.ledger_id !== checkpoint.success_ledger_id
    || ledgerEntry.provider_mode !== checkpoint.provider_mode
    || ledgerEntry.paid_plan_sha256 !== checkpoint.paid_plan_sha256
    || ledgerEntry.unit_id !== checkpoint.unit_id
    || ledgerEntry.fingerprint !== checkpoint.extraction_fingerprint
    || ledgerEntry.batch_index !== checkpoint.batch_index
    || ledgerEntry.attempt !== checkpoint.attempts
    || ledgerEntry.request_hash !== checkpoint.successful_request_hash
    || ledgerEntry.model !== checkpoint.model
    || ledgerEntry.prompt_version !== checkpoint.prompt_version
    || ledgerEntry.success !== true
    || ledgerEntry.error_category !== null
    || ledgerEntry.request_id !== checkpoint.request_id
    || ledgerEntry.input_tokens !== checkpoint.successful_input_tokens
    || ledgerEntry.output_tokens !== checkpoint.successful_output_tokens
  ) {
    throw new Error("checkpoint_success_ledger_provenance_mismatch");
  }
}

async function assertSuccessfulCheckpointLedgerBindings(
  stateDir: string,
  artifact: Pick<
    StrictExtractionArtifact,
    "provider_mode" | "paid_plan_sha256" | "unit_id" | "fingerprint"
  >,
  checkpoints: ExtractionBatchCheckpoint[],
): Promise<void> {
  const ledger = await readAiLedger(stateDir);
  const ledgerById = new Map(ledger.map((entry) => [entry.ledger_id, entry]));
  const checkpointLedgerIds = new Set<string>();
  for (const checkpoint of checkpoints) {
    if (
      checkpoint.provider_mode !== artifact.provider_mode
      || checkpoint.paid_plan_sha256 !== artifact.paid_plan_sha256
      || checkpoint.unit_id !== artifact.unit_id
      || checkpoint.extraction_fingerprint !== artifact.fingerprint
      || checkpointLedgerIds.has(checkpoint.success_ledger_id)
    ) {
      throw new Error("checkpoint_success_ledger_artifact_mismatch");
    }
    assertCheckpointSuccessLedgerMatch(
      checkpoint,
      ledgerById.get(checkpoint.success_ledger_id),
    );
    checkpointLedgerIds.add(checkpoint.success_ledger_id);
  }
  const matchingSuccessfulRows = ledger.filter((entry) => isNewLedgerEntry(entry)
    && entry.provider_mode === artifact.provider_mode
    && entry.paid_plan_sha256 === artifact.paid_plan_sha256
    && entry.unit_id === artifact.unit_id
    && entry.fingerprint === artifact.fingerprint
    && entry.success);
  if (
    matchingSuccessfulRows.length !== checkpointLedgerIds.size
    || matchingSuccessfulRows.some((entry) => !checkpointLedgerIds.has(entry.ledger_id))
  ) {
    throw new Error("success_ledger_checkpoint_reverse_binding_mismatch");
  }
}

async function extractionRequestHash(
  request: ExtractionRequest,
  processingContext: { scannerParserVersion: string; converterVersion: string },
): Promise<string> {
  const images = await Promise.all(request.imagePaths.map(async (imagePath, index) => {
    const digest = await sha256File(imagePath);
    const provenance = request.imageSourceRefs[index];
    if (!provenance || digest.sha256 !== provenance.artifactId) {
      throw new Error(`request_image_digest_mismatch:${path.basename(imagePath)}`);
    }
    return {
      sha256: digest.sha256,
      bytes: digest.bytes,
      provenance,
    };
  }));
  return sha256Text(JSON.stringify({
    processing_version: EXTRACTION_PROCESSING_VERSION,
    scanner_parser_version: processingContext.scannerParserVersion,
    converter_version: processingContext.converterVersion,
    unit_id: request.unitId,
    model: request.model,
    canonical_name: request.canonicalName,
    region_code: request.regionCode,
    kind_hint: request.kindHint,
    text: request.text,
    images,
    repair: request.repair ?? null,
  }));
}

async function readBatchCheckpoint(
  checkpointPath: string,
  stateDir: string,
  expectedIdentity: BatchCheckpointIdentity,
  expectedFingerprint: string,
  authorizedAttemptRequestHashes?: readonly string[],
): Promise<ExtractionBatchCheckpoint | null> {
  try {
    await verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath: checkpointPath,
      expectedRelativePath: path.join(
        ".cache",
        "extract-batches",
        `${expectedFingerprint}.json`,
      ),
    });
    const raw = await readJsonFile(checkpointPath);
    const parsed = ExtractionBatchCheckpointSchema.safeParse(raw);
    if (!parsed.success || parsed.data.checkpoint_fingerprint !== expectedFingerprint) {
      throw new Error("batch_checkpoint_invalid");
    }
    verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
    if (
      parsed.data.schema_version !== 3
      || parsed.data.unit_id !== expectedIdentity.unitId
      || parsed.data.batch_index !== expectedIdentity.batchIndex
      || parsed.data.prompt_version !== EXTRACTION_PROMPT_VERSION
      || parsed.data.prompt_hash !== EXTRACTION_PROMPT_HASH
      || parsed.data.processing_version !== EXTRACTION_PROCESSING_VERSION
      || parsed.data.scanner_parser_version !== expectedIdentity.scannerParserVersion
      || parsed.data.converter_version !== expectedIdentity.converterVersion
      || parsed.data.model !== expectedIdentity.model
      || parsed.data.provider_mode !== expectedIdentity.providerMode
      || parsed.data.paid_plan_sha256 !== expectedIdentity.paidPlanSha256
      || parsed.data.extraction_fingerprint !== expectedIdentity.extractionFingerprint
      || JSON.stringify(parsed.data.canonical_identity) !== JSON.stringify(expectedIdentity.canonicalIdentity)
      || parsed.data.artifact_fingerprint !== expectedIdentity.artifactFingerprint
      || parsed.data.request_hash !== expectedIdentity.requestHash
      || parsed.data.attempt_request_hashes.length !== parsed.data.attempts
      || parsed.data.attempt_request_hashes[0] !== expectedIdentity.requestHash
      || parsed.data.successful_request_hash !== parsed.data.attempt_request_hashes.at(-1)
      || (expectedIdentity.providerMode === "production_paid" && (
        !authorizedAttemptRequestHashes
        || parsed.data.attempt_request_hashes.some(
          (requestHash) => !authorizedAttemptRequestHashes.includes(requestHash),
        )
      ))
    ) {
      throw new Error("batch_checkpoint_invalid");
    }
    const recomputed = batchCheckpointFingerprint({
      unitId: parsed.data.unit_id,
      batchIndex: parsed.data.batch_index,
      model: parsed.data.model,
      providerMode: parsed.data.provider_mode,
      paidPlanSha256: parsed.data.paid_plan_sha256,
      extractionFingerprint: parsed.data.extraction_fingerprint,
      canonicalIdentity: parsed.data.canonical_identity,
      artifactFingerprint: parsed.data.artifact_fingerprint,
      requestHash: parsed.data.request_hash,
      scannerParserVersion: parsed.data.scanner_parser_version,
      converterVersion: parsed.data.converter_version,
    });
    if (recomputed !== expectedFingerprint) throw new Error("batch_checkpoint_invalid");
    const resultHash = batchCheckpointResultHash({
      data: parsed.data.data,
      attempts: parsed.data.attempts,
      inputTokens: parsed.data.input_tokens,
      outputTokens: parsed.data.output_tokens,
      requestId: parsed.data.request_id,
      attemptRequestHashes: parsed.data.attempt_request_hashes,
      successfulRequestHash: parsed.data.successful_request_hash,
      successLedgerId: parsed.data.success_ledger_id,
      successfulInputTokens: parsed.data.successful_input_tokens,
      successfulOutputTokens: parsed.data.successful_output_tokens,
    });
    if (resultHash !== parsed.data.result_hash) throw new Error("batch_checkpoint_invalid");
    const ledger = await readAiLedger(stateDir);
    assertCheckpointSuccessLedgerMatch(
      parsed.data,
      ledger.find((entry) => entry.ledger_id === parsed.data.success_ledger_id),
    );
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error("batch_checkpoint_invalid", { cause: error });
  }
}

/**
 * Replays the deterministic request/checkpoint/finalization chain before any
 * downstream validator is allowed to trust a strict extraction artifact.
 */
export async function verifyCurrentExtractionCacheForUnit(
  unit: ManifestUnit,
  manifest: IngestManifest,
  stateDir: string,
): Promise<StrictExtractionArtifact> {
  const conversion = unit.conversion;
  const metadata = unit.extraction;
  if (!conversion || !metadata) throw new Error("strict_extraction_cache_metadata_missing");
  if (!metadata.provider_mode || metadata.paid_plan_sha256 === undefined) {
    throw new Error("strict_extraction_cache_provider_provenance_missing");
  }
  const metadataProviderMode = metadata.provider_mode;
  const metadataPaidPlanSha256 = metadata.paid_plan_sha256;
  await verifyProvenance(unit, manifest);
  const converterVersion = conversion.converter_version ?? "v1-legacy";
  const fingerprint = currentExtractionFingerprint({
    scannerParserVersion: manifest.scanner_parser_version,
    converterVersion,
    model: metadata.model,
    rawName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    sourceFingerprint: unit.source_fingerprint,
    artifactFingerprint: conversion.artifact_fingerprint,
  });
  const requests = await buildRequests(unit, metadata.model, stateDir);
  const canonicalIdentity: ExtractionBatchCheckpoint["canonical_identity"] = {
    canonical_name: unit.parsed.raw_name,
    region_code: unit.parsed.region_code,
    kind_hint: unit.parsed.kind_hint,
  };
  const batchIdentities = await Promise.all(requests.map(async (request, batchIndex) => {
    const requestHash = await extractionRequestHash(request, {
      scannerParserVersion: manifest.scanner_parser_version,
      converterVersion,
    });
    const identity: BatchCheckpointIdentity = {
      unitId: unit.unit_id,
      batchIndex,
      model: metadata.model,
      providerMode: metadataProviderMode,
      paidPlanSha256: metadataPaidPlanSha256,
      extractionFingerprint: fingerprint,
      canonicalIdentity,
      artifactFingerprint: conversion.artifact_fingerprint,
      requestHash,
      scannerParserVersion: manifest.scanner_parser_version,
      converterVersion,
    };
    return { fingerprint: batchCheckpointFingerprint(identity), identity };
  }));
  const cachePath = path.join(path.resolve(stateDir), ".cache", "extract", `${fingerprint}.json`);
  if (path.resolve(metadata.artifact_path) !== cachePath || metadata.fingerprint !== fingerprint) {
    throw new Error("strict_extraction_cache_manifest_path_or_fingerprint_mismatch");
  }
  const artifact = await readCache(cachePath, {
    stateDir,
    fingerprint,
    unitId: unit.unit_id,
    sourceFingerprint: unit.source_fingerprint,
    artifactFingerprint: conversion.artifact_fingerprint,
    scannerParserVersion: manifest.scanner_parser_version,
    converterVersion,
    model: metadata.model,
    providerMode: metadataProviderMode,
    paidPlanSha256: metadataPaidPlanSha256,
    canonicalIdentity,
    unit,
    requests,
    batchIdentities,
  });
  if (!artifact || artifact.content_sha256 !== metadata.content_sha256) {
    throw new Error("strict_extraction_cache_replay_failed");
  }
  return artifact;
}

function extractionMetadata(
  cache: StrictExtractionArtifact,
  artifactPath: string,
  cacheHit: boolean,
): NonNullable<ManifestUnit["extraction"]> {
  return {
    provider_mode: cache.provider_mode,
    paid_plan_sha256: cache.paid_plan_sha256,
    fingerprint: cache.fingerprint,
    content_sha256: cache.content_sha256,
    source_fingerprint: cache.source_fingerprint,
    artifact_fingerprint: cache.artifact_fingerprint,
    prompt_version: cache.prompt_version,
    prompt_hash: cache.prompt_hash,
    processing_version: cache.processing_version,
    scanner_parser_version: cache.scanner_parser_version,
    converter_version: cache.converter_version,
    model: cache.model,
    artifact_path: artifactPath,
    cache_hit: cacheHit,
    attempts: cache.attempts,
    input_tokens: cache.input_tokens,
    output_tokens: cache.output_tokens,
    extracted_at: cache.created_at,
  };
}

export interface ExtractionPlanUnit {
  unit_id: string;
  display_name: string;
  source_paths: string[];
  formats: string[];
  kind_hint: "agency" | "hall";
  region_code: string;
  text_characters: number;
  image_count: number;
  requests: number;
  estimated_input_tokens: number;
  maximum_input_tokens: number;
  estimated_output_tokens: number;
  maximum_output_tokens: number;
  estimated_cost_usd: number;
  maximum_cost_usd: number;
}

export interface ExtractionPlan {
  provider: "openai_responses_api";
  configured_model_env: string | null;
  resolved_model: ExtractionModel;
  luna_semantics: string;
  processing_version: string;
  estimation_basis: string;
  max_retry_attempts: number;
  uncached_paid_call_hard_limit_usd: number;
  prior_durable_ledger_cost_usd: number;
  domain_cumulative_committed_cost_usd: number;
  remaining_paid_call_budget_usd: number;
  cost_fence_scope: "local_user_home_execution_domain_claims_and_authoritative_state_ledger";
  execution_domain_id: string | null;
  execution_domain_authority_root: string | null;
  authoritative_state_dir: string | null;
  execution_domain_scope: "single_local_user_home_not_central_or_cross_machine" | null;
  approval_status:
    | "not_requested"
    | "approved_sequential_runtime_fence"
    | "blocked_expected_cost_exceeds_remaining_budget"
    | "blocked_expected_cost_exceeds_fixed_approval_cap"
    | "blocked_single_attempt_exceeds_remaining_budget"
    | "blocked_single_attempt_exceeds_fixed_approval_cap";
  approval_authorized_ceiling_usd: number | null;
  approval_plan_sha256: string | null;
  approval_plan_path: string | null;
  units: ExtractionPlanUnit[];
  estimated_input_tokens: number;
  maximum_input_tokens: number;
  estimated_output_tokens: number;
  maximum_output_tokens: number;
  estimated_cost_usd: number;
  maximum_cost_usd: number;
  maximum_single_attempt_cost_usd: number;
  completion_not_guaranteed: boolean;
}

function requestPlanningText(request: ExtractionRequest): string {
  return [
    repairInstructions(request) ?? EXTRACTION_INSTRUCTIONS,
    request.canonicalName,
    request.regionCode,
    request.kindHint,
    request.text,
    JSON.stringify(request.imageSourceRefs),
    JSON.stringify(EXTRACTION_RESPONSE_FORMAT),
  ].join("\n");
}

function estimatedRequestInputTokens(request: ExtractionRequest): number {
  // Expected planning uses UTF-8 bytes/3 plus provider-message framing. The
  // serialized response schema is included instead of being hidden overhead.
  return Math.ceil(Buffer.byteLength(requestPlanningText(request), "utf8") / 3)
    + 512
    + (request.imagePaths.length * ESTIMATED_IMAGE_INPUT_TOKENS);
}

function maximumRequestInputTokens(request: ExtractionRequest): number {
  // A UTF-8 byte upper reserve is intentionally much stricter than the
  // expected token approximation. Image accounting also uses a 4x reserve.
  return Buffer.byteLength(requestPlanningText(request), "utf8")
    + 2_048
    + (request.imagePaths.length * MAXIMUM_IMAGE_INPUT_TOKENS);
}

async function paidPlanUnitInput(
  unit: ManifestUnit,
  manifest: IngestManifest,
  model: ExtractionModel,
  stateDir: string,
): Promise<{ approval: PaidExtractionPlanUnitInput; requests: ExtractionRequest[] }> {
  const conversion = unit.conversion;
  if (!conversion) throw new Error(`paid_plan_conversion_missing:${unit.unit_id}`);
  const converterVersion = conversion.converter_version ?? "v1-legacy";
  const requests = await buildRequests(unit, model, stateDir);
  const requestHashes = await Promise.all(requests.map((request) => extractionRequestHash(request, {
    scannerParserVersion: manifest.scanner_parser_version,
    converterVersion,
  })));
  const staticRetryRequestHashes = await Promise.all(requests.map((request) => extractionRequestHash(
    staticValidationRetryRequest(request),
    {
      scannerParserVersion: manifest.scanner_parser_version,
      converterVersion,
    },
  )));
  const authorizedRequestReservationsByBatch = requests.map((request, index) => {
    return [
      {
        requestHash: requestHashes[index] as string,
        maximumInputTokens: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
        maximumOutputTokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
      },
      {
        requestHash: staticRetryRequestHashes[index] as string,
        maximumInputTokens: PAID_EXTRACTION_PROVIDER_INPUT_TOKEN_BOUND,
        maximumOutputTokens: PAID_EXTRACTION_PROVIDER_OUTPUT_TOKEN_CAP,
      },
    ];
  });
  const plannedRequestEstimates = requests.map((request, index) => {
    const input = estimatedRequestInputTokens(request);
    return {
      requestHash: requestHashes[index] as string,
      estimatedInputTokens: input,
      estimatedOutputTokens: Math.min(MAX_OUTPUT_TOKENS, Math.max(1_200, input)),
    };
  });
  const estimatedInputTokens = plannedRequestEstimates.reduce(
    (sum, request) => sum + request.estimatedInputTokens,
    0,
  );
  const estimatedOutputTokens = plannedRequestEstimates.reduce(
    (sum, request) => sum + request.estimatedOutputTokens,
    0,
  );
  return {
    requests,
    approval: {
      unitId: unit.unit_id,
      extractionFingerprint: currentExtractionFingerprint({
        scannerParserVersion: manifest.scanner_parser_version,
        converterVersion,
        model,
        rawName: unit.parsed.raw_name,
        regionCode: unit.parsed.region_code,
        kindHint: unit.parsed.kind_hint,
        sourceFingerprint: unit.source_fingerprint,
        artifactFingerprint: conversion.artifact_fingerprint,
      }),
      sourceFingerprint: unit.source_fingerprint,
      artifactFingerprint: conversion.artifact_fingerprint,
      converterVersion,
      requestHashes,
      authorizedRequestReservationsByBatch,
      plannedRequestEstimates,
      estimatedInputTokens,
      estimatedOutputTokens,
      maximumInputTokens: authorizedRequestReservationsByBatch.reduce(
        (sum, batch) => sum + (Math.max(...batch.map((request) => request.maximumInputTokens))
          * PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH),
        0,
      ),
      maximumOutputTokens: requests.length
        * MAX_OUTPUT_TOKENS
        * PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH,
    },
  };
}

async function currentPaidPlanInput(
  manifest: IngestManifest,
  selectedUnits: ManifestUnit[],
  model: ExtractionModel,
  stateDir: string,
  authorizedCostCeilingUsd: number,
  domainCommittedCostNanoUsd: number,
  priorDurableLedger: AiLedgerSnapshot,
  executionDomain: PaidExecutionDomainBinding,
): Promise<CreatePaidExtractionPlanApprovalInput> {
  const units: PaidExtractionPlanUnitInput[] = [];
  for (const unit of selectedUnits) {
    await verifyProvenance(unit, manifest);
    units.push((await paidPlanUnitInput(unit, manifest, model, stateDir)).approval);
  }
  return {
    executionDomain,
    model,
    scannerParserVersion: manifest.scanner_parser_version,
    authorizedCostCeilingUsd,
    domainCommittedCostNanoUsd,
    priorDurableLedger,
    units,
  };
}

async function assertPaidPlanLedgerSnapshotAndResumeState(
  stateDir: string,
  approval: PaidExtractionPlanApproval,
  manifest: IngestManifest,
  selectedUnits: ManifestUnit[],
): Promise<Awaited<ReturnType<typeof readAiLedgerState>>> {
  const ledgerState = await readAiLedgerState(stateDir);
  const baseline = approval.payload.prior_durable_ledger;
  assertAiLedgerSnapshotIsExactPrefix(baseline, ledgerState);

  const planUnits = new Map(approval.payload.units.map((unit) => [unit.unit_id, unit]));
  const manifestUnits = new Map(selectedUnits.map((unit) => [unit.unit_id, unit]));
  const expectedFingerprints = new Map<string, string>();
  for (const unit of selectedUnits) {
    const conversion = unit.conversion;
    if (!conversion) throw new Error(`paid_plan_conversion_missing:${unit.unit_id}`);
    expectedFingerprints.set(unit.unit_id, currentExtractionFingerprint({
      scannerParserVersion: manifest.scanner_parser_version,
      converterVersion: conversion.converter_version ?? "v1-legacy",
      model: approval.payload.model,
      rawName: unit.parsed.raw_name,
      regionCode: unit.parsed.region_code,
      kindHint: unit.parsed.kind_hint,
      sourceFingerprint: unit.source_fingerprint,
      artifactFingerprint: conversion.artifact_fingerprint,
    }));
  }

  const delta = ledgerState.entries.slice(baseline.row_count);
  for (const entry of delta) {
    if (!isNewLedgerEntry(entry)
      || entry.provider_mode !== "production_paid"
      || entry.paid_plan_sha256 !== approval.plan_sha256
      || entry.model !== approval.payload.model
      || entry.prompt_version !== approval.payload.prompt_version) {
      throw new Error("paid_plan_ledger_delta_provenance_mismatch");
    }
    const planUnit = planUnits.get(entry.unit_id);
    const manifestUnit = manifestUnits.get(entry.unit_id);
    const expectedFingerprint = expectedFingerprints.get(entry.unit_id);
    const authorizedHashes = planUnit?.authorized_request_hashes_by_batch[entry.batch_index];
    if (!planUnit || !manifestUnit || !expectedFingerprint
      || entry.fingerprint !== expectedFingerprint
      || !authorizedHashes?.includes(entry.request_hash)) {
      throw new Error("paid_plan_ledger_delta_request_mismatch");
    }
    if (!entry.success && !["rate_limit", "invalid_response"].includes(entry.error_category ?? "")) {
      throw new Error("paid_plan_ledger_delta_is_not_a_recognized_durable_retry_state");
    }
  }

  const checkpointDirectory = path.join(path.resolve(stateDir), ".cache", "extract-batches");
  let checkpointNames: string[] = [];
  try {
    checkpointNames = await readdir(checkpointDirectory);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const relevantCheckpoints: ExtractionBatchCheckpoint[] = [];
  for (const name of checkpointNames.sort((left, right) => left.localeCompare(right, "en"))) {
    if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
    const raw = await readJsonFile(path.join(checkpointDirectory, name));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;
    if (candidate.paid_plan_sha256 !== approval.plan_sha256) continue;
    verifyJsonContentHash(candidate, "content_sha256");
    const checkpoint = ExtractionBatchCheckpointSchema.parse(candidate);
    const recomputedFingerprint = batchCheckpointFingerprint({
      unitId: checkpoint.unit_id,
      batchIndex: checkpoint.batch_index,
      model: checkpoint.model,
      providerMode: checkpoint.provider_mode,
      paidPlanSha256: checkpoint.paid_plan_sha256,
      extractionFingerprint: checkpoint.extraction_fingerprint,
      canonicalIdentity: checkpoint.canonical_identity,
      artifactFingerprint: checkpoint.artifact_fingerprint,
      requestHash: checkpoint.request_hash,
      scannerParserVersion: checkpoint.scanner_parser_version,
      converterVersion: checkpoint.converter_version,
    });
    const recomputedResult = batchCheckpointResultHash({
      data: checkpoint.data,
      attempts: checkpoint.attempts,
      inputTokens: checkpoint.input_tokens,
      outputTokens: checkpoint.output_tokens,
      requestId: checkpoint.request_id,
      attemptRequestHashes: checkpoint.attempt_request_hashes,
      successfulRequestHash: checkpoint.successful_request_hash,
      successLedgerId: checkpoint.success_ledger_id,
      successfulInputTokens: checkpoint.successful_input_tokens,
      successfulOutputTokens: checkpoint.successful_output_tokens,
    });
    const planUnit = planUnits.get(checkpoint.unit_id);
    const authorizedHashes = planUnit?.authorized_request_hashes_by_batch[checkpoint.batch_index];
    if (
      checkpoint.provider_mode !== "production_paid"
      || checkpoint.checkpoint_fingerprint !== name.slice(0, -5)
      || checkpoint.checkpoint_fingerprint !== recomputedFingerprint
      || checkpoint.result_hash !== recomputedResult
      || checkpoint.extraction_fingerprint !== expectedFingerprints.get(checkpoint.unit_id)
      || checkpoint.model !== approval.payload.model
      || checkpoint.request_hash !== planUnit?.request_hashes[checkpoint.batch_index]
      || !authorizedHashes?.includes(checkpoint.successful_request_hash)
    ) {
      throw new Error("paid_plan_resume_checkpoint_mismatch");
    }
    relevantCheckpoints.push(checkpoint);
  }
  const ledgerById = new Map(ledgerState.entries.map((entry) => [entry.ledger_id, entry]));
  for (const checkpoint of relevantCheckpoints) {
    assertCheckpointSuccessLedgerMatch(checkpoint, ledgerById.get(checkpoint.success_ledger_id));
  }
  const deltaSuccessIds = new Set(delta.filter((entry) => entry.success).map((entry) => entry.ledger_id));
  const checkpointSuccessIds = new Set(relevantCheckpoints.map((checkpoint) => checkpoint.success_ledger_id));
  if (deltaSuccessIds.size !== checkpointSuccessIds.size
    || [...deltaSuccessIds].some((ledgerId) => !checkpointSuccessIds.has(ledgerId))) {
    throw new Error("paid_plan_resume_success_ledger_checkpoint_mismatch");
  }
  return ledgerState;
}

async function planExtractionInternal(
  options: ExtractOptions,
  env: NodeJS.ProcessEnv = process.env,
  paidExecutionDomainAccess: PaidExecutionDomainAccess = productionPaidExecutionDomainAccess,
): Promise<ExtractionPlan> {
  const model = resolveExtractionModel(env);
  const manifest = await loadManifest(options.stateDir);
  const selected = selectExtractionUnits(manifest, {
    model,
    ...(options.enforcePilotAuthorization ? { providerMode: "production_paid" as const } : {}),
    ...(options.unitIds ? { unitIds: options.unitIds } : {}),
    ...(!options.unitIds && options.limit !== undefined ? { sampleSize: options.limit } : {}),
  });
  if (options.enforcePilotAuthorization) {
    const selectedIds = selected.map((unit) => unit.unit_id);
    if (
      selectedIds.length !== FIXED_EIGHT_ORDERED_UNIT_IDS.length
      || selectedIds.some((unitId, index) => unitId !== FIXED_EIGHT_ORDERED_UNIT_IDS[index])
    ) {
      throw new Error("fixed_eight_paid_pilot_requires_exact_approved_units_and_order");
    }
  }
  const units: ExtractionPlanUnit[] = [];
  const approvalUnits: PaidExtractionPlanUnitInput[] = [];
  for (const unit of selected) {
    await verifyProvenance(unit, manifest);
    const planned = await paidPlanUnitInput(unit, manifest, model, options.stateDir);
    const requests = planned.requests;
    const estimatedInputTokens = planned.approval.estimatedInputTokens;
    const estimatedOutputTokens = planned.approval.estimatedOutputTokens;
    const maximumInputTokens = planned.approval.maximumInputTokens;
    const maximumOutputTokens = planned.approval.maximumOutputTokens;
    approvalUnits.push(planned.approval);
    units.push({
      unit_id: unit.unit_id,
      display_name: unit.display_name,
      source_paths: unit.source_files.map((source) => source.path),
      formats: [...new Set(unit.source_files.map((source) => source.ext))],
      kind_hint: unit.parsed.kind_hint,
      region_code: unit.parsed.region_code,
      text_characters: unit.conversion?.text_characters ?? 0,
      image_count: unit.conversion?.image_artifacts.length ?? 0,
      requests: requests.length,
      estimated_input_tokens: estimatedInputTokens,
      maximum_input_tokens: maximumInputTokens,
      estimated_output_tokens: estimatedOutputTokens,
      maximum_output_tokens: maximumOutputTokens,
      estimated_cost_usd: planned.approval.plannedRequestEstimates.reduce(
        (sum, request) => sum + estimateExtractionCostUsd(
          model,
          request.estimatedInputTokens,
          request.estimatedOutputTokens,
        ),
        0,
      ),
      maximum_cost_usd: planned.approval.authorizedRequestReservationsByBatch.reduce(
        (sum, batch) => sum + (Math.max(...batch.map((request) => estimateExtractionCostUsd(
          model,
          request.maximumInputTokens,
          request.maximumOutputTokens,
        ))) * PAID_EXTRACTION_MAX_ATTEMPTS_PER_BATCH),
        0,
      ),
    });
  }
  const estimatedInputTokens = units.reduce((sum, unit) => sum + unit.estimated_input_tokens, 0);
  const maximumInputTokens = units.reduce((sum, unit) => sum + unit.maximum_input_tokens, 0);
  const estimatedOutputTokens = units.reduce((sum, unit) => sum + unit.estimated_output_tokens, 0);
  const maximumOutputTokens = units.reduce((sum, unit) => sum + unit.maximum_output_tokens, 0);
  const estimatedCostUsd = units.reduce((sum, unit) => sum + unit.estimated_cost_usd, 0);
  const maximumCostUsd = units.reduce((sum, unit) => sum + unit.maximum_cost_usd, 0);
  const maximumSingleAttemptCostUsd = Math.max(...approvalUnits.flatMap(
    (unit) => unit.authorizedRequestReservationsByBatch.flatMap(
      (batch) => batch.map((request) => estimateExtractionCostUsd(
        model,
        request.maximumInputTokens,
        request.maximumOutputTokens,
      )),
    ),
  ));
  const paidCallLimitUsd = resolveUncachedPaidCallLimitUsd(env);
  const priorLedgerState = await readAiLedgerState(options.stateDir);
  const priorDurableLedgerCostUsd = priorLedgerState.snapshot.cumulative_cost_usd;
  let approvalPlanSha256: string | null = null;
  let approvalPlanPath: string | null = null;
  let executionDomainBinding: PaidExecutionDomainBinding | null = null;
  let effectivePriorLedgerCostUsd = priorDurableLedgerCostUsd;
  let approvalStatus: ExtractionPlan["approval_status"] = "not_requested";
  let approvalAuthorizedCeilingUsd: number | null = null;
  if (options.enforcePilotAuthorization) {
    await assertNoOrphanedPaidCallIntents(options.stateDir);
    const executionDomain = await paidExecutionDomainAccess.loadForPlanning(options.stateDir);
    if (
      executionDomain.current_ledger.content_sha256 !== priorLedgerState.snapshot.content_sha256
      || executionDomain.current_ledger.byte_count !== priorLedgerState.snapshot.byte_count
      || executionDomain.current_ledger.row_count !== priorLedgerState.snapshot.row_count
      || executionDomain.current_ledger.cumulative_cost_usd
        !== priorLedgerState.snapshot.cumulative_cost_usd
    ) {
      throw new Error("paid_execution_ledger_changed_during_plan");
    }
    executionDomainBinding = executionDomain.binding;
    effectivePriorLedgerCostUsd = executionDomain.cumulative_committed_cost_usd;
    const remainingPaidCallBudgetUsd = Math.max(
      0,
      paidCallLimitUsd - effectivePriorLedgerCostUsd,
    );
    approvalAuthorizedCeilingUsd = Math.min(
      remainingPaidCallBudgetUsd,
      MAX_FIXED_EIGHT_APPROVED_COST_USD,
    );
    if (
      estimatedCostUsd <= approvalAuthorizedCeilingUsd
      && maximumSingleAttemptCostUsd <= approvalAuthorizedCeilingUsd
    ) {
      const approval = createFixedEightPaidExtractionPlanApproval({
        executionDomain: executionDomain.binding,
        model,
        scannerParserVersion: manifest.scanner_parser_version,
        authorizedCostCeilingUsd: approvalAuthorizedCeilingUsd,
        domainCommittedCostNanoUsd: executionDomain.cumulative_committed_cost_nano_usd,
        priorDurableLedger: priorLedgerState.snapshot,
        units: approvalUnits,
      });
      approvalPlanPath = await writeFixedEightPaidExtractionPlanApproval(
        options.stateDir,
        approval,
      );
      approvalPlanSha256 = approval.plan_sha256;
      approvalStatus = "approved_sequential_runtime_fence";
    } else {
      const expectedBlocked = estimatedCostUsd > approvalAuthorizedCeilingUsd;
      const remainingBudgetIsBinding = remainingPaidCallBudgetUsd <= MAX_FIXED_EIGHT_APPROVED_COST_USD;
      approvalStatus = expectedBlocked
        ? (remainingBudgetIsBinding
            ? "blocked_expected_cost_exceeds_remaining_budget"
            : "blocked_expected_cost_exceeds_fixed_approval_cap")
        : (remainingBudgetIsBinding
            ? "blocked_single_attempt_exceeds_remaining_budget"
            : "blocked_single_attempt_exceeds_fixed_approval_cap");
    }
  }
  const remainingPaidCallBudgetUsd = Math.max(
    0,
    paidCallLimitUsd - effectivePriorLedgerCostUsd,
  );
  return {
    provider: "openai_responses_api",
    configured_model_env: env.EXTRACTION_MODEL?.trim() || null,
    resolved_model: model,
    luna_semantics: "gpt-5.6-luna is the literal OpenAI API model identifier used by this repository, not an alias mapping; the repository labels it as the lower-cost tier.",
    processing_version: EXTRACTION_PROCESSING_VERSION,
    estimation_basis: `Expected cost is the sum of request-level heuristic estimates, including the serialized structured-output schema and request framing (UTF-8 bytes/3 + 512 + ${ESTIMATED_IMAGE_INPUT_TOKENS.toLocaleString("en-US")} per image) and expected output=max(1,200, 100% input), capped at ${MAX_OUTPUT_TOKENS.toLocaleString("en-US")}. Every authorized paid attempt instead reserves a deliberately conservative 1,050,000-input-token cost bound (the whole context window, above the currently documented 922,000 max input) and ${MAX_OUTPUT_TOKENS.toLocaleString("en-US")} output tokens. That reservation applies the 1.25x cache-write input upper bound plus the long-context multipliers (2x input and 1.5x output above 272,000 input tokens), for up to ${MAX_EXTRACTION_ATTEMPTS} attempts total per batch. Aggregate maximum cost is informational: the sequential authority claim and integer nano-USD runtime fence may stop execution before every planned request completes. Actual settlement releases unused reservation only after an exact completed checkpoint. Repository planning rates, not a provider quote.`,
    max_retry_attempts: MAX_EXTRACTION_ATTEMPTS,
    uncached_paid_call_hard_limit_usd: paidCallLimitUsd,
    prior_durable_ledger_cost_usd: effectivePriorLedgerCostUsd,
    domain_cumulative_committed_cost_usd: effectivePriorLedgerCostUsd,
    remaining_paid_call_budget_usd: remainingPaidCallBudgetUsd,
    cost_fence_scope: "local_user_home_execution_domain_claims_and_authoritative_state_ledger",
    execution_domain_id: executionDomainBinding?.domain_id ?? null,
    execution_domain_authority_root: executionDomainBinding?.authority_root_realpath ?? null,
    authoritative_state_dir: executionDomainBinding?.authoritative_state_dir_realpath ?? null,
    execution_domain_scope: executionDomainBinding
      ? "single_local_user_home_not_central_or_cross_machine"
      : null,
    approval_status: approvalStatus,
    approval_authorized_ceiling_usd: approvalAuthorizedCeilingUsd,
    approval_plan_sha256: approvalPlanSha256,
    approval_plan_path: approvalPlanPath,
    units,
    estimated_input_tokens: estimatedInputTokens,
    maximum_input_tokens: maximumInputTokens,
    estimated_output_tokens: estimatedOutputTokens,
    maximum_output_tokens: maximumOutputTokens,
    estimated_cost_usd: estimatedCostUsd,
    maximum_cost_usd: maximumCostUsd,
    maximum_single_attempt_cost_usd: maximumSingleAttemptCostUsd,
    completion_not_guaranteed: maximumCostUsd > (approvalAuthorizedCeilingUsd ?? paidCallLimitUsd),
  };
}

export async function planExtraction(
  options: ExtractOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExtractionPlan> {
  return planExtractionInternal(options, env);
}

/** @internal Test-only authority-root seam; production planning is fixed to the user home. */
export async function planExtractionForTests(
  options: ExtractOptions,
  env: NodeJS.ProcessEnv,
  paidExecutionDomainLocation: PaidExecutionDomainLocationOptions,
): Promise<ExtractionPlan> {
  if (!process.env.NODE_TEST_CONTEXT) {
    throw new Error("test_only_paid_execution_domain_override_requires_node_test_runner");
  }
  return planExtractionInternal(options, env, testPaidExecutionDomainAccess(
    paidExecutionDomainLocation,
  ));
}

interface ExtractionLockMetadata {
  schema_version: 1;
  lock_id: string;
  pid: number;
  hostname: string;
  started_at: string;
  state_dir: string;
}

function parseExtractionLockMetadata(value: unknown): ExtractionLockMetadata | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExtractionLockMetadata>;
  if (
    candidate.schema_version !== 1
    || typeof candidate.lock_id !== "string"
    || !candidate.lock_id
    || !Number.isSafeInteger(candidate.pid)
    || (candidate.pid ?? 0) < 1
    || typeof candidate.hostname !== "string"
    || !candidate.hostname
    || typeof candidate.started_at !== "string"
    || !Number.isFinite(Date.parse(candidate.started_at))
    || typeof candidate.state_dir !== "string"
    || !candidate.state_dir
  ) {
    return null;
  }
  return candidate as ExtractionLockMetadata;
}

function isLocalProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") return true;
    return false;
  }
}

async function readExtractionLock(lockPath: string): Promise<ExtractionLockMetadata> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    throw new Error(`extract_lock_invalid: inspect ${lockPath} before manual recovery`);
  }
  const metadata = parseExtractionLockMetadata(parsed);
  if (!metadata) {
    throw new Error(`extract_lock_invalid: inspect ${lockPath} before manual recovery`);
  }
  return metadata;
}

export async function acquireExtractionLock(stateDir: string): Promise<() => Promise<void>> {
  const resolvedStateDirectory = path.resolve(stateDir);
  const lockDirectory = path.join(resolvedStateDirectory, ".cache", "locks");
  const lockPath = path.join(lockDirectory, "extract.lock");
  await mkdir(lockDirectory, { recursive: true });
  const metadata: ExtractionLockMetadata = {
    schema_version: 1,
    lock_id: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    started_at: new Date().toISOString(),
    state_dir: resolvedStateDirectory,
  };
  const temporaryLockPath = `${lockPath}.${process.pid}.${metadata.lock_id}.tmp`;
  const lockHandle = await open(temporaryLockPath, "wx");
  try {
    await lockHandle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await lockHandle.sync();
  } catch (error) {
    await lockHandle.close().catch(() => undefined);
    await unlink(temporaryLockPath).catch(() => undefined);
    throw error;
  }
  await lockHandle.close();
  try {
    await link(temporaryLockPath, lockPath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      await unlink(temporaryLockPath).catch(() => undefined);
      throw error;
    }
    await unlink(temporaryLockPath).catch(() => undefined);
    const owner = await readExtractionLock(lockPath);
    if (path.resolve(owner.state_dir) !== resolvedStateDirectory) {
      throw new Error(`extract_lock_state_mismatch: inspect ${lockPath} before manual recovery`);
    }
    if (owner.hostname === hostname() && !isLocalProcessAlive(owner.pid)) {
      throw new Error(
        `extract_lock_stale_local_pid: pid=${owner.pid} started_at=${owner.started_at}; inspect ${lockPath} before manual recovery`,
      );
    }
    throw new Error(
      `extract_lock_active: pid=${owner.pid} host=${owner.hostname} started_at=${owner.started_at}`,
    );
  }
  try {
    await unlink(temporaryLockPath);
  } catch (error) {
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    let current: ExtractionLockMetadata;
    try {
      current = await readExtractionLock(lockPath);
    } catch (error) {
      throw new Error(
        `extract_lock_ownership_lost: ${error instanceof Error ? error.message : "lock unavailable"}`,
      );
    }
    if (current.lock_id !== metadata.lock_id) {
      throw new Error("extract_lock_ownership_lost: lock owner changed before release");
    }
    await unlink(lockPath);
    released = true;
  };
}

async function extractManifestUnlocked(
  options: ExtractOptions,
  dependencies: ExtractInternalDependencies = {},
  authorization: "fixed_eight" | "test_only_injected_provider" = "fixed_eight",
): Promise<IngestManifest> {
  const env = dependencies.env ?? process.env;
  const paidExecutionDomainAccess = dependencies.paidExecutionDomainAccess
    ?? productionPaidExecutionDomainAccess;
  const model = resolveExtractionModel(env);
  const manifest = await loadManifest(options.stateDir);
  const selectedUnits = selectExtractionUnits(manifest, {
    model,
    providerMode: authorization === "fixed_eight" ? "production_paid" : "test_only",
    ...(options.unitIds ? { unitIds: options.unitIds } : {}),
    ...(!options.unitIds && options.limit !== undefined ? { sampleSize: options.limit } : {}),
  });
  if (authorization === "fixed_eight") {
    const selectedIds = selectedUnits.map((unit) => unit.unit_id);
    if (
      selectedIds.length !== FIXED_EIGHT_ORDERED_UNIT_IDS.length
      || selectedIds.some((unitId, index) => unitId !== FIXED_EIGHT_ORDERED_UNIT_IDS[index])
    ) {
      throw new Error("fixed_eight_paid_pilot_requires_exact_approved_units_and_order");
    }
  }
  if (selectedUnits.length > 8) {
    throw new Error("pilot_gate_required_before_more_than_8_units");
  }
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const runId = randomUUID();
  const paidCallLimitUsd = resolveUncachedPaidCallLimitUsd(env);
  const providerMode: ExtractionProviderMode = authorization === "fixed_eight"
    ? "production_paid"
    : "test_only";
  let approvedPlan: PaidExtractionPlanApproval | null = null;
  let priorDurableLedgerCostUsd = 0;
  if (authorization === "fixed_eight") {
    const approvedPlanSha256 = options.approvedPlanSha256?.trim();
    if (!approvedPlanSha256) {
      throw new Error("fixed_eight_paid_pilot_requires_approved_plan_sha256_from_extract_plan");
    }
    approvedPlan = await readFixedEightPaidExtractionPlanApproval(
      options.stateDir,
      approvedPlanSha256,
    );
    await assertNoOrphanedPaidCallIntents(options.stateDir);
    const executionDomain = await paidExecutionDomainAccess.verifyForPlan(
      options.stateDir,
      approvedPlan.payload.execution_domain,
    );
    const currentPlanInput = await currentPaidPlanInput(
      manifest,
      selectedUnits,
      model,
      options.stateDir,
      approvedPlan.payload.cost.authorized_ceiling_usd,
      approvedPlan.payload.cost.domain_committed_at_plan_nano_usd,
      approvedPlan.payload.prior_durable_ledger,
      executionDomain.binding,
    );
    assertFixedEightPaidExtractionPlanApprovalMatches(
      approvedPlan,
      currentPlanInput,
      approvedPlanSha256,
    );
    const currentLedgerState = await assertPaidPlanLedgerSnapshotAndResumeState(
      options.stateDir,
      approvedPlan,
      manifest,
      selectedUnits,
    );
    priorDurableLedgerCostUsd = currentLedgerState.snapshot.cumulative_cost_usd;
  }
  const runtimeTotalPaidCallLimitUsd = approvedPlan
    ? Math.min(
        paidCallLimitUsd,
        approvedPlan.payload.prior_durable_ledger.cumulative_cost_usd
          + approvedPlan.payload.cost.authorized_ceiling_usd,
      )
    : paidCallLimitUsd;
  const paidCallCostFence = new UncachedPaidCallCostFence(
    model,
    runtimeTotalPaidCallLimitUsd,
    priorDurableLedgerCostUsd,
  );
  let provider = dependencies.provider;

  for (const unit of selectedUnits) {
    try {
      const conversion = unit.conversion;
      if (!conversion) throw new Error("conversion_missing_after_selection");
      const converterVersion = conversion.converter_version ?? "v1-legacy";
      await verifyProvenance(unit, manifest);
      // Any previous validation is bound to the old extraction artifact and
      // must not survive a new prompt/model run.
      delete unit.validation;
      const fingerprint = currentExtractionFingerprint({
        scannerParserVersion: manifest.scanner_parser_version,
        converterVersion,
        model,
        rawName: unit.parsed.raw_name,
        regionCode: unit.parsed.region_code,
        kindHint: unit.parsed.kind_hint,
        sourceFingerprint: unit.source_fingerprint,
        artifactFingerprint: conversion.artifact_fingerprint,
      });
      const cachePath = path.join(path.resolve(options.stateDir), ".cache", "extract", `${fingerprint}.json`);
      const requests = await buildRequests(unit, model, options.stateDir);
      const canonicalIdentity: ExtractionBatchCheckpoint["canonical_identity"] = {
        canonical_name: unit.parsed.raw_name,
        region_code: unit.parsed.region_code,
        kind_hint: unit.parsed.kind_hint,
      };
      const approvedPlanUnit = approvedPlan?.payload.units.find(
        (candidate) => candidate.unit_id === unit.unit_id,
      ) ?? null;
      const plannedBatches = await Promise.all(requests.map(async (request, batchIndex) => {
        const requestHash = await extractionRequestHash(request, {
          scannerParserVersion: manifest.scanner_parser_version,
          converterVersion,
        });
        const checkpointIdentity: BatchCheckpointIdentity = {
          unitId: unit.unit_id,
          batchIndex,
          model,
          providerMode,
          paidPlanSha256: approvedPlan?.plan_sha256 ?? null,
          extractionFingerprint: fingerprint,
          canonicalIdentity,
          artifactFingerprint: conversion.artifact_fingerprint,
          requestHash,
          scannerParserVersion: manifest.scanner_parser_version,
          converterVersion,
        };
        const checkpointFingerprint = batchCheckpointFingerprint(checkpointIdentity);
        return {
          request,
          batchIndex,
          requestHash,
          checkpointIdentity,
          checkpointFingerprint,
          checkpointPath: path.join(
            path.resolve(options.stateDir),
            ".cache",
            "extract-batches",
            `${checkpointFingerprint}.json`,
          ),
        };
      }));
      if (approvedPlan) {
        assertPaidExtractionPlannedRequestHashes(
            approvedPlan,
            unit.unit_id,
            plannedBatches.map((batch) => batch.requestHash),
          );
      }
      const cached = await readCache(cachePath, {
        stateDir: options.stateDir,
        fingerprint,
        unitId: unit.unit_id,
        sourceFingerprint: unit.source_fingerprint,
        artifactFingerprint: conversion.artifact_fingerprint,
        scannerParserVersion: manifest.scanner_parser_version,
        converterVersion,
        model,
        providerMode,
        paidPlanSha256: approvedPlan?.plan_sha256 ?? null,
        canonicalIdentity,
        unit,
        requests,
        batchIdentities: plannedBatches.map((batch) => ({
          fingerprint: batch.checkpointFingerprint,
          identity: batch.checkpointIdentity,
        })),
      });
      if (cached) {
        unit.extraction = extractionMetadata(cached, cachePath, true);
        unit.stage = "extracted";
        clearResolvedExtractionNotices(unit);
        await saveManifest(manifest);
        continue;
      }
      const preparedBatches = await Promise.all(plannedBatches.map(async (batch) => {
        const checkpoint = await readBatchCheckpoint(
          batch.checkpointPath,
          options.stateDir,
          batch.checkpointIdentity,
          batch.checkpointFingerprint,
          approvedPlanUnit?.authorized_request_hashes_by_batch[batch.batchIndex],
        );
        return {
          ...batch,
          checkpoint,
        };
      }));
      const requiresProvider = preparedBatches.some((batch) => batch.checkpoint === null);
      if (requiresProvider) {
        if (approvedPlan) {
          await assertPaidPlanLedgerSnapshotAndResumeState(
            options.stateDir,
            approvedPlan,
            manifest,
            selectedUnits,
          );
        }
        provider ??= createOpenAIExtractionProvider(env);
      }
      const responses: DisclosureExtraction[] = [];
      const usedBatchCheckpoints: ExtractionBatchCheckpoint[] = [];
      let attempts = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      for (const batch of preparedBatches) {
        if (batch.checkpoint) {
          usedBatchCheckpoints.push(batch.checkpoint);
          responses.push(batch.checkpoint.data);
          attempts += batch.checkpoint.attempts;
          inputTokens += batch.checkpoint.input_tokens;
          outputTokens += batch.checkpoint.output_tokens;
          continue;
        }
        if (!provider) throw new Error("extraction_provider_unavailable");
        const extracted = await extractWithRetry(provider, batch.request, sleep, async (audit) => {
          const { usage, costUsd: usageReportedCostUsd } = usageReportedExtractionCostUsd(
            model,
            audit.result ?? safeProviderUsage(audit.error),
          );
          const chargedCostUsd = usageReportedCostUsd !== null && usageReportedCostUsd > 0
            ? usageReportedCostUsd
            : audit.reservedCostUsd;
          const ledgerId = createLedgerId(runId, fingerprint, batch.batchIndex, audit.attempt);
          await appendAiLedgerEntry(options.stateDir, {
            schema_version: 3,
            provider_mode: providerMode,
            paid_plan_sha256: approvedPlan?.plan_sha256 ?? null,
            ledger_id: ledgerId,
            run_id: runId,
            unit_id: unit.unit_id,
            fingerprint,
            prompt_version: EXTRACTION_PROMPT_VERSION,
            model,
            batch_index: batch.batchIndex,
            attempt: audit.attempt,
            request_hash: audit.requestHash,
            request_id: audit.result?.requestId ?? safeRequestId(audit.error),
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            cached_input_tokens: usage.cachedInputTokens,
            cache_write_input_tokens: usage.cacheWriteInputTokens,
            estimated_cost_usd: chargedCostUsd,
            reserved_cost_usd: audit.reservedCostUsd,
            charge_basis: usageReportedCostUsd !== null && usageReportedCostUsd > 0
              ? "usage_reported"
              : "reservation_upper_bound",
            latency_ms: Math.max(0, audit.latencyMs),
            success: audit.result !== null,
            error_category: audit.result ? null : safeErrorCategory(audit.error),
            ...safeOwnershipAudit(audit.error),
            attempted_at: new Date().toISOString(),
          });
          return ledgerId;
        }, paidCallCostFence, (attemptRequest) => extractionRequestHash(attemptRequest, {
          scannerParserVersion: manifest.scanner_parser_version,
          converterVersion,
        }), authorization === "fixed_eight"
          ? (initialRequest) => staticValidationRetryRequest(initialRequest)
          : repairRequestForInvalidResponse,
        authorization === "fixed_eight" ? {
          begin: async ({ attempt, requestHash, reservation }) => {
            if (!approvedPlan || !approvedPlanUnit) {
              throw new Error("paid_plan_not_in_scope_before_provider_call");
            }
            assertPaidExtractionAttemptReservationAuthorized(
              approvedPlan,
              unit.unit_id,
              batch.batchIndex,
              requestHash,
              reservation,
            );
            await assertPaidPlanLedgerSnapshotAndResumeState(
              options.stateDir,
              approvedPlan,
              manifest,
              selectedUnits,
            );
            await paidExecutionDomainAccess.claimAttempt(
              options.stateDir,
              approvedPlan.payload.execution_domain,
              {
                runId,
                unitId: unit.unit_id,
                extractionFingerprint: fingerprint,
                batchIndex: batch.batchIndex,
                attempt,
                requestHash,
                paidPlanSha256: approvedPlan.plan_sha256,
                model,
                reservedCostUsd: reservation.maximumCostUsd,
                maximumInputTokens: reservation.maximumInputTokens,
                maximumOutputTokens: reservation.maximumOutputTokens,
                runtimeAbsoluteCostLimitUsd: paidCallLimitUsd,
              },
            );
            return beginPaidCallIntent(options.stateDir, {
              runId,
              unitId: unit.unit_id,
              extractionFingerprint: fingerprint,
              batchIndex: batch.batchIndex,
              attempt,
              requestHash,
              paidPlanSha256: approvedPlan.plan_sha256,
              model,
              reservedCostUsd: reservation.maximumCostUsd,
            });
          },
        } : undefined);
        const checkpointCandidate = {
          schema_version: 3 as const,
          provider_mode: providerMode,
          paid_plan_sha256: approvedPlan?.plan_sha256 ?? null,
          content_sha256: "0".repeat(64),
          checkpoint_fingerprint: batch.checkpointFingerprint,
          unit_id: unit.unit_id,
          batch_index: batch.batchIndex,
          prompt_version: EXTRACTION_PROMPT_VERSION,
          prompt_hash: EXTRACTION_PROMPT_HASH,
          processing_version: EXTRACTION_PROCESSING_VERSION,
          scanner_parser_version: manifest.scanner_parser_version,
          converter_version: converterVersion,
          model,
          canonical_identity: canonicalIdentity,
          artifact_fingerprint: conversion.artifact_fingerprint,
          extraction_fingerprint: fingerprint,
          request_hash: batch.requestHash,
          attempt_request_hashes: extracted.attemptRequestHashes,
          successful_request_hash: extracted.successfulRequestHash,
          result_hash: batchCheckpointResultHash({
            data: extracted.result.data,
            attempts: extracted.attempts,
            inputTokens: extracted.billedInputTokens,
            outputTokens: extracted.billedOutputTokens,
            requestId: extracted.result.requestId ?? null,
            attemptRequestHashes: extracted.attemptRequestHashes,
            successfulRequestHash: extracted.successfulRequestHash,
            successLedgerId: extracted.successLedgerId,
            successfulInputTokens: extracted.result.inputTokens,
            successfulOutputTokens: extracted.result.outputTokens,
          }),
          data: extracted.result.data,
          attempts: extracted.attempts,
          input_tokens: extracted.billedInputTokens,
          output_tokens: extracted.billedOutputTokens,
          success_ledger_id: extracted.successLedgerId,
          successful_input_tokens: extracted.result.inputTokens,
          successful_output_tokens: extracted.result.outputTokens,
          request_id: extracted.result.requestId ?? null,
          created_at: new Date().toISOString(),
        };
        checkpointCandidate.content_sha256 = canonicalJsonSha256ExcludingField(
          checkpointCandidate,
          "content_sha256",
        );
        const checkpoint: ExtractionBatchCheckpoint = ExtractionBatchCheckpointSchema.parse(
          checkpointCandidate,
        );
        await prepareDeterministicStateArtifactWritePath({
          stateDir: options.stateDir,
          artifactPath: batch.checkpointPath,
          expectedRelativePath: path.join(
            ".cache",
            "extract-batches",
            `${batch.checkpointFingerprint}.json`,
          ),
        });
        await persistCheckpointThenSettlePaidCallIntents(
          options.stateDir,
          extracted.paidCallIntents,
          async () => {
            await writeJsonFile(batch.checkpointPath, checkpoint);
            const ledger = await readAiLedger(options.stateDir);
            assertCheckpointSuccessLedgerMatch(
              checkpoint,
              ledger.find((entry) => entry.ledger_id === checkpoint.success_ledger_id),
            );
          },
        );
        usedBatchCheckpoints.push(checkpoint);
        responses.push(extracted.result.data);
        attempts += extracted.attempts;
        inputTokens += extracted.billedInputTokens;
        outputTokens += extracted.billedOutputTokens;
      }
      const { data, evidenceModalities } = await finalizeExtractionResponses(
        unit,
        responses,
        preparedBatches.map((batch) => batch.request),
      );
      const cacheCandidate = {
        schema_version: 3 as const,
        provider_mode: providerMode,
        paid_plan_sha256: approvedPlan?.plan_sha256 ?? null,
        content_sha256: "0".repeat(64),
        unit_id: unit.unit_id,
        fingerprint,
        source_fingerprint: unit.source_fingerprint,
        artifact_fingerprint: conversion.artifact_fingerprint,
        prompt_version: EXTRACTION_PROMPT_VERSION,
        prompt_hash: EXTRACTION_PROMPT_HASH,
        processing_version: EXTRACTION_PROCESSING_VERSION,
        scanner_parser_version: manifest.scanner_parser_version,
        converter_version: converterVersion,
        model,
        data,
        attempts,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        evidence_modalities: evidenceModalities,
        batch_checkpoint_fingerprints: usedBatchCheckpoints.map(
          (checkpoint) => checkpoint.checkpoint_fingerprint,
        ),
        batch_checkpoint_result_hashes: usedBatchCheckpoints.map(
          (checkpoint) => checkpoint.result_hash,
        ),
        created_at: new Date().toISOString(),
      };
      cacheCandidate.content_sha256 = canonicalJsonSha256ExcludingField(
        cacheCandidate,
        "content_sha256",
      );
      const cache = StrictExtractionArtifactSchema.parse(cacheCandidate);
      await assertSuccessfulCheckpointLedgerBindings(
        options.stateDir,
        cache,
        usedBatchCheckpoints,
      );
      await prepareDeterministicStateArtifactWritePath({
        stateDir: options.stateDir,
        artifactPath: cachePath,
        expectedRelativePath: path.join(".cache", "extract", `${fingerprint}.json`),
      });
      await writeJsonFile(cachePath, cache);
      unit.extraction = extractionMetadata(
        cache,
        cachePath,
        preparedBatches.every((batch) => batch.checkpoint !== null),
      );
      unit.stage = "extracted";
      clearResolvedExtractionNotices(unit);
    } catch (error) {
      unit.stage = "error";
      delete unit.extraction;
      delete unit.validation;
      const message = error instanceof Error ? error.message : "알 수 없는 추출 오류";
      unit.notices = Array.from(new Set([...unit.notices, `extract 실패: ${message}`]));
      if (error instanceof UncachedPaidCallCostFenceError) {
        await saveManifest(manifest);
        throw error;
      }
      if (authorization === "fixed_eight") {
        // An ambiguous provider outcome or any failure between a paid response
        // and its durable checkpoint leaves an intent behind. Never continue
        // to another paid unit until a human reconciles that request.
        await assertNoOrphanedPaidCallIntents(options.stateDir);
      }
    }
    await saveManifest(manifest);
  }
  await saveManifest(manifest);
  return manifest;
}

export async function extractManifest(
  options: ExtractOptions,
  dependencies: ExtractDependencies = {},
): Promise<IngestManifest> {
  if ("provider" in dependencies || "paidExecutionDomainAccess" in dependencies) {
    throw new Error("production_extract_rejects_injected_provider_or_authority_override");
  }
  const releaseLock = await acquireExtractionLock(options.stateDir);
  try {
    const manifest = await extractManifestUnlocked(options, dependencies);
    const byId = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
    const incompleteUnitIds = FIXED_EIGHT_ORDERED_UNIT_IDS.filter((unitId) => {
      const unit = byId.get(unitId);
      return !unit || unit.stage !== "extracted" || !unit.extraction;
    });
    if (incompleteUnitIds.length > 0) {
      throw new Error(`fixed_eight_extraction_incomplete:${incompleteUnitIds.join(",")}`);
    }
    return manifest;
  } finally {
    await releaseLock();
  }
}

/**
 * Test-only seam for deterministic fake providers. It is deliberately separate
 * from the production export so passing an injected provider cannot silently
 * disable the fixed-eight paid-call authorization boundary.
 *
 * @internal
 */
export async function extractManifestForTests(
  options: ExtractOptions,
  dependencies: ExtractDependencies & {
    provider: ExtractionProvider;
  },
): Promise<IngestManifest> {
  if (!process.env.NODE_TEST_CONTEXT) {
    throw new Error("test_only_extraction_helper_requires_node_test_runner");
  }
  const env = dependencies.env ?? {};
  if (env.INGEST_OPENAI_ENABLED === "true" || Boolean(env.OPENAI_API_KEY?.trim())) {
    throw new Error("test_only_extraction_helper_rejects_paid_provider_environment");
  }
  if (options.enforcePilotAuthorization || options.approvedPlanSha256) {
    throw new Error("arbitrary_test_provider_cannot_enter_production_paid_mode");
  }
  const internalDependencies: ExtractInternalDependencies = {
    env,
    provider: dependencies.provider,
    ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
  };
  const releaseLock = await acquireExtractionLock(options.stateDir);
  try {
    return await extractManifestUnlocked(
      options,
      internalDependencies,
      "test_only_injected_provider",
    );
  } finally {
    await releaseLock();
  }
}

function assertScriptedProviderTokenCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`fixed_eight_scripted_provider_${field}_invalid`);
  }
}

async function assertFixedEightScriptedTestPaths(
  stateDir: string,
  authorityRoot: string,
): Promise<void> {
  const [stateRealPath, authorityRealPath, temporaryRootRealPath] = await Promise.all([
    realpath(stateDir),
    realpath(authorityRoot),
    realpath(tmpdir()),
  ]);
  if (
    !isPathWithin(temporaryRootRealPath, stateRealPath)
    || !isPathWithin(temporaryRootRealPath, authorityRealPath)
    || path.resolve(stateRealPath) === path.resolve(temporaryRootRealPath)
    || path.resolve(authorityRealPath) === path.resolve(temporaryRootRealPath)
  ) {
    throw new Error("fixed_eight_scripted_provider_requires_isolated_temporary_paths");
  }
}

/**
 * Exercises production-paid provenance without accepting executable provider
 * code. The helper is limited to isolated OS-temp state and constructs a
 * deterministic in-memory provider from schema-validated response values.
 *
 * @internal
 */
export async function extractFixedEightWithScriptedProviderForTests(
  options: ExtractOptions,
  scenario: FixedEightScriptedProviderScenarioForTests,
  dependencies: ExtractDependencies & {
    paidExecutionDomainAuthorityRoot: string;
  },
): Promise<FixedEightScriptedExtractionResultForTests> {
  if (!process.env.NODE_TEST_CONTEXT) {
    throw new Error("fixed_eight_scripted_provider_requires_node_test_runner");
  }
  if (!options.enforcePilotAuthorization || !options.approvedPlanSha256?.trim()) {
    throw new Error("fixed_eight_scripted_provider_requires_approved_paid_plan");
  }
  const env = dependencies.env ?? {};
  if (env.INGEST_OPENAI_ENABLED === "true" || Boolean(env.OPENAI_API_KEY?.trim())) {
    throw new Error("fixed_eight_scripted_provider_rejects_paid_provider_environment");
  }
  await assertFixedEightScriptedTestPaths(
    options.stateDir,
    dependencies.paidExecutionDomainAuthorityRoot,
  );

  assertScriptedProviderTokenCount(scenario.inputTokens, "input_tokens");
  assertScriptedProviderTokenCount(scenario.outputTokens, "output_tokens");
  if (scenario.cachedInputTokens !== undefined && scenario.cachedInputTokens !== null) {
    assertScriptedProviderTokenCount(scenario.cachedInputTokens, "cached_input_tokens");
  }
  if (
    scenario.cacheWriteInputTokens !== undefined
    && scenario.cacheWriteInputTokens !== null
  ) {
    assertScriptedProviderTokenCount(
      scenario.cacheWriteInputTokens,
      "cache_write_input_tokens",
    );
  }
  const failFirstInvalidResponses = scenario.failFirstInvalidResponses ?? 0;
  if (
    !Number.isSafeInteger(failFirstInvalidResponses)
    || failFirstInvalidResponses < 0
    || failFirstInvalidResponses >= MAX_EXTRACTION_ATTEMPTS
  ) {
    throw new Error("fixed_eight_scripted_provider_failure_count_invalid");
  }
  const requestIdPrefix = scenario.requestIdPrefix ?? "fixed-eight-scripted";
  if (!/^[A-Za-z0-9._:-]{1,80}$/u.test(requestIdPrefix)) {
    throw new Error("fixed_eight_scripted_provider_request_id_prefix_invalid");
  }
  const responsesByCanonicalName = new Map<string, DisclosureExtraction>();
  for (const [canonicalName, response] of Object.entries(
    scenario.responsesByCanonicalName,
  )) {
    if (!canonicalName.trim()) {
      throw new Error("fixed_eight_scripted_provider_canonical_name_invalid");
    }
    responsesByCanonicalName.set(canonicalName, DisclosureExtractionSchema.parse(response));
  }

  let providerCalls = 0;
  const observedRepairs: Array<ExtractionRequest["repair"]> = [];
  const provider: ExtractionProvider = {
    extract: async (request) => {
      providerCalls += 1;
      observedRepairs.push(request.repair);
      const requestId = `${requestIdPrefix}-${providerCalls}`;
      if (providerCalls <= failFirstInvalidResponses) {
        throw new ExtractionProviderResponseError(
          "scripted_invalid_response_for_fixed_eight_test",
          {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            usageReported: true,
            requestId,
          },
        );
      }
      const data = responsesByCanonicalName.get(request.canonicalName);
      if (!data) {
        throw new Error(
          `fixed_eight_scripted_provider_response_missing:${request.canonicalName}`,
        );
      }
      return {
        data: DisclosureExtractionSchema.parse(data),
        inputTokens: scenario.inputTokens,
        outputTokens: scenario.outputTokens,
        ...(scenario.cachedInputTokens !== undefined
          ? { cachedInputTokens: scenario.cachedInputTokens }
          : {}),
        ...(scenario.cacheWriteInputTokens !== undefined
          ? { cacheWriteInputTokens: scenario.cacheWriteInputTokens }
          : {}),
        usageReported: true,
        requestId,
      };
    },
  };
  const releaseLock = await acquireExtractionLock(options.stateDir);
  try {
    const manifest = await extractManifestUnlocked(
      options,
      {
        env,
        provider,
        ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
        paidExecutionDomainAccess: testPaidExecutionDomainAccess({
          authorityRoot: dependencies.paidExecutionDomainAuthorityRoot,
        }),
      },
      "fixed_eight",
    );
    return { manifest, providerCalls, observedRepairs };
  } finally {
    await releaseLock();
  }
}
