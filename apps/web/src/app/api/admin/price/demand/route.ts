import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 업체 수요 랭킹 (관리자 전용) — vendor_demand_daily 집계.
// 업체 제휴 대화용 근거: 기간별 조회·클릭·상세·찜·조합 수치.
const METRICS = ["impression", "detail_click", "detail_view", "wishlist_add", "combo_add"] as const;
type Metric = (typeof METRICS)[number];
const CATEGORY_FILTERS = new Set(["studio", "dress", "makeup", "venue"]);
const MAX_ROWS = 40_000;
const PAGE = 1_000;

type DemandRow = { vendor_id: string; metric: Metric; count: number };

export async function GET(request: Request) {
  const admin = await verifyAdmin(request);
  if (!admin.authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get("days") ?? "30");
  const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30;
  const categoryParam = url.searchParams.get("category") ?? "";
  const category = CATEGORY_FILTERS.has(categoryParam) ? categoryParam : null;

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const client = getServiceClient();

  try {
    const rows: DemandRow[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await client
        .from("vendor_demand_daily")
        .select("vendor_id, metric, count")
        .gte("day", cutoff)
        .order("vendor_id", { ascending: true })
        .order("day", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as DemandRow[]));
      if (!data || data.length < PAGE) break;
    }

    const byVendor = new Map<string, Record<Metric, number>>();
    for (const row of rows) {
      const bucket = byVendor.get(row.vendor_id)
        ?? { impression: 0, detail_click: 0, detail_view: 0, wishlist_add: 0, combo_add: 0 };
      bucket[row.metric] += Number(row.count);
      byVendor.set(row.vendor_id, bucket);
    }
    if (byVendor.size === 0) return NextResponse.json({ days, category, rows: [] });

    const vendorIds = [...byVendor.keys()];
    const vendors = new Map<string, { name: string; category: string; region_code: string | null }>();
    for (let index = 0; index < vendorIds.length; index += 200) {
      const chunk = vendorIds.slice(index, index + 200);
      const { data, error } = await client
        .from("vendors")
        .select("id, name, category, region_code")
        .in("id", chunk);
      if (error) throw new Error(error.message);
      for (const vendor of data ?? []) {
        vendors.set(vendor.id, {
          name: vendor.name,
          category: vendor.category,
          region_code: vendor.region_code ?? null,
        });
      }
    }

    const result = vendorIds
      .flatMap((vendorId) => {
        const vendor = vendors.get(vendorId);
        if (!vendor) return [];
        if (category && vendor.category !== category) return [];
        const metrics = byVendor.get(vendorId)!;
        const total = METRICS.reduce((sum, metric) => sum + metrics[metric], 0);
        return [{ vendor_id: vendorId, ...vendor, ...metrics, total }];
      })
      .sort((left, right) => right.total - left.total)
      .slice(0, 100);

    return NextResponse.json({ days, category, rows: result });
  } catch {
    return NextResponse.json({ error: "수요 데이터를 불러오지 못했습니다." }, { status: 503 });
  }
}
