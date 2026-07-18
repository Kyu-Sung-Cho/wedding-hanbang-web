import { createHash } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { assertDisclosureStagingProjectRef } from "./destination.js";

export type PriceDemoCategory = "studio" | "dress" | "makeup" | "venue";
type StoredPriceDemoCategory = Exclude<PriceDemoCategory, "venue"> | "hall";

export interface PriceDemoAgency {
  id: string;
  name: string;
  normalized_name: string;
  aliases: string[];
  corporate_name: string;
  region_code: string;
  source_file: string;
  slug: string;
  display_name: string;
  homepage_url: null;
  disclosure_url: null;
  is_active: true;
}

export interface PriceDemoVendor {
  id: string;
  owner_id: null;
  name: string;
  slug: string;
  category: PriceDemoCategory;
  location: string;
  region_code: string;
  aliases: string[];
  status: "approved";
  attributes: { demo_notice: string };
  enrichment_status: "skip";
}

export interface PriceDemoOption {
  id: string;
  official_price_id: string;
  name: string;
  price_min_krw: number;
  price_max_krw: number;
  unit: string;
  condition: string;
  raw_text: string;
  source_file: string;
  source_quote: string;
  source_object_keys: string[];
  confidence: 1;
  is_effectively_mandatory: boolean;
  ai_note: string;
  sort_order: number;
}

export interface PriceDemoPrice {
  id: string;
  snapshot_id: string;
  vendor_id: string;
  agency_id: string;
  category: StoredPriceDemoCategory;
  item_name: string;
  base_spec: string;
  price_min_krw: number;
  price_max_krw: number;
  vat_note: string;
  price_note: string;
  source_file: string;
  source_quote: string;
  source_object_keys: string[];
  source_record_key: string;
  confidence: 1;
  options: PriceDemoOption[];
  review: {
    action: "approve";
    expected_review_version: 0;
  };
}

export interface PriceDemoFixture {
  evidence: {
    bucket: "disclosure-raw";
    object_key: string;
    source_file: string;
    content_type: "image/png";
    bytes_base64: string;
  };
  agencies: PriceDemoAgency[];
  vendors: PriceDemoVendor[];
  snapshot: {
    id: string;
    period_label: string;
    source: string;
    source_url: null;
    source_note: string;
    collected_at: string;
  };
  prices: PriceDemoPrice[];
  publication: {
    snapshot_id: string;
    method: "promote_price_snapshot";
  };
}

export interface PriceDemoSeedRepository {
  /** Idempotently prepares evidence, agencies, vendors and the draft snapshot. */
  prepareFoundation(fixture: PriceDemoFixture, actorId: string): Promise<void>;
  /** Inserts a missing virgin row/options or verifies an exact replay. */
  preparePrice(price: PriceDemoPrice, actorId: string): Promise<"pending" | "approved">;
  /** Uses the database-owned review fence to approve one exact pending row. */
  approvePrice(price: PriceDemoPrice, actorId: string): Promise<void>;
  /** Publication must be implemented exclusively through promote_price_snapshot. */
  promoteSnapshot(snapshotId: string, actorId: string): Promise<void>;
  /** Fails unless the complete fixture is current, published and exact. */
  verifyPublishedFixture(fixture: PriceDemoFixture, actorId: string): Promise<void>;
}

export interface PriceDemoSeedResult {
  snapshot_id: string;
  agencies: number;
  vendors: number;
  prices: number;
  options: number;
  mandatory_options: number;
  published: true;
}

const SAMPLE_EVIDENCE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const CATEGORY_LABELS: ReadonlyArray<readonly [PriceDemoCategory, string]> = [
  ["studio", "스튜디오"],
  ["dress", "드레스"],
  ["makeup", "메이크업"],
  ["venue", "예식장"],
];

const DEMO_REGION_CODES = [
  "seoul_gangnam3",
  "seoul_etc",
  "incheon",
  "busan",
  "daejeon",
  "gwangju",
  "daegu",
  "ulsan",
  "gyeonggi",
  "chungcheong",
  "jeolla",
  "gyeongsang",
] as const;

export interface PriceDemoSeedEnvironment {
  target: "local" | "staging";
  projectRef: string;
  url: string;
  key: string;
  actorId: string;
}

const PRODUCTION_APP_HOSTS = new Set(["hanbang.ai", "www.hanbang.ai"]);
const DESTINATION_URL_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "PRICE_DEMO_SEED_APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

function requiredEnvironmentValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`price demo seed requires ${key}`);
  return value;
}

function parseEnvironmentUrl(value: string, label: string): URL {
  const withProtocol = /^https?:\/\//iu.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error(`price demo seed ${label} is not a valid URL`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`price demo seed ${label} contains forbidden URL credentials, query, or fragment`);
  }
  return parsed;
}

function assertNotProductionDestination(env: NodeJS.ProcessEnv): void {
  for (const key of DESTINATION_URL_KEYS) {
    const value = env[key]?.trim();
    if (!value) continue;
    const parsed = parseEnvironmentUrl(value, key);
    if (PRODUCTION_APP_HOSTS.has(parsed.hostname.toLocaleLowerCase("en-US"))) {
      throw new Error(`price demo seed refuses the hanbang.ai production destination (${key})`);
    }
    if (parsed.hostname === "slrtobkksjmxgzatjyqb.supabase.co") {
      throw new Error(`price demo seed refuses the repository-pinned production destination (${key})`);
    }
  }
}

function assertServiceRoleKey(key: string): void {
  if (/anon|publishable/iu.test(key)) {
    throw new Error("price demo seed requires a service_role secret, not an anon/publishable key");
  }
  if (key.startsWith("sb_secret_")) return;
  const parts = key.split(".");
  if (parts.length !== 3) {
    throw new Error("price demo seed requires a service_role JWT or sb_secret_ key");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("price demo seed could not validate the service_role JWT");
  }
  if (
    typeof payload !== "object"
    || payload === null
    || !("role" in payload)
    || payload.role !== "service_role"
  ) {
    throw new Error("price demo seed JWT role must be service_role");
  }
}

/** Fail-closed destination fence. It intentionally ignores any env-provided production-ref override. */
export function assertPriceDemoSeedEnvironment(env: NodeJS.ProcessEnv): PriceDemoSeedEnvironment {
  assertNotProductionDestination(env);
  const target = requiredEnvironmentValue(env, "PRICE_DEMO_SEED_TARGET_ENV");
  if (target !== "local" && target !== "staging") {
    throw new Error("price demo seed target must be local or staging");
  }
  const projectRef = requiredEnvironmentValue(env, "SUPABASE_PROJECT_REF");
  const url = requiredEnvironmentValue(env, "SUPABASE_URL");
  const key = requiredEnvironmentValue(env, "SUPABASE_SERVICE_ROLE_KEY");
  const actorId = requiredEnvironmentValue(env, "PRICE_DEMO_SEED_ADMIN_ACTOR_ID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(actorId)) {
    throw new Error("price demo seed admin actor must be a valid UUID");
  }
  assertServiceRoleKey(key);
  assertDisclosureStagingProjectRef(projectRef);

  const confirmation = requiredEnvironmentValue(env, "PRICE_DEMO_SEED_CONFIRM");
  if (confirmation !== `SEED_SAMPLE_PRICE_DISCLOSURE:${projectRef}`) {
    throw new Error("price demo seed confirm value does not exactly match the target project ref");
  }

  const parsed = parseEnvironmentUrl(url, "SUPABASE_URL");
  if (parsed.pathname !== "/") {
    throw new Error("price demo seed SUPABASE_URL must be a base URL without a path");
  }
  if (target === "local") {
    if (projectRef !== "local") {
      throw new Error("price demo seed local target requires SUPABASE_PROJECT_REF=local");
    }
    if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(parsed.hostname)) {
      throw new Error("price demo seed local target must use a localhost Supabase URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("price demo seed local URL must use HTTP or HTTPS");
    }
  } else {
    const stagingRef = requiredEnvironmentValue(env, "PRICE_DEMO_SEED_STAGING_PROJECT_REF");
    assertDisclosureStagingProjectRef(stagingRef);
    if (stagingRef !== projectRef) {
      throw new Error("price demo seed staging project refs do not match");
    }
    if (parsed.protocol !== "https:" || parsed.port !== "" || parsed.hostname !== `${projectRef}.supabase.co`) {
      throw new Error("price demo seed staging URL must exactly match its non-production Supabase project ref");
    }
  }

  return { target, projectRef, url, key, actorId };
}

function sequenceUuid(namespace: string, index: number): string {
  return `${namespace}-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

/**
 * Builds an intentionally synthetic, deterministic fixture. Nothing in this
 * object is presented as market data: every human-visible identity and source
 * carries SAMPLE/데모, while patterned values make accidental reuse obvious.
 */
export function buildPriceDemoFixture(): PriceDemoFixture {
  const evidenceBytes = Buffer.from(SAMPLE_EVIDENCE_BASE64, "base64");
  const evidenceKey = `${createHash("sha256").update(evidenceBytes).digest("hex")}.png`;
  const snapshotId = "d3c00000-0000-4000-8000-000000000001";
  const agencies: PriceDemoAgency[] = Array.from({ length: 3 }, (_, index) => {
    const ordinal = index + 1;
    const letter = String.fromCharCode(64 + ordinal);
    return {
      id: sequenceUuid("d3a00000", ordinal),
      name: `SAMPLE 데모 공시대행사 ${letter}`,
      normalized_name: `sample데모공시대행사${letter.toLocaleLowerCase("en-US")}`,
      aliases: [`SAMPLE 데모 대행 별칭 ${letter}`],
      corporate_name: `SAMPLE 데모 법인 ${letter}`,
      region_code: DEMO_REGION_CODES[index] ?? "seoul_gangnam3",
      source_file: "SAMPLE-데모-증빙.png",
      slug: `sample-demo-agency-${letter.toLocaleLowerCase("en-US")}`,
      display_name: `SAMPLE 데모 공시대행사 ${letter}`,
      homepage_url: null,
      disclosure_url: null,
      is_active: true,
    };
  });

  const vendors: PriceDemoVendor[] = CATEGORY_LABELS.flatMap(([category, label], categoryIndex) =>
    Array.from({ length: 3 }, (_, itemIndex) => {
      const ordinal = categoryIndex * 3 + itemIndex + 1;
      return {
        id: sequenceUuid("d3b00000", ordinal),
        owner_id: null,
        name: `SAMPLE 데모 ${label} ${itemIndex + 1}`,
        slug: `sample-demo-${category}-${itemIndex + 1}`,
        category,
        location: "SAMPLE 데모 지역",
        region_code: DEMO_REGION_CODES[ordinal - 1] ?? "seoul_gangnam3",
        aliases: ordinal <= 2 ? [`SAMPLE 데모 ${label} 별칭 ${itemIndex + 1}`] : [],
        status: "approved",
        attributes: { demo_notice: "SAMPLE 데모 전용 — 실제 업체 정보가 아닙니다" },
        enrichment_status: "skip",
      };
    }),
  );

  const prices: PriceDemoPrice[] = vendors.map((vendor, index) => {
    const ordinal = index + 1;
    const priceId = sequenceUuid("d3d00000", ordinal);
    const categoryLabel = CATEGORY_LABELS.find(([category]) => category === vendor.category)?.[1] ?? "업체";
    const patternedMin = 101_010 + ordinal * 10_101;
    const patternedMax = patternedMin + 1_010;
    const sourceQuote = `SAMPLE 데모 근거 문구 ${ordinal}: 실제 공시·가격이 아닌 테스트 범위`;
    const option: PriceDemoOption = {
      id: sequenceUuid("d3e00000", ordinal),
      official_price_id: priceId,
      name: `SAMPLE 데모 ${categoryLabel} 옵션 ${ordinal}`,
      price_min_krw: 1_010 + ordinal,
      price_max_krw: 1_010 + ordinal,
      unit: "SAMPLE 데모 1회",
      condition: "SAMPLE 데모 조건 — 실제 계약 조건 아님",
      raw_text: `SAMPLE 데모 원문 옵션 ${ordinal} — 실제 정보 아님`,
      source_file: "SAMPLE-데모-증빙.png",
      source_quote: `SAMPLE 데모 옵션 근거 ${ordinal} — 실제 원문 아님`,
      source_object_keys: [evidenceKey],
      confidence: 1,
      is_effectively_mandatory: ordinal <= 2,
      ai_note: "SAMPLE 데모 판정 — 실제 필수 옵션 판정 아님",
      sort_order: 1,
    };
    return {
      id: priceId,
      snapshot_id: snapshotId,
      vendor_id: vendor.id,
      agency_id: agencies[index % agencies.length].id,
      category: vendor.category === "venue" ? "hall" : vendor.category,
      item_name: `SAMPLE 데모 ${categoryLabel} 기본 구성 ${ordinal}`,
      base_spec: "SAMPLE 데모 기본 사양 — 실제 상품 아님",
      price_min_krw: patternedMin,
      price_max_krw: patternedMax,
      vat_note: "SAMPLE 데모 VAT 표기 — 실제 세무 정보 아님",
      price_note: "SAMPLE 데모 전용 가격 — 실제 업체·시장 가격이 아닙니다",
      source_file: "SAMPLE-데모-증빙.png",
      source_quote: sourceQuote,
      source_object_keys: [evidenceKey],
      source_record_key: `sample-demo-price-${ordinal.toString().padStart(2, "0")}`,
      confidence: 1,
      options: [option],
      review: { action: "approve", expected_review_version: 0 },
    };
  });

  return {
    evidence: {
      bucket: "disclosure-raw",
      object_key: evidenceKey,
      source_file: "SAMPLE-데모-증빙.png",
      content_type: "image/png",
      bytes_base64: SAMPLE_EVIDENCE_BASE64,
    },
    agencies,
    vendors,
    snapshot: {
      id: snapshotId,
      period_label: "SAMPLE 데모 2026-07",
      source: "kca_tprice",
      source_url: null,
      source_note: "SAMPLE 데모 전용 스냅샷 — 실제 공시 자료가 아닙니다",
      collected_at: "2026-07-01",
    },
    prices,
    publication: {
      snapshot_id: snapshotId,
      method: "promote_price_snapshot",
    },
  };
}

function assertCanonicalPriceDemoFixture(fixture: PriceDemoFixture): void {
  if (JSON.stringify(fixture) !== JSON.stringify(buildPriceDemoFixture())) {
    throw new Error("price demo seed accepts only the canonical SAMPLE/데모 fixture");
  }
}

function assertCanonicalPriceDemoPrice(
  canonicalFixture: PriceDemoFixture,
  price: PriceDemoPrice,
): void {
  const canonical = canonicalFixture.prices.find((candidate) => candidate.id === price.id);
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(price)) {
    throw new Error("price demo seed accepts only canonical fixture price rows");
  }
}

export async function applyPriceDemoFixture(
  repository: PriceDemoSeedRepository,
  fixture: PriceDemoFixture,
  actorId: string,
): Promise<PriceDemoSeedResult> {
  assertCanonicalPriceDemoFixture(fixture);
  await repository.prepareFoundation(fixture, actorId);
  for (const price of fixture.prices) {
    const state = await repository.preparePrice(price, actorId);
    if (state === "pending") await repository.approvePrice(price, actorId);
  }
  await repository.promoteSnapshot(fixture.publication.snapshot_id, actorId);
  await repository.verifyPublishedFixture(fixture, actorId);
  return {
    snapshot_id: fixture.snapshot.id,
    agencies: fixture.agencies.length,
    vendors: fixture.vendors.length,
    prices: fixture.prices.length,
    options: fixture.prices.reduce((sum, price) => sum + price.options.length, 0),
    mandatory_options: fixture.prices.reduce(
      (sum, price) => sum + price.options.filter((option) => option.is_effectively_mandatory).length,
      0,
    ),
    published: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function databaseError(context: string, error: unknown): never {
  const code = isRecord(error) && typeof error.code === "string" ? error.code.slice(0, 40) : "unknown";
  throw new Error(`price demo seed ${context} failed (DB code: ${code})`);
}

function storageConflict(error: unknown): boolean {
  return isRecord(error) && (
    error.statusCode === "409"
    || error.status === 409
    || (typeof error.message === "string" && /already exists|duplicate/iu.test(error.message))
  );
}

function sameArray(actual: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

const PRICE_SELECT = [
  "id", "snapshot_id", "vendor_id", "agency_id", "category", "item_name",
  "base_spec", "price_min_krw", "price_max_krw", "vat_note", "price_note",
  "source_file", "source_quote", "source_object_keys", "source_record_key",
  "confidence", "review_status", "needs_review", "edited_by_admin",
  "review_version", "reviewed_by", "review_action",
].join(",");

const OPTION_SELECT = [
  "id", "official_price_id", "name", "price_min_krw", "price_max_krw",
  "unit", "condition", "raw_text", "source_file", "source_quote",
  "source_object_keys", "confidence", "is_effectively_mandatory", "ai_note", "sort_order",
].join(",");

function exactPriceContent(row: Record<string, unknown>, price: PriceDemoPrice): boolean {
  return row.id === price.id
    && row.snapshot_id === price.snapshot_id
    && row.vendor_id === price.vendor_id
    && row.agency_id === price.agency_id
    && row.category === price.category
    && row.item_name === price.item_name
    && row.base_spec === price.base_spec
    && row.price_min_krw === price.price_min_krw
    && row.price_max_krw === price.price_max_krw
    && row.vat_note === price.vat_note
    && row.price_note === price.price_note
    && row.source_file === price.source_file
    && row.source_quote === price.source_quote
    && sameArray(row.source_object_keys, price.source_object_keys)
    && row.source_record_key === price.source_record_key
    && row.confidence === price.confidence;
}

function exactOptionContent(row: Record<string, unknown>, option: PriceDemoOption): boolean {
  return row.id === option.id
    && row.official_price_id === option.official_price_id
    && row.name === option.name
    && row.price_min_krw === option.price_min_krw
    && row.price_max_krw === option.price_max_krw
    && row.unit === option.unit
    && row.condition === option.condition
    && row.raw_text === option.raw_text
    && row.source_file === option.source_file
    && row.source_quote === option.source_quote
    && sameArray(row.source_object_keys, option.source_object_keys)
    && row.confidence === option.confidence
    && row.is_effectively_mandatory === option.is_effectively_mandatory
    && row.ai_note === option.ai_note
    && row.sort_order === option.sort_order;
}

function exactAgencyContent(row: Record<string, unknown>, agency: PriceDemoAgency): boolean {
  return row.id === agency.id
    && row.name === agency.name
    && row.normalized_name === agency.normalized_name
    && sameArray(row.aliases, agency.aliases)
    && row.corporate_name === agency.corporate_name
    && row.region_code === agency.region_code
    && row.source_file === agency.source_file
    && row.slug === agency.slug
    && row.display_name === agency.display_name
    && row.homepage_url === agency.homepage_url
    && row.disclosure_url === agency.disclosure_url
    && row.is_active === agency.is_active
    && row.merged_into_agency_id === null;
}

function exactVendorContent(row: Record<string, unknown>, vendor: PriceDemoVendor): boolean {
  return row.id === vendor.id
    && row.owner_id === vendor.owner_id
    && row.name === vendor.name
    && row.slug === vendor.slug
    && row.category === vendor.category
    && row.location === vendor.location
    && row.region_code === vendor.region_code
    && sameArray(row.aliases, vendor.aliases)
    && row.status === vendor.status
    && JSON.stringify(row.attributes) === JSON.stringify(vendor.attributes)
    && row.enrichment_status === vendor.enrichment_status;
}

async function verifyFoundation(client: SupabaseClient, fixture: PriceDemoFixture): Promise<void> {
  const agencyRows = await client.from("agencies")
    .select("id,name,normalized_name,aliases,corporate_name,region_code,source_file,slug,display_name,homepage_url,disclosure_url,is_active,merged_into_agency_id")
    .in("id", fixture.agencies.map((row) => row.id));
  if (agencyRows.error) databaseError("agency verification", agencyRows.error);
  const vendorRows = await client.from("vendors")
    .select("id,owner_id,name,slug,category,location,region_code,aliases,status,attributes,enrichment_status")
    .in("id", fixture.vendors.map((row) => row.id));
  if (vendorRows.error) databaseError("vendor verification", vendorRows.error);
  if (
    !Array.isArray(agencyRows.data)
    || !agencyRows.data.every(isRecord)
    || agencyRows.data.length !== fixture.agencies.length
    || fixture.agencies.some((expected) =>
      !(agencyRows.data as unknown as Record<string, unknown>[])
        .some((stored) => exactAgencyContent(stored, expected))
    )
  ) {
    throw new Error("price demo seed agency fixture verification failed");
  }
  if (
    !Array.isArray(vendorRows.data)
    || !vendorRows.data.every(isRecord)
    || vendorRows.data.length !== fixture.vendors.length
    || fixture.vendors.some((expected) =>
      !(vendorRows.data as unknown as Record<string, unknown>[])
        .some((stored) => exactVendorContent(stored, expected))
    )
  ) {
    throw new Error("price demo seed vendor fixture verification failed");
  }
}

function pendingPriceInsert(price: PriceDemoPrice): Record<string, unknown> {
  const { options: _options, review: _review, ...content } = price;
  return {
    ...content,
    review_status: "pending",
    needs_review: true,
    validation_issue_codes: [],
    edited_by_admin: false,
  };
}

function optionInsert(option: PriceDemoOption): Record<string, unknown> {
  return { ...option };
}

async function readPrice(client: SupabaseClient, priceId: string): Promise<Record<string, unknown> | null> {
  const result = await client.from("official_prices").select(PRICE_SELECT).eq("id", priceId).maybeSingle();
  if (result.error) databaseError("price lookup", result.error);
  if (result.data === null) return null;
  if (!isRecord(result.data)) throw new Error("price demo seed received an invalid stored price");
  return result.data;
}

async function readOptions(client: SupabaseClient, priceId: string): Promise<Record<string, unknown>[]> {
  const result = await client.from("official_price_options")
    .select(OPTION_SELECT)
    .eq("official_price_id", priceId)
    .order("id", { ascending: true });
  if (result.error) databaseError("option lookup", result.error);
  if (!Array.isArray(result.data) || !result.data.every(isRecord)) {
    throw new Error("price demo seed received invalid stored options");
  }
  return result.data as unknown as Record<string, unknown>[];
}

async function prepareEvidence(client: SupabaseClient, fixture: PriceDemoFixture): Promise<void> {
  const bytes = Buffer.from(fixture.evidence.bytes_base64, "base64");
  const expectedObjectKey = `${createHash("sha256").update(bytes).digest("hex")}.png`;
  if (expectedObjectKey !== fixture.evidence.object_key) {
    throw new Error("price demo seed evidence digest does not match its immutable object key");
  }
  const bucket = client.storage.from(fixture.evidence.bucket);
  const uploaded = await bucket.upload(fixture.evidence.object_key, bytes, {
    contentType: fixture.evidence.content_type,
    upsert: false,
  });
  if (!uploaded.error) return;
  if (!storageConflict(uploaded.error)) databaseError("evidence upload", uploaded.error);
  const existing = await bucket.download(fixture.evidence.object_key);
  if (existing.error) databaseError("existing evidence verification", existing.error);
  if (!existing.data) throw new Error("price demo seed existing evidence is missing");
  const existingBytes = new Uint8Array(await existing.data.arrayBuffer());
  const existingHash = createHash("sha256").update(existingBytes).digest("hex");
  if (existingHash !== fixture.evidence.object_key.slice(0, 64)) {
    throw new Error("price demo seed existing evidence hash mismatch");
  }
}

function assertRepositoryEnvironment(environment: PriceDemoSeedEnvironment): void {
  assertDisclosureStagingProjectRef(environment.projectRef);
  assertServiceRoleKey(environment.key);
  const parsed = parseEnvironmentUrl(environment.url, "SUPABASE_URL");
  if (environment.target === "local") {
    if (environment.projectRef !== "local" || !new Set(["localhost", "127.0.0.1", "[::1]"]).has(parsed.hostname)) {
      throw new Error("price demo seed repository refuses a non-local local destination");
    }
  } else if (
    parsed.protocol !== "https:"
    || parsed.port !== ""
    || parsed.pathname !== "/"
    || parsed.hostname !== `${environment.projectRef}.supabase.co`
  ) {
    throw new Error("price demo seed repository refuses an invalid staging destination");
  }
}

export function createSupabasePriceDemoSeedRepository(
  environment: PriceDemoSeedEnvironment,
  providedClient?: SupabaseClient,
): PriceDemoSeedRepository {
  assertRepositoryEnvironment(environment);
  const canonicalFixture = buildPriceDemoFixture();
  const client = providedClient ?? createClient(environment.url, environment.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    prepareFoundation: async (fixture, actorId) => {
      assertCanonicalPriceDemoFixture(fixture);
      if (actorId !== environment.actorId) {
        throw new Error("price demo seed actor does not match the confirmed environment actor");
      }
      await prepareEvidence(client, fixture);
      const agencies = await client.from("agencies").upsert(fixture.agencies, { onConflict: "id" });
      if (agencies.error) databaseError("agency upsert", agencies.error);
      const vendors = await client.from("vendors").upsert(fixture.vendors, { onConflict: "id" });
      if (vendors.error) databaseError("vendor upsert", vendors.error);
      const snapshot = await client.from("price_snapshots").upsert(fixture.snapshot, { onConflict: "id" });
      if (snapshot.error) databaseError("draft snapshot upsert", snapshot.error);
      await verifyFoundation(client, fixture);
    },

    preparePrice: async (price, actorId) => {
      assertCanonicalPriceDemoPrice(canonicalFixture, price);
      if (actorId !== environment.actorId) {
        throw new Error("price demo seed actor does not match the confirmed environment actor");
      }
      let stored = await readPrice(client, price.id);
      if (!stored) {
        const inserted = await client.from("official_prices").insert(pendingPriceInsert(price));
        if (inserted.error) databaseError("pending price insert", inserted.error);
        stored = await readPrice(client, price.id);
      }
      if (!stored || !exactPriceContent(stored, price)) {
        throw new Error(`price demo seed immutable price content mismatch: ${price.id}`);
      }
      const status = stored.review_status;
      if (status === "pending") {
        if (stored.needs_review !== true || stored.edited_by_admin !== false || stored.review_version !== 0) {
          throw new Error(`price demo seed pending price is not a virgin replay: ${price.id}`);
        }
      } else if (status === "approved") {
        if (
          stored.needs_review !== false
          || stored.review_version !== 1
          || stored.reviewed_by !== actorId
          || stored.review_action !== "approve"
        ) {
          throw new Error(`price demo seed approved price review identity mismatch: ${price.id}`);
        }
      } else {
        throw new Error(`price demo seed refuses a rejected or unknown price state: ${price.id}`);
      }

      const storedOptions = await readOptions(client, price.id);
      const expectedById = new Map(price.options.map((option) => [option.id, option]));
      if (storedOptions.some((option) => {
        const expected = typeof option.id === "string" ? expectedById.get(option.id) : undefined;
        return !expected || !exactOptionContent(option, expected);
      })) {
        throw new Error(`price demo seed immutable option content mismatch: ${price.id}`);
      }
      const storedIds = new Set(storedOptions.map((option) => option.id));
      const missing = price.options.filter((option) => !storedIds.has(option.id));
      if (status === "approved" && missing.length > 0) {
        throw new Error(`price demo seed approved option set is incomplete: ${price.id}`);
      }
      if (status === "pending" && missing.length > 0) {
        const inserted = await client.from("official_price_options").insert(missing.map(optionInsert));
        if (inserted.error) databaseError("pending option insert", inserted.error);
      }
      return status;
    },

    approvePrice: async (price, actorId) => {
      assertCanonicalPriceDemoPrice(canonicalFixture, price);
      if (actorId !== environment.actorId) {
        throw new Error("price demo seed actor does not match the confirmed environment actor");
      }
      const values = {
        category: price.category,
        item_name: price.item_name,
        base_spec: price.base_spec,
        price_min_krw: price.price_min_krw,
        price_max_krw: price.price_max_krw,
        vat_note: price.vat_note,
        price_note: price.price_note,
        source_quote: price.source_quote,
        confidence: price.confidence,
      };
      const options = price.options.map((option) => ({
        id: option.id,
        name: option.name,
        price_min_krw: option.price_min_krw,
        price_max_krw: option.price_max_krw,
        unit: option.unit,
        condition: option.condition,
        raw_text: option.raw_text,
        source_quote: option.source_quote,
        confidence: option.confidence,
      }));
      const result = await client.rpc("review_official_price_with_alias_proposals", {
        p_price_id: price.id,
        p_actor_id: actorId,
        p_action: price.review.action,
        p_values: values,
        p_options: options,
        p_selected_proposal_ids: [],
        p_expected_review_version: price.review.expected_review_version,
      });
      if (result.error) databaseError("price approval RPC", result.error);
    },

    promoteSnapshot: async (snapshotId, actorId) => {
      if (snapshotId !== canonicalFixture.snapshot.id) {
        throw new Error("price demo seed refuses a non-canonical fixture snapshot");
      }
      if (actorId !== environment.actorId) {
        throw new Error("price demo seed actor does not match the confirmed environment actor");
      }
      const result = await client.rpc("promote_price_snapshot", {
        p_snapshot_id: snapshotId,
        p_actor_id: actorId,
      });
      if (result.error) databaseError("snapshot promotion RPC", result.error);
    },

    verifyPublishedFixture: async (fixture, actorId) => {
      assertCanonicalPriceDemoFixture(fixture);
      if (actorId !== environment.actorId) {
        throw new Error("price demo seed actor does not match the confirmed environment actor");
      }
      const snapshot = await client.from("price_snapshots")
        .select("id,period_label,source,source_note,collected_at,is_current,published")
        .eq("id", fixture.snapshot.id)
        .maybeSingle();
      if (snapshot.error) databaseError("published snapshot verification", snapshot.error);
      if (
        !isRecord(snapshot.data)
        || snapshot.data.id !== fixture.snapshot.id
        || snapshot.data.period_label !== fixture.snapshot.period_label
        || snapshot.data.source !== fixture.snapshot.source
        || snapshot.data.source_note !== fixture.snapshot.source_note
        || snapshot.data.collected_at !== fixture.snapshot.collected_at
        || snapshot.data.is_current !== true
        || snapshot.data.published !== true
      ) {
        throw new Error("price demo seed snapshot did not become the exact current published fixture");
      }

      await verifyFoundation(client, fixture);
      for (const price of fixture.prices) {
        const stored = await readPrice(client, price.id);
        if (
          !stored
          || !exactPriceContent(stored, price)
          || stored.review_status !== "approved"
          || stored.needs_review !== false
          || stored.review_version !== 1
          || stored.reviewed_by !== actorId
          || stored.review_action !== "approve"
        ) {
          throw new Error(`price demo seed published price verification failed: ${price.id}`);
        }
        const options = await readOptions(client, price.id);
        if (
          options.length !== price.options.length
          || options.some((row) => {
            const expected = typeof row.id === "string" ? price.options.find((option) => option.id === row.id) : undefined;
            return !expected || !exactOptionContent(row, expected);
          })
        ) {
          throw new Error(`price demo seed published option verification failed: ${price.id}`);
        }
      }
    },
  };
}

export async function runPriceDemoSeed(env: NodeJS.ProcessEnv = process.env): Promise<PriceDemoSeedResult> {
  const environment = assertPriceDemoSeedEnvironment(env);
  const repository = createSupabasePriceDemoSeedRepository(environment);
  return applyPriceDemoFixture(repository, buildPriceDemoFixture(), environment.actorId);
}

const invokedFilename = process.argv[1] ? path.basename(process.argv[1]).toLocaleLowerCase("en-US") : "";
if (invokedFilename === "price-demo-seed.ts" || invokedFilename === "price-demo-seed.js") {
  runPriceDemoSeed().then(
    (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown price demo seed error";
      process.stderr.write(`price demo seed failed: ${message}\n`);
      process.exitCode = 1;
    },
  );
}
