import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { apiError, privateJson } from "@/lib/invitation/http";
import { parseDispatchRow, parseStoredShares } from "@/lib/invitation/inquiryRepository";
import { inquiryDailyCap, inquiryGlobalDailyCap, isInquirySendingEnabled } from "@/lib/invitation/switches";
import { isRecord } from "@/utils/requestValidation";
import { log } from "@/utils/log";

/**
 * 운영자 대기열(W4 파일럿). 커플이 승인한 편지만 여기에 온다. 운영자는 업체의 공식 문의 창구로 직접 보내고
 * 보냈다고 표시한 뒤, 답장 원문과 정해진 칸을 적는다. 이 시스템은 메일·문자를 보내지 않는다(D-75).
 *
 * 편지 글과 알려줄 정보는 대기 중인 줄에만 보인다. 문의 스위치가 꺼져 있으면 대기 중인 줄의 글도 가린다
 * — 멈춘 동안 새로 보내지 않게 하기 위해서다. 이미 보낸 줄은 표시만 한다.
 * 한 사람이 탈퇴하면 DB 가 그 커플의 대기 줄을 거둬들이고(withdrawn) 글을 지운다. 거둬들인 줄은 여기에 오지 않는다.
 */

export const dynamic = "force-dynamic";

const SENT_WINDOW_DAYS = 30;

export async function GET(request: Request) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) return apiError(401, "ADMIN_REQUIRED", "관리자만 볼 수 있어요.");
  try {
    const client = getServiceClient();
    const sendingEnabled = isInquirySendingEnabled();
    const cap = inquiryDailyCap();
    const globalCap = inquiryGlobalDailyCap();
    const since = new Date(Date.now() - SENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [queuedResult, sentResult] = await Promise.all([
      client
        .from("hall_inquiry_dispatches")
        .select("id, couple_id, letter_id, version_id, hall_id, recipient_name, status, queued_at, sent_at")
        .eq("status", "queued")
        .order("queued_at", { ascending: true })
        .limit(100),
      client
        .from("hall_inquiry_dispatches")
        .select("id, couple_id, letter_id, version_id, hall_id, recipient_name, status, queued_at, sent_at, channel_note, redacted_at")
        .eq("status", "sent")
        .gte("sent_at", since)
        .order("sent_at", { ascending: false })
        .limit(100),
    ]);
    if (queuedResult.error || sentResult.error) return apiError(503, "QUEUE_UNAVAILABLE", "대기열을 불러오지 못했어요.");

    const queuedRows = (queuedResult.data ?? []).flatMap((row) => {
      const parsed = parseDispatchRow(row);
      return parsed && isRecord(row) && typeof row.couple_id === "string" ? [{ ...parsed, coupleId: row.couple_id }] : [];
    });
    const sentRows = (sentResult.data ?? []).flatMap((row) => {
      const parsed = parseDispatchRow(row);
      return parsed && isRecord(row) && typeof row.couple_id === "string"
        ? [{ ...parsed, coupleId: row.couple_id, channelNote: typeof row.channel_note === "string" ? row.channel_note : null }]
        : [];
    });

    const versionIds = [...new Set(queuedRows.map((row) => row.versionId))];
    const hallIds = [...new Set(queuedRows.map((row) => row.hallId))];
    const sentIds = sentRows.map((row) => row.id);
    const [versionsResult, hallsResult, repliesResult] = await Promise.all([
      versionIds.length > 0 && sendingEnabled
        ? client.from("hall_inquiry_letter_versions").select("id, body, signature, shares").in("id", versionIds).limit(versionIds.length)
        : Promise.resolve({ data: [], error: null }),
      hallIds.length > 0
        ? client.from("hall_listings").select("id, source_url").in("id", hallIds).limit(hallIds.length)
        : Promise.resolve({ data: [], error: null }),
      sentIds.length > 0
        ? client.from("hall_inquiry_replies").select("id, dispatch_id, outcome, event_at, recorded_at").in("dispatch_id", sentIds).limit(300)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (versionsResult.error || hallsResult.error || repliesResult.error) {
      return apiError(503, "QUEUE_UNAVAILABLE", "대기열을 불러오지 못했어요.");
    }

    const versions = new Map((versionsResult.data ?? []).flatMap((row) => (isRecord(row) && typeof row.id === "string" ? [[row.id, row]] : [])));
    const sources = new Map((hallsResult.data ?? []).flatMap((row) => (isRecord(row) && typeof row.id === "string" ? [[row.id, row.source_url]] : [])));
    const replies = (repliesResult.data ?? []).filter(isRecord);

    return privateJson({
      sendingEnabled,
      dailyCap: cap.value,
      dailyCapMisconfigured: cap.misconfigured,
      globalDailyCap: globalCap.value,
      globalDailyCapMisconfigured: globalCap.misconfigured,
      queued: queuedRows.map((row) => {
        const version = versions.get(row.versionId);
        const shares = version ? parseStoredShares(version.shares) : null;
        return {
          dispatchId: row.id,
          coupleRef: row.coupleId.slice(0, 8),
          recipientName: row.recipientName,
          queuedAt: row.queuedAt,
          sourceUrl: typeof sources.get(row.hallId) === "string" ? sources.get(row.hallId) : null,
          letter: version && sendingEnabled
            ? {
              body: typeof version.body === "string" ? version.body : "",
              signature: typeof version.signature === "string" ? version.signature : "",
              shares: {
                name: shares?.name.on ? shares.name.value : null,
                phone: shares?.phone.on ? shares.phone.value : null,
                budget: shares?.budget.on ? shares.budget.value : null,
              },
            }
            : null,
        };
      }),
      sent: sentRows.map((row) => ({
        dispatchId: row.id,
        coupleRef: row.coupleId.slice(0, 8),
        recipientName: row.recipientName,
        sentAt: row.sentAt,
        channelNote: row.channelNote,
        // 한 사람이 탈퇴해서 커플 쪽 기록을 지운 문의. 답장을 더 적지 않는다.
        closed: row.redacted,
        replies: replies
          .filter((reply) => reply.dispatch_id === row.id)
          .map((reply) => ({ outcome: reply.outcome, eventAt: reply.event_at ?? null, recordedAt: reply.recorded_at })),
      })),
    });
  } catch (error) {
    log.error("[invitation admin inquiries GET]", error);
    return apiError(500, "SERVER_ERROR", "대기열을 불러오지 못했어요.");
  }
}
