import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import {
  attributeCategoryToDb,
  normalizeVendorCategory,
} from "@/lib/admin/vendorWorkspace";
import type { VendorAttributeCategory } from "@/lib/vendors/attributeSchemas";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

const CATEGORIES = new Set(["all", "studio", "dress", "makeup", "hall"]);
const STATUSES = new Set(["all", "pending", "in_progress", "done", "skip"]);
const REGION_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const QUEUE_PAGE_SIZE = 500;
const QUEUE_SAFE_LIMIT = 5_000;
const PROGRESS_CATEGORIES = ["studio", "dress", "makeup", "hall"] as const;
const SUPPORTED_DB_CATEGORIES = PROGRESS_CATEGORIES.map(attributeCategoryToDb);
const ACTIVE_VENDOR_STATUSES = ["pending", "approved"] as const;

type UnknownRecord = Record<string, unknown>;
type ServiceClient = ReturnType<typeof getServiceClient>;

class EnrichmentQueueCapacityError extends Error {}

function privateAssignment(value: unknown): string | null {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== "object") return null;
  const enrichedBy = (record as UnknownRecord).enriched_by;
  return typeof enrichedBy === "string" ? enrichedBy : null;
}

function emptyProgress() {
  return {
    studio: { done: 0, total: 0 },
    dress: { done: 0, total: 0 },
    makeup: { done: 0, total: 0 },
    hall: { done: 0, total: 0 },
  } satisfies Record<VendorAttributeCategory, { done: number; total: number }>;
}

async function loadQueue(
  client: ServiceClient,
  filters: {
    category: string;
    status: string;
    region: string;
    mine: boolean;
    userId: string;
  },
): Promise<UnknownRecord[]> {
  const rows: UnknownRecord[] = [];
  let offset = 0;
  let totalCount: number | null = null;
  const privateSelection = filters.mine
    ? "private:vendor_enrichment_private!inner(enriched_by)"
    : "private:vendor_enrichment_private(enriched_by)";

  while (offset < QUEUE_SAFE_LIMIT) {
    const selectOptions: { count: "exact" } | undefined = totalCount === null
      ? { count: "exact" }
      : undefined;
    const queue = client
      .from("vendors")
      .select(`
        id, name, slug, category, status, region_code,
        enrichment_status, enriched_at,
        ${privateSelection}
      `, selectOptions)
      .order("enrichment_status", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true });
    queue.in("status", [...ACTIVE_VENDOR_STATUSES]);
    if (filters.category !== "all") {
      queue.eq(
        "category",
        attributeCategoryToDb(filters.category as VendorAttributeCategory),
      );
    } else {
      queue.in("category", SUPPORTED_DB_CATEGORIES);
    }
    if (filters.status !== "all") {
      queue.eq("enrichment_status", filters.status);
    }
    if (filters.region) queue.eq("region_code", filters.region);
    if (filters.mine) queue.eq("private.enriched_by", filters.userId);

    const result: {
      data: unknown[] | null;
      count: number | null;
      error: unknown;
    } = await queue.range(offset, offset + QUEUE_PAGE_SIZE - 1);
    if (result.error || !Array.isArray(result.data)) {
      throw new Error("ENRICHMENT_QUEUE_QUERY_FAILED");
    }
    if (totalCount === null) {
      if (typeof result.count !== "number" || result.count < 0) {
        throw new Error("ENRICHMENT_QUEUE_COUNT_FAILED");
      }
      const resultCount: number = result.count;
      totalCount = resultCount;
      if (resultCount > QUEUE_SAFE_LIMIT) {
        throw new EnrichmentQueueCapacityError("ENRICHMENT_QUEUE_SAFE_LIMIT_EXCEEDED");
      }
    }
    if (totalCount === null) {
      throw new Error("ENRICHMENT_QUEUE_COUNT_FAILED");
    }
    const page = result.data as UnknownRecord[];
    rows.push(...page);
    if (rows.length >= totalCount) return rows;
    if (page.length === 0) {
      throw new Error("ENRICHMENT_QUEUE_PAGINATION_STALLED");
    }
    offset += page.length;
  }

  throw new EnrichmentQueueCapacityError("ENRICHMENT_QUEUE_SAFE_LIMIT_EXCEEDED");
}

async function loadProgress(client: ServiceClient) {
  const progress = emptyProgress();
  const counts = await Promise.all(PROGRESS_CATEGORIES.map(async (category) => {
    const dbCategory = attributeCategoryToDb(category);
    const [totalResult, doneResult] = await Promise.all([
      client
        .from("vendors")
        .select("id", { count: "exact", head: true })
        .eq("category", dbCategory)
        .in("status", [...ACTIVE_VENDOR_STATUSES]),
      client
        .from("vendors")
        .select("id", { count: "exact", head: true })
        .eq("category", dbCategory)
        .in("status", [...ACTIVE_VENDOR_STATUSES])
        .eq("enrichment_status", "done"),
    ]);
    if (
      totalResult.error
      || doneResult.error
      || typeof totalResult.count !== "number"
      || typeof doneResult.count !== "number"
    ) {
      throw new Error("ENRICHMENT_PROGRESS_QUERY_FAILED");
    }
    return { category, total: totalResult.count, done: doneResult.count };
  }));

  for (const count of counts) {
    progress[count.category] = { done: count.done, total: count.total };
  }
  return progress;
}

export async function GET(request: Request) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await checkRateLimitPersistent(
    rateLimitKey("admin:enrichment-queue", request, userId),
    { maxRequests: 6, windowMs: 60 * 1000 },
  );
  if (limited) return limited;

  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "all";
  const status = url.searchParams.get("status") ?? "all";
  const region = url.searchParams.get("region")?.trim() ?? "";
  const mine = ["1", "true"].includes(url.searchParams.get("mine") ?? "");
  if (!CATEGORIES.has(category) || !STATUSES.has(status)) {
    return NextResponse.json({ error: "필터 값을 확인해 주세요." }, { status: 400 });
  }
  if (region && !REGION_CODE_PATTERN.test(region)) {
    return NextResponse.json({ error: "지역 필터 값을 확인해 주세요." }, { status: 400 });
  }

  try {
    const client = getServiceClient();
    const [queueRows, progress] = await Promise.all([
      loadQueue(client, { category, status, region, mine, userId }),
      loadProgress(client),
    ]);
    const vendors = queueRows.flatMap((raw) => {
      const item = raw as UnknownRecord;
      if (!ACTIVE_VENDOR_STATUSES.includes(item.status as typeof ACTIVE_VENDOR_STATUSES[number])) {
        return [];
      }
      const schemaCategory = normalizeVendorCategory(String(item.category ?? ""));
      if (!schemaCategory) return [];
      const assignee = privateAssignment(item.private);
      if (mine && assignee !== userId) return [];
      return [{
        id: item.id,
        name: item.name,
        slug: item.slug,
        category: schemaCategory,
        region_code: item.region_code,
        enrichment_status: item.enrichment_status,
        enriched_at: item.enriched_at,
        assigned_to_me: assignee === userId,
        is_assigned: assignee !== null,
      }];
    });

    const done = Object.values(progress).reduce((sum, item) => sum + item.done, 0);
    const total = Object.values(progress).reduce((sum, item) => sum + item.total, 0);
    return NextResponse.json({
      vendors,
      progress: { ...progress, all: { done, total } },
      filters: { category, status, region: region || null, mine },
    });
  } catch (caught) {
    if (caught instanceof EnrichmentQueueCapacityError) {
      return NextResponse.json(
        {
          error: "업체 보강 대기열이 안전 한도(5,000건)를 초과했습니다. 필터를 좁혀 주세요.",
          code: "ENRICHMENT_QUEUE_SAFE_LIMIT_EXCEEDED",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "업체 보강 대기열을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
