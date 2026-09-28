import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanupProviderMedia } from "@/lib/providers/mediaCleanup";
import { log } from "@/utils/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  try {
    const result = await cleanupProviderMedia(createAdminClient({ requestTimeoutMs: 20_000 }));
    if (result.pending) log.error("provider-media/cleanup", new Error("PROVIDER_CLEANUP_RETRY_REQUIRED"));
    return NextResponse.json({ ok: result.pending === 0, ...result }, { status: result.pending ? 503 : 200, headers });
  } catch {
    log.error("provider-media/cleanup", new Error("PROVIDER_CLEANUP_UNAVAILABLE"));
    return NextResponse.json({ error: "provider media cleanup unavailable" }, { status: 503, headers });
  }
}
