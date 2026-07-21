import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PRICE_CATEGORIES,
  type PriceCatalog,
  type PriceCategory,
  type PriceOffer,
  type PriceOption,
  type PriceVendor,
} from "./catalog";

type SnapshotRow = {
  id: string;
  period_label: string;
};

type PriceRow = {
  id: string;
  vendor_id: string | null;
  agency_id: string | null;
  category: string;
  item_name: string;
  base_spec: string | null;
  price_min_krw: number | null;
  price_max_krw: number | null;
  price_note: string | null;
};

type OptionRow = {
  id: string;
  official_price_id: string;
  name: string;
  price_min_krw: number | null;
  price_max_krw: number | null;
  unit: string | null;
  condition: string | null;
  is_effectively_mandatory: boolean | null;
  sort_order: number | null;
};

type SemanticRow = {
  partner_vendor_id: string | null;
  semantic_type: string;
};

type VendorRow = {
  id: string;
  slug: string;
  name: string;
  aliases: unknown;
  category: string;
  region_code: string | null;
  status: string;
};

type AgencyRow = {
  id: string;
  name: string;
  display_name: string | null;
};

type PageResult<T> = { data: T[] | null; error: unknown };

const PAGE_SIZE = 500;
const ROW_LIMIT = 10_000;
const ID_CHUNK_SIZE = 50;
const UNSAFE_TEXT = /(?:[a-z]:[\\/]|\\\\|\/(?:users|home|tmp|var)\/|[a-f0-9]{64}\.(?:pdf|xlsx?|docx?|png|jpe?g|txt|json))/iu;

function chunks<T>(values: readonly T[], size = ID_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function collectRows<T>(
  read: (from: number, to: number) => Promise<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < ROW_LIMIT) {
    const requested = Math.min(PAGE_SIZE, ROW_LIMIT - rows.length);
    const result = await read(rows.length, rows.length + requested - 1);
    if (result.error) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
    const page = result.data ?? [];
    if (page.length > requested) throw new Error("ADMIN_PREVIEW_DATA_LIMIT");
    rows.push(...page);
    if (page.length < requested) return rows;
  }
  const overflow = await read(ROW_LIMIT, ROW_LIMIT);
  if (overflow.error) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  if ((overflow.data ?? []).length > 0) throw new Error("ADMIN_PREVIEW_DATA_LIMIT");
  return rows;
}

function safeText(value: unknown, maximum = 300): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximum || normalized.includes("\0")) return null;
  if (UNSAFE_TEXT.test(normalized)) return null;
  return normalized;
}

function money(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function category(value: unknown): PriceCategory | null {
  const normalized = value === "venue" ? "hall" : value;
  return PRICE_CATEGORIES.includes(normalized as PriceCategory)
    ? normalized as PriceCategory
    : null;
}

function aliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => safeText(entry, 160) ?? []))].slice(0, 20);
}

function optionFromRow(row: OptionRow): PriceOption | null {
  const name = safeText(row.name, 200);
  if (!name || !safeText(row.id, 160)) return null;
  return {
    id: row.id,
    name,
    minimumKrw: money(row.price_min_krw),
    maximumKrw: money(row.price_max_krw),
    unit: safeText(row.unit, 100),
    condition: safeText(row.condition, 300),
    // Pending source text remains server-private until a human approves it.
    rawText: "",
    isEffectivelyMandatory: row.is_effectively_mandatory === true,
    sortOrder: Number.isSafeInteger(row.sort_order) ? row.sort_order as number : undefined,
  };
}

function emptyCatalog(periodLabel = "검수 전 공시"): PriceCatalog {
  const categories: Record<PriceCategory, PriceVendor[]> = {
    studio: [],
    dress: [],
    makeup: [],
    hall: [],
  };
  return {
    periodLabel,
    categories,
    counts: { studio: 0, dress: 0, makeup: 0, hall: 0 },
    agencies: [],
  };
}

export async function loadAdminPreviewPriceCatalog(
  client: SupabaseClient,
): Promise<PriceCatalog> {
  const snapshotResult = await client
    .from("price_snapshots")
    .select("id, period_label")
    .eq("source", "kca_tprice")
    .eq("published", false)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, 0);
  if (snapshotResult.error) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  const snapshot = (snapshotResult.data?.[0] ?? null) as SnapshotRow | null;
  if (!snapshot) return emptyCatalog();

  const prices = await collectRows<PriceRow>(async (from, to) => {
    const result = await client
      .from("official_prices")
      .select("id, vendor_id, agency_id, category, item_name, base_spec, price_min_krw, price_max_krw, price_note")
      .eq("snapshot_id", snapshot.id)
      .in("review_status", ["pending", "approved"])
      .order("id", { ascending: true })
      .range(from, to);
    return { data: (result.data ?? null) as PriceRow[] | null, error: result.error };
  });

  const semantics = await collectRows<SemanticRow>(async (from, to) => {
    const result = await client
      .from("disclosure_semantic_staging")
      .select("partner_vendor_id, semantic_type")
      .eq("snapshot_id", snapshot.id)
      .eq("subject_kind", "vendor")
      .not("partner_vendor_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to);
    return { data: (result.data ?? null) as SemanticRow[] | null, error: result.error };
  });

  const vendorIds = [...new Set([
    ...prices.flatMap(({ vendor_id }) => vendor_id ?? []),
    ...semantics.flatMap(({ partner_vendor_id }) => partner_vendor_id ?? []),
  ])];
  const agencyIds = [...new Set(prices.flatMap(({ agency_id }) => agency_id ?? []))];
  const priceIds = prices.map(({ id }) => id);

  const vendors: VendorRow[] = [];
  for (const ids of chunks(vendorIds)) {
    const rows = await collectRows<VendorRow>(async (from, to) => {
      const result = await client
        .from("vendors")
        .select("id, slug, name, aliases, category, region_code, status")
        .in("id", ids)
        .in("status", ["pending", "approved"])
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (result.data ?? null) as VendorRow[] | null, error: result.error };
    });
    vendors.push(...rows);
  }

  const agencies: AgencyRow[] = [];
  for (const ids of chunks(agencyIds)) {
    const rows = await collectRows<AgencyRow>(async (from, to) => {
      const result = await client
        .from("agencies")
        .select("id, name, display_name")
        .in("id", ids)
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (result.data ?? null) as AgencyRow[] | null, error: result.error };
    });
    agencies.push(...rows);
  }

  const options: OptionRow[] = [];
  for (const ids of chunks(priceIds)) {
    const rows = await collectRows<OptionRow>(async (from, to) => {
      const result = await client
        .from("official_price_options")
        .select("id, official_price_id, name, price_min_krw, price_max_krw, unit, condition, is_effectively_mandatory, sort_order")
        .in("official_price_id", ids)
        .order("official_price_id", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (result.data ?? null) as OptionRow[] | null, error: result.error };
    });
    options.push(...rows);
  }

  const agencyById = new Map(agencies.map((row) => [row.id, row]));
  const optionsByPrice = new Map<string, PriceOption[]>();
  for (const row of options) {
    const option = optionFromRow(row);
    if (!option) continue;
    const existing = optionsByPrice.get(row.official_price_id) ?? [];
    existing.push(option);
    optionsByPrice.set(row.official_price_id, existing);
  }
  const pricesByVendor = new Map<string, PriceOffer[]>();
  for (const row of prices) {
    if (!row.vendor_id || !category(row.category)) continue;
    const itemName = safeText(row.item_name, 300);
    if (!itemName) continue;
    const agency = row.agency_id ? agencyById.get(row.agency_id) : null;
    const offer: PriceOffer = {
      id: row.id,
      itemName,
      agencyId: row.agency_id,
      agencyName: safeText(agency?.display_name, 200)
        ?? safeText(agency?.name, 200)
        ?? (row.agency_id ? "대행사 확인 필요" : "업체 직접 공시"),
      minimumKrw: money(row.price_min_krw),
      maximumKrw: money(row.price_max_krw),
      priceNote: safeText(row.price_note, 500),
      baseSpec: safeText(row.base_spec, 500),
      options: optionsByPrice.get(row.id) ?? [],
    };
    const existing = pricesByVendor.get(row.vendor_id) ?? [];
    existing.push(offer);
    pricesByVendor.set(row.vendor_id, existing);
  }

  const catalog = emptyCatalog(safeText(snapshot.period_label, 100) ?? "검수 전 공시");
  for (const row of vendors) {
    const vendorCategory = category(row.category);
    const id = safeText(row.id, 160);
    const slug = safeText(row.slug, 120);
    const name = safeText(row.name, 300);
    if (!vendorCategory || !id || !slug || !name) continue;
    catalog.categories[vendorCategory].push({
      id,
      slug,
      name,
      aliases: aliases(row.aliases),
      category: vendorCategory,
      regionCode: safeText(row.region_code, 100),
      offers: (pricesByVendor.get(id) ?? []).sort((left, right) =>
        (left.minimumKrw ?? Number.MAX_SAFE_INTEGER) - (right.minimumKrw ?? Number.MAX_SAFE_INTEGER)
        || (left.itemName ?? "").localeCompare(right.itemName ?? "", "ko-KR")
        || left.id.localeCompare(right.id)),
    });
  }
  for (const value of PRICE_CATEGORIES) {
    catalog.categories[value].sort((left, right) =>
      left.name.localeCompare(right.name, "ko-KR") || left.id.localeCompare(right.id));
    catalog.counts[value] = catalog.categories[value].length;
  }
  catalog.agencies = agencies.flatMap((row) => {
    const name = safeText(row.display_name, 200) ?? safeText(row.name, 200);
    return name ? [{ id: row.id, name }] : [];
  }).sort((left, right) => left.name.localeCompare(right.name, "ko-KR") || left.id.localeCompare(right.id));
  return catalog;
}

export async function loadAdminPreviewVendor(
  client: SupabaseClient,
  vendorId: string,
): Promise<{ vendor: PriceVendor; periodLabel: string } | null> {
  if (!/^[a-zA-Z0-9-]{1,160}$/u.test(vendorId)) return null;
  const catalog = await loadAdminPreviewPriceCatalog(client);
  for (const value of PRICE_CATEGORIES) {
    const vendor = catalog.categories[value].find(({ id }) => id === vendorId);
    if (vendor) return { vendor, periodLabel: catalog.periodLabel };
  }
  return null;
}
