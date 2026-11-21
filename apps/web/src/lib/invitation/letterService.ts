import {
  INVITATION_CONDITIONS_PROGRESS_KEY,
  missingConditions,
  parseInvitationConditions,
  type InvitationLetterResponse,
  type LetterState,
} from "@hanbang/shared/invitation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoupleContext } from "./coupleContext";
import { readHallsByIds, readShortlist } from "./hallRepository";
import { readApproverSetting, readInquiryTimeline, readOpenLetter, type InquiryTimeline, type LetterVersionRow } from "./inquiryRepository";
import { kstParts } from "./kstFormat";
import { budgetShareValues, buildLetterModel, draftLetterBody, letterSignature, letterState } from "./letter";
import { selfSendView } from "./selfSend";
import { inquiryDailyCap, isInquirySelfSendEnabled, isInquirySendingEnabled } from "./switches";

/**
 * 편지 화면, 홈, 승인 경로가 함께 쓰는 읽기. 열린 편지가 있으면 그 마지막 판을, 없으면 저장된 조건과
 * 담은 홀로 만든 초안(아직 저장 안 함)을 준다.
 *
 * 커플이 직접 보내기(D-83 1단계)가 켜져 있으면 응답에 `selfSend` 를 싣는다: 저장한 판이 있으면 받는 곳마다
 * 보낼 글, 없으면 null. 꺼져 있으면 그 칸을 두지 않아 응답이 이 스위치 전과 같다.
 */

export type OpenLetterView = { version: LetterVersionRow; state: LetterState } | null;

export type LetterView = {
  response: InvitationLetterResponse;
  open: OpenLetterView;
  timeline: InquiryTimeline;
};

export function queuedToday(timeline: InquiryTimeline, now: Date = new Date()): number {
  const today = kstParts(now).ymd;
  return timeline.dispatches.filter((dispatch) => kstParts(new Date(dispatch.queuedAt)).ymd === today).length;
}

export async function loadLetterView(
  supabase: SupabaseClient,
  context: CoupleContext,
  options: { now?: Date } = {},
): Promise<LetterView | null> {
  const [settingResult, openResult, timelineResult, shortlistResult] = await Promise.all([
    readApproverSetting(supabase, context.coupleId),
    readOpenLetter(supabase, context.coupleId),
    readInquiryTimeline(supabase, context.coupleId),
    readShortlist(supabase, context.coupleId),
  ]);
  if (!settingResult.ok || !openResult.ok || !timelineResult.ok || !shortlistResult.ok) return null;

  const selfSendMode = isInquirySelfSendEnabled();
  const progress = context.journey?.progress ?? {};
  const conditions = parseInvitationConditions(progress[INVITATION_CONDITIONS_PROGRESS_KEY]);
  const weddingDate = context.journey?.weddingDate ?? null;
  const open = openResult.value;
  // 직접 보내기에서는 편지가 대기열에 들어가지 않아 잠기지 않는다. 받는 곳이 담은 홀을 따라가야 하므로 담은 홀도 읽는다.
  const recipientIds = open
    ? selfSendMode ? [...new Set([...open.version.recipientHallIds, ...shortlistResult.value])] : open.version.recipientHallIds
    : shortlistResult.value;
  const hallsResult = await readHallsByIds(supabase, recipientIds);
  if (!hallsResult.ok) return null;
  const hallById = new Map(hallsResult.value.map((hall) => [hall.id, hall]));

  // 새 초안은 이미 문의한 홀을 빼고 담은 홀로 만든다. 같은 내용은 DB 가 다시 막지만, 초안이 권하지 않게 한다.
  // 탈퇴로 거둬들인 문의는 보내지 않았으므로 문의한 것으로 세지 않는다.
  const contacted = new Set(timelineResult.value.dispatches
    .filter((dispatch) => dispatch.status !== "withdrawn")
    .map((dispatch) => dispatch.hallId));
  const shortlisted = shortlistResult.value.flatMap((hallId) => {
    const hall = hallById.get(hallId);
    return hall?.active && !contacted.has(hallId) ? [{ hallId, name: hall.name }] : [];
  });
  // 직접 보내기에서 저장한 판의 받는 곳이 지금 담은 홀과 다르면(담거나 뺐으면) 그 판은 화면의 편지가 아니다.
  // 글과 알려줄 정보는 그 판대로 두고 받는 곳만 지금 담은 홀로 바꿔 보여 주고, 다시 저장해야 보낼 글이 나온다.
  // 그대로 두면 새로 담은 홀은 편지에 들어오지 못하고, 뺀 홀이 남아 저장이 늘 RECIPIENTS_UNAVAILABLE 로 막힌다.
  // 저장한 뒤 총예산이 바뀌었거나(예산을 알려주기로 했을 때) 이름이 바뀌었으면(상대가 들어왔을 때) 그 판의 글은 옛 값을
  // 담고 있다. 화면은 새 예산을 보이는데 보낼 글은 옛 예산을 업체에 보내게 되므로, 이때도 다시 저장해야 글이 나온다.
  // 저장(PUT)이 쓰는 함수와 같은 함수로 지금 저장하면 남을 값을 계산해 견준다.
  const savedValuesChanged = Boolean(open && selfSendMode && (
    (open.version.shares.budget.on
      && open.version.shares.budget.value !== budgetShareValues(context.journey?.totalBudget ?? null).stored)
    || open.version.signature !== letterSignature(open.version.shares.name.on, context.members)
  ));
  const stale = Boolean(open && selfSendMode && (!sameHalls(open.version.recipientHallIds, shortlisted) || savedValuesChanged));
  const shownVersion = open && !stale ? open.version : null;
  const recipients = open && !stale
    ? open.version.recipientHallIds.map((hallId, index) => ({ hallId, name: open.version.recipientNames[index] }))
    : shortlisted;

  const cap = inquiryDailyCap();
  const state = letterState({
    letterId: open?.letterId ?? null,
    version: shownVersion,
    approvals: shownVersion ? open?.approvals ?? [] : [],
    setting: settingResult.value,
    members: context.members,
    viewerId: context.userId,
    recipients,
    sendingEnabled: isInquirySendingEnabled(),
    dailyCap: cap.value,
    queuedToday: queuedToday(timelineResult.value, options.now),
  });

  const partner = context.partner;
  const partnerApproved = Boolean(partner && state.approvedBy.includes(partner.id));
  const backdrop = recipients.map((recipient) => hallById.get(recipient.hallId)?.photoUrl ?? null).find(Boolean) ?? null;
  const built = buildLetterModel({
    version: stale && open
      ? recipients.length > 0
        ? { ...open.version, recipientHallIds: recipients.map((item) => item.hallId), recipientNames: recipients.map((item) => item.name) }
        : null
      : open?.version ?? null,
    draft: open ? null : {
      recipients: recipients.map((recipient) => recipient.name),
      body: draftLetterBody(conditions, weddingDate),
      signature: letterSignature(false, context.members),
    },
    viewer: context.viewer,
    partner,
    partnerApproved,
    totalBudget: context.journey?.totalBudget ?? null,
    backdropPhoto: backdrop,
    now: options.now,
  });
  // 직접 보내기의 글에는 휴대폰 번호가 들어가지 않는다(커플이 자기 폰으로 보낸다). 쓰지 않을 번호를 받지 않도록
  // 알려주기 칸에서 뺀다. 저장(PUT)도 이 단계에서는 번호를 받지 않는다.
  const letter = built && selfSendMode
    ? { ...built, shares: built.shares.filter((share) => share.key !== "phone") }
    : built;

  const missing: InvitationLetterResponse["missing"] = [
    ...(recipients.length === 0 ? ["shortlist" as const] : []),
    ...missingConditions(conditions, weddingDate),
  ];
  const base: InvitationLetterResponse = { letter, state: letter ? state : null, missing };
  return {
    response: selfSendMode ? { ...base, selfSend: selfSendFor(shownVersion) } : base,
    open: open ? { version: open.version, state } : null,
    timeline: timelineResult.value,
  };
}

/** 저장한 판이 있고 아직 운영자 대기열에 들어가지 않았을 때만 보낼 글을 만든다. */
function selfSendFor(version: LetterVersionRow | null): InvitationLetterResponse["selfSend"] {
  return version && !version.queuedAt ? selfSendView(version) : null;
}

/** 판의 받는 곳과 지금 받을 수 있는 담은 홀이 같은 홀들인가(순서는 보지 않는다). */
function sameHalls(versionHallIds: readonly string[], current: readonly { hallId: string }[]): boolean {
  if (versionHallIds.length !== current.length) return false;
  const ids = new Set(current.map((item) => item.hallId));
  return versionHallIds.every((hallId) => ids.has(hallId));
}
