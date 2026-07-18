import type { SupabaseClient } from "@supabase/supabase-js";
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

export function assemblePublicVendorPriceProfile(
  vendor: PublicVendorProjection,
  prices: PublicPriceProjection[],
  options: PublicOptionProjection[],
) {
  const attributeCategory = vendorAttributeCategoryFromDb(vendor.category);
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
      name: vendor.name,
      category: consumerCategory(vendor.category),
      region_code: vendor.region_code,
      aliases: safeAliases(vendor.aliases),
      urls: {
        official: vendor.official_url,
        instagram: vendor.instagram_url,
        naver_place: vendor.naver_place_url,
      },
    },
    attributes: attributeCategory
      ? sanitizePublicVendorAttributes(attributeCategory, vendor.attributes)
      : {},
    tags: safeTags(vendor.tags),
    prices: orderedPrices.map((price) => ({
      id: price.id,
      period_label: price.period_label,
      category: consumerCategory(price.price_category),
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

  const prices = await collectPublicVendorRelationChunks<PublicPriceProjection>(
    [[slug]],
    async ([vendorSlug], from, to) => {
      const result = await client
        .from("v_public_official_prices")
        .select(
          "id, period_label, price_category, item_name, base_spec, price_min_krw, price_max_krw, vat_note, price_note, source_label, agency_id, agency_slug, agency_display_name, is_current, published_at",
        )
        .eq("vendor_slug", vendorSlug)
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
  );
}
