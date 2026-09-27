import { WEDDING_CODE_V31_QUESTIONS, type V31Draft } from "@/constants/weddingCodeV31";
import { V31_CORE_PAGE_INDEXES, getV31MissingIndex, getV31NextIndex, getV31PreviousIndex, getV31ResponseAt, getV31ScreenIndexes, type V31Flow } from "./v31Flow";

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

/**
 * 이어 하기로 열 자리. 저장된 자리보다 앞 페이지에 빈 칸이 있으면 그 페이지부터 연다. 2026-09-27 에 기본 흐름을 주제별로
 * 다시 묶으면서 하객 규모와 더 쓰고 싶은 곳이 1·2쪽으로 옮겨 갔다. 예전 묶음에서 중간까지 답한 사람은 그 두 칸이 빈 채로
 * 뒤 페이지에 저장돼 있다. 새 묶음에서는 빈 칸이 있으면 다음 페이지로 못 가므로 저장 자리 앞에 빈 칸이 생기지 않는다.
 */
export function getV31ResumeIndex(draft: V31Draft, flow: V31Flow, index: number, editing: boolean): number {
  if (flow !== "core" || editing) return index;
  const missing = getV31MissingIndex(draft, flow);
  if (missing === null) return index;
  const saved = getV31Page(flow, index);
  const target = getV31Page(flow, missing);
  return target.position >= 0 && target.position < saved.position ? target.indexes[0] : index;
}

export function getV31PageMissingIndex(draft: V31Draft, indexes: readonly number[]): number | null {
  return indexes.find(index => getV31ResponseAt(draft, index) === undefined) ?? null;
}

export function isV31PageComplete(draft: V31Draft, indexes: readonly number[]): boolean {
  return indexes.length > 0 && getV31PageMissingIndex(draft, indexes) === null;
}
