import { decodeEvidenceQuote, encodeMergedEvidenceQuote } from "./merge-evidence.js";
import {
  extractHallXlsxTopology,
  type HallXlsxTopologyExtraction,
} from "./hall-xlsx-topology.js";
import {
  projectCanonicalPdfLayoutMoney,
  type PdfLayoutMoneyProjection,
} from "./pdf-layout-evidence.js";
import { DisclosureExtractionSchema } from "./schemas.js";
import type { DisclosureExtraction } from "./schemas.js";
import {
  isConverterReviewMetadataLine,
  scanSourceMoneyOccurrences,
} from "./validate.js";

export const LOCAL_EXTRACTION_GUARD = "[local_evidence_guard]";

export interface LocalTextEvidence {
  sourceFileId: string;
  text: string;
}

export interface LocalDisclosureInput {
  canonicalName: string;
  regionCode: string;
  kindHint: "agency" | "hall";
  hasImages: boolean;
  sources: LocalTextEvidence[];
}

type PackageVendorCategory = "studio" | "dress" | "makeup";
type VendorCategory = PackageVendorCategory | "other";
type StrictDisclosureExtraction = ReturnType<typeof DisclosureExtractionSchema.parse>;
type LocalHall = StrictDisclosureExtraction["halls"][number];
type MoneyOccurrence = ReturnType<typeof scanSourceMoneyOccurrences>[number];

interface WorkbookCell {
  sheet: string;
  address: string;
  column: number;
  row: number;
  value: string;
  sourceFileId: string;
  canonicalDocx: boolean;
}

interface WorkbookMerge {
  sheet: string;
  startColumn: number;
  endColumn: number;
  startRow: number;
  endRow: number;
  anchorAddress: string;
  sourceFileId: string;
}

interface WorkbookEvidence {
  cells: WorkbookCell[];
  merges: WorkbookMerge[];
  docxMetadataStatus: "none" | "valid" | "invalid";
}

interface LocatedMoney {
  occurrence: MoneyOccurrence;
  cell: WorkbookCell;
  rawOrdinalInCell: number;
}

/**
 * A source locator and raw token are not an occurrence identity: the same
 * exact amount may legitimately appear more than once inside one physical
 * cell. Keep the scanner ordinal in every structured-link key so linking one
 * occurrence cannot silently consume its equal-valued sibling.
 */
function locatedMoneyLinkKey(entry: LocatedMoney): string {
  return [
    entry.cell.sourceFileId,
    entry.occurrence.source_locator,
    entry.occurrence.raw,
    entry.occurrence.krw,
    entry.rawOrdinalInCell,
  ].join("\0");
}

interface AgencySection {
  header: WorkbookCell;
  category: VendorCategory | null;
  categoryEvidence: WorkbookCell | null;
  endRow: number;
}

interface VendorAnchor {
  cell: WorkbookCell;
  header: WorkbookCell;
  headerEndRow: number;
  categoryEvidence: WorkbookCell | null;
  endRow: number;
  category: VendorCategory;
  selfBusiness: boolean;
}

interface PackageAnchor {
  cell: WorkbookCell;
  header: WorkbookCell;
  headerEndRow: number;
  categoryScope: PackageVendorCategory[];
  categoryEvidence: WorkbookCell[];
  endRow: number;
  explicit: boolean;
}

interface PlainTextLine {
  sourceFileId: string;
  number: number;
  value: string;
  quoteValue: string;
}

interface PlainLineVendorAnchor {
  sourceFileId: string;
  category: VendorCategory;
  categoryLine: PlainTextLine;
  vendorLine: PlainTextLine;
  endLine: number;
}

const WORKBOOK_CELL_PATTERN = /^(.+)!([A-Z]+)(\d+):\s*(.+)$/u;
const SHEET_HEADING_PATTERN = /^##\s*시트:\s*(.+)$/u;
const MERGE_PATTERN = /^병합\s*범위\s+([A-Z]+)(\d+):([A-Z]+)(\d+)\s*·\s*좌상단\s+([A-Z]+\d+)$/u;
const BUSINESS_HEADER_PATTERN = /^(?:(?:스튜디오|드레스|메이크업|헤어메이크업)\s*)?(?:사업자명|사업장명|사업체명|사용자명|업체명|브랜드명|상호명|스튜디오명|드레스(?:샵)?명|메이크업(?:샵)?명)$/u;
const HALL_HEADER_PATTERN = /^(?:예식홀명|예식홀|홀명|웨딩홀명)$/u;
const POLICY_PATTERN = /(?:위약|환불|환급|취소|계약\s*해지|해약|(?:소비자|고객).{0,60}공제)/u;
const POLICY_TIER_PATTERN = /(?:예식|결혼식)(?:\s*진행)?\s*일.{0,80}(?:이내|이전|당일).{0,160}(?:결제\s*금액|예식\s*비용|식사\s*비용|계약\s*금액).{0,80}\d+\s*%/u;
const PUBLIC_CONTACT_PATTERN = /(?:전화|연락처|tel|fax|e-?mail|@)/iu;
const PLACEHOLDER_VENDOR_PATTERN = /^(?:[A-Z](?:\s*(?:스튜디오|드레스|메이크업))?|[ㅇ○O]{2,}|해당\s*없음|없음|예시|샘플|\|+|⦙+)$/iu;
const PACKAGE_SHEET_PATTERN = /(?:토탈|패키지)/u;
const GENERIC_SHEET_PATTERN = /^Sheet\d*$/iu;
const EXPLICIT_TERMS_HEADING_PATTERN = /(?:계약\s*취소\s*및\s*환불\s*규정|지불\s*약정)/u;
const PRICING_BASIS_HEADING_PATTERN = /^(?:①\s*)?(?:가격|금액)\s*(?:\(|（|\[|:|：|$)/iu;
const PRICING_BASIS_NOTE_PATTERN = /(?:\bVAT\b|부가\s*가치세|부가세|(?:가격|금액)\s*(?:은|는|의)?\s*(?:단위|기준|산정|포함|별도)|단위\s*[:：]?\s*(?:원|만원|천원))/iu;
const CATEGORY_PRICING_BASIS_HEADING_PATTERN = /^(?:[•·▪-]\s*)?(스튜디오|드레스|메이크업)(?:\s*구성)?\s*(?:(?:및|&)\s*)?(?:가격|금액)\s*(?:안내)?$/iu;
const DECLARED_MONEY_UNIT_PATTERN = /(?:가격|금액)?\s*단위\s*[:：]?\s*(?:원|만원|천원)/iu;
const PAYMENT_AMOUNT_ROLE_PATTERN = /^(?:총\s*)?(?:계약금|계약\s*금액|중도금|잔금|선금|예치금|총액|합계|공급가액|결제\s*금액|지급\s*금액|견적\s*금액|촬영비|본식비)$/u;
const INLINE_PRICE_COMPONENT_PATTERN = /(?:피팅비|추가비|추가금|헬퍼비|업그레이드|대관료|촬영비|본식비|상품가)/u;
const PLAIN_LINE_GENERIC_LABEL_PATTERN = /^(?:제휴\s*업체\s*가격표|업체\s*가격표|가격표|업체명|사업자명|브랜드명|구분|가격|금액|기본\s*가격|상품명|구성|비고)$/iu;
const GENERIC_OPTION_HEADER_PATTERN = /^(?:(?:주요\s*)?선택\s*품목(?:\s*가격)?|기타\s*옵션|연출\s*추가|행사\s*진행|장식\s*추가)$/iu;
const PLACEHOLDER_HALL_PATTERN = /^(?:[A-Z]\s*홀|[ㅇ○O]{2,}(?:\s*홀)?|해당\s*없음|없음|예시|샘플)$/iu;
const CATEGORY_ORDER: PackageVendorCategory[] = ["studio", "dress", "makeup"];
const PACKAGE_COMPOSITION_HEADER_PATTERN = /^(?:(?:패키지|상품|기본)\s*){0,2}구성(?:\s*내용)?$/u;
const OCR_REVIEW_SOURCE_PATTERN = /^\[OCR_REVIEW_ONLY\]\s*$/mu;
const EXPLICIT_PACKAGE_ANCHOR_PATTERN = /^패키지\s*[A-Z0-9가-힣]+$/iu;
const VENDOR_CONTINUATION_LABEL_PATTERN = /^(?:추가\s*항목|추가항목)$/u;
const TRADITIONAL_ATTIRE_DRESS_EVIDENCE_PATTERN = /(?:한복|상의원|명주\s*실크|본견\s*실크|혼방\s*실크|우리옷)/u;
const BUSINESS_IDENTITY_TITLE_PATTERN = /(?:웨딩|브라이드|브라이덜|꾸뛰르|드레스|스튜디오|메이크업|상의원|한복|예식장|웨딩홀|호텔|컨벤션)/iu;
const DECLARED_UNIT_PRICE_SEMANTIC_PATTERN = /(?:가격|금액|비용|요금|대관료|식대|보증금|사용료|상담비|제작비|변경비|피팅비|헬퍼비|추가|옵션|할인|할증|업그레이드|변경|담당자\s*지정|야외|야간)/u;
const DECLARED_UNIT_NON_PRICE_PATTERN = /(?:사업자\s*등록|전화|연락처|tel|fax|e-?mail|계좌|은행|예금주|작성일|날짜|단위\s*충돌)/iu;
const DECLARED_UNIT_QUANTITY_PATTERN = /^(?:(?:최소|최대)?\s*보증\s*인원|인원|수량|\d[\d,]*\s*(?:명|개|건|회|벌|장|부|권|페이지|컷|시간|분|일|개월|월|년)|\d+(?:\.\d+)?\s*(?:%|퍼센트))$/u;
const PACKAGE_OPTION_DESCRIPTOR_PATTERN = /^(?:[*※·ㆍ-]\s*)?(?:피팅|헬퍼|도우미|추가|업그레이드|원본|앨범|액자|수정본)(?:\s|$)/u;
const DOCX_CELL_META_PREFIX = "[DOCX_CELL_META]";
const DOCX_CELL_META_VERSION = 2;
const DOCX_CELL_META_KEYS = [
  "column",
  "empty",
  "locator",
  "row",
  "span",
  "table",
  "version",
  "vertical_merge",
] as const;
const PDF_LAYOUT_EVIDENCE_VERSION = 1;
const PDF_LAYOUT_BEGIN = `[PDF_LAYOUT_EVIDENCE_V${PDF_LAYOUT_EVIDENCE_VERSION}_BEGIN]`;
const PDF_LAYOUT_END = `[PDF_LAYOUT_EVIDENCE_V${PDF_LAYOUT_EVIDENCE_VERSION}_END]`;
const PDF_LAYOUT_ROW_PATTERN = /^\[PDF_LAYOUT_EVIDENCE_V1 page=([1-9][0-9]*) row=([1-9][0-9]*) y=(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)\] ([A-Za-z0-9_-]+)$/u;
const PDF_LAYOUT_ROW_KEYS = ["anchor_y", "items", "page", "row", "version"] as const;
const PDF_LAYOUT_ITEM_KEYS = ["column", "height", "text", "width", "x", "y"] as const;
const PDF_LAYOUT_ROW_TOLERANCE_POINTS = 0.75;

interface CanonicalPdfLayoutItem {
  column: number;
  text: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
}

interface CanonicalPdfLayoutRow {
  page: number;
  row: number;
  anchorY: number;
  items: CanonicalPdfLayoutItem[];
  line: PlainTextLine | null;
}

interface CanonicalPdfLayoutEvidence {
  status: "none" | "valid" | "invalid";
  rows: CanonicalPdfLayoutRow[];
}

interface CanonicalDocxCellMetadata {
  locator: string;
  table: number;
  row: number;
  column: number;
  span: string | null;
  verticalMerge: "restart" | "continue" | null;
  empty: boolean;
  width: number;
}

function canonicalPdfLayoutNumber(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && !Object.is(value, -0)
    && Math.abs(value) <= 20_000;
}

function canonicalPdfLayoutNullableNumber(value: unknown): value is number | null {
  return value === null || canonicalPdfLayoutNumber(value);
}

function canonicalPdfLayoutInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= maximum;
}

function canonicalPdfCoordinate(value: number): string {
  return value.toFixed(3).replace(/(?:\.0+|(\.[0-9]*?)0+)$/u, "$1");
}

function normalizePdfLayoutItemText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\n\f\v]+/gu, " ")
    .replace(/ {2,}/gu, " ")
    .trim();
}

function decodeCanonicalPdfLayoutRow(
  rawLine: string,
): Omit<CanonicalPdfLayoutRow, "line"> | null {
  const wrapper = PDF_LAYOUT_ROW_PATTERN.exec(rawLine);
  if (!wrapper) return null;
  const encoded = wrapper[4]!;
  let decoded: string;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== encoded) return null;
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || !exactObjectKeys(parsed as Record<string, unknown>, PDF_LAYOUT_ROW_KEYS)
  ) return null;
  const value = parsed as Record<string, unknown>;
  if (
    value.version !== PDF_LAYOUT_EVIDENCE_VERSION
    || !canonicalPdfLayoutInteger(value.page, 1_000)
    || !canonicalPdfLayoutInteger(value.row, 100_000)
    || !canonicalPdfLayoutNumber(value.anchor_y)
    || !Array.isArray(value.items)
    || value.items.length > 2_000
  ) return null;
  const items: CanonicalPdfLayoutItem[] = [];
  for (const [index, rawItem] of value.items.entries()) {
    if (
      typeof rawItem !== "object"
      || rawItem === null
      || Array.isArray(rawItem)
      || !exactObjectKeys(rawItem as Record<string, unknown>, PDF_LAYOUT_ITEM_KEYS)
    ) return null;
    const item = rawItem as Record<string, unknown>;
    if (
      item.column !== index + 1
      || typeof item.text !== "string"
      || item.text.length > 20_000
      || !canonicalPdfLayoutNumber(item.x)
      || !canonicalPdfLayoutNumber(item.y)
      || !canonicalPdfLayoutNullableNumber(item.width)
      || !canonicalPdfLayoutNullableNumber(item.height)
      || (typeof item.width === "number" && item.width < 0)
      || (typeof item.height === "number" && item.height < 0)
      || Math.abs(item.y - value.anchor_y) > PDF_LAYOUT_ROW_TOLERANCE_POINTS
    ) return null;
    items.push({
      column: item.column,
      text: item.text,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    });
  }
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1]!;
    const current = items[index]!;
    if (current.x < previous.x) return null;
    if (current.x === previous.x && current.y > previous.y) return null;
  }
  if (
    Number(wrapper[1]) !== value.page
    || Number(wrapper[2]) !== value.row
    || wrapper[3] !== canonicalPdfCoordinate(value.anchor_y)
  ) return null;
  return {
    page: value.page,
    row: value.row,
    anchorY: value.anchor_y,
    items,
  };
}

function parseCanonicalPdfLayoutEvidence(source: LocalTextEvidence): CanonicalPdfLayoutEvidence {
  const rawLines = source.text.replace(/\r\n?/gu, "\n").split("\n");
  const markerIndexes = rawLines.flatMap((line, index) => (
    line.startsWith("[PDF_LAYOUT_EVIDENCE_") ? [index] : []
  ));
  if (markerIndexes.length === 0) return { status: "none", rows: [] };
  const beginIndexes = rawLines.flatMap((line, index) => line === PDF_LAYOUT_BEGIN ? [index] : []);
  const endIndexes = rawLines.flatMap((line, index) => line === PDF_LAYOUT_END ? [index] : []);
  if (beginIndexes.length !== 1 || endIndexes.length !== 1) return { status: "invalid", rows: [] };
  const begin = beginIndexes[0]!;
  const end = endIndexes[0]!;
  let lastNonEmptyIndex = -1;
  for (let index = rawLines.length - 1; index >= 0; index -= 1) {
    if (rawLines[index]!.trim().length === 0) continue;
    lastNonEmptyIndex = index;
    break;
  }
  if (begin >= end || end !== lastNonEmptyIndex) {
    return { status: "invalid", rows: [] };
  }
  if (rawLines.slice(begin + 1, end).some((line) => !line)) {
    return { status: "invalid", rows: [] };
  }
  const decoded = rawLines.slice(begin + 1, end).map(decodeCanonicalPdfLayoutRow);
  if (decoded.length === 0 || decoded.some((row) => row === null)) {
    return { status: "invalid", rows: [] };
  }
  const rows = decoded as Array<Omit<CanonicalPdfLayoutRow, "line">>;
  let priorPage = 0;
  let priorRow = 0;
  let priorAnchor = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.page < priorPage) return { status: "invalid", rows: [] };
    if (row.page !== priorPage) {
      if (row.page !== priorPage + 1 || row.row !== 1) return { status: "invalid", rows: [] };
      priorPage = row.page;
      priorRow = 0;
      priorAnchor = Number.POSITIVE_INFINITY;
    }
    if (row.row !== priorRow + 1 || row.anchorY > priorAnchor) {
      return { status: "invalid", rows: [] };
    }
    priorRow = row.row;
    priorAnchor = row.anchorY;
  }
  const pages = new Map<number, Array<{ row: Omit<CanonicalPdfLayoutRow, "line">; text: string }>>();
  for (const row of rows) {
    const text = row.items.map(({ text: itemText }) => normalizePdfLayoutItemText(itemText))
      .filter(Boolean)
      .join("\t");
    const pageRows = pages.get(row.page) ?? [];
    if (text) pageRows.push({ row, text });
    pages.set(row.page, pageRows);
  }
  const orderedPages = [...pages.entries()].sort(([left], [right]) => left - right);
  const expectedOrderedText = orderedPages.map(([, pageRows]) => (
    pageRows.map(({ text }) => text).join("\n")
  )).join("\n\n");
  const actualOrderedText = rawLines.slice(0, begin).join("\n").trimEnd();
  if (actualOrderedText !== expectedOrderedText) return { status: "invalid", rows: [] };

  let lineNumber = 1;
  const lineByKey = new Map<string, PlainTextLine>();
  for (const [pageIndex, [page, pageRows]] of orderedPages.entries()) {
    for (const { row, text } of pageRows) {
      lineByKey.set(`${page}\0${row.row}`, {
        sourceFileId: source.sourceFileId,
        number: lineNumber,
        value: cleanCellValue(text),
        quoteValue: cleanCellValue(text),
      });
      lineNumber += 1;
    }
    if (pageIndex < orderedPages.length - 1) lineNumber += 1;
  }
  return {
    status: "valid",
    rows: rows.map((row) => ({
      ...row,
      line: lineByKey.get(`${row.page}\0${row.row}`) ?? null,
    })),
  };
}

function columnNumber(value: string): number {
  let result = 0;
  for (const character of value) result = (result * 26) + character.charCodeAt(0) - 64;
  return result;
}

function cleanCellValue(value: string): string {
  return value
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/\\\|/gu, "|")
    .replace(/\s+/gu, " ")
    .trim();
}

function exactObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, "en"));
  const orderedExpected = [...expected].sort((left, right) => left.localeCompare(right, "en"));
  return actual.length === orderedExpected.length
    && actual.every((key, index) => key === orderedExpected[index]);
}

function canonicalDocxInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= 16_384;
}

function decodeCanonicalDocxMetadata(rawLine: string): CanonicalDocxCellMetadata | null {
  const lineMatch = /^\[DOCX_CELL_META\] ([A-Za-z0-9_-]+)$/u.exec(rawLine.trim());
  if (!lineMatch) return null;
  const encoded = lineMatch[1]!;
  let decoded: string;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== encoded) return null;
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || !exactObjectKeys(parsed as Record<string, unknown>, DOCX_CELL_META_KEYS)
  ) return null;
  const value = parsed as Record<string, unknown>;
  if (
    value.version !== DOCX_CELL_META_VERSION
    || typeof value.locator !== "string"
    || !canonicalDocxInteger(value.table)
    || !canonicalDocxInteger(value.row)
    || !canonicalDocxInteger(value.column)
    || !(value.span === null || typeof value.span === "string")
    || !(value.vertical_merge === null
      || value.vertical_merge === "restart"
      || value.vertical_merge === "continue")
    || typeof value.empty !== "boolean"
  ) return null;
  const locator = /^table:([1-9][0-9]*)!([A-Z]+)([1-9][0-9]*)$/u.exec(value.locator);
  if (
    !locator
    || Number(locator[1]) !== value.table
    || Number(locator[3]) !== value.row
    || columnNumber(locator[2]!) !== value.column
  ) return null;
  let width = 1;
  if (value.span !== null) {
    const span = /^([A-Z]+)([1-9][0-9]*):([A-Z]+)([1-9][0-9]*)$/u.exec(value.span);
    if (
      !span
      || span[1] !== locator[2]
      || Number(span[2]) !== value.row
      || Number(span[4]) !== value.row
    ) return null;
    const endColumn = columnNumber(span[3]!);
    if (endColumn <= value.column || endColumn > 16_384) return null;
    width = endColumn - value.column + 1;
  }
  return {
    locator: value.locator,
    table: value.table,
    row: value.row,
    column: value.column,
    span: value.span,
    verticalMerge: value.vertical_merge,
    empty: value.empty,
    width,
  };
}

function canonicalDocxMerges(
  source: LocalTextEvidence,
  cells: WorkbookCell[],
  rawLines: string[],
): { status: "none" | "valid" | "invalid"; merges: WorkbookMerge[] } {
  const metadataLines = rawLines.filter((line) => line.trim().startsWith(DOCX_CELL_META_PREFIX));
  if (metadataLines.length === 0) return { status: "none", merges: [] };
  const metadata = metadataLines.map(decodeCanonicalDocxMetadata);
  if (metadata.some((entry) => entry === null)) return { status: "invalid", merges: [] };
  const entries = metadata as CanonicalDocxCellMetadata[];
  const byLocator = new Map<string, CanonicalDocxCellMetadata>();
  for (const entry of entries) {
    if (byLocator.has(entry.locator)) return { status: "invalid", merges: [] };
    byLocator.set(entry.locator, entry);
  }
  const cellsByLocator = new Map<string, WorkbookCell>();
  for (const cell of cells) {
    if (!/^table:[1-9][0-9]*$/u.test(cell.sheet)) return { status: "invalid", merges: [] };
    const locator = `${cell.sheet}!${cell.address}`;
    if (cellsByLocator.has(locator)) return { status: "invalid", merges: [] };
    cellsByLocator.set(locator, cell);
  }
  for (const entry of entries) {
    const existingCell = cellsByLocator.get(entry.locator);
    if (entry.empty === Boolean(existingCell)) return { status: "invalid", merges: [] };
    if (entry.verticalMerge === "continue" && !entry.empty) {
      return { status: "invalid", merges: [] };
    }
  }
  const keyed = new Map(entries.map((entry) => [
    `${entry.table}\0${entry.column}\0${entry.row}`,
    entry,
  ]));
  for (const entry of entries.filter(({ verticalMerge }) => verticalMerge === "continue")) {
    const previous = keyed.get(`${entry.table}\0${entry.column}\0${entry.row - 1}`);
    if (
      !previous
      || (previous.verticalMerge !== "restart" && previous.verticalMerge !== "continue")
      || previous.width !== entry.width
    ) return { status: "invalid", merges: [] };
    let cursor: CanonicalDocxCellMetadata | undefined = previous;
    while (cursor?.verticalMerge === "continue") {
      cursor = keyed.get(`${cursor.table}\0${cursor.column}\0${cursor.row - 1}`);
    }
    if (cursor?.verticalMerge !== "restart") return { status: "invalid", merges: [] };
  }
  const merges: WorkbookMerge[] = [];
  for (const entry of entries) {
    if (entry.verticalMerge === "continue") continue;
    let endRow = entry.row;
    if (entry.verticalMerge === "restart") {
      while (true) {
        const next = keyed.get(`${entry.table}\0${entry.column}\0${endRow + 1}`);
        if (!next || next.verticalMerge !== "continue" || next.width !== entry.width) break;
        endRow += 1;
      }
    }
    if (entry.width === 1 && endRow === entry.row) continue;
    const address = entry.locator.slice(entry.locator.indexOf("!") + 1);
    merges.push({
      sheet: `table:${entry.table}`,
      startColumn: entry.column,
      endColumn: entry.column + entry.width - 1,
      startRow: entry.row,
      endRow,
      anchorAddress: address,
      sourceFileId: source.sourceFileId,
    });
  }
  return { status: "valid", merges };
}

function parseWorkbookEvidence(source: LocalTextEvidence): WorkbookEvidence {
  const cells: WorkbookCell[] = [];
  const merges: WorkbookMerge[] = [];
  let currentSheet = "";
  const rawLines = source.text.split(/\r?\n/u);
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    const sheetMatch = SHEET_HEADING_PATTERN.exec(line);
    if (sheetMatch) {
      currentSheet = sheetMatch[1]!.trim();
      continue;
    }
    const cellMatch = WORKBOOK_CELL_PATTERN.exec(line);
    if (cellMatch) {
      currentSheet = cellMatch[1]!.trim();
      cells.push({
        sheet: currentSheet,
        address: `${cellMatch[2]}${cellMatch[3]}`,
        column: columnNumber(cellMatch[2]!),
        row: Number.parseInt(cellMatch[3]!, 10),
        value: cellMatch[4]!,
        sourceFileId: source.sourceFileId,
        canonicalDocx: false,
      });
      continue;
    }
    const mergeMatch = MERGE_PATTERN.exec(line);
    if (!mergeMatch || !currentSheet) continue;
    merges.push({
      sheet: currentSheet,
      startColumn: columnNumber(mergeMatch[1]!),
      startRow: Number.parseInt(mergeMatch[2]!, 10),
      endColumn: columnNumber(mergeMatch[3]!),
      endRow: Number.parseInt(mergeMatch[4]!, 10),
      anchorAddress: mergeMatch[5]!,
      sourceFileId: source.sourceFileId,
    });
  }
  const docx = canonicalDocxMerges(source, cells, rawLines);
  if (docx.status === "valid") {
    for (const cell of cells) cell.canonicalDocx = true;
  }
  return {
    cells,
    merges: [...merges, ...docx.merges],
    docxMetadataStatus: docx.status,
  };
}

/**
 * Returns the exact non-empty cell locators only when the converter-owned
 * DOCX v2 metadata authenticates the complete canonical table stream.
 * Callers must treat `null` as a hard failure; ordinary workbook-looking text
 * is not sufficient to authorize a locator migration.
 */
export function certifiedCanonicalDocxCellLocators(
  source: LocalTextEvidence,
): ReadonlySet<string> | null {
  const workbook = parseWorkbookEvidence(source);
  if (workbook.docxMetadataStatus !== "valid") return null;
  return new Set(
    workbook.cells
      .filter((cell) => cell.canonicalDocx)
      .map((cell) => `${cell.sheet}!${cell.address}`),
  );
}

function shortCellQuote(cell: WorkbookCell, content = cell.value, maximum = 1_900): string {
  const prefix = `${cell.sheet}!${cell.address}: `;
  const available = Math.max(1, maximum - prefix.length);
  const candidate = content.slice(0, available);
  const sliced = content.length > available
    ? candidate
      // Only a truncated suffix can be an incomplete converter tag/entity.
      // A literal trailing `&` in a complete source cell is authoritative text.
      .replace(/<(?:b|br)?$/iu, "")
      .replace(/&(?:#\d*|[a-z]*)$/iu, "")
    : candidate;
  return `${prefix}${sliced || content.slice(0, 1)}`;
}

function splitNormalizedEvidenceChunks(value: string, maximum = 900): string[] {
  const normalized = cleanCellValue(value);
  if (normalized.length <= maximum) return normalized ? [normalized] : [];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maximum) {
    const preferred = remaining.lastIndexOf(" ", maximum);
    const splitAt = preferred >= Math.floor(maximum * 0.6) ? preferred : maximum;
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function mergedQuote(cells: WorkbookCell[], maximum: number): string | null {
  const unique = new Map(cells.map((cell) => [
    `${cell.sourceFileId}\0${cell.sheet}\0${cell.address}\0${cell.value}`,
    cell,
  ]));
  const values = [...unique.values()];
  const priorityAttempts = maximum >= 2_000
    ? [
        { context: 120, last: 1_400 },
        { context: 100, last: 1_200 },
        { context: 80, last: 1_000 },
      ]
    : [
        { context: 100, last: 360 },
        { context: 80, last: 300 },
        { context: 60, last: 240 },
      ];
  for (const attempt of priorityAttempts) {
    const encoded = encodeMergedEvidenceQuote(
      values.map((cell, index) => ({
        source_file_id: cell.sourceFileId,
        quote: shortCellQuote(
          cell,
          cell.value,
          index === values.length - 1 ? attempt.last : attempt.context,
        ),
      })),
      maximum,
    );
    if (encoded !== null) return encoded;
  }
  for (const fragmentMaximum of [360, 240, 160, 100, 60]) {
    const encoded = encodeMergedEvidenceQuote(
      values.map((cell) => ({
        source_file_id: cell.sourceFileId,
        quote: shortCellQuote(cell, cell.value, fragmentMaximum),
      })),
      maximum,
    );
    if (encoded !== null) return encoded;
  }
  return null;
}

function categoriesFromText(value: string): VendorCategory[] {
  const normalized = cleanCellValue(value);
  const matches: VendorCategory[] = [];
  if (/(?:메이크업|헤어|원장급|부원장급|실장급)/u.test(normalized)) matches.push("makeup");
  if (/(?:드레스|피팅|헬퍼|도우미)/u.test(normalized)) matches.push("dress");
  if (/(?:스튜디오|스냅|앨범|페이지|작가\s*추가)/u.test(normalized)) matches.push("studio");
  if (TRADITIONAL_ATTIRE_DRESS_EVIDENCE_PATTERN.test(normalized)) matches.push("dress");
  return [...new Set(matches)];
}

function categoryFromText(value: string): VendorCategory | null {
  const distinct = categoriesFromText(value);
  return distinct.length === 1 ? distinct[0]! : null;
}

function packageCategoriesFromText(value: string): PackageVendorCategory[] {
  return categoriesFromText(value).filter(
    (category): category is PackageVendorCategory => category !== "other",
  );
}

function policySectionType(value: string): NonNullable<DisclosureExtraction["sections"]>[number]["section_type"] {
  if (/위약/u.test(value) || POLICY_TIER_PATTERN.test(cleanCellValue(value))) return "penalty";
  if (/(?:환불|환급)/u.test(value)) return "refund_policy";
  if (/(?:취소|계약\s*해지|해약)/u.test(value)) return "contract_terms";
  if (/(?:예약|계약금)/u.test(value)) return "reservation";
  if (isPricingBasisText(value)) return "pricing_basis";
  return "other";
}

function isPricingBasisText(value: string): boolean {
  const normalized = cleanCellValue(value);
  return PRICING_BASIS_HEADING_PATTERN.test(normalized)
    || CATEGORY_PRICING_BASIS_HEADING_PATTERN.test(normalized)
    || PRICING_BASIS_NOTE_PATTERN.test(normalized);
}

function isPricingBasisCell(cell: WorkbookCell): boolean {
  const normalized = cleanCellValue(cell.value);
  if (!normalized || normalized.length > 1_800 || POLICY_PATTERN.test(normalized)) return false;
  if (PRICING_BASIS_HEADING_PATTERN.test(normalized)) return true;
  return scanSourceMoneyOccurrences(normalized).length === 0
    && PRICING_BASIS_NOTE_PATTERN.test(normalized);
}

function isPaymentAmountRoleCell(cell: WorkbookCell): boolean {
  const normalized = cleanCellValue(cell.value);
  return normalized.length <= 300
    && PAYMENT_AMOUNT_ROLE_PATTERN.test(normalized)
    && scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0;
}

function exactCategoryFromText(value: string): VendorCategory | null {
  const normalized = cleanCellValue(value);
  if (/^(?:스튜디오|studio)$/iu.test(normalized)) return "studio";
  if (/^(?:드레스|dress)$/iu.test(normalized)) return "dress";
  if (/^(?:메이크업|헤어\s*(?:&|앤드)?\s*메이크업|makeup)$/iu.test(normalized)) return "makeup";
  return null;
}

function explicitPlainCategoryFromText(value: string): VendorCategory | null {
  const exact = exactCategoryFromText(value);
  if (exact) return exact;
  const heading = CATEGORY_PRICING_BASIS_HEADING_PATTERN.exec(cleanCellValue(value));
  return heading?.[1] ? exactCategoryFromText(heading[1]) : null;
}

function plainTextLines(source: LocalTextEvidence): PlainTextLine[] {
  return source.text.split(/\r?\n/u).flatMap((rawLine, index) => {
    const quoteValue = cleanCellValue(rawLine);
    if (
      !quoteValue
      || isConverterReviewMetadataLine(quoteValue)
      || quoteValue.startsWith("[PDF_LAYOUT_EVIDENCE_")
    ) return [];
    const ocrLine = /^ocr:page:\d+:line:\d+:\s*(.*)$/u.exec(quoteValue);
    const docxBodyLine = /^docx:body:p\d+:\s*(.*)$/u.exec(quoteValue);
    const value = cleanCellValue(ocrLine?.[1] ?? docxBodyLine?.[1] ?? quoteValue);
    return value ? [{
      sourceFileId: source.sourceFileId,
      number: index + 1,
      value,
      quoteValue,
    }] : [];
  });
}

function docxBodyProjection(source: LocalTextEvidence): LocalTextEvidence | null {
  let found = false;
  const text = source.text.split(/\r?\n/u).map((line) => {
    if (!/^\s*docx:body:p[1-9][0-9]*:\s*.+$/u.test(line)) return "";
    found = true;
    return line;
  }).join("\n");
  return found ? { sourceFileId: source.sourceFileId, text } : null;
}

function shortLineQuote(line: PlainTextLine, maximum = 1_900): string {
  const prefix = `line:${line.number}: `;
  return `${prefix}${line.quoteValue.slice(0, Math.max(1, maximum - prefix.length))}`;
}

function mergedLineQuote(lines: PlainTextLine[], maximum: number): string | null {
  return encodeMergedEvidenceQuote(
    lines.map((line) => ({
      source_file_id: line.sourceFileId,
      quote: shortLineQuote(line),
    })),
    maximum,
  );
}

function isPlainLineVendorCandidate(line: PlainTextLine): boolean {
  return line.value.length <= 300
    && exactCategoryFromText(line.value) === null
    && !/[&＋+/]\s*$/u.test(line.value)
    && !PLAIN_LINE_GENERIC_LABEL_PATTERN.test(line.value)
    && !POLICY_PATTERN.test(line.value)
    && !isPricingBasisText(line.value)
    && scanSourceMoneyOccurrences(line.value).length === 0;
}

function mergeForAnchor(evidence: WorkbookEvidence, cell: WorkbookCell): WorkbookMerge | null {
  return evidence.merges.find((merge) =>
    merge.sourceFileId === cell.sourceFileId
    && merge.sheet === cell.sheet
    && merge.anchorAddress === cell.address
  ) ?? null;
}

function mergeContainingCell(evidence: WorkbookEvidence, cell: WorkbookCell): WorkbookMerge | null {
  return evidence.merges.find((merge) =>
    merge.sourceFileId === cell.sourceFileId
    && merge.sheet === cell.sheet
    && cell.column >= merge.startColumn
    && cell.column <= merge.endColumn
    && cell.row >= merge.startRow
    && cell.row <= merge.endRow
  ) ?? null;
}

function cellRowInterval(
  evidence: WorkbookEvidence,
  cell: WorkbookCell,
): { startRow: number; endRow: number } {
  const merge = mergeContainingCell(evidence, cell);
  return merge
    ? { startRow: merge.startRow, endRow: merge.endRow }
    : { startRow: cell.row, endRow: cell.row };
}

function cellOverlapsRows(
  evidence: WorkbookEvidence,
  cell: WorkbookCell,
  startRow: number,
  endRow: number,
): boolean {
  const interval = cellRowInterval(evidence, cell);
  return interval.startRow <= endRow && interval.endRow >= startRow;
}

function mergeCoveringColumn(
  evidence: WorkbookEvidence,
  cell: WorkbookCell,
  targetColumn: number,
): boolean {
  if (cell.column === targetColumn) return true;
  const merge = mergeForAnchor(evidence, cell);
  return Boolean(merge && merge.startColumn <= targetColumn && merge.endColumn >= targetColumn);
}

function policyBoundary(cells: WorkbookCell[], header: WorkbookCell): number {
  return cells
    .filter((cell) =>
      cell.sourceFileId === header.sourceFileId
      && cell.sheet === header.sheet
      && cell.column === header.column
      && cell.row > header.row
      && isDocumentPolicyBoundaryCell(cell)
    )
    .reduce((minimum, cell) => Math.min(minimum, cell.row), Number.POSITIVE_INFINITY);
}

function isDocumentPolicyBoundaryCell(cell: WorkbookCell): boolean {
  const value = cleanCellValue(cell.value);
  if (!POLICY_PATTERN.test(value) || value.startsWith("※")) return false;
  return /(?:산정\s*기준|환불\s*규정|환급\s*규정|환불\s*정책|환급\s*정책|약관)/u.test(value)
    || /계약\s*해지.{0,80}(?:위약|환불|환급).{0,80}(?:기준|규정)/u.test(value)
    || /^(?:②\s*)?(?:위약금|환불|환급|환급\s*위약금)$/u.test(value);
}

function headerFollowsCurrentPriceSection(
  cells: WorkbookCell[],
  header: WorkbookCell,
): boolean {
  const previousPolicyRow = cells
    .filter((cell) =>
      cell.column === header.column
      && cell.row < header.row
      && isDocumentPolicyBoundaryCell(cell)
    )
    .reduce((maximum, cell) => Math.max(maximum, cell.row), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(previousPolicyRow)) return true;
  const previousPriceRow = cells
    .filter((cell) =>
      cell.column === header.column
      && cell.row < header.row
      && /(?:^|\s)①?\s*가격(?:\s|\(|$)/u.test(cleanCellValue(cell.value))
    )
    .reduce((maximum, cell) => Math.max(maximum, cell.row), Number.NEGATIVE_INFINITY);
  return previousPriceRow > previousPolicyRow;
}

function categoryForHeader(
  cells: WorkbookCell[],
  header: WorkbookCell,
): VendorCategory | null {
  const firstVendorRow = cells
    .filter((cell) =>
      cell.sourceFileId === header.sourceFileId
      && cell.sheet === header.sheet
      && cell.column === header.column
      && cell.row > header.row
      && !BUSINESS_HEADER_PATTERN.test(cleanCellValue(cell.value))
    )
    .reduce((minimum, cell) => Math.min(minimum, cell.row), Number.POSITIVE_INFINITY);
  const windowEnd = Math.min(header.row + 2, firstVendorRow - 1);
  const window = [
    ...cells
      .filter((cell) =>
        cell.sourceFileId === header.sourceFileId
        && cell.sheet === header.sheet
        && cell.row >= Math.max(1, header.row - 3)
        && cell.row <= windowEnd
      )
      .map((cell) => cell.value),
  ].join(" ");
  const exactNearbyCategories = [...new Set(cells
    .filter((cell) =>
      cell.sourceFileId === header.sourceFileId
      && cell.sheet === header.sheet
      && cell.row >= Math.max(1, header.row - 3)
      && cell.row <= windowEnd
    )
    .flatMap((cell) => {
      const category = explicitPlainCategoryFromText(cell.value);
      return category ? [category] : [];
    }))];
  // A category printed in the audited table heading is stronger evidence
  // than a worksheet tab name, which is frequently copied from a template.
  if (exactNearbyCategories.length === 1) return exactNearbyCategories[0]!;
  return categoryFromText(header.sheet) ?? categoryFromText(window);
}

function categoryEvidenceForHeader(
  cells: WorkbookCell[],
  header: WorkbookCell,
  category: VendorCategory | null,
): WorkbookCell | null {
  if (!category) return null;
  const firstVendorRow = cells
    .filter((cell) =>
      cell.sourceFileId === header.sourceFileId
      && cell.sheet === header.sheet
      && cell.column === header.column
      && cell.row > header.row
      && isVendorAnchorCandidate(cell)
    )
    .reduce((minimum, cell) => Math.min(minimum, cell.row), Number.POSITIVE_INFINITY);
  const windowEnd = Number.isFinite(firstVendorRow)
    ? Math.min(header.row + 2, firstVendorRow - 1)
    : header.row;
  const candidates = cells
    .filter((cell) =>
      cell.sourceFileId === header.sourceFileId
      && cell.sheet === header.sheet
      && cell.row >= Math.max(1, header.row - 3)
      && cell.row <= windowEnd
      && categoryFromText(cell.value) === category
    );
  return candidates
    .sort((left, right) =>
      Number(explicitPlainCategoryFromText(right.value) === category)
        - Number(explicitPlainCategoryFromText(left.value) === category)
      || right.row - left.row
      || left.column - right.column
    )[0] ?? null;
}

function agencySections(evidence: WorkbookEvidence): AgencySection[] {
  const result: AgencySection[] = [];
  const scopes = [...new Set(evidence.cells.map((cell) => `${cell.sourceFileId}\0${cell.sheet}`))];
  for (const scope of scopes) {
    const [sourceFileId, sheet] = scope.split("\0") as [string, string];
    const sheetCells = evidence.cells.filter((cell) =>
      cell.sourceFileId === sourceFileId && cell.sheet === sheet
    );
    const headers = sheetCells
      .filter((cell) => BUSINESS_HEADER_PATTERN.test(cleanCellValue(cell.value)))
      .filter((header) => headerFollowsCurrentPriceSection(sheetCells, header))
      .sort((left, right) => left.row - right.row || left.column - right.column);
    for (const [index, header] of headers.entries()) {
      const nextHeaderRow = headers[index + 1]?.row ?? Number.POSITIVE_INFINITY;
      const boundary = Math.min(nextHeaderRow, policyBoundary(sheetCells, header));
      const orderedGenericCategory = GENERIC_SHEET_PATTERN.test(sheet) && headers.length === 3
        ? CATEGORY_ORDER[Math.min(index, CATEGORY_ORDER.length - 1)]!
        : null;
      const explicitCategory = orderedGenericCategory === null
        ? categoryForHeader(sheetCells, header)
        : null;
      const category = orderedGenericCategory ?? explicitCategory;
      result.push({
        header,
        category,
        categoryEvidence: categoryEvidenceForHeader(sheetCells, header, category)
          ?? (!explicitCategory && category ? header : null),
        endRow: Number.isFinite(boundary)
          ? boundary - 1
          : Math.max(...sheetCells.map((cell) => cell.row)),
      });
    }
  }
  return result;
}

function isVendorAnchorCandidate(cell: WorkbookCell): boolean {
  const value = cleanCellValue(cell.value);
  return value.length >= 1
    && value.length <= 300
    && !BUSINESS_HEADER_PATTERN.test(value)
    && !HALL_HEADER_PATTERN.test(value)
    && !POLICY_PATTERN.test(value)
    && !VENDOR_CONTINUATION_LABEL_PATTERN.test(value)
    && !PLACEHOLDER_VENDOR_PATTERN.test(value)
    && scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0;
}

function safeDocxBusinessIdentityValues(
  rawValue: string,
  canonicalDocx: boolean,
  headerValue: string,
): string[] {
  const rawIdentity = cleanCellValue(rawValue);
  if (
    !canonicalDocx
    || cleanCellValue(headerValue) !== "사업자명"
    || !/[,，]/u.test(rawIdentity)
  ) return [rawIdentity];
  // Commas inside a legal name or prose are not a vendor list. A fan-out is
  // allowed only for a plain identity cell under the converter-authenticated
  // exact header; descriptions and policy language stay one review-only row.
  if (
    /[()（）\[\]{}｛｝]/u.test(rawIdentity)
    || /(?:주식회사|유한회사|합자회사|합명회사|사단법인|재단법인|법인|㈜|계약|가격|금액|비용|위약|환불|취소|설명|비고|적용|포함|별도)/u.test(rawIdentity)
  ) return [rawIdentity];
  const names = rawIdentity.split(/[,，]/u).map((name) => name.trim());
  if (
    names.length < 2
    || names.length > 50
    || names.some((name) => (
      name.length < 1
      || name.length > 80
      || !/^[\p{L}\p{N}][\p{L}\p{N}\s&·.'’/-]*$/u.test(name)
      || POLICY_PATTERN.test(name)
      || PUBLIC_CONTACT_PATTERN.test(name)
      || scanSourceMoneyOccurrences(name).length > 0
    ))
    || new Set(names.map((name) => name.normalize("NFKC").toLocaleLowerCase("ko"))).size
      !== names.length
  ) return [rawIdentity];
  return names;
}

function safeDocxBusinessIdentityNames(anchor: VendorAnchor): string[] {
  return safeDocxBusinessIdentityValues(
    anchor.cell.value,
    anchor.cell.canonicalDocx,
    anchor.header.value,
  );
}

function isPackageSection(evidence: WorkbookEvidence, section: AgencySection): boolean {
  if (PACKAGE_SHEET_PATTERN.test(section.header.sheet)) return true;
  if (evidence.cells.some((cell) => (
    cell.sourceFileId === section.header.sourceFileId
    && cell.sheet === section.header.sheet
    && cell.row > section.header.row
    && cell.row <= section.endRow
    && EXPLICIT_PACKAGE_ANCHOR_PATTERN.test(cleanCellValue(cell.value))
  ))) return true;
  return evidence.cells.some((cell) => (
    cell.sourceFileId === section.header.sourceFileId
    && cell.sheet === section.header.sheet
    && cell.row >= Math.max(1, section.header.row - 3)
    && cell.row <= section.header.row + 2
    && /(?:스드메|토탈\s*샵)/u.test(cleanCellValue(cell.value))
  ));
}

function vendorAnchors(evidence: WorkbookEvidence, sections: AgencySection[]): VendorAnchor[] {
  const result: VendorAnchor[] = [];
  for (const section of sections) {
    if (isPackageSection(evidence, section)) continue;
    const candidates = evidence.cells
      .filter((cell) =>
        cell.sourceFileId === section.header.sourceFileId
        && cell.sheet === section.header.sheet
        && cell.column === section.header.column
        && cell.row > section.header.row
        && cell.row <= section.endRow
        && isVendorAnchorCandidate(cell)
      )
      .sort((left, right) => left.row - right.row);
    for (const [index, cell] of candidates.entries()) {
      const merge = mergeForAnchor(evidence, cell);
      const endRow = Math.min(
        section.endRow,
        merge?.endRow ?? ((candidates[index + 1]?.row ?? (section.endRow + 1)) - 1),
      );
      const rowCategoryEvidence = section.category ? null : evidence.cells
        .filter((candidate) => (
          candidate.sourceFileId === cell.sourceFileId
          && candidate.sheet === cell.sheet
          && candidate.column < cell.column
          && cellOverlapsRows(evidence, candidate, cell.row, cell.row)
          && categoryFromText(candidate.value) !== null
        ))
        .sort((left, right) => right.column - left.column)[0] ?? null;
      const spanCategoryEvidence = section.category || rowCategoryEvidence ? null : evidence.cells
        .filter((candidate) => (
          candidate.sourceFileId === cell.sourceFileId
          && candidate.sheet === cell.sheet
          && candidate.column > cell.column
          && cellOverlapsRows(evidence, candidate, cell.row, endRow)
          && categoryFromText(candidate.value) !== null
        ))
        .sort((left, right) => left.row - right.row || left.column - right.column)[0] ?? null;
      const category = section.category
        ?? (rowCategoryEvidence ? categoryFromText(rowCategoryEvidence.value) : null)
        ?? (spanCategoryEvidence ? categoryFromText(spanCategoryEvidence.value) : null);
      if (!category) continue;
      const sheetIdentity = explicitSheetBusinessIdentity(evidence.cells.filter((candidate) => (
        candidate.sourceFileId === cell.sourceFileId && candidate.sheet === cell.sheet
      )));
      result.push({
        cell,
        header: section.header,
        headerEndRow: candidates[0]!.row - 1,
        categoryEvidence: section.categoryEvidence ?? rowCategoryEvidence ?? spanCategoryEvidence,
        category,
        endRow,
        selfBusiness: /^사업장명$/u.test(cleanCellValue(section.header.value))
          && Boolean(sheetIdentity && identitiesReferToSameBusiness(sheetIdentity.name, cell.value)),
      });
    }
  }
  return result;
}

function packageAnchors(evidence: WorkbookEvidence, sections: AgencySection[]): PackageAnchor[] {
  const result: PackageAnchor[] = [];
  for (const section of sections) {
    if (!isPackageSection(evidence, section)) continue;
    const sheetCells = evidence.cells.filter((cell) =>
      cell.sourceFileId === section.header.sourceFileId
      && cell.sheet === section.header.sheet
    );
    const allCandidates = sheetCells
      .filter((cell) =>
        cell.sourceFileId === section.header.sourceFileId
        && cell.sheet === section.header.sheet
        && cell.column === section.header.column
        && cell.row > section.header.row
        && cell.row <= section.endRow
        && isVendorAnchorCandidate(cell)
      )
      .sort((left, right) => left.row - right.row);
    const explicitCandidates = allCandidates.filter((cell) => (
      EXPLICIT_PACKAGE_ANCHOR_PATTERN.test(cleanCellValue(cell.value))
    ));
    const candidates = explicitCandidates.length > 0 ? explicitCandidates : allCandidates;
    if (candidates.length === 0) continue;
    const headerEndRow = candidates[0]!.row - 1;
    const sharedCategoryEvidence = sheetCells
      .filter((cell) =>
        cell.row >= Math.max(1, section.header.row - 3)
        && cell.row < (candidates[0]?.row ?? Number.POSITIVE_INFINITY)
        && /(?:스드메|스튜디오|드레스|메이크업|헤어\s*메이크업)/u.test(cleanCellValue(cell.value))
      )
      .sort((left, right) => left.row - right.row || left.column - right.column);
    const sharedCategoryScope = [...new Set(sharedCategoryEvidence.flatMap((cell): PackageVendorCategory[] => {
      if (/스드메/u.test(cleanCellValue(cell.value))) return [...CATEGORY_ORDER];
      return packageCategoriesFromText(cell.value);
    }))];
    for (const [index, cell] of candidates.entries()) {
      const merge = mergeForAnchor(evidence, cell);
      const endRow = Math.min(
        section.endRow,
        merge?.endRow ?? ((candidates[index + 1]?.row ?? (section.endRow + 1)) - 1),
      );
      const spanCategoryEvidence = explicitCandidates.length === 0 ? [] : sheetCells
        .filter((candidate) => {
          if (
            candidate.row < cell.row
            || candidate.row > endRow
            || packageCategoriesFromText(candidate.value).length === 0
          ) return false;
          const owningHeader = headerForVendorColumn(
            evidence,
            { cell, header: section.header, headerEndRow },
            candidate,
          );
          return Boolean(
            owningHeader
            && PACKAGE_COMPOSITION_HEADER_PATTERN.test(cleanCellValue(owningHeader.value)),
          );
        })
        .sort((left, right) => left.row - right.row || left.column - right.column);
      const categoryEvidence = spanCategoryEvidence.length > 0
        ? spanCategoryEvidence
        : sharedCategoryEvidence;
      const categoryScope = spanCategoryEvidence.length > 0
        ? [...new Set(spanCategoryEvidence.flatMap((candidate) => (
            packageCategoriesFromText(candidate.value)
          )))]
        : sharedCategoryScope;
      result.push({
        cell,
        header: section.header,
        headerEndRow,
        categoryScope,
        categoryEvidence,
        endRow,
        explicit: explicitCandidates.length > 0,
      });
    }
  }
  return result;
}

interface LocatedOccurrenceSegment {
  text: string;
  rawIndex: number;
}

function exactMoneyTokenIndexes(value: string, raw: string): number[] {
  const indexes: number[] = [];
  let fromIndex = 0;
  while (fromIndex <= value.length - raw.length) {
    const index = value.indexOf(raw, fromIndex);
    if (index < 0) break;
    const before = index > 0 ? value[index - 1]! : "";
    const after = index + raw.length < value.length ? value[index + raw.length]! : "";
    const afterNext = index + raw.length + 1 < value.length
      ? value[index + raw.length + 1]!
      : "";
    const hasExplicitWonSuffix = /원\s*$/u.test(raw);
    const numericContinuationAfter = /\d/u.test(after)
      || (
        !hasExplicitWonSuffix
        && /[,.]/u.test(after)
        && /\d/u.test(afterNext)
      );
    if (!/[\d,.]/u.test(before) && !numericContinuationAfter) indexes.push(index);
    fromIndex = index + Math.max(1, raw.length);
  }
  return indexes;
}

function occurrenceCommaClause(
  text: string,
  rawIndex: number,
  rawLength: number,
): LocatedOccurrenceSegment {
  const delimiterIndexes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (!/[,，;；|]/u.test(character)) continue;
    if (
      /[,，]/u.test(character)
      && /\d/u.test(text[index - 1] ?? "")
      && /\d/u.test(text[index + 1] ?? "")
    ) continue;
    delimiterIndexes.push(index);
  }
  const previousDelimiter = delimiterIndexes
    .filter((index) => index < rawIndex)
    .at(-1) ?? -1;
  const followingDelimiter = delimiterIndexes.find((index) => (
    index >= rawIndex + rawLength
  ));
  const nextDelimiter = followingDelimiter !== undefined
    ? followingDelimiter
    : text.length;
  const untrimmed = text.slice(previousDelimiter + 1, nextDelimiter);
  const leadingWhitespace = untrimmed.length - untrimmed.trimStart().length;
  return {
    text: untrimmed.trim(),
    rawIndex: rawIndex - (previousDelimiter + 1) - leadingWhitespace,
  };
}

function exactLabelPriceFragment(value: string): boolean {
  const occurrences = scanSourceMoneyOccurrences(value);
  if (occurrences.length < 1 || occurrences.length > 2) return false;
  if (occurrences.length === 2 && !/[~～〜–—]/u.test(value)) return false;
  const firstIndex = value.indexOf(occurrences[0]!.raw);
  if (firstIndex <= 0) return false;
  const label = value.slice(0, firstIndex)
    .replace(/^[\s●•▶▷▪◦·:：\-–—]+|[\s●•▶▷▪◦·:：\-–—]+$/gu, "")
    .trim();
  return specificOptionLabel(label) !== null;
}

function exactDelimitedPriceFragments(value: string): string[] {
  const bulletParts = value
    .split(/(?=[●•▶▷▪◦]\s*)/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const candidates = bulletParts.flatMap((part) => (
    part.split(/\s*(?:\/|\||;|；)\s*/u).map((candidate) => candidate.trim()).filter(Boolean)
  ));
  return candidates.length > 1 && candidates.every(exactLabelPriceFragment)
    ? candidates
    : [value.trim()];
}

function occurrenceSegment(located: LocatedMoney): LocatedOccurrenceSegment {
  const raw = located.occurrence.raw;
  const candidates = located.cell.value
    .split(/(?:<br\s*\/?>|\r?\n)/giu)
    .map((value) => value.trim())
    .flatMap(exactDelimitedPriceFragments)
    .flatMap((text) => exactMoneyTokenIndexes(text, raw).map((rawIndex) => ({
      text,
      rawIndex,
    })));
  const selected = candidates[located.rawOrdinalInCell] ?? candidates[0] ?? {
    text: raw,
    rawIndex: 0,
  };
  const selectedClause = occurrenceCommaClause(selected.text, selected.rawIndex, raw.length);
  if (selectedClause.text.length <= 850) return selectedClause;
  const start = Math.max(0, selectedClause.rawIndex - 350);
  return {
    text: selectedClause.text.slice(
      start,
      Math.min(selectedClause.text.length, start + 850),
    ),
    rawIndex: selectedClause.rawIndex - start,
  };
}

function exactPrecedingPriceClauseContext(
  located: LocatedMoney,
): { label: string; evidenceText: string } | null {
  const raw = located.occurrence.raw;
  const candidates = located.cell.value
    .split(/(?:<br\s*\/?>|\r?\n)/giu)
    .map((value) => value.trim())
    .flatMap((part) => {
      const fragments = exactDelimitedPriceFragments(part);
      return fragments.flatMap((fragment, fragmentIndex) => (
        exactMoneyTokenIndexes(fragment, raw).map(() => ({
          part,
          fragments,
          fragmentIndex,
        }))
      ));
    });
  const selected = candidates[located.rawOrdinalInCell] ?? candidates[0];
  if (!selected || selected.fragmentIndex < 1) return null;
  // Equal amounts only need the preceding sibling label when the source
  // explicitly delimits peer clauses. Bullet fragments already carry their
  // own exact label and quote; borrowing the previous bullet would widen the
  // provenance beyond the occurrence being linked.
  if (!/(?:\/|\||;|；)/u.test(selected.part)) return null;
  const previous = selected.fragments[selected.fragmentIndex - 1]!;
  const occurrences = scanSourceMoneyOccurrences(shortCellQuote({
    ...located.cell,
    value: previous,
  }));
  if (occurrences.length !== 1) return null;
  const amountIndex = previous.indexOf(occurrences[0]!.raw);
  if (amountIndex <= 0) return null;
  const label = specificOptionLabel(previous.slice(0, amountIndex));
  return label ? { label, evidenceText: selected.part } : null;
}

function unitEvidenceForOccurrence(
  evidence: WorkbookEvidence,
  located: LocatedMoney,
  labelCell: WorkbookCell | null,
): WorkbookCell[] {
  const valueEvidence = { ...located.cell, value: occurrenceSegment(located).text };
  const reproducesOccurrence = (support: WorkbookCell[]): boolean =>
    scanSourceMoneyOccurrences(
      [...support, ...(labelCell ? [labelCell] : []), valueEvidence]
        .map((cell) => shortCellQuote(cell))
        .join("\n"),
    ).some((occurrence) =>
      occurrence.source_locator === located.occurrence.source_locator
      && occurrence.raw === located.occurrence.raw
      && occurrence.krw === located.occurrence.krw
    );
  if (reproducesOccurrence([])) return [];

  const declarationPattern = /(?:금액\s*)?단위\s*[:：]?\s*(?:억|천만|백만|만|천)?\s*원|[([]\s*(?:단위\s*[:：]?\s*)?(?:억|천만|백만|만|천)?\s*원(?:\s*,[^)\]]*)?\s*[)\]]/u;
  const candidates = evidence.cells.filter((cell) =>
    cell.sourceFileId === located.cell.sourceFileId
    && cell.sheet === located.cell.sheet
    && cell.row <= located.cell.row
    && declarationPattern.test(cleanCellValue(cell.value))
  );
  const rows = [...new Set(candidates.map((cell) => cell.row))]
    .sort((left, right) => right - left);
  for (const row of rows) {
    const rowCells = candidates
      .filter((cell) => cell.row === row)
      .sort((left, right) => left.column - right.column);
    if (reproducesOccurrence(rowCells)) return rowCells;
  }
  // A canonical bare won value can sit in a sub-column covered by a merged
  // price header. The compact source_quote cannot reproduce the workbook
  // merge metadata, so carry the independently certified declaration and
  // semantic header explicitly instead of dropping their provenance.
  if (/^\d{1,3}(?:,\d{3})+$/u.test(located.occurrence.raw.trim())) {
    const support = exactDeclaredUnitPriceSupport(evidence, located);
    if (support) {
      return [...new Map(
        [support.declaration, support.semantic].map((cell) => [cellKey(cell), cell]),
      ).values()];
    }
  }
  return [];
}

const MIN_STRUCTURED_PRICE_KRW = 10_000;

function sourceMoneyTokenIsAmbiguous(raw: string): boolean {
  const numericTokens = raw.match(/\d[\d,.]*/gu) ?? [];
  return numericTokens.some((token) => {
    if (token.includes(",") && !/^\d{1,3}(?:,\d{3})+$/u.test(token)) return true;
    // A dot followed by exactly three digits is used as both a decimal typo
    // and a thousands separator in source disclosures. Preserve it in the
    // audit ledger, but require a person to choose the publishable amount.
    return /^\d{1,3}(?:\.\d{3})+$/u.test(token);
  });
}

function sourceMoneyRequiresStructuredQuarantine(
  occurrence: MoneyOccurrence,
  hasDeclaredUnitSupport = false,
  explicitUnitConflict = false,
): boolean {
  const hasExplicitCurrencyUnit = /(?:KRW|₩|억|천만|백만|만|천|원)/iu.test(occurrence.raw);
  if (occurrence.krw < MIN_STRUCTURED_PRICE_KRW) return true;
  if (sourceMoneyTokenIsAmbiguous(occurrence.raw)) return true;
  return hasDeclaredUnitSupport
    && !hasExplicitCurrencyUnit
    && /^\d{1,3}(?:,\d{3})+$/u.test(occurrence.raw.trim());
}

function normalizedMoneyUnit(value: string): string | null {
  if (/(?:KRW|₩)/iu.test(value)) return "원";
  return value.match(/(?:천만|백만|억|만|천)?원/u)?.[0] ?? null;
}

function exactWorkbookPriceSemanticSupport(
  evidence: WorkbookEvidence,
  located: LocatedMoney,
): WorkbookCell | null {
  const sameSheet = evidence.cells.filter((cell) => (
    cell.sourceFileId === located.cell.sourceFileId
    && cell.sheet === located.cell.sheet
  ));
  const sameRowContext = sameSheet.filter((cell) => (
    cell.row === located.cell.row
    && cell.column <= located.cell.column
    && located.cell.column - cell.column <= 8
  ));
  const nearestDescriptor = sameRowContext
    .filter((cell) => (
      cell.column < located.cell.column
      && scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0
    ))
    .sort((left, right) => right.column - left.column)[0] ?? null;
  const boundedRoleContext = [located.cell, ...(nearestDescriptor ? [nearestDescriptor] : [])];
  if (boundedRoleContext.some((cell) => (
    DECLARED_UNIT_NON_PRICE_PATTERN.test(cleanCellValue(cell.value))
  ))) {
    return null;
  }
  if (boundedRoleContext.some((cell) => {
    const value = cleanCellValue(cell.value);
    return DECLARED_UNIT_QUANTITY_PATTERN.test(value)
      && !DECLARED_UNIT_PRICE_SEMANTIC_PATTERN.test(value);
  })) return null;

  const semanticCandidates = sameSheet
    .filter((cell) => {
      if (DECLARED_UNIT_NON_PRICE_PATTERN.test(cleanCellValue(cell.value))) return false;
      if (!DECLARED_UNIT_PRICE_SEMANTIC_PATTERN.test(cleanCellValue(cell.value))) return false;
      if (cellKey(cell) === cellKey(located.cell)) return true;
      if (
        cell.row === located.cell.row
        && cell.column < located.cell.column
        && located.cell.column - cell.column <= 8
      ) return true;
      return cell.row < located.cell.row && mergeCoveringColumn(
        evidence,
        cell,
        located.cell.column,
      );
    })
    .sort((left, right) => (
      Number(right.row === located.cell.row) - Number(left.row === located.cell.row)
      || right.row - left.row
      || right.column - left.column
    ));
  return semanticCandidates[0] ?? null;
}

function exactDeclaredUnitPriceSupport(
  evidence: WorkbookEvidence,
  located: LocatedMoney,
): { declaration: WorkbookCell; semantic: WorkbookCell } | null {
  const declarations = evidence.cells
    .filter((cell) => (
      cell.sourceFileId === located.cell.sourceFileId
      && cell.sheet === located.cell.sheet
      && cell.row <= located.cell.row
      && DECLARED_MONEY_UNIT_PATTERN.test(cleanCellValue(cell.value))
      && ["원", "만원", "천원"].includes(normalizedMoneyUnit(cell.value) ?? "")
      && scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0
    ))
    .sort((left, right) => right.row - left.row || left.column - right.column);
  const declaration = declarations[0];
  if (!declaration) return null;
  const nearestDeclarationRow = declaration.row;
  const nearestUnits = new Set(declarations
    .filter((cell) => cell.row === nearestDeclarationRow)
    .map((cell) => normalizedMoneyUnit(cell.value))
    .filter((unit): unit is string => unit !== null));
  if (nearestUnits.size !== 1) return null;
  const semantic = exactWorkbookPriceSemanticSupport(evidence, located);
  return semantic ? { declaration, semantic } : null;
}

function isCanonicalDeclaredUnitBarePrice(
  evidence: WorkbookEvidence,
  located: LocatedMoney,
): boolean {
  const raw = located.occurrence.raw.trim();
  if (!/^\d{1,3}(?:,\d{3})+$/u.test(raw)) return false;
  if (sourceMoneyTokenIsAmbiguous(raw)) return false;
  if (DECLARED_UNIT_NON_PRICE_PATTERN.test(cleanCellValue(located.cell.value))) return false;
  const support = exactDeclaredUnitPriceSupport(evidence, located);
  // A comma-grouped bare token is canonical KRW only under an exact won
  // declaration. Under 만원/천원 it is unit-ambiguous (and can inflate by
  // orders of magnitude), so preserve it in the ledger for human review.
  return support !== null && normalizedMoneyUnit(support.declaration.value) === "원";
}

function locatedMoneyRequiresStructuredQuarantine(
  evidence: WorkbookEvidence,
  located: LocatedMoney,
  allowExplicitSubMinimumWon = false,
  allowCanonicalDeclaredBare = false,
): boolean {
  const declaredUnitCells = evidence.cells.filter((cell) => (
      cell.sourceFileId === located.cell.sourceFileId
      && cell.sheet === located.cell.sheet
      && cell.row <= located.cell.row
      && /(?:금액\s*)?단위\s*[:：]?\s*(?:억|천만|백만|만|천)?\s*원|[([]\s*(?:단위\s*[:：]?\s*)?(?:억|천만|백만|만|천)?\s*원(?:\s*,[^)\]]*)?\s*[)\]]/u.test(
        cleanCellValue(cell.value),
      )
    ))
    .sort((left, right) => right.row - left.row || left.column - right.column);
  const declaredUnit = normalizedMoneyUnit(declaredUnitCells[0]?.value ?? "");
  const explicitUnit = normalizedMoneyUnit(located.occurrence.raw);
  const declaredUnitConflict = Boolean(
    declaredUnit
    && explicitUnit
    && declaredUnit !== explicitUnit,
  );
  if (
    allowExplicitSubMinimumWon
    && located.occurrence.krw >= 1_000
    && located.occurrence.krw < MIN_STRUCTURED_PRICE_KRW
    && explicitUnit !== null
    && (
      !declaredUnitConflict
      || (located.cell.value.match(/\d[\d,.]*/gu) ?? []).length === 1
    )
    && !sourceMoneyTokenIsAmbiguous(located.occurrence.raw)
    && exactWorkbookPriceSemanticSupport(evidence, located) !== null
  ) return false;
  if (
    allowCanonicalDeclaredBare
    && !explicitUnit
    && !declaredUnitConflict
    && isCanonicalDeclaredUnitBarePrice(evidence, located)
  ) return false;
  return sourceMoneyRequiresStructuredQuarantine(
    located.occurrence,
    declaredUnitCells.length > 0,
    declaredUnitConflict,
  );
}

type LocalPriceOption = StrictDisclosureExtraction["partner_vendors"][number]["options"][number];

function specificOptionLabel(
  value: string,
  allowHallAddOnHeader = false,
  allowExactSameDayCancellationFee = false,
): string | null {
  const normalized = cleanCellValue(value)
    .replace(/^[~\-–—:：·ㆍ/|●•▶▷▪◦]+|[~\-–—:：·ㆍ/|●•▶▷▪◦]+$/gu, "")
    .trim();
  if (/^(?:여|남)$/u.test(normalized)) return normalized;
  if (
    normalized.length < 2
    || normalized.length > 300
    || (
      GENERIC_OPTION_HEADER_PATTERN.test(normalized)
      && !(allowHallAddOnHeader && /^장식\s*추가$/u.test(normalized))
    )
    || (
      POLICY_PATTERN.test(normalized)
      && !(
        allowExactSameDayCancellationFee
        && /^당일\s*일정\s*취소$/u.test(normalized)
      )
    )
    || HALL_HEADER_PATTERN.test(normalized)
    || BUSINESS_HEADER_PATTERN.test(normalized)
    || PLACEHOLDER_VENDOR_PATTERN.test(normalized)
    || scanSourceMoneyOccurrences(normalized).length > 0
  ) return null;
  return normalized;
}

function exactBoundedRowDescriptorLabel(
  value: string,
  allowExactSameDayCancellationFee = false,
): { name: string; evidenceText: string } | null {
  const firstExactFragment = value
    .split(/(?:<br\s*\/?>|\r?\n)/giu)
    .map((fragment) => fragment.trim())
    .find(Boolean) ?? "";
  if (firstExactFragment && firstExactFragment !== value.trim()) {
    const delimiterIndex = firstExactFragment.search(/\s*[(/|;；]\s*/u);
    const wordBoundary = firstExactFragment.lastIndexOf(" ", 72);
    const boundedFragment = firstExactFragment.length <= 72
      ? firstExactFragment
      : delimiterIndex >= 2 && delimiterIndex <= 72
        ? firstExactFragment.slice(0, delimiterIndex).trim()
        : firstExactFragment.slice(0, wordBoundary >= 2 ? wordBoundary : 72).trim();
    for (const evidenceText of [boundedFragment, firstExactFragment]) {
      const name = specificOptionLabel(
        evidenceText,
        false,
        allowExactSameDayCancellationFee,
      );
      if (name) return { name, evidenceText };
    }
  }
  const name = specificOptionLabel(
    value,
    false,
    allowExactSameDayCancellationFee,
  );
  return name ? { name, evidenceText: value } : null;
}

function exactCompoundHeaderComponent(
  labelCell: WorkbookCell,
  located: LocatedMoney,
): string | null {
  const labels = cleanCellValue(labelCell.value)
    .split(/\s*(?:\/|\|)\s*/u)
    .map((value) => specificOptionLabel(value));
  const clauses = cleanCellValue(located.cell.value)
    .split(/\s*(?:\/|\|)\s*/u)
    .map((value) => value.trim());
  if (
    labels.length < 2
    || labels.length !== clauses.length
    || labels.some((label) => label === null)
    || new Set(labels).size !== labels.length
  ) return null;
  const clauseOccurrences = clauses.map((clause) => (
    scanSourceMoneyOccurrences(shortCellQuote({ ...located.cell, value: clause }))
  ));
  if (clauseOccurrences.some((occurrences) => occurrences.length !== 1)) return null;
  let matchingOrdinal = 0;
  for (const [index, occurrences] of clauseOccurrences.entries()) {
    const occurrence = occurrences[0]!;
    if (
      occurrence.raw !== located.occurrence.raw
      || occurrence.krw !== located.occurrence.krw
    ) continue;
    if (matchingOrdinal === located.rawOrdinalInCell) return labels[index]!;
    matchingOrdinal += 1;
  }
  return null;
}

function optionRangePeers(entries: LocatedMoney[], located: LocatedMoney): LocatedMoney[] {
  const segment = occurrenceSegment(located).text;
  if (!/[~～〜–—]/u.test(segment)) return [located];
  const sameCellEntries = entries.filter((entry) => (
    cellKey(entry.cell) === cellKey(located.cell)
    && occurrenceSegment(entry).text === segment
  ));
  const clauses = segment.split(/\s*(?:\/|\||;)\s*/u);
  const sourceOccurrences = clauses.flatMap((clause, clauseIndex) => (
    scanSourceMoneyOccurrences(clause).map((occurrence) => ({ occurrence, clauseIndex }))
  ));
  const usedSourceIndexes = new Set<number>();
  const clauseByEntry = new Map<LocatedMoney, number>();
  for (const entry of sameCellEntries) {
    const sourceIndex = sourceOccurrences.findIndex(({ occurrence }, index) => (
      !usedSourceIndexes.has(index)
      && occurrence.raw === entry.occurrence.raw
      && occurrence.krw === entry.occurrence.krw
    ));
    if (sourceIndex < 0) continue;
    usedSourceIndexes.add(sourceIndex);
    clauseByEntry.set(entry, sourceOccurrences[sourceIndex]!.clauseIndex);
  }
  const locatedClause = clauseByEntry.get(located);
  if (locatedClause !== undefined && /[~～〜–—]/u.test(clauses[locatedClause]!)) {
    const peers = sameCellEntries.filter((entry) => clauseByEntry.get(entry) === locatedClause);
    return peers.length > 1 ? peers : [located];
  }
  return [located];
}

function dedupeOptions(options: LocalPriceOption[]): LocalPriceOption[] {
  const unique = new Map<string, LocalPriceOption>();
  for (const option of options) {
    const key = JSON.stringify({
      name: option.name,
      min: option.price_min_krw,
      max: option.price_max_krw,
      condition: option.condition,
      quote: option.source_quote,
      source_file_ids: option.source_file_ids,
    });
    if (!unique.has(key)) unique.set(key, option);
  }
  return [...unique.values()];
}

function optionFromOccurrence(
  evidence: WorkbookEvidence,
  located: LocatedMoney,
  labelCell: WorkbookCell | null = null,
  recordEvidence: WorkbookCell[] = [],
  rangePeers: LocatedMoney[] = [located],
  allowHallAddOnHeader = false,
  preferLabelCell = false,
  allowExactSameDayCancellationFee = false,
): LocalPriceOption | null {
  const locatedSegment = occurrenceSegment(located);
  const segment = locatedSegment.text;
  const orderedPeers = [...rangePeers].sort((left, right) => (
    occurrenceSegment(left).rawIndex - occurrenceSegment(right).rawIndex
  ));
  const labelOccurrence = orderedPeers[0] ?? located;
  const labelSegment = occurrenceSegment(labelOccurrence);
  const occurrenceIndex = labelSegment.text === segment
    ? labelSegment.rawIndex
    : locatedSegment.rawIndex;
  const inlinePrefix = occurrenceIndex < 0
    ? ""
    : cleanCellValue(segment.slice(0, occurrenceIndex))
      .replace(/^[~\-–—:：·ㆍ]+|[~\-–—:：·ㆍ]+$/gu, "")
      .trim();
  const inlineTail = inlinePrefix.split(/[\/|;]/u).at(-1)?.trim() ?? inlinePrefix;
  const earlierInlineMoney = scanSourceMoneyOccurrences(inlinePrefix).at(-1);
  const earlierInlineMoneyIndex = earlierInlineMoney
    ? inlinePrefix.lastIndexOf(earlierInlineMoney.raw)
    : -1;
  const nearestInlineLabel = earlierInlineMoney && earlierInlineMoneyIndex >= 0
    ? inlinePrefix
      .slice(earlierInlineMoneyIndex + earlierInlineMoney.raw.length)
      .replace(/^[\s([{（［｛]+|[\s)\]}）］｝]+$/gu, "")
      .trim()
    : null;
  const inlineName = [nearestInlineLabel, inlineTail, inlinePrefix]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => specificOptionLabel(candidate))
    .find((candidate): candidate is string => candidate !== null) ?? null;
  const inlineSuffix = occurrenceIndex < 0
    ? null
    : cleanCellValue(
        segment.slice(occurrenceIndex + labelOccurrence.occurrence.raw.length),
      ).match(/^(?:할인|추가(?:\s*(?:비용|금액))?|별도(?:\s*비용)?)(?=\s|$)/u)?.[0] ?? null;
  const cellParts = located.cell.value.split(/(?:<br\s*\/?>|\r?\n)/giu).map((value) => value.trim());
  const containingPartIndex = cellParts.findIndex((part) => (
    part === segment || exactDelimitedPriceFragments(part).includes(segment)
  ));
  const precedingSegment = containingPartIndex > 0
    ? specificOptionLabel(cellParts[containingPartIndex - 1]!)
    : null;
  const headerName = labelCell
    ? exactCompoundHeaderComponent(labelCell, located)
      ?? specificOptionLabel(labelCell.value, allowHallAddOnHeader)
    : null;
  const genericPriceHeader = Boolean(
    labelCell
    && /^(?:기본\s*)?(?:가격|금액)$/u.test(cleanCellValue(labelCell.value)),
  );
  const rowDescriptor = evidence.cells
    .filter((cell) => (
      cell.sourceFileId === located.cell.sourceFileId
      && cell.sheet === located.cell.sheet
      && cell.row === located.cell.row
      && cell.column < located.cell.column
      && located.cell.column - cell.column <= 8
      && !recordEvidence.some((support) => cellKey(support) === cellKey(cell))
      && (
        genericPriceHeader
          ? exactBoundedRowDescriptorLabel(
              cell.value,
              allowExactSameDayCancellationFee,
            )
          : specificOptionLabel(
              cell.value,
              false,
              allowExactSameDayCancellationFee,
            )
      ) !== null
    ))
    .sort((left, right) => right.column - left.column)[0] ?? null;
  const rowDescriptorLabel = rowDescriptor
    ? genericPriceHeader
      ? exactBoundedRowDescriptorLabel(
          rowDescriptor.value,
          allowExactSameDayCancellationFee,
        )
      : specificOptionLabel(
          rowDescriptor.value,
          false,
          allowExactSameDayCancellationFee,
        )
        ? {
            name: specificOptionLabel(
              rowDescriptor.value,
              false,
              allowExactSameDayCancellationFee,
            )!,
            evidenceText: rowDescriptor.value,
          }
        : null
    : null;
  const rowDescriptorName = rowDescriptorLabel?.name ?? null;
  const recordRowDescriptor = recordEvidence.slice(1)
    .filter((support) => (
      support.sourceFileId === located.cell.sourceFileId
      && support.sheet === located.cell.sheet
      && support.row === located.cell.row
      && support.column < located.cell.column
      && specificOptionLabel(support.value) !== null
    ))
    .sort((left, right) => right.column - left.column)[0] ?? null;
  const recordRowDescriptorName = recordRowDescriptor
    ? specificOptionLabel(recordRowDescriptor.value)
    : null;
  const contextualVariant = inlineName && /^(?:여|남|여자|남자|여성|남성|\d+\s*(?:벌|회|장|컷|인|P))$/iu.test(inlineName)
    ? precedingSegment ?? headerName ?? rowDescriptorName ?? recordRowDescriptorName
    : null;
  const precedingPriceClauseContext = exactPrecedingPriceClauseContext(located);
  type OptionLabelCandidate = { name: string; evidence: WorkbookCell[] };
  const inlineCandidate: OptionLabelCandidate | null = inlineName
    ? { name: inlineName, evidence: [] }
    : null;
  const inlineSuffixCandidate: OptionLabelCandidate | null = inlineSuffix
    ? { name: inlineSuffix, evidence: [] }
    : null;
  const precedingCandidate: OptionLabelCandidate | null = precedingSegment
    ? {
        name: precedingSegment,
        evidence: [{ ...located.cell, value: cellParts[containingPartIndex - 1]! }],
      }
    : null;
  const headerCandidate: OptionLabelCandidate | null = headerName && labelCell
    ? { name: headerName, evidence: [labelCell] }
    : null;
  const rowDescriptorCandidate: OptionLabelCandidate | null = rowDescriptorName && rowDescriptor
    ? {
        name: rowDescriptorName,
        evidence: [{
          ...rowDescriptor,
          value: rowDescriptorLabel?.evidenceText ?? rowDescriptor.value,
        }],
      }
    : null;
  const recordRowDescriptorCandidate: OptionLabelCandidate | null = (
    recordRowDescriptorName && recordRowDescriptor
  )
    ? { name: recordRowDescriptorName, evidence: [recordRowDescriptor] }
    : null;
  const inferredCandidate = inlineCandidate
    ?? inlineSuffixCandidate
    ?? precedingCandidate
    ?? (genericPriceHeader ? rowDescriptorCandidate : headerCandidate)
    ?? headerCandidate
    ?? rowDescriptorCandidate
    ?? recordRowDescriptorCandidate;
  const selectedLabel = preferLabelCell && headerCandidate
    ? headerCandidate
    : inferredCandidate;
  if (!selectedLabel) return null;
  const { name } = selectedLabel;
  const peerAmounts = orderedPeers.map((entry) => entry.occurrence.krw);
  const singlePeer = orderedPeers.length === 1;
  const openRangeClause = singlePeer
    ? segment.split(/\s*(?:\/|\||;)\s*/u).find((clause) => (
        scanSourceMoneyOccurrences(clause).some((occurrence) => (
          occurrence.raw === located.occurrence.raw
          && occurrence.krw === located.occurrence.krw
        ))
      )) ?? segment
    : segment;
  const occurrenceIndexInClause = openRangeClause.indexOf(located.occurrence.raw);
  const openLowerBound = singlePeer
    && occurrenceIndexInClause >= 0
    && /[~～〜–—]\s*$/u.test(openRangeClause.slice(0, occurrenceIndexInClause));
  const openUpperBound = singlePeer
    && occurrenceIndexInClause >= 0
    && /^\s*[~～〜–—]/u.test(
      openRangeClause.slice(occurrenceIndexInClause + located.occurrence.raw.length),
    );
  const valueEvidence = {
    ...located.cell,
    value: precedingPriceClauseContext?.evidenceText ?? segment,
  };
  const unitEvidence = unitEvidenceForOccurrence(evidence, located, labelCell);
  const contextualVariantEvidence = contextualVariant === null
    ? []
    : [
        precedingCandidate,
        headerCandidate,
        rowDescriptorCandidate,
        recordRowDescriptorCandidate,
      ].find((candidate) => candidate?.name === contextualVariant)?.evidence ?? [];
  const supportingEvidence = [
    ...recordEvidence,
    ...selectedLabel.evidence,
    ...contextualVariantEvidence,
    ...unitEvidence,
  ];
  const sourceQuote = supportingEvidence.length > 0
    ? mergedQuote([...supportingEvidence, valueEvidence], 1_000)
      ?? shortCellQuote(located.cell, segment, 1_000)
    : shortCellQuote(located.cell, segment, 1_000);
  return {
    name,
    price_min_krw: openLowerBound ? null : Math.min(...peerAmounts),
    price_max_krw: openUpperBound ? null : Math.max(...peerAmounts),
    unit: null,
    condition: contextualVariant ?? precedingPriceClauseContext?.label ?? null,
    raw_text: segment,
    source_quote: sourceQuote,
    source_file_ids: [located.cell.sourceFileId],
  };
}

function cellKey(cell: WorkbookCell): string {
  return `${cell.sourceFileId}\0${cell.sheet}\0${cell.address}`;
}

function headerForVendorColumn(
  evidence: WorkbookEvidence,
  anchor: Pick<VendorAnchor, "cell" | "header" | "headerEndRow">,
  target: WorkbookCell,
): WorkbookCell | null {
  return evidence.cells
    .filter((cell) =>
      cell.sourceFileId === target.sourceFileId
      && cell.sheet === target.sheet
      && cell.row >= anchor.header.row
      && cell.row <= anchor.headerEndRow
      && mergeCoveringColumn(evidence, cell, target.column)
    )
    .sort((left, right) => right.row - left.row || right.column - left.column)[0] ?? null;
}

function isExactBasePriceHeader(cell: WorkbookCell | null): boolean {
  return Boolean(cell && /^기본\s*(?:가격|금액)$/u.test(cleanCellValue(cell.value)));
}

function isCorePackageVariantDescriptor(value: string): boolean {
  const normalized = cleanCellValue(value);
  return normalized.length > 0 && !PACKAGE_OPTION_DESCRIPTOR_PATTERN.test(normalized);
}

function pricingBasisSupportForCell(
  evidence: WorkbookEvidence,
  target: WorkbookCell,
): WorkbookCell[] {
  const sameSheet = evidence.cells.filter((cell) => (
    cell.sourceFileId === target.sourceFileId
    && cell.sheet === target.sheet
  ));
  const descriptor = sameSheet
    .filter((cell) => (
      cell.row === target.row
      && cell.column < target.column
      && cleanCellValue(cell.value).length > 0
      && cleanCellValue(cell.value).length <= 300
      && !POLICY_PATTERN.test(cell.value)
      && scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0
    ))
    .sort((left, right) => right.column - left.column)[0];
  const header = sameSheet
    .filter((cell) => (
      cellKey(cell) !== cellKey(target)
      && cell.row <= target.row
      && isPricingBasisCell(cell)
      && scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0
      && (
        mergeCoveringColumn(evidence, cell, target.column)
        || (cell.row === target.row && cell.column < target.column)
        || target.row - cell.row <= 20
      )
    ))
    .sort((left, right) => {
      const leftCovers = mergeCoveringColumn(evidence, left, target.column) ? 1 : 0;
      const rightCovers = mergeCoveringColumn(evidence, right, target.column) ? 1 : 0;
      return rightCovers - leftCovers
        || Number(right.row === target.row) - Number(left.row === target.row)
        || right.row - left.row
        || Math.abs(left.column - target.column) - Math.abs(right.column - target.column);
    })[0];
  if (!header) return descriptor && isPaymentAmountRoleCell(descriptor) ? [descriptor] : [];
  const unitDeclaration = sameSheet
    .filter((cell) => (
      cellKey(cell) !== cellKey(target)
      && cellKey(cell) !== cellKey(header)
      && cell.row <= target.row
      && target.row - cell.row <= 20
      && DECLARED_MONEY_UNIT_PATTERN.test(cleanCellValue(cell.value))
      && scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0
    ))
    .sort((left, right) => {
      const leftCovers = mergeCoveringColumn(evidence, left, target.column) ? 1 : 0;
      const rightCovers = mergeCoveringColumn(evidence, right, target.column) ? 1 : 0;
      return rightCovers - leftCovers
        || right.row - left.row
        || Math.abs(left.column - target.column) - Math.abs(right.column - target.column);
    })[0];
  return [
    ...(unitDeclaration ? [unitDeclaration] : []),
    header,
    ...(descriptor && cellKey(descriptor) !== cellKey(header) ? [descriptor] : []),
  ];
}

function vendorPolicyType(
  value: string,
): StrictDisclosureExtraction["partner_vendors"][number]["policies"][number]["policy_type"] {
  if (/(?:위약|취소|해지|해약)/u.test(value)) return "penalty";
  if (/(?:환불|환급)/u.test(value)) return "refund";
  if (/변경/u.test(value)) return "change";
  return "other";
}

function lineNumberFromLocator(locator: string): number | null {
  const match = /^line:(\d+)$/u.exec(locator);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function lineHasMoney(line: PlainTextLine): boolean {
  return scanSourceMoneyOccurrences(line.value).length > 0;
}

function plainLineVendorAnchors(lines: PlainTextLine[]): PlainLineVendorAnchor[] {
  const candidates = new Map<number, Omit<PlainLineVendorAnchor, "endLine">>();
  const claimedCategoryMarkers = new Set<number>();
  const categoryMarkers = lines.flatMap((line, index) => {
    const category = exactCategoryFromText(line.value);
    return category ? [{ line, index, category }] : [];
  });
  const nextMoneyIsNear = (index: number): boolean => lines
    .slice(index + 1, index + 4)
    .some((line) => lineHasMoney(line) && !POLICY_PATTERN.test(line.value));

  // Common DOCX tables flatten as: vendor name -> category label -> price.
  for (const marker of categoryMarkers) {
    const previous = lines[marker.index - 1];
    if (!previous || !isPlainLineVendorCandidate(previous) || !nextMoneyIsNear(marker.index)) {
      continue;
    }
    candidates.set(previous.number, {
      sourceFileId: previous.sourceFileId,
      category: marker.category,
      categoryLine: marker.line,
      vendorLine: previous,
    });
    claimedCategoryMarkers.add(marker.line.number);
  }

  // Some tables print the category once, followed by the first vendor and its
  // price. Keep the window deliberately narrow so prose and option labels do
  // not become vendor identities.
  for (const marker of categoryMarkers) {
    if (claimedCategoryMarkers.has(marker.line.number)) continue;
    const window = lines.slice(marker.index + 1, marker.index + 5);
    const vendorOffset = window.findIndex(isPlainLineVendorCandidate);
    if (vendorOffset < 0) continue;
    const vendorIndex = marker.index + 1 + vendorOffset;
    const vendorLine = lines[vendorIndex]!;
    const intervening = lines.slice(marker.index + 1, vendorIndex);
    if (intervening.some((line) => {
      const category = exactCategoryFromText(line.value);
      return category !== null && category !== marker.category;
    })) continue;
    if (!lines
      .slice(vendorIndex + 1, vendorIndex + 5)
      .some((line) => lineHasMoney(line) && !POLICY_PATTERN.test(line.value))) continue;
    if (!candidates.has(vendorLine.number)) {
      const repeatedCategory = lines
        .slice(vendorIndex + 1, vendorIndex + 4)
        .find((line) => exactCategoryFromText(line.value) === marker.category);
      candidates.set(vendorLine.number, {
        sourceFileId: vendorLine.sourceFileId,
        category: marker.category,
        categoryLine: repeatedCategory ?? marker.line,
        vendorLine,
      });
    }
  }

  const ordered = [...candidates.values()].sort((left, right) => (
    left.vendorLine.number - right.vendorLine.number
  ));
  return ordered.map((anchor, index) => {
    const nextVendorLine = ordered[index + 1]?.vendorLine.number ?? Number.POSITIVE_INFINITY;
    const nextDifferentCategory = lines.find((line) => (
      line.number > anchor.vendorLine.number
      && exactCategoryFromText(line.value) !== null
      && exactCategoryFromText(line.value) !== anchor.category
    ))?.number ?? Number.POSITIVE_INFINITY;
    const policyBoundaryLine = lines.find((line) => (
      line.number > anchor.vendorLine.number && POLICY_PATTERN.test(line.value)
    ))?.number ?? Number.POSITIVE_INFINITY;
    return {
      ...anchor,
      endLine: Math.min(nextVendorLine, nextDifferentCategory, policyBoundaryLine) - 1,
    };
  });
}

function plainLineAgencyExtraction(
  sources: LocalTextEvidence[],
): {
  partnerVendors: StrictDisclosureExtraction["partner_vendors"];
  sections: NonNullable<DisclosureExtraction["sections"]>;
  quarantinedMoney: number;
} {
  const partnerVendors: StrictDisclosureExtraction["partner_vendors"] = [];
  const sections: NonNullable<DisclosureExtraction["sections"]> = [];
  let quarantinedMoney = 0;
  for (const source of sources) {
    const lines = plainTextLines(source);
    const lineByNumber = new Map(lines.map((line) => [line.number, line]));
    const scannedOccurrences = scanSourceMoneyOccurrences(source.text);
    const occurrences = scannedOccurrences.filter((occurrence) => (
      !sourceMoneyRequiresStructuredQuarantine(occurrence)
    ));
    quarantinedMoney += scannedOccurrences.length - occurrences.length;
    const plainAnchors = plainLineVendorAnchors(lines);
    for (const anchor of plainAnchors) {
      const options = occurrences.flatMap((occurrence) => {
        const lineNumber = lineNumberFromLocator(occurrence.source_locator);
        const line = lineNumber === null ? null : lineByNumber.get(lineNumber);
        if (
          !line
          || line.number <= anchor.vendorLine.number
          || line.number > anchor.endLine
          || POLICY_PATTERN.test(line.value)
        ) return [];
        const name = line.value.length <= 300 ? line.value : occurrence.raw;
        const occurrenceOffset = line.value.indexOf(occurrence.raw);
        const trailingText = occurrenceOffset < 0
          ? ""
          : line.value.slice(occurrenceOffset + occurrence.raw.length);
        const openEndedMinimum = /^\s*[~～]/u.test(trailingText)
          && scanSourceMoneyOccurrences(trailingText).length === 0;
        return [{
          name,
          price_min_krw: occurrence.krw,
          price_max_krw: openEndedMinimum ? null : occurrence.krw,
          unit: null,
          condition: openEndedMinimum ? line.value : null,
          raw_text: occurrence.raw,
          source_quote: mergedLineQuote([
            anchor.categoryLine,
            anchor.vendorLine,
            line,
          ], 1_000) ?? shortLineQuote(line, 1_000),
          source_file_ids: [source.sourceFileId],
        }];
      }).slice(0, 100);
      if (options.length === 0) continue;
      partnerVendors.push({
        vendor_name: anchor.vendorLine.value,
        old_names: [],
        category: anchor.category,
        price_min_krw: null,
        price_max_krw: null,
        base_spec: null,
        price_note: null,
        options,
        policies: [],
        source_quote: mergedLineQuote([
          anchor.categoryLine,
          anchor.vendorLine,
        ], 1_000) ?? shortLineQuote(anchor.vendorLine, 1_000),
        source_file_ids: [source.sourceFileId],
        confidence: 0.4,
        needs_review: true,
      });
    }

    // OCR can flatten a single-vendor price sheet into column-first reading
    // order (all labels, then all values), placing the brand after the prices.
    // Recover only the narrow, review-only case where the source itself has
    // exactly one category and an explicit all-caps Latin brand line.
    if (plainAnchors.length === 0) {
      const categoryLines = lines.flatMap((line) => {
        const category = explicitPlainCategoryFromText(line.value);
        return category ? [{ line, category }] : [];
      });
      const categories = [...new Set(categoryLines.map((entry) => entry.category))];
      const brandLines = lines
        .filter((line) => (
          /^[A-Z][A-Z\s&.'-]{2,60}$/u.test(line.value)
          && !/(?:OCR|REVIEW|ONLY|WINDOWS|MEDIA)/u.test(line.value)
          && isPlainLineVendorCandidate(line)
        ))
        .sort((left, right) => right.value.length - left.value.length || left.number - right.number);
      const categoryLine = categoryLines[0]?.line;
      const vendorLine = brandLines[0];
      if (categories.length === 1 && categoryLine && vendorLine) {
        const options = occurrences.flatMap((occurrence) => {
          if (POLICY_PATTERN.test(occurrence.line_context)) return [];
          const lineNumber = lineNumberFromLocator(occurrence.source_locator);
          const line = lineNumber === null ? null : lineByNumber.get(lineNumber);
          if (!line) return [];
          return [{
            name: occurrence.raw,
            price_min_krw: occurrence.krw,
            price_max_krw: occurrence.krw,
            unit: null,
            condition: null,
            raw_text: occurrence.raw,
            source_quote: mergedLineQuote([categoryLine, vendorLine, line], 1_000)
              ?? shortLineQuote(line, 1_000),
            source_file_ids: [source.sourceFileId],
          }];
        }).slice(0, 100);
        if (options.length > 0) {
          partnerVendors.push({
            vendor_name: vendorLine.value,
            old_names: [],
            category: categories[0]!,
            price_min_krw: null,
            price_max_krw: null,
            base_spec: null,
            price_note: null,
            options,
            policies: [],
            source_quote: mergedLineQuote([categoryLine, vendorLine], 1_000)
              ?? shortLineQuote(vendorLine, 1_000),
            source_file_ids: [source.sourceFileId],
            confidence: 0.3,
            needs_review: true,
          });
        }
      }
    }

    for (const line of lines) {
      const pricingBasis = !POLICY_PATTERN.test(line.value)
        && (PRICING_BASIS_HEADING_PATTERN.test(line.value)
          || CATEGORY_PRICING_BASIS_HEADING_PATTERN.test(line.value)
          || (scanSourceMoneyOccurrences(line.value).length === 0
            && PRICING_BASIS_NOTE_PATTERN.test(line.value)));
      if (!pricingBasis && !POLICY_PATTERN.test(line.value)) continue;
      sections.push({
        section_type: policySectionType(line.value),
        title: line.value.slice(0, 300),
        content_verbatim: line.value.slice(0, 20_000),
        summary: line.value.slice(0, 1_000),
        source_quote: shortLineQuote(line, 2_000),
        source_file_ids: [source.sourceFileId],
        confidence: 0.4,
        needs_review: true,
      });
    }
  }
  return { partnerVendors, sections, quarantinedMoney };
}

function blankHall(): DisclosureExtraction["hall"] {
  return {
    venue_fee_krw: null,
    meal_price_min_krw: null,
    meal_price_max_krw: null,
    venue_fee_source_quote: null,
    meal_price_source_quote: null,
    venue_fee_source_file_ids: [],
    meal_price_source_file_ids: [],
    items: [],
    confidence: 0,
    needs_review: true,
  };
}

type HallPriceKind =
  | "meal"
  | "venue"
  | "decoration"
  | "option"
  | "combined"
  | "ambiguous";

interface HallColumnContext {
  exactHeader: WorkbookCell | null;
  fallbackHeader: WorkbookCell | null;
  rowQualifier: WorkbookCell | null;
}

function explicitNoVenueDecoration(value: string): string | null {
  const normalized = cleanCellValue(value);
  const venueAbsent = normalized.match(
    /(?:대관(?:비|료)?|홀\s*사용료|장소\s*사용료)\s*(?:없음|무료|0\s*원)/u,
  );
  const decorationOnly = venueAbsent
    ? normalized.replace(venueAbsent[0], " ").trim()
    : "";
  const decorationAmounts = scanSourceMoneyOccurrences(decorationOnly);
  if (
    !venueAbsent
    || decorationAmounts.length < 1
    || decorationAmounts.length > 2
    || !/(?:장식비|(?:생화|꽃|플라워)\s*(?:장식|데코))\s*[^\d]{0,30}[\d,]+\s*(?:원|만원|천원)/u.test(decorationOnly)
    || /(?:대관(?:비|료)?|홀\s*사용료|장소\s*사용료|(?<!장)식\s*비|식대|메뉴|뷔페|코스|촬영|폐백|음료)/u.test(decorationOnly)
  ) return null;
  return venueAbsent[0];
}

function explicitVenueNoDecoration(value: string): string | null {
  const normalized = cleanCellValue(value);
  const decorationAbsent = normalized.match(
    /(?:장식비|(?:생화|꽃|플라워)\s*(?:장식|데코))\s*(?:없음|무료|0\s*원)/u,
  );
  const venueOnly = decorationAbsent
    ? normalized.replace(decorationAbsent[0], " ").trim()
    : "";
  const venueAmounts = scanSourceMoneyOccurrences(venueOnly);
  if (
    !decorationAbsent
    || venueAmounts.length < 1
    || venueAmounts.length > 2
    || !/(?:대관(?:비|료)?|홀\s*사용료|장소\s*사용료)\s*[^\d]{0,30}[\d,]+\s*(?:원|만원|천원)/u.test(venueOnly)
    || /(?:장식비|(?:생화|꽃|플라워)\s*(?:장식|데코)|(?<!장)식\s*비|식대|메뉴|뷔페|코스|촬영|폐백|음료)/u.test(venueOnly)
  ) return null;
  return decorationAbsent[0];
}

function isOpenEndedMoneyEntry(entry: LocatedMoney): boolean {
  const segment = occurrenceSegment(entry).text;
  return scanSourceMoneyOccurrences(segment).length === 1
    && /[~～〜–—]\s*$/u.test(segment);
}

function ambiguousHallFeeLabel(value: string): boolean {
  const normalized = cleanCellValue(value);
  const mentionsVenue = /(?:대관|홀\s*사용|장소)/u.test(normalized);
  const mentionsDecoration = /(?:장식|생화|꽃)/u.test(normalized);
  const compositeBase = /기본\s*비용/u.test(normalized)
    && mentionsVenue
    && /(?:진행|혼구|원판|촬영|연출)/u.test(normalized);
  return (mentionsVenue && mentionsDecoration) || compositeBase;
}

function ambiguousMealVariantLabel(value: string): boolean {
  const normalized = cleanCellValue(value);
  return /(?:대인|성인)/u.test(normalized)
    && /(?:소인|아동|어린이)/u.test(normalized);
}

const EXPLICIT_HALL_IDENTITY_PATTERN = /^(?=.*(?:웨딩\s*홀|홀|ballroom|볼룸|(?:오키드|그랜드|아셈)\s*룸)(?:\s*\([^)]*\))?\s*$)[\p{L}\p{N}][\p{L}\p{N}\s&·.,'’()\/-]{1,119}$/iu;
const HALL_IDENTITY_SERVICE_EXCLUSION_PATTERN = /(?:현장\s*중계|스크린\s*중계|중계용|LED\s*gate|사용료|대관료|장식비|촬영비)/iu;

function isExplicitHallIdentityText(value: string): boolean {
  const normalized = cleanCellValue(value);
  return normalized.length >= 2
    && normalized.length <= 120
    && !PLACEHOLDER_HALL_PATTERN.test(normalized)
    && !HALL_IDENTITY_SERVICE_EXCLUSION_PATTERN.test(normalized)
    && scanSourceMoneyOccurrences(normalized).length === 0
    && EXPLICIT_HALL_IDENTITY_PATTERN.test(normalized);
}

function explicitHallPriceLabelKind(
  value: string,
): Exclude<HallPriceKind, "option"> | null {
  const normalized = cleanCellValue(value);
  if (ambiguousHallFeeLabel(normalized)) return "combined";
  if (ambiguousMealVariantLabel(normalized)) return "ambiguous";
  const matches: Array<"meal" | "venue" | "decoration"> = [];
  if (/(?:대관료|대관\s*(?:비|금액)?|홀\s*사용료|장소\s*사용료)/u.test(normalized)) {
    matches.push("venue");
  }
  if (/(?:장식비|(?:생화|꽃|플라워)\s*(?:장식|데코))/u.test(normalized)) {
    matches.push("decoration");
  }
  if (
    /(?:(?<!장)식비|식대|메뉴|뷔페|코스)/u.test(normalized)
    || /(?:^|[^\p{L}])식사(?:$|[^\p{L}])/u.test(normalized)
  ) matches.push("meal");
  const distinct = [...new Set(matches)];
  return distinct.length === 1 ? distinct[0]! : null;
}

function isIncrementalGuestQualifier(value: string): boolean {
  return /추가\s*(?:1\s*)?(?:명|인)\s*당/u.test(cleanCellValue(value));
}

function isExactHallPriceVariant(entry: LocatedMoney): boolean {
  const fragment = occurrenceSegment(entry).text;
  if (!exactLabelPriceFragment(fragment)) return false;
  const occurrence = scanSourceMoneyOccurrences(fragment)[0];
  if (!occurrence) return false;
  const occurrenceIndex = fragment.indexOf(occurrence.raw);
  if (occurrenceIndex <= 0) return false;
  const label = cleanCellValue(fragment.slice(0, occurrenceIndex))
    .replace(/^[\s●•▶▷▪◦·:：\-–—]+|[\s●•▶▷▪◦·:：\-–—]+$/gu, "")
    .trim();
  return /^(?:대인|소인|성인|아동|어린이|성수기|비수기|(?:20)?\d{2}년(?:도)?)(?:\s*(?:기준|식대|식비|식사|뷔페|메뉴))?$/u.test(label);
}

function hallPriceKind(context: HallColumnContext, targetValue = ""): HallPriceKind {
  const exactHeader = cleanCellValue(context.exactHeader?.value ?? "");
  const fallbackHeader = cleanCellValue(context.fallbackHeader?.value ?? "");
  const rowQualifier = cleanCellValue(context.rowQualifier?.value ?? "");
  const target = cleanCellValue(targetValue);
  // A real same-column subheader is authoritative over descriptors elsewhere
  // in the row. In particular `장식 추가` is an add-on column, never the
  // venue's aggregate decoration fee.
  if (/^장식\s*추가$/u.test(exactHeader)) return "option";
  // A cell such as "대관비 없음 / 장식비 20,000,000원" is not an
  // ambiguous combined fee: it explicitly states a zero/absent venue fee and
  // independently labels the only amount as decoration.
  if (explicitNoVenueDecoration(target)) return "decoration";
  // The inverse explicit form is equally unambiguous: the one amount is the
  // venue fee and the decoration component is explicitly absent.
  if (explicitVenueNoDecoration(target)) return "venue";

  // A physically adjacent row qualifier is the only safe way to split a
  // merged `대관료, 장식비` parent column. It also keeps `추가 1명당` as a
  // separate option instead of silently widening the base meal range.
  if (rowQualifier) {
    if (isIncrementalGuestQualifier(rowQualifier)) return "option";
    const rowKind = explicitHallPriceLabelKind(rowQualifier);
    if (rowKind) return rowKind;
  }

  // Without adjacent topology, preserve a combined column only as an exact
  // combined-fee option. It must never populate either legacy aggregate.
  if (
    ambiguousHallFeeLabel(exactHeader)
    || ambiguousHallFeeLabel(fallbackHeader)
  ) return "combined";
  const targetKind = explicitHallPriceLabelKind(target);
  if (targetKind) return targetKind;
  const exactKind = explicitHallPriceLabelKind(exactHeader);
  if (exactKind) return exactKind;
  // Other-column fallback is deliberately last: it may help old unmerged
  // exports, but must never override an exact column header or row qualifier.
  const fallbackKind = explicitHallPriceLabelKind(fallbackHeader);
  if (fallbackKind) return fallbackKind;
  return "option";
}

function minMax(values: number[]): { minimum: number | null; maximum: number | null } {
  return values.length === 0
    ? { minimum: null, maximum: null }
    : { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function hallColumnContext(
  evidence: WorkbookEvidence,
  hallHeader: WorkbookCell,
  hallRow: number,
  target: WorkbookCell,
  hallAnchor: WorkbookCell,
): HallColumnContext {
  const headerEndRow = Math.min(
    hallRow - 1,
    mergeForAnchor(evidence, hallHeader)?.endRow ?? (hallHeader.row + 1),
  );
  const candidates = evidence.cells
    .filter((cell) =>
      cell.sourceFileId === target.sourceFileId
      && cell.sheet === target.sheet
      && cell.row >= hallHeader.row
      && cell.row <= headerEndRow
      && mergeCoveringColumn(evidence, cell, target.column)
    )
    .sort((left, right) => right.row - left.row || right.column - left.column);
  const exactHeader = candidates[0] ?? null;
  const fallbackHeader = exactHeader ? null : evidence.cells
    .filter((cell) =>
      cell.sourceFileId === target.sourceFileId
      && cell.sheet === target.sheet
      && cell.row >= hallHeader.row
      && cell.row <= headerEndRow
      && cell.column < target.column
      && target.column - cell.column <= 1
    )
    .sort((left, right) => right.row - left.row || right.column - left.column)[0] ?? null;
  const rowQualifier = evidence.cells
    .filter((cell) => {
      if (
        cell.sourceFileId !== target.sourceFileId
        || cell.sheet !== target.sheet
        || cell.row !== target.row
        || cell.column >= target.column
        || cellKey(cell) === cellKey(hallAnchor)
        || scanSourceMoneyOccurrences(cleanCellValue(cell.value)).length > 0
      ) return false;
      const merge = mergeContainingCell(evidence, cell);
      const rightEdge = merge?.endColumn ?? cell.column;
      return rightEdge === target.column - 1;
    })
    .sort((left, right) => right.column - left.column)[0] ?? null;
  return { exactHeader, fallbackHeader, rowQualifier };
}

function headerForHallColumn(context: HallColumnContext): WorkbookCell | null {
  return context.exactHeader ?? context.fallbackHeader;
}

function bindingLabelForHallColumn(
  context: HallColumnContext,
  kind: HallPriceKind,
): WorkbookCell | null {
  const rowValue = context.rowQualifier?.value ?? "";
  const rowKind = explicitHallPriceLabelKind(rowValue);
  if (
    context.rowQualifier
    && (
      (kind === "option" && isIncrementalGuestQualifier(rowValue))
      || rowKind === kind
    )
  ) return context.rowQualifier;
  return headerForHallColumn(context);
}

function exactHallGuaranteeValue(value: string): number | null {
  const normalized = cleanCellValue(value);
  const match = /^(?:최소\s*보증인원\s*[:：]?\s*([\d,]+)\s*명|기본\s*[:：]?\s*([\d,]+)\s*명|보증인원\s*[:：]?\s*([\d,]+)\s*명\s*부터)$/u.exec(normalized);
  const raw = match?.slice(1).find((candidate) => candidate !== undefined);
  if (!raw) return null;
  const guarantee = Number.parseInt(raw.replace(/,/gu, ""), 10);
  return Number.isSafeInteger(guarantee) && guarantee > 0 ? guarantee : null;
}

function localHalls(
  evidence: WorkbookEvidence,
  locatedMoney: LocatedMoney[],
): {
  halls: LocalHall[];
  linkedLocators: Set<string>;
  overflow: number;
  semanticQuarantine: number;
} {
  const halls: LocalHall[] = [];
  const linkedLocators = new Set<string>();
  let overflow = 0;
  let semanticQuarantine = 0;
  const headers = evidence.cells
    .filter((cell) => HALL_HEADER_PATTERN.test(cleanCellValue(cell.value)))
    .sort((left, right) => left.sheet.localeCompare(right.sheet, "ko") || left.row - right.row);
  for (const header of headers) {
    const sheetCells = evidence.cells.filter((cell) =>
      cell.sourceFileId === header.sourceFileId && cell.sheet === header.sheet
    );
    const boundary = policyBoundary(sheetCells, header);
    const anchors = sheetCells
      .filter((cell) =>
        cell.column === header.column
        && cell.row > header.row
        && cell.row < boundary
        && isVendorAnchorCandidate(cell)
      )
      .sort((left, right) => left.row - right.row);
    for (const [index, anchor] of anchors.entries()) {
      const merge = mergeForAnchor(evidence, anchor);
      const endRow = Math.min(
        Number.isFinite(boundary) ? boundary - 1 : Number.MAX_SAFE_INTEGER,
        merge?.endRow ?? ((anchors[index + 1]?.row ?? (anchor.row + 1)) - 1),
      );
      const occurrences = locatedMoney.filter((entry) =>
        entry.cell.sourceFileId === anchor.sourceFileId
        && entry.cell.sheet === anchor.sheet
        && entry.cell.row >= anchor.row
        && entry.cell.row <= endRow
        && entry.cell.column > anchor.column
        && !POLICY_PATTERN.test(entry.occurrence.line_context)
      );
      const guaranteeCell = sheetCells.find((cell) => {
        if (cell.row < anchor.row || cell.row > endRow) return false;
        const normalized = cleanCellValue(cell.value);
        if (exactHallGuaranteeValue(normalized) !== null) return true;
        if (!/^[\d,]+\s*명$/u.test(normalized)) return false;
        const context = hallColumnContext(evidence, header, anchor.row, cell, anchor);
        return cleanCellValue(context.exactHeader?.value ?? "").replace(/\s+/gu, "") === "최소보증인원";
      }) ?? null;
      const hallName = cleanCellValue(anchor.value);
      const explicitHallIdentity = isExplicitHallIdentityText(hallName);
      if (occurrences.length === 0 && !explicitHallIdentity) continue;
      const guaranteeValue = guaranteeCell
        ? exactHallGuaranteeValue(guaranteeCell.value)
          ?? Number.parseInt(cleanCellValue(guaranteeCell.value).replace(/[^\d]/gu, ""), 10)
        : null;
      const hall: LocalHall = {
        hall_name: hallName.slice(0, 300),
        guarantee_min: guaranteeValue !== null && Number.isSafeInteger(guaranteeValue)
          ? guaranteeValue
          : null,
        meal_price_min_krw: null,
        meal_price_max_krw: null,
        venue_fee_min_krw: null,
        venue_fee_max_krw: null,
        venue_fee_note: null,
        decoration_fee_min_krw: null,
        decoration_fee_max_krw: null,
        decoration_note: null,
        options: [],
        source_quote: shortCellQuote(anchor, anchor.value, 2_000),
        source_file_ids: [anchor.sourceFileId],
        confidence: 0.45,
        needs_review: true,
      };
      const linkEntries = (entries: LocatedMoney[]): void => {
        for (const entry of entries) {
          linkedLocators.add(locatedMoneyLinkKey(entry));
        }
      };
      const fieldEvidence: WorkbookCell[] = [anchor, ...(guaranteeCell ? [guaranteeCell] : [])];
      const byKind: Record<"meal" | "venue" | "decoration", number[]> = {
        meal: [],
        venue: [],
        decoration: [],
      };
      const entriesByKind: Record<"meal" | "venue" | "decoration", LocatedMoney[]> = {
        meal: [],
        venue: [],
        decoration: [],
      };
      for (const entry of occurrences) {
        const entryLinkKey = locatedMoneyLinkKey(entry);
        if (linkedLocators.has(entryLinkKey)) continue;
        const columnContext = hallColumnContext(evidence, header, anchor.row, entry.cell, anchor);
        const kind = isExactHallPriceVariant(entry)
          ? "option"
          : hallPriceKind(columnContext, entry.cell.value);
        const columnLabel = bindingLabelForHallColumn(columnContext, kind);
        if (kind === "ambiguous") {
          semanticQuarantine += 1;
          continue;
        }
        if (kind === "option" || kind === "combined") {
          if (hall.options.length < 200) {
            const peers = optionRangePeers(occurrences, entry);
            const option = optionFromOccurrence(
              evidence,
              entry,
              columnLabel,
              [anchor],
              peers,
              true,
              kind === "combined",
            );
            if (option) {
              hall.options.push(option);
              linkEntries(peers);
            } else {
              semanticQuarantine += 1;
            }
          }
          else overflow += 1;
          continue;
        }
        linkEntries([entry]);
        if (kind === "decoration") {
          const venueAbsent = explicitNoVenueDecoration(entry.cell.value);
          if (venueAbsent) {
            hall.venue_fee_note = hall.venue_fee_note ?? venueAbsent;
            fieldEvidence.push(entry.cell);
          }
        }
        if (kind === "venue") {
          const decorationAbsent = explicitVenueNoDecoration(entry.cell.value);
          if (decorationAbsent) {
            hall.decoration_note = hall.decoration_note ?? decorationAbsent;
            fieldEvidence.push(entry.cell);
          }
        }
        byKind[kind].push(entry.occurrence.krw);
        entriesByKind[kind].push(entry);
      }
      const meal = minMax(byKind.meal);
      const venue = minMax(byKind.venue);
      const decoration = minMax(byKind.decoration);
      hall.meal_price_min_krw = meal.minimum;
      hall.meal_price_max_krw = meal.maximum;
      hall.venue_fee_min_krw = venue.minimum;
      hall.venue_fee_max_krw = venue.maximum;
      hall.decoration_fee_min_krw = decoration.minimum;
      hall.decoration_fee_max_krw = decoration.maximum;
      if (entriesByKind.meal.some(isOpenEndedMoneyEntry)) {
        hall.meal_price_max_krw = null;
      }
      if (entriesByKind.venue.some(isOpenEndedMoneyEntry)) {
        hall.venue_fee_max_krw = null;
      }
      if (entriesByKind.decoration.some(isOpenEndedMoneyEntry)) {
        hall.decoration_fee_max_krw = null;
      }
      const explicitUpperLimit = entriesByKind.decoration
        .map((entry) => cleanCellValue(entry.cell.value).match(/상한\s*(?:제한)?\s*없음/u)?.[0] ?? null)
        .find((value): value is string => value !== null);
      if (explicitUpperLimit) hall.decoration_note = explicitUpperLimit;
      for (const kind of ["meal", "venue", "decoration"] as const) {
        const range = minMax(byKind[kind]);
        const aggregateOwners = new Set<LocatedMoney>();
        for (const amount of new Set([range.minimum, range.maximum])) {
          if (amount === null) continue;
          const owner = entriesByKind[kind].find((entry) => entry.occurrence.krw === amount);
          if (owner) aggregateOwners.add(owner);
        }
        for (const entry of aggregateOwners) {
          fieldEvidence.push({ ...entry.cell, value: entry.occurrence.raw });
        }
        for (const entry of entriesByKind[kind]) {
          if (aggregateOwners.has(entry)) continue;
          const columnContext = hallColumnContext(evidence, header, anchor.row, entry.cell, anchor);
          const columnLabel = bindingLabelForHallColumn(columnContext, kind);
          if (hall.options.length < 200) {
            const peers = optionRangePeers(entriesByKind[kind], entry);
            const option = optionFromOccurrence(
              evidence,
              entry,
              columnLabel,
              [anchor],
              peers,
              true,
            );
            if (option) hall.options.push(option);
            else semanticQuarantine += 1;
          } else {
            overflow += 1;
          }
        }
      }

      const hallMode = /실내/u.test(anchor.value)
        ? "실내"
        : /야외/u.test(anchor.value) ? "야외" : null;
      if (hallMode) {
        const annexSheets = new Set(
          evidence.cells
            .filter((cell) =>
              cell.sourceFileId === anchor.sourceFileId
              && cell.sheet !== anchor.sheet
            )
            .map((cell) => cell.sheet)
            .filter((sheet) => {
              const identifyingText = [
                sheet,
                ...evidence.cells
                  .filter((cell) =>
                    cell.sourceFileId === anchor.sourceFileId
                    && cell.sheet === sheet
                    && cell.row <= 3
                  )
                  .map((cell) => cell.value),
              ].join(" ");
              return identifyingText.includes(hallMode);
            }),
        );
        const annexOccurrences = locatedMoney.filter((entry) =>
          entry.cell.sourceFileId === anchor.sourceFileId
          && annexSheets.has(entry.cell.sheet)
          && !POLICY_PATTERN.test(entry.occurrence.line_context)
        );
        for (const entry of annexOccurrences) {
          const entryLinkKey = locatedMoneyLinkKey(entry);
          if (linkedLocators.has(entryLinkKey)) continue;
          if (hall.options.length < 200) {
            const peers = optionRangePeers(annexOccurrences, entry);
            const option = optionFromOccurrence(evidence, entry, null, [anchor], peers);
            if (option) {
              hall.options.push(option);
              linkEntries(peers);
            } else {
              semanticQuarantine += 1;
            }
          } else overflow += 1;
        }
      }
      const aggregateEvidence = [...fieldEvidence];
      for (const kind of ["meal", "venue", "decoration"] as const) {
        const range = minMax(byKind[kind]);
        for (const amount of new Set([range.minimum, range.maximum])) {
          if (amount === null) continue;
          const owner = entriesByKind[kind].find((entry) => entry.occurrence.krw === amount);
          if (!owner) continue;
          const columnContext = hallColumnContext(evidence, header, anchor.row, owner.cell, anchor);
          const bindingLabel = bindingLabelForHallColumn(columnContext, kind);
          if (columnContext.exactHeader) aggregateEvidence.push(columnContext.exactHeader);
          if (columnContext.fallbackHeader) aggregateEvidence.push(columnContext.fallbackHeader);
          if (columnContext.rowQualifier) aggregateEvidence.push(columnContext.rowQualifier);
          aggregateEvidence.push(...unitEvidenceForOccurrence(evidence, owner, bindingLabel));
        }
      }
      hall.options = dedupeOptions(hall.options);
      hall.source_quote = mergedQuote(aggregateEvidence, 2_000) ?? hall.source_quote;
      halls.push(hall);
    }
  }
  return { halls, linkedLocators, overflow, semanticQuarantine };
}

function exactCanonicalDocxHallJoinKey(value: string): string {
  return cleanCellValue(value)
    .normalize("NFKC")
    .replace(/\s*\(단독홀\)\s*$/u, "")
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("ko");
}

function mergeExactCanonicalDocxHalls(
  evidence: WorkbookEvidence,
  halls: LocalHall[],
): LocalHall[] {
  const canonicalDocxSourceIds = new Set(evidence.cells.flatMap((cell) => (
    cell.canonicalDocx ? [cell.sourceFileId] : []
  )));
  const result: LocalHall[] = [];
  const byKey = new Map<string, LocalHall>();
  const scalarFields = [
    "guarantee_min",
    "meal_price_min_krw",
    "meal_price_max_krw",
    "venue_fee_min_krw",
    "venue_fee_max_krw",
    "venue_fee_note",
    "decoration_fee_min_krw",
    "decoration_fee_max_krw",
    "decoration_note",
  ] as const;
  for (const hall of halls) {
    if (
      typeof hall.hall_name !== "string"
      || !hall.source_file_ids.every((sourceFileId) => canonicalDocxSourceIds.has(sourceFileId))
    ) {
      result.push(hall);
      continue;
    }
    const key = exactCanonicalDocxHallJoinKey(hall.hall_name);
    const existing = byKey.get(key);
    if (!key || !existing) {
      result.push(hall);
      if (key) byKey.set(key, hall);
      continue;
    }
    const conflict = scalarFields.some((field) => (
      existing[field] !== null
      && hall[field] !== null
      && existing[field] !== hall[field]
    ));
    if (conflict) {
      result.push(hall);
      continue;
    }
    if (
      /\s*\(단독홀\)\s*$/u.test(existing.hall_name ?? "")
      && !/\s*\(단독홀\)\s*$/u.test(hall.hall_name)
    ) {
      existing.hall_name = hall.hall_name;
    }
    for (const field of scalarFields) {
      if (existing[field] === null && hall[field] !== null) {
        // The schema fields in this fixed list are all nullable scalars.
        Object.assign(existing, { [field]: hall[field] });
      }
    }
    existing.options = dedupeOptions([...existing.options, ...hall.options]);
    existing.source_file_ids = [...new Set([
      ...existing.source_file_ids,
      ...hall.source_file_ids,
    ])];
    existing.confidence = Math.min(existing.confidence, hall.confidence);
    existing.needs_review = existing.needs_review || hall.needs_review;
  }
  return result;
}

const PLAIN_HALL_TABLE_HEADER_PATTERN = /예식\s*홀명/u;
const PLAIN_HALL_MEAL_LABEL_PATTERN = /(?:(?<!장)식\s*비|식대|(?:뷔페|코스)\s*[A-Z가-힣0-9]*)/iu;
const PLAIN_HALL_MEAL_LABEL_GLOBAL_PATTERN = /(?:(?<!장)식\s*비|식대|(?:뷔페|코스)\s*[A-Z가-힣0-9]*)/giu;
const PLAIN_HALL_VENUE_LABEL_PATTERN = /(?:대관료|대관\s*(?:비|금액)?)/u;
const PLAIN_HALL_DECORATION_LABEL_PATTERN = /(?:장식비|(?:생화|꽃|플라워)\s*(?:장식|데코))/u;
const PLAIN_HALL_OPTION_EXCLUSION_PATTERN = /(?:예식\s*홀명|선택\s*품목\s*가격|환불\s*기준|위약금|취소\s*일자)/u;
const PLAIN_HALL_SAFE_OPTION_LABEL_PATTERN = /(?:사회자|촬영|스냅|DVD|부케|축포|뮤지컬|연주|축가|폐백|소인|케이(?:크|익)|샴페인|와인|맥주|소주|음료|국수|떡|플라워\s*샤워|도우미|헬퍼|객실|포토|무대|로드|원판)/iu;

function normalizedPlainIdentity(value: string): string {
  return cleanCellValue(value)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase("ko-KR");
}

function plainHallDisplayName(value: string): string {
  return cleanCellValue(value)
    .replace(/^[^\p{L}\p{N}]+/gu, "")
    .replace(/\s*\((?:단독홀|단독|연회장)\)\s*$/u, "")
    .replace(/\s*(?:기본|최소\s*보증|보증|개런티)\s*[\d,]+\s*명.*$/u, "")
    .trim();
}

function isPlainHallIdentityLine(line: PlainTextLine): boolean {
  const value = plainHallDisplayName(line.value);
  return isExplicitHallIdentityText(value)
    && !PUBLIC_CONTACT_PATTERN.test(line.value)
    && !POLICY_PATTERN.test(line.value)
    && !PLAIN_HALL_TABLE_HEADER_PATTERN.test(line.value)
    && !PLAIN_HALL_OPTION_EXCLUSION_PATTERN.test(line.value)
    && scanSourceMoneyOccurrences(line.value).length === 0;
}

interface PdfLayoutHallExtractionResult {
  halls: LocalHall[];
  sections: NonNullable<DisclosureExtraction["sections"]>;
  handledSourceIds: Set<string>;
  invalidSourceIds: Set<string>;
  quarantinedMoney: number;
}

interface PdfLayoutAgencyExtractionResult {
  partnerVendors: StrictDisclosureExtraction["partner_vendors"];
  sections: NonNullable<DisclosureExtraction["sections"]>;
  handledSourceIds: Set<string>;
  invalidSourceIds: Set<string>;
  quarantinedMoney: number;
}

function pdfProjectionQuote(
  projection: PdfLayoutMoneyProjection,
  maximum = 1_000,
): string {
  const prefix = `${projection.source_locator} [krw=${projection.krw}]: `;
  return `${prefix}${projection.line_context.slice(0, Math.max(1, maximum - prefix.length))}`;
}

function exactPdfProjectionOptionName(projection: PdfLayoutMoneyProjection): string {
  const exact = cleanCellValue(projection.header).replace(/\s*\/\s*.*/u, "").trim();
  return (exact || cleanCellValue(projection.header) || "가격").slice(0, 300);
}

function exactPdfHallOptionName(
  layout: CanonicalPdfLayoutEvidence,
  projection: PdfLayoutMoneyProjection,
): string {
  const header = exactPdfProjectionOptionName(projection);
  const genericHeader = /^(?:금|금액|기본가격|기타\s*옵션)$/u.test(header)
    || /(?:^|\s)제공\s*금액(?:\s|\(|$)/u.test(header)
    || /[\/·]/u.test(projection.header);
  if (!genericHeader) {
    return header;
  }
  const row = layout.rows.find((candidate) => (
    candidate.page === projection.page && candidate.row === projection.row
  ));
  const amount = row?.items.find((item) => item.column === projection.item);
  const nearest = row?.items
    .filter((item) => amount && item.x < amount.x)
    .sort((left, right) => right.x - left.x)
    .map((item) => normalizePdfLayoutItemText(item.text))
    .find((text) => (
      text.length >= 1
      && text.length <= 100
      && /\p{L}/u.test(text)
      && scanSourceMoneyOccurrences(text).length === 0
      && !/^(?:원|만원|명|인|회|번|벌|장|개|기본|추가|가격|금액|기타\s*옵션)$/u.test(text)
    ));
  return (nearest ?? header).slice(0, 300);
}

function pdfLayoutEvidenceFragments(
  sourceFileIdValue: string,
  quotes: Array<string | null | undefined>,
): Array<{ source_file_id: string; quote: string }> {
  const fragments: Array<{ source_file_id: string; quote: string }> = [];
  for (const quote of quotes) {
    if (!quote) continue;
    const decoded = decodeEvidenceQuote(quote);
    if (decoded.kind === "single") {
      fragments.push({ source_file_id: sourceFileIdValue, quote: decoded.quote });
    } else if (decoded.kind === "merged") {
      fragments.push(...decoded.fragments);
    }
  }
  const seen = new Set<string>();
  return fragments.filter((fragment) => {
    const key = `${fragment.source_file_id}\0${fragment.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pdfLayoutRowQuote(row: CanonicalPdfLayoutRow | null): string | null {
  return row?.line ? shortLineQuote(row.line, 900) : null;
}

function projectionUsesIsolatedMoneySlot(
  layout: CanonicalPdfLayoutEvidence,
  projection: PdfLayoutMoneyProjection,
): boolean {
  if (!projection.line_context.includes("만원") || projection.raw.includes(",")) return true;
  const row = layout.rows.find((candidate) => (
    candidate.page === projection.page && candidate.row === projection.row
  ));
  const item = row?.items.find((candidate) => candidate.column === projection.item);
  if (!item) return false;
  return /^\s*[([]?\s*[1-9]\d{0,3}\s*[)\]]?\s*$/u.test(
    normalizePdfLayoutItemText(item.text).normalize("NFKC"),
  );
}

function scannerAddedPdfProjectionLocators(source: LocalTextEvidence): Set<string> {
  return new Set(scanSourceMoneyOccurrences(source.text).flatMap((occurrence) => (
    occurrence.source_locator.startsWith("pdf:") ? [occurrence.source_locator] : []
  )));
}

function certifiedPdfProjectionGroups(
  layout: CanonicalPdfLayoutEvidence,
  projections: PdfLayoutMoneyProjection[],
): PdfLayoutMoneyProjection[][] {
  const groupsByPhysicalItem = new Map<string, PdfLayoutMoneyProjection[]>();
  for (const projection of projections) {
    const key = [
      projection.page,
      projection.row,
      projection.item,
      projection.header,
    ].join("\0");
    groupsByPhysicalItem.set(key, [
      ...(groupsByPhysicalItem.get(key) ?? []),
      projection,
    ]);
  }
  const result: PdfLayoutMoneyProjection[][] = [];
  for (const physicalItem of groupsByPhysicalItem.values()) {
    const ordered = [...physicalItem].sort((left, right) => (
      left.moneyOrdinal - right.moneyOrdinal
    ));
    const first = ordered[0]!;
    const item = layout.rows.find((row) => (
      row.page === first.page && row.row === first.row
    ))?.items.find((candidate) => candidate.column === first.item) ?? null;
    const itemText = normalizePdfLayoutItemText(item?.text ?? "").normalize("NFKC");
    const exactTwoValueRange = ordered.length === 2
      && ordered[0]!.moneyOrdinal + 1 === ordered[1]!.moneyOrdinal
      && /(?:~|～|〜|–|—)/u.test(itemText);
    if (exactTwoValueRange) {
      result.push(ordered);
    } else {
      result.push(...ordered.map((projection) => [projection]));
    }
  }
  const crossItemRanges = new Map<string, PdfLayoutMoneyProjection[][]>();
  for (const group of result.filter((candidate) => candidate.length === 1)) {
    const projection = group[0]!;
    const key = [projection.page, projection.row, projection.header].join("\0");
    crossItemRanges.set(key, [...(crossItemRanges.get(key) ?? []), group]);
  }
  const consumed = new Set<PdfLayoutMoneyProjection[]>();
  const mergedRanges: PdfLayoutMoneyProjection[][] = [];
  for (const candidates of crossItemRanges.values()) {
    if (candidates.length !== 2) continue;
    const ordered = [...candidates].sort((left, right) => (
      left[0]!.item - right[0]!.item
    ));
    const left = ordered[0]![0]!;
    const right = ordered[1]![0]!;
    if (left.item >= right.item) continue;
    const row = layout.rows.find((candidate) => (
      candidate.page === left.page && candidate.row === left.row
    ));
    if (!row) continue;
    const between = row.items.filter((item) => (
      item.column > left.item && item.column < right.item
    ));
    if (!between.some((item) => /^(?:~|～|〜|–|—)$/u.test(
      normalizePdfLayoutItemText(item.text),
    ))) continue;
    consumed.add(ordered[0]!);
    consumed.add(ordered[1]!);
    mergedRanges.push([left, right]);
  }
  return [
    ...result.filter((group) => !consumed.has(group)),
    ...mergedRanges,
  ].sort((left, right) => (
    left[0]!.page - right[0]!.page
    || left[0]!.row - right[0]!.row
    || left[0]!.item - right[0]!.item
    || left[0]!.moneyOrdinal - right[0]!.moneyOrdinal
  ));
}

function scannerBoundProjectionQuote(
  projection: PdfLayoutMoneyProjection,
  projectedLocators: ReadonlySet<string>,
  maximum = 1_000,
): string {
  if (projectedLocators.has(projection.source_locator)) {
    return pdfProjectionQuote(projection, maximum);
  }
  const prefix = `line:${projection.lineNumber}: `;
  return `${prefix}${projection.line_context.slice(0, Math.max(1, maximum - prefix.length))}`;
}

function pdfHeaderEvidenceRow(
  layout: CanonicalPdfLayoutEvidence,
  projection: PdfLayoutMoneyProjection,
  minimumRow: number,
): CanonicalPdfLayoutRow | null {
  const name = exactPdfProjectionOptionName(projection).replace(/\s+/gu, "");
  return layout.rows
    .filter((row) => (
      row.page === projection.page
      && row.row >= minimumRow
      && row.row <= projection.row
      && pdfLayoutRowText(row).replace(/\s+/gu, "").includes(name)
    ))
    .sort((left, right) => right.row - left.row)[0] ?? null;
}

interface ExactPdfTableHallOwner {
  hall: LocalHall;
  identityRow: CanonicalPdfLayoutRow | null;
}

function exactPdfTableHallOwner(
  source: LocalTextEvidence,
  layout: CanonicalPdfLayoutEvidence,
  projection: PdfLayoutMoneyProjection,
  halls: LocalHall[],
): ExactPdfTableHallOwner | null {
  const eligible = halls.filter((hall) => hall.source_file_ids.includes(source.sourceFileId));
  const rowText = normalizedPlainIdentity(projection.line_context);
  const inline = eligible.filter((hall) => (
    hall.hall_name !== null && rowText.includes(normalizedPlainIdentity(hall.hall_name))
  ));
  if (inline.length === 1) return { hall: inline[0]!, identityRow: null };

  const identityHeaders = layout.rows.filter((row) => (
    row.page === projection.page
    && row.row <= projection.row
    && row.items.some((item) => normalizePdfLayoutItemText(item.text).replace(/\s+/gu, "") === "예식홀명")
  )).sort((left, right) => right.row - left.row);
  const header = identityHeaders[0] ?? null;
  if (header) {
    const identityItem = header.items.find((item) => (
      normalizePdfLayoutItemText(item.text).replace(/\s+/gu, "") === "예식홀명"
    ));
    if (identityItem) {
      const nextStop = layout.rows
        .filter((row) => (
          row.page === header.page
          && row.row > header.row
          && /(?:선택\s*품목\s*가격|계약\s*해지|위약금|환급)/u.test(pdfLayoutRowText(row))
        ))
        .sort((left, right) => left.row - right.row)[0] ?? null;
      const endRow = nextStop?.row ?? Math.max(...layout.rows
        .filter((row) => row.page === header.page)
        .map(({ row }) => row));
      const identities = layout.rows.flatMap((row) => {
        if (row.page !== header.page || row.row <= header.row || row.row >= endRow) return [];
        const name = plainHallDisplayName(row.items
          // A PDF cell may be split into `A` + `홀`. Restrict the owner band
          // to the measured identity-header start so adjacent option labels
          // cannot be concatenated into a false hall name.
          .filter((item) => Math.abs(item.x - identityItem.x) <= 40)
          .map((item) => normalizePdfLayoutItemText(item.text))
          .filter(Boolean)
          .join(" "));
        const exactPlaceholder = /^[A-Z]\s*홀$/iu.test(name);
        return (isExplicitHallIdentityText(name) || exactPlaceholder)
          ? [{ name: name.slice(0, 300), row }]
          : [];
      });
      const preceding = identities
        .filter((candidate) => candidate.row.row <= projection.row)
        .sort((left, right) => right.row.row - left.row.row);
      const owner = preceding[0] ?? (identities.length === 1 ? identities[0]! : null);
      if (owner) {
        const existing = eligible.find((hall) => (
          hall.hall_name !== null
          && normalizedPlainIdentity(hall.hall_name) === normalizedPlainIdentity(owner.name)
        ));
        if (existing) return { hall: existing, identityRow: owner.row };
        const quote = pdfLayoutRowQuote(owner.row);
        if (!quote) return null;
        const hall: LocalHall = {
          hall_name: owner.name,
          guarantee_min: null,
          meal_price_min_krw: null,
          meal_price_max_krw: null,
          venue_fee_min_krw: null,
          venue_fee_max_krw: null,
          venue_fee_note: null,
          decoration_fee_min_krw: null,
          decoration_fee_max_krw: null,
          decoration_note: null,
          options: [],
          source_quote: quote,
          source_file_ids: [source.sourceFileId],
          confidence: 0.25,
          needs_review: true,
        };
        halls.push(hall);
        return { hall, identityRow: owner.row };
      }
    }
  }
  const headerRow = pdfHeaderEvidenceRow(layout, projection, 1);
  const markedTitles = headerRow
    ? layout.rows.flatMap((row) => {
        if (row.page !== projection.page || row.row >= headerRow.row || !row.line) return [];
        const text = row.items
          .map((item) => normalizePdfLayoutItemText(item.text))
          .filter(Boolean)
          .join(" ");
        const match = /^[□■]\s*(.+)$/u.exec(text);
        if (!match) return [];
        const name = plainHallDisplayName(match[1] ?? "");
        if (
          name.length < 2
          || name.length > 120
          || !/\p{L}/u.test(name)
          || PUBLIC_CONTACT_PATTERN.test(name)
          || POLICY_PATTERN.test(name)
          || scanSourceMoneyOccurrences(name).length > 0
        ) return [];
        return [{ name, row }];
      })
    : [];
  if (markedTitles.length === 1) {
    const marked = markedTitles[0]!;
    const existing = eligible.find((hall) => (
      hall.hall_name !== null
      && normalizedPlainIdentity(hall.hall_name) === normalizedPlainIdentity(marked.name)
    ));
    if (existing) return { hall: existing, identityRow: marked.row };
    const quote = pdfLayoutRowQuote(marked.row);
    if (!quote) return null;
    const hall: LocalHall = {
      hall_name: marked.name.slice(0, 300),
      guarantee_min: null,
      meal_price_min_krw: null,
      meal_price_max_krw: null,
      venue_fee_min_krw: null,
      venue_fee_max_krw: null,
      venue_fee_note: null,
      decoration_fee_min_krw: null,
      decoration_fee_max_krw: null,
      decoration_note: null,
      options: [],
      source_quote: quote,
      source_file_ids: [source.sourceFileId],
      confidence: 0.25,
      needs_review: true,
    };
    halls.push(hall);
    return { hall, identityRow: marked.row };
  }
  return eligible.length === 1 ? { hall: eligible[0]!, identityRow: null } : null;
}

function evidenceQuoteContainsPdfProjection(
  sourceFileIdValue: string,
  quote: string,
  projection: PdfLayoutMoneyProjection,
): boolean {
  return pdfLayoutEvidenceFragments(sourceFileIdValue, [quote]).some((fragment) => (
    fragment.source_file_id === sourceFileIdValue
    && (
      fragment.quote.includes(projection.source_locator)
      || (
        fragment.quote.startsWith(`line:${projection.lineNumber}:`)
        && scanSourceMoneyOccurrences(fragment.quote).some(({ krw }) => krw === projection.krw)
      )
    )
  ));
}

function pdfProjectionGroupAlreadyStructured(
  sourceFileIdValue: string,
  halls: LocalHall[],
  group: PdfLayoutMoneyProjection[],
): boolean {
  const records = halls.flatMap((hall) => [
    {
      amounts: [
        hall.meal_price_min_krw,
        hall.meal_price_max_krw,
        hall.venue_fee_min_krw,
        hall.venue_fee_max_krw,
        hall.decoration_fee_min_krw,
        hall.decoration_fee_max_krw,
      ],
      quote: hall.source_quote,
      requirePdfLocator: false,
    },
    ...hall.options.map((option) => ({
      amounts: [option.price_min_krw, option.price_max_krw],
      quote: option.source_quote,
      // An already emitted option is only complete for this projection when
      // it retains the exact PDF item locator. Exact line evidence may prove
      // the aggregate above, but should be enriched rather than causing an
      // otherwise identical option to lose its item-level provenance.
      requirePdfLocator: true,
    })),
  ]);
  return group.every((projection) => records.some((record) => (
    record.amounts.includes(projection.krw)
    && (record.requirePdfLocator
      ? pdfLayoutEvidenceFragments(sourceFileIdValue, [record.quote]).some((fragment) => (
          fragment.source_file_id === sourceFileIdValue
          && fragment.quote.includes(projection.source_locator)
        ))
      : evidenceQuoteContainsPdfProjection(sourceFileIdValue, record.quote, projection))
  )));
}

function hasExactPdfProjectionLabel(
  layout: CanonicalPdfLayoutEvidence,
  projection: PdfLayoutMoneyProjection,
): boolean {
  const label = exactPdfHallOptionName(layout, projection);
  return /\p{L}/u.test(label)
    && !/^(?:가격|금액|기본가격|기타\s*옵션|제공\s*금액.*)$/u.test(label)
    && !PUBLIC_CONTACT_PATTERN.test(label)
    && !POLICY_PATTERN.test(label);
}

function addCertifiedPdfHallOptions(
  source: LocalTextEvidence,
  layout: CanonicalPdfLayoutEvidence,
  extracted: { halls: LocalHall[]; quarantinedMoney: number },
): void {
  const projectedLocators = scannerAddedPdfProjectionLocators(source);
  const additions = projectCanonicalPdfLayoutMoney(source.text).filter((projection) => (
    projection.certifier !== "policy"
  ));
  for (const projectionGroup of certifiedPdfProjectionGroups(layout, additions)) {
    if (pdfProjectionGroupAlreadyStructured(source.sourceFileId, extracted.halls, projectionGroup)) {
      continue;
    }
    if (
      projectionGroup.length !== 2
      && !projectionGroup.every((projection) => projectedLocators.has(projection.source_locator))
      && !projectionGroup.every((projection) => hasExactPdfProjectionLabel(layout, projection))
    ) continue;
    if (projectionGroup.some((projection) => !projectionUsesIsolatedMoneySlot(layout, projection))) {
      extracted.quarantinedMoney += projectionGroup.length;
      continue;
    }
    const projection = projectionGroup[0]!;
    const owner = exactPdfTableHallOwner(
      source,
      layout,
      projection,
      extracted.halls,
    );
    const hall = owner?.hall ?? null;
    if (!hall || hall.options.length >= 200) {
      extracted.quarantinedMoney += 1;
      continue;
    }
    const projectionRow = layout.rows.find((row) => (
      row.page === projection.page && row.row === projection.row
    )) ?? null;
    const headerRow = pdfHeaderEvidenceRow(layout, projection, 1);
    const identity = normalizedPlainIdentity(hall.hall_name ?? "");
    const identityFragments = pdfLayoutEvidenceFragments(
      source.sourceFileId,
      [hall.source_quote],
    ).filter((fragment) => fragment.source_file_id === source.sourceFileId);
    const identityFragment = identityFragments.find((fragment) => (
      normalizedPlainIdentity(fragment.quote).includes(identity)
    )) ?? null;
    if (!identityFragment) {
      extracted.quarantinedMoney += projectionGroup.length;
      continue;
    }
    const fragments = [
      identityFragment,
      ...pdfLayoutEvidenceFragments(source.sourceFileId, [
      pdfLayoutRowQuote(headerRow),
      pdfLayoutRowQuote(projectionRow),
      ...projectionGroup.map((candidate) => pdfProjectionQuote(candidate)),
      ]),
    ];
    const sourceQuote = encodeMergedEvidenceQuote(fragments, 1_000)
      ?? pdfProjectionQuote(projection);
    const prices = projectionGroup.map(({ krw }) => krw);
    const option: LocalPriceOption = {
      name: exactPdfHallOptionName(layout, projection),
      price_min_krw: Math.min(...prices),
      price_max_krw: projectionGroup.length === 2 ? Math.max(...prices) : null,
      unit: null,
      condition: (projection.condition ?? projection.line_context).slice(0, 1_000),
      raw_text: projection.line_context.slice(0, 2_000),
      source_quote: sourceQuote,
      source_file_ids: [source.sourceFileId],
    };
    const exactExisting = hall.options.find((candidate) => (
      normalizedPlainIdentity(candidate.name) === normalizedPlainIdentity(option.name)
      && candidate.price_min_krw === option.price_min_krw
      && candidate.price_max_krw === option.price_max_krw
      && (candidate.condition === option.condition || projectionGroup.length === 2)
      && candidate.source_file_ids.includes(source.sourceFileId)
    ));
    if (exactExisting) {
      exactExisting.source_quote = option.source_quote;
      exactExisting.raw_text = option.raw_text;
      exactExisting.condition = option.condition;
    } else {
      hall.options.push(option);
    }
  }
}

type PdfHallColumnKind = "identity" | "combined" | "meal" | "remarks";

interface PdfHallColumnBands {
  identityUpper: number;
  combinedMealBoundary: number;
  mealRemarksBoundary: number;
}

function pdfLayoutRowText(row: CanonicalPdfLayoutRow): string {
  return cleanCellValue(row.items.map(({ text }) => normalizePdfLayoutItemText(text)).join(" "));
}

function pdfHallColumnKind(
  item: CanonicalPdfLayoutItem,
  bands: PdfHallColumnBands,
): PdfHallColumnKind {
  if (item.x < bands.identityUpper) return "identity";
  if (item.x < bands.combinedMealBoundary) return "combined";
  if (item.x < bands.mealRemarksBoundary) return "meal";
  return "remarks";
}

function exactPdfMoneyRange(item: CanonicalPdfLayoutItem): MoneyOccurrence[] | null {
  const text = normalizePdfLayoutItemText(item.text);
  const occurrences = scanSourceMoneyOccurrences(text);
  if (occurrences.length !== 2 || !/[~～]/u.test(text)) return null;
  return occurrences;
}

function exactPdfOptionPrice(item: CanonicalPdfLayoutItem): {
  minimum: number;
  maximum: number | null;
} | null {
  const text = normalizePdfLayoutItemText(item.text);
  const occurrences = scanSourceMoneyOccurrences(text);
  if (occurrences.length === 1 && /[~～]\s*$/u.test(text)) {
    return { minimum: occurrences[0]!.krw, maximum: null };
  }
  if (occurrences.length === 2 && /[~～]/u.test(text)) {
    return {
      minimum: Math.min(...occurrences.map(({ krw }) => krw)),
      maximum: Math.max(...occurrences.map(({ krw }) => krw)),
    };
  }
  return null;
}

function pdfLayoutSectionRow(
  rows: CanonicalPdfLayoutRow[],
  pattern: RegExp,
): CanonicalPdfLayoutRow | null {
  const matches = rows.filter((row) => pattern.test(pdfLayoutRowText(row)));
  return matches.length === 1 ? matches[0]! : null;
}

function pdfLayoutRowsBetween(
  rows: CanonicalPdfLayoutRow[],
  start: CanonicalPdfLayoutRow,
  end: CanonicalPdfLayoutRow,
): CanonicalPdfLayoutRow[] {
  return rows.filter((row) => (
    row.page === start.page
    && row.page === end.page
    && row.row > start.row
    && row.row < end.row
  ));
}

function extractStrictSharedPdfHallLayout(
  source: LocalTextEvidence,
  layout: CanonicalPdfLayoutEvidence,
): Omit<PdfLayoutHallExtractionResult, "handledSourceIds" | "invalidSourceIds"> | null {
  const rows = layout.rows.filter((row) => row.line !== null);
  const priceSection = pdfLayoutSectionRow(
    rows,
    /^[1-9][0-9]*\.\s*대관료\s*(?:&|및)\s*식대$/u,
  );
  const optionSection = pdfLayoutSectionRow(
    rows,
    /^[1-9][0-9]*\.\s*추가\s*선택사항\s*품목$/u,
  );
  const policySection = pdfLayoutSectionRow(
    rows,
    /^[1-9][0-9]*\.\s*환불\s*기준$/u,
  );
  if (
    !priceSection
    || !optionSection
    || !policySection
    || priceSection.page !== optionSection.page
    || priceSection.page !== policySection.page
    || !(priceSection.row < optionSection.row && optionSection.row < policySection.row)
  ) return null;

  const typedHeaderCandidates = rows.filter((row) => {
    if (
      row.page !== priceSection.page
      || row.row <= priceSection.row
      || row.row >= optionSection.row
      || row.row - priceSection.row > 5
      || row.items.length !== 3
    ) return false;
    const text = row.items.map(({ text }) => normalizePdfLayoutItemText(text));
    return /^대관\s*(?:및|&)\s*(?:장식|장식비)$/u.test(text[0] ?? "")
      && text[1] === "식대"
      && text[2] === "비고"
      && row.items[1]!.x - row.items[0]!.x >= 80
      && row.items[2]!.x - row.items[1]!.x >= 60;
  });
  if (typedHeaderCandidates.length !== 1) return null;
  const typedHeader = typedHeaderCandidates[0]!;
  const [combinedHeader, mealHeader, remarksHeader] = typedHeader.items;
  if (!combinedHeader || !mealHeader || !remarksHeader) return null;
  const combinedMealGap = mealHeader.x - combinedHeader.x;
  const bands: PdfHallColumnBands = {
    identityUpper: combinedHeader.x - Math.min(60, combinedMealGap * 0.4),
    combinedMealBoundary: (combinedHeader.x + mealHeader.x) / 2,
    mealRemarksBoundary: (mealHeader.x + remarksHeader.x) / 2,
  };
  if (
    !(bands.identityUpper > 0)
    || !(bands.identityUpper < bands.combinedMealBoundary)
    || !(bands.combinedMealBoundary < bands.mealRemarksBoundary)
  ) return null;

  const pricingRows = pdfLayoutRowsBetween(rows, typedHeader, optionSection);
  const hallRows = pricingRows.flatMap((row) => {
    const identities = row.items.filter((item) => (
      pdfHallColumnKind(item, bands) === "identity"
      && isExplicitHallIdentityText(plainHallDisplayName(item.text))
    ));
    if (identities.length !== 1) return [];
    const identity = identities[0]!;
    return [{ row, item: identity, name: plainHallDisplayName(identity.text) }];
  });
  if (hallRows.length < 2 || hallRows.length > 100) return null;
  const hallKeys = hallRows.map(({ name }) => normalizedPlainIdentity(name));
  if (hallKeys.some((key, index) => !key || hallKeys.indexOf(key) !== index)) return null;
  const firstHall = hallRows[0]!.row;
  const lastHall = hallRows.at(-1)!.row;
  if (hallRows.some(({ row }) => row.items.some((item) => (
    scanSourceMoneyOccurrences(normalizePdfLayoutItemText(item.text)).length > 0
  )))) return null;
  if (pricingRows.some((row) => (
    row.row >= firstHall.row
    && row.row <= lastHall.row
    && row.items.some((item) => scanSourceMoneyOccurrences(item.text).length > 0)
  ))) return null;

  const guaranteeCandidates = pricingRows.flatMap((row) => {
    if (row.row >= firstHall.row) return [];
    return row.items.flatMap((item) => {
      if (pdfHallColumnKind(item, bands) !== "meal") return [];
      const match = /^최소\s*([1-9][0-9,]*)\s*명(?:\s*\([^)]*\))?$/u.exec(
        normalizePdfLayoutItemText(item.text),
      );
      if (!match) return [];
      const value = Number.parseInt(match[1]!.replace(/,/gu, ""), 10);
      return Number.isSafeInteger(value) && value > 0 ? [{ row, value }] : [];
    });
  });
  if (guaranteeCandidates.length !== 1) return null;
  const guarantee = guaranteeCandidates[0]!;

  const footerCandidates = pricingRows.filter((row) => (
    row.row > lastHall.row
    && row.items.some((item) => scanSourceMoneyOccurrences(item.text).length > 0)
  ));
  if (footerCandidates.length !== 1) return null;
  const footer = footerCandidates[0]!;
  if (footer.items.length !== 2) return null;
  const combinedItem = footer.items.find((item) => pdfHallColumnKind(item, bands) === "combined");
  const mealItem = footer.items.find((item) => pdfHallColumnKind(item, bands) === "meal");
  if (!combinedItem || !mealItem || combinedItem === mealItem) return null;
  const combinedRange = exactPdfMoneyRange(combinedItem);
  const mealRange = exactPdfMoneyRange(mealItem);
  if (!combinedRange || !mealRange) return null;

  const optionRows = pdfLayoutRowsBetween(rows, optionSection, policySection);
  const sharedOptions: Array<{ option: LocalPriceOption; line: PlainTextLine }> = [];
  const claimedMoneyLineNumbers = new Set<number>([footer.line!.number]);
  for (const row of optionRows) {
    const hasMoney = row.items.some((item) => scanSourceMoneyOccurrences(item.text).length > 0);
    if (!hasMoney) continue;
    if (row.items.length !== 4 || !row.line) return null;
    const [leftLabelItem, leftPriceItem, rightLabelItem, rightPriceItem] = row.items;
    if (
      !leftLabelItem
      || !leftPriceItem
      || !rightLabelItem
      || !rightPriceItem
      || pdfHallColumnKind(leftLabelItem, bands) !== "identity"
      || pdfHallColumnKind(leftPriceItem, bands) !== "combined"
      || pdfHallColumnKind(rightLabelItem, bands) !== "meal"
      || pdfHallColumnKind(rightPriceItem, bands) !== "remarks"
    ) return null;
    const leftName = specificOptionLabel(leftLabelItem.text);
    const rightName = specificOptionLabel(rightLabelItem.text);
    const leftPrice = exactPdfOptionPrice(leftPriceItem);
    const rightPrice = exactPdfOptionPrice(rightPriceItem);
    if (!leftName || !rightName || !leftPrice || !rightPrice) return null;
    for (const [name, price, priceItem] of [
      [leftName, leftPrice, leftPriceItem],
      [rightName, rightPrice, rightPriceItem],
    ] as const) {
      sharedOptions.push({
        option: {
          name,
          price_min_krw: price.minimum,
          price_max_krw: price.maximum,
          unit: null,
          condition: null,
          raw_text: `${name} ${normalizePdfLayoutItemText(priceItem.text)}`.slice(0, 2_000),
          source_quote: shortLineQuote(row.line, 1_000),
          source_file_ids: [source.sourceFileId],
        },
        line: row.line,
      });
    }
    claimedMoneyLineNumbers.add(row.line.number);
  }
  if (sharedOptions.length === 0 || sharedOptions.length > 199) return null;
  const sourceMoney = scanSourceMoneyOccurrences(source.text);
  if (sourceMoney.some((occurrence) => {
    const lineNumber = lineNumberFromLocator(occurrence.source_locator);
    return lineNumber === null || !claimedMoneyLineNumbers.has(lineNumber);
  })) return null;

  const policyRows = pdfLayoutRowsBetween(rows, policySection, {
    ...policySection,
    row: Number.MAX_SAFE_INTEGER,
  });
  const policyTableHeaders = policyRows.filter((row) => (
    row.items.length === 3
    && normalizePdfLayoutItemText(row.items[0]!.text) === "취소 일정"
    && normalizePdfLayoutItemText(row.items[1]!.text) === "기준 규정"
    && normalizePdfLayoutItemText(row.items[2]!.text) === "비고"
  ));
  if (policyTableHeaders.length !== 1) return null;
  const policyTableHeader = policyTableHeaders[0]!;
  const policyDataRows = policyRows.filter((row) => row.row > policyTableHeader.row);
  const refundRows = policyDataRows.flatMap((row) => row.items.flatMap((item) => (
    /^([1-9][0-9]?)%\s*환불$/u.test(normalizePdfLayoutItemText(item.text))
      ? [{ row, item }]
      : []
  )));
  if (refundRows.length !== 1) return null;
  const refund = refundRows[0]!;
  if (pdfHallColumnKind(refund.item, bands) !== "meal") return null;
  const refundConditionRow = policyDataRows.find((row) => row.row === refund.row.row + 1) ?? null;
  const refundConditionItem = refundConditionRow?.items.find((item) => (
    pdfHallColumnKind(item, bands) === "identity"
    && /^계약\s*체결일\s*기준\s*[1-9][0-9]*일\s*이내$/u.test(normalizePdfLayoutItemText(item.text))
  )) ?? null;
  if (!refundConditionRow?.line || !refundConditionItem || !refund.row.line) return null;
  const deductionRow = policyDataRows.find((row) => row.row === refundConditionRow.row + 1) ?? null;
  const deductionItem = deductionRow?.items.length === 1
    && /^\[[^\]]*(?:공제|차감)[^\]]*\]$/u.test(normalizePdfLayoutItemText(deductionRow.items[0]!.text))
      ? deductionRow.items[0]!
      : null;
  const refundContent = [
    normalizePdfLayoutItemText(refund.item.text),
    normalizePdfLayoutItemText(refundConditionItem.text),
    ...(deductionItem ? [normalizePdfLayoutItemText(deductionItem.text)] : []),
  ].join(" ");
  const sections: NonNullable<DisclosureExtraction["sections"]> = [{
    section_type: "refund_policy",
    title: refundContent.slice(0, 300),
    content_verbatim: refundContent,
    summary: refundContent.slice(0, 1_000),
    source_quote: mergedLineQuote([
      refund.row.line,
      refundConditionRow.line,
      ...(deductionRow?.line && deductionItem ? [deductionRow.line] : []),
    ], 2_000) ?? shortLineQuote(refund.row.line, 2_000),
    source_file_ids: [source.sourceFileId],
    confidence: 0.45,
    needs_review: true,
  }];

  for (const row of policyDataRows) {
    if (!row.line || row.items.length < 2) continue;
    const condition = row.items.find((item) => (
      pdfHallColumnKind(item, bands) === "identity"
      && /^예식\s*[1-9][0-9]*일\s*전\s*~\s*(?:[1-9][0-9]*일\s*이내|예식\s*당일)$/u.test(
        normalizePdfLayoutItemText(item.text),
      )
    ));
    const penalty = row.items.find((item) => (
      pdfHallColumnKind(item, bands) === "meal"
      && /^총\s*비용의\s*[1-9][0-9]?%\s*위약금$/u.test(normalizePdfLayoutItemText(item.text))
    ));
    if (!condition && !penalty) continue;
    if (!condition || !penalty || row.items.length !== 2) return null;
    const content = `${normalizePdfLayoutItemText(condition.text)} ${normalizePdfLayoutItemText(penalty.text)}`;
    sections.push({
      section_type: "penalty",
      title: content.slice(0, 300),
      content_verbatim: content,
      summary: content.slice(0, 1_000),
      source_quote: shortLineQuote(row.line, 2_000),
      source_file_ids: [source.sourceFileId],
      confidence: 0.45,
      needs_review: true,
    });
  }
  if (sections.filter(({ section_type }) => section_type === "penalty").length === 0) return null;

  const basisLabels = ["총 비용의 기준", "대관료, 식대", "기타 부대비용", "포함"] as const;
  const basisParts = basisLabels.map((label) => {
    const matches = policyDataRows.flatMap((row) => row.items.flatMap((item) => (
      normalizePdfLayoutItemText(item.text) === label
      && pdfHallColumnKind(item, bands) === "remarks"
        ? [{ row, item }]
        : []
    )));
    return matches.length === 1 ? matches[0]! : null;
  });
  if (
    basisParts.every((part) => part !== null)
    && basisParts.every((part, index) => index === 0 || (
      part!.row.row > basisParts[index - 1]!.row.row
    ))
  ) {
    const basisContent = basisLabels.join(" ");
    const basisLines = basisParts.map((part) => part!.row.line)
      .filter((line): line is PlainTextLine => line !== null);
    if (basisLines.length === basisLabels.length) {
      sections.push({
        section_type: "pricing_basis",
        title: basisContent,
        content_verbatim: basisContent,
        summary: basisContent,
        source_quote: mergedLineQuote(basisLines, 2_000)
          ?? shortLineQuote(basisLines[0]!, 2_000),
        source_file_ids: [source.sourceFileId],
        confidence: 0.45,
        needs_review: true,
      });
    }
  }

  const noticeCandidates = policyDataRows.flatMap((row) => row.items.flatMap((item) => {
    const text = normalizePdfLayoutItemText(item.text);
    return /소비자\s*분쟁해결\s*기준.*(?:권고사항|권고\s*사항).*계약\s*진행/u.test(text)
      ? [{ row, text }]
      : [];
  }));
  if (noticeCandidates.length === 1 && noticeCandidates[0]!.row.line) {
    const notice = noticeCandidates[0]!;
    const noticeLine = notice.row.line!;
    sections.push({
      section_type: "notice",
      title: notice.text.slice(0, 300),
      content_verbatim: notice.text,
      summary: notice.text.slice(0, 1_000),
      source_quote: shortLineQuote(noticeLine, 2_000),
      source_file_ids: [source.sourceFileId],
      confidence: 0.45,
      needs_review: true,
    });
  }

  const combinedAmounts = combinedRange.map(({ krw }) => krw);
  const mealAmounts = mealRange.map(({ krw }) => krw);
  const sharedCombinedOption: LocalPriceOption = {
    name: normalizePdfLayoutItemText(combinedHeader.text),
    price_min_krw: Math.min(...combinedAmounts),
    price_max_krw: Math.max(...combinedAmounts),
    unit: null,
    condition: null,
    raw_text: normalizePdfLayoutItemText(combinedItem.text),
    source_quote: mergedLineQuote([typedHeader.line!, footer.line!], 1_000)
      ?? shortLineQuote(footer.line!, 1_000),
    source_file_ids: [source.sourceFileId],
  };
  const hallSourceLines = [typedHeader.line!, guarantee.row.line!, footer.line!];
  const halls: LocalHall[] = hallRows.map(({ row, name }) => {
    const hallIdentityLine = row.line!;
    const options = [
      {
        ...sharedCombinedOption,
        source_quote: mergedLineQuote(
          [hallIdentityLine, typedHeader.line!, footer.line!],
          1_000,
        ) ?? shortLineQuote(footer.line!, 1_000),
      },
      ...sharedOptions.map(({ option, line }) => ({
        ...option,
        source_quote: mergedLineQuote([hallIdentityLine, line], 1_000)
          ?? shortLineQuote(line, 1_000),
      })),
    ];
    return {
      hall_name: name.slice(0, 300),
      guarantee_min: guarantee.value,
      meal_price_min_krw: Math.min(...mealAmounts),
      meal_price_max_krw: Math.max(...mealAmounts),
      venue_fee_min_krw: null,
      venue_fee_max_krw: null,
      venue_fee_note: null,
      decoration_fee_min_krw: null,
      decoration_fee_max_krw: null,
      decoration_note: null,
      options,
      source_quote: mergedLineQuote([hallIdentityLine, ...hallSourceLines], 2_000)
        ?? shortLineQuote(hallIdentityLine, 2_000),
      source_file_ids: [source.sourceFileId],
      confidence: 0.45,
      needs_review: true,
    };
  });
  return { halls, sections, quarantinedMoney: 0 };
}

const STANDARD_PDF_OPTION_HEADERS = [
  "폐백",
  "식음료",
  "장식",
  "연출",
  "행사",
  "영상",
  "사진",
  "기타옵션",
] as const;

function exactPdfRowsInclusive(
  rows: CanonicalPdfLayoutRow[],
  start: CanonicalPdfLayoutRow,
  end: CanonicalPdfLayoutRow,
): CanonicalPdfLayoutRow[] | null {
  if (start.page !== end.page || start.row > end.row) return null;
  const selected = rows.filter((row) => (
    row.page === start.page && row.row >= start.row && row.row <= end.row
  ));
  if (
    selected.length !== end.row - start.row + 1
    || selected.some((row) => row.line === null)
    || selected.some((row, index) => index > 0 && (
      row.row !== selected[index - 1]!.row + 1
      || row.line!.number !== selected[index - 1]!.line!.number + 1
    ))
  ) return null;
  return selected;
}

function extractStrictStandardSinglePdfHallLayout(
  source: LocalTextEvidence,
  layout: CanonicalPdfLayoutEvidence,
): Omit<PdfLayoutHallExtractionResult, "handledSourceIds" | "invalidSourceIds"> | null {
  const rows = layout.rows.filter((row) => row.line !== null);
  const priceHeaders = rows.filter((row) => {
    const values = row.items.map(({ text }) => normalizePdfLayoutItemText(text));
    return values.length === 3
      && /^예식\s*홀명$/u.test(values[0] ?? "")
      && /^(?<!장)식\s*비$/u.test(values[1] ?? "")
      && /^대관료$/u.test(values[2] ?? "");
  });
  const optionSections = rows.filter((row) => (
    /^선택\s*품목\s*가격$/u.test(pdfLayoutRowText(row))
  ));
  const policySections = rows.filter((row) => (
    /계약\s*해지.*위약금.*환급.*산정\s*기준/u.test(pdfLayoutRowText(row))
  ));
  if (
    priceHeaders.length !== 1
    || optionSections.length !== 1
    || policySections.length !== 1
  ) return null;
  const priceHeader = priceHeaders[0]!;
  const optionSection = optionSections[0]!;
  const policySection = policySections[0]!;
  if (
    priceHeader.page !== optionSection.page
    || priceHeader.page !== policySection.page
    || !(priceHeader.row < optionSection.row && optionSection.row < policySection.row)
  ) return null;
  const [identityHeader, mealHeader, venueHeader] = priceHeader.items;
  if (!identityHeader || !mealHeader || !venueHeader) return null;
  const identityMealBoundary = (identityHeader.x + mealHeader.x) / 2;
  const mealVenueBoundary = (mealHeader.x + venueHeader.x) / 2;
  if (
    mealHeader.x - identityHeader.x < 40
    || venueHeader.x - mealHeader.x < 40
    || !(identityMealBoundary < mealVenueBoundary)
  ) return null;

  const sourceMoney = scanSourceMoneyOccurrences(source.text);
  const moneyForRow = (row: CanonicalPdfLayoutRow): MoneyOccurrence[] => (
    row.line
      ? sourceMoney.filter(({ source_locator }) => source_locator === `line:${row.line!.number}`)
      : []
  );
  const priceRows = pdfLayoutRowsBetween(rows, priceHeader, optionSection);
  if (priceRows.length !== 3) return null;
  const identityCandidates = priceRows.flatMap((row) => {
    const name = plainHallDisplayName(row.items
      .filter((item) => item.x < identityMealBoundary)
      .map(({ text }) => normalizePdfLayoutItemText(text))
      .filter(Boolean)
      .join(" "));
    return isExplicitHallIdentityText(name) ? [{ row, name }] : [];
  });
  if (identityCandidates.length !== 1) return null;
  const hallIdentity = identityCandidates[0]!;
  const mealCandidates = priceRows.flatMap((row) => {
    const text = row.items
      .filter((item) => item.x >= identityMealBoundary && item.x < mealVenueBoundary)
      .map(({ text: itemText }) => normalizePdfLayoutItemText(itemText))
      .filter(Boolean)
      .join(" ");
    const money = moneyForRow(row);
    return money.length === 1 ? [{ row, text, occurrence: money[0]! }] : [];
  });
  const baseMeals = mealCandidates.filter(({ text }) => (
    /^기본\s*[1-9][0-9,]*\s*명\s*[1-9][0-9,]*\s*원$/u.test(text)
  ));
  const incrementalMeals = mealCandidates.filter(({ text }) => (
    /^추가\s*1\s*명당\s*[1-9][0-9,]*\s*원$/u.test(text)
  ));
  if (baseMeals.length !== 1 || incrementalMeals.length !== 1) return null;
  const guaranteeMatch = /^기본\s*([1-9][0-9,]*)\s*명/u.exec(baseMeals[0]!.text);
  const guarantee = Number.parseInt(guaranteeMatch?.[1]?.replace(/,/gu, "") ?? "", 10);
  if (!Number.isSafeInteger(guarantee) || guarantee < 1) return null;

  const venueCandidates = priceRows.flatMap((row) => {
    const text = row.items
      .filter((item) => item.x >= mealVenueBoundary)
      .map(({ text: itemText }) => normalizePdfLayoutItemText(itemText))
      .filter(Boolean)
      .join(" ");
    const money = moneyForRow(row);
    return /^대관(?:료)?\s*[1-9][0-9,]*\s*원$/u.test(text) && money.length === 1
      ? [{ row, occurrence: money[0]!, text }]
      : [];
  });
  if (
    venueCandidates.length !== 1
    || venueCandidates[0]!.row.row !== hallIdentity.row.row
  ) return null;
  const directRows = [
    baseMeals[0]!.row,
    hallIdentity.row,
    incrementalMeals[0]!.row,
  ].sort((left, right) => left.row - right.row);
  const directEvidenceRows = exactPdfRowsInclusive(
    rows,
    directRows[0]!,
    directRows.at(-1)!,
  );
  if (
    !directEvidenceRows
    || directEvidenceRows.length !== 3
    || directRows.some((row, index) => row.row !== directEvidenceRows[index]!.row)
  ) return null;
  const directQuote = mergedLineQuote(
    directEvidenceRows.map(({ line }) => line!),
    2_000,
  );
  if (!directQuote) return null;

  const optionRows = pdfLayoutRowsBetween(rows, optionSection, policySection);
  const optionHeaders = STANDARD_PDF_OPTION_HEADERS.map((label) => {
    const matches = optionRows.flatMap((row) => row.items.flatMap((item) => (
      normalizePdfLayoutItemText(item.text) === label ? [{ row, item, label }] : []
    )));
    return matches.length === 1 ? matches[0]! : null;
  });
  if (optionHeaders.some((header) => header === null)) return null;
  const exactOptionHeaders = optionHeaders as Array<{
    row: CanonicalPdfLayoutRow;
    item: CanonicalPdfLayoutItem;
    label: typeof STANDARD_PDF_OPTION_HEADERS[number];
  }>;
  if (exactOptionHeaders.some((header, index) => index > 0 && (
    header.item.x - exactOptionHeaders[index - 1]!.item.x < 20
  ))) return null;
  const optionHallHeaders = optionRows.flatMap((row) => row.items.flatMap((item) => (
    /^예식\s*홀명$/u.test(normalizePdfLayoutItemText(item.text)) ? [{ row, item }] : []
  )));
  if (
    optionHallHeaders.length !== 1
    || Math.abs(optionHallHeaders[0]!.item.x - identityHeader.x) > 20
  ) return null;
  const optionIdentityGap = exactOptionHeaders[0]!.item.x - optionHallHeaders[0]!.item.x;
  if (optionIdentityGap < 40) return null;
  // Text starts are not cell edges: a split hall name can extend slightly
  // beyond their midpoint while still ending before the first option column.
  // Keep the boundary inside the measured header gap, with room on both sides.
  const firstOptionBoundary = optionHallHeaders[0]!.item.x + optionIdentityGap * 0.75;
  const optionBoundaries = exactOptionHeaders.slice(0, -1).map((header, index) => (
    (header.item.x + exactOptionHeaders[index + 1]!.item.x) / 2
  ));
  const optionColumnAtX = (x: number): number | null => {
    if (x < firstOptionBoundary) return null;
    const index = optionBoundaries.findIndex((boundary) => x < boundary);
    return index < 0 ? exactOptionHeaders.length - 1 : index;
  };
  const optionIdentityCandidates = optionRows.flatMap((row) => {
    const name = plainHallDisplayName(row.items
      .filter((item) => item.x < firstOptionBoundary)
      .map(({ text }) => normalizePdfLayoutItemText(text))
      .filter(Boolean)
      .join(" "));
    return isExplicitHallIdentityText(name) ? [{ row, name }] : [];
  });
  if (
    optionIdentityCandidates.length !== 1
    || normalizedPlainIdentity(optionIdentityCandidates[0]!.name)
      !== normalizedPlainIdentity(hallIdentity.name)
  ) return null;

  const optionMoney = optionRows.flatMap((row) => moneyForRow(row).flatMap((occurrence) => {
    const numericToken = occurrence.raw.match(/[1-9][0-9,]*/u)?.[0] ?? null;
    if (!numericToken) return [];
    const positioned = row.items.filter((item) => (
      normalizePdfLayoutItemText(item.text).includes(numericToken)
    ));
    if (positioned.length !== 1) return [];
    const column = optionColumnAtX(positioned[0]!.x);
    return column === null ? [] : [{ row, occurrence, column }];
  }));
  const foodColumn = STANDARD_PDF_OPTION_HEADERS.indexOf("식음료");
  const decorationColumn = STANDARD_PDF_OPTION_HEADERS.indexOf("장식");
  const foodPrices = optionMoney.filter(({ column }) => column === foodColumn);
  const decorationPrices = optionMoney.filter(({ column }) => column === decorationColumn);
  if (
    optionMoney.length !== 2
    || foodPrices.length !== 1
    || decorationPrices.length !== 1
  ) return null;
  const foodConditionCandidates = optionRows.flatMap((row) => row.items.flatMap((item) => (
    optionColumnAtX(item.x) === foodColumn
    && normalizePdfLayoutItemText(item.text) === "무제한"
      ? [{ row, item }]
      : []
  )));
  if (foodConditionCandidates.length !== 1) return null;

  const optionFromColumn = (
    price: typeof foodPrices[number],
    header: typeof exactOptionHeaders[number],
    condition: string | null,
    conditionRow: CanonicalPdfLayoutRow | null,
  ): LocalPriceOption | null => {
    const evidenceRows = [
      hallIdentity.row,
      header.row,
      ...(conditionRow ? [conditionRow] : []),
      price.row,
    ];
    if (
      evidenceRows.some((row) => row.line === null)
      || evidenceRows.some((row) => row.page !== price.row.page)
      || evidenceRows.some((row, index) => index > 0 && (
        row.row <= evidenceRows[index - 1]!.row
      ))
    ) return null;
    // Each option cites only the minimum source rows needed to prove its hall,
    // semantic column, optional condition, and exact price occurrence. In
    // particular, an equal amount in a neighbouring option row must never be
    // able to satisfy this option's grounding check.
    const sourceQuote = mergedLineQuote(evidenceRows.map(({ line }) => line!), 2_000);
    if (!sourceQuote) return null;
    return {
      name: header.label,
      price_min_krw: price.occurrence.krw,
      price_max_krw: price.occurrence.krw,
      unit: null,
      condition,
      raw_text: cleanCellValue(price.occurrence.raw),
      source_quote: sourceQuote,
      source_file_ids: [source.sourceFileId],
    };
  };
  const decorationOption = optionFromColumn(
    decorationPrices[0]!,
    exactOptionHeaders[decorationColumn]!,
    null,
    null,
  );
  const foodOption = optionFromColumn(
    foodPrices[0]!,
    exactOptionHeaders[foodColumn]!,
    "무제한",
    foodConditionCandidates[0]!.row,
  );
  if (!decorationOption || !foodOption) return null;

  const claimedMoney = new Set<MoneyOccurrence>([
    baseMeals[0]!.occurrence,
    incrementalMeals[0]!.occurrence,
    venueCandidates[0]!.occurrence,
    decorationPrices[0]!.occurrence,
    foodPrices[0]!.occurrence,
  ]);
  if (
    claimedMoney.size !== sourceMoney.length
    || sourceMoney.some((occurrence) => !claimedMoney.has(occurrence))
  ) return null;

  const policyRows = rows.filter((row) => (
    row.page === policySection.page && row.row >= policySection.row
  ));
  const sections: NonNullable<DisclosureExtraction["sections"]> = policyRows.flatMap((row) => {
    const content = pdfLayoutRowText(row);
    if (!row.line || !POLICY_PATTERN.test(content)) return [];
    return [{
      section_type: policySectionType(content),
      title: content.slice(0, 300),
      content_verbatim: content.slice(0, 20_000),
      summary: content.slice(0, 1_000),
      source_quote: shortLineQuote(row.line, 2_000),
      source_file_ids: [source.sourceFileId],
      confidence: 0.4,
      needs_review: true,
    }];
  });
  const mealAmounts = [
    baseMeals[0]!.occurrence.krw,
    incrementalMeals[0]!.occurrence.krw,
  ];
  return {
    halls: [{
      hall_name: hallIdentity.name.slice(0, 300),
      guarantee_min: guarantee,
      meal_price_min_krw: Math.min(...mealAmounts),
      meal_price_max_krw: Math.max(...mealAmounts),
      venue_fee_min_krw: venueCandidates[0]!.occurrence.krw,
      venue_fee_max_krw: venueCandidates[0]!.occurrence.krw,
      venue_fee_note: null,
      decoration_fee_min_krw: null,
      decoration_fee_max_krw: null,
      decoration_note: null,
      options: [decorationOption, foodOption],
      source_quote: directQuote,
      source_file_ids: [source.sourceFileId],
      confidence: 0.45,
      needs_review: true,
    }],
    sections,
    quarantinedMoney: 0,
  };
}

function pdfLayoutHallExtraction(sources: LocalTextEvidence[]): PdfLayoutHallExtractionResult {
  const result: PdfLayoutHallExtractionResult = {
    halls: [],
    sections: [],
    handledSourceIds: new Set<string>(),
    invalidSourceIds: new Set<string>(),
    quarantinedMoney: 0,
  };
  for (const source of sources) {
    const layout = parseCanonicalPdfLayoutEvidence(source);
    if (layout.status === "none") continue;
    if (layout.status === "invalid") {
      result.invalidSourceIds.add(source.sourceFileId);
      continue;
    }
    const extracted = extractStrictSharedPdfHallLayout(source, layout)
      ?? extractStrictStandardSinglePdfHallLayout(source, layout);
    if (!extracted) continue;
    result.halls.push(...extracted.halls);
    result.sections.push(...extracted.sections);
    result.handledSourceIds.add(source.sourceFileId);
    result.quarantinedMoney += extracted.quarantinedMoney;
  }
  return result;
}

interface PdfAgencyCategoryBlock {
  page: number;
  startRow: number;
  endRow: number;
  category: PackageVendorCategory;
  explicitHeading: boolean;
  headingRow: CanonicalPdfLayoutRow;
}

function exactPdfAgencyCategory(value: string): PackageVendorCategory | null {
  const compact = cleanCellValue(value).replace(/\s+/gu, "");
  if (compact === "스튜디오") return "studio";
  if (compact === "드레스") return "dress";
  if (compact === "메이크업") return "makeup";
  return null;
}

function pdfAgencyCategoryBlocks(
  layout: CanonicalPdfLayoutEvidence,
): PdfAgencyCategoryBlock[] {
  const rows = layout.rows.filter((row) => row.line !== null);
  const starts: Array<{
    row: CanonicalPdfLayoutRow;
    category: PackageVendorCategory | null;
    explicitHeading: boolean;
  }> = [];
  for (const row of rows) {
    const text = pdfLayoutRowText(row);
    const explicit = /^(?:[1-3]\s*\.?\s*)(스튜디오|드레스|메이크업)\s*선택\s*품목$/u.exec(text);
    if (explicit) {
      starts.push({
        row,
        category: exactPdfAgencyCategory(explicit[1]!),
        explicitHeading: true,
      });
      continue;
    }
    if (/사업자명.*기본가격/u.test(text.replace(/\s+/gu, ""))) {
      starts.push({ row, category: null, explicitHeading: false });
    }
  }
  const effectiveStarts: typeof starts = [];
  for (const start of starts) {
    const active = effectiveStarts.at(-1);
    if (
      !start.explicitHeading
      && active?.explicitHeading
      && active.row.page === start.row.page
    ) continue;
    effectiveStarts.push(start);
  }
  const blocks: PdfAgencyCategoryBlock[] = [];
  for (const [index, start] of effectiveStarts.entries()) {
    const next = effectiveStarts.slice(index + 1).find(({ row }) => row.page === start.row.page);
    const policyBoundary = rows.find((row) => (
      row.page === start.row.page
      && row.row > start.row.row
      && /계약해지에따른위약금및환급/u.test(pdfLayoutRowText(row).replace(/\s+/gu, ""))
    ));
    const endRow = Math.min(
      (next?.row.row ?? Number.POSITIVE_INFINITY) - 1,
      (policyBoundary?.row ?? Number.POSITIVE_INFINITY) - 1,
      Math.max(...rows.filter((row) => row.page === start.row.page).map((row) => row.row)),
    );
    const scopedRows = rows.filter((row) => (
      row.page === start.row.page && row.row >= start.row.row && row.row <= endRow
    ));
    const categories = [...new Set(scopedRows.flatMap((row) => (
      row.items.flatMap((item) => {
        const category = exactPdfAgencyCategory(item.text);
        return category ? [category] : [];
      })
    )))];
    const category = start.category ?? (categories.length === 1 ? categories[0]! : null);
    if (!category) continue;
    blocks.push({
      page: start.row.page,
      startRow: start.row.row,
      endRow,
      category,
      explicitHeading: start.explicitHeading,
      headingRow: start.row,
    });
  }
  return blocks;
}

function pdfAgencyVendorAnchors(
  layout: CanonicalPdfLayoutEvidence,
  block: PdfAgencyCategoryBlock,
): Array<{ row: CanonicalPdfLayoutRow; vendorName: string }> {
  const generic = /^(?:구분|사업자명|기본가격|선택품목|선택품목가격|본식|본식신랑신부|촬영해당없음|리허설무료|혼주메이크업:?|모|부|드레스도우미)$/u;
  const optionRole = /^(?:앨범(?:추가)?|액자(?:추가)?|원본(?:파일)?|업그레이드|야외(?:촬영)?|야간(?:촬영)?|출장(?:비)?|피팅(?:비)?|헬퍼(?:비)?|도우미(?:비)?|드레스도우미)$/u;
  return layout.rows.flatMap((row) => {
    if (
      row.page !== block.page
      || row.row <= block.startRow
      || row.row > block.endRow
      || !row.line
    ) return [];
    const left = cleanCellValue(
      row.items.filter((item) => item.x < 180).map((item) => item.text).join(" "),
    );
    const compact = left.replace(/\s+/gu, "");
    if (
      left.length < 2
      || left.length > 100
      || /\d/u.test(left)
      || generic.test(compact)
      || optionRole.test(compact)
      || exactPdfAgencyCategory(left) !== null
      || /(?:가격|금액|무료|해당없음|페이지|인치|회당|벌당|피팅)/u.test(left)
    ) return [];
    return [{ row, vendorName: left.slice(0, 300) }];
  });
}

function nearestPdfAgencyAnchor(
  anchors: Array<{ row: CanonicalPdfLayoutRow; vendorName: string }>,
  row: number,
  preferLaterOnTie: boolean,
): { row: CanonicalPdfLayoutRow; vendorName: string } | null {
  return [...anchors].sort((left, right) => (
    Math.abs(left.row.row - row) - Math.abs(right.row.row - row)
    || (preferLaterOnTie ? right.row.row - left.row.row : left.row.row - right.row.row)
  ))[0] ?? null;
}

function pdfLayoutAgencyExtraction(
  sources: LocalTextEvidence[],
): PdfLayoutAgencyExtractionResult {
  const result: PdfLayoutAgencyExtractionResult = {
    partnerVendors: [],
    sections: [],
    handledSourceIds: new Set<string>(),
    invalidSourceIds: new Set<string>(),
    quarantinedMoney: 0,
  };
  for (const source of sources) {
    const layout = parseCanonicalPdfLayoutEvidence(source);
    if (layout.status === "none") continue;
    if (layout.status === "invalid") {
      result.invalidSourceIds.add(source.sourceFileId);
      continue;
    }
    const blocks = pdfAgencyCategoryBlocks(layout);
    if (
      blocks.length !== 3
      || blocks.map(({ category }) => category).join(",") !== "studio,dress,makeup"
    ) continue;
    const projections = projectCanonicalPdfLayoutMoney(source.text);
    const projectedLocators = scannerAddedPdfProjectionLocators(source);
    const sourceVendors: StrictDisclosureExtraction["partner_vendors"] = [];
    let sourceQuarantine = 0;
    for (const block of blocks) {
      const anchors = pdfAgencyVendorAnchors(layout, block);
      const blockProjections = projections.filter((projection) => (
        projection.page === block.page
        && projection.row > block.startRow
        && projection.row <= block.endRow
        && projection.certifier !== "policy"
      ));
      const categoryRows = layout.rows.filter((row) => (
        row.page === block.page
        && row.row >= block.startRow
        && row.row <= block.endRow
        && row.items.some((item) => exactPdfAgencyCategory(item.text) === block.category)
      ));
      if (anchors.length === 0) {
        sourceQuarantine += blockProjections.length;
        continue;
      }
      const selected = blockProjections;
      for (const projection of selected) {
        if (!projectionUsesIsolatedMoneySlot(layout, projection)) {
          sourceQuarantine += 1;
          continue;
        }
        const owner = anchors
          .filter((candidate) => candidate.row.row <= projection.row)
          .sort((left, right) => right.row.row - left.row.row)[0] ?? null;
        if (!owner) {
          sourceQuarantine += 1;
          continue;
        }
        const categoryRow = block.explicitHeading
          ? block.headingRow
          : [...categoryRows].sort((left, right) => (
              Math.abs(left.row - owner.row.row) - Math.abs(right.row - owner.row.row)
            ))[0] ?? block.headingRow;
        const headerRow = pdfHeaderEvidenceRow(
          layout,
          projection,
          Math.max(1, block.startRow - 3),
        )
          ?? block.headingRow;
        let vendor = sourceVendors.find((candidate) => (
          candidate.category === block.category
          && normalizedPlainIdentity(candidate.vendor_name) === normalizedPlainIdentity(owner.vendorName)
        ));
        if (!vendor) {
          const vendorQuote = encodeMergedEvidenceQuote(
            pdfLayoutEvidenceFragments(source.sourceFileId, [
              pdfLayoutRowQuote(categoryRow),
              pdfLayoutRowQuote(owner.row),
            ]),
            1_000,
          ) ?? shortLineQuote(owner.row.line!, 1_000);
          vendor = {
            vendor_name: owner.vendorName,
            old_names: [],
            category: block.category,
            price_min_krw: null,
            price_max_krw: null,
            base_spec: null,
            price_note: null,
            options: [],
            policies: [],
            source_quote: vendorQuote,
            source_file_ids: [source.sourceFileId],
            confidence: 0.4,
            needs_review: true,
          };
          sourceVendors.push(vendor);
        }
        if (vendor.options.length >= 100) {
          sourceQuarantine += 1;
          continue;
        }
        const sourceQuote = encodeMergedEvidenceQuote(
          pdfLayoutEvidenceFragments(source.sourceFileId, [
            pdfLayoutRowQuote(categoryRow),
            pdfLayoutRowQuote(headerRow),
            pdfLayoutRowQuote(owner.row),
            scannerBoundProjectionQuote(projection, projectedLocators),
          ]),
          1_000,
        ) ?? scannerBoundProjectionQuote(projection, projectedLocators);
        vendor.options.push({
          name: exactPdfProjectionOptionName(projection),
          price_min_krw: projection.krw,
          price_max_krw: null,
          unit: null,
          condition: projection.condition?.slice(0, 1_000) ?? null,
          raw_text: projection.line_context.slice(0, 2_000),
          source_quote: sourceQuote,
          source_file_ids: [source.sourceFileId],
        });
      }
    }
    result.partnerVendors.push(...sourceVendors);
    result.handledSourceIds.add(source.sourceFileId);
    result.quarantinedMoney += sourceQuarantine;

    const policyByRow = new Map<string, PdfLayoutMoneyProjection[]>();
    for (const projection of projections.filter((candidate) => (
      candidate.certifier === "policy"
      && projectedLocators.has(candidate.source_locator)
    ))) {
      const key = `${projection.page}\0${projection.row}`;
      policyByRow.set(key, [...(policyByRow.get(key) ?? []), projection]);
    }
    for (const rowProjections of policyByRow.values()) {
      const first = rowProjections[0]!;
      const sourceQuote = encodeMergedEvidenceQuote(
        rowProjections.map((projection) => ({
          source_file_id: source.sourceFileId,
          quote: pdfProjectionQuote(projection, 1_700),
        })),
        2_000,
      ) ?? pdfProjectionQuote(first, 2_000);
      result.sections.push({
        section_type: "penalty",
        title: first.line_context.slice(0, 300),
        content_verbatim: first.line_context.slice(0, 20_000),
        summary: first.line_context.slice(0, 1_000),
        source_quote: sourceQuote,
        source_file_ids: [source.sourceFileId],
        confidence: 0.4,
        needs_review: true,
      });
    }
  }
  return result;
}

function sourceQuoteContainsExactLine(
  quote: string,
  sourceFileIdValue: string,
  lineNumber: number,
): boolean {
  const decoded = decodeEvidenceQuote(quote);
  const fragments = decoded.kind === "single"
    ? [{ source_file_id: sourceFileIdValue, quote: decoded.quote }]
    : decoded.kind === "merged" ? decoded.fragments : [];
  return fragments.some((fragment) => (
    fragment.source_file_id === sourceFileIdValue
    && fragment.quote.startsWith(`line:${lineNumber}:`)
  ));
}

function quarantineNonIsolatedPdfAgencySlots(
  sources: LocalTextEvidence[],
  partnerVendors: StrictDisclosureExtraction["partner_vendors"],
): number {
  let removed = 0;
  for (const source of sources) {
    const layout = parseCanonicalPdfLayoutEvidence(source);
    if (layout.status !== "valid") continue;
    const unsafe = projectCanonicalPdfLayoutMoney(source.text).filter((projection) => (
      !projectionUsesIsolatedMoneySlot(layout, projection)
    ));
    for (const projection of unsafe) {
      for (const vendor of partnerVendors) {
        const retained = vendor.options.filter((option) => !(
          (option.price_min_krw === projection.krw || option.price_max_krw === projection.krw)
          && sourceQuoteContainsExactLine(
            option.source_quote,
            source.sourceFileId,
            projection.lineNumber,
          )
        ));
        removed += vendor.options.length - retained.length;
        vendor.options = retained;
      }
    }
  }
  return removed;
}

function uniquePlainHallIdentities(lines: PlainTextLine[]): PlainTextLine[] {
  const candidates = lines.filter(isPlainHallIdentityLine);
  const tableScoped = new Set(candidates.filter((candidate) => lines.some((line) => (
    line.number < candidate.number
    && candidate.number - line.number <= 12
    && PLAIN_HALL_TABLE_HEADER_PATTERN.test(line.value)
  ))).map((candidate) => candidate.number));
  const groups: PlainTextLine[][] = [];
  for (const candidate of candidates) {
    const identity = normalizedPlainIdentity(plainHallDisplayName(candidate.value))
      .replace(/웨딩/gu, "");
    const group = groups.find((entries) => {
      const existing = normalizedPlainIdentity(plainHallDisplayName(entries[0]!.value))
        .replace(/웨딩/gu, "");
      return identity.includes(existing) || existing.includes(identity);
    });
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  return groups.map((entries) => (
    entries.find((entry) => tableScoped.has(entry.number)) ?? entries[0]!
  ));
}

function strictPlainHallFieldKind(
  value: string,
): "meal" | "venue" | "decoration" | null {
  if (
    ambiguousHallFeeLabel(value)
    || ambiguousMealVariantLabel(value)
    || /장식\s*추가/u.test(value)
  ) return null;
  const matches: Array<"meal" | "venue" | "decoration"> = [];
  if (PLAIN_HALL_MEAL_LABEL_PATTERN.test(value)) matches.push("meal");
  if (PLAIN_HALL_VENUE_LABEL_PATTERN.test(value)) matches.push("venue");
  if (PLAIN_HALL_DECORATION_LABEL_PATTERN.test(value)) matches.push("decoration");
  const distinct = [...new Set(matches)];
  return distinct.length === 1 ? distinct[0]! : null;
}

function meaningfulPlainOptionName(value: string, raw: string): string | null {
  const rawIndex = value.indexOf(raw);
  const prefix = cleanCellValue(rawIndex >= 0 ? value.slice(0, rawIndex) : "")
    .replace(/^[\-–—:：·ㆍ]+|[\-–—:：·ㆍ]+$/gu, "")
    .trim();
  if (
    prefix.length < 2
    || prefix.length > 120
    || PLAIN_HALL_OPTION_EXCLUSION_PATTERN.test(prefix)
    || PUBLIC_CONTACT_PATTERN.test(prefix)
  ) return null;
  return prefix;
}

function plainLineHallExtraction(
  sources: LocalTextEvidence[],
  canonicalName: string,
): {
  halls: LocalHall[];
  sections: NonNullable<DisclosureExtraction["sections"]>;
  quarantinedMoney: number;
} {
  const halls: LocalHall[] = [];
  const sections: NonNullable<DisclosureExtraction["sections"]> = [];
  let quarantinedMoney = 0;
  for (const source of sources) {
    const lines = plainTextLines(source);
    const lineByNumber = new Map(lines.map((line) => [line.number, line]));
    const primaryLines = lines.filter((line) => !/^ocr:page:\d+:line:\d+:/u.test(line.quoteValue));
    const hallIdentities = uniquePlainHallIdentities(primaryLines);
    const identityLine = hallIdentities.length === 1 ? hallIdentities[0]! : null;
    const scanned = scanSourceMoneyOccurrences(source.text);
    const structuredPrimary = scanned.filter((occurrence) => {
      const lineNumber = lineNumberFromLocator(occurrence.source_locator);
      const line = lineNumber === null ? null : lineByNumber.get(lineNumber);
      if (!line || /^ocr:page:\d+:line:\d+:/u.test(line.quoteValue)) return false;
      if (POLICY_PATTERN.test(line.value)) return false;
      return !sourceMoneyRequiresStructuredQuarantine(occurrence);
    });
    quarantinedMoney += scanned.filter((occurrence) => {
      const lineNumber = lineNumberFromLocator(occurrence.source_locator);
      const line = lineNumber === null ? null : lineByNumber.get(lineNumber);
      return Boolean(
        line
        && !/^ocr:page:\d+:line:\d+:/u.test(line.quoteValue)
        && !POLICY_PATTERN.test(line.value)
        && !structuredPrimary.includes(occurrence),
      );
    }).length;

    const occurrencesByLine = new Map<number, MoneyOccurrence[]>();
    for (const occurrence of structuredPrimary) {
      const lineNumber = lineNumberFromLocator(occurrence.source_locator);
      if (lineNumber === null) continue;
      occurrencesByLine.set(lineNumber, [
        ...(occurrencesByLine.get(lineNumber) ?? []),
        occurrence,
      ]);
    }
    const groups: Array<{
      lines: PlainTextLine[];
      occurrences: MoneyOccurrence[];
      label: PlainTextLine;
      kind: "meal" | "venue" | "decoration" | "option";
    }> = [];
    const fieldEvidence: PlainTextLine[] = [];
    if (identityLine) {
      const identityIndex = primaryLines.findIndex((line) => line.number === identityLine.number);
      const nearby = primaryLines.slice(identityIndex, identityIndex + 20);
      const priorLines = primaryLines.slice(Math.max(0, identityIndex - 15), identityIndex);
      const priorHeaderIndex = [...priorLines]
        .map((line, index) => ({ line, index }))
        .reverse()
        .find(({ line }) => PLAIN_HALL_TABLE_HEADER_PATTERN.test(line.value))?.index ?? -1;
      const priorHeaderLines = priorHeaderIndex >= 0 ? priorLines.slice(priorHeaderIndex) : [];
      const priorHeader = priorHeaderLines[0] ?? null;
      const priorHeaderContext = priorHeaderLines.map((line) => line.value).join(" ");
      const typedNearby = priorHeader ? nearby : nearby.slice(0, 10);

      for (const line of typedNearby) {
        const occurrences = occurrencesByLine.get(line.number) ?? [];
        if (occurrences.length === 0) continue;
        const kind = strictPlainHallFieldKind(line.value);
        const repeatedSameKindLabels = kind === "meal"
          ? [...line.value.matchAll(PLAIN_HALL_MEAL_LABEL_GLOBAL_PATTERN)].length
          : 0;
        const explicitRange = occurrences.length === 1
          || /(?:~|～|〜|–|—|\b부터\b|\b최소\b|\b최대\b)/u.test(line.value)
          || (occurrences.length <= 2 && repeatedSameKindLabels >= occurrences.length);
        if (kind && explicitRange) {
          groups.push({ lines: [line], occurrences, label: line, kind });
          continue;
        }

        // Some official PDF tables collapse two adjacent columns into one
        // line. Accept only the exact, auditable shape: the source header
        // declares meal before venue/decoration and the row contains two
        // explicit two-value ranges in that same order.
        if (
          priorHeader
          && occurrences.length === 4
          && PLAIN_HALL_MEAL_LABEL_PATTERN.test(priorHeaderContext)
          && PLAIN_HALL_VENUE_LABEL_PATTERN.test(priorHeaderContext)
          && (line.value.match(/[~～〜–—]/gu)?.length ?? 0) >= 2
        ) {
          groups.push({
            lines: [line],
            occurrences: occurrences.slice(0, 2),
            label: priorHeader,
            kind: "meal",
          });
          if (!ambiguousHallFeeLabel(priorHeaderContext)) {
            groups.push({
              lines: [line],
              occurrences: occurrences.slice(2, 4),
              label: priorHeader,
              kind: "venue",
            });
          }
          fieldEvidence.push(priorHeader);
          continue;
        }

        // A single amount-only cell is safe as a meal only when it sits in
        // the first table, after a declared 식비 header, and before an
        // explicit venue/decoration row. This covers DOCX table projection
        // without borrowing labels across arbitrary lines.
        if (
          priorHeader
          && occurrences.length === 1
          && PLAIN_HALL_MEAL_LABEL_PATTERN.test(priorHeaderContext)
          && PLAIN_HALL_VENUE_LABEL_PATTERN.test(priorHeaderContext)
          && !/[\p{L}]/u.test(line.value.replace(/(?:KRW|원)/giu, ""))
          && nearby.some((candidate) => (
            candidate.number > line.number
            && candidate.number - line.number <= 3
            && PLAIN_HALL_VENUE_LABEL_PATTERN.test(candidate.value)
          ))
        ) {
          groups.push({ lines: [line], occurrences, label: priorHeader, kind: "meal" });
          fieldEvidence.push(priorHeader);
          continue;
        }

        if (
          priorHeader
          && occurrences.length === 1
          && PLAIN_HALL_MEAL_LABEL_PATTERN.test(priorHeaderContext)
          && PLAIN_HALL_VENUE_LABEL_PATTERN.test(priorHeaderContext)
          && /(?:기본\s*[\d,]+\s*명|추가\s*[\d,]+\s*명당)/u.test(line.value)
        ) {
          groups.push({ lines: [line], occurrences, label: priorHeader, kind: "meal" });
          fieldEvidence.push(priorHeader);
        }
      }

      const claimedTypedLines = new Set(groups.flatMap((group) => (
        group.lines.map((line) => line.number)
      )));
      for (const [nearbyIndex, line] of typedNearby.entries()) {
        if (claimedTypedLines.has(line.number)) continue;
        const occurrences = occurrencesByLine.get(line.number) ?? [];
        if (occurrences.length !== 1) continue;
        const precedingCandidates = typedNearby
          .slice(Math.max(0, nearbyIndex - 2), nearbyIndex)
          .reverse();
        const label = precedingCandidates.find((candidate) => (
          strictPlainHallFieldKind(candidate.value) !== null
          && (occurrencesByLine.get(candidate.number)?.length ?? 0) === 0
        ));
        if (!label) continue;
        const intervening = typedNearby.filter((candidate) => (
          candidate.number > label.number && candidate.number < line.number
        ));
        if (intervening.some((candidate) => (
          (occurrencesByLine.get(candidate.number)?.length ?? 0) > 0
          || strictPlainHallFieldKind(candidate.value) !== null
          || PLAIN_HALL_TABLE_HEADER_PATTERN.test(candidate.value)
          || isPlainHallIdentityLine(candidate)
          || POLICY_PATTERN.test(candidate.value)
          || PUBLIC_CONTACT_PATTERN.test(candidate.value)
        ))) continue;
        const kind = strictPlainHallFieldKind(label.value);
        if (!kind) continue;
        const groupLines = [line];
        const groupOccurrences = [...occurrences];
        const nextLine = typedNearby[nearbyIndex + 1];
        const nextOccurrences = nextLine
          ? occurrencesByLine.get(nextLine.number) ?? []
          : [];
        if (
          /[~～〜–—]\s*$/u.test(line.value)
          && nextLine?.number === line.number + 1
          && nextOccurrences.length === 1
          && strictPlainHallFieldKind(nextLine.value) === null
        ) {
          groupLines.push(nextLine);
          groupOccurrences.push(...nextOccurrences);
        }
        groups.push({ lines: groupLines, occurrences: groupOccurrences, label, kind });
        for (const claimed of groupLines) claimedTypedLines.add(claimed.number);
      }

      const typedLineNumbers = new Set(groups.flatMap((group) => (
        group.lines.map((line) => line.number)
      )));
      const optionBoundary = primaryLines.find((line) => (
        line.number > identityLine.number
        && POLICY_PATTERN.test(line.value)
      ))?.number ?? Number.POSITIVE_INFINITY;
      for (const line of primaryLines.filter((candidate) => (
        candidate.number > identityLine.number
        && candidate.number < optionBoundary
        && !typedLineNumbers.has(candidate.number)
      ))) {
        const occurrences = occurrencesByLine.get(line.number) ?? [];
        if (occurrences.length === 0 || occurrences.length > 2) continue;
        if (
          occurrences.length === 2
          && !/(?:~|～|〜|–|—)/u.test(line.value)
        ) continue;
        const optionName = meaningfulPlainOptionName(line.value, occurrences[0]!.raw);
        if (
          !optionName
          || strictPlainHallFieldKind(optionName)
          || !PLAIN_HALL_SAFE_OPTION_LABEL_PATTERN.test(optionName)
        ) continue;
        groups.push({ lines: [line], occurrences, label: { ...line, value: optionName }, kind: "option" });
      }
    }
    const groupedOccurrenceKeys = new Set(groups.flatMap((group) => (
      group.occurrences.map((occurrence) => (
        `${occurrence.source_locator}\0${occurrence.raw}\0${occurrence.krw}`
      ))
    )));
    quarantinedMoney += structuredPrimary.filter((occurrence) => (
      !groupedOccurrenceKeys.has(
        `${occurrence.source_locator}\0${occurrence.raw}\0${occurrence.krw}`,
      )
    )).length;

    if (identityLine) {
      const hall: LocalHall = {
        hall_name: plainHallDisplayName(identityLine.value).slice(0, 300),
        guarantee_min: null,
        meal_price_min_krw: null,
        meal_price_max_krw: null,
        venue_fee_min_krw: null,
        venue_fee_max_krw: null,
        venue_fee_note: null,
        decoration_fee_min_krw: null,
        decoration_fee_max_krw: null,
        decoration_note: null,
        options: [],
        source_quote: shortLineQuote(identityLine, 2_000),
        source_file_ids: [source.sourceFileId],
        confidence: 0.35,
        needs_review: true,
      };
      const guaranteeLine = primaryLines.find((line) => (
        line.number >= identityLine.number
        && line.number <= identityLine.number + 4
        && /(?:기본|최소\s*보증|보증|개런티)?\s*[\d,]+\s*명/u.test(line.value)
      )) ?? null;
      const guaranteeMatch = guaranteeLine?.value.match(
        /(?:기본|최소\s*보증|보증|개런티)?\s*([\d,]+)\s*명/u,
      );
      if (guaranteeMatch) {
        const guarantee = Number.parseInt(guaranteeMatch[1]!.replace(/,/gu, ""), 10);
        if (Number.isSafeInteger(guarantee) && guarantee > 0) hall.guarantee_min = guarantee;
      }
      const aggregateEvidence = new Map<number, PlainTextLine>([
        [identityLine.number, identityLine],
        ...fieldEvidence.map((line) => [line.number, line] as const),
        ...(guaranteeLine ? [[guaranteeLine.number, guaranteeLine] as const] : []),
      ]);
      for (const kind of ["meal", "venue", "decoration"] as const) {
        const matchingGroups = groups.filter((group) => group.kind === kind);
        const values = matchingGroups.flatMap((group) => group.occurrences.map((entry) => entry.krw));
        const range = minMax(values);
        if (kind === "meal") {
          hall.meal_price_min_krw = range.minimum;
          hall.meal_price_max_krw = range.maximum;
        } else if (kind === "venue") {
          hall.venue_fee_min_krw = range.minimum;
          hall.venue_fee_max_krw = range.maximum;
        } else {
          hall.decoration_fee_min_krw = range.minimum;
          hall.decoration_fee_max_krw = range.maximum;
        }
        const aggregateOwners = new Set<typeof matchingGroups[number]>();
        for (const amount of new Set([range.minimum, range.maximum])) {
          if (amount === null) continue;
          const owner = matchingGroups.find((group) => (
            group.occurrences.some((entry) => entry.krw === amount)
          ));
          if (owner) aggregateOwners.add(owner);
        }
        for (const owner of aggregateOwners) {
          aggregateEvidence.set(owner.label.number, owner.label);
          for (const line of owner.lines) aggregateEvidence.set(line.number, line);
        }
        for (const group of matchingGroups) {
          aggregateEvidence.set(group.label.number, group.label);
          for (const line of group.lines) aggregateEvidence.set(line.number, line);
        }
      }
      for (const group of groups.filter((candidate) => candidate.kind === "option")) {
        if (hall.options.length >= 200) break;
        const values = group.occurrences.map((entry) => entry.krw);
        hall.options.push({
          name: group.label.value.slice(0, 300),
          price_min_krw: Math.min(...values),
          price_max_krw: Math.max(...values),
          unit: null,
          condition: null,
          raw_text: group.lines[0]!.value.slice(0, 2_000),
          source_quote: mergedLineQuote([identityLine, ...group.lines], 1_000)
            ?? shortLineQuote(group.lines[0]!, 1_000),
          source_file_ids: [source.sourceFileId],
        });
      }
      hall.source_quote = mergedLineQuote([...aggregateEvidence.values()], 2_000)
        ?? hall.source_quote;
      halls.push(hall);
    } else {
      for (const hallIdentity of hallIdentities) {
        halls.push({
          hall_name: plainHallDisplayName(hallIdentity.value).slice(0, 300),
          guarantee_min: null,
          meal_price_min_krw: null,
          meal_price_max_krw: null,
          venue_fee_min_krw: null,
          venue_fee_max_krw: null,
          venue_fee_note: null,
          decoration_fee_min_krw: null,
          decoration_fee_max_krw: null,
          decoration_note: null,
          options: [],
          source_quote: shortLineQuote(hallIdentity, 2_000),
          source_file_ids: [source.sourceFileId],
          confidence: 0.3,
          needs_review: true,
        });
      }
    }

    const structuredLineNumbers = new Set(lines.flatMap((line) => {
      const lineOccurrences = scanned.filter((occurrence) => (
        lineNumberFromLocator(occurrence.source_locator) === line.number
      ));
      if (lineOccurrences.length === 0) return [];
      const allOccurrencesStructured = lineOccurrences.every((occurrence) => (
        groupedOccurrenceKeys.has(
          `${occurrence.source_locator}\0${occurrence.raw}\0${occurrence.krw}`,
        )
      ));
      return allOccurrencesStructured ? [line.number] : [];
    }));
    for (const line of lines) {
      const lineNumberOccurrences = scanned.filter((occurrence) => (
        lineNumberFromLocator(occurrence.source_locator) === line.number
      ));
      const isOcr = /^ocr:page:\d+:line:\d+:/u.test(line.quoteValue);
      const policy = POLICY_PATTERN.test(line.value);
      const quarantined = lineNumberOccurrences.length > 0 && !structuredLineNumbers.has(line.number);
      if (!policy && !isOcr && !quarantined) continue;
      if (!policy && lineNumberOccurrences.length === 0) continue;
      sections.push({
        section_type: policy ? policySectionType(line.value) : "other",
        title: line.value.slice(0, 300),
        content_verbatim: line.value.slice(0, 20_000),
        summary: line.value.slice(0, 1_000),
        source_quote: shortLineQuote(line, 2_000),
        source_file_ids: [source.sourceFileId],
        confidence: 0.3,
        needs_review: true,
      });
    }
  }
  return { halls, sections, quarantinedMoney };
}

const GENERIC_DOCUMENT_TITLE_PATTERN = /^(?:예식장업|예식장|웨딩홀|호텔|컨벤션|구분|가격표?|금액|공시|안내|sheet\d*)$/iu;

const BUSINESS_IDENTITY_REGION_AFFIXES = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
  "대전광역시", "울산광역시", "세종특별자치시", "제주특별자치도",
  "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도",
  "전라남도", "경상북도", "경상남도", "서울", "부산", "대구", "인천",
  "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남",
  "전북", "전남", "경북", "경남", "제주", "강남",
] as const;

function normalizedDocumentIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase("ko-KR");
}

function regionNormalizedDocumentIdentities(value: string): Set<string> {
  const base = normalizedDocumentIdentity(cleanCellValue(value));
  const forms = new Set(base ? [base] : []);
  const normalizedAffixes = BUSINESS_IDENTITY_REGION_AFFIXES
    .map(normalizedDocumentIdentity)
    .sort((left, right) => right.length - left.length);
  for (const candidate of [...forms]) {
    for (const affix of normalizedAffixes) {
      if (candidate.startsWith(affix) && candidate.length > affix.length + 1) {
        forms.add(candidate.slice(affix.length));
      }
      if (candidate.endsWith(affix) && candidate.length > affix.length + 1) {
        forms.add(candidate.slice(0, -affix.length));
      }
    }
  }
  return forms;
}

function documentTitleName(value: string): string | null {
  const title = cleanCellValue(value)
    .replace(/^[^\p{L}\p{N}]+/gu, "")
    .replace(/^\d{4}\s*(?=\p{L})/u, "")
    .trim();
  if (
    title.length < 2
    || title.length > 120
    || !/[\p{L}]/u.test(title)
    || GENERIC_DOCUMENT_TITLE_PATTERN.test(title)
    || /^(?:웨딩\s*)?서비스\s*이용\s*약관$/u.test(title)
    || PLACEHOLDER_HALL_PATTERN.test(title)
    || POLICY_PATTERN.test(title)
    || PUBLIC_CONTACT_PATTERN.test(title)
    || PRICING_BASIS_HEADING_PATTERN.test(title)
    || scanSourceMoneyOccurrences(title).length > 0
  ) return null;
  return title;
}

function workbookScopeKey(sourceFileId: string, sheet: string): string {
  return `${sourceFileId}\0${sheet}`;
}

function identitiesReferToSameBusiness(left: string, right: string): boolean {
  const leftForms = regionNormalizedDocumentIdentities(left);
  const rightForms = regionNormalizedDocumentIdentities(right);
  for (const normalizedLeft of leftForms) {
    for (const normalizedRight of rightForms) {
      if (normalizedLeft.length < 2 || normalizedRight.length < 2) continue;
      if (
        normalizedLeft === normalizedRight
        // Keep legacy legal/display suffix compatibility without ever
        // reordering business words. Regional affixes are stripped above;
        // any remaining relation must stay at a literal string boundary.
        || normalizedLeft.startsWith(normalizedRight)
        || normalizedLeft.endsWith(normalizedRight)
        || normalizedRight.startsWith(normalizedLeft)
        || normalizedRight.endsWith(normalizedLeft)
      ) return true;
    }
  }
  return false;
}

function explicitSheetBusinessIdentity(cells: WorkbookCell[]): {
  cell: WorkbookCell;
  name: string;
} | null {
  const firstCell = cells
    .filter((cell) => cell.row === 1 && cell.column === 1)
    .sort((left, right) => left.address.localeCompare(right.address, "en"))[0];
  if (!firstCell) return null;
  const name = documentTitleName(firstCell.value);
  if (!name) return null;
  const markedTitle = /^[^\p{L}\p{N}]{1,8}\s*[\p{L}\p{N}]/u.test(
    cleanCellValue(firstCell.value),
  );
  if (!markedTitle && !BUSINESS_IDENTITY_TITLE_PATTERN.test(name)) return null;
  return { cell: firstCell, name };
}

function crossBusinessSheetIdentities(
  evidence: WorkbookEvidence,
  canonicalName: string,
): Array<{ scopeKey: string; sheet: string; identity: string }> {
  const scopes = [...new Set(evidence.cells.map((cell) => (
    workbookScopeKey(cell.sourceFileId, cell.sheet)
  )))];
  const identities = scopes.flatMap((scopeKey) => {
    const [sourceFileId, sheet] = scopeKey.split("\0") as [string, string];
    const identity = explicitSheetBusinessIdentity(evidence.cells.filter((cell) => (
      cell.sourceFileId === sourceFileId && cell.sheet === sheet
    )));
    return identity ? [{ scopeKey, sheet, identity: identity.name }] : [];
  });
  // Canonical metadata can name an owning agency or upload folder rather than
  // the one business printed in a single-sheet disclosure. Fence only when at
  // least one sheet positively establishes the canonical business and another
  // sheet positively establishes a different business.
  if (!identities.some(({ identity }) => (
    identitiesReferToSameBusiness(identity, canonicalName)
  ))) return [];
  return identities.filter(({ identity }) => (
    !identitiesReferToSameBusiness(identity, canonicalName)
  ));
}

function selfBusinessPartnerVendors(
  evidence: WorkbookEvidence,
  structuredLocatedMoney: LocatedMoney[],
  canonicalName: string,
  packageRanges: PackageAnchor[],
  existingVendors: StrictDisclosureExtraction["partner_vendors"],
): {
  partnerVendors: StrictDisclosureExtraction["partner_vendors"];
  linkedLocators: Set<string>;
  optionOverflow: number;
  semanticQuarantine: number;
} {
  const partnerVendors: StrictDisclosureExtraction["partner_vendors"] = [];
  const linkedLocators = new Set<string>();
  let optionOverflow = 0;
  let semanticQuarantine = 0;
  const scopes = [...new Set(evidence.cells.map((cell) => (
    workbookScopeKey(cell.sourceFileId, cell.sheet)
  )))];
  for (const scopeKey of scopes) {
    const [sourceFileId, sheet] = scopeKey.split("\0") as [string, string];
    const sheetCells = evidence.cells
      .filter((cell) => cell.sourceFileId === sourceFileId && cell.sheet === sheet)
      .sort((left, right) => left.row - right.row || left.column - right.column);
    const identity = explicitSheetBusinessIdentity(sheetCells);
    if (!identity || !identitiesReferToSameBusiness(identity.name, canonicalName)) continue;
    const businessHeaders = sheetCells.filter((cell) => (
      BUSINESS_HEADER_PATTERN.test(cleanCellValue(cell.value))
    ));
    const sheetPackageRanges = packageRanges.filter((range) => (
      range.cell.sourceFileId === sourceFileId && range.cell.sheet === sheet
    ));
    const hasSelfBusinessHeader = businessHeaders.some((cell) => (
      /^사업장명$/u.test(cleanCellValue(cell.value))
    ));
    const hasExplicitPackageRanges = sheetPackageRanges.some(({ explicit }) => explicit);
    const hasStandalonePriceHeading = sheetCells.some((cell) => (
      cell.row <= 4
      && (PRICING_BASIS_HEADING_PATTERN.test(cleanCellValue(cell.value))
        || /^(?:\d+\s*[.)]?\s*)?가격/u.test(cleanCellValue(cell.value)))
    ));
    if (
      !hasSelfBusinessHeader
      && !hasExplicitPackageRanges
      && !(businessHeaders.length === 0 && hasStandalonePriceHeading)
    ) continue;
    const firstPolicyBoundaryRow = sheetCells
      .filter(isDocumentPolicyBoundaryCell)
      .reduce((minimum, cell) => Math.min(minimum, cell.row), Number.POSITIVE_INFINITY);
    const dataEndRow = Number.isFinite(firstPolicyBoundaryRow)
      ? firstPolicyBoundaryRow - 1
      : Number.POSITIVE_INFINITY;
    const inPackageRange = (cell: WorkbookCell): boolean => sheetPackageRanges.some((range) => (
      cell.row >= range.cell.row && cell.row <= range.endRow
    ));
    const categoryEvidence = sheetCells.flatMap((cell) => (
      inPackageRange(cell) || cell.row > dataEndRow
        ? []
        : categoriesFromText(cell.value).map((category) => ({ cell, category }))
    )).filter(({ cell }) => (
      cellKey(cell) !== cellKey(identity.cell)
      && !POLICY_PATTERN.test(cleanCellValue(cell.value))
    ));
    const orderedCategories = [...new Set(categoryEvidence.map(({ category }) => category))];
    for (const category of orderedCategories) {
      const evidenceForCategory = categoryEvidence.filter((entry) => entry.category === category);
      const firstCategoryEvidence = evidenceForCategory[0]?.cell;
      if (!firstCategoryEvidence) continue;
      const alreadyRepresented = [...existingVendors, ...partnerVendors].some((vendor) => (
        vendor.category === category
        && vendor.source_file_ids.includes(sourceFileId)
        && identitiesReferToSameBusiness(vendor.vendor_name, identity.name)
      ));
      if (alreadyRepresented) continue;
      const occurrenceCategory = (entry: LocatedMoney): VendorCategory | null => {
        const sameRow = categoryEvidence
          .filter(({ cell }) => cell.row === entry.cell.row)
          .map(({ category: rowCategory }) => rowCategory);
        const sameRowDistinct = [...new Set(sameRow)];
        if (sameRowDistinct.length === 1) return sameRowDistinct[0]!;
        return categoryEvidence
          .filter(({ cell }) => cell.row < entry.cell.row)
          .sort((left, right) => right.cell.row - left.cell.row || right.cell.column - left.cell.column)[0]
          ?.category ?? null;
      };
      const occurrences = structuredLocatedMoney.filter((entry) => (
        entry.cell.sourceFileId === sourceFileId
        && entry.cell.sheet === sheet
        && entry.cell.row <= dataEndRow
        && !inPackageRange(entry.cell)
        && !POLICY_PATTERN.test(entry.occurrence.line_context)
        && occurrenceCategory(entry) === category
      ));
      const options: LocalPriceOption[] = [];
      for (const entry of occurrences.slice(0, 100)) {
        const peers = optionRangePeers(occurrences, entry);
        const option = optionFromOccurrence(
          evidence,
          entry,
          null,
          [identity.cell, firstCategoryEvidence],
          peers,
        );
        if (!option) {
          semanticQuarantine += 1;
          continue;
        }
        options.push(option);
        for (const peer of peers) linkedLocators.add(locatedMoneyLinkKey(peer));
      }
      optionOverflow += Math.max(0, occurrences.length - 100);
      partnerVendors.push({
        vendor_name: identity.name.slice(0, 300),
        old_names: [],
        category,
        price_min_krw: null,
        price_max_krw: null,
        base_spec: null,
        price_note: null,
        options: dedupeOptions(options),
        policies: [],
        source_quote: mergedQuote([identity.cell, firstCategoryEvidence], 1_000)
          ?? shortCellQuote(identity.cell, identity.cell.value, 1_000),
        source_file_ids: [sourceFileId],
        confidence: 0.35,
        needs_review: true,
      });
    }
  }
  return {
    partnerVendors,
    linkedLocators,
    optionOverflow,
    semanticQuarantine,
  };
}

function sourceBackedVenueIdentity(
  evidence: WorkbookEvidence,
  sources: LocalTextEvidence[],
  canonicalName: string,
): LocalHall | null {
  const canonicalIdentity = normalizedDocumentIdentity(canonicalName);
  const candidates: Array<{
    name: string;
    sourceQuote: string;
    sourceFileId: string;
    score: number;
    order: number;
  }> = [];
  for (const cell of evidence.cells.filter((candidate) => candidate.row <= 3)) {
    const name = documentTitleName(cell.value);
    if (!name) continue;
    const identity = normalizedDocumentIdentity(name);
    const canonicalRelated = canonicalIdentity.length >= 2
      && (identity.includes(canonicalIdentity) || canonicalIdentity.includes(identity));
    const markedTitle = /^[^\p{L}\p{N}]{1,8}\s*[\p{L}\p{N}]/u.test(
      cleanCellValue(cell.value),
    );
    const hasNearbyPriceHeading = evidence.cells.some((candidate) => (
      candidate.sourceFileId === cell.sourceFileId
      && candidate.sheet === cell.sheet
      && candidate.row <= 3
      && (PRICING_BASIS_HEADING_PATTERN.test(cleanCellValue(candidate.value))
        || /(?:가격|금액)\s*(?:\(|（|\[|:|：|$)/u.test(cleanCellValue(candidate.value)))
    ));
    if (!canonicalRelated && !markedTitle && !(cell.row === 1 && hasNearbyPriceHeading)) continue;
    candidates.push({
      name,
      sourceQuote: shortCellQuote(cell, cell.value, 2_000),
      sourceFileId: cell.sourceFileId,
      score: (canonicalRelated ? 30 : 0) + (markedTitle ? 20 : 0)
        + (cell.row === 1 ? 10 : 0) + (hasNearbyPriceHeading ? 5 : 0),
      order: cell.row * 1_000 + cell.column,
    });
  }
  for (const source of sources) {
    if (evidence.cells.some((cell) => cell.sourceFileId === source.sourceFileId)) continue;
    const lines = plainTextLines(source).filter((line) => (
      line.number <= 8
      && !/^ocr:page:\d+:line:\d+:/u.test(line.quoteValue)
      && !isConverterReviewMetadataLine(line.quoteValue)
    ));
    const hasNearbyPriceHeading = lines.some((line) => (
      PRICING_BASIS_HEADING_PATTERN.test(line.value)
      || /(?:가격|금액)\s*(?:\(|（|\[|:|：|$)/u.test(line.value)
    ));
    for (const line of lines) {
      const name = documentTitleName(line.value);
      if (!name) continue;
      const identity = normalizedDocumentIdentity(name);
      const canonicalRelated = canonicalIdentity.length >= 2
        && (identity.includes(canonicalIdentity) || canonicalIdentity.includes(identity));
      const markedTitle = /^[^\p{L}\p{N}]{1,8}\s*[\p{L}\p{N}]/u.test(line.value);
      if (!canonicalRelated && !markedTitle && !(line.number === 1 && hasNearbyPriceHeading)) continue;
      candidates.push({
        name,
        sourceQuote: shortLineQuote(line, 2_000),
        sourceFileId: source.sourceFileId,
        score: (canonicalRelated ? 30 : 0) + (markedTitle ? 20 : 0)
          + (line.number === 1 ? 10 : 0) + (hasNearbyPriceHeading ? 5 : 0),
        order: line.number,
      });
    }
  }
  const candidate = candidates.sort((left, right) => (
    right.score - left.score
    || left.order - right.order
    || left.name.localeCompare(right.name, "ko")
  ))[0];
  if (!candidate) return null;
  return {
    hall_name: candidate.name.slice(0, 300),
    guarantee_min: null,
    meal_price_min_krw: null,
    meal_price_max_krw: null,
    venue_fee_min_krw: null,
    venue_fee_max_krw: null,
    venue_fee_note: null,
    decoration_fee_min_krw: null,
    decoration_fee_max_krw: null,
    decoration_note: null,
    options: [],
    source_quote: candidate.sourceQuote,
    source_file_ids: [candidate.sourceFileId],
    confidence: 0.25,
    needs_review: true,
  };
}

interface HallXlsxTopologySource {
  source: LocalTextEvidence;
  topology: HallXlsxTopologyExtraction;
}

function isCanonicalXlsxSourceText(text: string): boolean {
  return /^##\s*시트:\s*.+$/mu.test(text)
    && /^.+![A-Z]+[1-9][0-9]*:\s*.*$/mu.test(text);
}

function topologyEvidenceQuote(
  sourceFileIdValue: string,
  quotes: readonly string[],
  maximum: number,
): string {
  const unique = [...new Set(quotes.filter((quote) => quote.trim().length > 0))];
  const merged = encodeMergedEvidenceQuote(
    unique.map((quote) => ({ source_file_id: sourceFileIdValue, quote })),
    maximum,
  );
  return merged ?? unique[0]!.slice(0, maximum);
}

function topologyOccurrenceQuote(
  topology: HallXlsxTopologyExtraction,
  occurrence: HallXlsxTopologyExtraction["money_occurrences"][number],
): string {
  const conditionById = new Map(topology.conditions.map((condition) => [
    condition.condition_id,
    condition,
  ]));
  return topologyEvidenceQuote(
    occurrence.source_file_id,
    [
      occurrence.source_quote,
      ...occurrence.condition_ids.flatMap((conditionId) => {
        const condition = conditionById.get(conditionId);
        return condition ? [condition.source_quote] : [];
      }),
    ],
    2_000,
  );
}

function exactTopologyHalls(
  existingHalls: LocalHall[],
  topologySources: readonly HallXlsxTopologySource[],
  evidence: WorkbookEvidence,
  existingOwnedOccurrences: ReadonlySet<string>,
): { halls: LocalHall[]; optionOverflow: number; hallQuarantine: number } {
  const exactKey = (value: string): string => value
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("ko");
  const componentKeysBySource = new Map<string, Set<string>>();
  const splitCompositeKeysBySource = new Map<string, Set<string>>();
  for (const { topology } of topologySources) {
    for (const component of topology.hall_components) {
      const keys = componentKeysBySource.get(component.source_file_id) ?? new Set<string>();
      keys.add(exactKey(component.hall_name));
      componentKeysBySource.set(component.source_file_id, keys);
    }
    const componentsByAnchor = new Map<string, HallXlsxTopologyExtraction["hall_components"]>();
    for (const component of topology.hall_components) {
      for (const [index, locator] of component.source_locators.entries()) {
        const anchorKey = `${component.source_file_id}\0${locator}`;
        const siblings = [...(componentsByAnchor.get(anchorKey) ?? []), component];
        componentsByAnchor.set(anchorKey, siblings);
        if (new Set(siblings.map(({ hall_id: hallId }) => hallId)).size < 2) continue;
        const quote = component.source_quotes[index] ?? component.source_quotes[0];
        const payload = quote?.replace(/^.+![A-Z]+[1-9][0-9]*:\s*/u, "").trim();
        if (!payload) continue;
        const keys = splitCompositeKeysBySource.get(component.source_file_id) ?? new Set<string>();
        keys.add(exactKey(payload));
        splitCompositeKeysBySource.set(component.source_file_id, keys);
      }
    }
  }
  let hallQuarantine = 0;
  let optionOverflow = 0;
  const halls: LocalHall[] = [];
  const coalescedBySourceAndName = new Map<string, LocalHall>();
  for (const candidate of existingHalls) {
    const topologyOwners = candidate.source_file_ids.filter((sourceFileIdValue) => (
      (componentKeysBySource.get(sourceFileIdValue)?.size ?? 0) > 0
    ));
    if (topologyOwners.length !== 1 || candidate.source_file_ids.length !== 1) {
      halls.push(candidate);
      continue;
    }
    const hallName = candidate.hall_name;
    const key = typeof hallName === "string" ? exactKey(hallName) : "";
    if (key && splitCompositeKeysBySource.get(topologyOwners[0]!)?.has(key)) {
      hallQuarantine += 1;
      continue;
    }
    if (!key || !componentKeysBySource.get(topologyOwners[0]!)!.has(key)) {
      halls.push(candidate);
      continue;
    }
    const coalesceKey = `${topologyOwners[0]}\0${key}`;
    const existing = coalescedBySourceAndName.get(coalesceKey);
    if (!existing) {
      halls.push(candidate);
      coalescedBySourceAndName.set(coalesceKey, candidate);
      continue;
    }
    const mergedOptions = dedupeOptions([...existing.options, ...candidate.options]);
    optionOverflow += Math.max(0, mergedOptions.length - 200);
    existing.options = mergedOptions.slice(0, 200);
    existing.source_file_ids = [...new Set([...existing.source_file_ids, ...candidate.source_file_ids])];
    existing.confidence = Math.min(existing.confidence, candidate.confidence);
    existing.needs_review = existing.needs_review || candidate.needs_review;
    for (const field of [
      "guarantee_min",
      "meal_price_min_krw",
      "meal_price_max_krw",
      "venue_fee_min_krw",
      "venue_fee_max_krw",
      "decoration_fee_min_krw",
      "decoration_fee_max_krw",
    ] as const) {
      if (existing[field] === null) existing[field] = candidate[field];
      else if (candidate[field] !== null && existing[field] !== candidate[field]) {
        existing[field] = null;
        hallQuarantine += 1;
      }
    }
    for (const field of ["venue_fee_note", "decoration_note"] as const) {
      if (existing[field] === null) existing[field] = candidate[field];
      else if (candidate[field] !== null && existing[field] !== candidate[field]) {
        existing[field] = [...new Set([existing[field], candidate[field]])].join(" · ").slice(0, 4_000);
      }
    }
  }
  const cellQuoteByLocator = new Map(evidence.cells.map((cell) => [
    `${cell.sourceFileId}\0${cell.sheet}!${cell.address}`,
    shortCellQuote(cell, cell.value, 900),
  ]));
  for (const { topology } of topologySources) {
    const conditionById = new Map(topology.conditions.map((condition) => [
      condition.condition_id,
      condition,
    ]));
    const occurrenceById = new Map(topology.money_occurrences.map((occurrence) => [
      occurrence.occurrence_id,
      occurrence,
    ]));
    const componentNameById = new Map(topology.hall_components.map((component) => [
      component.hall_id,
      exactKey(component.hall_name),
    ]));
    const amountOrdinals = new Map<string, number>();
    const occurrenceOwnerKey = new Map<string, string>();
    for (const occurrence of topology.money_occurrences) {
      const base = [
        occurrence.source_file_id,
        occurrence.source_locator,
        occurrence.amount_krw,
      ].join("\0");
      const ordinal = amountOrdinals.get(base) ?? 0;
      amountOrdinals.set(base, ordinal + 1);
      occurrenceOwnerKey.set(occurrence.occurrence_id, `${base}\0${ordinal}`);
    }
    const exactOptionsByHallId = new Map<
      string,
      NonNullable<LocalHall["options"]>
    >();
    for (const option of topology.price_options) {
      if (option.relation_kind !== "exact_hall" || option.hall_ids.length !== 1) continue;
      const occurrences = option.occurrence_ids
        .map((occurrenceId) => occurrenceById.get(occurrenceId))
        .filter((occurrence): occurrence is NonNullable<typeof occurrence> => Boolean(occurrence));
      const hallId = option.hall_ids[0]!;
      if (
        occurrences.length !== option.occurrence_ids.length
        || occurrences.some((occurrence) => (
          occurrence.relation_kind !== "exact_hall"
          || occurrence.hall_ids.length !== 1
          || occurrence.hall_ids[0] !== hallId
        ))
      ) continue;
      const optionNameKey = exactKey(option.name);
      if (
        optionNameKey === componentNameById.get(hallId)
        || /^(?:검수필요가격|가격|금액|price|선택품목가격|주요선택품목가격|옵션가격|기타옵션|장식추가|연출추가|행사진행)$/iu.test(optionNameKey)
        || scanSourceMoneyOccurrences(option.name).length > 0
      ) continue;
      const unownedOccurrences = occurrences.filter((occurrence) => {
        const ownerKey = occurrenceOwnerKey.get(occurrence.occurrence_id);
        return ownerKey !== undefined && !existingOwnedOccurrences.has(ownerKey);
      });
      // Existing exact semantic owners always win. A partially owned topology
      // range cannot be safely re-shaped, so leave its remaining occurrence in
      // the ledger/coverage gap instead of manufacturing a second meaning.
      if (unownedOccurrences.length === 0 || unownedOccurrences.length !== occurrences.length) continue;
      const conditions = option.condition_ids.flatMap((conditionId) => {
        const condition = conditionById.get(conditionId);
        return condition ? [condition] : [];
      });
      const supportLocators = [...new Set([
        ...option.label_locators,
        ...occurrences.flatMap((occurrence) => [
          ...occurrence.price_header_locators,
          ...(occurrence.unit_source_locator ? [occurrence.unit_source_locator] : []),
        ]),
      ])];
      const sourceQuote = topologyEvidenceQuote(
        option.source_file_id,
        [
          // PriceOption evidence is capped at 1,000 chars. Preserve every
          // physical range occurrence first as an exact contiguous cell
          // fragment; otherwise a verbose XLSX cell can make the encoder fall
          // back to only the first amount and manufacture a coverage gap.
          ...occurrences.map((occurrence) => (
            `${occurrence.source_locator}: ${occurrence.raw_text}`
          )),
          ...supportLocators.flatMap((locator) => {
            const quote = cellQuoteByLocator.get(`${option.source_file_id}\0${locator}`);
            return quote ? [quote.slice(0, 240)] : [];
          }),
          ...conditions.map((condition) => condition.source_quote.slice(0, 240)),
        ],
        1_000,
      );
      const projected = {
        name: option.name.slice(0, 300),
        price_min_krw: option.price_min_krw,
        price_max_krw: option.price_max_krw,
        unit: "원",
        condition: conditions.length > 0
          ? [...new Set(conditions.map(({ text }) => text))].join(" · ").slice(0, 1_000)
          : null,
        raw_text: option.raw_text.slice(0, 2_000),
        source_quote: sourceQuote,
        source_file_ids: [option.source_file_id],
      };
      exactOptionsByHallId.set(hallId, [
        ...(exactOptionsByHallId.get(hallId) ?? []),
        projected,
      ]);
    }

    for (const component of topology.hall_components) {
      const key = exactKey(component.hall_name);
      let hall = halls.find((candidate) => (
        typeof candidate.hall_name === "string" && exactKey(candidate.hall_name) === key
      ));
      if (!hall) {
        if (halls.length >= 100) {
          optionOverflow += exactOptionsByHallId.get(component.hall_id)?.length ?? 0;
          continue;
        }
        const conditions = component.condition_ids.flatMap((conditionId) => {
          const condition = conditionById.get(conditionId);
          return condition ? [condition.source_quote] : [];
        });
        hall = {
          hall_name: component.hall_name,
          guarantee_min: null,
          meal_price_min_krw: null,
          meal_price_max_krw: null,
          venue_fee_min_krw: null,
          venue_fee_max_krw: null,
          venue_fee_note: null,
          decoration_fee_min_krw: null,
          decoration_fee_max_krw: null,
          decoration_note: null,
          options: [],
          source_quote: topologyEvidenceQuote(
            component.source_file_id,
            [...component.source_quotes, ...conditions],
            2_000,
          ),
          source_file_ids: [component.source_file_id],
          confidence: 0.35,
          needs_review: true,
        };
        halls.push(hall);
      }
      hall.source_file_ids = [...new Set([...hall.source_file_ids, component.source_file_id])];
      hall.confidence = Math.min(hall.confidence, 0.35);
      hall.needs_review = true;
      const additions = exactOptionsByHallId.get(component.hall_id) ?? [];
      const available = Math.max(0, 200 - hall.options.length);
      hall.options = dedupeOptions([...hall.options, ...additions.slice(0, available)]);
      optionOverflow += Math.max(0, additions.length - available);
    }
  }
  return { halls, optionOverflow, hallQuarantine };
}

/**
 * Conservative, network-free extraction from converter-owned text evidence.
 * Every emitted row is review-only and every value remains bound to an exact
 * source cell. Image facts are never inferred.
 */
export function extractDisclosureFromLocalEvidence(
  input: LocalDisclosureInput,
): StrictDisclosureExtraction {
  const pdfLayout = input.kindHint === "hall"
    ? pdfLayoutHallExtraction(input.sources)
    : {
        halls: [] as LocalHall[],
        sections: [] as NonNullable<DisclosureExtraction["sections"]>,
        handledSourceIds: new Set<string>(),
        invalidSourceIds: new Set<string>(),
        quarantinedMoney: 0,
      };
  const pdfAgency = input.kindHint === "agency"
    ? pdfLayoutAgencyExtraction(input.sources)
    : {
        partnerVendors: [] as StrictDisclosureExtraction["partner_vendors"],
        sections: [] as NonNullable<DisclosureExtraction["sections"]>,
        handledSourceIds: new Set<string>(),
        invalidSourceIds: new Set<string>(),
        quarantinedMoney: 0,
      };
  const parsedSources = input.sources.map((source) => ({
    source,
    evidence: parseWorkbookEvidence(source),
  }));
  const ocrReviewSourceIds = new Set(parsedSources.flatMap(({ source }) => (
    OCR_REVIEW_SOURCE_PATTERN.test(source.text) ? [source.sourceFileId] : []
  )));
  const invalidDocxMetadataSourceIds = new Set(parsedSources.flatMap(({ source, evidence }) => (
    evidence.docxMetadataStatus === "invalid" ? [source.sourceFileId] : []
  )));
  const invalidPdfLayoutMetadataSourceIds = new Set([
    ...pdfLayout.invalidSourceIds,
    ...pdfAgency.invalidSourceIds,
  ]);
  const hallXlsxTopologySources: HallXlsxTopologySource[] = input.kindHint === "hall"
    ? parsedSources.flatMap(({ source }) => (
        !ocrReviewSourceIds.has(source.sourceFileId)
        && !invalidDocxMetadataSourceIds.has(source.sourceFileId)
        && !invalidPdfLayoutMetadataSourceIds.has(source.sourceFileId)
        && isCanonicalXlsxSourceText(source.text)
          ? [{
              source,
              topology: extractHallXlsxTopology({
                sourceFileId: source.sourceFileId,
                canonicalText: source.text,
              }),
            }]
          : []
      ))
    : [];
  const nonOcrEvidence: WorkbookEvidence = {
    cells: parsedSources.flatMap(({ evidence: parsed }) => parsed.cells)
      .filter((cell) => (
        !ocrReviewSourceIds.has(cell.sourceFileId)
        && !invalidDocxMetadataSourceIds.has(cell.sourceFileId)
        && !invalidPdfLayoutMetadataSourceIds.has(cell.sourceFileId)
      )),
    merges: parsedSources.flatMap(({ evidence: parsed }) => parsed.merges)
      .filter((merge) => (
        !ocrReviewSourceIds.has(merge.sourceFileId)
        && !invalidDocxMetadataSourceIds.has(merge.sourceFileId)
        && !invalidPdfLayoutMetadataSourceIds.has(merge.sourceFileId)
      )),
    docxMetadataStatus: "none",
  };
  const crossBusinessIdentities = crossBusinessSheetIdentities(
    nonOcrEvidence,
    input.canonicalName,
  );
  const crossBusinessScopeKeys = new Set(
    crossBusinessIdentities.map(({ scopeKey }) => scopeKey),
  );
  const evidence: WorkbookEvidence = {
    cells: nonOcrEvidence.cells.filter((cell) => !crossBusinessScopeKeys.has(
      workbookScopeKey(cell.sourceFileId, cell.sheet),
    )),
    merges: nonOcrEvidence.merges.filter((merge) => !crossBusinessScopeKeys.has(
      workbookScopeKey(merge.sourceFileId, merge.sheet),
    )),
    docxMetadataStatus: "none",
  };
  const structuralParsedSources = parsedSources
    .filter(({ source }) => (
      !ocrReviewSourceIds.has(source.sourceFileId)
      && !invalidDocxMetadataSourceIds.has(source.sourceFileId)
      && !invalidPdfLayoutMetadataSourceIds.has(source.sourceFileId)
    ))
    .map(({ source, evidence: parsed }) => ({
      source,
      evidence: {
        cells: parsed.cells.filter((cell) => !crossBusinessScopeKeys.has(
          workbookScopeKey(cell.sourceFileId, cell.sheet),
        )),
        merges: parsed.merges.filter((merge) => !crossBusinessScopeKeys.has(
          workbookScopeKey(merge.sourceFileId, merge.sheet),
        )),
        docxMetadataStatus: parsed.docxMetadataStatus,
      },
    }));
  const docxBodySources = parsedSources.flatMap(({ source }) => {
    if (ocrReviewSourceIds.has(source.sourceFileId)) return [];
    const projection = docxBodyProjection(source);
    return projection ? [projection] : [];
  });
  const docxBodySourceIds = new Set(docxBodySources.map(({ sourceFileId }) => sourceFileId));
  const cellByLocator = new Map(evidence.cells.map((cell) => [
    `${cell.sourceFileId}\0${cell.sheet}!${cell.address}`,
    cell,
  ]));
  const moneyOccurrences: NonNullable<DisclosureExtraction["money_occurrences"]> = [];
  const locatedMoney: LocatedMoney[] = [];
  const rawOrdinalsByCell = new Map<string, number>();
  const topologyReplacementCapacity = new Map<string, number>();
  for (const { topology } of hallXlsxTopologySources) {
    for (const occurrence of topology.money_occurrences) {
      const key = [
        occurrence.source_file_id,
        occurrence.source_locator,
        occurrence.amount_krw,
      ].join("\0");
      topologyReplacementCapacity.set(key, (topologyReplacementCapacity.get(key) ?? 0) + 1);
    }
  }
  const policyCells = new Map<string, WorkbookCell>();
  for (const cell of evidence.cells) {
    if (POLICY_PATTERN.test(cell.value) || POLICY_TIER_PATTERN.test(cleanCellValue(cell.value))) {
      policyCells.set(cellKey(cell), cell);
      continue;
    }
    if (scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0) continue;
    const inheritedBoundary = evidence.cells
      .filter((candidate) => (
        candidate.sourceFileId === cell.sourceFileId
        && candidate.sheet === cell.sheet
        && candidate.row < cell.row
        && isDocumentPolicyBoundaryCell(candidate)
        && (
          candidate.column === cell.column
          || mergeCoveringColumn(evidence, candidate, cell.column)
        )
      ))
      .sort((left, right) => right.row - left.row)[0];
    if (!inheritedBoundary) continue;
    const laterPriceHeading = evidence.cells.some((candidate) => (
      candidate.sourceFileId === cell.sourceFileId
      && candidate.sheet === cell.sheet
      && candidate.row > inheritedBoundary.row
      && candidate.row <= cell.row
      && isPricingBasisCell(candidate)
    ));
    if (!laterPriceHeading) policyCells.set(cellKey(cell), cell);
  }
  for (const { source } of parsedSources) {
    const plainLinesByNumber = new Map(
      plainTextLines(source).map((line) => [line.number, line]),
    );
    for (const occurrence of scanSourceMoneyOccurrences(source.text)) {
      const cell = cellByLocator.get(`${source.sourceFileId}\0${occurrence.source_locator}`);
      const policy = POLICY_PATTERN.test(occurrence.line_context)
        || (cell ? policyCells.has(cellKey(cell)) : false);
      const occurrenceLineNumber = lineNumberFromLocator(occurrence.source_locator);
      const occurrenceLine = occurrenceLineNumber === null
        ? null
        : plainLinesByNumber.get(occurrenceLineNumber) ?? null;
      const replacementKey = [
        source.sourceFileId,
        occurrence.source_locator,
        occurrence.krw,
      ].join("\0");
      const replacementCapacity = topologyReplacementCapacity.get(replacementKey) ?? 0;
      if (replacementCapacity > 0) {
        topologyReplacementCapacity.set(replacementKey, replacementCapacity - 1);
      } else {
        moneyOccurrences.push({
          amount_krw: occurrence.krw,
          raw_text: occurrence.raw,
          source_quote: occurrenceLine
            ? shortLineQuote(occurrenceLine, 2_000)
            : occurrence.source_locator.startsWith("pdf:")
              ? `${occurrence.source_locator} [krw=${occurrence.krw}]: ${occurrence.line_context}`
                .slice(0, 2_000)
              : `${occurrence.source_locator}: ${occurrence.raw}`.slice(0, 2_000),
          source_file_ids: [source.sourceFileId],
          kind: policy ? "policy" : "price",
          needs_review: true,
        });
      }
      if (!cell) continue;
      const rawOrdinalKey = [
        source.sourceFileId,
        occurrence.source_locator,
        occurrence.raw,
        occurrence.krw,
      ].join("\0");
      const rawOrdinalInCell = rawOrdinalsByCell.get(rawOrdinalKey) ?? 0;
      rawOrdinalsByCell.set(rawOrdinalKey, rawOrdinalInCell + 1);
      locatedMoney.push({ occurrence, cell, rawOrdinalInCell });
      if (policy) policyCells.set(`${source.sourceFileId}\0${occurrence.source_locator}`, cell);
    }
  }
  for (const { topology } of hallXlsxTopologySources) {
    for (const occurrence of topology.money_occurrences) {
      moneyOccurrences.push({
        amount_krw: occurrence.amount_krw,
        raw_text: occurrence.raw_text.slice(0, 200),
        source_quote: topologyOccurrenceQuote(topology, occurrence),
        source_file_ids: [occurrence.source_file_id],
        kind: occurrence.relation_kind === "policy"
          ? "policy"
          : occurrence.relation_kind === "exact_hall" ? "price" : "other_money",
        needs_review: true,
      });
    }
  }
  const structuredLocatedMoney = locatedMoney.filter((entry) => (
    !locatedMoneyRequiresStructuredQuarantine(
      evidence,
      entry,
      true,
      input.kindHint === "agency",
    )
  ));
  const workbookStructuredMoneyQuarantineCount = locatedMoney.length
    - structuredLocatedMoney.length;

  const agencyPackages: StrictDisclosureExtraction["agency_packages"] = [];
  const partnerVendors: StrictDisclosureExtraction["partner_vendors"] = [];
  const partnerVendorsByExactScope = new Map<
    string,
    StrictDisclosureExtraction["partner_vendors"]
  >();
  const linkedLocators = new Set<string>();
  const consumedVendorPolicyCells = new Set<string>();
  let optionOverflow = 0;
  let semanticBindingQuarantine = 0;
  const tableSections = input.kindHint === "agency" ? agencySections(evidence) : [];
  const tablePackageAnchors = input.kindHint === "agency"
    ? packageAnchors(evidence, tableSections)
    : [];
  const plainAgency = input.kindHint === "agency"
    ? plainLineAgencyExtraction(
        structuralParsedSources
          .filter(({ source, evidence: parsed }) => (
            parsed.cells.length === 0 && !docxBodySourceIds.has(source.sourceFileId)
          ))
          .map(({ source }) => source),
      )
    : { partnerVendors: [], sections: [], quarantinedMoney: 0 };
  const docxBodyAgency = input.kindHint === "agency"
    ? plainLineAgencyExtraction(docxBodySources)
    : { partnerVendors: [], sections: [], quarantinedMoney: 0 };
  const plainHall = input.kindHint === "hall"
    ? plainLineHallExtraction(
        structuralParsedSources
          .filter(({ source, evidence: parsed }) => (
            parsed.cells.length === 0
            && !docxBodySourceIds.has(source.sourceFileId)
            && !pdfLayout.handledSourceIds.has(source.sourceFileId)
          ))
          .map(({ source }) => source),
        input.canonicalName,
      )
    : { halls: [] as LocalHall[], sections: [], quarantinedMoney: 0 };
  const docxBodyHall = input.kindHint === "hall"
    ? plainLineHallExtraction(docxBodySources, input.canonicalName)
    : { halls: [] as LocalHall[], sections: [], quarantinedMoney: 0 };
  if (input.kindHint === "agency") {
    const anchors = vendorAnchors(evidence, tableSections);
    for (const anchor of anchors) {
      const spanCells = evidence.cells.filter((cell) =>
        cell.sourceFileId === anchor.cell.sourceFileId
        && cell.sheet === anchor.cell.sheet
        && cellOverlapsRows(evidence, cell, anchor.cell.row, anchor.endRow)
        && cell.column > anchor.cell.column
      );
      if (spanCells.length === 0) continue;
      const policyCellsForVendor = spanCells.flatMap((cell) => {
        const columnHeader = headerForVendorColumn(evidence, anchor, cell);
        const policyContext = columnHeader && POLICY_PATTERN.test(columnHeader.value)
          ? columnHeader
          : POLICY_PATTERN.test(cell.value) ? cell : null;
        if (!policyContext) return [];
        const unitEvidence = new Map(
          locatedMoney
            .filter((entry) => cellKey(entry.cell) === cellKey(cell))
            .flatMap((entry) => unitEvidenceForOccurrence(evidence, entry, policyContext))
            .map((support) => [cellKey(support), support]),
        );
        consumedVendorPolicyCells.add(cellKey(cell));
        consumedVendorPolicyCells.add(cellKey(policyContext));
        return [{ cell, policyContext, unitEvidence: [...unitEvidence.values()] }];
      });
      const policyCellKeys = new Set(policyCellsForVendor.map(({ cell }) => cellKey(cell)));
      const occurrences = structuredLocatedMoney.filter((entry) =>
        entry.cell.sourceFileId === anchor.cell.sourceFileId
        && entry.cell.sheet === anchor.cell.sheet
        && cellOverlapsRows(evidence, entry.cell, anchor.cell.row, anchor.endRow)
        && entry.cell.column > anchor.cell.column
        && !policyCellKeys.has(cellKey(entry.cell))
      );
      const basePriceOccurrences = anchor.selfBusiness
        ? occurrences.filter((entry) => (
            isExactBasePriceHeader(headerForVendorColumn(evidence, anchor, entry.cell))
          ))
        : [];
      const basePriceOccurrenceKeys = new Set(
        basePriceOccurrences.map(locatedMoneyLinkKey),
      );
      const optionOccurrences = occurrences.filter((entry) => (
        !basePriceOccurrenceKeys.has(locatedMoneyLinkKey(entry))
      ));
      const options: LocalPriceOption[] = [];
      for (const entry of optionOccurrences.slice(0, 100)) {
        const peers = optionRangePeers(optionOccurrences, entry);
        const columnHeader = headerForVendorColumn(evidence, anchor, entry.cell);
        const option = optionFromOccurrence(
          evidence,
          entry,
          columnHeader,
          [anchor.cell, anchor.header, ...(anchor.categoryEvidence ? [anchor.categoryEvidence] : [])],
          peers,
          false,
          false,
          Boolean(
            columnHeader
            && /^기타\s*옵션$/u.test(cleanCellValue(columnHeader.value)),
          ),
        );
        if (!option) {
          semanticBindingQuarantine += 1;
          continue;
        }
        options.push(option);
        for (const peer of peers) {
          linkedLocators.add(locatedMoneyLinkKey(peer));
        }
      }
      optionOverflow += Math.max(0, optionOccurrences.length - 100);
      for (const entry of basePriceOccurrences) {
        linkedLocators.add(locatedMoneyLinkKey(entry));
      }
      for (const { cell } of policyCellsForVendor) {
        for (const entry of locatedMoney.filter((candidate) => cellKey(candidate.cell) === cellKey(cell))) {
          linkedLocators.add(locatedMoneyLinkKey(entry));
        }
      }
      const basePriceAmounts = basePriceOccurrences.map((entry) => entry.occurrence.krw);
      const basePriceEvidence = basePriceOccurrences.flatMap((entry) => [
        ...(headerForVendorColumn(evidence, anchor, entry.cell)
          ? [headerForVendorColumn(evidence, anchor, entry.cell)!]
          : []),
        ...unitEvidenceForOccurrence(
          evidence,
          entry,
          headerForVendorColumn(evidence, anchor, entry.cell),
        ),
        entry.cell,
      ]);
      const partnerVendorTemplate: StrictDisclosureExtraction["partner_vendors"][number] = {
        vendor_name: cleanCellValue(anchor.cell.value).slice(0, 300),
        old_names: [],
        category: anchor.category,
        price_min_krw: basePriceAmounts.length > 0 ? Math.min(...basePriceAmounts) : null,
        price_max_krw: basePriceAmounts.length > 0 ? Math.max(...basePriceAmounts) : null,
        base_spec: null,
        price_note: null,
        options: dedupeOptions(options),
        policies: policyCellsForVendor.flatMap(({ cell, policyContext, unitEvidence }) =>
          splitNormalizedEvidenceChunks(cell.value).map((rawText) => {
            const quotedCell = { ...cell, value: rawText };
            const sourceQuote = mergedQuote([
              anchor.cell,
              anchor.header,
              ...(anchor.categoryEvidence ? [anchor.categoryEvidence] : []),
              ...unitEvidence,
              policyContext,
              quotedCell,
            ], 2_000) ?? shortCellQuote(quotedCell, rawText, 2_000);
            return {
              policy_type: vendorPolicyType(`${policyContext.value} ${rawText}`),
              raw_text: rawText,
              source_quote: sourceQuote,
              source_file_ids: [cell.sourceFileId],
            };
          })
        ).slice(0, 100),
        source_quote: mergedQuote(
          [
            anchor.cell,
            anchor.header,
            ...(anchor.categoryEvidence ? [anchor.categoryEvidence] : []),
            ...basePriceEvidence,
          ],
          basePriceEvidence.length > 0 ? 2_000 : 1_000,
        ) ?? shortCellQuote(anchor.cell, anchor.cell.value, 1_000),
        source_file_ids: [anchor.cell.sourceFileId],
        confidence: 0.45,
        needs_review: true,
      };
      for (const vendorName of safeDocxBusinessIdentityNames(anchor)) {
        const partnerVendor = {
          ...partnerVendorTemplate,
          vendor_name: vendorName.slice(0, 300),
        };
        partnerVendors.push(partnerVendor);
        const exactScopeKey = [
          anchor.cell.sourceFileId,
          anchor.cell.sheet,
          anchor.category,
          partnerVendor.vendor_name,
        ].join("\0");
        partnerVendorsByExactScope.set(exactScopeKey, [
          ...(partnerVendorsByExactScope.get(exactScopeKey) ?? []),
          partnerVendor,
        ]);
      }
    }

    for (const header of evidence.cells.filter((cell) =>
      BUSINESS_HEADER_PATTERN.test(cleanCellValue(cell.value))
    )) {
      const sheetCells = evidence.cells.filter((cell) =>
        cell.sourceFileId === header.sourceFileId && cell.sheet === header.sheet
      );
      const hasPriorPolicyBoundary = sheetCells.some((cell) =>
        cell.row < header.row && isDocumentPolicyBoundaryCell(cell)
      );
      if (!hasPriorPolicyBoundary) continue;
      const policyHeader = sheetCells.find((cell) =>
        cell.row === header.row
        && cell.column > header.column
        && POLICY_PATTERN.test(cleanCellValue(cell.value))
      );
      const category = categoryFromText(header.sheet) ?? categoryForHeader(sheetCells, header);
      if (!policyHeader || !category) continue;
      const categoryEvidence = categoryEvidenceForHeader(sheetCells, header, category);
      const anchors = sheetCells
        .filter((cell) =>
          cell.column === header.column
          && cell.row > header.row
          && isVendorAnchorCandidate(cell)
        )
        .sort((left, right) => left.row - right.row);
      for (const [anchorIndex, policyAnchor] of anchors.entries()) {
        const exactScopeKey = [
          policyAnchor.sourceFileId,
          policyAnchor.sheet,
          category,
          cleanCellValue(policyAnchor.value).slice(0, 300),
        ].join("\0");
        const exactMatches = partnerVendorsByExactScope.get(exactScopeKey) ?? [];
        if (exactMatches.length !== 1) continue;
        const endRow = (anchors[anchorIndex + 1]?.row ?? (Math.max(
          ...sheetCells.map((cell) => cell.row),
        ) + 1)) - 1;
        const policyValueCells = sheetCells.filter((cell) =>
          cell.row >= policyAnchor.row
          && cell.row <= endRow
          && cell.column > header.column
          && mergeCoveringColumn(evidence, policyHeader, cell.column)
          && cleanCellValue(cell.value).length > 0
        );
        for (const policyCell of policyValueCells) {
          consumedVendorPolicyCells.add(cellKey(policyCell));
          const cellOccurrences = locatedMoney.filter((entry) =>
            cellKey(entry.cell) === cellKey(policyCell)
          );
          for (const entry of cellOccurrences) {
            linkedLocators.add(locatedMoneyLinkKey(entry));
          }
          const unitEvidence = new Map(
            cellOccurrences
              .flatMap((entry) => unitEvidenceForOccurrence(evidence, entry, policyHeader))
              .map((support) => [cellKey(support), support]),
          );
          exactMatches[0]!.policies.push(...splitNormalizedEvidenceChunks(policyCell.value).map(
            (rawText) => {
              const quotedCell = { ...policyCell, value: rawText };
              return {
                policy_type: vendorPolicyType(`${policyHeader.value} ${rawText}`),
                raw_text: rawText,
                source_quote: mergedQuote([
                  header,
                  policyAnchor,
                  ...(categoryEvidence ? [categoryEvidence] : []),
                  ...unitEvidence.values(),
                  policyHeader,
                  quotedCell,
                ], 2_000) ?? shortCellQuote(quotedCell, rawText, 2_000),
                source_file_ids: [policyCell.sourceFileId],
              };
            },
          ));
        }
      }
    }

    for (const anchor of tablePackageAnchors) {
      const spanCells = evidence.cells.filter((cell) =>
        cell.sourceFileId === anchor.cell.sourceFileId
        && cell.sheet === anchor.cell.sheet
        && cell.row >= anchor.cell.row
        && cell.row <= anchor.endRow
        && cell.column > anchor.cell.column
      );
      if (spanCells.length === 0) continue;
      const occurrences = structuredLocatedMoney.filter((entry) =>
        entry.cell.sourceFileId === anchor.cell.sourceFileId
        && entry.cell.sheet === anchor.cell.sheet
        && entry.cell.row >= anchor.cell.row
        && entry.cell.row <= anchor.endRow
        && entry.cell.column > anchor.cell.column
        && !POLICY_PATTERN.test(entry.occurrence.line_context)
      );
      const basePriceRows = occurrences.flatMap((entry) => {
        const header = headerForVendorColumn(evidence, anchor, entry.cell);
        if (!header || !/^(?:기본\s*)?(?:가격|금액)$/u.test(cleanCellValue(header.value))) {
          return [];
        }
        const descriptor = spanCells
          .filter((cell) => (
            cell.row === entry.cell.row
            && cell.column > anchor.cell.column
            && cell.column < entry.cell.column
            && scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0
            && specificOptionLabel(cell.value) !== null
          ))
          .sort((left, right) => right.column - left.column)[0];
        return descriptor && isCorePackageVariantDescriptor(descriptor.value)
          ? [{ row: entry.cell.row, descriptor }]
          : [];
      }).filter((candidate, index, candidates) => (
        candidates.findIndex(({ row }) => row === candidate.row) === index
      )).sort((left, right) => left.row - right.row);
      const variantScopes = !anchor.explicit && basePriceRows.length > 1
        ? basePriceRows.map((variant, index) => ({
            startRow: variant.row,
            endRow: (basePriceRows[index + 1]?.row ?? (anchor.endRow + 1)) - 1,
            descriptor: variant.descriptor,
          }))
        : [{ startRow: anchor.cell.row, endRow: anchor.endRow, descriptor: null }];
      const firstLineLabels = basePriceRows.map(({ descriptor }) => (
        cleanCellValue(descriptor.value.split(/<br\s*\/?>|\r?\n/iu)[0] ?? "")
      ));

      for (const variant of variantScopes) {
        const variantOccurrences = occurrences.filter((entry) => (
          entry.cell.row >= variant.startRow && entry.cell.row <= variant.endRow
        ));
        const recordEvidence = [
          anchor.cell,
          ...(variant.descriptor ? [variant.descriptor] : []),
          ...anchor.categoryEvidence,
        ];
        const options: LocalPriceOption[] = [];
        for (const entry of variantOccurrences.slice(0, 100)) {
          const peers = optionRangePeers(variantOccurrences, entry);
          const option = optionFromOccurrence(
            evidence,
            entry,
            headerForVendorColumn(evidence, anchor, entry.cell),
            recordEvidence,
            peers,
          );
          if (!option) {
            semanticBindingQuarantine += 1;
            continue;
          }
          options.push(option);
          for (const peer of peers) {
            linkedLocators.add(locatedMoneyLinkKey(peer));
          }
        }
        optionOverflow += Math.max(0, variantOccurrences.length - 100);
        const variantFirstLine = variant.descriptor
          ? cleanCellValue(variant.descriptor.value.split(/<br\s*\/?>|\r?\n/iu)[0] ?? "")
          : null;
        const variantDescriptor = variant.descriptor && variantFirstLine
          ? (
              firstLineLabels.filter((label) => label === variantFirstLine).length > 1
                ? cleanCellValue(variant.descriptor.value).slice(0, 120)
                : variantFirstLine.slice(0, 120)
            )
          : null;
        const baseName = cleanCellValue(anchor.cell.value);
        agencyPackages.push({
          // A synthesized "vendor — variant" string is convenient for UI but
          // is not a verbatim source fact. Keep the variant's exact row text as
          // the authoritative package identity; the owning agency relation
          // already supplies the vendor name.
          package_name: variantDescriptor ?? baseName.slice(0, 300),
          category_scope: anchor.categoryScope,
          price_min_krw: null,
          price_max_krw: null,
          vat_note: null,
          price_note: variantDescriptor,
          options: dedupeOptions(options),
          source_quote: mergedQuote(recordEvidence, 1_000)
            ?? shortCellQuote(anchor.cell, anchor.cell.value, 1_000),
          source_file_ids: [anchor.cell.sourceFileId],
          confidence: 0.4,
          needs_review: true,
        });
      }
    }

    const selfBusiness = selfBusinessPartnerVendors(
      evidence,
      structuredLocatedMoney,
      input.canonicalName,
      tablePackageAnchors,
      partnerVendors,
    );
    partnerVendors.push(...selfBusiness.partnerVendors);
    for (const locator of selfBusiness.linkedLocators) linkedLocators.add(locator);
    optionOverflow += selfBusiness.optionOverflow;
    semanticBindingQuarantine += selfBusiness.semanticQuarantine;
  }
  partnerVendors.push(...plainAgency.partnerVendors.filter((vendor) => (
    !vendor.source_file_ids.some((sourceFileIdValue) => (
      pdfAgency.handledSourceIds.has(sourceFileIdValue)
    ))
  )));
  for (const projectedVendor of pdfAgency.partnerVendors) {
    const existing = partnerVendors.find((vendor) => (
      vendor.category === projectedVendor.category
      && normalizedPlainIdentity(vendor.vendor_name) === normalizedPlainIdentity(projectedVendor.vendor_name)
    ));
    if (!existing) {
      partnerVendors.push(projectedVendor);
      continue;
    }
    const optionQuotes = new Set(existing.options.map(({ source_quote }) => source_quote));
    for (const option of projectedVendor.options) {
      if (optionQuotes.has(option.source_quote) || existing.options.length >= 100) continue;
      existing.options.push(option);
      optionQuotes.add(option.source_quote);
    }
  }
  pdfAgency.quarantinedMoney += quarantineNonIsolatedPdfAgencySlots(
    input.sources,
    partnerVendors,
  );

  const hallResult = input.kindHint === "hall"
    ? localHalls(evidence, structuredLocatedMoney)
    : {
        halls: [] as LocalHall[],
        linkedLocators: new Set<string>(),
        overflow: 0,
        semanticQuarantine: 0,
      };
  for (const locator of hallResult.linkedLocators) linkedLocators.add(locator);
  optionOverflow += hallResult.overflow;
  semanticBindingQuarantine += hallResult.semanticQuarantine;
  const extractedHalls = mergeExactCanonicalDocxHalls(
    evidence,
    [...hallResult.halls, ...pdfLayout.halls, ...plainHall.halls],
  );
  const existingHallOwnedOccurrences = new Set<string>();
  const existingAmountOrdinals = new Map<string, number>();
  for (const entry of structuredLocatedMoney) {
    const base = [
      entry.cell.sourceFileId,
      entry.occurrence.source_locator,
      entry.occurrence.krw,
    ].join("\0");
    const ordinal = existingAmountOrdinals.get(base) ?? 0;
    existingAmountOrdinals.set(base, ordinal + 1);
    if (hallResult.linkedLocators.has(locatedMoneyLinkKey(entry))) {
      existingHallOwnedOccurrences.add(`${base}\0${ordinal}`);
    }
  }
  const topologyHallResult = exactTopologyHalls(
    extractedHalls,
    hallXlsxTopologySources,
    evidence,
    existingHallOwnedOccurrences,
  );
  optionOverflow += topologyHallResult.optionOverflow;
  semanticBindingQuarantine += topologyHallResult.hallQuarantine;
  const identityOnlyVenue = input.kindHint === "hall" && topologyHallResult.halls.length === 0
    ? sourceBackedVenueIdentity(
        evidence,
        structuralParsedSources.map(({ source }) => source),
        input.canonicalName,
      )
    : null;
  const finalHalls = identityOnlyVenue ? [identityOnlyVenue] : topologyHallResult.halls;
  let finalPdfLayoutQuarantinedMoney = 0;
  if (input.kindHint === "hall") {
    const accumulator = { halls: finalHalls, quarantinedMoney: 0 };
    for (const source of input.sources) {
      if (pdfLayout.handledSourceIds.has(source.sourceFileId)) continue;
      const layout = parseCanonicalPdfLayoutEvidence(source);
      if (layout.status !== "valid") continue;
      addCertifiedPdfHallOptions(source, layout, accumulator);
    }
    finalPdfLayoutQuarantinedMoney = accumulator.quarantinedMoney;
  }

  const unlinkedPricingBasisSections: NonNullable<DisclosureExtraction["sections"]> = [];
  const unlinkedByCell = new Map<string, LocatedMoney[]>();
  for (const entry of structuredLocatedMoney.filter((candidate) => (
    !policyCells.has(cellKey(candidate.cell))
    && !linkedLocators.has(locatedMoneyLinkKey(candidate))
  ))) {
    unlinkedByCell.set(cellKey(entry.cell), [
      ...(unlinkedByCell.get(cellKey(entry.cell)) ?? []),
      entry,
    ]);
  }
  for (const entries of unlinkedByCell.values()) {
    const cell = entries[0]?.cell;
    if (!cell) continue;
    const support = pricingBasisSupportForCell(evidence, cell);
    const inlinePriceComponents = entries.length > 0
      && INLINE_PRICE_COMPONENT_PATTERN.test(cleanCellValue(cell.value));
    if (support.length === 0 && !inlinePriceComponents) continue;
    const content = cell.value.slice(0, 1_800);
    const descriptor = support.find((candidate) => !isPricingBasisCell(candidate));
    unlinkedPricingBasisSections.push({
      section_type: support.length > 0 ? "pricing_basis" : "other",
      title: (descriptor?.value ?? content).slice(0, 300),
      content_verbatim: content,
      summary: content.slice(0, 1_000),
      source_quote: mergedQuote([...support, { ...cell, value: content }], 2_000)
        ?? shortCellQuote(cell, content, 2_000),
      source_file_ids: [cell.sourceFileId],
      confidence: 0.35,
      needs_review: true,
    });
    for (const entry of entries) {
      linkedLocators.add(locatedMoneyLinkKey(entry));
    }
  }

  const orderedPolicyCells = [...policyCells.values()]
    .sort((left, right) =>
      left.sourceFileId.localeCompare(right.sourceFileId, "en")
      || left.sheet.localeCompare(right.sheet, "ko")
      || left.column - right.column
      || left.row - right.row
    );
  // Never infer that a shorter policy row is a truncated copy of the next
  // longer row: real tier tables commonly contain `5%`, `10%`, `20%` rows of
  // increasing text length. Collapse only repeated projections of the same
  // physical merged cell; the cell-key map above already removes exact same-
  // locator duplicates.
  const seenPolicyMergeProjections = new Set<string>();
  const collapsedPolicyCells = orderedPolicyCells.filter((cell) => {
    const merge = mergeContainingCell(evidence, cell);
    if (!merge) return true;
    const key = [
      merge.sourceFileId,
      merge.sheet,
      merge.startColumn,
      merge.startRow,
      merge.endColumn,
      merge.endRow,
      cleanCellValue(cell.value),
    ].join("\0");
    if (seenPolicyMergeProjections.has(key)) return false;
    seenPolicyMergeProjections.add(key);
    return true;
  });
  const sectionCells = new Map<string, { cell: WorkbookCell; heading: WorkbookCell | null }>();
  const documentPolicyHeadings = collapsedPolicyCells.filter(isDocumentPolicyBoundaryCell);
  for (const cell of collapsedPolicyCells) {
    const heading = documentPolicyHeadings
      .filter((candidate) =>
        candidate.sourceFileId === cell.sourceFileId
        && candidate.sheet === cell.sheet
        && candidate.column === cell.column
        && candidate.row < cell.row
      )
      .sort((left, right) => right.row - left.row)[0] ?? null;
    if (isDocumentPolicyBoundaryCell(cell)) {
      const nextHeadingRow = documentPolicyHeadings
        .filter((candidate) =>
          candidate.sourceFileId === cell.sourceFileId
          && candidate.sheet === cell.sheet
          && candidate.column === cell.column
          && candidate.row > cell.row
        )
        .reduce((minimum, candidate) => Math.min(minimum, candidate.row), Number.POSITIVE_INFINITY);
      const hasDescendant = collapsedPolicyCells.some((candidate) =>
        candidate.sourceFileId === cell.sourceFileId
        && candidate.sheet === cell.sheet
        && candidate.column === cell.column
        && candidate.row > cell.row
        && candidate.row < nextHeadingRow
      );
      // A policy boundary can also be the complete policy body. Do not drop
      // its own commercial terms merely because a later sibling clause is
      // present. Pure headings still collapse into their descendants, while
      // a boundary carrying an explicit money occurrence remains a separate,
      // exact source-backed section.
      if (
        !hasDescendant
        || scanSourceMoneyOccurrences(cleanCellValue(cell.value)).length > 0
      ) {
        sectionCells.set(cellKey(cell), { cell, heading: null });
      }
      continue;
    }
    sectionCells.set(cellKey(cell), { cell, heading });
  }
  for (const cell of evidence.cells.filter(isPricingBasisCell)) {
    sectionCells.set(cellKey(cell), { cell, heading: null });
  }
  const explicitTermsHeadings = evidence.cells.filter((cell) =>
    /약관/u.test(cell.sheet)
    && EXPLICIT_TERMS_HEADING_PATTERN.test(cleanCellValue(cell.value))
  );
  for (const heading of explicitTermsHeadings) {
    const normalizedHeading = cleanCellValue(heading.value);
    const sameLevelHeadingPattern = /^제\s*\d+\s*조/u.test(normalizedHeading)
      ? /^제\s*\d+\s*조/u
      : /^\d+\s*\./u;
    const boundary = evidence.cells
      .filter((cell) =>
        cell.sourceFileId === heading.sourceFileId
        && cell.sheet === heading.sheet
        && cell.column === heading.column
        && cell.row > heading.row
        && sameLevelHeadingPattern.test(cleanCellValue(cell.value))
      )
      .reduce((minimum, cell) => Math.min(minimum, cell.row), Number.POSITIVE_INFINITY);
    for (const cell of evidence.cells.filter((candidate) =>
      candidate.sourceFileId === heading.sourceFileId
      && candidate.sheet === heading.sheet
      && candidate.column === heading.column
      && candidate.row >= heading.row
      && candidate.row < boundary
      && cleanCellValue(candidate.value).length > 0
    )) {
      sectionCells.set(cellKey(cell), { cell, heading });
    }
  }
  const workbookSections: NonNullable<DisclosureExtraction["sections"]> = [...sectionCells.values()]
    .filter(({ cell }) => !consumedVendorPolicyCells.has(cellKey(cell)))
    .sort((left, right) =>
      left.cell.sourceFileId.localeCompare(right.cell.sourceFileId, "en")
      || left.cell.sheet.localeCompare(right.cell.sheet, "ko")
      || left.cell.column - right.cell.column
      || left.cell.row - right.cell.row
    )
    .slice(0, 500)
    .map(({ cell, heading }) => {
      const content = cell.value.slice(0, 1_800);
      return {
        section_type: policySectionType(`${heading?.value ?? ""} ${content}`),
        title: cleanCellValue(content).slice(0, 300),
        content_verbatim: content,
        summary: content.slice(0, 1_000),
        source_quote: heading && cellKey(heading) !== cellKey(cell)
          ? mergedQuote([heading, { ...cell, value: content }], 2_000)
            ?? shortCellQuote(cell, content, 2_000)
          : shortCellQuote(cell, content, 2_000),
        source_file_ids: [cell.sourceFileId],
        confidence: 0.4,
        needs_review: true,
      };
    });
  const sectionCandidates: NonNullable<DisclosureExtraction["sections"]> = [
    ...workbookSections,
    ...unlinkedPricingBasisSections,
    ...pdfAgency.sections,
    ...plainAgency.sections,
    ...docxBodyAgency.sections,
    ...plainHall.sections,
    ...pdfLayout.sections,
    ...docxBodyHall.sections,
  ];
  const seenSectionContent = new Set<string>();
  const sections: NonNullable<DisclosureExtraction["sections"]> = sectionCandidates
    .filter((section) => {
      const key = `${section.source_file_ids.join(",")}\0${section.content_verbatim}`;
      if (seenSectionContent.has(key)) return false;
      seenSectionContent.add(key);
      return true;
    })
    .slice(0, 500);
  const unlinkedMoney = structuredLocatedMoney.filter((entry) =>
    !policyCells.has(cellKey(entry.cell))
    && !linkedLocators.has(locatedMoneyLinkKey(entry))
  ).length;

  return DisclosureExtractionSchema.parse({
    doc_kind: input.kindHint === "hall"
      ? "hall_disclosure"
      : partnerVendors.length > 0 && agencyPackages.length > 0
        ? "mixed"
        : partnerVendors.length > 0 ? "partner_price_list" : "agency_disclosure",
    business_name: input.canonicalName,
    region_hint: input.regionCode,
    agency_packages: agencyPackages,
    partner_vendors: partnerVendors,
    halls: finalHalls,
    sections,
    money_occurrences: moneyOccurrences,
    hall: blankHall(),
    extraction_notes: [
      LOCAL_EXTRACTION_GUARD,
      "외부 API를 호출하지 않은 로컬 규칙 추출입니다. 모든 행은 관리자 검수가 필요합니다.",
      ...(input.hasImages ? ["[local_image_unread] 내장 이미지 내용은 자동 발행 근거로 사용하지 않았습니다."] : []),
      ...(ocrReviewSourceIds.size > 0
        ? [`[local_ocr_review_source_quarantine] ${ocrReviewSourceIds.size}개 OCR 검수 전용 원본은 구조화하지 않고 감사 원장에만 보존했습니다.`]
        : []),
      ...(invalidDocxMetadataSourceIds.size > 0
        ? [`[local_docx_metadata_quarantine] ${invalidDocxMetadataSourceIds.size}개 DOCX 원본의 병합 메타데이터가 비정상이라 표 구조화를 중단하고 감사 원장에만 보존했습니다.`]
        : []),
      ...(invalidPdfLayoutMetadataSourceIds.size > 0
        ? [`[local_pdf_layout_metadata_quarantine] ${invalidPdfLayoutMetadataSourceIds.size}개 PDF 원본의 배치 메타데이터가 비정상이라 구조화를 중단하고 감사 원장에만 보존했습니다.`]
        : []),
      ...crossBusinessIdentities.map(({ sheet, identity }) => (
        `[cross_business_sheet_identity:${sheet}] ${identity} 시트는 ${input.canonicalName} 업체 구조화에서 격리했습니다.`
      )),
      ...(workbookStructuredMoneyQuarantineCount + plainAgency.quarantinedMoney + docxBodyAgency.quarantinedMoney + plainHall.quarantinedMoney + pdfLayout.quarantinedMoney + finalPdfLayoutQuarantinedMoney + pdfAgency.quarantinedMoney + docxBodyHall.quarantinedMoney > 0
        ? [`[local_structured_money_quarantine] ${workbookStructuredMoneyQuarantineCount + plainAgency.quarantinedMoney + docxBodyAgency.quarantinedMoney + plainHall.quarantinedMoney + pdfLayout.quarantinedMoney + finalPdfLayoutQuarantinedMoney + pdfAgency.quarantinedMoney + docxBodyHall.quarantinedMoney}개 금액은 감사 원장에만 보존됐습니다.`]
        : []),
      ...(semanticBindingQuarantine > 0
        ? [`[local_semantic_binding_quarantine] ${semanticBindingQuarantine}개 금액은 의미 연결을 확정하지 않고 검수 대기로 보존했습니다.`]
        : []),
      ...(optionOverflow > 0 ? [`[local_option_overflow] ${optionOverflow}개 금액은 감사 원장에만 보존됐습니다.`] : []),
      ...(unlinkedMoney > 0 ? [`[local_unlinked_money] ${unlinkedMoney}개 금액의 업체 연결은 사람 검수가 필요합니다.`] : []),
    ].join("\n").slice(0, 4_000),
  });
}

export const LOCAL_DOCX_SHARED_MONEY_CONTRACT_VERSION =
  "v1-docx2-exact-vmerge-or-business-header-fanout" as const;

export interface LocalDocxSharedMoneyGroup {
  authority: "vertical_merge_interval" | "business_identity_fan_out";
  source_file_id: string;
  source_locator: string;
  amount_krw: number;
  raw_text: string;
  member_occurrence_keys: string[];
}

interface CertifiedSharedMoneyMember {
  authority: LocalDocxSharedMoneyGroup["authority"];
  authorityKey: string;
  sourceFileId: string;
  sourceLocator: string;
  amountKrw: number;
  rawText: string;
  occurrenceKey: string;
  vendorName: string;
  expectedVendorNames: string[];
}

function structuredOccurrenceKey(path: string, amountKrw: number): string {
  return `${path}\0${amountKrw}`;
}

function exactQuotedDocxCells(
  quote: string,
  evidenceBySource: ReadonlyMap<string, WorkbookEvidence>,
): WorkbookCell[] | null {
  const decoded = decodeEvidenceQuote(quote);
  if (decoded.kind === "invalid") return null;
  const fragments = decoded.kind === "single"
    ? []
    : decoded.fragments;
  if (fragments.length === 0) return null;
  const cells: WorkbookCell[] = [];
  for (const fragment of fragments) {
    const evidence = evidenceBySource.get(fragment.source_file_id);
    if (!evidence || evidence.docxMetadataStatus !== "valid") return null;
    const match = WORKBOOK_CELL_PATTERN.exec(fragment.quote.trim());
    if (!match) return null;
    const sheet = match[1]!.trim();
    const address = `${match[2]}${match[3]}`;
    const quotedValue = cleanCellValue(match[4]!);
    const cell = evidence.cells.find((candidate) => (
      candidate.sheet === sheet
      && candidate.address === address
      && candidate.canonicalDocx
    ));
    if (
      !cell
      || !quotedValue
      || !cleanCellValue(cell.value).includes(quotedValue)
    ) return null;
    cells.push(cell);
  }
  return [...new Map(cells.map((cell) => [cellKey(cell), cell])).values()];
}

function certifiedCategoryCell(
  quotedCells: WorkbookCell[],
  category: VendorCategory,
): WorkbookCell | null {
  return quotedCells.find((cell) => (
    categoriesFromText(cell.value).includes(category)
  )) ?? null;
}

function certifiedIdentityAndHeader(
  evidence: WorkbookEvidence,
  quotedCells: WorkbookCell[],
  vendorName: string,
): { identity: WorkbookCell; header: WorkbookCell; fanOutNames: string[] } | null {
  for (const identity of quotedCells) {
    const possibleHeaders = evidence.cells
      .filter((cell) => (
        cell.sourceFileId === identity.sourceFileId
        && cell.sheet === identity.sheet
        && cell.column === identity.column
        && cell.row < identity.row
        && BUSINESS_HEADER_PATTERN.test(cleanCellValue(cell.value))
      ))
      .sort((left, right) => right.row - left.row);
    const header = possibleHeaders[0];
    if (!header || !quotedCells.some((cell) => cellKey(cell) === cellKey(header))) continue;
    const identityValue = cleanCellValue(identity.value);
    const fanOutNames = safeDocxBusinessIdentityValues(
      identity.value,
      identity.canonicalDocx,
      header.value,
    );
    if (identityValue !== vendorName && !fanOutNames.includes(vendorName)) continue;
    return { identity, header, fanOutNames };
  }
  return null;
}

function categoryForPhysicalVendorCell(
  evidence: WorkbookEvidence,
  identity: WorkbookCell,
): VendorCategory | null {
  const interval = cellRowInterval(evidence, identity);
  const categories = evidence.cells
    .filter((cell) => (
      cell.sourceFileId === identity.sourceFileId
      && cell.sheet === identity.sheet
      && cellKey(cell) !== cellKey(identity)
      && cellOverlapsRows(evidence, cell, interval.startRow, interval.endRow)
      && scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0
    ))
    .flatMap((cell) => categoriesFromText(cell.value));
  const distinct = [...new Set(categories)];
  return distinct.length === 1 ? distinct[0]! : null;
}

function physicalVendorNamesForVerticalMerge(
  evidence: WorkbookEvidence,
  identity: WorkbookCell,
  header: WorkbookCell,
  category: VendorCategory,
  priceMerge: WorkbookMerge,
): string[] {
  return evidence.cells
    .filter((cell) => (
      cell.sourceFileId === identity.sourceFileId
      && cell.sheet === identity.sheet
      && cell.column === header.column
      && cell.row > header.row
      && isVendorAnchorCandidate(cell)
      && cellOverlapsRows(evidence, cell, priceMerge.startRow, priceMerge.endRow)
      && categoryForPhysicalVendorCell(evidence, cell) === category
    ))
    .map((cell) => cleanCellValue(cell.value));
}

/**
 * Independently re-certifies the only two cases where several review-only
 * records may truthfully point at one physical DOCX money occurrence. The
 * score layer may collapse only the returned member keys; every ordinary
 * duplicate remains subject to the global one-to-one occurrence gate.
 */
export function certifyLocalDocxSharedMoneyGroups(input: {
  data: DisclosureExtraction;
  sources: LocalTextEvidence[];
}): LocalDocxSharedMoneyGroup[] {
  const evidenceBySource = new Map(input.sources.map((source) => [
    source.sourceFileId,
    parseWorkbookEvidence(source),
  ]));
  const members: CertifiedSharedMoneyMember[] = [];
  const addRecord = (
    vendor: DisclosureExtraction["partner_vendors"][number],
    vendorIndex: number,
    path: string,
    quote: string,
    sourceFileIds: string[] | undefined,
    values: Array<number | null>,
  ): void => {
    if (!sourceFileIds || sourceFileIds.length !== 1 || vendor.category === "hall") return;
    const vendorCategory: VendorCategory = vendor.category;
    const sourceFileId = sourceFileIds[0]!;
    const evidence = evidenceBySource.get(sourceFileId);
    if (!evidence || evidence.docxMetadataStatus !== "valid") return;
    const quotedCells = exactQuotedDocxCells(quote, evidenceBySource);
    if (!quotedCells || quotedCells.some((cell) => cell.sourceFileId !== sourceFileId)) return;
    const identityAndHeader = certifiedIdentityAndHeader(
      evidence,
      quotedCells,
      vendor.vendor_name,
    );
    const categoryCell = certifiedCategoryCell(quotedCells, vendorCategory);
    if (!identityAndHeader || !categoryCell) return;
    const { identity, header, fanOutNames } = identityAndHeader;
    if (!cellOverlapsRows(
      evidence,
      categoryCell,
      cellRowInterval(evidence, identity).startRow,
      cellRowInterval(evidence, identity).endRow,
    )) return;
    const distinctAmounts = [...new Set(values.filter((value): value is number => (
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    )))];
    for (const amountKrw of distinctAmounts) {
      const priceCandidates = quotedCells.flatMap((cell) => {
        const occurrences = scanSourceMoneyOccurrences(shortCellQuote(cell))
          .filter((occurrence) => occurrence.krw === amountKrw);
        return occurrences.length === 1 ? [{ cell, occurrence: occurrences[0]! }] : [];
      });
      if (priceCandidates.length !== 1) continue;
      const { cell: priceCell, occurrence } = priceCandidates[0]!;
      const fanOutAuthorized = cleanCellValue(header.value) === "사업자명"
        && fanOutNames.length > 1
        && fanOutNames.includes(vendor.vendor_name);
      if (fanOutAuthorized) {
        members.push({
          authority: "business_identity_fan_out",
          authorityKey: `${sourceFileId}\0${identity.sheet}!${identity.address}`,
          sourceFileId,
          sourceLocator: occurrence.source_locator,
          amountKrw,
          rawText: occurrence.raw,
          occurrenceKey: structuredOccurrenceKey(path, amountKrw),
          vendorName: vendor.vendor_name,
          expectedVendorNames: fanOutNames,
        });
        continue;
      }
      const priceMerge = mergeContainingCell(evidence, priceCell);
      if (
        !priceMerge
        || priceMerge.endRow <= priceMerge.startRow
        || !cellOverlapsRows(
          evidence,
          identity,
          priceMerge.startRow,
          priceMerge.endRow,
        )
      ) continue;
      const expectedVendorNames = physicalVendorNamesForVerticalMerge(
        evidence,
        identity,
        header,
        vendorCategory,
        priceMerge,
      );
      members.push({
        authority: "vertical_merge_interval",
        authorityKey: [
          sourceFileId,
          priceMerge.sheet,
          priceMerge.startColumn,
          priceMerge.endColumn,
          priceMerge.startRow,
          priceMerge.endRow,
        ].join("\0"),
        sourceFileId,
        sourceLocator: occurrence.source_locator,
        amountKrw,
        rawText: occurrence.raw,
        occurrenceKey: structuredOccurrenceKey(path, amountKrw),
        vendorName: vendor.vendor_name,
        expectedVendorNames,
      });
    }
  };

  input.data.partner_vendors.forEach((vendor, vendorIndex) => {
    addRecord(
      vendor,
      vendorIndex,
      `partner_vendors[${vendorIndex}]`,
      vendor.source_quote,
      vendor.source_file_ids,
      [vendor.price_min_krw, vendor.price_max_krw],
    );
    vendor.options.forEach((option, optionIndex) => addRecord(
      vendor,
      vendorIndex,
      `partner_vendors[${vendorIndex}].options[${optionIndex}]`,
      option.source_quote,
      option.source_file_ids,
      [option.price_min_krw, option.price_max_krw],
    ));
  });

  const grouped = new Map<string, CertifiedSharedMoneyMember[]>();
  for (const member of members) {
    const key = [
      member.authority,
      member.authorityKey,
      member.sourceFileId,
      member.sourceLocator,
      member.amountKrw,
      member.rawText,
    ].join("\0");
    grouped.set(key, [...(grouped.get(key) ?? []), member]);
  }
  return [...grouped.values()].flatMap((group): LocalDocxSharedMoneyGroup[] => {
    const first = group[0];
    if (!first) return [];
    const memberNames = [...new Set(group.map(({ vendorName }) => vendorName))].sort((a, b) => (
      a.localeCompare(b, "ko")
    ));
    const expectedNames = [...new Set(first.expectedVendorNames)].sort((a, b) => (
      a.localeCompare(b, "ko")
    ));
    const memberKeys = [...new Set(group.map(({ occurrenceKey }) => occurrenceKey))];
    if (
      memberNames.length < 2
      || memberKeys.length !== memberNames.length
      || JSON.stringify(memberNames) !== JSON.stringify(expectedNames)
      || group.some((member) => (
        member.authority !== first.authority
        || JSON.stringify([...new Set(member.expectedVendorNames)].sort((a, b) => a.localeCompare(b, "ko")))
          !== JSON.stringify(expectedNames)
      ))
    ) return [];
    return [{
      authority: first.authority,
      source_file_id: first.sourceFileId,
      source_locator: first.sourceLocator,
      amount_krw: first.amountKrw,
      raw_text: first.rawText,
      member_occurrence_keys: memberKeys.sort((a, b) => a.localeCompare(b, "en")),
    }];
  });
}
