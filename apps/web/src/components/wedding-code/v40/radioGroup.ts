"use client";

import { useRef, type KeyboardEvent } from "react";
import { nextRadioIndex } from "./styles";

/**
 * 라디오 그룹 하나의 방향키와 탭 자리를 맡는 도우미(움직이는 탭 자리 방식).
 *
 * - 탭으로 그룹에 들어가면 고른 칸(없으면 첫 칸) 하나에만 선다. 나머지 칸의 탭 자리는 -1 이다.
 * - 방향키는 DOM 순서를 따라 다음과 이전 칸으로 초점을 옮기고 그 칸을 고른다(브라우저 기본 라디오와 같다). 끝에서 반대쪽 끝으로 돈다.
 * - 스페이스와 엔터는 단추의 기본 클릭이 처리한다.
 * - 선택은 위에서 받은 select(index)로만 알린다. 이 도우미는 값을 저장하지 않는다.
 * - 알트, 컨트롤, 메타를 함께 누른 방향키는 브라우저 이동과 겹치므로 무시한다.
 */
export function useRadioGroup(count: number, checkedIndex: number | null, select: (index: number) => void) {
  const items = useRef<(HTMLElement | null)[]>([]);
  const tabbable = checkedIndex !== null && checkedIndex >= 0 && checkedIndex < count ? checkedIndex : 0;

  return {
    /** 칸의 ref 로 넘긴다: ref={ref(index)} */
    ref: (index: number) => (element: HTMLElement | null) => {
      items.current[index] = element;
    },
    /** 칸의 tabIndex 로 넘긴다. */
    tabIndex: (index: number): 0 | -1 => (index === tabbable ? 0 : -1),
    /** 칸의 onKeyDown 으로 넘긴다: onKeyDown={(event) => onKeyDown(event, index)} */
    onKeyDown: (event: KeyboardEvent<HTMLElement>, index: number) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const next = nextRadioIndex(event.key, index, count);
      if (next === null) return;
      event.preventDefault();
      select(next);
      items.current[next]?.focus();
    },
  };
}
