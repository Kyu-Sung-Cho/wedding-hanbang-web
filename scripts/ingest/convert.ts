import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import JSZip from "jszip";
import pdfParse from "pdf-parse";
import { SaxesParser } from "saxes";
import * as XLSX from "xlsx";

import { HwpExtractionError, extractHwpBuffer } from "./hwp-extract.js";
import { sha256File, sha256Text, writeJsonFile } from "./io.js";
import { loadManifest, saveManifest } from "./manifest.js";
import type { IngestManifest, ManifestUnit } from "./types.js";
import { encodeXlsxSheetName } from "./xlsx-aux-evidence.js";
import {
  createWindowsOcrReviewArtifacts,
  WINDOWS_OCR_CONTRACT_HASH,
  WINDOWS_OCR_CONTRACT_VERSION,
  WindowsOcrReviewError,
  type WindowsOcrReviewResult,
  type WindowsOcrRunner,
} from "./windows-ocr.js";

export const PDF_LAYOUT_EVIDENCE_VERSION = 1;
export const DOCX_TABLE_EVIDENCE_VERSION = 2;
export const CONVERTER_VERSION = `v11-canonical-layout-evidence-pdf${PDF_LAYOUT_EVIDENCE_VERSION}-docx${DOCX_TABLE_EVIDENCE_VERSION}-windows-ocr-review-${WINDOWS_OCR_CONTRACT_HASH.slice(0, 12)}`;
export const CONVERSION_FAILURE_IDENTITY_NOTICE_PREFIX = "convert_failure_identity:";
const CONVERSION_CACHE_CLEANUP_BLOCKED_NOTICE_PREFIX = "convert_cache_cleanup_blocked:";
const OCR_REVIEW_ONLY_NOTICE_PREFIX = "ocr_review_only:";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * HWP 안내문.
 *
 * 2026-08-08까지는 "HWP는 자동 변환하지 않습니다 — 한컴오피스 뷰어로 PDF 저장 후
 * scan부터 다시"였다. 그 정책 때문에 공시 8유닛(전체의 3.2%, 대구·광주·강원
 * 커버리지에 직접 영향)이 통째로 빠져 있었다. 그런데 같은 디렉터리의
 * `hwp-extract.ts`가 그 일을 이미 하고 있었고(테스트 포함) 프로덕션 호출자만
 * 0건이었다 — 실측 결과 8건 중 7건이 가격표·위약금 전문을 그대로 내놓는다.
 *
 * 그래서 **변환은 자동화하되 승인은 사람에게 남긴다**(`bulkApprovalEligible: false`).
 * 텍스트가 안 나오는 것(본문이 통째로 스캔 이미지인 경우)만 아래 안내로 남는다.
 */
const HWP_UNREADABLE_GUIDANCE =
  "HWP를 읽지 못했습니다(암호·배포제한·손상·HWP5 아님). 한컴오피스 뷰어에서 열어 PDF로 같은 위치에 저장한 뒤 scan부터 다시 실행하세요.";
const HWP_OCR_GUIDANCE =
  "HWP 본문에서 판독 가능한 텍스트가 나오지 않았습니다(내용이 스캔 이미지일 수 있습니다). 내장 이미지를 시각 판독 경로로 처리하세요.";
const PDF_RASTER_GUIDANCE =
  "PDF 페이지의 시각 정보 보존을 위한 Poppler(pdftoppm) 래스터화에 실패했습니다. Poppler를 설치하거나 각 페이지를 PNG로 내보내 같은 위치에 둔 뒤 scan부터 다시 실행하세요.";
const OFFICE_MEDIA_FORMAT_GUIDANCE =
  "XLSX/DOCX 내부 미디어가 지원되지 않는 형식입니다. EMF/WMF 같은 이미지를 원본에서 PNG/JPEG/WebP/GIF로 교체하거나 동일 업체 폴더에 PNG로 내보낸 뒤 scan부터 다시 실행하세요.";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_XLSX_MEDIA_COUNT = 100;
const MAX_XLSX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_XLSX_MEDIA_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_XLSX_EMF_PNG_BYTES = 20 * 1024 * 1024;
const MAX_XLSX_EMF_DIMENSION = 8_192;
const MAX_XLSX_EMF_PIXELS = 40_000_000;
const MAX_XLSX_EMF_RASTER_PROCESS_MS = 30_000;
const MAX_XLSX_EMF_RASTER_STDERR_BYTES = 8 * 1024;
const MAX_XLSX_DRAWING_PARTS = 1_000;
const MAX_XLSX_DRAWING_TEXT_NODES = 10_000;
const MAX_XLSX_FORMULA_COUNT = 10_000;
const MAX_XLSX_FORMULA_CHARACTERS = 8_192;
const MAX_XLSX_FORMULA_TOTAL_CHARACTERS = 200_000;
const MAX_XLSX_ARCHIVE_ENTRIES = 10_000;
const MAX_XLSX_ARCHIVE_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_XLSX_ARCHIVE_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_XLSX_SHEETS = 100;
const MAX_XLSX_SHEET_RANGE_CELLS = 250_000;
const MAX_XLSX_NONEMPTY_CELLS = 100_000;
const MAX_XLSX_SERIALIZED_TEXT_CHARACTERS = 300_000;
const MAX_XLSX_MERGES = 10_000;
const MAX_DOCX_ARCHIVE_ENTRIES = 2_048;
const MAX_DOCX_ARCHIVE_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 200;
const MAX_DOCX_MEDIA_COUNT = 100;
const MAX_DOCX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_MEDIA_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_DOCX_TABLES = 1_000;
const MAX_DOCX_TABLE_ROWS = 100_000;
const MAX_DOCX_TABLE_CELLS = 100_000;
const MAX_DOCX_BODY_PARAGRAPHS = 100_000;
const MAX_DOCX_SERIALIZED_TEXT_CHARACTERS = 2_000_000;
const DOCX_RATIO_CHECK_MIN_BYTES = 64 * 1024;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const MAX_PDF_PAGES = 200;
const MAX_PDF_TEXT_CHARACTERS = 600_000;
const MAX_PDF_RASTER_PAGE_BYTES = 20 * 1024 * 1024;
const MAX_PDF_RASTER_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_PDF_RASTER_PROCESS_MS = 120_000;
const MAX_PDF_RASTER_STDERR_BYTES = 16 * 1024;

class IngestConversionLimitError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "IngestConversionLimitError";
  }
}

export interface XlsxFormulaLimitMetadata {
  formulaCount: number;
  expressionCharacters: number;
  totalExpressionCharacters: number;
}

export function validateXlsxFormulaLimits(metadata: XlsxFormulaLimitMetadata): void {
  if (
    !Number.isSafeInteger(metadata.formulaCount)
    || !Number.isSafeInteger(metadata.expressionCharacters)
    || !Number.isSafeInteger(metadata.totalExpressionCharacters)
    || metadata.formulaCount < 0
    || metadata.expressionCharacters < 0
    || metadata.totalExpressionCharacters < 0
  ) {
    throw new IngestConversionLimitError("xlsx_formula_limit_metadata_invalid");
  }
  if (metadata.formulaCount > MAX_XLSX_FORMULA_COUNT) {
    throw new IngestConversionLimitError("xlsx_formula_count_limit");
  }
  if (metadata.expressionCharacters > MAX_XLSX_FORMULA_CHARACTERS) {
    throw new IngestConversionLimitError("xlsx_formula_character_limit");
  }
  if (metadata.totalExpressionCharacters > MAX_XLSX_FORMULA_TOTAL_CHARACTERS) {
    throw new IngestConversionLimitError("xlsx_formula_total_character_limit");
  }
}

interface ConversionFailureIdentity {
  schema_version: 1;
  converter_version: string;
  source_fingerprint: string;
  code: string;
}

function conversionFailureIdentityNotice(unit: ManifestUnit, code: string): string {
  const identity: ConversionFailureIdentity = {
    schema_version: 1,
    converter_version: CONVERTER_VERSION,
    source_fingerprint: unit.source_fingerprint,
    code,
  };
  return `${CONVERSION_FAILURE_IDENTITY_NOTICE_PREFIX}${JSON.stringify(identity)}`;
}

export function isCurrentConversionFailureNotice(
  notice: string,
  sourceFingerprint: string,
): boolean {
  if (!notice.startsWith(CONVERSION_FAILURE_IDENTITY_NOTICE_PREFIX)) return false;
  try {
    const parsed = JSON.parse(
      notice.slice(CONVERSION_FAILURE_IDENTITY_NOTICE_PREFIX.length),
    ) as Partial<ConversionFailureIdentity>;
    return parsed.schema_version === 1
      && parsed.converter_version === CONVERTER_VERSION
      && parsed.source_fingerprint === sourceFingerprint
      && typeof parsed.code === "string"
      && parsed.code.length > 0;
  } catch {
    return false;
  }
}

function clearPriorConversionFailureNotices(unit: ManifestUnit): void {
  unit.notices = unit.notices.filter((notice) =>
    !notice.startsWith(CONVERSION_FAILURE_IDENTITY_NOTICE_PREFIX)
    && !notice.startsWith("convert 실패")
    && !notice.startsWith(PDF_RASTER_GUIDANCE)
    && !notice.startsWith(OCR_REVIEW_ONLY_NOTICE_PREFIX)
    && notice !== OFFICE_MEDIA_FORMAT_GUIDANCE,
  );
}

function recordConversionFailure(
  unit: ManifestUnit,
  code: string,
  humanNotice: string,
  remediation: string[] = [],
): void {
  unit.stage = "error";
  delete unit.conversion;
  delete unit.extraction;
  delete unit.validation;
  unit.notices = Array.from(new Set([
    ...unit.notices.filter(
      (notice) => !notice.startsWith(CONVERSION_FAILURE_IDENTITY_NOTICE_PREFIX),
    ),
    conversionFailureIdentityNotice(unit, code),
    humanNotice,
    ...remediation,
  ]));
}

function assertSupportedOfficeMedia(name: string, format: "docx" | "xlsx"): void {
  const supported = /\.(?:png|jpe?g|webp|gif)$/iu.test(name)
    || (format === "xlsx" && /\.emf$/iu.test(name));
  if (!supported) {
    throw new IngestConversionLimitError(`${format}_media_format_unsupported`);
  }
}

function sourceStemKey(sourcePath: string): string {
  const portable = sourcePath.replace(/\\/g, "/");
  const directory = path.posix.dirname(portable);
  const stem = path.posix.basename(portable, path.posix.extname(portable));
  return `${directory}/${stem}`.normalize("NFKC").toLocaleLowerCase("ko-KR");
}

async function assertSourceSizeLimit(sourcePath: string, declaredBytes: number): Promise<void> {
  const actual = await stat(sourcePath);
  if (declaredBytes > MAX_SOURCE_BYTES || actual.size > MAX_SOURCE_BYTES) {
    throw new IngestConversionLimitError("source_size_limit_50MB");
  }
  if (actual.size !== declaredBytes) {
    throw new IngestConversionLimitError("source_changed_after_scan");
  }
}

export interface ConvertOptions {
  stateDir: string;
  windowsOcrReviewOnly?: boolean;
}

export interface ConvertDependencies {
  extractPdfText?: (sourcePath: string) => Promise<string>;
  rasterizePdf?: (sourcePath: string, outputDirectory: string) => Promise<string[]>;
  rasterizeXlsxEmf?: XlsxEmfRasterizer;
  windowsOcrRunner?: WindowsOcrRunner;
}

export type XlsxEmfRasterizer = (
  content: Buffer,
  scratchDirectory: string,
) => Promise<Buffer>;

export class PdfRasterizerUnavailableError extends Error {
  constructor(message = PDF_RASTER_GUIDANCE) {
    super(message);
    this.name = "PdfRasterizerUnavailableError";
  }
}

async function allFilesExist(filePaths: string[]): Promise<boolean> {
  const results = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    }),
  );
  return results.every(Boolean);
}

async function artifactFingerprint(
  filePaths: string[],
  canonicalFilePaths: string[] = filePaths,
): Promise<string> {
  if (filePaths.length !== canonicalFilePaths.length) {
    throw new Error("artifact fingerprint path cardinality mismatch");
  }
  const records = await Promise.all(
    filePaths.map(async (filePath, index) => {
      const canonicalPath = canonicalFilePaths[index];
      if (canonicalPath === undefined) {
        throw new Error("artifact fingerprint canonical path missing");
      }
      const digest = await sha256File(filePath);
      return `${path.resolve(canonicalPath)}\0${digest.sha256}`;
    }),
  );
  records.sort((left, right) => left.localeCompare(right, "en"));
  return sha256Text(records.join("\n"));
}

async function artifactsMatchFingerprint(
  filePaths: string[],
  expectedFingerprint: string,
): Promise<boolean> {
  if (!(await allFilesExist(filePaths))) return false;
  try {
    return await artifactFingerprint(filePaths) === expectedFingerprint;
  } catch {
    // An artifact can disappear or become unreadable between the existence
    // check and hashing. Treat every such race as a cache miss.
    return false;
  }
}

interface PublishedConversionSnapshot {
  conversion: NonNullable<ManifestUnit["conversion"]>;
  extraction: ManifestUnit["extraction"];
  validation: ManifestUnit["validation"];
}

async function capturePublishedConversionSnapshot(
  unit: ManifestUnit,
): Promise<PublishedConversionSnapshot | null> {
  const conversion = unit.conversion;
  if (
    conversion === undefined
    || conversion.source_fingerprint !== unit.source_fingerprint
    || !await artifactsMatchFingerprint(
      [...conversion.text_artifacts, ...conversion.image_artifacts],
      conversion.artifact_fingerprint,
    )
  ) {
    return null;
  }
  return {
    conversion,
    extraction: unit.extraction,
    validation: unit.validation,
  };
}

async function restorePublishedConversionSnapshot(
  unit: ManifestUnit,
  snapshot: PublishedConversionSnapshot | null,
): Promise<boolean> {
  if (
    snapshot === null
    || !await artifactsMatchFingerprint(
      [
        ...snapshot.conversion.text_artifacts,
        ...snapshot.conversion.image_artifacts,
      ],
      snapshot.conversion.artifact_fingerprint,
    )
  ) {
    return false;
  }
  unit.conversion = snapshot.conversion;
  if (snapshot.extraction !== undefined) unit.extraction = snapshot.extraction;
  if (snapshot.validation !== undefined) unit.validation = snapshot.validation;
  return true;
}

function ocrReviewModeMatches(
  conversion: NonNullable<ManifestUnit["conversion"]>,
  enabled: boolean,
): boolean {
  const metadata = conversion.ocr_review;
  if (!enabled) return metadata === undefined;
  if (conversion.image_artifacts.length === 0) return metadata === undefined;
  return metadata?.contract_version === WINDOWS_OCR_CONTRACT_VERSION
    && metadata.contract_hash === WINDOWS_OCR_CONTRACT_HASH
    && metadata.language === "ko-KR"
    && metadata.review_only === true
    && metadata.authoritative === false
    && metadata.bulk_approval_eligible === false
    && metadata.artifacts.length > 0
    && metadata.artifacts.every((artifact) =>
      conversion.text_artifacts.includes(artifact.artifact_path)
    );
}

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

function filesystemFailureCode(error: unknown): string {
  if (
    error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && /^[A-Za-z0-9_]+$/u.test(error.code)
  ) {
    return error.code;
  }
  return error instanceof Error && /^[A-Za-z0-9_]+$/u.test(error.name)
    ? error.name
    : "unknown";
}

async function lstatIfPresent(filePath: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function assertPlainCacheTree(
  directory: string,
  canonicalConvertedRoot: string,
): Promise<void> {
  const directoryMetadata = await lstat(directory);
  if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
    throw new IngestConversionLimitError("unsafe_reparse_or_non_directory");
  }
  const canonicalDirectory = await realpath(directory);
  if (!isPathWithin(canonicalConvertedRoot, canonicalDirectory)) {
    throw new IngestConversionLimitError("cache_path_outside_state");
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const metadata = await lstat(entryPath);
    if (metadata.isSymbolicLink()) {
      throw new IngestConversionLimitError("unsafe_reparse_or_non_directory");
    }
    if (metadata.isDirectory()) {
      await assertPlainCacheTree(entryPath, canonicalConvertedRoot);
    } else if (!metadata.isFile()) {
      throw new IngestConversionLimitError("unsafe_special_cache_entry");
    }
  }
}

async function ensureGeneratedConversionParent(
  stateDir: string,
  unit: ManifestUnit,
): Promise<string> {
  if (
    !SHA256_HEX_PATTERN.test(unit.unit_id)
    || !SHA256_HEX_PATTERN.test(unit.source_fingerprint)
  ) {
    throw new IngestConversionLimitError("conversion_cache_identity_invalid");
  }
  const stateRoot = path.resolve(stateDir);
  const stateMetadata = await lstat(stateRoot);
  if (stateMetadata.isSymbolicLink() || !stateMetadata.isDirectory()) {
    throw new IngestConversionLimitError("conversion_cache_state_root_unsafe");
  }
  const canonicalStateRoot = await realpath(stateRoot);
  const convertedRoot = path.join(stateRoot, ".converted");
  try {
    await mkdir(convertedRoot);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  }
  const convertedMetadata = await lstat(convertedRoot);
  if (convertedMetadata.isSymbolicLink() || !convertedMetadata.isDirectory()) {
    throw new IngestConversionLimitError("conversion_cache_root_unsafe");
  }
  const canonicalConvertedRoot = await realpath(convertedRoot);
  if (!isPathWithin(canonicalStateRoot, canonicalConvertedRoot)) {
    throw new IngestConversionLimitError("conversion_cache_root_escape");
  }

  const unitRoot = path.join(convertedRoot, unit.unit_id);
  try {
    await mkdir(unitRoot);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  }
  const unitMetadata = await lstat(unitRoot);
  if (unitMetadata.isSymbolicLink() || !unitMetadata.isDirectory()) {
    throw new IngestConversionLimitError("conversion_cache_unit_root_unsafe");
  }
  const canonicalUnitRoot = await realpath(unitRoot);
  if (!isPathWithin(canonicalConvertedRoot, canonicalUnitRoot)) {
    throw new IngestConversionLimitError("conversion_cache_unit_root_escape");
  }

  const finalOutputDirectory = path.join(unitRoot, unit.source_fingerprint);
  const existingOutput = await lstatIfPresent(finalOutputDirectory);
  if (existingOutput !== null && (existingOutput.isSymbolicLink() || !existingOutput.isDirectory())) {
    throw new IngestConversionLimitError("conversion_cache_output_unsafe");
  }
  return finalOutputDirectory;
}

async function invalidateGeneratedConversionCache(
  stateDir: string,
  unit: ManifestUnit,
): Promise<void> {
  const clearCleanupBlock = (): void => {
    unit.notices = unit.notices.filter(
      (notice) => !notice.startsWith(CONVERSION_CACHE_CLEANUP_BLOCKED_NOTICE_PREFIX),
    );
  };
  const blockCleanup = (code: string): void => {
    unit.notices = Array.from(new Set([
      ...unit.notices.filter(
        (notice) => !notice.startsWith(CONVERSION_CACHE_CLEANUP_BLOCKED_NOTICE_PREFIX),
      ),
      `${CONVERSION_CACHE_CLEANUP_BLOCKED_NOTICE_PREFIX}${code}`,
    ]));
  };
  if (
    !SHA256_HEX_PATTERN.test(unit.unit_id)
    || !SHA256_HEX_PATTERN.test(unit.source_fingerprint)
  ) {
    blockCleanup("invalid_identity");
    return;
  }

  const stateRoot = path.resolve(stateDir);
  const convertedRoot = path.join(stateRoot, ".converted");
  const unitRoot = path.join(convertedRoot, unit.unit_id);
  const conversionDirectory = path.join(unitRoot, unit.source_fingerprint);
  const expectedRelativePath = path.join(unit.unit_id, unit.source_fingerprint);
  if (path.relative(convertedRoot, conversionDirectory) !== expectedRelativePath) {
    blockCleanup("path_escape");
    return;
  }

  try {
    for (const boundary of [stateRoot, convertedRoot, unitRoot, conversionDirectory]) {
      const metadata = await lstatIfPresent(boundary);
      if (metadata === null) {
        clearCleanupBlock();
        return;
      }
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        blockCleanup("unsafe_reparse_or_non_directory");
        return;
      }
    }
    const canonicalStateRoot = await realpath(stateRoot);
    const canonicalConvertedRoot = await realpath(convertedRoot);
    const canonicalConversionDirectory = await realpath(conversionDirectory);
    if (
      !isPathWithin(canonicalStateRoot, canonicalConvertedRoot)
      || !isPathWithin(canonicalConvertedRoot, canonicalConversionDirectory)
    ) {
      blockCleanup("path_escape");
      return;
    }
    await assertPlainCacheTree(conversionDirectory, canonicalConvertedRoot);
    await rm(conversionDirectory, { recursive: true, force: false });
    clearCleanupBlock();
  } catch (error) {
    blockCleanup(filesystemFailureCode(error));
  }
}

interface ConversionPublication {
  finalDirectory: string;
  publicationDirectory: string;
  stagingDirectory: string;
}

async function createConversionPublication(finalDirectory: string): Promise<ConversionPublication> {
  const parentDirectory = path.dirname(finalDirectory);
  await mkdir(parentDirectory, { recursive: true });
  const publicationDirectory = await mkdtemp(path.join(parentDirectory, ".publish-"));
  const stagingDirectory = path.join(publicationDirectory, "next");
  try {
    await mkdir(stagingDirectory);
  } catch (error) {
    await rm(publicationDirectory, { recursive: true, force: true });
    throw error;
  }
  return { finalDirectory, publicationDirectory, stagingDirectory };
}

function publishedArtifactPath(
  artifactPath: string,
  publication: ConversionPublication,
): string {
  const relative = path.relative(
    path.resolve(publication.stagingDirectory),
    path.resolve(artifactPath),
  );
  if (
    relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  ) {
    return path.join(publication.finalDirectory, relative);
  }
  // PNG sources are immutable raw inputs and intentionally remain outside the
  // generated conversion directory.
  return artifactPath;
}

async function discardConversionPublication(publication: ConversionPublication): Promise<void> {
  await rm(publication.publicationDirectory, { recursive: true, force: true });
}

async function publishConversionAtomically(publication: ConversionPublication): Promise<void> {
  const previousDirectory = path.join(publication.publicationDirectory, "previous");
  let previousMoved = false;
  let preserveRecoveryDirectory = false;
  try {
    try {
      await rename(publication.finalDirectory, previousDirectory);
      previousMoved = true;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    await rename(publication.stagingDirectory, publication.finalDirectory);
  } catch (publishError) {
    if (previousMoved) {
      try {
        await rename(previousDirectory, publication.finalDirectory);
      } catch (rollbackError) {
        preserveRecoveryDirectory = true;
        throw new AggregateError(
          [publishError, rollbackError],
          `conversion publish and rollback failed; previous artifacts retained at ${previousDirectory}`,
        );
      }
    }
    throw publishError;
  } finally {
    if (!preserveRecoveryDirectory) {
      await rm(publication.publicationDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

interface XlsxConversion {
  textPath: string;
  textCharacters: number;
  cellCount: number;
  imagePaths: string[];
}

interface XlsxDrawingTextRecord {
  locator: string;
  text: string;
}

interface XlsxFormulaRecord {
  sheetName: string;
  cellAddress: string;
  worksheetPart: string;
  expression: string;
  formulaFlags: string[];
  hasCachedValue: boolean;
}

const XLSX_DRAWING_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const DRAWING_MAIN_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
const SPREADSHEET_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
]);
const OFFICE_RELATIONSHIP_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
const PACKAGE_RELATIONSHIP_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://purl.oclc.org/ooxml/package/relationships",
]);

function xmlAttribute(
  attributes: Record<string, { local: string; uri: string; value: string }>,
  local: string,
  acceptedUris: ReadonlySet<string> | null = null,
): string | null {
  const attribute = Object.values(attributes).find((candidate) =>
    candidate.local === local && (acceptedUris === null || acceptedUris.has(candidate.uri))
  );
  return attribute?.value ?? null;
}

function parseXmlStrictly(
  xml: string,
  malformedCode: string,
  configure: (parser: SaxesParser<{ xmlns: true }>) => void,
): void {
  const parser = new SaxesParser({ xmlns: true });
  configure(parser);
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof IngestConversionLimitError) throw error;
    throw new IngestConversionLimitError(malformedCode);
  }
}

function assertUtf8XmlDeclaration(xml: string, code: string): void {
  if (/^\s*<\?xml[^>]*encoding\s*=\s*["'](?!utf-?8["'])/iu.test(xml)) {
    throw new IngestConversionLimitError(code);
  }
}

function decodeUtf8Xml(bytes: Buffer, code: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new IngestConversionLimitError(code);
  }
}

interface WorkbookSheetRelationship {
  sheetName: string;
  relationshipId: string;
}

function parseWorkbookSheetRelationships(xml: string): WorkbookSheetRelationship[] {
  assertUtf8XmlDeclaration(xml, "xlsx_workbook_xml_encoding_unsupported");
  const sheets: WorkbookSheetRelationship[] = [];
  let depth = 0;
  let sawRoot = false;
  parseXmlStrictly(xml, "xlsx_workbook_xml_malformed", (parser) => {
    parser.on("doctype", () => {
      throw new IngestConversionLimitError("xlsx_workbook_xml_doctype_forbidden");
    });
    parser.on("opentag", (tag) => {
      if (depth === 0) {
        if (!SPREADSHEET_NAMESPACES.has(tag.uri) || tag.local !== "workbook") {
          throw new IngestConversionLimitError("xlsx_workbook_xml_root_unsupported");
        }
        sawRoot = true;
      }
      depth += 1;
      if (!SPREADSHEET_NAMESPACES.has(tag.uri) || tag.local !== "sheet") return;
      const attributes = tag.attributes as Record<string, { local: string; uri: string; value: string }>;
      const sheetName = xmlAttribute(attributes, "name");
      const relationshipId = xmlAttribute(attributes, "id", OFFICE_RELATIONSHIP_NAMESPACES);
      if (!sheetName || !relationshipId) {
        throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
      }
      sheets.push({ sheetName: sheetName.normalize("NFKC"), relationshipId });
    });
    parser.on("closetag", () => {
      depth -= 1;
    });
  });
  if (!sawRoot || depth !== 0) {
    throw new IngestConversionLimitError("xlsx_workbook_xml_malformed");
  }
  if (
    new Set(sheets.map(({ sheetName }) => sheetName)).size !== sheets.length
    || new Set(sheets.map(({ relationshipId }) => relationshipId)).size !== sheets.length
  ) {
    throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
  }
  return sheets;
}

function resolveWorksheetRelationshipTarget(target: string): string {
  if (!target || /[\\?#\0]/u.test(target)) {
    throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
  }
  const withoutLeadingSlash = target.replace(/^\/+/, "");
  const resolved = path.posix.normalize(
    withoutLeadingSlash.startsWith("xl/")
      ? withoutLeadingSlash
      : path.posix.join("xl", withoutLeadingSlash),
  );
  if (
    resolved.includes("..")
    || !/^xl\/worksheets\/[A-Za-z0-9._~%-]+\.xml$/u.test(resolved)
  ) {
    throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
  }
  return resolved;
}

function parseWorksheetRelationshipTargets(xml: string): Map<string, string> {
  assertUtf8XmlDeclaration(xml, "xlsx_workbook_relationships_encoding_unsupported");
  const targets = new Map<string, string>();
  let depth = 0;
  let sawRoot = false;
  parseXmlStrictly(xml, "xlsx_workbook_relationships_malformed", (parser) => {
    parser.on("doctype", () => {
      throw new IngestConversionLimitError("xlsx_workbook_relationships_doctype_forbidden");
    });
    parser.on("opentag", (tag) => {
      if (depth === 0) {
        if (!PACKAGE_RELATIONSHIP_NAMESPACES.has(tag.uri) || tag.local !== "Relationships") {
          throw new IngestConversionLimitError("xlsx_workbook_relationships_root_unsupported");
        }
        sawRoot = true;
      }
      depth += 1;
      if (!PACKAGE_RELATIONSHIP_NAMESPACES.has(tag.uri) || tag.local !== "Relationship") return;
      const attributes = tag.attributes as Record<string, { local: string; uri: string; value: string }>;
      const type = xmlAttribute(attributes, "Type");
      if (!type?.endsWith("/worksheet")) return;
      const id = xmlAttribute(attributes, "Id");
      const target = xmlAttribute(attributes, "Target");
      const targetMode = xmlAttribute(attributes, "TargetMode");
      if (!id || !target || targetMode?.toLocaleLowerCase("en-US") === "external") {
        throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
      }
      if (targets.has(id)) {
        throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
      }
      targets.set(id, resolveWorksheetRelationshipTarget(target));
    });
    parser.on("closetag", () => {
      depth -= 1;
    });
  });
  if (!sawRoot || depth !== 0) {
    throw new IngestConversionLimitError("xlsx_workbook_relationships_malformed");
  }
  return targets;
}

interface RawWorksheetFormula {
  cellAddress: string;
  expression: string;
  formulaFlags: string[];
  hasCachedValue: boolean;
}

function parseWorksheetFormulas(xml: string): RawWorksheetFormula[] {
  assertUtf8XmlDeclaration(xml, "xlsx_formula_xml_encoding_unsupported");
  const formulas: RawWorksheetFormula[] = [];
  let formulaCharacters = 0;
  let depth = 0;
  let sawRoot = false;
  let activeCell: {
    address: string;
    formula: string | null;
    formulaFlags: string[];
    cachedValue: string | null;
    collecting: "formula" | "value" | null;
  } | null = null;
  parseXmlStrictly(xml, "xlsx_formula_xml_malformed", (parser) => {
    parser.on("doctype", () => {
      throw new IngestConversionLimitError("xlsx_formula_xml_doctype_forbidden");
    });
    parser.on("opentag", (tag) => {
      if (depth === 0) {
        if (!SPREADSHEET_NAMESPACES.has(tag.uri) || tag.local !== "worksheet") {
          throw new IngestConversionLimitError("xlsx_formula_xml_root_unsupported");
        }
        sawRoot = true;
      }
      depth += 1;
      if (!SPREADSHEET_NAMESPACES.has(tag.uri)) return;
      if (tag.local === "c") {
        if (activeCell) {
          throw new IngestConversionLimitError("xlsx_formula_structure_unsupported");
        }
        const attributes = tag.attributes as Record<string, { local: string; uri: string; value: string }>;
        const address = xmlAttribute(attributes, "r")?.toUpperCase();
        if (!address || !/^[A-Z]+[1-9][0-9]*$/u.test(address)) {
          throw new IngestConversionLimitError("xlsx_formula_cell_address_invalid");
        }
        activeCell = {
          address,
          formula: null,
          formulaFlags: [],
          cachedValue: null,
          collecting: null,
        };
        return;
      }
      if (tag.local === "f") {
        if (!activeCell || activeCell.formula !== null || activeCell.collecting !== null) {
          throw new IngestConversionLimitError("xlsx_formula_structure_unsupported");
        }
        const formulaAttributes = Object.values(tag.attributes) as Array<{
          local: string;
          uri: string;
          value: string;
        }>;
        // `ca` is only a recalculation hint. It is safe to preserve as inert
        // metadata. Shared/array/data-table semantics (`t`, `si`, `ref`, etc.)
        // require expansion and remain fail-closed.
        if (formulaAttributes.some((attribute) =>
          attribute.uri !== ""
          || attribute.local !== "ca"
          || !/^(?:0|1|false|true)$/iu.test(attribute.value)
        )) {
          throw new IngestConversionLimitError("xlsx_formula_structure_unsupported");
        }
        activeCell.formulaFlags = formulaAttributes.map((attribute) =>
          `ca:${/^(?:1|true)$/iu.test(attribute.value) ? "1" : "0"}`
        );
        activeCell.formula = "";
        activeCell.collecting = "formula";
        return;
      }
      if (tag.local === "v" && activeCell) {
        if (activeCell.cachedValue !== null || activeCell.collecting !== null) {
          throw new IngestConversionLimitError("xlsx_formula_structure_unsupported");
        }
        activeCell.cachedValue = "";
        activeCell.collecting = "value";
      }
    });
    const append = (value: string): void => {
      if (activeCell?.collecting === "formula") activeCell.formula += value;
      if (activeCell?.collecting === "value") activeCell.cachedValue += value;
    };
    parser.on("text", append);
    parser.on("cdata", append);
    parser.on("closetag", (tag) => {
      if (SPREADSHEET_NAMESPACES.has(tag.uri) && tag.local === "f") {
        if (!activeCell || activeCell.collecting !== "formula") {
          throw new IngestConversionLimitError("xlsx_formula_structure_unsupported");
        }
        activeCell.collecting = null;
      } else if (SPREADSHEET_NAMESPACES.has(tag.uri) && tag.local === "v") {
        if (!activeCell || activeCell.collecting !== "value") {
          throw new IngestConversionLimitError("xlsx_formula_structure_unsupported");
        }
        activeCell.collecting = null;
      } else if (SPREADSHEET_NAMESPACES.has(tag.uri) && tag.local === "c") {
        if (!activeCell || activeCell.collecting !== null) {
          throw new IngestConversionLimitError("xlsx_formula_structure_unsupported");
        }
        if (activeCell.formula !== null) {
          const expression = activeCell.formula.trim();
          if (!expression) {
            throw new IngestConversionLimitError("xlsx_formula_structure_unsupported");
          }
          formulaCharacters += expression.length;
          validateXlsxFormulaLimits({
            formulaCount: formulas.length + 1,
            expressionCharacters: expression.length,
            totalExpressionCharacters: formulaCharacters,
          });
          formulas.push({
            cellAddress: activeCell.address,
            expression,
            formulaFlags: activeCell.formulaFlags,
            hasCachedValue: activeCell.cachedValue !== null && activeCell.cachedValue.trim().length > 0,
          });
        }
        activeCell = null;
      }
      depth -= 1;
    });
  });
  if (!sawRoot || depth !== 0 || activeCell) {
    throw new IngestConversionLimitError("xlsx_formula_xml_malformed");
  }
  return formulas;
}

function parseXlsxDrawingText(
  xml: string,
  entryName: string,
): { records: XlsxDrawingTextRecord[]; textNodeCount: number } {
  if (/^\s*<\?xml[^>]*encoding\s*=\s*["'](?!utf-?8["'])/iu.test(xml)) {
    throw new IngestConversionLimitError("xlsx_drawing_xml_encoding_unsupported");
  }
  const records: XlsxDrawingTextRecord[] = [];
  let textNodeCount = 0;
  let depth = 0;
  let sawRoot = false;
  let activeBody: {
    paragraphs: string[];
    paragraph: string | null;
    collectingText: boolean;
  } | null = null;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => {
    throw new IngestConversionLimitError("xlsx_drawing_xml_doctype_forbidden");
  });
  parser.on("opentag", (tag) => {
    if (depth === 0) {
      if (tag.uri !== XLSX_DRAWING_NAMESPACE || tag.local !== "wsDr") {
        throw new IngestConversionLimitError("xlsx_drawing_xml_root_unsupported");
      }
      sawRoot = true;
    }
    depth += 1;
    if (tag.uri === XLSX_DRAWING_NAMESPACE && tag.local === "txBody") {
      if (activeBody) {
        throw new IngestConversionLimitError("xlsx_drawing_text_structure_unsupported");
      }
      activeBody = { paragraphs: [], paragraph: null, collectingText: false };
      return;
    }
    if (tag.uri === DRAWING_MAIN_NAMESPACE && tag.local === "p" && activeBody) {
      if (activeBody.paragraph !== null) {
        throw new IngestConversionLimitError("xlsx_drawing_text_structure_unsupported");
      }
      activeBody.paragraph = "";
      return;
    }
    if (tag.uri === DRAWING_MAIN_NAMESPACE && tag.local === "t") {
      if (!activeBody || activeBody.paragraph === null || activeBody.collectingText) {
        throw new IngestConversionLimitError("xlsx_drawing_text_structure_unsupported");
      }
      textNodeCount += 1;
      if (textNodeCount > MAX_XLSX_DRAWING_TEXT_NODES) {
        throw new IngestConversionLimitError("xlsx_drawing_text_node_count_limit");
      }
      activeBody.collectingText = true;
      return;
    }
    if (
      tag.uri === DRAWING_MAIN_NAMESPACE
      && (tag.local === "br" || tag.local === "tab")
      && activeBody
      && activeBody.paragraph !== null
    ) {
      activeBody.paragraph += tag.local === "br" ? "\n" : "\t";
    }
  });
  const appendText = (text: string): void => {
    if (activeBody?.collectingText && activeBody.paragraph !== null) {
      activeBody.paragraph += text;
    } else if (activeBody && text.trim().length > 0) {
      throw new IngestConversionLimitError("xlsx_drawing_text_structure_unsupported");
    }
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", (tag) => {
    if (tag.uri === DRAWING_MAIN_NAMESPACE && tag.local === "t") {
      if (!activeBody?.collectingText) {
        throw new IngestConversionLimitError("xlsx_drawing_text_structure_unsupported");
      }
      activeBody.collectingText = false;
    } else if (tag.uri === DRAWING_MAIN_NAMESPACE && tag.local === "p" && activeBody) {
      if (activeBody.paragraph === null || activeBody.collectingText) {
        throw new IngestConversionLimitError("xlsx_drawing_text_structure_unsupported");
      }
      activeBody.paragraphs.push(activeBody.paragraph);
      activeBody.paragraph = null;
    } else if (tag.uri === XLSX_DRAWING_NAMESPACE && tag.local === "txBody") {
      if (!activeBody || activeBody.paragraph !== null || activeBody.collectingText) {
        throw new IngestConversionLimitError("xlsx_drawing_text_structure_unsupported");
      }
      const text = activeBody.paragraphs.join("\n").trim();
      if (text) {
        records.push({
          locator: `XLSX_DRAWING ${entryName}#text-box-${records.length + 1}`,
          text,
        });
      }
      activeBody = null;
    }
    depth -= 1;
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof IngestConversionLimitError) throw error;
    throw new IngestConversionLimitError("xlsx_drawing_xml_malformed");
  }
  if (!sawRoot || depth !== 0 || activeBody) {
    throw new IngestConversionLimitError("xlsx_drawing_xml_malformed");
  }
  return { records, textNodeCount };
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

interface PopulatedXlsxCell {
  address: string;
  row: number;
  column: number;
  value: string;
}

function populatedWorksheetCells(worksheet: XLSX.WorkSheet): PopulatedXlsxCell[] {
  return Object.entries(worksheet).flatMap(([address, rawCell]) => {
    if (address.startsWith("!") || !/^[A-Z]+[1-9][0-9]*$/iu.test(address)) return [];
    const value = XLSX.utils.format_cell(rawCell as XLSX.CellObject).trim();
    if (!value) return [];
    const decoded = XLSX.utils.decode_cell(address);
    return [{
      address: XLSX.utils.encode_cell(decoded),
      row: decoded.r,
      column: decoded.c,
      value,
    }];
  }).sort((left, right) => left.row - right.row || left.column - right.column);
}

function checkedSerializedLine(
  line: string,
  currentCharacters: number,
): number {
  const next = currentCharacters + line.length + 1;
  if (next > MAX_XLSX_SERIALIZED_TEXT_CHARACTERS) {
    throw new IngestConversionLimitError("xlsx_serialized_text_limit");
  }
  return next;
}

export function workbookToMarkdown(workbook: XLSX.WorkBook): { markdown: string; cellCount: number } {
  if (workbook.SheetNames.length > MAX_XLSX_SHEETS) {
    throw new IngestConversionLimitError("xlsx_sheet_count_limit");
  }
  const output: string[] = [];
  let cellCount = 0;
  let mergeCount = 0;
  let serializedCharacters = 0;
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const populatedCells = populatedWorksheetCells(worksheet);
    if (populatedCells.length === 0) continue;
    const range = {
      s: {
        r: Math.min(...populatedCells.map(({ row }) => row)),
        c: Math.min(...populatedCells.map(({ column }) => column)),
      },
      e: {
        r: Math.max(...populatedCells.map(({ row }) => row)),
        c: Math.max(...populatedCells.map(({ column }) => column)),
      },
    };
    const rangeCells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
    if (!Number.isSafeInteger(rangeCells) || rangeCells > MAX_XLSX_SHEET_RANGE_CELLS) {
      throw new IngestConversionLimitError("xlsx_sheet_range_limit");
    }
    cellCount += populatedCells.length;
    if (cellCount > MAX_XLSX_NONEMPTY_CELLS) {
      throw new IngestConversionLimitError("xlsx_nonempty_cell_limit");
    }

    const merges = worksheet["!merges"] ?? [];
    mergeCount += merges.length;
    if (mergeCount > MAX_XLSX_MERGES) {
      throw new IngestConversionLimitError("xlsx_merge_count_limit");
    }
    const directCells = new Map(populatedCells.map((cell) => [cell.address, cell]));
    const compactMergeCells = new Map<string, PopulatedXlsxCell>();
    const mergeNotices: string[] = [];
    for (const merge of merges) {
      const anchorAddress = XLSX.utils.encode_cell(merge.s);
      const anchor = directCells.get(anchorAddress);
      if (!anchor) continue;
      const mergeAddress = XLSX.utils.encode_range(merge);
      mergeNotices.push(`병합 범위 ${mergeAddress} · 좌상단 ${anchorAddress}`);
      const mergeArea = (merge.e.r - merge.s.r + 1) * (merge.e.c - merge.s.c + 1);
      const canExpandLiterally = Number.isSafeInteger(mergeArea)
        && mergeArea <= 64
        && anchor.value.length <= 80;
      if (!canExpandLiterally) continue;
      for (let row = merge.s.r; row <= merge.e.r; row += 1) {
        for (let column = merge.s.c; column <= merge.e.c; column += 1) {
          const address = XLSX.utils.encode_cell({ r: row, c: column });
          if (directCells.has(address)) continue;
          compactMergeCells.set(address, { address, row, column, value: anchor.value });
        }
      }
    }

    const tableCells = [...populatedCells, ...compactMergeCells.values()]
      .sort((left, right) => left.row - right.row || left.column - right.column);
    const section = [
      `## 시트: ${sheetName}`,
      "",
      ...populatedCells.map(({ address, value }) =>
        `${sheetName}!${address}: ${escapeMarkdownCell(value)}`
      ),
      ...(mergeNotices.length > 0 ? ["", ...mergeNotices] : []),
      "",
      "| 셀 | 값 |",
      "| --- | --- |",
      ...tableCells.map(({ address, value }) =>
        `| ${address} | ${escapeMarkdownCell(value)} |`
      ),
      "",
    ];
    for (const line of section) {
      serializedCharacters = checkedSerializedLine(line, serializedCharacters);
      output.push(line);
    }
  }
  return { markdown: output.join("\n"), cellCount };
}

function zipEntryUncompressedBytes(entry: unknown): number | null {
  if (typeof entry !== "object" || entry === null || !("_data" in entry)) return null;
  const data = entry._data;
  if (typeof data !== "object" || data === null || !("uncompressedSize" in data)) return null;
  return typeof data.uncompressedSize === "number" && Number.isFinite(data.uncompressedSize)
    ? data.uncompressedSize
    : null;
}

function zipEntryCompressedBytes(entry: unknown): number | null {
  if (typeof entry !== "object" || entry === null || !("_data" in entry)) return null;
  const data = entry._data;
  if (typeof data !== "object" || data === null || !("compressedSize" in data)) return null;
  return typeof data.compressedSize === "number" && Number.isFinite(data.compressedSize)
    ? data.compressedSize
    : null;
}

export interface DocxArchiveEntryMetadata {
  name: string;
  compressedBytes: number;
  uncompressedBytes: number;
}

function validateZipArchiveHeader(
  archive: Buffer,
  format: "docx" | "xlsx",
  maximumEntries: number,
): void {
  if (archive.byteLength < ZIP_EOCD_MIN_BYTES) {
    throw new IngestConversionLimitError(`${format}_archive_header_invalid`);
  }
  const minimumOffset = Math.max(
    0,
    archive.byteLength - ZIP_EOCD_MIN_BYTES - ZIP_MAX_COMMENT_BYTES,
  );
  let eocdOffset = -1;
  for (let offset = archive.byteLength - ZIP_EOCD_MIN_BYTES; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === archive.byteLength) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new IngestConversionLimitError(`${format}_archive_header_invalid`);
  }

  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDisk = archive.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  if (
    entriesOnDisk === 0xffff
    || entryCount === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
  ) {
    throw new IngestConversionLimitError(`${format}_archive_zip64_forbidden`);
  }
  if (entryCount > maximumEntries) {
    throw new IngestConversionLimitError(`${format}_archive_entry_count_limit`);
  }
  if (
    entryCount < 1
    || diskNumber !== 0
    || centralDisk !== 0
    || entriesOnDisk !== entryCount
    || centralOffset > eocdOffset
    || centralSize > eocdOffset - centralOffset
    || centralOffset + centralSize !== eocdOffset
  ) {
    throw new IngestConversionLimitError(`${format}_archive_header_invalid`);
  }
}

export function validateDocxArchiveHeader(archive: Buffer): void {
  validateZipArchiveHeader(archive, "docx", MAX_DOCX_ARCHIVE_ENTRIES);
}

export function validateXlsxArchiveHeader(archive: Buffer): void {
  validateZipArchiveHeader(archive, "xlsx", MAX_XLSX_ARCHIVE_ENTRIES);
}

export function validateDocxArchiveLimits(entries: DocxArchiveEntryMetadata[]): void {
  if (entries.length > MAX_DOCX_ARCHIVE_ENTRIES) {
    throw new IngestConversionLimitError("docx_archive_entry_count_limit");
  }
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  let mediaCount = 0;
  let mediaBytes = 0;
  for (const entry of entries) {
    if (
      !Number.isSafeInteger(entry.compressedBytes)
      || entry.compressedBytes < 0
      || !Number.isSafeInteger(entry.uncompressedBytes)
      || entry.uncompressedBytes < 0
    ) {
      throw new IngestConversionLimitError("docx_archive_size_metadata_invalid");
    }
    totalCompressedBytes += entry.compressedBytes;
    totalUncompressedBytes += entry.uncompressedBytes;
    if (totalUncompressedBytes > MAX_DOCX_ARCHIVE_TOTAL_BYTES) {
      throw new IngestConversionLimitError("docx_archive_total_size_limit");
    }
    if (/^word\/media\/[^/]+$/iu.test(entry.name)) {
      mediaCount += 1;
      mediaBytes += entry.uncompressedBytes;
      assertSupportedOfficeMedia(entry.name, "docx");
      if (mediaCount > MAX_DOCX_MEDIA_COUNT) {
        throw new IngestConversionLimitError("docx_media_count_limit");
      }
      if (entry.uncompressedBytes > MAX_DOCX_MEDIA_BYTES) {
        throw new IngestConversionLimitError("docx_media_item_size_limit");
      }
      if (mediaBytes > MAX_DOCX_MEDIA_TOTAL_BYTES) {
        throw new IngestConversionLimitError("docx_media_total_size_limit");
      }
    }
    if (
      entry.uncompressedBytes > DOCX_RATIO_CHECK_MIN_BYTES
      && (
        entry.compressedBytes === 0
        || entry.uncompressedBytes > entry.compressedBytes * MAX_DOCX_COMPRESSION_RATIO
      )
    ) {
      throw new IngestConversionLimitError("docx_archive_compression_ratio_limit");
    }
  }
  if (
    totalUncompressedBytes > DOCX_RATIO_CHECK_MIN_BYTES
    && (
      totalCompressedBytes === 0
      || totalUncompressedBytes > totalCompressedBytes * MAX_DOCX_COMPRESSION_RATIO
    )
  ) {
    throw new IngestConversionLimitError("docx_archive_compression_ratio_limit");
  }
}

async function assertDocxArchiveLimits(source: Buffer): Promise<void> {
  validateDocxArchiveHeader(source);
  const zip = await JSZip.loadAsync(source);
  const entries: DocxArchiveEntryMetadata[] = [];
  for (const entry of Object.values(zip.files).filter((candidate) => !candidate.dir)) {
    const compressedBytes = zipEntryCompressedBytes(entry);
    const uncompressedBytes = zipEntryUncompressedBytes(entry);
    if (compressedBytes === null || uncompressedBytes === null) {
      throw new IngestConversionLimitError("docx_archive_size_metadata_missing");
    }
    entries.push({ name: entry.name, compressedBytes, uncompressedBytes });
  }
  validateDocxArchiveLimits(entries);
}

export interface XlsxArchiveEntryMetadata {
  name: string;
  uncompressedBytes: number;
}

export function validateXlsxArchiveLimits(entries: XlsxArchiveEntryMetadata[]): void {
  if (entries.length > MAX_XLSX_ARCHIVE_ENTRIES) {
    throw new IngestConversionLimitError("xlsx_archive_entry_count_limit");
  }
  let totalBytes = 0;
  let mediaCount = 0;
  let mediaBytes = 0;
  let drawingPartCount = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.uncompressedBytes) || entry.uncompressedBytes < 0) {
      throw new IngestConversionLimitError("xlsx_archive_size_metadata_invalid");
    }
    if (entry.uncompressedBytes > MAX_XLSX_ARCHIVE_ENTRY_BYTES) {
      throw new IngestConversionLimitError("xlsx_archive_entry_size_limit");
    }
    totalBytes += entry.uncompressedBytes;
    if (totalBytes > MAX_XLSX_ARCHIVE_TOTAL_BYTES) {
      throw new IngestConversionLimitError("xlsx_archive_total_size_limit");
    }
    if (/^xl\/media\/[^/]+$/i.test(entry.name)) {
      mediaCount += 1;
      mediaBytes += entry.uncompressedBytes;
      assertSupportedOfficeMedia(entry.name, "xlsx");
      if (mediaCount > MAX_XLSX_MEDIA_COUNT) {
        throw new IngestConversionLimitError("xlsx_media_count_limit");
      }
      if (entry.uncompressedBytes > MAX_XLSX_MEDIA_BYTES) {
        throw new IngestConversionLimitError("xlsx_media_item_size_limit");
      }
      if (mediaBytes > MAX_XLSX_MEDIA_TOTAL_BYTES) {
        throw new IngestConversionLimitError("xlsx_media_total_size_limit");
      }
    }
    if (/^xl\/drawings\/(?!_rels\/)[^/]+$/iu.test(entry.name)) {
      drawingPartCount += 1;
      if (drawingPartCount > MAX_XLSX_DRAWING_PARTS) {
        throw new IngestConversionLimitError("xlsx_drawing_part_count_limit");
      }
      if (!/\.xml$/iu.test(entry.name)) {
        throw new IngestConversionLimitError("xlsx_drawing_part_format_unsupported");
      }
    }
  }
}

async function assertXlsxArchiveLimits(sourcePath: string): Promise<void> {
  const source = await readFile(sourcePath);
  validateXlsxArchiveHeader(source);
  const zip = await JSZip.loadAsync(source);
  const entries: XlsxArchiveEntryMetadata[] = [];
  for (const entry of Object.values(zip.files).filter((candidate) => !candidate.dir)) {
    const bytes = zipEntryUncompressedBytes(entry);
    if (bytes === null) throw new IngestConversionLimitError("xlsx_archive_size_metadata_missing");
    entries.push({ name: entry.name, uncompressedBytes: bytes });
  }
  validateXlsxArchiveLimits(entries);
}

async function extractXlsxDrawingText(sourcePath: string): Promise<XlsxDrawingTextRecord[]> {
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  const drawingEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /^xl\/drawings\/(?!_rels\/)[^/]+$/iu.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const records: XlsxDrawingTextRecord[] = [];
  let textNodeCount = 0;
  for (const entry of drawingEntries) {
    if (!/\.xml$/iu.test(entry.name)) {
      throw new IngestConversionLimitError("xlsx_drawing_part_format_unsupported");
    }
    const bytes = await entry.async("nodebuffer");
    let xml: string;
    try {
      xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new IngestConversionLimitError("xlsx_drawing_xml_utf8_invalid");
    }
    const parsed = parseXlsxDrawingText(xml, entry.name);
    textNodeCount += parsed.textNodeCount;
    if (textNodeCount > MAX_XLSX_DRAWING_TEXT_NODES) {
      throw new IngestConversionLimitError("xlsx_drawing_text_node_count_limit");
    }
    records.push(...parsed.records);
  }
  return records;
}

async function extractXlsxFormulaEvidence(
  sourcePath: string,
  workbook: XLSX.WorkBook,
): Promise<XlsxFormulaRecord[]> {
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  const workbookEntry = zip.file("xl/workbook.xml");
  const relationshipsEntry = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !relationshipsEntry) {
    throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
  }
  const workbookXml = decodeUtf8Xml(
    await workbookEntry.async("nodebuffer"),
    "xlsx_workbook_xml_utf8_invalid",
  );
  const relationshipsXml = decodeUtf8Xml(
    await relationshipsEntry.async("nodebuffer"),
    "xlsx_workbook_relationships_utf8_invalid",
  );
  const sheetRelationships = parseWorkbookSheetRelationships(workbookXml);
  const relationshipTargets = parseWorksheetRelationshipTargets(relationshipsXml);
  if (
    sheetRelationships.length !== workbook.SheetNames.length
    || sheetRelationships.some(({ sheetName }, index) =>
      sheetName !== workbook.SheetNames[index]?.normalize("NFKC")
    )
  ) {
    throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
  }

  const records: XlsxFormulaRecord[] = [];
  const mappedParts = new Set<string>();
  let formulaCharacters = 0;
  for (const { sheetName, relationshipId } of sheetRelationships) {
    const worksheetPart = relationshipTargets.get(relationshipId);
    if (!worksheetPart || mappedParts.has(worksheetPart)) {
      throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
    }
    mappedParts.add(worksheetPart);
    const worksheetEntry = zip.file(worksheetPart);
    if (!worksheetEntry) {
      throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
    }
    const worksheetXml = decodeUtf8Xml(
      await worksheetEntry.async("nodebuffer"),
      "xlsx_formula_xml_utf8_invalid",
    );
    const formulas = parseWorksheetFormulas(worksheetXml);
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      throw new IngestConversionLimitError("xlsx_formula_sheet_mapping_unsupported");
    }
    for (const formula of formulas) {
      formulaCharacters += formula.expression.length;
      validateXlsxFormulaLimits({
        formulaCount: records.length + 1,
        expressionCharacters: formula.expression.length,
        totalExpressionCharacters: formulaCharacters,
      });
      const cachedCell = worksheet[formula.cellAddress] as XLSX.CellObject | undefined;
      const cachedDisplay = cachedCell ? XLSX.utils.format_cell(cachedCell).trim() : "";
      if (formula.hasCachedValue && !cachedDisplay) {
        throw new IngestConversionLimitError("xlsx_formula_cached_value_unavailable");
      }
      records.push({
        sheetName,
        cellAddress: formula.cellAddress,
        worksheetPart,
        expression: formula.expression,
        formulaFlags: formula.formulaFlags,
        hasCachedValue: formula.hasCachedValue,
      });
    }
  }
  return records.sort((left, right) => {
    const sheetOrder = workbook.SheetNames.indexOf(left.sheetName) - workbook.SheetNames.indexOf(right.sheetName);
    if (sheetOrder !== 0) return sheetOrder;
    const leftCell = XLSX.utils.decode_cell(left.cellAddress);
    const rightCell = XLSX.utils.decode_cell(right.cellAddress);
    return leftCell.r - rightCell.r || leftCell.c - rightCell.c;
  });
}

function serializeXlsxFormulaEvidence(record: XlsxFormulaRecord): string {
  const sheet = encodeXlsxSheetName(record.sheetName);
  const locator = [
    "XLSX_FORMULA [sheet=",
    sheet,
    `;cell=${record.cellAddress};part=${record.worksheetPart}#cell-${record.cellAddress}]`,
  ].join("");
  const cachedValueLocator = record.hasCachedValue
    ? `[sheet=${sheet};cell=${record.cellAddress}]`
    : "null";
  const formulaFlags = record.formulaFlags.length > 0
    ? ` | formula_flags=${record.formulaFlags.join(",")}`
    : "";
  return `${locator}: expression=${escapeMarkdownCell(record.expression)}${formulaFlags} | cached_value_locator=${cachedValueLocator} | evaluation=not_executed`;
}

function validateXlsxEmfPng(content: Buffer): void {
  if (content.byteLength > MAX_XLSX_EMF_PNG_BYTES) {
    throw new IngestConversionLimitError("xlsx_emf_png_output_limit");
  }
  if (
    content.byteLength < 24
    || !content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || content.readUInt32BE(8) !== 13
    || content.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new IngestConversionLimitError("xlsx_emf_png_signature_invalid");
  }
  const width = content.readUInt32BE(16);
  const height = content.readUInt32BE(20);
  if (
    width < 1
    || height < 1
    || width > MAX_XLSX_EMF_DIMENSION
    || height > MAX_XLSX_EMF_DIMENSION
  ) {
    throw new IngestConversionLimitError("xlsx_emf_png_dimension_limit");
  }
  if (width * height > MAX_XLSX_EMF_PIXELS) {
    throw new IngestConversionLimitError("xlsx_emf_png_pixel_limit");
  }
}

const SYSTEM_DRAWING_EMF_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$inputPath = $env:HANBANG_EMF_INPUT
$outputPath = $env:HANBANG_EMF_OUTPUT
if ([string]::IsNullOrWhiteSpace($inputPath) -or [string]::IsNullOrWhiteSpace($outputPath)) {
  throw 'missing bounded EMF paths'
}
$image = [System.Drawing.Image]::FromFile($inputPath)
try {
  $width = [int]$image.Width
  $height = [int]$image.Height
  if ($width -lt 1 -or $height -lt 1 -or $width -gt 8192 -or $height -gt 8192) {
    throw 'EMF dimensions exceed bounds'
  }
  if (([int64]$width * [int64]$height) -gt 40000000) {
    throw 'EMF pixel count exceeds bounds'
  }
  $bitmap = [System.Drawing.Bitmap]::new(
    $width,
    $height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.DrawImage($image, 0, 0, $width, $height)
      $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
    }
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $image.Dispose()
}
`;

function xlsxEmfTemporaryRoot(scratchDirectory: string): string {
  let cursor = path.dirname(path.resolve(scratchDirectory));
  while (path.dirname(cursor) !== cursor) {
    if (path.basename(cursor) === ".converted") {
      return path.join(cursor, ".emf-raster-tmp");
    }
    cursor = path.dirname(cursor);
  }
  return scratchDirectory;
}

async function rasterizeXlsxEmfWithSystemDrawing(
  content: Buffer,
  scratchDirectory: string,
): Promise<Buffer> {
  if (process.platform !== "win32") {
    throw new IngestConversionLimitError("xlsx_emf_rasterizer_platform_unsupported");
  }
  const systemRoot = process.env.SystemRoot?.trim() || process.env.WINDIR?.trim();
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new IngestConversionLimitError("xlsx_emf_rasterizer_system_root_invalid");
  }
  const executable = path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const temporaryRoot = xlsxEmfTemporaryRoot(scratchDirectory);
  await mkdir(temporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, "emf-"));
  const inputPath = path.join(temporaryDirectory, "source.emf");
  const outputPath = path.join(temporaryDirectory, "raster.png");
  await writeFile(inputPath, content);
  try {
    const result = await new Promise<{ exitCode: number | null; stderr: string; timedOut: boolean }>((resolve) => {
      const child = spawn(executable, [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(SYSTEM_DRAWING_EMF_SCRIPT, "utf16le").toString("base64"),
      ], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          SystemRoot: systemRoot,
          WINDIR: systemRoot,
          TEMP: process.env.TEMP ?? temporaryDirectory,
          TMP: process.env.TMP ?? temporaryDirectory,
          HANBANG_EMF_INPUT: inputPath,
          HANBANG_EMF_OUTPUT: outputPath,
        },
      });
      const stderrChunks: Buffer[] = [];
      let stderrBytes = 0;
      let timedOut = false;
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      let forcedSettleTimer: NodeJS.Timeout | null = null;
      const finish = (exitCode: number | null, stderr = ""): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (forcedSettleTimer) clearTimeout(forcedSettleTimer);
        resolve({
          exitCode,
          stderr: stderr || Buffer.concat(stderrChunks).toString("utf8"),
          timedOut,
        });
      };
      child.stderr.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = MAX_XLSX_EMF_RASTER_STDERR_BYTES - stderrBytes;
        if (remaining > 0) {
          const kept = bytes.subarray(0, remaining);
          stderrChunks.push(kept);
          stderrBytes += kept.byteLength;
        }
      });
      child.once("error", (error) => finish(
        null,
        error instanceof Error ? error.name : "spawn_error",
      ));
      child.once("close", (code) => finish(code));
      timer = setTimeout(() => {
        timedOut = true;
        const signalled = child.kill("SIGKILL");
        if (!signalled) {
          finish(null);
          return;
        }
        forcedSettleTimer = setTimeout(() => finish(null), 5_000);
      }, MAX_XLSX_EMF_RASTER_PROCESS_MS);
    });
    if (result.timedOut) {
      throw new IngestConversionLimitError("xlsx_emf_raster_process_timeout");
    }
    if (result.exitCode !== 0) {
      throw new IngestConversionLimitError("xlsx_emf_raster_process_failed");
    }
    const outputMetadata = await stat(outputPath);
    if (outputMetadata.size > MAX_XLSX_EMF_PNG_BYTES) {
      throw new IngestConversionLimitError("xlsx_emf_png_output_limit");
    }
    const png = await readFile(outputPath);
    validateXlsxEmfPng(png);
    return png;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function extractXlsxMedia(
  sourcePath: string,
  outputDirectory: string,
  sourceIndex: number,
  rasterizeEmf: XlsxEmfRasterizer,
): Promise<string[]> {
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  const mediaEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && /^xl\/media\/[^/]+$/i.test(entry.name),
  );
  if (mediaEntries.length === 0) return [];

  // XLSX archives commonly reuse names such as xl/media/image1.png. Keep the
  // extracted directory tied to the manifest source-file index so a later
  // workbook cannot overwrite (or be attributed to) an earlier workbook.
  const mediaDirectory = path.join(outputDirectory, `${sourceIndex + 1}-media`);
  await mkdir(mediaDirectory, { recursive: true });
  const outputPaths: string[] = [];
  let extractedBytes = 0;
  for (const entry of mediaEntries) {
    const fileName = path.posix.basename(entry.name);
    assertSupportedOfficeMedia(fileName, "xlsx");
    const content = await entry.async("nodebuffer");
    if (content.byteLength > MAX_XLSX_MEDIA_BYTES) {
      throw new IngestConversionLimitError("xlsx_media_item_size_limit");
    }
    extractedBytes += content.byteLength;
    if (extractedBytes > MAX_XLSX_MEDIA_TOTAL_BYTES) {
      throw new IngestConversionLimitError("xlsx_media_total_size_limit");
    }
    const isEmf = /\.emf$/iu.test(fileName);
    const outputContent = isEmf
      ? await rasterizeEmf(content, mediaDirectory)
      : content;
    if (isEmf) validateXlsxEmfPng(outputContent);
    const outputName = isEmf
      ? `${createHash("sha256").update(content).digest("hex")}.png`
      : fileName;
    const outputPath = path.join(mediaDirectory, outputName);
    await writeFile(outputPath, outputContent);
    outputPaths.push(outputPath);
  }
  return outputPaths;
}

async function convertXlsx(
  sourcePath: string,
  outputDirectory: string,
  index: number,
  rasterizeEmf: XlsxEmfRasterizer,
): Promise<XlsxConversion> {
  await assertXlsxArchiveLimits(sourcePath);
  const workbook = XLSX.readFile(sourcePath, { cellDates: true, cellText: true });
  const formulaEvidence = await extractXlsxFormulaEvidence(sourcePath, workbook);
  const { markdown, cellCount } = workbookToMarkdown(workbook);
  const drawingText = await extractXlsxDrawingText(sourcePath);
  const auxiliarySections = [
    ...(drawingText.length > 0
      ? [
          "## XLSX 도형 텍스트",
          "",
          ...drawingText.map((record) => `${record.locator}: ${escapeMarkdownCell(record.text)}`),
          "",
        ]
      : []),
    ...(formulaEvidence.length > 0
      ? [
          "## XLSX 수식 원문 (실행하지 않음)",
          "",
          ...formulaEvidence.map(serializeXlsxFormulaEvidence),
          "",
        ]
      : []),
  ];
  const completeMarkdown = auxiliarySections.length > 0
    ? [markdown, ...auxiliarySections].join("\n")
    : markdown;
  if (completeMarkdown.length > MAX_XLSX_SERIALIZED_TEXT_CHARACTERS) {
    throw new IngestConversionLimitError("xlsx_serialized_text_limit");
  }
  const textPath = path.join(outputDirectory, `${index + 1}-sheets.txt`);
  await writeFile(textPath, completeMarkdown, "utf8");
  const imagePaths = await extractXlsxMedia(
    sourcePath,
    outputDirectory,
    index,
    rasterizeEmf,
  );
  return { textPath, textCharacters: completeMarkdown.length, cellCount, imagePaths };
}

const WORDPROCESSING_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);

export interface DocxTableCellEvidence {
  table: number;
  row: number;
  column: number;
  locator: string;
  text: string;
  column_span: number;
  vertical_merge: "restart" | "continue" | null;
}

export interface DocxTableSummary {
  table: number;
  rows: number;
  columns: number;
}

export interface DocxBodyParagraphEvidence {
  paragraph: number;
  locator: string;
  text: string;
}

export type DocxCanonicalEvidenceEntry =
  | { kind: "body"; paragraph: DocxBodyParagraphEvidence }
  | { kind: "table_cell"; cell: DocxTableCellEvidence };

export interface DocxTableEvidence {
  tables: DocxTableSummary[];
  cells: DocxTableCellEvidence[];
  bodyParagraphs: DocxBodyParagraphEvidence[];
  orderedEntries: DocxCanonicalEvidenceEntry[];
  evidenceText: string;
}

interface ActiveDocxCell {
  textParts: string[];
  columnSpan: number;
  verticalMerge: "restart" | "continue" | null;
  collectingText: boolean;
}

interface ActiveDocxRow {
  row: number;
  nextColumn: number;
}

interface ActiveDocxTable {
  summary: DocxTableSummary;
  row: ActiveDocxRow | null;
  cell: ActiveDocxCell | null;
}

interface ActiveDocxBodyParagraph {
  paragraph: number;
  textParts: string[];
  collectingText: boolean;
}

function normalizeDocxCellText(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function docxCellMetadataLine(metadata: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url");
  return `[DOCX_CELL_META] ${payload}`;
}

function parsePositiveDocxInteger(value: string | null, errorCode: string): number {
  if (!value || !/^[1-9][0-9]*$/u.test(value)) {
    throw new IngestConversionLimitError(errorCode);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 16_384) {
    throw new IngestConversionLimitError(errorCode);
  }
  return parsed;
}

function parseNonNegativeDocxInteger(value: string | null, errorCode: string): number {
  if (!value || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new IngestConversionLimitError(errorCode);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 16_384) {
    throw new IngestConversionLimitError(errorCode);
  }
  return parsed;
}

/**
 * Builds the authoritative DOCX text stream directly from WordprocessingML.
 * Paragraphs outside tables and table cells are disjoint physical scopes, so
 * each source token occurs once instead of being repeated by a flattened
 * compatibility rendering. Body locators are intentionally disjoint from the
 * workbook `sheet!A1` grammar; only actual table cells enter workbook-aware
 * ownership and row-context logic.
 */
export function extractDocxTableEvidenceFromXml(xml: string): DocxTableEvidence {
  assertUtf8XmlDeclaration(xml, "docx_document_xml_encoding_unsupported");
  const tables: DocxTableSummary[] = [];
  const cells: DocxTableCellEvidence[] = [];
  const bodyParagraphs: DocxBodyParagraphEvidence[] = [];
  const orderedEntries: DocxCanonicalEvidenceEntry[] = [];
  const activeTables: ActiveDocxTable[] = [];
  const activeBodyParagraphs: ActiveDocxBodyParagraph[] = [];
  let totalRows = 0;
  let totalBodyParagraphs = 0;
  let depth = 0;
  let sawRoot = false;

  parseXmlStrictly(xml, "docx_document_xml_malformed", (parser) => {
    parser.on("doctype", () => {
      throw new IngestConversionLimitError("docx_document_xml_doctype_forbidden");
    });
    parser.on("opentag", (tag) => {
      if (depth === 0) {
        if (!WORDPROCESSING_NAMESPACES.has(tag.uri) || tag.local !== "document") {
          throw new IngestConversionLimitError("docx_document_xml_root_unsupported");
        }
        sawRoot = true;
      }
      depth += 1;
      if (!WORDPROCESSING_NAMESPACES.has(tag.uri)) return;

      if (tag.local === "tbl") {
        if (tables.length >= MAX_DOCX_TABLES) {
          throw new IngestConversionLimitError("docx_table_count_limit");
        }
        const summary = { table: tables.length + 1, rows: 0, columns: 0 };
        tables.push(summary);
        activeTables.push({ summary, row: null, cell: null });
        return;
      }

      const activeTable = activeTables.at(-1);
      if (!activeTable) {
        if (tag.local === "p") {
          totalBodyParagraphs += 1;
          if (totalBodyParagraphs > MAX_DOCX_BODY_PARAGRAPHS) {
            throw new IngestConversionLimitError("docx_body_paragraph_count_limit");
          }
          activeBodyParagraphs.push({
            paragraph: totalBodyParagraphs,
            textParts: [],
            collectingText: false,
          });
          return;
        }
        const activeParagraph = activeBodyParagraphs.at(-1);
        if (tag.local === "t" && activeParagraph) {
          if (activeParagraph.collectingText) {
            throw new IngestConversionLimitError("docx_body_text_structure_unsupported");
          }
          activeParagraph.collectingText = true;
          return;
        }
        if (
          (tag.local === "tab" || tag.local === "br" || tag.local === "cr")
          && activeParagraph
        ) {
          activeParagraph.textParts.push(tag.local === "tab" ? "\t" : "\n");
        }
        return;
      }
      if (tag.local === "tr") {
        if (activeTable.row || activeTable.cell) {
          throw new IngestConversionLimitError("docx_table_structure_unsupported");
        }
        totalRows += 1;
        if (totalRows > MAX_DOCX_TABLE_ROWS) {
          throw new IngestConversionLimitError("docx_table_row_count_limit");
        }
        activeTable.summary.rows += 1;
        activeTable.row = { row: activeTable.summary.rows, nextColumn: 0 };
        return;
      }
      if (tag.local === "tc") {
        if (!activeTable.row || activeTable.cell) {
          throw new IngestConversionLimitError("docx_table_structure_unsupported");
        }
        activeTable.cell = {
          textParts: [],
          columnSpan: 1,
          verticalMerge: null,
          collectingText: false,
        };
        return;
      }
      if (tag.local === "gridBefore" && activeTable.row && !activeTable.cell) {
        if (activeTable.row.nextColumn !== 0) {
          throw new IngestConversionLimitError("docx_table_grid_before_invalid");
        }
        const attributes = tag.attributes as Record<string, { local: string; uri: string; value: string }>;
        activeTable.row.nextColumn = parseNonNegativeDocxInteger(
          xmlAttribute(attributes, "val", WORDPROCESSING_NAMESPACES),
          "docx_table_grid_before_invalid",
        );
        return;
      }
      if (tag.local === "gridSpan" && activeTable.cell) {
        const attributes = tag.attributes as Record<string, { local: string; uri: string; value: string }>;
        activeTable.cell.columnSpan = parsePositiveDocxInteger(
          xmlAttribute(attributes, "val", WORDPROCESSING_NAMESPACES),
          "docx_table_grid_span_invalid",
        );
        return;
      }
      if (tag.local === "vMerge" && activeTable.cell) {
        const attributes = tag.attributes as Record<string, { local: string; uri: string; value: string }>;
        const value = xmlAttribute(attributes, "val", WORDPROCESSING_NAMESPACES);
        if (value !== null && value !== "restart" && value !== "continue") {
          throw new IngestConversionLimitError("docx_table_vertical_merge_invalid");
        }
        activeTable.cell.verticalMerge = value === "restart" ? "restart" : "continue";
        return;
      }
      if (tag.local === "t" && activeTable.cell) {
        if (activeTable.cell.collectingText) {
          throw new IngestConversionLimitError("docx_table_text_structure_unsupported");
        }
        activeTable.cell.collectingText = true;
        return;
      }
      if (
        (tag.local === "tab" || tag.local === "br" || tag.local === "cr")
        && activeTable.cell
      ) {
        activeTable.cell.textParts.push(tag.local === "tab" ? "\t" : "\n");
      }
    });

    const appendText = (value: string): void => {
      const activeCell = activeTables.at(-1)?.cell;
      if (activeCell?.collectingText) {
        activeCell.textParts.push(value);
        return;
      }
      if (activeTables.length > 0) return;
      const activeParagraph = activeBodyParagraphs.at(-1);
      if (activeParagraph?.collectingText) activeParagraph.textParts.push(value);
    };
    parser.on("text", appendText);
    parser.on("cdata", appendText);

    parser.on("closetag", (tag) => {
      if (WORDPROCESSING_NAMESPACES.has(tag.uri)) {
        const activeTable = activeTables.at(-1);
        if (tag.local === "t" && activeTable?.cell) {
          if (!activeTable.cell.collectingText) {
            throw new IngestConversionLimitError("docx_table_text_structure_unsupported");
          }
          activeTable.cell.collectingText = false;
        } else if (tag.local === "p" && activeTable?.cell) {
          activeTable.cell.textParts.push("\n");
        } else if (tag.local === "tc") {
          if (!activeTable?.row || !activeTable.cell || activeTable.cell.collectingText) {
            throw new IngestConversionLimitError("docx_table_structure_unsupported");
          }
          if (cells.length >= MAX_DOCX_TABLE_CELLS) {
            throw new IngestConversionLimitError("docx_table_cell_count_limit");
          }
          const column = activeTable.row.nextColumn + 1;
          const columnSpan = activeTable.cell.columnSpan;
          if (activeTable.row.nextColumn + columnSpan > 16_384) {
            throw new IngestConversionLimitError("docx_table_column_limit");
          }
          const locator = `table:${activeTable.summary.table}!${XLSX.utils.encode_col(column - 1)}${activeTable.row.row}`;
          const cell: DocxTableCellEvidence = {
            table: activeTable.summary.table,
            row: activeTable.row.row,
            column,
            locator,
            text: normalizeDocxCellText(activeTable.cell.textParts.join("")),
            column_span: columnSpan,
            vertical_merge: activeTable.cell.verticalMerge,
          };
          cells.push(cell);
          orderedEntries.push({ kind: "table_cell", cell });
          activeTable.row.nextColumn += columnSpan;
          activeTable.summary.columns = Math.max(
            activeTable.summary.columns,
            activeTable.row.nextColumn,
          );
          activeTable.cell = null;
        } else if (tag.local === "tr") {
          if (!activeTable?.row || activeTable.cell) {
            throw new IngestConversionLimitError("docx_table_structure_unsupported");
          }
          activeTable.row = null;
        } else if (tag.local === "tbl") {
          if (!activeTable || activeTable.row || activeTable.cell) {
            throw new IngestConversionLimitError("docx_table_structure_unsupported");
          }
          activeTables.pop();
        } else if (!activeTable) {
          const activeParagraph = activeBodyParagraphs.at(-1);
          if (tag.local === "t" && activeParagraph) {
            if (!activeParagraph.collectingText) {
              throw new IngestConversionLimitError("docx_body_text_structure_unsupported");
            }
            activeParagraph.collectingText = false;
          } else if (tag.local === "p") {
            if (!activeParagraph || activeParagraph.collectingText) {
              throw new IngestConversionLimitError("docx_body_text_structure_unsupported");
            }
            activeBodyParagraphs.pop();
            const paragraph: DocxBodyParagraphEvidence = {
              paragraph: activeParagraph.paragraph,
              locator: `docx:body:p${activeParagraph.paragraph}`,
              text: normalizeDocxCellText(activeParagraph.textParts.join("")),
            };
            if (paragraph.text) {
              bodyParagraphs.push(paragraph);
              orderedEntries.push({ kind: "body", paragraph });
            }
          }
        }
      }
      depth -= 1;
    });
  });

  if (
    !sawRoot
    || depth !== 0
    || activeTables.length > 0
    || activeBodyParagraphs.length > 0
  ) {
    throw new IngestConversionLimitError("docx_document_xml_malformed");
  }

  const evidenceLines: string[] = [];
  for (const entry of orderedEntries) {
    if (entry.kind === "body") {
      evidenceLines.push(
        `${entry.paragraph.locator}: ${escapeMarkdownCell(entry.paragraph.text)}`,
      );
      continue;
    }
    const { cell } = entry;
    if (cell.text) {
      // Keep the colon immediately after the workbook address. Existing local
      // parsers can consume the cell without treating span metadata as part of
      // the sheet name/address or source text.
      evidenceLines.push(`${cell.locator}: ${escapeMarkdownCell(cell.text)}`);
    }
    if (cell.column_span > 1 || cell.vertical_merge !== null || !cell.text) {
      const finalColumn = cell.column + cell.column_span - 1;
      evidenceLines.push(docxCellMetadataLine({
        version: DOCX_TABLE_EVIDENCE_VERSION,
        locator: cell.locator,
        table: cell.table,
        row: cell.row,
        column: cell.column,
        span: cell.column_span > 1
          ? `${XLSX.utils.encode_col(cell.column - 1)}${cell.row}:${XLSX.utils.encode_col(finalColumn - 1)}${cell.row}`
          : null,
        vertical_merge: cell.vertical_merge,
        empty: !cell.text,
      }));
    }
  }
  const evidenceText = evidenceLines.join("\n");
  if (evidenceText.length > MAX_DOCX_SERIALIZED_TEXT_CHARACTERS) {
    throw new IngestConversionLimitError("docx_table_serialized_text_limit");
  }
  return { tables, cells, bodyParagraphs, orderedEntries, evidenceText };
}

async function convertDocx(
  sourcePath: string,
  outputDirectory: string,
  index: number,
): Promise<{
  textPath: string;
  textCharacters: number;
  imagePaths: string[];
  notices: string[];
}> {
  const source = await readFile(sourcePath);
  await assertDocxArchiveLimits(source);
  const zip = await JSZip.loadAsync(source);
  const documentEntry = zip.file("word/document.xml");
  if (!documentEntry) {
    throw new IngestConversionLimitError("docx_document_xml_missing");
  }
  const documentXml = decodeUtf8Xml(
    await documentEntry.async("nodebuffer"),
    "docx_document_xml_utf8_invalid",
  );
  const tableEvidence = extractDocxTableEvidenceFromXml(documentXml);
  const text = tableEvidence.evidenceText;
  if (text.length > MAX_DOCX_SERIALIZED_TEXT_CHARACTERS) {
    throw new IngestConversionLimitError("docx_serialized_text_limit");
  }
  const textPath = path.join(outputDirectory, `${index + 1}-doc.txt`);
  await writeFile(textPath, text, "utf8");
  const mediaEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /^word\/media\/[^/]+$/iu.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const imagePaths: string[] = [];
  if (mediaEntries.length > 0) {
    const mediaDirectory = path.join(outputDirectory, `${index + 1}-docx-media`);
    await mkdir(mediaDirectory, { recursive: true });
    let extractedBytes = 0;
    for (const entry of mediaEntries) {
      assertSupportedOfficeMedia(path.posix.basename(entry.name), "docx");
      const content = await entry.async("nodebuffer");
      if (content.byteLength > MAX_DOCX_MEDIA_BYTES) {
        throw new IngestConversionLimitError("docx_media_item_size_limit");
      }
      extractedBytes += content.byteLength;
      if (extractedBytes > MAX_DOCX_MEDIA_TOTAL_BYTES) {
        throw new IngestConversionLimitError("docx_media_total_size_limit");
      }
      const outputPath = path.join(mediaDirectory, path.posix.basename(entry.name));
      await writeFile(outputPath, content);
      imagePaths.push(outputPath);
    }
  }
  return {
    textPath,
    textCharacters: text.length,
    imagePaths,
    notices: [],
  };
}

export interface PdfTextLimitMetadata {
  pageCount: number | null;
  textCharacters: number;
}

export function validatePdfTextLimits(metadata: PdfTextLimitMetadata): void {
  if (
    metadata.pageCount !== null
    && (!Number.isSafeInteger(metadata.pageCount) || metadata.pageCount < 1 || metadata.pageCount > MAX_PDF_PAGES)
  ) {
    throw new IngestConversionLimitError("pdf_page_count_limit");
  }
  if (
    !Number.isSafeInteger(metadata.textCharacters)
    || metadata.textCharacters < 0
    || metadata.textCharacters > MAX_PDF_TEXT_CHARACTERS
  ) {
    throw new IngestConversionLimitError("pdf_text_output_limit");
  }
}

export const PDF_LAYOUT_ROW_TOLERANCE_POINTS = 0.75;

export interface PdfPositionedTextItem {
  text: string;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
}

export interface PdfPositionedTextPage {
  page: number;
  items: readonly PdfPositionedTextItem[];
}

export interface PdfLayoutItem {
  text: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
}

export interface PdfLayoutRow {
  page: number;
  row: number;
  anchor_y: number;
  items: PdfLayoutItem[];
}

export interface PdfLayoutTextEvidence {
  orderedText: string;
  evidenceText: string;
  combinedText: string;
  rows: PdfLayoutRow[];
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalPdfNumber(value: number, errorCode: string): number {
  if (!Number.isFinite(value)) throw new IngestConversionLimitError(errorCode);
  return Object.is(value, -0) ? 0 : value;
}

function optionalPdfNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return canonicalPdfNumber(value, "pdf_text_item_geometry_invalid");
}

function normalizePdfRowText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\n\f\v]+/gu, " ")
    .replace(/ {2,}/gu, " ")
    .trim();
}

function formatPdfCoordinate(value: number): string {
  return value.toFixed(3).replace(/(?:\.0+|(\.[0-9]*?)0+)$/u, "$1");
}

/**
 * Builds a stable top-to-bottom, left-to-right representation of PDF.js text
 * items. A row is anchored to its first (highest-y) item; comparing every
 * later item to that fixed anchor deliberately prevents transitive y-chaining
 * from joining separate visual rows.
 */
export function buildPdfLayoutTextEvidence(
  inputPages: readonly PdfPositionedTextPage[],
): PdfLayoutTextEvidence {
  const pageItems = new Map<number, PdfLayoutItem[]>();
  for (const inputPage of inputPages) {
    if (
      !Number.isSafeInteger(inputPage.page)
      || inputPage.page < 1
      || inputPage.page > MAX_PDF_PAGES
    ) {
      throw new IngestConversionLimitError("pdf_text_item_page_invalid");
    }
    const items = pageItems.get(inputPage.page) ?? [];
    for (const inputItem of inputPage.items) {
      if (typeof inputItem.text !== "string") {
        throw new IngestConversionLimitError("pdf_text_item_text_invalid");
      }
      items.push({
        text: inputItem.text,
        x: canonicalPdfNumber(inputItem.x, "pdf_text_item_geometry_invalid"),
        y: canonicalPdfNumber(inputItem.y, "pdf_text_item_geometry_invalid"),
        width: optionalPdfNumber(inputItem.width),
        height: optionalPdfNumber(inputItem.height),
      });
    }
    pageItems.set(inputPage.page, items);
  }

  const rows: PdfLayoutRow[] = [];
  for (const [page, items] of [...pageItems.entries()].sort(([left], [right]) => left - right)) {
    const sortedItems = [...items].sort((left, right) =>
      right.y - left.y
      || left.x - right.x
      || compareOrdinal(left.text, right.text)
      || (left.width ?? -1) - (right.width ?? -1)
      || (left.height ?? -1) - (right.height ?? -1)
    );
    const pageRows: Array<{ anchorY: number; items: PdfLayoutItem[] }> = [];
    for (const item of sortedItems) {
      // Items are already descending by y. If the newest row anchor is too
      // far away, every older anchor is even farther away, so only the newest
      // row can match. This keeps clustering linear after the initial sort.
      const newestRow = pageRows.at(-1);
      const matchingRow = newestRow
        && Math.abs(newestRow.anchorY - item.y) <= PDF_LAYOUT_ROW_TOLERANCE_POINTS
        ? newestRow
        : undefined;
      if (matchingRow) {
        matchingRow.items.push(item);
      } else {
        pageRows.push({ anchorY: item.y, items: [item] });
      }
    }
    for (const [rowIndex, pageRow] of pageRows.entries()) {
      pageRow.items.sort((left, right) =>
        left.x - right.x
        || right.y - left.y
        || compareOrdinal(left.text, right.text)
        || (left.width ?? -1) - (right.width ?? -1)
        || (left.height ?? -1) - (right.height ?? -1)
      );
      rows.push({
        page,
        row: rowIndex + 1,
        anchor_y: pageRow.anchorY,
        items: pageRow.items,
      });
    }
  }

  const orderedPages = new Map<number, string[]>();
  for (const row of rows) {
    const line = row.items
      .map((item) => normalizePdfRowText(item.text))
      .filter(Boolean)
      .join("\t");
    if (!line) continue;
    const pageLines = orderedPages.get(row.page) ?? [];
    pageLines.push(line);
    orderedPages.set(row.page, pageLines);
  }
  const orderedText = [...orderedPages.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, lines]) => lines.join("\n"))
    .join("\n\n");

  const evidenceLines = rows.map((row) => {
    const record = {
      version: PDF_LAYOUT_EVIDENCE_VERSION,
      page: row.page,
      row: row.row,
      anchor_y: row.anchor_y,
      items: row.items.map((item, index) => ({
        column: index + 1,
        text: item.text,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      })),
    };
    const payload = Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
    return `[PDF_LAYOUT_EVIDENCE_V${PDF_LAYOUT_EVIDENCE_VERSION} page=${row.page} row=${row.row} y=${formatPdfCoordinate(row.anchor_y)}] ${payload}`;
  });
  const evidenceText = evidenceLines.length > 0
    ? [
        `[PDF_LAYOUT_EVIDENCE_V${PDF_LAYOUT_EVIDENCE_VERSION}_BEGIN]`,
        ...evidenceLines,
        `[PDF_LAYOUT_EVIDENCE_V${PDF_LAYOUT_EVIDENCE_VERSION}_END]`,
      ].join("\n")
    : "";
  const combinedText = [orderedText, evidenceText].filter(Boolean).join("\n\n");
  validatePdfTextLimits({ pageCount: null, textCharacters: combinedText.length });
  return { orderedText, evidenceText, combinedText, rows };
}

async function defaultExtractPdfText(sourcePath: string): Promise<string> {
  const positionedPages: PdfPositionedTextPage[] = [];
  let fallbackPageNumber = 0;
  let pageRenderError: unknown = null;
  const parsed = await pdfParse(await readFile(sourcePath), {
    max: MAX_PDF_PAGES + 1,
    pagerender: async (pageData: unknown) => {
      try {
        fallbackPageNumber += 1;
        const pageRecord = pageData as {
          pageNumber?: unknown;
          getTextContent?: (options?: Record<string, unknown>) => Promise<{ items?: unknown[] }>;
        };
        if (typeof pageRecord.getTextContent !== "function") {
          throw new IngestConversionLimitError("pdf_text_content_api_unavailable");
        }
        const content = await pageRecord.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false,
        });
        const positionedItems: PdfPositionedTextItem[] = [];
        let fallbackText = "";
        let lastFallbackY: number | undefined;
        for (const unknownItem of content.items ?? []) {
          const item = unknownItem as {
            str?: unknown;
            transform?: unknown;
            width?: unknown;
            height?: unknown;
          };
          if (typeof item.str !== "string") continue;
          const itemY = Array.isArray(item.transform) && Number.isFinite(item.transform[5])
            ? Number(item.transform[5])
            : undefined;
          if (fallbackText && lastFallbackY !== undefined && itemY !== lastFallbackY) {
            fallbackText += "\n";
          } else if (fallbackText && itemY === undefined) {
            fallbackText += " ";
          }
          fallbackText += item.str;
          lastFallbackY = itemY;
          if (
            !Array.isArray(item.transform)
            || !Number.isFinite(item.transform[4])
            || !Number.isFinite(item.transform[5])
          ) {
            continue;
          }
          positionedItems.push({
            text: item.str,
            x: Number(item.transform[4]),
            y: Number(item.transform[5]),
            width: typeof item.width === "number" && Number.isFinite(item.width) ? item.width : null,
            height: typeof item.height === "number" && Number.isFinite(item.height) ? item.height : null,
          });
        }
        const declaredPageNumber = Number(pageRecord.pageNumber);
        const page = Number.isSafeInteger(declaredPageNumber) && declaredPageNumber > 0
          ? declaredPageNumber
          : fallbackPageNumber;
        positionedPages.push({ page, items: positionedItems });
        // pdf-parse still needs a string from pagerender. This reproduces its
        // historical y-change fallback for malformed/legacy unpositioned text.
        return fallbackText;
      } catch (error) {
        // pdf-parse 1.x swallows pagerender failures. Capture and rethrow after
        // it returns so conversion cannot silently publish an incomplete PDF.
        pageRenderError ??= error;
        return "";
      }
    },
  });
  if (pageRenderError) throw pageRenderError;
  validatePdfTextLimits({ pageCount: parsed.numpages, textCharacters: parsed.text.length });
  const layout = buildPdfLayoutTextEvidence(positionedPages);
  const text = layout.rows.length > 0 ? layout.combinedText : parsed.text;
  validatePdfTextLimits({ pageCount: parsed.numpages, textCharacters: text.length });
  return text;
}

export interface PdfRasterArtifactMetadata {
  name: string;
  bytes: number;
}

export function validatePdfRasterLimits(entries: PdfRasterArtifactMetadata[]): void {
  if (entries.length > MAX_PDF_PAGES) {
    throw new IngestConversionLimitError("pdf_raster_page_count_limit");
  }
  let totalBytes = 0;
  for (const entry of entries) {
    if (!/^page-[1-9][0-9]*\.png$/iu.test(entry.name)) {
      throw new IngestConversionLimitError("pdf_raster_artifact_name_invalid");
    }
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new IngestConversionLimitError("pdf_raster_size_metadata_invalid");
    }
    if (entry.bytes > MAX_PDF_RASTER_PAGE_BYTES) {
      throw new IngestConversionLimitError("pdf_raster_page_output_limit");
    }
    totalBytes += entry.bytes;
    if (totalBytes > MAX_PDF_RASTER_TOTAL_BYTES) {
      throw new IngestConversionLimitError("pdf_raster_total_output_limit");
    }
  }
}

export interface PdfRasterCommandRequest {
  sourcePath: string;
  outputPrefix: string;
  timeoutMs: number;
  maxStderrBytes: number;
}

export interface PdfRasterCommandResult {
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
}

export type PdfRasterCommandRunner = (
  request: PdfRasterCommandRequest,
) => Promise<PdfRasterCommandResult>;

async function runPdfRasterCommand(request: PdfRasterCommandRequest): Promise<PdfRasterCommandResult> {
  return new Promise<PdfRasterCommandResult>((resolve) => {
    const executable = process.env.INGEST_PDFTOPPM_PATH?.trim() || "pdftoppm";
    const child = spawn(executable, [
      "-png",
      "-r",
      "180",
      "-f",
      "1",
      "-l",
      String(MAX_PDF_PAGES),
      request.sourcePath,
      request.outputPrefix,
    ], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;
    let forcedSettleTimer: NodeJS.Timeout | null = null;
    const finish = (result: PdfRasterCommandResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forcedSettleTimer) clearTimeout(forcedSettleTimer);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({
        ...result,
        stderr: stderrTruncated ? `${stderr}\n[stderr truncated]` : stderr,
      });
    };
    child.stderr.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = request.maxStderrBytes - stderrBytes;
      if (remaining > 0) {
        const kept = bytes.subarray(0, remaining);
        stderrChunks.push(kept);
        stderrBytes += kept.byteLength;
      }
      if (bytes.byteLength > remaining) stderrTruncated = true;
    });
    child.once("error", (error) => finish({
      exitCode: null,
      stderr: error instanceof Error ? error.name : "spawn_error",
      timedOut,
    }));
    // `exit` can fire before Windows has closed the child stdio handles and
    // published every generated page. `close` is the safe point for reading
    // the raster output directory.
    child.once("close", (code) => finish({ exitCode: code, stderr: "", timedOut }));
    timer = setTimeout(() => {
      timedOut = true;
      const signalled = child.kill("SIGKILL");
      if (!signalled) {
        finish({ exitCode: null, stderr: "", timedOut: true });
        return;
      }
      forcedSettleTimer = setTimeout(
        () => finish({ exitCode: null, stderr: "", timedOut: true }),
        5_000,
      );
    }, request.timeoutMs);
  });
}

async function rasterPageEntries(outputDirectory: string): Promise<Array<{ name: string; path: string; bytes: number }>> {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const pages = entries
    .filter((entry) => entry.isFile() && /^page-\d+\.png$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en", { numeric: true }));
  const withSizes = await Promise.all(pages.map(async (entry) => ({
    name: entry.name,
    path: path.join(outputDirectory, entry.name),
    bytes: (await stat(path.join(outputDirectory, entry.name))).size,
  })));
  validatePdfRasterLimits(withSizes);
  return withSizes;
}

function pdfRasterTemporaryRoot(outputDirectory: string): string {
  let cursor = path.dirname(path.resolve(outputDirectory));
  while (path.dirname(cursor) !== cursor) {
    if (path.basename(cursor) === ".converted") {
      return path.join(cursor, ".pdf-raster-tmp");
    }
    cursor = path.dirname(cursor);
  }
  return path.dirname(outputDirectory);
}

export async function rasterizePdfSafely(
  sourcePath: string,
  outputDirectory: string,
  runner: PdfRasterCommandRunner = runPdfRasterCommand,
): Promise<string[]> {
  try {
    await access(outputDirectory);
    const existingPages = await rasterPageEntries(outputDirectory);
    if (existingPages.length === 0) {
      throw new IngestConversionLimitError("pdf_raster_publish_destination_exists");
    }
    return existingPages.map((page) => page.path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const parentDirectory = path.dirname(outputDirectory);
  const temporaryRoot = pdfRasterTemporaryRoot(outputDirectory);
  await Promise.all([
    mkdir(parentDirectory, { recursive: true }),
    mkdir(temporaryRoot, { recursive: true }),
  ]);
  // Poppler on Windows can exit successfully without output when the deeply
  // content-addressed destination exceeds its path limit. Render under the
  // short, same-volume state scratch directory and atomically publish only
  // after every page has passed the size/count checks.
  const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, "pdf-"));
  let published = false;
  try {
    const result = await runner({
      sourcePath,
      outputPrefix: path.join(temporaryDirectory, "page"),
      timeoutMs: MAX_PDF_RASTER_PROCESS_MS,
      maxStderrBytes: MAX_PDF_RASTER_STDERR_BYTES,
    });
    if (result.timedOut) {
      throw new IngestConversionLimitError("pdf_raster_process_timeout");
    }
    if (result.exitCode !== 0) {
      const boundedStderr = Buffer.from(result.stderr).subarray(0, MAX_PDF_RASTER_STDERR_BYTES).toString("utf8").trim();
      throw new PdfRasterizerUnavailableError(
        `${PDF_RASTER_GUIDANCE} (${boundedStderr || `exit ${result.exitCode ?? "unknown"}`})`,
      );
    }
    const pages = await rasterPageEntries(temporaryDirectory);
    if (pages.length === 0) throw new PdfRasterizerUnavailableError();
    await rename(temporaryDirectory, outputDirectory);
    published = true;
    return pages.map((page) => path.join(outputDirectory, page.name));
  } finally {
    if (!published) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function defaultRasterizePdf(sourcePath: string, outputDirectory: string): Promise<string[]> {
  return rasterizePdfSafely(sourcePath, outputDirectory);
}

export async function convertManifest(
  options: ConvertOptions,
  dependencies: ConvertDependencies = {},
): Promise<IngestManifest> {
  const manifest = await loadManifest(options.stateDir);
  const manualQueue: Array<{ unit_id: string; source_file: string; instruction: string }> = [];

  for (const unit of manifest.units) {
    if (unit.parsed.region_code === "unknown") continue;
    const hwpFiles = unit.source_files.filter((source) => source.ext === "hwp");
    const replacementPdfStems = new Set(
      unit.source_files.filter((source) => source.ext === "pdf").map((source) => sourceStemKey(source.path)),
    );
    // HWP는 이제 로컬 추출기로 변환한다. 사람 손이 필요한지는 변환을 **해 본 뒤**
    // 결정된다 — 미리 needs_manual_conversion으로 찍으면 되는 것까지 막힌다.
    const unconvertedHwpFiles = hwpFiles.filter((source) => !replacementPdfStems.has(sourceStemKey(source.path)));

    const publishedSnapshot = await capturePublishedConversionSnapshot(unit);

    if (
      publishedSnapshot !== null
      && publishedSnapshot.conversion.converter_version === CONVERTER_VERSION
      && ocrReviewModeMatches(publishedSnapshot.conversion, options.windowsOcrReviewOnly === true)
      && unit.stage !== "needs_manual_conversion"
      && unit.stage !== "error"
    ) {
      continue;
    }

    // PDF 대체본이 있는 HWP만 건너뛴다(그 PDF가 이미 근거다). 나머지 HWP는 변환한다.
    const convertibleFiles = unit.source_files.filter((source) =>
      source.ext !== "hwp" || unconvertedHwpFiles.includes(source));
    if (convertibleFiles.length === 0) continue;
    clearPriorConversionFailureNotices(unit);
    let finalOutputDirectory: string;
    let publication: ConversionPublication;
    try {
      finalOutputDirectory = await ensureGeneratedConversionParent(options.stateDir, unit);
      publication = await createConversionPublication(finalOutputDirectory);
    } catch (error) {
      const category = error instanceof IngestConversionLimitError
        ? error.code
        : error instanceof Error
          ? error.name
          : "unknown";
      recordConversionFailure(
        unit,
        category,
        `convert 실패: output_directory (${category})`,
      );
      if (!await restorePublishedConversionSnapshot(unit, publishedSnapshot)) {
        await invalidateGeneratedConversionCache(options.stateDir, unit);
      }
      continue;
    }
    const outputDirectory = publication.stagingDirectory;
    const textArtifacts: string[] = [];
    const imageArtifacts: string[] = [];
    let textCharacters = 0;
    let cellCount = 0;
    let requiresManualPdf = false;
    let conversionFailed = false;
    let ocrReview: WindowsOcrReviewResult | undefined;

    for (const [index, source] of convertibleFiles.entries()) {
      try {
        await assertSourceSizeLimit(source.absolute_path, source.bytes);
        if (source.ext === "xlsx") {
          const converted = await convertXlsx(
            source.absolute_path,
            outputDirectory,
            index,
            dependencies.rasterizeXlsxEmf ?? rasterizeXlsxEmfWithSystemDrawing,
          );
          textArtifacts.push(converted.textPath);
          imageArtifacts.push(...converted.imagePaths);
          textCharacters += converted.textCharacters;
          cellCount += converted.cellCount;
        } else if (source.ext === "docx") {
          const converted = await convertDocx(source.absolute_path, outputDirectory, index);
          textArtifacts.push(converted.textPath);
          imageArtifacts.push(...converted.imagePaths);
          textCharacters += converted.textCharacters;
          unit.notices = Array.from(new Set([...unit.notices, ...converted.notices]));
        } else if (source.ext === "hwp") {
          // 로컬 추출기(hwp5 CFB + zlib). 외부 도구·한컴오피스 설치 불필요.
          let extraction: ReturnType<typeof extractHwpBuffer>;
          try {
            extraction = extractHwpBuffer(await readFile(source.absolute_path));
          } catch (error) {
            // 읽을 수 없는 HWP(암호·DRM·손상·HWP5 아님)는 **변환 실패가 아니라
            // 사람 손이 필요한 상태**다. 유닛 전체를 error로 떨어뜨리면 같은 유닛의
            // 정상 파일까지 죽는다 — 기존 계약(HWP는 유닛을 막는다)을 그대로 지킨다.
            const code = error instanceof HwpExtractionError ? error.code : "hwp_unreadable";
            requiresManualPdf = true;
            const instruction = `${HWP_UNREADABLE_GUIDANCE} (${code})`;
            unit.notices = Array.from(new Set([...unit.notices, instruction]));
            manualQueue.push({ unit_id: unit.unit_id, source_file: source.path, instruction });
            continue;
          }
          const textPath = path.join(outputDirectory, `${index + 1}-hwp.txt`);
          await writeFile(textPath, extraction.text, "utf8");
          textArtifacts.push(textPath);
          textCharacters += extraction.textCharacters;
          if (extraction.images.length > 0) {
            // 내장 이미지는 버리지 않는다 — 본문이 스캔인 경우 유일한 근거다.
            const mediaDirectory = path.join(outputDirectory, `${index + 1}-hwp-media`);
            await mkdir(mediaDirectory, { recursive: true });
            for (const image of extraction.images) {
              const imagePath = path.join(mediaDirectory, image.name);
              await writeFile(imagePath, image.content);
              imageArtifacts.push(imagePath);
            }
          }
          if (extraction.review.required) {
            // 본문 텍스트가 근거가 못 된다(대개 가격표가 통째로 이미지).
            // 자동 승인에서 빼고 시각 판독 경로로 넘긴다.
            requiresManualPdf = true;
            const instruction = `${HWP_OCR_GUIDANCE} (${extraction.review.reasonCodes.join(", ")})`;
            unit.notices = Array.from(new Set([...unit.notices, instruction]));
            manualQueue.push({ unit_id: unit.unit_id, source_file: source.path, instruction });
          }
        } else if (source.ext === "png") {
          imageArtifacts.push(source.absolute_path);
        } else if (source.ext === "pdf") {
          const extractPdfText = dependencies.extractPdfText ?? defaultExtractPdfText;
          const rasterizePdf = dependencies.rasterizePdf ?? defaultRasterizePdf;
          const text = (await extractPdfText(source.absolute_path)).trim();
          validatePdfTextLimits({ pageCount: null, textCharacters: text.length });
          const textPath = path.join(outputDirectory, `${index + 1}-pdf.txt`);
          await writeFile(textPath, text, "utf8");
          textArtifacts.push(textPath);
          textCharacters += text.length;
          // A text-rich PDF may still contain a scanned price table, a
          // drawing, or one image-only page. Aggregate character thresholds
          // cannot prove that every page is represented, so retain page
          // rasters for every PDF and let extraction reconcile text + vision.
          const pageDirectory = path.join(outputDirectory, `${index + 1}-pdf-pages`);
          if (dependencies.rasterizePdf) await mkdir(pageDirectory, { recursive: true });
          try {
            imageArtifacts.push(...(await rasterizePdf(source.absolute_path, pageDirectory)));
          } catch (error) {
            if (error instanceof IngestConversionLimitError) throw error;
            requiresManualPdf = true;
            const instruction = error instanceof PdfRasterizerUnavailableError
              ? error.message
              : PDF_RASTER_GUIDANCE;
            unit.notices = Array.from(new Set([...unit.notices, instruction]));
            manualQueue.push({ unit_id: unit.unit_id, source_file: source.path, instruction });
          }
        }
      } catch (error) {
        conversionFailed = true;
        const category = error instanceof IngestConversionLimitError
          ? error.code
          : error instanceof Error
            ? error.name
            : "unknown";
        const remediation = category === "xlsx_media_format_unsupported"
          || category === "docx_media_format_unsupported"
          ? [OFFICE_MEDIA_FORMAT_GUIDANCE]
          : [];
        recordConversionFailure(
          unit,
          category,
          `convert 실패 (${source.ext}): ${category}`,
          remediation,
        );
        break;
      }
    }
    if (
      !conversionFailed
      && options.windowsOcrReviewOnly === true
      && imageArtifacts.length > 0
    ) {
      try {
        const rawSourceHashes = new Map(unit.source_files.map((source) => [
          path.resolve(source.absolute_path).toLocaleLowerCase("en-US"),
          source.sha256,
        ]));
        const images = await Promise.all(imageArtifacts.map(async (imagePath, index) => ({
          imagePath,
          expectedSha256: rawSourceHashes.get(
            path.resolve(imagePath).toLocaleLowerCase("en-US"),
          ) ?? (await sha256File(imagePath)).sha256,
          page: index + 1,
        })));
        ocrReview = await createWindowsOcrReviewArtifacts({
          images,
          outputDirectory: path.join(outputDirectory, "ocr-review"),
        }, dependencies.windowsOcrRunner);
        textArtifacts.push(...ocrReview.artifacts.map((artifact) => artifact.artifact_path));
        textCharacters += ocrReview.text_characters;
        unit.notices = Array.from(new Set([
          ...unit.notices,
          `${OCR_REVIEW_ONLY_NOTICE_PREFIX}Windows.Media.Ocr ko-KR evidence requires visual human verification and is excluded from automatic or bulk approval`,
        ]));
      } catch (error) {
        conversionFailed = true;
        const category = error instanceof WindowsOcrReviewError
          ? error.code
          : error instanceof Error
            ? error.name
            : "unknown";
        recordConversionFailure(
          unit,
          category,
          `convert failed (windows-ocr-review): ${category}`,
        );
      }
    }
    if (conversionFailed) {
      await discardConversionPublication(publication);
      if (!await restorePublishedConversionSnapshot(unit, publishedSnapshot)) {
        await invalidateGeneratedConversionCache(options.stateDir, unit);
      }
      continue;
    }
    if (textArtifacts.length > 0 || imageArtifacts.length > 0) {
      const publishedTextArtifacts = textArtifacts.map((artifactPath) =>
        publishedArtifactPath(artifactPath, publication));
      const publishedImageArtifacts = imageArtifacts.map((artifactPath) =>
        publishedArtifactPath(artifactPath, publication));
      const publishedOcrReview = ocrReview
        ? {
            contract_version: ocrReview.contract_version,
            contract_hash: ocrReview.contract_hash,
            language: ocrReview.language,
            review_only: ocrReview.review_only,
            authoritative: ocrReview.authoritative,
            bulk_approval_eligible: ocrReview.bulk_approval_eligible,
            artifacts: ocrReview.artifacts.map((artifact) => ({
              ...artifact,
              artifact_path: publishedArtifactPath(artifact.artifact_path, publication),
            })),
          }
        : undefined;
      let publishAttempted = false;
      try {
        const fingerprint = await artifactFingerprint(
          [...textArtifacts, ...imageArtifacts],
          [...publishedTextArtifacts, ...publishedImageArtifacts],
        );
        publishAttempted = true;
        await publishConversionAtomically(publication);
        unit.conversion = {
          converter_version: CONVERTER_VERSION,
          source_fingerprint: unit.source_fingerprint,
          text_artifacts: publishedTextArtifacts,
          image_artifacts: publishedImageArtifacts,
          text_characters: textCharacters,
          cell_count: cellCount,
          artifact_fingerprint: fingerprint,
          converted_at: new Date().toISOString(),
          ...(publishedOcrReview ? { ocr_review: publishedOcrReview } : {}),
        };
        // HWP가 있다는 사실만으로 막지 않는다 — 읽히면 변환된 것이다. 사람 손이
        // 필요한 경우(읽기 실패·본문이 통째로 이미지)는 requiresManualPdf로 들어온다.
        unit.stage = requiresManualPdf ? "needs_manual_conversion" : "converted";
      } catch (error) {
        // publishConversionAtomically owns cleanup once called. In the rare
        // double-failure case it deliberately retains `previous` for manual
        // recovery, so the caller must not erase that directory.
        if (!publishAttempted) {
          await discardConversionPublication(publication).catch(() => undefined);
        }
        const category = error instanceof Error ? error.name : "unknown";
        recordConversionFailure(
          unit,
          category,
          `convert 실패: artifact_publish (${category})`,
        );
        if (!await restorePublishedConversionSnapshot(unit, publishedSnapshot)) {
          await invalidateGeneratedConversionCache(options.stateDir, unit);
        }
      }
    } else {
      await discardConversionPublication(publication);
      // 산출물이 하나도 없는데 실패도 아닌 경우는 HWP를 못 읽었을 때뿐이다.
      // 그대로 두면 stage가 "scanned"에 머물러 사람 손이 필요하다는 사실이 사라진다.
      if (requiresManualPdf) unit.stage = "needs_manual_conversion";
    }
  }

  await writeJsonFile(
    path.join(path.resolve(options.stateDir), ".converted", "needs-manual-conversion.json"),
    { generated_at: new Date().toISOString(), units: manualQueue },
  );
  await saveManifest(manifest);
  return manifest;
}
