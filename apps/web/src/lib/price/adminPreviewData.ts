import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PRICE_CATEGORIES,
  type PriceCatalog,
  type PriceCategory,
  type PriceOffer,
  type PriceOption,
  type PricePolicy,
  type PricePolicyType,
  type PriceVendor,
} from "./catalog";

type SnapshotRow = {
  id: string;
  period_label: string;
};

type AdminPreviewScopeRow = {
  run_sha256: string;
  snapshot_id: string;
  period_label: string;
  unit_ids: string[];
  official_price_ids: string[];
  semantic_ids: string[];
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
  review_status: string;
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
  id: string;
  partner_vendor_id: string | null;
  official_price_id: string | null;
  source_agency: unknown;
  record_kind: string;
  subject_kind: string;
  semantic_type: string;
  title: string | null;
  summary: string | null;
  content_verbatim: string;
  review_status: string;
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

type OwnedRow = {
  run_sha256: string;
  unit_id: string;
  row_kind: "official_price" | "semantic";
  row_id: string;
};

type PageResult<T> = { data: T[] | null; error: unknown };

const PAGE_SIZE = 500;
const ROW_LIMIT = 10_000;
const ID_CHUNK_SIZE = 50;
const QUERY_CONCURRENCY = 4;
const REQUEST_BUDGET = 256;
const PRICE_POLICY_TYPE_BY_SEMANTIC: Readonly<Record<string, PricePolicyType>> = {
  penalty: "penalty",
  refund: "refund",
  refund_policy: "refund",
  change: "change",
  pricing_basis: "other",
  contract_terms: "other",
  reservation: "other",
  validity: "other",
  included_items: "other",
  usage_guide: "other",
  notice: "other",
  other: "other",
};
const UNSAFE_TEXT = /(?:[a-z]:[\\/]|\\\\|\/(?:users|home|tmp|var)\/|[a-f0-9]{64}\.(?:pdf|xlsx?|docx?|png|jpe?g|txt|json))/iu;

function chunks<T>(values: readonly T[], size = ID_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

type RequestBudget = {
  take: () => void;
};

function requestBudget(limit = REQUEST_BUDGET): RequestBudget {
  let remaining = limit;
  return {
    take() {
      if (remaining <= 0) throw new Error("ADMIN_PREVIEW_DATA_LIMIT");
      remaining -= 1;
    },
  };
}

async function mapWithBoundedConcurrency<T, Result>(
  values: readonly T[],
  read: (value: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(QUERY_CONCURRENCY, values.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await read(values[index] as T, index);
    }
  }));
  return results;
}

async function collectRows<T>(
  read: (from: number, to: number) => Promise<PageResult<T>>,
  budget: RequestBudget,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < ROW_LIMIT) {
    const requested = Math.min(PAGE_SIZE, ROW_LIMIT - rows.length);
    budget.take();
    const result = await read(rows.length, rows.length + requested - 1);
    if (result.error) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
    const page = result.data ?? [];
    if (page.length > requested) throw new Error("ADMIN_PREVIEW_DATA_LIMIT");
    rows.push(...page);
    if (page.length < requested) return rows;
  }
  budget.take();
  const overflow = await read(ROW_LIMIT, ROW_LIMIT);
  if (overflow.error) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  if ((overflow.data ?? []).length > 0) throw new Error("ADMIN_PREVIEW_DATA_LIMIT");
  return rows;
}

async function collectChunkedRows<T>(
  ids: readonly string[],
  budget: RequestBudget,
  read: (ids: string[], from: number, to: number) => Promise<PageResult<T>>,
): Promise<T[]> {
  const pages = await mapWithBoundedConcurrency(chunks(ids), (chunk) =>
    collectRows((from, to) => read(chunk, from, to), budget));
  return pages.flat();
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

function sourceAgencyName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return safeText(source.display_name, 200)
    ?? safeText(source.name, 200)
    ?? safeText(source.corporate_name, 200);
}

function policyFromRow(
  row: SemanticRow,
  boundPrice: PriceRow | null,
): PricePolicy | null {
  const id = safeText(row.id, 160);
  const content = safeText(row.content_verbatim, 20_000);
  const agencyName = sourceAgencyName(row.source_agency);
  const policyType = PRICE_POLICY_TYPE_BY_SEMANTIC[row.semantic_type];
  if (
    !id
    || !content
    || !policyType
    || (row.source_agency !== null && row.source_agency !== undefined && !agencyName)
    || (row.official_price_id !== null && row.official_price_id !== undefined && !boundPrice)
  ) return null;
  const originalTitle = safeText(row.title, 300);
  const attribution = [
    agencyName,
    boundPrice ? safeText(boundPrice.item_name, 300) : null,
  ].filter((value): value is string => value !== null).join(" / ");
  return {
    id,
    type: policyType,
    title: attribution
      ? `${originalTitle ?? "정책"} · 적용 범위: ${attribution}`.slice(0, 300)
      : originalTitle,
    summary: safeText(row.summary, 1_000),
    content,
  };
}

function isUnboundHallDocumentPolicy(row: SemanticRow): boolean {
  return row.record_kind === "document_section"
    && row.subject_kind === "vendor"
    && row.semantic_type === "penalty"
    && row.review_status === "pending"
    && row.partner_vendor_id === null
    && row.official_price_id === null;
}

function safeIdArray(value: unknown, maximum = ROW_LIMIT): string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const result = value.map((entry) => safeText(entry, 160));
  if (result.some((entry) => entry === null)) return null;
  const ids = result as string[];
  return new Set(ids).size === ids.length ? ids : null;
}

function adminPreviewScope(value: unknown): AdminPreviewScopeRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const runSha256 = safeText(row.run_sha256, 64);
  const snapshotId = safeText(row.snapshot_id, 160);
  const periodLabel = safeText(row.period_label, 100);
  const unitIds = safeIdArray(row.unit_ids, 1_000);
  const officialPriceIds = safeIdArray(row.official_price_ids);
  const semanticIds = safeIdArray(row.semantic_ids);
  if (
    !runSha256
    || !/^[0-9a-f]{64}$/u.test(runSha256)
    || !snapshotId
    || !periodLabel
    || !unitIds
    || unitIds.length === 0
    || unitIds.some((unitId) => !/^[0-9a-f]{64}$/u.test(unitId))
    || !officialPriceIds
    || !semanticIds
  ) return null;
  return {
    run_sha256: runSha256,
    snapshot_id: snapshotId,
    period_label: periodLabel,
    unit_ids: unitIds,
    official_price_ids: officialPriceIds,
    semantic_ids: semanticIds,
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
  scope: { vendorId?: string } = {},
): Promise<PriceCatalog> {
  const budget = requestBudget();
  const requestedVendorId = scope.vendorId;
  budget.take();
  const scopeResult = requestedVendorId
    ? await client.rpc("get_vendor_disclosure_admin_preview_vendor_scope", {
      p_vendor_id: requestedVendorId,
    })
    : await client.rpc("get_vendor_disclosure_admin_preview_scope");
  if (scopeResult.error || !Array.isArray(scopeResult.data)) {
    throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  }
  if (scopeResult.data.length === 0) return emptyCatalog();
  if (scopeResult.data.length !== 1) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  const completedRun = adminPreviewScope(scopeResult.data[0]);
  if (!completedRun) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");

  budget.take();
  const snapshotResult = await client
    .from("price_snapshots")
    .select("id, period_label")
    .eq("id", completedRun.snapshot_id)
    .eq("source", "kca_tprice")
    .eq("published", false)
    .eq("is_current", false)
    .is("published_at", null)
    .range(0, 0);
  if (snapshotResult.error) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  const snapshot = (snapshotResult.data?.[0] ?? null) as SnapshotRow | null;
  if (!snapshot || snapshot.period_label !== completedRun.period_label) {
    throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  }

  const ownedPriceIds = new Set(completedRun.official_price_ids);
  const ownedPrices = await collectChunkedRows<PriceRow>(
    completedRun.official_price_ids,
    budget,
    async (ids, from, to) => {
      const result = await client
        .from("official_prices")
        .select("id, vendor_id, agency_id, category, item_name, base_spec, price_min_krw, price_max_krw, price_note, review_status")
        .in("id", ids)
        .eq("snapshot_id", snapshot.id)
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (result.data ?? null) as PriceRow[] | null, error: result.error };
    },
  );
  if (ownedPrices.length !== completedRun.official_price_ids.length) {
    throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  }
  if (
    new Set(ownedPrices.map(({ id }) => id)).size !== ownedPrices.length
    || ownedPrices.some(({ id }) => !ownedPriceIds.has(id))
  ) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  const prices = ownedPrices.filter(({ review_status }) =>
    review_status === "pending" || review_status === "approved");

  const ownedSemanticIds = new Set(completedRun.semantic_ids);
  const ownedSemantics = await collectChunkedRows<SemanticRow>(
    completedRun.semantic_ids,
    budget,
    async (ids, from, to) => {
      const result = await client
        .from("disclosure_semantic_staging")
        .select("id, partner_vendor_id, official_price_id, source_agency, record_kind, subject_kind, semantic_type, title, summary, content_verbatim, review_status")
        .in("id", ids)
        .eq("snapshot_id", snapshot.id)
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (result.data ?? null) as SemanticRow[] | null, error: result.error };
    },
  );
  if (ownedSemantics.length !== completedRun.semantic_ids.length) {
    throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  }
  if (
    new Set(ownedSemantics.map(({ id }) => id)).size !== ownedSemantics.length
    || ownedSemantics.some(({ id }) => !ownedSemanticIds.has(id))
  ) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
  const semantics = ownedSemantics.filter((row) =>
    row.record_kind === "vendor_policy"
    && row.subject_kind === "vendor"
    && row.review_status === "pending"
    && row.partner_vendor_id !== null);

  const inferredHallDocumentPolicies: Array<{ row: SemanticRow; vendorId: string }> = [];
  const hasScopedHallPrice = ownedPrices.some((row) =>
    category(row.category) === "hall" && row.vendor_id !== null);
  const shouldResolveHallDocumentPolicies = hasScopedHallPrice && (
    requestedVendorId !== undefined
    || ownedSemantics.some(isUnboundHallDocumentPolicy)
  );
  if (shouldResolveHallDocumentPolicies) {
    const ownership = await collectChunkedRows<OwnedRow>(
      completedRun.unit_ids,
      budget,
      async (unitIds, from, to) => {
        const result = await client
          .from("vendor_disclosure_ingest_owned_rows")
          .select("run_sha256, unit_id, row_kind, row_id")
          .eq("run_sha256", completedRun.run_sha256)
          .in("unit_id", unitIds)
          .in("row_kind", ["official_price", "semantic"])
          .order("row_kind", { ascending: true })
          .order("row_id", { ascending: true })
          .range(from, to);
        return { data: (result.data ?? null) as OwnedRow[] | null, error: result.error };
      },
    );
    const completedUnitIds = new Set(completedRun.unit_ids);
    const ownershipKeys = new Set<string>();
    if (ownership.some((row) => {
      const key = `${row.row_kind}:${row.row_id}`;
      if (
        row.run_sha256 !== completedRun.run_sha256
        || !completedUnitIds.has(row.unit_id)
        || ownershipKeys.has(key)
      ) return true;
      ownershipKeys.add(key);
      return false;
    })) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");

    const priceOwnerById = new Map(
      ownership
        .filter((row) => row.row_kind === "official_price")
        .map((row) => [row.row_id, row] as const),
    );
    const semanticOwnerById = new Map(
      ownership
        .filter((row) => row.row_kind === "semantic")
        .map((row) => [row.row_id, row] as const),
    );
    if (
      completedRun.official_price_ids.some((id) => !priceOwnerById.has(id))
      || completedRun.semantic_ids.some((id) => !semanticOwnerById.has(id))
    ) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");

    const candidateUnitIds = new Set(ownedPrices.flatMap((row) => {
      if (category(row.category) !== "hall" || !row.vendor_id) return [];
      const owner = priceOwnerById.get(row.id);
      return owner ? [owner.unit_id] : [];
    }));
    const lineagePriceIds = ownership
      .filter((row) => row.row_kind === "official_price" && candidateUnitIds.has(row.unit_id))
      .map((row) => row.row_id);
    const supplementalPriceIds = lineagePriceIds.filter((id) => !ownedPriceIds.has(id));
    const supplementalPrices = await collectChunkedRows<PriceRow>(
      supplementalPriceIds,
      budget,
      async (ids, from, to) => {
        const result = await client
          .from("official_prices")
          .select("id, vendor_id, agency_id, category, item_name, base_spec, price_min_krw, price_max_krw, price_note, review_status")
          .in("id", ids)
          .eq("snapshot_id", snapshot.id)
          .order("id", { ascending: true })
          .range(from, to);
        return { data: (result.data ?? null) as PriceRow[] | null, error: result.error };
      },
    );
    if (
      supplementalPrices.length !== supplementalPriceIds.length
      || new Set(supplementalPrices.map(({ id }) => id)).size !== supplementalPrices.length
      || supplementalPrices.some(({ id }) => !supplementalPriceIds.includes(id))
    ) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");

    const lineagePriceById = new Map(
      [...ownedPrices, ...supplementalPrices].map((row) => [row.id, row] as const),
    );
    const inferredVendorByUnit = new Map<string, string>();
    for (const unitId of candidateUnitIds) {
      const unitPriceIds = ownership
        .filter((row) => row.row_kind === "official_price" && row.unit_id === unitId)
        .map((row) => row.row_id);
      const unitPrices = unitPriceIds.flatMap((id) => lineagePriceById.get(id) ?? []);
      const vendorIds = new Set(unitPrices.flatMap(({ vendor_id }) => vendor_id ?? []));
      if (
        unitPrices.length !== unitPriceIds.length
        || unitPrices.length === 0
        || unitPrices.some((row) => category(row.category) !== "hall" || !row.vendor_id)
        || vendorIds.size !== 1
      ) continue;
      const [vendorId] = vendorIds;
      if (!vendorId || (requestedVendorId && vendorId !== requestedVendorId)) continue;
      inferredVendorByUnit.set(unitId, vendorId);
    }

    const inferredSemanticOwners = ownership.filter((row) =>
      row.row_kind === "semantic" && inferredVendorByUnit.has(row.unit_id));
    const supplementalSemanticIds = inferredSemanticOwners
      .map((row) => row.row_id)
      .filter((id) => !ownedSemanticIds.has(id));
    const supplementalSemantics = await collectChunkedRows<SemanticRow>(
      supplementalSemanticIds,
      budget,
      async (ids, from, to) => {
        const result = await client
          .from("disclosure_semantic_staging")
          .select("id, partner_vendor_id, official_price_id, source_agency, record_kind, subject_kind, semantic_type, title, summary, content_verbatim, review_status")
          .in("id", ids)
          .eq("snapshot_id", snapshot.id)
          .order("id", { ascending: true })
          .range(from, to);
        return { data: (result.data ?? null) as SemanticRow[] | null, error: result.error };
      },
    );
    if (
      supplementalSemantics.length !== supplementalSemanticIds.length
      || new Set(supplementalSemantics.map(({ id }) => id)).size !== supplementalSemantics.length
      || supplementalSemantics.some(({ id }) => !supplementalSemanticIds.includes(id))
    ) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");
    const lineageSemanticById = new Map(
      [...ownedSemantics, ...supplementalSemantics].map((row) => [row.id, row] as const),
    );
    for (const owner of inferredSemanticOwners) {
      const vendorId = inferredVendorByUnit.get(owner.unit_id);
      const row = lineageSemanticById.get(owner.row_id);
      if (vendorId && row && isUnboundHallDocumentPolicy(row)) {
        inferredHallDocumentPolicies.push({ row, vendorId });
      }
    }
  }

  const vendorIds = [...new Set([
    ...prices.flatMap(({ vendor_id }) => vendor_id ?? []),
    ...semantics.flatMap(({ partner_vendor_id }) => partner_vendor_id ?? []),
  ])];
  const agencyIds = [...new Set(prices.flatMap(({ agency_id }) => agency_id ?? []))];
  const priceIds = prices.map(({ id }) => id);

  const vendors = await collectChunkedRows<VendorRow>(
    vendorIds,
    budget,
    async (ids, from, to) => {
      const result = await client
        .from("vendors")
        .select("id, slug, name, aliases, category, region_code, status")
        .in("id", ids)
        .in("status", ["draft", "pending", "approved"])
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (result.data ?? null) as VendorRow[] | null, error: result.error };
    },
  );
  const expectedVendorIds = new Set(vendorIds);
  if (
    vendors.length !== expectedVendorIds.size
    || new Set(vendors.map(({ id }) => id)).size !== vendors.length
    || vendors.some(({ id }) => !expectedVendorIds.has(id))
  ) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");

  const agencies = await collectChunkedRows<AgencyRow>(
    agencyIds,
    budget,
    async (ids, from, to) => {
      const result = await client
        .from("agencies")
        .select("id, name, display_name")
        .in("id", ids)
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (result.data ?? null) as AgencyRow[] | null, error: result.error };
    },
  );
  const expectedAgencyIds = new Set(agencyIds);
  if (
    agencies.length !== expectedAgencyIds.size
    || new Set(agencies.map(({ id }) => id)).size !== agencies.length
    || agencies.some(({ id }) => !expectedAgencyIds.has(id))
  ) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");

  const options = await collectChunkedRows<OptionRow>(
    priceIds,
    budget,
    async (ids, from, to) => {
      const result = await client
        .from("official_price_options")
        .select("id, official_price_id, name, price_min_krw, price_max_krw, unit, condition, is_effectively_mandatory, sort_order")
        .in("official_price_id", ids)
        .order("official_price_id", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (result.data ?? null) as OptionRow[] | null, error: result.error };
    },
  );
  const expectedOptionPriceIds = new Set(priceIds);
  if (
    new Set(options.map(({ id }) => id)).size !== options.length
    || options.some(({ official_price_id }) => !expectedOptionPriceIds.has(official_price_id))
  ) throw new Error("ADMIN_PREVIEW_DATA_UNAVAILABLE");

  const agencyById = new Map(agencies.map((row) => [row.id, row]));
  const optionsByPrice = new Map<string, PriceOption[]>();
  for (const row of options) {
    const option = optionFromRow(row);
    if (!option) continue;
    const existing = optionsByPrice.get(row.official_price_id) ?? [];
    existing.push(option);
    optionsByPrice.set(row.official_price_id, existing);
  }
  const pricesByVendor = new Map<string, Map<PriceCategory, PriceOffer[]>>();
  const priceById = new Map(prices.map((row) => [row.id, row]));
  for (const row of prices) {
    const priceCategory = category(row.category);
    if (!row.vendor_id || !priceCategory) continue;
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
    const byCategory = pricesByVendor.get(row.vendor_id) ?? new Map<PriceCategory, PriceOffer[]>();
    const existing = byCategory.get(priceCategory) ?? [];
    existing.push(offer);
    byCategory.set(priceCategory, existing);
    pricesByVendor.set(row.vendor_id, byCategory);
  }
  const policiesByVendor = new Map<string, PricePolicy[]>();
  for (const row of semantics) {
    if (!row.partner_vendor_id) continue;
    const boundPrice = row.official_price_id ? priceById.get(row.official_price_id) ?? null : null;
    if (boundPrice && boundPrice.vendor_id !== row.partner_vendor_id) continue;
    const policy = policyFromRow(row, boundPrice);
    if (!policy) continue;
    const existing = policiesByVendor.get(row.partner_vendor_id) ?? [];
    existing.push(policy);
    policiesByVendor.set(row.partner_vendor_id, existing);
  }
  const vendorById = new Map(vendors.map((row) => [row.id, row] as const));
  for (const { row, vendorId } of inferredHallDocumentPolicies) {
    if (category(vendorById.get(vendorId)?.category) !== "hall") continue;
    const policy = policyFromRow(row, null);
    if (!policy) continue;
    const existing = policiesByVendor.get(vendorId) ?? [];
    existing.push(policy);
    policiesByVendor.set(vendorId, existing);
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
      offers: (pricesByVendor.get(id)?.get(vendorCategory) ?? []).sort((left, right) =>
        (left.minimumKrw ?? Number.MAX_SAFE_INTEGER) - (right.minimumKrw ?? Number.MAX_SAFE_INTEGER)
        || (left.itemName ?? "").localeCompare(right.itemName ?? "", "ko-KR")
        || left.id.localeCompare(right.id)),
      policies: (policiesByVendor.get(id) ?? []).sort((left, right) =>
        left.type.localeCompare(right.type, "en") || left.id.localeCompare(right.id)),
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
  const catalog = await loadAdminPreviewPriceCatalog(client, { vendorId });
  for (const value of PRICE_CATEGORIES) {
    const vendor = catalog.categories[value].find(({ id }) => id === vendorId);
    if (vendor) return { vendor, periodLabel: catalog.periodLabel };
  }
  return null;
}
