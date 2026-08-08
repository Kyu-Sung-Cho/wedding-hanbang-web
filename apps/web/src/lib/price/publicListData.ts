import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PRICE_CATEGORIES,
  type PriceCatalog,
  type PriceCategory,
  type PriceOffer,
  type PriceOption,
  type PriceVendor,
} from "./catalog";
import { vendorDisplayName } from "./vendorDisplayName";
import { vendorIdentityKey, vendorRegionCodeOverride } from "./vendorIdentity";

type PublicPriceRow = {
  id: string;
  period_label: string;
  vendor_id: string;
  vendor_slug: string;
  vendor_name: string;
  vendor_aliases: unknown;
  vendor_category: string;
  region_code: string | null;
  agency_id: string | null;
  agency_name: string | null;
  agency_display_name: string | null;
  price_category: string;
  item_name: string;
  base_spec: string | null;
  price_min_krw: number | null;
  price_max_krw: number | null;
  price_note: string | null;
  vat_note: string | null;
};

export type PublicOptionRow = {
  id: string;
  official_price_id: string;
  name: string;
  price_min_krw: number | null;
  price_max_krw: number | null;
  unit: string | null;
  condition: string | null;
  raw_text: string;
  is_effectively_mandatory: boolean | null;
  sort_order: number | null;
};

const PAGE_SIZE = 200;
const PRICE_LIMIT = 5_000;
const OPTION_LIMIT = 20_000;
const OPTION_CHUNK_SIZE = 50;

type Page<T> = { data: T[] | null; error: unknown };

// 정적 생성이 다수 워커로 동시에 돌 때 PostgREST가 순간 포화될 수 있다.
// 페이지 조회는 짧은 백오프로 재시도하고, 소진되면 기존대로 fail-closed.
const PAGE_FETCH_ATTEMPTS = 4;
const PAGE_FETCH_BACKOFF_MS = 400;

async function fetchPageWithRetry<T>(
  fetchPage: (from: number, to: number) => Promise<Page<T>>,
  from: number,
  to: number,
): Promise<Page<T>> {
  let page: Page<T> = { data: null, error: new Error("unreachable") };
  for (let attempt = 1; attempt <= PAGE_FETCH_ATTEMPTS; attempt += 1) {
    page = await fetchPage(from, to);
    if (!page.error) return page;
    if (attempt < PAGE_FETCH_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, PAGE_FETCH_BACKOFF_MS * 3 ** (attempt - 1)),
      );
    }
  }
  return page;
}

async function collectPages<T>(
  fetchPage: (from: number, to: number) => Promise<Page<T>>,
  maximumRows: number,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const remaining = maximumRows - rows.length;
    const requested = remaining > 0 ? Math.min(PAGE_SIZE, remaining) : 1;
    const page = await fetchPageWithRetry(fetchPage, from, from + requested - 1);
    if (page.error) throw new Error("PUBLIC_PRICE_CATALOG_UNAVAILABLE");
    const pageRows = page.data ?? [];
    if (remaining === 0) {
      if (pageRows.length > 0) throw new Error("PUBLIC_PRICE_CATALOG_LIMIT");
      break;
    }
    if (pageRows.length > requested) throw new Error("PUBLIC_PRICE_CATALOG_LIMIT");
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
    from += pageRows.length;
  }
  return rows;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function category(value: string): PriceCategory | null {
  if (value === "venue") return "hall";
  return PRICE_CATEGORIES.includes(value as PriceCategory) ? value as PriceCategory : null;
}

function money(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function aliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((alias) => (
    typeof alias === "string" && alias.trim() ? [alias.trim().slice(0, 300)] : []
  )))].slice(0, 50);
}

export function optionFromRow(row: PublicOptionRow): PriceOption | null {
  if (!row.id || !row.official_price_id || !row.name || !row.raw_text) return null;
  return {
    id: row.id,
    name: row.name,
    minimumKrw: money(row.price_min_krw),
    maximumKrw: money(row.price_max_krw),
    unit: row.unit,
    condition: row.condition,
    rawText: row.raw_text,
    isEffectivelyMandatory: row.is_effectively_mandatory === true,
    sortOrder: Number.isSafeInteger(row.sort_order) && (row.sort_order ?? -1) >= 0
      ? row.sort_order!
      : Number.MAX_SAFE_INTEGER,
  };
}

export async function loadPublicPriceCatalog(
  client: SupabaseClient,
  options?: { optionCategories?: readonly PriceCategory[] },
): Promise<PriceCatalog> {
  const priceRows = await collectPages<PublicPriceRow>(async (from, to) => {
    const result = await client
      .from("v_public_official_prices")
      .select(
        "id, period_label, vendor_id, vendor_slug, vendor_name, vendor_aliases, vendor_category, region_code, agency_id, agency_name, agency_display_name, price_category, item_name, base_spec, price_min_krw, price_max_krw, price_note, vat_note",
      )
      .eq("source", "kca_tprice")
      .eq("is_current", true)
      .not("vendor_id", "is", null)
      .order("period_label", { ascending: false })
      .order("vendor_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return {
      data: (result.data ?? null) as PublicPriceRow[] | null,
      error: result.error,
    };
  }, PRICE_LIMIT);

  const optionCategories = options?.optionCategories
    ? new Set(options.optionCategories)
    : null;
  const priceIds = priceRows.flatMap((row) => {
    const priceCategory = category(row.price_category);
    return row.id && priceCategory && (!optionCategories || optionCategories.has(priceCategory))
      ? [row.id]
      : [];
  });
  const optionRows: PublicOptionRow[] = [];
  for (const ids of chunks(priceIds, OPTION_CHUNK_SIZE)) {
    const remaining = OPTION_LIMIT - optionRows.length;
    if (remaining <= 0) throw new Error("PUBLIC_PRICE_CATALOG_LIMIT");
    const rows = await collectPages<PublicOptionRow>(async (from, to) => {
      const result = await client
        .from("v_public_official_price_options")
        .select(
          "id, official_price_id, name, price_min_krw, price_max_krw, unit, condition, raw_text, is_effectively_mandatory, sort_order",
        )
        .in("official_price_id", ids)
        .order("official_price_id", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return {
        data: (result.data ?? null) as PublicOptionRow[] | null,
        error: result.error,
      };
    }, remaining);
    optionRows.push(...rows);
  }

  const optionsByPrice = new Map<string, PriceOption[]>();
  for (const row of optionRows) {
    const option = optionFromRow(row);
    if (!option) continue;
    const values = optionsByPrice.get(row.official_price_id) ?? [];
    values.push(option);
    optionsByPrice.set(row.official_price_id, values);
  }

  const vendorsById = new Map<string, PriceVendor>();
  // 병합 키는 vendor_id가 아니라 (카테고리 + 정규화 이름)이다 — 아래
  // vendorIdentityKey 주석 참고.
  const agencyNames = new Map<string, string>();
  const periods = new Set<string>();
  for (const row of priceRows) {
    const priceCategory = category(row.price_category);
    if (!priceCategory || !row.id || !row.vendor_id || !row.vendor_slug || !row.vendor_name) continue;
    periods.add(row.period_label);
    const agencyLabel = row.agency_display_name?.trim() || row.agency_name?.trim() || "업체 직접 공시";
    if (row.agency_id) agencyNames.set(row.agency_id, agencyLabel);
    const offer: PriceOffer = {
      id: row.id,
      itemName: row.item_name,
      // 오퍼 단위 지역. 한 업체가 여러 지역에 공시하면 행마다 지역이 다르고,
      // 지역 필터는 업체가 아니라 행 기준으로 좁혀야 그 지역의 가격만 보인다.
      regionCode: row.region_code ?? undefined,
      agencyId: row.agency_id,
      agencyName: agencyLabel,
      minimumKrw: money(row.price_min_krw),
      maximumKrw: money(row.price_max_krw),
      // 부가세 표기는 비교의 핵심인데 목록에서만 빠져 있었다(상세엔 노출 중).
      priceNote: [row.vat_note, row.price_note].filter(Boolean).join(" · ") || null,
      baseSpec: row.base_spec,
      options: (optionsByPrice.get(row.id) ?? []).sort((left, right) =>
        (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER)
        || (left.minimumKrw ?? Number.MAX_SAFE_INTEGER) - (right.minimumKrw ?? Number.MAX_SAFE_INTEGER)
        || left.name.localeCompare(right.name, "ko-KR")
        || left.id.localeCompare(right.id)),
    };
    const identity = vendorIdentityKey(priceCategory, row.vendor_name, row.vendor_slug);
    // 지역은 대행사의 것이지 샵의 것이 아니다. 이름에 지점 라벨이 있으면
    // 그게 샵의 실제 소재지라 대행사 지역보다 우선한다 — 없으면 `[강릉]`이 붙은
    // 샵이 서울로 잡혀 강원 필터에서 사라진다.
    const regionCode = vendorRegionCodeOverride(priceCategory, row.vendor_name) ?? row.region_code;
    const existing = vendorsById.get(identity);
    if (existing) {
      if (existing.aliases.length === 0) existing.aliases = aliases(row.vendor_aliases);
      // 대표 URL은 슬러그 사전순 최솟값으로 고정한다 — 상세 페이지의 canonical과
      // 같은 규칙이어야 카드 링크와 정규 주소가 어긋나지 않는다.
      if (row.vendor_slug < existing.slug) {
        existing.slug = row.vendor_slug;
        existing.id = row.vendor_id;
      }
      if (existing.category === priceCategory) existing.offers.push(offer);
      if (regionCode) {
        existing.regionCodes ??= [];
        if (!existing.regionCodes.includes(regionCode)) {
          existing.regionCodes.push(regionCode);
        }
      }
      continue;
    }
    // 적재를 만든 스캐너가 파일명을 그대로 업체명으로 써서 `베로나지디_예식장`·
    // `빌라드지디 논현(라비에벨(주))` 같은 이름이 공개돼 있다(2026-08-08 실측 21곳).
    // DB를 고치는 게 근본이지만 운영 쓰기가 봉인돼 있어 표시 규칙으로 정리한다.
    const display = vendorDisplayName(row.vendor_name);
    vendorsById.set(identity, {
      id: row.vendor_id,
      slug: row.vendor_slug,
      name: display.name,
      disclosureEntity: display.disclosureEntity,
      aliases: aliases(row.vendor_aliases),
      category: priceCategory,
      regionCode,
      regionCodes: regionCode ? [regionCode] : [],
      offers: [offer],
    });
  }

  const categories = Object.fromEntries(PRICE_CATEGORIES.map((value) => [
    value,
    [...vendorsById.values()]
      .filter(({ category: vendorCategory }) => vendorCategory === value)
      .map((vendor) => ({
        ...vendor,
        offers: [...vendor.offers].sort((left, right) =>
          (left.minimumKrw ?? Number.MAX_SAFE_INTEGER) - (right.minimumKrw ?? Number.MAX_SAFE_INTEGER)
          || left.agencyName.localeCompare(right.agencyName, "ko-KR")
          || left.id.localeCompare(right.id)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "ko-KR") || left.id.localeCompare(right.id)),
  ])) as PriceCatalog["categories"];

  return {
    periodLabel: [...periods].sort((left, right) => right.localeCompare(left))[0] ?? "기간 확인 필요",
    categories,
    counts: Object.fromEntries(
      PRICE_CATEGORIES.map((value) => [value, categories[value].length]),
    ) as PriceCatalog["counts"],
    agencies: [...agencyNames].map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "ko-KR") || left.id.localeCompare(right.id)),
  };
}
