import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

import { readJsonFile, sha256File, sha256Text, writeJsonFile } from "./io.js";
import { appendAiLedgerEntry, createLedgerId, estimateExtractionCostUsd } from "./ledger.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { EXTRACTION_INSTRUCTIONS, EXTRACTION_PROMPT_VERSION } from "./prompt.js";
import { sourceFileId, sourceFilesForArtifact } from "./provenance.js";
import {
  DisclosureExtractionSchema,
  ExtractionArtifactSchema,
  ExtractionBatchCheckpointSchema,
  type ExtractionArtifact,
  type ExtractionBatchCheckpoint,
  type DisclosureExtraction,
} from "./schemas.js";
import type { IngestManifest, ManifestUnit, SourceFile } from "./types.js";

const ALLOWED_EXTRACTION_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const;
const MAX_TEXT_CHARACTERS_PER_REQUEST = 30_000;
const MAX_IMAGES_PER_REQUEST = 5;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_REQUEST_RAW_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_REQUEST_BASE64_CHARACTERS = 50 * 1024 * 1024;
const MAX_REQUESTS_PER_UNIT = 20;
const MAX_OUTPUT_TOKENS = 8_000;
const EXTRACTION_REQUEST_FORMAT_VERSION = "v3-row-source-provenance";
const EXTRACTION_PROMPT_HASH = sha256Text(
  `${EXTRACTION_INSTRUCTIONS}\0${EXTRACTION_REQUEST_FORMAT_VERSION}`,
);

export type ExtractionModel = (typeof ALLOWED_EXTRACTION_MODELS)[number];

export interface ExtractionSourceReference {
  sourceFileId: string;
  sourcePath: string;
}

export interface ExtractionImageSourceReference {
  artifactId: string;
  sources: ExtractionSourceReference[];
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
}

export interface ExtractionProviderResult {
  data: DisclosureExtraction;
  inputTokens: number;
  outputTokens: number;
  requestId?: string;
}

export interface ExtractionProvider {
  extract(request: ExtractionRequest): Promise<ExtractionProviderResult>;
}

export class ExtractionProviderResponseError extends Error {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requestId?: string;

  constructor(
    message: string,
    audit: { inputTokens: number; outputTokens: number; requestId?: string },
  ) {
    super(message);
    this.name = "ExtractionProviderResponseError";
    this.inputTokens = Number.isSafeInteger(audit.inputTokens) && audit.inputTokens >= 0
      ? audit.inputTokens
      : 0;
    this.outputTokens = Number.isSafeInteger(audit.outputTokens) && audit.outputTokens >= 0
      ? audit.outputTokens
      : 0;
    if (audit.requestId?.trim()) this.requestId = audit.requestId.slice(0, 200);
  }
}

export interface ExtractOptions {
  stateDir: string;
  /** Deprecated name retained for callers; selection is stratified, never sequential. */
  limit?: number;
  unitIds?: string[];
}

export interface ExtractDependencies {
  provider?: ExtractionProvider;
  env?: NodeJS.ProcessEnv;
  sleep?: (milliseconds: number) => Promise<void>;
}

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

function isExtractableUnit(unit: ManifestUnit): boolean {
  return Boolean(unit.conversion)
    && unit.stage !== "needs_manual_conversion"
    && unit.stage !== "scanned"
    && unit.stage !== "validated"
    && unit.stage !== "loaded";
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
  options: { unitIds?: string[]; sampleSize?: number } = {},
): ManifestUnit[] {
  const eligible = manifest.units.filter(isExtractableUnit);
  if (options.unitIds) {
    if (options.unitIds.length === 0) throw new Error("units_empty");
    if (new Set(options.unitIds).size !== options.unitIds.length) throw new Error("duplicate_unit_id");
    const byId = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
    return options.unitIds.map((unitId) => {
      if (!/^[a-f0-9]{64}$/u.test(unitId)) throw new Error(`invalid_unit_id:${unitId}`);
      const unit = byId.get(unitId);
      if (!unit) throw new Error(`unknown_unit_id:${unitId}`);
      if (!isExtractableUnit(unit)) throw new Error(`unit_not_extractable:${unitId}:${unit.stage}`);
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
        ...sourceLines,
        "다음 이미지는 위 원본 파일 식별자에 연결된 공시 증거입니다.",
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
    instructions: EXTRACTION_INSTRUCTIONS,
    input: [{ role: "user", content }],
    max_output_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    reasoning: { effort: "medium" },
    text: {
      format: zodTextFormat(DisclosureExtractionSchema, "vendor_disclosure_v2"),
      verbosity: "low",
    },
    safety_identifier: `disclosure_${request.unitId.slice(0, 24)}`,
    service_tier: "default",
    store: false,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function nonnegativeTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function parseOpenAIExtractionResponse(
  responseData: unknown,
  requestId?: string,
): ExtractionProviderResult {
  const response = recordValue(responseData);
  const usage = recordValue(response?.usage);
  const inputTokens = nonnegativeTokenCount(usage?.input_tokens);
  const outputTokens = nonnegativeTokenCount(usage?.output_tokens);
  const responseRequestId = requestId?.trim()
    || (typeof response?._request_id === "string" ? response._request_id : undefined);
  const audit = {
    inputTokens,
    outputTokens,
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

export function createOpenAIExtractionProvider(env: NodeJS.ProcessEnv = process.env): ExtractionProvider {
  if (env.INGEST_OPENAI_ENABLED !== "true") {
    throw new Error("실제 추출은 INGEST_OPENAI_ENABLED=true일 때만 허용합니다.");
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY가 필요합니다.");
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });

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

function chunkText(text: string, maximumCharacters = MAX_TEXT_CHARACTERS_PER_REQUEST): string[] {
  if (text.length <= maximumCharacters) return text ? [text] : [];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maximumCharacters) {
    const candidate = remaining.slice(0, maximumCharacters);
    const boundary = Math.max(candidate.lastIndexOf("\n## "), candidate.lastIndexOf("\n\n"));
    const splitAt = boundary > maximumCharacters / 2
      ? boundary
      : maximumCharacters;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
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
): string[] {
  if (!text) return [];
  const header = ["[비신뢰 원본 파일 증거 시작]", ...evidenceLabel(artifactId, sources)].join("\n");
  const footer = "[비신뢰 원본 파일 증거 끝]";
  const framingCharacters = header.length + footer.length + 2;
  const payloadLimit = MAX_TEXT_CHARACTERS_PER_REQUEST - framingCharacters;
  if (payloadLimit < 1_000) throw new Error("source_evidence_label_too_large");
  return chunkText(text, payloadLimit).map((fragment) => `${header}\n${fragment}\n${footer}`);
}

function packTextFragments(fragments: string[]): string[] {
  const requests: string[] = [];
  let current = "";
  for (const fragment of fragments) {
    const candidate = current ? `${current}\n\n${fragment}` : fragment;
    if (candidate.length <= MAX_TEXT_CHARACTERS_PER_REQUEST) {
      current = candidate;
      continue;
    }
    if (current) requests.push(current);
    current = fragment;
  }
  if (current) requests.push(current);
  return requests;
}

async function buildRequests(unit: ManifestUnit, model: ExtractionModel): Promise<ExtractionRequest[]> {
  if (!unit.conversion) return [];
  const textFragments = (await Promise.all(unit.conversion.text_artifacts.map(async (filePath) => {
    const [text, digest] = await Promise.all([readFile(filePath, "utf8"), sha256File(filePath)]);
    const sources = sourceFilesForArtifact(unit, filePath).map(toSourceReference);
    return labeledTextFragments(text, digest.sha256, sources);
  }))).flat();
  const textChunks = packTextFragments(textFragments);
  const imageGroups: string[][] = [];
  const imageSourceRefGroups: ExtractionImageSourceReference[][] = [];
  for (let index = 0; index < unit.conversion.image_artifacts.length; index += MAX_IMAGES_PER_REQUEST) {
    const imagePaths = unit.conversion.image_artifacts.slice(index, index + MAX_IMAGES_PER_REQUEST);
    imageGroups.push(imagePaths);
    imageSourceRefGroups.push(await Promise.all(imagePaths.map(async (imagePath) => ({
      artifactId: (await sha256File(imagePath)).sha256,
      sources: sourceFilesForArtifact(unit, imagePath).map(toSourceReference),
    }))));
  }
  const requestCount = Math.max(1, textChunks.length, imageGroups.length);
  if (requestCount > MAX_REQUESTS_PER_UNIT) {
    throw new Error(`한 unit의 추출 요청이 ${MAX_REQUESTS_PER_UNIT}개를 초과합니다. 원본을 사람 검토 후 분할하세요.`);
  }
  return Array.from({ length: requestCount }, (_, index) => ({
    unitId: unit.unit_id,
    model,
    canonicalName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    text: textChunks[index] ?? "",
    imagePaths: imageGroups[index] ?? [],
    imageSourceRefs: imageSourceRefGroups[index] ?? [],
  }));
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

export function mergeExtractionChunks(results: DisclosureExtraction[]): DisclosureExtraction {
  const first = results[0];
  if (!first) throw new Error("추출 결과가 비어 있습니다.");
  const kinds = new Set(results.map((result) => result.doc_kind).filter((kind) => kind !== "unknown"));
  const hallSources = results.map((result) => result.hall);
  const allAgencyPackages = uniqueByValue(results.flatMap((result) => result.agency_packages));
  const agencyConflicts = conflictingKeys(
    allAgencyPackages,
    (item) => item.package_name,
    (item) => JSON.stringify(item),
  );
  const allPartnerVendors = uniqueByValue(results.flatMap((result) => result.partner_vendors));
  const partnerConflicts = conflictingKeys(
    allPartnerVendors,
    (item) => `${item.category}:${item.vendor_name}`,
    (item) => JSON.stringify(item),
  );
  const allHallItems = uniqueByValue(hallSources.flatMap((hall) => hall.items));
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
    agency_packages: allAgencyPackages.map((item) => hasIdentityConflict || agencyConflicts.has(item.package_name)
      ? { ...item, needs_review: true, confidence: Math.min(item.confidence, 0.5) }
      : item),
    partner_vendors: allPartnerVendors.map((item) => hasIdentityConflict || partnerConflicts.has(`${item.category}:${item.vendor_name}`)
      ? { ...item, needs_review: true, confidence: Math.min(item.confidence, 0.5) }
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

function isRetryable(error: unknown): boolean {
  const status = retryStatus(error);
  return status === 429 || (status !== null && status >= 500 && status <= 599);
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

function safeProviderUsage(error: unknown): { inputTokens: number; outputTokens: number } {
  if (!(error instanceof Error)) return { inputTokens: 0, outputTokens: 0 };
  const inputTokens = "inputTokens" in error ? nonnegativeTokenCount(error.inputTokens) : 0;
  const outputTokens = "outputTokens" in error ? nonnegativeTokenCount(error.outputTokens) : 0;
  return { inputTokens, outputTokens };
}

function safeErrorCategory(error: unknown): "rate_limit" | "provider_5xx" | "timeout" | "network" | "invalid_response" | "unknown" {
  const status = retryStatus(error);
  if (status === 429) return "rate_limit";
  if (status !== null && status >= 500 && status <= 599) return "provider_5xx";
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "timeout";
  if (error instanceof Error && ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].some((code) => error.message.includes(code))) return "network";
  if (error instanceof Error && /구조화 출력|검증/u.test(error.message)) return "invalid_response";
  return "unknown";
}

interface AttemptAudit {
  attempt: number;
  latencyMs: number;
  result: ExtractionProviderResult | null;
  error: unknown;
}

async function extractWithRetry(
  provider: ExtractionProvider,
  request: ExtractionRequest,
  sleep: (milliseconds: number) => Promise<void>,
  auditAttempt: (audit: AttemptAudit) => Promise<void>,
): Promise<{
  result: ExtractionProviderResult;
  attempts: number;
  billedInputTokens: number;
  billedOutputTokens: number;
}> {
  let serverRetries = 0;
  let invalidResponseRetries = 0;
  let billedInputTokens = 0;
  let billedOutputTokens = 0;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const startedAt = Date.now();
    let result: ExtractionProviderResult;
    try {
      const candidate = await provider.extract(request);
      const parsed = DisclosureExtractionSchema.safeParse(candidate.data);
      if (!parsed.success) {
        throw new ExtractionProviderResponseError(
          `OpenAI 구조화 출력 검증에 실패했습니다: ${parsed.error.issues[0]?.message ?? "unknown"}`,
          {
            inputTokens: candidate.inputTokens,
            outputTokens: candidate.outputTokens,
            requestId: candidate.requestId,
          },
        );
      }
      result = { ...candidate, data: parsed.data };
    } catch (error) {
      const failedUsage = safeProviderUsage(error);
      billedInputTokens += failedUsage.inputTokens;
      billedOutputTokens += failedUsage.outputTokens;
      await auditAttempt({ attempt, latencyMs: Date.now() - startedAt, result: null, error });
      const category = safeErrorCategory(error);
      if (category === "invalid_response" && invalidResponseRetries < 1) {
        invalidResponseRetries += 1;
        continue;
      }
      if (isRetryable(error) && serverRetries < 3) {
        await sleep(computeRetryDelayMilliseconds(error, serverRetries));
        serverRetries += 1;
        continue;
      }
      throw error;
    }
    billedInputTokens += result.inputTokens;
    billedOutputTokens += result.outputTokens;
    await auditAttempt({ attempt, latencyMs: Date.now() - startedAt, result, error: null });
    return { result, attempts: attempt, billedInputTokens, billedOutputTokens };
  }
  throw new Error("도달할 수 없는 재시도 상태입니다.");
}

async function readCache(cachePath: string): Promise<ExtractionArtifact | null> {
  try {
    const parsed = ExtractionArtifactSchema.safeParse(await readJsonFile(cachePath));
    if (!parsed.success) throw new Error("extract_cache_invalid");
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

interface BatchCheckpointIdentity {
  unitId: string;
  batchIndex: number;
  model: ExtractionModel;
  canonicalIdentity: ExtractionBatchCheckpoint["canonical_identity"];
  artifactFingerprint: string;
  requestHash: string;
}

function batchCheckpointFingerprint(identity: BatchCheckpointIdentity): string {
  return sha256Text(JSON.stringify({
    schema_version: 1,
    unit_id: identity.unitId,
    batch_index: identity.batchIndex,
    prompt_version: EXTRACTION_PROMPT_VERSION,
    prompt_hash: EXTRACTION_PROMPT_HASH,
    model: identity.model,
    canonical_identity: identity.canonicalIdentity,
    artifact_fingerprint: identity.artifactFingerprint,
    request_hash: identity.requestHash,
  }));
}

function batchCheckpointResultHash(result: {
  data: DisclosureExtraction;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  requestId: string | null;
}): string {
  return sha256Text(JSON.stringify({
    data: result.data,
    attempts: result.attempts,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    request_id: result.requestId,
  }));
}

async function extractionRequestHash(request: ExtractionRequest): Promise<string> {
  const images = await Promise.all(request.imagePaths.map(async (imagePath, index) => {
    const digest = await sha256File(imagePath);
    return {
      sha256: digest.sha256,
      bytes: digest.bytes,
      provenance: request.imageSourceRefs[index],
    };
  }));
  return sha256Text(JSON.stringify({
    unit_id: request.unitId,
    model: request.model,
    canonical_name: request.canonicalName,
    region_code: request.regionCode,
    kind_hint: request.kindHint,
    text: request.text,
    images,
  }));
}

async function readBatchCheckpoint(
  checkpointPath: string,
  expectedFingerprint: string,
): Promise<ExtractionBatchCheckpoint | null> {
  try {
    const parsed = ExtractionBatchCheckpointSchema.safeParse(await readJsonFile(checkpointPath));
    if (!parsed.success || parsed.data.checkpoint_fingerprint !== expectedFingerprint) {
      throw new Error("batch_checkpoint_invalid");
    }
    const recomputed = batchCheckpointFingerprint({
      unitId: parsed.data.unit_id,
      batchIndex: parsed.data.batch_index,
      model: parsed.data.model,
      canonicalIdentity: parsed.data.canonical_identity,
      artifactFingerprint: parsed.data.artifact_fingerprint,
      requestHash: parsed.data.request_hash,
    });
    if (recomputed !== expectedFingerprint) throw new Error("batch_checkpoint_invalid");
    const resultHash = batchCheckpointResultHash({
      data: parsed.data.data,
      attempts: parsed.data.attempts,
      inputTokens: parsed.data.input_tokens,
      outputTokens: parsed.data.output_tokens,
      requestId: parsed.data.request_id,
    });
    if (resultHash !== parsed.data.result_hash) throw new Error("batch_checkpoint_invalid");
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error("batch_checkpoint_invalid");
    throw error;
  }
}

function extractionMetadata(
  cache: ExtractionArtifact,
  artifactPath: string,
  cacheHit: boolean,
): NonNullable<ManifestUnit["extraction"]> {
  return {
    fingerprint: cache.fingerprint,
    source_fingerprint: cache.source_fingerprint,
    artifact_fingerprint: cache.artifact_fingerprint,
    prompt_version: cache.prompt_version,
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
  estimation_basis: string;
  units: ExtractionPlanUnit[];
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  maximum_output_tokens: number;
  estimated_cost_usd: number;
  maximum_cost_usd: number;
}

function estimatedRequestInputTokens(request: ExtractionRequest): number {
  const framing = [
    EXTRACTION_INSTRUCTIONS,
    request.canonicalName,
    request.regionCode,
    request.kindHint,
    request.text,
  ].join("\n");
  // Korean text is conservatively approximated from UTF-8 bytes. Vision tokens
  // vary by model/image dimensions, so planning reserves 4,096 per image.
  return Math.ceil(Buffer.byteLength(framing, "utf8") / 3)
    + 2_000
    + (request.imagePaths.length * 4_096);
}

export async function planExtraction(
  options: ExtractOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExtractionPlan> {
  const model = resolveExtractionModel(env);
  const manifest = await loadManifest(options.stateDir);
  const selected = selectExtractionUnits(manifest, {
    ...(options.unitIds ? { unitIds: options.unitIds } : {}),
    ...(!options.unitIds && options.limit !== undefined ? { sampleSize: options.limit } : {}),
  });
  const units: ExtractionPlanUnit[] = [];
  for (const unit of selected) {
    await verifyProvenance(unit, manifest);
    const requests = await buildRequests(unit, model);
    const estimatedInputTokens = requests.reduce(
      (sum, request) => sum + estimatedRequestInputTokens(request),
      0,
    );
    const estimatedOutputTokens = requests.reduce((sum, request) => {
      const input = estimatedRequestInputTokens(request);
      return sum + Math.min(MAX_OUTPUT_TOKENS, Math.max(1_200, Math.ceil(input * 0.2)));
    }, 0);
    const maximumOutputTokens = requests.length * MAX_OUTPUT_TOKENS;
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
      estimated_output_tokens: estimatedOutputTokens,
      maximum_output_tokens: maximumOutputTokens,
      estimated_cost_usd: estimateExtractionCostUsd(model, estimatedInputTokens, estimatedOutputTokens),
      maximum_cost_usd: estimateExtractionCostUsd(model, estimatedInputTokens, maximumOutputTokens),
    });
  }
  const estimatedInputTokens = units.reduce((sum, unit) => sum + unit.estimated_input_tokens, 0);
  const estimatedOutputTokens = units.reduce((sum, unit) => sum + unit.estimated_output_tokens, 0);
  const maximumOutputTokens = units.reduce((sum, unit) => sum + unit.maximum_output_tokens, 0);
  return {
    provider: "openai_responses_api",
    configured_model_env: env.EXTRACTION_MODEL?.trim() || null,
    resolved_model: model,
    luna_semantics: "gpt-5.6-luna is the literal OpenAI API model identifier used by this repository, not an alias mapping; the repository labels it as the lower-cost tier.",
    estimation_basis: "UTF-8 bytes/3 + 2,000 request overhead + 4,096 per image; expected output=max(1,200, 20% input), capped at 8,000; maximum uses 8,000 per request. Repository planning rates, not a provider quote.",
    units,
    estimated_input_tokens: estimatedInputTokens,
    estimated_output_tokens: estimatedOutputTokens,
    maximum_output_tokens: maximumOutputTokens,
    estimated_cost_usd: estimateExtractionCostUsd(model, estimatedInputTokens, estimatedOutputTokens),
    maximum_cost_usd: estimateExtractionCostUsd(model, estimatedInputTokens, maximumOutputTokens),
  };
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
  dependencies: ExtractDependencies = {},
): Promise<IngestManifest> {
  const env = dependencies.env ?? process.env;
  const model = resolveExtractionModel(env);
  const manifest = await loadManifest(options.stateDir);
  const selectedUnits = selectExtractionUnits(manifest, {
    ...(options.unitIds ? { unitIds: options.unitIds } : {}),
    ...(!options.unitIds && options.limit !== undefined ? { sampleSize: options.limit } : {}),
  });
  if (selectedUnits.length > 8) {
    throw new Error("pilot_gate_required_before_more_than_8_units");
  }
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const runId = randomUUID();
  let provider = dependencies.provider;

  for (const unit of selectedUnits) {
    try {
      const conversion = unit.conversion;
      if (!conversion) throw new Error("conversion_missing_after_selection");
      await verifyProvenance(unit, manifest);
      const fingerprint = sha256Text([
        EXTRACTION_PROMPT_VERSION,
        EXTRACTION_PROMPT_HASH,
        model,
        unit.parsed.raw_name,
        unit.parsed.region_code,
        unit.parsed.kind_hint,
        unit.source_fingerprint,
        conversion.artifact_fingerprint,
      ].join("\0"));
      const cachePath = path.join(path.resolve(options.stateDir), ".cache", "extract", `${fingerprint}.json`);
      const cached = await readCache(cachePath);
      if (cached?.fingerprint === fingerprint) {
        unit.extraction = extractionMetadata(cached, cachePath, true);
        unit.stage = "extracted";
        continue;
      }
      const requests = await buildRequests(unit, model);
      const canonicalIdentity: ExtractionBatchCheckpoint["canonical_identity"] = {
        canonical_name: unit.parsed.raw_name,
        region_code: unit.parsed.region_code,
        kind_hint: unit.parsed.kind_hint,
      };
      const preparedBatches = await Promise.all(requests.map(async (request, batchIndex) => {
        const requestHash = await extractionRequestHash(request);
        const checkpointIdentity: BatchCheckpointIdentity = {
          unitId: unit.unit_id,
          batchIndex,
          model,
          canonicalIdentity,
          artifactFingerprint: conversion.artifact_fingerprint,
          requestHash,
        };
        const checkpointFingerprint = batchCheckpointFingerprint(checkpointIdentity);
        const checkpointPath = path.join(
          path.resolve(options.stateDir),
          ".cache",
          "extract-batches",
          `${checkpointFingerprint}.json`,
        );
        const checkpoint = await readBatchCheckpoint(checkpointPath, checkpointFingerprint);
        return {
          request,
          batchIndex,
          requestHash,
          checkpointFingerprint,
          checkpointPath,
          checkpoint,
        };
      }));
      const requiresProvider = preparedBatches.some((batch) => batch.checkpoint === null);
      if (requiresProvider) {
        provider ??= createOpenAIExtractionProvider(env);
      }
      const responses: DisclosureExtraction[] = [];
      let attempts = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      for (const batch of preparedBatches) {
        if (batch.checkpoint) {
          responses.push(batch.checkpoint.data);
          attempts += batch.checkpoint.attempts;
          inputTokens += batch.checkpoint.input_tokens;
          outputTokens += batch.checkpoint.output_tokens;
          continue;
        }
        if (!provider) throw new Error("extraction_provider_unavailable");
        const extracted = await extractWithRetry(provider, batch.request, sleep, async (audit) => {
          const usage = audit.result ?? safeProviderUsage(audit.error);
          await appendAiLedgerEntry(options.stateDir, {
            schema_version: 2,
            ledger_id: createLedgerId(runId, fingerprint, batch.batchIndex, audit.attempt),
            run_id: runId,
            unit_id: unit.unit_id,
            fingerprint,
            prompt_version: EXTRACTION_PROMPT_VERSION,
            model,
            batch_index: batch.batchIndex,
            attempt: audit.attempt,
            request_id: audit.result?.requestId ?? safeRequestId(audit.error),
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            estimated_cost_usd: estimateExtractionCostUsd(model, usage.inputTokens, usage.outputTokens),
            latency_ms: Math.max(0, audit.latencyMs),
            success: audit.result !== null,
            error_category: audit.result ? null : safeErrorCategory(audit.error),
            attempted_at: new Date().toISOString(),
          });
        });
        const checkpoint: ExtractionBatchCheckpoint = ExtractionBatchCheckpointSchema.parse({
          schema_version: 1,
          checkpoint_fingerprint: batch.checkpointFingerprint,
          unit_id: unit.unit_id,
          batch_index: batch.batchIndex,
          prompt_version: EXTRACTION_PROMPT_VERSION,
          prompt_hash: EXTRACTION_PROMPT_HASH,
          model,
          canonical_identity: canonicalIdentity,
          artifact_fingerprint: conversion.artifact_fingerprint,
          request_hash: batch.requestHash,
          result_hash: batchCheckpointResultHash({
            data: extracted.result.data,
            attempts: extracted.attempts,
            inputTokens: extracted.billedInputTokens,
            outputTokens: extracted.billedOutputTokens,
            requestId: extracted.result.requestId ?? null,
          }),
          data: extracted.result.data,
          attempts: extracted.attempts,
          input_tokens: extracted.billedInputTokens,
          output_tokens: extracted.billedOutputTokens,
          request_id: extracted.result.requestId ?? null,
          created_at: new Date().toISOString(),
        });
        await writeJsonFile(batch.checkpointPath, checkpoint);
        responses.push(extracted.result.data);
        attempts += extracted.attempts;
        inputTokens += extracted.billedInputTokens;
        outputTokens += extracted.billedOutputTokens;
      }
      const data = DisclosureExtractionSchema.parse(mergeExtractionChunks(responses));
      const cache: ExtractionArtifact = {
        schema_version: 1,
        fingerprint,
        source_fingerprint: unit.source_fingerprint,
        artifact_fingerprint: conversion.artifact_fingerprint,
        prompt_version: EXTRACTION_PROMPT_VERSION,
        model,
        data,
        attempts,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        created_at: new Date().toISOString(),
      };
      await writeJsonFile(cachePath, cache);
      unit.extraction = extractionMetadata(
        cache,
        cachePath,
        preparedBatches.every((batch) => batch.checkpoint !== null),
      );
      unit.stage = "extracted";
    } catch (error) {
      unit.stage = "error";
      const message = error instanceof Error ? error.message : "알 수 없는 추출 오류";
      unit.notices = Array.from(new Set([...unit.notices, `extract 실패: ${message}`]));
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
  const releaseLock = await acquireExtractionLock(options.stateDir);
  try {
    return await extractManifestUnlocked(options, dependencies);
  } finally {
    await releaseLock();
  }
}
