import type { NextResponse } from "next/server";

import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

const ADMIN_READ_RATE_LIMIT = {
  maxRequests: 30,
  windowMs: 60 * 1000,
} as const;

const MAX_ADMIN_PAGE = 100;

export type AdminReadScope =
  | "admins"
  | "bookings"
  | "customers"
  | "price-dedupe"
  | "price-review"
  | "price-source"
  | "price-upload-confirmations"
  | "registrations"
  | "reports"
  | "vendor-enrichment-detail"
  | "vendors";

export type AdminMutationScope =
  | "post-moderation"
  | "post-pin"
  | "price-dedupe-decision"
  | "price-review-update"
  | "price-upload-confirmation"
  | "report-moderation"
  | "vendor-enrichment-assign"
  | "vendor-enrichment-save";

export interface AdminPagination {
  page: number;
  limit: number;
  offset: number;
}

export function checkAdminReadRateLimit(
  request: Request,
  userId: string,
  scope: AdminReadScope,
): Promise<NextResponse | null> {
  return checkRateLimitPersistent(
    rateLimitKey(`admin:read:${scope}`, request, userId),
    ADMIN_READ_RATE_LIMIT,
    { failClosed: true },
  );
}

export function checkAdminMutationRateLimit(
  request: Request,
  userId: string,
  scope: AdminMutationScope,
): Promise<NextResponse | null> {
  return checkRateLimitPersistent(
    rateLimitKey(`admin:mutation:${scope}`, request, userId),
    { maxRequests: 60, windowMs: 60 * 60 * 1000 },
    { failClosed: true },
  );
}

function parsePositiveInteger(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Reject, rather than clamp, attacker-controlled offsets. This keeps the
 * database from evaluating unexpectedly deep OFFSET queries.
 */
export function parseAdminPagination(
  request: Request,
  options: { defaultLimit: number; maxLimit: number },
): AdminPagination | null {
  const url = new URL(request.url);
  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const limit = parsePositiveInteger(url.searchParams.get("limit"), options.defaultLimit);

  if (
    page === null
    || limit === null
    || page > MAX_ADMIN_PAGE
    || limit > options.maxLimit
  ) {
    return null;
  }

  return { page, limit, offset: (page - 1) * limit };
}

export function adminPaginationMetadata(
  pagination: AdminPagination,
  returned: number,
  total: number,
) {
  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    truncated: pagination.offset + returned < total,
  };
}
