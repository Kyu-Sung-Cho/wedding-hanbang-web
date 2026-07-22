import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
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
import {
  LOCAL_DETERMINISTIC_ENGINE_HASH,
  LOCAL_DETERMINISTIC_ENGINE_VERSION,
  LOCAL_DETERMINISTIC_MODEL,
  LOCAL_DETERMINISTIC_PROVIDER_MODE,
} from "./local-extraction-contract.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { decodeEvidenceQuote, encodeMergedEvidenceQuote } from "./merge-evidence.js";
import { extractHallXlsxTopology } from "./hall-xlsx-topology.js";
import { projectCanonicalPdfLayoutMoney } from "./pdf-layout-evidence.js";
import {
  buildPartnerVendorRecords,
  findPartnerVendorIdentityConflicts,
  findPartnerVendorDedupeCandidates,
} from "./partner-dedupe.js";
import {
  prepareStructuredEvidenceText,
  resolveArtifactSourceProvenance,
  sourceFileId,
  sourceFilesForArtifact,
} from "./provenance.js";
import { validateStructuredRecordSourceLinkage } from "./record-source-linkage.js";
import {
  DUPLICATE_SOURCE_NOTICE_PREFIX,
  normalizeVendorName,
  regionCodeFromDirectory,
  SCANNER_PARSER_VERSION,
} from "./scan.js";
import {
  DisclosureExtractionSchema,
  StrictExtractionArtifactSchema,
  VisualTranscriptionExtractionBindingSchema,
} from "./schemas.js";
import type {
  DisclosureExtraction,
  VisualTranscriptionExtractionBinding,
} from "./schemas.js";
import type { IngestManifest, ManifestUnit, SourceFile } from "./types.js";
import {
  indexXlsxAuxiliaryEvidence,
  looksLikeXlsxAuxiliaryEvidence,
  matchSingleXlsxAuxiliaryEvidenceQuote,
  parseXlsxAuxiliaryEvidenceLine,
  parseXlsxAuxiliaryEvidencePayload,
  type XlsxAuxiliaryEvidenceIndex,
} from "./xlsx-aux-evidence.js";
import {
  loadVisualTranscriptionSidecar,
  mergeVisualTranscriptionSidecar,
  visualTranscriptionExtractionBinding,
  type LoadedVisualTranscriptionSidecar,
} from "./visual-transcription-sidecar.js";

export const VALIDATOR_VERSION = "v44-canonical-source-linkage";
export { SOURCE_MONEY_SCANNER_VERSION } from "./extraction-contract.js";
const BASE_PRICE_MIN_KRW = 100_000;
const BASE_PRICE_MAX_KRW = 30_000_000;
const SECTION_AND_POLICY_SOURCE_QUOTE_MAX_CHARACTERS = 2_000;
const PUBLIC_CONTACT_PATTERN = /(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const LOCAL_PARTNER_VENDOR_CONFLICT_NOTICE =
  "local_partner_vendor_conflict_requires_dedupe_review";

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
  source_locator: z.string().min(1).max(300),
  visual_transcription: z.object({
    evidence_id: z.string().regex(/^[a-f0-9]{64}$/),
    visible_amounts_krw: z.array(z.number().int().nonnegative()).max(100),
    estimated_content: z.string().min(1).max(2_000),
    reason: z.string().min(1).max(1_000),
  }).strict().optional(),
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

/**
 * Validation output for the zero-cost local rules engine. Keeping this
 * contract separate prevents local evidence from ever being represented as a
 * paid/model extraction or inheriting its publication trust.
 */
export const LocalValidatedArtifactSchema = z.object({
  schema_version: z.literal(3),
  artifact_kind: z.literal("local_deterministic_validation"),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  validator_version: z.literal(VALIDATOR_VERSION),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  unit_id: z.string().regex(/^[a-f0-9]{64}$/),
  source_files: z.array(ValidatedSourceFileSchema),
  source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  extraction_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  extraction_content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  provider_mode: z.literal(LOCAL_DETERMINISTIC_PROVIDER_MODE),
  model: z.literal(LOCAL_DETERMINISTIC_MODEL),
  engine_version: z.literal(LOCAL_DETERMINISTIC_ENGINE_VERSION),
  engine_hash: z.literal(LOCAL_DETERMINISTIC_ENGINE_HASH),
  data: DisclosureExtractionSchema,
  issues: z.array(ValidationIssueSchema),
  coverage_gaps: z.array(CoverageGapSchema).max(5_000),
  review_status: z.literal("pending"),
  needs_review: z.literal(true),
  bulk_approval_eligible: z.literal(false),
  visual_transcription: VisualTranscriptionExtractionBindingSchema.optional(),
  validated_at: z.string().datetime(),
}).strict();

export const ValidatedArtifactSchema = z.union([
  LegacyValidatedArtifactSchema,
  StrictValidatedArtifactSchema,
  LocalValidatedArtifactSchema,
]);

export type StrictValidatedArtifact = z.infer<typeof StrictValidatedArtifactSchema>;
export type LocalValidatedArtifact = z.infer<typeof LocalValidatedArtifactSchema>;
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
  pdfLayoutMoney?: PdfLayoutMoneyEvidenceIndex;
  bySourceFileId?: Record<string, {
    normalizedText: string;
    hasImages: boolean;
    xlsxCells?: XlsxCellEvidenceIndex;
    xlsxAuxiliary?: XlsxAuxiliaryEvidenceIndex;
    lineEvidence?: Record<string, string[]>;
    pdfLayoutMoney?: PdfLayoutMoneyEvidenceIndex;
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

const CONVERTER_REVIEW_METADATA_PATTERN = /^(?:\[OCR_REVIEW_ONLY\]|contract_version:\s*[A-Z0-9][A-Z0-9._+-]{0,199}|contract_hash:\s*[A-F0-9]{64}|language:\s*ko-KR|review_only:\s*true|authoritative:\s*false|bulk_approval_eligible:\s*false|source_image_sha256:\s*[A-F0-9]{64}|page:\s*[1-9][0-9]*|engine_name:\s*Windows\.Media\.Ocr|engine_version:\s*[A-Z0-9][A-Z0-9._|+-]{0,199}|engine_hash:\s*[A-F0-9]{64})$/iu;

/** Only exact converter-owned OCR provenance records are metadata. Prefixes remain disclosure evidence. */
export function isConverterReviewMetadataLine(value: string): boolean {
  return CONVERTER_REVIEW_METADATA_PATTERN.test(normalizeEvidenceText(value));
}

interface ParsedLineEvidenceQuote {
  locator: string;
  lineNumber: number;
  lineContent: string;
}

interface ParsedPdfLayoutEvidenceQuote {
  locator: string;
  krw: number;
  lineContent: string;
}

type PdfLayoutMoneyEvidenceIndex = Record<
  string,
  Array<{ krw: number; lineContent: string }>
>;

/**
 * A PDF projection quote binds one structured value to one canonical layout
 * occurrence. The KRW tag is metadata, not source prose; it is accepted only
 * when the canonical layout projection at the exact locator proves the same
 * value and line payload.
 */
function parsePdfLayoutEvidenceQuote(value: string): ParsedPdfLayoutEvidenceQuote | null {
  const normalized = normalizeEvidenceText(value);
  const match = /^(pdf:page:[1-9][0-9]*:row:[1-9][0-9]*:item:[1-9][0-9]*:money:[1-9][0-9]*) \[krw=([1-9][0-9]*)\]:\s*(.+)$/u.exec(normalized);
  if (!match) return null;
  const krw = Number.parseInt(match[2]!, 10);
  if (!Number.isSafeInteger(krw) || krw < 1_000) return null;
  return { locator: match[1]!, krw, lineContent: match[3]!.trim() };
}

function indexPdfLayoutMoneyEvidence(text: string): PdfLayoutMoneyEvidenceIndex {
  const index: PdfLayoutMoneyEvidenceIndex = {};
  for (const candidate of projectCanonicalPdfLayoutMoney(text)) {
    const entries = index[candidate.source_locator] ?? [];
    entries.push({
      krw: candidate.krw,
      lineContent: normalizeEvidenceText(candidate.line_context),
    });
    index[candidate.source_locator] = entries;
  }
  return index;
}

function mergePdfLayoutMoneyEvidence(
  texts: readonly string[],
): PdfLayoutMoneyEvidenceIndex {
  const merged: PdfLayoutMoneyEvidenceIndex = {};
  for (const text of texts) {
    for (const [locator, candidates] of Object.entries(indexPdfLayoutMoneyEvidence(text))) {
      merged[locator] = [...(merged[locator] ?? []), ...candidates];
    }
  }
  return merged;
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
  const locator = `${located[1].normalize("NFKC").trim()}!${located[2].toUpperCase()}`;
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
  const addQuotedOccurrences = (quote: string): void => {
    const decoded = decodeEvidenceQuote(quote);
    const addScannedOccurrences = (exactQuotes: string[]): void => {
      const scanQuotes: string[] = [];
      for (const exactQuote of exactQuotes) {
        const pdf = parsePdfLayoutEvidenceQuote(exactQuote);
        if (pdf) evidence.push({ values: [pdf.krw], quote: exactQuote });
        else scanQuotes.push(exactQuote);
      }
      const scanText = scanQuotes.join("\n");
      for (const occurrence of scanSourceMoneyOccurrences(scanText)) {
        const exactQuote = scanQuotes.find((candidate) => {
          const parsed = parseXlsxEvidenceLine(candidate, true);
          return parsed?.locator === occurrence.source_locator
            && parsed.cellContent.includes(occurrence.raw);
        }) ?? exactQuotes[0];
        if (!exactQuote) continue;
        // Policy and section prose can repeat the same KRW value for distinct
        // conditions. Keep one evidence vertex per exact source occurrence so
        // duplicate-aware coverage matching can consume every occurrence.
        evidence.push({ values: [occurrence.krw], quote: exactQuote });
      }
    };
    if (decoded.kind === "single") {
      addScannedOccurrences([decoded.quote]);
      return;
    }
    if (decoded.kind !== "merged") return;

    const xlsxBySourceAndSheet = new Map<string, string[]>();
    const independent: string[] = [];
    for (const fragment of decoded.fragments) {
      const parsed = parseXlsxEvidenceLine(fragment.quote, true);
      const separator = parsed?.locator.lastIndexOf("!") ?? -1;
      if (!parsed || separator < 1) {
        independent.push(fragment.quote);
        continue;
      }
      const key = `${fragment.source_file_id}\0${parsed.locator.slice(0, separator)}`;
      xlsxBySourceAndSheet.set(key, [
        ...(xlsxBySourceAndSheet.get(key) ?? []),
        fragment.quote,
      ]);
    }
    for (const exactQuotes of xlsxBySourceAndSheet.values()) addScannedOccurrences(exactQuotes);
    for (const exactQuote of independent) addScannedOccurrences([exactQuote]);
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
      addQuotedOccurrences(policy.source_quote);
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
    addQuotedOccurrences(section.source_quote);
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
  if (
    isConverterReviewMetadataLine(line)
    || /(?:사업자\s*등록|계좌|은행|예금주|작성일|날짜)/iu.test(line)
    || PUBLIC_CONTACT_PATTERN.test(line)
  ) return true;
  return /(?:전화|연락처|tel|fax)/iu.test(line);
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

type SourceMoneyScannerContract = "current" | "legacy_e258_v9";

const CURRENT_SOURCE_MONEY_SCANNER_CONTRACT: SourceMoneyScannerContract = "current";
const LEGACY_E258_SOURCE_MONEY_SCANNER_CONTRACT: SourceMoneyScannerContract = "legacy_e258_v9";

function numericMoney(
  value: string,
  multiplier: number,
  contract: SourceMoneyScannerContract = CURRENT_SOURCE_MONEY_SCANNER_CONTRACT,
): number | null {
  const normalized = contract === CURRENT_SOURCE_MONEY_SCANNER_CONTRACT
    && /^\d{1,3}(?:\.\d{3})+$/u.test(value)
    ? value.replace(/\./gu, "")
    : value.replace(/,/gu, "");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const amount = Math.round(numeric * multiplier);
  return Number.isSafeInteger(amount) ? amount : null;
}

function explicitMoneyAmount(
  raw: string,
  contract: SourceMoneyScannerContract = CURRENT_SOURCE_MONEY_SCANNER_CONTRACT,
): number | null {
  let amount = 0;
  let components = 0;
  for (const match of raw.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(천만|백만|억|만|천)/gu)) {
    const component = numericMoney(match[1], moneyMultiplier(match[2]), contract);
    if (component === null) return null;
    amount += component;
    components += 1;
  }
  if (components > 0) return Number.isSafeInteger(amount) ? amount : null;
  const won = raw.match(/(\d[\d,]*(?:\.\d+)?)\s*원/u);
  return won ? numericMoney(won[1], 1, contract) : null;
}

function explicitCurrencyMoneyAmount(
  raw: string,
  contract: SourceMoneyScannerContract = CURRENT_SOURCE_MONEY_SCANNER_CONTRACT,
): number | null {
  const unitAmount = explicitMoneyAmount(raw, contract);
  if (unitAmount !== null) return unitAmount;
  const numeric = raw.match(/\d[\d,]*(?:\.\d+)?/u)?.[0];
  return numeric ? numericMoney(numeric, 1, contract) : null;
}

function simpleKoreanMoneyMultiplier(raw: string): number | null {
  const match = raw.match(
    /^\s*\d[\d,]*(?:\.\d+)?\s*(천만|백만|억|만|천)\s*원?\s*$/u,
  );
  return match ? moneyMultiplier(match[1]) : null;
}

function explicitCurrencyRangeAmount(
  raw: string,
  peer: string,
  contract: SourceMoneyScannerContract = CURRENT_SOURCE_MONEY_SCANNER_CONTRACT,
): number | null {
  if (!/(?:천만|백만|억|만|천|원)/u.test(raw)) {
    const sharedMultiplier = simpleKoreanMoneyMultiplier(peer);
    const numeric = raw.match(/\d[\d,]*(?:\.\d+)?/u)?.[0];
    if (sharedMultiplier !== null && numeric) {
      return numericMoney(numeric, sharedMultiplier, contract);
    }
  }
  return explicitCurrencyMoneyAmount(raw, contract);
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

function isNumberedClause(
  before: string,
  after: string,
  contract: SourceMoneyScannerContract = CURRENT_SOURCE_MONEY_SCANNER_CONTRACT,
): boolean {
  return /(?:^|<br>|[\n\r])\s*$/iu.test(before)
    && (contract === LEGACY_E258_SOURCE_MONEY_SCANNER_CONTRACT
      ? /^\.\s/u.test(after)
      : /^\.\s*/u.test(after));
}

function hasKoreanCountSuffix(after: string): boolean {
  return /^(?:명|개|건|회|벌|장|부|권|페이지|컷|시간|분|일|개월|월|년|조|인|팀|곳|호|차|대)/u.test(after.trimStart());
}

function hasTemporalBareRangeContext(before: string): boolean {
  const clause = before.split(/(?:<br>|[\n\r/|;；])/iu).at(-1)?.slice(-160) ?? "";
  if (/예식\s*(?:예정\s*)?일/u.test(clause)) return true;
  return /(?:계약\s*해제|계약\s*해지|취소|해약)/u.test(clause)
    && /(?:\d+\s*)?(?:일|개월|전|후|까지|이전|이후)/u.test(clause);
}

function hasNonMoneyBareRangeSuffix(after: string): boolean {
  const normalized = after.trimStart().replace(/^[)\]}）］｝]+\s*/u, "");
  return /^(?:%|퍼센트|년|개월|월|일|시간|분|시|회|벌|장|개|명|부|권|페이지|컷)/u.test(normalized);
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

function hasBareNumericEnumeration(payload: string): boolean {
  return [...payload.matchAll(/\d+(?:\s*([,/])\s*\d+){2,}/gu)].some((match) => {
    const value = match[0];
    if (value.includes("/")) return true;
    const groups = value.split(",").map((part) => part.trim());
    const conventionalThousandsGrouping = !/\s/u.test(value)
      && groups[0]!.length >= 1
      && groups[0]!.length <= 3
      && groups.slice(1).every((group) => group.length === 3);
    return !conventionalThousandsGrouping;
  });
}

function hasExplicitMoneyTokenStartBoundary(payload: string, start: number): boolean {
  if (start <= 0) return true;
  // Do not restart a money token inside a malformed numeric continuation such
  // as `1,500,000원.000원`. The complete first amount is valid evidence, while
  // the trailing `.000원` is not an independent price.
  return !/[\d,.]/u.test(payload[start - 1] ?? "");
}

function sourceMoneyOccurrences(
  payload: string,
  multiplier: number | null,
  lineContext: string,
  sourceLocator: string,
  allowBare = true,
  barePriceContext = false,
  contract: SourceMoneyScannerContract = CURRENT_SOURCE_MONEY_SCANNER_CONTRACT,
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
    if (
      contract === CURRENT_SOURCE_MONEY_SCANNER_CONTRACT
      && !hasExplicitMoneyTokenStartBoundary(payload, start)
    ) continue;
    occupied.push({ start, end });
    push(match[0], explicitCurrencyRangeAmount(match[2], match[5], contract), start, end);
    push(match[0], explicitCurrencyRangeAmount(match[5], match[2], contract), start, end);
  }

  const explicitCurrencySingle = new RegExp(
    String.raw`(?:KRW\s*|₩\s*)(${CURRENCY_MONEY_TOKEN_PATTERN})|(${CURRENCY_MONEY_TOKEN_PATTERN})\s*KRW\b`,
    "giu",
  );
  for (const match of payload.matchAll(explicitCurrencySingle)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      contract === CURRENT_SOURCE_MONEY_SCANNER_CONTRACT
      && !hasExplicitMoneyTokenStartBoundary(payload, start)
    ) continue;
    if (overlapsSpan(start, end, occupied)) continue;
    occupied.push({ start, end });
    push(match[0], explicitCurrencyMoneyAmount(match[1] ?? match[2], contract), start, end);
  }

  const explicitRange = /(\d[\d,]*(?:\.\d+)?)\s*(?:~|〜|–|—|-)\s*(?:(?:최고|최대|상한)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(억|천만|백만|만|천)\s*원?/gu;
  for (const match of payload.matchAll(explicitRange)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      contract === CURRENT_SOURCE_MONEY_SCANNER_CONTRACT
      && !hasExplicitMoneyTokenStartBoundary(payload, start)
    ) continue;
    if (overlapsSpan(start, end, occupied)) continue;
    if (!match[0].trimEnd().endsWith("원") && hasKoreanCountSuffix(payload.slice(end))) {
      occupied.push({ start, end });
      continue;
    }
    occupied.push({ start, end });
    const unitMultiplier = moneyMultiplier(match[3]);
    push(match[0], numericMoney(match[1], unitMultiplier, contract), start, end);
    push(match[0], numericMoney(match[2], unitMultiplier, contract), start, end);
  }

  const explicitSingle = /(?:\d[\d,]*(?:\.\d+)?\s*(?:천만|백만|억|만|천)\s*)+원?|\d[\d,]*(?:\.\d+)?\s*원/gu;
  for (const match of payload.matchAll(explicitSingle)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      contract === CURRENT_SOURCE_MONEY_SCANNER_CONTRACT
      && !hasExplicitMoneyTokenStartBoundary(payload, start)
    ) continue;
    if (overlapsSpan(start, end, occupied)) continue;
    if (!match[0].trimEnd().endsWith("원") && hasKoreanCountSuffix(payload.slice(end))) {
      occupied.push({ start, end });
      continue;
    }
    occupied.push({ start, end });
    push(match[0], explicitMoneyAmount(match[0], contract), start, end);
  }

  if (
    multiplier === null
    || !allowBare
    || (contract === CURRENT_SOURCE_MONEY_SCANNER_CONTRACT
      && !barePriceContext
      && hasBareNumericEnumeration(payload))
  ) return occurrences;

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
    if (hasNonMoneyBareRangeSuffix(after)) {
      occupied.push({ start, end });
      continue;
    }
    if (hasTemporalBareRangeContext(before)) {
      occupied.push({ start, end });
      continue;
    }
    if (
      contract === CURRENT_SOURCE_MONEY_SCANNER_CONTRACT
      && multiplier === 1
      && /(?:해당\s*)?없음\s*$/u.test(before)
      && /^\d{2,4}\s*-\s*\d{3,4}$/u.test(match[0])
    ) {
      occupied.push({ start, end });
      continue;
    }
    occupied.push({ start, end });
    push(
      match[0],
      numericMoney(match[1], bareMoneyMultiplier(match[1], multiplier, before), contract),
      start,
      end,
    );
    push(
      match[0],
      numericMoney(match[2], bareMoneyMultiplier(match[2], multiplier, before), contract),
      start,
      end,
    );
  }

  for (const match of payload.matchAll(/\d[\d,]*(?:\.\d+)?/gu)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    if (overlapsSpan(start, end, occupied)) continue;
    const after = payload.slice(end).trimStart();
    const before = payload.slice(0, start);
    if (isClockFragment(before, after) || isNumberedClause(before, after, contract)) continue;
    if (isEmbeddedIdentifier(raw, before, after)) continue;
    if (/^(?:%|p\b|r\b|벌|회|장|개|명|시간|분|시|부|권|페이지|컷|스팟|일|개월|월|년|조)/iu.test(after)) continue;
    if (/[\d,.-]$/u.test(before)) continue;
    push(raw, numericMoney(raw, bareMoneyMultiplier(raw, multiplier, before), contract), start, end);
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
  return /(?:가격|금액|비용|요금|대관료|식대|보증금|추가금|헬퍼|퍼스트웨어|추가대여|헤어피스|선택품목|옵션|야외\s*[/·]\s*야간|야간\s*[/·]\s*야외)/u.test(payload);
}

const PDF_LAYOUT_EVIDENCE_BEGIN = "[PDF_LAYOUT_EVIDENCE_V1_BEGIN]";
const PDF_LAYOUT_EVIDENCE_END = "[PDF_LAYOUT_EVIDENCE_V1_END]";
const PDF_LAYOUT_EVIDENCE_ROW_PATTERN = /^\[PDF_LAYOUT_EVIDENCE_V1 page=([1-9][0-9]*) row=([1-9][0-9]*) y=(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)\] ([A-Za-z0-9_-]+)$/u;

function canonicalPdfLayoutEvidenceMetadataLineIndexes(
  lines: readonly string[],
): ReadonlySet<number> {
  const beginIndexes = lines.flatMap((line, index) => (
    line === PDF_LAYOUT_EVIDENCE_BEGIN ? [index] : []
  ));
  const endIndexes = lines.flatMap((line, index) => (
    line === PDF_LAYOUT_EVIDENCE_END ? [index] : []
  ));
  if (beginIndexes.length !== 1 || endIndexes.length !== 1) return new Set();
  const begin = beginIndexes[0]!;
  const end = endIndexes[0]!;
  let lastNonEmptyIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]!.trim().length === 0) continue;
    lastNonEmptyIndex = index;
    break;
  }
  if (begin >= end || end !== lastNonEmptyIndex || end === begin + 1) return new Set();

  let priorPage = 0;
  let priorRow = 0;
  let priorAnchorY = Number.POSITIVE_INFINITY;
  for (let index = begin + 1; index < end; index += 1) {
    const match = PDF_LAYOUT_EVIDENCE_ROW_PATTERN.exec(lines[index]!);
    if (!match) return new Set();
    const page = Number(match[1]);
    const row = Number(match[2]);
    const anchorY = Number(match[3]);
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(row) || !Number.isFinite(anchorY)) {
      return new Set();
    }
    if (page !== priorPage) {
      if (page !== priorPage + 1 || row !== 1) return new Set();
      priorPage = page;
      priorRow = 0;
      priorAnchorY = Number.POSITIVE_INFINITY;
    }
    if (row !== priorRow + 1 || anchorY > priorAnchorY) return new Set();
    priorRow = row;
    priorAnchorY = anchorY;
  }

  return new Set(Array.from({ length: end - begin + 1 }, (_, offset) => begin + offset));
}

function sourceMoneyProjectionForTextArtifact(_artifactPath: string, value: string): string {
  // The scanner itself excludes the exact converter-owned metadata rows from
  // ordinary line scanning. Retain the canonical suffix here so its strict
  // page/row/item occurrence projection remains available to local audit.
  // A duplicated or malformed suffix still fails closed in the canonical
  // parser and therefore cannot create projected occurrences.
  return value;
}

function scanSourceMoneyOccurrencesForContract(
  fullText: string,
  contract: SourceMoneyScannerContract,
): CoverageGap[] {
  const candidates: CoverageGap[] = [];
  const lines = fullText.normalize("NFKC").split(/\r?\n/u);
  const pdfLayoutMetadataLineIndexes = canonicalPdfLayoutEvidenceMetadataLineIndexes(lines);
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
  for (const [lineIndex, rawLine] of lines.entries()) {
    if (isConverterReviewMetadataLine(rawLine)) continue;
    if (pdfLayoutMetadataLineIndexes.has(lineIndex)) continue;
    if (looksLikeXlsxAuxiliaryEvidence(rawLine)) continue;
    const cellMatch = rawLine.trim().match(/^(.+)!([A-Z]+\d+):\s*(.*)$/u);
    if (!cellMatch) continue;
    const sheetName = cellMatch[1].trim();
    workbookSheets.add(sheetName);
    workbookCellPayloads.set(`${sheetName}\0${cellMatch[2]}`, cellMatch[3]);
    const declared = declaredMoneyMultiplier(cellMatch[3]);
    const row = Number(cellMatch[2].match(/\d+$/u)?.[0]);
    const column = cellMatch[2].match(/^[A-Z]+/u)?.[0];
    const columnDeclared = declared === null && priceHeaderContext(cellMatch[3])
      ? parentheticalMoneyMultiplier(cellMatch[3])
      : null;
    if (columnDeclared !== null && column && Number.isSafeInteger(row)) {
      const declarations = workbookColumnUnitDeclarations.get(sheetName) ?? [];
      declarations.push({ column, row, multiplier: columnDeclared });
      workbookColumnUnitDeclarations.set(sheetName, declarations);
    } else if (declared !== null) {
      const values = workbookMultipliers.get(sheetName) ?? new Set<number>();
      values.add(declared);
      workbookMultipliers.set(sheetName, values);
      if (column && Number.isSafeInteger(row)) {
        const declarations = workbookUnitDeclarations.get(sheetName) ?? [];
        declarations.push({ column, row, multiplier: declared });
        workbookUnitDeclarations.set(sheetName, declarations);
      }
    }
    if (
      column
      && Number.isSafeInteger(row)
      && row <= 20
      && priceHeaderContext(cellMatch[3])
    ) {
      const priceColumns = workbookPriceColumns.get(sheetName) ?? new Set<string>();
      priceColumns.add(column);
      workbookPriceColumns.set(sheetName, priceColumns);
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
    if (isConverterReviewMetadataLine(line)) continue;
    if (pdfLayoutMetadataLineIndexes.has(lineIndex)) continue;
    const auxiliary = parseXlsxAuxiliaryEvidenceLine(line);
    if (auxiliary) {
      candidates.push(...sourceMoneyOccurrences(
        auxiliary.payload,
        null,
        auxiliary.payload,
        auxiliary.locator,
        !excludedMoneyContext(auxiliary.payload),
        false,
        contract,
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
      const sheetName = canonicalCell[1].trim();
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
        isPriceColumn || hasInlinePriceSemantics,
        contract,
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
    const ocrPayload = /^ocr:page:\d+:line:\d+:\s*(.*)$/iu.exec(line)?.[1]?.trim() ?? null;
    const disclosurePayload = ocrPayload ?? line;
    const declared = declaredMoneyMultiplier(disclosurePayload);
    if (declared !== null) {
      if (ocrPayload === null) tableMultiplier = declared;
      continue;
    }
    candidates.push(...sourceMoneyOccurrences(
      disclosurePayload,
      ocrPayload === null ? tableMultiplier : null,
      line,
      `line:${lineIndex + 1}`,
      !excludedMoneyContext(disclosurePayload),
      priceHeaderContext(disclosurePayload),
      contract,
    ));
  }

  return candidates;
}

export function scanSourceMoneyOccurrences(fullText: string): CoverageGap[] {
  const lineOccurrences = scanSourceMoneyOccurrencesForContract(
    fullText,
    CURRENT_SOURCE_MONEY_SCANNER_CONTRACT,
  );
  const lineOccurrenceCapacity = new Map<string, number>();
  for (const occurrence of lineOccurrences) {
    const key = `${occurrence.krw}\0${normalizeEvidenceText(occurrence.line_context)}`;
    lineOccurrenceCapacity.set(key, (lineOccurrenceCapacity.get(key) ?? 0) + 1);
  }
  const projected = projectCanonicalPdfLayoutMoney(fullText).filter((candidate) => {
    const key = `${candidate.krw}\0${normalizeEvidenceText(candidate.line_context)}`;
    const capacity = lineOccurrenceCapacity.get(key) ?? 0;
    if (capacity === 0) return true;
    lineOccurrenceCapacity.set(key, capacity - 1);
    return false;
  });
  return [
    ...lineOccurrences,
    ...projected.map(({ raw, krw, line_context, source_locator }) => ({
      raw,
      krw,
      line_context,
      source_locator,
    })),
  ];
}

/**
 * Frozen scanner used only to replay the known paid-cache transition. This is
 * not a permissive validation mode: callers must still prove the complete
 * source/checkpoint/ledger chain and exact final cache equality.
 */
export function scanLegacyE258SourceMoneyOccurrences(fullText: string): CoverageGap[] {
  return scanSourceMoneyOccurrencesForContract(
    fullText,
    LEGACY_E258_SOURCE_MONEY_SCANNER_CONTRACT,
  );
}

export function findCoverageGaps(
  fullText: string,
  data: DisclosureExtraction,
  options: {
    includeAuditLedger?: boolean;
    scannedCandidates?: readonly CoverageGap[];
  } = {},
): CoverageGap[] {
  const scannedCandidates = options.scannedCandidates
    ? [...options.scannedCandidates]
    : scanSourceMoneyOccurrences(fullText);
  const topologyCandidates = data.doc_kind === "hall_disclosure"
    && /^##\s*시트:\s*.+$/mu.test(fullText)
    && /^.+![A-Z]+[1-9][0-9]*:\s*.*$/mu.test(fullText)
    ? extractHallXlsxTopology({ sourceFileId: "coverage", canonicalText: fullText })
      .money_occurrences.map((occurrence) => ({
        raw: occurrence.raw_text,
        krw: occurrence.amount_krw,
        line_context: occurrence.source_quote,
        source_locator: occurrence.source_locator,
      }))
    : [];
  const topologyCapacity = new Map<string, number>();
  for (const occurrence of topologyCandidates) {
    const key = `${occurrence.source_locator}\0${occurrence.krw}`;
    topologyCapacity.set(key, (topologyCapacity.get(key) ?? 0) + 1);
  }
  const scannerOnlyCandidates = scannedCandidates.filter((occurrence) => {
    const key = `${occurrence.source_locator}\0${occurrence.krw}`;
    const capacity = topologyCapacity.get(key) ?? 0;
    if (capacity === 0) return true;
    topologyCapacity.set(key, capacity - 1);
    return false;
  });
  const candidates = topologyCandidates.length > 0
    ? [...topologyCandidates, ...scannerOnlyCandidates]
    : scannedCandidates;
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
      const pdfQuote = parsePdfLayoutEvidenceQuote(evidence.quote);
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
      if (pdfQuote) {
        return candidate.source_locator === pdfQuote.locator
          && candidate.krw === pdfQuote.krw
          && candidateContext === normalizeEvidenceText(pdfQuote.lineContent)
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

interface LocalMoneyAuditResult {
  issues: ValidationIssue[];
}

type LocalSourceMoneyIndex = ReadonlyMap<string, readonly CoverageGap[]>;

function indexLocalSourceMoney(
  sourceTextsByFileId: ReadonlyMap<string, readonly string[]>,
): LocalSourceMoneyIndex {
  return new Map([...sourceTextsByFileId.entries()].map(([sourceFileIdValue, sourceTexts]) => [
    sourceFileIdValue,
    sourceTexts.flatMap((sourceText) => scanSourceMoneyOccurrences(sourceText)),
  ]));
}

function localMoneyOccurrenceKey(
  sourceFileIdValue: string,
  amountKrw: number,
  rawText: string,
  sourceQuote: string,
): string {
  return [
    sourceFileIdValue,
    amountKrw,
    normalizeEvidenceText(rawText),
    normalizeEvidenceText(sourceQuote),
  ].join("\0");
}

function localTopologyAuditQuote(
  topology: ReturnType<typeof extractHallXlsxTopology>,
  occurrence: ReturnType<typeof extractHallXlsxTopology>["money_occurrences"][number],
): string {
  const conditionById = new Map(topology.conditions.map((condition) => [
    condition.condition_id,
    condition,
  ]));
  const quotes = [...new Set([
    occurrence.source_quote,
    ...occurrence.condition_ids.flatMap((conditionId) => {
      const condition = conditionById.get(conditionId);
      return condition ? [condition.source_quote] : [];
    }),
  ])];
  return encodeMergedEvidenceQuote(
    quotes.map((quote) => ({ source_file_id: occurrence.source_file_id, quote })),
    2_000,
  ) ?? occurrence.source_quote.slice(0, 2_000);
}

/**
 * Local extraction builds its audit ledger with this module's deterministic
 * source scanner. Validation therefore requires exact, duplicate-aware
 * equality in both directions instead of treating the ledger as a hint.
 */
function validateLocalMoneyAudit(
  data: DisclosureExtraction,
  sourceMoneyByFileId: LocalSourceMoneyIndex,
  sourceTextByFileId: ReadonlyMap<string, string>,
): LocalMoneyAuditResult {
  const expectedByKey = new Map<string, CoverageGap[]>();
  const topologyBySource = new Map([...sourceTextByFileId.entries()].flatMap(([
    sourceFileIdValue,
    sourceText,
  ]) => (
    data.doc_kind === "hall_disclosure"
    && /^##\s*시트:\s*.+$/mu.test(sourceText)
    && /^.+![A-Z]+[1-9][0-9]*:\s*.*$/mu.test(sourceText)
      ? [[sourceFileIdValue, extractHallXlsxTopology({
          sourceFileId: sourceFileIdValue,
          canonicalText: sourceText,
        })] as const]
      : []
  )));
  const topologyReplacementCapacity = new Map<string, number>();
  for (const [sourceFileIdValue, topology] of topologyBySource) {
    for (const occurrence of topology.money_occurrences) {
      const replacementKey = `${sourceFileIdValue}\0${occurrence.source_locator}\0${occurrence.amount_krw}`;
      topologyReplacementCapacity.set(
        replacementKey,
        (topologyReplacementCapacity.get(replacementKey) ?? 0) + 1,
      );
      const key = localMoneyOccurrenceKey(
        sourceFileIdValue,
        occurrence.amount_krw,
        occurrence.raw_text,
        localTopologyAuditQuote(topology, occurrence),
      );
      expectedByKey.set(key, [
        ...(expectedByKey.get(key) ?? []),
        {
          raw: occurrence.raw_text,
          krw: occurrence.amount_krw,
          line_context: occurrence.source_quote,
          source_locator: occurrence.source_locator,
        },
      ]);
    }
  }
  for (const [sourceFileIdValue, occurrences] of sourceMoneyByFileId) {
    for (const occurrence of occurrences) {
      const replacementKey = `${sourceFileIdValue}\0${occurrence.source_locator}\0${occurrence.krw}`;
      const replacementCapacity = topologyReplacementCapacity.get(replacementKey) ?? 0;
      if (replacementCapacity > 0) {
        topologyReplacementCapacity.set(replacementKey, replacementCapacity - 1);
        continue;
      }
      const lineNumberMatch = /^line:(\d+)$/u.exec(occurrence.source_locator);
      const lineNumber = lineNumberMatch
        ? Number.parseInt(lineNumberMatch[1]!, 10)
        : null;
      const rawLine = lineNumber && Number.isSafeInteger(lineNumber)
        ? sourceTextByFileId.get(sourceFileIdValue)?.split(/\r?\n/u)[lineNumber - 1]
        : undefined;
      const normalizedLine = rawLine
        ?.replace(/<br\s*\/?>/giu, " ")
        .replace(/\\\|/gu, "|")
        .replace(/\s+/gu, " ")
        .trim();
      const sourceQuote = normalizedLine
        ? `line:${lineNumber}: ${normalizedLine}`.slice(0, 2_000)
        : occurrence.source_locator.startsWith("pdf:")
          ? `${occurrence.source_locator} [krw=${occurrence.krw}]: ${occurrence.line_context}`
            .slice(0, 2_000)
          : `${occurrence.source_locator}: ${occurrence.raw}`.slice(0, 2_000);
      const key = localMoneyOccurrenceKey(
        sourceFileIdValue,
        occurrence.krw,
        occurrence.raw,
        sourceQuote,
      );
      expectedByKey.set(key, [...(expectedByKey.get(key) ?? []), occurrence]);
    }
  }

  const issues: ValidationIssue[] = [];
  for (const [index, occurrence] of (data.money_occurrences ?? []).entries()) {
    const issuePath = `money_occurrences[${index}]`;
    if (occurrence.source_file_ids.length !== 1) {
      issues.push({
        severity: "error",
        code: "local_money_audit_source_scope_invalid",
        path: `${issuePath}.source_file_ids`,
        message: "로컬 금액 감사 항목은 정확히 한 원본 파일에 귀속되어야 합니다.",
      });
      continue;
    }
    const key = localMoneyOccurrenceKey(
      occurrence.source_file_ids[0]!,
      occurrence.amount_krw,
      occurrence.raw_text,
      occurrence.source_quote,
    );
    const candidates = expectedByKey.get(key);
    if (!candidates || candidates.length === 0) {
      issues.push({
        severity: "error",
        code: "local_money_audit_not_in_source",
        path: issuePath,
        message: "로컬 감사 원장의 금액·원문·발생 위치 조합을 해당 원본에서 정확히 확인할 수 없습니다.",
      });
      continue;
    }
    candidates.shift();
  }

  const missingAuditOccurrences = [...expectedByKey.values()].flat();
  if (missingAuditOccurrences.length > 0) {
    issues.push({
      severity: "error",
      code: "local_money_audit_missing_source_occurrence",
      path: "money_occurrences",
      message: `로컬 감사 원장이 원문 금액 발생 ${missingAuditOccurrences.length}건을 보존하지 못했습니다.`,
    });
  }

  return { issues };
}

export function parseKoreanMoneyAmounts(text: string): number[] {
  return [...new Set(sourceMoneyOccurrences(
    text.normalize("NFKC"),
    null,
    text,
    "quote",
  ).map((occurrence) => occurrence.krw))];
}

/**
 * Parse money from the exact evidence fragments rather than from the merged
 * JSON envelope. For XLSX fragments the source scanner is replayed per source
 * file and sheet, so a cited unit/header cell may ground a bare cited value
 * without letting context leak across files or worksheets.
 */
function parseEvidenceQuoteMoneyAmounts(quote: string): number[] {
  const decoded = decodeEvidenceQuote(quote);
  if (decoded.kind === "single") return parseKoreanMoneyAmounts(decoded.quote);
  if (decoded.kind === "invalid") return [];

  const groupedXlsx = new Map<string, string[]>();
  const independent: string[] = [];
  for (const fragment of decoded.fragments) {
    const parsed = parseXlsxEvidenceLine(fragment.quote, true);
    if (!parsed) {
      independent.push(fragment.quote);
      continue;
    }
    const separator = parsed.locator.lastIndexOf("!");
    if (separator < 1) {
      independent.push(fragment.quote);
      continue;
    }
    const sheet = parsed.locator.slice(0, separator);
    const key = `${fragment.source_file_id}\0${sheet}`;
    groupedXlsx.set(key, [...(groupedXlsx.get(key) ?? []), fragment.quote]);
  }

  return [...new Set([
    ...independent.flatMap((fragment) => parseKoreanMoneyAmounts(fragment)),
    ...[...groupedXlsx.values()].flatMap((fragments) =>
      scanSourceMoneyOccurrences(fragments.join("\n")).map(({ krw }) => krw)
    ),
  ])];
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function evidenceContainsQuote(
  quote: string,
  evidence: Pick<ValidationEvidenceContext, "normalizedText" | "xlsxCells" | "xlsxAuxiliary" | "lineEvidence" | "pdfLayoutMoney">,
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
  const pdfQuote = parsePdfLayoutEvidenceQuote(quote);
  if (pdfQuote) {
    return (evidence.pdfLayoutMoney?.[pdfQuote.locator] ?? []).some((entry) => (
      entry.krw === pdfQuote.krw
      && entry.lineContent === normalizeEvidenceText(pdfQuote.lineContent)
    ));
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
  const pdf = parsePdfLayoutEvidenceQuote(quote);
  if (pdf) return normalizeEvidenceText(pdf.lineContent);
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

/**
 * A local structured section may faithfully join text split across PDF rows.
 * Treat that join as authoritative only when every merged fragment is an exact
 * line quote from one source and the locators retain strict source order.
 * Arbitrary fragment reordering and cross-document composition stay rejected.
 */
function boundedOrderedLineEvidenceComposite(quote: string): string | null {
  const decoded = decodeEvidenceQuote(quote);
  if (decoded.kind !== "merged") return null;
  if (new Set(decoded.fragments.map(({ source_file_id }) => source_file_id)).size !== 1) {
    return null;
  }
  const lines = decoded.fragments.map(({ quote: fragmentQuote }) => (
    parseLineEvidenceQuote(fragmentQuote)
  ));
  if (lines.some((line) => line === null)) return null;
  const exactLines = lines as ParsedLineEvidenceQuote[];
  if (exactLines.some((line, index) => (
    index > 0 && line.lineNumber <= exactLines[index - 1]!.lineNumber
  ))) return null;
  const composite = normalizeEvidenceText(
    exactLines.map(({ lineContent }) => lineContent).join(" "),
  );
  return composite || null;
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
    "부가세",
    "부가 가치세",
    "vat",
    "pricing basis",
    "price basis",
  ],
  refund_policy: ["환불", "환급", "반환", "refund"],
  penalty: ["위약금", "위약", "해약금", "취소 수수료", "penalty"],
  contract_terms: [
    "계약 조건",
    "계약조건",
    "계약 조항",
    "계약조항",
    "계약 해지",
    "계약해지",
    "취소",
    "해약",
    "약관",
    "contract terms",
  ],
  reservation: ["예약", "계약금", "reservation"],
  validity: ["유효", "적용 기간", "적용기간", "validity"],
  included_items: ["포함", "구성", "included"],
  usage_guide: ["이용 안내", "이용안내", "사용 안내", "사용안내", "usage guide"],
  notice: ["안내", "유의", "주의", "공지", "notice"],
  other: ["기타", "other"],
};

const LOCAL_PRICING_BASIS_EVIDENCE_LABELS = [
  "가격",
  "금액",
  "총 비용",
  "계약금",
  "중도금",
  "잔금",
] as const;

const POLICY_TYPE_EVIDENCE_LABELS: Readonly<Record<
  NonNullable<DisclosureExtraction["partner_vendors"][number]["policies"]>[number]["policy_type"],
  readonly string[]
>> = {
  penalty: ["위약금", "위약", "해약금", "취소", "취소 수수료", "penalty"],
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

const LOCAL_PARTNER_CATEGORY_EVIDENCE_LABELS: typeof PARTNER_CATEGORY_EVIDENCE_LABELS = {
  ...PARTNER_CATEGORY_EVIDENCE_LABELS,
  // The deterministic parser classifies studio rows from exact album-spec
  // cells as well as explicit category headers. Keep this broader vocabulary
  // confined to the local, review-only validation path.
  studio: ["스튜디오", "스냅", "앨범", "페이지", "작가 추가", "studio"],
  // Traditional Korean wedding attire is clothing in the public four-tab
  // taxonomy. Accept only exact source vocabulary; never infer it from a
  // business name that lacks one of these audited attire terms.
  dress: [
    "드레스",
    "한복",
    "상의원",
    "명주실크",
    "명주 실크",
    "본견실크",
    "본견 실크",
    "혼방실크",
    "혼방 실크",
    "우리옷",
    "dress",
  ],
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
  localReviewOnly = false,
): void {
  if (!evidence) return;
  const payloads = boundedEvidencePayloads(section.source_quote);
  if (!payloads) return;
  const orderedLineComposite = localReviewOnly
    ? boundedOrderedLineEvidenceComposite(section.source_quote)
    : null;
  let requiresReview = false;
  for (const [field, value] of [
    ["title", section.title],
    ["content_verbatim", section.content_verbatim],
  ] as const) {
    if (
      boundedEvidenceContainsField(payloads, value)
      || (
        orderedLineComposite !== null
        && orderedLineComposite.includes(normalizeEvidenceText(value))
      )
    ) continue;
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
    section.section_type !== "other"
    &&
    !exactFormulaGroundsPricingBasis
    && !boundedEvidenceContainsAnyLabel(
      orderedLineComposite === null ? payloads : [...payloads, orderedLineComposite],
      section.section_type === "pricing_basis" && localReviewOnly
        ? [
            ...SECTION_TYPE_EVIDENCE_LABELS.pricing_basis,
            ...LOCAL_PRICING_BASIS_EVIDENCE_LABELS,
          ]
        : SECTION_TYPE_EVIDENCE_LABELS[section.section_type],
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
  if (
    policy.policy_type !== "other"
    && !boundedEvidenceContainsAnyLabel(
    payloads,
    POLICY_TYPE_EVIDENCE_LABELS[policy.policy_type],
    )
  ) {
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
  // `other` is the fail-closed, unclassified bucket rather than an asserted
  // business type. Requiring the literal word "other"/"기타" would reject
  // source-backed vendors such as hanbok or accessory businesses simply
  // because the four public discovery categories do not describe them.
  // They remain pending/needs-review and are not coerced into a public tab.
  if (
    vendor.category !== "other"
    && !boundedEvidenceContainsAnyLabel(
      payloads,
      PARTNER_CATEGORY_EVIDENCE_LABELS[vendor.category],
    )
  ) {
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
    const quotedAmounts = parseEvidenceQuoteMoneyAmounts(quote);
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
      pdfLayoutMoney?: PdfLayoutMoneyEvidenceIndex;
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
      pdfLayoutMoney: referenced.reduce<PdfLayoutMoneyEvidenceIndex>((result, value) => {
        for (const [locator, candidates] of Object.entries(value.pdfLayoutMoney ?? {})) {
          result[locator] = [...(result[locator] ?? []), ...candidates];
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
  const addQuote = (path: string, value: string | null | undefined): void => {
    if (!value) return;
    const decoded = decodeEvidenceQuote(value);
    if (decoded.kind !== "merged") {
      add(path, value);
      return;
    }
    for (const fragment of decoded.fragments) {
      add(path, boundedSingleQuotePayload(fragment.quote) ?? fragment.quote);
    }
  };
  data.agency_packages.forEach((item, index) => {
    add(`agency_packages[${index}].package_name`, item.package_name);
    add(`agency_packages[${index}].vat_note`, item.vat_note);
    add(`agency_packages[${index}].price_note`, item.price_note);
    addQuote(`agency_packages[${index}].source_quote`, item.source_quote);
    item.options.forEach((option, optionIndex) => {
      const path = `agency_packages[${index}].options[${optionIndex}]`;
      add(`${path}.name`, option.name);
      add(`${path}.condition`, option.condition);
      add(`${path}.raw_text`, option.raw_text);
      addQuote(`${path}.source_quote`, option.source_quote);
    });
  });
  (data.halls ?? []).forEach((hall, index) => {
    const path = `halls[${index}]`;
    add(`${path}.hall_name`, hall.hall_name);
    add(`${path}.venue_fee_note`, hall.venue_fee_note);
    add(`${path}.decoration_note`, hall.decoration_note);
    addQuote(`${path}.source_quote`, hall.source_quote);
    hall.options.forEach((option, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      add(`${optionPath}.name`, option.name);
      add(`${optionPath}.condition`, option.condition);
      add(`${optionPath}.raw_text`, option.raw_text);
      addQuote(`${optionPath}.source_quote`, option.source_quote);
    });
  });
  (data.sections ?? []).forEach((section, index) => {
    const path = `sections[${index}]`;
    add(`${path}.title`, section.title);
    add(`${path}.content_verbatim`, section.content_verbatim);
    add(`${path}.summary`, section.summary);
    addQuote(`${path}.source_quote`, section.source_quote);
  });
  data.partner_vendors.forEach((item, index) => {
    add(`partner_vendors[${index}].vendor_name`, item.vendor_name);
    add(`partner_vendors[${index}].base_spec`, item.base_spec);
    add(`partner_vendors[${index}].price_note`, item.price_note);
    addQuote(`partner_vendors[${index}].source_quote`, item.source_quote);
    item.options.forEach((option, optionIndex) => {
      const path = `partner_vendors[${index}].options[${optionIndex}]`;
      add(`${path}.name`, option.name);
      add(`${path}.condition`, option.condition);
      add(`${path}.raw_text`, option.raw_text);
      addQuote(`${path}.source_quote`, option.source_quote);
    });
    (item.policies ?? []).forEach((policy, policyIndex) => {
      const path = `partner_vendors[${index}].policies[${policyIndex}]`;
      add(`${path}.raw_text`, policy.raw_text);
      addQuote(`${path}.source_quote`, policy.source_quote);
    });
  });
  addQuote("hall.venue_fee_source_quote", data.hall.venue_fee_source_quote);
  addQuote("hall.meal_price_source_quote", data.hall.meal_price_source_quote);
  data.hall.items.forEach((item, index) => {
    add(`hall.items[${index}].name`, item.name);
    add(`hall.items[${index}].raw_text`, item.raw_text);
    addQuote(`hall.items[${index}].source_quote`, item.source_quote);
  });
  return fields;
}

export function validateExtractionForUnit(
  unit: ManifestUnit,
  data: DisclosureExtraction,
  evidence?: ValidationEvidenceContext,
  options: { mode?: "local_deterministic" } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const localReviewOnly = options.mode === "local_deterministic"
    && /(?:^|\n)\[local_evidence_guard\]/u.test(data.extraction_notes);
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
      severity: localReviewOnly && canonicalBusinessIdentityMatchesUnit(unit, data.business_name)
        ? "warning"
        : "error",
      code: localReviewOnly && canonicalBusinessIdentityMatchesUnit(unit, data.business_name)
        ? "identity_only_no_price"
        : "no_price_records",
      path: "data",
      message: localReviewOnly && canonicalBusinessIdentityMatchesUnit(unit, data.business_name)
        ? "가격은 구조화하지 않고 원본 파일명에서 확정된 업체 정체성만 pending으로 보존합니다. 자동 승인과 일반 공개 대상이 아닙니다."
        : "적재 가능한 가격 값이 하나도 없어 사람 검토 전까지 staging 적재를 차단했습니다.",
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
  if (data.business_name && !canonicalBusinessIdentityMatchesUnit(unit, data.business_name)) {
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
    validateSectionSemanticGrounding(
      section,
      sectionPath,
      issues,
      sectionProvenance.evidence,
      localReviewOnly,
    );
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

async function readExistingLocalValidated(
  filePath: string,
  expected: {
    stateDir: string;
    fingerprint: string;
    unitId: string;
    sourceFingerprint: string;
    extractionFingerprint: string;
    extractionContentSha256: string;
    engineVersion: string;
    engineHash: string;
    sourceFiles: LocalValidatedArtifact["source_files"];
    visualTranscription: VisualTranscriptionExtractionBinding | null;
  },
): Promise<LocalValidatedArtifact | null> {
  try {
    await verifyDeterministicStateArtifactPath({
      stateDir: expected.stateDir,
      artifactPath: filePath,
      expectedRelativePath: path.join("validated", `${expected.unitId}.json`),
    });
    const raw = await readJsonFile(filePath);
    const parsed = LocalValidatedArtifactSchema.safeParse(raw);
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
        && artifact.provider_mode === LOCAL_DETERMINISTIC_PROVIDER_MODE
        && artifact.model === LOCAL_DETERMINISTIC_MODEL
        && artifact.engine_version === expected.engineVersion
        && artifact.engine_hash === expected.engineHash
        && artifact.needs_review
        && !artifact.bulk_approval_eligible
        && isDeepStrictEqual(
          artifact.visual_transcription ?? null,
          expected.visualTranscription,
        )
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

export interface DeriveValidatedPayloadOptions {
  mode?: "paid_or_test" | "local_deterministic";
  visualTranscription?: LoadedVisualTranscriptionSidecar | null;
}

interface ValidationExtractionInput {
  data: DisclosureExtraction;
  evidence_modalities?: ReturnType<
    typeof StrictExtractionArtifactSchema.parse
  >["evidence_modalities"];
}

function forceLocalValidationReviewOnly(data: DisclosureExtraction): void {
  for (const row of data.agency_packages) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, 0.5);
  }
  for (const row of data.partner_vendors) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, 0.5);
  }
  for (const row of data.halls ?? []) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, 0.5);
  }
  for (const row of data.sections ?? []) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, 0.5);
  }
  for (const row of data.money_occurrences ?? []) row.needs_review = true;
  data.hall.needs_review = true;
  data.hall.confidence = Math.min(data.hall.confidence, 0.5);
  for (const row of data.hall.items) {
    row.needs_review = true;
    row.confidence = Math.min(row.confidence, 0.5);
  }
  if (!/(?:^|\n)\[local_evidence_guard\]/u.test(data.extraction_notes)) {
    data.extraction_notes = [
      "[local_evidence_guard]",
      data.extraction_notes,
    ].filter(Boolean).join("\n").slice(0, 4_000);
  }
}

function sourceQuoteLocators(quote: string): string[] {
  const decoded = decodeEvidenceQuote(quote);
  const quotes = decoded.kind === "single"
    ? [decoded.quote]
    : decoded.kind === "merged"
      ? decoded.fragments.map((fragment) => fragment.quote)
      : [];
  return quotes.flatMap((fragment) => {
    const located = /^(.+![A-Z]+\d+):/iu.exec(normalizeEvidenceText(fragment));
    return located ? [located[1]!] : [];
  });
}

function localLinkedCategoryIsGroundedInSheetLocator(
  data: DisclosureExtraction,
  issuePath: string,
): boolean {
  const matched = /^partner_vendors\[(\d+)\](?:\.options\[(\d+)\])?\.source_quote$/u.exec(
    issuePath,
  );
  if (!matched) return false;
  const vendor = data.partner_vendors[Number(matched[1])];
  if (!vendor) return false;
  const quote = matched[2] === undefined
    ? vendor.source_quote
    : vendor.options[Number(matched[2])]?.source_quote;
  return quote !== undefined && boundedEvidenceContainsAnyLabel(
    sourceQuoteLocators(quote),
    LOCAL_PARTNER_CATEGORY_EVIDENCE_LABELS[vendor.category],
  );
}

const LOCAL_GENERIC_BUSINESS_HEADER_PATTERN = /^(?:사업자명|사업체명|사용자명|업체명|브랜드명|상호명|스튜디오명|드레스(?:샵)?명|메이크업(?:샵)?명)$/u;

function localGenericTableOrderCategoryIsGrounded(
  data: DisclosureExtraction,
  issuePath: string,
  evidence: ValidationEvidenceContext,
): boolean {
  const categoryMatch = /^partner_vendors\[(\d+)\]\.category$/u.exec(issuePath);
  const quoteMatch = /^partner_vendors\[(\d+)\](?:\.options\[(\d+)\])?\.source_quote$/u.exec(
    issuePath,
  );
  const vendorIndex = Number(categoryMatch?.[1] ?? quoteMatch?.[1]);
  if (!Number.isSafeInteger(vendorIndex)) return false;
  const vendor = data.partner_vendors[vendorIndex];
  if (!vendor) return false;
  const option = quoteMatch?.[2] === undefined
    ? null
    : vendor.options[Number(quoteMatch[2])] ?? null;
  const quote = option?.source_quote ?? vendor.source_quote;
  const sourceFileIds = option?.source_file_ids ?? vendor.source_file_ids ?? [];
  const quotedLocators = new Set(sourceQuoteLocators(quote));
  const categoryOrder: DisclosureExtraction["partner_vendors"][number]["category"][] = [
    "studio",
    "dress",
    "makeup",
  ];

  return sourceFileIds.some((sourceFileIdValue) => {
    const cells = evidence.bySourceFileId?.[sourceFileIdValue]?.xlsxCells;
    if (!cells) return false;
    for (const locator of quotedLocators) {
      const parsed = /^(.*)!([A-Z]+)(\d+)$/iu.exec(locator);
      if (!parsed) continue;
      const [, sheet, column, rowText] = parsed;
      if (!/^Sheet\d*$/iu.test(sheet!)) continue;
      if (!(cells[locator] ?? []).some((value) => (
        LOCAL_GENERIC_BUSINESS_HEADER_PATTERN.test(normalizeEvidenceText(value))
      ))) continue;
      const headers = Object.entries(cells).flatMap(([candidateLocator, values]) => {
        const candidate = /^(.*)!([A-Z]+)(\d+)$/iu.exec(candidateLocator);
        if (
          !candidate
          || candidate[1] !== sheet
          || candidate[2]?.toLocaleUpperCase("en-US") !== column?.toLocaleUpperCase("en-US")
          || !values.some((value) => (
            LOCAL_GENERIC_BUSINESS_HEADER_PATTERN.test(normalizeEvidenceText(value))
          ))
        ) return [];
        return [{ locator: candidateLocator, row: Number.parseInt(candidate[3]!, 10) }];
      }).sort((left, right) => left.row - right.row);
      if (headers.length !== 3) continue;
      const headerIndex = headers.findIndex((header) => (
        header.locator === locator && header.row === Number.parseInt(rowText!, 10)
      ));
      if (headerIndex >= 0 && categoryOrder[headerIndex] === vendor.category) return true;
    }
    return false;
  });
}

interface LocalStructuredEvidenceExpectation {
  quote: string;
  sourceFileIds: string[];
  requiredFields: string[];
  requiredLabelGroups: readonly (readonly string[])[];
  amounts: number[];
  normalizedIdentityFields?: string[];
}

function localStructuredEvidenceExpectation(
  data: DisclosureExtraction,
  issuePath: string,
): LocalStructuredEvidenceExpectation | null {
  const agency = /^agency_packages\[(\d+)\](?:\.options\[(\d+)\])?\.source_quote$/u.exec(
    issuePath,
  );
  if (agency) {
    const row = data.agency_packages[Number(agency[1])];
    if (!row) return null;
    const option = agency[2] === undefined ? null : row.options[Number(agency[2])] ?? null;
    return {
      quote: option?.source_quote ?? row.source_quote,
      sourceFileIds: option?.source_file_ids ?? row.source_file_ids ?? [],
      requiredFields: [
        row.package_name,
        ...(option ? [option.name, option.raw_text] : []),
      ],
      requiredLabelGroups: row.category_scope.map((category) =>
        AGENCY_CATEGORY_EVIDENCE_LABELS[category]
      ),
      amounts: validMoneyValues(
        ...(option
          ? [option.price_min_krw, option.price_max_krw]
          : [row.price_min_krw, row.price_max_krw]),
      ),
    };
  }

  const policy = /^partner_vendors\[(\d+)\]\.policies\[(\d+)\]\.source_quote$/u.exec(
    issuePath,
  );
  if (policy) {
    const vendor = data.partner_vendors[Number(policy[1])];
    const row = vendor?.policies?.[Number(policy[2])];
    if (!vendor || !row) return null;
    return {
      quote: row.source_quote,
      sourceFileIds: row.source_file_ids,
      requiredFields: [vendor.vendor_name, row.raw_text],
      requiredLabelGroups: row.policy_type === "other"
        ? []
        : [POLICY_TYPE_EVIDENCE_LABELS[row.policy_type]],
      amounts: [],
    };
  }

  const partner = /^partner_vendors\[(\d+)\](?:\.options\[(\d+)\])?\.source_quote$/u.exec(
    issuePath,
  );
  if (partner) {
    const vendor = data.partner_vendors[Number(partner[1])];
    if (!vendor) return null;
    const option = partner[2] === undefined ? null : vendor.options[Number(partner[2])] ?? null;
    return {
      quote: option?.source_quote ?? vendor.source_quote,
      sourceFileIds: option?.source_file_ids ?? vendor.source_file_ids ?? [],
      requiredFields: [
        vendor.vendor_name,
        ...(option ? [option.name, option.raw_text] : []),
      ],
      requiredLabelGroups: [LOCAL_PARTNER_CATEGORY_EVIDENCE_LABELS[vendor.category]],
      amounts: validMoneyValues(
        ...(option
          ? [option.price_min_krw, option.price_max_krw]
          : [vendor.price_min_krw, vendor.price_max_krw]),
      ),
    };
  }

  const hall = /^halls\[(\d+)\](?:\.options\[(\d+)\])?\.source_quote$/u.exec(issuePath);
  if (hall) {
    const row = data.halls?.[Number(hall[1])];
    if (!row || row.hall_name === null) return null;
    const option = hall[2] === undefined ? null : row.options[Number(hall[2])] ?? null;
    return {
      quote: option?.source_quote ?? row.source_quote,
      sourceFileIds: option?.source_file_ids ?? row.source_file_ids,
      requiredFields: [
        ...(option ? [option.name, option.raw_text] : []),
      ],
      requiredLabelGroups: [],
      normalizedIdentityFields: [row.hall_name],
      amounts: validMoneyValues(
        ...(option
          ? [option.price_min_krw, option.price_max_krw]
          : [
              row.meal_price_min_krw,
              row.meal_price_max_krw,
              row.venue_fee_min_krw,
              row.venue_fee_max_krw,
              row.decoration_fee_min_krw,
              row.decoration_fee_max_krw,
            ]),
      ),
    };
  }
  return null;
}

function normalizeLocalIdentity(value: string): string {
  return normalizeEvidenceText(value)
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase("ko-KR");
}

function localEvidenceQuoteIsExact(
  expectation: LocalStructuredEvidenceExpectation,
  evidence: ValidationEvidenceContext,
): boolean {
  const decoded = decodeEvidenceQuote(expectation.quote);
  if (decoded.kind === "invalid") return false;
  const fragments = decoded.kind === "single"
    ? expectation.sourceFileIds.length === 1
      ? [{ source_file_id: expectation.sourceFileIds[0]!, quote: decoded.quote }]
      : []
    : decoded.fragments;
  if (fragments.length === 0) return false;
  if (!sameStringSet(
    [...new Set(fragments.map(({ source_file_id }) => source_file_id))],
    expectation.sourceFileIds,
  )) return false;
  return fragments.every((fragment) => {
    const sourceEvidence = evidence.bySourceFileId?.[fragment.source_file_id];
    return sourceEvidence !== undefined && evidenceContainsQuote(fragment.quote, sourceEvidence);
  });
}

export function payloadContainsExactMoneyRaw(payload: string, raw: string): boolean {
  const normalizedPayload = normalizeEvidenceText(payload);
  const normalizedRaw = normalizeEvidenceText(raw);
  if (!normalizedRaw) return false;
  let fromIndex = 0;
  while (fromIndex <= normalizedPayload.length - normalizedRaw.length) {
    const index = normalizedPayload.indexOf(normalizedRaw, fromIndex);
    if (index < 0) return false;
    const before = index > 0 ? normalizedPayload[index - 1]! : "";
    const after = index + normalizedRaw.length < normalizedPayload.length
      ? normalizedPayload[index + normalizedRaw.length]!
      : "";
    if (!/[\d,.]/u.test(before) && !/[\d,.]/u.test(after)) return true;
    fromIndex = index + 1;
  }
  return false;
}

function localSourceScannerGroundsAmounts(
  expectation: LocalStructuredEvidenceExpectation,
  sourceMoneyByFileId: LocalSourceMoneyIndex,
): boolean {
  if (expectation.amounts.length === 0) return true;
  const decoded = decodeEvidenceQuote(expectation.quote);
  if (decoded.kind === "invalid") return false;
  const fragments = decoded.kind === "single"
    ? expectation.sourceFileIds.length === 1
      ? [{ source_file_id: expectation.sourceFileIds[0]!, quote: decoded.quote }]
      : []
    : decoded.fragments;
  const locatedFragments = fragments.flatMap((fragment) => {
    const xlsx = parseXlsxEvidenceLine(fragment.quote, true);
    if (xlsx) {
      return [{
        sourceFileId: fragment.source_file_id,
        locator: xlsx.locator,
        payload: xlsx.cellContent,
      }];
    }
    const line = parseLineEvidenceQuote(fragment.quote);
    if (line) return [{
          sourceFileId: fragment.source_file_id,
          locator: line.locator,
          payload: line.lineContent,
        }];
    const pdf = parsePdfLayoutEvidenceQuote(fragment.quote);
    return pdf ? [{
      sourceFileId: fragment.source_file_id,
      locator: pdf.locator,
      payload: pdf.lineContent,
    }] : [];
  });
  return expectation.amounts.every((amount) => locatedFragments.some((fragment) =>
    (sourceMoneyByFileId.get(fragment.sourceFileId) ?? []).some((occurrence) =>
      occurrence.krw === amount
      && fragment.locator === occurrence.source_locator
      && payloadContainsExactMoneyRaw(fragment.payload, occurrence.raw)
    )
  ));
}

function localStructuredEvidenceCoreIsGrounded(
  expectation: LocalStructuredEvidenceExpectation,
  evidence: ValidationEvidenceContext,
  sourceMoneyByFileId: LocalSourceMoneyIndex,
): boolean {
  if (!localEvidenceQuoteIsExact(expectation, evidence)) return false;
  const payloads = boundedEvidencePayloads(expectation.quote);
  if (!payloads) return false;
  if (!expectation.requiredFields.every((field) =>
    boundedEvidenceContainsField(payloads, field)
  )) return false;
  if (!(expectation.normalizedIdentityFields ?? []).every((field) => {
    const identity = normalizeLocalIdentity(field);
    return identity.length > 0 && payloads.some((payload) => (
      normalizeLocalIdentity(payload).includes(identity)
    ));
  })) return false;
  return localSourceScannerGroundsAmounts(expectation, sourceMoneyByFileId);
}

function localStructuredEvidenceIsGrounded(
  data: DisclosureExtraction,
  issuePath: string,
  evidence: ValidationEvidenceContext,
  sourceMoneyByFileId: LocalSourceMoneyIndex,
): boolean {
  const expectation = localStructuredEvidenceExpectation(data, issuePath);
  if (!expectation || !localStructuredEvidenceCoreIsGrounded(
    expectation,
    evidence,
    sourceMoneyByFileId,
  )) return false;
  const payloads = boundedEvidencePayloads(expectation.quote);
  return Boolean(payloads && expectation.requiredLabelGroups.every((labels) =>
    boundedEvidenceContainsAnyLabel(
      [...payloads, ...sourceQuoteLocators(expectation.quote)],
      labels,
    )
  ));
}

function localCategoryIssueIsGrounded(
  data: DisclosureExtraction,
  issuePath: string,
  evidence: ValidationEvidenceContext,
  sourceMoneyByFileId: LocalSourceMoneyIndex,
): boolean {
  const partner = /^partner_vendors\[(\d+)\]\.category$/u.exec(issuePath);
  if (partner) {
    return localStructuredEvidenceIsGrounded(
      data,
      `partner_vendors[${partner[1]}].source_quote`,
      evidence,
      sourceMoneyByFileId,
    );
  }
  const agency = /^agency_packages\[(\d+)\]\.category_scope\[\d+\]$/u.exec(issuePath);
  return agency !== null && localStructuredEvidenceIsGrounded(
    data,
    `agency_packages[${agency[1]}].source_quote`,
    evidence,
    sourceMoneyByFileId,
  );
}

function localGenericTableRecordEvidenceIsGrounded(
  data: DisclosureExtraction,
  issuePath: string,
  evidence: ValidationEvidenceContext,
  sourceMoneyByFileId: LocalSourceMoneyIndex,
): boolean {
  if (!localGenericTableOrderCategoryIsGrounded(data, issuePath, evidence)) return false;
  const expectation = localStructuredEvidenceExpectation(data, issuePath);
  return Boolean(
    expectation
    && localStructuredEvidenceCoreIsGrounded(expectation, evidence, sourceMoneyByFileId),
  );
}

function localStructuredOptionEvidenceIsGrounded(
  data: DisclosureExtraction,
  issuePath: string,
  evidence: ValidationEvidenceContext,
  sourceMoneyByFileId: LocalSourceMoneyIndex,
): boolean {
  const expectation = localStructuredEvidenceExpectation(data, issuePath);
  if (!expectation || !localStructuredEvidenceCoreIsGrounded(
    expectation,
    evidence,
    sourceMoneyByFileId,
  )) return false;
  const payloads = boundedEvidencePayloads(expectation.quote);
  if (!payloads) return false;
  const explicitlyGrounded = expectation.requiredLabelGroups.every((labels) =>
    boundedEvidenceContainsAnyLabel(
      [...payloads, ...sourceQuoteLocators(expectation.quote)],
      labels,
    )
  );
  return explicitlyGrounded
    || localGenericTableOrderCategoryIsGrounded(data, issuePath, evidence)
    || localLinkedCategoryIsGroundedInSheetLocator(data, issuePath);
}

function normalizedHallQuotePayloads(sourceQuote: string): string[] {
  return (boundedEvidencePayloads(sourceQuote) ?? [])
    .map((payload) => payload.normalize("NFKC").replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

function hasVenueFeeLabel(value: string): boolean {
  return /대관(?:료|비)?/u.test(value);
}

function hasDecorationFeeLabel(value: string): boolean {
  return /(?:(?:생화|꽃|플라워)\s*)?장식(?:료|비)?/u.test(value);
}

function decorationFeeExplicitlyAbsent(value: string): boolean {
  return /(?:장식(?:료|비)?|(?:생화|꽃|플라워)\s*(?:장식|데코))\s*(?:없음|무료|0\s*원)/u.test(value);
}

function sourceQuoteLocatorReferences(
  quote: string,
  sourceFileIds: readonly string[],
): Array<{ sourceFileId: string; locator: string }> {
  const decoded = decodeEvidenceQuote(quote);
  const fragments = decoded.kind === "single"
    ? sourceFileIds.length === 1
      ? [{ source_file_id: sourceFileIds[0]!, quote: decoded.quote }]
      : []
    : decoded.kind === "merged"
      ? decoded.fragments
      : [];
  return fragments.flatMap((fragment) => {
    const parsed = parseXlsxEvidenceLine(fragment.quote, true);
    return parsed
      ? [{ sourceFileId: fragment.source_file_id, locator: parsed.locator }]
      : [];
  });
}

type HallFeeRowLabelKind = "venue" | "decoration" | "combined" | "other";

interface HallFeeRowTopology {
  amount: number;
  kind: HallFeeRowLabelKind;
  labelCited: boolean;
}

function hallFeeRowLabelKind(value: string): HallFeeRowLabelKind {
  const venue = hasVenueFeeLabel(value);
  const decoration = hasDecorationFeeLabel(value);
  if (venue && decoration) return "combined";
  if (venue) return "venue";
  if (decoration) return "decoration";
  return "other";
}

/**
 * Resolve only a physically adjacent `label | amount` pair on the same XLSX
 * row. A hidden combined row label is enough to quarantine an assignment, but
 * a dedicated label is allowed to prove a split only when both its locator and
 * the amount locator are present in the record's exact source quote.
 */
function hallFeeRowTopologies(
  quote: string,
  sourceFileIds: readonly string[],
  amounts: readonly (number | null)[],
  evidence: ValidationEvidenceContext,
): HallFeeRowTopology[] {
  const assigned = new Set(amounts.filter((value): value is number => value !== null));
  if (assigned.size === 0) return [];
  const references = sourceQuoteLocatorReferences(quote, sourceFileIds);
  const cited = new Set(references.map((reference) => (
    `${reference.sourceFileId}\0${reference.locator}`
  )));
  return references.flatMap((reference): HallFeeRowTopology[] => {
    const valueMatch = /^(.*)!([A-Z]+)(\d+)$/iu.exec(reference.locator);
    const cells = evidence.bySourceFileId?.[reference.sourceFileId]?.xlsxCells;
    if (!valueMatch || !cells) return [];
    const valuePayloads = cells[reference.locator] ?? [];
    const matchingAmounts = [...new Set(valuePayloads.flatMap((payload) => (
      parseKoreanMoneyAmounts(payload).filter((amount) => assigned.has(amount))
    )))];
    if (matchingAmounts.length === 0) return [];
    const [, sheet, valueColumn, row] = valueMatch;
    const preceding = Object.entries(cells).flatMap(([locator, payloads]) => {
      const candidate = /^(.*)!([A-Z]+)(\d+)$/iu.exec(locator);
      if (
        !candidate
        || candidate[1] !== sheet
        || candidate[3] !== row
        || xlsxColumnNumber(candidate[2]!) !== xlsxColumnNumber(valueColumn!) - 1
      ) return [];
      return payloads
        .filter((payload) => parseKoreanMoneyAmounts(payload).length === 0)
        .map((payload) => ({ locator, payload }));
    })[0];
    if (!preceding) return [];
    const kind = hallFeeRowLabelKind(preceding.payload);
    return matchingAmounts.map((amount) => ({
      amount,
      kind,
      labelCited: cited.has(`${reference.sourceFileId}\0${preceding.locator}`),
    }));
  });
}

function hallAmountHasCombinedFeeRowLabel(
  quote: string,
  sourceFileIds: readonly string[],
  amounts: readonly (number | null)[],
  evidence: ValidationEvidenceContext,
): boolean {
  return hallFeeRowTopologies(quote, sourceFileIds, amounts, evidence)
    .some(({ kind }) => kind === "combined");
}

function hallAmountsHaveDedicatedFeeRowLabels(
  quote: string,
  sourceFileIds: readonly string[],
  amounts: readonly (number | null)[],
  expected: "venue" | "decoration",
  evidence: ValidationEvidenceContext,
): boolean {
  const assigned = [...new Set(amounts.filter((value): value is number => value !== null))];
  if (assigned.length === 0) return false;
  const topologies = hallFeeRowTopologies(quote, sourceFileIds, assigned, evidence);
  return assigned.every((amount) => topologies.some((topology) => (
    topology.amount === amount
    && topology.kind === expected
    && topology.labelCited
  )));
}

function canonicalBusinessIdentityMatchesUnit(
  unit: ManifestUnit,
  businessName: string | null,
): boolean {
  return Boolean(businessName && [
    unit.parsed.raw_name,
    unit.parsed.corporate_name,
  ].filter((value): value is string => Boolean(value)).some((value) =>
    normalizeVendorName(businessName ?? "") === normalizeVendorName(value)
  ));
}

function exactFullSourcePayloads(
  quote: string,
  sourceFileIds: readonly string[],
  evidence: ValidationEvidenceContext,
): string[] {
  const decoded = decodeEvidenceQuote(quote);
  if (decoded.kind === "invalid") return [];
  const fragments = decoded.kind === "single"
    ? sourceFileIds.length === 1
      ? [{ source_file_id: sourceFileIds[0]!, quote: decoded.quote }]
      : []
    : decoded.fragments;
  const payloads: string[] = [];
  for (const fragment of fragments) {
    const sourceEvidence = evidence.bySourceFileId?.[fragment.source_file_id];
    if (!sourceEvidence || !evidenceContainsQuote(fragment.quote, sourceEvidence)) continue;
    const xlsx = parseXlsxEvidenceLine(fragment.quote, true);
    if (xlsx) {
      payloads.push(...(sourceEvidence.xlsxCells?.[xlsx.locator] ?? [])
        .filter((candidate) => candidate.includes(xlsx.cellContent)));
      continue;
    }
    const line = parseLineEvidenceQuote(fragment.quote);
    if (line) {
      payloads.push(...(sourceEvidence.lineEvidence?.[line.locator] ?? [])
        .filter((candidate) => candidate.includes(line.lineContent)));
      continue;
    }
    const bounded = boundedSingleQuotePayload(fragment.quote);
    if (bounded) payloads.push(bounded);
  }
  return [...new Set(payloads.map((payload) => normalizeEvidenceText(payload)).filter(Boolean))];
}

function payloadGroundsMoney(payload: string, amount: number | null): boolean {
  return amount === null || parseKoreanMoneyAmounts(payload).includes(amount);
}

function valuesGroundedInPayloads(
  payloads: readonly string[],
  values: readonly (number | null)[],
): boolean {
  return values.every((value) => value === null || payloads.some((payload) => (
    payloadGroundsMoney(payload, value)
  )));
}

function appendReviewNote(current: string | null, note: string): string {
  if (!current) return note;
  return current.includes(note) ? current : `${current}\n${note}`;
}

/**
 * Remove unsafe commercial meaning while retaining the source ledger and the
 * source-backed entity identity. This runs before ordinary validation so a
 * quarantined value cannot reach staging merely because its number existed in
 * the cited cell.
 */
function quarantineUnsafeLocalStructuredSemantics(
  data: DisclosureExtraction,
  evidence: ValidationEvidenceContext,
  sourceMoneyByFileId: LocalSourceMoneyIndex,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const quarantineOptions = <T>(
    ownerPath: string,
    options: T[],
  ): T[] => options.filter((_option, optionIndex) => {
    const sourcePath = `${ownerPath}.options[${optionIndex}].source_quote`;
    if (localStructuredOptionEvidenceIsGrounded(
      data,
      sourcePath,
      evidence,
      sourceMoneyByFileId,
    )) {
      return true;
    }
    issues.push({
      severity: "warning",
      code: "local_ungrounded_option_quarantined",
      path: `${ownerPath}.options[${optionIndex}]`,
      message: "옵션명과 모든 금액을 동일한 정확 원문 근거로 확인할 수 없어 구조화 옵션에서 제외하고 원문 금액 원장에만 보존했습니다.",
    });
    return false;
  });

  data.agency_packages.forEach((row, rowIndex) => {
    row.options = quarantineOptions(`agency_packages[${rowIndex}]`, row.options);
  });
  data.partner_vendors.forEach((row, rowIndex) => {
    row.options = quarantineOptions(`partner_vendors[${rowIndex}]`, row.options);
  });

  (data.sections ?? []).forEach((section, sectionIndex) => {
    const payloads = boundedEvidencePayloads(section.source_quote) ?? [];
    if (boundedEvidenceContainsField(payloads, section.title)) return;
    const exactLeadingTitle = section.title
      .split(/<br\s*\/?>/iu)[0]
      ?.trim();
    if (!exactLeadingTitle || !boundedEvidenceContainsField(payloads, exactLeadingTitle)) return;
    section.title = exactLeadingTitle;
    issues.push({
      severity: "warning",
      code: "local_section_title_shortened_to_exact_source",
      path: `sections[${sectionIndex}].title`,
      message: "긴 표 머리글이 source_quote 경계를 넘어서 원문에서 그대로 확인되는 첫 제목만 보존했습니다. 전체 문구는 비공개 원본 검수에서 확인해야 합니다.",
    });
  });

  (data.halls ?? []).forEach((hall, hallIndex) => {
    const hallPath = `halls[${hallIndex}]`;
    const payloads = exactFullSourcePayloads(hall.source_quote, hall.source_file_ids, evidence);
    const combined = payloads.filter((payload) => (
      hasVenueFeeLabel(payload) && hasDecorationFeeLabel(payload)
    ));
    const venueOnly = payloads.filter((payload) => (
      hasVenueFeeLabel(payload) && !hasDecorationFeeLabel(payload)
    ));
    const decorationOnly = payloads.filter((payload) => (
      hasDecorationFeeLabel(payload) && !hasVenueFeeLabel(payload)
    ));
    const venueExplicitlyAbsent = payloads.some((payload) => (
      /대관(?:료|비)?\s*(?:없음|무료|0\s*원)/u.test(payload)
    ));
    const explicitVenueWithNoDecoration = valuesGroundedInPayloads(
      payloads.filter((payload) => (
        hasVenueFeeLabel(payload)
        && hasDecorationFeeLabel(payload)
        && decorationFeeExplicitlyAbsent(payload)
      )),
      [hall.venue_fee_min_krw, hall.venue_fee_max_krw],
    );
    const venueAssigned = hall.venue_fee_min_krw !== null || hall.venue_fee_max_krw !== null;
    const decorationAssigned = hall.decoration_fee_min_krw !== null
      || hall.decoration_fee_max_krw !== null;
    const venueAmountHasCombinedRowLabel = hallAmountHasCombinedFeeRowLabel(
      hall.source_quote,
      hall.source_file_ids,
      [hall.venue_fee_min_krw, hall.venue_fee_max_krw],
      evidence,
    );
    const decorationAmountHasCombinedRowLabel = hallAmountHasCombinedFeeRowLabel(
      hall.source_quote,
      hall.source_file_ids,
      [hall.decoration_fee_min_krw, hall.decoration_fee_max_krw],
      evidence,
    );
    const venueAmountsHaveDedicatedRowLabels = hallAmountsHaveDedicatedFeeRowLabels(
      hall.source_quote,
      hall.source_file_ids,
      [hall.venue_fee_min_krw, hall.venue_fee_max_krw],
      "venue",
      evidence,
    );
    const decorationAmountsHaveDedicatedRowLabels = hallAmountsHaveDedicatedFeeRowLabels(
      hall.source_quote,
      hall.source_file_ids,
      [hall.decoration_fee_min_krw, hall.decoration_fee_max_krw],
      "decoration",
      evidence,
    );

    if (
      venueAssigned
      && (
        venueExplicitlyAbsent
        || venueAmountHasCombinedRowLabel
        || (
          combined.length > 0
          && !venueAmountsHaveDedicatedRowLabels
          && !explicitVenueWithNoDecoration
          && !valuesGroundedInPayloads(
            venueOnly,
            [hall.venue_fee_min_krw, hall.venue_fee_max_krw],
          )
        )
      )
    ) {
      hall.venue_fee_min_krw = null;
      hall.venue_fee_max_krw = null;
      hall.venue_fee_note = appendReviewNote(
        hall.venue_fee_note,
        "대관료와 장식비의 분리 근거가 불충분하여 가격 확인이 필요합니다.",
      );
      issues.push({
        severity: "warning",
        code: "local_hall_venue_fee_quarantined",
        path: `${hallPath}.venue_fee`,
        message: "복합 대관·장식 금액 또는 대관료 없음 표기와 충돌해 대관료를 null로 격리했습니다.",
      });
    }

    if (
      decorationAssigned
      && (
        decorationAmountHasCombinedRowLabel
        || (
          combined.length > 0
          && !decorationAmountsHaveDedicatedRowLabels
        )
      )
      && !venueExplicitlyAbsent
      && !valuesGroundedInPayloads(
        decorationOnly,
        [hall.decoration_fee_min_krw, hall.decoration_fee_max_krw],
      )
    ) {
      hall.decoration_fee_min_krw = null;
      hall.decoration_fee_max_krw = null;
      hall.decoration_note = appendReviewNote(
        hall.decoration_note,
        "대관료와 장식비의 분리 근거가 불충분하여 가격 확인이 필요합니다.",
      );
      issues.push({
        severity: "warning",
        code: "local_hall_decoration_fee_quarantined",
        path: `${hallPath}.decoration_fee`,
        message: "복합 대관·장식 금액을 장식비로 단정할 수 없어 null로 격리했습니다.",
      });
    }

    const joinedPayload = payloads.join("\n");
    const hasAdultMeal = /(?:대인|성인)\s*(?:식대|식비|식사|뷔페)?/u.test(joinedPayload);
    const hasChildMeal = /(?:소인|아동|어린이)\s*(?:식대|식비|식사|뷔페)?/u.test(joinedPayload);
    if (
      hasAdultMeal
      && hasChildMeal
      && (hall.meal_price_min_krw !== null || hall.meal_price_max_krw !== null)
    ) {
      hall.meal_price_min_krw = null;
      hall.meal_price_max_krw = null;
      issues.push({
        severity: "warning",
        code: "local_hall_meal_variants_quarantined",
        path: `${hallPath}.meal_price`,
        message: "성인·소인 식대를 하나의 범위로 오해하지 않도록 대표 식대를 null로 격리하고 개별 원문 검수를 요구합니다.",
      });
    }

    hall.options = quarantineOptions(hallPath, hall.options);
  });
  return issues;
}

function exactEvidenceLocators(quote: string): string[] {
  const decoded = decodeEvidenceQuote(quote);
  const fragments = decoded.kind === "single"
    ? [decoded.quote]
    : decoded.kind === "merged"
      ? decoded.fragments.map((fragment) => fragment.quote)
      : [];
  return fragments.flatMap((fragment) => {
    const xlsx = parseXlsxEvidenceLine(fragment, true);
    if (xlsx) return [xlsx.locator];
    const line = parseLineEvidenceQuote(fragment);
    return line ? [line.locator] : [];
  });
}

/**
 * Preserve an explicit, text-backed price occurrence that cannot safely be
 * attached to a vendor option as an unlinked review section. This closes the
 * omission ledger without inventing commercial meaning. Image/OCR evidence is
 * intentionally excluded and remains a coverage gap for visual review.
 */
function preserveUnlinkedLocalPriceOccurrences(
  unit: ManifestUnit,
  data: DisclosureExtraction,
  sourceText: string,
  evidence: ValidationEvidenceContext,
  scannedCandidates: readonly CoverageGap[],
): ValidationIssue[] {
  const gaps = findCoverageGaps(sourceText, data, {
    includeAuditLedger: false,
    scannedCandidates,
  });
  if (gaps.length === 0) return [];
  const occurrences = data.money_occurrences ?? [];
  const usedOccurrences = new Set<number>();
  const sourceById = new Map(unit.source_files.map((source) => [sourceFileId(source), source]));
  const sections = data.sections ?? [];
  let preserved = 0;

  for (const gap of gaps) {
    if (sections.length >= 500) break;
    const occurrenceIndex = occurrences.findIndex((occurrence, index) => {
      if (usedOccurrences.has(index) || occurrence.kind !== "price") return false;
      if (occurrence.amount_krw !== gap.krw || occurrence.raw_text !== gap.raw) return false;
      if (!exactEvidenceLocators(occurrence.source_quote).includes(gap.source_locator)) return false;
      if (/ocr:page:/iu.test(occurrence.source_quote)) return false;
      if (occurrence.source_file_ids.length !== 1) return false;
      const source = sourceById.get(occurrence.source_file_ids[0]!);
      if (!source || source.ext === "png") return false;
      const payloads = boundedEvidencePayloads(occurrence.source_quote) ?? [];
      return boundedEvidenceContainsField(payloads, occurrence.raw_text);
    });
    if (occurrenceIndex < 0) continue;
    const occurrence = occurrences[occurrenceIndex]!;
    let reviewQuote = occurrence.source_quote;
    if (!parseEvidenceQuoteMoneyAmounts(reviewQuote).includes(occurrence.amount_krw)) {
      const sourceFileIdValue = occurrence.source_file_ids[0]!;
      const sourceEvidence = evidence.bySourceFileId?.[sourceFileIdValue];
      const valueLocator = exactEvidenceLocators(occurrence.source_quote)[0];
      const parsedValueLocator = valueLocator
        ? /^(.*)!([A-Z]+)(\d+)$/iu.exec(valueLocator)
        : null;
      const declaredUnitCandidates = parsedValueLocator && sourceEvidence?.xlsxCells
        ? Object.entries(sourceEvidence.xlsxCells)
          .filter(([locator, payloads]) => (
            locator.startsWith(`${parsedValueLocator[1]}!`)
            && payloads.some((payload) => (
              /(?:단위|금액|가격)[^\n]{0,40}(?:백만원|만원|천원|원)/iu.test(payload)
            ))
          ))
          .sort(([left], [right]) => left.localeCompare(right, "en"))
        : [];
      const priceColumnCandidates = parsedValueLocator && sourceEvidence?.xlsxCells
        ? Object.entries(sourceEvidence.xlsxCells)
          .filter(([locator, payloads]) => {
            const candidate = /^(.*)!([A-Z]+)(\d+)$/iu.exec(locator);
            return Boolean(
              candidate
              && candidate[1] === parsedValueLocator[1]
              && candidate[2]?.toUpperCase() === parsedValueLocator[2]?.toUpperCase()
              && Number.parseInt(candidate[3]!, 10) <= Number.parseInt(parsedValueLocator[3]!, 10)
              && payloads.some(priceHeaderContext)
            );
          })
          .sort(([left], [right]) => right.localeCompare(left, "en"))
        : [];
      const merged = declaredUnitCandidates
        .flatMap(([unitLocator, unitPayloads]) => {
          const columnContexts = priceColumnCandidates.length > 0
            ? priceColumnCandidates
            : [[null, []] as const];
          return columnContexts.map(([columnLocator, columnPayloads]) => (
            encodeMergedEvidenceQuote([{
              source_file_id: sourceFileIdValue,
              quote: `${unitLocator}: ${unitPayloads[0]}`,
            }, ...(columnLocator
              ? [{
                  source_file_id: sourceFileIdValue,
                  quote: `${columnLocator}: ${columnPayloads[0]}`,
                }]
              : []), {
              source_file_id: sourceFileIdValue,
              quote: occurrence.source_quote,
            }], 2_000)
          ));
        })
        .find((candidate): candidate is string => Boolean(
          candidate && parseEvidenceQuoteMoneyAmounts(candidate).includes(occurrence.amount_krw)
        ));
      if (!merged) continue;
      reviewQuote = merged;
    }
    usedOccurrences.add(occurrenceIndex);
    sections.push({
      section_type: "other",
      title: occurrence.raw_text,
      content_verbatim: occurrence.raw_text,
      summary: occurrence.raw_text,
      source_quote: reviewQuote,
      source_file_ids: occurrence.source_file_ids,
      confidence: 0.2,
      needs_review: true,
    });
    preserved += 1;
  }
  data.sections = sections;
  return preserved > 0
    ? [{
        severity: "warning",
        code: "local_unlinked_price_occurrences_preserved",
        path: "extraction_notes.unlinked_price_occurrences",
        message: `${preserved}개 원문 가격은 업체·옵션 의미를 단정하지 않고 미연결 검수 섹션으로 보존했습니다. 자동 승인과 일반 공개 대상이 아닙니다.`,
      }]
    : [];
}

/**
 * Local extraction is deliberately conservative: an exact number is still
 * unsafe when it has been attached to the wrong commercial meaning. These
 * guards reject the high-risk bindings that exact-quote/money checks alone
 * cannot distinguish.
 */
export function validateLocalHallSemanticBindings(
  unit: ManifestUnit,
  data: DisclosureExtraction,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const halls = data.halls ?? [];
  const hallDocument = unit.parsed.kind_hint === "hall"
    || data.doc_kind === "hall_disclosure";
  if (hallDocument && !halls.some((hall) => Boolean(hall.hall_name?.trim()))) {
    issues.push({
      severity: canonicalBusinessIdentityMatchesUnit(unit, data.business_name)
        ? "warning"
        : "error",
      code: canonicalBusinessIdentityMatchesUnit(unit, data.business_name)
        ? "local_hall_identity_only_from_canonical_source"
        : "local_hall_identity_missing",
      path: "halls",
      message: canonicalBusinessIdentityMatchesUnit(unit, data.business_name)
        ? "개별 홀명은 권위 있는 본문에서 확인되지 않아 생성하지 않았고, 해시로 고정된 원본 파일명에서 확정된 예식장 업체 정체성만 pending으로 보존합니다."
        : "A hall disclosure must retain at least one source-backed hall or venue identity, even when every price remains null.",
    });
  }

  halls.forEach((hall, index) => {
    const path = `halls[${index}]`;
    const payloads = normalizedHallQuotePayloads(hall.source_quote);
    const combinedFeePayloads = payloads.filter((payload) =>
      hasVenueFeeLabel(payload) && hasDecorationFeeLabel(payload)
    );
    const venueOnlyEvidence = payloads.some((payload) =>
      hasVenueFeeLabel(payload) && !hasDecorationFeeLabel(payload)
    );
    const decorationOnlyEvidence = payloads.some((payload) =>
      hasDecorationFeeLabel(payload) && !hasVenueFeeLabel(payload)
    );
    const venueFeeAssigned = hall.venue_fee_min_krw !== null
      || hall.venue_fee_max_krw !== null;
    const decorationFeeAssigned = hall.decoration_fee_min_krw !== null
      || hall.decoration_fee_max_krw !== null;
    const venueExplicitlyAbsent = payloads.some((payload) =>
      /대관(?:료|비)\s*(?:없음|무료|0\s*원)/u.test(payload)
    );
    const decorationExplicitlyAbsent = payloads.some(decorationFeeExplicitlyAbsent);

    if (venueFeeAssigned && venueExplicitlyAbsent) {
      issues.push({
        severity: "error",
        code: "local_hall_venue_fee_contradicts_source",
        path: `${path}.venue_fee`,
        message: "The structured venue fee contradicts exact source text that says the venue fee is absent or free.",
      });
    }
    if (
      combinedFeePayloads.length > 0
      && venueFeeAssigned
      && !venueOnlyEvidence
      && !decorationExplicitlyAbsent
    ) {
      issues.push({
        severity: "error",
        code: "local_hall_combined_fee_misbinding",
        path: `${path}.venue_fee`,
        message: "A combined venue/decor disclosure cannot be represented as a venue fee without separate venue-only evidence.",
      });
    }
    if (
      combinedFeePayloads.length > 0
      && decorationFeeAssigned
      && !decorationOnlyEvidence
      && !venueExplicitlyAbsent
    ) {
      issues.push({
        severity: "error",
        code: "local_hall_combined_fee_misbinding",
        path: `${path}.decoration_fee`,
        message: "A combined venue/decor disclosure cannot be represented as a decoration fee without separate decoration-only evidence.",
      });
    }

    const quoteText = payloads.join("\n");
    const hasAdultMeal = /(?:대인|성인)\s*(?:식대|식비|식사|뷔페)?/u.test(quoteText);
    const hasChildMeal = /(?:소인|아동|어린이)\s*(?:식대|식비|식사|뷔페)?/u.test(quoteText);
    const mealAssigned = hall.meal_price_min_krw !== null
      || hall.meal_price_max_krw !== null;
    if (mealAssigned && hasAdultMeal && hasChildMeal) {
      issues.push({
        severity: "error",
        code: "local_hall_meal_variants_collapsed",
        path: `${path}.meal_price`,
        message: "Adult and child meal variants must remain separate options instead of being collapsed into one min/max range.",
      });
    }
  });
  return issues;
}

function structuredCoverageSnapshotForLocalValidation(
  unit: ManifestUnit,
  data: DisclosureExtraction,
): DisclosureExtraction {
  const snapshot = structuredClone(data);
  const hallDocument = unit.parsed.kind_hint === "hall"
    || snapshot.doc_kind === "hall_disclosure";
  if (!hallDocument) return snapshot;
  snapshot.sections = (snapshot.sections ?? []).filter((section) => {
    if (!["other", "pricing_basis"].includes(section.section_type)) return true;
    // Grounded non-price notes remain useful review evidence. A money-bearing
    // miscellaneous/pricing-basis section, however, is only an unlinked ledger
    // entry and cannot prove that a hall price was structurally captured.
    return parseEvidenceQuoteMoneyAmounts(section.source_quote).length === 0;
  });
  return snapshot;
}

function applyLocalValidationIssuePolicy(
  data: DisclosureExtraction,
  issues: ValidationIssue[],
  evidence: ValidationEvidenceContext,
  sourceMoneyByFileId: LocalSourceMoneyIndex,
): void {
  for (const issue of issues) {
    if (
      ["source_locator_invalid", "source_quote_payload_mismatch"].includes(issue.code)
      && localStructuredEvidenceIsGrounded(
        data,
        issue.path,
        evidence,
        sourceMoneyByFileId,
      )
    ) {
      issue.severity = "warning";
      issue.code = "local_source_scoped_evidence_verified";
      issue.message = "The merged record quote was re-verified against its exact source_file_id, locator, identity, and money tokens; it remains pending for human review.";
      continue;
    }
    if (issue.code === "conflicting_partner_vendor_prices") {
      issue.severity = "warning";
      issue.code = "local_partner_vendor_conflict_requires_dedupe_review";
      issue.message = "동일 정규화 업체명의 서로 다른 행은 자동 병합하지 않고 pending 중복 후보로 사람이 검수해야 합니다.";
      continue;
    }
    if (
      [
        "source_record_scope_ambiguous",
        "package_identity_not_linked",
        "package_category_not_linked",
        "vendor_identity_not_linked",
        "vendor_category_not_linked",
        "vendor_policy_text_not_linked",
        "vendor_policy_type_not_linked",
        "hall_identity_not_linked",
      ].includes(issue.code)
      && (
        localStructuredEvidenceIsGrounded(
          data,
          issue.path,
          evidence,
          sourceMoneyByFileId,
        )
        || localGenericTableRecordEvidenceIsGrounded(
          data,
          issue.path,
          evidence,
          sourceMoneyByFileId,
        )
      )
    ) {
      issue.severity = "warning";
      issue.code = "local_exact_evidence_requires_record_review";
      issue.message = "정확한 원본 셀·금액·의미 필드는 재검증됐지만 표 경계는 로컬 변환물만으로 확정할 수 없어 사람이 레코드 연결을 검수해야 합니다.";
      continue;
    }
    if (
      issue.code === "vendor_category_not_linked"
      && localGenericTableOrderCategoryIsGrounded(data, issue.path, evidence)
    ) {
      issue.severity = "warning";
      issue.code = "local_category_inferred_from_generic_table_order";
      issue.message = "카테고리는 정확히 3개인 공시 표의 S-D-M 순서와 표 머리글 locator로 추론했으며 자동 승인 없이 사람이 확인해야 합니다.";
      continue;
    }
    if (
      issue.code === "vendor_category_not_linked"
      && localLinkedCategoryIsGroundedInSheetLocator(data, issue.path)
    ) {
      issue.severity = "warning";
      issue.code = "local_category_inferred_from_sheet_locator";
      issue.message = "가격 행의 카테고리는 정확한 XLSX 시트 locator에서 추론했으며 자동 승인 없이 사람이 확인해야 합니다.";
      continue;
    }
    if (
      issue.code === "semantic_type_not_grounded_in_source_quote"
      && (
        localGenericTableOrderCategoryIsGrounded(data, issue.path, evidence)
        || localCategoryIssueIsGrounded(
          data,
          issue.path,
          evidence,
          sourceMoneyByFileId,
        )
      )
    ) {
      issue.severity = "warning";
      issue.code = "local_category_inferred_from_review_only_structure";
      issue.message = "카테고리는 정확한 XLSX 시트 또는 3개 공시 표 순서에서 추론했으며 자동 승인 없이 사람이 확인해야 합니다.";
      continue;
    }
    if (
      issue.code === "price_source_quote_mismatch"
      || issue.code === "price_source_quote_unparseable"
    ) {
      const linkagePath = `${issue.path}.source_quote`;
      const expectation = localStructuredEvidenceExpectation(data, linkagePath);
      if (
        expectation
        && localEvidenceQuoteIsExact(expectation, evidence)
        && localSourceScannerGroundsAmounts(expectation, sourceMoneyByFileId)
      ) {
        issue.severity = "warning";
        issue.code = "local_money_grounded_by_full_source_scanner";
        issue.message = "금액은 정확한 locator·원문 토큰·전체 표 단위 문맥으로 재검증됐으며 자동 승인 없이 사람이 확인해야 합니다.";
      } else {
        issue.severity = "error";
        issue.code = "local_extracted_money_not_grounded";
        issue.message = "로컬 추출 금액을 해당 source_quote에서 결정적으로 확인할 수 없습니다.";
      }
    }
  }
}

/** Rebuild the exact payload validation is allowed to persist. */
export async function deriveValidatedPayloadForUnit(
  unit: ManifestUnit,
  extraction: ValidationExtractionInput,
  options: DeriveValidatedPayloadOptions = {},
): Promise<DerivedValidatedPayload> {
  const data = DisclosureExtractionSchema.parse(structuredClone(extraction.data));
  const localDeterministic = options.mode === "local_deterministic";
  if (localDeterministic) forceLocalValidationReviewOnly(data);
  // Paid extraction assigns global line:N locators in conversion array order.
  // The local runner instead sorts artifacts, groups them by source, and then
  // restarts line:N inside each source-scoped evidence document. Keep both
  // contracts explicit: sharing the paid global offset with local records
  // detaches every second-and-later source quote from its actual source.
  const textArtifacts = [...(unit.conversion?.text_artifacts ?? [])];
  if (localDeterministic) {
    textArtifacts.sort((left, right) => left.localeCompare(right, "en"));
  }
  const evidenceBySource = new Map(unit.source_files.map((source) => [
    sourceFileId(source),
    {
      text: [] as Array<{ value: string; lineOffset: number }>,
      sourceMoneyText: [] as string[],
      hasImages: false,
    },
  ]));
  const sourceImageSourcesBySha256 = new Map<string, SourceFile[]>();
  for (const artifactPath of unit.conversion?.image_artifacts ?? []) {
    const digest = await sha256File(artifactPath);
    const resolution = resolveArtifactSourceProvenance(unit, artifactPath);
    const sources = resolution.authoritative
      ? resolution.sources
      : sourceFilesForArtifact(unit, artifactPath);
    for (const source of sources) {
      const sourceEvidence = evidenceBySource.get(sourceFileId(source));
      if (sourceEvidence) sourceEvidence.hasImages = true;
    }
    if (!resolution.authoritative || resolution.sources.length !== 1) continue;
    const current = sourceImageSourcesBySha256.get(digest.sha256) ?? [];
    const source = resolution.sources[0]!;
    if (!current.some((candidate) => sourceFileId(candidate) === sourceFileId(source))) {
      current.push(source);
    }
    sourceImageSourcesBySha256.set(digest.sha256, current);
  }

  const textArtifactContents: Array<{
    artifactPath: string;
    text: string;
    sourceMoneyText: string;
    sources: SourceFile[];
    lineOffset: number;
  }> = [];
  let globalLineOffset = 0;
  let ambiguousOcrArtifacts = 0;
  let excludedContactLines = 0;
  let excludedOcrMetadataLines = 0;
  for (const artifactPath of textArtifacts) {
    const rawText = await readFile(artifactPath, "utf8");
    const resolution = resolveArtifactSourceProvenance(unit, artifactPath, {
      sourceImageSourcesBySha256,
    });
    // Source provenance and evidence authority are separate. Even an OCR
    // artifact mapped to exactly one image remains a private review aid.
    if (resolution.ocr_review) {
      if (!resolution.authoritative || resolution.sources.length !== 1) {
        ambiguousOcrArtifacts += 1;
      }
      continue;
    }
    const prepared = prepareStructuredEvidenceText(rawText, {
      ocrReviewArtifact: resolution.ocr_review,
    });
    excludedContactLines += prepared.excluded_contact_lines;
    excludedOcrMetadataLines += prepared.excluded_ocr_metadata_lines;
    textArtifactContents.push({
      artifactPath,
      text: prepared.text,
      sourceMoneyText: sourceMoneyProjectionForTextArtifact(artifactPath, prepared.text),
      lineOffset: globalLineOffset,
      sources: resolution.authoritative
        ? resolution.sources
        : sourceFilesForArtifact(unit, artifactPath),
    });
    globalLineOffset += prepared.text.split(/\r?\n/u).length;
  }
  for (const artifact of textArtifactContents) {
    for (const source of artifact.sources) {
      const sourceEvidence = evidenceBySource.get(sourceFileId(source));
      if (!sourceEvidence) continue;
      sourceEvidence.text.push({
        value: artifact.text,
        lineOffset: artifact.lineOffset,
      });
      sourceEvidence.sourceMoneyText.push(artifact.sourceMoneyText);
    }
  }
  const sourceText = textArtifactContents.map((artifact) => artifact.text).join("\n");
  const sourceMoneyText = textArtifactContents
    .map((artifact) => artifact.sourceMoneyText)
    .join("\n");
  const localSourceMoneyCandidates = localDeterministic
    ? textArtifactContents.flatMap((artifact) => (
        scanSourceMoneyOccurrences(artifact.sourceMoneyText)
      ))
    : [];
  const sourceTextByFileId = new Map([...evidenceBySource.entries()].map(([id, value]) => [
    id,
    value.text.map((entry) => entry.value).join("\n"),
  ]));
  const sourceMoneyTextByFileId = new Map([...evidenceBySource.entries()].map(([id, value]) => [
    id,
    value.sourceMoneyText.join("\n"),
  ]));
  const sourceMoneyArtifactsByFileId = new Map([...evidenceBySource.entries()].map(([id, value]) => [
    id,
    value.sourceMoneyText,
  ]));
  const sourceMoneyByFileId = localDeterministic
    ? indexLocalSourceMoney(sourceMoneyArtifactsByFileId)
    : new Map<string, readonly CoverageGap[]>();
  const evidence: ValidationEvidenceContext = {
    normalizedText: normalizeEvidenceText(sourceText),
    xlsxCells: indexXlsxCellEvidence(sourceText),
    xlsxAuxiliary: indexXlsxAuxiliaryEvidence(sourceText),
    lineEvidence: indexLineEvidence(sourceText),
    pdfLayoutMoney: mergePdfLayoutMoneyEvidence(
      textArtifactContents.map((artifact) => artifact.text),
    ),
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
    bySourceFileId: Object.fromEntries([...evidenceBySource.entries()].map(([id, value]) => {
      const sourceScopedText = value.text.map((entry) => entry.value).join("\n");
      return [id, {
        normalizedText: normalizeEvidenceText(sourceScopedText),
        xlsxCells: indexXlsxCellEvidence(sourceScopedText),
        xlsxAuxiliary: indexXlsxAuxiliaryEvidence(sourceScopedText),
        pdfLayoutMoney: mergePdfLayoutMoneyEvidence(
          value.text.map((entry) => entry.value),
        ),
        lineEvidence: localDeterministic
          ? indexLineEvidence(sourceScopedText)
          : Object.assign(
              {},
              ...value.text.map((entry) => indexLineEvidence(entry.value, entry.lineOffset)),
            ),
        hasImages: value.hasImages,
      }];
    })),
  };
  const quarantineIssues = localDeterministic
    ? quarantineUnsafeLocalStructuredSemantics(data, evidence, sourceMoneyByFileId)
    : [];
  // The unlinked review ledger is intentionally retained for an administrator,
  // but it is not a structured price capture. Snapshot the post-quarantine
  // commercial structure before adding those review-only sections so neither
  // the audit ledger nor its UI representation can satisfy primary coverage.
  const structuredCoverageData = localDeterministic
    ? structuredCoverageSnapshotForLocalValidation(unit, data)
    : data;
  const unlinkedPriceIssues = localDeterministic
    ? preserveUnlinkedLocalPriceOccurrences(
        unit,
        data,
        sourceMoneyText,
        evidence,
        localSourceMoneyCandidates,
      )
    : [];
  const issues = validateExtractionForUnit(
    unit,
    data,
    evidence,
    localDeterministic ? { mode: "local_deterministic" } : {},
  );
  issues.push(...quarantineIssues, ...unlinkedPriceIssues);
  if (unit.conversion?.ocr_review) {
    issues.push({
      severity: "warning",
      code: "ocr_evidence_review_only",
      path: "conversion.ocr_review",
      message: "Windows.Media.Ocr evidence is a non-authoritative review aid and requires visual verification before individual approval.",
    });
  }
  if (ambiguousOcrArtifacts > 0) {
    issues.push({
      severity: "warning",
      code: "ocr_provenance_ambiguous_review_only",
      path: "conversion.ocr_review.artifacts",
      message: `${ambiguousOcrArtifacts} shared OCR review artifact(s) could not be mapped to exactly one source_file_id and were excluded from structured evidence and money validation. The artifacts remain available for human review.`,
    });
  }
  if (excludedContactLines > 0) {
    issues.push({
      severity: "warning",
      code: "public_contact_evidence_excluded",
      path: "conversion.text_artifacts",
      message: `${excludedContactLines} contact-bearing source line(s) were excluded from public identity and source anchors while remaining in the private review artifacts.`,
    });
  }
  if (excludedOcrMetadataLines > 0) {
    issues.push({
      severity: "warning",
      code: "ocr_metadata_evidence_excluded",
      path: "conversion.ocr_review.artifacts",
      message: `${excludedOcrMetadataLines} OCR provenance metadata line(s) were excluded from structured evidence and money validation.`,
    });
  }
  issues.push(...validateStructuredRecordSourceLinkage(
    data,
    sourceText,
    sourceTextByFileId,
  ).map((issue) => {
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
  if (unit.notices.some((notice) => notice.startsWith(DUPLICATE_SOURCE_NOTICE_PREFIX))) {
    issues.push({
      severity: "warning",
      code: "duplicate_source_content",
      path: "unit.notices",
      message: "다른 업체 unit과 완전히 동일한 원본 세트이므로 자동 승인을 제외하고 사람이 업체 연결을 확인해야 합니다.",
    });
  }
  if (localDeterministic) {
    issues.push(...validateLocalHallSemanticBindings(unit, data));
    applyLocalValidationIssuePolicy(data, issues, evidence, sourceMoneyByFileId);
  }
  if (localDeterministic || /(?:^|\n)\[local_evidence_guard\]/u.test(data.extraction_notes)) {
    issues.push({
      severity: "warning",
      code: "local_evidence_guard",
      path: "extraction_notes",
      message: "근거가 불충분한 추출 레코드를 로컬 보호 로직이 제거했으므로 자동 승인을 제외하고 원문 누락 여부를 사람이 확인해야 합니다.",
    });
  }
  const localMoneyAudit = localDeterministic
    ? validateLocalMoneyAudit(data, sourceMoneyByFileId, sourceTextByFileId)
    : null;
  if (localMoneyAudit) issues.push(...localMoneyAudit.issues);
  const coverageGaps = findCoverageGaps(
    sourceMoneyText,
    structuredCoverageData,
    {
      includeAuditLedger: false,
      ...(localDeterministic ? { scannedCandidates: localSourceMoneyCandidates } : {}),
    },
  );
  if (coverageGaps.length > 0) {
    issues.push({
      severity: "warning",
      code: "coverage_gap",
      path: "coverage_gaps",
      message: `원문 금액 후보 ${coverageGaps.length}건이 추출 KRW 값과 연결되지 않아 사람 검토가 필요합니다.`,
    });
  }
  if (localDeterministic && (unit.conversion?.image_artifacts.length ?? 0) > 0) {
    issues.push({
      severity: "warning",
      code: "image_coverage_gap_unreadable",
      path: "conversion.image_artifacts",
      message: "로컬 무비용 추출이 이미지 안의 금액·정책을 판독하지 않았으므로 이미지 원본 범위는 coverage 미확정 상태입니다.",
    });
  }
  const visualTranscription = options.visualTranscription ?? null;
  if (!visualTranscription) return { data, issues, coverageGaps };
  if (!localDeterministic) {
    throw new Error("visual_transcription_requires_local_deterministic_validation");
  }
  const merged = mergeVisualTranscriptionSidecar(data, visualTranscription);
  const visualIssues: ValidationIssue[] = merged.validation_issue_codes.map((code) => ({
    severity: "warning",
    code,
    path: "visual_transcription.reviewer",
    message: code === "visual_transcription_requires_human_confirmation"
      ? "Visual transcription is Codex-assisted and remains unconfirmed; it cannot support publication or bulk approval."
      : "Visual transcription is grounded in a human-confirmed overlay but still requires individual administrator review before publication.",
  }));
  const visualCoverageGaps: CoverageGap[] = merged.coverage_gaps.map((gap) => ({
    raw: gap.estimated_content.slice(0, 200),
    krw: gap.visible_amounts_krw[0] ?? 0,
    line_context: gap.reason,
    source_locator: gap.source_locator,
    visual_transcription: {
      evidence_id: gap.evidence_id,
      visible_amounts_krw: [...gap.visible_amounts_krw],
      estimated_content: gap.estimated_content,
      reason: gap.reason,
    },
  }));
  if (coverageGaps.length + visualCoverageGaps.length > 5_000) {
    throw new Error("visual_transcription_combined_coverage_gap_limit_exceeded");
  }
  return {
    data: merged.data,
    issues: [...issues, ...visualIssues],
    coverageGaps: [...coverageGaps, ...visualCoverageGaps],
  };
}

async function verifyVisualTranscriptionBindingForLocalExtraction(
  unit: ManifestUnit,
  manifest: IngestManifest,
  stateDir: string,
  extraction: { visual_transcription?: VisualTranscriptionExtractionBinding },
): Promise<LoadedVisualTranscriptionSidecar | null> {
  const sidecar = await loadVisualTranscriptionSidecar({
    stateDir,
    manifest,
    unitId: unit.unit_id,
  });
  const binding = sidecar ? visualTranscriptionExtractionBinding(sidecar) : null;
  if (
    !isDeepStrictEqual(extraction.visual_transcription ?? null, binding)
    || !isDeepStrictEqual(unit.local_extraction?.visual_transcription ?? null, binding)
  ) {
    throw new Error("local_visual_transcription_extraction_binding_mismatch");
  }
  return sidecar;
}

/**
 * Replays the full local extraction + validation chain. Consumers must use
 * this verifier instead of parsing a local artifact through the paid schema.
 */
export async function verifyCurrentLocalValidatedArtifactForUnit(
  unit: ManifestUnit,
  manifest: IngestManifest,
  stateDir: string,
): Promise<LocalValidatedArtifact> {
  const extractionMetadata = unit.local_extraction;
  const validationMetadata = unit.validation;
  if (
    !extractionMetadata
    || !validationMetadata
    || (unit.extraction && extractionMetadata.paid_review_only_override !== true)
  ) {
    throw new Error("local_validation_manifest_metadata_missing_or_ambiguous");
  }
  if (
    validationMetadata.provider_mode !== LOCAL_DETERMINISTIC_PROVIDER_MODE
    || validationMetadata.model !== LOCAL_DETERMINISTIC_MODEL
    || validationMetadata.engine_version !== LOCAL_DETERMINISTIC_ENGINE_VERSION
    || validationMetadata.engine_hash !== LOCAL_DETERMINISTIC_ENGINE_HASH
    || validationMetadata.needs_review !== true
    || validationMetadata.bulk_approval_eligible !== false
  ) {
    throw new Error("local_validation_manifest_review_contract_mismatch");
  }
  await verifyValidationInputsUnchanged(unit, manifest);
  const { verifyCurrentLocalExtractionCacheForUnit } = await import(
    "./local-extraction-runner.js"
  );
  const extraction = await verifyCurrentLocalExtractionCacheForUnit(unit, manifest, stateDir);
  const visualTranscription = await verifyVisualTranscriptionBindingForLocalExtraction(
    unit,
    manifest,
    stateDir,
    extraction,
  );
  const visualBinding = visualTranscription
    ? visualTranscriptionExtractionBinding(visualTranscription)
    : null;
  await verifyDeterministicStateArtifactPath({
    stateDir,
    artifactPath: validationMetadata.artifact_path,
    expectedRelativePath: path.join("validated", `${unit.unit_id}.json`),
  });
  const raw = await readJsonFile(validationMetadata.artifact_path);
  const parsed = LocalValidatedArtifactSchema.safeParse(raw);
  if (!parsed.success) throw new Error("local_validation_artifact_schema_invalid");
  verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
  const artifact = parsed.data;
  const expectedSourceFiles = unit.source_files.map((source) => ({
    path: source.path,
    sha256: source.sha256,
    bytes: source.bytes,
  }));
  const recomputedFingerprint = validatedArtifactFingerprint(
    artifact.extraction_fingerprint,
    artifact.data,
    artifact.issues,
    artifact.coverage_gaps,
  );
  if (
    artifact.content_sha256 !== validationMetadata.content_sha256
    || artifact.fingerprint !== validationMetadata.fingerprint
    || artifact.fingerprint !== recomputedFingerprint
    || artifact.unit_id !== unit.unit_id
    || artifact.source_fingerprint !== unit.source_fingerprint
    || artifact.extraction_fingerprint !== extractionMetadata.fingerprint
    || artifact.extraction_content_sha256 !== extraction.content_sha256
    || artifact.extraction_content_sha256 !== validationMetadata.extraction_content_sha256
    || artifact.engine_version !== extraction.engine_version
    || artifact.engine_hash !== extraction.engine_hash
    || validationMetadata.validator_version !== VALIDATOR_VERSION
    || validationMetadata.review_status !== artifact.review_status
    || validationMetadata.issue_count !== artifact.issues.length
    || validationMetadata.validated_at !== artifact.validated_at
    || !isDeepStrictEqual(artifact.visual_transcription ?? null, visualBinding)
    || !isDeepStrictEqual(validationMetadata.visual_transcription ?? null, visualBinding)
    || JSON.stringify(artifact.source_files) !== JSON.stringify(expectedSourceFiles)
  ) {
    throw new Error("local_validation_artifact_provenance_mismatch");
  }
  const replayed = await deriveValidatedPayloadForUnit(
    unit,
    extraction,
    { mode: "local_deterministic", visualTranscription },
  );
  if (
    !isDeepStrictEqual(artifact.data, replayed.data)
    || !isDeepStrictEqual(artifact.issues, replayed.issues)
    || !isDeepStrictEqual(artifact.coverage_gaps, replayed.coverageGaps)
  ) {
    throw new Error("local_validation_artifact_replay_mismatch");
  }
  return artifact;
}

export async function validateManifest(options: ValidateOptions): Promise<IngestManifest> {
  const manifest = await loadManifest(options.stateDir);
  const validatedDirectory = path.join(path.resolve(options.stateDir), "validated");
  const artifactsByUnitId = new Map<
    string,
    StrictValidatedArtifact | LocalValidatedArtifact
  >();

  for (const unit of manifest.units) {
    if (unit.local_extraction) {
      if (unit.extraction && unit.local_extraction.paid_review_only_override !== true) {
        unit.stage = "error";
        delete unit.validation;
        unit.notices = Array.from(new Set([
          ...unit.notices,
          "validate failed: ambiguous paid/local extraction provenance",
        ]));
        continue;
      }
      // A previous validator version may have persisted a fully provenance-
      // bound artifact with blocking issues and moved the unit to error. New
      // validator versions must be able to replay that same verified local
      // extraction; skipping error here leaves fixed units permanently stale.
      if (!["extracted", "validated", "error"].includes(unit.stage)) continue;
      let localExtractionArtifact;
      let visualTranscription: LoadedVisualTranscriptionSidecar | null = null;
      try {
        await verifyValidationInputsUnchanged(unit, manifest);
        const { verifyCurrentLocalExtractionCacheForUnit } = await import(
          "./local-extraction-runner.js"
        );
        localExtractionArtifact = await verifyCurrentLocalExtractionCacheForUnit(
          unit,
          manifest,
          options.stateDir,
        );
        visualTranscription = await verifyVisualTranscriptionBindingForLocalExtraction(
          unit,
          manifest,
          options.stateDir,
          localExtractionArtifact,
        );
      } catch (error) {
        unit.stage = "error";
        delete unit.validation;
        const message = error instanceof Error
          ? error.message
          : "unknown_local_validation_provenance_error";
        unit.notices = Array.from(new Set([
          ...unit.notices,
          `validate failed: local extraction artifact provenance mismatch (${message})`,
        ]));
        continue;
      }

      const { data, issues, coverageGaps } = await deriveValidatedPayloadForUnit(
        unit,
        localExtractionArtifact,
        { mode: "local_deterministic", visualTranscription },
      );
      const visualBinding = visualTranscription
        ? visualTranscriptionExtractionBinding(visualTranscription)
        : null;
      const fingerprint = validatedArtifactFingerprint(
        unit.local_extraction.fingerprint,
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
      const existing = await readExistingLocalValidated(artifactPath, {
        stateDir: options.stateDir,
        fingerprint,
        unitId: unit.unit_id,
        sourceFingerprint: unit.source_fingerprint,
        extractionFingerprint: unit.local_extraction.fingerprint,
        extractionContentSha256: localExtractionArtifact.content_sha256,
        engineVersion: localExtractionArtifact.engine_version,
        engineHash: localExtractionArtifact.engine_hash,
        sourceFiles,
        visualTranscription: visualBinding,
      });
      const artifactCandidate = existing ?? {
        schema_version: 3 as const,
        artifact_kind: "local_deterministic_validation" as const,
        content_sha256: "0".repeat(64),
        validator_version: VALIDATOR_VERSION,
        fingerprint,
        unit_id: unit.unit_id,
        source_files: sourceFiles,
        source_fingerprint: unit.source_fingerprint,
        extraction_fingerprint: unit.local_extraction.fingerprint,
        extraction_content_sha256: localExtractionArtifact.content_sha256,
        provider_mode: LOCAL_DETERMINISTIC_PROVIDER_MODE,
        model: LOCAL_DETERMINISTIC_MODEL,
        engine_version: localExtractionArtifact.engine_version,
        engine_hash: localExtractionArtifact.engine_hash,
        data,
        issues,
        coverage_gaps: coverageGaps,
        review_status: "pending" as const,
        needs_review: true as const,
        bulk_approval_eligible: false as const,
        ...(visualBinding ? { visual_transcription: visualBinding } : {}),
        validated_at: new Date().toISOString(),
      };
      if (!existing) {
        artifactCandidate.content_sha256 = canonicalJsonSha256ExcludingField(
          artifactCandidate,
          "content_sha256",
        );
      }
      const artifact = LocalValidatedArtifactSchema.parse(artifactCandidate);
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
        provider_mode: LOCAL_DETERMINISTIC_PROVIDER_MODE,
        model: LOCAL_DETERMINISTIC_MODEL,
        engine_version: artifact.engine_version,
        engine_hash: artifact.engine_hash,
        needs_review: true,
        bulk_approval_eligible: false,
        ...(visualBinding ? { visual_transcription: visualBinding } : {}),
        artifact_path: artifactPath,
        review_status: "pending",
        issue_count: artifact.issues.length,
        validated_at: artifact.validated_at,
      };
      unit.stage = artifact.issues.some((issue) => issue.severity === "error")
        ? "error"
        : "validated";
      unit.notices = unit.notices.filter((notice) => !notice.startsWith("validate failed:"));
      continue;
    }
    // An earlier fail-closed replay may have moved a still-provenanced paid
    // unit to error. Re-enter validation only through the complete extraction
    // verifier below; units without extraction provenance remain skipped.
    if (!unit.extraction || !["extracted", "validated", "error"].includes(unit.stage)) continue;
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
    unit.notices = unit.notices.filter((notice) => !notice.startsWith("validate failed:"));
  }

  for (const unit of manifest.units) {
    unit.notices = unit.notices.filter((notice) =>
      notice !== LOCAL_PARTNER_VENDOR_CONFLICT_NOTICE
    );
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
      const localReviewOnly = Boolean(
        unit.local_extraction
        && (!unit.extraction || unit.local_extraction.paid_review_only_override === true)
        && unit.validation.provider_mode === LOCAL_DETERMINISTIC_PROVIDER_MODE
        && "artifact_kind" in artifact
        && artifact.artifact_kind === "local_deterministic_validation",
      );
      if (localReviewOnly) {
        unit.notices = Array.from(new Set([
          ...unit.notices,
          LOCAL_PARTNER_VENDOR_CONFLICT_NOTICE,
        ]));
        continue;
      }
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
