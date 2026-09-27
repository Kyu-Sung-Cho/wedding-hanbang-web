import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V31_QUESTIONS } from "@/constants/weddingCodeV31";
import { createV31Draft, encodeV31 } from "../v31";
import {
  V31_ALL_STEP_IDS, V31_CORE_INDEXES, V31_CORE_SCREEN_INDEXES, V31_EXTRA_INDEXES, V31_FULL_INDEXES, V31_PRIORITY_INDEX, getV31IndexForId,
} from "../v31Flow";
import { getV31Page, getV31PageMissingIndex, getV31Pages, getV31ResumeIndex, isV31PageComplete } from "../v31Pages";

describe("v3.1 페이지는 기존 응답 자리를 바꾸지 않는다", () => {
  it("기본 흐름은 주제 하나에 한 쪽이고 우선순위는 혼자 맨 끝이며, 선택 흐름은 문장 3개씩 묶는다", () => {
    const pages = getV31Pages("core");
    // 함께할 사람(G1·G3·하객 규모) / 돈(B1·B3·더 쓰고 싶은 곳) / D1 / T / F / H / 장소 / 사진 / 입을 옷(R4·옷) / 식사 / 식순 / 피하고 싶은 것 / 우선순위
    expect(pages).toEqual([[1, 3, 29], [6, 8, 33], [10], [13, 14, 15], [17, 18, 20], [21, 22, 24], [25], [26], [5, 27], [28], [30], [31], [32]]);
    expect(pages.flat()).toEqual(V31_CORE_SCREEN_INDEXES);
    // 묶음만 바뀌고 묻는 자리는 그대로다: 완료 판정 23개와 우선순위 하나.
    expect([...pages.flat()].sort((a, b) => a - b)).toEqual([...V31_CORE_INDEXES, V31_PRIORITY_INDEX].sort((a, b) => a - b));
    expect(pages.at(-1)).toEqual([V31_PRIORITY_INDEX]);
    expect(getV31Pages("extra")).toEqual([[0, 2, 4], [9, 12, 16], [19, 23]]);
    expect(getV31Pages("extra").flat()).toEqual(V31_EXTRA_INDEXES);
    expect(getV31Pages("full")).toEqual(V31_FULL_INDEXES.map(index => [index]));
  });

  it("기본 페이지 하나에는 주제가 하나뿐이다", () => {
    // 고르기 칸의 주제: 하객 규모는 함께할 사람, 입을 옷은 옷의 기준, 더 쓰고 싶은 곳은 돈. 나머지 고르기는 각자 한 주제다.
    const topicOf = (index: number) => {
      const id = V31_ALL_STEP_IDS[index];
      const question = WEDDING_CODE_V31_QUESTIONS.find(item => item.id === id);
      if (question) return question.topic;
      return ({ "taste.guests": "guests", "taste.attire": "records", spending: "budget" } as Record<string, string>)[id] ?? id;
    };
    for (const page of getV31Pages("core")) expect(new Set(page.map(topicOf)).size, page.join(",")).toBe(1);
  });

  it("페이지 중간 질문 자리로 복원해도 같은 묶음을 열고 앞뒤 페이지 첫 자리로 이동한다", () => {
    for (const index of [6, 8, 33]) expect(getV31Page("core", index)).toEqual({
      indexes: [6, 8, 33], position: 1, total: 13, previousIndex: 1, nextIndex: 10,
    });
    expect(getV31Page("core", 3).previousIndex).toBeNull();
    expect(getV31Page("core", 29)).toMatchObject({ indexes: [1, 3, 29], position: 0 });
    expect(getV31Page("core", 31).nextIndex).toBe(32);
    expect(getV31Page("core", 32)).toMatchObject({ indexes: [32], position: 12, total: 13, previousIndex: 31, nextIndex: null });
    expect(getV31Page("extra", 23)).toMatchObject({ indexes: [19, 23], previousIndex: 9, nextIndex: null, total: 3 });
    expect(getV31Page("extra", 32)).toMatchObject({ indexes: [], position: -1 });
    expect(getV31Page("full", 8)).toMatchObject({ indexes: [8], previousIndex: 7, nextIndex: 9, total: 34 });
  });

  it("이어 하기는 저장 자리보다 앞 페이지에 빈 칸이 있으면 그 페이지부터 연다", () => {
    // 예전 묶음 3쪽(T1, 13)에 저장한 사람: G1·G3·R4·B1·B3·D1 만 답했고 하객 규모(1쪽)와 더 쓰고 싶은 곳(2쪽)이 비었다.
    const oldLayout = createV31Draft();
    for (const id of ["G1", "G3", "R4", "B1", "B3", "D1"] as const) oldLayout.answers[id] = 4;
    expect(getV31ResumeIndex(oldLayout, "core", 13, false)).toBe(1);
    oldLayout.tastes.guests = { status: "undecided" };
    expect(getV31ResumeIndex(oldLayout, "core", 13, false)).toBe(6);
    // 빈 칸이 저장 자리와 같은 페이지이거나 뒤에 있으면 저장 자리를 그대로 쓴다.
    oldLayout.spending = { status: "no_preference" };
    expect(getV31ResumeIndex(oldLayout, "core", 13, false)).toBe(13);
    const spendingOnly = createV31Draft();
    for (const id of ["G1", "G3", "B1", "B3"] as const) spendingOnly.answers[id] = 4;
    spendingOnly.tastes.guests = { status: "undecided" };
    expect(getV31ResumeIndex(spendingOnly, "core", 33, false)).toBe(33);
    // 수정 화면·선택 흐름·이전 전체 흐름은 저장 자리를 그대로 연다.
    expect(getV31ResumeIndex(createV31Draft(), "core", 13, true)).toBe(13);
    expect(getV31ResumeIndex(createV31Draft(), "extra", 9, false)).toBe(9);
    expect(getV31ResumeIndex(createV31Draft(), "full", 20, false)).toBe(20);
  });

  it("결과 수정은 흐름 밖 문장도 한 개만 열고 기존 다음·이전 질문 의미를 유지한다", () => {
    expect(getV31Page("core", getV31IndexForId("B3"), true)).toMatchObject({ indexes: [8], previousIndex: 6, nextIndex: 33 });
    expect(getV31Page("core", getV31IndexForId("V1"), true)).toMatchObject({ indexes: [0], previousIndex: null, nextIndex: null });
    expect(getV31Page("core", getV31IndexForId("priorities"), true)).toMatchObject({ indexes: [32], previousIndex: 31, nextIndex: null });
    expect(getV31Page("extra", getV31IndexForId("priorities"), true)).toMatchObject({ indexes: [32], previousIndex: null, nextIndex: null });
    expect(getV31Page("core", -1)).toMatchObject({ indexes: [], previousIndex: null, nextIndex: null });
  });

  it("한 페이지의 문장과 고르기에 모두 명시적으로 답해야 끝나며 중간·모름·계획 없음·건너뜀을 그대로 보존한다", () => {
    const draft = createV31Draft();
    const page = getV31Page("core", 1);
    expect(page.indexes).toEqual([1, 3, 29]);
    expect(getV31PageMissingIndex(draft, page.indexes)).toBe(1);
    draft.answers.G1 = 3;
    expect(isV31PageComplete(draft, page.indexes)).toBe(false);
    expect(getV31PageMissingIndex(draft, page.indexes)).toBe(3);
    draft.answers.G3 = "undecided";
    expect(isV31PageComplete(draft, page.indexes)).toBe(false);
    expect(getV31PageMissingIndex(draft, page.indexes)).toBe(29);
    draft.tastes.guests = { status: "not_applicable" };
    const before = encodeV31(draft);
    expect(isV31PageComplete(draft, page.indexes)).toBe(true);
    expect(getV31PageMissingIndex(draft, page.indexes)).toBeNull();
    expect(encodeV31(draft)).toBe(before);
    draft.tastes.guests = { status: "skipped" };
    expect(isV31PageComplete(draft, page.indexes)).toBe(true);
    expect(draft.answers).toEqual({ G1: 3, G3: "undecided" });
    expect(draft.tastes).toEqual({ guests: { status: "skipped" } });
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
