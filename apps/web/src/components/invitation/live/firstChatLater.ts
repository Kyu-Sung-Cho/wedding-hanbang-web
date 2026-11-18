"use client";

import { useSyncExternalStore } from "react";

/**
 * 첫 대화(조건 묻기)를 "나중에 할게요"로 건너뛴 사람(2026-11-17 리드 지시: 이미 쓰던 커플이 새 질문에 갇히지 않게).
 *
 * 이 브라우저에 사람마다 기억한다(앱은 기기에 사람마다 기억한다). 서버에는 보내지 않는다. 건너뛰어도 홈의
 * "희망 시기와 지역 알려 주기" 한 줄과 웨딩홀 비교의 "조건 알려 주기"가 첫 대화를 다시 연다.
 *
 * 저장소를 쓰지 못하면 막지 않는다. 읽지 못하면 건너뛴 것으로 보고(홈을 연다), 적지 못하면 이 탭이 열려 있는
 * 동안만 기억한다. 어느 쪽이든 사람은 첫 대화에 갇히지 않는다.
 */

const STORAGE_PREFIX = "hanbang_invitation_first_chat_later:";

/** 저장소에 적지 못했을 때 이 탭에서만 기억하는 사람들. */
const skippedThisTab = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** 이 사람이 첫 대화를 건너뛰었는가. 저장소를 읽지 못하면 건너뛴 것으로 본다. */
export function readFirstChatLater(owner: string): boolean {
  if (skippedThisTab.has(owner)) return true;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${owner}`) === "1";
  } catch {
    return true;
  }
}

/** 건너뛴 것을 기억한다. 저장소에 적지 못해도 이 탭에서는 기억한다. */
export function rememberFirstChatLater(owner: string): void {
  skippedThisTab.add(owner);
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${owner}`, "1");
  } catch {
    // 저장소를 막아 둔 브라우저다. 이 탭이 열려 있는 동안은 위 목록이 기억한다.
  }
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 다른 탭에서 건너뛴 것도 따라간다.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(STORAGE_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * 이 사람이 첫 대화를 건너뛰었는가. 서버 렌더와 하이드레이션 중에는 저장소를 읽지 않아 `null`(아직 모름)이다 —
 * 서버와 브라우저의 첫 그림이 같아야 한다.
 */
export function useFirstChatLater(owner: string | null): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => (owner ? readFirstChatLater(owner) : false),
    () => null,
  );
}

/** 시험에서만 쓴다: 이 탭의 기억을 비운다. */
export function resetFirstChatLaterForTest(): void {
  skippedThisTab.clear();
}
