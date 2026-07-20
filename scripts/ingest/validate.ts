import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { CONVERTER_VERSION } from "./convert.js";
import {
  currentExtractionFingerprint,
  EXTRACTION_PROCESSING_VERSION,
  EXTRACTION_PROMPT_HASH,
  EXTRACTION_PROMPT_VERSION,
  SOURCE_MONEY_SCANNER_VERSION,
} from "./extraction-contract.js";
import {
  canonicalJsonSha256ExcludingField,
  prepareDeterministicStateArtifactWritePath,
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "./artifact-integrity.js";
import { readJsonFile, sha256File, sha256Text, writeJsonFile } from "./io.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { decodeEvidenceQuote } from "./merge-evidence.js";
import {
  buildPartnerVendorRecords,
  findPartnerVendorIdentityConflicts,
  findPartnerVendorDedupeCandidates,
} from "./partner-dedupe.js";
import { sourceFileId, sourceFilesForArtifact } from "./provenance.js";
import { validateStructuredRecordSourceLinkage } from "./record-source-linkage.js";
import { normalizeVendorName, regionCodeFromDirectory, SCANNER_PARSER_VERSION } from "./scan.js";
import { DisclosureExtractionSchema, StrictExtractionArtifactSchema } from "./schemas.js";
import type { DisclosureExtraction } from "./schemas.js";
import type { IngestManifest, ManifestUnit } from "./types.js";
import {
  indexXlsxAuxiliaryEvidence,
  looksLikeXlsxAuxiliaryEvidence,
  matchSingleXlsxAuxiliaryEvidenceQuote,
  parseXlsxAuxiliaryEvidenceLine,
  parseXlsxAuxiliaryEvidencePayload,
  type XlsxAuxiliaryEvidenceIndex,
} from "./xlsx-aux-evidence.js";

export const VALIDATOR_VERSION = "v12-xlsx-auxiliary-evidence";
export { SOURCE_MONEY_SCANNER_VERSION } from "./extraction-contract.js";
const BASE_PRICE_MIN_KRW = 100_000;
const BASE_PRICE_MAX_KRW = 30_000_000;
const SECTION_AND_POLICY_SOURCE_QUOTE_MAX_CHARACTERS = 2_000;
const PUBLIC_CONTACT_PATTERN = /(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;

const ValidationIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string().min(1),
  path: z.string().min(1),
  message: z.string().min(1),
});

export const CoverageGapSchema = z.object({
  raw: z.string().min(1).max(200),
  krw: z.number().int().nonnegative(),
  line_context: z.string().min(1).max(1_000),
  source_locator: z.string().min(1).max(200),
}).strict();

export type CoverageGap = z.infer<typeof CoverageGapSchema>;

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const DedupeCandidatesSchema = z.object({
  generated_at: z.string().datetime(),
  threshold: z.literal(0.7),
  auto_merge: z.literal(false),
  candidates: z.array(z.object({
    entity_kind: z.enum(["vendor", "agency"]).optional(),
    left_unit_id: z.string().regex(/^[a-f0-9]{64}$/),
    right_unit_id: z.string().regex(/^[a-f0-9]{64}$/),
    left_record_ref: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    right_record_ref: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    region_code: z.string().min(1),
    category: z.enum(["studio", "dress", "makeup", "hall", "other"]).optional(),
    left_name: z.string().min(1).max(500),
    right_name: z.string().min(1).max(500),
    similarity: z.number().min(0.7).max(1),
    decision: z.literal("human_review_required"),
  }).superRefine((candidate, context) => {
    const hasLeftRef = candidate.left_record_ref !== undefined;
    const hasRightRef = candidate.right_record_ref !== undefined;
    if (hasLeftRef !== hasRightRef) {
      context.addIssue({ code: "custom", message: "partner dedupe record refs must be provided as a pair" });
    }
    if ((hasLeftRef || hasRightRef) && candidate.entity_kind !== "vendor") {
      context.addIssue({ code: "custom", message: "row-level dedupe refs are only valid for vendor candidates" });
    }
  })).max(10_000),
});

export type DedupeCandidates = z.infer<typeof DedupeCandidatesSchema>;

const ValidatedSourceFileSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
}).strict();

export const LegacyValidatedArtifactSchema = z.object({
  schema_version: z.literal(1),
  validator_version: z.literal(VALIDATOR_VERSION),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  unit_id: z.string().regex(/^[a-f0-9]{64}$/),
  source_files: z.array(ValidatedSourceFileSchema),
  source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  extraction_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  data: DisclosureExtractionSchema,
  issues: z.array(ValidationIssueSchema),
  coverage_gaps: z.array(CoverageGapSchema).max(5_000),
  review_status: z.literal("pending"),
  validated_at: z.string().datetime(),
});

export const StrictValidatedArtifactSchema = z.object({
  schema_version: z.literal(2),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  validator_version: z.literal(VALIDATOR_VERSION),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  unit_id: z.string().regex(/^[a-f0-9]{64}$/),
  source_files: z.array(ValidatedSourceFileSchema),
  source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  extraction_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  extraction_content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  prompt_version: z.string().min(1).max(200),
  prompt_hash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.enum(["gpt-5.6-luna", "gpt-5.6-terra"]),
  data: DisclosureExtractionSchema,
  issues: z.array(ValidationIssueSchema),
  coverage_gaps: z.array(CoverageGapSchema).max(5_000),
  review_status: z.literal("pending"),
  validated_at: z.string().datetime(),
}).strict();

export const ValidatedArtifactSchema = z.union([
  LegacyValidatedArtifactSchema,
  StrictValidatedArtifactSchema,
]);

export type StrictValidatedArtifact = z.infer<typeof StrictValidatedArtifactSchema>;
export type ValidatedArtifact = z.infer<typeof ValidatedArtifactSchema>;

export interface ValidateOptions {
  stateDir: string;
}

export interface ValidationEvidenceContext {
  normalizedText: string;
  hasImages: boolean;
  xlsxCells?: XlsxCellEvidenceIndex;
  xlsxAuxiliary?: XlsxAuxiliaryEvidenceIndex;
  lineEvidence?: Record<string, string[]>;
  bySourceFileId?: Record<string, {
    normalizedText: string;
    hasImages: boolean;
    xlsxCells?: XlsxCellEvidenceIndex;
    xlsxAuxiliary?: XlsxAuxiliaryEvidenceIndex;
    lineEvidence?: Record<string, string[]>;
  }>;
  sourceScoped?: boolean;
  referencedSourceFileIds?: string[];
  recordModalities?: Record<string, "text" | "image" | "mixed">;
  recordSourceModalities?: Record<string, Record<string, "text" | "image" | "mixed">>;
}

function recordEvidenceModality(
  recordModalities: ValidationEvidenceContext["recordModalities"],
  issuePath: string,
): "text" | "image" | "mixed" | undefined {
  if (!recordModalities) return undefined;
  let candidate = issuePath;
  while (candidate) {
    const modality = recordModalities[candidate];
    if (modality) return modality;
    const parent = candidate.replace(/(?:\.[^.[]+|\[\d+\])$/u, "");
    if (parent === candidate) break;
    candidate = parent;
  }
  return undefined;
}

function scopeEvidenceToRecord(
  evidence: ValidationEvidenceContext,
  issuePath: string,
): ValidationEvidenceContext {
  const modality = recordEvidenceModality(evidence.recordModalities, issuePath);
  return {
    ...evidence,
    // Text-backed and mixed-origin records must pass exact converted-text
    // validation. An unrelated image on the same source cannot downgrade the
    // mismatch to a warning. Only an explicitly image-backed record, or a
    // legacy image-only source with no converted text, receives visual review.
    hasImages: modality === "image"
      || (modality === undefined && !evidence.normalizedText && evidence.hasImages),
  };
}

function recordSourceEvidenceModality(
  recordSourceModalities: ValidationEvidenceContext["recordSourceModalities"],
  issuePath: string,
  sourceFileIdValue: string,
): "text" | "image" | "mixed" | undefined {
  if (!recordSourceModalities) return undefined;
  let candidate = issuePath;
  while (candidate) {
    const modality = recordSourceModalities[candidate]?.[sourceFileIdValue];
    if (modality) return modality;
    const parent = candidate.replace(/(?:\.[^.[]+|\[\d+\])$/u, "");
    if (parent === candidate) break;
    candidate = parent;
  }
  return undefined;
}

export function normalizeEvidenceText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/\\\|/g, "|")
    .replace(/\s+/gu, " ")
    .trim();
}

interface ParsedLineEvidenceQuote {
  locator: string;
  lineNumber: number;
  lineContent: string;
}

export function parseLineEvidenceQuote(value: string): ParsedLineEvidenceQuote | null {
  const normalized = normalizeEvidenceText(value);
  const match = /^line:(\d+):\s*(.+)$/iu.exec(normalized);
  if (!match) return null;
  const lineNumber = Number.parseInt(match[1], 10);
  const lineContent = match[2].trim();
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1 || !lineContent) return null;
  return { locator: `line:${lineNumber}`, lineNumber, lineContent };
}

export function indexLineEvidence(text: string, lineOffset = 0): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const normalized = normalizeEvidenceText(rawLine);
    const locator = `line:${lineOffset + index + 1}`;
    // XLSX auxiliary records have their own source-scoped locator contract.
    // Never let a generic line:N quote bypass it.
    result[locator] = normalized && !looksLikeXlsxAuxiliaryEvidence(normalized)
      ? [normalized]
      : [];
  }
  return result;
}

export type XlsxCellEvidenceIndex = Record<string, string[]>;

export type XlsxEvidenceQuoteMatch = {
  kind: "not_xlsx";
} | {
  kind: "match";
  locator: string;
} | {
  kind: "reject";
  locator: string;
  violation: "not_in_request" | "not_exact_single_cell";
};

interface ParsedXlsxEvidenceLine {
  locator: string;
  cellContent: string;
}

function parseXlsxEvidenceLine(value: string, rejectComposite: boolean): ParsedXlsxEvidenceLine | null {
  const normalized = normalizeEvidenceText(value);
  if (looksLikeXlsxAuxiliaryEvidence(normalized)) return null;
  const located = /^(.+?)!([A-Z]+\d+):\s*(.+)$/iu.exec(normalized);
  if (!located) return null;
  const locator = `${located[1].normalize("NFKC")}!${located[2].toUpperCase()}`;
  const cellContent = located[3].trim();
  if (!cellContent) return null;
  if (rejectComposite) {
    // A range such as `Sheet!A1:B2: ...` is parsed with `B2: ...` as the
    // apparent cell content. Explicitly reject that shape, as well as a
    // second locator joined by punctuation. A source quote may bind to one
    // physical cell only.
    if (/^[A-Z]+\d+(?::[A-Z]+\d+)?\s*:/iu.test(cellContent)) return null;
    if (/(?:^|[;|])\s*(?:[^;|]+!)?[A-Z]+\d+(?::[A-Z]+\d+)?\s*:/iu.test(cellContent)) return null;
  }
  return { locator, cellContent };
}

export function indexXlsxCellEvidence(text: string): XlsxCellEvidenceIndex {
  const index: XlsxCellEvidenceIndex = {};
  for (const line of text.split(/\r?\n/u)) {
    if (looksLikeXlsxAuxiliaryEvidence(line)) continue;
    const parsed = parseXlsxEvidenceLine(line.trim(), false);
    if (!parsed) continue;
    const values = index[parsed.locator] ?? [];
    if (!values.includes(parsed.cellContent)) values.push(parsed.cellContent);
    index[parsed.locator] = values;
  }
  return index;
}

export function matchSingleXlsxEvidenceQuote(
  quote: string,
  cells: XlsxCellEvidenceIndex,
): XlsxEvidenceQuoteMatch {
  if (looksLikeXlsxAuxiliaryEvidence(quote)) return { kind: "not_xlsx" };
  const parsed = parseXlsxEvidenceLine(quote, true);
  if (!parsed) {
    const locatedButComposite = parseXlsxEvidenceLine(quote, false);
    if (locatedButComposite) {
      return {
        kind: "reject",
        locator: locatedButComposite.locator,
        violation: "not_exact_single_cell",
      };
    }
    return /(?:^|[;|\s])(?:[^;|\s]+!)?[A-Z]+\d+(?::[A-Z]+\d+)?\s*:/iu.test(
      normalizeEvidenceText(quote),
    )
      ? { kind: "reject", locator: "invalid_xlsx_locator", violation: "not_exact_single_cell" }
      : { kind: "not_xlsx" };
  }
  const candidates = cells[parsed.locator];
  if (!candidates) {
    return { kind: "reject", locator: parsed.locator, violation: "not_in_request" };
  }
  if (!candidates.some((candidate) => candidate.includes(parsed.cellContent))) {
    return { kind: "reject", locator: parsed.locator, violation: "not_exact_single_cell" };
  }
  return { kind: "match", locator: parsed.locator };
}

export function validatedArtifactFingerprint(
  extractionFingerprint: string,
  data: DisclosureExtraction,
  issues: ValidationIssue[],
  coverageGaps: CoverageGap[] = [],
): string {
  const payloadHash = sha256Text(JSON.stringify({ data, issues, coverage_gaps: coverageGaps }));
  return sha256Text(`${VALIDATOR_VERSION}\0${extractionFingerprint}\0${payloadHash}`);
}

interface ExtractedMoneyEvidence {
  values: number[];
  quote: string | null;
}

function validMoneyValues(...values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  ))];
}

function extractedMoneyEvidence(
  data: DisclosureExtraction,
  includeAuditLedger = true,
): ExtractedMoneyEvidence[] {
  if (includeAuditLedger && (data.money_occurrences?.length ?? 0) > 0) {
    return (data.money_occurrences ?? []).map((occurrence) => ({
      values: [occurrence.amount_krw],
      quote: occurrence.source_quote,
    }));
  }
  const evidence: ExtractedMoneyEvidence[] = [];
  const add = (quote: string | null, ...values: Array<number | null>): void => {
    const normalizedValues = validMoneyValues(...values);
    if (normalizedValues.length === 0) return;
    if (quote === null) {
      evidence.push({ values: normalizedValues, quote });
      return;
    }
    const decoded = decodeEvidenceQuote(quote);
    if (decoded.kind === "merged") {
      evidence.push(...decoded.fragments.map((fragment) => ({
        values: normalizedValues,
        quote: fragment.quote,
      })));
      return;
    }
    evidence.push({ values: normalizedValues, quote });
  };
  for (const item of data.agency_packages) {
    add(item.source_quote, item.price_min_krw, item.price_max_krw);
    for (const option of item.options) {
      add(option.source_quote, option.price_min_krw, option.price_max_krw);
    }
  }
  for (const item of data.partner_vendors) {
    add(item.source_quote, item.price_min_krw, item.price_max_krw);
    for (const option of item.options) {
      add(option.source_quote, option.price_min_krw, option.price_max_krw);
    }
    for (const policy of item.policies ?? []) {
      add(policy.source_quote, ...sourceMoneyOccurrences(
        policy.source_quote,
        null,
        policy.source_quote,
        "policy_quote",
      ).map((occurrence) => occurrence.krw));
    }
  }
  for (const hall of data.halls ?? []) {
    add(
      hall.source_quote,
      hall.venue_fee_min_krw,
      hall.venue_fee_max_krw,
      hall.meal_price_min_krw,
      hall.meal_price_max_krw,
      hall.decoration_fee_min_krw,
      hall.decoration_fee_max_krw,
    );
    for (const option of hall.options) {
      add(option.source_quote, option.price_min_krw, option.price_max_krw);
    }
  }
  for (const section of data.sections ?? []) {
    add(section.source_quote, ...sourceMoneyOccurrences(
      section.source_quote,
      null,
      section.source_quote,
      "section_quote",
    ).map((occurrence) => occurrence.krw));
  }
  add(data.hall.venue_fee_source_quote, data.hall.venue_fee_krw);
  add(
    data.hall.meal_price_source_quote,
    data.hall.meal_price_min_krw,
    data.hall.meal_price_max_krw,
  );
  for (const item of data.hall.items) {
    add(item.source_quote, item.price_min_krw, item.price_max_krw);
  }
  return evidence;
}

function declaredMoneyMultiplier(line: string): number | null {
  const match = line.match(/(?:금액\s*)?단위\s*[:：]?\s*(억|천만|백만|만|천)?\s*원/u);
  if (!match) return null;
  if (match[1] === "억") return 100_000_000;
  if (match[1] === "천만") return 10_000_000;
  if (match[1] === "백만") return 1_000_000;
  if (match[1] === "만") return 10_000;
  if (match[1] === "천") return 1_000;
  return 1;
}

function parentheticalMoneyMultiplier(line: string): number | null {
  const match = line.match(/[([]\s*(?:단위\s*[:：]?\s*)?(억|천만|백만|만|천)?\s*원(?:\s*,[^)\]]*)?\s*[)\]]/u);
  if (!match) return null;
  return moneyMultiplier(match[1] ?? "원");
}

function excludedMoneyContext(line: string): boolean {
  return /(?:전화|연락처|tel|fax|사업자\s*등록|계좌|은행|예금주|작성일|날짜)/iu.test(line);
}

interface MoneyMatchSpan {
  start: number;
  end: number;
}

function overlapsSpan(start: number, end: number, spans: MoneyMatchSpan[]): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

function moneyMultiplier(unit: string): number {
  if (unit === "억") return 100_000_000;
  if (unit === "천만") return 10_000_000;
  if (unit === "백만") return 1_000_000;
  if (unit === "만") return 10_000;
  if (unit === "천") return 1_000;
  return 1;
}

function numericMoney(value: string, multiplier: number): number | null {
  const numeric = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const amount = Math.round(numeric * multiplier);
  return Number.isSafeInteger(amount) ? amount : null;
}

function explicitMoneyAmount(raw: string): number | null {
  let amount = 0;
  let components = 0;
  for (const match of raw.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(천만|백만|억|만|천)/gu)) {
    const component = numericMoney(match[1], moneyMultiplier(match[2]));
    if (component === null) return null;
    amount += component;
    components += 1;
  }
  if (components > 0) return Number.isSafeInteger(amount) ? amount : null;
  const won = raw.match(/(\d[\d,]*(?:\.\d+)?)\s*원/u);
  return won ? numericMoney(won[1], 1) : null;
}

function explicitCurrencyMoneyAmount(raw: string): number | null {
  const unitAmount = explicitMoneyAmount(raw);
  if (unitAmount !== null) return unitAmount;
  const numeric = raw.match(/\d[\d,]*(?:\.\d+)?/u)?.[0];
  return numeric ? numericMoney(numeric, 1) : null;
}

function simpleKoreanMoneyMultiplier(raw: string): number | null {
  const match = raw.match(
    /^\s*\d[\d,]*(?:\.\d+)?\s*(천만|백만|억|만|천)\s*원?\s*$/u,
  );
  return match ? moneyMultiplier(match[1]) : null;
}

function explicitCurrencyRangeAmount(raw: string, peer: string): number | null {
  if (!/(?:천만|백만|억|만|천|원)/u.test(raw)) {
    const sharedMultiplier = simpleKoreanMoneyMultiplier(peer);
    const numeric = raw.match(/\d[\d,]*(?:\.\d+)?/u)?.[0];
    if (sharedMultiplier !== null && numeric) {
      return numericMoney(numeric, sharedMultiplier);
    }
  }
  return explicitCurrencyMoneyAmount(raw);
}

const CURRENCY_MONEY_TOKEN_PATTERN = String.raw`\d[\d,]*(?:\.\d+)?(?:\s*(?:천만|백만|억|만|천)(?:\s*\d[\d,]*(?:\.\d+)?\s*(?:천만|백만|억|만|천))*\s*원?|\s*원)?`;

function bareMoneyMultiplier(raw: string, declaredMultiplier: number, before = ""): number {
  // A comma-formatted value such as `1컷16,500` is already written in won,
  // even when the surrounding sheet declares bare table cells in 만원. Applying
  // the sheet multiplier would turn 16,500원 into 165,000,000원. Explicit unit
  // text still wins earlier in sourceMoneyOccurrences.
  if (
    declaredMultiplier > 1
    && raw.includes(",")
    && Number(raw.replace(/,/g, "")) >= 1_000
    && /(?:컷|장|개|부|권)\s*$/u.test(before)
  ) {
    return 1;
  }
  return declaredMultiplier;
}

function isClockFragment(before: string, after: string): boolean {
  return /(?:^|\D)\d{1,2}:$/u.test(before) || /^:\d{2}(?:\D|$)/u.test(after);
}

function isNumberedClause(before: string, after: string): boolean {
  return /(?:^|<br>|[\n\r])\s*$/iu.test(before) && /^\.\s/u.test(after);
}

function hasKoreanCountSuffix(after: string): boolean {
  return /^(?:명|개|건|회|벌|장|부|권|페이지|컷|시간|분|일|개월|월|년|조|인|팀|곳|호|차|대)/u.test(after.trimStart());
}

function isEmbeddedIdentifier(raw: string, before: string, after: string): boolean {
  if (raw.includes(",")) return false;
  // Bare table prices are frequently attached directly to a Korean label
  // (`대표:55`, `선수정본:5컷11`). Only suppress known choice syntax here;
  // vendor-name digits in identity columns never receive a bare-price
  // multiplier in the first place.
  if (/(?:택|선택)\s*$/u.test(before) || /^스팟/u.test(after)) return true;
  if (!/[\p{L}]$/u.test(before) && !/^\p{L}/u.test(after)) return false;
  const segment = before.split(/<br>|[\/|]/iu).at(-1) ?? before;
  if (/[:：]/u.test(segment)) return false;
  if (/(?:가격|금액|비용|추가|옵션|할인|할증|대관료|식대|보증금|사용료|상담비|제작비|변경비|당|컷|장|벌|개)\s*$/u.test(before)) {
    return false;
  }
  return true;
}

function sourceMoneyOccurrences(
  payload: string,
  multiplier: number | null,
  lineContext: string,
  sourceLocator: string,
  allowBare = true,
): CoverageGap[] {
  const occurrences: CoverageGap[] = [];
  const occupied: MoneyMatchSpan[] = [];
  const push = (raw: string, krw: number | null, start: number, end: number): void => {
    if (krw === null) return;
    const context = lineContext.length <= 1_000
      ? lineContext
      : payload.slice(
        Math.max(0, start - 480),
        Math.min(payload.length, end + 480),
      );
    occurrences.push({
      raw: raw.trim().slice(0, 200),
      krw,
      line_context: context.slice(0, 1_000),
      source_locator: sourceLocator.slice(0, 200),
    });
  };

  // Some disclosure files use the ISO code or won symbol instead of the
  // Korean `원` suffix. Treat those markers as explicit currency evidence so
  // they are audited even when the surrounding table has no declared unit.
  const explicitCurrencyRange = new RegExp(
    String.raw`(?:(KRW|₩)\s*)?(${CURRENCY_MONEY_TOKEN_PATTERN})\s*(KRW)?\s*(?:~|〜|–|—|-)\s*(?:(KRW|₩)\s*)?(${CURRENCY_MONEY_TOKEN_PATTERN})\s*(KRW)?`,
    "giu",
  );
  for (const match of payload.matchAll(explicitCurrencyRange)) {
    if (![match[1], match[3], match[4], match[6]].some(Boolean)) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    occupied.push({ start, end });
    push(match[0], explicitCurrencyRangeAmount(match[2], match[5]), start, end);
    push(match[0], explicitCurrencyRangeAmount(match[5], match[2]), start, end);
  }

  const explicitCurrencySingle = new RegExp(
    String.raw`(?:KRW\s*|₩\s*)(${CURRENCY_MONEY_TOKEN_PATTERN})|(${CURRENCY_MONEY_TOKEN_PATTERN})\s*KRW\b`,
    "giu",
  );
  for (const match of payload.matchAll(explicitCurrencySingle)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlapsSpan(start, end, occupied)) continue;
    occupied.push({ start, end });
    push(match[0], explicitCurrencyMoneyAmount(match[1] ?? match[2]), start, end);
  }

  const explicitRange = /(\d[\d,]*(?:\.\d+)?)\s*(?:~|〜|–|—|-)\s*(?:(?:최고|최대|상한)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(억|천만|백만|만|천)\s*원?/gu;
  for (const match of payload.matchAll(explicitRange)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlapsSpan(start, end, occupied)) continue;
    if (!match[0].trimEnd().endsWith("원") && hasKoreanCountSuffix(payload.slice(end))) {
      occupied.push({ start, end });
      continue;
    }
    occupied.push({ start, end });
    const unitMultiplier = moneyMultiplier(match[3]);
    push(match[0], numericMoney(match[1], unitMultiplier), start, end);
    push(match[0], numericMoney(match[2], unitMultiplier), start, end);
  }

  const explicitSingle = /(?:\d[\d,]*(?:\.\d+)?\s*(?:천만|백만|억|만|천)\s*)+원?|\d[\d,]*(?:\.\d+)?\s*원/gu;
  for (const match of payload.matchAll(explicitSingle)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlapsSpan(start, end, occupied)) continue;
    if (!match[0].trimEnd().endsWith("원") && hasKoreanCountSuffix(payload.slice(end))) {
      occupied.push({ start, end });
      continue;
    }
    occupied.push({ start, end });
    push(match[0], explicitMoneyAmount(match[0]), start, end);
  }

  if (multiplier === null || !allowBare) return occurrences;

  const bareRange = /(\d[\d,]*(?:\.\d+)?)\s*(?:~|〜|–|—|-)\s*(?:(?:최고|최대|상한)\s*)?(\d[\d,]*(?:\.\d+)?)/gu;
  for (const match of payload.matchAll(bareRange)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlapsSpan(start, end, occupied)) continue;
    const after = payload.slice(end).trimStart();
    const before = payload.slice(0, start);
    if (isClockFragment(before, after)) {
      occupied.push({ start, end });
      continue;
    }
    if (/^(?:%|년|개월|월|일|시간|분|시|회|벌|장|개|명|부|권|페이지|컷)/u.test(after)) {
      occupied.push({ start, end });
      continue;
    }
    occupied.push({ start, end });
    push(match[0], numericMoney(match[1], bareMoneyMultiplier(match[1], multiplier, before)), start, end);
    push(match[0], numericMoney(match[2], bareMoneyMultiplier(match[2], multiplier, before)), start, end);
  }

  for (const match of payload.matchAll(/\d[\d,]*(?:\.\d+)?/gu)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    if (overlapsSpan(start, end, occupied)) continue;
    const after = payload.slice(end).trimStart();
    const before = payload.slice(0, start);
    if (isClockFragment(before, after) || isNumberedClause(before, after)) continue;
    if (isEmbeddedIdentifier(raw, before, after)) continue;
    if (/^(?:%|p\b|r\b|벌|회|장|개|명|시간|분|시|부|권|페이지|컷|스팟|일|개월|월|년|조)/iu.test(after)) continue;
    if (/[\d,.-]$/u.test(before)) continue;
    push(raw, numericMoney(raw, bareMoneyMultiplier(raw, multiplier, before)), start, end);
  }
  return occurrences;
}

function xlsxColumnNumber(column: string): number {
  let result = 0;
  for (const character of column) result = result * 26 + character.charCodeAt(0) - 64;
  return result;
}

function xlsxColumnName(columnNumber: number): string {
  let value = columnNumber;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function priceHeaderContext(payload: string): boolean {
  return /(?:가격|금액|비용|요금|대관료|식대|보증금|추가금|헬퍼|퍼스트웨어|추가대여|헤어피스|선택품목|옵션)/u.test(payload);
}

export function scanSourceMoneyOccurrences(fullText: string): CoverageGap[] {
  const candidates: CoverageGap[] = [];
  const lines = fullText.normalize("NFKC").split(/\r?\n/u);
  const workbookMultipliers = new Map<string, Set<number>>();
  const workbookUnitDeclarations = new Map<string, Array<{
    column: string;
    row: number;
    multiplier: number;
  }>>();
  const workbookColumnUnitDeclarations = new Map<string, Array<{
    column: string;
    row: number;
    multiplier: number;
  }>>();
  const workbookPriceColumns = new Map<string, Set<string>>();
  const workbookCellPayloads = new Map<string, string>();
  const workbookSheets = new Set<string>();
  for (const rawLine of lines) {
    if (looksLikeXlsxAuxiliaryEvidence(rawLine)) continue;
    const cellMatch = rawLine.trim().match(/^(.+)!([A-Z]+\d+):\s*(.*)$/u);
    if (!cellMatch) continue;
    workbookSheets.add(cellMatch[1]);
    workbookCellPayloads.set(`${cellMatch[1]}\0${cellMatch[2]}`, cellMatch[3]);
    const declared = declaredMoneyMultiplier(cellMatch[3]);
    const row = Number(cellMatch[2].match(/\d+$/u)?.[0]);
    const column = cellMatch[2].match(/^[A-Z]+/u)?.[0];
    const columnDeclared = declared === null && priceHeaderContext(cellMatch[3])
      ? parentheticalMoneyMultiplier(cellMatch[3])
      : null;
    if (columnDeclared !== null && column && Number.isSafeInteger(row)) {
      const declarations = workbookColumnUnitDeclarations.get(cellMatch[1]) ?? [];
      declarations.push({ column, row, multiplier: columnDeclared });
      workbookColumnUnitDeclarations.set(cellMatch[1], declarations);
    } else if (declared !== null) {
      const values = workbookMultipliers.get(cellMatch[1]) ?? new Set<number>();
      values.add(declared);
      workbookMultipliers.set(cellMatch[1], values);
      if (column && Number.isSafeInteger(row)) {
        const declarations = workbookUnitDeclarations.get(cellMatch[1]) ?? [];
        declarations.push({ column, row, multiplier: declared });
        workbookUnitDeclarations.set(cellMatch[1], declarations);
      }
    }
    if (
      column
      && Number.isSafeInteger(row)
      && row <= 20
      && priceHeaderContext(cellMatch[3])
    ) {
      const priceColumns = workbookPriceColumns.get(cellMatch[1]) ?? new Set<string>();
      priceColumns.add(column);
      workbookPriceColumns.set(cellMatch[1], priceColumns);
    }
  }
  for (const [sheetName, declarations] of workbookUnitDeclarations) {
    const existingColumnDeclarations = workbookColumnUnitDeclarations.get(sheetName) ?? [];
    const columnSpecificRows = new Set<number>();
    for (const row of new Set([
      ...declarations.map((declaration) => declaration.row),
      ...existingColumnDeclarations.map((declaration) => declaration.row),
    ])) {
      const rowDeclarations = [...declarations, ...existingColumnDeclarations]
        .filter((declaration) => declaration.row === row);
      if (
        new Set(rowDeclarations.map((declaration) => declaration.column)).size > 1
        && new Set(rowDeclarations.map((declaration) => declaration.multiplier)).size > 1
      ) {
        columnSpecificRows.add(row);
      }
    }
    const promoted = declarations.filter((declaration) => columnSpecificRows.has(declaration.row));
    if (promoted.length === 0) continue;
    workbookColumnUnitDeclarations.set(sheetName, [...existingColumnDeclarations, ...promoted]);
    workbookUnitDeclarations.set(
      sheetName,
      declarations.filter((declaration) => !columnSpecificRows.has(declaration.row)),
    );
  }
  let prepassSheet: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line.match(/^##\s*시트:\s*(.+)$/u);
    if (heading) {
      prepassSheet = heading[1].trim();
      continue;
    }
    if (!prepassSheet) continue;
    const merge = line.match(/^병합 범위\s+([A-Z]+\d+):([A-Z]+\d+)\s*·\s*좌상단\s+([A-Z]+\d+)$/u);
    if (!merge) continue;
    const anchorPayload = workbookCellPayloads.get(`${prepassSheet}\0${merge[3]}`);
    if (!anchorPayload || !priceHeaderContext(anchorPayload)) continue;
    const startColumn = merge[1].match(/^[A-Z]+/u)?.[0];
    const endColumn = merge[2].match(/^[A-Z]+/u)?.[0];
    if (!startColumn || !endColumn) continue;
    const priceColumns = workbookPriceColumns.get(prepassSheet) ?? new Set<string>();
    const anchorColumn = merge[3].match(/^[A-Z]+/u)?.[0];
    const anchorRow = Number(merge[3].match(/\d+$/u)?.[0]);
    const anchorDeclaration = (workbookColumnUnitDeclarations.get(prepassSheet) ?? [])
      .filter((declaration) => declaration.column === anchorColumn && declaration.row === anchorRow)
      .at(-1);
    for (
      let column = xlsxColumnNumber(startColumn);
      column <= xlsxColumnNumber(endColumn);
      column += 1
    ) {
      const columnName = xlsxColumnName(column);
      priceColumns.add(columnName);
      if (anchorDeclaration) {
        const declarations = workbookColumnUnitDeclarations.get(prepassSheet) ?? [];
        if (!declarations.some((declaration) =>
          declaration.column === columnName
          && declaration.row === anchorDeclaration.row
          && declaration.multiplier === anchorDeclaration.multiplier
        )) {
          declarations.push({
            column: columnName,
            row: anchorDeclaration.row,
            multiplier: anchorDeclaration.multiplier,
          });
          workbookColumnUnitDeclarations.set(prepassSheet, declarations);
        }
      }
    }
    workbookPriceColumns.set(prepassSheet, priceColumns);
  }

  let tableMultiplier: number | null = null;
  let currentSheet: string | null = null;
  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const auxiliary = parseXlsxAuxiliaryEvidenceLine(line);
    if (auxiliary) {
      candidates.push(...sourceMoneyOccurrences(
        auxiliary.payload,
        null,
        auxiliary.payload,
        auxiliary.locator,
        !excludedMoneyContext(auxiliary.payload),
      ));
      continue;
    }
    if (looksLikeXlsxAuxiliaryEvidence(line)) {
      // Converted auxiliary evidence is required to be canonical. A malformed
      // line cannot fall back to a generic line locator.
      continue;
    }
    const sheetHeading = line.match(/^##\s*시트:\s*(.+)$/u);
    if (sheetHeading) {
      currentSheet = sheetHeading[1].trim();
      const declared = workbookMultipliers.get(currentSheet);
      tableMultiplier = declared?.size === 1 ? [...declared][0] : null;
      continue;
    }
    const canonicalCell = line.match(/^(.+)!([A-Z]+\d+):\s*(.*)$/u);
    if (canonicalCell) {
      const sheetName = canonicalCell[1];
      const sheetMultipliers = workbookMultipliers.get(sheetName);
      const cellRow = Number.parseInt(canonicalCell[2].match(/\d+$/u)?.[0] ?? "", 10);
      const column = canonicalCell[2].match(/^[A-Z]+/u)?.[0];
      const nearestColumnDeclaration = (workbookColumnUnitDeclarations.get(sheetName) ?? [])
        .filter((declaration) => declaration.column === column && declaration.row <= cellRow)
        .sort((left, right) => right.row - left.row)[0];
      const nearestDeclaration = (workbookUnitDeclarations.get(sheetName) ?? [])
        .filter((declaration) => declaration.row <= cellRow)
        .sort((left, right) => right.row - left.row)[0];
      const sheetMultiplier = nearestColumnDeclaration?.multiplier
        ?? nearestDeclaration?.multiplier
        ?? (sheetMultipliers?.size === 1 ? [...sheetMultipliers][0] : tableMultiplier);
      const payload = canonicalCell[3];
      if (declaredMoneyMultiplier(payload) !== null || parentheticalMoneyMultiplier(payload) !== null) continue;
      const hasInlinePriceSemantics = /(?:가격|금액|비용|추가|옵션|할인|할증|당|업그레이드|제작|변경|대관|식대|사용료|보증금|원본|수정|앨범|액자)/u.test(payload);
      const isPriceColumn = Boolean(column && workbookPriceColumns.get(sheetName)?.has(column));
      const cellMultiplier = isPriceColumn || hasInlinePriceSemantics ? sheetMultiplier : null;
      candidates.push(...sourceMoneyOccurrences(
        payload,
        cellMultiplier,
        line,
        `${sheetName}!${canonicalCell[2]}`,
        !excludedMoneyContext(payload),
      ));
      continue;
    }
    if (
      currentSheet
      && workbookSheets.has(currentSheet)
      && /^\|\s*(?:[A-Z]+\d+|셀|---)\s*\|/u.test(line)
    ) {
      // workbookToMarkdown emits every real cell twice: once as Sheet!A1 and
      // once in this rendering table. Only the canonical cell is source evidence.
      continue;
    }
    if (/^병합 범위\s/u.test(line)) continue;
    const declared = declaredMoneyMultiplier(line);
    if (declared !== null) {
      tableMultiplier = declared;
      continue;
    }
    candidates.push(...sourceMoneyOccurrences(
      line,
      tableMultiplier,
      line,
      `line:${lineIndex + 1}`,
      !excludedMoneyContext(line),
    ));
  }

  return candidates;
}

export function findCoverageGaps(
  fullText: string,
  data: DisclosureExtraction,
  options: { includeAuditLedger?: boolean } = {},
): CoverageGap[] {
  const candidates = scanSourceMoneyOccurrences(fullText);
  const xlsxCells = indexXlsxCellEvidence(fullText);
  const xlsxAuxiliary = indexXlsxAuxiliaryEvidence(fullText);
  const lineEvidence = indexLineEvidence(fullText);
  const evidenceValues = extractedMoneyEvidence(data, options.includeAuditLedger ?? false)
    .flatMap((evidence) => evidence.values.map((value) => ({ quote: evidence.quote, value })));
  const edges = evidenceValues.map((evidence) => {
    if (!evidence.quote) return [] as number[];
    const normalizedQuote = normalizeEvidenceText(evidence.quote);
    if (!normalizedQuote) return [] as number[];
    const lineQuote = parseLineEvidenceQuote(evidence.quote);
    const xlsxQuote = matchSingleXlsxEvidenceQuote(evidence.quote, xlsxCells);
    const xlsxAuxiliaryQuote = matchSingleXlsxAuxiliaryEvidenceQuote(
      evidence.quote,
      xlsxAuxiliary,
    );
    return candidates.flatMap((candidate, candidateIndex) => {
      if (candidate.krw !== evidence.value) return [];
      const candidateContext = normalizeEvidenceText(candidate.line_context);
      if (lineQuote) {
        const sourceLines = lineEvidence[lineQuote.locator] ?? [];
        return candidate.source_locator === lineQuote.locator
          && sourceLines.some((line) => line.includes(lineQuote.lineContent))
          ? [candidateIndex]
          : [];
      }
      if (xlsxQuote.kind === "match") {
        return candidate.source_locator === xlsxQuote.locator ? [candidateIndex] : [];
      }
      if (xlsxQuote.kind === "reject") return [];
      if (xlsxAuxiliaryQuote.kind === "match") {
        return candidate.source_locator === xlsxAuxiliaryQuote.locator ? [candidateIndex] : [];
      }
      if (xlsxAuxiliaryQuote.kind === "reject") return [];
      // Legacy/non-located evidence remains acceptable only when its semantic
      // context identifies the actual occurrence. A money-only quote must not
      // consume an arbitrary equal-valued occurrence elsewhere in the source.
      const semanticTokens = normalizedQuote
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= 2)
        .filter((token) => !/^(?:krw|\d[\d,.]*(?:원|만원|천원|억원)?)$/iu.test(token));
      return semanticTokens.some((token) => candidateContext.includes(token))
        && (candidateContext.includes(normalizedQuote) || normalizedQuote.includes(candidateContext))
        ? [candidateIndex]
        : [];
    });
  });

  const candidateOwner = new Map<number, number>();
  const assign = (evidenceIndex: number, visited: Set<number>): boolean => {
    for (const candidateIndex of edges[evidenceIndex] ?? []) {
      if (visited.has(candidateIndex)) continue;
      visited.add(candidateIndex);
      const previousOwner = candidateOwner.get(candidateIndex);
      if (previousOwner === undefined || assign(previousOwner, visited)) {
        candidateOwner.set(candidateIndex, evidenceIndex);
        return true;
      }
    }
    return false;
  };
  for (const evidenceIndex of evidenceValues.keys()) assign(evidenceIndex, new Set<number>());
  const matched = new Set(candidateOwner.keys());
  return candidates.filter((_, index) => !matched.has(index)).slice(0, 5_000);
}

export function parseKoreanMoneyAmounts(text: string): number[] {
  return [...new Set(sourceMoneyOccurrences(
    text.normalize("NFKC"),
    null,
    text,
    "quote",
  ).map((occurrence) => occurrence.krw))];
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function evidenceContainsQuote(
  quote: string,
  evidence: Pick<ValidationEvidenceContext, "normalizedText" | "xlsxCells" | "xlsxAuxiliary" | "lineEvidence">,
): boolean {
  const auxiliaryQuote = matchSingleXlsxAuxiliaryEvidenceQuote(
    quote,
    evidence.xlsxAuxiliary ?? {},
  );
  if (auxiliaryQuote.kind === "match") return true;
  if (auxiliaryQuote.kind === "reject") return false;
  const lineQuote = parseLineEvidenceQuote(quote);
  if (lineQuote) {
    return (evidence.lineEvidence?.[lineQuote.locator] ?? [])
      .some((line) => line.includes(lineQuote.lineContent));
  }
  const xlsxQuote = evidence.xlsxCells === undefined
    ? { kind: "not_xlsx" as const }
    : matchSingleXlsxEvidenceQuote(quote, evidence.xlsxCells);
  if (xlsxQuote.kind === "match") return true;
  if (xlsxQuote.kind === "reject") return false;
  const normalizedQuote = normalizeEvidenceText(quote);
  if (!normalizedQuote) return false;
  const unlabeledAuxiliaryPayload = Object.values(evidence.xlsxAuxiliary ?? {})
    .flat()
    .some((payload) => payload.includes(normalizedQuote));
  return !unlabeledAuxiliaryPayload && evidence.normalizedText.includes(normalizedQuote);
}

function boundedSingleQuotePayload(quote: string): string | null {
  const auxiliary = parseXlsxAuxiliaryEvidencePayload(quote);
  if (auxiliary) return normalizeEvidenceText(auxiliary);
  if (looksLikeXlsxAuxiliaryEvidence(quote)) return null;
  const line = parseLineEvidenceQuote(quote);
  if (line) return normalizeEvidenceText(line.lineContent);
  const xlsx = parseXlsxEvidenceLine(quote, true);
  if (xlsx) return normalizeEvidenceText(xlsx.cellContent);
  const normalized = normalizeEvidenceText(quote);
  return normalized.length > 0 ? normalized : null;
}

/**
 * Return only the text explicitly carried by the quoted evidence boundary.
 * Never search the whole source here: an exact but unrelated quote must not
 * authenticate semantic fields copied or invented from somewhere else.
 */
function boundedEvidencePayloads(quote: string): string[] | null {
  const decoded = decodeEvidenceQuote(quote);
  if (decoded.kind === "invalid") return null;
  if (decoded.kind === "single") {
    const payload = boundedSingleQuotePayload(decoded.quote);
    return payload ? [payload] : null;
  }
  const payloads: string[] = [];
  for (const fragment of decoded.fragments) {
    // Nested envelopes are not part of the evidence contract and must not
    // expand the trusted text boundary recursively.
    if (decodeEvidenceQuote(fragment.quote).kind !== "single") return null;
    const payload = boundedSingleQuotePayload(fragment.quote);
    if (!payload) return null;
    payloads.push(payload);
  }
  return payloads;
}

function boundedEvidenceContainsField(payloads: readonly string[], value: string): boolean {
  const normalizedValue = normalizeEvidenceText(value);
  return normalizedValue.length > 0
    && payloads.some((payload) => payload.includes(normalizedValue));
}

const SECTION_TYPE_EVIDENCE_LABELS: Readonly<Record<
  NonNullable<DisclosureExtraction["sections"]>[number]["section_type"],
  readonly string[]
>> = {
  pricing_basis: [
    "가격 기준",
    "가격기준",
    "금액 기준",
    "금액기준",
    "금액 단위",
    "금액단위",
    "단위",
    "총비용",
    "계산식",
    "산정",
    "산출",
    "pricing basis",
    "price basis",
  ],
  refund_policy: ["환불", "환급", "반환", "refund"],
  penalty: ["위약금", "위약", "해약금", "취소 수수료", "penalty"],
  contract_terms: ["계약 조건", "계약조건", "계약 조항", "계약조항", "약관", "contract terms"],
  reservation: ["예약", "reservation"],
  validity: ["유효", "적용 기간", "적용기간", "validity"],
  included_items: ["포함", "구성", "included"],
  usage_guide: ["이용 안내", "이용안내", "사용 안내", "사용안내", "usage guide"],
  notice: ["안내", "유의", "주의", "공지", "notice"],
  other: ["기타", "other"],
};

const POLICY_TYPE_EVIDENCE_LABELS: Readonly<Record<
  NonNullable<DisclosureExtraction["partner_vendors"][number]["policies"]>[number]["policy_type"],
  readonly string[]
>> = {
  penalty: ["위약금", "위약", "해약금", "취소 수수료", "penalty"],
  refund: ["환불", "환급", "반환", "refund"],
  change: ["변경", "change"],
  other: ["기타", "other"],
};

const PARTNER_CATEGORY_EVIDENCE_LABELS: Readonly<Record<
  DisclosureExtraction["partner_vendors"][number]["category"],
  readonly string[]
>> = {
  studio: ["스튜디오", "studio"],
  dress: ["드레스", "dress"],
  makeup: ["메이크업", "헤어 메이크업", "makeup"],
  hall: ["예식장", "웨딩홀", "hall", "venue"],
  other: ["기타", "other"],
};

const AGENCY_CATEGORY_EVIDENCE_LABELS: Readonly<Record<
  DisclosureExtraction["agency_packages"][number]["category_scope"][number],
  readonly string[]
>> = {
  studio: ["스튜디오", "studio", "스드메"],
  dress: ["드레스", "dress", "스드메"],
  makeup: ["메이크업", "헤어 메이크업", "makeup", "스드메"],
};

function boundedEvidenceContainsAnyLabel(
  payloads: readonly string[],
  labels: readonly string[],
): boolean {
  const normalizedPayloads = payloads.map((payload) => payload.toLocaleLowerCase("ko-KR"));
  return labels.some((label) => {
    const normalizedLabel = normalizeEvidenceText(label).toLocaleLowerCase("ko-KR");
    return normalizedPayloads.some((payload) => payload.includes(normalizedLabel));
  });
}

function validateSectionSemanticGrounding(
  section: NonNullable<DisclosureExtraction["sections"]>[number],
  issuePath: string,
  issues: ValidationIssue[],
  evidence?: ValidationEvidenceContext,
): void {
  if (!evidence) return;
  const payloads = boundedEvidencePayloads(section.source_quote);
  if (!payloads) return;
  let requiresReview = false;
  for (const [field, value] of [
    ["title", section.title],
    ["content_verbatim", section.content_verbatim],
  ] as const) {
    if (boundedEvidenceContainsField(payloads, value)) continue;
    requiresReview = true;
    if (
      field === "content_verbatim"
      && normalizeEvidenceText(value).length > SECTION_AND_POLICY_SOURCE_QUOTE_MAX_CHARACTERS
    ) {
      issues.push({
        severity: "error",
        code: "authoritative_field_exceeds_source_quote_capacity",
        path: `${issuePath}.${field}`,
        message: "content_verbatim이 source_quote 최대 길이를 넘어 일부 인용만으로 전체 원문을 인증할 수 없어 수동 검토로 격리했습니다.",
      });
      continue;
    }
    issues.push({
      severity: "error",
      code: "authoritative_field_not_grounded_in_source_quote",
      path: `${issuePath}.${field}`,
      message: `${field} 값이 source_quote가 한정한 원문 안에 그대로 존재하지 않아 자동 적재를 차단했습니다.`,
    });
  }
  const decodedSourceQuote = decodeEvidenceQuote(section.source_quote);
  const sourceQuotes = decodedSourceQuote.kind === "single"
    ? [decodedSourceQuote.quote]
    : decodedSourceQuote.kind === "merged"
      ? decodedSourceQuote.fragments.map((fragment) => fragment.quote)
      : [];
  const exactFormulaGroundsPricingBasis = section.section_type === "pricing_basis"
    && sourceQuotes.some((quote) =>
      quote.trim().startsWith("XLSX_FORMULA ")
      && matchSingleXlsxAuxiliaryEvidenceQuote(
        quote,
        evidence.xlsxAuxiliary ?? {},
      ).kind === "match"
    );
  if (
    !exactFormulaGroundsPricingBasis
    && !boundedEvidenceContainsAnyLabel(
      payloads,
      SECTION_TYPE_EVIDENCE_LABELS[section.section_type],
    )
  ) {
    requiresReview = true;
    issues.push({
      severity: "error",
      code: "semantic_type_not_grounded_in_source_quote",
      path: `${issuePath}.section_type`,
      message: "section_type을 뒷받침하는 명시적 유형 표지가 source_quote 안에 없어 자동 적재를 차단했습니다.",
    });
  }
  if (requiresReview) section.needs_review = true;
}

function validatePolicySemanticGrounding(
  policy: NonNullable<DisclosureExtraction["partner_vendors"][number]["policies"]>[number],
  issuePath: string,
  issues: ValidationIssue[],
  evidence?: ValidationEvidenceContext,
): boolean {
  if (!evidence) return false;
  const payloads = boundedEvidencePayloads(policy.source_quote);
  if (!payloads) return false;
  let requiresReview = false;
  if (!boundedEvidenceContainsField(payloads, policy.raw_text)) {
    requiresReview = true;
    const exceedsQuoteCapacity = normalizeEvidenceText(policy.raw_text).length
      > SECTION_AND_POLICY_SOURCE_QUOTE_MAX_CHARACTERS;
    issues.push(exceedsQuoteCapacity
      ? {
          severity: "error",
          code: "authoritative_field_exceeds_source_quote_capacity",
          path: `${issuePath}.raw_text`,
          message: "정책 raw_text가 source_quote 최대 길이를 넘어 일부 인용만으로 전체 원문을 인증할 수 없어 수동 검토로 격리했습니다.",
        }
      : {
          severity: "error",
          code: "authoritative_field_not_grounded_in_source_quote",
          path: `${issuePath}.raw_text`,
          message: "정책 raw_text가 source_quote가 한정한 원문 안에 그대로 존재하지 않아 자동 적재를 차단했습니다.",
        });
  }
  if (!boundedEvidenceContainsAnyLabel(
    payloads,
    POLICY_TYPE_EVIDENCE_LABELS[policy.policy_type],
  )) {
    requiresReview = true;
    issues.push({
      severity: "error",
      code: "semantic_type_not_grounded_in_source_quote",
      path: `${issuePath}.policy_type`,
      message: "policy_type을 뒷받침하는 명시적 유형 표지가 source_quote 안에 없어 자동 적재를 차단했습니다.",
    });
  }
  return requiresReview;
}

function validateOptionSemanticGrounding(
  option: DisclosureExtraction["agency_packages"][number]["options"][number],
  issuePath: string,
  issues: ValidationIssue[],
  evidence?: ValidationEvidenceContext,
): boolean {
  if (!evidence) return false;
  const payloads = boundedEvidencePayloads(option.source_quote);
  if (!payloads) return false;
  let requiresReview = false;
  const fields: Array<["name" | "raw_text" | "unit" | "condition", string]> = [
    ["name", option.name],
    ["raw_text", option.raw_text],
  ];
  if (option.unit !== null) fields.push(["unit", option.unit]);
  if (option.condition !== null) fields.push(["condition", option.condition]);
  for (const [field, value] of fields) {
    if (boundedEvidenceContainsField(payloads, value)) continue;
    requiresReview = true;
    issues.push({
      severity: "error",
      code: "authoritative_field_not_grounded_in_source_quote",
      path: `${issuePath}.${field}`,
      message: `${field} 값이 source_quote가 한정한 원문 안에 그대로 존재하지 않아 자동 적재를 차단했습니다.`,
    });
  }
  return requiresReview;
}

function validatePartnerVendorSemanticGrounding(
  vendor: DisclosureExtraction["partner_vendors"][number],
  issuePath: string,
  issues: ValidationIssue[],
  evidence?: ValidationEvidenceContext,
): void {
  if (!evidence) return;
  const payloads = boundedEvidencePayloads(vendor.source_quote);
  if (!payloads) return;
  const fields: Array<["vendor_name" | "base_spec" | "price_note", string]> = [
    ["vendor_name", vendor.vendor_name],
  ];
  if (vendor.base_spec !== null) fields.push(["base_spec", vendor.base_spec]);
  if (vendor.price_note !== null) fields.push(["price_note", vendor.price_note]);
  for (const [field, value] of fields) {
    if (boundedEvidenceContainsField(payloads, value)) continue;
    vendor.needs_review = true;
    issues.push({
      severity: "error",
      code: "authoritative_field_not_grounded_in_source_quote",
      path: `${issuePath}.${field}`,
      message: `${field} 값이 source_quote가 한정한 원문 안에 그대로 존재하지 않아 자동 적재를 차단했습니다.`,
    });
  }
  if (!boundedEvidenceContainsAnyLabel(
    payloads,
    PARTNER_CATEGORY_EVIDENCE_LABELS[vendor.category],
  )) {
    vendor.needs_review = true;
    issues.push({
      severity: "error",
      code: "semantic_type_not_grounded_in_source_quote",
      path: `${issuePath}.category`,
      message: "업체 category를 뒷받침하는 명시적 카테고리 표지가 source_quote 안에 없어 자동 적재를 차단했습니다.",
    });
  }
}

function validateAgencyPackageSemanticGrounding(
  agencyPackage: DisclosureExtraction["agency_packages"][number],
  issuePath: string,
  issues: ValidationIssue[],
  evidence?: ValidationEvidenceContext,
): void {
  if (!evidence) return;
  const payloads = boundedEvidencePayloads(agencyPackage.source_quote);
  if (!payloads) return;
  const fields: Array<["package_name" | "vat_note" | "price_note", string]> = [
    ["package_name", agencyPackage.package_name],
  ];
  if (agencyPackage.vat_note !== null) fields.push(["vat_note", agencyPackage.vat_note]);
  if (agencyPackage.price_note !== null) fields.push(["price_note", agencyPackage.price_note]);
  for (const [field, value] of fields) {
    if (boundedEvidenceContainsField(payloads, value)) continue;
    agencyPackage.needs_review = true;
    issues.push({
      severity: "error",
      code: "authoritative_field_not_grounded_in_source_quote",
      path: `${issuePath}.${field}`,
      message: `${field} 값이 source_quote가 한정한 원문 안에 그대로 존재하지 않아 자동 적재를 차단했습니다.`,
    });
  }
  agencyPackage.category_scope.forEach((category, categoryIndex) => {
    if (boundedEvidenceContainsAnyLabel(
      payloads,
      AGENCY_CATEGORY_EVIDENCE_LABELS[category],
    )) return;
    agencyPackage.needs_review = true;
    issues.push({
      severity: "error",
      code: "semantic_type_not_grounded_in_source_quote",
      path: `${issuePath}.category_scope[${categoryIndex}]`,
      message: "패키지 category_scope를 뒷받침하는 명시적 카테고리 표지가 source_quote 안에 없어 자동 적재를 차단했습니다.",
    });
  });
}

function validateLegacyHallItemSemanticGrounding(
  item: DisclosureExtraction["hall"]["items"][number],
  issuePath: string,
  issues: ValidationIssue[],
  evidence?: ValidationEvidenceContext,
): void {
  if (!evidence) return;
  const payloads = boundedEvidencePayloads(item.source_quote);
  if (!payloads) return;
  for (const [field, value] of [
    ["name", item.name],
    ["raw_text", item.raw_text],
  ] as const) {
    if (boundedEvidenceContainsField(payloads, value)) continue;
    item.needs_review = true;
    issues.push({
      severity: "error",
      code: "authoritative_field_not_grounded_in_source_quote",
      path: `${issuePath}.${field}`,
      message: `${field} 값이 source_quote가 한정한 원문 안에 그대로 존재하지 않아 자동 적재를 차단했습니다.`,
    });
  }
}

function validateMergedEvidenceQuote(
  quote: string,
  issuePath: string,
  issues: ValidationIssue[],
  evidence?: ValidationEvidenceContext,
): boolean {
  const decoded = decodeEvidenceQuote(quote);
  if (decoded.kind === "single") return false;
  if (decoded.kind === "invalid") {
    issues.push({
      severity: "error",
      code: "merged_source_quote_invalid",
      path: issuePath,
      message: `병합 source_quote 형식이 올바르지 않습니다: ${decoded.reason}`,
    });
    return true;
  }
  if (!evidence?.bySourceFileId || !evidence.referencedSourceFileIds) {
    issues.push({
      severity: "error",
      code: "merged_source_quote_evidence_missing",
      path: issuePath,
      message: "병합 source_quote의 조각별 원본을 검증할 수 없어 적재를 차단했습니다.",
    });
    return true;
  }
  const fragmentSourceIds = decoded.fragments.map((fragment) => fragment.source_file_id);
  if (!sameStringSet(fragmentSourceIds, evidence.referencedSourceFileIds)) {
    issues.push({
      severity: "error",
      code: "merged_source_quote_provenance_mismatch",
      path: issuePath,
      message: "병합 source_quote 조각의 source_file_id 집합이 행 provenance와 일치하지 않습니다.",
    });
    return true;
  }
  for (const fragment of decoded.fragments) {
    const source = evidence.bySourceFileId[fragment.source_file_id];
    if (!source) {
      issues.push({
        severity: "error",
        code: "merged_source_quote_provenance_mismatch",
        path: issuePath,
        message: "병합 source_quote가 현재 행에서 참조하지 않은 source_file_id를 포함합니다.",
      });
      continue;
    }
    if (evidenceContainsQuote(fragment.quote, source)) continue;
    const fragmentModality = recordSourceEvidenceModality(
      evidence.recordSourceModalities,
      issuePath,
      fragment.source_file_id,
    );
    const requiresVisualReview = source.hasImages && (
      fragmentModality === "image"
      || (fragmentModality === undefined && !source.normalizedText)
    );
    issues.push(requiresVisualReview
      ? {
          severity: "warning",
          code: "merged_source_quote_fragment_requires_visual_review",
          path: issuePath,
          message: "병합 source_quote 조각을 해당 이미지 원본에서 사람이 직접 대조해야 합니다.",
        }
      : {
          severity: "error",
          code: "merged_source_quote_fragment_not_found_in_referenced_source",
          path: issuePath,
          message: "병합 source_quote 조각이 선언된 source_file_id의 변환 원문에 존재하지 않습니다.",
        });
  }
  return true;
}

function validateRange(
  minimum: number | null,
  maximum: number | null,
  quote: string | null,
  issuePath: string,
  issues: ValidationIssue[],
  checkBaseSanity: boolean,
  evidence?: ValidationEvidenceContext,
): void {
  if (minimum !== null && maximum !== null && minimum > maximum) {
    issues.push({
      severity: "error",
      code: "price_min_gt_max",
      path: issuePath,
      message: `최솟값 ${minimum}원이 최댓값 ${maximum}원보다 큽니다.`,
    });
  }
  const values = [minimum, maximum].filter((value): value is number => value !== null);
  if (values.length > 0 && !quote) {
    issues.push({
      severity: "error",
      code: "missing_source_quote",
      path: issuePath,
      message: "가격값에 대응하는 source_quote가 없습니다.",
    });
  }
  if (checkBaseSanity && values.some((value) => value < BASE_PRICE_MIN_KRW || value > BASE_PRICE_MAX_KRW)) {
    issues.push({
      severity: "warning",
      code: "base_price_out_of_sanity_range",
      path: issuePath,
      message: "기본가가 100,000원~30,000,000원 범위 밖이므로 사람 검토가 필요합니다.",
    });
  }
  if (quote && values.length > 0) {
    const quotedAmounts = parseKoreanMoneyAmounts(quote);
    if (quotedAmounts.length === 0) {
      issues.push({
        severity: "warning",
        code: "price_source_quote_unparseable",
        path: issuePath,
        message: "가격 숫자를 source_quote에서 보수적으로 해석할 수 없어 사람 검토가 필요합니다.",
      });
    } else if (!values.every((value) => quotedAmounts.includes(value))) {
      issues.push({
        severity: "warning",
        code: "price_source_quote_mismatch",
        path: issuePath,
        message: "정규화 금액이 source_quote에서 결정적으로 확인되지 않습니다.",
      });
    }

    const mergedEvidenceHandled = validateMergedEvidenceQuote(quote, issuePath, issues, evidence);
    if (evidence && !mergedEvidenceHandled) {
      if (!evidenceContainsQuote(quote, evidence)) {
        issues.push(evidence.hasImages
          ? {
              severity: "warning",
              code: "source_quote_requires_visual_review",
              path: issuePath,
              message: "source_quote를 변환 텍스트에서 찾지 못했습니다. 이미지/PDF 원본을 사람이 직접 대조해야 합니다.",
            }
          : {
              severity: "error",
              code: evidence.sourceScoped
                ? "source_quote_not_found_in_referenced_source"
                : "source_quote_not_found_in_text",
              path: issuePath,
              message: "source_quote가 변환된 원문 텍스트에 존재하지 않아 적재를 차단했습니다.",
            });
      }
    }
  }
}

function validateEvidenceQuote(
  quote: string,
  issuePath: string,
  issues: ValidationIssue[],
  evidence?: ValidationEvidenceContext,
): void {
  if (validateMergedEvidenceQuote(quote, issuePath, issues, evidence)) return;
  if (!evidence) return;
  if (evidenceContainsQuote(quote, evidence)) return;
  issues.push(evidence.hasImages
    ? {
        severity: "warning",
        code: "source_quote_requires_visual_review",
        path: issuePath,
        message: "source_quote를 변환 텍스트에서 찾지 못했습니다. 이미지/PDF 원본을 사람이 직접 대조해야 합니다.",
      }
    : {
        severity: "error",
        code: evidence.sourceScoped
          ? "source_quote_not_found_in_referenced_source"
          : "source_quote_not_found_in_text",
        path: issuePath,
        message: "source_quote가 변환된 원문 텍스트에 존재하지 않아 적재를 차단했습니다.",
  });
}

function validateMoneyOccurrenceQuote(
  quote: string,
  rawText: string,
  issuePath: string,
  issues: ValidationIssue[],
  evidence?: ValidationEvidenceContext,
): boolean {
  let requiresReview = false;
  if (evidence) {
    const payloads = boundedEvidencePayloads(quote);
    if (payloads && !boundedEvidenceContainsField(payloads, rawText)) {
      requiresReview = true;
      issues.push({
        severity: "error",
        code: "authoritative_field_not_grounded_in_source_quote",
        path: `${issuePath}.raw_text`,
        message: "금액 발생 raw_text가 source_quote가 한정한 원문 안에 그대로 존재하지 않아 자동 적재를 차단했습니다.",
      });
    }
  }
  if (!evidence) return requiresReview;
  const normalizedQuote = normalizeEvidenceText(quote);
  if (evidenceContainsQuote(quote, evidence)) return requiresReview;
  if (looksLikeXlsxAuxiliaryEvidence(quote)) {
    validateEvidenceQuote(quote, issuePath, issues, evidence);
    return requiresReview;
  }
  const located = /^(.+![A-Z]+\d+):\s*(.+)$/iu.exec(normalizedQuote);
  if (located) {
    const locator = normalizeEvidenceText(located[1]);
    const raw = normalizeEvidenceText(rawText);
    const locatorIndex = evidence.normalizedText.indexOf(`${locator}:`);
    const rawIndex = locatorIndex < 0 ? -1 : evidence.normalizedText.indexOf(raw, locatorIndex + locator.length + 1);
    const nextCell = rawIndex < 0
      ? -1
      : evidence.normalizedText.slice(locatorIndex + locator.length + 1, rawIndex).search(
        /(?:^|\s).+![A-Z]+\d+:/u,
      );
    if (locatorIndex >= 0 && rawIndex >= 0 && nextCell < 0) return requiresReview;
  }
  validateEvidenceQuote(quote, issuePath, issues, evidence);
  return requiresReview;
}

function resolveRowEvidence(
  unit: ManifestUnit,
  sourceIds: string[] | undefined,
  issuePath: string,
  issues: ValidationIssue[],
  evidence: ValidationEvidenceContext | undefined,
): { sourceIds: string[]; evidence: ValidationEvidenceContext | undefined } {
  const allowedIds = new Set(unit.source_files.map(sourceFileId));
  const resolvedIds = sourceIds && sourceIds.length > 0
    ? [...sourceIds]
    : unit.source_files.length === 1
      ? [sourceFileId(unit.source_files[0])]
      : [];
  if (resolvedIds.length === 0) {
    issues.push({
      severity: "error",
      code: "missing_source_file_provenance",
      path: issuePath,
      message: "여러 원본 파일 중 이 가격 행을 직접 뒷받침하는 source_file_id가 없어 적재를 차단합니다.",
    });
    return { sourceIds: [], evidence: undefined };
  }
  if (new Set(resolvedIds).size !== resolvedIds.length) {
    issues.push({
      severity: "error",
      code: "duplicate_source_file_provenance",
      path: issuePath,
      message: "같은 source_file_id가 중복되어 적재를 차단합니다.",
    });
  }
  const unknown = resolvedIds.filter((id) => !allowedIds.has(id));
  if (unknown.length > 0) {
    issues.push({
      severity: "error",
      code: "unknown_source_file_provenance",
      path: issuePath,
      message: "현재 unit에 속하지 않는 source_file_id가 있어 적재를 차단합니다.",
    });
    return { sourceIds: resolvedIds, evidence: undefined };
  }
  if (!evidence?.bySourceFileId) {
    return {
      sourceIds: resolvedIds,
      evidence: evidence ? scopeEvidenceToRecord(evidence, issuePath) : undefined,
    };
  }
  const referenced = resolvedIds
    .map((id) => evidence.bySourceFileId?.[id])
    .filter((value): value is {
      normalizedText: string;
      hasImages: boolean;
      xlsxCells?: XlsxCellEvidenceIndex;
      xlsxAuxiliary?: XlsxAuxiliaryEvidenceIndex;
      lineEvidence?: Record<string, string[]>;
    } => value !== undefined);
  if (referenced.length !== resolvedIds.length) {
    issues.push({
      severity: "error",
      code: "source_file_evidence_missing",
      path: issuePath,
      message: "참조한 source_file_id의 변환 증거를 찾을 수 없어 적재를 차단합니다.",
    });
    return { sourceIds: resolvedIds, evidence: undefined };
  }
  return {
    sourceIds: resolvedIds,
    evidence: scopeEvidenceToRecord({
      normalizedText: referenced.map((value) => value.normalizedText).filter(Boolean).join(" "),
      hasImages: referenced.some((value) => value.hasImages),
      xlsxCells: referenced.reduce<XlsxCellEvidenceIndex>((result, value) => {
        for (const [locator, candidates] of Object.entries(value.xlsxCells ?? {})) {
          result[locator] = [...new Set([...(result[locator] ?? []), ...candidates])];
        }
        return result;
      }, {}),
      xlsxAuxiliary: referenced.reduce<XlsxAuxiliaryEvidenceIndex>((result, value) => {
        for (const [locator, candidates] of Object.entries(value.xlsxAuxiliary ?? {})) {
          result[locator] = [...new Set([...(result[locator] ?? []), ...candidates])];
        }
        return result;
      }, {}),
      lineEvidence: referenced.reduce<Record<string, string[]>>((result, value) => {
        for (const [locator, candidates] of Object.entries(value.lineEvidence ?? {})) {
          result[locator] = [...new Set([...(result[locator] ?? []), ...candidates])];
        }
        return result;
      }, {}),
      bySourceFileId: Object.fromEntries(resolvedIds.map((id, index) => [id, referenced[index]])),
      sourceScoped: true,
      referencedSourceFileIds: resolvedIds,
      recordModalities: evidence.recordModalities,
      recordSourceModalities: evidence.recordSourceModalities,
    }, issuePath),
  };
}

function hasHallPayload(data: DisclosureExtraction): boolean {
  return (data.halls?.length ?? 0) > 0
    || data.hall.venue_fee_krw !== null
    || data.hall.meal_price_min_krw !== null
    || data.hall.meal_price_max_krw !== null
    || data.hall.items.length > 0;
}

function hasAnyPriceValue(data: DisclosureExtraction): boolean {
  const optionHasPrice = (options: DisclosureExtraction["agency_packages"][number]["options"]): boolean =>
    options.some((option) => option.price_min_krw !== null || option.price_max_krw !== null);
  return data.agency_packages.some((item) =>
    item.price_min_krw !== null || item.price_max_krw !== null || optionHasPrice(item.options)
  ) || data.partner_vendors.some((item) =>
    item.price_min_krw !== null || item.price_max_krw !== null || optionHasPrice(item.options)
  ) || (data.halls ?? []).some((hall) =>
    hall.meal_price_min_krw !== null
    || hall.meal_price_max_krw !== null
    || hall.venue_fee_min_krw !== null
    || hall.venue_fee_max_krw !== null
    || hall.decoration_fee_min_krw !== null
    || hall.decoration_fee_max_krw !== null
    || optionHasPrice(hall.options)
  ) || data.hall.venue_fee_krw !== null
    || data.hall.meal_price_min_krw !== null
    || data.hall.meal_price_max_krw !== null
    || data.hall.items.some((item) => item.price_min_krw !== null || item.price_max_krw !== null);
}

function hasReviewableDisclosureSemantics(data: DisclosureExtraction): boolean {
  return (data.sections?.length ?? 0) > 0
    || data.partner_vendors.some((vendor) => (vendor.policies?.length ?? 0) > 0);
}

function hasConflictingAgencyPackageRows(data: DisclosureExtraction): boolean {
  const rows = new Map<string, Set<string>>();
  for (const item of data.agency_packages) {
    const identity = item.package_name.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
    const variants = rows.get(identity) ?? new Set<string>();
    variants.add(JSON.stringify({
      category_scope: item.category_scope,
      price_min_krw: item.price_min_krw,
      price_max_krw: item.price_max_krw,
      vat_note: item.vat_note,
      price_note: item.price_note,
      options: item.options,
      source_quote: item.source_quote,
    }));
    rows.set(identity, variants);
  }
  return [...rows.values()].some((variants) => variants.size > 1);
}

function publicContactFields(data: DisclosureExtraction): Array<{ path: string; value: string }> {
  const fields: Array<{ path: string; value: string }> = [];
  const add = (path: string, value: string | null | undefined): void => {
    if (value && PUBLIC_CONTACT_PATTERN.test(value)) fields.push({ path, value });
  };
  data.agency_packages.forEach((item, index) => {
    add(`agency_packages[${index}].package_name`, item.package_name);
    add(`agency_packages[${index}].vat_note`, item.vat_note);
    add(`agency_packages[${index}].price_note`, item.price_note);
    add(`agency_packages[${index}].source_quote`, item.source_quote);
    item.options.forEach((option, optionIndex) => {
      const path = `agency_packages[${index}].options[${optionIndex}]`;
      add(`${path}.name`, option.name);
      add(`${path}.condition`, option.condition);
      add(`${path}.raw_text`, option.raw_text);
      add(`${path}.source_quote`, option.source_quote);
    });
  });
  (data.halls ?? []).forEach((hall, index) => {
    const path = `halls[${index}]`;
    add(`${path}.hall_name`, hall.hall_name);
    add(`${path}.venue_fee_note`, hall.venue_fee_note);
    add(`${path}.decoration_note`, hall.decoration_note);
    add(`${path}.source_quote`, hall.source_quote);
    hall.options.forEach((option, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      add(`${optionPath}.name`, option.name);
      add(`${optionPath}.condition`, option.condition);
      add(`${optionPath}.raw_text`, option.raw_text);
      add(`${optionPath}.source_quote`, option.source_quote);
    });
  });
  (data.sections ?? []).forEach((section, index) => {
    const path = `sections[${index}]`;
    add(`${path}.title`, section.title);
    add(`${path}.content_verbatim`, section.content_verbatim);
    add(`${path}.summary`, section.summary);
    add(`${path}.source_quote`, section.source_quote);
  });
  data.partner_vendors.forEach((item, index) => {
    add(`partner_vendors[${index}].vendor_name`, item.vendor_name);
    add(`partner_vendors[${index}].base_spec`, item.base_spec);
    add(`partner_vendors[${index}].price_note`, item.price_note);
    add(`partner_vendors[${index}].source_quote`, item.source_quote);
    item.options.forEach((option, optionIndex) => {
      const path = `partner_vendors[${index}].options[${optionIndex}]`;
      add(`${path}.name`, option.name);
      add(`${path}.condition`, option.condition);
      add(`${path}.raw_text`, option.raw_text);
      add(`${path}.source_quote`, option.source_quote);
    });
    (item.policies ?? []).forEach((policy, policyIndex) => {
      const path = `partner_vendors[${index}].policies[${policyIndex}]`;
      add(`${path}.raw_text`, policy.raw_text);
      add(`${path}.source_quote`, policy.source_quote);
    });
  });
  add("hall.venue_fee_source_quote", data.hall.venue_fee_source_quote);
  add("hall.meal_price_source_quote", data.hall.meal_price_source_quote);
  data.hall.items.forEach((item, index) => {
    add(`hall.items[${index}].name`, item.name);
    add(`hall.items[${index}].raw_text`, item.raw_text);
    add(`hall.items[${index}].source_quote`, item.source_quote);
  });
  return fields;
}

export function validateExtractionForUnit(
  unit: ManifestUnit,
  data: DisclosureExtraction,
  evidence?: ValidationEvidenceContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (data.doc_kind === "unknown") {
    issues.push({
      severity: "error",
      code: "unknown_document_kind",
      path: "doc_kind",
      message: "문서 유형을 확인하지 못해 staging 적재를 차단했습니다.",
    });
  }
  const hasAgencyPayload = data.agency_packages.length > 0;
  const hasPartnerPayload = data.partner_vendors.length > 0;
  const hallPayload = hasHallPayload(data);
  const hasDocumentPayloadConflict =
    (data.doc_kind === "agency_disclosure" && (hasPartnerPayload || hallPayload))
    || (data.doc_kind === "partner_price_list" && (hasAgencyPayload || hallPayload))
    || (data.doc_kind === "hall_disclosure" && (hasAgencyPayload || hasPartnerPayload));
  if (hasDocumentPayloadConflict) {
    issues.push({
      severity: "error",
      code: "document_payload_conflict",
      path: "doc_kind",
      message: "문서 유형과 추출 payload가 충돌해 자동 적재를 차단했습니다. mixed 여부를 사람이 확인해야 합니다.",
    });
  }
  if (!hasAnyPriceValue(data) && !hasReviewableDisclosureSemantics(data)) {
    issues.push({
      severity: "error",
      code: "no_price_records",
      path: "data",
      message: "적재 가능한 가격 값이 하나도 없어 사람 검토 전까지 staging 적재를 차단했습니다.",
    });
  }
  for (const field of publicContactFields(data)) {
    issues.push({
      severity: "error",
      code: "public_field_contains_contact_data",
      path: field.path,
      message: "공개 가격 필드에 전화번호 또는 이메일 주소가 포함되어 적재를 차단합니다. 원문은 private 원본에서만 검토하세요.",
    });
  }
  if (hasConflictingAgencyPackageRows(data)) {
    issues.push({
      severity: "error",
      code: "conflicting_agency_package_prices",
      path: "agency_packages",
      message: "같은 패키지 이름에 서로 다른 가격·옵션 행이 있어 어느 한쪽도 자동 선택하지 않습니다.",
    });
  }
  if (findPartnerVendorIdentityConflicts(
    buildPartnerVendorRecords(unit.unit_id, unit.parsed.region_code, data.partner_vendors),
  ).length > 0) {
    issues.push({
      severity: "error",
      code: "conflicting_partner_vendor_prices",
      path: "partner_vendors",
      message: "같은 지역·카테고리의 동일 정규화 업체명에 서로 다른 가격·구성 행이 있어 자동 적재를 차단했습니다.",
    });
  }
  if (
    (
      unit.parsed.kind_hint === "hall"
      && (
        ["agency_disclosure", "partner_price_list"].includes(data.doc_kind)
        || hasAgencyPayload
        || hasPartnerPayload
      )
    )
    || (
      unit.parsed.kind_hint === "agency"
      && (data.doc_kind === "hall_disclosure" || hallPayload)
    )
  ) {
    issues.push({
      severity: "error",
      code: "document_kind_conflict",
      path: "doc_kind",
      message: `폴더 힌트(${unit.parsed.kind_hint})와 문서 분류(${data.doc_kind})가 충돌합니다.`,
    });
  }
  if (data.business_name && ![
    unit.parsed.raw_name,
    unit.parsed.corporate_name,
  ].filter((value): value is string => Boolean(value)).some((value) =>
    normalizeVendorName(data.business_name ?? "") === normalizeVendorName(value)
  )) {
    issues.push({
      severity: "error",
      code: "business_name_conflict",
      path: "business_name",
      message: `문서의 상호(${data.business_name})가 스캔에서 확정한 업체명(${unit.parsed.raw_name})과 달라 수동 확인 전까지 적재를 차단합니다.`,
    });
  }
  if (data.region_hint) {
    const documentRegion = regionCodeFromDirectory(data.region_hint);
    if (documentRegion !== "unknown" && documentRegion !== unit.parsed.region_code) {
      issues.push({
        severity: "warning",
        code: "region_mismatch",
        path: "region_hint",
        message: `폴더 지역(${unit.parsed.region_code})과 문서 지역(${documentRegion})이 다릅니다.`,
      });
    }
  }

  data.agency_packages.forEach((item, index) => {
    const itemPath = `agency_packages[${index}]`;
    const itemProvenance = resolveRowEvidence(unit, item.source_file_ids, itemPath, issues, evidence);
    item.source_file_ids = itemProvenance.sourceIds;
    validateRange(item.price_min_krw, item.price_max_krw, item.source_quote, itemPath, issues, true, itemProvenance.evidence);
    validateAgencyPackageSemanticGrounding(item, itemPath, issues, itemProvenance.evidence);
    item.options.forEach((option, optionIndex) => {
      const optionPath = `${itemPath}.options[${optionIndex}]`;
      const optionProvenance = resolveRowEvidence(unit, option.source_file_ids, optionPath, issues, evidence);
      option.source_file_ids = optionProvenance.sourceIds;
      validateRange(option.price_min_krw, option.price_max_krw, option.source_quote, optionPath, issues, false, optionProvenance.evidence);
      if (validateOptionSemanticGrounding(
        option,
        optionPath,
        issues,
        optionProvenance.evidence,
      )) {
        item.needs_review = true;
      }
    });
    if (item.needs_review || item.confidence < 0.8) {
      issues.push({ severity: "warning", code: "low_confidence", path: `agency_packages[${index}]`, message: "추출 신뢰도가 낮거나 모델이 검토를 요청했습니다." });
    }
  });
  data.partner_vendors.forEach((item, index) => {
    const itemPath = `partner_vendors[${index}]`;
    const itemProvenance = resolveRowEvidence(unit, item.source_file_ids, itemPath, issues, evidence);
    item.source_file_ids = itemProvenance.sourceIds;
    validateRange(item.price_min_krw, item.price_max_krw, item.source_quote, itemPath, issues, true, itemProvenance.evidence);
    validatePartnerVendorSemanticGrounding(item, itemPath, issues, itemProvenance.evidence);
    item.options.forEach((option, optionIndex) => {
      const optionPath = `${itemPath}.options[${optionIndex}]`;
      const optionProvenance = resolveRowEvidence(unit, option.source_file_ids, optionPath, issues, evidence);
      option.source_file_ids = optionProvenance.sourceIds;
      validateRange(option.price_min_krw, option.price_max_krw, option.source_quote, optionPath, issues, false, optionProvenance.evidence);
      if (validateOptionSemanticGrounding(
        option,
        optionPath,
        issues,
        optionProvenance.evidence,
      )) {
        item.needs_review = true;
      }
    });
    (item.policies ?? []).forEach((policy, policyIndex) => {
      const policyPath = `${itemPath}.policies[${policyIndex}]`;
      const policyProvenance = resolveRowEvidence(unit, policy.source_file_ids, policyPath, issues, evidence);
      policy.source_file_ids = policyProvenance.sourceIds;
      validateEvidenceQuote(policy.source_quote, policyPath, issues, policyProvenance.evidence);
      if (validatePolicySemanticGrounding(
        policy,
        policyPath,
        issues,
        policyProvenance.evidence,
      )) {
        item.needs_review = true;
      }
    });
    if (item.needs_review || item.confidence < 0.8) {
      issues.push({ severity: "warning", code: "low_confidence", path: `partner_vendors[${index}]`, message: "추출 신뢰도가 낮거나 모델이 검토를 요청했습니다." });
    }
  });
  (data.halls ?? []).forEach((hall, index) => {
    const hallPath = `halls[${index}]`;
    const hallProvenance = resolveRowEvidence(unit, hall.source_file_ids, hallPath, issues, evidence);
    hall.source_file_ids = hallProvenance.sourceIds;
    validateRange(
      hall.venue_fee_min_krw,
      hall.venue_fee_max_krw,
      hall.source_quote,
      `${hallPath}.venue_fee`,
      issues,
      true,
      hallProvenance.evidence,
    );
    validateRange(
      hall.meal_price_min_krw,
      hall.meal_price_max_krw,
      hall.source_quote,
      `${hallPath}.meal_price`,
      issues,
      false,
      hallProvenance.evidence,
    );
    validateRange(
      hall.decoration_fee_min_krw,
      hall.decoration_fee_max_krw,
      hall.source_quote,
      `${hallPath}.decoration_fee`,
      issues,
      false,
      hallProvenance.evidence,
    );
    hall.options.forEach((option, optionIndex) => {
      const optionPath = `${hallPath}.options[${optionIndex}]`;
      const optionProvenance = resolveRowEvidence(unit, option.source_file_ids, optionPath, issues, evidence);
      option.source_file_ids = optionProvenance.sourceIds;
      validateRange(
        option.price_min_krw,
        option.price_max_krw,
        option.source_quote,
        optionPath,
        issues,
        false,
        optionProvenance.evidence,
      );
      if (validateOptionSemanticGrounding(
        option,
        optionPath,
        issues,
        optionProvenance.evidence,
      )) {
        hall.needs_review = true;
      }
    });
    if (hall.needs_review || hall.confidence < 0.8) {
      issues.push({ severity: "warning", code: "low_confidence", path: hallPath, message: "추출 신뢰도가 낮거나 모델이 검토를 요청했습니다." });
    }
  });
  (data.sections ?? []).forEach((section, index) => {
    const sectionPath = `sections[${index}]`;
    const sectionProvenance = resolveRowEvidence(unit, section.source_file_ids, sectionPath, issues, evidence);
    section.source_file_ids = sectionProvenance.sourceIds;
    validateEvidenceQuote(section.source_quote, sectionPath, issues, sectionProvenance.evidence);
    validateSectionSemanticGrounding(section, sectionPath, issues, sectionProvenance.evidence);
    if (section.needs_review || section.confidence < 0.8) {
      issues.push({ severity: "warning", code: "low_confidence", path: sectionPath, message: "추출 신뢰도가 낮거나 모델이 검토를 요청했습니다." });
    }
  });
  (data.money_occurrences ?? []).forEach((occurrence, index) => {
    const occurrencePath = `money_occurrences[${index}]`;
    const occurrenceProvenance = resolveRowEvidence(
      unit,
      occurrence.source_file_ids,
      occurrencePath,
      issues,
      evidence,
    );
    occurrence.source_file_ids = occurrenceProvenance.sourceIds;
    if (validateMoneyOccurrenceQuote(
      occurrence.source_quote,
      occurrence.raw_text,
      occurrencePath,
      issues,
      occurrenceProvenance.evidence,
    )) {
      occurrence.needs_review = true;
    }
    if (occurrence.needs_review) {
      issues.push({ severity: "warning", code: "low_confidence", path: occurrencePath, message: "금액 발생의 판독을 모델이 검토 요청했습니다." });
    }
  });
  if (data.hall.venue_fee_krw !== null) {
    const venueProvenance = resolveRowEvidence(unit, data.hall.venue_fee_source_file_ids, "hall.venue_fee_krw", issues, evidence);
    data.hall.venue_fee_source_file_ids = venueProvenance.sourceIds;
    validateRange(data.hall.venue_fee_krw, data.hall.venue_fee_krw, data.hall.venue_fee_source_quote, "hall.venue_fee_krw", issues, true, venueProvenance.evidence);
  }
  if (data.hall.meal_price_min_krw !== null || data.hall.meal_price_max_krw !== null) {
    const mealProvenance = resolveRowEvidence(unit, data.hall.meal_price_source_file_ids, "hall.meal_price", issues, evidence);
    data.hall.meal_price_source_file_ids = mealProvenance.sourceIds;
    validateRange(data.hall.meal_price_min_krw, data.hall.meal_price_max_krw, data.hall.meal_price_source_quote, "hall.meal_price", issues, false, mealProvenance.evidence);
  }
  data.hall.items.forEach((item, index) => {
    const itemPath = `hall.items[${index}]`;
    const itemProvenance = resolveRowEvidence(unit, item.source_file_ids, itemPath, issues, evidence);
    item.source_file_ids = itemProvenance.sourceIds;
    validateRange(item.price_min_krw, item.price_max_krw, item.source_quote, itemPath, issues, false, itemProvenance.evidence);
    validateLegacyHallItemSemanticGrounding(item, itemPath, issues, itemProvenance.evidence);
    if (item.needs_review || item.confidence < 0.8) {
      issues.push({ severity: "warning", code: "low_confidence", path: `hall.items[${index}]`, message: "추출 신뢰도가 낮거나 모델이 검토를 요청했습니다." });
    }
  });
  return issues;
}

function trigramSet(value: string): Set<string> {
  const padded = value.length < 3 ? value : value;
  const trigrams = new Set<string>();
  if (padded.length < 3) {
    if (padded) trigrams.add(padded);
    return trigrams;
  }
  for (let index = 0; index <= padded.length - 3; index += 1) {
    trigrams.add(padded.slice(index, index + 3));
  }
  return trigrams;
}

export function trigramSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const leftSet = trigramSet(left);
  const rightSet = trigramSet(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let overlap = 0;
  for (const trigram of leftSet) if (rightSet.has(trigram)) overlap += 1;
  return (2 * overlap) / (leftSet.size + rightSet.size);
}

export async function verifyValidationInputsUnchanged(
  unit: ManifestUnit,
  manifest: IngestManifest,
): Promise<void> {
  const conversion = unit.conversion;
  if (
    !conversion
    || conversion.source_fingerprint !== unit.source_fingerprint
    || manifest.scanner_parser_version !== SCANNER_PARSER_VERSION
    || (conversion.converter_version ?? "v1-legacy") !== CONVERTER_VERSION
  ) {
    throw new Error("validation_input_version_mismatch");
  }
  for (const source of unit.source_files) {
    const digest = await sha256File(source.absolute_path);
    if (digest.sha256 !== source.sha256 || digest.bytes !== source.bytes) {
      throw new Error(`validation_source_changed:${source.path}`);
    }
  }
  const records = await Promise.all(
    [...conversion.text_artifacts, ...conversion.image_artifacts]
      .sort((left, right) => left.localeCompare(right, "en"))
      .map(async (artifactPath) => {
        const digest = await sha256File(artifactPath);
        return `${path.resolve(artifactPath)}\0${digest.sha256}`;
      }),
  );
  if (sha256Text(records.join("\n")) !== conversion.artifact_fingerprint) {
    throw new Error("validation_conversion_artifact_changed");
  }
}

async function readStrictExtractionForValidation(
  unit: ManifestUnit,
  manifest: IngestManifest,
  stateDir: string,
): Promise<ReturnType<typeof StrictExtractionArtifactSchema.parse>> {
  const metadata = unit.extraction;
  const conversion = unit.conversion;
  if (!metadata || !conversion) throw new Error("validation_extraction_metadata_missing");
  const converterVersion = conversion.converter_version ?? "v1-legacy";
  const expectedFingerprint = currentExtractionFingerprint({
    scannerParserVersion: manifest.scanner_parser_version,
    converterVersion,
    model: metadata.model,
    rawName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    sourceFingerprint: unit.source_fingerprint,
    artifactFingerprint: conversion.artifact_fingerprint,
  });
  if (
    metadata.fingerprint !== expectedFingerprint
    || metadata.prompt_version !== EXTRACTION_PROMPT_VERSION
    || metadata.prompt_hash !== EXTRACTION_PROMPT_HASH
    || metadata.processing_version !== EXTRACTION_PROCESSING_VERSION
    || metadata.scanner_parser_version !== manifest.scanner_parser_version
    || metadata.converter_version !== converterVersion
    || !metadata.content_sha256
  ) {
    throw new Error("validation_extraction_manifest_identity_mismatch");
  }
  await verifyDeterministicStateArtifactPath({
    stateDir,
    artifactPath: metadata.artifact_path,
    expectedRelativePath: path.join(".cache", "extract", `${expectedFingerprint}.json`),
  });
  const raw = await readJsonFile(metadata.artifact_path);
  const parsed = StrictExtractionArtifactSchema.safeParse(raw);
  if (!parsed.success) throw new Error("validation_extraction_artifact_schema_invalid");
  verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
  const artifact = parsed.data;
  if (
    artifact.content_sha256 !== metadata.content_sha256
    || artifact.unit_id !== unit.unit_id
    || artifact.fingerprint !== expectedFingerprint
    || artifact.source_fingerprint !== unit.source_fingerprint
    || artifact.artifact_fingerprint !== conversion.artifact_fingerprint
    || artifact.prompt_version !== EXTRACTION_PROMPT_VERSION
    || artifact.prompt_hash !== EXTRACTION_PROMPT_HASH
    || artifact.processing_version !== EXTRACTION_PROCESSING_VERSION
    || artifact.scanner_parser_version !== manifest.scanner_parser_version
    || artifact.converter_version !== converterVersion
    || artifact.model !== metadata.model
  ) {
    throw new Error("validation_extraction_artifact_identity_mismatch");
  }
  return artifact;
}

async function readExistingValidated(
  filePath: string,
  expected: {
    stateDir: string;
    fingerprint: string;
    unitId: string;
    sourceFingerprint: string;
    extractionFingerprint: string;
    extractionContentSha256: string;
    promptVersion: string;
    promptHash: string;
    model: "gpt-5.6-luna" | "gpt-5.6-terra";
    sourceFiles: StrictValidatedArtifact["source_files"];
  },
): Promise<StrictValidatedArtifact | null> {
  try {
    await verifyDeterministicStateArtifactPath({
      stateDir: expected.stateDir,
      artifactPath: filePath,
      expectedRelativePath: path.join("validated", `${expected.unitId}.json`),
    });
    const raw = await readJsonFile(filePath);
    const parsed = StrictValidatedArtifactSchema.safeParse(raw);
    if (!parsed.success) return null;
    try {
      verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
    } catch {
      return null;
    }
    const artifact = parsed.data;
    const contentFingerprint = validatedArtifactFingerprint(
      artifact.extraction_fingerprint,
      artifact.data,
      artifact.issues,
      artifact.coverage_gaps,
    );
    return artifact.fingerprint === expected.fingerprint
        && contentFingerprint === expected.fingerprint
        && artifact.unit_id === expected.unitId
        && artifact.source_fingerprint === expected.sourceFingerprint
        && artifact.extraction_fingerprint === expected.extractionFingerprint
        && artifact.extraction_content_sha256 === expected.extractionContentSha256
        && artifact.prompt_version === expected.promptVersion
        && artifact.prompt_hash === expected.promptHash
        && artifact.model === expected.model
        && JSON.stringify(artifact.source_files) === JSON.stringify(expected.sourceFiles)
      ? artifact
      : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export interface DerivedValidatedPayload {
  data: DisclosureExtraction;
  issues: ValidationIssue[];
  coverageGaps: CoverageGap[];
}

/** Rebuild the exact payload validation is allowed to persist. */
export async function deriveValidatedPayloadForUnit(
  unit: ManifestUnit,
  extraction: Pick<
    ReturnType<typeof StrictExtractionArtifactSchema.parse>,
    "data" | "evidence_modalities"
  >,
): Promise<DerivedValidatedPayload> {
  const data = DisclosureExtractionSchema.parse(structuredClone(extraction.data));
  const textArtifacts = unit.conversion?.text_artifacts ?? [];
  const evidenceBySource = new Map(unit.source_files.map((source) => [
    sourceFileId(source),
    { text: [] as Array<{ value: string; lineOffset: number }>, hasImages: false },
  ]));
  const textArtifactContents: Array<{ artifactPath: string; text: string; lineOffset: number }> = [];
  let lineOffset = 0;
  for (const artifactPath of textArtifacts) {
    const text = await readFile(artifactPath, "utf8");
    textArtifactContents.push({ artifactPath, text, lineOffset });
    lineOffset += text.split(/\r?\n/u).length;
  }
  for (const artifact of textArtifactContents) {
    for (const source of sourceFilesForArtifact(unit, artifact.artifactPath)) {
      evidenceBySource.get(sourceFileId(source))?.text.push({
        value: artifact.text,
        lineOffset: artifact.lineOffset,
      });
    }
  }
  for (const artifactPath of unit.conversion?.image_artifacts ?? []) {
    for (const source of sourceFilesForArtifact(unit, artifactPath)) {
      const sourceEvidence = evidenceBySource.get(sourceFileId(source));
      if (sourceEvidence) sourceEvidence.hasImages = true;
    }
  }
  const sourceText = textArtifactContents.map((artifact) => artifact.text).join("\n");
  const evidence: ValidationEvidenceContext = {
    normalizedText: normalizeEvidenceText(sourceText),
    xlsxCells: indexXlsxCellEvidence(sourceText),
    xlsxAuxiliary: indexXlsxAuxiliaryEvidence(sourceText),
    lineEvidence: indexLineEvidence(sourceText),
    hasImages: (unit.conversion?.image_artifacts.length ?? 0) > 0,
    recordModalities: Object.fromEntries(
      (extraction.evidence_modalities ?? [])
        .filter((entry) => entry.source_file_id === undefined)
        .map((entry) => [entry.path, entry.modality]),
    ),
    recordSourceModalities: (extraction.evidence_modalities ?? []).reduce<
      Record<string, Record<string, "text" | "image" | "mixed">>
    >((result, entry) => {
      if (!entry.source_file_id) return result;
      result[entry.path] = {
        ...(result[entry.path] ?? {}),
        [entry.source_file_id]: entry.modality,
      };
      return result;
    }, {}),
    bySourceFileId: Object.fromEntries([...evidenceBySource.entries()].map(([id, value]) => [
      id,
      {
        normalizedText: normalizeEvidenceText(value.text.map((entry) => entry.value).join("\n")),
        xlsxCells: indexXlsxCellEvidence(value.text.map((entry) => entry.value).join("\n")),
        xlsxAuxiliary: indexXlsxAuxiliaryEvidence(value.text.map((entry) => entry.value).join("\n")),
        lineEvidence: Object.assign(
          {},
          ...value.text.map((entry) => indexLineEvidence(entry.value, entry.lineOffset)),
        ),
        hasImages: value.hasImages,
      },
    ])),
  };
  const issues = validateExtractionForUnit(unit, data, evidence);
  issues.push(...validateStructuredRecordSourceLinkage(data, sourceText).map((issue) => {
    const modality = recordEvidenceModality(evidence.recordModalities, issue.path);
    const imageOnlyEvidence = modality === "image"
      || (modality === undefined && !sourceText.trim() && evidence.hasImages);
    return {
      severity: imageOnlyEvidence ? "warning" as const : "error" as const,
      code: issue.code,
      path: issue.path,
      message: imageOnlyEvidence
        ? `${issue.message} 이미지 원본에서 관리자 대조가 필요합니다.`
        : issue.message,
    };
  }));
  const coverageGaps = findCoverageGaps(sourceText, data, { includeAuditLedger: false });
  if (coverageGaps.length > 0) {
    issues.push({
      severity: "warning",
      code: "coverage_gap",
      path: "coverage_gaps",
      message: `원문 금액 후보 ${coverageGaps.length}건이 추출 KRW 값과 연결되지 않아 사람 검토가 필요합니다.`,
    });
  }
  return { data, issues, coverageGaps };
}

export async function validateManifest(options: ValidateOptions): Promise<IngestManifest> {
  const manifest = await loadManifest(options.stateDir);
  const validatedDirectory = path.join(path.resolve(options.stateDir), "validated");
  const artifactsByUnitId = new Map<string, StrictValidatedArtifact>();

  for (const unit of manifest.units) {
    if (!unit.extraction || !["extracted", "validated"].includes(unit.stage)) continue;
    let extractionArtifact: ReturnType<typeof StrictExtractionArtifactSchema.parse>;
    try {
      await verifyValidationInputsUnchanged(unit, manifest);
      const { verifyCurrentExtractionCacheForUnit } = await import("./extract.js");
      extractionArtifact = await verifyCurrentExtractionCacheForUnit(
        unit,
        manifest,
        options.stateDir,
      );
    } catch (error) {
      unit.stage = "error";
      delete unit.validation;
      const message = error instanceof Error ? error.message : "unknown_validation_provenance_error";
      unit.notices = Array.from(new Set([
        ...unit.notices,
        `validate failed: extraction artifact provenance mismatch (${message})`,
      ]));
      continue;
    }

    const { data, issues, coverageGaps } = await deriveValidatedPayloadForUnit(
      unit,
      extractionArtifact,
    );
    const fingerprint = validatedArtifactFingerprint(
      unit.extraction.fingerprint,
      data,
      issues,
      coverageGaps,
    );
    const artifactPath = path.join(validatedDirectory, `${unit.unit_id}.json`);
    const sourceFiles = unit.source_files.map((source) => ({
      path: source.path,
      sha256: source.sha256,
      bytes: source.bytes,
    }));
    const existing = await readExistingValidated(artifactPath, {
      stateDir: options.stateDir,
      fingerprint,
      unitId: unit.unit_id,
      sourceFingerprint: unit.source_fingerprint,
      extractionFingerprint: unit.extraction.fingerprint,
      extractionContentSha256: extractionArtifact.content_sha256,
      promptVersion: extractionArtifact.prompt_version,
      promptHash: extractionArtifact.prompt_hash,
      model: extractionArtifact.model,
      sourceFiles,
    });
    const artifactCandidate = existing ?? {
      schema_version: 2 as const,
      content_sha256: "0".repeat(64),
      validator_version: VALIDATOR_VERSION,
      fingerprint,
      unit_id: unit.unit_id,
      source_files: sourceFiles,
      source_fingerprint: unit.source_fingerprint,
      extraction_fingerprint: unit.extraction.fingerprint,
      extraction_content_sha256: extractionArtifact.content_sha256,
      prompt_version: extractionArtifact.prompt_version,
      prompt_hash: extractionArtifact.prompt_hash,
      model: extractionArtifact.model,
      data,
      issues,
      coverage_gaps: coverageGaps,
      review_status: "pending",
      validated_at: new Date().toISOString(),
    };
    if (!existing) {
      artifactCandidate.content_sha256 = canonicalJsonSha256ExcludingField(
        artifactCandidate,
        "content_sha256",
      );
    }
    const artifact = StrictValidatedArtifactSchema.parse(artifactCandidate);
    if (!existing) {
      await prepareDeterministicStateArtifactWritePath({
        stateDir: options.stateDir,
        artifactPath,
        expectedRelativePath: path.join("validated", `${unit.unit_id}.json`),
      });
      await writeJsonFile(artifactPath, artifact);
    }
    artifactsByUnitId.set(unit.unit_id, artifact);
    unit.validation = {
      fingerprint,
      content_sha256: artifact.content_sha256,
      extraction_content_sha256: artifact.extraction_content_sha256,
      validator_version: artifact.validator_version,
      artifact_path: artifactPath,
      review_status: "pending",
      issue_count: artifact.issues.length,
      validated_at: artifact.validated_at,
    };
    unit.stage = artifact.issues.some((issue) => issue.severity === "error") ? "error" : "validated";
  }

  const initiallyValidPartnerRecords = manifest.units.flatMap((unit) => {
    const artifact = artifactsByUnitId.get(unit.unit_id);
    return unit.stage === "validated" && artifact
      ? buildPartnerVendorRecords(unit.unit_id, unit.parsed.region_code, artifact.data.partner_vendors)
      : [];
  });
  const conflictingPartnerRefs = new Set(
    findPartnerVendorIdentityConflicts(initiallyValidPartnerRecords)
      .flatMap((conflict) => conflict.record_refs),
  );
  if (conflictingPartnerRefs.size > 0) {
    for (const unit of manifest.units) {
      const artifact = artifactsByUnitId.get(unit.unit_id);
      if (unit.stage !== "validated" || !artifact || !unit.validation) continue;
      const unitHasConflict = buildPartnerVendorRecords(
        unit.unit_id,
        unit.parsed.region_code,
        artifact.data.partner_vendors,
      ).some((record) => conflictingPartnerRefs.has(record.record_ref));
      if (!unitHasConflict) continue;
      artifact.issues.push({
        severity: "error",
        code: "conflicting_partner_vendor_prices",
        path: "partner_vendors",
        message: "다른 공시 원본과 동일한 지역·카테고리·정규화 업체명을 사용하지만 가격·구성이 달라 자동 적재를 차단했습니다.",
      });
      artifact.fingerprint = validatedArtifactFingerprint(
        artifact.extraction_fingerprint,
        artifact.data,
        artifact.issues,
        artifact.coverage_gaps,
      );
      artifact.content_sha256 = canonicalJsonSha256ExcludingField(
        artifact,
        "content_sha256",
      );
      await verifyDeterministicStateArtifactPath({
        stateDir: options.stateDir,
        artifactPath: unit.validation.artifact_path,
        expectedRelativePath: path.join("validated", `${unit.unit_id}.json`),
      });
      await writeJsonFile(unit.validation.artifact_path, artifact);
      unit.validation.fingerprint = artifact.fingerprint;
      unit.validation.content_sha256 = artifact.content_sha256;
      unit.validation.issue_count = artifact.issues.length;
      unit.stage = "error";
    }
  }

  const validatedUnits = manifest.units.filter((unit) => unit.stage === "validated" && unit.validation);
  const candidates: DedupeCandidates["candidates"] = [];
  for (let leftIndex = 0; leftIndex < validatedUnits.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < validatedUnits.length; rightIndex += 1) {
      const left = validatedUnits[leftIndex];
      const right = validatedUnits[rightIndex];
      if (left.parsed.region_code !== right.parsed.region_code) continue;
      const similarity = trigramSimilarity(left.parsed.normalized_name, right.parsed.normalized_name);
      if (similarity < 0.7) continue;
      candidates.push({
        left_unit_id: left.unit_id,
        right_unit_id: right.unit_id,
        region_code: left.parsed.region_code,
        left_name: left.parsed.raw_name,
        right_name: right.parsed.raw_name,
        similarity: Number(similarity.toFixed(4)),
        decision: "human_review_required",
      });
    }
  }
  const validatedPartnerRecords = validatedUnits.flatMap((unit) => {
    const artifact = artifactsByUnitId.get(unit.unit_id);
    return artifact
      ? buildPartnerVendorRecords(unit.unit_id, unit.parsed.region_code, artifact.data.partner_vendors)
      : [];
  });
  candidates.push(...findPartnerVendorDedupeCandidates(validatedPartnerRecords));
  const dedupeArtifact: DedupeCandidates = {
    generated_at: new Date().toISOString(),
    threshold: 0.7,
    auto_merge: false,
    candidates,
  };
  await writeJsonFile(
    path.join(validatedDirectory, "dedupe_candidates.json"),
    DedupeCandidatesSchema.parse(dedupeArtifact),
  );
  await saveManifest(manifest);
  return manifest;
}
