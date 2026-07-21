import path from "node:path";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import {
  ArtifactIntegrityError,
  requireStrictPathHashPair,
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "./artifact-integrity.js";
import {
  currentExtractionFingerprint,
  EXTRACTION_PROCESSING_VERSION,
  EXTRACTION_PROMPT_HASH,
  EXTRACTION_PROMPT_VERSION,
} from "./extraction-contract.js";
import { isPathWithin, readJsonFile, writeJsonFile } from "./io.js";
import { decodeEvidenceQuote } from "./merge-evidence.js";
import { loadManifest } from "./manifest.js";
import { normalizeVendorName, regionCodeFromDirectory } from "./scan.js";
import { sourceFileId } from "./provenance.js";
import { readFixedEightPaidExtractionPlanApproval } from "./paid-extraction-plan.js";
import { isStructuredRecordSourceLinkageCode } from "./record-source-linkage.js";
import {
  ExtractionBatchCheckpointSchema,
  ExtractionArtifactSchema,
  StrictExtractionArtifactSchema,
} from "./schemas.js";
import type { DisclosureExtraction } from "./schemas.js";
import type { IngestManifest, ManifestUnit } from "./types.js";
import {
  deriveValidatedPayloadForUnit,
  normalizeEvidenceText,
  StrictValidatedArtifactSchema,
  validatedArtifactFingerprint,
  ValidatedArtifactSchema,
  verifyCurrentLocalValidatedArtifactForUnit,
  verifyValidationInputsUnchanged,
} from "./validate.js";
import {
  looksLikeXlsxAuxiliaryEvidence,
  parseXlsxAuxiliaryEvidenceLine,
  stripXlsxAuxiliaryEvidenceLocator,
} from "./xlsx-aux-evidence.js";
import type { CoverageGap } from "./validate.js";

const MoneyOccurrenceSchema = z.object({
  raw: z.string().min(1).max(200),
  krw: z.number().int().nonnegative(),
  line_context: z.string().min(1).max(1_000),
  source_locator: z.string().min(1).max(200),
}).strict();

const MAX_GROUND_TRUTH_ARTIFACT_BYTES = 64 * 1024 * 1024;

async function readHashedJsonOnce(
  artifactPath: string,
  label: string,
): Promise<{ sha256: string; value: unknown }> {
  const bytes = await readFile(artifactPath);
  if (bytes.byteLength > MAX_GROUND_TRUTH_ARTIFACT_BYTES) {
    throw new Error(`${label} exceeds ${MAX_GROUND_TRUTH_ARTIFACT_BYTES} bytes`);
  }
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value: JSON.parse(bytes.toString("utf8")) as unknown,
  };
}

const GroundTruthInventorySchema = z.object({
  generated_at: z.string().datetime(),
  units: z.array(z.object({
    unit_id: z.string().regex(/^[a-f0-9]{64}$/u),
    display_name: z.string().min(1),
    source_paths: z.array(z.string().min(1)).min(1),
    candidate_count: z.number().int().nonnegative(),
    candidates: z.array(MoneyOccurrenceSchema),
  }).passthrough()).min(1),
}).passthrough();

const UnreadableCellSchema = z.object({
  source_locator: z.string().min(1).max(300),
  visible_amounts_krw: z.array(z.number().int().nonnegative()).max(100),
  estimated_content: z.string().min(1).max(2_000),
  reason: z.string().min(1).max(1_000),
}).strict();

const UnitExpectationsSchema = z.object({
  doc_kinds: z.array(z.enum([
    "agency_disclosure",
    "hall_disclosure",
    "partner_price_list",
    "mixed",
    "unknown",
  ])).min(1),
  allowed_partner_categories: z.array(z.enum([
    "studio",
    "dress",
    "makeup",
    "hall",
    "other",
  ])).min(1).optional(),
  policies: z.boolean(),
  pricing_basis: z.boolean(),
  sections: z.boolean(),
  halls_min: z.number().int().nonnegative(),
}).strict();

const GroundTruthOverlaySchema = z.object({
  schema_version: z.literal(1),
  created_at: z.string().datetime(),
  units: z.array(z.object({
    unit_id: z.string().regex(/^[a-f0-9]{64}$/u),
    readable_occurrences: z.array(MoneyOccurrenceSchema),
    unreadable_cells: z.array(UnreadableCellSchema),
    expectations: UnitExpectationsSchema,
  }).strict()).min(1),
}).strict();

const StableOccurrenceReferenceSchema = z.object({
  unit_id: z.string().regex(/^[a-f0-9]{64}$/u),
  source_locator: z.string().min(1).max(300),
  raw: z.string().min(1).max(200),
  // One-based among occurrences with the same unit, locator, and raw text.
  ordinal: z.number().int().positive(),
}).strict();

const AdjudicationResultSchema = MoneyOccurrenceSchema.extend({
  unit_id: z.string().regex(/^[a-f0-9]{64}$/u),
  ordinal: z.number().int().positive(),
}).strict();

const GroundTruthAdjudicationSchema = z.object({
  schema_version: z.literal(1),
  created_at: z.string().datetime(),
  base_ground_truth_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  decisions: z.array(z.object({
    decision_id: z.string().min(1).max(200),
    action: z.enum([
      "exclude_non_money",
      "merge_components",
      "add_missing",
      "replace_amount",
      "quarantine_source_anomaly",
      "semantic_expansion_only",
    ]),
    verification: z.enum(["verified", "human_required"]),
    references: z.array(StableOccurrenceReferenceSchema).max(100),
    result: AdjudicationResultSchema.optional(),
    reason: z.string().min(1).max(2_000),
    reviewed_by: z.string().min(1).max(200).optional(),
    reviewed_at: z.string().datetime().optional(),
  }).strict()).max(10_000),
}).strict();

export interface ExtractedMoneyOccurrence {
  path: string;
  krw: number;
  source_quote: string | null;
  source_file_ids: string[];
}

export interface LocatedMoneyOccurrence extends z.infer<typeof MoneyOccurrenceSchema> {
  origin: "inventory" | "manual_image" | "adjudication";
}

type StableOccurrenceReference = z.infer<typeof StableOccurrenceReferenceSchema>;
type GroundTruthAdjudication = z.infer<typeof GroundTruthAdjudicationSchema>;
type AdjudicationDecision = GroundTruthAdjudication["decisions"][number];

interface AppliedAdjudication {
  effective: LocatedMoneyOccurrence[];
  decisions: AdjudicationDecision[];
  excludedBaseOccurrences: number;
  addedEffectiveOccurrences: number;
  quarantinedOccurrences: number;
  humanRequired: Array<{
    decision_id: string;
    action: AdjudicationDecision["action"];
    reason: string;
    references: StableOccurrenceReference[];
    result: z.infer<typeof AdjudicationResultSchema> | null;
  }>;
}

export interface MatchResult {
  extracted_index: number;
  ground_truth_index: number;
  match_quality: "locator" | "quote_context" | "image_value_only";
}

export interface ScoreOptions {
  stateDir: string;
  unitIds: string[];
  groundTruthPath: string;
  expectedGroundTruthSha256: string;
  expectedOccurrenceCount: number;
  overlayPath?: string;
  expectedOverlaySha256?: string;
  adjudicationPath?: string;
  expectedAdjudicationSha256?: string;
  /** Units reported and scored, but excluded from the 25-unit batch gate. */
  nonBlockingUnitIds?: string[];
  /** Exact paid plan used to produce the strict extraction artifacts. */
  approvedPaidPlanSha256?: string;
  /**
   * Fail-closed pilot mode. Direct callers default to the legacy-compatible
   * scoring path; the operational CLI opts in explicitly.
   */
  requireValidatedArtifacts?: boolean;
  /** Explicitly select paid artifacts (default) or zero-cost review-only local evidence. */
  candidateSource?: "paid" | "local";
}

export function evaluateBatchGate(
  unitIds: string[],
  reports: Array<{
    unit_id?: unknown;
    status?: unknown;
    price_gate?: unknown;
  }>,
  nonBlockingUnitIds: string[] = [],
): {
  eligible: boolean;
  blocking_unit_ids: string[];
  non_blocking_unit_ids: string[];
  blocking_passed_units: number;
  blocking_failed_units: number;
  blocking_blocked_units: number;
} {
  const selected = new Set(unitIds);
  const nonBlocking = new Set(nonBlockingUnitIds);
  for (const unitId of nonBlocking) {
    if (!selected.has(unitId)) throw new Error(`non-blocking score unit is not selected: ${unitId}`);
  }
  const blockingUnitIds = unitIds.filter((unitId) => !nonBlocking.has(unitId));
  if (blockingUnitIds.length === 0) throw new Error("score requires at least one blocking unit");
  const reportById = new Map(reports.map((report) => [String(report.unit_id ?? ""), report]));
  const blockingReports = blockingUnitIds.map((unitId) => reportById.get(unitId));
  const hasManualLinkageReviews = (report: typeof blockingReports[number]): boolean => {
    const priceGate = report?.price_gate;
    if (!priceGate || typeof priceGate !== "object") return false;
    const reviews = (priceGate as { manual_linkage_reviews?: unknown }).manual_linkage_reviews;
    return Array.isArray(reviews) && reviews.length > 0;
  };
  // Defense in depth: a stale or forged unit status cannot make a blocking
  // unit batch-eligible while its structured source linkage still needs a
  // person to inspect it. The explicitly non-blocking May unit remains outside
  // these counters.
  const blockingPassedUnits = blockingReports.filter((report) =>
    report?.status === "pass" && !hasManualLinkageReviews(report)
  ).length;
  const blockingFailedUnits = blockingReports.filter((report) =>
    report?.status === "fail" || (report?.status === "pass" && hasManualLinkageReviews(report))
  ).length;
  const blockingBlockedUnits = blockingReports.filter((report) => report?.status === "blocked" || !report).length;
  return {
    eligible: blockingPassedUnits === blockingUnitIds.length
      && blockingFailedUnits === 0
      && blockingBlockedUnits === 0,
    blocking_unit_ids: blockingUnitIds,
    non_blocking_unit_ids: unitIds.filter((unitId) => nonBlocking.has(unitId)),
    blocking_passed_units: blockingPassedUnits,
    blocking_failed_units: blockingFailedUnits,
    blocking_blocked_units: blockingBlockedUnits,
  };
}

function occurrenceReferenceKey(reference: StableOccurrenceReference): string {
  return JSON.stringify([
    reference.unit_id,
    reference.source_locator,
    reference.raw,
    reference.ordinal,
  ]);
}

function locateOccurrenceIndex(
  unitId: string,
  occurrences: LocatedMoneyOccurrence[],
  reference: StableOccurrenceReference,
): number {
  if (reference.unit_id !== unitId) {
    throw new Error(`adjudication reference unit mismatch: ${reference.unit_id} != ${unitId}`);
  }
  const matches = occurrences
    .map((occurrence, index) => ({ occurrence, index }))
    .filter(({ occurrence }) => occurrence.source_locator === reference.source_locator
      && occurrence.raw === reference.raw);
  const selected = matches[reference.ordinal - 1];
  if (!selected) {
    throw new Error(`adjudication reference not found: ${occurrenceReferenceKey(reference)}`);
  }
  return selected.index;
}

function appliedAdjudicationForUnit(
  unitId: string,
  base: LocatedMoneyOccurrence[],
  decisions: AdjudicationDecision[],
): AppliedAdjudication {
  if (decisions.length === 0) {
    return {
      effective: base,
      decisions: [],
      excludedBaseOccurrences: 0,
      addedEffectiveOccurrences: 0,
      quarantinedOccurrences: 0,
      humanRequired: [],
    };
  }
  const effective = [...base];
  const removed = new Set<number>();
  const additions: LocatedMoneyOccurrence[] = [];
  const reservedResults: LocatedMoneyOccurrence[] = [];
  const seenReferences = new Set<string>();
  const humanRequired: AppliedAdjudication["humanRequired"] = [];
  const validateResultIdentity = (decision: AdjudicationDecision): LocatedMoneyOccurrence => {
    if (!decision.result || decision.result.unit_id !== unitId) {
      throw new Error(`adjudication result unit mismatch: ${decision.decision_id}`);
    }
    const existingIdentityCount = [
      ...base.filter((_, index) => !removed.has(index)),
      ...reservedResults,
    ].filter((occurrence) => occurrence.source_locator === decision.result?.source_locator
      && occurrence.raw === decision.result?.raw).length;
    if (decision.result.ordinal !== existingIdentityCount + 1) {
      throw new Error(
        `adjudication result ordinal mismatch: ${decision.decision_id}; expected=${existingIdentityCount + 1}, actual=${decision.result.ordinal}`,
      );
    }
    const { unit_id: _unitId, ordinal: _ordinal, ...occurrence } = decision.result;
    const located = { ...occurrence, origin: "adjudication" as const };
    reservedResults.push(located);
    return located;
  };

  for (const decision of decisions) {
    const referenceIndexes = decision.references.map((reference) => {
      const key = occurrenceReferenceKey(reference);
      if (seenReferences.has(key)) {
        throw new Error(`adjudication occurrence referenced more than once: ${key}`);
      }
      seenReferences.add(key);
      return locateOccurrenceIndex(unitId, base, reference);
    });
    if (decision.action === "exclude_non_money") {
      if (decision.references.length < 1 || decision.result) {
        throw new Error(`exclude_non_money requires references and no result: ${decision.decision_id}`);
      }
      referenceIndexes.forEach((index) => removed.add(index));
    } else if (decision.action === "replace_amount") {
      if (decision.references.length !== 1 || !decision.result) {
        throw new Error(`replace_amount requires one reference and one result: ${decision.decision_id}`);
      }
      if (decision.result.unit_id !== unitId) {
        throw new Error(`replace_amount result unit mismatch: ${decision.decision_id}`);
      }
      referenceIndexes.forEach((index) => removed.add(index));
      const result = validateResultIdentity(decision);
      if (decision.verification === "verified") additions.push(result);
    } else if (decision.action === "merge_components") {
      if (decision.references.length < 2 || !decision.result) {
        throw new Error(`merge_components requires multiple references and one result: ${decision.decision_id}`);
      }
      if (decision.result.unit_id !== unitId) {
        throw new Error(`merge_components result unit mismatch: ${decision.decision_id}`);
      }
      referenceIndexes.forEach((index) => removed.add(index));
      const result = validateResultIdentity(decision);
      if (decision.verification === "verified") additions.push(result);
    } else if (decision.action === "add_missing") {
      if (decision.references.length !== 0 || !decision.result) {
        throw new Error(`add_missing requires no references and one result: ${decision.decision_id}`);
      }
      const result = validateResultIdentity(decision);
      if (decision.verification === "verified") additions.push(result);
    } else if (decision.action === "quarantine_source_anomaly") {
      if (decision.references.length < 1 || decision.result) {
        throw new Error(
          `quarantine_source_anomaly requires references and no result: ${decision.decision_id}`,
        );
      }
      referenceIndexes.forEach((index) => removed.add(index));
    } else if (decision.action === "semantic_expansion_only") {
      if (decision.references.length < 1 || decision.result) {
        throw new Error(
          `semantic_expansion_only requires references and no price result: ${decision.decision_id}`,
        );
      }
    } else {
      throw new Error(`unsupported adjudication action: ${decision.action}`);
    }
    if (decision.verification === "human_required") {
      humanRequired.push({
        decision_id: decision.decision_id,
        action: decision.action,
        reason: decision.reason,
        references: decision.references,
        result: decision.result ?? null,
      });
    }
  }

  const humanRequiredQuarantinedOccurrences = humanRequired
    .filter((decision) => decision.action !== "semantic_expansion_only")
    .reduce(
      (sum, decision) => sum + Math.max(decision.references.length, decision.result ? 1 : 0),
      0,
    );
  const verifiedSourceAnomalyOccurrences = decisions
    .filter((decision) => decision.action === "quarantine_source_anomaly"
      && decision.verification === "verified")
    .reduce((sum, decision) => sum + decision.references.length, 0);
  return {
    effective: [...effective.filter((_, index) => !removed.has(index)), ...additions],
    decisions,
    excludedBaseOccurrences: removed.size,
    addedEffectiveOccurrences: additions.length,
    quarantinedOccurrences: humanRequiredQuarantinedOccurrences + verifiedSourceAnomalyOccurrences,
    humanRequired,
  };
}

function moneyValues(...values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  ))];
}

function extractedMoneyOccurrences(data: DisclosureExtraction): ExtractedMoneyOccurrence[] {
  if ((data.money_occurrences?.length ?? 0) > 0) {
    return (data.money_occurrences ?? []).map((occurrence, index) => ({
      path: `money_occurrences[${index}]`,
      krw: occurrence.amount_krw,
      source_quote: occurrence.source_quote,
      source_file_ids: occurrence.source_file_ids,
    }));
  }
  const result: ExtractedMoneyOccurrence[] = [];
  const add = (
    fieldPath: string,
    quote: string | null,
    sourceFileIds: string[] | undefined,
    ...values: Array<number | null>
  ): void => {
    for (const krw of moneyValues(...values)) {
      result.push({
        path: fieldPath,
        krw,
        source_quote: quote,
        source_file_ids: sourceFileIds ?? [],
      });
    }
  };

  data.agency_packages.forEach((item, itemIndex) => {
    add(
      `agency_packages[${itemIndex}]`,
      item.source_quote,
      item.source_file_ids,
      item.price_min_krw,
      item.price_max_krw,
    );
    item.options.forEach((option, optionIndex) => add(
      `agency_packages[${itemIndex}].options[${optionIndex}]`,
      option.source_quote,
      option.source_file_ids,
      option.price_min_krw,
      option.price_max_krw,
    ));
  });
  data.partner_vendors.forEach((item, itemIndex) => {
    add(
      `partner_vendors[${itemIndex}]`,
      item.source_quote,
      item.source_file_ids,
      item.price_min_krw,
      item.price_max_krw,
    );
    item.options.forEach((option, optionIndex) => add(
      `partner_vendors[${itemIndex}].options[${optionIndex}]`,
      option.source_quote,
      option.source_file_ids,
      option.price_min_krw,
      option.price_max_krw,
    ));
  });
  add(
    "hall.venue_fee_krw",
    data.hall.venue_fee_source_quote,
    data.hall.venue_fee_source_file_ids,
    data.hall.venue_fee_krw,
  );
  add(
    "hall.meal_price",
    data.hall.meal_price_source_quote,
    data.hall.meal_price_source_file_ids,
    data.hall.meal_price_min_krw,
    data.hall.meal_price_max_krw,
  );
  data.hall.items.forEach((item, itemIndex) => add(
    `hall.items[${itemIndex}]`,
    item.source_quote,
    item.source_file_ids,
    item.price_min_krw,
    item.price_max_krw,
  ));
  return result;
}

function structuredMoneyOccurrences(data: DisclosureExtraction): ExtractedMoneyOccurrence[] {
  const copy: DisclosureExtraction = {
    ...data,
    money_occurrences: [],
    // `hall` is a backward-compatible mirror of `halls`. When the canonical
    // multi-hall payload exists, score only that representation so the mirror
    // does not manufacture duplicate source occurrences.
    ...((data.halls?.length ?? 0) > 0 ? {
      hall: {
        venue_fee_krw: null,
        meal_price_min_krw: null,
        meal_price_max_krw: null,
        venue_fee_source_quote: null,
        meal_price_source_quote: null,
        venue_fee_source_file_ids: [],
        meal_price_source_file_ids: [],
        items: [],
        confidence: data.hall.confidence,
        needs_review: data.hall.needs_review,
      },
    } : {}),
  };
  const result = extractedMoneyOccurrences(copy);
  const add = (
    pathPrefix: string,
    quote: string | null,
    sourceFileIds: string[],
    ...values: Array<number | null>
  ): void => {
    for (const krw of moneyValues(...values)) {
      result.push({ path: pathPrefix, krw, source_quote: quote, source_file_ids: sourceFileIds });
    }
  };
  (data.halls ?? []).forEach((hall, hallIndex) => {
    add(
      `halls[${hallIndex}]`,
      hall.source_quote,
      hall.source_file_ids,
      hall.venue_fee_min_krw,
      hall.venue_fee_max_krw,
      hall.meal_price_min_krw,
      hall.meal_price_max_krw,
      hall.decoration_fee_min_krw,
      hall.decoration_fee_max_krw,
    );
    hall.options.forEach((option, optionIndex) => add(
      `halls[${hallIndex}].options[${optionIndex}]`,
      option.source_quote,
      option.source_file_ids,
      option.price_min_krw,
      option.price_max_krw,
    ));
  });
  return result;
}

function compactReviewEvidence(value: string): string {
  return normalizeEvidenceText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function needsReviewEvidenceTexts(data: DisclosureExtraction): string[] {
  const result: string[] = [];
  const add = (record: unknown, needsReview: boolean): void => {
    if (needsReview) result.push(compactReviewEvidence(JSON.stringify(record)));
  };
  data.agency_packages.forEach((record) => add(record, record.needs_review));
  data.partner_vendors.forEach((record) => add(record, record.needs_review));
  (data.halls ?? []).forEach((record) => add(record, record.needs_review));
  (data.sections ?? []).forEach((record) => add(record, record.needs_review));
  data.hall.items.forEach((record) => add(record, record.needs_review));
  add(data.hall, data.hall.needs_review);
  return result;
}

function unreadableCellDispositions(
  data: DisclosureExtraction,
  cells: Array<z.infer<typeof UnreadableCellSchema>>,
  unsafeExtractions: ExtractedMoneyOccurrence[],
): Array<{
  source_locator: string;
  visible_amounts_krw: number[];
  needs_review: boolean;
  amounts_remain_unstructured: boolean;
}> {
  const reviewEvidence = needsReviewEvidenceTexts(data);
  return cells.map((cell) => {
    const locatorLeaf = compactReviewEvidence(cell.source_locator.split("/").at(-1) ?? "");
    return {
      source_locator: cell.source_locator,
      visible_amounts_krw: [...cell.visible_amounts_krw],
      // The manually adjudicated locator leaf (for example, "기본추가" or
      // "헤어피스") must occur in a concrete record whose needs_review flag is
      // true. A generic, unrelated needs_review elsewhere is not disposition.
      needs_review: locatorLeaf.length >= 2
        && reviewEvidence.some((evidence) => evidence.includes(locatorLeaf)),
      amounts_remain_unstructured: !unsafeExtractions.some((item) =>
        cell.visible_amounts_krw.includes(item.krw)
      ),
    };
  });
}

function evidenceTokens(value: string): Set<string> {
  return new Set(
    normalizeEvidenceText(value)
      .split(/[^\p{L}\p{N}.,+~-]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  );
}

function overlapTokenCount(left: string, right: string): number {
  const leftTokens = evidenceTokens(left);
  const rightTokens = evidenceTokens(right);
  return [...leftTokens].filter((token) => rightTokens.has(token)).length;
}

function semanticOverlapTokenCount(left: string, right: string): number {
  const isMoneyOnly = (token: string): boolean =>
    /^(?:krw|[+~-]?\d[\d,.]*(?:원|만원|천원|억원)?)$/iu.test(token)
    || /^(?:원|만원|천원|억원)$/u.test(token);
  const leftTokens = [...evidenceTokens(left)].filter((token) => !isMoneyOnly(token));
  const rightTokens = evidenceTokens(right);
  return leftTokens.filter((token) => rightTokens.has(token) && !isMoneyOnly(token)).length;
}

interface ExcelCellLocator {
  sheet: string | null;
  column: number;
  row: number;
}

interface ExcelRangeLocator {
  sheet: string | null;
  startColumn: number;
  endColumn: number;
  startRow: number;
  endRow: number;
}

function excelColumnNumber(value: string): number {
  return [...value.toUpperCase()].reduce(
    (total, character) => total * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function normalizeSheetName(value: string): string {
  return value.trim().replace(/^'(.*)'$/u, "$1").normalize("NFKC").toLowerCase();
}

function parseExcelCellLocator(value: string): ExcelCellLocator | null {
  const match = /^(.*?)!([A-Z]{1,4})(\d+)$/iu.exec(normalizeEvidenceText(value));
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  return {
    sheet: normalizeSheetName(match[1]),
    column: excelColumnNumber(match[2]),
    row: Number.parseInt(match[3], 10),
  };
}

function parseExcelRangeAtQuoteStart(value: string): ExcelRangeLocator | null {
  const quote = normalizeEvidenceText(value);
  const sheetQualified = /^(.*?)!([A-Z]{1,4})(\d+)(?::([A-Z]{1,4})(\d+))?(?::|\s|$)/iu.exec(quote);
  const cellOnly = /^([A-Z]{1,4})(\d+)(?::([A-Z]{1,4})(\d+))?(?::|\s|$)/iu.exec(quote);
  const match = sheetQualified ?? cellOnly;
  if (!match) return null;
  const offset = sheetQualified ? 1 : 0;
  const sheet = sheetQualified && match[1] ? normalizeSheetName(match[1]) : null;
  const startColumnText = match[1 + offset];
  const startRowText = match[2 + offset];
  const endColumnText = match[3 + offset] ?? startColumnText;
  const endRowText = match[4 + offset] ?? startRowText;
  if (!startColumnText || !startRowText || !endColumnText || !endRowText) return null;
  const left = excelColumnNumber(startColumnText);
  const right = excelColumnNumber(endColumnText);
  const top = Number.parseInt(startRowText, 10);
  const bottom = Number.parseInt(endRowText, 10);
  return {
    sheet,
    startColumn: Math.min(left, right),
    endColumn: Math.max(left, right),
    startRow: Math.min(top, bottom),
    endRow: Math.max(top, bottom),
  };
}

function quoteRangeContainsCell(quote: string, candidateLocator: string): boolean {
  const cell = parseExcelCellLocator(candidateLocator);
  const range = parseExcelRangeAtQuoteStart(quote);
  if (!cell || !range) return false;
  if (range.sheet !== null && range.sheet !== cell.sheet) return false;
  return cell.column >= range.startColumn
    && cell.column <= range.endColumn
    && cell.row >= range.startRow
    && cell.row <= range.endRow;
}

function quoteLineMatchesCandidate(quote: string, candidateLocator: string): boolean {
  const quoteMatch = /^line:(\d+)(?::|\s|$)/iu.exec(normalizeEvidenceText(quote));
  const candidateMatch = /^line:(\d+)$/iu.exec(normalizeEvidenceText(candidateLocator));
  return Boolean(
    quoteMatch
    && candidateMatch
    && Number.parseInt(quoteMatch[1], 10) === Number.parseInt(candidateMatch[1], 10),
  );
}

function singleQuoteMatchQuality(
  extracted: ExtractedMoneyOccurrence,
  candidate: LocatedMoneyOccurrence,
  sourceQuote: string,
): MatchResult["match_quality"] | null {
  if (extracted.krw !== candidate.krw) return null;
  const quote = normalizeEvidenceText(sourceQuote);
  if (!quote) return null;
  const context = normalizeEvidenceText(candidate.line_context);
  const auxiliary = parseXlsxAuxiliaryEvidenceLine(quote);
  if (auxiliary) {
    return auxiliary.locator === candidate.source_locator
      && context === normalizeEvidenceText(auxiliary.payload)
      ? "locator"
      : null;
  }
  if (
    looksLikeXlsxAuxiliaryEvidence(quote)
    || candidate.source_locator.startsWith("XLSX_DRAWING ")
    || candidate.source_locator.startsWith("XLSX_FORMULA ")
  ) return null;
  if (/^line:\d+(?::|\s|$)/iu.test(quote)) {
    return quoteLineMatchesCandidate(quote, candidate.source_locator) ? "locator" : null;
  }
  // XLSX conversion quotes may intentionally cite a rectangular row range
  // (for example Sheet!A6:E6) or omit only the sheet name (B4). A candidate
  // cell inside that cited range is still occurrence-grounded evidence.
  if (quoteRangeContainsCell(quote, candidate.source_locator)) return "locator";
  // XLSX occurrences are only distinct by Sheet!Cell. Falling back to a
  // similar quote would let one repeated value cover a different cell.
  if (/^.+![A-Z]+\d+$/u.test(candidate.source_locator)) return null;
  if (
    semanticOverlapTokenCount(quote, context) >= 1
    && (
      (context && (context.includes(quote) || quote.includes(context)))
      || overlapTokenCount(quote, context) >= 2
    )
  ) {
    return "quote_context";
  }
  return null;
}

function matchQuality(
  extracted: ExtractedMoneyOccurrence,
  candidate: LocatedMoneyOccurrence,
): MatchResult["match_quality"] | null {
  const decoded = decodeEvidenceQuote(extracted.source_quote ?? "");
  if (decoded.kind === "invalid") return null;
  const quotes = decoded.kind === "merged"
    ? decoded.fragments.map((fragment) => fragment.quote)
    : [decoded.quote];
  const rank = { locator: 3, quote_context: 2, image_value_only: 1 } as const;
  let best: MatchResult["match_quality"] | null = null;
  for (const quote of quotes) {
    const quality = singleQuoteMatchQuality(extracted, candidate, quote);
    if (quality && (!best || rank[quality] > rank[best])) best = quality;
  }
  return best;
}

export function findOccurrenceMatches(
  extracted: ExtractedMoneyOccurrence[],
  groundTruth: LocatedMoneyOccurrence[],
): MatchResult[] {
  const rank = { locator: 3, quote_context: 2, image_value_only: 1 } as const;
  const adjacency = extracted.map((item) =>
    groundTruth
      .map((candidate, groundTruthIndex) => ({
        groundTruthIndex,
        quality: matchQuality(item, candidate),
      }))
      .filter((candidate): candidate is { groundTruthIndex: number; quality: MatchResult["match_quality"] } =>
        candidate.quality !== null
      )
      .sort((left, right) => rank[right.quality] - rank[left.quality] || left.groundTruthIndex - right.groundTruthIndex)
  );
  const groundTruthToExtracted = new Map<number, number>();

  const augment = (
    extractedIndex: number,
    visitedExtracted: Set<number>,
    visitedGroundTruth: Set<number>,
  ): boolean => {
    if (visitedExtracted.has(extractedIndex)) return false;
    visitedExtracted.add(extractedIndex);
    for (const candidate of adjacency[extractedIndex] ?? []) {
      if (visitedGroundTruth.has(candidate.groundTruthIndex)) continue;
      visitedGroundTruth.add(candidate.groundTruthIndex);
      const previousExtracted = groundTruthToExtracted.get(candidate.groundTruthIndex);
      if (
        previousExtracted === undefined
        || augment(previousExtracted, visitedExtracted, visitedGroundTruth)
      ) {
        groundTruthToExtracted.set(candidate.groundTruthIndex, extractedIndex);
        return true;
      }
    }
    return false;
  };

  const extractionOrder = extracted
    .map((_, index) => index)
    .sort((left, right) =>
      (adjacency[left]?.length ?? 0) - (adjacency[right]?.length ?? 0) || left - right
    );
  for (const extractedIndex of extractionOrder) {
    augment(extractedIndex, new Set<number>(), new Set<number>());
  }

  return [...groundTruthToExtracted.entries()]
    .map(([groundTruthIndex, extractedIndex]) => {
      const quality = adjacency[extractedIndex]
        ?.find((candidate) => candidate.groundTruthIndex === groundTruthIndex)?.quality;
      if (!quality) throw new Error("occurrence_match_internal_invariant_failed");
      return {
        extracted_index: extractedIndex,
        ground_truth_index: groundTruthIndex,
        match_quality: quality,
      };
    })
    .sort((left, right) => left.extracted_index - right.extracted_index);
}

export function classifyCoverageGapsAgainstGroundTruth(
  coverageGaps: CoverageGap[],
  groundTruth: LocatedMoneyOccurrence[],
): { actual: CoverageGap[]; excluded_as_not_ground_truth: CoverageGap[] } {
  const candidates: ExtractedMoneyOccurrence[] = coverageGaps.map((gap, index) => ({
    path: `validator_coverage_gaps[${index}]`,
    krw: gap.krw,
    source_quote: `${gap.source_locator}: ${gap.line_context}`,
    source_file_ids: [],
  }));
  const matchedIndexes = new Set(
    findOccurrenceMatches(candidates, groundTruth).map((match) => match.extracted_index),
  );
  return {
    actual: coverageGaps.filter((_, index) => matchedIndexes.has(index)),
    excluded_as_not_ground_truth: coverageGaps.filter((_, index) => !matchedIndexes.has(index)),
  };
}

function linkingErrors(
  unit: ManifestUnit,
  data: DisclosureExtraction,
  sourcePaths: string[],
  expectations: z.infer<typeof UnitExpectationsSchema> | undefined,
): Array<{ code: string; message: string }> {
  const errors: Array<{ code: string; message: string }> = [];
  const manifestPaths = unit.source_files.map((source) => source.path).sort();
  const inventoryPaths = [...sourcePaths].sort();
  if (JSON.stringify(manifestPaths) !== JSON.stringify(inventoryPaths)) {
    errors.push({ code: "source_unit_mismatch", message: "ground truth source_paths와 manifest unit 원본이 다릅니다." });
  }
  const allowedSourceFileIds = new Set(unit.source_files.map(sourceFileId));
  const unknownSourceFileIds = new Set<string>();
  const visitSourceReferences = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visitSourceReferences);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.source_file_ids)) {
      for (const sourceId of record.source_file_ids) {
        if (typeof sourceId === "string" && !allowedSourceFileIds.has(sourceId)) {
          unknownSourceFileIds.add(sourceId);
        }
      }
    }
    Object.values(record).forEach(visitSourceReferences);
  };
  visitSourceReferences(data);
  if (unknownSourceFileIds.size > 0) {
    errors.push({
      code: "source_file_id_mismatch",
      message: `추출 근거가 현재 unit 원본에 없는 source_file_id ${unknownSourceFileIds.size}개를 참조합니다.`,
    });
  }
  if (!data.business_name) {
    errors.push({ code: "business_name_missing", message: "추출 결과에 업체/대행사 상호가 없습니다." });
  } else if (![
    unit.parsed.raw_name,
    unit.parsed.corporate_name,
  ].filter((value): value is string => Boolean(value)).some((value) =>
    normalizeVendorName(data.business_name ?? "") === normalizeVendorName(value)
  )) {
    errors.push({
      code: "business_name_mismatch",
      message: `추출 상호(${data.business_name})와 canonical 업체(${unit.parsed.raw_name})가 다릅니다.`,
    });
  }
  const allowedKinds = expectations?.doc_kinds
    ?? (unit.parsed.kind_hint === "hall"
      ? ["hall_disclosure"]
      : ["agency_disclosure", "partner_price_list", "mixed"]);
  if (!allowedKinds.includes(data.doc_kind)) {
    errors.push({
      code: "category_mismatch",
      message: `문서 분류 ${data.doc_kind}가 허용 분류 ${allowedKinds.join(", ")}에 없습니다.`,
    });
  }
  if (!data.region_hint) {
    errors.push({
      code: "region_missing",
      message: "추출 결과에 canonical 지역 연결값이 없습니다.",
    });
  } else {
    const parsedRegion = regionCodeFromDirectory(data.region_hint);
    if (parsedRegion === "unknown") {
      errors.push({
        code: "region_unrecognized",
        message: `추출 지역(${data.region_hint})을 canonical 지역 코드로 해석할 수 없습니다.`,
      });
    } else if (parsedRegion !== unit.parsed.region_code) {
      errors.push({
        code: "region_mismatch",
        message: `추출 지역(${data.region_hint})과 canonical 지역(${unit.parsed.region_code})이 다릅니다.`,
      });
    }
  }
  data.partner_vendors.forEach((vendor, index) => {
    if (/^(?:unknown|vendor\s*\d+|업체(?:명)?\s*(?:미상|미기재)?|미상|행\s*\d+)$/iu.test(
      vendor.vendor_name.trim(),
    )) {
      errors.push({
        code: "partner_name_placeholder",
        message: `partner_vendors[${index}]가 실제 업체명이 아닌 placeholder를 사용했습니다.`,
      });
    }
    const decoded = decodeEvidenceQuote(vendor.source_quote);
    const evidenceQuotes = decoded.kind === "merged"
      ? decoded.fragments.map((fragment) => fragment.quote)
      : decoded.kind === "single" ? [decoded.quote] : [];
    const sheetCategories = new Set(evidenceQuotes.flatMap((quote) => {
      if (looksLikeXlsxAuxiliaryEvidence(quote)) return [];
      const sheet = /^(.+?)![A-Z]+\d+/iu.exec(normalizeEvidenceText(quote))?.[1]
        ?.replace(/[\s_-]/gu, "")
        .toLowerCase();
      if (!sheet) return [];
      if (sheet.includes("스튜디오") || sheet.includes("studio")) return ["studio" as const];
      if (sheet.includes("드레스") || sheet.includes("dress")) return ["dress" as const];
      if (sheet.includes("메이크업") || sheet.includes("makeup")) return ["makeup" as const];
      if (sheet.includes("예식장") || sheet.includes("hall")) return ["hall" as const];
      return [];
    }));
    if (sheetCategories.size === 1 && !sheetCategories.has(vendor.category as never)) {
      errors.push({
        code: "partner_category_source_mismatch",
        message: `partner_vendors[${index}] ${vendor.vendor_name}의 분류가 source_quote 시트와 다릅니다.`,
      });
    } else if (sheetCategories.size > 1) {
      errors.push({
        code: "partner_category_source_ambiguous",
        message: `partner_vendors[${index}] ${vendor.vendor_name}의 병합 근거가 서로 다른 카테고리 시트를 가리킵니다.`,
      });
    }
  });
  if (expectations?.allowed_partner_categories) {
    const allowed = new Set(expectations.allowed_partner_categories);
    data.partner_vendors.forEach((vendor, index) => {
      if (!allowed.has(vendor.category)) {
        errors.push({
          code: "partner_category_mismatch",
          message: `partner_vendors[${index}] ${vendor.vendor_name}의 분류 ${vendor.category}가 수동 기준과 다릅니다.`,
        });
      }
    });
  }
  return errors;
}

interface SemanticValidationIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

function semanticEvidenceFragments(sourceQuote: string): string[] {
  const decoded = decodeEvidenceQuote(sourceQuote);
  const quotes = decoded.kind === "single"
    ? [decoded.quote]
    : decoded.kind === "merged"
      ? decoded.fragments.map((fragment) => fragment.quote)
      : [];
  return quotes.flatMap((quote) => {
    if (looksLikeXlsxAuxiliaryEvidence(quote) && !parseXlsxAuxiliaryEvidenceLine(quote)) return [];
    return [normalizeEvidenceText(stripXlsxAuxiliaryEvidenceLocator(quote))
    .replace(/^(?:(?:.+?![A-Z]{1,4}\d+(?::[A-Z]{1,4}\d+)?)|(?:line:\d+)):\s*/iu, "")
    .trim()];
  })
    .filter(Boolean);
}

function semanticTextIsQuoted(sourceQuote: string, semanticText: string): boolean {
  const expected = normalizeEvidenceText(semanticText).toLowerCase();
  if (expected.length < 2) return false;
  return semanticEvidenceFragments(sourceQuote).some((fragment) => {
    const evidence = fragment.toLowerCase();
    return evidence.length >= 2 && (evidence.includes(expected) || expected.includes(evidence));
  });
}

function issueTouchesSemanticPath(issuePath: string, semanticPath: string): boolean {
  return issuePath === semanticPath
    || issuePath.startsWith(`${semanticPath}.`)
    || issuePath.startsWith(`${semanticPath}[`)
    || semanticPath.startsWith(`${issuePath}.`)
    || semanticPath.startsWith(`${issuePath}[`);
}

function semanticCapture(
  data: DisclosureExtraction,
  expectations: z.infer<typeof UnitExpectationsSchema> | undefined,
  provenanceValidated: boolean,
  validationIssues: SemanticValidationIssue[],
): Record<string, unknown> {
  const sections = data.sections ?? [];
  const halls = data.halls ?? [];
  const rejectedPaths = new Set<string>();
  const isValidatedPath = (recordPath: string): boolean => {
    const accepted = provenanceValidated && !validationIssues.some((issue) =>
      issueTouchesSemanticPath(issue.path, recordPath)
    );
    if (!accepted) rejectedPaths.add(recordPath);
    return accepted;
  };
  const acceptSemanticPath = (recordPath: string, semanticEvidenceMatches: boolean): boolean => {
    const accepted = isValidatedPath(recordPath) && semanticEvidenceMatches;
    if (!accepted) rejectedPaths.add(recordPath);
    return accepted;
  };
  const semanticTypeLabelPresent = (value: string, type: string): boolean => {
    const patterns: Record<string, RegExp> = {
      refund: /환불|refund/iu,
      penalty: /위약|취소\s*수수료|penalty/iu,
      contract: /계약|변경|contract|change/iu,
      reservation: /예약|reservation/iu,
      pricing: /가격|금액|요금|총비용|계산식|산정|산출|부가세|별도|포함|price|fee|vat/iu,
    };
    return patterns[type]?.test(value) ?? false;
  };
  const partnerPolicyCandidates = data.partner_vendors.flatMap((vendor, vendorIndex) =>
    (vendor.policies ?? []).map((policy, policyIndex) => ({
      path: `partner_vendors[${vendorIndex}].policies[${policyIndex}]`,
      policy,
    }))
  );
  const partnerPolicies = partnerPolicyCandidates.filter(({ path: recordPath, policy }) => {
    const type = policy.policy_type === "refund"
      ? "refund"
      : policy.policy_type === "penalty" ? "penalty"
        : policy.policy_type === "change" ? "contract" : "policy";
    const policyTypeMatches = type === "policy"
      ? /환불|위약|취소|계약|예약|변경|refund|penalty|cancel|contract|reservation|change/iu
        .test(policy.raw_text)
      : semanticTypeLabelPresent(policy.raw_text, type);
    return acceptSemanticPath(
      recordPath,
      semanticTextIsQuoted(policy.source_quote, policy.raw_text)
        && policyTypeMatches,
    );
  });
  const sectionCandidates = sections.map((section, index) => ({ path: `sections[${index}]`, section }));
  const verifiedSections = sectionCandidates.filter(({ path: recordPath, section }) =>
    acceptSemanticPath(
      recordPath,
      semanticTextIsQuoted(section.source_quote, section.content_verbatim),
    )
  );
  const documentPolicySections = verifiedSections.filter(({ path: recordPath, section }) => {
    const type = section.section_type === "refund_policy"
      ? "refund"
      : section.section_type === "penalty" ? "penalty"
        : section.section_type === "contract_terms" ? "contract"
          : section.section_type === "reservation" ? "reservation" : null;
    if (type === null) return false;
    const accepted = semanticTypeLabelPresent(section.content_verbatim, type);
    if (!accepted) rejectedPaths.add(recordPath);
    return accepted;
  });
  const pricingBasisSections = verifiedSections.filter(({ path: recordPath, section }) => {
    if (section.section_type !== "pricing_basis") return false;
    const decoded = decodeEvidenceQuote(section.source_quote);
    const quotes = decoded.kind === "single"
      ? [decoded.quote]
      : decoded.kind === "merged"
        ? decoded.fragments.map((fragment) => fragment.quote)
        : [];
    const exactFormulaEvidence = quotes.some((quote) =>
      parseXlsxAuxiliaryEvidenceLine(quote)?.locator.startsWith("XLSX_FORMULA ") === true
    );
    const accepted = exactFormulaEvidence
      || semanticTypeLabelPresent(section.content_verbatim, "pricing");
    if (!accepted) rejectedPaths.add(recordPath);
    return accepted;
  });
  const pricingBasisFallbackCandidates = [
    ...data.agency_packages.flatMap((item, index) => [
      { path: `agency_packages[${index}].vat_note`, value: item.vat_note, sourceQuote: item.source_quote },
      { path: `agency_packages[${index}].price_note`, value: item.price_note, sourceQuote: item.source_quote },
    ]),
    ...data.partner_vendors.map((item, index) => ({
      path: `partner_vendors[${index}].price_note`,
      value: item.price_note,
      sourceQuote: item.source_quote,
    })),
  ].filter((candidate): candidate is { path: string; value: string; sourceQuote: string } =>
    typeof candidate.value === "string" && candidate.value.trim().length > 0
  );
  const pricingBasisFallbacks = pricingBasisFallbackCandidates.filter((candidate) =>
    acceptSemanticPath(
      candidate.path,
      semanticTextIsQuoted(candidate.sourceQuote, candidate.value)
        && semanticTypeLabelPresent(candidate.value, "pricing"),
    )
  );
  const verifiedHalls = halls.filter((_, index) => isValidatedPath(`halls[${index}]`));
  const legacyHallCaptured = data.hall.venue_fee_krw !== null
    || data.hall.meal_price_min_krw !== null
    || data.hall.meal_price_max_krw !== null
    || data.hall.items.length > 0;
  const verifiedLegacyHallCaptured = legacyHallCaptured && isValidatedPath("hall");
  const observed = {
    policies: partnerPolicies.length + documentPolicySections.length,
    partner_policies: partnerPolicies.length,
    document_policy_sections: documentPolicySections.length,
    pricing_basis_sections: pricingBasisSections.length,
    pricing_basis_fallback_notes: pricingBasisFallbacks.length,
    sections: verifiedSections.length,
    halls: verifiedHalls.length,
    legacy_single_hall_payload: verifiedLegacyHallCaptured,
    raw: {
      partner_policies: partnerPolicyCandidates.length,
      sections: sectionCandidates.length,
      halls: halls.length,
      pricing_basis_fallback_notes: pricingBasisFallbackCandidates.length,
      legacy_single_hall_payload: legacyHallCaptured,
    },
    provenance_validation: provenanceValidated ? "strict_validated_artifact" : "unverified",
    rejected_paths: [...rejectedPaths].sort(),
  };
  if (!expectations) return { expected: null, observed, status: "not_grounded" };
  if (!provenanceValidated) {
    return {
      expected: expectations,
      observed,
      misses: ["strict_semantic_provenance"],
      status: "unverified",
    };
  }
  const misses = [
    ...(expectations.policies && observed.policies === 0 ? ["policies"] : []),
    ...(expectations.pricing_basis && observed.pricing_basis_sections === 0 ? ["pricing_basis"] : []),
    ...(expectations.sections && observed.sections === 0 ? ["sections"] : []),
    ...(observed.halls < expectations.halls_min ? ["halls"] : []),
  ];
  return {
    expected: expectations,
    observed,
    misses,
    status: misses.length === 0 ? "captured" : "missing",
  };
}

async function optionalValidatedCoverageGaps(
  unit: ManifestUnit,
  stateDir: string,
): Promise<CoverageGap[] | null> {
  const artifactPath = unit.validation?.artifact_path;
  if (!artifactPath) return null;
  try {
    const resolvedPath = path.resolve(artifactPath);
    if (!isPathWithin(stateDir, resolvedPath)) return null;
    await access(resolvedPath);
    const parsed = ValidatedArtifactSchema.safeParse(await readJsonFile(resolvedPath));
    if (!parsed.success || !unit.extraction) return null;
    const artifact = parsed.data;
    const expectedFingerprint = validatedArtifactFingerprint(
      artifact.extraction_fingerprint,
      artifact.data,
      artifact.issues,
      artifact.coverage_gaps,
    );
    if (
      artifact.unit_id !== unit.unit_id
      || artifact.source_fingerprint !== unit.source_fingerprint
      || artifact.extraction_fingerprint !== unit.extraction.fingerprint
      || artifact.fingerprint !== expectedFingerprint
      || artifact.fingerprint !== unit.validation?.fingerprint
    ) return null;
    return artifact.coverage_gaps;
  } catch {
    return null;
  }
}

class StrictScoreArtifactError extends Error {
  readonly blocker: string;

  constructor(blocker: string) {
    super(blocker);
    this.name = "StrictScoreArtifactError";
    this.blocker = blocker;
  }
}

export function strictArtifactBlocker(
  scope: "extraction_artifact" | "validated_artifact",
  error: unknown,
): StrictScoreArtifactError {
  const seen = new Set<unknown>();
  let current = error;
  while (
    current !== null
    && (typeof current === "object" || typeof current === "function")
    && !seen.has(current)
  ) {
    seen.add(current);
    if (current instanceof StrictScoreArtifactError) return current;
    if (current instanceof ArtifactIntegrityError) {
      return new StrictScoreArtifactError(`${scope}:${current.code}`);
    }
    if (current instanceof z.ZodError) {
      return new StrictScoreArtifactError(`${scope}:schema_invalid`);
    }
    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return new StrictScoreArtifactError(`${scope}:unreadable_or_invalid`);
}

function requireStrictArtifactCondition(condition: boolean, blocker: string): void {
  if (!condition) throw new StrictScoreArtifactError(blocker);
}

type StrictExtractionArtifact = z.infer<typeof StrictExtractionArtifactSchema>;

async function readStrictExtractionArtifact(
  unit: ManifestUnit,
  manifest: IngestManifest,
  stateDir: string,
  scannerParserVersion: string,
): Promise<StrictExtractionArtifact> {
  if (!unit.extraction) {
    throw new StrictScoreArtifactError("extraction_artifact:manifest_metadata_missing");
  }
  if (!unit.conversion) {
    throw new StrictScoreArtifactError("extraction_artifact:conversion_metadata_missing");
  }
  const manifestMetadata = unit.extraction as typeof unit.extraction & Record<string, unknown>;
  const converterVersion = unit.conversion.converter_version ?? "v1-legacy";
  const expectedFingerprint = currentExtractionFingerprint({
    scannerParserVersion,
    converterVersion,
    model: unit.extraction.model,
    rawName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    sourceFingerprint: unit.source_fingerprint,
    artifactFingerprint: unit.conversion.artifact_fingerprint,
  });
  try {
    requireStrictArtifactCondition(
      typeof manifestMetadata.content_sha256 === "string",
      "extraction_artifact:artifact_content_hash_missing",
    );
    requireStrictArtifactCondition(
      unit.extraction.prompt_version === EXTRACTION_PROMPT_VERSION
      && unit.extraction.prompt_hash === EXTRACTION_PROMPT_HASH
      && unit.extraction.processing_version === EXTRACTION_PROCESSING_VERSION,
      "extraction_artifact:current_contract_mismatch",
    );
    requireStrictArtifactCondition(
      unit.extraction.fingerprint === expectedFingerprint,
      "extraction_artifact:current_fingerprint_mismatch",
    );
    const { verifyCurrentExtractionCacheForUnit } = await import("./extract.js");
    const artifact = await verifyCurrentExtractionCacheForUnit(unit, manifest, stateDir);
    requireStrictArtifactCondition(
      artifact.unit_id === unit.unit_id
      && artifact.fingerprint === unit.extraction.fingerprint
      && artifact.source_fingerprint === unit.source_fingerprint
      && artifact.source_fingerprint === unit.extraction.source_fingerprint
      && artifact.artifact_fingerprint === unit.extraction.artifact_fingerprint
      && artifact.prompt_version === unit.extraction.prompt_version
      && artifact.model === unit.extraction.model,
      "extraction_artifact:manifest_identity_mismatch",
    );
    requireStrictArtifactCondition(
      manifestMetadata.content_sha256 === artifact.content_sha256
      && manifestMetadata.provider_mode === artifact.provider_mode
      && manifestMetadata.paid_plan_sha256 === artifact.paid_plan_sha256
      && manifestMetadata.prompt_hash === artifact.prompt_hash
      && manifestMetadata.processing_version === artifact.processing_version
      && manifestMetadata.scanner_parser_version === artifact.scanner_parser_version
      && manifestMetadata.converter_version === artifact.converter_version,
      "extraction_artifact:strict_manifest_metadata_missing_or_mismatch",
    );
    requireStrictArtifactCondition(
      unit.extraction.prompt_version === EXTRACTION_PROMPT_VERSION
      && unit.extraction.prompt_hash === EXTRACTION_PROMPT_HASH
      && unit.extraction.processing_version === EXTRACTION_PROCESSING_VERSION
      && artifact.prompt_version === EXTRACTION_PROMPT_VERSION
      && artifact.prompt_hash === EXTRACTION_PROMPT_HASH
      && artifact.processing_version === EXTRACTION_PROCESSING_VERSION,
      "extraction_artifact:current_contract_mismatch",
    );
    requireStrictArtifactCondition(
      unit.conversion.source_fingerprint === unit.source_fingerprint
      && unit.conversion.artifact_fingerprint === artifact.artifact_fingerprint
      && unit.extraction.artifact_fingerprint === unit.conversion.artifact_fingerprint
      && artifact.scanner_parser_version === scannerParserVersion
      && artifact.converter_version === converterVersion,
      "extraction_artifact:current_conversion_identity_mismatch",
    );
    requireStrictArtifactCondition(
      unit.extraction.fingerprint === expectedFingerprint
      && artifact.fingerprint === expectedFingerprint,
      "extraction_artifact:current_fingerprint_mismatch",
    );
    return artifact;
  } catch (error) {
    throw strictArtifactBlocker("extraction_artifact", error);
  }
}

async function strictCheckpointRequestHashes(
  stateDir: string,
  extraction: z.infer<typeof StrictExtractionArtifactSchema>,
): Promise<string[]> {
  const requestHashes: string[] = [];
  for (const checkpointFingerprint of extraction.batch_checkpoint_fingerprints) {
    const checkpointPath = path.join(
      stateDir,
      ".cache",
      "extract-batches",
      `${checkpointFingerprint}.json`,
    );
    await verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath: checkpointPath,
      expectedRelativePath: path.join(
        ".cache",
        "extract-batches",
        `${checkpointFingerprint}.json`,
      ),
    });
    const raw = await readJsonFile(checkpointPath);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("strict_checkpoint_schema_invalid");
    }
    verifyJsonContentHash(raw as Record<string, unknown>, "content_sha256");
    const checkpoint = ExtractionBatchCheckpointSchema.parse(raw);
    if (
      checkpoint.checkpoint_fingerprint !== checkpointFingerprint
      || checkpoint.provider_mode !== extraction.provider_mode
      || checkpoint.paid_plan_sha256 !== extraction.paid_plan_sha256
      || checkpoint.unit_id !== extraction.unit_id
      || checkpoint.extraction_fingerprint !== extraction.fingerprint
    ) {
      throw new Error("strict_checkpoint_fingerprint_mismatch");
    }
    requestHashes.push(checkpoint.request_hash);
  }
  return requestHashes;
}

async function readStrictValidatedArtifact(
  unit: ManifestUnit,
  stateDir: string,
  extraction: StrictExtractionArtifact,
): Promise<z.infer<typeof StrictValidatedArtifactSchema>> {
  if (!unit.validation) {
    throw new StrictScoreArtifactError("validated_artifact:manifest_metadata_missing");
  }
  try {
    const artifactPath = await verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath: unit.validation.artifact_path,
      expectedRelativePath: path.join("validated", `${unit.unit_id}.json`),
    });
    const rawArtifact = await readJsonFile(artifactPath);
    requireStrictArtifactCondition(
      typeof rawArtifact === "object" && rawArtifact !== null && !Array.isArray(rawArtifact),
      "validated_artifact:schema_invalid",
    );
    verifyJsonContentHash(rawArtifact as Record<string, unknown>, "content_sha256");
    const artifact = StrictValidatedArtifactSchema.parse(rawArtifact);
    const expectedFingerprint = validatedArtifactFingerprint(
      artifact.extraction_fingerprint,
      artifact.data,
      artifact.issues,
      artifact.coverage_gaps,
    );
    const expectedSourceFiles = unit.source_files.map((source) => ({
      path: source.path,
      sha256: source.sha256,
      bytes: source.bytes,
    }));
    const manifestMetadata = unit.validation as typeof unit.validation & Record<string, unknown>;
    requireStrictArtifactCondition(
      artifact.unit_id === unit.unit_id
      && artifact.source_fingerprint === unit.source_fingerprint
      && artifact.extraction_fingerprint === unit.extraction?.fingerprint
      && artifact.extraction_fingerprint === extraction.fingerprint,
      "validated_artifact:manifest_identity_mismatch",
    );
    requireStrictArtifactCondition(
      artifact.fingerprint === expectedFingerprint
      && artifact.fingerprint === unit.validation.fingerprint,
      "validated_artifact:fingerprint_mismatch",
    );
    requireStrictArtifactCondition(
      manifestMetadata.content_sha256 === artifact.content_sha256
      && manifestMetadata.extraction_content_sha256 === artifact.extraction_content_sha256
      && manifestMetadata.validator_version === artifact.validator_version
      && artifact.extraction_content_sha256 === extraction.content_sha256,
      "validated_artifact:strict_manifest_metadata_missing_or_mismatch",
    );
    requireStrictArtifactCondition(
      artifact.prompt_version === extraction.prompt_version
      && artifact.prompt_hash === extraction.prompt_hash
      && artifact.model === extraction.model,
      "validated_artifact:extraction_provenance_mismatch",
    );
    requireStrictArtifactCondition(
      artifact.review_status === unit.validation.review_status
      && artifact.issues.length === unit.validation.issue_count
      && artifact.validated_at === unit.validation.validated_at,
      "validated_artifact:manifest_validation_metadata_mismatch",
    );
    requireStrictArtifactCondition(
      isDeepStrictEqual(artifact.source_files, expectedSourceFiles),
      "validated_artifact:source_files_mismatch",
    );
    const replayed = await deriveValidatedPayloadForUnit(unit, extraction);
    requireStrictArtifactCondition(
      isDeepStrictEqual(artifact.data, replayed.data),
      "validated_artifact:data_replay_mismatch",
    );
    requireStrictArtifactCondition(
      isDeepStrictEqual(artifact.issues, replayed.issues),
      "validated_artifact:issues_replay_mismatch",
    );
    requireStrictArtifactCondition(
      isDeepStrictEqual(artifact.coverage_gaps, replayed.coverageGaps),
      "validated_artifact:coverage_gaps_replay_mismatch",
    );
    return artifact;
  } catch (error) {
    throw strictArtifactBlocker("validated_artifact", error);
  }
}

function normalizedSha256(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new Error(`${label}은 SHA-256 64자리여야 합니다.`);
  return normalized;
}

export async function scoreExtractionAgainstGroundTruth(options: ScoreOptions): Promise<Record<string, unknown>> {
  const stateDir = path.resolve(options.stateDir);
  const requireValidatedArtifacts = options.requireValidatedArtifacts === true;
  const candidateSource = options.candidateSource ?? "paid";
  if (candidateSource === "local" && !requireValidatedArtifacts) {
    throw new Error("local_candidate_source_requires_strict_validated_artifacts");
  }
  if (candidateSource === "local" && options.approvedPaidPlanSha256) {
    throw new Error("local_candidate_source_cannot_claim_paid_plan");
  }
  const paidPlanSha256 = candidateSource === "paid" && options.approvedPaidPlanSha256
    ? normalizedSha256(options.approvedPaidPlanSha256, "approvedPaidPlanSha256")
    : null;
  const paidPlan = paidPlanSha256
    ? await readFixedEightPaidExtractionPlanApproval(stateDir, paidPlanSha256)
    : null;
  const overlayPair = requireStrictPathHashPair({
    artifactPath: options.overlayPath,
    expectedSha256: options.expectedOverlaySha256,
    label: "overlayPath",
  });
  let adjudicationPair: ReturnType<typeof requireStrictPathHashPair>;
  try {
    adjudicationPair = requireStrictPathHashPair({
      artifactPath: options.adjudicationPath,
      expectedSha256: options.expectedAdjudicationSha256,
      label: "adjudicationPath",
    });
  } catch (error) {
    if (error instanceof ArtifactIntegrityError && error.code === "path_hash_pair_incomplete") {
      throw new Error("adjudicationPath and expectedAdjudicationSha256 must be provided together");
    }
    throw error;
  }
  const groundTruthPath = path.resolve(options.groundTruthPath);
  if (!isPathWithin(stateDir, groundTruthPath)) {
    throw new Error("ground truth는 ignored ingest state 디렉터리 안에 있어야 합니다.");
  }
  const expectedGroundTruthSha256 = normalizedSha256(
    options.expectedGroundTruthSha256,
    "expectedGroundTruthSha256",
  );
  const groundTruthSnapshot = await readHashedJsonOnce(groundTruthPath, "ground truth");
  if (groundTruthSnapshot.sha256 !== expectedGroundTruthSha256) {
    throw new Error(`ground truth SHA-256 불일치: expected=${expectedGroundTruthSha256}, actual=${groundTruthSnapshot.sha256}`);
  }
  const inventory = GroundTruthInventorySchema.parse(groundTruthSnapshot.value);
  const inventoryOccurrenceCount = inventory.units.reduce((sum, unit) => {
    if (unit.candidate_count !== unit.candidates.length) {
      throw new Error(`ground truth candidate_count 불일치: ${unit.unit_id}`);
    }
    return sum + unit.candidates.length;
  }, 0);
  if (inventoryOccurrenceCount !== options.expectedOccurrenceCount) {
    throw new Error(
      `ground truth occurrence 불일치: expected=${options.expectedOccurrenceCount}, actual=${inventoryOccurrenceCount}`,
    );
  }
  let overlay: z.infer<typeof GroundTruthOverlaySchema> | null = null;
  let overlayHash: string | null = null;
  if (overlayPair) {
    const overlayPath = path.resolve(overlayPair.artifactPath);
    if (!isPathWithin(stateDir, overlayPath)) {
      throw new Error("ground truth overlay는 ignored ingest state 디렉터리 안에 있어야 합니다.");
    }
    const overlaySnapshot = await readHashedJsonOnce(overlayPath, "ground truth overlay");
    overlayHash = overlaySnapshot.sha256;
    if (overlayHash !== overlayPair.expectedSha256) {
      throw new Error(`overlay SHA-256 불일치: expected=${overlayPair.expectedSha256}, actual=${overlayHash}`);
    }
    overlay = GroundTruthOverlaySchema.parse(overlaySnapshot.value);
  }

  let adjudication: GroundTruthAdjudication | null = null;
  let adjudicationHash: string | null = null;
  if (adjudicationPair) {
    const adjudicationPath = path.resolve(adjudicationPair.artifactPath);
    if (!isPathWithin(stateDir, adjudicationPath)) {
      throw new Error("ground truth adjudication must be inside ignored ingest state directory");
    }
    const adjudicationSnapshot = await readHashedJsonOnce(adjudicationPath, "ground truth adjudication");
    adjudicationHash = adjudicationSnapshot.sha256;
    if (adjudicationHash !== adjudicationPair.expectedSha256) {
      throw new Error(`adjudication SHA-256 mismatch: expected=${adjudicationPair.expectedSha256}, actual=${adjudicationHash}`);
    }
    adjudication = GroundTruthAdjudicationSchema.parse(adjudicationSnapshot.value);
    if (adjudication.base_ground_truth_sha256 !== groundTruthSnapshot.sha256) {
      throw new Error(
        `adjudication base SHA-256 mismatch: declared=${adjudication.base_ground_truth_sha256}, actual=${groundTruthSnapshot.sha256}`,
      );
    }
    const decisionIds = adjudication.decisions.map((decision) => decision.decision_id);
    if (new Set(decisionIds).size !== decisionIds.length) {
      throw new Error("adjudication decision_id values must be unique");
    }
  }

  const uniqueUnitIds = [...new Set(options.unitIds)];
  if (uniqueUnitIds.length === 0) throw new Error("score에는 unit ID가 하나 이상 필요합니다.");
  if (uniqueUnitIds.length !== options.unitIds.length) throw new Error("score unit ID에 중복이 있습니다.");
  const uniqueNonBlockingUnitIds = [...new Set(options.nonBlockingUnitIds ?? [])];
  if (uniqueNonBlockingUnitIds.length !== (options.nonBlockingUnitIds?.length ?? 0)) {
    throw new Error("non-blocking score unit IDs must be unique");
  }
  const manifest = await loadManifest(stateDir);
  const inventoryById = new Map(inventory.units.map((unit) => [unit.unit_id, unit]));
  const overlayById = new Map(overlay?.units.map((unit) => [unit.unit_id, unit]) ?? []);
  const manifestById = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
  const decisionsByUnit = new Map<string, AdjudicationDecision[]>();
  for (const decision of adjudication?.decisions ?? []) {
    const unitIds = new Set([
      ...decision.references.map((reference) => reference.unit_id),
      ...(decision.result ? [decision.result.unit_id] : []),
    ]);
    if (unitIds.size !== 1) {
      throw new Error(`adjudication decision must target exactly one unit: ${decision.decision_id}`);
    }
    const unitId = [...unitIds][0];
    if (!unitId || !inventoryById.has(unitId)) {
      throw new Error(`adjudication decision targets unknown ground-truth unit: ${decision.decision_id}`);
    }
    decisionsByUnit.set(unitId, [...(decisionsByUnit.get(unitId) ?? []), decision]);
  }
  const adjudicatedById = new Map<string, AppliedAdjudication>();
  for (const inventoryUnit of inventory.units) {
    const overlayUnit = overlayById.get(inventoryUnit.unit_id);
    const base: LocatedMoneyOccurrence[] = [
      ...inventoryUnit.candidates.map((candidate) => ({ ...candidate, origin: "inventory" as const })),
      ...(overlayUnit?.readable_occurrences.map((candidate) => ({
        ...candidate,
        origin: "manual_image" as const,
      })) ?? []),
    ];
    adjudicatedById.set(
      inventoryUnit.unit_id,
      appliedAdjudicationForUnit(
        inventoryUnit.unit_id,
        base,
        decisionsByUnit.get(inventoryUnit.unit_id) ?? [],
      ),
    );
  }
  const reports: Array<Record<string, unknown>> = [];

  for (const unitId of uniqueUnitIds) {
    const unit = manifestById.get(unitId);
    const inventoryUnit = inventoryById.get(unitId);
    const overlayUnit = overlayById.get(unitId);
    const appliedAdjudication = adjudicatedById.get(unitId);
    if (!unit || !inventoryUnit) {
      reports.push({
        unit_id: unitId,
        status: "blocked",
        blockers: [!unit ? "manifest_unit_missing" : "ground_truth_unit_missing"],
      });
      continue;
    }
    const stageIsScoreable = candidateSource === "local"
      ? unit.local_extraction
        ? unit.stage === "validated"
          || (unit.stage === "error" && Boolean(unit.validation))
        : Boolean(
            unit.conversion
            && unit.extraction?.provider_mode === "production_paid"
            && ["extracted", "validated", "error"].includes(unit.stage),
          )
      : requireValidatedArtifacts
        ? unit.stage === "validated"
          || (unit.stage === "error" && Boolean(unit.extraction) && Boolean(unit.validation))
        : unit.stage === "extracted" || unit.stage === "validated";
    if (!stageIsScoreable) {
      reports.push({
        unit_id: unitId,
        display_name: unit.display_name,
        status: "blocked",
        blockers: [requireValidatedArtifacts
          ? `unit_stage_not_validated:${unit.stage}`
          : `unit_stage_not_scoreable:${unit.stage}`],
        readable_ground_truth_occurrences: appliedAdjudication?.effective.length
          ?? inventoryUnit.candidates.length + (overlayUnit?.readable_occurrences.length ?? 0),
        unreadable_cells: overlayUnit?.unreadable_cells ?? [],
      });
      continue;
    }
    if (candidateSource === "paid" && !unit.extraction?.artifact_path) {
      reports.push({
        unit_id: unitId,
        display_name: unit.display_name,
        status: "blocked",
        blockers: ["extraction_artifact_missing"],
        readable_ground_truth_occurrences: inventoryUnit.candidates.length
          + (overlayUnit?.readable_occurrences.length ?? 0),
        unreadable_cells: overlayUnit?.unreadable_cells ?? [],
      });
      continue;
    }
    let extraction: {
      data: DisclosureExtraction;
      prompt_version: string;
      model: string;
    };
    let strictValidatorCoverageGaps: CoverageGap[] | null = null;
    let strictBlockingValidationIssues: Array<{
      severity: "error";
      code: string;
      path: string;
      message: string;
    }> = [];
    let strictLinkageReviewWarnings: Array<{
      severity: "warning";
      code: string;
      path: string;
      message: string;
    }> = [];
    let strictSemanticValidationIssues: SemanticValidationIssue[] = [];
    let strictProvenance: Record<string, unknown> | null = null;
    if (candidateSource === "local") {
      const activeLocal = Boolean(unit.local_extraction);
      try {
        if (activeLocal) {
          const localValidation = await verifyCurrentLocalValidatedArtifactForUnit(
            unit,
            manifest,
            stateDir,
          );
          extraction = {
            data: localValidation.data,
            prompt_version: localValidation.engine_version,
            model: localValidation.model,
          };
          strictValidatorCoverageGaps = localValidation.coverage_gaps;
          strictBlockingValidationIssues = localValidation.issues.filter(
            (issue): issue is typeof issue & { severity: "error" } => issue.severity === "error",
          );
          strictLinkageReviewWarnings = localValidation.issues.filter(
            (issue): issue is typeof issue & { severity: "warning" } =>
              issue.severity === "warning" && isStructuredRecordSourceLinkageCode(issue.code),
          );
          strictSemanticValidationIssues = localValidation.issues;
          strictProvenance = {
            candidate_source: "active_local_validation",
            source_fingerprint: localValidation.source_fingerprint,
            conversion_fingerprint: unit.conversion?.artifact_fingerprint ?? null,
            extraction_fingerprint: localValidation.extraction_fingerprint,
            extraction_content_sha256: localValidation.extraction_content_sha256,
            validation_fingerprint: localValidation.fingerprint,
            validation_content_sha256: localValidation.content_sha256,
            model: localValidation.model,
            engine_version: localValidation.engine_version,
            engine_hash: localValidation.engine_hash,
            validator_version: localValidation.validator_version,
            review_status: localValidation.review_status,
            needs_review: localValidation.needs_review,
            bulk_approval_eligible: localValidation.bulk_approval_eligible,
          };
        } else {
          const { verifyCurrentLocalCandidateForUnit } = await import("./local-candidate.js");
          const verified = await verifyCurrentLocalCandidateForUnit(unit, manifest, stateDir);
          const candidate = verified.candidate;
          extraction = {
            data: candidate.data,
            prompt_version: candidate.local_engine.engine_version,
            model: candidate.model,
          };
          strictValidatorCoverageGaps = candidate.coverage_gaps;
          strictBlockingValidationIssues = candidate.validation_issues.filter(
            (issue): issue is typeof issue & { severity: "error" } => issue.severity === "error",
          );
          strictLinkageReviewWarnings = candidate.validation_issues.filter(
            (issue): issue is typeof issue & { severity: "warning" } =>
              issue.severity === "warning" && isStructuredRecordSourceLinkageCode(issue.code),
          );
          strictSemanticValidationIssues = candidate.validation_issues;
          strictProvenance = {
            candidate_source: "local_candidate_sidecar",
            source_fingerprint: candidate.source_fingerprint,
            conversion_fingerprint: candidate.conversion_fingerprint,
            candidate_fingerprint: candidate.fingerprint,
            candidate_content_sha256: candidate.content_sha256,
            receipt_fingerprint: verified.receipt.fingerprint,
            receipt_content_sha256: verified.receipt.content_sha256,
            paid_extraction_fingerprint: candidate.paid_extraction.fingerprint,
            paid_extraction_content_sha256: candidate.paid_extraction.content_sha256,
            paid_plan_sha256: candidate.paid_extraction.paid_plan_sha256,
            model: candidate.model,
            engine_version: candidate.local_engine.engine_version,
            engine_hash: candidate.local_engine.engine_hash,
            validator_version: candidate.local_engine.validator_version,
            review_status: candidate.review_status,
            needs_review: candidate.needs_review,
            bulk_approval_eligible: candidate.bulk_approval_eligible,
            adoption_status: candidate.adoption_status,
          };
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unreadable_or_invalid";
        reports.push({
          unit_id: unitId,
          display_name: unit.display_name,
          status: "blocked",
          blockers: [`${activeLocal ? "local_validation_artifact" : "local_candidate_artifact"}:${detail}`],
          readable_ground_truth_occurrences: appliedAdjudication?.effective.length
            ?? inventoryUnit.candidates.length + (overlayUnit?.readable_occurrences.length ?? 0),
          unreadable_cells: overlayUnit?.unreadable_cells ?? [],
        });
        continue;
      }
    } else if (requireValidatedArtifacts) {
      try {
        const strictExtraction = await readStrictExtractionArtifact(
          unit,
          manifest,
          stateDir,
          manifest.scanner_parser_version,
        );
        await verifyValidationInputsUnchanged(unit, manifest);
        const strictValidation = await readStrictValidatedArtifact(unit, stateDir, strictExtraction);
        const requestHashes = await strictCheckpointRequestHashes(stateDir, strictExtraction);
        const approvedPlanUnit = paidPlan?.payload.units.find((candidate) => candidate.unit_id === unitId);
        if (strictExtraction.provider_mode === "production_paid" && !paidPlan) {
          throw new StrictScoreArtifactError("extraction_artifact:paid_plan_required_for_production_artifact");
        }
        if (paidPlan && (
          !approvedPlanUnit
          || strictExtraction.provider_mode !== "production_paid"
          || strictExtraction.paid_plan_sha256 !== paidPlan.plan_sha256
          || paidPlan.payload.model !== strictExtraction.model
          || approvedPlanUnit.source_fingerprint !== unit.source_fingerprint
          || approvedPlanUnit.artifact_fingerprint !== strictExtraction.artifact_fingerprint
          || approvedPlanUnit.converter_version !== strictExtraction.converter_version
          || !isDeepStrictEqual(approvedPlanUnit.request_hashes, requestHashes)
        )) {
          throw new StrictScoreArtifactError("extraction_artifact:paid_plan_provenance_mismatch");
        }
        strictProvenance = {
          paid_plan_sha256: strictExtraction.paid_plan_sha256,
          source_fingerprint: unit.source_fingerprint,
          conversion_fingerprint: strictExtraction.artifact_fingerprint,
          extraction_fingerprint: strictExtraction.fingerprint,
          extraction_content_sha256: strictExtraction.content_sha256,
          validation_fingerprint: strictValidation.fingerprint,
          validation_content_sha256: strictValidation.content_sha256,
          model: strictExtraction.model,
          prompt_version: strictExtraction.prompt_version,
          prompt_hash: strictExtraction.prompt_hash,
          processing_version: strictExtraction.processing_version,
          scanner_parser_version: strictExtraction.scanner_parser_version,
          converter_version: strictExtraction.converter_version,
          request_hashes: requestHashes,
        };
        // Validation deterministically repairs/enriches row-level provenance.
        // Score the exact content-bound pending staging payload, while its
        // extraction fingerprint/content hash retain the upstream binding.
        extraction = { ...strictExtraction, data: strictValidation.data };
        strictValidatorCoverageGaps = strictValidation.coverage_gaps;
        strictBlockingValidationIssues = strictValidation.issues.filter(
          (issue): issue is typeof issue & { severity: "error" } => issue.severity === "error",
        );
        strictLinkageReviewWarnings = strictValidation.issues.filter(
          (issue): issue is typeof issue & { severity: "warning" } =>
            issue.severity === "warning" && isStructuredRecordSourceLinkageCode(issue.code),
        );
        strictSemanticValidationIssues = strictValidation.issues;
      } catch (error) {
        const blocker = error instanceof StrictScoreArtifactError
          ? error.blocker
          : "strict_artifact_verification_failed";
        reports.push({
          unit_id: unitId,
          display_name: unit.display_name,
          status: "blocked",
          blockers: [blocker],
          readable_ground_truth_occurrences: appliedAdjudication?.effective.length
            ?? inventoryUnit.candidates.length + (overlayUnit?.readable_occurrences.length ?? 0),
          unreadable_cells: overlayUnit?.unreadable_cells ?? [],
        });
        continue;
      }
    } else {
      const extractionPath = path.resolve(unit.extraction!.artifact_path);
      if (!isPathWithin(stateDir, extractionPath)) {
        throw new Error(`extraction artifact가 state 밖을 가리킵니다: ${unitId}`);
      }
      extraction = ExtractionArtifactSchema.parse(await readJsonFile(extractionPath));
    }
    const baseGroundTruthOccurrenceCount = inventoryUnit.candidates.length
      + (overlayUnit?.readable_occurrences.length ?? 0);
    const groundTruth = appliedAdjudication?.effective ?? [];
    if (groundTruth.length === 0) {
      reports.push({
        unit_id: unitId,
        display_name: unit.display_name,
        prompt_version: extraction.prompt_version,
        model: extraction.model,
        status: "blocked",
        blockers: ["readable_ground_truth_missing"],
        unreadable_cells: overlayUnit?.unreadable_cells ?? [],
      });
      continue;
    }

    const extracted = extractedMoneyOccurrences(extraction.data);
    const matches = findOccurrenceMatches(extracted, groundTruth);
    const matchedExtracted = new Set(matches.map((match) => match.extracted_index));
    const matchedGroundTruth = new Set(matches.map((match) => match.ground_truth_index));
    const hallucinated = extracted
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => !matchedExtracted.has(index))
      .map(({ item }) => ({
        ...item,
        reason: groundTruth.some((candidate) => candidate.krw === item.krw)
          ? "amount_exists_but_occurrence_location_not_grounded_or_duplicate_overflow"
          : "amount_not_in_ground_truth",
      }));
    const missing = groundTruth.filter((_, index) => !matchedGroundTruth.has(index));
    // Structured fields are checked independently of the audit ledger. Matching
    // is one-to-one so one source amount cannot authorize an arbitrary number of
    // duplicated structured prices. Human-required/quarantined values are
    // deliberately absent: they must remain null until a person adjudicates them.
    const structured = structuredMoneyOccurrences(extraction.data);
    const structuredMatches = findOccurrenceMatches(structured, groundTruth);
    const matchedStructured = new Set(structuredMatches.map((match) => match.extracted_index));
    const unsupportedStructuredAmounts = structured
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => !matchedStructured.has(index))
      .map(({ item }) => ({ ...item, reason: "structured_amount_not_grounded_in_source_occurrence" }));
    const unreadableVisibleAmounts = new Map<number, number>();
    for (const cell of overlayUnit?.unreadable_cells ?? []) {
      for (const amount of cell.visible_amounts_krw) {
        unreadableVisibleAmounts.set(amount, (unreadableVisibleAmounts.get(amount) ?? 0) + 1);
      }
    }
    const unsafeUnreadableExtractions = [
      ...hallucinated,
      ...unsupportedStructuredAmounts,
    ].filter((item) => {
      const remaining = unreadableVisibleAmounts.get(item.krw) ?? 0;
      if (remaining < 1) return false;
      unreadableVisibleAmounts.set(item.krw, remaining - 1);
      return true;
    });
    const knownUnreadableCellDispositions = unreadableCellDispositions(
      extraction.data,
      overlayUnit?.unreadable_cells ?? [],
      unsafeUnreadableExtractions,
    );
    const unreadableCellsSafelyDisposed = knownUnreadableCellDispositions.every((disposition) =>
      disposition.needs_review && disposition.amounts_remain_unstructured
    );
    const structuredLinkageValidationIssues = strictBlockingValidationIssues.filter((issue) =>
      isStructuredRecordSourceLinkageCode(issue.code)
    );
    const otherBlockingValidationIssues = strictBlockingValidationIssues.filter((issue) =>
      !isStructuredRecordSourceLinkageCode(issue.code)
    );
    const links = [
      ...linkingErrors(unit, extraction.data, inventoryUnit.source_paths, overlayUnit?.expectations),
      ...structuredLinkageValidationIssues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
    ];
    const validatorCoverageGaps = requireValidatedArtifacts
      ? strictValidatorCoverageGaps
      : await optionalValidatedCoverageGaps(unit, stateDir);
    const coverageGapAssessment = validatorCoverageGaps === null
      ? null
      : classifyCoverageGapsAgainstGroundTruth(validatorCoverageGaps, groundTruth);
    const actualCoverageGaps = coverageGapAssessment?.actual ?? [];
    const priceGatePassed = hallucinated.length === 0
      && missing.length === 0
      && unsupportedStructuredAmounts.length === 0
      && links.length === 0
      && strictLinkageReviewWarnings.length === 0
      && otherBlockingValidationIssues.length === 0
      && unsafeUnreadableExtractions.length === 0
      && unreadableCellsSafelyDisposed
      && actualCoverageGaps.length === 0;
    const semanticCaptureResult = semanticCapture(
      extraction.data,
      overlayUnit?.expectations,
      requireValidatedArtifacts,
      strictSemanticValidationIssues,
    );
    const semanticGateRequired = overlayUnit?.expectations !== undefined;
    const semanticCaptureStatus = String(semanticCaptureResult.status ?? "not_grounded");
    const semanticGatePassed = !semanticGateRequired || semanticCaptureStatus === "captured";
    reports.push({
      unit_id: unitId,
      display_name: unit.display_name,
      prompt_version: extraction.prompt_version,
      model: extraction.model,
      provenance: strictProvenance,
      status: priceGatePassed && semanticGatePassed ? "pass" : "fail",
      price_gate: {
        passed: priceGatePassed,
        hallucinated_amounts: hallucinated,
        missing_readable_amounts: missing,
        unsupported_structured_amounts: unsupportedStructuredAmounts,
        linking_errors: links,
        manual_linkage_reviews: strictLinkageReviewWarnings,
        blocking_validation_issues: otherBlockingValidationIssues,
        unsafe_unreadable_extractions: unsafeUnreadableExtractions,
        actual_coverage_gaps: actualCoverageGaps,
        coverage_gaps_excluded_as_not_ground_truth:
          coverageGapAssessment?.excluded_as_not_ground_truth ?? [],
      },
      counts: {
        extracted_occurrences: extracted.length,
        base_ground_truth_occurrences: baseGroundTruthOccurrenceCount,
        effective_ground_truth_occurrences: groundTruth.length,
        human_required_occurrences: appliedAdjudication?.humanRequired.reduce(
          (sum, decision) => sum + Math.max(decision.references.length, decision.result ? 1 : 0),
          0,
        ) ?? 0,
        readable_ground_truth_occurrences: groundTruth.length,
        matched_occurrences: matches.length,
        locator_matches: matches.filter((match) => match.match_quality === "locator").length,
        quote_context_matches: matches.filter((match) => match.match_quality === "quote_context").length,
        image_value_only_matches: matches.filter((match) => match.match_quality === "image_value_only").length,
      },
      semantic_gate: {
        required: semanticGateRequired,
        passed: semanticGatePassed,
        expected_status: semanticGateRequired ? "captured" : "not_required",
        actual_status: semanticCaptureStatus,
      },
      semantic_capture: semanticCaptureResult,
      validator_coverage_gaps: validatorCoverageGaps,
      unreadable_cells: overlayUnit?.unreadable_cells ?? [],
      unreadable_handling: {
        any_needs_review: [
          ...extraction.data.agency_packages,
          ...extraction.data.partner_vendors,
          ...extraction.data.hall.items,
          ...(extraction.data.halls ?? []),
          ...(extraction.data.sections ?? []),
          ...(extraction.data.money_occurrences ?? []),
        ].some((item) => item.needs_review) || extraction.data.hall.needs_review,
        known_cell_dispositions: knownUnreadableCellDispositions,
        all_known_cells_safely_disposed: unreadableCellsSafelyDisposed,
        extraction_notes: extraction.data.extraction_notes,
      },
      adjudication_decisions: appliedAdjudication?.decisions ?? [],
      human_required_adjudication: appliedAdjudication?.humanRequired ?? [],
      adjudication_summary: {
        verified_decisions: appliedAdjudication?.decisions.filter(
          (decision) => decision.verification === "verified",
        ).length ?? 0,
        human_required_decisions: appliedAdjudication?.humanRequired.length ?? 0,
        excluded_base_occurrences: appliedAdjudication?.excludedBaseOccurrences ?? 0,
        added_effective_occurrences: appliedAdjudication?.addedEffectiveOccurrences ?? 0,
        quarantined_occurrences: appliedAdjudication?.quarantinedOccurrences ?? 0,
        human_required_occurrences: appliedAdjudication?.humanRequired.reduce(
          (sum, decision) => sum + Math.max(decision.references.length, decision.result ? 1 : 0),
          0,
        ) ?? 0,
      },
    });
  }

  const passedUnits = reports.filter((report) => report.status === "pass").length;
  const failedUnits = reports.filter((report) => report.status === "fail").length;
  const blockedUnits = reports.filter((report) => report.status === "blocked").length;
  const batchGate = evaluateBatchGate(uniqueUnitIds, reports, uniqueNonBlockingUnitIds);
  const eligibleForBatch = candidateSource === "paid" && batchGate.eligible;
  const generatedAt = new Date().toISOString();
  const baseReadableOccurrenceCount = inventoryOccurrenceCount + (overlay?.units.reduce(
    (sum, unit) => sum + unit.readable_occurrences.length,
    0,
  ) ?? 0);
  const effectiveReadableOccurrenceCount = [...adjudicatedById.values()].reduce(
    (sum, applied) => sum + applied.effective.length,
    0,
  );
  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    verification: candidateSource === "local"
      ? {
          mode: "strict_local_review_artifacts",
          candidate_source: "local",
          validated_artifacts_required: true,
          deterministic_artifact_paths_required: true,
          artifact_content_hashes_required: true,
          paid_plan_sha256: null,
          review_only: true,
        }
      : {
          mode: requireValidatedArtifacts
            ? "strict_validated_artifacts"
            : "legacy_compatible",
          validated_artifacts_required: requireValidatedArtifacts,
          deterministic_artifact_paths_required: requireValidatedArtifacts,
          artifact_content_hashes_required: requireValidatedArtifacts,
          paid_plan_sha256: paidPlanSha256,
        },
    ground_truth: {
      path: groundTruthPath,
      sha256: groundTruthSnapshot.sha256,
      inventory_occurrences: inventoryOccurrenceCount,
      base_inventory_occurrences: inventoryOccurrenceCount,
      base_readable_occurrences: baseReadableOccurrenceCount,
      effective_readable_occurrences: effectiveReadableOccurrenceCount,
      overlay_sha256: overlayHash,
      overlay_readable_occurrences: overlay?.units.reduce(
        (sum, unit) => sum + unit.readable_occurrences.length,
        0,
      ) ?? 0,
      unreadable_cells: overlay?.units.reduce((sum, unit) => sum + unit.unreadable_cells.length, 0) ?? 0,
      adjudication: {
        path: options.adjudicationPath ? path.resolve(options.adjudicationPath) : null,
        sha256: adjudicationHash,
        verified_decisions: adjudication?.decisions.filter(
          (decision) => decision.verification === "verified",
        ).length ?? 0,
        human_required_decisions: adjudication?.decisions.filter(
          (decision) => decision.verification === "human_required",
        ).length ?? 0,
        decisions_by_action: Object.fromEntries([
          "exclude_non_money",
          "merge_components",
          "add_missing",
          "replace_amount",
          "quarantine_source_anomaly",
          "semantic_expansion_only",
        ].map((action) => [
          action,
          adjudication?.decisions.filter((decision) => decision.action === action).length ?? 0,
        ])),
        human_required_occurrences: [...adjudicatedById.values()].reduce(
          (sum, applied) => sum + applied.humanRequired.reduce(
            (unitSum, decision) => unitSum
              + Math.max(decision.references.length, decision.result ? 1 : 0),
            0,
          ),
          0,
        ),
        excluded_base_occurrences: [...adjudicatedById.values()].reduce(
          (sum, applied) => sum + applied.excludedBaseOccurrences,
          0,
        ),
        added_effective_occurrences: [...adjudicatedById.values()].reduce(
          (sum, applied) => sum + applied.addedEffectiveOccurrences,
          0,
        ),
        quarantined_occurrences: [...adjudicatedById.values()].reduce(
          (sum, applied) => sum + applied.quarantinedOccurrences,
          0,
        ),
      },
    },
    gate: {
      status: candidateSource === "local"
        ? "review_only"
        : eligibleForBatch ? "pass" : batchGate.blocking_blocked_units > 0 ? "blocked" : "fail",
      verification_mode: candidateSource === "local"
        ? "strict_local_review_artifacts"
        : requireValidatedArtifacts
          ? "strict_validated_artifacts"
          : "legacy_compatible",
      validated_artifacts_required: requireValidatedArtifacts,
      passed_units: passedUnits,
      failed_units: failedUnits,
      blocked_units: blockedUnits,
      eligible_for_25_unit_batch: eligibleForBatch,
      blocking_unit_ids: batchGate.blocking_unit_ids,
      non_blocking_unit_ids: batchGate.non_blocking_unit_ids,
      blocking_passed_units: batchGate.blocking_passed_units,
      blocking_failed_units: batchGate.blocking_failed_units,
      blocking_blocked_units: batchGate.blocking_blocked_units,
      criteria: {
        hallucinated_amounts: 0,
        missing_readable_amounts: 0,
        unsupported_structured_amounts: 0,
        linking_errors: 0,
        manual_linkage_reviews: 0,
        blocking_validation_issues: 0,
        actual_coverage_gaps: 0,
        unreadable_amounts_must_remain_unstructured: true,
      },
      semantic_criteria: {
        required_for_expected_units: overlay !== undefined,
        required_status: overlay !== undefined ? "captured" : "not_required",
      },
    },
    units: reports,
  };
  const outputDirectory = candidateSource === "local"
    ? path.join(stateDir, "scoring", "local-review")
    : path.join(stateDir, "scoring");
  const timestamp = generatedAt.replace(/[:.]/gu, "-");
  await writeJsonFile(path.join(outputDirectory, `score-${timestamp}.json`), report);
  await writeJsonFile(path.join(outputDirectory, "latest.json"), report);
  return report;
}
