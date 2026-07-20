import { spawn } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import JSZip from "jszip";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { SaxesParser } from "saxes";
import * as XLSX from "xlsx";

import { sha256File, sha256Text, writeJsonFile } from "./io.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { DUPLICATE_SOURCE_NOTICE_PREFIX } from "./scan.js";
import type { IngestManifest, ManifestUnit } from "./types.js";
import { encodeXlsxSheetName } from "./xlsx-aux-evidence.js";

export const CONVERTER_VERSION = "v6-complete-xlsx-drawing-formula-evidence";
export const CONVERSION_FAILURE_IDENTITY_NOTICE_PREFIX = "convert_failure_identity:";
const CONVERSION_CACHE_CLEANUP_BLOCKED_NOTICE_PREFIX = "convert_cache_cleanup_blocked:";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

const HWP_GUIDANCE =
  "HWP는 자동 변환하지 않습니다. 한컴오피스 뷰어에서 열어 PDF로 같은 위치에 저장한 뒤 scan부터 다시 실행하세요.";
const PDF_RASTER_GUIDANCE =
  "PDF 페이지의 시각 정보 보존을 위한 Poppler(pdftoppm) 래스터화에 실패했습니다. Poppler를 설치하거나 각 페이지를 PNG로 내보내 같은 위치에 둔 뒤 scan부터 다시 실행하세요.";
const OFFICE_MEDIA_FORMAT_GUIDANCE =
  "XLSX/DOCX 내부 미디어가 지원되지 않는 형식입니다. EMF/WMF 같은 이미지를 원본에서 PNG/JPEG/WebP/GIF로 교체하거나 동일 업체 폴더에 PNG로 내보낸 뒤 scan부터 다시 실행하세요.";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_XLSX_MEDIA_COUNT = 100;
const MAX_XLSX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_XLSX_MEDIA_TOTAL_BYTES = 50 * 1024 * 1024;
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
  if (!/\.(?:png|jpe?g|webp|gif)$/iu.test(name)) {
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
}

export interface ConvertDependencies {
  extractPdfText?: (sourcePath: string) => Promise<string>;
  rasterizePdf?: (sourcePath: string, outputDirectory: string) => Promise<string[]>;
}

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

async function extractXlsxMedia(
  sourcePath: string,
  outputDirectory: string,
  sourceIndex: number,
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
    const outputPath = path.join(mediaDirectory, fileName);
    const content = await entry.async("nodebuffer");
    if (content.byteLength > MAX_XLSX_MEDIA_BYTES) {
      throw new IngestConversionLimitError("xlsx_media_item_size_limit");
    }
    extractedBytes += content.byteLength;
    if (extractedBytes > MAX_XLSX_MEDIA_TOTAL_BYTES) {
      throw new IngestConversionLimitError("xlsx_media_total_size_limit");
    }
    await writeFile(outputPath, content);
    outputPaths.push(outputPath);
  }
  return outputPaths;
}

async function convertXlsx(
  sourcePath: string,
  outputDirectory: string,
  index: number,
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
  );
  return { textPath, textCharacters: completeMarkdown.length, cellCount, imagePaths };
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
  const extracted = await mammoth.extractRawText({ buffer: source });
  const text = extracted.value.trim();
  const textPath = path.join(outputDirectory, `${index + 1}-doc.txt`);
  await writeFile(textPath, text, "utf8");
  const zip = await JSZip.loadAsync(source);
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
    notices: extracted.messages.map((message) => `DOCX ${message.type}: ${message.message}`),
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

async function defaultExtractPdfText(sourcePath: string): Promise<string> {
  const parsed = await pdfParse(await readFile(sourcePath), { max: MAX_PDF_PAGES + 1 });
  validatePdfTextLimits({ pageCount: parsed.numpages, textCharacters: parsed.text.length });
  return parsed.text;
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
    if (unit.notices.some((notice) => notice.startsWith(DUPLICATE_SOURCE_NOTICE_PREFIX))) {
      // The scanner preserves both immutable paths but deliberately blocks
      // byte-identical unit copies. Conversion must not turn that scan error
      // back into an apparently healthy downstream state. Its deterministic,
      // regenerable cache is invalid too; raw source paths are never cleanup
      // targets.
      await invalidateGeneratedConversionCache(options.stateDir, unit);
      unit.stage = "error";
      delete unit.conversion;
      delete unit.extraction;
      delete unit.validation;
      continue;
    }
    const hwpFiles = unit.source_files.filter((source) => source.ext === "hwp");
    const replacementPdfStems = new Set(
      unit.source_files.filter((source) => source.ext === "pdf").map((source) => sourceStemKey(source.path)),
    );
    const unconvertedHwpFiles = hwpFiles.filter((source) => !replacementPdfStems.has(sourceStemKey(source.path)));
    if (unconvertedHwpFiles.length > 0) {
      unit.stage = "needs_manual_conversion";
      unit.notices = Array.from(new Set([...unit.notices, HWP_GUIDANCE]));
    }
    for (const source of unconvertedHwpFiles) {
      manualQueue.push({ unit_id: unit.unit_id, source_file: source.path, instruction: HWP_GUIDANCE });
    }

    if (
      unit.conversion?.source_fingerprint === unit.source_fingerprint
      && unit.conversion.converter_version === CONVERTER_VERSION
      && unit.stage !== "needs_manual_conversion"
      && unit.stage !== "error"
      && await artifactsMatchFingerprint(
        [
          ...unit.conversion.text_artifacts,
          ...unit.conversion.image_artifacts,
        ],
        unit.conversion.artifact_fingerprint,
      )
    ) {
      continue;
    }

    const convertibleFiles = unit.source_files.filter((source) => source.ext !== "hwp");
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
      await invalidateGeneratedConversionCache(options.stateDir, unit);
      continue;
    }
    const outputDirectory = publication.stagingDirectory;
    const textArtifacts: string[] = [];
    const imageArtifacts: string[] = [];
    let textCharacters = 0;
    let cellCount = 0;
    let requiresManualPdf = false;
    let conversionFailed = false;

    for (const [index, source] of convertibleFiles.entries()) {
      try {
        await assertSourceSizeLimit(source.absolute_path, source.bytes);
        if (source.ext === "xlsx") {
          const converted = await convertXlsx(source.absolute_path, outputDirectory, index);
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
    if (conversionFailed) {
      await discardConversionPublication(publication);
      await invalidateGeneratedConversionCache(options.stateDir, unit);
      continue;
    }
    if (textArtifacts.length > 0 || imageArtifacts.length > 0) {
      const publishedTextArtifacts = textArtifacts.map((artifactPath) =>
        publishedArtifactPath(artifactPath, publication));
      const publishedImageArtifacts = imageArtifacts.map((artifactPath) =>
        publishedArtifactPath(artifactPath, publication));
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
        };
        unit.stage = requiresManualPdf || unconvertedHwpFiles.length > 0
          ? "needs_manual_conversion"
          : "converted";
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
        await invalidateGeneratedConversionCache(options.stateDir, unit);
      }
    } else {
      await discardConversionPublication(publication);
    }
  }

  await writeJsonFile(
    path.join(path.resolve(options.stateDir), ".converted", "needs-manual-conversion.json"),
    { generated_at: new Date().toISOString(), units: manualQueue },
  );
  await saveManifest(manifest);
  return manifest;
}
