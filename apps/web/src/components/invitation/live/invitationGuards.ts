import type {
  ConsultationScheduleResult,
  HallShortlistResponse,
  InquiryApproverResponse,
  InvitationActivityResponse,
  InvitationConditionsResponse,
  InvitationConsultationResponse,
  InvitationHallsResponse,
  InvitationHomeResponse,
  InvitationJourneyResponse,
  InvitationLetterResponse,
  LetterApproveResult,
} from "@hanbang/shared/invitation";

import { isRecord } from "./invitationApi";

/**
 * `/api/invitation/*` 응답의 경계 검사. 화면이 바로 읽는 칸만 본다. 서버와 화면 번들이 어긋난 배포
 * 사이에 모양이 다른 응답이 오면 화면을 깨뜨리지 않고 불러오기 실패로 다룬다.
 */

const isArray = Array.isArray;
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isNullable = <T>(value: unknown, check: (inner: unknown) => inner is T): value is T | null =>
  value === null || check(value);

export function isHomeResponse(value: unknown): value is InvitationHomeResponse {
  if (!isRecord(value) || !isRecord(value.home) || !isArray(value.degraded)) return false;
  const home = value.home;
  return isArray(home.people)
    && isRecord(home.invitation)
    && isArray(home.decisions)
    && (home.update === null || (isRecord(home.update) && isString(home.update.text) && isArray(home.update.steps)));
}

export function isConditionsResponse(value: unknown): value is InvitationConditionsResponse {
  return isRecord(value) && isRecord(value.conditions) && isArray(value.missing);
}

const ACTORS: ReadonlySet<unknown> = new Set(["amora", "operator", "couple"]);

/**
 * 오늘 한 일은 줄마다 누가 했는지(`actor`)가 있어야 받는다. 없으면 담당자의 일이 "오늘 아모라가 한 일" 아래에
 * 아모라의 일처럼 놓이므로, 그런 응답은 불러오기 실패로 다룬다.
 */
export function isActivityResponse(value: unknown): value is InvitationActivityResponse {
  return isRecord(value)
    && isArray(value.activity)
    && value.activity.every((item) => isRecord(item) && isString(item.timeLabel) && isString(item.text) && ACTORS.has(item.actor));
}

export function isJourneyResponse(value: unknown): value is InvitationJourneyResponse {
  return isRecord(value)
    && isRecord(value.journey)
    && isArray(value.journey.rows)
    && isArray(value.journey.addOns)
    && isRecord(value.plan)
    && isArray(value.plan.off)
    && isArray(value.plan.addOns);
}

export function isHallsResponse(value: unknown): value is InvitationHallsResponse {
  return isRecord(value)
    && isNullable(value.compare, (compare): compare is object =>
      isRecord(compare) && isArray(compare.halls) && isNumber(compare.guests))
    && isArray(value.missing)
    && isNumber(value.pickedCount);
}

export function isShortlistResponse(value: unknown): value is HallShortlistResponse {
  return isRecord(value) && isString(value.hallId) && typeof value.picked === "boolean" && isNumber(value.pickedCount);
}

/** 확인을 기다리는 승인 방식 제안. 확인·거절 단추가 그대로 돌려보낼 `proposalId` 와 답할 수 있는지가 있어야 한다. */
function isApproverProposal(value: unknown): boolean {
  return isRecord(value)
    && isString(value.proposalId)
    && isString(value.mode)
    && (value.designatedUserId === null || isString(value.designatedUserId))
    && isString(value.proposedBy)
    && typeof value.viewerCanRespond === "boolean";
}

export function isApproverResponse(value: unknown): value is InquiryApproverResponse {
  return isRecord(value)
    && isRecord(value.setting)
    && isString(value.setting.mode)
    && isArray(value.members)
    && value.members.every((member) => isRecord(member) && isString(member.id) && typeof member.isViewer === "boolean")
    // 제안 칸이 없던 서버(배포 사이)는 제안이 없는 것으로 읽는다. 있으면 모양이 맞아야 한다.
    && (value.pending === undefined || value.pending === null || isApproverProposal(value.pending));
}

export function isLetterResponse(value: unknown): value is InvitationLetterResponse {
  return isRecord(value)
    && isNullable(value.letter, (letter): letter is object =>
      isRecord(letter) && isArray(letter.recipients) && isArray(letter.shares) && isString(letter.body))
    && isNullable(value.state, (state): state is object =>
      isRecord(state) && isString(state.status) && isArray(state.waitingFor) && isArray(state.recipients))
    && isArray(value.missing);
}

/** PUT `/letter` 은 편지 응답에 새로 저장한 판을 더해 준다. */
export type LetterSaveResponse = InvitationLetterResponse & {
  saved: { letterId: string; versionId: string; version: number; fingerprint: string; created: boolean };
};

export function isLetterSaveResponse(value: unknown): value is LetterSaveResponse {
  if (!isLetterResponse(value)) return false;
  const saved = (value as { saved?: unknown }).saved;
  return isRecord(saved) && isString(saved.versionId) && isString(saved.fingerprint);
}

/** POST `/letter/approve` 응답. 승인 결과와 다시 읽은 편지(못 읽었으면 null). */
export type LetterApproveResponse = { result: LetterApproveResult; letter: InvitationLetterResponse | null };

export function isLetterApproveResponse(value: unknown): value is LetterApproveResponse {
  return isRecord(value)
    && isRecord(value.result)
    && isString(value.result.status)
    && isNumber(value.result.queuedCount)
    && isArray(value.result.duplicateHallIds)
    && isArray(value.result.waitingFor)
    && isNullable(value.letter, isLetterResponse);
}

export function isConsultationResponse(value: unknown): value is InvitationConsultationResponse {
  return isRecord(value)
    && isNullable(value.consultation, (model): model is object =>
      isRecord(model) && isString(model.dateLabel) && isString(model.venue) && isArray(model.questions))
    && typeof value.inCalendar === "boolean";
}

export function isScheduleResult(value: unknown): value is ConsultationScheduleResult {
  return isRecord(value) && typeof value.added === "boolean" && typeof value.alreadyInCalendar === "boolean";
}
