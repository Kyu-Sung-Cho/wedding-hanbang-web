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
import { buildLetterModel, draftLetterBody, letterSignature, letterState } from "./letter";
import { inquiryDailyCap, isInquirySendingEnabled } from "./switches";

/**
 * 편지 화면, 홈, 승인 경로가 함께 쓰는 읽기. 열린 편지가 있으면 그 마지막 판을, 없으면 저장된 조건과
 * 담은 홀로 만든 초안(아직 저장 안 함)을 준다.
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

  const progress = context.journey?.progress ?? {};
  const conditions = parseInvitationConditions(progress[INVITATION_CONDITIONS_PROGRESS_KEY]);
  const weddingDate = context.journey?.weddingDate ?? null;
  const open = openResult.value;
  const recipientIds = open ? open.version.recipientHallIds : shortlistResult.value;
  const hallsResult = await readHallsByIds(supabase, recipientIds);
  if (!hallsResult.ok) return null;
  const hallById = new Map(hallsResult.value.map((hall) => [hall.id, hall]));

  // 새 초안은 이미 문의한 홀을 빼고 담은 홀로 만든다. 같은 내용은 DB 가 다시 막지만, 초안이 권하지 않게 한다.
  // 탈퇴로 거둬들인 문의는 보내지 않았으므로 문의한 것으로 세지 않는다.
  const contacted = new Set(timelineResult.value.dispatches
    .filter((dispatch) => dispatch.status !== "withdrawn")
    .map((dispatch) => dispatch.hallId));
  const recipients = open
    ? open.version.recipientHallIds.map((hallId, index) => ({ hallId, name: open.version.recipientNames[index] }))
    : shortlistResult.value.flatMap((hallId) => {
      const hall = hallById.get(hallId);
      return hall?.active && !contacted.has(hallId) ? [{ hallId, name: hall.name }] : [];
    });

  const cap = inquiryDailyCap();
  const state = letterState({
    letterId: open?.letterId ?? null,
    version: open?.version ?? null,
    approvals: open?.approvals ?? [],
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
  const letter = buildLetterModel({
    version: open?.version ?? null,
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

  const missing: InvitationLetterResponse["missing"] = [
    ...(recipients.length === 0 ? ["shortlist" as const] : []),
    ...missingConditions(conditions, weddingDate),
  ];
  return {
    response: { letter, state: letter ? state : null, missing },
    open: open ? { version: open.version, state } : null,
    timeline: timelineResult.value,
  };
}
