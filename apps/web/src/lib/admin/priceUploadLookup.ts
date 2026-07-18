import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const PAGE_SIZE = 1_000;
const MAX_ROWS = 10_000;
export const PRICE_LOOKUP_DISCLAIMER = "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.";
const DIRECT_DISCLOSURE_AGENCY_LABEL = "업체 직접 공시";

export interface PublishedPriceLookupInput {
  query: string;
  category?: "studio" | "dress" | "makeup" | "hall";
}

const candidatesSchema = z.array(z.object({
  vendor_id: z.string().uuid(),
  vendor_slug: z.string().min(1),
  vendor_name: z.string().min(1),
  vendor_category: z.enum(["studio", "dress", "makeup", "hall", "venue"]),
  aliases: z.array(z.string()),
  similarity: z.number().min(0.3).max(1),
})).max(3);

const nullableString = z.string().nullable().optional();
const nullableInteger = z.number().int().nullable().optional();

const priceRowsSchema = z.array(z.object({
  id: z.string().uuid(),
  snapshot_id: z.string().uuid(),
  period_label: z.string(),
  published_at: nullableString,
  is_current: z.literal(true),
  vendor_id: z.string().uuid(),
  region_code: nullableString,
  agency_name: nullableString,
  price_min_krw: nullableInteger,
  price_max_krw: nullableInteger,
  price_note: nullableString,
}));

const optionRowsSchema = z.array(z.object({
  official_price_id: z.string().uuid(),
  name: z.string(),
  price_min_krw: nullableInteger,
  raw_text: z.string(),
  is_effectively_mandatory: z.boolean().optional(),
  sort_order: z.number().int().optional(),
}));

type PageResult = { data: unknown; error: unknown };

function pageResult(value: unknown): PromiseLike<PageResult> {
  return value as PromiseLike<PageResult>;
}

async function loadAll(
  queryPage: (start: number, end: number) => PromiseLike<PageResult>,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  while (rows.length < MAX_ROWS) {
    const result = await queryPage(rows.length, rows.length + PAGE_SIZE - 1);
    if (result.error) throw new Error("PRICE_LOOKUP_QUERY_FAILED");
    if (!Array.isArray(result.data)) throw new Error("PRICE_LOOKUP_RESPONSE_INVALID");
    rows.push(...result.data);
    if (result.data.length < PAGE_SIZE) return rows;
  }
  throw new Error("PRICE_LOOKUP_ROW_LIMIT_EXCEEDED");
}

function publishedAtRank(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function latestSnapshotIdsByVendor(
  prices: z.infer<typeof priceRowsSchema>,
): Map<string, string> {
  const latestRows = new Map<string, (typeof prices)[number]>();
  for (const price of prices) {
    const current = latestRows.get(price.vendor_id);
    if (
      !current
      || publishedAtRank(price.published_at) > publishedAtRank(current.published_at)
      || (
        publishedAtRank(price.published_at) === publishedAtRank(current.published_at)
        && price.snapshot_id.localeCompare(current.snapshot_id) > 0
      )
    ) {
      latestRows.set(price.vendor_id, price);
    }
  }
  return new Map(
    [...latestRows].map(([vendorId, price]) => [vendorId, price.snapshot_id]),
  );
}

export async function lookupPublishedVendorPrices(
  client: SupabaseClient,
  input: PublishedPriceLookupInput,
) {
  const matchResult = await client.rpc("lookup_public_price_vendors", {
    p_query: input.query,
    p_category: input.category ?? null,
    p_limit: 3,
  });
  if (matchResult.error) throw new Error("PRICE_LOOKUP_MATCH_FAILED");
  const parsedCandidates = candidatesSchema.safeParse(matchResult.data ?? []);
  if (!parsedCandidates.success) throw new Error("PRICE_LOOKUP_MATCH_RESPONSE_INVALID");
  const candidates = parsedCandidates.data;
  if (candidates.length === 0) {
    return { matches: [], disclaimer: PRICE_LOOKUP_DISCLAIMER };
  }

  const vendorIds = candidates.map((candidate) => candidate.vendor_id);
  const rawPrices = await loadAll((start, end) => pageResult(
    client
      .from("v_public_official_prices")
      .select("id,snapshot_id,period_label,published_at,is_current,vendor_id,region_code,agency_name,price_min_krw,price_max_krw,price_note")
      .in("vendor_id", vendorIds)
      .eq("is_current", true)
      .order("vendor_id", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("snapshot_id", { ascending: false })
      .order("agency_name", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(start, end),
  ));
  const prices = priceRowsSchema.parse(rawPrices);
  const candidateIds = new Set(vendorIds);
  if (prices.some((price) => !candidateIds.has(price.vendor_id))) {
    throw new Error("PRICE_LOOKUP_VENDOR_BOUNDARY_VIOLATION");
  }

  const latestSnapshotIds = latestSnapshotIdsByVendor(prices);
  const latestPrices = prices.filter(
    (price) => latestSnapshotIds.get(price.vendor_id) === price.snapshot_id,
  );
  const priceIds = latestPrices.map((price) => price.id);
  const rawOptions: unknown[] = [];
  for (let offset = 0; offset < priceIds.length; offset += 100) {
    const chunk = priceIds.slice(offset, offset + 100);
    rawOptions.push(...await loadAll((start, end) => pageResult(
      client
        .from("v_public_official_price_options")
        .select("official_price_id,name,price_min_krw,raw_text,is_effectively_mandatory,sort_order")
        .in("official_price_id", chunk)
        .order("official_price_id", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
        .range(start, end),
    )));
  }
  const options = optionRowsSchema.parse(rawOptions);
  const allowedPriceIds = new Set(priceIds);
  if (options.some((option) => !allowedPriceIds.has(option.official_price_id))) {
    throw new Error("PRICE_LOOKUP_OPTION_BOUNDARY_VIOLATION");
  }
  const optionsByPrice = new Map<string, typeof options>();
  for (const option of options) {
    const group = optionsByPrice.get(option.official_price_id) ?? [];
    group.push(option);
    optionsByPrice.set(option.official_price_id, group);
  }
  const pricesByVendor = new Map<string, Array<(typeof prices)[number] & { options: typeof options }>>();
  for (const price of latestPrices) {
    const group = pricesByVendor.get(price.vendor_id) ?? [];
    group.push({ ...price, options: optionsByPrice.get(price.id) ?? [] });
    pricesByVendor.set(price.vendor_id, group);
  }

  return {
    matches: candidates.flatMap((candidate) => {
      const vendorPrices = pricesByVendor.get(candidate.vendor_id);
      if (!vendorPrices || vendorPrices.length === 0) return [];
      const representativePrice = vendorPrices[0];
      return [{
        vendor: {
          id: candidate.vendor_id,
          slug: candidate.vendor_slug,
          name: candidate.vendor_name,
          category: candidate.vendor_category === "venue" ? "hall" : candidate.vendor_category,
          region_code: representativePrice.region_code ?? null,
        },
        period_label: representativePrice.period_label,
        prices: vendorPrices.map((price) => ({
          agency: price.agency_name ?? DIRECT_DISCLOSURE_AGENCY_LABEL,
          price_min_krw: price.price_min_krw ?? null,
          price_max_krw: price.price_max_krw ?? null,
          price_note: price.price_note ?? null,
          options: price.options.map((option) => ({
            name: option.name,
            price_min_krw: option.price_min_krw ?? null,
            raw_text: option.raw_text,
            is_effectively_mandatory: option.is_effectively_mandatory ?? false,
          })),
        })),
        detail_url: `/price/vendor/${candidate.vendor_slug}`,
      }];
    }),
    disclaimer: PRICE_LOOKUP_DISCLAIMER,
  };
}
