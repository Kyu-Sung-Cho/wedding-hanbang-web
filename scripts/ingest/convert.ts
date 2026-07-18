import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";

import { sha256File, sha256Text, writeJsonFile } from "./io.js";
import { loadManifest, saveManifest } from "./manifest.js";
import type { IngestManifest } from "./types.js";

export const CONVERTER_VERSION = "v2-source-scoped-xlsx-media";

const HWP_GUIDANCE =
  "HWP는 자동 변환하지 않습니다. 한컴오피스 뷰어에서 열어 PDF로 같은 위치에 저장한 뒤 scan부터 다시 실행하세요.";
const PDF_RASTER_GUIDANCE =
  "PDF에서 300자 이상의 텍스트를 읽지 못했고 Poppler(pdftoppm) 래스터화도 실패했습니다. Poppler를 설치하거나 각 페이지를 PNG로 내보내 같은 위치에 둔 뒤 scan부터 다시 실행하세요.";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_XLSX_MEDIA_COUNT = 100;
const MAX_XLSX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_XLSX_MEDIA_TOTAL_BYTES = 50 * 1024 * 1024;
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

async function artifactFingerprint(filePaths: string[]): Promise<string> {
  const records = await Promise.all(
    [...filePaths].sort((left, right) => left.localeCompare(right, "en")).map(async (filePath) => {
      const digest = await sha256File(filePath);
      return `${path.resolve(filePath)}\0${digest.sha256}`;
    }),
  );
  return sha256Text(records.join("\n"));
}

interface XlsxConversion {
  textPath: string;
  textCharacters: number;
  cellCount: number;
  imagePaths: string[];
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

async function extractXlsxMedia(
  sourcePath: string,
  outputDirectory: string,
  sourceIndex: number,
  shouldExtract: (mediaCount: number) => boolean,
): Promise<string[]> {
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  const mediaEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && /^xl\/media\/[^/]+$/i.test(entry.name),
  );
  if (!shouldExtract(mediaEntries.length)) return [];

  // XLSX archives commonly reuse names such as xl/media/image1.png. Keep the
  // extracted directory tied to the manifest source-file index so a later
  // workbook cannot overwrite (or be attributed to) an earlier workbook.
  const mediaDirectory = path.join(outputDirectory, `${sourceIndex + 1}-media`);
  await mkdir(mediaDirectory, { recursive: true });
  const outputPaths: string[] = [];
  let extractedBytes = 0;
  for (const entry of mediaEntries) {
    const fileName = path.posix.basename(entry.name);
    if (!/\.(?:png|jpe?g|webp|gif)$/i.test(fileName)) continue;
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
  sourceBytes: number,
  outputDirectory: string,
  index: number,
): Promise<XlsxConversion> {
  await assertXlsxArchiveLimits(sourcePath);
  const workbook = XLSX.readFile(sourcePath, { cellDates: true, cellText: true });
  const { markdown, cellCount } = workbookToMarkdown(workbook);
  const textPath = path.join(outputDirectory, `${index + 1}-sheets.txt`);
  await writeFile(textPath, markdown, "utf8");
  const imagePaths = await extractXlsxMedia(
    sourcePath,
    outputDirectory,
    index,
    (mediaCount) =>
      (markdown.length < 500 && sourceBytes > 300 * 1024) || (mediaCount > 0 && cellCount < 50),
  );
  return { textPath, textCharacters: markdown.length, cellCount, imagePaths };
}

async function convertDocx(
  sourcePath: string,
  outputDirectory: string,
  index: number,
): Promise<{ textPath: string; textCharacters: number; notices: string[] }> {
  const source = await readFile(sourcePath);
  await assertDocxArchiveLimits(source);
  const extracted = await mammoth.extractRawText({ buffer: source });
  const text = extracted.value.trim();
  const textPath = path.join(outputDirectory, `${index + 1}-doc.txt`);
  await writeFile(textPath, text, "utf8");
  return {
    textPath,
    textCharacters: text.length,
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
    const child = spawn("pdftoppm", [
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
    child.once("exit", (code) => finish({ exitCode: code, stderr: "", timedOut }));
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

export async function rasterizePdfSafely(
  sourcePath: string,
  outputDirectory: string,
  runner: PdfRasterCommandRunner = runPdfRasterCommand,
): Promise<string[]> {
  try {
    await access(outputDirectory);
    throw new IngestConversionLimitError("pdf_raster_publish_destination_exists");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const parentDirectory = path.dirname(outputDirectory);
  await mkdir(parentDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(parentDirectory, `.${path.basename(outputDirectory)}.tmp-`));
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
      && await allFilesExist([
        ...unit.conversion.text_artifacts,
        ...unit.conversion.image_artifacts,
      ])
    ) {
      continue;
    }

    const convertibleFiles = unit.source_files.filter((source) => source.ext !== "hwp");
    if (convertibleFiles.length === 0) continue;
    const outputDirectory = path.join(
      path.resolve(options.stateDir),
      ".converted",
      unit.unit_id,
      unit.source_fingerprint,
    );
    try {
      await mkdir(outputDirectory, { recursive: true });
    } catch (error) {
      unit.stage = "error";
      const category = error instanceof Error ? error.name : "unknown";
      unit.notices = Array.from(new Set([...unit.notices, `convert 실패: output_directory (${category})`]));
      continue;
    }
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
          const converted = await convertXlsx(source.absolute_path, source.bytes, outputDirectory, index);
          textArtifacts.push(converted.textPath);
          imageArtifacts.push(...converted.imagePaths);
          textCharacters += converted.textCharacters;
          cellCount += converted.cellCount;
        } else if (source.ext === "docx") {
          const converted = await convertDocx(source.absolute_path, outputDirectory, index);
          textArtifacts.push(converted.textPath);
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
          if (text.length < 300) {
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
        }
      } catch (error) {
        conversionFailed = true;
        unit.stage = "error";
        const category = error instanceof IngestConversionLimitError
          ? error.code
          : error instanceof Error
            ? error.name
            : "unknown";
        unit.notices = Array.from(new Set([...unit.notices, `convert 실패 (${source.ext}): ${category}`]));
        break;
      }
    }
    if (conversionFailed) continue;
    if (textArtifacts.length > 0 || imageArtifacts.length > 0) {
      unit.conversion = {
        converter_version: CONVERTER_VERSION,
        source_fingerprint: unit.source_fingerprint,
        text_artifacts: textArtifacts,
        image_artifacts: imageArtifacts,
        text_characters: textCharacters,
        cell_count: cellCount,
        artifact_fingerprint: await artifactFingerprint([...textArtifacts, ...imageArtifacts]),
        converted_at: new Date().toISOString(),
      };
      unit.stage = requiresManualPdf || unconvertedHwpFiles.length > 0
        ? "needs_manual_conversion"
        : "converted";
    }
  }

  await writeJsonFile(
    path.join(path.resolve(options.stateDir), ".converted", "needs-manual-conversion.json"),
    { generated_at: new Date().toISOString(), units: manualQueue },
  );
  await saveManifest(manifest);
  return manifest;
}
