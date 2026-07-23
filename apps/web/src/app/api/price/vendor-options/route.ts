import { NextResponse } from "next/server";

import { optionFromRow, type PublicOptionRow } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 목록 카드의 "추가금" 펼침 시 옵션 본문(원문 인용 포함)을 지연 로드하는 공개 API.
// 이미 공개된 뷰(v_public_official_price_options)의 읽기 전용 재노출이며,
// 목록 첫 전송에서 옵션 11k개를 빼기 위한 다이어트 짝꿍이다.
const MAX_IDS = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(request: Request) {
  const limited = checkRateLimit(rateLimitKey("vendor-options", request), {
    maxRequests: 240,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_IDS || ids.some((id) => !UUID_RE.test(id))) {
    return NextResponse.json({ error: "ids 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const { data, error } = await createPublicClient()
      .from("v_public_official_price_options")
      .select("id, official_price_id, name, price_min_krw, price_max_krw, unit, condition, raw_text, is_effectively_mandatory, sort_order")
      .in("official_price_id", ids)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(0, 999);
    if (error) throw new Error(error.message);

    const options = ((data ?? []) as PublicOptionRow[]).flatMap((row) => {
      const option = optionFromRow(row);
      return option ? [{ ...option, officialPriceId: row.official_price_id }] : [];
    });
    return NextResponse.json(
      { options },
      // 발행 주기가 분기 단위라 CDN에 하루 캐시해도 안전하다.
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch {
    return NextResponse.json({ error: "옵션을 불러오지 못했습니다." }, { status: 503 });
  }
}
