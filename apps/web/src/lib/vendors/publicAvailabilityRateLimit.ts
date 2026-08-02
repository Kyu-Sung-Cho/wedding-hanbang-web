import type { NextResponse } from "next/server";

import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

const PUBLIC_BOOKING_AVAILABILITY_RATE_LIMIT = {
  maxRequests: 30,
  windowMs: 60 * 1000,
} as const;

/**
 * All anonymous routes that scan booking occupancy share one persistent IP
 * bucket so callers cannot multiply the allowance by switching endpoints.
 */
export function checkPublicBookingAvailabilityRateLimit(
  request: Request,
): Promise<NextResponse | null> {
  return checkRateLimitPersistent(
    rateLimitKey("public-booking-availability", request),
    PUBLIC_BOOKING_AVAILABILITY_RATE_LIMIT,
    { failClosed: true },
  );
}
