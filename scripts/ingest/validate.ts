import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { readJsonFile, sha256Text, writeJsonFile } from "./io.js";
import { loadManifest, saveManifest } from "./manifest.js";
import {
  buildPartnerVendorRecords,
  findPartnerVendorIdentityConflicts,
  findPartnerVendorDedupeCandidates,
} from "./partner-dedupe.js";
import { sourceFileId, sourceFilesForArtifact } from "./provenance.js";
import { normalizeVendorName, regionCodeFromDirectory } from "./scan.js";
import { DisclosureExtractionSchema, ExtractionArtifactSchema } from "./schemas.js";
import type { DisclosureExtraction } from "./schemas.js";
import type { IngestManifest, ManifestUnit } from "./types.js";

const VALIDATOR_VERSION = "v4-row-source-provenance";
const BASE_PRICE_MIN_KRW = 100_000;
const BASE_PRICE_MAX_KRW = 30_000_000;
const PUBLIC_CONTACT_PATTERN = /(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;

const ValidationIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string().min(1),
  path: z.string().min(1),
  message: z.string().min(1),
});

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

export const ValidatedArtifactSchema = z.object({
  schema_version: z.literal(1),
  validator_version: z.literal(VALIDATOR_VERSION),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  unit_id: z.string().regex(/^[a-f0-9]{64}$/),
  source_files: z.array(z.object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative(),
  })),
  source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  extraction_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  data: DisclosureExtractionSchema,
  issues: z.array(ValidationIssueSchema),
  review_status: z.literal("pending"),
  validated_at: z.string().datetime(),
});

export type ValidatedArtifact = z.infer<typeof ValidatedArtifactSchema>;

export interface ValidateOptions {
  stateDir: string;
}

export interface ValidationEvidenceContext {
  normalizedText: string;
  hasImages: boolean;
  bySourceFileId?: Record<string, {
    normalizedText: string;
    hasImages: boolean;
  }>;
  sourceScoped?: boolean;
}

export function normalizeEvidenceText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/\\\|/g, "|")
    .replace(/\s+/gu, " ")
    .trim();
}

export function validatedArtifactFingerprint(
  extractionFingerprint: string,
  data: DisclosureExtraction,
  issues: ValidationIssue[],
): string {
  const payloadHash = sha256Text(JSON.stringify({ data, issues }));
  return sha256Text(`${VALIDATOR_VERSION}\0${extractionFingerprint}\0${payloadHash}`);
}

export function parseKoreanMoneyAmounts(text: string): number[] {
  const amounts = new Set<number>();
  const multiplierFor = (unit: string | undefined): number => {
    if (unit === "억") return 100_000_000;
    if (unit === "천만") return 10_000_000;
    if (unit === "백만") return 1_000_000;
    if (unit === "만") return 10_000;
    if (unit === "천") return 1_000;
    return 1;
  };
  const parseNumeric = (value: string): number => Number(value.replace(/,/g, ""));

  const rangePattern = /(\d[\d,]*(?:\.\d+)?)\s*(?:~|〜|–|—|-)\s*(\d[\d,]*(?:\.\d+)?)\s*(억|천만|백만|만|천)\s*원?/g;
  for (const match of text.matchAll(rangePattern)) {
    const minimum = parseNumeric(match[1]);
    const maximum = parseNumeric(match[2]);
    const multiplier = multiplierFor(match[3]);
    if (Number.isFinite(minimum)) amounts.add(Math.round(minimum * multiplier));
    if (Number.isFinite(maximum)) amounts.add(Math.round(maximum * multiplier));
  }

  const explicitUnitPattern = /(\d[\d,]*(?:\.\d+)?)\s*(억|천만|백만|만|천)(?:\s*원)?/g;
  for (const match of text.matchAll(explicitUnitPattern)) {
    const numeric = parseNumeric(match[1]);
    if (Number.isFinite(numeric)) amounts.add(Math.round(numeric * multiplierFor(match[2])));
  }
  const wonPattern = /(\d[\d,]*(?:\.\d+)?)\s*원/g;
  for (const match of text.matchAll(wonPattern)) {
    const numeric = parseNumeric(match[1]);
    if (Number.isFinite(numeric)) amounts.add(Math.round(numeric));
  }
  return [...amounts];
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

    if (evidence) {
      const normalizedQuote = normalizeEvidenceText(quote);
      if (!normalizedQuote || !evidence.normalizedText.includes(normalizedQuote)) {
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
  if (!evidence?.bySourceFileId) return { sourceIds: resolvedIds, evidence };
  const referenced = resolvedIds
    .map((id) => evidence.bySourceFileId?.[id])
    .filter((value): value is { normalizedText: string; hasImages: boolean } => value !== undefined);
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
    evidence: {
      normalizedText: referenced.map((value) => value.normalizedText).filter(Boolean).join(" "),
      hasImages: referenced.some((value) => value.hasImages),
      sourceScoped: true,
    },
  };
}

function hasHallPayload(data: DisclosureExtraction): boolean {
  return data.hall.venue_fee_krw !== null
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
  ) || data.hall.venue_fee_krw !== null
    || data.hall.meal_price_min_krw !== null
    || data.hall.meal_price_max_krw !== null
    || data.hall.items.some((item) => item.price_min_krw !== null || item.price_max_krw !== null);
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
  if (!hasAnyPriceValue(data)) {
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
  if (
    data.business_name
    && normalizeVendorName(data.business_name) !== unit.parsed.normalized_name
  ) {
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
    item.options.forEach((option, optionIndex) => {
      const optionPath = `${itemPath}.options[${optionIndex}]`;
      const optionProvenance = resolveRowEvidence(unit, option.source_file_ids, optionPath, issues, evidence);
      option.source_file_ids = optionProvenance.sourceIds;
      validateRange(option.price_min_krw, option.price_max_krw, option.source_quote, optionPath, issues, false, optionProvenance.evidence);
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
    item.options.forEach((option, optionIndex) => {
      const optionPath = `${itemPath}.options[${optionIndex}]`;
      const optionProvenance = resolveRowEvidence(unit, option.source_file_ids, optionPath, issues, evidence);
      option.source_file_ids = optionProvenance.sourceIds;
      validateRange(option.price_min_krw, option.price_max_krw, option.source_quote, optionPath, issues, false, optionProvenance.evidence);
    });
    if (item.needs_review || item.confidence < 0.8) {
      issues.push({ severity: "warning", code: "low_confidence", path: `partner_vendors[${index}]`, message: "추출 신뢰도가 낮거나 모델이 검토를 요청했습니다." });
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

async function readExistingValidated(
  filePath: string,
  expected: {
    fingerprint: string;
    unitId: string;
    sourceFingerprint: string;
    extractionFingerprint: string;
    sourceFiles: ValidatedArtifact["source_files"];
  },
): Promise<ValidatedArtifact | null> {
  try {
    const parsed = ValidatedArtifactSchema.safeParse(await readJsonFile(filePath));
    if (!parsed.success) return null;
    const artifact = parsed.data;
    const contentFingerprint = validatedArtifactFingerprint(
      artifact.extraction_fingerprint,
      artifact.data,
      artifact.issues,
    );
    return artifact.fingerprint === expected.fingerprint
        && contentFingerprint === expected.fingerprint
        && artifact.unit_id === expected.unitId
        && artifact.source_fingerprint === expected.sourceFingerprint
        && artifact.extraction_fingerprint === expected.extractionFingerprint
        && JSON.stringify(artifact.source_files) === JSON.stringify(expected.sourceFiles)
      ? artifact
      : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function validateManifest(options: ValidateOptions): Promise<IngestManifest> {
  const manifest = await loadManifest(options.stateDir);
  const validatedDirectory = path.join(path.resolve(options.stateDir), "validated");
  const artifactsByUnitId = new Map<string, ValidatedArtifact>();

  for (const unit of manifest.units) {
    if (!unit.extraction || !["extracted", "validated"].includes(unit.stage)) continue;
    const extractionParsed = ExtractionArtifactSchema.safeParse(await readJsonFile(unit.extraction.artifact_path));
    if (
      !extractionParsed.success
      || extractionParsed.data.fingerprint !== unit.extraction.fingerprint
      || extractionParsed.data.source_fingerprint !== unit.source_fingerprint
      || extractionParsed.data.artifact_fingerprint !== unit.conversion?.artifact_fingerprint
    ) {
      unit.stage = "error";
      unit.notices = Array.from(new Set([...unit.notices, "validate 실패: 추출 artifact provenance가 현재 manifest와 일치하지 않습니다."]));
      continue;
    }

    const textArtifacts = unit.conversion?.text_artifacts ?? [];
    const evidenceBySource = new Map(unit.source_files.map((source) => [
      sourceFileId(source),
      { text: [] as string[], hasImages: false },
    ]));
    const textArtifactContents = await Promise.all(textArtifacts.map(async (artifactPath) => ({
      artifactPath,
      text: await readFile(artifactPath, "utf8"),
    })));
    for (const artifact of textArtifactContents) {
      for (const source of sourceFilesForArtifact(unit, artifact.artifactPath)) {
        evidenceBySource.get(sourceFileId(source))?.text.push(artifact.text);
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
      hasImages: (unit.conversion?.image_artifacts.length ?? 0) > 0,
      bySourceFileId: Object.fromEntries([...evidenceBySource.entries()].map(([id, value]) => [
        id,
        { normalizedText: normalizeEvidenceText(value.text.join("\n")), hasImages: value.hasImages },
      ])),
    };
    const issues = validateExtractionForUnit(unit, extractionParsed.data.data, evidence);
    const fingerprint = validatedArtifactFingerprint(
      unit.extraction.fingerprint,
      extractionParsed.data.data,
      issues,
    );
    const artifactPath = path.join(validatedDirectory, `${unit.unit_id}.json`);
    const sourceFiles = unit.source_files.map((source) => ({
      path: source.path,
      sha256: source.sha256,
      bytes: source.bytes,
    }));
    const existing = await readExistingValidated(artifactPath, {
      fingerprint,
      unitId: unit.unit_id,
      sourceFingerprint: unit.source_fingerprint,
      extractionFingerprint: unit.extraction.fingerprint,
      sourceFiles,
    });
    const artifact: ValidatedArtifact = existing ?? {
      schema_version: 1,
      validator_version: VALIDATOR_VERSION,
      fingerprint,
      unit_id: unit.unit_id,
      source_files: sourceFiles,
      source_fingerprint: unit.source_fingerprint,
      extraction_fingerprint: unit.extraction.fingerprint,
      data: extractionParsed.data.data,
      issues,
      review_status: "pending",
      validated_at: new Date().toISOString(),
    };
    if (!existing) await writeJsonFile(artifactPath, artifact);
    artifactsByUnitId.set(unit.unit_id, artifact);
    unit.validation = {
      fingerprint,
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
      );
      await writeJsonFile(unit.validation.artifact_path, artifact);
      unit.validation.fingerprint = artifact.fingerprint;
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
