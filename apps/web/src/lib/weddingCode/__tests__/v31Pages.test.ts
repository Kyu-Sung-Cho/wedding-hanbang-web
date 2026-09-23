import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V31_QUESTIONS } from "@/constants/weddingCodeV31";
import { createV31Draft, encodeV31 } from "../v31";
import { V31_CORE_INDEXES, V31_EXTRA_INDEXES, V31_FULL_INDEXES, getV31IndexForId } from "../v31Flow";
import { getV31Page, getV31PageMissingIndex, getV31Pages, isV31PageComplete } from "../v31Pages";

describe("v3.1 페이지는 기존 응답 자리를 바꾸지 않는다", () => {
  it("기본 15문장은 5쪽, 선택형 8개는 각각 한 쪽으로 만들고 기존 순서를 지킨다", () => {
    const pages = getV31Pages("core");
    expect(pages).toEqual([[1, 3, 5], [6, 8, 10], [13, 14, 15], [17, 18, 20], [21, 22, 24], [25], [26], [27], [28], [29], [30], [31], [33]]);
    expect(pages.flat()).toEqual(V31_CORE_INDEXES);
    expect(getV31Pages("extra")).toEqual([[0, 2, 4], [9, 12, 16], [19, 23], [32]]);
    expect(getV31Pages("extra").flat()).toEqual(V31_EXTRA_INDEXES);
    expect(getV31Pages("full")).toEqual(V31_FULL_INDEXES.map(index => [index]));
  });

  it("페이지 중간 질문 자리로 복원해도 같은 묶음을 열고 앞뒤 페이지 첫 자리로 이동한다", () => {
    for (const index of [6, 8, 10]) expect(getV31Page("core", index)).toEqual({
      indexes: [6, 8, 10], position: 1, total: 13, previousIndex: 1, nextIndex: 13,
    });
    expect(getV31Page("core", 3).previousIndex).toBeNull();
    expect(getV31Page("core", 33).nextIndex).toBeNull();
    expect(getV31Page("extra", 23)).toMatchObject({ indexes: [19, 23], previousIndex: 9, nextIndex: 32 });
    expect(getV31Page("full", 8)).toMatchObject({ indexes: [8], previousIndex: 7, nextIndex: 9, total: 34 });
  });

  it("결과 수정은 흐름 밖 문장도 한 개만 열고 기존 다음·이전 질문 의미를 유지한다", () => {
    expect(getV31Page("core", getV31IndexForId("B3"), true)).toMatchObject({ indexes: [8], previousIndex: 6, nextIndex: 10 });
    expect(getV31Page("core", getV31IndexForId("V1"), true)).toMatchObject({ indexes: [0], previousIndex: null, nextIndex: null });
    expect(getV31Page("core", -1)).toMatchObject({ indexes: [], previousIndex: null, nextIndex: null });
  });

  it("세 문장에 모두 명시적으로 답해야 끝나며 중간·모름·계획 없음·건너뜀을 그대로 보존한다", () => {
    const draft = createV31Draft();
    const page = getV31Page("core", 1);
    expect(getV31PageMissingIndex(draft, page.indexes)).toBe(1);
    draft.answers.G1 = 3;
    expect(isV31PageComplete(draft, page.indexes)).toBe(false);
    expect(getV31PageMissingIndex(draft, page.indexes)).toBe(3);
    draft.answers.G3 = "undecided";
    expect(isV31PageComplete(draft, page.indexes)).toBe(false);
    draft.answers.R4 = "not_applicable";
    const before = encodeV31(draft);
    expect(isV31PageComplete(draft, page.indexes)).toBe(true);
    expect(getV31PageMissingIndex(draft, page.indexes)).toBeNull();
    expect(encodeV31(draft)).toBe(before);
    draft.answers.R4 = "skipped";
    expect(isV31PageComplete(draft, page.indexes)).toBe(true);
    expect(draft.answers).toEqual({ G1: 3, G3: "undecided", R4: "skipped" });
    expect(isV31PageComplete(draft, [])).toBe(false);
    expect(isV31PageComplete(draft, [-1])).toBe(false);
  });

  it("보기 질문은 동의 응답과 섞거나 기본 답을 채우지 않고 직접 선택한 상태만 받는다", () => {
    const draft = createV31Draft();
    for (const question of WEDDING_CODE_V31_QUESTIONS) draft.answers[question.id] = 5;
    expect(isV31PageComplete(draft, [25])).toBe(false);
    draft.tastes.venue = { status: "undecided" };
    expect(isV31PageComplete(draft, [25])).toBe(true);
    expect(isV31PageComplete(draft, [33])).toBe(false);
    draft.spending = { status: "no_preference" };
    expect(isV31PageComplete(draft, [33])).toBe(true);
    expect(draft.priorities).toBeUndefined();
  });
});
