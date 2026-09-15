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

function record(status: string, purged: number | null) {
  try {
    console.log(JSON.stringify({
      event: "wedding_code_research_retention_run",
      version: 1,
      occurredAt: new Date().toISOString(),
      status,
      purged,
    }));
  } catch {
    // 관측 실패로 이미 끝난 파기를 되돌리거나 응답을 바꾸지 않는다.
  }
}

/**
 * 웨딩코드 답 보태기의 보관기간(60일) 파기와 지운 삭제 코드로 남은 행 정리.
 *
 * ## 왜 `ai-log-retention` 에 얹지 않고 따로 두나
 *
 * 처음에는 거기 세 번째 단계로 얹었다가 2026-09-16 적대 검토에서 잡혔다. 그 작업은
 * `AI_LOG_RETENTION_CRON_ENABLED` 로 켜고 끄는 **다른 약속**이고, 앞 단계가 실패하면
 * 뒤 단계를 건너뛴다. 60일 약속이 무관한 스위치와 무관한 실패에 묶이면 안 된다.
 *
 * 켜는 조건은 수집 플래그가 아니라 **저장소를 지키는 스위치**(비밀값)다. 새 답을 받지
 * 않게 된 뒤에도 이미 받은 답은 60일 안에 지워져야 하기 때문이다.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  if (!isWeddingCodeResearchStorageActive()) {
    record("disabled", null);
    return NextResponse.json({ ok: true, enabled: false, status: "disabled" }, { headers: NO_STORE_HEADERS });
  }

  try {
    const { data, error } = await createAdminClient().rpc("purge_expired_wedding_code_research_contributions");
    if (error && FUNCTION_MISSING.has(error.code ?? "")) {
      // 비밀값을 DB 레인보다 먼저 넣은 경우. 지울 행도 있을 수 없다.
      record("not_applied", null);
      log.warn("[cron wedding-code research retention] purge function missing", { code: error.code });
      return NextResponse.json({ ok: true, enabled: true, status: "not_applied" }, { headers: NO_STORE_HEADERS });
    }
    if (error || typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) {
      record("failed", null);
      log.error("[cron wedding-code research retention] purge failed", { code: error?.code ?? "malformed" });
      return NextResponse.json({ error: "WeddingCode research retention failed" }, { status: 500, headers: NO_STORE_HEADERS });
    }
    record("completed", data);
    return NextResponse.json({ ok: true, enabled: true, status: "completed", purged: data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    record("failed", null);
    log.error("[cron wedding-code research retention] purge threw", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "WeddingCode research retention failed" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
