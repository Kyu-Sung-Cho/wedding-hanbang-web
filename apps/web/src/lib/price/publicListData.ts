import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PRICE_CATEGORIES,
  type PriceCatalog,
  type PriceCategory,
  type PriceOffer,
  type PriceOption,
  type PriceVendor,
} from "./catalog";

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
  base_spec: string | null;
  price_min_krw: number | null;
  price_max_krw: number | null;
  price_note: string | null;
};

type PublicOptionRow = {
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

async function collectPages<T>(
  fetchPage: (from: number, to: number) => Promise<Page<T>>,
  maximumRows: number,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const remaining = maximumRows - rows.length;
    const requested = remaining > 0 ? Math.min(PAGE_SIZE, remaining) : 1;
    const page = await fetchPage(from, from + requested - 1);
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

function optionFromRow(row: PublicOptionRow): PriceOption | null {
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
        "id, period_label, vendor_id, vendor_slug, vendor_name, vendor_aliases, vendor_category, region_code, agency_id, agency_name, agency_display_name, price_category, base_spec, price_min_krw, price_max_krw, price_note",
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
      agencyId: row.agency_id,
      agencyName: agencyLabel,
      minimumKrw: money(row.price_min_krw),
      maximumKrw: money(row.price_max_krw),
      priceNote: row.price_note,
      baseSpec: row.base_spec,
      options: (optionsByPrice.get(row.id) ?? []).sort((left, right) =>
        (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER)
        || (left.minimumKrw ?? Number.MAX_SAFE_INTEGER) - (right.minimumKrw ?? Number.MAX_SAFE_INTEGER)
        || left.name.localeCompare(right.name, "ko-KR")
        || left.id.localeCompare(right.id)),
    };
    const existing = vendorsById.get(row.vendor_id);
    if (existing) {
      if (existing.aliases.length === 0) existing.aliases = aliases(row.vendor_aliases);
      if (existing.category === priceCategory) existing.offers.push(offer);
      continue;
    }
    vendorsById.set(row.vendor_id, {
      id: row.vendor_id,
      slug: row.vendor_slug,
      name: row.vendor_name,
      aliases: aliases(row.vendor_aliases),
      category: priceCategory,
      regionCode: row.region_code,
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
