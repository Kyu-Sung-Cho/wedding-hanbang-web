import { NextResponse } from "next/server";
import { setDemoCookies } from "@/lib/demoSession";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

export async function POST(request: Request) {
  const limited = checkRateLimit(rateLimitKey("demo-start", request), {
    maxRequests: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (limited) return limited;

  const response = NextResponse.json({ success: true });
  if (!setDemoCookies(response)) {
    return NextResponse.json({ error: "데모 세션 설정을 사용할 수 없습니다." }, { status: 500 });
  }
  return response;
}
