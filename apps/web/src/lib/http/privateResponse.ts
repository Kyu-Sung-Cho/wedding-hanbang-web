import { NextResponse as FrameworkNextResponse } from "next/server";

export const PRIVATE_NO_STORE_CACHE_CONTROL =
  "private, no-store, max-age=0, must-revalidate";

function json(
  body: unknown,
  init: ResponseInit = {},
): ReturnType<typeof FrameworkNextResponse.json> {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
  return FrameworkNextResponse.json(body, { ...init, headers });
}

/**
 * Authenticated JSON must never be reusable across users, including when a
 * future proxy or platform cache is added in front of the route handler.
 */
export const PrivateNextResponse = { json } as const;
