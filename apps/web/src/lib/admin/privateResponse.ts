import { NextResponse as FrameworkNextResponse } from "next/server";

const PRIVATE_NO_STORE = "private, no-store";

function json(
  body: unknown,
  init: ResponseInit = {},
): ReturnType<typeof FrameworkNextResponse.json> {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", PRIVATE_NO_STORE);
  return FrameworkNextResponse.json(body, { ...init, headers });
}

/**
 * Admin JSON responses can contain unpublished prices, evidence metadata, and
 * internal enrichment notes. Keep the familiar NextResponse.json call shape
 * while making the privacy header impossible to omit in an individual branch.
 */
export const AdminNextResponse = { json } as const;

