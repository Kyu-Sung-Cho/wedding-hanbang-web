import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalVendorName,
  isSameNameDifferentBusiness,
  verifiedVendorIdentitySlugs,
  vendorIdentityKey,
  vendorIdentityLikePattern,
} from "@/lib/price/vendorIdentity";
import type { PriceCategory } from "@/lib/price/catalog";
import {
  sanitizePublicVendorAttributes,
  vendorAttributeCategoryFromDb,
} from "./attributeSchemas";

type PublicVendorProjection = {
  id: string;
  slug: string;
  name: string;
  category: string;
  region_code: string | null;
  aliases: unknown;
  official_url: string | null;
  instagram_url: string | null;
  naver_place_url: string | null;
  attributes: unknown;
  tags: unknown;
};

type PublicPriceProjection = {
  id: string;
  period_label: string;
  price_category: string;
  region_code: string | null;
  item_name: string;
  base_spec: string | null;
  price_min_krw: number | null;
  price_max_krw: number | null;
  vat_note: string | null;
  price_note: string | null;
  source_label: string;
  agency_id?: string | null;
  agency_slug?: string | null;
  agency_display_name?: string | null;
  is_current?: boolean;
  published_at?: string | null;
};

type PublicOptionProjection = {
  id: string;
  official_price_id: string;
  name: string;
  price_min_krw: number | null;
  price_max_krw: number | null;
  unit: string | null;
  condition: string | null;
  raw_text: string;
  is_effectively_mandatory?: boolean;
  sort_order?: number;
};

type RelationPage<T> = { data: T[] | null; error: unknown };

const PUBLIC_RELATION_PAGE_SIZE = 200;
const PUBLIC_PRICE_CAP = 2_000;
const PUBLIC_OPTION_CAP = 5_000;
const OPTION_ID_CHUNK_SIZE = 50;

export async function collectPublicVendorRelationChunks<T>(
  idChunks: string[][],
  fetchPage: (
    ids: string[],
    from: number,
    to: number,
  ) => Promise<RelationPage<T>>,
  options: {
    maxRows: number;
    limitError: string;
    unavailableError?: string;
    pageSize?: number;
  },
): Promise<T[]> {
  const pageSize = options.pageSize ?? PUBLIC_RELATION_PAGE_SIZE;
  if (
    !Number.isSafeInteger(options.maxRows)
    || options.maxRows < 1
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
  ) {
    throw new Error(options.limitError);
  }

  const rows: T[] = [];
  for (const ids of idChunks) {
    if (ids.length === 0) continue;
    let from = 0;
    while (true) {
      const remaining = options.maxRows - rows.length;
      const requested = remaining > 0 ? Math.min(pageSize, remaining) : 1;
      const page = await fetchPage(ids, from, from + requested - 1);
      if (page.error) {
        throw new Error(options.unavailableError ?? "PUBLIC_VENDOR_PRICE_UNAVAILABLE");
      }
      const pageRows = page.data ?? [];
      if (remaining === 0) {
        if (pageRows.length > 0) throw new Error(options.limitError);
        break;
      }
      if (pageRows.length > requested) throw new Error(options.limitError);
      if (pageRows.length === 0) break;
      rows.push(...pageRows);
      from += pageRows.length;
    }
  }
  return rows;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !isPlainObject(entry)
      || typeof entry.slug !== "string"
      || typeof entry.label !== "string"
    ) {
      return [];
    }
    return [{
      slug: entry.slug,
      label: entry.label,
      group: typeof entry.group === "string" ? entry.group : null,
    }];
  }).sort((left, right) =>
    left.label.localeCompare(right.label, "ko-KR")
    || left.slug.localeCompare(right.slug)
  );
}

function safeAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((alias): alias is string => (
    typeof alias === "string" && alias.trim().length > 0 && alias.length <= 160
  )).map((alias) => alias.trim()))].slice(0, 20);
}

function consumerCategory(category: string): string {
  return category === "venue" ? "hall" : category;
}

function isPriceCategory(category: string): category is PriceCategory {
  return category === "studio"
    || category === "dress"
    || category === "makeup"
    || category === "hall";
}

function nullableMoneyOrder(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function comparePrices(
  left: PublicPriceProjection,
  right: PublicPriceProjection,
): number {
  return Number(right.is_current === true) - Number(left.is_current === true)
    || right.period_label.localeCompare(left.period_label)
    || nullableMoneyOrder(left.price_min_krw, right.price_min_krw)
    || left.item_name.localeCompare(right.item_name, "ko-KR")
    || left.id.localeCompare(right.id);
}

function compareOptions(
  left: PublicOptionProjection,
  right: PublicOptionProjection,
): number {
  return nullableMoneyOrder(left.price_min_krw, right.price_min_krw)
    || left.name.localeCompare(right.name, "ko-KR")
    || left.id.localeCompare(right.id);
}

export type VendorIdentityRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  region_code: string | null;
  aliases?: unknown;
};

/** 상세 페이지가 훑을 형제 후보 상한. 실측 최대 151(이름이 "스튜디오"인 1곳). */
const IDENTITY_CANDIDATE_CAP = 200;

/**
 * 같은 샵인데 대행사 지역 때문에 vendors 행이 갈린 형제들을 찾는다.
 *
 * 목록 카드는 이미 (카테고리 + 정규화 이름)으로 한 장에 묶는데 상세는 슬러그
 * 하나만 봤다. 그래서 "카드엔 대행사 4곳인데 눌러 보니 1곳"이 됐다
 * (2026-07-26 실측: 157그룹 · 형제 185행이 상세에서 통째로 빠짐).
 *
 * 정규화가 공백·구두점을 지우는 것을 SQL에서 흉내낼 수 없어, 글자 사이에 %를
 * 끼운 ILIKE로 후보만 넓게 긁고 최종 판정은 목록과 같은 함수로 한다.
 * 조회가 실패하면 자기 자신만 반환한다 — 상세 페이지가 죽는 것보다 낫다.
 */
export async function loadVendorIdentityRows(
  client: SupabaseClient,
  vendor: PublicVendorProjection,
): Promise<VendorIdentityRow[]> {
  const self: VendorIdentityRow = {
    id: vendor.id,
    slug: vendor.slug,
    name: vendor.name,
    category: vendor.category,
    region_code: vendor.region_code,
    aliases: vendor.aliases,
  };
  const consumer = consumerCategory(vendor.category);
  if (!isPriceCategory(consumer)) return [self];
  // 표기만 다른 같은 업체("가을" ↔ "가을스튜디오")까지 흡수한 대표 이름으로 본다.
  // 목록(`vendorIdentityKey`)과 같은 함수를 써야 판정이 갈리지 않는다.
  const normalized = canonicalVendorName(consumer, vendor.name);
  const verifiedSlugs = verifiedVendorIdentitySlugs(consumer, vendor.slug);
  // 이름만 같고 실제로는 다른 업체는 목록에서도 분리하므로 형제를 찾지 않는다.
  // 단, 공개 채널이 같은 것으로 행 단위 확인된 slug 묶음은 그 범위 안에서만 모은다.
  if (
    !normalized
    || (isSameNameDifferentBusiness(consumer, normalized) && !verifiedSlugs)
  ) {
    return [self];
  }
  const pattern = verifiedSlugs
    ? null
    : vendorIdentityLikePattern(vendor.name, consumer);
  if (!verifiedSlugs && !pattern) return [self];
  const selfIdentity = vendorIdentityKey(consumer, vendor.name, vendor.slug);

  try {
    const candidates = client
      .from("v_public_vendors")
      .select("id, slug, name, category, region_code, aliases")
      .eq("category", vendor.category);
    const scopedCandidates = verifiedSlugs
      ? candidates.in("slug", [...verifiedSlugs])
      : pattern
        ? candidates.ilike("name", pattern)
        : candidates;
    const { data, error } = await scopedCandidates
      .order("slug", { ascending: true })
      .limit(IDENTITY_CANDIDATE_CAP);
    if (error || !Array.isArray(data)) {
      // self만 돌려주면 상세가 형제를 못 보고, 목록 카드에는 대행사 4곳인데 눌러
      // 보면 1곳인 상태로 되돌아간다(`e7dd16bf`가 고친 사고, 실측 157그룹 누락).
      // 빌드는 통과하면서 내용만 얇아지므로 로그가 유일한 신호다.
      reportIdentityLoadFailure(error ?? new Error("v_public_vendors returned no array"));
      return [self];
    }
    const rows = (data as VendorIdentityRow[]).filter((row) => {
      if (
        typeof row?.id !== "string"
        || typeof row?.slug !== "string"
        || typeof row?.name !== "string"
      ) {
        return false;
      }
      const rowCategory = consumerCategory(row.category);
      return isPriceCategory(rowCategory)
        && vendorIdentityKey(rowCategory, row.name, row.slug) === selfIdentity;
    });
    if (!rows.some((row) => row.slug === vendor.slug)) rows.push(self);
    return rows.sort((left, right) => left.slug.localeCompare(right.slug));
  } catch (err) {
    reportIdentityLoadFailure(err);
    return [self];
  }
}

function reportIdentityLoadFailure(cause: unknown): void {
  console.error("[vendor-identity] 형제 업체 조회 실패 — 상세가 병합 전 상태로 얇아진다:", cause);
}

export type VendorIdentitySummary = {
  vendorIds: string[];
  slugs: string[];
  regionCodes: string[];
  /**
   * 같은 묶음의 대표 URL. 형제 슬러그마다 같은 내용이 뜨면 검색엔진에는 중복
   * 문서가 된다(실측 185개). 목록 카드도 이 규칙으로 링크를 만든다.
   */
  canonicalSlug: string;
  /**
   * 같은 묶음의 대표 업체 id — 찜·가격알림·analytics의 저장 키다.
   *
   * 목록 카드는 병합할 때 슬러그가 더 작은 형제로 slug와 id를 **함께** 교체한다
   * (`publicListData.ts`). 상세가 방문한 슬러그의 id를 쓰면 같은 샵이 서로 다른
   * id로 두 번 찜되고, 목록에서 찜한 샵을 형제 주소로 열면 찜이 안 된 것으로
   * 보인다. 그래서 대표 슬러그와 같은 형제의 id로 고정한다.
   */
  canonicalVendorId: string;
};

function effectiveIdentityRows(
  vendor: PublicVendorProjection,
  identityRows?: VendorIdentityRow[],
): VendorIdentityRow[] {
  const rows = identityRows && identityRows.length > 0
    ? identityRows
    : [{
        id: vendor.id,
        slug: vendor.slug,
        name: vendor.name,
        category: vendor.category,
        region_code: vendor.region_code,
        aliases: vendor.aliases,
      }];
  return [...rows].sort((left, right) => (
    left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0
  ));
}

function identitySummary(
  vendor: PublicVendorProjection,
  identityRows?: VendorIdentityRow[],
): VendorIdentitySummary {
  const rows = effectiveIdentityRows(vendor, identityRows);
  const slugs = [...new Set(rows.map(({ slug }) => slug))];
  // 목록의 병합 규칙(`row.vendor_slug < existing.slug`)과 같은 코드유닛 순서로
  // 비교해야 대표가 갈리지 않는다 — localeCompare로 바꾸면 어긋난다.
  const canonicalSlug = [...slugs].sort()[0] ?? vendor.slug;
  return {
    vendorIds: [...new Set(rows.map(({ id }) => id))],
    slugs,
    regionCodes: [...new Set(rows.flatMap(({ region_code }) => (region_code ? [region_code] : [])))],
    canonicalSlug,
    // 대표 슬러그와 같은 형제의 id. 슬러그를 못 찾으면(형제 조회 실패 등)
    // 방문한 업체 자신으로 떨어진다.
    canonicalVendorId: rows.find(({ slug }) => slug === canonicalSlug)?.id ?? vendor.id,
  };
}

export function assemblePublicVendorPriceProfile(
  vendor: PublicVendorProjection,
  prices: PublicPriceProjection[],
  options: PublicOptionProjection[],
  identityRows?: VendorIdentityRow[],
) {
  const attributeCategory = vendorAttributeCategoryFromDb(vendor.category);
  const profileIdentityRows = effectiveIdentityRows(vendor, identityRows);
  const identity = identitySummary(vendor, profileIdentityRows);
  const canonicalVendor = profileIdentityRows.find(({ slug }) => (
    slug === identity.canonicalSlug
  )) ?? profileIdentityRows[0];
  const representativeName = canonicalVendor?.name ?? vendor.name;
  const mergedAliases = new Set<string>();
  for (const row of profileIdentityRows) {
    const siblingName = row.name.trim();
    if (siblingName) mergedAliases.add(siblingName);
    for (const alias of safeAliases(row.aliases)) mergedAliases.add(alias);
  }
  for (const alias of safeAliases(vendor.aliases)) mergedAliases.add(alias);
  mergedAliases.delete(representativeName.trim());
  const orderedPrices = [...prices].sort(comparePrices);
  const orderedOptions = [...options].sort(compareOptions);
  const optionsByPriceId = new Map<string, PublicOptionProjection[]>();
  for (const option of orderedOptions) {
    const priceOptions = optionsByPriceId.get(option.official_price_id) ?? [];
    priceOptions.push(option);
    optionsByPriceId.set(option.official_price_id, priceOptions);
  }
  const sources = [...new Set(orderedPrices.map(({ source_label }) => source_label))];
  return {
    vendor: {
      id: vendor.id,
      slug: vendor.slug,
      name: representativeName,
      category: consumerCategory(vendor.category),
      region_code: vendor.region_code,
      aliases: [...mergedAliases].slice(0, 50),
      urls: {
        official: vendor.official_url,
        instagram: vendor.instagram_url,
        naver_place: vendor.naver_place_url,
      },
    },
    // 같은 샵이 대행사 지역 때문에 여러 행으로 갈려 있어도 상세는 한 곳으로 본다.
    identity,
    attributes: attributeCategory
      ? sanitizePublicVendorAttributes(attributeCategory, vendor.attributes)
      : {},
    tags: safeTags(vendor.tags),
    prices: orderedPrices.map((price) => ({
      id: price.id,
      period_label: price.period_label,
      category: consumerCategory(price.price_category),
      region_code: price.region_code,
      item_name: price.item_name,
      base_spec: price.base_spec,
      price_min_krw: price.price_min_krw,
      price_max_krw: price.price_max_krw,
      vat_note: price.vat_note,
      price_note: price.price_note,
      source: price.source_label,
      is_current: price.is_current === true,
      published_at: price.published_at ?? null,
      agency: price.agency_id ? {
        id: price.agency_id,
        slug: price.agency_slug ?? null,
        name: price.agency_display_name ?? null,
      } : null,
      options: (optionsByPriceId.get(price.id) ?? []).map((option) => ({
        id: option.id,
        official_price_id: option.official_price_id,
        name: option.name,
        price_min_krw: option.price_min_krw,
        price_max_krw: option.price_max_krw,
        unit: option.unit,
        condition: option.condition,
        raw_text: option.raw_text,
        is_effectively_mandatory: option.is_effectively_mandatory === true,
        sort_order: Number.isInteger(option.sort_order) ? option.sort_order : 0,
      })),
    })),
    sources,
    disclaimer: "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.",
  };
}

export async function loadPublicVendorPriceProfile(
  client: SupabaseClient,
  slug: string,
) {
  const { data: vendorData, error: vendorError } = await client
    .from("v_public_vendors")
    .select(
      "id, slug, name, category, region_code, aliases, official_url, instagram_url, naver_place_url, attributes, tags",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (vendorError) throw new Error("PUBLIC_VENDOR_PRICE_UNAVAILABLE");
  if (!vendorData) return null;

  const identityRows = await loadVendorIdentityRows(
    client,
    vendorData as PublicVendorProjection,
  );

  const prices = await collectPublicVendorRelationChunks<PublicPriceProjection>(
    chunks(identityRows.map(({ slug: identitySlug }) => identitySlug), OPTION_ID_CHUNK_SIZE),
    async (vendorSlugs, from, to) => {
      const result = await client
        .from("v_public_official_prices")
        .select(
          "id, period_label, price_category, region_code, item_name, base_spec, price_min_krw, price_max_krw, vat_note, price_note, source_label, agency_id, agency_slug, agency_display_name, is_current, published_at",
        )
        .in("vendor_slug", vendorSlugs)
        .eq("source", "kca_tprice")
        .order("period_label", { ascending: false })
        .order("price_min_krw", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to);
      return {
        data: (result.data ?? null) as PublicPriceProjection[] | null,
        error: result.error,
      };
    },
    {
      maxRows: PUBLIC_PRICE_CAP,
      limitError: "PUBLIC_VENDOR_PRICE_LIMIT",
    },
  );
  const priceIds = prices.map(({ id }) => id);
  let options: PublicOptionProjection[] = [];
  if (priceIds.length > 0) {
    options = await collectPublicVendorRelationChunks<PublicOptionProjection>(
      chunks(priceIds, OPTION_ID_CHUNK_SIZE),
      async (ids, from, to) => {
        const result = await client
          .from("v_public_official_price_options")
          .select(
            "id, official_price_id, name, price_min_krw, price_max_krw, unit, condition, raw_text, is_effectively_mandatory, sort_order",
          )
          .in("official_price_id", ids)
          .order("official_price_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        return {
          data: (result.data ?? null) as PublicOptionProjection[] | null,
          error: result.error,
        };
      },
      {
        maxRows: PUBLIC_OPTION_CAP,
        limitError: "PUBLIC_VENDOR_OPTION_LIMIT",
      },
    );
  }
  return assemblePublicVendorPriceProfile(
    vendorData as PublicVendorProjection,
    prices,
    options,
    identityRows,
  );
}

export type PublicVendorPolicy = {
  id: string;
  semanticType: string;
  title: string | null;
  contentVerbatim: string;
  sourceAgency: string | null;
};

const POLICY_CAP = 80;

// 계약 직전에 급한 순서. 알파벳순(change → other → penalty → refund)으로 두면
// 정작 위약금이 맨 뒤로 밀린다.
const POLICY_TYPE_RANK: Record<string, number> = {
  penalty: 0,
  refund: 1,
  refund_policy: 1,
  change: 2,
};

function policyTypeRank(semanticType: string): number {
  return POLICY_TYPE_RANK[semanticType] ?? 3;
}

/**
 * 업체의 위약금·환불·계약 조건 원문.
 *
 * 공시 원본에는 업체별 위약금이 들어 있고 적재도 끝나 있었지만 공개 경로가 없어
 * 화면에는 추가금만 보이고 위약금은 빠져 있었다 — 계약 직전에 가장 알고 싶은
 * 정보다. v_public_vendor_policies는 발행 스냅샷의 검수 통과분만 원문 그대로
 * 노출한다(요약·해석은 판정이 되므로 담지 않는다).
 *
 * 뷰가 아직 적용되지 않은 환경에서도 상세 페이지 전체가 죽지 않도록, 조회
 * 실패는 빈 목록으로 흘린다 — 위약금은 부가 정보이고 가격이 본문이다.
 */
/**
 * 위약금 원문은 이 제품이 가진 가장 강한 사실이다. 그게 조용히 사라지면 유통 글이
 * 약속한 것과 도착 화면이 어긋난다(2026-07-26 `c019c68c`가 고친 바로 그 사고 유형).
 * 검색 가능한 접두어로 남겨 Vercel 함수 로그에서 바로 잡을 수 있게 한다.
 */
function reportPolicyLoadFailure(cause: unknown): void {
  console.error("[vendor-policies] 위약금 공개 조회 실패 — 상세 화면에서 섹션이 사라진다:", cause);
}

export async function loadPublicVendorPolicies(
  client: SupabaseClient,
  vendorIds: string[],
): Promise<PublicVendorPolicy[]> {
  const ids = [...new Set(vendorIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return [];
  try {
    const { data, error } = await client
      .from("v_public_vendor_policies")
      .select("id, semantic_type, title, content_verbatim, source_agency")
      .in("vendor_id", ids)
      .order("semantic_type", { ascending: true })
      .order("id", { ascending: true })
      .limit(POLICY_CAP);
    if (error || !Array.isArray(data)) {
      // 페이지는 `policies.length > 0`일 때만 섹션을 렌더한다. 즉 뷰가 드롭되거나
      // GRANT가 회수되면 위약금 831건이 **아무 에러 없이** 화면에서 사라진다.
      // 가격은 계속 보이므로 눈으로는 알아채기 어렵다 — 로그로 남긴다.
      // 정기 확인은 `pnpm audit:production`(공개 뷰 anon 200 + 행수)이 담당한다.
      reportPolicyLoadFailure(error ?? new Error("v_public_vendor_policies returned no array"));
      return [];
    }
    // 대행사가 여러 곳이면 같은 약관이 그대로 반복된다. 화면에서는 같은 문장을
    // 두 번 읽게 하지 않는다(공백 차이만 다른 것도 같은 문장으로 본다).
    const seen = new Set<string>();
    const policies = data.flatMap((row) => {
      const content = typeof row.content_verbatim === "string" ? row.content_verbatim.trim() : "";
      if (!content || typeof row.id !== "string") return [];
      const semanticType = typeof row.semantic_type === "string" ? row.semantic_type : "other";
      const fingerprint = `${semanticType}|${content.replace(/\s+/g, " ")}`;
      if (seen.has(fingerprint)) return [];
      seen.add(fingerprint);
      return [{
        id: row.id,
        semanticType,
        title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : null,
        contentVerbatim: content,
        sourceAgency: typeof row.source_agency === "string" && row.source_agency.trim()
          ? row.source_agency.trim()
          : null,
      }];
    });
    return policies.sort((left, right) =>
      policyTypeRank(left.semanticType) - policyTypeRank(right.semanticType)
      || left.id.localeCompare(right.id));
  } catch (err) {
    reportPolicyLoadFailure(err);
    return [];
  }
}
