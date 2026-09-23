// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V31_TASTES, type V31Draft } from "@/constants/weddingCodeV31";
import { createV31Draft } from "@/lib/weddingCode/v31";
import WeddingCodeV31Results from "./WeddingCodeV31Results";

function basicDraft(): V31Draft {
  const draft = createV31Draft();
  draft.answers = { G1: 5, G3: 4, R4: 4, B1: 5, B3: 2, D1: 4, T1: 4, T2: 4, T3: 4, F1: 4, F2: 5, F4: 4, H1: 4, H2: 4, H4: 4 };
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "answered", values: [taste.options[0].value] };
  draft.avoidances = { status: "no_preference" };
  draft.spending = { status: "no_preference" };
  return draft;
}

function render(draft: V31Draft, first: V31Draft | null = null) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<WeddingCodeV31Results draft={draft} first={first} received={false}
    shareOrigin="https://hanbang.ai" onEdit={() => {}} onRestart={() => {}} onMore={() => {}} optionalCount={9} />);
  return container;
}

describe("짧은 웨딩코드 결과의 미노출 문항", () => {
  it("기본 답 23개만 세고 보지 않은 문항을 빈 우선순위나 미정 목록으로 만들지 않는다", () => {
    const view = render(basicDraft());
    expect(view.textContent).toContain("답을 남긴 질문은 23개예요.");
    expect(view.textContent).toContain("원하면 더 알아보기 (선택)");
    expect(view.textContent).not.toContain("내가 직접 고른 우선순위");
    expect(view.textContent).not.toContain("꽃 장식이 풍성한 공간에서 식을 올리고 싶다.");
    expect(view.textContent).not.toContain("모르거나, 해당하지 않거나, 답하지 않은 내용");
  });

  it("직접 건너뛴 선택 질문은 보지 않은 질문과 달리 결과에 그대로 남긴다", () => {
    const draft = basicDraft();
    draft.answers.V1 = "skipped";
    draft.priorities = { status: "skipped" };
    const view = render(draft);
    expect(view.textContent).toContain("답을 남긴 질문은 25개예요.");
    expect(view.textContent).toContain("꽃 장식이 풍성한 공간에서 식을 올리고 싶다.");
    expect(view.textContent).toContain("우선순위는 이번에 고르지 않았어요.");
    expect(view.textContent).toContain("모르거나, 해당하지 않거나, 답하지 않은 내용");
  });

  it("둘 다 안 본 질문은 비교에서 빼고 한 사람만 답한 질문은 차이로 만들지 않는다", () => {
    const first = basicDraft();
    const second = basicDraft();
    const bothCore = render(second, first);
    expect(bothCore.querySelector('[data-comparison="V1"]')).toBeNull();
    expect(bothCore.querySelector('[data-comparison="B2"]')).toBeNull();
    expect(bothCore.querySelector('[data-comparison="D2"]')).toBeNull();
    expect(bothCore.querySelector('[data-comparison="G1"]')).not.toBeNull();
    first.answers.V1 = 5;
    const mixed = render(second, first);
    const extra = mixed.querySelector('[data-comparison="V1"]');
    expect(extra).not.toBeNull();
    expect(extra?.closest("details")?.querySelector("summary")?.textContent).toBe("아직 함께 비교하지 않은 내용");
    expect(extra?.textContent).toContain("아직 보지 않은 문장이에요");
  });
});
