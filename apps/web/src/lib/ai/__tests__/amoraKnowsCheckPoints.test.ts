import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";

/**
 * 아모라가 준비 항목의 확인 포인트를 실제로 받는가.
 *
 * 2026-08-19까지 아모라는 체크리스트를 `할일: 3/9완료` 같은 **개수로만** 봤다. 항목 이름도,
 * 항목에 붙은 한 줄 안내(`note`)도 못 봤다. 그래서 "예식장 계약할 때 뭐 확인해?"라고 물으면
 * 같은 제품 안에 답이 있는데도 일반론으로 답했다 — 화면과 대화가 다른 말을 했다.
 *
 * `note`는 저장되지 않으므로(저장 직전에 떼어 낸다) 사용자 행에서는 절대 읽을 수 없다.
 * 템플릿에서 프롬프트로 넣는 이 경로가 유일하다. 그래서 여기가 끊기면 조용히 예전으로 돌아간다.
 */
const baseContext = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  brideName: null,
  groomName: null,
  senderName: "민이",
  scheduleEvents: [],
  chatSummaries: [],
  bookings: [],
};

const prompt = getWeddingPlannerSystemPrompt(baseContext as never);
const notedItems = CATEGORY_CHECKLISTS.flatMap((category) =>
  category.items.filter((item) => item.note).map((item) => ({ category, item })),
);

describe("아모라가 준비 항목의 확인 포인트를 안다", () => {
  it("안내가 붙은 항목이 실제로 있다", () => {
    expect(notedItems.length).toBeGreaterThan(0);
  });

  it("모든 안내 문장이 프롬프트에 그대로 들어간다", () => {
    const missing = notedItems
      .filter(({ item }) => !prompt.includes(item.note!))
      .map(({ category, item }) => `${category.key}/${item.id}`);
    expect(missing, "프롬프트에 빠진 안내").toEqual([]);
  });

  it("어느 분야의 안내인지 알 수 있다", () => {
    // 문장만 있으면 아모라가 맥락 없이 인용한다. 분야 이름이 같이 있어야 한다.
    const categories = new Set(notedItems.map(({ category }) => category.label));
    for (const label of categories) {
      expect(prompt, `${label} 이름이 없다`).toContain(label);
    }
  });

  it("지어내지 말라고 못박는다", () => {
    expect(prompt).toContain("여기 없는 항목의 확인 포인트를 지어내지 마세요");
  });

  it("계약 판정으로 넘어가지 말라고 못박는다", () => {
    // 계약 해석·판정은 2026-08-18에 제품에서 전면 제거한 축이다. 위약금·철회 얘기를
    // 하다 보면 "이 조항은 불리합니다"로 넘어가기 쉬워서 프롬프트에서 먼저 막는다.
    expect(prompt).toContain("계약 판정이 아닙니다");
    expect(prompt).toContain("유리한지 불리한지");
  });

  it("수치와 법령 이름을 붙이지 말라고 못박는다", () => {
    expect(prompt).toContain("금액·기간 수치나 법령 이름을 붙이지 마세요");
  });

  it("안내 문장 자체에 숫자가 섞여 들어가지 않는다", () => {
    // 문구 계약(checklistNotes.test.ts)과 같은 기준. 프롬프트로 나가는 것도 같아야 한다.
    const withDigits = notedItems
      .filter(({ item }) => /[0-9]/.test(item.note!))
      .map(({ item }) => item.id);
    expect(withDigits).toEqual([]);
  });
});
