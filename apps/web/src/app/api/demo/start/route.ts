import { NextResponse } from "next/server";
import { setDemoCookies } from "@/lib/demoSession";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

function sameOriginRedirect(location: string): NextResponse {
  // Relative Location avoids trusting forwarded/Host headers and preserves the
  // exact localhost/127.0.0.1 origin that owns the demo cookies.
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

export async function POST(request: Request) {
  const limited = checkRateLimit(rateLimitKey("demo-start", request), {
    maxRequests: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (limited) {
    const response = sameOriginRedirect("/demo/login?error=rate_limited");
    const retryAfter = limited.headers.get("Retry-After");
    if (retryAfter) response.headers.set("Retry-After", retryAfter);
    return response;
  }

  const response = sameOriginRedirect("/wedding/lounge");
  if (!setDemoCookies(response)) {
    return sameOriginRedirect("/demo/login?error=unavailable");
  }
  return response;
}
