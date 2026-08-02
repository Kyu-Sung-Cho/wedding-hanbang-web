import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const PAGE_SIZE = 1_000;
const MAX_ROWS_PER_DATASET = 50_000;

const nullableString = z.string().nullable().optional();
const nullableInteger = z.number().int().nullable().optional();

const snapshotRowsSchema = z.array(z.object({
  id: z.string().uuid(),
  period_label: z.string(),
  source: z.string(),
  source_note: nullableString,
  collected_at: nullableString,
  published: z.literal(true),
  published_at: nullableString,
  is_current: z.literal(true),
}));

const priceRowsSchema = z.array(z.object({
  id: z.string().uuid(),
  snapshot_id: z.string().uuid(),
  period_label: z.string().optional(),
  source: z.string().optional(),
  published_at: nullableString,
  is_current: z.literal(true).optional(),
  vendor_id: nullableString,
  vendor_slug: nullableString,
  vendor_name: nullableString,
  vendor_category: nullableString,
  region_code: nullableString,
  agency_id: nullableString,
  agency_name: nullableString,
  price_category: z.string(),
  item_name: z.string().optional(),
  base_spec: nullableString,
  price_min_krw: nullableInteger,
  price_max_krw: nullableInteger,
  vat_note: nullableString,
  price_note: nullableString,
  source_quote: nullableString,
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}));

const optionRowsSchema = z.array(z.object({
  id: z.string().uuid(),
  official_price_id: z.string().uuid(),
  name: z.string(),
  price_min_krw: nullableInteger,
  price_max_krw: nullableInteger,
  unit: nullableString,
  condition: nullableString,
  raw_text: z.string(),
  is_effectively_mandatory: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  source_quote: nullableString,
  created_at: z.string().optional(),
}));

const packageRowsSchema = z.array(z.object({
  id: z.string().uuid(),
  snapshot_id: z.string().uuid(),
  period_label: z.string().optional(),
  source: z.string().optional(),
  published_at: nullableString,
  agency_id: z.string().uuid().optional(),
  agency_name: z.string().optional(),
  region_code: nullableString,
  package_name: z.string().optional(),
  category_scope: z.array(z.string()).optional(),
  price_min_krw: nullableInteger,
  price_max_krw: nullableInteger,
  vat_note: nullableString,
  price_note: nullableString,
  options: z.unknown().optional(),
  source_quote: nullableString,
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}));

type PageResult = { data: unknown; error: unknown };

function pageResult(value: unknown): PromiseLike<PageResult> {
  return value as PromiseLike<PageResult>;
}

async function loadAll(
  queryPage: (start: number, end: number) => PromiseLike<PageResult>,
  maxRows = MAX_ROWS_PER_DATASET,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  while (rows.length < maxRows) {
    const requestedPageSize = Math.min(PAGE_SIZE, maxRows - rows.length);
    const result = await queryPage(rows.length, rows.length + requestedPageSize - 1);
    if (result.error) throw new Error("PRICE_EXPORT_QUERY_FAILED");
    if (!Array.isArray(result.data)) throw new Error("PRICE_EXPORT_RESPONSE_INVALID");
    rows.push(...result.data);
    if (result.data.length < requestedPageSize) return rows;
  }
  throw new Error("PRICE_EXPORT_ROW_LIMIT_EXCEEDED");
}

export async function loadCurrentPublishedPriceExport(client: SupabaseClient) {
  const rawSnapshots = await loadAll((start, end) => pageResult(
    client
      .from("price_snapshots")
      .select("id,period_label,source,source_note,collected_at,published,published_at,is_current")
      .eq("published", true)
      .eq("is_current", true)
      .order("source", { ascending: true })
      .order("id", { ascending: true })
      .range(start, end),
  ));
  const snapshots = snapshotRowsSchema.parse(rawSnapshots);
  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  if (snapshotIds.length === 0) {
    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      snapshots: [],
      prices: [],
      agency_packages: [],
    };
  }

  const rawPrices = await loadAll((start, end) => pageResult(
    client
      .from("v_private_admin_official_prices")
      .select("id,snapshot_id,period_label,source,published_at,is_current,vendor_id,vendor_slug,vendor_name,vendor_category,region_code,agency_id,agency_name,price_category,item_name,base_spec,price_min_krw,price_max_krw,vat_note,price_note,source_quote,created_at,updated_at")
      .in("snapshot_id", snapshotIds)
      .order("snapshot_id", { ascending: true })
      .order("id", { ascending: true })
      .range(start, end),
  ));
  const prices = priceRowsSchema.parse(rawPrices);
  const allowedSnapshots = new Set(snapshotIds);
  if (prices.some((price) => !allowedSnapshots.has(price.snapshot_id))) {
    throw new Error("PRICE_EXPORT_SNAPSHOT_BOUNDARY_VIOLATION");
  }

  const priceIds = prices.map((price) => price.id);
  const rawOptions: unknown[] = [];
  for (let offset = 0; offset < priceIds.length; offset += 100) {
    const chunk = priceIds.slice(offset, offset + 100);
    const remainingOptionBudget = MAX_ROWS_PER_DATASET - rawOptions.length;
    if (remainingOptionBudget <= 0) {
      throw new Error("PRICE_EXPORT_ROW_LIMIT_EXCEEDED");
    }
    rawOptions.push(...await loadAll((start, end) => pageResult(
      client
        .from("v_private_admin_official_price_options")
        .select("id,official_price_id,name,price_min_krw,price_max_krw,unit,condition,raw_text,is_effectively_mandatory,sort_order,source_quote,created_at")
        .in("official_price_id", chunk)
        .order("official_price_id", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .range(start, end),
    ), remainingOptionBudget));
  }
  const options = optionRowsSchema.parse(rawOptions);
  const allowedPrices = new Set(priceIds);
  if (options.some((option) => !allowedPrices.has(option.official_price_id))) {
    throw new Error("PRICE_EXPORT_OPTION_BOUNDARY_VIOLATION");
  }
  const optionsByPrice = new Map<string, typeof options>();
  for (const option of options) {
    const grouped = optionsByPrice.get(option.official_price_id) ?? [];
    grouped.push(option);
    optionsByPrice.set(option.official_price_id, grouped);
  }

  const rawPackages = await loadAll((start, end) => pageResult(
    client
      .from("v_private_admin_agency_packages")
      .select("id,snapshot_id,period_label,source,published_at,agency_id,agency_name,region_code,package_name,category_scope,price_min_krw,price_max_krw,vat_note,price_note,options,source_quote,created_at,updated_at")
      .in("snapshot_id", snapshotIds)
      .order("snapshot_id", { ascending: true })
      .order("id", { ascending: true })
      .range(start, end),
  ));
  const packages = packageRowsSchema.parse(rawPackages);
  if (packages.some((packageRow) => !allowedSnapshots.has(packageRow.snapshot_id))) {
    throw new Error("PRICE_EXPORT_PACKAGE_BOUNDARY_VIOLATION");
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    snapshots,
    prices: prices.map((price) => ({
      ...price,
      options: optionsByPrice.get(price.id) ?? [],
    })),
    agency_packages: packages,
  };
}
