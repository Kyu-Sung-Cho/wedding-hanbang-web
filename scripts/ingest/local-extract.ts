import { encodeMergedEvidenceQuote } from "./merge-evidence.js";
import { DisclosureExtractionSchema } from "./schemas.js";
import type { DisclosureExtraction } from "./schemas.js";
import { scanSourceMoneyOccurrences } from "./validate.js";

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

type VendorCategory = "studio" | "dress" | "makeup";
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
}

interface LocatedMoney {
  occurrence: MoneyOccurrence;
  cell: WorkbookCell;
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
}

interface PackageAnchor {
  cell: WorkbookCell;
  header: WorkbookCell;
  headerEndRow: number;
  categoryScope: VendorCategory[];
  categoryEvidence: WorkbookCell[];
  endRow: number;
}

const WORKBOOK_CELL_PATTERN = /^(.+)!([A-Z]+)(\d+):\s*(.+)$/u;
const SHEET_HEADING_PATTERN = /^##\s*시트:\s*(.+)$/u;
const MERGE_PATTERN = /^병합\s*범위\s+([A-Z]+)(\d+):([A-Z]+)(\d+)\s*·\s*좌상단\s+([A-Z]+\d+)$/u;
const BUSINESS_HEADER_PATTERN = /^(?:(?:스튜디오|드레스|메이크업|헤어메이크업)\s*)?(?:사업자명|사업체명|사용자명|업체명|브랜드명|상호명|스튜디오명|드레스(?:샵)?명|메이크업(?:샵)?명)$/u;
const HALL_HEADER_PATTERN = /^(?:예식홀명|홀명|웨딩홀명)$/u;
const POLICY_PATTERN = /(?:위약|환불|환급|취소|계약\s*해지|해약)/u;
const PLACEHOLDER_VENDOR_PATTERN = /^(?:[A-Z](?:\s*(?:스튜디오|드레스|메이크업))?|[ㅇ○O]{2,}|해당\s*없음|없음|예시|샘플|\|+|⦙+)$/iu;
const PACKAGE_SHEET_PATTERN = /(?:토탈|패키지)/u;
const GENERIC_SHEET_PATTERN = /^Sheet\d*$/iu;
const EXPLICIT_TERMS_HEADING_PATTERN = /(?:계약\s*취소\s*및\s*환불\s*규정|지불\s*약정)/u;
const CATEGORY_ORDER: VendorCategory[] = ["studio", "dress", "makeup"];

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

function parseWorkbookEvidence(source: LocalTextEvidence): WorkbookEvidence {
  const cells: WorkbookCell[] = [];
  const merges: WorkbookMerge[] = [];
  let currentSheet = "";
  for (const rawLine of source.text.split(/\r?\n/u)) {
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
  return { cells, merges };
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

function categoryFromText(value: string): VendorCategory | null {
  const normalized = cleanCellValue(value);
  if (/(?:메이크업|헤어|원장급|부원장급|실장급)/u.test(normalized)) return "makeup";
  if (/(?:드레스|피팅|헬퍼|도우미)/u.test(normalized)) return "dress";
  if (/(?:스튜디오|스냅|앨범|페이지|작가\s*추가)/u.test(normalized)) return "studio";
  return null;
}

function policySectionType(value: string): NonNullable<DisclosureExtraction["sections"]>[number]["section_type"] {
  if (/위약/u.test(value)) return "penalty";
  if (/(?:환불|환급)/u.test(value)) return "refund_policy";
  if (/(?:취소|계약\s*해지|해약)/u.test(value)) return "contract_terms";
  if (/(?:예약|계약금)/u.test(value)) return "reservation";
  return "other";
}

function mergeForAnchor(evidence: WorkbookEvidence, cell: WorkbookCell): WorkbookMerge | null {
  return evidence.merges.find((merge) =>
    merge.sourceFileId === cell.sourceFileId
    && merge.sheet === cell.sheet
    && merge.anchorAddress === cell.address
  ) ?? null;
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
      cell.sheet === header.sheet
      && cell.column === header.column
      && cell.row > header.row
      && !BUSINESS_HEADER_PATTERN.test(cleanCellValue(cell.value))
    )
    .reduce((minimum, cell) => Math.min(minimum, cell.row), Number.POSITIVE_INFINITY);
  const windowEnd = Math.min(header.row + 2, firstVendorRow - 1);
  const window = [
    ...cells
      .filter((cell) =>
        cell.sheet === header.sheet
        && cell.row >= Math.max(1, header.row - 3)
        && cell.row <= windowEnd
      )
      .map((cell) => cell.value),
  ].join(" ");
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
  return cells
    .filter((cell) =>
      cell.sourceFileId === header.sourceFileId
      && cell.sheet === header.sheet
      && cell.row >= Math.max(1, header.row - 3)
      && cell.row <= windowEnd
      && categoryFromText(cell.value) === category
    )
    .sort((left, right) => right.row - left.row || left.column - right.column)[0] ?? null;
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
      const category = categoryForHeader(sheetCells, header)
        ?? (GENERIC_SHEET_PATTERN.test(sheet) && headers.length >= 3
          ? CATEGORY_ORDER[Math.min(index, CATEGORY_ORDER.length - 1)]!
          : null);
      result.push({
        header,
        category,
        categoryEvidence: categoryEvidenceForHeader(sheetCells, header, category),
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
    && !PLACEHOLDER_VENDOR_PATTERN.test(value)
    && scanSourceMoneyOccurrences(shortCellQuote(cell)).length === 0;
}

function vendorAnchors(evidence: WorkbookEvidence, sections: AgencySection[]): VendorAnchor[] {
  const result: VendorAnchor[] = [];
  for (const section of sections) {
    if (!section.category || PACKAGE_SHEET_PATTERN.test(section.header.sheet)) continue;
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
      result.push({
        cell,
        header: section.header,
        headerEndRow: candidates[0]!.row - 1,
        categoryEvidence: section.categoryEvidence,
        category: section.category,
        endRow: Math.min(
          section.endRow,
          merge?.endRow ?? ((candidates[index + 1]?.row ?? (section.endRow + 1)) - 1),
        ),
      });
    }
  }
  return result;
}

function packageAnchors(evidence: WorkbookEvidence, sections: AgencySection[]): PackageAnchor[] {
  const result: PackageAnchor[] = [];
  for (const section of sections) {
    if (!PACKAGE_SHEET_PATTERN.test(section.header.sheet)) continue;
    const sheetCells = evidence.cells.filter((cell) =>
      cell.sourceFileId === section.header.sourceFileId
      && cell.sheet === section.header.sheet
    );
    const candidates = sheetCells
      .filter((cell) =>
        cell.sourceFileId === section.header.sourceFileId
        && cell.sheet === section.header.sheet
        && cell.column === section.header.column
        && cell.row > section.header.row
        && cell.row <= section.endRow
        && isVendorAnchorCandidate(cell)
      )
      .sort((left, right) => left.row - right.row);
    const categoryEvidence = sheetCells
      .filter((cell) =>
        cell.row >= Math.max(1, section.header.row - 3)
        && cell.row < (candidates[0]?.row ?? Number.POSITIVE_INFINITY)
        && /(?:스드메|스튜디오|드레스|메이크업|헤어\s*메이크업)/u.test(cleanCellValue(cell.value))
      )
      .sort((left, right) => left.row - right.row || left.column - right.column);
    const categoryScope = [...new Set(categoryEvidence.flatMap((cell): VendorCategory[] => {
      if (/스드메/u.test(cleanCellValue(cell.value))) return [...CATEGORY_ORDER];
      const category = categoryFromText(cell.value);
      return category ? [category] : [];
    }))];
    for (const [index, cell] of candidates.entries()) {
      const merge = mergeForAnchor(evidence, cell);
      result.push({
        cell,
        header: section.header,
        headerEndRow: candidates[0]!.row - 1,
        categoryScope,
        categoryEvidence,
        endRow: Math.min(
          section.endRow,
          merge?.endRow ?? ((candidates[index + 1]?.row ?? (section.endRow + 1)) - 1),
        ),
      });
    }
  }
  return result;
}

function occurrenceSegment(cell: WorkbookCell, raw: string): string {
  const parts = cell.value.split(/(?:<br\s*\/?>|\r?\n)/giu).map((value) => value.trim());
  const containsExactToken = (value: string): boolean => {
    let fromIndex = 0;
    while (fromIndex <= value.length - raw.length) {
      const index = value.indexOf(raw, fromIndex);
      if (index < 0) return false;
      const before = index > 0 ? value[index - 1]! : "";
      const after = index + raw.length < value.length ? value[index + raw.length]! : "";
      if (!/[\d,.]/u.test(before) && !/[\d,.]/u.test(after)) return true;
      fromIndex = index + 1;
    }
    return false;
  };
  const containing = parts.find(containsExactToken) ?? raw;
  if (containing.length <= 850) return containing;
  const index = containing.indexOf(raw);
  const start = Math.max(0, index - 350);
  return containing.slice(start, Math.min(containing.length, start + 850));
}

function unitEvidenceForOccurrence(
  evidence: WorkbookEvidence,
  located: LocatedMoney,
  labelCell: WorkbookCell | null,
): WorkbookCell[] {
  const valueEvidence = { ...located.cell, value: occurrenceSegment(located.cell, located.occurrence.raw) };
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
  return [];
}

function optionFromOccurrence(
  evidence: WorkbookEvidence,
  located: LocatedMoney,
  labelCell: WorkbookCell | null = null,
  recordEvidence: WorkbookCell[] = [],
): StrictDisclosureExtraction["partner_vendors"][number]["options"][number] {
  const segment = occurrenceSegment(located.cell, located.occurrence.raw);
  const occurrenceIndex = segment.indexOf(located.occurrence.raw);
  const inlinePrefix = occurrenceIndex < 0
    ? ""
    : cleanCellValue(segment.slice(0, occurrenceIndex))
      .replace(/^[~\-–—:：·ㆍ]+|[~\-–—:：·ㆍ]+$/gu, "")
      .trim();
  const inlineName = inlinePrefix
    && scanSourceMoneyOccurrences(inlinePrefix).length === 0
    ? inlinePrefix.slice(0, 300)
    : null;
  const headerName = labelCell
    && !POLICY_PATTERN.test(labelCell.value)
    && scanSourceMoneyOccurrences(shortCellQuote(labelCell)).length === 0
    ? cleanCellValue(labelCell.value).slice(0, 300)
    : null;
  const name = inlineName ?? headerName ?? located.occurrence.raw;
  const valueEvidence = { ...located.cell, value: segment };
  const unitEvidence = unitEvidenceForOccurrence(evidence, located, labelCell);
  const supportingEvidence = [
    ...recordEvidence,
    ...(labelCell && name === headerName ? [labelCell] : []),
    ...unitEvidence,
  ];
  const sourceQuote = supportingEvidence.length > 0
    ? mergedQuote([...supportingEvidence, valueEvidence], 1_000)
      ?? shortCellQuote(located.cell, segment, 1_000)
    : shortCellQuote(located.cell, segment, 1_000);
  return {
    name,
    price_min_krw: located.occurrence.krw,
    price_max_krw: located.occurrence.krw,
    unit: null,
    condition: null,
    raw_text: located.occurrence.raw,
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

function vendorPolicyType(
  value: string,
): StrictDisclosureExtraction["partner_vendors"][number]["policies"][number]["policy_type"] {
  if (/(?:위약|취소|해지|해약)/u.test(value)) return "penalty";
  if (/(?:환불|환급)/u.test(value)) return "refund";
  if (/변경/u.test(value)) return "change";
  return "other";
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

function hallPriceKind(value: string): "meal" | "venue" | "decoration" | "option" {
  if (/(?:대관|홀\s*사용|장소)/u.test(value)) return "venue";
  if (/(?:장식|생화|꽃)/u.test(value)) return "decoration";
  if (/(?:식비|식대|메뉴|식사)/u.test(value)) return "meal";
  return "option";
}

function minMax(values: number[]): { minimum: number | null; maximum: number | null } {
  return values.length === 0
    ? { minimum: null, maximum: null }
    : { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function headerForHallColumn(
  evidence: WorkbookEvidence,
  hallHeader: WorkbookCell,
  hallRow: number,
  target: WorkbookCell,
): WorkbookCell | null {
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
  if (candidates[0]) return candidates[0];
  return evidence.cells
    .filter((cell) =>
      cell.sourceFileId === target.sourceFileId
      && cell.sheet === target.sheet
      && cell.row >= hallHeader.row
      && cell.row <= headerEndRow
      && cell.column < target.column
      && target.column - cell.column <= 1
    )
    .sort((left, right) => right.row - left.row || right.column - left.column)[0] ?? null;
}

function localHalls(
  evidence: WorkbookEvidence,
  locatedMoney: LocatedMoney[],
): { halls: LocalHall[]; linkedLocators: Set<string>; overflow: number } {
  const halls: LocalHall[] = [];
  const linkedLocators = new Set<string>();
  let overflow = 0;
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
      if (occurrences.length === 0) continue;
      const guaranteeCell = sheetCells.find((cell) =>
        cell.row >= anchor.row
        && cell.row <= endRow
        && /(?:기본|보증)\s*[\d,]+\s*명/u.test(cleanCellValue(cell.value))
      ) ?? null;
      const guaranteeMatch = guaranteeCell?.value.match(/(?:기본|보증)\s*([\d,]+)\s*명/u);
      const hall: LocalHall = {
        hall_name: cleanCellValue(anchor.value).slice(0, 300),
        guarantee_min: guaranteeMatch
          ? Number.parseInt(guaranteeMatch[1]!.replace(/,/gu, ""), 10)
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
        const columnHeader = headerForHallColumn(evidence, header, anchor.row, entry.cell);
        const kind = hallPriceKind(columnHeader?.value ?? "");
        linkedLocators.add(`${entry.cell.sourceFileId}\0${entry.occurrence.source_locator}\0${entry.occurrence.raw}`);
        if (kind === "option") {
          if (hall.options.length < 200) {
            hall.options.push(optionFromOccurrence(evidence, entry, columnHeader, [anchor]));
          }
          else overflow += 1;
          continue;
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
          const columnHeader = headerForHallColumn(evidence, header, anchor.row, entry.cell);
          if (hall.options.length < 200) {
            hall.options.push(optionFromOccurrence(evidence, entry, columnHeader, [anchor]));
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
          linkedLocators.add(`${entry.cell.sourceFileId}\0${entry.occurrence.source_locator}\0${entry.occurrence.raw}`);
          if (hall.options.length < 200) hall.options.push(optionFromOccurrence(
            evidence,
            entry,
            null,
            [anchor],
          ));
          else overflow += 1;
        }
      }
      const aggregateEvidence = [...fieldEvidence];
      for (const kind of ["meal", "venue", "decoration"] as const) {
        const range = minMax(byKind[kind]);
        for (const amount of new Set([range.minimum, range.maximum])) {
          if (amount === null) continue;
          const owner = entriesByKind[kind].find((entry) => entry.occurrence.krw === amount);
          if (!owner) continue;
          const headerCell = headerForHallColumn(evidence, header, anchor.row, owner.cell);
          if (headerCell) aggregateEvidence.push(headerCell);
          aggregateEvidence.push(...unitEvidenceForOccurrence(evidence, owner, headerCell));
        }
      }
      hall.source_quote = mergedQuote(aggregateEvidence, 2_000) ?? hall.source_quote;
      halls.push(hall);
    }
  }
  return { halls, linkedLocators, overflow };
}

/**
 * Conservative, network-free extraction from converter-owned text evidence.
 * Every emitted row is review-only and every value remains bound to an exact
 * source cell. Image facts are never inferred.
 */
export function extractDisclosureFromLocalEvidence(
  input: LocalDisclosureInput,
): StrictDisclosureExtraction {
  const parsedSources = input.sources.map((source) => ({
    source,
    evidence: parseWorkbookEvidence(source),
  }));
  const evidence: WorkbookEvidence = {
    cells: parsedSources.flatMap((entry) => entry.evidence.cells),
    merges: parsedSources.flatMap((entry) => entry.evidence.merges),
  };
  const cellByLocator = new Map(evidence.cells.map((cell) => [
    `${cell.sourceFileId}\0${cell.sheet}!${cell.address}`,
    cell,
  ]));
  const moneyOccurrences: NonNullable<DisclosureExtraction["money_occurrences"]> = [];
  const locatedMoney: LocatedMoney[] = [];
  const policyCells = new Map<string, WorkbookCell>();
  for (const { source } of parsedSources) {
    for (const occurrence of scanSourceMoneyOccurrences(source.text)) {
      const cell = cellByLocator.get(`${source.sourceFileId}\0${occurrence.source_locator}`);
      const policy = POLICY_PATTERN.test(occurrence.line_context);
      moneyOccurrences.push({
        amount_krw: occurrence.krw,
        raw_text: occurrence.raw,
        source_quote: `${occurrence.source_locator}: ${occurrence.raw}`.slice(0, 2_000),
        source_file_ids: [source.sourceFileId],
        kind: policy ? "policy" : "price",
        needs_review: true,
      });
      if (!cell) continue;
      locatedMoney.push({ occurrence, cell });
      if (policy) policyCells.set(`${source.sourceFileId}\0${occurrence.source_locator}`, cell);
    }
  }
  for (const cell of evidence.cells) {
    if (POLICY_PATTERN.test(cell.value)) {
      policyCells.set(`${cell.sourceFileId}\0${cell.sheet}!${cell.address}`, cell);
    }
  }

  const agencyPackages: StrictDisclosureExtraction["agency_packages"] = [];
  const partnerVendors: StrictDisclosureExtraction["partner_vendors"] = [];
  const partnerVendorsByExactScope = new Map<
    string,
    StrictDisclosureExtraction["partner_vendors"]
  >();
  const linkedLocators = new Set<string>();
  const consumedVendorPolicyCells = new Set<string>();
  let optionOverflow = 0;
  const tableSections = input.kindHint === "agency" ? agencySections(evidence) : [];
  if (input.kindHint === "agency") {
    const anchors = vendorAnchors(evidence, tableSections);
    for (const anchor of anchors) {
      const spanCells = evidence.cells.filter((cell) =>
        cell.sourceFileId === anchor.cell.sourceFileId
        && cell.sheet === anchor.cell.sheet
        && cell.row >= anchor.cell.row
        && cell.row <= anchor.endRow
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
      const occurrences = locatedMoney.filter((entry) =>
        entry.cell.sourceFileId === anchor.cell.sourceFileId
        && entry.cell.sheet === anchor.cell.sheet
        && entry.cell.row >= anchor.cell.row
        && entry.cell.row <= anchor.endRow
        && entry.cell.column > anchor.cell.column
        && !policyCellKeys.has(cellKey(entry.cell))
      );
      const options = occurrences.slice(0, 100).map((entry) =>
        optionFromOccurrence(
          evidence,
          entry,
          headerForVendorColumn(evidence, anchor, entry.cell),
          [anchor.cell, ...(anchor.categoryEvidence ? [anchor.categoryEvidence] : [])],
        )
      );
      optionOverflow += Math.max(0, occurrences.length - options.length);
      for (const entry of occurrences) {
        linkedLocators.add(`${entry.cell.sourceFileId}\0${entry.occurrence.source_locator}\0${entry.occurrence.raw}`);
      }
      for (const { cell } of policyCellsForVendor) {
        for (const entry of locatedMoney.filter((candidate) => cellKey(candidate.cell) === cellKey(cell))) {
          linkedLocators.add(`${entry.cell.sourceFileId}\0${entry.occurrence.source_locator}\0${entry.occurrence.raw}`);
        }
      }
      const partnerVendor: StrictDisclosureExtraction["partner_vendors"][number] = {
        vendor_name: cleanCellValue(anchor.cell.value).slice(0, 300),
        old_names: [],
        category: anchor.category,
        price_min_krw: null,
        price_max_krw: null,
        base_spec: null,
        price_note: null,
        options,
        policies: policyCellsForVendor.flatMap(({ cell, policyContext, unitEvidence }) =>
          splitNormalizedEvidenceChunks(cell.value).map((rawText) => {
            const quotedCell = { ...cell, value: rawText };
            const sourceQuote = mergedQuote([
              anchor.cell,
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
          [anchor.cell, ...(anchor.categoryEvidence ? [anchor.categoryEvidence] : [])],
          1_000,
        ) ?? shortCellQuote(anchor.cell, anchor.cell.value, 1_000),
        source_file_ids: [anchor.cell.sourceFileId],
        confidence: 0.45,
        needs_review: true,
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
            linkedLocators.add(
              `${entry.cell.sourceFileId}\0${entry.occurrence.source_locator}\0${entry.occurrence.raw}`,
            );
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

    for (const anchor of packageAnchors(evidence, tableSections)) {
      const spanCells = evidence.cells.filter((cell) =>
        cell.sourceFileId === anchor.cell.sourceFileId
        && cell.sheet === anchor.cell.sheet
        && cell.row >= anchor.cell.row
        && cell.row <= anchor.endRow
        && cell.column > anchor.cell.column
      );
      if (spanCells.length === 0) continue;
      const occurrences = locatedMoney.filter((entry) =>
        entry.cell.sourceFileId === anchor.cell.sourceFileId
        && entry.cell.sheet === anchor.cell.sheet
        && entry.cell.row >= anchor.cell.row
        && entry.cell.row <= anchor.endRow
        && entry.cell.column > anchor.cell.column
        && !POLICY_PATTERN.test(entry.occurrence.line_context)
      );
      const options = occurrences.slice(0, 100).map((entry) =>
        optionFromOccurrence(
          evidence,
          entry,
          headerForVendorColumn(evidence, anchor, entry.cell),
          [anchor.cell, ...anchor.categoryEvidence],
        )
      );
      optionOverflow += Math.max(0, occurrences.length - options.length);
      for (const entry of occurrences) {
        linkedLocators.add(`${entry.cell.sourceFileId}\0${entry.occurrence.source_locator}\0${entry.occurrence.raw}`);
      }
      agencyPackages.push({
        package_name: cleanCellValue(anchor.cell.value).slice(0, 300),
        category_scope: anchor.categoryScope,
        price_min_krw: null,
        price_max_krw: null,
        vat_note: null,
        price_note: null,
        options,
        source_quote: mergedQuote(
          [anchor.cell, ...anchor.categoryEvidence],
          1_000,
        ) ?? shortCellQuote(anchor.cell, anchor.cell.value, 1_000),
        source_file_ids: [anchor.cell.sourceFileId],
        confidence: 0.4,
        needs_review: true,
      });
    }
  }

  const hallResult = input.kindHint === "hall"
    ? localHalls(evidence, locatedMoney)
    : { halls: [] as LocalHall[], linkedLocators: new Set<string>(), overflow: 0 };
  for (const locator of hallResult.linkedLocators) linkedLocators.add(locator);
  optionOverflow += hallResult.overflow;

  const orderedPolicyCells = [...policyCells.values()]
    .sort((left, right) =>
      left.sourceFileId.localeCompare(right.sourceFileId, "en")
      || left.sheet.localeCompare(right.sheet, "ko")
      || left.column - right.column
      || left.row - right.row
    );
  const collapsedPolicyCells = orderedPolicyCells.filter((cell, index) => {
    const next = orderedPolicyCells[index + 1];
    return !(
      next
      && next.sourceFileId === cell.sourceFileId
      && next.sheet === cell.sheet
      && next.column === cell.column
      && next.row === cell.row + 1
      && next.value.length > cell.value.length
    );
  });
  const sectionCells = new Map<string, { cell: WorkbookCell; heading: WorkbookCell | null }>();
  for (const cell of collapsedPolicyCells) {
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
  const sections: NonNullable<DisclosureExtraction["sections"]> = [...sectionCells.values()]
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
        title: content.slice(0, 300),
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
  const unlinkedMoney = locatedMoney.filter((entry) =>
    !POLICY_PATTERN.test(entry.occurrence.line_context)
    && !linkedLocators.has(`${entry.cell.sourceFileId}\0${entry.occurrence.source_locator}\0${entry.occurrence.raw}`)
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
    halls: hallResult.halls,
    sections,
    money_occurrences: moneyOccurrences,
    hall: blankHall(),
    extraction_notes: [
      LOCAL_EXTRACTION_GUARD,
      "외부 API를 호출하지 않은 로컬 규칙 추출입니다. 모든 행은 관리자 검수가 필요합니다.",
      ...(input.hasImages ? ["[local_image_unread] 내장 이미지 내용은 자동 발행 근거로 사용하지 않았습니다."] : []),
      ...(optionOverflow > 0 ? [`[local_option_overflow] ${optionOverflow}개 금액은 감사 원장에만 보존됐습니다.`] : []),
      ...(unlinkedMoney > 0 ? [`[local_unlinked_money] ${unlinkedMoney}개 금액의 업체 연결은 사람 검수가 필요합니다.`] : []),
    ].join("\n").slice(0, 4_000),
  });
}
