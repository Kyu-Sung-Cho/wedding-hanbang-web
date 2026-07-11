// 아모라 케어 아웃바운드 크론 — 보류 중인 과거 구현.
//
// 현재 CARE_MOMENTS_CRON_ENABLED=false이며 배포 스케줄도 등록하지 않는다.
// 설정 화면·프로필 API·DB 기본값도 별도로 opt-in을 막고 있으므로 이 파일의
// 아래 발송 구현이 존재한다는 사실을 현재 제공 기능으로 해석하면 안 된다.
// 재활성화 전에는 명시적 채널별 동의, 철회, 발송 감사, 삭제 경합과 비용 상한을
// 새로 검증해야 한다. 과거 설계는 due 모멘트(D-3/D-1/D+1)를 계산해서:
//  1) 채팅에 아모라 메시지를 먼저 넣어두고 (proactive 라우트와 동일 dedupe —
//     chat_messages 유니크 인덱스(couple_id, metadata->>client_request_id))
//  2) "이번 크론이 삽입에 성공한 커플"에게만 이메일을 보낸다.
//     → 사용자가 이미 앱에서 그 셀을 본 경우(proactive가 먼저 발화) insert가 23505로
//       실패하므로 중복 알림이 구조적으로 불가능. 알림을 눌러 채팅에 들어오면
//       같은 메시지가 대화방에 기다리고 있다 — 카톡 → 대화방 UX.
//
// 안전장치: CRON_SECRET Bearer 필수(fail-closed) / 수신 설정(care_notifications_enabled)
// 존중 / 실행당 발화 상한 / 이메일 실패는 무시(다음 날 셀이 지나면 자연 소멸 — 스팸 재시도 없음).
//
// 과거 채널 로드맵: Phase1 이메일 → Phase2 Expo 푸시(모바일 출시 시 여기에 추가)
// → Phase3 카카오 알림톡(채널 개설 후). 문구·dedupe·스케줄은 그대로 재사용.

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { buildDueMomentCells } from "@/lib/amora/momentLoop";
import { buildCareEmailSubject, buildCareEmailHtml } from "@/lib/care/careEmail";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 실행당 발화(커플) 상한 — 폭주 방어. 베타 규모(커플 수십)에선 도달 불가.
const MAX_FIRES_PER_RUN = 100;
// 조회 커플 상한 — 규모가 커지면 페이지네이션으로 전환할 것 (그 전에 이 캡이 알림).
const MAX_JOURNEYS = 500;
const CARE_MOMENTS_CRON_ENABLED = false;

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(req: NextRequest) {
  // Vercel Cron은 CRON_SECRET 환경변수가 있으면 Authorization: Bearer <값>을 자동으로 붙인다.
  // 시크릿 미설정 시에도 공개 트리거를 막기 위해 fail-closed.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!CARE_MOMENTS_CRON_ENABLED) {
    return NextResponse.json({ ok: true, disabled: true, reason: "disabled_for_safety_and_cost" });
  }

  const admin = getAdmin();
  const stats = { couples: 0, due: 0, fired: 0, alreadySent: 0, emails: 0, emailErrors: 0 };

  try {
    const { data: journeys, error: journeysError } = await admin
      .from("wedding_journeys")
      .select("couple_id, wedding_date, progress")
      .limit(MAX_JOURNEYS);

    if (journeysError) {
      console.error("[care-cron] journeys 조회 실패:", journeysError.message);
      return NextResponse.json({ error: "journeys 조회 실패" }, { status: 500 });
    }
    if ((journeys?.length ?? 0) >= MAX_JOURNEYS) {
      console.warn(`[care-cron] journeys가 캡(${MAX_JOURNEYS})에 도달 — 페이지네이션 전환 필요`);
    }

    const resendKey = process.env.RESEND_API_KEY;
    const resend = resendKey ? new Resend(resendKey) : null;

    for (const journey of journeys ?? []) {
      if (stats.fired >= MAX_FIRES_PER_RUN) break;
      stats.couples += 1;

      const dueCells = buildDueMomentCells({
        weddingDate: journey.wedding_date,
        progress: journey.progress,
      });
      if (dueCells.length === 0) continue;
      stats.due += 1;

      // 이미 발화된 셀 제외 (proactive 라우트와 동일 패턴)
      const dueKeys = dueCells.map((cell) => `moment:${cell.dedupeKey}`);
      const { data: sentRows } = await admin
        .from("chat_messages")
        .select("metadata")
        .eq("couple_id", journey.couple_id)
        .eq("sender_type", "ai")
        .in("metadata->>client_request_id", dueKeys);
      const sentKeys = new Set(
        (sentRows ?? [])
          .map((row) => (row.metadata as { client_request_id?: string } | null)?.client_request_id)
          .filter(Boolean) as string[]
      );
      const cell = dueCells.find((c) => !sentKeys.has(`moment:${c.dedupeKey}`));
      if (!cell) {
        stats.alreadySent += 1;
        continue;
      }

      // 채팅에 선삽입 — 23505(유니크 위반)면 다른 경로가 먼저 발화한 것 → 알림 생략
      const { error: insertError } = await admin.from("chat_messages").insert({
        couple_id: journey.couple_id,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: cell.message,
        visibility: "shared",
        metadata: {
          client_request_id: `moment:${cell.dedupeKey}`,
          moment: {
            dedupeKey: cell.dedupeKey,
            momentType: cell.momentType,
            cellKind: cell.cellKind,
            momentDate: cell.momentDate,
            memoryKeys: cell.memoryKeys,
            channel: "care_cron",
          },
        },
      });

      if (insertError) {
        if (insertError.code === "23505") {
          stats.alreadySent += 1;
        } else {
          console.error("[care-cron] 모멘트 insert 실패:", insertError.message);
        }
        continue;
      }
      stats.fired += 1;

      // 수신 동의된 커플 멤버에게 이메일 (최대 2명). 실패는 기록만 — 재시도 없음.
      if (!resend) continue;
      const { data: members } = await admin
        .from("profiles")
        .select("email, name, care_notifications_enabled")
        .eq("couple_id", journey.couple_id);

      for (const member of members ?? []) {
        if (member.care_notifications_enabled === false) continue;
        if (typeof member.email !== "string" || !member.email.includes("@")) continue;
        try {
          await resend.emails.send({
            from: "아모라 · 웨딩한방 <noreply@hanbang.ai>",
            to: member.email,
            subject: buildCareEmailSubject(cell),
            html: buildCareEmailHtml({ recipientName: member.name ?? null, cell }),
          });
          stats.emails += 1;
        } catch (emailErr) {
          stats.emailErrors += 1;
          console.error("[care-cron] 이메일 발송 실패:", emailErr);
        }
      }
    }

    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[care-cron] 실행 에러:", err);
    return NextResponse.json({ error: "서버 오류", ...stats }, { status: 500 });
  }
}
