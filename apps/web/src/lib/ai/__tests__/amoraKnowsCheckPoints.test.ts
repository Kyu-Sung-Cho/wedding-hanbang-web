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

  /**
   * 2026-09-02 — **전부 싣는 것에서 예산 안에서 싣는 것으로** 바꿨다.
   *
   * 전부 실으면 9,162자로 상한 48,000자의 19% 를 한 섹션이 가져갔고, 실측 결과
   * 데이터가 든 커플은 프롬프트가 100.0%(남은 자리 10자)였다. 넘치면 꼬리부터
   * 잘리는데 꼬리에는 이 커플의 예산·일정·결정 히스토리가 있다.
   *
   * 그래서 이 검사가 지키는 것을 바꿨다. "모든 문장이 있다" 가 아니라
   * **"이 커플이 손대고 있는 것은 반드시 있고, 전체는 예산 안이다"** 이다.
   * 경로가 통째로 끊기면 여전히 빨개진다 — 그것이 원래 이 파일의 이유다.
   */
  it("경로가 살아 있다 — 확인 포인트가 실제로 프롬프트에 들어간다", () => {
    const present = notedItems.filter(({ item }) => prompt.includes(item.note!));
    expect(present.length).toBeGreaterThan(0);
  });

  it("이 커플이 손대고 있는 분야의 안내는 빠지지 않는다", () => {
    // 진행 중인 카테고리 셋을 골라 그 안내가 전부 실리는지 본다.
    const active = CATEGORY_CHECKLISTS
      .filter((category) => category.items.some((item) => item.note))
      .slice(-3); // 템플릿 순서상 뒤쪽 = 예산이 없으면 먼저 잘리는 쪽
    const activePrompt = getWeddingPlannerSystemPrompt({
      ...baseContext,
      progress: Object.fromEntries(active.map((c) => [c.key, { completed: 1 }])),
    } as never);

    const missing = active.flatMap((category) =>
      category.items
        .filter((item) => item.note && !activePrompt.includes(item.note))
        .map((item) => `${category.key}/${item.id}`),
    );
    expect(missing, "진행 중인 분야의 안내가 빠졌다").toEqual([]);
  });

  it("전체는 예산 안에 머문다 — 커플 문맥을 밀어내지 않는다", () => {
    const section = prompt.split("## 준비 항목에서 확인할 것")[1] ?? "";
    const body = section.split("- 여기 없는 항목의")[0] ?? "";
    expect(body.length).toBeGreaterThan(0);
    // 여유를 조금 둔다. 정확한 상수는 구현이 정하고, 여기서는 자릿수를 지킨다.
    expect(body.length).toBeLessThan(4_000);
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
