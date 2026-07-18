import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sanitizePublicVendorAttributes,
  type VendorAttributeCategory,
} from "./attributeSchemas";
import type {
  RecommendationCandidate,
  VendorRecommendationRequest,
  VendorRecommendationResponse,
} from "./recommendation";

type VendorRow = {
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

type FlatTagRow = {
  vendorId: string;
  slug: string;
  label: string;
  isActive?: boolean;
};

type FlatPriceRow = {
  vendorId: string;
  id: string;
  snapshotId?: string;
  priceCategory: string;
  itemName: string;
  minKrw: number;
  maxKrw: number | null;
  periodLabel: string;
  isCurrent: boolean;
  publishedAt: string | null;
  createdAt: string;
};

const VENDOR_PAGE_SIZE = 1_000;
const MAX_VENDOR_CANDIDATES = 5_000;
const RELATION_PAGE_SIZE = 1_000;
const MAX_RECOMMENDATION_TAG_ROWS = 25_000;
const MAX_RECOMMENDATION_PRICE_ROWS = 25_000;

type VendorPage = { data: VendorRow[] | null; error: unknown };
type RelationPage<T> = { data: T[] | null; error: unknown };

export async function collectRecommendationRelationChunks<T>(
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
  const pageSize = options.pageSize ?? RELATION_PAGE_SIZE;
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
        throw new Error(
          options.unavailableError ?? "VENDOR_RECOMMENDATION_DATA_UNAVAILABLE",
        );
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

export async function collectRecommendationVendorPages(
  fetchPage: (from: number, to: number) => Promise<VendorPage>,
): Promise<VendorRow[]> {
  const vendors: VendorRow[] = [];
  let from = 0;
  while (true) {
    const remaining = MAX_VENDOR_CANDIDATES - vendors.length;
    const requested = remaining > 0 ? Math.min(VENDOR_PAGE_SIZE, remaining) : 1;
    const to = from + requested - 1;
    const page = await fetchPage(from, to);
    if (page.error) throw new Error("VENDOR_RECOMMENDATION_DATA_UNAVAILABLE");
    const rows = page.data ?? [];
    if (remaining === 0) {
      if (rows.length > 0) throw new Error("VENDOR_RECOMMENDATION_CANDIDATE_LIMIT");
      return vendors;
    }
    if (rows.length > requested) {
      throw new Error("VENDOR_RECOMMENDATION_CANDIDATE_LIMIT");
    }
    if (rows.length === 0) return vendors;
    vendors.push(...rows);
    from += rows.length;
  }
}

export function recommendationCategoryToDb(
  category: VendorAttributeCategory,
): string {
  return category === "hall" ? "venue" : category;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function comparePriceRecency(left: FlatPriceRow, right: FlatPriceRow): number {
  return Number(right.isCurrent) - Number(left.isCurrent)
    || (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "")
    || right.createdAt.localeCompare(left.createdAt)
    || right.periodLabel.localeCompare(left.periodLabel)
    || left.id.localeCompare(right.id);
}

function isHallVenueFeeItem(itemName: string): boolean {
  const normalized = itemName.normalize("NFKC").trim();
  return normalized === "대관료" || /^대관료\s*[([{]/u.test(normalized);
}

function priceForVendor(
  category: VendorAttributeCategory,
  rows: FlatPriceRow[],
) {
  const eligibleRows = rows.filter((row) => {
    if (category === "hall") {
      return row.priceCategory === "hall" && isHallVenueFeeItem(row.itemName);
    }
    return row.priceCategory === category;
  });
  if (eligibleRows.length === 0) return null;
  const newest = [...eligibleRows].sort(comparePriceRecency)[0];
  const selectedRows = eligibleRows.filter((row) =>
    newest.snapshotId
      ? row.snapshotId === newest.snapshotId
      : row.periodLabel === newest.periodLabel && row.isCurrent === newest.isCurrent
  );
  const minKrw = Math.min(...selectedRows.map((row) => row.minKrw));
  const explicitMax = selectedRows
    .map((row) => row.maxKrw)
    .filter((value): value is number => value !== null);
  const maxKrw = explicitMax.length === selectedRows.length
    ? Math.max(...explicitMax)
    : null;
  return {
    minKrw,
    maxKrw,
    periodLabel: newest.periodLabel,
    hasMarketData: false,
    isLatestSnapshot: newest.isCurrent,
  };
}

export function assembleRecommendationCandidates(
  category: VendorAttributeCategory,
  vendorRows: VendorRow[],
  tagRows: FlatTagRow[],
  priceRows: FlatPriceRow[],
): RecommendationCandidate[] {
  const dbCategory = recommendationCategoryToDb(category);
  const tagsByVendor = new Map<string, Array<{ slug: string; label: string }>>();
  for (const row of tagRows) {
    if (row.isActive === false) continue;
    const tags = tagsByVendor.get(row.vendorId) ?? [];
    tags.push({ slug: row.slug, label: row.label });
    tagsByVendor.set(row.vendorId, tags);
  }
  for (const tags of tagsByVendor.values()) {
    tags.sort((left, right) =>
      left.label.localeCompare(right.label, "ko-KR") || left.slug.localeCompare(right.slug)
    );
  }

  const pricesByVendor = new Map<string, FlatPriceRow[]>();
  for (const row of priceRows) {
    const prices = pricesByVendor.get(row.vendorId) ?? [];
    prices.push(row);
    pricesByVendor.set(row.vendorId, prices);
  }

  return vendorRows.flatMap((vendor) => {
    if (
      vendor.status !== "approved"
      || vendor.category !== dbCategory
      || !vendor.slug
      || vendor.slug.trim() === ""
    ) {
      return [];
    }
    const price = priceForVendor(
      category,
      pricesByVendor.get(vendor.id) ?? [],
    );
    if (!price) return [];

    const tags = tagsByVendor.get(vendor.id) ?? [];

    return [{
      id: vendor.id,
      slug: vendor.slug,
      name: vendor.name,
      category,
      regionCode: vendor.region_code,
      status: vendor.status,
      attributes: sanitizePublicVendorAttributes(category, vendor.attributes),
      tags,
      urls: {
        official: vendor.official_url,
        instagram: vendor.instagram_url,
        naverPlace: vendor.naver_place_url,
      },
      price,
    }];
  });
}

function normalizeAggregatedTags(
  vendorId: string,
  value: unknown,
): FlatTagRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isPlainObject(entry)) return [];
    return typeof entry.slug === "string" && typeof entry.label === "string"
      ? [{ vendorId, slug: entry.slug, label: entry.label, isActive: true }]
      : [];
  });
}

export async function loadRecommendationCandidates(
  client: SupabaseClient,
  category: VendorAttributeCategory,
): Promise<RecommendationCandidate[]> {
  const vendors = await collectRecommendationVendorPages(async (from, to) => {
    const result = await client
      .from("v_public_vendor_enrichment")
      .select(
        "id, slug, name, category, region_code, attributes, official_url, instagram_url, naver_place_url, tags",
      )
      .eq("category", recommendationCategoryToDb(category))
      .not("slug", "is", null)
      .order("id", { ascending: true })
      .range(from, to);
    return {
      data: result.data?.map((row) => ({ ...row, status: "approved" })) as VendorRow[] | null,
      error: result.error,
    };
  });
  if (vendors.length === 0) return [];

  // Tags are aggregated in the explicit public projection, avoiding one
  // vendor-id query per 100 candidates and long PostgREST `.in(...)` URLs.
  const tagRows = vendors.flatMap((vendor) => normalizeAggregatedTags(vendor.id, vendor.tags));
  if (tagRows.length > MAX_RECOMMENDATION_TAG_ROWS) {
    throw new Error("VENDOR_RECOMMENDATION_TAG_LIMIT");
  }
  const rawPriceRows = await collectRecommendationRelationChunks(
    [[recommendationCategoryToDb(category)]],
    async (_categories, from, to) => {
      const result = await client
        .from("v_public_official_prices")
        .select(
          "id, snapshot_id, vendor_id, price_category, item_name, price_min_krw, price_max_krw, period_label, is_current, published_at, created_at",
        )
        .eq("price_category", category)
        .eq("source", "kca_tprice")
        .not("vendor_id", "is", null)
        .not("price_min_krw", "is", null)
        .order("vendor_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return { data: result.data ?? null, error: result.error };
    },
    {
      maxRows: MAX_RECOMMENDATION_PRICE_ROWS,
      limitError: "VENDOR_RECOMMENDATION_PRICE_LIMIT",
    },
  );

  const priceRows: FlatPriceRow[] = [];
  for (const raw of rawPriceRows) {
      const row = raw as Record<string, unknown>;
      if (
        typeof row.id === "string"
        && typeof row.snapshot_id === "string"
        && typeof row.vendor_id === "string"
        && typeof row.price_category === "string"
        && typeof row.item_name === "string"
        && typeof row.price_min_krw === "number"
        && Number.isSafeInteger(row.price_min_krw)
        && row.price_min_krw >= 0
        && typeof row.period_label === "string"
        && typeof row.created_at === "string"
      ) {
        const maxKrw = typeof row.price_max_krw === "number"
          && Number.isSafeInteger(row.price_max_krw)
          && row.price_max_krw >= row.price_min_krw
          ? row.price_max_krw
          : null;
        priceRows.push({
          vendorId: row.vendor_id,
          id: row.id,
          snapshotId: row.snapshot_id,
          priceCategory: row.price_category,
          itemName: row.item_name,
          minKrw: row.price_min_krw,
          maxKrw,
          periodLabel: row.period_label,
          isCurrent: row.is_current === true,
          publishedAt: typeof row.published_at === "string" ? row.published_at : null,
          createdAt: row.created_at,
        });
      }
  }

  return assembleRecommendationCandidates(category, vendors, tagRows, priceRows);
}

export async function logRecommendationImpressions(
  client: SupabaseClient,
  request: VendorRecommendationRequest,
  response: VendorRecommendationResponse,
): Promise<boolean> {
  if (response.results.length === 0) return true;
  const requestedRegions = request.region_codes ?? [];
  const region = requestedRegions.length === 1
    ? requestedRegions[0]
    : requestedRegions.length > 1 ? "multiple" : "all";
  const rows = response.results.map((result) => ({
    anon_id: "amora",
    vendor_id: result.vendor.id,
    surface: "amora_reco",
    event_type: "vendor_impression",
    context: {
      category: request.category,
      region,
      surface: "amora_reco",
    },
  }));
  const { error } = await client.from("events").insert(rows);
  return !error;
}
