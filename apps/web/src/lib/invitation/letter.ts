import {
  LETTER_COPY,
  conditionYearMonth,
  type InquiryApproverSetting,
  type InvitationConditions,
  type LetterApprovalStatus,
  type LetterModel,
  type LetterNotQueuedReason,
  type LetterShare,
  type LetterState,
} from "@hanbang/shared/invitation";
import { dotDateLabel } from "./kstFormat";
import { LIVE_COPY, withCommas } from "./liveCopy";
import type { ApprovalRow, LetterVersionRow, StoredShares } from "./inquiryRepository";

/**
 * 상담 문의 편지(W3). 초안은 저장된 조건에서만 만든다. 모르는 조건은 문장에서 뺀다.
 * 승인이 끝났는지는 DB 함수(`hall_inquiry_approve_letter`)와 같은 규칙으로 센다. 화면에 보여 주는 값일 뿐이고
 * 실제 판정은 승인할 때 DB 가 다시 한다.
 */

export type LetterMember = { id: string; name: string | null };

const MAX_SIGNATURE_CHARS = 60;

/** 저장된 조건으로 만든 편지 초안. 상담 가능 시간은 커플이 "문구 고치기"로 넣는다. */
export function draftLetterBody(conditions: InvitationConditions, weddingDate: string | null): string {
  const exact = weddingDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(weddingDate) : null;
  const yearMonth = conditionYearMonth(conditions, weddingDate);
  const when = exact
    ? `${Number(exact[1])}년 ${Number(exact[2])}월 ${Number(exact[3])}일`
    : yearMonth
      ? `${yearMonth.year}년 ${yearMonth.month}월`
      : null;
  const parts = [LIVE_COPY.letter.opening(when, conditions.timeLabel)];
  if (conditions.guestCount !== null) parts.push(LIVE_COPY.letter.guests(conditions.guestCount));
  parts.push(LIVE_COPY.letter.askAvailability);
  return parts.join(" ");
}

/** 판에 남기는 예산 값과 화면에 보이는 값. 총예산을 정하지 않았으면 그렇다고 알린다. */
export function budgetShareValues(totalBudget: number | null): { stored: string; display: string } {
  if (totalBudget === null || totalBudget <= 0) {
    return { stored: LIVE_COPY.letter.budgetUnsetStored, display: LETTER_COPY.budgetUnset };
  }
  const manwon = withCommas(Math.round(totalBudget / 10_000));
  return { stored: LIVE_COPY.letter.budgetStored(manwon), display: LIVE_COPY.letter.budgetDisplay(manwon) };
}

/** 숫자만 남긴 휴대폰 번호를 "010-1234-5678" 꼴로. */
export function formatMobile(digits: string): string | null {
  if (!/^01[016789]\d{7,8}$/.test(digits)) return null;
  return digits.length === 11
    ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
    : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** 화면에는 가운데를 가린 번호만 준다("010-****-1234"). */
export function maskMobile(phone: string): string {
  const match = /^(01[016789])-(\d{3,4})-(\d{4})$/.exec(phone);
  return match ? `${match[1]}-${"*".repeat(4)}-${match[3]}` : "";
}

/**
 * 맺음말. 이름을 알려주기로 했을 때만 두 사람 이름을 쓴다(아티팩트 "민지와 준호 드림").
 * 이름을 끄면 이름이 없는 맺음말을 쓴다. 이 값은 판에 남아 지문에 들어간다.
 */
export function letterSignature(nameShared: boolean, members: readonly LetterMember[]): string {
  const names = members.map((member) => member.name?.trim() ?? "").filter(Boolean);
  if (!nameShared || names.length === 0) return LIVE_COPY.letter.anonymousSignature;
  const signature = LETTER_COPY.signature(names[0], names[1] ?? null);
  return Array.from(signature).length <= MAX_SIGNATURE_CHARS ? signature : LIVE_COPY.letter.anonymousSignature;
}

export type ApprovalProgress = {
  approvedBy: string[];
  /** 문의가 켜져 있을 때, 꺼진 동안에만 승인해서 다시 승인해야 하는 사람. */
  pausedBy: string[];
  complete: boolean;
  waitingFor: string[];
  unavailable: boolean;
};

/**
 * DB 의 승인 판정과 같은 규칙. 지금 승인 방식의 판 번호와 이 판의 지문으로 받은 승인만 센다.
 * 문의 보내기가 켜져 있으면 켜진 동안 받은 승인만 센다(꺼진 동안의 승인은 저장된 선택일 뿐이다).
 */
export function approvalProgress(input: {
  setting: InquiryApproverSetting;
  memberIds: readonly string[];
  approvals: readonly ApprovalRow[];
  fingerprint: string;
  sendingEnabled: boolean;
}): ApprovalProgress {
  const members = [...input.memberIds];
  const current = input.approvals.filter((approval) => approval.settingsRevision === input.setting.revision
    && approval.fingerprint === input.fingerprint
    && approval.approverUserId !== null
    && members.includes(approval.approverUserId));
  const approvedBy = [...new Set(current
    .filter((approval) => !input.sendingEnabled || approval.sendingEnabled)
    .map((approval) => approval.approverUserId as string))];
  const pausedBy = input.sendingEnabled
    ? [...new Set(current
      .filter((approval) => !approval.sendingEnabled && !approvedBy.includes(approval.approverUserId as string))
      .map((approval) => approval.approverUserId as string))]
    : [];

  if (input.setting.mode === "designated") {
    const designated = input.setting.designatedUserId;
    const unavailable = designated === null || !members.includes(designated);
    const complete = !unavailable && approvedBy.includes(designated as string);
    return { approvedBy, pausedBy, complete, unavailable, waitingFor: complete || unavailable ? [] : [designated as string] };
  }
  if (input.setting.mode === "both") {
    const unavailable = members.length < 2;
    const complete = !unavailable && members.every((id) => approvedBy.includes(id));
    return { approvedBy, pausedBy, complete, unavailable, waitingFor: members.filter((id) => !approvedBy.includes(id)) };
  }
  const complete = approvedBy.length >= 1;
  return { approvedBy, pausedBy, complete, unavailable: false, waitingFor: complete ? [] : members };
}

export function letterState(input: {
  letterId: string | null;
  version: LetterVersionRow | null;
  approvals: readonly ApprovalRow[];
  setting: InquiryApproverSetting;
  members: readonly LetterMember[];
  viewerId: string;
  recipients: readonly { hallId: string; name: string }[];
  sendingEnabled: boolean;
  dailyCap: number;
  queuedToday: number;
}): LetterState {
  // 승인은 지금 방식에서 승인할 수 있는 사람만 남길 수 있다(정한 한 사람이 있으면 그 사람뿐). DB 도 같다.
  const memberIds = input.members.map((member) => member.id);
  const viewerIsMember = memberIds.includes(input.viewerId);
  const viewerIsApprover = viewerIsMember
    && (input.setting.mode !== "designated" || input.setting.designatedUserId === input.viewerId);
  const base = {
    letterId: input.letterId,
    approver: input.setting,
    sendingEnabled: input.sendingEnabled,
    recipients: input.recipients,
    viewerIsApprover,
  };

  if (!input.version) {
    return {
      ...base,
      versionId: null,
      version: null,
      fingerprint: null,
      status: "draft",
      approvedBy: [],
      approvedWhilePaused: [],
      waitingFor: input.setting.mode === "designated" && input.setting.designatedUserId
        ? [input.setting.designatedUserId]
        : memberIds,
      viewerCanApprove: viewerIsApprover,
      notQueuedReason: null,
    };
  }

  const progress = approvalProgress({
    setting: input.setting,
    memberIds,
    approvals: input.approvals,
    fingerprint: input.version.fingerprint,
    sendingEnabled: input.sendingEnabled,
  });
  let status: LetterApprovalStatus;
  let notQueuedReason: LetterNotQueuedReason | null = null;
  if (input.version.queuedAt) {
    status = "queued";
  } else if (progress.complete) {
    status = "approved_not_queued";
    if (!input.sendingEnabled) notQueuedReason = "sending_disabled";
    else if (input.queuedToday + input.version.recipientHallIds.length > input.dailyCap) notQueuedReason = "daily_cap";
    // 켜진 동안의 승인으로 끝났는데 커플 상한 안이면, 남은 이유는 서비스 전체 상한뿐이다(DB 가 그렇게 판정했다).
    else notQueuedReason = "global_daily_cap";
  } else {
    status = progress.approvedBy.length > 0 || progress.unavailable ? "awaiting_approval" : "draft";
    if (progress.unavailable) notQueuedReason = "approver_unavailable";
  }

  return {
    ...base,
    versionId: input.version.id,
    version: input.version.version,
    fingerprint: input.version.fingerprint,
    status,
    approvedBy: progress.approvedBy,
    approvedWhilePaused: progress.pausedBy,
    waitingFor: progress.waitingFor,
    // 승인이 끝났지만 아직 넣지 못한 판은 승인할 수 있는 사람이 다시 눌러 대기열에 넣을 수 있다(DB 가 다시 판정한다).
    viewerCanApprove: status !== "queued" && viewerIsApprover
      && (!progress.approvedBy.includes(input.viewerId) || status === "approved_not_queued"),
    notQueuedReason,
  };
}

function shareRows(shares: StoredShares | null, suggestedName: string | null, budgetDisplay: string): LetterShare[] {
  return [
    {
      key: "name",
      label: LETTER_COPY.shares.name,
      value: shares?.name.on && shares.name.value ? shares.name.value : suggestedName ?? "",
      on: shares?.name.on ?? false,
    },
    {
      key: "phone",
      label: LETTER_COPY.shares.phone,
      value: shares?.phone.on && shares.phone.value ? maskMobile(shares.phone.value) : "",
      on: shares?.phone.on ?? false,
    },
    { key: "budget", label: LETTER_COPY.shares.budget, value: budgetDisplay, on: shares?.budget.on ?? false },
  ];
}

export function buildLetterModel(input: {
  version: LetterVersionRow | null;
  draft: { recipients: readonly string[]; body: string; signature: string } | null;
  viewer: LetterMember;
  partner: LetterMember | null;
  partnerApproved: boolean;
  totalBudget: number | null;
  backdropPhoto: string | null;
  now?: Date;
}): LetterModel | null {
  const budget = budgetShareValues(input.totalBudget);
  if (input.version) {
    return {
      recipients: input.version.recipientNames,
      dateLabel: dotDateLabel(new Date(input.version.createdAt)),
      body: input.version.body,
      signature: input.version.signature,
      shares: shareRows(input.version.shares, input.viewer.name, budget.display),
      partnerApprovedName: input.partnerApproved
        ? input.partner?.name ?? LIVE_COPY.partnerFallback
        : null,
      backdropPhoto: input.backdropPhoto,
    };
  }
  if (!input.draft || input.draft.recipients.length === 0) return null;
  return {
    recipients: input.draft.recipients,
    dateLabel: dotDateLabel(input.now ?? new Date()),
    body: input.draft.body,
    signature: input.draft.signature,
    shares: shareRows(null, input.viewer.name, budget.display),
    partnerApprovedName: null,
    backdropPhoto: input.backdropPhoto,
  };
}
