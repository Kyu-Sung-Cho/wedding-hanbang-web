import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sanitizePublicVendorAttributes,
  vendorAttributeCategoryFromDb,
} from "./attributeSchemas";

type VendorProfileRow = {
  id: string;
  slug: string | null;
  name: string;
  category: string;
  region_code: string | null;
  status: string;
  attributes: unknown;
  official_url: string | null;
  instagram_url: string | null;
  naver_place_url: string | null;
  tags?: unknown;
};

type ProfileTag = {
  slug: string;
  label: string;
  tagGroup: string;
};

type ProfileOption = {
  id: string;
  name: string;
  minKrw: number | null;
  maxKrw: number | null;
  unit: string | null;
  condition: string | null;
  rawText: string;
};

type ProfilePrice = {
  id: string;
  category: string;
  itemName: string;
  baseSpec: string | null;
  minKrw: number | null;
  maxKrw: number | null;
  vatNote: string | null;
  priceNote: string | null;
  sourceLabel: string;
  periodLabel: string;
  isCurrent: boolean;
  options: ProfileOption[];
};

type PublicProfilePriceRow = {
  id: string;
  snapshot_id: string;
  price_category: string;
  item_name: string;
  base_spec: string | null;
  price_min_krw: number | null;
  price_max_krw: number | null;
  vat_note: string | null;
  price_note: string | null;
  source_label: string;
  period_label: string;
  is_current: boolean;
};

type RelationPage<T> = { data: T[] | null; error: unknown };

const PROFILE_RELATION_PAGE_SIZE = 200;
const PROFILE_TAG_CAP = 500;
const PROFILE_PRICE_CAP = 2_000;
const PROFILE_OPTION_CAP = 5_000;
const PROFILE_ID_CHUNK_SIZE = 50;

export async function collectVendorProfileRelationChunks<T>(
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
  const pageSize = options.pageSize ?? PROFILE_RELATION_PAGE_SIZE;
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
        throw new Error(options.unavailableError ?? "VENDOR_PROFILE_DATA_UNAVAILABLE");
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

function chunks<T>(values: T[], size = PROFILE_ID_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function apiCategory(dbCategory: string): string {
  return dbCategory === "venue" ? "hall" : dbCategory;
}

function nullableMoneyOrder(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compareTags(left: ProfileTag, right: ProfileTag): number {
  return left.label.localeCompare(right.label, "ko-KR")
    || left.slug.localeCompare(right.slug)
    || left.tagGroup.localeCompare(right.tagGroup);
}

function compareOptions(left: ProfileOption, right: ProfileOption): number {
  return nullableMoneyOrder(left.minKrw, right.minKrw)
    || left.name.localeCompare(right.name, "ko-KR")
    || left.id.localeCompare(right.id);
}

function comparePrices(left: ProfilePrice, right: ProfilePrice): number {
  return Number(right.isCurrent) - Number(left.isCurrent)
    || right.periodLabel.localeCompare(left.periodLabel)
    || nullableMoneyOrder(left.minKrw, right.minKrw)
    || left.itemName.localeCompare(right.itemName, "ko-KR")
    || left.id.localeCompare(right.id);
}

function profileSourceLabel(sourceLabel: string, periodLabel: string): string {
  const sourceName = sourceLabel.split(" · ", 1)[0]?.trim() || "공시 자료";
  return `${sourceName} ${periodLabel} 공시 기준`;
}

export function assembleVendorProfile(
  vendor: VendorProfileRow,
  tags: ProfileTag[],
  prices: ProfilePrice[],
) {
  if (vendor.status !== "approved" || !vendor.slug || vendor.slug.trim() === "") {
    return null;
  }
  const attributeCategory = vendorAttributeCategoryFromDb(vendor.category);
  const orderedTags = [...tags].sort(compareTags);
  const orderedPrices = [...prices].sort(comparePrices);
  const sources = [...new Set(orderedPrices.map(({ sourceLabel, periodLabel }) => (
    profileSourceLabel(sourceLabel, periodLabel)
  )))];
  const dataBadges: string[] = [];
  if (orderedPrices.length > 0) dataBadges.push("공시가");
  if (orderedPrices.some(({ isCurrent }) => isCurrent)) dataBadges.push("최신 공시");
  if (orderedTags.length > 0) dataBadges.push("태그 확인");

  return {
    vendor: {
      id: vendor.id,
      slug: vendor.slug,
      name: vendor.name,
      category: apiCategory(vendor.category),
      region_code: vendor.region_code,
      urls: {
        official: vendor.official_url,
        instagram: vendor.instagram_url,
        naver_place: vendor.naver_place_url,
      },
    },
    attributes: attributeCategory
      ? sanitizePublicVendorAttributes(attributeCategory, vendor.attributes)
      : {},
    tags: orderedTags.map(({ slug, label, tagGroup }) => ({
      slug,
      label,
      tag_group: tagGroup,
    })),
    official_prices: orderedPrices.map((price) => ({
      id: price.id,
      category: price.category,
      item_name: price.itemName,
      base_spec: price.baseSpec,
      price_min_krw: price.minKrw,
      price_max_krw: price.maxKrw,
      vat_note: price.vatNote,
      price_note: price.priceNote,
      period_label: price.periodLabel,
      is_current: price.isCurrent,
      source: profileSourceLabel(price.sourceLabel, price.periodLabel),
      options: [...price.options].sort(compareOptions).map((option) => ({
        id: option.id,
        name: option.name,
        price_min_krw: option.minKrw,
        price_max_krw: option.maxKrw,
        unit: option.unit,
        condition: option.condition,
        raw_text: option.rawText,
      })),
    })),
    data_badges: dataBadges,
    sources,
  };
}

function normalizeAggregatedProfileTags(value: unknown): ProfileTag[] {
  if (!Array.isArray(value) || value.length > PROFILE_TAG_CAP) {
    throw new Error("VENDOR_PROFILE_DATA_UNAVAILABLE");
  }
  return value.map((entry) => {
    if (
      !isPlainObject(entry)
      || typeof entry.slug !== "string"
      || typeof entry.label !== "string"
      || typeof entry.group !== "string"
    ) {
      throw new Error("VENDOR_PROFILE_DATA_UNAVAILABLE");
    }
    return { slug: entry.slug, label: entry.label, tagGroup: entry.group };
  });
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOption(value: unknown): ProfileOption | null {
  if (
    !isPlainObject(value)
    || typeof value.id !== "string"
    || typeof value.name !== "string"
    || typeof value.raw_text !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    minKrw: nullableNumber(value.price_min_krw),
    maxKrw: nullableNumber(value.price_max_krw),
    unit: nullableString(value.unit),
    condition: nullableString(value.condition),
    rawText: value.raw_text,
  };
}

function normalizePublicPrice(
  value: unknown,
  optionsByPriceId: Map<string, ProfileOption[]>,
): ProfilePrice | null {
  if (!isPlainObject(value)) return null;
  if (
    typeof value.id !== "string"
    || typeof value.snapshot_id !== "string"
    || typeof value.price_category !== "string"
    || typeof value.item_name !== "string"
    || typeof value.source_label !== "string"
    || typeof value.period_label !== "string"
    || typeof value.is_current !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id,
    category: value.price_category,
    itemName: value.item_name,
    baseSpec: nullableString(value.base_spec),
    minKrw: nullableNumber(value.price_min_krw),
    maxKrw: nullableNumber(value.price_max_krw),
    vatNote: nullableString(value.vat_note),
    priceNote: nullableString(value.price_note),
    sourceLabel: value.source_label,
    periodLabel: value.period_label,
    isCurrent: value.is_current,
    options: optionsByPriceId.get(value.id) ?? [],
  };
}

export async function loadVendorProfile(
  client: SupabaseClient,
  vendorId: string,
) {
  const { data: vendorData, error: vendorError } = await client
    .from("v_public_vendor_enrichment")
    .select(
      "id, slug, name, category, region_code, attributes, official_url, instagram_url, naver_place_url, tags",
    )
    .eq("id", vendorId)
    .maybeSingle();
  if (vendorError) throw new Error("VENDOR_PROFILE_DATA_UNAVAILABLE");
  if (!vendorData) return null;

  const rawPriceRows = await collectVendorProfileRelationChunks<PublicProfilePriceRow>(
    [[vendorId]],
    async ([id], from, to) => {
      const result = await client
        .from("v_public_official_prices")
        .select(
          "id, snapshot_id, price_category, item_name, base_spec, price_min_krw, price_max_krw, vat_note, price_note, source_label, period_label, is_current",
        )
        .eq("vendor_id", id)
        .eq("source", "kca_tprice")
        .order("period_label", { ascending: false })
        .order("price_min_krw", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to);
      return {
        data: (result.data ?? null) as PublicProfilePriceRow[] | null,
        error: result.error,
      };
    },
    { maxRows: PROFILE_PRICE_CAP, limitError: "VENDOR_PROFILE_PRICE_LIMIT" },
  );
  const tags = normalizeAggregatedProfileTags(vendorData.tags);

  const priceIds = rawPriceRows.map(({ id }) => id);
  const rawOptionRows = priceIds.length === 0
    ? []
    : await collectVendorProfileRelationChunks(
      chunks(priceIds),
      async (ids, from, to) => {
        const result = await client
          .from("v_public_official_price_options")
          .select(
            "id, official_price_id, name, price_min_krw, price_max_krw, unit, condition, raw_text",
          )
          .in("official_price_id", ids)
          .order("official_price_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        return { data: result.data ?? null, error: result.error };
      },
      { maxRows: PROFILE_OPTION_CAP, limitError: "VENDOR_PROFILE_OPTION_LIMIT" },
    );

  const optionsByPriceId = new Map<string, ProfileOption[]>();
  for (const raw of rawOptionRows) {
    const row = raw as Record<string, unknown>;
    const option = normalizeOption(row);
    if (!option || typeof row.official_price_id !== "string") continue;
    const existing = optionsByPriceId.get(row.official_price_id) ?? [];
    existing.push(option);
    optionsByPriceId.set(row.official_price_id, existing);
  }
  const prices = rawPriceRows
    .map((row) => normalizePublicPrice(row, optionsByPriceId))
    .filter((price): price is ProfilePrice => price !== null);

  return assembleVendorProfile(
    { ...vendorData, status: "approved" } as VendorProfileRow,
    tags,
    prices,
  );
}
