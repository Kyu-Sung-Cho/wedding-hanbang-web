"use client";

import { useEffect, type RefObject } from "react";

/**
 * 화면이 바뀌면 새 화면의 뿌리로 초점과 스크롤을 옮긴다.
 *
 * 다음 단추를 누르면 그 단추가 그대로 남아 있는 채 화면 내용만 바뀌기 쉽다. 낭독기와 키보드 사용자는 무엇이 바뀌었는지 모르므로
 * 새 화면의 뿌리(초점을 받을 수 있게 tabIndex -1 을 준 요소)로 초점을 옮겨 화면 이름을 읽게 하고, 화면 맨 위가 보이게 한다.
 * key 가 같으면 다시 옮기지 않는다(같은 화면 안에서 답을 고를 때 초점을 빼앗지 않는다).
 *
 * 스크롤은 scrollIntoView 가 있을 때만 한다(시험 환경 jsdom 에는 없다). 초점은 스크롤 없이 옮기고 스크롤은 따로 한다.
 *
 * target 을 주면 초점은 뿌리 대신 그 요소로 간다(스크롤은 그래도 뿌리 맨 위로). 뿌리에 이름을 줄 수 없는 화면(안쪽 구역이 이미 같은 이름이라
 * 이름이 겹친다)에서 화면 제목으로 초점을 보내, 낭독기가 이름 없는 덩어리 대신 화면 제목을 읽게 한다. target 이 요소를 못 찾으면 뿌리다.
 * target 은 늘 같은 함수(모듈 안의 함수 하나나 undefined)를 줘야 한다. 화면이 바뀔 때(key)뿐 아니라 target 이 바뀔 때도 초점을 다시 옮기기 때문이다.
 */
export function useScreenFocus(
  ref: RefObject<HTMLElement | null>,
  key: string,
  enabled: boolean = true,
  target?: (root: HTMLElement) => HTMLElement | null,
): void {
  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    (target?.(element) ?? element).focus({ preventScroll: true });
    element.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [ref, key, enabled, target]);
}
