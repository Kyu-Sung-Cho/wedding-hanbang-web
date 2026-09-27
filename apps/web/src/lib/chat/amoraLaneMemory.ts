/**
 * 아모라 대화의 마지막 레인('함께 대화' / '나만 (상담)')을 이 브라우저에 계정별로 적어 두는 자리.
 *
 * 규칙(언제 카드를 띄우고 어느 칸으로 여는가)과 키 모양은 `@hanbang/shared/amora-lane-choice`
 * 한 벌을 쓴다. 여기는 웹 저장소(localStorage)를 읽고 쓰는 일만 한다. 전체화면(`ChatContent`)과
 * 옆 패널(`ChatSidePanel`)이 같은 함수를 불러 같은 키를 본다.
 *
 * - 저장소 접근은 전부 try/catch 로 감싼다. 사생활 보호 창, 막힌 저장소, 할당량 초과에서
 *   읽기가 실패하면 `null` 을 돌려주고, 규칙이 선택 카드를 다시 띄운다(모르는 채로 한쪽을
 *   고르지 않는다).
 * - 사람이 직접 고른 칸만 적는다. 주소의 `?scope=`, 준비 안내, 안전 판정이 옮긴 탭은 적지
 *   않는다. 그건 그 사람의 선택이 아니다.
 * - 분석 이벤트를 보내지 않는다. 무엇을 골랐는지는 이 브라우저 밖으로 나가지 않는다.
 */

import {
  amoraLaneStorageKey,
  type AmoraLaneChoice,
} from "@hanbang/shared/amora-lane-choice";

/** 기억된 값을 원문 그대로 돌려준다. 없거나 읽지 못하면 `null`. 해석은 규칙 쪽이 한다. */
export function readRememberedAmoraLane(userId: string | null | undefined): string | null {
  const key = amoraLaneStorageKey(userId);
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 사람이 고른 칸을 적는다. 적지 못하면 `false` — 화면은 그대로 두고 다음 방문에 다시 묻는다. */
export function rememberAmoraLane(
  userId: string | null | undefined,
  lane: AmoraLaneChoice,
): boolean {
  const key = amoraLaneStorageKey(userId);
  if (!key) return false;
  try {
    window.localStorage.setItem(key, lane);
    return true;
  } catch {
    return false;
  }
}
