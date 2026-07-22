/**
 * Read-only, deterministic topology extraction for canonical XLSX text.
 *
 * This module deliberately does not populate public hall aggregates. It emits
 * exact, source-backed review relations that a later integration step may
 * validate and stage. It has no filesystem, network, database, environment,
 * cache, or clock dependency.
 */

export interface HallXlsxTopologyInput {
  sourceFileId: string;
  canonicalText: string;
}

export type HallXlsxConditionKind = "date" | "season" | "discount" | "mode" | "other";

export interface HallXlsxCondition {
  condition_id: string;
  kind: HallXlsxConditionKind;
  text: string;
  source_file_id: string;
  source_locator: string;
  source_quote: string;
}

export interface HallXlsxHallComponent {
  hall_id: string;
  hall_name: string;
  source_file_id: string;
  source_locators: string[];
  source_quotes: string[];
  block_locators: string[];
  condition_ids: string[];
  needs_review: true;
}

export type HallXlsxPriceRelationKind =
  | "exact_hall"
  | "shared_hall_group"
  | "annex"
  | "companion_sheet"
  | "unbound_review"
  | "policy";

export interface HallXlsxMoneyOccurrence {
  occurrence_id: string;
  amount_krw: number;
  raw_text: string;
  source_file_id: string;
  source_locator: string;
  source_quote: string;
  unit_source_locator: string | null;
  price_header_locators: string[];
  condition_ids: string[];
  hall_ids: string[];
  block_locator: string | null;
  relation_kind: HallXlsxPriceRelationKind;
  bounded_bare: boolean;
  needs_review: true;
}

export interface HallXlsxPriceOption {
  option_id: string;
  name: string;
  raw_text: string;
  price_min_krw: number | null;
  price_max_krw: number | null;
  occurrence_ids: string[];
  source_file_id: string;
  source_locator: string;
  source_quote: string;
  label_locators: string[];
  condition_ids: string[];
  hall_ids: string[];
  relation_kind: Exclude<HallXlsxPriceRelationKind, "policy">;
  needs_review: true;
}

export interface HallXlsxEvidenceSpan {
  source_file_id: string;
  source_locator: string;
  source_quote: string;
  text: string;
}

export interface HallXlsxReviewNotice {
  code:
    | "sample_sheet_excluded"
    | "malformed_money_quarantined"
    | "non_price_number_quarantined"
    | "bounded_bare_price"
    | "companion_sheet_review"
    | "shared_hall_group"
    | "unbound_price_relation"
    | "ambiguous_mode_annex"
    | "repeated_hall_coalesced";
  sheet: string;
  source_locator: string | null;
  message: string;
}

export interface HallXlsxTopologyExtraction {
  hall_components: HallXlsxHallComponent[];
  price_options: HallXlsxPriceOption[];
  money_occurrences: HallXlsxMoneyOccurrence[];
  conditions: HallXlsxCondition[];
  policy_evidence: HallXlsxEvidenceSpan[];
  pricing_basis_evidence: HallXlsxEvidenceSpan[];
  review_notices: HallXlsxReviewNotice[];
}

interface WorkbookCell {
  sheet: string;
  address: string;
  column: number;
  row: number;
  rawValue: string;
  plainValue: string;
  locator: string;
  quote: string;
}

interface WorkbookMerge {
  sheet: string;
  startColumn: number;
  endColumn: number;
  startRow: number;
  endRow: number;
  anchorAddress: string;
}

interface ParsedWorkbook {
  cells: WorkbookCell[];
  merges: WorkbookMerge[];
  sheets: string[];
}

interface HallAnchor {
  cell: WorkbookCell;
  endRow: number;
  hallIds: string[];
  blockLocator: string;
}

interface HallBlock {
  header: WorkbookCell;
  startRow: number;
  endRow: number;
  anchors: HallAnchor[];
}

interface ScannedMoney {
  amountKrw: number;
  raw: string;
  start: number;
  end: number;
  boundedBare: boolean;
  unitSourceLocator: string | null;
  rangeKey: string | null;
  openDirection: "lower" | "upper" | null;
}

interface MoneyFragment {
  text: string;
  start: number;
  end: number;
}

interface InlineParentCondition {
  text: string;
  start: number;
}

interface ExactPriceLabel {
  name: string;
  locators: string[];
  rawText: string;
  parentCondition: InlineParentCondition | null;
}

const CELL_PATTERN = /^(.+)!([A-Z]+)([1-9][0-9]*):\s*(.*)$/u;
const SHEET_PATTERN = /^##\s*시트:\s*(.+)$/u;
const MERGE_PATTERN = /^병합\s*범위\s+([A-Z]+)([1-9][0-9]*):([A-Z]+)([1-9][0-9]*)\s*·\s*좌상단\s+([A-Z]+[1-9][0-9]*)$/u;
const HALL_HEADER_PATTERN = /^(?:예식홀명|웨딩홀명|예식홀|홀명)$/u;
const POLICY_PATTERN = /(?:위약|환불|환급|계약\s*해지|계약해제|취소|해약|공제)/u;
const PRICING_BASIS_PATTERN = /(?:①\s*)?(?:가격|금액)|\bPRICE\b|VAT|부가세|단위\s*[(:：]/iu;
const PRICE_SEMANTIC_PATTERN = /(?:\bPRICE\b|가격|금액|최고가|최저가|최대가|최소가|할인가|최종가|프로모션가|식비|식대|식음료|대관|장식|선택\s*(?:품목|상품|옵션)|옵션|상품|비용|요금|뷔페|메뉴|촬영|DVD|드레스|메이크업|부케|사회|축가|포토|음향|객실|케이터링|주류|음료|연주|폐백)/iu;
const GENERIC_PRICE_HEADER_PATTERN = /^(?:①\s*)?(?:가격|금액)(?:\s*\([^)]*\))?$|^(?:PRICE(?:\s*\/\s*가격)?|PRICE\s*\(가격\))$/iu;
const ITEM_HEADER_PATTERN = /^(?:ITEM(?:\s*\/\s*항목|\s*\(항목\))?|항목|품목|구분)$/iu;
const DESCRIPTION_HEADER_PATTERN = /^(?:구성|내용|REMARKS?|REMARKS?\s*\(내용\))$/iu;
const NON_PRICE_CONTEXT_PATTERN = /(?:사업자\s*등록|전화|연락처|\btel\b|\bfax\b|e-?mail|계좌|은행|예금주|작성일|날짜)/iu;
const COUNT_CONTEXT_PATTERN = /(?:보증\s*인원|지불\s*보증|인원|수량)|\d[\d,]*\s*(?:명|개|건|회|벌|장|부|권|페이지|컷|시간|분|일|개월|월|년)(?:\s|$|[),./])/u;
const CONTEXT_NON_PRICE_FIELD_PATTERN = /(?:사업자\s*등록(?:번호)?|전화(?:번호)?|연락처|\btel\b|\bfax\b|e-?mail|계좌(?:번호)?|은행|예금주|작성일(?:자)?|예식일자|날짜|지불\s*보증\s*인원|보증\s*인원|수용\s*인원|인원\s*수|^인원$|^수량$|^개수$|^횟수$|^시간$|예식\s*시간|^시각$|^타임$|위약금\s*율|^비율$|퍼센트|%)/iu;
const NON_OFFER_CONTEXT_PATTERN = /(?:샘플|예시|\btemplate\b|객실\s*(?:가|가격|요금)|할인액)/iu;
const ACCESSORY_SPACE_PATTERN = /(?:신부\s*대기\s*룸|폐백실|연회장|귀빈실|객실)/u;
const CONDITION_PATTERN = /(?:20\d{2}\s*년|\d{1,2}\s*월\s*[~～-]\s*\d{1,2}\s*월|성수기|비수기|골든|주중|주말|현역|예비역|군무원|가족|실내\s*예식|야외\s*예식|할인)/u;
const HALL_SERVICE_EXCLUSION_PATTERN = /(?:대관료|사용료|장식비|촬영비|현장\s*중계|미디어월|선택품목|옵션|가격|금액)/u;
const SAMPLE_SHEET_PATTERN = /^(?:샘플|sample|template|예시)$/iu;
const MONEY_UNIT_PATTERN = /(?:억원|천만원|백만원|만원|천원|원|억|만)/u;
const STRICT_CANONICAL_COMMA_PATTERN = /^\d{1,3}(?:,\d{3})+$/u;

function columnNumber(value: string): number {
  let result = 0;
  for (const character of value) result = result * 26 + character.charCodeAt(0) - 64;
  return result;
}

function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .trim();
}

function parseWorkbook(canonicalText: string): ParsedWorkbook {
  const cells: WorkbookCell[] = [];
  const merges: WorkbookMerge[] = [];
  const sheets: string[] = [];
  const seenCells = new Set<string>();
  let currentSheet: string | null = null;
  for (const line of canonicalText.split(/\r?\n/u)) {
    const sheetMatch = SHEET_PATTERN.exec(line);
    if (sheetMatch) {
      currentSheet = sheetMatch[1]!.trim();
      if (!sheets.includes(currentSheet)) sheets.push(currentSheet);
      continue;
    }
    const cellMatch = CELL_PATTERN.exec(line);
    if (cellMatch) {
      const sheet = cellMatch[1]!.trim();
      const address = `${cellMatch[2]!}${cellMatch[3]!}`;
      const key = `${sheet}\0${address}`;
      if (seenCells.has(key)) continue;
      seenCells.add(key);
      if (!sheets.includes(sheet)) sheets.push(sheet);
      const rawValue = cellMatch[4]!;
      cells.push({
        sheet,
        address,
        column: columnNumber(cellMatch[2]!),
        row: Number.parseInt(cellMatch[3]!, 10),
        rawValue,
        plainValue: plainText(rawValue),
        locator: `${sheet}!${address}`,
        quote: `${sheet}!${address}: ${rawValue}`,
      });
      continue;
    }
    const mergeMatch = MERGE_PATTERN.exec(line);
    if (mergeMatch && currentSheet) {
      merges.push({
        sheet: currentSheet,
        startColumn: columnNumber(mergeMatch[1]!),
        startRow: Number.parseInt(mergeMatch[2]!, 10),
        endColumn: columnNumber(mergeMatch[3]!),
        endRow: Number.parseInt(mergeMatch[4]!, 10),
        anchorAddress: mergeMatch[5]!,
      });
    }
  }
  cells.sort((left, right) => (
    sheets.indexOf(left.sheet) - sheets.indexOf(right.sheet)
    || left.row - right.row
    || left.column - right.column
  ));
  return { cells, merges, sheets };
}

function mergeForAnchor(workbook: ParsedWorkbook, cell: WorkbookCell): WorkbookMerge | null {
  return workbook.merges.find((merge) => (
    merge.sheet === cell.sheet && merge.anchorAddress === cell.address
  )) ?? null;
}

function mergeContaining(workbook: ParsedWorkbook, cell: WorkbookCell): WorkbookMerge | null {
  return workbook.merges.find((merge) => (
    merge.sheet === cell.sheet
    && cell.column >= merge.startColumn
    && cell.column <= merge.endColumn
    && cell.row >= merge.startRow
    && cell.row <= merge.endRow
  )) ?? null;
}

function mergeCoversColumn(
  workbook: ParsedWorkbook,
  cell: WorkbookCell,
  targetColumn: number,
): boolean {
  if (cell.column === targetColumn) return true;
  const merge = mergeForAnchor(workbook, cell);
  return Boolean(merge && targetColumn >= merge.startColumn && targetColumn <= merge.endColumn);
}

function conditionKind(value: string): HallXlsxConditionKind | null {
  if (!CONDITION_PATTERN.test(value)) return null;
  if (/20\d{2}\s*년|\d{1,2}\s*월\s*[~～-]\s*\d{1,2}\s*월/u.test(value)) return "date";
  if (/(?:성수기|비수기|골든|주중|주말)/u.test(value)) return "season";
  if (/(?:할인|현역|예비역|군무원|가족)/u.test(value)) return "discount";
  if (/(?:실내\s*예식|야외\s*예식)/u.test(value)) return "mode";
  return "other";
}

function normalizedHallName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("ko");
}

function cleanHallComponent(value: string): string {
  return value
    .replace(/^[\s,·/|]+|[\s,·/|]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function delimitedHallComponents(value: string): string[] | null {
  const parts = value.split(/\s*(?:\/|,|·|\|)\s*/u).map(cleanHallComponent).filter(Boolean);
  if (parts.length < 2) return null;
  const complete = parts.map((part) => /(?:홀|룸)(?:\s*\([^)]*\))?$/u.test(part));
  const allComplete = complete.every(Boolean);
  if (complete.some(Boolean) && !allComplete) return null;
  const allShortNames = complete.every((entry) => !entry) && parts.length <= 6 && parts.every((part) => (
    /^[\p{L}\p{N}][\p{L}\p{N}\s&'’.-]{0,30}$/u.test(part)
    && !/^\d+\s*F$/iu.test(part)
    && !HALL_SERVICE_EXCLUSION_PATTERN.test(part)
  ));
  return allComplete || allShortNames ? parts : null;
}

function suffixedHallComponents(value: string): string[] | null {
  const normalized = value.replace(/\n+/gu, " ").replace(/\s+/gu, " ").trim();
  const matches: string[] = [];
  let start = 0;
  for (const suffix of normalized.matchAll(/(?:홀|룸)(?!홀|룸)/gu)) {
    const end = suffix.index! + suffix[0].length;
    const component = cleanHallComponent(normalized.slice(start, end));
    if (component) matches.push(component);
    start = end;
  }
  if (normalized.slice(start).trim().length > 0) return null;
  if (matches.some((component) => /^(?:홀|룸)$/u.test(component))) return null;
  if (matches.slice(1).some((component) => /^\([^)]*\)\s*단독홀$/u.test(component))) return null;
  return matches.length >= 2 ? matches : null;
}

export function splitExactHallComponents(value: string): string[] {
  const normalized = plainText(value).replace(/\n+/gu, " ").replace(/\s+/gu, " ").trim();
  if (!normalized) return [];
  if (/\(\s*단독홀\s*\)\s*$/u.test(normalized)) return [normalized];
  return delimitedHallComponents(normalized)
    ?? suffixedHallComponents(normalized)
    ?? [normalized];
}

function exactHallIdentity(value: string): boolean {
  const normalized = plainText(value).replace(/\n+/gu, " ").trim();
  return normalized.length >= 2
    && normalized.length <= 300
    && !/^[A-Z]홀$/u.test(normalized)
    && !HALL_HEADER_PATTERN.test(normalized)
    && !POLICY_PATTERN.test(normalized)
    && !HALL_SERVICE_EXCLUSION_PATTERN.test(normalized)
    && !ACCESSORY_SPACE_PATTERN.test(normalized)
    && (
      /(?:홀|룸)(?:\s*\([^)]*\))?(?:\s|$|[/,·])/u.test(normalized)
      || /\((?:실내|야외)\s*예식\)\s*$/u.test(normalized)
      || /^야외\s*예식장\s*\(\s*기타\s*\)$/u.test(normalized)
      || /^[A-Za-z0-9][A-Za-z0-9 &'’.-]{0,100}\s+Ballroom(?:\s*\([^)]*\))?$/iu.test(normalized)
      || Boolean(delimitedHallComponents(normalized))
    );
}

function unitScale(unit: string): number | null {
  switch (unit.replace(/\s+/gu, "")) {
    case "원": return 1;
    case "천원": return 1_000;
    case "만원":
    case "만": return 10_000;
    case "백만원": return 1_000_000;
    case "천만원": return 10_000_000;
    case "억원":
    case "억": return 100_000_000;
    default: return null;
  }
}

function strictNumericValue(raw: string, unit: string): number | null {
  const normalized = raw.replace(/\s+/gu, "");
  if (normalized.includes(",") && !STRICT_CANONICAL_COMMA_PATTERN.test(normalized)) return null;
  if (normalized.includes(".") && !/^\d+(?:\.\d+)?$/u.test(normalized)) return null;
  if (normalized.includes(".") && unitScale(unit) === 1) return null;
  const numeric = Number(normalized.replace(/,/gu, ""));
  const scale = unitScale(unit);
  if (!Number.isFinite(numeric) || scale === null) return null;
  const result = numeric * scale;
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function declaredUnit(cell: WorkbookCell): string | null {
  const match = /(?:가격|금액)?\s*단위\s*(?:[(:：]\s*)?(억원|천만원|백만원|만원|천원|원|억|만)(?=\s|[).,/:：]|$)/iu.exec(cell.plainValue);
  return match?.[1]?.replace(/\s+/gu, "") ?? null;
}

function malformedMoneySpans(value: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const match of value.matchAll(/(?<![\d,.])\d[\d,.]*(?:억원|천만원|백만원|만원|천원|원|억|만)(?![\p{L}])/gu)) {
    const numeric = match[0].match(/^\d[\d,.]*/u)?.[0];
    const unit = match[0].slice(numeric?.length ?? 0);
    if (!numeric) continue;
    const commaValid = !numeric.includes(",") || STRICT_CANONICAL_COMMA_PATTERN.test(numeric);
    const dotValid = !numeric.includes(".") || (/^\d+\.\d+$/u.test(numeric) && unitScale(unit) !== 1);
    if (!commaValid || !dotValid || (numeric.includes(",") && numeric.includes("."))) {
      spans.push({ start: match.index!, end: match.index! + match[0].length });
    }
  }
  return spans;
}

function overlaps(
  start: number,
  end: number,
  spans: ReadonlyArray<{ start: number; end: number }>,
): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

function moneyFragments(value: string): MoneyFragment[] {
  const fragments: MoneyFragment[] = [];
  const separators = /\r?\n|[●•▶▷▪◦]|\//gu;
  let cursor = 0;
  const append = (rawStart: number, rawEnd: number): void => {
    const raw = value.slice(rawStart, rawEnd);
    const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
    const start = rawStart + leading;
    const end = Math.max(start, rawEnd - trailing);
    if (end <= start) return;
    fragments.push({ text: value.slice(start, end), start, end });
  };
  for (const match of value.matchAll(separators)) {
    append(cursor, match.index!);
    cursor = match.index! + match[0].length;
  }
  append(cursor, value.length);
  return fragments;
}

function fragmentForMoney(value: string, money: Pick<ScannedMoney, "start" | "end">): MoneyFragment {
  return moneyFragments(value).find((fragment) => (
    money.start >= fragment.start && money.end <= fragment.end
  )) ?? { text: value.trim(), start: 0, end: value.length };
}

function previousMoneylessLine(
  value: string,
  money: Pick<ScannedMoney, "start" | "end">,
): InlineParentCondition | null {
  const lineStart = value.lastIndexOf("\n", Math.max(0, money.start - 1)) + 1;
  if (lineStart === 0) return null;
  const previousEnd = lineStart - 1;
  const previousStart = value.lastIndexOf("\n", Math.max(0, previousEnd - 1)) + 1;
  const raw = value.slice(previousStart, previousEnd);
  const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
  const text = raw.trim();
  if (
    text.length < 2
    || text.length > 120
    || !/[\p{L}]/u.test(text)
    || /\d[\d,.]*\s*(?:억원|천만원|백만원|만원|천원|원|억|만)/u.test(text)
    || GENERIC_PRICE_HEADER_PATTERN.test(text)
    || NON_PRICE_CONTEXT_PATTERN.test(text)
  ) return null;
  return { text, start: previousStart + leading };
}

function openDirectionAround(
  value: string,
  start: number,
  end: number,
): ScannedMoney["openDirection"] {
  const fragment = fragmentForMoney(value, { start, end });
  const before = value.slice(fragment.start, start);
  const after = value.slice(end, fragment.end);
  if (/(?:[~～〜–—]|\s-)\s*$/u.test(before)) return "upper";
  if (/^\s*(?:[~～〜–—]|-\s)/u.test(after)) return "lower";
  return null;
}

function priceHeaderCells(
  workbook: ParsedWorkbook,
  cell: WorkbookCell,
  lowerRow = 0,
): WorkbookCell[] {
  return workbook.cells
    .filter((candidate) => (
      candidate.sheet === cell.sheet
      && candidate.row >= lowerRow
      && candidate.row <= cell.row
      && PRICE_SEMANTIC_PATTERN.test(candidate.plainValue)
      && (
        mergeCoversColumn(workbook, candidate, cell.column)
        || (
          candidate.row === cell.row
          && candidate.column < cell.column
          && cell.column - candidate.column <= 3
        )
      )
    ))
    .sort((left, right) => right.row - left.row || right.column - left.column);
}

function moneyContextCells(
  workbook: ParsedWorkbook,
  target: WorkbookCell,
  lowerRow: number,
): WorkbookCell[] {
  const candidates = [
    target,
    ...workbook.cells.filter((cell) => (
      cell.sheet === target.sheet
      && cell.row === target.row
      && cell.column === target.column - 1
    )),
    ...workbook.cells.filter((cell) => (
      cell.sheet === target.sheet
      && cell.row >= lowerRow
      && cell.row < target.row
      && mergeCoversColumn(workbook, cell, target.column)
      && !/\d/u.test(cell.plainValue)
      && (
        CONTEXT_NON_PRICE_FIELD_PATTERN.test(cell.plainValue)
        || NON_OFFER_CONTEXT_PATTERN.test(cell.plainValue)
      )
    )),
    ...workbook.cells.filter((cell) => {
      if (cell.sheet !== target.sheet || cell.column >= target.column) return false;
      const merge = mergeForAnchor(workbook, cell);
      return Boolean(
        merge
        && target.row >= merge.startRow
        && target.row <= merge.endRow
        && merge.endColumn === target.column - 1
      );
    }),
  ];
  const seen = new Set<string>();
  return candidates.filter((cell) => {
    if (seen.has(cell.locator)) return false;
    seen.add(cell.locator);
    return true;
  });
}

function hasDocumentPriceScope(cells: readonly WorkbookCell[], target: WorkbookCell): boolean {
  return cells.some((cell) => (
    cell.sheet === target.sheet
    && cell.row <= target.row
    && (GENERIC_PRICE_HEADER_PATTERN.test(cell.plainValue) || PRICING_BASIS_PATTERN.test(cell.plainValue))
  ));
}

function nearestDeclaredUnit(
  cells: readonly WorkbookCell[],
  target: WorkbookCell,
): { unit: string; locator: string } | null {
  const candidates = cells
    .flatMap((cell) => {
      const unit = cell.sheet === target.sheet && cell.row <= target.row ? declaredUnit(cell) : null;
      return unit ? [{ unit, locator: cell.locator, row: cell.row }] : [];
    })
    .sort((left, right) => right.row - left.row);
  const nearestRow = candidates[0]?.row;
  if (nearestRow === undefined) return null;
  const nearest = candidates.filter((candidate) => candidate.row === nearestRow);
  return new Set(nearest.map(({ unit }) => unit)).size === 1 ? nearest[0]! : null;
}

function explicitWonSupportInRow(
  workbook: ParsedWorkbook,
  target: WorkbookCell,
): WorkbookCell | null {
  return workbook.cells.find((cell) => (
    cell.sheet === target.sheet
    && cell.row === target.row
    && cell.locator !== target.locator
    && /(?:\d{1,3}(?:,\d{3})+|\d+)\s*원(?:\s|\/|$)/u.test(cell.plainValue)
    && !NON_PRICE_CONTEXT_PATTERN.test(cell.plainValue)
  )) ?? null;
}

function explicitWonSupportInSheet(
  workbook: ParsedWorkbook,
  target: WorkbookCell,
): WorkbookCell | null {
  return workbook.cells.find((cell) => (
    cell.sheet === target.sheet
    && /(?:\d{1,3}(?:,\d{3})+|\d+)\s*원(?:\s|\/|$)/u.test(cell.plainValue)
    && !NON_PRICE_CONTEXT_PATTERN.test(cell.plainValue)
  )) ?? null;
}

function barePriceSupport(
  workbook: ParsedWorkbook,
  cell: WorkbookCell,
  headers: readonly WorkbookCell[],
): { unit: string; locator: string } | null {
  if (NON_PRICE_CONTEXT_PATTERN.test(cell.plainValue)) return null;
  if (COUNT_CONTEXT_PATTERN.test(cell.plainValue) || /\d+(?:\.\d+)?\s*%/u.test(cell.plainValue)) return null;
  const declaration = nearestDeclaredUnit(workbook.cells, cell);
  if (declaration && headers.length > 0) return declaration;
  if (headers.length === 0 || !hasDocumentPriceScope(workbook.cells, cell)) return null;
  const rowSupport = explicitWonSupportInRow(workbook, cell);
  if (rowSupport) return { unit: "원", locator: rowSupport.locator };
  const sheetSupport = explicitWonSupportInSheet(workbook, cell);
  return sheetSupport ? { unit: "원", locator: sheetSupport.locator } : null;
}

function scanMoneyInCell(
  workbook: ParsedWorkbook,
  cell: WorkbookCell,
  headers: readonly WorkbookCell[],
  lowerRow: number,
  addNotice: (notice: HallXlsxReviewNotice) => void,
): ScannedMoney[] {
  const value = cell.plainValue;
  const malformed = malformedMoneySpans(value);
  if (malformed.length > 0) {
    addNotice({
      code: "malformed_money_quarantined",
      sheet: cell.sheet,
      source_locator: cell.locator,
      message: "비표준 숫자 구분자는 금액으로 해석하지 않고 원문 위치만 검수 대상으로 유지합니다.",
    });
  }
  const contexts = moneyContextCells(workbook, cell, lowerRow);
  const contextualExclusion = contexts.some(({ plainValue }) => (
    CONTEXT_NON_PRICE_FIELD_PATTERN.test(plainValue)
    || NON_OFFER_CONTEXT_PATTERN.test(plainValue)
  ));
  if (contextualExclusion) {
    if (/\d/u.test(value)) {
      addNotice({
        code: "non_price_number_quarantined",
        sheet: cell.sheet,
        source_locator: cell.locator,
        message: "라벨·세로 부모·열 서브헤더를 포함한 전체 문맥이 비가격 숫자이므로 검수 대상으로 격리합니다.",
      });
    }
    return [];
  }
  const nonPriceContext = NON_PRICE_CONTEXT_PATTERN.test(value);
  const occupied: Array<{ start: number; end: number }> = [...malformed];
  const scanned: ScannedMoney[] = [];
  const push = (entry: ScannedMoney): void => {
    if (overlaps(entry.start, entry.end, occupied)) return;
    occupied.push({ start: entry.start, end: entry.end });
    scanned.push(entry);
  };

  const bracketPattern = /\[\s*(\d{1,3}(?:,\d{3})+)\s*\]\s*(억원|천만원|백만원|만원|천원|원|억|만)/gu;
  for (const match of value.matchAll(bracketPattern)) {
    const amount = strictNumericValue(match[1]!, match[2]!);
    if (amount === null || nonPriceContext) continue;
    push({
      amountKrw: amount,
      raw: match[0],
      start: match.index!,
      end: match.index! + match[0].length,
      boundedBare: false,
      unitSourceLocator: cell.locator,
      rangeKey: null,
      openDirection: openDirectionAround(value, match.index!, match.index! + match[0].length),
    });
  }

  const dualUnitRangePattern = /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(억원|천만원|백만원|만원|천원|원|억|만)\s*([~～〜–—-])\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(억원|천만원|백만원|만원|천원|원|억|만)(?![\p{L}])/gu;
  for (const match of value.matchAll(dualUnitRangePattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (overlaps(start, end, malformed) || nonPriceContext) continue;
    const left = strictNumericValue(match[1]!, match[2]!);
    const right = strictNumericValue(match[4]!, match[5]!);
    if (left === null || right === null) continue;
    const rangeKey = `${cell.locator}\0${start}\0${end}`;
    const separatorOffset = match[0].indexOf(match[3]!, match[1]!.length + match[2]!.length);
    const leftOffset = match[0].indexOf(match[1]!);
    const leftRawEnd = separatorOffset < 0 ? match[0].length : separatorOffset;
    const leftRaw = match[0].slice(leftOffset, leftRawEnd).trimEnd();
    const rightOffset = match[0].lastIndexOf(match[4]!);
    const rightRaw = match[0].slice(rightOffset).trim();
    occupied.push({ start, end });
    scanned.push({
      amountKrw: left,
      raw: leftRaw,
      start: start + leftOffset,
      end: start + leftOffset + leftRaw.length,
      boundedBare: false,
      unitSourceLocator: cell.locator,
      rangeKey,
      openDirection: null,
    }, {
      amountKrw: right,
      raw: rightRaw,
      start: start + rightOffset,
      end: start + rightOffset + rightRaw.length,
      boundedBare: false,
      unitSourceLocator: cell.locator,
      rangeKey,
      openDirection: null,
    });
  }

  const sharedRangePattern = /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d+)\s*([~～〜–—-])\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(억원|천만원|백만원|만원|천원|원|억|만)(?![\p{L}])/gu;
  for (const match of value.matchAll(sharedRangePattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (overlaps(start, end, malformed) || nonPriceContext) continue;
    const left = strictNumericValue(match[1]!, match[4]!);
    const right = strictNumericValue(match[3]!, match[4]!);
    if (left === null || right === null) continue;
    const rangeKey = `${cell.locator}\0${start}\0${end}`;
    occupied.push({ start, end });
    const leftOffset = match[0].indexOf(match[1]!);
    const rightOffset = match[0].lastIndexOf(match[3]!);
    scanned.push({
      amountKrw: left,
      raw: match[1]!,
      start: start + leftOffset,
      end: start + leftOffset + match[1]!.length,
      boundedBare: false,
      unitSourceLocator: cell.locator,
      rangeKey,
      openDirection: null,
    }, {
      amountKrw: right,
      raw: `${match[3]!}${match[4]!}`,
      start: start + rightOffset,
      end,
      boundedBare: false,
      unitSourceLocator: cell.locator,
      rangeKey,
      openDirection: null,
    });
  }

  const explicitPattern = /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(억원|천만원|백만원|만원|천원|원|억|만)(?![\p{L}])/gu;
  for (const match of value.matchAll(explicitPattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (overlaps(start, end, occupied) || nonPriceContext) continue;
    const amount = strictNumericValue(match[1]!, match[2]!);
    if (amount === null) continue;
    push({
      amountKrw: amount,
      raw: match[0],
      start,
      end,
      boundedBare: false,
      unitSourceLocator: cell.locator,
      rangeKey: null,
      openDirection: openDirectionAround(value, start, end),
    });
  }

  const support = barePriceSupport(workbook, cell, headers);
  const barePattern = /(?<![\d,.])(0|\d{1,3}(?:,\d{3})+)(?![\d,.])/gu;
  for (const match of value.matchAll(barePattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (overlaps(start, end, occupied)) continue;
    const digitCount = match[1]!.replace(/,/gu, "").length;
    if (digitCount >= 12 && digitCount <= 14) {
      addNotice({
        code: "non_price_number_quarantined",
        sheet: cell.sheet,
        source_locator: cell.locator,
        message: "12~14자리 무단위 숫자는 계좌·식별자 가능성으로 인해 금액으로 승격하지 않습니다.",
      });
      continue;
    }
    const trailing = value.slice(end).match(/^\s*([\p{L}%]+)/u)?.[1] ?? "";
    if (/^(?:명|개|건|회|벌|장|부|권|페이지|컷|시간|분|일|개월|월|년|%)/u.test(trailing)) {
      addNotice({
        code: "non_price_number_quarantined",
        sheet: cell.sheet,
        source_locator: cell.locator,
        message: "수량·기간·비율 문맥의 숫자는 가격으로 승격하지 않습니다.",
      });
      continue;
    }
    if (!support) {
      if (headers.length > 0 || NON_PRICE_CONTEXT_PATTERN.test(value) || COUNT_CONTEXT_PATTERN.test(value)) {
        addNotice({
          code: "non_price_number_quarantined",
          sheet: cell.sheet,
          source_locator: cell.locator,
          message: "정확한 가격 단위 또는 제한된 가격 표 문맥이 없는 숫자는 격리합니다.",
        });
      }
      continue;
    }
    const amount = strictNumericValue(match[1]!, support.unit);
    if (amount === null) continue;
    scanned.push({
      amountKrw: amount,
      raw: match[1]!,
      start,
      end,
      boundedBare: true,
      unitSourceLocator: support.locator,
      rangeKey: null,
      openDirection: openDirectionAround(value, start, end),
    });
    occupied.push({ start, end });
    addNotice({
      code: "bounded_bare_price",
      sheet: cell.sheet,
      source_locator: cell.locator,
      message: "정확한 가격 표와 단위 근거에 한정해 bare 금액을 검수용 관계로 보존했습니다.",
    });
  }

  return scanned.sort((left, right) => left.start - right.start || left.end - right.end);
}

function conditionCellsFor(
  workbook: ParsedWorkbook,
  target: WorkbookCell,
  lowerRow: number,
): WorkbookCell[] {
  const candidates = workbook.cells
    .filter((cell) => (
      cell.sheet === target.sheet
      && cell.row >= Math.max(0, lowerRow - 3)
      && cell.row <= target.row
      && cell.locator !== target.locator
      && conditionKind(cell.plainValue) !== null
      && (
        mergeCoversColumn(workbook, cell, target.column)
        || cell.column <= target.column
        || cell.row < lowerRow
      )
    ))
    .sort((left, right) => right.row - left.row || right.column - left.column);
  const nearestByKind = new Map<HallXlsxConditionKind, WorkbookCell>();
  for (const cell of candidates) {
    const kind = conditionKind(cell.plainValue);
    if (kind && !nearestByKind.has(kind)) nearestByKind.set(kind, cell);
  }
  return [...nearestByKind.values()].sort((left, right) => left.row - right.row || left.column - right.column);
}

function rowCells(workbook: ParsedWorkbook, target: WorkbookCell): WorkbookCell[] {
  return workbook.cells.filter((cell) => cell.sheet === target.sheet && cell.row === target.row);
}

function tableHeaderForColumn(
  workbook: ParsedWorkbook,
  target: WorkbookCell,
  pattern: RegExp,
  lowerRow: number,
): WorkbookCell | null {
  return workbook.cells
    .filter((cell) => (
      cell.sheet === target.sheet
      && cell.row >= lowerRow
      && cell.row < target.row
      && pattern.test(cell.plainValue)
      && mergeCoversColumn(workbook, cell, target.column)
    ))
    .sort((left, right) => right.row - left.row)[0] ?? null;
}

function exactLabelForPrice(
  workbook: ParsedWorkbook,
  target: WorkbookCell,
  money: ScannedMoney,
  lowerRow: number,
): ExactPriceLabel {
  const fragment = fragmentForMoney(target.plainValue, money);
  const numericIndex = Math.max(0, money.start - fragment.start);
  const inline = numericIndex > 0
    ? fragment.text
      .slice(0, numericIndex)
      .replace(/^[\s●•▶▷▪◦·:：~～〜–—/-]+|[\s●•▶▷▪◦·:：~～〜–—/-]+$/gu, "")
      .trim()
    : "";
  const base = {
    rawText: fragment.text,
    parentCondition: previousMoneylessLine(target.plainValue, money),
  };
  if (
    (inline.length >= 2 || /^(?:여|남)$/u.test(inline))
    && inline.length <= 120
    && !GENERIC_PRICE_HEADER_PATTERN.test(inline)
    && !NON_PRICE_CONTEXT_PATTERN.test(inline)
  ) return { name: inline, locators: [target.locator], ...base };

  const sameRow = rowCells(workbook, target);
  const itemColumns = workbook.cells.filter((header) => (
    header.sheet === target.sheet
    && header.row >= lowerRow
    && header.row < target.row
    && ITEM_HEADER_PATTERN.test(header.plainValue)
  ));
  const itemCell = sameRow
    .filter((cell) => cell.column < target.column && !/\d[\d,.]*\s*(?:원|만)/u.test(cell.plainValue))
    .find((cell) => itemColumns.some((header) => mergeCoversColumn(workbook, header, cell.column))) ?? null;

  const verticalParent = workbook.cells
    .filter((cell) => {
      if (cell.sheet !== target.sheet || cell.column >= target.column) return false;
      const merge = mergeForAnchor(workbook, cell);
      return Boolean(
        merge
        && target.row >= merge.startRow
        && target.row <= merge.endRow
        && merge.endColumn < target.column
        && cell.plainValue.length > 0
        && !exactHallIdentity(cell.plainValue)
      );
    })
    .sort((left, right) => right.column - left.column)[0] ?? null;

  const headers = priceHeaderCells(workbook, target, lowerRow);
  const specificHeader = headers.find((header) => (
    !GENERIC_PRICE_HEADER_PATTERN.test(header.plainValue)
  )) ?? null;

  const nearestLeft = sameRow
    .filter((cell) => (
      cell.column < target.column
      && cell.plainValue.length > 0
      && !/\d[\d,.]*\s*(?:원|만)/u.test(cell.plainValue)
      && !HALL_HEADER_PATTERN.test(cell.plainValue)
      && !exactHallIdentity(cell.plainValue)
    ))
    .sort((left, right) => right.column - left.column)[0] ?? null;
  const primary = itemCell ?? verticalParent ?? specificHeader ?? nearestLeft;

  const rightDescription = sameRow
    .filter((cell) => cell.column > target.column && cell.plainValue.length > 0)
    .find((cell) => tableHeaderForColumn(
      workbook,
      cell,
      DESCRIPTION_HEADER_PATTERN,
      lowerRow,
    ) !== null) ?? null;

  const names = [primary?.plainValue, rightDescription?.plainValue]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\n+/gu, " ").replace(/\s+/gu, " ").trim());
  const locators = [primary?.locator, rightDescription?.locator]
    .filter((value): value is string => Boolean(value));
  if (names.length > 0) {
    return { name: names.join(" · ").slice(0, 240), locators, ...base };
  }

  const specific = headers.find((header) => !GENERIC_PRICE_HEADER_PATTERN.test(header.plainValue));
  return specific
    ? {
      name: specific.plainValue.slice(0, 240),
      locators: [specific.locator],
      ...base,
    }
    : {
      name: "검수 필요 가격",
      locators: headers.slice(0, 1).map(({ locator }) => locator),
      ...base,
    };
}

function isPolicyCell(cell: WorkbookCell): boolean {
  return POLICY_PATTERN.test(cell.plainValue);
}

function isSampleSheet(sheet: string): boolean {
  return SAMPLE_SHEET_PATTERN.test(sheet.trim());
}

function modeForSheet(workbook: ParsedWorkbook, sheet: string): "실내" | "야외" | null {
  const text = [
    sheet,
    ...workbook.cells
      .filter((cell) => cell.sheet === sheet && cell.row <= 3)
      .map(({ plainValue }) => plainValue),
  ].join(" ");
  const indoor = /실내/u.test(text);
  const outdoor = /야외/u.test(text);
  return indoor === outdoor ? null : indoor ? "실내" : "야외";
}

export function extractHallXlsxTopology(
  input: HallXlsxTopologyInput,
): HallXlsxTopologyExtraction {
  const parsed = parseWorkbook(input.canonicalText);
  const reviewNotices: HallXlsxReviewNotice[] = [];
  const noticeKeys = new Set<string>();
  const addNotice = (notice: HallXlsxReviewNotice): void => {
    const key = `${notice.code}\0${notice.sheet}\0${notice.source_locator ?? ""}`;
    if (noticeKeys.has(key)) return;
    noticeKeys.add(key);
    reviewNotices.push(notice);
  };

  const excludedSamples = new Set(parsed.sheets.filter(isSampleSheet));
  for (const sheet of excludedSamples) {
    addNotice({
      code: "sample_sheet_excluded",
      sheet,
      source_locator: null,
      message: "실데이터 sibling sheet가 있어 exact 샘플 sheet를 검수 topology에서 제외했습니다.",
    });
  }
  const workbook: ParsedWorkbook = {
    cells: parsed.cells.filter((cell) => !excludedSamples.has(cell.sheet)),
    merges: parsed.merges.filter((merge) => !excludedSamples.has(merge.sheet)),
    sheets: parsed.sheets.filter((sheet) => !excludedSamples.has(sheet)),
  };

  const conditions: HallXlsxCondition[] = [];
  const conditionsByLocator = new Map<string, HallXlsxCondition>();
  const inlineConditionsByKey = new Map<string, HallXlsxCondition>();
  const ensureConditions = (cells: readonly WorkbookCell[]): string[] => cells.flatMap((cell) => {
    const kind = conditionKind(cell.plainValue);
    if (!kind) return [];
    const existing = conditionsByLocator.get(cell.locator);
    if (existing) return [existing.condition_id];
    const condition: HallXlsxCondition = {
      condition_id: `condition:${input.sourceFileId}:${cell.locator}`,
      kind,
      text: cell.plainValue.slice(0, 300),
      source_file_id: input.sourceFileId,
      source_locator: cell.locator,
      source_quote: cell.quote,
    };
    conditionsByLocator.set(cell.locator, condition);
    conditions.push(condition);
    return [condition.condition_id];
  });
  const ensureInlineCondition = (
    cell: WorkbookCell,
    parent: InlineParentCondition,
  ): string => {
    const key = `${cell.locator}\0${parent.start}\0${parent.text}`;
    const existing = inlineConditionsByKey.get(key);
    if (existing) return existing.condition_id;
    const condition: HallXlsxCondition = {
      condition_id: `condition:${input.sourceFileId}:${cell.locator}:fragment:${parent.start}`,
      kind: "other",
      text: parent.text,
      source_file_id: input.sourceFileId,
      source_locator: cell.locator,
      source_quote: cell.quote,
    };
    inlineConditionsByKey.set(key, condition);
    conditions.push(condition);
    return condition.condition_id;
  };

  const hallComponents: HallXlsxHallComponent[] = [];
  const hallByName = new Map<string, HallXlsxHallComponent>();
  const sourceIdsForAnchor = new Map<string, string[]>();
  const createComponents = (
    cell: WorkbookCell,
    blockLocator: string,
    conditionIds: readonly string[],
  ): string[] => {
    const components = splitExactHallComponents(cell.plainValue);
    if (components.length > 1) {
      addNotice({
        code: "shared_hall_group",
        sheet: cell.sheet,
        source_locator: cell.locator,
        message: "한 source anchor의 복수 hall은 가격을 복제하지 않는 shared review group으로 유지합니다.",
      });
    }
    const ids = components.map((hallName) => {
      const normalized = normalizedHallName(hallName);
      const existing = hallByName.get(normalized);
      if (existing) {
        if (!existing.source_locators.includes(cell.locator)) {
          existing.source_locators.push(cell.locator);
          existing.source_quotes.push(cell.quote);
        }
        if (!existing.block_locators.includes(blockLocator)) existing.block_locators.push(blockLocator);
        for (const conditionId of conditionIds) {
          if (!existing.condition_ids.includes(conditionId)) existing.condition_ids.push(conditionId);
        }
        addNotice({
          code: "repeated_hall_coalesced",
          sheet: cell.sheet,
          source_locator: cell.locator,
          message: "동일 hall identity를 합치되 모든 block locator와 condition을 보존했습니다.",
        });
        return existing.hall_id;
      }
      const hall: HallXlsxHallComponent = {
        hall_id: `hall:${input.sourceFileId}:${normalized}`,
        hall_name: hallName.slice(0, 300),
        source_file_id: input.sourceFileId,
        source_locators: [cell.locator],
        source_quotes: [cell.quote],
        block_locators: [blockLocator],
        condition_ids: [...conditionIds],
        needs_review: true,
      };
      hallByName.set(normalized, hall);
      hallComponents.push(hall);
      return hall.hall_id;
    });
    sourceIdsForAnchor.set(cell.locator, ids);
    return ids;
  };

  const blocks: HallBlock[] = [];
  for (const sheet of workbook.sheets) {
    const sheetCells = workbook.cells.filter((cell) => cell.sheet === sheet);
    const headers = sheetCells
      .filter((cell) => HALL_HEADER_PATTERN.test(cell.plainValue))
      .sort((left, right) => left.row - right.row || left.column - right.column);
    for (const [headerIndex, header] of headers.entries()) {
      const nextHeader = headers.slice(headerIndex + 1).find((candidate) => candidate.row > header.row);
      const policyRow = sheetCells
        .filter((cell) => cell.row > header.row && isPolicyCell(cell))
        .map(({ row }) => row)
        .sort((left, right) => left - right)[0];
      const endRow = Math.min(
        nextHeader ? nextHeader.row - 1 : Number.MAX_SAFE_INTEGER,
        policyRow !== undefined ? policyRow - 1 : Number.MAX_SAFE_INTEGER,
      );
      const candidateCells = sheetCells.filter((cell) => (
        cell.column === header.column
        && cell.row > header.row
        && cell.row <= endRow
        && !HALL_HEADER_PATTERN.test(cell.plainValue)
        && !isPolicyCell(cell)
        && (conditionKind(cell.plainValue) === null || exactHallIdentity(cell.plainValue))
      ));
      const anchors = candidateCells.filter((cell) => {
        if (exactHallIdentity(cell.plainValue)) return true;
        const merge = mergeForAnchor(workbook, cell);
        const rowEnd = merge?.endRow ?? cell.row;
        return Boolean(
          delimitedHallComponents(cell.plainValue)
          && sheetCells.some((peer) => (
            peer.row >= cell.row
            && peer.row <= rowEnd
            && peer.column > cell.column
            && (/\d[\d,.]*\s*(?:원|만)/u.test(peer.plainValue) || STRICT_CANONICAL_COMMA_PATTERN.test(peer.plainValue))
          ))
        );
      });
      const blockLocator = header.locator;
      const block: HallBlock = { header, startRow: header.row, endRow, anchors: [] };
      for (const [anchorIndex, cell] of anchors.entries()) {
        const merge = mergeForAnchor(workbook, cell);
        const nextAnchor = anchors[anchorIndex + 1];
        const anchorEnd = Math.min(
          endRow,
          merge?.endRow ?? (nextAnchor ? nextAnchor.row - 1 : cell.row),
        );
        const conditionIds = ensureConditions(conditionCellsFor(workbook, cell, header.row));
        const hallIds = createComponents(cell, blockLocator, conditionIds);
        block.anchors.push({ cell, endRow: anchorEnd, hallIds, blockLocator });
      }
      blocks.push(block);
    }
  }

  const policyEvidence: HallXlsxEvidenceSpan[] = workbook.cells
    .filter(isPolicyCell)
    .map((cell) => ({
      source_file_id: input.sourceFileId,
      source_locator: cell.locator,
      source_quote: cell.quote,
      text: cell.plainValue,
    }));
  const pricingBasisEvidence: HallXlsxEvidenceSpan[] = workbook.cells
    .filter((cell) => PRICING_BASIS_PATTERN.test(cell.plainValue) && !isPolicyCell(cell))
    .map((cell) => ({
      source_file_id: input.sourceFileId,
      source_locator: cell.locator,
      source_quote: cell.quote,
      text: cell.plainValue,
    }));

  const occurrences: HallXlsxMoneyOccurrence[] = [];
  const occurrenceRangeKeys = new Map<string, string[]>();
  const optionInputs: Array<{
    occurrence: HallXlsxMoneyOccurrence;
    money: ScannedMoney;
    label: ExactPriceLabel;
  }> = [];

  for (const cell of workbook.cells) {
    const block = blocks.find((candidate) => (
      candidate.header.sheet === cell.sheet
      && cell.row >= candidate.startRow
      && cell.row <= candidate.endRow
    )) ?? null;
    const lowerRow = block?.startRow ?? 0;
    const headers = priceHeaderCells(workbook, cell, lowerRow);
    const scanned = scanMoneyInCell(workbook, cell, headers, lowerRow, addNotice);
    if (scanned.length === 0) continue;
    const policy = isPolicyCell(cell);
    const anchor = block?.anchors.find((candidate) => (
      cell.row >= candidate.cell.row
      && cell.row <= candidate.endRow
      && cell.column > candidate.cell.column
    )) ?? null;
    const mode = modeForSheet(workbook, cell.sheet);
    const modeHalls = mode
      ? hallComponents.filter((hall) => hall.hall_name.includes(mode)).map(({ hall_id }) => hall_id)
      : [];
    const exactModeHall = mode !== null && modeHalls.length === 1;
    const ambiguousModeAnnex = mode !== null && !exactModeHall;
    const sheetHasHallHeader = blocks.some(({ header }) => header.sheet === cell.sheet);
    const relationKind: HallXlsxPriceRelationKind = policy
      ? "policy"
      : anchor
        ? anchor.hallIds.length > 1 ? "shared_hall_group" : "exact_hall"
        : exactModeHall
          ? "annex"
          : ambiguousModeAnnex
            ? "unbound_review"
          : !sheetHasHallHeader && hallComponents.length > 0
            ? "companion_sheet"
            : "unbound_review";
    const hallIds = policy
      ? []
      : anchor?.hallIds ?? (relationKind === "annex" ? modeHalls : []);
    if (ambiguousModeAnnex && !policy && !anchor) {
      addNotice({
        code: "ambiguous_mode_annex",
        sheet: cell.sheet,
        source_locator: cell.locator,
        message: "모드 annex는 정확히 하나의 mode hall이 있을 때만 귀속하며, 0개 또는 복수인 경우 fan-out 없이 unbound review로 유지합니다.",
      });
    }
    if (relationKind === "companion_sheet") {
      addNotice({
        code: "companion_sheet_review",
        sheet: cell.sheet,
        source_locator: cell.locator,
        message: "Companion sheet 가격은 특정 hall aggregate로 복제하지 않고 review-only로 유지합니다.",
      });
    }
    if (relationKind === "unbound_review") {
      addNotice({
        code: "unbound_price_relation",
        sheet: cell.sheet,
        source_locator: cell.locator,
        message: "가격 근거는 보존했지만 exact hall owner가 없어 aggregate하지 않습니다.",
      });
    }
    const conditionIds = ensureConditions(conditionCellsFor(workbook, cell, lowerRow));
    for (const conditionId of anchor?.cell ? ensureConditions(conditionCellsFor(workbook, anchor.cell, lowerRow)) : []) {
      if (!conditionIds.includes(conditionId)) conditionIds.push(conditionId);
    }
    for (const [ordinal, money] of scanned.entries()) {
      const label = policy ? null : exactLabelForPrice(workbook, cell, money, lowerRow);
      const occurrenceConditionIds = [...conditionIds];
      if (label?.parentCondition) {
        const parentConditionId = ensureInlineCondition(cell, label.parentCondition);
        if (!occurrenceConditionIds.includes(parentConditionId)) {
          occurrenceConditionIds.push(parentConditionId);
        }
      }
      const occurrence: HallXlsxMoneyOccurrence = {
        occurrence_id: `money:${input.sourceFileId}:${cell.locator}:${ordinal}`,
        amount_krw: money.amountKrw,
        raw_text: money.raw,
        source_file_id: input.sourceFileId,
        source_locator: cell.locator,
        source_quote: cell.quote,
        unit_source_locator: money.unitSourceLocator,
        price_header_locators: headers.map(({ locator }) => locator),
        condition_ids: occurrenceConditionIds,
        hall_ids: [...hallIds],
        block_locator: block?.header.locator ?? null,
        relation_kind: relationKind,
        bounded_bare: money.boundedBare,
        needs_review: true,
      };
      occurrences.push(occurrence);
      if (money.rangeKey) {
        const ids = occurrenceRangeKeys.get(money.rangeKey) ?? [];
        ids.push(occurrence.occurrence_id);
        occurrenceRangeKeys.set(money.rangeKey, ids);
      }
      if (label) {
        optionInputs.push({
          occurrence,
          money,
          label,
        });
      }
    }
  }

  const priceOptions: HallXlsxPriceOption[] = [];
  const consumedOccurrences = new Set<string>();
  const optionInputByOccurrenceId = new Map(optionInputs.map((entry) => [
    entry.occurrence.occurrence_id,
    entry,
  ]));
  for (const entry of optionInputs) {
    if (consumedOccurrences.has(entry.occurrence.occurrence_id)) continue;
    const rangeIds = entry.money.rangeKey
      ? occurrenceRangeKeys.get(entry.money.rangeKey) ?? [entry.occurrence.occurrence_id]
      : [entry.occurrence.occurrence_id];
    const rangeOccurrences = rangeIds
      .map((id) => occurrences.find((occurrence) => occurrence.occurrence_id === id))
      .filter((occurrence): occurrence is HallXlsxMoneyOccurrence => Boolean(occurrence));
    for (const occurrence of rangeOccurrences) consumedOccurrences.add(occurrence.occurrence_id);
    const values = rangeOccurrences.map(({ amount_krw }) => amount_krw);
    const openDirections = rangeIds.flatMap((occurrenceId) => {
      const direction = optionInputByOccurrenceId.get(occurrenceId)?.money.openDirection;
      return direction ? [direction] : [];
    });
    const upperOpen = openDirections.includes("upper");
    const lowerOpen = openDirections.includes("lower");
    priceOptions.push({
      option_id: `option:${entry.occurrence.occurrence_id}`,
      name: entry.label.name,
      raw_text: entry.label.rawText,
      price_min_krw: upperOpen ? null : Math.min(...values),
      price_max_krw: lowerOpen ? null : Math.max(...values),
      occurrence_ids: rangeOccurrences.map(({ occurrence_id }) => occurrence_id),
      source_file_id: input.sourceFileId,
      source_locator: entry.occurrence.source_locator,
      source_quote: entry.occurrence.source_quote,
      label_locators: entry.label.locators,
      condition_ids: [...entry.occurrence.condition_ids],
      hall_ids: [...entry.occurrence.hall_ids],
      relation_kind: entry.occurrence.relation_kind as Exclude<HallXlsxPriceRelationKind, "policy">,
      needs_review: true,
    });
  }

  hallComponents.sort((left, right) => (
    left.source_locators[0]!.localeCompare(right.source_locators[0]!, "ko")
  ));
  conditions.sort((left, right) => left.source_locator.localeCompare(right.source_locator, "ko"));
  reviewNotices.sort((left, right) => (
    left.sheet.localeCompare(right.sheet, "ko")
    || (left.source_locator ?? "").localeCompare(right.source_locator ?? "", "ko")
    || left.code.localeCompare(right.code)
  ));

  return {
    hall_components: hallComponents,
    price_options: priceOptions,
    money_occurrences: occurrences,
    conditions,
    policy_evidence: policyEvidence,
    pricing_basis_evidence: pricingBasisEvidence,
    review_notices: reviewNotices,
  };
}
