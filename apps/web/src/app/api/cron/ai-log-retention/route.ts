import { NextResponse } from "next/server";

import { verifySecretBearerRequest } from "@/lib/auth/secretBearer";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!verifySecretBearerRequest(request, process.env.CRON_SECRET)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  if (process.env.AI_LOG_RETENTION_CRON_ENABLED !== "true") {
    return NextResponse.json(
      { ok: true, enabled: false, status: "disabled" },
      { headers: NO_STORE_HEADERS },
    );
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("redact_old_ai_interactions", {
      p_retention: "90 days",
    });
    if (
      error
      || typeof data !== "number"
      || !Number.isSafeInteger(data)
      || data < 0
    ) {
      return NextResponse.json(
        { error: "AI log retention failed" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { ok: true, enabled: true, status: "completed", redacted: data },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "AI log retention failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
