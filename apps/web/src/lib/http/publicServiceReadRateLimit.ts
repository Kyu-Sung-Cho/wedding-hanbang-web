import type { NextResponse } from "next/server";

import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

export type PublicServiceReadScope =
  | "community-vendor-tags"
  | "published-quote-result";

export function checkPublicServiceReadRateLimit(
  request: Request,
  scope: PublicServiceReadScope,
): Promise<NextResponse | null> {
  return checkRateLimitPersistent(
    rateLimitKey(`public-service-read:${scope}`, request),
    { maxRequests: 60, windowMs: 60 * 1000 },
    { failClosed: true },
  );
}
