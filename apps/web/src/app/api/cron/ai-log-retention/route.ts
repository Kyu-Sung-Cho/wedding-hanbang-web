import { NextResponse } from "next/server";
import { log } from "@/utils/log";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
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

    // 관리자 접속기록도 같은 작업에서 지운다.
    //
    // 크론을 따로 늘리지 않는 이유: 스케줄이 늘면 `vercel.json` 이 또 바뀌고,
    // 2026-09-01 에 그 파일에서 스케줄 6개가 통째로 사라져 탈퇴 처리와 로그
    // 파기가 멈춘 일이 있었다. 파기끼리는 한 작업에 두는 편이 잃기 어렵다.
    //
    // **이 값은 처방침에 적힌 기간과 같아야 한다.** 어긋나면
    // `retentionNoticeMatchesCode.test.ts` 가 빨개진다.
    const { data: purgedAdminAccess, error: adminPurgeError } = await admin.rpc(
      "purge_admin_access_log",
      { p_retention: "365 days" },
    );
    if (
      adminPurgeError
      || typeof purgedAdminAccess !== "number"
      || !Number.isSafeInteger(purgedAdminAccess)
      || purgedAdminAccess < 0
    ) {
      // 앞의 파기는 이미 끝났다. 그 사실을 잃지 않도록 부분 성공으로 알린다.
      return NextResponse.json(
        { error: "Admin access log retention failed", redacted: data },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        enabled: true,
        status: "completed",
        redacted: data,
        purgedAdminAccess,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    log.error("api/cron/ai-log-retention", err);
    return NextResponse.json(
      { error: "AI log retention failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
