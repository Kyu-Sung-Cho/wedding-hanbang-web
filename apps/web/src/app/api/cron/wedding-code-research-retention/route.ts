import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isWeddingCodeResearchStorageActive } from "@/lib/weddingCode/contribution/server";
import { log } from "@/utils/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
/** DB 레인이 아직 적용되지 않아 함수가 없을 때 PostgREST·PostgreSQL이 내는 코드. */
const FUNCTION_MISSING = new Set(["PGRST202", "42883"]);

function record(status: string, purged: number | null, lane = "research") {
  try {
    console.log(JSON.stringify({
      event: lane === "36" ? "wedding_code36_retention_run" : "wedding_code_research_retention_run",
      version: 1,
      occurredAt: new Date().toISOString(),
      status,
      purged,
    }));
  } catch {
    // 관측 실패로 이미 끝난 파기를 되돌리거나 응답을 바꾸지 않는다.
  }
}

type PurgeResult = { status: "disabled" | "not_applied" | "completed" | "failed"; purged?: number };

async function purgeResearch(): Promise<PurgeResult> {
  if (!isWeddingCodeResearchStorageActive()) {
    record("disabled", null);
    return { status: "disabled" };
  }

  try {
    const { data, error } = await createAdminClient().rpc("purge_expired_wedding_code_research_contributions");
    if (error && FUNCTION_MISSING.has(error.code ?? "")) {
      // 비밀값을 DB 레인보다 먼저 넣은 경우. 지울 행도 있을 수 없다.
      record("not_applied", null);
      log.warn("[cron wedding-code research retention] purge function missing", { code: error.code });
      return { status: "not_applied" };
    }
    if (error || typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) {
      record("failed", null);
      log.error("[cron wedding-code research retention] purge failed", { code: error?.code ?? "malformed" });
      return { status: "failed" };
    }
    record("completed", data);
    return { status: "completed", purged: data };
  } catch (error) {
    record("failed", null);
    log.error("[cron wedding-code research retention] purge threw", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return { status: "failed" };
  }
}

async function purge36(): Promise<PurgeResult> {
  try {
    const { data, error } = await createAdminClient().rpc("wc36_purge_expired");
    const count = data !== null && typeof data === "object" && !Array.isArray(data) ? data.deleted_count : undefined;
    if (error || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      record("failed", null, "36");
      log.error("[cron wedding-code36 retention] purge failed", { code: error?.code ?? "malformed" });
      return { status: "failed" };
    }
    record("completed", count, "36");
    return { status: "completed", purged: count };
  } catch (error) {
    record("failed", null, "36");
    log.error("[cron wedding-code36 retention] purge threw", { name: error instanceof Error ? error.name : "unknown" });
    return { status: "failed" };
  }
}

/** 두 파기 작업은 서로의 수집 스위치나 실패와 무관하게 실행한다. */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  const research = await purgeResearch();
  const weddingCode36 = await purge36();
  if (research.status === "failed" || weddingCode36.status === "failed") {
    const error = research.status === "failed" ? "WeddingCode research retention failed" : "WeddingCode 36 retention failed";
    return NextResponse.json({ error, research, weddingCode36 }, { status: 500, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json({ ok: true, enabled: research.status !== "disabled", ...research, weddingCode36 }, { headers: NO_STORE_HEADERS });
}
