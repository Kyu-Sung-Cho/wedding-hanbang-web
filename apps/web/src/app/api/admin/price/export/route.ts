import { NextResponse } from "next/server";
import { log } from "@/utils/log";

import { loadCurrentPublishedPriceExport } from "@/lib/admin/priceUploadExport";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const admin = await verifyAdmin(request);
  if (!admin.authorized) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const exported = await loadCurrentPublishedPriceExport(getServiceClient());
    return NextResponse.json(exported, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Disposition": 'attachment; filename="wedding-hanbang-current-prices.json"',
      },
    });
  } catch (err) {
    log.error("api/admin/price/export", err);
    return NextResponse.json(
      { error: "Price export unavailable" },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
