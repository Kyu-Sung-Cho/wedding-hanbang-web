const PDF_LAYOUT_BEGIN = "[PDF_LAYOUT_EVIDENCE_V1_BEGIN]";
const PDF_LAYOUT_END = "[PDF_LAYOUT_EVIDENCE_V1_END]";
const PDF_LAYOUT_ROW_PATTERN = /^\[PDF_LAYOUT_EVIDENCE_V1 page=([1-9][0-9]*) row=([1-9][0-9]*) y=(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)\] ([A-Za-z0-9_-]+)$/u;
const ROW_KEYS = ["anchor_y", "items", "page", "row", "version"] as const;
const ITEM_KEYS = ["column", "height", "text", "width", "x", "y"] as const;
const ROW_TOLERANCE_POINTS = 0.75;

export interface CanonicalPdfLayoutItem {
  item: number;
  text: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
}

export interface CanonicalPdfLayoutRow {
  page: number;
  row: number;
  anchorY: number;
  items: CanonicalPdfLayoutItem[];
  lineNumber: number | null;
  lineText: string | null;
}

export interface CanonicalPdfLayoutEvidence {
  status: "none" | "valid" | "invalid";
  rows: CanonicalPdfLayoutRow[];
}

export interface PdfLayoutMoneyProjection {
  raw: string;
  krw: number;
  line_context: string;
  source_locator: string;
  page: number;
  row: number;
  item: number;
  moneyOrdinal: number;
  lineNumber: number;
  header: string;
  condition: string | null;
  certifier: "grid" | "policy" | "narrow";
  alsoNarrow?: boolean;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, "en"));
  const ordered = [...expected].sort((left, right) => left.localeCompare(right, "en"));
  return actual.length === ordered.length && actual.every((key, index) => key === ordered[index]);
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && !Object.is(value, -0)
    && Math.abs(value) <= 20_000;
}

function nullableCoordinate(value: unknown): value is number | null {
  return value === null || finiteCoordinate(value);
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= maximum;
}

function coordinate(value: number): string {
  return value.toFixed(3).replace(/(?:\.0+|(\.[0-9]*?)0+)$/u, "$1");
}

export function normalizePdfLayoutItemText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\n\f\v]+/gu, " ")
    .replace(/ {2,}/gu, " ")
    .trim();
}

function decodeRow(rawLine: string): Omit<CanonicalPdfLayoutRow, "lineNumber" | "lineText"> | null {
  const wrapper = PDF_LAYOUT_ROW_PATTERN.exec(rawLine);
  if (!wrapper) return null;
  let parsed: unknown;
  try {
    const bytes = Buffer.from(wrapper[4]!, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== wrapper[4]) return null;
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  if (!exactKeys(parsed as Record<string, unknown>, ROW_KEYS)) return null;
  const value = parsed as Record<string, unknown>;
  if (
    value.version !== 1
    || !positiveInteger(value.page, 1_000)
    || !positiveInteger(value.row, 100_000)
    || !finiteCoordinate(value.anchor_y)
    || !Array.isArray(value.items)
    || value.items.length > 2_000
  ) return null;
  const items: CanonicalPdfLayoutItem[] = [];
  for (const [index, rawItem] of value.items.entries()) {
    if (typeof rawItem !== "object" || rawItem === null || Array.isArray(rawItem)) return null;
    if (!exactKeys(rawItem as Record<string, unknown>, ITEM_KEYS)) return null;
    const item = rawItem as Record<string, unknown>;
    if (
      item.column !== index + 1
      || typeof item.text !== "string"
      || item.text.length > 20_000
      || !finiteCoordinate(item.x)
      || !finiteCoordinate(item.y)
      || !nullableCoordinate(item.width)
      || !nullableCoordinate(item.height)
      || (typeof item.width === "number" && item.width < 0)
      || (typeof item.height === "number" && item.height < 0)
      || Math.abs(item.y - value.anchor_y) > ROW_TOLERANCE_POINTS
    ) return null;
    items.push({
      item: index + 1,
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
    if (current.x < previous.x || (current.x === previous.x && current.y > previous.y)) return null;
  }
  if (
    Number(wrapper[1]) !== value.page
    || Number(wrapper[2]) !== value.row
    || wrapper[3] !== coordinate(value.anchor_y)
  ) return null;
  return {
    page: value.page,
    row: value.row,
    anchorY: value.anchor_y,
    items,
  };
}

export function parseCanonicalPdfLayoutEvidenceText(
  fullText: string,
): CanonicalPdfLayoutEvidence {
  const rawLines = fullText.replace(/\r\n?/gu, "\n").split("\n");
  const markerIndexes = rawLines.flatMap((line, index) => (
    line.startsWith("[PDF_LAYOUT_EVIDENCE_") ? [index] : []
  ));
  if (markerIndexes.length === 0) return { status: "none", rows: [] };
  const begins = rawLines.flatMap((line, index) => line === PDF_LAYOUT_BEGIN ? [index] : []);
  const ends = rawLines.flatMap((line, index) => line === PDF_LAYOUT_END ? [index] : []);
  if (begins.length !== 1 || ends.length !== 1) return { status: "invalid", rows: [] };
  const begin = begins[0]!;
  const end = ends[0]!;
  let lastNonEmpty = -1;
  for (let index = rawLines.length - 1; index >= 0; index -= 1) {
    if (!rawLines[index]!.trim()) continue;
    lastNonEmpty = index;
    break;
  }
  if (begin >= end || end !== lastNonEmpty || rawLines.slice(begin + 1, end).some((line) => !line)) {
    return { status: "invalid", rows: [] };
  }
  const decoded = rawLines.slice(begin + 1, end).map(decodeRow);
  if (decoded.length === 0 || decoded.some((row) => row === null)) {
    return { status: "invalid", rows: [] };
  }
  const rows = decoded as Array<Omit<CanonicalPdfLayoutRow, "lineNumber" | "lineText">>;
  let priorPage = 0;
  let priorRow = 0;
  let priorAnchor = Number.POSITIVE_INFINITY;
  for (const row of rows) {
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
  const pages = new Map<number, Array<{ row: typeof rows[number]; text: string }>>();
  for (const row of rows) {
    const text = row.items.map(({ text: itemText }) => normalizePdfLayoutItemText(itemText))
      .filter(Boolean)
      .join("\t");
    const pageRows = pages.get(row.page) ?? [];
    if (text) pageRows.push({ row, text });
    pages.set(row.page, pageRows);
  }
  const orderedPages = [...pages.entries()].sort(([left], [right]) => left - right);
  const expected = orderedPages.map(([, pageRows]) => pageRows.map(({ text }) => text).join("\n"))
    .join("\n\n");
  if (rawLines.slice(0, begin).join("\n").trimEnd() !== expected) {
    return { status: "invalid", rows: [] };
  }
  let lineNumber = 1;
  const lines = new Map<string, { number: number; text: string }>();
  for (const [pageIndex, [page, pageRows]] of orderedPages.entries()) {
    for (const { row, text } of pageRows) {
      lines.set(`${page}\0${row.row}`, { number: lineNumber, text });
      lineNumber += 1;
    }
    if (pageIndex < orderedPages.length - 1) lineNumber += 1;
  }
  return {
    status: "valid",
    rows: rows.map((row) => {
      const line = lines.get(`${row.page}\0${row.row}`) ?? null;
      return {
        ...row,
        lineNumber: line?.number ?? null,
        lineText: line?.text ?? null,
      };
    }),
  };
}

const EXACT_PRICE_HEADER = /^(?:기본\s*가격|가격|금액|식비|식대|대관료(?:\s*[,·/]?\s*장식비)?|장식비|야외\s*[/·]\s*야간|기타\s*옵션|추가\s*대여|퍼스트웨어|헤어피스)$/u;
const TABLE_STOP = /(?:계약\s*해지|취소|해지|환불|환급|공제|위약|정책|규정|손해\s*배상|산정\s*기준|\b(?:cancellation|policy|termination|refund|deduction|penalty)\b)/iu;
const NON_PRICE_IDENTIFIER_ROW = /(?:계좌(?:\s*(?:번호|정보))?|예금주|입금\s*계좌|은행|연락처|전화(?:\s*번호)?|휴대폰|사업자\s*(?:등록\s*)?번호|법인\s*(?:등록\s*)?번호|대표\s*(?:전화\s*)?번호|문의(?:처)?|생년\s*월일|날짜|일자|(?:^|[^A-Z])(?:ACCOUNT|DEPOSITOR|TEL|FAX|PHONE)(?:[^A-Z]|$))/iu;
const BARE_WON = /(?<![\d,.])([1-9]\d{0,2}(?:,\d{3})+)(?![\d,.])/gu;
const BARE_WON_PRESENT = /(?<![\d,.])[1-9]\d{0,2}(?:,\d{3})+(?![\d,.])/u;
const INLINE_MANWON = /(?<![\d,.])([1-9]\d{0,3}(?:,\d{3})*)\s*만원/gu;
const SPLIT_MANWON_INTEGER = /(?<![\d,.])([1-9]\d{0,3})(?![\d,.])/gu;

interface HeaderBand {
  header: CanonicalPdfLayoutItem;
  minimumX: number;
  maximumX: number;
  requiresAdjacentUnit: boolean;
}

interface PdfGridHeaderAnchor {
  centerX: number;
  header: CanonicalPdfLayoutItem;
  label: string;
  priceColumn: boolean;
}

interface PdfGridColumn {
  centerX: number;
  header: CanonicalPdfLayoutItem;
  label: string;
  priceColumn: boolean;
  minimumX: number;
  maximumX: number;
}

interface CertifiedPdfGrid {
  page: number;
  firstDataRow: number;
  lastDataRow: number;
  columns: PdfGridColumn[];
}

function priceBands(row: CanonicalPdfLayoutRow): HeaderBand[] {
  if (row.items.length < 2) return [];
  if (rowHasMixedPriceHeaderCluster(row)) return [];
  const candidates = row.items.flatMap((item, index) => {
    const header = normalizePdfLayoutItemText(item.text);
    if (!EXACT_PRICE_HEADER.test(header)) return [];
    const prior = row.items[index - 1];
    const next = row.items[index + 1];
    return [{
      header: item,
      minimumX: prior ? (prior.x + item.x) / 2 : item.x - 80,
      maximumX: next ? (item.x + next.x) / 2 : item.x + 180,
      requiresAdjacentUnit: false,
    }];
  });
  const hasCoordinateAmbiguity = candidates.some((candidate, index) => (
    candidates.some((other, otherIndex) => (
      otherIndex > index
      && normalizePdfLayoutItemText(other.header.text).replace(/\s+/gu, "")
        === normalizePdfLayoutItemText(candidate.header.text).replace(/\s+/gu, "")
      && Math.abs(other.header.x - candidate.header.x) <= 1
    ))
  ));
  if (hasCoordinateAmbiguity) return [];
  return candidates;
}

const OPTION_PRICE_HEADING = /^(?:주요\s*)?선택\s*품목\s*가격$/u;
const NON_PRICE_OPTION_COLUMN = /^(?:예식홀명|사업자명|비고|구성|품목)$/u;
const EXACT_WON_UNIT = /^(?:원|만원|천원)$/u;

function optionPriceBands(row: CanonicalPdfLayoutRow): HeaderBand[] {
  if (row.items.length < 2 || row.items.some((item) => /\d/u.test(item.text))) return [];
  if (rowHasMixedPriceHeaderCluster(row)) return [];
  return row.items.flatMap((item, index) => {
    const header = normalizePdfLayoutItemText(item.text);
    if (!header || NON_PRICE_OPTION_COLUMN.test(header)) return [];
    const prior = row.items[index - 1];
    const next = row.items[index + 1];
    return [{
      header: item,
      minimumX: prior ? (prior.x + item.x) / 2 : item.x - 80,
      maximumX: next ? (item.x + next.x) / 2 : item.x + 180,
      requiresAdjacentUnit: true,
    }];
  });
}

function hasAdjacentAlignedWonUnit(
  rows: readonly CanonicalPdfLayoutRow[],
  row: CanonicalPdfLayoutRow,
  item: CanonicalPdfLayoutItem,
  band: HeaderBand,
): boolean {
  return rows.some((candidate) => (
    candidate.page === row.page
    && Math.abs(candidate.row - row.row) === 1
    && Math.abs(candidate.anchorY - row.anchorY) <= 24
    && candidate.items.some((unit) => (
      unit.x >= band.minimumX
      && unit.x < band.maximumX
      && Math.abs(unit.x - item.x) <= 36
      && EXACT_WON_UNIT.test(normalizePdfLayoutItemText(unit.text))
    ))
  ));
}

interface PdfItemMoneyMatch {
  raw: string;
  krw: number;
  start: number;
  length: number;
  requiresAlignedManwonUnit: boolean;
}

function overlapsMoneyMatch(
  left: Pick<PdfItemMoneyMatch, "start" | "length">,
  right: Pick<PdfItemMoneyMatch, "start" | "length">,
): boolean {
  return left.start < right.start + right.length
    && right.start < left.start + left.length;
}

function directPdfItemMoneyMatches(normalized: string): PdfItemMoneyMatch[] {
  const manwon = [...normalized.matchAll(INLINE_MANWON)].flatMap((match) => {
    const raw = match[1]!;
    const integer = Number.parseInt(raw.replace(/,/gu, ""), 10);
    const krw = integer * 10_000;
    return Number.isSafeInteger(krw) && krw >= 1_000 ? [{
      raw,
      krw,
      start: match.index ?? 0,
      length: match[0].length,
      requiresAlignedManwonUnit: false,
    }] : [];
  });
  const won = [...normalized.matchAll(BARE_WON)].flatMap((match) => {
    const candidate = {
      start: match.index ?? 0,
      length: match[0].length,
    };
    if (manwon.some((entry) => overlapsMoneyMatch(candidate, entry))) return [];
    const raw = match[1]!;
    const krw = Number.parseInt(raw.replace(/,/gu, ""), 10);
    return Number.isSafeInteger(krw) && krw >= 1_000 ? [{
      raw,
      krw,
      ...candidate,
      requiresAlignedManwonUnit: false,
    }] : [];
  });
  return [...won, ...manwon].sort((left, right) => (
    left.start - right.start || left.length - right.length
  ));
}

function bareWonOccurrences(value: string): Array<{ raw: string; krw: number }> {
  const normalized = normalizePdfLayoutItemText(value).normalize("NFKC");
  if (/(?:%|명|인|년|월|일|시|분|회|번|권|페이지|P\b|x\s*\d)/iu.test(normalized)) return [];
  return directPdfItemMoneyMatches(normalized).map(({ raw, krw }) => ({ raw, krw }));
}

const GRID_HEADER_LABELS = [
  { compact: "대관료장식비", label: "대관료·장식비", priceColumn: true },
  { compact: "사업자명", label: "사업자명", priceColumn: false },
  { compact: "예식홀명", label: "예식홀명", priceColumn: false },
  { compact: "드레스도우미", label: "드레스 도우미", priceColumn: true },
  { compact: "디자인추가금", label: "디자인 추가금", priceColumn: true },
  { compact: "드레스추가대여", label: "드레스 추가 대여", priceColumn: true },
  { compact: "담당자지정", label: "담당자 지정", priceColumn: true },
  { compact: "퍼스트웨어", label: "퍼스트웨어", priceColumn: true },
  { compact: "기타옵션", label: "기타 옵션", priceColumn: true },
  { compact: "야외야간", label: "야외/야간", priceColumn: true },
  { compact: "기본가격", label: "기본가격", priceColumn: true },
  { compact: "추가대여", label: "추가 대여", priceColumn: true },
  { compact: "헤어피스", label: "헤어피스", priceColumn: true },
  { compact: "식음료", label: "식음료", priceColumn: true },
  { compact: "대관료", label: "대관료", priceColumn: true },
  { compact: "장식비", label: "장식비", priceColumn: true },
  { compact: "추가금", label: "추가금", priceColumn: true },
  { compact: "구분", label: "구분", priceColumn: false },
  { compact: "품목", label: "품목", priceColumn: false },
  { compact: "구성", label: "구성", priceColumn: false },
  { compact: "비고", label: "비고", priceColumn: false },
  { compact: "금액", label: "금액", priceColumn: true },
  { compact: "식비", label: "식비", priceColumn: true },
  { compact: "식대", label: "식대", priceColumn: true },
  { compact: "폐백", label: "폐백", priceColumn: true },
  { compact: "장식", label: "장식", priceColumn: true },
  { compact: "연출", label: "연출", priceColumn: true },
  { compact: "행사", label: "행사", priceColumn: true },
  { compact: "영상", label: "영상", priceColumn: true },
  { compact: "사진", label: "사진", priceColumn: true },
] as const;

function compactGridText(value: string): string {
  return normalizePdfLayoutItemText(value).normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
}

function itemRight(item: CanonicalPdfLayoutItem): number {
  const fallback = Math.max(8, normalizePdfLayoutItemText(item.text).length * 5);
  return item.x + (item.width ?? fallback);
}

function headerAnchorsInRow(row: CanonicalPdfLayoutRow): PdfGridHeaderAnchor[] {
  const anchors: PdfGridHeaderAnchor[] = [];
  for (const item of row.items) {
    const normalized = normalizePdfLayoutItemText(item.text).normalize("NFKC");
    if (NON_PRICE_IDENTIFIER_ROW.test(normalized)) {
      anchors.push({
        centerX: (item.x + itemRight(item)) / 2,
        header: item,
        label: normalized,
        priceColumn: false,
      });
    }
    const compact = compactGridText(item.text);
    const occupied: Array<{ start: number; end: number }> = [];
    for (const header of GRID_HEADER_LABELS) {
      const start = compact.indexOf(header.compact);
      if (start < 0) continue;
      const end = start + header.compact.length;
      if (occupied.some((span) => start < span.end && end > span.start)) continue;
      const width = itemRight(item) - item.x;
      anchors.push({
        centerX: item.x + width * ((start + end) / 2) / Math.max(1, compact.length),
        header: item,
        label: header.label,
        priceColumn: header.priceColumn,
      });
      occupied.push({ start, end });
    }
  }
  for (let start = 0; start < row.items.length; start += 1) {
    for (let length = 2; length <= 4 && start + length <= row.items.length; length += 1) {
      const items = row.items.slice(start, start + length);
      const compact = items.map(({ text }) => compactGridText(text)).join("");
      const header = GRID_HEADER_LABELS.find((candidate) => candidate.compact === compact);
      if (!header) continue;
      const first = items[0]!;
      const last = items.at(-1)!;
      const centerX = (first.x + itemRight(last)) / 2;
      if (anchors.some((anchor) => (
        anchor.label === header.label && Math.abs(anchor.centerX - centerX) <= 2
      ))) continue;
      anchors.push({
        centerX,
        header: first,
        label: header.label,
        priceColumn: header.priceColumn,
      });
    }
  }
  return anchors;
}

function rowHasMixedPriceHeaderCluster(row: CanonicalPdfLayoutRow): boolean {
  const anchors = headerAnchorsInRow(row);
  return anchors.some((anchor, index) => anchors.some((other, otherIndex) => (
    otherIndex > index
    && Math.abs(other.centerX - anchor.centerX) <= 22
    && other.priceColumn !== anchor.priceColumn
  )));
}

function rowHasPotentialGridMoney(row: CanonicalPdfLayoutRow): boolean {
  const rowText = row.lineText ?? "";
  return BARE_WON_PRESENT.test(rowText.normalize("NFKC"))
    || (/만원/u.test(rowText) && /\d/u.test(rowText));
}

function isGridHeading(row: CanonicalPdfLayoutRow): boolean {
  const value = normalizePdfLayoutItemText(row.lineText ?? "").normalize("NFKC");
  const compact = compactGridText(value);
  if (!value || rowHasPotentialGridMoney(row) || TABLE_STOP.test(value)) return false;
  if (/(?:주요)?선택품목가격/u.test(compact)) return true;
  if (/선택사항/u.test(compact)) return true;
  if (
    /^(?:\d+)(?:스튜디오|드레스|메이크업)(?:선택품목)?$/u.test(compact)
    || /^(?:\d+)?(?:스튜디오|드레스|메이크업)선택품목$/u.test(compact)
  ) {
    return true;
  }
  return /^(?:[①-⑳]\s*)?(?:\d+\.?\s*)?가격(?:\s*\([^)]*VAT[^)]*\)|\s*\[?VAT[^\]]*\]?)?$/iu.test(
    value.replace(/\s+/gu, " ").trim(),
  );
}

function certifiedGridColumns(headerRows: readonly CanonicalPdfLayoutRow[]): PdfGridColumn[] {
  const anchors = headerRows.flatMap(headerAnchorsInRow)
    .sort((left, right) => left.centerX - right.centerX);
  const clusters: Array<{
    anchors: PdfGridHeaderAnchor[];
    centerX: number;
  }> = [];
  for (const anchor of anchors) {
    const cluster = clusters.find((candidate) => Math.abs(candidate.centerX - anchor.centerX) <= 22);
    if (cluster) {
      cluster.anchors.push(anchor);
      cluster.centerX = cluster.anchors.reduce((sum, candidate) => sum + candidate.centerX, 0)
        / cluster.anchors.length;
    } else {
      clusters.push({ anchors: [anchor], centerX: anchor.centerX });
    }
  }
  clusters.sort((left, right) => left.centerX - right.centerX);
  if (clusters.some(({ anchors: values }) => (
    values.some(({ priceColumn }) => priceColumn)
    && values.some(({ priceColumn }) => !priceColumn)
  ))) return [];
  if (clusters.length < 2 || !clusters.some(({ anchors: values }) => (
    values.some(({ priceColumn }) => priceColumn)
  ))) return [];
  return clusters.map((cluster, index) => {
    const prior = clusters[index - 1];
    const next = clusters[index + 1];
    const priorGap = prior ? cluster.centerX - prior.centerX : null;
    const nextGap = next ? next.centerX - cluster.centerX : null;
    return {
      centerX: cluster.centerX,
      header: cluster.anchors.find(({ priceColumn }) => priceColumn)?.header
        ?? cluster.anchors[0]!.header,
      label: [...new Set(cluster.anchors.map(({ label }) => label))].join("/"),
      priceColumn: cluster.anchors.some(({ priceColumn }) => priceColumn),
      minimumX: prior
        ? (prior.centerX + cluster.centerX) / 2
        : cluster.centerX - Math.max((nextGap ?? 120) / 2, 60),
      maximumX: next
        ? (cluster.centerX + next.centerX) / 2
        : cluster.centerX + Math.max((priorGap ?? 120) / 2, 100),
    };
  });
}

function certifiedPdfGrids(rows: readonly CanonicalPdfLayoutRow[]): CertifiedPdfGrid[] {
  const grids: CertifiedPdfGrid[] = [];
  for (const page of new Set(rows.map(({ page }) => page))) {
    const pageRows = rows.filter((row) => row.page === page && row.lineNumber !== null);
    for (const [headingIndex, heading] of pageRows.entries()) {
      if (!isGridHeading(heading)) continue;
      let firstDataIndex = -1;
      for (let index = headingIndex + 1; index < Math.min(pageRows.length, headingIndex + 10); index += 1) {
        const candidate = pageRows[index]!;
        if (isGridHeading(candidate) || TABLE_STOP.test(candidate.lineText ?? "")) break;
        if (rowHasPotentialGridMoney(candidate)) {
          firstDataIndex = index;
          break;
        }
      }
      if (firstDataIndex < 0) continue;
      const columns = certifiedGridColumns(pageRows.slice(headingIndex + 1, firstDataIndex));
      if (columns.length === 0) continue;
      let lastDataIndex = pageRows.length - 1;
      for (let index = firstDataIndex + 1; index < pageRows.length; index += 1) {
        const candidate = pageRows[index]!;
        const prior = pageRows[index - 1]!;
        if (
          isGridHeading(candidate)
          || TABLE_STOP.test(candidate.lineText ?? "")
          || prior.anchorY - candidate.anchorY > 36
        ) {
          lastDataIndex = index - 1;
          break;
        }
      }
      grids.push({
        page,
        firstDataRow: pageRows[firstDataIndex]!.row,
        lastDataRow: pageRows[lastDataIndex]!.row,
        columns,
      });
    }
  }
  return grids;
}

function tokenCenterX(
  item: CanonicalPdfLayoutItem,
  text: string,
  start: number,
  length: number,
): number {
  const width = itemRight(item) - item.x;
  return item.x + width * (start + length / 2) / Math.max(1, text.length);
}

function projectCertifiedPdfGridMoney(
  evidence: CanonicalPdfLayoutEvidence,
): PdfLayoutMoneyProjection[] {
  const grids = certifiedPdfGrids(evidence.rows);
  const result: PdfLayoutMoneyProjection[] = [];
  for (const grid of grids) {
    const rows = evidence.rows.filter((row) => (
      row.page === grid.page
      && row.row >= grid.firstDataRow
      && row.row <= grid.lastDataRow
      && row.lineNumber !== null
    ));
    for (const row of rows) {
      const rowText = row.lineText!;
      if (
        NON_PRICE_IDENTIFIER_ROW.test(rowText.normalize("NFKC"))
        || /(?:%|퍼센트|할인)/iu.test(rowText)
      ) continue;
      const exactManwonUnits = row.items.filter((item) => (
        compactGridText(item.text) === "만원"
      ));
      for (const item of row.items) {
        const normalized = normalizePdfLayoutItemText(item.text).normalize("NFKC");
        const directMatches = directPdfItemMoneyMatches(normalized);
        const splitManwonMatches = exactManwonUnits.length === 0
          || /(?:%|명|인|회|번|권|페이지|컷|벌|장|개|대|년|월|일|시|분)/u.test(normalized)
          ? []
          : [...normalized.matchAll(SPLIT_MANWON_INTEGER)].flatMap((match) => {
              const candidate = {
                start: match.index ?? 0,
                length: match[0].length,
              };
              if (directMatches.some((entry) => overlapsMoneyMatch(candidate, entry))) return [];
              const raw = match[1]!;
              const krw = Number.parseInt(raw, 10) * 10_000;
              return Number.isSafeInteger(krw) && krw >= 1_000 ? [{
                raw,
                krw,
                ...candidate,
                requiresAlignedManwonUnit: true,
              }] : [];
            });
        const matches = [...directMatches, ...splitManwonMatches].sort((left, right) => (
          left.start - right.start || left.length - right.length
        ));
        for (const [ordinalIndex, match] of matches.entries()) {
          const after = normalized.slice(match.start + match.length);
          if (/^\s*(?:%|명|인|회|번|권|페이지|컷|벌|장|개|대|년|월|일|시|분)/u.test(after)) {
            continue;
          }
          const centerX = tokenCenterX(item, normalized, match.start, match.length);
          const columns = grid.columns.filter((column) => (
            centerX >= column.minimumX && centerX < column.maximumX
          ));
          if (columns.length !== 1 || !columns[0]!.priceColumn) continue;
          if (match.requiresAlignedManwonUnit) {
            const alignedUnits = exactManwonUnits.filter((unit) => {
            const unitCenter = (unit.x + itemRight(unit)) / 2;
            return unitCenter >= columns[0]!.minimumX
              && unitCenter < columns[0]!.maximumX
              && Math.abs(unitCenter - centerX) <= 80;
            });
            if (alignedUnits.length !== 1) continue;
          }
          result.push({
            raw: match.raw,
            krw: match.krw,
            line_context: rowText,
            source_locator: `pdf:page:${row.page}:row:${row.row}:item:${item.item}:money:${ordinalIndex + 1}`,
            page: row.page,
            row: row.row,
            item: item.item,
            moneyOrdinal: ordinalIndex + 1,
            lineNumber: row.lineNumber!,
            header: columns[0]!.label,
            condition: rowText,
            certifier: "grid",
          });
        }
      }
    }
  }
  return result;
}

function projectExactPolicySplitManwon(
  evidence: CanonicalPdfLayoutEvidence,
): PdfLayoutMoneyProjection[] {
  const result: PdfLayoutMoneyProjection[] = [];
  for (const row of evidence.rows) {
    if (row.lineNumber === null) continue;
    const descriptor = row.items.find((item) => {
      const compact = compactGridText(item.text);
      return /^촬영날기준으로주일전취소시위약금만원발생연기시(?:만원)?$/u.test(compact);
    });
    if (!descriptor) continue;
    const compactDescriptor = compactGridText(descriptor.text);
    const amountSlots = [...compactDescriptor.matchAll(/만원/gu)].length;
    if (amountSlots < 1 || amountSlots > 2) continue;
    const integers = row.items.flatMap((item) => {
      const match = /^\s*\(?\s*([1-9]\d{0,3})\s*\)?\s*$/u.exec(
        normalizePdfLayoutItemText(item.text).normalize("NFKC"),
      );
      return match ? [{ item, raw: match[1]! }] : [];
    });
    if (integers.length !== amountSlots + 1) continue;
    for (const entry of integers.slice(1)) {
      const krw = Number.parseInt(entry.raw, 10) * 10_000;
      if (!Number.isSafeInteger(krw) || krw < 1_000) continue;
      result.push({
        raw: entry.raw,
        krw,
        line_context: row.lineText!,
        source_locator: `pdf:page:${row.page}:row:${row.row}:item:${entry.item.item}:money:1`,
        page: row.page,
        row: row.row,
        item: entry.item.item,
        moneyOrdinal: 1,
        lineNumber: row.lineNumber,
        header: "위약금/연기",
        condition: normalizePdfLayoutItemText(descriptor.text),
        certifier: "policy",
      });
    }
  }
  return result;
}

export function projectCanonicalPdfLayoutMoney(fullText: string): PdfLayoutMoneyProjection[] {
  const evidence = parseCanonicalPdfLayoutEvidenceText(fullText);
  if (evidence.status !== "valid") return [];
  const result: PdfLayoutMoneyProjection[] = [];
  for (const page of new Set(evidence.rows.map((row) => row.page))) {
    const rows = evidence.rows.filter((row) => row.page === page && row.lineNumber !== null);
    let activeBands: HeaderBand[] = [];
    let awaitingOptionColumns = false;
    for (const row of rows) {
      const rowText = row.items.map(({ text }) => normalizePdfLayoutItemText(text)).join(" ");
      if (TABLE_STOP.test(rowText)) {
        activeBands = [];
        awaitingOptionColumns = false;
        continue;
      }
      if (OPTION_PRICE_HEADING.test(rowText)) {
        activeBands = [];
        awaitingOptionColumns = true;
        continue;
      }
      const bands = priceBands(row);
      if (bands.length > 0) {
        activeBands = bands;
        awaitingOptionColumns = false;
        continue;
      }
      if (awaitingOptionColumns) {
        const optionBands = optionPriceBands(row);
        if (optionBands.length > 0) {
          activeBands = optionBands;
          awaitingOptionColumns = false;
          continue;
        }
      }
      if (activeBands.length === 0) continue;
      if (NON_PRICE_IDENTIFIER_ROW.test(rowText.normalize("NFKC"))) continue;
      for (const item of row.items) {
        const band = activeBands.find(({ minimumX, maximumX }) => (
          item.x >= minimumX && item.x < maximumX
        ));
        if (!band) continue;
        if (band.requiresAdjacentUnit && !hasAdjacentAlignedWonUnit(rows, row, item, band)) continue;
        const occurrences = bareWonOccurrences(item.text);
        for (const [ordinalIndex, occurrence] of occurrences.entries()) {
          const sourceLocator = [
            `pdf:page:${row.page}`,
            `row:${row.row}`,
            `item:${item.item}`,
            `money:${ordinalIndex + 1}`,
          ].join(":");
          result.push({
            ...occurrence,
            line_context: row.lineText!,
            source_locator: sourceLocator,
            page: row.page,
            row: row.row,
            item: item.item,
            moneyOrdinal: ordinalIndex + 1,
            lineNumber: row.lineNumber!,
            header: normalizePdfLayoutItemText(band.header.text),
            condition: null,
            certifier: "narrow",
          });
        }
      }
    }
  }
  const gridCandidates = projectCertifiedPdfGridMoney(evidence);
  const policyCandidates = projectExactPolicySplitManwon(evidence);
  const occurrenceKey = (candidate: PdfLayoutMoneyProjection): string => [
    candidate.page,
    candidate.row,
    candidate.item,
    candidate.moneyOrdinal,
    candidate.raw,
    candidate.krw,
  ].join("\0");
  const narrowKeys = new Set(result.map(occurrenceKey));
  const combined: PdfLayoutMoneyProjection[] = [];
  const occurrenceKeys = new Set<string>();
  for (const candidate of [
    ...gridCandidates,
    ...policyCandidates,
    ...result,
  ]) {
    const key = occurrenceKey(candidate);
    if (occurrenceKeys.has(key)) continue;
    occurrenceKeys.add(key);
    combined.push({ ...candidate, alsoNarrow: narrowKeys.has(key) });
  }
  return combined;
}
