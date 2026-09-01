import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { log } from "@/utils/log";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 업체 수요 랭킹 (관리자 전용) — events 원장을 pg_cron이 일별 롤업한
// vendor_demand_daily(impressions·detail_views·wishlist_adds·combo_adds·
// quote_requests·weighted_score·qualified_score)를 기간 합산해 보여준다.
// qualified_score = 예식일을 등록한 실준비 커플의 가중 행동만 집계한 점수 —
// 업체 제휴 대화에서 가장 정직하고 강한 수치다.
const CATEGORY_FILTERS = new Set(["studio", "dress", "makeup", "venue"]);
const MAX_ROWS = 60_000;
const PAGE = 1_000;

type DemandRow = {
  vendor_id: string;
  impressions: number;
  detail_views: number;
  wishlist_adds: number;
  combo_adds: number;
  quote_requests: number;
  weighted_score: number;
  qualified_score: number;
};

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
        .select("vendor_id, impressions, detail_views, wishlist_adds, combo_adds, quote_requests, weighted_score, qualified_score")
        .gte("day", cutoff)
        .order("vendor_id", { ascending: true })
        .order("day", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as DemandRow[]));
      if (!data || data.length < PAGE) break;
    }

    const byVendor = new Map<string, Omit<DemandRow, "vendor_id">>();
    for (const row of rows) {
      const bucket = byVendor.get(row.vendor_id) ?? {
        impressions: 0, detail_views: 0, wishlist_adds: 0,
        combo_adds: 0, quote_requests: 0, weighted_score: 0, qualified_score: 0,
      };
      bucket.impressions += Number(row.impressions);
      bucket.detail_views += Number(row.detail_views);
      bucket.wishlist_adds += Number(row.wishlist_adds);
      bucket.combo_adds += Number(row.combo_adds);
      bucket.quote_requests += Number(row.quote_requests);
      bucket.weighted_score += Number(row.weighted_score);
      bucket.qualified_score += Number(row.qualified_score);
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
        return [{
          vendor_id: vendorId,
          ...vendor,
          ...metrics,
          weighted_score: Math.round(metrics.weighted_score * 10) / 10,
          qualified_score: Math.round(metrics.qualified_score * 10) / 10,
        }];
      })
      .sort((left, right) => right.weighted_score - left.weighted_score
        || right.detail_views - left.detail_views)
      .slice(0, 100);

    return NextResponse.json({ days, category, rows: result });
  } catch (err) {
    log.error("api/admin/price/demand", err);
    return NextResponse.json({ error: "수요 데이터를 불러오지 못했습니다." }, { status: 503 });
  }
}

// 당일/특정일 즉시 롤업 — pg_cron(매일 04:00 KST, 전일분)을 기다리지 않고
// 미팅 직전 최신 수치를 뽑을 때 사용.
const aggregateSchema = z.strictObject({
  action: z.literal("aggregate"),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "요청 출처를 확인할 수 없습니다." }, { status: 403 });
  }
  const admin = await verifyAdmin(request);
  if (!admin.authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await readBoundedUtf8Text(request, 1_024);
  if (!body.ok) return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  let input: z.infer<typeof aggregateSchema>;
  try {
    const parsed = aggregateSchema.safeParse(JSON.parse(body.text));
    if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const { data, error } = await getServiceClient().rpc(
      "aggregate_vendor_demand_daily",
      input.day ? { p_day: input.day } : {},
    );
    if (error) throw new Error(error.message);
    return NextResponse.json({ aggregated_vendors: data ?? 0, day: input.day ?? "KST 어제" });
  } catch (err) {
    log.error("api/admin/price/demand", err);
    return NextResponse.json({ error: "집계 실행에 실패했습니다." }, { status: 503 });
  }
}
