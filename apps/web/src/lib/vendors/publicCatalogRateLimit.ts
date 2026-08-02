import type { NextResponse } from "next/server";

import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

const PUBLIC_VENDOR_CATALOG_RATE_LIMIT = {
  maxRequests: 120,
  windowMs: 60 * 1000,
} as const;

/**
 * List and detail share one durable bucket so endpoint fan-out cannot multiply
 * the allowance before service-role catalog queries run.
 */
export function checkPublicVendorCatalogRateLimit(
  request: Request,
): Promise<NextResponse | null> {
  return checkRateLimitPersistent(
    rateLimitKey("public-vendor-catalog", request),
    PUBLIC_VENDOR_CATALOG_RATE_LIMIT,
    { failClosed: true },
  );
}
