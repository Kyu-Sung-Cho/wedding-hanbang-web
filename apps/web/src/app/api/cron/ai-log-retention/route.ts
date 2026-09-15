import { NextResponse } from "next/server";
import {
  createRetentionRunLog,
  type RetentionRunStep,
} from "@/lib/compliance/retentionRunLog";

import { createAdminClient } from "@/lib/supabase/admin";
import { isWeddingCodeResearchContributionOpen } from "@/lib/weddingCode/contribution/server";

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

  const enabled = process.env.AI_LOG_RETENTION_CRON_ENABLED === "true";
  const recordRun = createRetentionRunLog(enabled);
  if (!enabled) {
    recordRun({ status: "disabled" });
    return NextResponse.json(
      { ok: true, enabled: false, status: "disabled" },
      { headers: NO_STORE_HEADERS },
    );
  }

  recordRun({ status: "started" });
  let step: RetentionRunStep = "client";
  let redacted: number | null = null;
  try {
    const admin = createAdminClient();
    step = "ai_interactions";
    const { data, error } = await admin.rpc("redact_old_ai_interactions", {
      p_retention: "90 days",
    });
    if (
      error
      || typeof data !== "number"
      || !Number.isSafeInteger(data)
      || data < 0
    ) {
      recordRun({ status: "failed", failedStep: step });
      return NextResponse.json(
        { error: "AI log retention failed" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
    redacted = data;

    // 관리자 접속기록도 같은 작업에서 지운다.
    //
    // 크론을 따로 늘리지 않는 이유: 스케줄이 늘면 `vercel.json` 이 또 바뀌고,
    // 2026-09-01 에 그 파일에서 스케줄 6개가 통째로 사라져 탈퇴 처리와 로그
    // 파기가 멈춘 일이 있었다. 파기끼리는 한 작업에 두는 편이 잃기 어렵다.
    //
    // **이 값은 처방침에 적힌 기간과 같아야 한다.** 어긋나면
    // `retentionNoticeMatchesCode.test.ts` 가 빨개진다.
    step = "admin_access";
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
      recordRun({ status: "partial", failedStep: step, redacted });
      return NextResponse.json(
        { error: "Admin access log retention failed", redacted: data },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // 웨딩코드 답 보태기는 보낸 날부터 60일이 상한이다(처리방침 제3조). 받는 동안에만
    // 테이블이 있다고 확정할 수 있으므로 같은 스위치로 켠다. 보태기 RPC 도 넣을 때마다
    // 만료분을 지우지만, 한동안 아무도 안 보내면 그 청소가 멈추므로 여기서 매일 지운다.
    let purgedWeddingCodeResearch: number | undefined;
    if (isWeddingCodeResearchContributionOpen()) {
      step = "wedding_code_research";
      const { data: purged, error: researchPurgeError } = await admin.rpc(
        "purge_expired_wedding_code_research_contributions",
      );
      if (
        researchPurgeError
        || typeof purged !== "number"
        || !Number.isSafeInteger(purged)
        || purged < 0
      ) {
        recordRun({ status: "partial", failedStep: step, redacted, purgedAdminAccess });
        return NextResponse.json(
          { error: "WeddingCode research retention failed", redacted: data, purgedAdminAccess },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }
      purgedWeddingCodeResearch = purged;
    }

    recordRun({ status: "completed", redacted, purgedAdminAccess, purgedWeddingCodeResearch });
    return NextResponse.json(
      {
        ok: true,
        enabled: true,
        status: "completed",
        redacted: data,
        purgedAdminAccess,
        ...(purgedWeddingCodeResearch === undefined ? {} : { purgedWeddingCodeResearch }),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    recordRun({
      status: redacted === null ? "failed" : "partial",
      failedStep: step,
      redacted: redacted ?? undefined,
    });
    return NextResponse.json(
      redacted === null
        ? { error: "AI log retention failed" }
        : step === "wedding_code_research"
          ? { error: "WeddingCode research retention failed", redacted }
          : { error: "Admin access log retention failed", redacted },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
