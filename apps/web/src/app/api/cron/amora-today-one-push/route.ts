import { NextResponse } from "next/server";
import { isWithinAmoraPushWindow } from "@hanbang/shared/amora-push";

import { getAmoraActions } from "@/lib/amora/actions";
import { readAmoraActionSnapshot } from "@/lib/amora/actionRepository";
import { isAmoraAppPushEnabled, sendAmoraPush, type SendAmoraPushReason } from "@/lib/amora/push/sendAmoraPush";
import { buildTodayOneScheduleCandidates } from "@/lib/care/todayOne";
import { buildTodayOneBudgetGuardrailCandidates } from "@/lib/care/todayOneBudget";
import { buildTodayOneTaskDeadlineCandidates } from "@/lib/care/todayOneMore";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/utils/log";

/**
 * 아침 "오늘의 한 가지" 앱 알림(결정 D-86, 25장 2절 "아침마다 먼저 챙긴다").
 *
 * 앱 알림과 오늘의 한 가지를 둘 다 켰고, 오늘 카드를 아직 받지 않았고(앱을 이미 열었으면 알리지 않는다), 받는 시간
 * 안인 사람(DB `list_amora_today_one_push_recipients`)에게, 저장된 일정·지출·할 일에서 오늘 고를 것이 하나라도
 * 있을 때만 "아모라가 정리한 게 있어요"를 보낸다. 카드는 앱을 열 때 지금처럼 만든다(이 길은 카드를 만들지 않는다).
 * 문의에서 생긴 줄(정할 것, 답 없는 문의)은 아직 이 알림의 이유로 쓰지 않는다(문의 기록을 서비스 열쇠로 읽는
 * 길이 없다). 그런 날은 앱을 열면 카드가 보이고 알림만 오지 않는다.
 *
 * 스위치(`AMORA_APP_PUSH_ENABLED`, `AMORA_TODAY_ONE_ENABLED`)가 꺼져 있으면 DB 에도 가지 않는다.
 * 켜는 날 `apps/web/vercel.json` 에 이 경로를 넣는다(한국 시각 09~19시 매시 5분, UTC `5 0-10 * * *`).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_RECIPIENTS = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

type Recipient = { userId: string; coupleId: string };

function parseRecipients(value: unknown): Recipient[] | null {
  if (!Array.isArray(value) || value.length > MAX_RECIPIENTS) return null;
  const recipients: Recipient[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return null;
    const { user_id: userId, couple_id: coupleId } = row as Record<string, unknown>;
    if (typeof userId !== "string" || !UUID_RE.test(userId) || typeof coupleId !== "string" || !UUID_RE.test(coupleId)) {
      return null;
    }
    recipients.push({ userId, coupleId });
  }
  return recipients;
}

async function hasSomethingToday(
  admin: ReturnType<typeof createAdminClient>,
  coupleId: string,
  now: Date,
): Promise<boolean> {
  const { data: journey, error } = await admin
    .from("wedding_journeys")
    .select("wedding_date, total_budget, progress, state_revision")
    .eq("couple_id", coupleId)
    .maybeSingle();
  if (error || !journey || typeof journey.state_revision !== "number") return false;
  const progress = journey.progress && typeof journey.progress === "object" ? journey.progress as Record<string, unknown> : {};
  const stateRevision = journey.state_revision;
  if (buildTodayOneScheduleCandidates({ weddingDate: journey.wedding_date, progress, stateRevision, now }).length > 0) return true;
  if (buildTodayOneBudgetGuardrailCandidates({ totalBudget: journey.total_budget, progress, stateRevision }).length > 0) return true;
  try {
    const snapshot = await readAmoraActionSnapshot(admin, coupleId, getAmoraActions(progress), "open");
    return buildTodayOneTaskDeadlineCandidates({ actions: snapshot.actions, stateRevision, now }).length > 0;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isAmoraAppPushEnabled() || !isAmoraTodayOneEnabled()) {
    return NextResponse.json({ ok: true, disabled: true }, { headers: NO_STORE });
  }
  const now = new Date();
  if (!isWithinAmoraPushWindow(now)) {
    return NextResponse.json({ ok: true, skipped: "quiet_hours" }, { headers: NO_STORE });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("list_amora_today_one_push_recipients", { p_limit: MAX_RECIPIENTS });
    const recipients = error ? null : parseRecipients(data);
    if (!recipients) {
      // 내용 없는 코드만 보낸다(받는 사람·커플 id 를 싣지 않음).
      log.error("cron/amora-today-one-push", new Error("AMORA_TODAY_ONE_PUSH_RECIPIENTS_UNAVAILABLE"));
      return NextResponse.json({ error: "recipients unavailable" }, { status: 503, headers: NO_STORE });
    }

    const counts: Partial<Record<SendAmoraPushReason | "nothing_today", number>> = {};
    for (const recipient of recipients) {
      const reason = await hasSomethingToday(admin, recipient.coupleId, now)
        ? (await sendAmoraPush({ userId: recipient.userId, kind: "today_one", deepLink: "home" })).reason
        : "nothing_today";
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
    return NextResponse.json({ ok: true, recipients: recipients.length, counts }, { headers: NO_STORE });
  } catch {
    log.error("cron/amora-today-one-push", new Error("AMORA_TODAY_ONE_PUSH_RUN_FAILED"));
    return NextResponse.json({ error: "run failed" }, { status: 500, headers: NO_STORE });
  }
}
