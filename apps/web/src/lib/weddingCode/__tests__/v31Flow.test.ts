import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_TASTES } from "@/constants/weddingCodeV31";
import { createV31Draft, decodeV31, encodeV31 } from "../v31";
import {
  V31_CORE_INDEXES, V31_CORE_SCREEN_INDEXES, V31_EXTRA_INDEXES, V31_FULL_INDEXES, V31_LEGACY_ONLY_INDEXES, V31_PRIORITY_INDEX,
  getV31FlowIndexes, getV31MissingIndex, getV31NextIndex, getV31PreviousIndex,
  getV31ResponseAt, getV31ScreenIndexes, isV31CoreComplete, isV31FullComplete,
} from "../v31Flow";

function coreDraft() {
  const draft = createV31Draft();
  for (const id of ["G1", "G3", "R4", "B1", "B3", "D1", "T1", "T2", "T3", "F1", "F2", "F4", "H1", "H2", "H4"] as const) draft.answers[id] = 4;
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "undecided" };
  draft.avoidances = { status: "no_preference" };
  draft.spending = { status: "no_preference" };
  return draft;
}

describe("v3.1 핵심·추가 흐름의 응답 의미 보존", () => {
  it("완료에 필요한 기본 자리는 23개 그대로이고, 화면은 그 뒤에 우선순위를 한 번만 묻는다", () => {
    expect(V31_CORE_INDEXES).toEqual([1, 3, 5, 6, 8, 10, 13, 14, 15, 17, 18, 20, 21, 22, 24, 25, 26, 27, 28, 29, 30, 31, 33]);
    expect(getV31FlowIndexes("core")).toEqual(V31_CORE_INDEXES);
    // 화면은 주제별 페이지 순서로 묻는다(2026-09-27). 묻는 자리는 완료 판정 23개와 끝의 우선순위 하나 그대로다.
    expect(V31_CORE_SCREEN_INDEXES).toEqual([1, 3, 29, 6, 8, 33, 10, 13, 14, 15, 17, 18, 20, 21, 22, 24, 25, 26, 5, 27, 28, 30, 31, V31_PRIORITY_INDEX]);
    expect([...V31_CORE_SCREEN_INDEXES].sort((a, b) => a - b)).toEqual([...V31_CORE_INDEXES, V31_PRIORITY_INDEX].sort((a, b) => a - b));
    expect(getV31ScreenIndexes("core")).toEqual(V31_CORE_SCREEN_INDEXES);
    expect(V31_EXTRA_INDEXES).toEqual([0, 2, 4, 9, 12, 16, 19, 23]);
    expect(getV31ScreenIndexes("extra")).toEqual(V31_EXTRA_INDEXES);
    expect(V31_LEGACY_ONLY_INDEXES).toEqual([7, 11]);
    expect(V31_FULL_INDEXES).toEqual(Array.from({ length: 34 }, (_, index) => index));
    expect([...V31_CORE_INDEXES, ...V31_EXTRA_INDEXES, ...V31_LEGACY_ONLY_INDEXES, V31_PRIORITY_INDEX].sort((a, b) => a - b)).toEqual(V31_FULL_INDEXES);
    // 기본 화면과 선택 화면을 이어 봐도 우선순위는 한 번만 나온다.
    expect([...getV31ScreenIndexes("core"), ...getV31ScreenIndexes("extra")].filter(index => index === V31_PRIORITY_INDEX)).toHaveLength(1);
    expect(getV31FlowIndexes("full")).toEqual(V31_FULL_INDEXES);
    expect(getV31ScreenIndexes("full")).toEqual(V31_FULL_INDEXES);
  });

  it("비어 있는 칸은 화면에서 묻는 순서로 먼저 찾는다", () => {
    // 옷 문장(R4)과 하객 규모가 둘 다 비었으면, 화면에서 먼저 묻는 하객 규모(1쪽)부터 안내한다. R4 는 9쪽이다.
    const draft = coreDraft();
    delete draft.answers.R4; delete draft.tastes.guests;
    expect(getV31MissingIndex(draft, "core")).toBe(29);
    delete draft.spending;
    expect(getV31MissingIndex(draft, "core")).toBe(29);
    draft.tastes.guests = { status: "undecided" };
    expect(getV31MissingIndex(draft, "core")).toBe(33);
    draft.spending = { status: "no_preference" };
    expect(getV31MissingIndex(draft, "core")).toBe(5);
  });

  it("화면 순번이 아닌 기존 질문 자리로 앞뒤 이동하며 다른 흐름으로 새지 않는다", () => {
    expect(getV31PreviousIndex("core", 1)).toBeNull();
    expect(getV31NextIndex("core", 1)).toBe(3);
    expect(getV31PreviousIndex("core", 3)).toBe(1);
    expect(getV31NextIndex("core", 3)).toBe(29);
    expect(getV31NextIndex("core", 33)).toBe(10);
    expect(getV31NextIndex("core", 31)).toBe(32);
    expect(getV31NextIndex("core", 32)).toBeNull();
    expect(getV31PreviousIndex("core", 32)).toBe(31);
    expect(getV31NextIndex("extra", 19)).toBe(23);
    expect(getV31NextIndex("extra", 23)).toBeNull();
    expect(getV31NextIndex("extra", 32)).toBeNull();
    expect(getV31NextIndex("full", 31)).toBe(32);
    expect(getV31NextIndex("core", 0)).toBeNull();
    expect(getV31PreviousIndex("extra", 1)).toBeNull();
  });

  it("23개 완료는 나머지를 보지 않은 채 결과와 공유에 쓸 수 있으며 원답을 채우지 않는다", () => {
    const draft = coreDraft();
    const before = structuredClone(draft);
    // 화면에서는 우선순위를 묻지만, 서버 함께 보기 계약이 쓰는 완료 판정은 우선순위 없이 참이다.
    expect(isV31CoreComplete(draft)).toBe(true);
    expect(isV31FullComplete(draft)).toBe(false);
    expect(getV31MissingIndex(draft, "core")).toBeNull();
    expect(getV31MissingIndex(draft, "extra")).toBe(0);
    expect(getV31MissingIndex(draft, "full")).toBe(0);
    expect(getV31ResponseAt(draft, 1)).toBe(4);
    expect(getV31ResponseAt(draft, 25)).toEqual({ status: "undecided" });
    expect(getV31ResponseAt(draft, 31)).toEqual({ status: "no_preference" });
    expect(getV31ResponseAt(draft, 32)).toBeUndefined();
    expect(getV31ResponseAt(draft, 33)).toEqual({ status: "no_preference" });
    expect(getV31ResponseAt(draft, -1)).toBeUndefined();
    expect(getV31ResponseAt(draft, 34)).toBeUndefined();
    expect(getV31ResponseAt(draft, 1.5)).toBeUndefined();
    expect(encodeV31(draft).split("_")[1]).toBe("-4-4-44-4-4--444-44-444-4");
    expect(decodeV31(encodeV31(draft))).toEqual(before);
    expect(draft).toEqual(before);
    expect(draft.priorities).toBeUndefined();
  });

  it("누락된 핵심 답으로 완료되지 않으며 모름·비해당·건너뜀은 명시적 응답으로 보존한다", () => {
    const draft = coreDraft();
    delete draft.answers.H4;
    expect(isV31CoreComplete(draft)).toBe(false);
    expect(getV31MissingIndex(draft, "core")).toBe(24);
    draft.answers.H4 = "skipped";
    draft.answers.B1 = "not_applicable";
    draft.answers.G1 = "undecided";
    expect(isV31CoreComplete(draft)).toBe(true);
    delete draft.tastes.photo;
    expect(getV31MissingIndex(draft, "core")).toBe(26);
    expect(isV31CoreComplete(draft)).toBe(false);
    draft.tastes.photo = { status: "skipped" };
    delete draft.spending;
    expect(getV31MissingIndex(draft, "core")).toBe(33);
  });

  it("기존 전체 응답과 선택 질문 답은 짧은 흐름에서 검사해도 손실되지 않는다", () => {
    const draft = coreDraft();
    for (const question of WEDDING_CODE_V31_QUESTIONS) draft.answers[question.id] = 5;
    draft.priorities = { status: "answered", values: ["V1", "G2", "R3"] };
    const original = encodeV31(draft);
    expect(isV31CoreComplete(draft)).toBe(true);
    expect(isV31FullComplete(draft)).toBe(true);
    expect(getV31MissingIndex(draft, "extra")).toBeNull();
    expect(encodeV31(draft)).toBe(original);
    expect(decodeV31(original)).toEqual(draft);
  });
});
