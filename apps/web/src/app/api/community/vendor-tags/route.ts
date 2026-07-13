import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { cleanOptionalText } from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:vendor-tags:list", req),
      { maxRequests: 120, windowMs: 60 * 1000 }
    );
    if (limited) return limited;

    const { searchParams } = new URL(req.url);
    const requestedLimit = Number.parseInt(
      searchParams.get("limit") ?? String(DEFAULT_LIMIT),
      10
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const category = cleanOptionalText(searchParams.get("category"), 40);

    const service = getServiceClient();
    let query = service
      .from("community_vendor_tags")
      .select("id, vendor_name, category, region, mention_count")
      .order("mention_count", { ascending: false })
      .limit(limit);

    if (category) query = query.eq("category", category);

    const { data, error } = await query;
    if (error) {
      console.error("Vendor tags list error:", error);
      return NextResponse.json(
        { error: "목록을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    const tags = (data ?? []).map((tag) => ({
      id: tag.id,
      vendor_name: tag.vendor_name,
      category: tag.category,
      region: tag.region,
      mention_count: tag.mention_count,
      // 과거 집계에는 지표별 고유 참여자 수·기간·출처 계약이 없다.
      // 호환 필드는 값을 만들어 내지 않고 명시적으로 닫아 둔다.
      avg_rating: null,
      avg_base_price: null,
      avg_extra_price: null,
      extra_rate: null,
    }));

    return NextResponse.json(
      { tags },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }
    );
  } catch (err) {
    console.error("Vendor tags error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
