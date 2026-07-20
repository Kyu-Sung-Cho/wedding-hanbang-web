import type { DisclosureExtraction } from "./schemas.js";
import { decodeEvidenceQuote } from "./merge-evidence.js";
import {
  looksLikeXlsxAuxiliaryEvidence,
  parseXlsxAuxiliaryEvidenceLine,
} from "./xlsx-aux-evidence.js";

export const MAX_STRUCTURED_LINKAGE_SOURCE_CHARACTERS = 4_000_000;
export const MAX_STRUCTURED_LINKAGE_SOURCE_LINES = 200_000;

export const STRUCTURED_RECORD_SOURCE_LINKAGE_CODES = [
  "source_evidence_limit_exceeded",
  "source_locator_invalid",
  "source_locator_ambiguous",
  "source_record_scope_ambiguous",
  "source_quote_payload_mismatch",
  "package_identity_not_linked",
  "package_category_not_linked",
  "vendor_identity_not_linked",
  "vendor_category_not_linked",
  "vendor_policy_text_not_linked",
  "vendor_policy_type_not_linked",
  "hall_identity_missing",
  "hall_identity_not_linked",
] as const;

export type StructuredRecordSourceLinkageCode =
  (typeof STRUCTURED_RECORD_SOURCE_LINKAGE_CODES)[number];

const STRUCTURED_RECORD_SOURCE_LINKAGE_CODE_SET: ReadonlySet<string> = new Set(
  STRUCTURED_RECORD_SOURCE_LINKAGE_CODES,
);

export function isStructuredRecordSourceLinkageCode(
  value: unknown,
): value is StructuredRecordSourceLinkageCode {
  return typeof value === "string"
    && STRUCTURED_RECORD_SOURCE_LINKAGE_CODE_SET.has(value);
}

export interface StructuredRecordSourceLinkageError {
  path: string;
  code: StructuredRecordSourceLinkageCode;
  message: string;
  locator: string | null;
}

const STRUCTURED_RECORD_SOURCE_LINKAGE_MESSAGES = {
  source_evidence_limit_exceeded: "구조화 레코드 연결 검증의 원문 크기 또는 행 수 상한을 초과했습니다.",
  source_locator_invalid: "가격 레코드의 source_quote가 원문의 정확한 셀 또는 행을 가리키지 않습니다.",
  source_locator_ambiguous: "가격 레코드의 source_quote locator가 원문에서 둘 이상 발견됩니다.",
  source_record_scope_ambiguous: "병합 근거가 하나의 결정적인 원문 레코드 범위에 속하지 않습니다.",
  source_quote_payload_mismatch: "source_quote의 인용문이 locator가 가리킨 원문에 없습니다.",
  package_identity_not_linked: "가격 근거에서 해당 패키지명을 확인할 수 없습니다.",
  package_category_not_linked: "가격 근거에서 해당 패키지의 카테고리 범위를 확인할 수 없습니다.",
  vendor_identity_not_linked: "근거에서 해당 제휴업체명 또는 원문에 명시된 상호 변경 관계를 확인할 수 없습니다.",
  vendor_category_not_linked: "가격 근거에서 해당 제휴업체 카테고리를 확인할 수 없습니다.",
  vendor_policy_text_not_linked: "정책 원문이 source_quote가 가리킨 근거에 없습니다.",
  vendor_policy_type_not_linked: "정책 근거에서 해당 정책 유형을 확인할 수 없습니다.",
  hall_identity_missing: "가격이 있는 홀 레코드에 홀 이름이 없습니다.",
  hall_identity_not_linked: "가격 근거에서 해당 홀 이름을 확인할 수 없습니다.",
} satisfies Record<StructuredRecordSourceLinkageCode, string>;

interface WorkbookCell {
  locator: string;
  sheet: string;
  sectionId: number;
  address: string;
  column: number;
  row: number;
  value: string;
}

interface SourceEvidenceIndex {
  lines: string[];
  auxiliaryByLocator: ReadonlyMap<string, readonly XlsxAuxiliaryRecord[]>;
  cellsByLocator: ReadonlyMap<string, readonly WorkbookCell[]>;
  cellsByRow: ReadonlyMap<string, readonly WorkbookCell[]>;
  cellsBySectionAddress: ReadonlyMap<string, readonly WorkbookCell[]>;
  mergesBySectionSheet: ReadonlyMap<string, readonly WorkbookMerge[]>;
  resolutionCache: Map<string, EvidenceResolution>;
}

interface WorkbookMerge {
  sheet: string;
  sectionId: number;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  anchorAddress: string;
}

interface XlsxAuxiliaryRecord {
  locator: string;
  payload: string;
}

interface ResolvedEvidence {
  locator: string;
  segments: string[];
  scope: EvidenceScope;
}

type EvidenceScope =
  | { kind: "line"; lineNumber: number }
  | { kind: "xlsx_auxiliary"; locator: string }
  | {
    kind: "xlsx";
    sheet: string;
    sectionId: number;
    row: number;
    startColumn: number;
    endColumn: number;
  };

interface PricedEvidenceReference {
  path: string;
  sourceQuote: string;
}

type EvidenceResolution =
  | ResolvedEvidence
  | StructuredRecordSourceLinkageError["code"];

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function segmentContainsIdentity(segment: string, identity: string): boolean {
  const normalizedSegment = normalizeEvidence(segment).toLowerCase();
  const identityCharacters = [...normalizeEvidence(identity).toLowerCase()]
    .filter((character) => /[\p{L}\p{N}]/u.test(character));
  // One-character names cannot establish a conservative record identity.
  if (identityCharacters.length < 2) return false;
  const flexibleIdentity = identityCharacters
    .map(escapedRegex)
    .join("[\\p{P}\\p{S}\\s]*");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${flexibleIdentity}(?:$|[^\\p{L}\\p{N}])`,
    "u",
  ).test(normalizedSegment);
}

const PARTNER_CATEGORY_LABELS: Readonly<Record<
  DisclosureExtraction["partner_vendors"][number]["category"],
  readonly string[]
>> = {
  studio: ["스튜디오", "studio"],
  dress: ["드레스", "dress"],
  makeup: ["메이크업", "makeup", "헤어 메이크업"],
  hall: ["예식장", "웨딩홀", "hall", "venue"],
  other: ["기타", "other"],
};

const AGENCY_CATEGORY_LABELS: Readonly<Record<
  DisclosureExtraction["agency_packages"][number]["category_scope"][number],
  readonly string[]
>> = {
  studio: ["스튜디오", "studio", "스드메"],
  dress: ["드레스", "dress", "스드메"],
  makeup: ["메이크업", "makeup", "헤어 메이크업", "스드메"],
};

const POLICY_TYPE_LABELS: Readonly<Partial<Record<
  NonNullable<DisclosureExtraction["partner_vendors"][number]["policies"]>[number]["policy_type"],
  readonly string[]
>>> = {
  penalty: ["위약금", "위약", "해약금", "취소 수수료", "penalty"],
  refund: ["환불", "환급", "반환", "refund"],
  change: ["변경", "change"],
};

const EXPLICIT_OLD_NAME_MARKER = /(?:구\s*(?:상호|업체명|이름)|이전\s*(?:상호|업체명|이름)|formerly|previously|renamed?\s+from|alias)/iu;

function evidenceContainsAnyLabel(
  segments: readonly string[],
  labels: readonly string[],
): boolean {
  return labels.some((label) =>
    segments.some((segment) => segmentContainsIdentity(segment, label))
  );
}

function evidenceLinksVendorIdentity(
  segments: readonly string[],
  vendorName: string,
  oldNames: readonly string[],
): boolean {
  if (segments.some((segment) => segmentContainsIdentity(segment, vendorName))) {
    return true;
  }

  // old_names is model output, not an authority. It can never authenticate a
  // vendor merely because one proposed old name appears in a price/policy row.
  // An alias is usable only when the bounded source evidence itself states the
  // relationship and contains the primary and old identities plus a clear
  // rename marker. (The primary-name branch above necessarily also succeeds
  // for such an explicit statement; this predicate makes the trust rule clear.)
  const relationship = normalizeEvidence(segments.join(" | "));
  return EXPLICIT_OLD_NAME_MARKER.test(relationship)
    && segmentContainsIdentity(relationship, vendorName)
    && oldNames.some((oldName) => segmentContainsIdentity(relationship, oldName));
}

function normalizedEvidenceContains(
  segments: readonly string[],
  expected: string,
): boolean {
  const normalizedExpected = normalizeEvidence(expected);
  if (normalizedExpected.length === 0) return false;
  return normalizeEvidence(segments.join(" ")).includes(normalizedExpected);
}

function containsExplicitMoney(value: string): boolean {
  return /(?:₩|krw\s*)\d|\d[\d,.]*\s*(?:억|천만|백만|만|천)?\s*원/iu.test(
    normalizeEvidence(value),
  );
}

function evidenceContainsCompetingIdentity(
  segments: readonly string[],
  currentIdentity: string,
  candidateIdentities: readonly (string | null)[],
): boolean {
  return candidateIdentities.some((identity) =>
    identity !== null
    && normalizeEvidence(identity) !== normalizeEvidence(currentIdentity)
    && segments.some((segment) => segmentContainsIdentity(segment, identity))
  );
}

function parseWorkbookCells(lines: readonly string[]): WorkbookCell[] {
  const cells: WorkbookCell[] = [];
  let sectionId = 0;
  for (const rawLine of lines) {
    if (/^##\s*시트:\s*(.+)$/u.test(rawLine.trim())) {
      sectionId += 1;
      continue;
    }
    if (looksLikeXlsxAuxiliaryEvidence(rawLine)) continue;
    const match = /^(.+)!([A-Z]+\d+):\s*(.*)$/u.exec(rawLine.trim());
    if (!match) continue;
    const row = Number.parseInt(match[2].match(/\d+$/u)?.[0] ?? "", 10);
    const column = workbookColumnNumber(match[2].match(/^[A-Z]+/u)?.[0] ?? "");
    if (
      !Number.isSafeInteger(row)
      || row < 1
      || !Number.isSafeInteger(column)
      || column < 1
    ) continue;
    const sheet = match[1].normalize("NFKC");
    cells.push({
      locator: `${sheet}!${match[2].toUpperCase()}`,
      sheet,
      sectionId,
      address: match[2].toUpperCase(),
      column,
      row,
      value: match[3],
    });
  }
  return cells;
}

function workbookColumnNumber(value: string): number {
  return [...value.toUpperCase()].reduce(
    (total, character) => total * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function parseWorkbookMerges(lines: readonly string[]): WorkbookMerge[] {
  const merges: WorkbookMerge[] = [];
  let sheet: string | null = null;
  let sectionId = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = /^##\s*시트:\s*(.+)$/u.exec(line);
    if (heading) {
      sheet = heading[1].trim().normalize("NFKC");
      sectionId += 1;
      continue;
    }
    if (!sheet) continue;
    const merge = /^병합 범위\s+([A-Z]+)(\d+):([A-Z]+)(\d+)\s*·\s*좌상단\s+([A-Z]+\d+)$/u.exec(line);
    if (!merge) continue;
    const startColumn = workbookColumnNumber(merge[1]);
    const endColumn = workbookColumnNumber(merge[3]);
    const startRow = Number.parseInt(merge[2], 10);
    const endRow = Number.parseInt(merge[4], 10);
    const anchorAddress = merge[5].toUpperCase();
    const expectedAnchorAddress = `${merge[1].toUpperCase()}${startRow}`;
    const area = (endColumn - startColumn + 1) * (endRow - startRow + 1);
    if (
      startColumn < 1
      || endColumn < startColumn
      || !Number.isSafeInteger(startRow)
      || !Number.isSafeInteger(endRow)
      || startRow < 1
      || endRow < startRow
      || !Number.isSafeInteger(area)
      || area > 512
      || anchorAddress !== expectedAnchorAddress
    ) continue;
    merges.push({
      sheet,
      sectionId,
      startRow,
      endRow,
      startColumn,
      endColumn,
      anchorAddress,
    });
  }
  return merges;
}

function appendToIndex<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sectionSheetKey(sectionId: number, sheet: string): string {
  return `${sectionId}\0${sheet}`;
}

function sectionAddressKey(
  sectionId: number,
  sheet: string,
  address: string,
): string {
  return `${sectionSheetKey(sectionId, sheet)}\0${address}`;
}

function rowKey(sectionId: number, sheet: string, row: number): string {
  return `${sectionSheetKey(sectionId, sheet)}\0${row}`;
}

/**
 * Returns the contiguous occupied column interval containing the cited cell.
 *
 * Converted XLSX text does not retain borders/table objects. A blank column is
 * therefore the only deterministic boundary available for separating two
 * side-by-side tables on one row. Adjacent tables with no blank column remain
 * indistinguishable and must be resolved by richer converter metadata or human
 * review; guessing a boundary from cell text would be fuzzy and unsafe.
 */
function contiguousEvidenceColumnInterval(
  matchingCell: WorkbookCell,
  rowCells: readonly WorkbookCell[],
  rowMerges: readonly WorkbookMerge[],
): { start: number; end: number } {
  const occupied = new Set<number>();
  for (const cell of rowCells) occupied.add(cell.column);
  for (const merge of rowMerges) {
    for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
      occupied.add(column);
    }
  }
  let start = matchingCell.column;
  let end = matchingCell.column;
  while (occupied.has(start - 1)) start -= 1;
  while (occupied.has(end + 1)) end += 1;
  return { start, end };
}

function buildSourceEvidenceIndex(sourceText: string): SourceEvidenceIndex {
  const lines = sourceText.split(/\r?\n/u);
  const cells = parseWorkbookCells(lines);
  const merges = parseWorkbookMerges(lines);
  const auxiliaryByLocator = new Map<string, XlsxAuxiliaryRecord[]>();
  const cellsByLocator = new Map<string, WorkbookCell[]>();
  const cellsByRow = new Map<string, WorkbookCell[]>();
  const cellsBySectionAddress = new Map<string, WorkbookCell[]>();
  const mergesBySectionSheet = new Map<string, WorkbookMerge[]>();
  for (const cell of cells) {
    appendToIndex(cellsByLocator, cell.locator, cell);
    appendToIndex(cellsByRow, rowKey(cell.sectionId, cell.sheet, cell.row), cell);
    appendToIndex(
      cellsBySectionAddress,
      sectionAddressKey(cell.sectionId, cell.sheet, cell.address),
      cell,
    );
  }
  for (const merge of merges) {
    appendToIndex(
      mergesBySectionSheet,
      sectionSheetKey(merge.sectionId, merge.sheet),
      merge,
    );
  }
  for (const rawLine of lines) {
    const auxiliary = parseXlsxAuxiliaryEvidenceLine(rawLine);
    if (auxiliary) appendToIndex(auxiliaryByLocator, auxiliary.locator, auxiliary);
  }
  return {
    lines,
    auxiliaryByLocator,
    cellsByLocator,
    cellsByRow,
    cellsBySectionAddress,
    mergesBySectionSheet,
    resolutionCache: new Map(),
  };
}

function parseXlsxQuote(value: string): { locator: string; payload: string } | null {
  if (looksLikeXlsxAuxiliaryEvidence(value)) return null;
  const match = /^(.+)!([A-Z]+\d+):\s*(.+)$/u.exec(value.trim());
  if (!match) return null;
  const payload = match[3].trim();
  if (/^[A-Z]+\d+(?::[A-Z]+\d+)?\s*:/iu.test(payload)) return null;
  if (/(?:^|[;|])\s*(?:[^;|]+!)?[A-Z]+\d+(?::[A-Z]+\d+)?\s*:/iu.test(payload)) {
    return null;
  }
  return {
    locator: `${match[1].normalize("NFKC")}!${match[2].toUpperCase()}`,
    payload,
  };
}

function normalizeEvidence(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/\\\|/gu, "|")
    .replace(/\s+/gu, " ")
    .trim();
}

function resolveSingleEvidence(
  quoteValue: string,
  index: SourceEvidenceIndex,
): EvidenceResolution {
  const auxiliaryQuote = parseXlsxAuxiliaryEvidenceLine(quoteValue);
  if (auxiliaryQuote) {
    const locatedByLocator = index.auxiliaryByLocator.get(auxiliaryQuote.locator) ?? [];
    if (locatedByLocator.length === 0) return "source_locator_invalid";
    const located = locatedByLocator.filter((candidate) =>
      normalizeEvidence(candidate.payload) === normalizeEvidence(auxiliaryQuote.payload)
    );
    if (located.length === 0) return "source_quote_payload_mismatch";
    if (located.length > 1) return "source_locator_ambiguous";
    return {
      locator: auxiliaryQuote.locator,
      segments: [located[0].payload],
      scope: { kind: "xlsx_auxiliary", locator: auxiliaryQuote.locator },
    };
  }
  if (looksLikeXlsxAuxiliaryEvidence(quoteValue)) return "source_locator_invalid";
  const lineQuote = /^line:(\d+):\s*(.+)$/iu.exec(normalizeEvidence(quoteValue));
  if (lineQuote) {
    const lineNumber = Number.parseInt(lineQuote[1], 10);
    const sourceLine = index.lines[lineNumber - 1];
    if (!Number.isSafeInteger(lineNumber) || lineNumber < 1 || sourceLine === undefined) {
      return "source_locator_invalid";
    }
    if (looksLikeXlsxAuxiliaryEvidence(sourceLine)) return "source_locator_invalid";
    if (!normalizeEvidence(sourceLine).includes(normalizeEvidence(lineQuote[2]))) {
      return "source_quote_payload_mismatch";
    }
    return {
      locator: `line:${lineNumber}`,
      segments: [sourceLine],
      scope: { kind: "line", lineNumber },
    };
  }
  const xlsxQuote = parseXlsxQuote(quoteValue);
  if (!xlsxQuote) return "source_locator_invalid";
  const locatedByAddress = index.cellsByLocator.get(xlsxQuote.locator) ?? [];
  if (locatedByAddress.length === 0) return "source_locator_invalid";
  const located = locatedByAddress.filter((cell) =>
    normalizeEvidence(cell.value).includes(normalizeEvidence(xlsxQuote.payload))
  );
  if (located.length === 0) {
    return "source_quote_payload_mismatch";
  }
  if (located.length > 1) return "source_locator_ambiguous";
  const matchingCell = located[0];
  const rowCells = index.cellsByRow.get(rowKey(
    matchingCell.sectionId,
    matchingCell.sheet,
    matchingCell.row,
  )) ?? [];
  const relevantMerges = index.mergesBySectionSheet.get(sectionSheetKey(
    matchingCell.sectionId,
    matchingCell.sheet,
  ))?.filter((merge) =>
    matchingCell.row >= merge.startRow && matchingCell.row <= merge.endRow
  ) ?? [];
  const interval = contiguousEvidenceColumnInterval(
    matchingCell,
    rowCells,
    relevantMerges,
  );
  const boundedRowCells = rowCells
    .filter((cell) => cell.column >= interval.start && cell.column <= interval.end)
    .sort((left, right) => left.column - right.column);
  // Two explicit-money cells in one borderless contiguous component may be a
  // legitimate min/max row or two adjacent tables. Without retained table
  // layout, choosing either interpretation would be unsafe, so require review.
  if (boundedRowCells.filter((cell) => containsExplicitMoney(cell.value)).length > 1) {
    return "source_record_scope_ambiguous";
  }
  const segments = boundedRowCells.map((cell) => cell.value);
  for (const merge of relevantMerges) {
    if (merge.endColumn < interval.start || merge.startColumn > interval.end) continue;
    const anchors = index.cellsBySectionAddress.get(sectionAddressKey(
      merge.sectionId,
      merge.sheet,
      merge.anchorAddress,
    )) ?? [];
    if (anchors.length > 1) return "source_locator_ambiguous";
    if (anchors.length === 1) segments.push(anchors[0].value);
  }
  return {
    locator: xlsxQuote.locator,
    segments,
    scope: {
      kind: "xlsx",
      sheet: matchingCell.sheet,
      sectionId: matchingCell.sectionId,
      row: matchingCell.row,
      startColumn: interval.start,
      endColumn: interval.end,
    },
  };
}

function resolveEvidence(
  quoteValue: string,
  index: SourceEvidenceIndex,
): EvidenceResolution {
  const cached = index.resolutionCache.get(quoteValue);
  if (cached !== undefined) return cached;
  const decoded = decodeEvidenceQuote(quoteValue);
  if (decoded.kind === "invalid") {
    index.resolutionCache.set(quoteValue, "source_locator_invalid");
    return "source_locator_invalid";
  }
  if (decoded.kind === "single") {
    const resolved = resolveSingleEvidence(decoded.quote, index);
    index.resolutionCache.set(quoteValue, resolved);
    return resolved;
  }
  const resolvedFragments: Array<{
    sourceFileId: string;
    evidence: ResolvedEvidence;
  }> = [];
  for (const fragment of decoded.fragments) {
    const resolved = resolveSingleEvidence(fragment.quote, index);
    if (typeof resolved === "string") {
      index.resolutionCache.set(quoteValue, resolved);
      return resolved;
    }
    resolvedFragments.push({
      sourceFileId: fragment.source_file_id,
      evidence: resolved,
    });
  }
  if (new Set(resolvedFragments.map(({ sourceFileId }) => sourceFileId)).size !== 1) {
    index.resolutionCache.set(quoteValue, "source_record_scope_ambiguous");
    return "source_record_scope_ambiguous";
  }
  const scopes = resolvedFragments.map(({ evidence }) => evidence.scope);
  const firstScope = scopes[0];
  if (firstScope.kind === "line") {
    if (!scopes.every((scope) => scope.kind === "line")) {
      index.resolutionCache.set(quoteValue, "source_record_scope_ambiguous");
      return "source_record_scope_ambiguous";
    }
    const lineNumbers = [...new Set(scopes.map((scope) => scope.lineNumber))]
      .sort((left, right) => left - right);
    if (lineNumbers.some((lineNumber, index) =>
      index > 0 && lineNumber !== lineNumbers[index - 1] + 1
    )) {
      index.resolutionCache.set(quoteValue, "source_record_scope_ambiguous");
      return "source_record_scope_ambiguous";
    }
  } else if (firstScope.kind === "xlsx") {
    if (!scopes.every((scope) =>
      scope.kind === "xlsx"
      && scope.sheet === firstScope.sheet
      && scope.sectionId === firstScope.sectionId
      && scope.row === firstScope.row
      && scope.startColumn === firstScope.startColumn
      && scope.endColumn === firstScope.endColumn
    )) {
      index.resolutionCache.set(quoteValue, "source_record_scope_ambiguous");
      return "source_record_scope_ambiguous";
    }
  } else if (!scopes.every((scope) =>
    scope.kind === "xlsx_auxiliary" && scope.locator === firstScope.locator
  )) {
    index.resolutionCache.set(quoteValue, "source_record_scope_ambiguous");
    return "source_record_scope_ambiguous";
  }
  const resolved = {
    locator: resolvedFragments.map(({ evidence }) => evidence.locator).join(" | "),
    segments: resolvedFragments.flatMap(({ evidence }) => evidence.segments),
    scope: firstScope,
  };
  index.resolutionCache.set(quoteValue, resolved);
  return resolved;
}

function linkageError(
  path: string,
  code: StructuredRecordSourceLinkageError["code"],
  locator: string | null,
): StructuredRecordSourceLinkageError {
  return {
    path,
    code,
    message: STRUCTURED_RECORD_SOURCE_LINKAGE_MESSAGES[code],
    locator,
  };
}

function pricedEvidenceReferences(
  parentPath: string,
  sourceQuote: string,
  directAmounts: Array<number | null>,
  options: Array<{
    price_min_krw: number | null;
    price_max_krw: number | null;
    source_quote: string;
  }>,
): PricedEvidenceReference[] {
  const result: PricedEvidenceReference[] = [];
  if (directAmounts.some((value) => value !== null)) {
    result.push({ path: `${parentPath}.source_quote`, sourceQuote });
  }
  for (const [optionIndex, option] of options.entries()) {
    if (option.price_min_krw === null && option.price_max_krw === null) continue;
    result.push({
      path: `${parentPath}.options[${optionIndex}].source_quote`,
      sourceQuote: option.source_quote,
    });
  }
  return result;
}

/**
 * Blocking identity-to-price linkage guard for schema-parsed extraction data.
 *
 * The caller must provide converted text concatenated in the same deterministic
 * order used to assign global `line:N` locators. Run this after the existing
 * source_file_id provenance and numeric-price evidence checks. Merged evidence
 * is checked fragment-by-fragment and is additionally confined to one source
 * file and one contiguous line/XLSX record scope here. No nearby prose or fuzzy
 * heading inference is used.
 */
export function validateStructuredRecordSourceLinkage(
  data: DisclosureExtraction,
  sourceText: string,
): StructuredRecordSourceLinkageError[] {
  if (sourceText.length > MAX_STRUCTURED_LINKAGE_SOURCE_CHARACTERS) {
    return [linkageError("$", "source_evidence_limit_exceeded", null)];
  }
  let lineCount = 1;
  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText.charCodeAt(index) !== 10) continue;
    lineCount += 1;
    if (lineCount > MAX_STRUCTURED_LINKAGE_SOURCE_LINES) {
      return [linkageError("$", "source_evidence_limit_exceeded", null)];
    }
  }
  const sourceIndex = buildSourceEvidenceIndex(sourceText);
  const errors: StructuredRecordSourceLinkageError[] = [];
  for (const [packageIndex, agencyPackage] of data.agency_packages.entries()) {
    const references = pricedEvidenceReferences(
      `agency_packages[${packageIndex}]`,
      agencyPackage.source_quote,
      [agencyPackage.price_min_krw, agencyPackage.price_max_krw],
      agencyPackage.options,
    );
    for (const reference of references) {
      const evidence = resolveEvidence(reference.sourceQuote, sourceIndex);
      if (typeof evidence === "string") {
        errors.push(linkageError(reference.path, evidence, null));
        continue;
      }
      if (evidenceContainsCompetingIdentity(
        evidence.segments,
        agencyPackage.package_name,
        data.agency_packages.map(({ package_name }) => package_name),
      )) {
        errors.push(linkageError(
          reference.path,
          "source_record_scope_ambiguous",
          evidence.locator,
        ));
        continue;
      }
      if (!evidence.segments.some((segment) =>
        segmentContainsIdentity(segment, agencyPackage.package_name)
      )) {
        errors.push(linkageError(
          reference.path,
          "package_identity_not_linked",
          evidence.locator,
        ));
      }
      if (agencyPackage.category_scope.some((category) =>
        !evidenceContainsAnyLabel(evidence.segments, AGENCY_CATEGORY_LABELS[category])
      )) {
        errors.push(linkageError(
          reference.path,
          "package_category_not_linked",
          evidence.locator,
        ));
      }
    }
  }
  for (const [partnerIndex, vendor] of data.partner_vendors.entries()) {
    const references = pricedEvidenceReferences(
      `partner_vendors[${partnerIndex}]`,
      vendor.source_quote,
      [vendor.price_min_krw, vendor.price_max_krw],
      vendor.options,
    );
    for (const reference of references) {
      const evidence = resolveEvidence(reference.sourceQuote, sourceIndex);
      if (typeof evidence === "string") {
        errors.push(linkageError(reference.path, evidence, null));
        continue;
      }
      if (evidenceContainsCompetingIdentity(
        evidence.segments,
        vendor.vendor_name,
        data.partner_vendors.map(({ vendor_name }) => vendor_name),
      )) {
        errors.push(linkageError(
          reference.path,
          "source_record_scope_ambiguous",
          evidence.locator,
        ));
        continue;
      }
      if (!evidenceLinksVendorIdentity(
        evidence.segments,
        vendor.vendor_name,
        vendor.old_names,
      )) {
        errors.push(linkageError(
          reference.path,
          "vendor_identity_not_linked",
          evidence.locator,
        ));
      }
      if (!PARTNER_CATEGORY_LABELS[vendor.category].some((label) =>
        evidence.segments.some((segment) => segmentContainsIdentity(segment, label))
      )) {
        errors.push(linkageError(
          reference.path,
          "vendor_category_not_linked",
          evidence.locator,
        ));
      }
    }
    for (const [policyIndex, policy] of (vendor.policies ?? []).entries()) {
      const path = `partner_vendors[${partnerIndex}].policies[${policyIndex}].source_quote`;
      const evidence = resolveEvidence(policy.source_quote, sourceIndex);
      if (typeof evidence === "string") {
        errors.push(linkageError(path, evidence, null));
        continue;
      }
      if (evidenceContainsCompetingIdentity(
        evidence.segments,
        vendor.vendor_name,
        data.partner_vendors.map(({ vendor_name }) => vendor_name),
      )) {
        errors.push(linkageError(
          path,
          "source_record_scope_ambiguous",
          evidence.locator,
        ));
        continue;
      }
      if (!evidenceLinksVendorIdentity(
        evidence.segments,
        vendor.vendor_name,
        vendor.old_names,
      )) {
        errors.push(linkageError(
          path,
          "vendor_identity_not_linked",
          evidence.locator,
        ));
      }
      if (!normalizedEvidenceContains(evidence.segments, policy.raw_text)) {
        errors.push(linkageError(
          path,
          "vendor_policy_text_not_linked",
          evidence.locator,
        ));
      }
      const typeLabels = POLICY_TYPE_LABELS[policy.policy_type];
      // `other` has no bounded lexical meaning. We still require exact policy
      // text and vendor identity, but do not guess a semantic type from prose.
      if (typeLabels !== undefined && !evidenceContainsAnyLabel(
        evidence.segments,
        typeLabels,
      )) {
        errors.push(linkageError(
          path,
          "vendor_policy_type_not_linked",
          evidence.locator,
        ));
      }
    }
  }
  for (const [hallIndex, hall] of (data.halls ?? []).entries()) {
    const references = pricedEvidenceReferences(
      `halls[${hallIndex}]`,
      hall.source_quote,
      [
        hall.meal_price_min_krw,
        hall.meal_price_max_krw,
        hall.venue_fee_min_krw,
        hall.venue_fee_max_krw,
        hall.decoration_fee_min_krw,
        hall.decoration_fee_max_krw,
      ],
      hall.options,
    );
    for (const reference of references) {
      if (hall.hall_name === null) {
        errors.push(linkageError(reference.path, "hall_identity_missing", null));
        continue;
      }
      const evidence = resolveEvidence(reference.sourceQuote, sourceIndex);
      if (typeof evidence === "string") {
        errors.push(linkageError(reference.path, evidence, null));
        continue;
      }
      if (evidenceContainsCompetingIdentity(
        evidence.segments,
        hall.hall_name,
        (data.halls ?? []).map(({ hall_name }) => hall_name),
      )) {
        errors.push(linkageError(
          reference.path,
          "source_record_scope_ambiguous",
          evidence.locator,
        ));
        continue;
      }
      if (!evidence.segments.some((segment) =>
        segmentContainsIdentity(segment, hall.hall_name ?? "")
      )) {
        errors.push(linkageError(
          reference.path,
          "hall_identity_not_linked",
          evidence.locator,
        ));
      }
    }
  }
  const legacyHallReferences: PricedEvidenceReference[] = [];
  if (data.hall.venue_fee_krw !== null) {
    legacyHallReferences.push({
      path: "hall.venue_fee_source_quote",
      sourceQuote: data.hall.venue_fee_source_quote ?? "",
    });
  }
  if (
    data.hall.meal_price_min_krw !== null
    || data.hall.meal_price_max_krw !== null
  ) {
    legacyHallReferences.push({
      path: "hall.meal_price_source_quote",
      sourceQuote: data.hall.meal_price_source_quote ?? "",
    });
  }
  for (const [itemIndex, item] of data.hall.items.entries()) {
    if (item.price_min_krw === null && item.price_max_krw === null) continue;
    legacyHallReferences.push({
      path: `hall.items[${itemIndex}].source_quote`,
      sourceQuote: item.source_quote,
    });
  }
  for (const reference of legacyHallReferences) {
    if (data.business_name === null) {
      errors.push(linkageError(reference.path, "hall_identity_missing", null));
      continue;
    }
    const evidence = resolveEvidence(reference.sourceQuote, sourceIndex);
    if (typeof evidence === "string") {
      errors.push(linkageError(reference.path, evidence, null));
      continue;
    }
    if (!evidence.segments.some((segment) =>
      segmentContainsIdentity(segment, data.business_name ?? "")
    )) {
      errors.push(linkageError(
        reference.path,
        "hall_identity_not_linked",
        evidence.locator,
      ));
    }
  }
  return errors;
}
