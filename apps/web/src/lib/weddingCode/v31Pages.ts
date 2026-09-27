import { WEDDING_CODE_V31_QUESTIONS, type V31Draft } from "@/constants/weddingCodeV31";
import { V31_CORE_PAGE_INDEXES, getV31NextIndex, getV31PreviousIndex, getV31ResponseAt, getV31ScreenIndexes, type V31Flow } from "./v31Flow";

export type V31Page = {
  indexes: readonly number[];
  position: number;
  total: number;
  previousIndex: number | null;
  nextIndex: number | null;
};

/**
 * 저장된 질문 자리는 그대로 두고 화면에서 함께 보여줄 묶음만 정한다. 기본 흐름은 주제별 페이지(V31_CORE_PAGES)이고,
 * 선택 흐름은 주제가 모두 달라 이어지는 동의 문장을 3개씩 묶는다. 이전 전체 흐름은 한 문항씩이다.
 */
export function getV31Pages(flow: V31Flow): readonly (readonly number[])[] {
  if (flow === "core") return V31_CORE_PAGE_INDEXES;
  const pages: number[][] = [];
  for (const index of getV31ScreenIndexes(flow)) {
    const previous = pages.at(-1);
    if (flow !== "full" && index < WEDDING_CODE_V31_QUESTIONS.length
      && previous && previous.length < 3 && previous[0] < WEDDING_CODE_V31_QUESTIONS.length) previous.push(index);
    else pages.push([index]);
  }
  return pages;
}

export function getV31Page(flow: V31Flow, index: number, editing = false): V31Page {
  if (editing) return {
    indexes: [index], position: getV31ScreenIndexes(flow).indexOf(index), total: getV31ScreenIndexes(flow).length,
    previousIndex: getV31PreviousIndex(flow, index), nextIndex: getV31NextIndex(flow, index),
  };
  const pages = getV31Pages(flow);
  const position = pages.findIndex(page => page.includes(index));
  return {
    indexes: pages[position] ?? [], position, total: pages.length,
    previousIndex: position > 0 ? pages[position - 1][0] : null,
    nextIndex: position >= 0 ? pages[position + 1]?.[0] ?? null : null,
  };
}

export function getV31PageMissingIndex(draft: V31Draft, indexes: readonly number[]): number | null {
  return indexes.find(index => getV31ResponseAt(draft, index) === undefined) ?? null;
}

export function isV31PageComplete(draft: V31Draft, indexes: readonly number[]): boolean {
  return indexes.length > 0 && getV31PageMissingIndex(draft, indexes) === null;
}
