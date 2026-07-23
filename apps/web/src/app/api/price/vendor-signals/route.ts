import { NextResponse } from "next/server";
import { z } from "zod";

import { getServiceClient } from "@/lib/utils/adminAuth";
import { readBoundedUtf8Text } from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 업체 수요 신호 수집 (공개 비컨) — 업체×지표 카운터만 증가시키며 개인 정보는
// 받지도 저장하지도 않는다. 실패 응답도 본문 없이 최소화(fire-and-forget 계약).
const MAX_BODY_BYTES = 8 * 1024;

const eventSchema = z.strictObject({
  vendor_id: z.string().uuid(),
  metric: z.enum(["impression", "detail_click", "detail_view", "wishlist_add", "combo_add"]),
});
const bodySchema = z.strictObject({
  events: z.array(eventSchema).min(1).max(50),
});

export async function POST(request: Request) {
  const limited = await checkRateLimitPersistent(rateLimitKey("vendor-signals", request), {
    maxRequests: 60,
    windowMs: 5 * 60 * 1000,
  });
  if (limited) return limited;

  const body = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!body.ok) return new NextResponse(null, { status: 204 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw: unknown = JSON.parse(body.text);
    const result = bodySchema.safeParse(raw);
    if (!result.success) return new NextResponse(null, { status: 204 });
    parsed = result.data;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  try {
    await getServiceClient().rpc("record_vendor_demand", { p_events: parsed.events });
  } catch {
    // 집계 실패는 사용자 흐름과 무관 — 조용히 무시.
  }
  return new NextResponse(null, { status: 204 });
}
