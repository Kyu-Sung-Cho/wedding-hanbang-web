import { NextRequest, NextResponse } from "next/server";
import { isAmoraTasksEnabled } from "@/lib/amoraTasks/config";
import { amoraTaskFailure } from "@/lib/amoraTasks/report";
import { AMORA_TASK_CRON_BUDGET, createAmoraTaskWorkerDeps } from "@/lib/amoraTasks/taskRuntime";
import { runAmoraTaskWorker } from "@/lib/amoraTasks/taskWorker";
import { log } from "@/utils/log";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 아모라가 맡은 일의 일꾼(2분마다, `apps/web/vercel.json`).
 *
 * 한 번에 몇 걸음씩만 나아가고 진행을 저장한다. 다음 차례가 저장된 진행에서 잇는다.
 * 스위치(`AMORA_TASKS_ENABLED`)가 꺼져 있으면 아무것도 잡지 않는다. 대기열의 일은 그대로 남고, 켜면 이어진다.
 * 맡은 일은 읽기·찾기·정리·초안만 한다. 쓰기 도구는 이 길에 없다(`lib/amoraTasks/taskTools.ts`).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAmoraTasksEnabled()) {
    return NextResponse.json({ ok: true, enabled: false, claimed: 0 });
  }
  try {
    const stats = await runAmoraTaskWorker(createAmoraTaskWorkerDeps(), AMORA_TASK_CRON_BUDGET);
    return NextResponse.json({ ok: true, enabled: true, ...stats });
  } catch (error) {
    log.error("[amora-tasks-cron] run failed", amoraTaskFailure("AMORA_TASKS_CRON_FAILED", error));
    return NextResponse.json({ error: "task queue unavailable" }, { status: 503 });
  }
}
