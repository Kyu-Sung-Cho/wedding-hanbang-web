import { NextResponse } from "next/server";
import { z } from "zod";

import { lookupPublishedVendorPrices } from "@/lib/admin/priceUploadLookup";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInternalVendorRequest } from "@/lib/vendors/internalAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  category: z.enum(["studio", "dress", "makeup", "hall"]).optional(),
}).strict();

export async function GET(request: Request) {
  if (!verifyInternalVendorRequest(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    category: url.searchParams.get("category") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid price lookup request" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const client = createAdminClient();
    const result = await lookupPublishedVendorPrices(client, {
      query: parsed.data.q,
      category: parsed.data.category,
    });
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Price lookup unavailable" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
