import { sha256Text } from "./io.js";
import { normalizeVendorName } from "./scan.js";
import type { DisclosureExtraction } from "./schemas.js";

export interface PartnerVendorRecord {
  unit_id: string;
  record_ref: string;
  region_code: string;
  category: DisclosureExtraction["partner_vendors"][number]["category"];
  vendor_name: string;
  normalized_name: string;
  occurrence: number;
  payload_fingerprint: string;
  stageable: boolean;
}

export interface PartnerVendorDedupeCandidate {
  entity_kind: "vendor";
  left_unit_id: string;
  right_unit_id: string;
  left_record_ref: string;
  right_record_ref: string;
  region_code: string;
  category: PartnerVendorRecord["category"];
  left_name: string;
  right_name: string;
  similarity: number;
  decision: "human_review_required";
}

export interface PartnerVendorIdentityConflict {
  identity_key: string;
  unit_ids: string[];
  record_refs: string[];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort((left, right) => left.localeCompare(right, "en")).map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

function partnerPayloadFingerprint(item: DisclosureExtraction["partner_vendors"][number]): string {
  const semanticOptions = item.options.map(({ source_file_ids: _sourceFileIds, ...option }) => option);
  return sha256Text(canonicalJson({
    price_min_krw: item.price_min_krw,
    price_max_krw: item.price_max_krw,
    base_spec: item.base_spec,
    price_note: item.price_note,
    options: semanticOptions,
  }));
}

export function buildPartnerVendorRecordRef(
  unitId: string,
  category: PartnerVendorRecord["category"],
  normalizedName: string,
  occurrence: number,
): string {
  if (!/^[a-f0-9]{64}$/u.test(unitId)) throw new Error("partner vendor unit id must be a SHA-256 digest");
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
    throw new Error("partner vendor occurrence must be a non-negative integer");
  }
  return sha256Text([unitId, category, normalizedName, String(occurrence)].join("\0"));
}

export function buildPartnerVendorRecords(
  unitId: string,
  regionCode: string,
  items: DisclosureExtraction["partner_vendors"],
): PartnerVendorRecord[] {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const normalizedName = normalizeVendorName(item.vendor_name);
    const identity = `${item.category}\0${normalizedName}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return {
      unit_id: unitId,
      record_ref: buildPartnerVendorRecordRef(unitId, item.category, normalizedName, occurrence),
      region_code: regionCode,
      category: item.category,
      vendor_name: item.vendor_name,
      normalized_name: normalizedName,
      occurrence,
      payload_fingerprint: partnerPayloadFingerprint(item),
      stageable: item.price_min_krw !== null
        || item.price_max_krw !== null
        || item.options.some((option) => option.price_min_krw !== null || option.price_max_krw !== null),
    };
  });
}

function trigramSet(value: string): Set<string> {
  if (value.length < 3) return value ? new Set([value]) : new Set();
  const result = new Set<string>();
  for (let index = 0; index <= value.length - 3; index += 1) result.add(value.slice(index, index + 3));
  return result;
}

export function partnerNameSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const leftSet = trigramSet(left);
  const rightSet = trigramSet(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let overlap = 0;
  for (const trigram of leftSet) if (rightSet.has(trigram)) overlap += 1;
  return (2 * overlap) / (leftSet.size + rightSet.size);
}

export function findPartnerVendorDedupeCandidates(
  records: PartnerVendorRecord[],
): PartnerVendorDedupeCandidate[] {
  const candidates: PartnerVendorDedupeCandidate[] = [];
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const left = records[leftIndex];
      const right = records[rightIndex];
      if (!left.stageable || !right.stageable) continue;
      if (left.region_code !== right.region_code || left.category !== right.category) continue;
      const similarity = partnerNameSimilarity(left.normalized_name, right.normalized_name);
      if (similarity < 0.7) continue;
      candidates.push({
        entity_kind: "vendor",
        left_unit_id: left.unit_id,
        right_unit_id: right.unit_id,
        left_record_ref: left.record_ref,
        right_record_ref: right.record_ref,
        region_code: left.region_code,
        category: left.category,
        left_name: left.vendor_name,
        right_name: right.vendor_name,
        similarity: Number(similarity.toFixed(4)),
        decision: "human_review_required",
      });
    }
  }
  return candidates;
}

export function findPartnerVendorIdentityConflicts(
  records: PartnerVendorRecord[],
): PartnerVendorIdentityConflict[] {
  const groups = new Map<string, PartnerVendorRecord[]>();
  for (const record of records) {
    const identityKey = [record.region_code, record.category, record.normalized_name].join("\0");
    const group = groups.get(identityKey) ?? [];
    group.push(record);
    groups.set(identityKey, group);
  }
  const conflicts: PartnerVendorIdentityConflict[] = [];
  for (const [identityKey, group] of groups) {
    if (new Set(group.map((record) => record.payload_fingerprint)).size < 2) continue;
    conflicts.push({
      identity_key: identityKey,
      unit_ids: [...new Set(group.map((record) => record.unit_id))].sort((left, right) => left.localeCompare(right, "en")),
      record_refs: group.map((record) => record.record_ref).sort((left, right) => left.localeCompare(right, "en")),
    });
  }
  return conflicts.sort((left, right) => left.identity_key.localeCompare(right.identity_key, "en"));
}
