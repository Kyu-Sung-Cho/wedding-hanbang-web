import {
  COMMON_STATE_COPY,
  COMPARE_STATE_COPY,
  FIRST_CHAT_INPUT_COPY,
  HOME_STATE_COPY,
  JOURNEY_STATE_COPY,
  LETTER_STATE_COPY,
} from "@hanbang/shared/invitation";

import type { InvitationApiFailure } from "./invitationApi";

/**
 * 실제 커플 화면의 실패를 화면 문장으로 바꾼다. 문장은 상태 문구(`copyStates.ts`)에서만 가져오고 여기서 짓지 않는다.
 *
 * 서버가 사람이 읽는 이유를 말하면(상담 후보 상한, 상대가 아직 합류하지 않음 같은) 그 문장을 먼저 쓰고, 이유가 없으면
 * (연결 끊김, 응답 모양이 다름) 그 화면의 상태 문구를 쓴다(앱 화면도 같은 순서다).
 */

/** 다시 불러오기 단추(옛 라운지의 같은 단추 이름). */
export const LIVE_RETRY_LABEL = "다시 불러오기";

function serverSentence(failure: InvitationApiFailure | null): string | null {
  return failure?.error?.trim() ? failure.error.trim() : null;
}

export const HOME_LOAD_FAILED = HOME_STATE_COPY.loadFailed;
export const HALLS_LOAD_FAILED = COMPARE_STATE_COPY.loadFailed;
export const DECISIONS_UNAVAILABLE = HOME_STATE_COPY.decisionsUnavailable;

/** 불러오기 실패. 서버가 이유를 말하지 않으면 그 화면의 상태 문구(`fallback`)를 쓴다. */
export function loadFailedMessage(failure: InvitationApiFailure | null, fallback: string): string {
  return serverSentence(failure) ?? fallback;
}

/** 조건 저장 실패. 첫 대화의 상태 문구를 쓴다. */
export const CONDITIONS_SAVE_FAILED = FIRST_CHAT_INPUT_COPY.saveFailed;

/** 준비 순서 저장 실패(빼기·다시 넣기·넣기). */
export const JOURNEY_SAVE_FAILED = JOURNEY_STATE_COPY.saveFailed;

/** 담기·빼기 실패. 상담 후보 상한(`SHORTLIST_FULL`)처럼 서버가 이유를 말하면 그 문장을 쓴다. */
export function shortlistFailedMessage(failure: InvitationApiFailure): string {
  return serverSentence(failure) ?? COMMON_STATE_COPY.saveFailed;
}

/** 편지 저장·승인 실패. 판이 바뀌었으면 다시 확인하라고, 이미 대기열에 넣은 편지면 두 번 보내지 않는다고 말한다. */
export function letterFailedMessage(failure: InvitationApiFailure): string {
  if (failure.code === "LETTER_VERSION_CHANGED") return LETTER_STATE_COPY.versionChanged;
  if (failure.code === "LETTER_LOCKED") return LETTER_STATE_COPY.alreadySent;
  return LETTER_STATE_COPY.saveFailed;
}

/**
 * 승인 방식 저장·제안 답하기 실패. 상대가 아직 합류하지 않았으면 고를 수 없다고 말하고, 그 밖에는 서버가 말한 이유를,
 * 이유가 없으면 저장하지 못했다고 말한다.
 */
export function approverFailedMessage(failure: InvitationApiFailure): string {
  if (failure.code === "APPROVER_PARTNER_REQUIRED") return LETTER_STATE_COPY.approverUnavailable;
  return serverSentence(failure) ?? COMMON_STATE_COPY.saveFailed;
}

/** 상담 일정 넣기 실패. */
export function scheduleFailedMessage(failure: InvitationApiFailure): string {
  return serverSentence(failure) ?? COMMON_STATE_COPY.saveFailed;
}
