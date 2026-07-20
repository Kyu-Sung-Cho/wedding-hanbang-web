export type XlsxAuxiliaryEvidenceIndex = Record<string, string[]>;

export type XlsxAuxiliaryEvidenceQuoteMatch = {
  kind: "not_xlsx_auxiliary";
} | {
  kind: "match";
  locator: string;
} | {
  kind: "reject";
  locator: string;
  violation: "not_in_request" | "not_exact_single_source";
};

export interface ParsedXlsxAuxiliaryEvidence {
  locator: string;
  payload: string;
}

function normalizeAuxiliaryEvidenceText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/\\\|/gu, "|")
    .replace(/\s+/gu, " ")
    .trim();
}

export function encodeXlsxSheetName(sheetName: string): string {
  return encodeURIComponent(sheetName.normalize("NFKC"))
    .replace(/[!'()*]/gu, (character) =>
      `%${character.codePointAt(0)?.toString(16).toUpperCase().padStart(2, "0")}`
    );
}

function isCanonicalEncodedSheetName(value: string): boolean {
  if (!value || /[;\]]/u.test(value)) return false;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 && encodeXlsxSheetName(decoded) === value;
  } catch {
    return false;
  }
}

function parseXlsxAuxiliaryEvidence(
  value: string,
  rejectComposite: boolean,
): ParsedXlsxAuxiliaryEvidence | null {
  const normalized = normalizeAuxiliaryEvidenceText(value);
  const drawing = /^(XLSX_DRAWING (xl\/drawings\/[A-Za-z0-9._~%-]+\.xml#text-box-[1-9][0-9]*)):\s*(.+)$/u.exec(
    normalized,
  );
  if (drawing) {
    const payload = drawing[3].trim();
    if (!payload || (rejectComposite && /(?:XLSX_DRAWING|XLSX_FORMULA)\s/u.test(payload))) {
      return null;
    }
    return { locator: drawing[1], payload };
  }

  const formula = /^(XLSX_FORMULA \[sheet=([^;\]]+);cell=([A-Z]+[1-9][0-9]*);part=(xl\/worksheets\/[A-Za-z0-9._~%-]+\.xml#cell-([A-Z]+[1-9][0-9]*))\]):\s*(.+)$/u.exec(
    normalized,
  );
  if (!formula) return null;
  const [, locator, encodedSheetName, cellAddress, , partCellAddress, rawPayload] = formula;
  const payload = rawPayload.trim();
  if (
    !isCanonicalEncodedSheetName(encodedSheetName)
    || cellAddress !== partCellAddress
    || !payload
    || (rejectComposite && /(?:XLSX_DRAWING|XLSX_FORMULA)\s/u.test(payload))
  ) {
    return null;
  }
  return { locator, payload };
}

export function looksLikeXlsxAuxiliaryEvidence(value: string): boolean {
  return /(?:^|[;|\s])(?:XLSX_DRAWING|XLSX_FORMULA)\s/u.test(
    normalizeAuxiliaryEvidenceText(value),
  );
}

export function parseXlsxAuxiliaryEvidenceLine(
  value: string,
): ParsedXlsxAuxiliaryEvidence | null {
  return parseXlsxAuxiliaryEvidence(value, false);
}

export function indexXlsxAuxiliaryEvidence(text: string): XlsxAuxiliaryEvidenceIndex {
  const index: XlsxAuxiliaryEvidenceIndex = {};
  for (const line of text.split(/\r?\n/u)) {
    const parsed = parseXlsxAuxiliaryEvidence(line.trim(), false);
    if (!parsed) continue;
    const values = index[parsed.locator] ?? [];
    if (!values.includes(parsed.payload)) values.push(parsed.payload);
    index[parsed.locator] = values;
  }
  return index;
}

export function matchSingleXlsxAuxiliaryEvidenceQuote(
  quote: string,
  evidence: XlsxAuxiliaryEvidenceIndex,
): XlsxAuxiliaryEvidenceQuoteMatch {
  const parsed = parseXlsxAuxiliaryEvidence(quote, true);
  if (!parsed) {
    return looksLikeXlsxAuxiliaryEvidence(quote)
      ? {
          kind: "reject",
          locator: "invalid_xlsx_auxiliary_locator",
          violation: "not_exact_single_source",
        }
      : { kind: "not_xlsx_auxiliary" };
  }
  const candidates = evidence[parsed.locator];
  if (!candidates) {
    return { kind: "reject", locator: parsed.locator, violation: "not_in_request" };
  }
  if (!candidates.some((candidate) =>
    normalizeAuxiliaryEvidenceText(candidate) === normalizeAuxiliaryEvidenceText(parsed.payload)
  )) {
    return {
      kind: "reject",
      locator: parsed.locator,
      violation: "not_exact_single_source",
    };
  }
  return { kind: "match", locator: parsed.locator };
}

export function parseXlsxAuxiliaryEvidencePayload(quote: string): string | null {
  return parseXlsxAuxiliaryEvidence(quote, true)?.payload ?? null;
}

export function stripXlsxAuxiliaryEvidenceLocator(quote: string): string {
  return parseXlsxAuxiliaryEvidencePayload(quote) ?? quote;
}
