import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { assertDisclosureStagingProjectRef } from "./destination.js";
import { sha256Text } from "./io.js";
import { buildOfficialPriceContentFingerprint } from "./load.js";
import { normalizeVendorName } from "./scan.js";
import type {
  StagingAgencyPackage,
  StagingEnvironment,
  StagingDedupeCandidate,
  StagingLoadPlan,
  StagingOfficialPrice,
  StagingWriter,
  StagingWriterResult,
} from "./load.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function idFrom(value: unknown, context: string): string {
  if (!isRecord(value) || typeof value.id !== "string") throw new Error(`${context}: 반환 ID가 없습니다.`);
  return value.id;
}

function databaseError(context: string, error: unknown): never {
  const code = isRecord(error) && typeof error.code === "string" ? error.code.slice(0, 40) : "unknown";
  throw new Error(`${context} 실패 (DB code: ${code})`);
}

function databaseErrorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "unknown";
}

function contentType(extension: string): string {
  if (extension === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "hwp") return "application/x-hwp";
  return "application/octet-stream";
}

function storageDuplicate(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return error.statusCode === "409"
    || error.status === 409
    || (typeof error.message === "string" && /duplicate|already exists/i.test(error.message));
}

function deterministicLedgerUuid(ledgerId: string): string {
  const hex = ledgerId.slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

async function logAiLedger(client: SupabaseClient, plan: StagingLoadPlan): Promise<string[]> {
  const logged: string[] = [];
  for (const entry of plan.ai_ledger) {
    const { error } = await client.from("ai_interactions_log").upsert({
      id: deterministicLedgerUuid(entry.ledger_id),
      session_id: "disclosure_ingest",
      interaction_type: "disclosure_extraction",
      specialist_type: null,
      user_input: null,
      ai_output: null,
      tool_name: "disclosure_extraction",
      tool_input: null,
      tool_output: null,
      latency_ms: entry.latency_ms,
      success: entry.success,
      error_message: entry.error_category,
      model: entry.model,
      tokens_input: entry.input_tokens,
      tokens_output: entry.output_tokens,
      cost_usd: entry.estimated_cost_usd,
      metadata: {
        ingest_call_id: entry.ledger_id,
        ingest_ledger_id: entry.ledger_id,
        ingest_run_id: entry.run_id,
        unit_id: entry.unit_id,
        fingerprint: entry.fingerprint,
        prompt_version: entry.prompt_version,
        request_id: entry.request_id,
        batch_index: entry.batch_index,
        attempt: entry.attempt,
        source: "local_disclosure_ingest",
      },
      created_at: entry.attempted_at,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) databaseError("AI 상호작용 ledger 적재", error);
    logged.push(entry.ledger_id);
  }
  return logged;
}

function sha256Buffer(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function uploadRawObjects(
  client: SupabaseClient,
  bucket: string,
  plan: StagingLoadPlan,
): Promise<void> {
  const storage = client.storage.from(bucket);
  for (const raw of plan.raw_objects) {
    const content = await readFile(raw.absolute_path);
    if (sha256Buffer(content) !== raw.sha256 || content.byteLength !== raw.bytes) {
      throw new Error(`Storage 업로드 직전 원본 hash가 변경되었습니다: ${raw.source_path}`);
    }
    const { error } = await storage.upload(
      raw.storage_path,
      content,
      { contentType: contentType(raw.ext), upsert: false },
    );
    if (!error) continue;
    if (!storageDuplicate(error)) databaseError("공시 원본 Storage 업로드", error);

    const existing = await storage.download(raw.storage_path);
    if (existing.error) databaseError("기존 공시 원본 Storage 검증", existing.error);
    if (!existing.data || existing.data.size !== raw.bytes) {
      throw new Error("Existing Storage object size/hash does not match the local evidence object.");
    }
    const existingContent = new Uint8Array(await existing.data.arrayBuffer());
    if (sha256Buffer(existingContent) !== raw.sha256) {
      throw new Error("Existing Storage object hash does not match the local evidence object.");
    }
  }
}

export async function uploadPreviewObjects(
  client: SupabaseClient,
  bucket: string,
  plan: StagingLoadPlan,
): Promise<void> {
  if (bucket !== "disclosure-preview") {
    throw new Error("Derived disclosure text may only be uploaded to disclosure-preview.");
  }
  const storage = client.storage.from(bucket);
  for (const preview of plan.preview_objects) {
    if (
      preview.bytes < 0
      || preview.bytes > 2 * 1024 * 1024
      || !/^[a-f0-9]{64}\.txt$/u.test(preview.storage_path)
      || preview.storage_path !== `${preview.sha256}.txt`
      || preview.source_label.length === 0
      || preview.source_label.length > 255
      || /[\\/]/u.test(preview.source_label)
    ) {
      throw new Error("Derived disclosure preview metadata is invalid.");
    }
    const content = await readFile(preview.absolute_path);
    let previewText: string;
    try {
      previewText = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new Error(`Derived preview text is not valid UTF-8: ${preview.source_label}`);
    }
    if (previewText.includes("\0")) {
      throw new Error(`Derived preview text contains a forbidden NUL byte: ${preview.source_label}`);
    }
    if (sha256Buffer(content) !== preview.sha256 || content.byteLength !== preview.bytes) {
      throw new Error(`Storage 업로드 직전 preview hash가 변경되었습니다: ${preview.source_label}`);
    }
    const { error } = await storage.upload(
      preview.storage_path,
      content,
      { contentType: "text/plain", upsert: false },
    );
    if (!error) continue;
    if (!storageDuplicate(error)) databaseError("공시 preview Storage 업로드", error);

    const existing = await storage.download(preview.storage_path);
    if (existing.error) databaseError("기존 공시 preview Storage 검증", existing.error);
    if (!existing.data || existing.data.size !== preview.bytes) {
      throw new Error("Existing preview Storage object size/hash does not match the local derived object.");
    }
    const existingContent = new Uint8Array(await existing.data.arrayBuffer());
    if (sha256Buffer(existingContent) !== preview.sha256) {
      throw new Error("Existing preview Storage object hash does not match the local derived object.");
    }
  }
}

async function ensureSnapshot(client: SupabaseClient, plan: StagingLoadPlan): Promise<string> {
  const existing = await client
    .from("price_snapshots")
    .select("id")
    .eq("source", plan.snapshot_source)
    .eq("period_label", plan.snapshot)
    .maybeSingle();
  if (existing.error) databaseError("가격 snapshot 조회", existing.error);
  if (existing.data) return idFrom(existing.data, "가격 snapshot 조회");

  const inserted = await client
    .from("price_snapshots")
    .insert({ period_label: plan.snapshot, source: plan.snapshot_source, is_current: false })
    .select("id")
    .single();
  if (inserted.error) databaseError("가격 snapshot 생성", inserted.error);
  return idFrom(inserted.data, "가격 snapshot 생성");
}

type StagingAgencyIdentity = Pick<
  StagingAgencyPackage,
  "agency_name" | "agency_normalized_name" | "agency_corporate_name" | "region_code" | "source_file"
>;

async function ensureAgency(client: SupabaseClient, row: StagingAgencyIdentity): Promise<string> {
  const candidates = await collectBoundedPages<unknown>(async (from, to) => {
    const page = await client
      .from("agencies")
      .select("id,name,normalized_name,aliases")
      .eq("region_code", row.region_code)
      .is("merged_into_agency_id", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (page.error) databaseError("대행사 후보 조회", page.error);
    return Array.isArray(page.data) ? page.data : [];
  });
  const matches = candidates.filter((candidate) => {
    if (!isRecord(candidate) || typeof candidate.name !== "string") return false;
    return [candidate.name, ...stringArray(candidate.aliases)]
      .some((name) => normalizeVendorName(name) === row.agency_normalized_name);
  });
  if (matches.length > 1) {
    throw new Error(`대행사 후보가 여러 개라 자동 매칭하지 않았습니다: ${row.agency_name}`);
  }
  if (matches[0]) return idFrom(matches[0], "대행사 조회");
  const inserted = await client.from("agencies").insert({
    name: row.agency_name,
    normalized_name: row.agency_normalized_name,
    corporate_name: row.agency_corporate_name,
    region_code: row.region_code,
    source_file: row.source_file,
    aliases: [],
  }).select("id").single();
  if (inserted.error) databaseError("대행사 staging 생성", inserted.error);
  return idFrom(inserted.data, "대행사 staging 생성");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export type VendorDatabaseCategory = "studio" | "dress" | "makeup" | "venue" | "other";

export function vendorDatabaseCategory(category: StagingOfficialPrice["category"]): VendorDatabaseCategory {
  return category === "hall" ? "venue" : category;
}

export function deterministicVendorSlug(
  vendorName: string,
  category: StagingOfficialPrice["category"],
  regionCode: string,
): string {
  const databaseCategory = vendorDatabaseCategory(category);
  const safeRegion = regionCode.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  const identity = `${normalizeVendorName(vendorName)}\0${databaseCategory}\0${regionCode}`;
  return `${databaseCategory}-${safeRegion}-${sha256Text(identity).slice(0, 12)}`;
}

export function activeVendorNameMatches(
  candidate: { name: string; aliases?: unknown; status?: unknown },
  targetNormalizedName: string,
): boolean {
  if (candidate.status !== undefined && candidate.status !== "pending" && candidate.status !== "approved") return false;
  return [candidate.name, ...stringArray(candidate.aliases)]
    .some((name) => normalizeVendorName(name) === targetNormalizedName);
}

export async function collectBoundedPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 500,
  maximumRows = 10_000,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || !Number.isSafeInteger(maximumRows) || maximumRows < pageSize) {
    throw new Error("invalid bounded pagination limits");
  }
  const rows: T[] = [];
  for (let from = 0; from < maximumRows; from += pageSize) {
    const requested = Math.min(pageSize, maximumRows - from);
    const page = await fetchPage(from, from + requested - 1);
    if (page.length > requested) throw new Error("vendor pagination returned more rows than requested");
    rows.push(...page);
    if (page.length < requested) return rows;
  }
  const overflow = await fetchPage(maximumRows, maximumRows);
  if (overflow.length > 0) {
    throw new Error(`active vendor candidate count exceeds the fail-closed limit of ${maximumRows}`);
  }
  return rows;
}

export function sanitizeVendorAliasProposals(aliases: string[]): Array<{
  alias: string;
  normalized_alias: string;
}> {
  const sanitized: string[] = [];
  const seen = new Set<string>();
  for (const value of aliases) {
    const alias = value.normalize("NFKC").trim();
    if (alias.length < 1 || alias.length > 200) {
      throw new Error("vendor alias proposals must be 1-200 trimmed characters");
    }
    const normalizedAlias = normalizeVendorName(alias);
    if (normalizedAlias.length < 1 || normalizedAlias.length > 200) {
      throw new Error("vendor alias proposals must have a valid normalized identity");
    }
    if (seen.has(normalizedAlias)) continue;
    seen.add(normalizedAlias);
    sanitized.push(alias);
  }
  if (sanitized.length > 100) throw new Error("vendor alias proposals exceed the 100 item limit");
  return sanitized.map((alias) => ({
    alias,
    normalized_alias: normalizeVendorName(alias),
  }));
}

export async function stageVendorAliasProposals(
  client: SupabaseClient,
  officialPriceId: string,
  vendorId: string,
  aliases: string[],
): Promise<void> {
  const proposals = sanitizeVendorAliasProposals(aliases);
  const existing = await client.from("vendor_alias_proposals")
    .select("id,vendor_id,alias,normalized_alias,status")
    .eq("official_price_id", officialPriceId);
  if (existing.error) databaseError("vendor alias proposal replay query", existing.error);

  const existingByIdentity = new Map<string, Record<string, unknown>>();
  for (const proposal of Array.isArray(existing.data) ? existing.data.filter(isRecord) : []) {
    if (typeof proposal.normalized_alias !== "string" || existingByIdentity.has(proposal.normalized_alias)) {
      throw new Error("stored vendor alias proposals have an invalid or duplicate identity");
    }
    existingByIdentity.set(proposal.normalized_alias, proposal);
  }
  const desiredIdentities = new Set(proposals.map((proposal) => proposal.normalized_alias));
  if ([...existingByIdentity.keys()].some((identity) => !desiredIdentities.has(identity))) {
    throw new Error("stored vendor alias proposal set differs from immutable staged content");
  }
  for (const proposal of proposals) {
    const stored = existingByIdentity.get(proposal.normalized_alias);
    if (stored && (stored.vendor_id !== vendorId || stored.alias !== proposal.alias)) {
      throw new Error("stored vendor alias proposal differs from immutable staged content");
    }
  }

  const missing = proposals.filter((proposal) => !existingByIdentity.has(proposal.normalized_alias));
  if (missing.length > 0) {
    const inserted = await client.from("vendor_alias_proposals").upsert(
      missing.map((proposal) => ({
        official_price_id: officialPriceId,
        vendor_id: vendorId,
        alias: proposal.alias,
        normalized_alias: proposal.normalized_alias,
        status: "pending",
      })),
      { onConflict: "official_price_id,normalized_alias", ignoreDuplicates: true },
    );
    if (inserted.error) databaseError("vendor alias proposal staging", inserted.error);
  }

  const verified = await client.from("vendor_alias_proposals")
    .select("vendor_id,alias,normalized_alias,status")
    .eq("official_price_id", officialPriceId);
  if (verified.error) databaseError("vendor alias proposal replay verification", verified.error);
  const verifiedRows = Array.isArray(verified.data) ? verified.data.filter(isRecord) : [];
  if (verifiedRows.length !== proposals.length || proposals.some((proposal) => !verifiedRows.some((stored) =>
    stored.vendor_id === vendorId
      && stored.alias === proposal.alias
      && stored.normalized_alias === proposal.normalized_alias
      && (stored.status === "pending" || stored.status === "approved" || stored.status === "rejected")
  ))) {
    throw new Error("vendor alias proposal replay verification failed");
  }
}

async function ensureVendor(client: SupabaseClient, row: StagingOfficialPrice): Promise<string> {
  const databaseCategory = vendorDatabaseCategory(row.category);
  const allCandidates = await collectBoundedPages<unknown>(async (from, to) => {
    const page = await client
      .from("vendors")
      .select("id,name,aliases,status")
      .eq("category", databaseCategory)
      .eq("region_code", row.region_code)
      .in("status", ["pending", "approved"])
      .order("id", { ascending: true })
      .range(from, to);
    if (page.error) databaseError("vendor candidate page query", page.error);
    return Array.isArray(page.data) ? page.data : [];
  });
  const target = normalizeVendorName(row.vendor_name);
  const matches = allCandidates.filter((candidate) => {
    if (!isRecord(candidate) || typeof candidate.name !== "string") return false;
    return activeVendorNameMatches({
      name: candidate.name,
      aliases: candidate.aliases,
      status: candidate.status,
    }, target);
  });
  if (matches.length > 1) throw new Error(`업체 후보가 여러 개라 자동 매칭하지 않았습니다: ${row.vendor_name}`);
  if (matches[0]) {
    return idFrom(matches[0], "업체 후보 조회");
  }

  const slug = deterministicVendorSlug(row.vendor_name, row.category, row.region_code);
  const slugCollision = await client.from("vendors")
    .select("id,name,aliases,status,category,region_code")
    .eq("slug", slug)
    .maybeSingle();
  if (slugCollision.error) databaseError("업체 slug 충돌 조회", slugCollision.error);
  if (slugCollision.data) {
    if (
      isRecord(slugCollision.data)
      && typeof slugCollision.data.name === "string"
      && slugCollision.data.category === databaseCategory
      && slugCollision.data.region_code === row.region_code
      && activeVendorNameMatches({
        name: slugCollision.data.name,
        aliases: slugCollision.data.aliases,
        status: slugCollision.data.status,
      }, target)
    ) {
      return idFrom(slugCollision.data, "업체 slug 조회");
    }
    throw new Error("deterministic vendor slug collision; automatic vendor creation is blocked");
  }

  const inserted = await client.from("vendors").insert({
    owner_id: null,
    name: row.vendor_name,
    slug,
    category: databaseCategory,
    location: "",
    region_code: row.region_code,
    aliases: [],
    status: "pending",
    attributes: {},
    enrichment_status: "pending",
  }).select("id").single();
  if (inserted.error && databaseErrorCode(inserted.error) === "23505") {
    throw new Error("deterministic vendor slug collision during insert; automatic vendor creation is blocked");
  }
  if (inserted.error) databaseError("업체 staging 생성", inserted.error);
  return idFrom(inserted.data, "업체 staging 생성");
}

async function insertAgencyPackage(
  client: SupabaseClient,
  snapshotId: string,
  row: StagingAgencyPackage,
): Promise<string> {
  const agencyId = await ensureAgency(client, row);
  const existing = await client.from("official_agency_packages")
    .select("id,category_scope,price_min_krw,price_max_krw,vat_note,price_note,source_quote,source_object_keys,source_preview_keys,options,confidence,needs_review,validation_issue_codes")
    .eq("snapshot_id", snapshotId)
    .eq("agency_id", agencyId)
    .eq("package_name", row.package_name)
    .eq("source_file", row.source_file)
    .maybeSingle();
  if (existing.error) databaseError("대행사 패키지 중복 확인", existing.error);
  if (existing.data) {
    const same = isRecord(existing.data)
      && existing.data.price_min_krw === row.price_min_krw
      && existing.data.price_max_krw === row.price_max_krw
      && JSON.stringify(existing.data.category_scope) === JSON.stringify(row.category_scope)
      && existing.data.vat_note === row.vat_note
      && existing.data.price_note === row.price_note
      && existing.data.source_quote === row.source_quote
      && JSON.stringify(existing.data.source_object_keys) === JSON.stringify(row.source_object_keys)
      && JSON.stringify(existing.data.source_preview_keys) === JSON.stringify(row.source_preview_keys)
      && JSON.stringify(existing.data.options) === JSON.stringify(row.options)
      && existing.data.confidence === row.confidence
      && existing.data.needs_review === row.needs_review
      && JSON.stringify(existing.data.validation_issue_codes) === JSON.stringify(row.validation_issue_codes);
    if (!same) {
      throw new Error("agency package identity already exists with different staged values; automatic overwrite is blocked");
    }
    return agencyId;
  }
  const inserted = await client.from("official_agency_packages").insert({
    snapshot_id: snapshotId,
    agency_id: agencyId,
    package_name: row.package_name,
    category_scope: row.category_scope,
    price_min_krw: row.price_min_krw,
    price_max_krw: row.price_max_krw,
    vat_note: row.vat_note,
    price_note: row.price_note,
    options: row.options,
    review_status: "pending",
    needs_review: row.needs_review,
    validation_issue_codes: row.validation_issue_codes,
    source_file: row.source_file,
    source_object_keys: row.source_object_keys,
    source_preview_keys: row.source_preview_keys,
    source_quote: row.source_quote,
    confidence: row.confidence,
  });
  if (inserted.error) databaseError("대행사 패키지 staging 적재", inserted.error);
  return agencyId;
}

async function insertPriceOptions(
  client: SupabaseClient,
  officialPriceId: string,
  row: StagingOfficialPrice,
): Promise<void> {
  const existing = await client.from("official_price_options")
    .select("name,price_min_krw,price_max_krw,unit,condition,raw_text,source_file,source_quote,source_object_keys,confidence")
    .eq("official_price_id", officialPriceId);
  if (existing.error) databaseError("공시 옵션 중복 확인", existing.error);
  const existingByIdentity = new Map<string, Record<string, unknown>>();
  for (const option of Array.isArray(existing.data) ? existing.data.filter(isRecord) : []) {
    const identity = `${option.name ?? ""}\0${option.unit ?? ""}\0${option.condition ?? ""}`;
    if (existingByIdentity.has(identity)) {
      throw new Error("duplicate stored option identity; automatic continuation is blocked");
    }
    existingByIdentity.set(identity, option);
  }
  for (const option of row.options) {
    const identity = `${option.name}\0${option.unit ?? ""}\0${option.condition ?? ""}`;
    const stored = existingByIdentity.get(identity);
    if (stored) {
      const same = stored.price_min_krw === option.price_min_krw
        && stored.price_max_krw === option.price_max_krw
        && stored.raw_text === option.raw_text
        && stored.source_file === option.source_file
        && stored.source_quote === option.source_quote
        && JSON.stringify(stored.source_object_keys) === JSON.stringify(option.source_object_keys)
        && stored.confidence === row.confidence;
      if (!same) {
        throw new Error("official price option identity already exists with different staged values; automatic overwrite is blocked");
      }
      continue;
    }
    const inserted = await client.from("official_price_options").insert({
      official_price_id: officialPriceId,
      name: option.name,
      price_min_krw: option.price_min_krw,
      price_max_krw: option.price_max_krw,
      unit: option.unit,
      condition: option.condition,
      raw_text: option.raw_text,
      source_file: option.source_file,
      source_object_keys: option.source_object_keys,
      source_quote: option.source_quote,
      confidence: row.confidence,
    });
    if (inserted.error) databaseError("공시 옵션 staging 적재", inserted.error);
  }
}

function stagedPriceParentMatches(
  stored: Record<string, unknown>,
  vendorId: string,
  agencyId: string | null,
  row: StagingOfficialPrice,
): boolean {
  const storedContentFingerprint = buildOfficialPriceContentFingerprint({
    vendor_id: stored.vendor_id,
    agency_id: stored.agency_id,
    category: stored.category,
    item_name: stored.item_name,
    base_spec: stored.base_spec,
    price_min_krw: stored.price_min_krw,
    price_max_krw: stored.price_max_krw,
    vat_note: stored.vat_note,
    price_note: stored.price_note,
    validation_issue_codes: stored.validation_issue_codes,
    source_file: stored.source_file,
    source_object_keys: stored.source_object_keys,
    source_preview_keys: stored.source_preview_keys,
    source_quote: stored.source_quote,
    confidence: stored.confidence,
  });
  const stagedContentFingerprint = buildOfficialPriceContentFingerprint({
    vendor_id: vendorId,
    agency_id: agencyId,
    category: row.category,
    item_name: row.item_name,
    base_spec: row.base_spec,
    price_min_krw: row.price_min_krw,
    price_max_krw: row.price_max_krw,
    vat_note: row.vat_note,
    price_note: row.price_note,
    validation_issue_codes: row.validation_issue_codes,
    source_file: row.source_file,
    source_object_keys: row.source_object_keys,
    source_preview_keys: row.source_preview_keys,
    source_quote: row.source_quote,
    confidence: row.confidence,
  });
  return stored.source_record_key === row.source_record_key
    && storedContentFingerprint === stagedContentFingerprint;
}

function optionIdentity(option: { name?: unknown; unit?: unknown; condition?: unknown }): string {
  return `${option.name ?? ""}\0${option.unit ?? ""}\0${option.condition ?? ""}`;
}

function stagedOptionMatches(
  stored: Record<string, unknown>,
  option: StagingOfficialPrice["options"][number],
  row: StagingOfficialPrice,
): boolean {
  return stored.name === option.name
    && stored.price_min_krw === option.price_min_krw
    && stored.price_max_krw === option.price_max_krw
    && stored.unit === option.unit
    && stored.condition === option.condition
    && stored.raw_text === option.raw_text
    && stored.source_file === option.source_file
    && stored.source_quote === option.source_quote
    && JSON.stringify(stored.source_object_keys) === JSON.stringify(option.source_object_keys)
    && stored.confidence === row.confidence;
}

export async function reconcileExistingOfficialPrice(
  client: SupabaseClient,
  storedPrice: Record<string, unknown>,
  vendorId: string,
  row: StagingOfficialPrice,
  agencyId: string | null = null,
): Promise<void> {
  if (!stagedPriceParentMatches(storedPrice, vendorId, agencyId, row)) {
    throw new Error("existing official price immutable staged content mismatch");
  }

  const existing = await client.from("official_price_options")
    .select("name,price_min_krw,price_max_krw,unit,condition,raw_text,source_file,source_quote,source_object_keys,confidence")
    .eq("official_price_id", idFrom(storedPrice, "공시 가격 중복 확인"));
  if (existing.error) databaseError("공시 옵션 중복 확인", existing.error);
  const existingByIdentity = new Map<string, Record<string, unknown>>();
  for (const option of Array.isArray(existing.data) ? existing.data.filter(isRecord) : []) {
    const identity = optionIdentity(option);
    if (existingByIdentity.has(identity)) {
      throw new Error("duplicate stored option identity; automatic continuation is blocked");
    }
    existingByIdentity.set(identity, option);
  }

  const expectedIdentities = new Set<string>();
  for (const option of row.options) {
    const identity = optionIdentity(option);
    if (expectedIdentities.has(identity)) {
      throw new Error("duplicate staged option identity; automatic continuation is blocked");
    }
    expectedIdentities.add(identity);
    const stored = existingByIdentity.get(identity);
    if (stored && !stagedOptionMatches(stored, option, row)) {
      throw new Error("existing official price option immutable staged content mismatch");
    }
  }
  if ([...existingByIdentity.keys()].some((identity) => !expectedIdentities.has(identity))) {
    throw new Error("existing official price option set differs from immutable staged content");
  }

  const pendingUnedited = storedPrice.review_status === "pending"
    && storedPrice.edited_by_admin === false;
  const missingOptions = row.options.filter((option) =>
    !existingByIdentity.has(optionIdentity(option))
  );
  if (!pendingUnedited) {
    if (missingOptions.length > 0) {
      throw new Error("reviewed or edited official price option set is immutable and differs from staged content");
    }
    return;
  }
  if (storedPrice.needs_review !== row.needs_review) {
    throw new Error("pending official price review state differs from staged content");
  }

  for (const option of missingOptions) {
    const inserted = await client.from("official_price_options").insert({
      official_price_id: idFrom(storedPrice, "공시 가격 중복 확인"),
      name: option.name,
      price_min_krw: option.price_min_krw,
      price_max_krw: option.price_max_krw,
      unit: option.unit,
      condition: option.condition,
      raw_text: option.raw_text,
      source_file: option.source_file,
      source_object_keys: option.source_object_keys,
      source_quote: option.source_quote,
      confidence: row.confidence,
    });
    if (inserted.error) databaseError("공시 옵션 staging 복구", inserted.error);
  }
}

async function insertOfficialPrice(
  client: SupabaseClient,
  snapshotId: string,
  row: StagingOfficialPrice,
): Promise<{ vendorId: string; agencyId: string | null }> {
  const vendorId = await ensureVendor(client, row);
  const agencyId = row.source_agency
    ? await ensureAgency(client, {
      agency_name: row.source_agency.name,
      agency_normalized_name: row.source_agency.normalized_name,
      agency_corporate_name: row.source_agency.corporate_name,
      region_code: row.source_agency.region_code,
      source_file: row.source_agency.source_file,
    })
    : null;
  const existing = await client.from("official_prices")
    .select("id,vendor_id,agency_id,category,item_name,base_spec,price_min_krw,price_max_krw,vat_note,price_note,review_status,needs_review,validation_issue_codes,source_file,source_object_keys,source_preview_keys,source_quote,confidence,source_record_key,edited_by_admin")
    .eq("snapshot_id", snapshotId)
    .eq("source_record_key", row.source_record_key)
    .maybeSingle();
  if (existing.error) databaseError("공시 가격 중복 확인", existing.error);
  if (existing.data) {
    if (!isRecord(existing.data)) {
      throw new Error("같은 source_record_key의 기존 가격 행 형식을 확인할 수 없습니다.");
    }
    await reconcileExistingOfficialPrice(client, existing.data, vendorId, row, agencyId);
    await stageVendorAliasProposals(
      client,
      idFrom(existing.data, "공시 가격 중복 확인"),
      vendorId,
      row.alias_proposals,
    );
    return { vendorId, agencyId };
  }

  const inserted = await client.from("official_prices").insert({
    snapshot_id: snapshotId,
    vendor_id: vendorId,
    agency_id: agencyId,
    category: row.category,
    item_name: row.item_name,
    base_spec: row.base_spec,
    price_min_krw: row.price_min_krw,
    price_max_krw: row.price_max_krw,
    vat_note: row.vat_note,
    price_note: row.price_note,
    review_status: "pending",
    needs_review: row.needs_review,
    validation_issue_codes: row.validation_issue_codes,
    source_file: row.source_file,
    source_object_keys: row.source_object_keys,
    source_preview_keys: row.source_preview_keys,
    source_quote: row.source_quote,
    confidence: row.confidence,
    source_record_key: row.source_record_key,
    edited_by_admin: false,
  }).select("id").single();
  if (inserted.error) databaseError("공시 가격 staging 적재", inserted.error);
  const officialPriceId = idFrom(inserted.data, "공시 가격 staging 적재");
  await insertPriceOptions(client, officialPriceId, row);
  await stageVendorAliasProposals(client, officialPriceId, vendorId, row.alias_proposals);
  return { vendorId, agencyId };
}

export function canonicalVendorPair(leftVendorId: string, rightVendorId: string): [string, string] {
  return leftVendorId.localeCompare(rightVendorId, "en") <= 0
    ? [leftVendorId, rightVendorId]
    : [rightVendorId, leftVendorId];
}

export function resolveStagedVendorDedupePair(
  candidate: StagingDedupeCandidate,
  unitVendorIds: Map<string, string>,
  partnerVendorIds: Map<string, string>,
): [string, string] | null {
  if (candidate.entity_kind !== "vendor") return null;
  const hasLeftRef = candidate.left_record_ref !== undefined;
  const hasRightRef = candidate.right_record_ref !== undefined;
  if (hasLeftRef !== hasRightRef) throw new Error("vendor dedupe candidate row refs must be provided as a pair");
  const left = hasLeftRef
    ? partnerVendorIds.get(candidate.left_record_ref as string)
    : unitVendorIds.get(candidate.left_unit_id);
  const right = hasRightRef
    ? partnerVendorIds.get(candidate.right_record_ref as string)
    : unitVendorIds.get(candidate.right_unit_id);
  if (hasLeftRef && (!left || !right)) {
    throw new Error("vendor dedupe candidate could not resolve its persisted partner row refs");
  }
  if (!left || !right || left === right) return null;
  return canonicalVendorPair(left, right);
}

async function persistDedupeCandidate(
  client: SupabaseClient,
  candidate: StagingDedupeCandidate,
  unitVendorIds: Map<string, string>,
  partnerVendorIds: Map<string, string>,
): Promise<void> {
  const pair = resolveStagedVendorDedupePair(candidate, unitVendorIds, partnerVendorIds);
  if (!pair) return;
  const [leftVendorId, rightVendorId] = pair;
  const { error } = await client.from("vendor_dedupe_candidates").upsert({
    left_vendor_id: leftVendorId,
    right_vendor_id: rightVendorId,
    reason: candidate.reason,
    similarity: Math.max(0, Math.min(1, candidate.similarity)),
    status: "pending",
  }, { onConflict: "left_vendor_id,right_vendor_id", ignoreDuplicates: true });
  if (error) databaseError("업체 중복 후보 staging 적재", error);
}

async function persistAgencyDedupeCandidate(
  client: SupabaseClient,
  candidate: StagingDedupeCandidate,
  unitAgencyIds: Map<string, string>,
): Promise<void> {
  if (candidate.entity_kind !== "agency") return;
  const left = unitAgencyIds.get(candidate.left_unit_id);
  const right = unitAgencyIds.get(candidate.right_unit_id);
  if (!left || !right || left === right) return;
  const [leftAgencyId, rightAgencyId] = canonicalVendorPair(left, right);
  const { error } = await client.from("agency_dedupe_candidates").upsert({
    left_agency_id: leftAgencyId,
    right_agency_id: rightAgencyId,
    reason: candidate.reason,
    similarity: Math.max(0, Math.min(1, candidate.similarity)),
    status: "pending",
  }, { onConflict: "left_agency_id,right_agency_id", ignoreDuplicates: true });
  if (error) databaseError("대행사 중복 후보 staging 적재", error);
}

function assertPlanSourceObjectKeys(plan: StagingLoadPlan): void {
  const available = new Set(plan.raw_objects.map((raw) => raw.storage_path));
  const availablePreviews = new Set(plan.preview_objects.map((preview) => preview.storage_path));
  const previewMappings = new Set(plan.preview_objects.map((preview) =>
    `${preview.storage_path}\0${preview.source_object_key}`
  ));
  const unitRecords = new Map(plan.units.map((unit) => [unit.unit_id, unit.source_records]));
  const keyPattern = /^[a-f0-9]{64}\.(?:xlsx|docx|hwp|pdf|png)$/;
  const previewKeyPattern = /^[a-f0-9]{64}\.txt$/;
  for (const preview of plan.preview_objects) {
    if (!available.has(preview.source_object_key)) {
      throw new Error("preview object must reference an immutable raw object in the same upload plan");
    }
  }
  const rows = [...plan.agency_packages, ...plan.official_prices];
  const rowProvenance = rows.flatMap((row) => [
    { unit_id: row.unit_id, source_file: row.source_file, source_object_keys: row.source_object_keys, source_preview_keys: row.source_preview_keys, requires_preview: true },
    ...row.options.map((option) => ({
      unit_id: row.unit_id,
      source_file: option.source_file,
      source_object_keys: option.source_object_keys,
      source_preview_keys: [] as string[],
      requires_preview: false,
    })),
  ]);
  for (const row of rowProvenance) {
    const records = unitRecords.get(row.unit_id);
    const selected = records?.filter((record) => row.source_object_keys.includes(record.source_object_key)) ?? [];
    let sourceLabels: string[] = [];
    try {
      const parsed = JSON.parse(row.source_file);
      sourceLabels = Array.isArray(parsed) && parsed.every((value) => typeof value === "string")
        ? parsed
        : [row.source_file];
    } catch {
      sourceLabels = [row.source_file];
    }
    const previewRecords = selected.filter((record) => record.source_preview_key !== null);
    const expectedPreviews = previewRecords.map((record) => record.source_preview_key as string);
    if (
      row.source_object_keys.length === 0
      || row.source_object_keys.some((key) => !keyPattern.test(key) || !available.has(key))
      || !records
      || selected.length !== row.source_object_keys.length
      || selected.some((record, index) => record.source_object_key !== row.source_object_keys[index])
      || selected.some((record, index) => record.source_file !== sourceLabels[index])
      || sourceLabels.length !== selected.length
    ) {
      throw new Error("staging row provenance must preserve a canonical source subset backed by the upload plan");
    }
    if (row.requires_preview && (
      row.source_preview_keys.length > 16
      || row.source_preview_keys.some((key) => !previewKeyPattern.test(key) || !availablePreviews.has(key))
      || expectedPreviews.length !== row.source_preview_keys.length
      || expectedPreviews.some((key, index) => key !== row.source_preview_keys[index])
      || row.source_preview_keys.some((key, index) =>
        !previewMappings.has(`${key}\0${previewRecords[index]?.source_object_key ?? ""}`)
      )
    )) {
      throw new Error("staging source_preview_keys must preserve canonical preview order and be backed by the private upload plan");
    }
  }
  const rowUnitIds = new Set(rows.map((row) => row.unit_id));
  if (plan.units.some((unit) => !rowUnitIds.has(unit.unit_id))) {
    throw new Error("a unit without a staging price/package row cannot be marked loaded");
  }
}

export function createSupabaseStagingWriter(environment: StagingEnvironment): StagingWriter {
  assertDisclosureStagingProjectRef(environment.projectRef);
  const client = createClient(environment.url, environment.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    stage: async (plan): Promise<StagingWriterResult> => {
      assertPlanSourceObjectKeys(plan);
      const loggedLedgerIds = await logAiLedger(client, plan);
      await uploadRawObjects(client, environment.bucket, plan);
      await uploadPreviewObjects(client, environment.previewBucket, plan);
      if (plan.agency_packages.length === 0 && plan.official_prices.length === 0) {
        return {
          loadedUnitIds: [],
          skippedUnitIds: plan.skipped_units.map((unit) => unit.unit_id),
          loggedLedgerIds,
        };
      }
      const snapshotId = await ensureSnapshot(client, plan);
      const unitAgencyIds = new Map<string, string>();
      for (const row of plan.agency_packages) {
        const agencyId = await insertAgencyPackage(client, snapshotId, row);
        if (!unitAgencyIds.has(row.unit_id)) unitAgencyIds.set(row.unit_id, agencyId);
      }
      const unitVendorIds = new Map<string, string>();
      const partnerVendorIds = new Map<string, string>();
      for (const row of plan.official_prices) {
        const { vendorId, agencyId } = await insertOfficialPrice(client, snapshotId, row);
        if (!unitVendorIds.has(row.unit_id)) unitVendorIds.set(row.unit_id, vendorId);
        if (row.partner_record_ref) {
          const previousVendorId = partnerVendorIds.get(row.partner_record_ref);
          if (previousVendorId && previousVendorId !== vendorId) {
            throw new Error("partner vendor row ref resolved to more than one persisted vendor UUID");
          }
          partnerVendorIds.set(row.partner_record_ref, vendorId);
        }
        if (agencyId && !unitAgencyIds.has(row.unit_id)) unitAgencyIds.set(row.unit_id, agencyId);
      }
      for (const candidate of plan.dedupe_candidates) {
        await persistDedupeCandidate(client, candidate, unitVendorIds, partnerVendorIds);
        await persistAgencyDedupeCandidate(client, candidate, unitAgencyIds);
      }
      return {
        loadedUnitIds: plan.units.map((unit) => unit.unit_id),
        skippedUnitIds: plan.skipped_units.map((unit) => unit.unit_id),
        loggedLedgerIds,
      };
    },
  };
}
