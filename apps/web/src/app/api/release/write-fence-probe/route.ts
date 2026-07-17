import { NextResponse } from "next/server";

/**
 * This endpoint never writes. In production-fence verification a POST must be
 * intercepted by `proxy.ts` first and return 503. Reaching this handler proves
 * that the deployed unsafe-method fence is not active.
 */
export async function POST() {
  return NextResponse.json(
    { error: "production_write_fence_not_active" },
    {
      status: 409,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
