import { NextResponse } from "next/server";

import { loadCurrentPublishedPriceExport } from "@/lib/admin/priceUploadExport";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const admin = await verifyAdmin(request);
  if (!admin.authorized || !admin.userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  const limited = await checkRateLimitPersistent(
    rateLimitKey("admin:price-export", request, admin.userId),
    { maxRequests: 6, windowMs: 60 * 1000 },
  );
  if (limited) return limited;
  try {
    const exported = await loadCurrentPublishedPriceExport(getServiceClient());
    return NextResponse.json(exported, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Disposition": 'attachment; filename="wedding-hanbang-current-prices.json"',
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Price export unavailable" },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
