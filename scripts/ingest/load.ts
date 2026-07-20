import { realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "./artifact-integrity.js";
import {
  assertDisclosureStagingProjectRef,
  assertRepositoryProductionProjectRef,
} from "./destination.js";
import { CONVERTER_VERSION } from "./convert.js";
import { isPathWithin, readJsonFile, sha256File, sha256Text } from "./io.js";
import { readAiLedger, type AiLedgerEntry } from "./ledger.js";
import { loadManifest } from "./manifest.js";
import { buildPartnerVendorRecords } from "./partner-dedupe.js";
import { sourceFileId } from "./provenance.js";
import { normalizeVendorName, SCANNER_PARSER_VERSION } from "./scan.js";
import {
  DisclosureSemanticStagingSchema,
  type DisclosureExtraction,
  type DisclosureSemanticStaging,
} from "./schemas.js";
import {
  currentExtractionFingerprint,
  EXTRACTION_PROCESSING_VERSION,
  EXTRACTION_PROMPT_HASH,
  EXTRACTION_PROMPT_VERSION,
} from "./extraction-contract.js";
import type { IngestManifest } from "./types.js";
import {
  deriveValidatedPayloadForUnit,
  DedupeCandidatesSchema,
  StrictValidatedArtifactSchema,
  VALIDATOR_VERSION,
  validatedArtifactFingerprint,
  verifyValidationInputsUnchanged,
} from "./validate.js";

export interface RawStorageObject {
  source_path: string;
  absolute_path: string;
  sha256: string;
  ext: string;
  bytes: number;
  storage_path: string;
}

export interface PreviewStorageObject {
  source_label: string;
  source_object_key: string;
  absolute_path: string;
  sha256: string;
  bytes: number;
  storage_path: string;
}

export interface StagingUnit {
  unit_id: string;
  kind_hint: "agency" | "hall";
  region_code: string;
  normalized_name: string;
  raw_name: string;
  corporate_name: string | null;
  source_file: string;
  source_object_keys: string[];
  source_preview_keys: string[];
  source_records: StagingSourceRecord[];
  source_fingerprint: string;
  validation_fingerprint: string;
  validation_issue_codes: string[];
  data: DisclosureExtraction;
}

export interface StagingSourceRecord {
  source_file_id: string;
  source_file: string;
  source_object_key: string;
  source_preview_key: string | null;
}

export type StagingPriceOption = Omit<
  DisclosureExtraction["agency_packages"][number]["options"][number],
  "source_file_ids"
> & {
  source_file_ids: string[];
  source_file: string;
  source_object_keys: string[];
};

export interface StagingAgencyPackage {
  unit_id: string;
  agency_name: string;
  agency_normalized_name: string;
  agency_corporate_name: string | null;
  region_code: string;
  package_name: string;
  category_scope: Array<"studio" | "dress" | "makeup">;
  price_min_krw: number | null;
  price_max_krw: number | null;
  vat_note: string | null;
  price_note: string | null;
  options: StagingPriceOption[];
  review_status: "pending";
  needs_review: boolean;
  validation_issue_codes: string[];
  source_file: string;
  source_object_keys: string[];
  source_preview_keys: string[];
  source_quote: string;
  confidence: number;
}

export interface StagingOfficialPrice {
  unit_id: string;
  partner_record_ref?: string;
  vendor_name: string;
  alias_proposals: string[];
  source_agency: {
    name: string;
    normalized_name: string;
    corporate_name: string | null;
    region_code: string;
    source_file: string;
  } | null;
  category: "studio" | "dress" | "makeup" | "hall" | "other";
  region_code: string;
  item_name: string;
  base_spec: string | null;
  price_min_krw: number | null;
  price_max_krw: number | null;
  vat_note: string | null;
  price_note: string | null;
  options: StagingPriceOption[];
  review_status: "pending";
  needs_review: boolean;
  validation_issue_codes: string[];
  source_file: string;
  source_object_keys: string[];
  source_preview_keys: string[];
  source_quote: string;
  confidence: number;
  source_record_key: string;
}

export interface StagingLoadPlan {
  schema_version: 2;
  snapshot: string;
  snapshot_source: "kca_tprice";
  units: StagingUnit[];
  skipped_units: StagingSkippedUnit[];
  raw_objects: RawStorageObject[];
  preview_objects: PreviewStorageObject[];
  agency_packages: StagingAgencyPackage[];
  official_prices: StagingOfficialPrice[];
  disclosure_semantics: DisclosureSemanticStaging[];
  dedupe_candidates: StagingDedupeCandidate[];
  ai_ledger: AiLedgerEntry[];
  warnings: string[];
}

export interface StagingSkippedUnit {
  unit_id: string;
  display_name: string;
  stage: string;
  reason: string;
}

export interface StagingDedupeCandidate {
  entity_kind: "vendor" | "agency";
  left_unit_id: string;
  right_unit_id: string;
  left_record_ref?: string;
  right_record_ref?: string;
  similarity: number;
  reason: string;
  status: "pending";
}

export interface StagingWriterResult {
  loadedUnitIds: string[];
  skippedUnitIds: string[];
  loggedLedgerIds: string[];
}

export interface StagingWriter {
  stage(plan: StagingLoadPlan): Promise<StagingWriterResult>;
}

export interface LoadOptions {
  stateDir: string;
  snapshot: string;
  apply?: boolean;
  confirmProjectRef?: string;
}

export interface LoadDependencies {
  writer?: StagingWriter;
  env?: NodeJS.ProcessEnv;
}

export interface StagingEnvironment {
  url: string;
  key: string;
  projectRef: string;
  bucket: string;
  previewBucket: string;
}

export interface LoadResult {
  mode: "dry-run" | "applied";
  plan: StagingLoadPlan;
  manifest: IngestManifest;
  writer_result: StagingWriterResult | null;
}

function deterministicTextCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceFileBundle(paths: string[]): string {
  const canonical = [...new Set(paths)];
  return canonical.length === 1 ? canonical[0] : JSON.stringify(canonical);
}

export function stagingProvenanceForSourceIds(
  unit: StagingUnit,
  sourceIds: string[] | undefined,
): Pick<StagingAgencyPackage, "source_file" | "source_object_keys" | "source_preview_keys"> & {
  source_file_ids: string[];
} {
  const uniqueSourceIds = sourceIds ? new Set(sourceIds) : new Set<string>();
  const selected = unit.source_records.filter((record) => uniqueSourceIds.has(record.source_file_id));
  if (
    !sourceIds
    || sourceIds.length === 0
    || uniqueSourceIds.size !== sourceIds.length
    || selected.length !== uniqueSourceIds.size
  ) {
    throw new Error(`행 단위 source_file_ids가 unit 원본과 일치하지 않습니다: ${unit.raw_name}`);
  }
  return {
    source_file_ids: selected.map((record) => record.source_file_id),
    source_file: sourceFileBundle(selected.map((record) => record.source_file)),
    source_object_keys: selected.map((record) => record.source_object_key),
    source_preview_keys: selected
      .map((record) => record.source_preview_key)
      .filter((key): key is string => key !== null),
  };
}

function stagingRowProvenanceForSourceIds(
  unit: StagingUnit,
  sourceIds: string[] | undefined,
): Pick<StagingAgencyPackage, "source_file" | "source_object_keys" | "source_preview_keys"> {
  const { source_file_ids: _sourceFileIds, ...provenance } = stagingProvenanceForSourceIds(unit, sourceIds);
  return provenance;
}

export function stagingOption(unit: StagingUnit, option: DisclosureExtraction["agency_packages"][number]["options"][number]): StagingPriceOption {
  const provenance = stagingProvenanceForSourceIds(unit, option.source_file_ids);
  const { source_file_ids: _sourceFileIds, ...safeOption } = option;
  return {
    ...safeOption,
    source_file_ids: provenance.source_file_ids,
    source_file: provenance.source_file,
    source_object_keys: provenance.source_object_keys,
  };
}

const MAX_PREVIEW_OBJECT_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_UNIT_BYTES = 4 * 1024 * 1024;
const MAX_PREVIEW_OBJECTS_PER_UNIT = 16;

async function conversionArtifactFingerprint(filePaths: string[]): Promise<string> {
  const records = await Promise.all(
    [...filePaths].sort((left, right) => left.localeCompare(right, "en")).map(async (filePath) => {
      const digest = await sha256File(filePath);
      return `${path.resolve(filePath)}\0${digest.sha256}`;
    }),
  );
  return sha256Text(records.join("\n"));
}

function portableSourceLabel(sourcePath: string): string {
  return path.posix.basename(sourcePath.replaceAll("\\", "/"));
}

async function buildUnitPreviewObjects(
  stateDir: string,
  unit: IngestManifest["units"][number],
): Promise<PreviewStorageObject[]> {
  const conversion = unit.conversion;
  const extraction = unit.extraction;
  if (!conversion || !extraction) {
    throw new Error(`conversion provenance가 없습니다: ${unit.display_name}`);
  }
  if (
    conversion.source_fingerprint !== unit.source_fingerprint
    || extraction.source_fingerprint !== unit.source_fingerprint
    || extraction.artifact_fingerprint !== conversion.artifact_fingerprint
  ) {
    throw new Error(`conversion provenance가 일치하지 않습니다: ${unit.display_name}`);
  }
  const allArtifactPaths = [...conversion.text_artifacts, ...conversion.image_artifacts];
  if (await conversionArtifactFingerprint(allArtifactPaths) !== conversion.artifact_fingerprint) {
    throw new Error(`conversion artifact hash가 일치하지 않습니다: ${unit.display_name}`);
  }

  const unitArtifactRoot = path.join(
    path.resolve(stateDir),
    ".converted",
    unit.unit_id,
    unit.source_fingerprint,
  );
  const realUnitArtifactRoot = await realpath(unitArtifactRoot);
  // Conversion artifact prefixes are positional. Preserve the manifest order
  // exactly, including for older manifests that predate canonical scan sorting.
  const convertibleSources = unit.source_files.filter((source) => source.ext !== "hwp");
  const expectedArtifacts = convertibleSources.flatMap((source, index) => {
    if (source.ext === "xlsx") return [{ source, name: `${index + 1}-sheets.txt` }];
    if (source.ext === "docx") return [{ source, name: `${index + 1}-doc.txt` }];
    if (source.ext === "pdf") return [{ source, name: `${index + 1}-pdf.txt` }];
    return [];
  });
  const actualByName = new Map<string, string>();
  for (const artifactPath of conversion.text_artifacts) {
    const resolved = await realpath(artifactPath);
    if (!isPathWithin(realUnitArtifactRoot, resolved)) {
      throw new Error(`preview artifact path가 변환 디렉터리를 벗어났습니다: ${unit.display_name}`);
    }
    const name = path.basename(resolved);
    if (actualByName.has(name)) throw new Error(`preview artifact가 중복되었습니다: ${unit.display_name}`);
    actualByName.set(name, resolved);
  }
  if (
    expectedArtifacts.length !== actualByName.size
    || expectedArtifacts.some(({ name }) => !actualByName.has(name))
  ) {
    throw new Error(`preview artifact/source 매핑이 일치하지 않습니다: ${unit.display_name}`);
  }
  if (expectedArtifacts.length > MAX_PREVIEW_OBJECTS_PER_UNIT) {
    throw new Error(`preview artifact 개수가 제한을 초과했습니다: ${unit.display_name}`);
  }

  let totalBytes = 0;
  const objects: PreviewStorageObject[] = [];
  for (const { source, name } of expectedArtifacts) {
    const absolutePath = actualByName.get(name);
    if (!absolutePath) throw new Error(`preview artifact가 없습니다: ${unit.display_name}`);
    const digest = await sha256File(absolutePath);
    totalBytes += digest.bytes;
    if (digest.bytes > MAX_PREVIEW_OBJECT_BYTES || totalBytes > MAX_PREVIEW_UNIT_BYTES) {
      throw new Error(`preview artifact 크기가 제한을 초과했습니다: ${unit.display_name}`);
    }
    objects.push({
      source_label: portableSourceLabel(source.path),
      source_object_key: `${source.sha256}.${source.ext}`,
      absolute_path: absolutePath,
      sha256: digest.sha256,
      bytes: digest.bytes,
      storage_path: `${digest.sha256}.txt`,
    });
  }
  return objects;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(deterministicTextCompare).map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

type DisclosureSemanticWithoutContentFingerprint = Omit<
  DisclosureSemanticStaging,
  "content_fingerprint"
>;

export function buildDisclosureSemanticContentFingerprint(
  row: DisclosureSemanticWithoutContentFingerprint | DisclosureSemanticStaging,
): string {
  const { content_fingerprint: _contentFingerprint, ...content } = row as DisclosureSemanticStaging;
  return sha256Text(canonicalJson(content));
}

export function buildDisclosureSemanticSourceRecordKey(input: {
  schema_version: 2;
  source_fingerprint: string;
  record_kind: DisclosureSemanticStaging["record_kind"];
  semantic_type: DisclosureSemanticStaging["semantic_type"];
  subject_kind: DisclosureSemanticStaging["subject_kind"];
  subject_normalized_name: string;
  partner_record_ref: string | null;
  title: string | null;
  source_file_ids: string[];
  source_quote: string;
  // Accepted as part of a semantic row, but deliberately excluded from the
  // locator key. Content drift at one locator must collide and be detected by
  // content_fingerprint instead of silently creating a second logical row.
  content_verbatim: string;
}): string {
  if (
    input.source_file_ids.length === 0
    || new Set(input.source_file_ids).size !== input.source_file_ids.length
    || input.source_file_ids.some((sourceId) => !/^[a-f0-9]{64}$/u.test(sourceId))
  ) {
    throw new Error("disclosure semantic source ids must be a non-empty canonical SHA-256 subset");
  }
  if (input.partner_record_ref !== null && !/^[a-f0-9]{64}$/u.test(input.partner_record_ref)) {
    throw new Error("disclosure semantic partner record ref must be a SHA-256 digest or null");
  }
  return sha256Text(canonicalJson({
    schema_version: input.schema_version,
    source_fingerprint: input.source_fingerprint,
    record_kind: input.record_kind,
    semantic_type: input.semantic_type,
    subject_kind: input.subject_kind,
    subject_normalized_name: input.subject_normalized_name,
    partner_record_ref: input.partner_record_ref,
    title: input.title,
    source_file_ids: input.source_file_ids,
    source_quote: input.source_quote,
  }));
}

export function stagingDisclosureSemantics(unit: StagingUnit): DisclosureSemanticStaging[] {
  const rows: DisclosureSemanticStaging[] = [];
  const append = (candidate: Omit<
    DisclosureSemanticWithoutContentFingerprint,
    "source_record_key"
  >): void => {
    const sourceRecordKey = buildDisclosureSemanticSourceRecordKey(candidate);
    const rowWithoutContentFingerprint: DisclosureSemanticWithoutContentFingerprint = {
      ...candidate,
      source_record_key: sourceRecordKey,
    };
    rows.push(DisclosureSemanticStagingSchema.parse({
      ...rowWithoutContentFingerprint,
      content_fingerprint: buildDisclosureSemanticContentFingerprint(rowWithoutContentFingerprint),
    }));
  };

  const partnerRecords = buildPartnerVendorRecords(
    unit.unit_id,
    unit.region_code,
    unit.data.partner_vendors,
  );
  for (const [vendorIndex, vendor] of unit.data.partner_vendors.entries()) {
    const partnerRecord = partnerRecords[vendorIndex];
    if (!partnerRecord) throw new Error("partner vendor semantic row reference could not be resolved");
    const normalizedVendorName = normalizeVendorName(vendor.vendor_name);
    if (!normalizedVendorName) throw new Error("disclosure semantic vendor subject must not be empty");
    for (const policy of vendor.policies ?? []) {
      const provenance = stagingProvenanceForSourceIds(unit, policy.source_file_ids);
      append({
        schema_version: 2,
        unit_id: unit.unit_id,
        record_kind: "vendor_policy",
        semantic_type: policy.policy_type,
        subject_kind: "vendor",
        subject_name: vendor.vendor_name,
        subject_normalized_name: normalizedVendorName,
        partner_record_ref: partnerRecord.record_ref,
        source_agency: unit.kind_hint === "agency" ? {
          name: unit.raw_name,
          normalized_name: unit.normalized_name,
          corporate_name: unit.corporate_name,
          region_code: unit.region_code,
          source_file: provenance.source_file,
        } : null,
        partner_link_status: partnerRecord.stageable
          ? "price_row_staged"
          : "policy_only_pending_identity",
        vendor_category: vendor.category,
        region_code: unit.region_code,
        title: null,
        content_verbatim: policy.raw_text,
        summary: null,
        review_status: "pending",
        needs_review: vendor.needs_review
          || vendor.confidence < 0.8
          || unit.validation_issue_codes.length > 0,
        validation_issue_codes: unit.validation_issue_codes,
        ...provenance,
        source_quote: policy.source_quote,
        source_fingerprint: unit.source_fingerprint,
        validation_fingerprint: unit.validation_fingerprint,
        confidence: vendor.confidence,
      });
    }
  }

  for (const section of unit.data.sections ?? []) {
    const provenance = stagingProvenanceForSourceIds(unit, section.source_file_ids);
    append({
      schema_version: 2,
      unit_id: unit.unit_id,
      record_kind: "document_section",
      semantic_type: section.section_type,
      subject_kind: unit.kind_hint === "agency" ? "agency" : "vendor",
      subject_name: unit.raw_name,
      subject_normalized_name: unit.normalized_name,
      partner_record_ref: null,
      source_agency: null,
      partner_link_status: "not_applicable",
      vendor_category: null,
      region_code: unit.region_code,
      title: section.title,
      content_verbatim: section.content_verbatim,
      summary: section.summary,
      review_status: "pending",
      needs_review: section.needs_review
        || section.confidence < 0.8
        || unit.validation_issue_codes.length > 0,
      validation_issue_codes: unit.validation_issue_codes,
      ...provenance,
      source_quote: section.source_quote,
      source_fingerprint: unit.source_fingerprint,
      validation_fingerprint: unit.validation_fingerprint,
      confidence: section.confidence,
    });
  }
  return rows;
}

type OfficialPriceRowKind = "partner" | "hall_venue_fee" | "hall_meal_price" | "hall_item";

function normalizedLogicalIdentity(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`official price ${label} must be a string`);
  }
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ");
  if (!normalized) throw new Error(`official price ${label} must not be empty`);
  return normalized;
}

function officialPriceLogicalIdentity(
  rowKind: OfficialPriceRowKind,
  payload: unknown,
  occurrence: number,
): Record<string, unknown> {
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
    throw new Error("official price logical occurrence must be a non-negative integer");
  }
  const record = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  if (rowKind === "partner") {
    return {
      category: normalizedLogicalIdentity(record.category, "category"),
      vendor_name: normalizedLogicalIdentity(
        record.normalized_vendor_name ?? record.vendor_name,
        "vendor identity",
      ),
      occurrence,
    };
  }
  if (rowKind === "hall_item") {
    return {
      item_name: normalizedLogicalIdentity(record.name ?? record.item_name, "hall item identity"),
      occurrence,
    };
  }
  return { occurrence };
}

export function buildOfficialPriceContentFingerprint(payload: unknown): string {
  return sha256Text(canonicalJson(payload));
}

export function buildOfficialPriceSourceRecordKey(
  sourceFingerprint: string,
  rowKind: OfficialPriceRowKind,
  payload: unknown,
  occurrence = 0,
): string {
  return sha256Text([
    sourceFingerprint,
    rowKind,
    canonicalJson(officialPriceLogicalIdentity(rowKind, payload, occurrence)),
  ].join("\0"));
}

function logicalOccurrence<T>(
  items: T[],
  index: number,
  rowKind: "partner" | "hall_item",
): number {
  const target = canonicalJson(officialPriceLogicalIdentity(rowKind, items[index], 0));
  let occurrence = 0;
  for (let candidateIndex = 0; candidateIndex < index; candidateIndex += 1) {
    if (canonicalJson(officialPriceLogicalIdentity(rowKind, items[candidateIndex], 0)) === target) {
      occurrence += 1;
    }
  }
  return occurrence;
}

function legacyHallPriceRows(unit: StagingUnit): StagingOfficialPrice[] {
  const rows: StagingOfficialPrice[] = [];
  const hall = unit.data.hall;
  const vendorName = unit.raw_name;
  if (hall.venue_fee_krw !== null && hall.venue_fee_source_quote) {
    const provenance = stagingRowProvenanceForSourceIds(unit, hall.venue_fee_source_file_ids);
    rows.push({
      unit_id: unit.unit_id,
      vendor_name: vendorName,
      alias_proposals: [],
      source_agency: null,
      category: "hall",
      region_code: unit.region_code,
      item_name: "대관료",
      base_spec: null,
      price_min_krw: hall.venue_fee_krw,
      price_max_krw: hall.venue_fee_krw,
      vat_note: null,
      price_note: null,
      options: [],
      review_status: "pending",
      needs_review: hall.needs_review || hall.confidence < 0.8 || unit.validation_issue_codes.length > 0,
      validation_issue_codes: unit.validation_issue_codes,
      ...provenance,
      source_quote: hall.venue_fee_source_quote,
      confidence: hall.confidence,
      source_record_key: buildOfficialPriceSourceRecordKey(
        unit.source_fingerprint,
        "hall_venue_fee",
        {
          price_min_krw: hall.venue_fee_krw,
          price_max_krw: hall.venue_fee_krw,
          source_quote: hall.venue_fee_source_quote,
          confidence: hall.confidence,
          needs_review: hall.needs_review,
        },
      ),
    });
  }
  if ((hall.meal_price_min_krw !== null || hall.meal_price_max_krw !== null) && hall.meal_price_source_quote) {
    const provenance = stagingRowProvenanceForSourceIds(unit, hall.meal_price_source_file_ids);
    rows.push({
      unit_id: unit.unit_id,
      vendor_name: vendorName,
      alias_proposals: [],
      source_agency: null,
      category: "hall",
      region_code: unit.region_code,
      item_name: "식대",
      base_spec: null,
      price_min_krw: hall.meal_price_min_krw,
      price_max_krw: hall.meal_price_max_krw,
      vat_note: null,
      price_note: null,
      options: [],
      review_status: "pending",
      needs_review: hall.needs_review || hall.confidence < 0.8 || unit.validation_issue_codes.length > 0,
      validation_issue_codes: unit.validation_issue_codes,
      ...provenance,
      source_quote: hall.meal_price_source_quote,
      confidence: hall.confidence,
      source_record_key: buildOfficialPriceSourceRecordKey(
        unit.source_fingerprint,
        "hall_meal_price",
        {
          price_min_krw: hall.meal_price_min_krw,
          price_max_krw: hall.meal_price_max_krw,
          source_quote: hall.meal_price_source_quote,
          confidence: hall.confidence,
          needs_review: hall.needs_review,
        },
      ),
    });
  }
  for (const [itemIndex, item] of hall.items.entries()) {
    if (item.price_min_krw === null && item.price_max_krw === null) continue;
    const provenance = stagingRowProvenanceForSourceIds(unit, item.source_file_ids);
    rows.push({
      unit_id: unit.unit_id,
      vendor_name: vendorName,
      alias_proposals: [],
      source_agency: null,
      category: "hall",
      region_code: unit.region_code,
      item_name: item.name,
      base_spec: item.raw_text,
      price_min_krw: item.price_min_krw,
      price_max_krw: item.price_max_krw,
      vat_note: null,
      price_note: null,
      options: [],
      review_status: "pending",
      needs_review: item.needs_review || item.confidence < 0.8 || unit.validation_issue_codes.length > 0,
      validation_issue_codes: unit.validation_issue_codes,
      ...provenance,
      source_quote: item.source_quote,
      confidence: item.confidence,
      source_record_key: buildOfficialPriceSourceRecordKey(
        unit.source_fingerprint,
        "hall_item",
        item,
        logicalOccurrence(hall.items, itemIndex, "hall_item"),
      ),
    });
  }
  return rows;
}

type CanonicalHall = NonNullable<DisclosureExtraction["halls"]>[number];

function canonicalHallBaseSpec(hall: CanonicalHall): string | null {
  return hall.guarantee_min === null
    ? null
    : `최소 보증 인원 ${hall.guarantee_min.toLocaleString("ko-KR")}명`;
}

function canonicalHallPriceRows(unit: StagingUnit): StagingOfficialPrice[] {
  const rows: StagingOfficialPrice[] = [];
  const logicalOccurrences = new Map<string, number>();
  const append = (
    hall: CanonicalHall,
    itemName: string,
    priceMinKrw: number | null,
    priceMaxKrw: number | null,
    priceNote: string | null,
    options: StagingPriceOption[],
  ): void => {
    const provenance = stagingRowProvenanceForSourceIds(unit, hall.source_file_ids);
    const normalizedItemName = normalizedLogicalIdentity(itemName, "hall item identity");
    const occurrence = logicalOccurrences.get(normalizedItemName) ?? 0;
    logicalOccurrences.set(normalizedItemName, occurrence + 1);
    rows.push({
      unit_id: unit.unit_id,
      vendor_name: unit.raw_name,
      alias_proposals: [],
      source_agency: null,
      category: "hall",
      region_code: unit.region_code,
      item_name: itemName,
      base_spec: canonicalHallBaseSpec(hall),
      price_min_krw: priceMinKrw,
      price_max_krw: priceMaxKrw,
      vat_note: null,
      price_note: priceNote,
      options,
      review_status: "pending",
      needs_review: hall.needs_review || hall.confidence < 0.8 || unit.validation_issue_codes.length > 0,
      validation_issue_codes: unit.validation_issue_codes,
      ...provenance,
      source_quote: hall.source_quote,
      confidence: hall.confidence,
      source_record_key: buildOfficialPriceSourceRecordKey(
        unit.source_fingerprint,
        "hall_item",
        { name: itemName },
        occurrence,
      ),
    });
  };

  for (const hall of unit.data.halls ?? []) {
    const hallIdentity = hall.hall_name?.trim() || unit.raw_name;
    if (hall.venue_fee_min_krw !== null || hall.venue_fee_max_krw !== null) {
      append(
        hall,
        `${hallIdentity} 대관료`,
        hall.venue_fee_min_krw,
        hall.venue_fee_max_krw,
        hall.venue_fee_note,
        [],
      );
    }
    if (hall.meal_price_min_krw !== null || hall.meal_price_max_krw !== null) {
      append(
        hall,
        `${hallIdentity} 식대`,
        hall.meal_price_min_krw,
        hall.meal_price_max_krw,
        null,
        [],
      );
    }
    if (hall.decoration_fee_min_krw !== null || hall.decoration_fee_max_krw !== null) {
      append(
        hall,
        `${hallIdentity} 장식비`,
        hall.decoration_fee_min_krw,
        hall.decoration_fee_max_krw,
        hall.decoration_note,
        [],
      );
    }
    if (optionsContainPrice(hall.options)) {
      append(
        hall,
        `${hallIdentity} 옵션`,
        null,
        null,
        null,
        hall.options.map((option) => stagingOption(unit, option)),
      );
    }
  }
  return rows;
}

function hallFactKind(itemName: string): string {
  const normalized = normalizeVendorName(itemName);
  if (normalized.endsWith("대관료")) return "venue_fee";
  if (normalized.endsWith("식대")) return "meal_price";
  if (normalized.endsWith("장식비") || normalized.endsWith("장식료")) return "decoration_fee";
  return `item:${normalized}`;
}

function hallFactLocator(
  sourceObjectKeys: string[],
  sourceQuote: string,
  factKind: string,
): string {
  return canonicalJson({ source_object_keys: sourceObjectKeys, source_quote: sourceQuote, fact_kind: factKind });
}

function hallFactPrice(min: number | null, max: number | null): string {
  return canonicalJson({ price_min_krw: min, price_max_krw: max });
}

export function hallPriceRows(unit: StagingUnit): StagingOfficialPrice[] {
  const canonicalRows = canonicalHallPriceRows(unit);
  if (canonicalRows.length === 0) return legacyHallPriceRows(unit);

  const canonicalFacts = new Map<string, string>();
  for (const row of canonicalRows) {
    canonicalFacts.set(
      hallFactLocator(row.source_object_keys, row.source_quote, hallFactKind(row.item_name)),
      hallFactPrice(row.price_min_krw, row.price_max_krw),
    );
    for (const option of row.options) {
      canonicalFacts.set(
        hallFactLocator(option.source_object_keys, option.source_quote, hallFactKind(option.name)),
        hallFactPrice(option.price_min_krw, option.price_max_krw),
      );
    }
  }

  const merged = [...canonicalRows];
  for (const legacyRow of legacyHallPriceRows(unit)) {
    const locator = hallFactLocator(
      legacyRow.source_object_keys,
      legacyRow.source_quote,
      hallFactKind(legacyRow.item_name),
    );
    const canonicalPrice = canonicalFacts.get(locator);
    if (canonicalPrice === undefined) {
      merged.push(legacyRow);
      continue;
    }
    if (canonicalPrice !== hallFactPrice(legacyRow.price_min_krw, legacyRow.price_max_krw)) {
      throw new Error("canonical and legacy hall payloads disagree for the same source-backed price fact");
    }
  }
  return merged;
}

function optionsContainPrice(options: DisclosureExtraction["agency_packages"][number]["options"]): boolean {
  return options.some((option) => option.price_min_krw !== null || option.price_max_krw !== null);
}

function stageableAgencyPackages(data: DisclosureExtraction): DisclosureExtraction["agency_packages"] {
  return data.agency_packages.filter((item) =>
    item.price_min_krw !== null || item.price_max_krw !== null || optionsContainPrice(item.options)
  );
}

function stageablePartnerVendors(data: DisclosureExtraction): DisclosureExtraction["partner_vendors"] {
  return data.partner_vendors.filter((item) =>
    item.price_min_krw !== null || item.price_max_krw !== null || optionsContainPrice(item.options)
  );
}

function hasHallPayload(data: DisclosureExtraction): boolean {
  return (data.halls?.length ?? 0) > 0
    || data.hall.venue_fee_krw !== null
    || data.hall.meal_price_min_krw !== null
    || data.hall.meal_price_max_krw !== null
    || data.hall.items.length > 0;
}

function hasDisclosureSemantics(data: DisclosureExtraction): boolean {
  return (data.sections?.length ?? 0) > 0
    || data.partner_vendors.some((vendor) => (vendor.policies?.length ?? 0) > 0);
}

function documentPayloadIsCompatible(data: DisclosureExtraction): boolean {
  const agency = data.agency_packages.length > 0;
  const partner = data.partner_vendors.length > 0;
  const hall = hasHallPayload(data);
  if (data.doc_kind === "agency_disclosure") return !partner && !hall;
  if (data.doc_kind === "partner_price_list") return !agency && !hall;
  if (data.doc_kind === "hall_disclosure") return !agency && !partner;
  return data.doc_kind === "mixed";
}

function hasConflictingAgencyPackageRows(data: DisclosureExtraction): boolean {
  const identities = new Map<string, Set<string>>();
  for (const item of data.agency_packages) {
    const key = item.package_name.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
    const variants = identities.get(key) ?? new Set<string>();
    variants.add(JSON.stringify({
      category_scope: item.category_scope,
      price_min_krw: item.price_min_krw,
      price_max_krw: item.price_max_krw,
      vat_note: item.vat_note,
      price_note: item.price_note,
      options: item.options,
      source_quote: item.source_quote,
    }));
    identities.set(key, variants);
  }
  return [...identities.values()].some((variants) => variants.size > 1);
}

function stageableRowCount(unit: StagingUnit): number {
  const data = unit.data;
  const agency = data.doc_kind === "agency_disclosure" || data.doc_kind === "mixed"
    ? stageableAgencyPackages(data).length
    : 0;
  const partner = data.doc_kind === "partner_price_list" || data.doc_kind === "mixed"
    ? stageablePartnerVendors(data).length
    : 0;
  const hall = data.doc_kind === "hall_disclosure" || data.doc_kind === "mixed"
    ? hallPriceRows(unit).length
    : 0;
  return agency + partner + hall;
}

async function readStrictValidatedArtifactForLoad(
  stateDir: string,
  manifest: IngestManifest,
  unit: IngestManifest["units"][number],
): Promise<ReturnType<typeof StrictValidatedArtifactSchema.parse>> {
  const extractionMetadata = unit.extraction;
  const validationMetadata = unit.validation;
  const conversion = unit.conversion;
  if (!extractionMetadata || !validationMetadata || !conversion) {
    throw new Error(`strict staging provenance is incomplete: ${unit.display_name}`);
  }
  await verifyValidationInputsUnchanged(unit, manifest);
  const converterVersion = conversion.converter_version ?? "v1-legacy";
  if (
    manifest.scanner_parser_version !== SCANNER_PARSER_VERSION
    || converterVersion !== CONVERTER_VERSION
  ) {
    throw new Error(`strict staging input versions are stale: ${unit.display_name}`);
  }
  const expectedExtractionFingerprint = currentExtractionFingerprint({
    scannerParserVersion: manifest.scanner_parser_version,
    converterVersion,
    model: extractionMetadata.model,
    rawName: unit.parsed.raw_name,
    regionCode: unit.parsed.region_code,
    kindHint: unit.parsed.kind_hint,
    sourceFingerprint: unit.source_fingerprint,
    artifactFingerprint: conversion.artifact_fingerprint,
  });
  if (
    extractionMetadata.fingerprint !== expectedExtractionFingerprint
    || extractionMetadata.prompt_version !== EXTRACTION_PROMPT_VERSION
    || extractionMetadata.prompt_hash !== EXTRACTION_PROMPT_HASH
    || extractionMetadata.processing_version !== EXTRACTION_PROCESSING_VERSION
    || extractionMetadata.scanner_parser_version !== manifest.scanner_parser_version
    || extractionMetadata.converter_version !== converterVersion
    || !extractionMetadata.content_sha256
  ) {
    throw new Error(`strict extraction metadata is stale: ${unit.display_name}`);
  }
  const { verifyCurrentExtractionCacheForUnit } = await import("./extract.js");
  const extraction = await verifyCurrentExtractionCacheForUnit(unit, manifest, stateDir);
  if (
    extraction.content_sha256 !== extractionMetadata.content_sha256
    || extraction.unit_id !== unit.unit_id
    || extraction.fingerprint !== expectedExtractionFingerprint
    || extraction.source_fingerprint !== unit.source_fingerprint
    || extraction.artifact_fingerprint !== conversion.artifact_fingerprint
    || extraction.prompt_version !== EXTRACTION_PROMPT_VERSION
    || extraction.prompt_hash !== EXTRACTION_PROMPT_HASH
    || extraction.processing_version !== EXTRACTION_PROCESSING_VERSION
    || extraction.scanner_parser_version !== manifest.scanner_parser_version
    || extraction.converter_version !== converterVersion
    || extraction.model !== extractionMetadata.model
  ) {
    throw new Error(`strict extraction artifact provenance is invalid: ${unit.display_name}`);
  }

  await verifyDeterministicStateArtifactPath({
    stateDir,
    artifactPath: validationMetadata.artifact_path,
    expectedRelativePath: path.join("validated", `${unit.unit_id}.json`),
  });
  const validationRaw = await readJsonFile(validationMetadata.artifact_path);
  const validationParsed = StrictValidatedArtifactSchema.safeParse(validationRaw);
  if (!validationParsed.success) {
    throw new Error(`strict validation artifact schema is invalid: ${unit.display_name}`);
  }
  verifyJsonContentHash(validationRaw as Record<string, unknown>, "content_sha256");
  const validation = validationParsed.data;
  const expectedSourceFiles = unit.source_files.map((source) => ({
    path: source.path,
    sha256: source.sha256,
    bytes: source.bytes,
  }));
  const recomputedValidationFingerprint = validatedArtifactFingerprint(
    validation.extraction_fingerprint,
    validation.data,
    validation.issues,
    validation.coverage_gaps,
  );
  const provenanceFailures = [
    validation.validator_version !== VALIDATOR_VERSION ? "validator_version" : null,
    validationMetadata.validator_version !== VALIDATOR_VERSION ? "manifest_validator_version" : null,
    validation.content_sha256 !== validationMetadata.content_sha256 ? "content_sha256" : null,
    validation.extraction_content_sha256 !== extraction.content_sha256
      ? "extraction_content_sha256"
      : null,
    validation.extraction_content_sha256 !== validationMetadata.extraction_content_sha256
      ? "manifest_extraction_content_sha256"
      : null,
    validation.fingerprint !== validationMetadata.fingerprint ? "fingerprint" : null,
    validation.fingerprint !== recomputedValidationFingerprint ? "recomputed_fingerprint" : null,
    validation.unit_id !== unit.unit_id ? "unit_id" : null,
    validation.source_fingerprint !== unit.source_fingerprint ? "source_fingerprint" : null,
    validation.extraction_fingerprint !== extraction.fingerprint ? "extraction_fingerprint" : null,
    validation.prompt_version !== EXTRACTION_PROMPT_VERSION ? "prompt_version" : null,
    validation.prompt_hash !== EXTRACTION_PROMPT_HASH ? "prompt_hash" : null,
    validation.model !== extraction.model ? "model" : null,
    validation.review_status !== "pending" ? "review_status" : null,
    validationMetadata.review_status !== validation.review_status ? "manifest_review_status" : null,
    validationMetadata.issue_count !== validation.issues.length ? "manifest_issue_count" : null,
    validationMetadata.validated_at !== validation.validated_at ? "manifest_validated_at" : null,
    validation.issues.some((issue) => issue.severity === "error") ? "blocking_issue" : null,
    JSON.stringify(validation.source_files) !== JSON.stringify(expectedSourceFiles) ? "source_files" : null,
  ].filter((failure): failure is string => failure !== null);
  if (provenanceFailures.length > 0) {
    throw new Error(
      `strict validation artifact provenance is invalid (${provenanceFailures.join(",")}): ${unit.display_name}`,
    );
  }
  const replayed = await deriveValidatedPayloadForUnit(unit, extraction);
  const replayFailures = [
    !isDeepStrictEqual(validation.data, replayed.data) ? "data_replay" : null,
    !isDeepStrictEqual(validation.issues, replayed.issues) ? "issues_replay" : null,
    !isDeepStrictEqual(validation.coverage_gaps, replayed.coverageGaps)
      ? "coverage_gaps_replay"
      : null,
  ].filter((failure): failure is string => failure !== null);
  if (replayFailures.length > 0) {
    throw new Error(
      `strict validation artifact replay is invalid (${replayFailures.join(",")}): ${unit.display_name}`,
    );
  }
  return validation;
}

async function buildLoadPlan(stateDir: string, snapshot: string): Promise<{ plan: StagingLoadPlan; manifest: IngestManifest }> {
  if (!/^20\d{2}Q[1-4]$/.test(snapshot)) throw new Error("snapshot은 2026Q3 형식이어야 합니다.");
  const manifest = await loadManifest(stateDir);
  const units: StagingUnit[] = [];
  const skippedUnits: StagingSkippedUnit[] = [];
  const rawObjects = new Map<string, RawStorageObject>();
  const previewObjects: PreviewStorageObject[] = [];
  const warnings = new Set<string>();

  for (const unit of manifest.units) {
    if (!unit.validation || !["validated", "loaded"].includes(unit.stage)) {
      skippedUnits.push({
        unit_id: unit.unit_id,
        display_name: unit.display_name,
        stage: unit.stage,
        reason: unit.stage === "needs_manual_conversion"
          ? "manual_conversion_required"
          : unit.stage === "error"
            ? "validation_or_scan_error"
            : "not_validated",
      });
      continue;
    }
    const validatedArtifact = await readStrictValidatedArtifactForLoad(stateDir, manifest, unit);
    // scan writes canonical source order. Load must not reorder an existing
    // manifest because conversion artifacts encode this exact positional order.
    const orderedSourceFiles = [...unit.source_files];
    const sourceFile = sourceFileBundle(orderedSourceFiles.map((source) => source.path));
    const sourceObjectKeys = orderedSourceFiles.map((source) => `${source.sha256}.${source.ext}`);
    const unitPreviewObjects = await buildUnitPreviewObjects(stateDir, unit);
    const sourcePreviewKeys = unitPreviewObjects.map((preview) => preview.storage_path);
    const previewBySourceObjectKey = new Map(unitPreviewObjects.map((preview) => [
      preview.source_object_key,
      preview.storage_path,
    ]));
    const sourceRecords: StagingSourceRecord[] = orderedSourceFiles.map((source) => {
      const sourceObjectKey = `${source.sha256}.${source.ext}`;
      return {
        source_file_id: sourceFileId(source),
        source_file: source.path,
        source_object_key: sourceObjectKey,
        source_preview_key: previewBySourceObjectKey.get(sourceObjectKey) ?? null,
      };
    });
    const stagingUnit: StagingUnit = {
      unit_id: unit.unit_id,
      kind_hint: unit.parsed.kind_hint,
      region_code: unit.parsed.region_code,
      normalized_name: unit.parsed.normalized_name,
      raw_name: unit.parsed.raw_name,
      corporate_name: unit.parsed.corporate_name,
      source_file: sourceFile,
      source_object_keys: sourceObjectKeys,
      source_preview_keys: sourcePreviewKeys,
      source_records: sourceRecords,
      source_fingerprint: unit.source_fingerprint,
      validation_fingerprint: unit.validation.fingerprint,
      validation_issue_codes: [...new Set(validatedArtifact.issues.map((issue) => issue.code))]
        .sort(deterministicTextCompare),
      data: validatedArtifact.data,
    };
    const blockingArtifactIssue = validatedArtifact.issues.some((issue) => issue.severity === "error");
    const skipReason = unit.parsed.region_code === "unknown"
      ? "unknown_region"
      : blockingArtifactIssue
        ? "blocking_validation_issue"
        : !documentPayloadIsCompatible(stagingUnit.data)
          ? "document_payload_conflict"
          : hasConflictingAgencyPackageRows(stagingUnit.data)
            ? "conflicting_agency_package_rows"
            : stageableRowCount(stagingUnit) === 0 && !hasDisclosureSemantics(stagingUnit.data)
              ? stagingUnit.data.doc_kind === "unknown"
                ? "unknown_document_kind"
                : "no_stageable_price_rows"
              : null;
    if (skipReason) {
      skippedUnits.push({
        unit_id: unit.unit_id,
        display_name: unit.display_name,
        stage: unit.stage,
        reason: skipReason,
      });
      continue;
    }
    units.push(stagingUnit);
    previewObjects.push(...unitPreviewObjects);
    for (const source of unit.source_files) {
      const currentSource = await sha256File(source.absolute_path);
      if (currentSource.sha256 !== source.sha256 || currentSource.bytes !== source.bytes) {
        throw new Error(`raw source changed after scan: ${source.path}`);
      }
      if (source.bytes > 50 * 1024 * 1024) {
        throw new Error(`Storage 50MB 제한을 넘는 원본입니다: ${source.path}`);
      }
      rawObjects.set(`${source.sha256}.${source.ext}`, {
        source_path: source.path,
        absolute_path: source.absolute_path,
        sha256: source.sha256,
        ext: source.ext,
        bytes: source.bytes,
        storage_path: `${source.sha256}.${source.ext}`,
      });
    }
  }

  const agencyPackages: StagingAgencyPackage[] = units.flatMap((unit) =>
    unit.data.doc_kind === "agency_disclosure" || unit.data.doc_kind === "mixed"
      ? stageableAgencyPackages(unit.data).map((item) => {
        const provenance = stagingRowProvenanceForSourceIds(unit, item.source_file_ids);
        return ({
    unit_id: unit.unit_id,
    agency_name: unit.raw_name,
    agency_normalized_name: unit.normalized_name,
    agency_corporate_name: unit.corporate_name,
    region_code: unit.region_code,
    package_name: item.package_name,
    category_scope: item.category_scope,
    price_min_krw: item.price_min_krw,
    price_max_krw: item.price_max_krw,
    vat_note: item.vat_note,
    price_note: item.price_note,
    options: item.options.map((option) => stagingOption(unit, option)),
    review_status: "pending",
    needs_review: item.needs_review || item.confidence < 0.8 || unit.validation_issue_codes.length > 0,
    validation_issue_codes: unit.validation_issue_codes,
    ...provenance,
    source_quote: item.source_quote,
    confidence: item.confidence,
  });
      })
      : []);
  const partnerPrices: StagingOfficialPrice[] = units.flatMap((unit) => {
    if (unit.data.doc_kind !== "partner_price_list" && unit.data.doc_kind !== "mixed") return [];
    const allPartnerRecords = buildPartnerVendorRecords(
      unit.unit_id,
      unit.region_code,
      unit.data.partner_vendors,
    );
    return stageablePartnerVendors(unit.data).map((item, itemIndex, items) => {
        const provenance = stagingRowProvenanceForSourceIds(unit, item.source_file_ids);
        const sourceItemIndex = unit.data.partner_vendors.indexOf(item);
        const partnerRecord = allPartnerRecords[sourceItemIndex];
        if (!partnerRecord) throw new Error("partner vendor row reference could not be resolved");
        return ({
    unit_id: unit.unit_id,
    partner_record_ref: partnerRecord.record_ref,
    vendor_name: item.vendor_name,
    alias_proposals: item.old_names,
    source_agency: unit.kind_hint === "agency" ? {
      name: unit.raw_name,
      normalized_name: unit.normalized_name,
      corporate_name: unit.corporate_name,
      region_code: unit.region_code,
      source_file: provenance.source_file,
    } : null,
    category: item.category,
    region_code: unit.region_code,
    item_name: item.vendor_name,
    base_spec: item.base_spec,
    price_min_krw: item.price_min_krw,
    price_max_krw: item.price_max_krw,
    vat_note: null,
    price_note: item.price_note,
    options: item.options.map((option) => stagingOption(unit, option)),
    review_status: "pending",
    needs_review: item.needs_review || item.confidence < 0.8 || unit.validation_issue_codes.length > 0,
    validation_issue_codes: unit.validation_issue_codes,
    ...provenance,
    source_quote: item.source_quote,
    confidence: item.confidence,
    source_record_key: buildOfficialPriceSourceRecordKey(
      unit.source_fingerprint,
      "partner",
      item,
      logicalOccurrence(items, itemIndex, "partner"),
    ),
  });
      });
  });
  const hallPrices = units.flatMap((unit) =>
    unit.data.doc_kind === "hall_disclosure" || unit.data.doc_kind === "mixed"
      ? hallPriceRows(unit)
      : []);
  const disclosureSemantics = units.flatMap(stagingDisclosureSemantics);
  const unitsWithPrimaryVendor = new Set(hallPrices.map((row) => row.unit_id));
  const unitsWithPrimaryAgency = new Set([
    ...agencyPackages.map((row) => row.unit_id),
    ...partnerPrices.filter((row) => row.source_agency !== null).map((row) => row.unit_id),
  ]);
  let dedupeCandidates: StagingDedupeCandidate[] = [];
  try {
    const parsed = DedupeCandidatesSchema.safeParse(
      await readJsonFile(path.join(path.resolve(stateDir), "validated", "dedupe_candidates.json")),
    );
    if (!parsed.success) throw new Error("dedupe_candidates.json 형식이 올바르지 않습니다.");
    dedupeCandidates = parsed.data.candidates.flatMap((candidate) => {
      if (candidate.entity_kind === "vendor") {
        if (!candidate.left_record_ref || !candidate.right_record_ref) {
          throw new Error("partner vendor dedupe candidate is missing stable row refs");
        }
        const stagedPartnerRefs = new Set(partnerPrices.map((row) => row.partner_record_ref));
        if (!stagedPartnerRefs.has(candidate.left_record_ref) || !stagedPartnerRefs.has(candidate.right_record_ref)) {
          throw new Error("partner vendor dedupe candidate references a row that is not stageable");
        }
        return [{
          entity_kind: "vendor" as const,
          left_unit_id: candidate.left_unit_id,
          right_unit_id: candidate.right_unit_id,
          left_record_ref: candidate.left_record_ref,
          right_record_ref: candidate.right_record_ref,
          similarity: candidate.similarity,
          reason: `같은 지역·카테고리의 제휴업체 정규화 상호 trigram 유사도 ${candidate.similarity.toFixed(4)}`,
          status: "pending" as const,
        }];
      }
      const vendorPair = unitsWithPrimaryVendor.has(candidate.left_unit_id)
        && unitsWithPrimaryVendor.has(candidate.right_unit_id);
      const agencyPair = unitsWithPrimaryAgency.has(candidate.left_unit_id)
        && unitsWithPrimaryAgency.has(candidate.right_unit_id);
      if (vendorPair === agencyPair) return [];
      return [{
        entity_kind: vendorPair ? "vendor" as const : "agency" as const,
        left_unit_id: candidate.left_unit_id,
        right_unit_id: candidate.right_unit_id,
        similarity: candidate.similarity,
        reason: `같은 지역의 정규화 상호 trigram 유사도 ${candidate.similarity.toFixed(4)}`,
        status: "pending",
      }];
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return {
    manifest,
    plan: {
      schema_version: 2,
      snapshot,
      snapshot_source: "kca_tprice",
      units,
      skipped_units: skippedUnits,
      raw_objects: [...rawObjects.values()],
      preview_objects: previewObjects,
      agency_packages: agencyPackages,
      official_prices: [...partnerPrices, ...hallPrices],
      disclosure_semantics: disclosureSemantics,
      dedupe_candidates: dedupeCandidates,
      ai_ledger: await readAiLedger(stateDir),
      warnings: [...warnings],
    },
  };
}

export function stagingEnvironment(env: NodeJS.ProcessEnv, confirmation: string | undefined): StagingEnvironment {
  if (env.INGEST_LOAD_ENABLED !== "true") throw new Error("apply에는 INGEST_LOAD_ENABLED=true가 필요합니다.");
  if (env.INGEST_TARGET_ENV !== "staging") throw new Error("INGEST_TARGET_ENV=staging만 허용합니다.");
  const projectRef = env.SUPABASE_PROJECT_REF?.trim();
  const expectedRef = env.INGEST_STAGING_PROJECT_REF?.trim();
  const productionRef = env.SUPABASE_PRODUCTION_PROJECT_REF?.trim();
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = env.INGEST_STORAGE_BUCKET?.trim();
  const previewBucket = env.INGEST_PREVIEW_STORAGE_BUCKET?.trim() || "disclosure-preview";
  if (!productionRef) throw new Error("SUPABASE_PRODUCTION_PROJECT_REF is required for the production exclusion fence.");
  assertRepositoryProductionProjectRef(productionRef);
  if (!projectRef || !expectedRef || !url || !key || !bucket) {
    throw new Error("SUPABASE_PROJECT_REF, INGEST_STAGING_PROJECT_REF, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_STORAGE_BUCKET이 모두 필요합니다.");
  }
  if ([projectRef, expectedRef, confirmation].some((value) => value === productionRef)) {
    throw new Error("production project ref is forbidden for disclosure ingest apply");
  }
  for (const ref of [projectRef, expectedRef, confirmation]) {
    if (ref) assertDisclosureStagingProjectRef(ref);
  }
  if (projectRef !== expectedRef || confirmation !== expectedRef) {
    throw new Error("staging project ref와 --confirm-project-ref가 정확히 일치해야 합니다.");
  }
  if (bucket !== "disclosure-raw") throw new Error("INGEST_STORAGE_BUCKET은 disclosure-raw여야 합니다.");
  if (previewBucket !== "disclosure-preview") {
    throw new Error("INGEST_PREVIEW_STORAGE_BUCKET은 disclosure-preview여야 합니다.");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL이 유효한 URL이 아닙니다.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL은 https 프로토콜만 허용합니다.");
  }
  if (parsedUrl.port !== "") {
    throw new Error("SUPABASE_URL은 HTTPS 기본 포트만 허용합니다.");
  }
  if (parsedUrl.username !== "" || parsedUrl.password !== "") {
    throw new Error("SUPABASE_URL에 사용자 credentials를 포함할 수 없습니다.");
  }
  if (parsedUrl.pathname !== "/") {
    throw new Error("SUPABASE_URL base URL에는 path 경로를 포함할 수 없습니다.");
  }
  if (parsedUrl.search !== "") {
    throw new Error("SUPABASE_URL base URL에는 query 쿼리를 포함할 수 없습니다.");
  }
  if (parsedUrl.hash !== "") {
    throw new Error("SUPABASE_URL base URL에는 hash fragment를 포함할 수 없습니다.");
  }
  if (parsedUrl.hostname !== `${projectRef}.supabase.co`) throw new Error("SUPABASE_URL host가 staging project ref와 일치하지 않습니다.");
  if (/anon/i.test(key) || key.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY에 anon/publishable 키를 사용할 수 없습니다.");
  }
  if (key.split(".").length === 3) {
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("legacy SUPABASE_SERVICE_ROLE_KEY JWT payload를 검증할 수 없습니다.");
    }
    if (typeof payload !== "object" || payload === null || !("role" in payload) || payload.role !== "service_role") {
      throw new Error("legacy SUPABASE_SERVICE_ROLE_KEY의 role이 service_role이 아닙니다.");
    }
  } else if (!key.startsWith("sb_secret_")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY는 legacy service_role JWT 또는 sb_secret_ 키여야 합니다.");
  }
  return { url, key, projectRef, bucket, previewBucket };
}

export async function loadValidated(
  options: LoadOptions,
  _dependencies: LoadDependencies = {},
): Promise<LoadResult> {
  if (options.apply) {
    throw new Error("load_apply_blocked_pending_state_aware_batch_runner");
  }
  const { plan, manifest } = await buildLoadPlan(options.stateDir, options.snapshot);
  return { mode: "dry-run", plan, manifest, writer_result: null };
}
