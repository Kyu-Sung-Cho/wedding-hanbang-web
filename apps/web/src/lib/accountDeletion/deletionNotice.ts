import type { SupabaseClient } from "@supabase/supabase-js";

import { CONTACT } from "@/lib/constants/contact";
import { log } from "@/utils/log";

/**
 * **삭제 결과를 알린다.**
 *
 * 「개인정보 보호법」 제36조 제2항이 "조치를 한 후 그 결과를 정보주체에게 알려야
 * 한다"고 하고, 시행령 제43조 제3항이 **요구를 받은 날부터 10일 이내**로 기한을
 * 정한다. 이 저장소의 탈퇴 경로에는 그 발송이 **0줄**이었다 — 사용자는 탈퇴를
 * 누르면 즉시 로그아웃되고 그 뒤로 자기 요청이 어떻게 됐는지 알 방법이 없었다.
 *
 * ## 왜 여기서, 이 순서로
 *
 * 가입 이메일은 `auth.users` 에만 있고 삭제와 함께 사라진다. 그래서 워커가
 * `deleteUser` **직전**에 주소를 job 행에 못 박고(`pin_account_deletion_notice_email`),
 * `finalize` **뒤**에 이 함수를 부른다. 순서가 반대면 "지웠다"고 말해 놓고
 * 실패할 수 있다.
 *
 * ## 실패하면
 *
 * **삭제를 되돌리지 않는다.** 통지 실패로 삭제가 멈추면 사용자는 지워지지도
 * 않고 연락도 못 받는다 — 둘 다 잃는 쪽이 더 나쁘다. 다음 크론이 최대 3회까지
 * 다시 시도하고, 상한에 닿으면 DB 가 주소를 스스로 버린다.
 *
 * 새 인프라를 만들지 않았다. 가입·비밀번호 재설정이 이미 쓰는 Resend 경로를
 * 그대로 쓴다. `notification_delivery_outbox` 는 못 쓴다 — Expo 푸시 전용이고
 * `recipient_id` 가 `auth.users` 를 CASCADE 로 참조해서 계정이 지워지는 바로 그
 * 순간 행이 함께 사라진다.
 */
export async function sendAccountDeletionNotice(
  admin: SupabaseClient,
  jobId: string,
): Promise<"sent" | "retry" | "gave_up" | "skipped"> {
  // **이 함수는 절대 던지지 않는다.**
  //
  // 부르는 자리가 워커의 try 블록 안이라, 여기서 던지면 **이미 완료된 삭제가
  // `retry` 로 바뀌어** 지워진 사용자를 두고 사가 전체가 다시 돈다. 처음 배선할
  // 때 실제로 그렇게 만들었고 워커 테스트가 잡았다. 통지 실패의 대가는 "연락을
  // 못 받는다" 여야지 "삭제가 안 끝난다" 가 되면 안 된다.
  type NoticeRow = { notice_email?: unknown; notice_sent_at?: unknown };
  let data: NoticeRow | null = null;
  try {
    const result = await admin
      .from("account_deletion_jobs")
      .select("notice_email, notice_sent_at")
      .eq("id", jobId)
      .maybeSingle();
    if (result.error) return "skipped";
    data = (result.data ?? null) as NoticeRow | null;
  } catch {
    return "skipped";
  }

  if (!data) return "skipped";
  if (data.notice_sent_at) return "skipped";
  const email = typeof data.notice_email === "string" ? data.notice_email : null;
  if (!email) return "skipped";

  let sent = false;
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      // 키가 없으면 보낼 수 없다. 조용히 넘기면 법이 요구하는 통지가 **한 번도
      // 안 나가는데 아무도 모르는** 상태가 된다.
      log.error(
        "[account-deletion] RESEND_API_KEY missing; the legally required deletion notice cannot be sent",
        new Error("account_deletion_notice_transport_missing"),
      );
    } else {
      const { Resend } = await import("resend");
      const result = await new Resend(apiKey).emails.send({
        from: "웨딩한방 <noreply@hanbang.ai>",
        to: email,
        subject: "웨딩한방 계정 삭제가 완료됐어요",
        html: buildNoticeHtml(),
      });
      sent = !result.error;
      if (result.error) {
        log.error(
          "[account-deletion] deletion notice send failed",
          new Error("account_deletion_notice_send_failed"),
        );
      }
    }
  } catch (err) {
    log.error("[account-deletion] deletion notice threw", err);
  }

  let outcome: unknown = null;
  try {
    outcome = (await admin.rpc("record_account_deletion_notice", {
      p_job_id: jobId,
      p_sent: sent,
    })).data;
  } catch {
    return "retry";
  }
  const result = typeof outcome === "string" ? outcome : "retry";
  if (result === "gave_up") {
    // 세 번 실패했다. 주소는 버렸고, 그 사람은 통지를 못 받았다. 조용히 끝나면
    // 안 되는 자리다.
    log.error(
      "[account-deletion] gave up on the deletion notice after 3 attempts",
      new Error("account_deletion_notice_gave_up"),
    );
  }
  return result === "sent" || result === "gave_up" || result === "retry"
    ? result
    : "skipped";
}

/**
 * 통지 본문.
 *
 * 문구를 새로 짓지 않는다 — 처리방침·약관이 이미 말하는 사실만 적는다.
 * 무엇이 지워졌고 무엇이 남는지는 이미 탈퇴 전에 화면이 알렸으므로 여기서
 * 다시 나열하지 않고, **조치를 했다는 사실**과 문의 창구만 담는다(시행령
 * 제43조 3항이 요구하는 것이 그것이다).
 */
function buildNoticeHtml(): string {
  return `
    <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
      <div style="text-align: center; margin-bottom: 32px;">
        <img src="https://hanbang.ai/images/logo-512-transparent.png" alt="웨딩한방" width="64" height="64" style="width: 64px; height: 64px; object-fit: contain;" />
      </div>
      <h1 style="font-size: 24px; font-weight: 300; color: #1A1A1F; text-align: center; margin-bottom: 16px;">
        계정 삭제가 완료됐어요
      </h1>
      <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; margin-bottom: 24px;">
        요청하신 계정 삭제 처리를 마쳤습니다. 계정과 로그인 정보, 프로필, 올리신 사진과 첨부 파일을 지웠어요.
      </p>
      <p style="font-size: 15px; color: #4A4A52; line-height: 1.7; margin-bottom: 24px;">
        연결된 파트너가 있었다면, 두 분이 함께 만든 준비 기록과 대화는 남은 분의 화면에 그대로 유지되고 회원님의 식별 정보만 제거됐습니다.
      </p>
      <p style="font-size: 13px; color: #8B857C; line-height: 1.7;">
        이 안내는 개인정보 보호법 제36조에 따라 처리 결과를 알려 드리는 메일이며, 회신하지 않으셔도 됩니다.
        문의가 있으시면 <a href="mailto:${CONTACT.email}" style="color: #8B857C;">${CONTACT.email}</a> 로 연락 주세요.
      </p>
    </div>
  `;
}
