import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  assertDisclosureStagingProjectRef,
  assertRepositoryProductionProjectRef,
} from "./destination.js";
import { isPathWithin, readJsonFile, sha256File, sha256Text, writeJsonFile } from "./io.js";
import { readAiLedger, type AiLedgerEntry } from "./ledger.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { buildPartnerVendorRecords } from "./partner-dedupe.js";
import { sourceFileId } from "./provenance.js";
import type { DisclosureExtraction } from "./schemas.js";
import type { IngestManifest } from "./types.js";
import {
  DedupeCandidatesSchema,
  ValidatedArtifactSchema,
  validatedArtifactFingerprint,
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
  schema_version: 1;
  snapshot: string;
  snapshot_source: "kca_tprice";
  units: StagingUnit[];
  skipped_units: StagingSkippedUnit[];
  raw_objects: RawStorageObject[];
  preview_objects: PreviewStorageObject[];
  agency_packages: StagingAgencyPackage[];
  official_prices: StagingOfficialPrice[];
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

function stagingProvenanceForSourceIds(
  unit: StagingUnit,
  sourceIds: string[] | undefined,
): Pick<StagingAgencyPackage, "source_file" | "source_object_keys" | "source_preview_keys"> {
  const selected = unit.source_records.filter((record) => sourceIds?.includes(record.source_file_id));
  if (!sourceIds || sourceIds.length === 0 || selected.length !== new Set(sourceIds).size) {
    throw new Error(`행 단위 source_file_ids가 unit 원본과 일치하지 않습니다: ${unit.raw_name}`);
  }
  return {
    source_file: sourceFileBundle(selected.map((record) => record.source_file)),
    source_object_keys: selected.map((record) => record.source_object_key),
    source_preview_keys: selected
      .map((record) => record.source_preview_key)
      .filter((key): key is string => key !== null),
  };
}

function stagingOption(unit: StagingUnit, option: DisclosureExtraction["agency_packages"][number]["options"][number]): StagingPriceOption {
  const provenance = stagingProvenanceForSourceIds(unit, option.source_file_ids);
  const { source_file_ids: sourceFileIds, ...safeOption } = option;
  return {
    ...safeOption,
    source_file_ids: sourceFileIds ?? [],
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

function hallPriceRows(unit: StagingUnit): StagingOfficialPrice[] {
  const rows: StagingOfficialPrice[] = [];
  const hall = unit.data.hall;
  const vendorName = unit.raw_name;
  if (hall.venue_fee_krw !== null && hall.venue_fee_source_quote) {
    const provenance = stagingProvenanceForSourceIds(unit, hall.venue_fee_source_file_ids);
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
    const provenance = stagingProvenanceForSourceIds(unit, hall.meal_price_source_file_ids);
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
    const provenance = stagingProvenanceForSourceIds(unit, item.source_file_ids);
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
  return data.hall.venue_fee_krw !== null
    || data.hall.meal_price_min_krw !== null
    || data.hall.meal_price_max_krw !== null
    || data.hall.items.length > 0;
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
    const parsed = ValidatedArtifactSchema.safeParse(await readJsonFile(unit.validation.artifact_path));
    if (
      !parsed.success
      || parsed.data.fingerprint !== unit.validation.fingerprint
      || parsed.data.source_fingerprint !== unit.source_fingerprint
      || parsed.data.review_status !== "pending"
    ) {
      throw new Error(`검증 artifact provenance가 일치하지 않습니다: ${unit.display_name}`);
    }
    const recomputedValidationFingerprint = validatedArtifactFingerprint(
      parsed.data.extraction_fingerprint,
      parsed.data.data,
      parsed.data.issues,
    );
    if (recomputedValidationFingerprint !== parsed.data.fingerprint) {
      throw new Error(`검증 artifact 내용 hash가 일치하지 않습니다: ${unit.display_name}`);
    }
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
      validation_issue_codes: [...new Set(parsed.data.issues.map((issue) => issue.code))].sort(deterministicTextCompare),
      data: parsed.data.data,
    };
    const blockingArtifactIssue = parsed.data.issues.some((issue) => issue.severity === "error");
    const skipReason = unit.parsed.region_code === "unknown"
      ? "unknown_region"
      : blockingArtifactIssue
        ? "blocking_validation_issue"
        : !documentPayloadIsCompatible(stagingUnit.data)
          ? "document_payload_conflict"
          : hasConflictingAgencyPackageRows(stagingUnit.data)
            ? "conflicting_agency_package_rows"
            : stageableRowCount(stagingUnit) === 0
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
        const provenance = stagingProvenanceForSourceIds(unit, item.source_file_ids);
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
        const provenance = stagingProvenanceForSourceIds(unit, item.source_file_ids);
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
      schema_version: 1,
      snapshot,
      snapshot_source: "kca_tprice",
      units,
      skipped_units: skippedUnits,
      raw_objects: [...rawObjects.values()],
      preview_objects: previewObjects,
      agency_packages: agencyPackages,
      official_prices: [...partnerPrices, ...hallPrices],
      dedupe_candidates: dedupeCandidates,
      ai_ledger: await readAiLedger(stateDir),
      warnings: [...warnings],
    },
  };
}

function stagingEnvironment(env: NodeJS.ProcessEnv, confirmation: string | undefined): StagingEnvironment {
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
  dependencies: LoadDependencies = {},
): Promise<LoadResult> {
  const { plan, manifest } = await buildLoadPlan(options.stateDir, options.snapshot);
  if (!options.apply) return { mode: "dry-run", plan, manifest, writer_result: null };

  const environment = stagingEnvironment(dependencies.env ?? process.env, options.confirmProjectRef);
  const writer = dependencies.writer ?? (await import("./supabase-writer.js")).createSupabaseStagingWriter(environment);
  const writerResult = await writer.stage(plan);
  const loadedIds = new Set(writerResult.loadedUnitIds);
  for (const unit of manifest.units) if (loadedIds.has(unit.unit_id)) unit.stage = "loaded";
  await saveManifest(manifest);
  await writeJsonFile(
    path.join(path.resolve(options.stateDir), ".cache", `ai-ledger-loaded-${environment.projectRef}.json`),
    {
      project_ref: environment.projectRef,
      ledger_ids: [...new Set(writerResult.loggedLedgerIds)].sort(),
      marked_at: new Date().toISOString(),
    },
  );
  return { mode: "applied", plan, manifest, writer_result: writerResult };
}
