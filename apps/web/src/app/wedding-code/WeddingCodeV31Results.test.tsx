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

function render(draft: V31Draft, first: V31Draft | null = null, received = false) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<WeddingCodeV31Results draft={draft} first={first} received={received}
    shareOrigin="https://hanbang.ai" onEdit={() => {}} onRestart={() => {}} onMore={() => {}} optionalCount={9} />);
  return container;
}

describe("짧은 웨딩코드 결과의 미노출 문항", () => {
  it("네 글자와 독립 문장 척도를 실제 답에서 보여주며 선택 질문을 만들어 채우지 않는다", () => {
    const view = render(basicDraft());
    const summary = view.querySelector('[data-style-summary="KBBB"]');
    expect(summary).not.toBeNull();
    expect(summary?.querySelector('[data-statement-scale="B1"] [role="meter"]')?.getAttribute("aria-valuenow")).toBe("100");
    expect(summary?.querySelector('[data-statement-scale="B3"] [role="meter"]')?.getAttribute("aria-valuenow")).toBe("25");
    expect(summary?.querySelector('[data-statement-scale="T1"] [role="meter"]')?.getAttribute("aria-valuenow")).toBe("75");
    expect(summary?.querySelector('[data-statement-scale="T2"] [role="meter"]')?.getAttribute("aria-valuenow")).toBe("75");
    expect(summary?.querySelector('[data-statement-scale="V1"]')).toBeNull();
    expect(summary?.textContent).toContain("문장 동의 정도");
  });

  it("모름·비해당·건너뜀은 수치로 바꾸지 않고 답이 없는 코드 자리를 보류한다", () => {
    const draft = basicDraft();
    draft.answers.B1 = "undecided";
    draft.answers.T1 = "not_applicable";
    draft.answers.F1 = "skipped";
    delete draft.answers.H1;
    const view = render(draft);
    const summary = view.querySelector('[data-style-summary="????"]');
    expect(summary).not.toBeNull();
    for (const id of ["B1", "T1", "F1", "H1"]) {
      expect(summary?.querySelector(`[data-statement-scale="${id}"] [role="meter"]`)).toBeNull();
    }
    expect(summary?.textContent).toContain("이번 계획에는 없어요");
    expect(summary?.textContent).toContain("지금 답하지 않을게요");
  });

  it("커플의 순서와 소유권을 유지하고 받은 링크에는 답 수정 버튼을 추가하지 않는다", () => {
    const first = basicDraft();
    const second = basicDraft();
    second.answers.B1 = 2; second.answers.B3 = 5;
    const view = render(second, first);
    const summaries = view.querySelectorAll("[data-style-summary]");
    expect(summaries).toHaveLength(2);
    expect(summaries[0].getAttribute("data-style-summary")).toBe("KBBB");
    expect(summaries[1].getAttribute("data-style-summary")).toBe("RBBB");
    expect(summaries[0].getAttribute("aria-label")).toBe("상대");
    expect(summaries[1].getAttribute("aria-label")).toBe("나");
    expect(summaries[0].querySelectorAll("button")).toHaveLength(0);
    expect(summaries[1].querySelectorAll("button").length).toBeGreaterThan(0);
    const received = render(second, first, true);
    expect([...view.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(["함께 보기", "내 결과", "상대 결과"]);
    expect([...received.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(["함께 보기", "먼저 답한 사람", "나중에 답한 사람"]);
    expect([...received.querySelectorAll("[data-style-summary]")].map(summary => summary.getAttribute("aria-label"))).toEqual(["먼저 답한 사람", "나중에 답한 사람"]);
    for (const summary of received.querySelectorAll("[data-style-summary]")) {
      expect(summary.querySelectorAll("button")).toHaveLength(0);
    }
    expect(view.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    expect(view.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("함께 보기");
    expect(view.querySelector('[data-comparison="B1"] dt')?.textContent).toBe("상대");
    expect(received.querySelector('[data-comparison="B1"] dt')?.textContent).toBe("먼저 답한 사람");
    expect(view.textContent).toContain("같은 코드여도 구체적인 취향과 답은 다를 수 있어요.");
  });

  it("기본 답 23개만 세고 보지 않은 문항을 빈 우선순위나 미정 목록으로 만들지 않는다", () => {
    const view = render(basicDraft());
    expect(view.textContent).toContain("답을 남긴 질문은 23개예요.");
    expect(view.textContent).toContain("원하면 더 알아보기 (선택)");
    expect(view.textContent).not.toContain("내가 직접 고른 우선순위");
    expect(view.textContent).not.toContain("꽃 장식이 풍성한 공간에서 식을 올리고 싶다.");
    expect(view.textContent).not.toContain("모름·계획 없음·답하지 않음·맞는 보기 없음");
  });

  it("직접 건너뛴 선택 질문은 보지 않은 질문과 달리 결과에 그대로 남긴다", () => {
    const draft = basicDraft();
    draft.answers.V1 = "skipped";
    draft.priorities = { status: "skipped" };
    const view = render(draft);
    expect(view.textContent).toContain("답을 남긴 질문은 25개예요.");
    expect(view.textContent).toContain("꽃 장식이 풍성한 공간에서 식을 올리고 싶다.");
    expect(view.textContent).toContain("우선순위는 이번에 고르지 않았어요.");
    expect(view.textContent).toContain("모름·계획 없음·답하지 않음·맞는 보기 없음");
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

  it("우선순위와 연결된 조합은 한 번만 보여주고 원래 우선순위와 추가 근거를 구별한다", () => {
    const draft = basicDraft();
    draft.answers.B3 = 5;
    draft.priorities = { status: "answered", values: ["B1", "B3", "T2"] };
    draft.spending = { status: "answered", values: ["photo"] };
    const view = render(draft);
    const guides = view.querySelector("[data-priority-guides]")!;
    expect([...guides.querySelectorAll("[data-insight]")].map(item => item.getAttribute("data-insight"))).toEqual(["priority-budget-revisit", "priority-budget-explicit-spending", "priority-delegate-update"]);
    for (const id of ["budget-revisit", "budget-explicit-spending", "delegate-update", "single-B1", "single-B3", "single-T2", "single-T3"]) {
      expect(view.querySelector(`[data-insight="${id}"]`)).toBeNull();
    }
    expect(view.querySelector('[data-insight="family-listen-decide"]')).not.toBeNull();
    const delegate = guides.querySelector('[data-insight="priority-delegate-update"]')!;
    expect(delegate.textContent).toContain("각자 맡은 일도 진행 중에 어디까지 했는지 서로 알려주면 좋겠다.");
    const selected = [...delegate.querySelectorAll("li")].find(item => item.textContent?.includes("이 설명에서 내가 우선순위로 고른 것"));
    expect(selected?.textContent).toContain("계약·추가 결제 없는 세부 선택 맡기기");
    expect(selected?.textContent).not.toContain("진행 상황 중간에 알려주기");
  });

  it("단일 문장과 취향 우선순위도 일반 설명에서 반복하지 않는다", () => {
    const draft = basicDraft();
    draft.answers.V1 = 5;
    draft.avoidances = { status: "answered", values: ["heavy_decoration", "loud_music"] };
    draft.priorities = { status: "answered", values: ["V1", "taste.photo", "H4"] };
    const view = render(draft);
    expect(view.querySelector('[data-insight="priority-flower-amount"]')).not.toBeNull();
    expect(view.querySelector('[data-insight="priority-taste.photo"]')).not.toBeNull();
    expect(view.querySelector('[data-insight="priority-H4"]')).not.toBeNull();
    for (const id of ["flower-amount", "single-V1", "avoid-heavy_decoration", "direct-photo", "single-H4"]) expect(view.querySelector(`[data-insight="${id}"]`)).toBeNull();
    expect(view.querySelector('[data-insight="avoid-loud_music"]')).not.toBeNull();
  });

  it("참여 방식 조합에서 설명한 직접 취향과 회피만 정리하고 다른 회피는 남긴다", () => {
    const draft = basicDraft();
    draft.tastes.ceremony = { status: "answered", values: ["participatory", "our_story"] };
    draft.avoidances = { status: "answered", values: ["stage_participation", "crowded_space"] };
    draft.priorities = { status: "answered", values: ["taste.ceremony"] };
    const view = render(draft);
    expect(view.querySelector('[data-insight="priority-participation-format"]')).not.toBeNull();
    for (const id of ["participation-format", "direct-ceremony", "avoid-stage_participation"]) expect(view.querySelector(`[data-insight="${id}"]`)).toBeNull();
    expect(view.querySelector('[data-insight="avoid-crowded_space"]')).not.toBeNull();
    expect(view.textContent).toContain("둘의 이야기를 담은 순서");
  });

  it("맞는 보기가 없는 개인 답과 커플 답을 취향 미정으로 설명하지 않는다", () => {
    const draft = basicDraft();
    draft.tastes.attire = { status: "no_match" };
    const solo = render(draft);
    const states = [...solo.querySelectorAll("details")].find(item => item.querySelector("summary")?.textContent === "모름·계획 없음·답하지 않음·맞는 보기 없음")!;
    expect(states.textContent).toContain("‘맞는 보기가 없어요’는 취향이 아직 정해지지 않았다는 뜻은 아니에요.");
    expect(states.textContent).toContain("어떤 옷을 입고 싶나요?");
    expect(states.textContent).toContain("맞는 보기가 없어요");
    expect(states.textContent).not.toContain("안 정했다고");
    const first = basicDraft(); first.tastes.attire = { status: "undecided" };
    const pair = render(draft, first);
    const item = pair.querySelector('[data-comparison="taste.attire"]')!;
    expect(item.textContent).toContain("맞는 보기가 없어요");
    expect(item.textContent).toContain("아직 모르겠어요");
    expect(item.closest("details")?.textContent).toContain("보기 밖의 생각이 있는 답을 미정으로 바꾸거나");
  });

  it("세부 선택을 맡겨도 괜찮다는 동의를 반드시 원하는 것으로 바꾸지 않는다", () => {
    const draft = basicDraft();
    const view = render(draft, basicDraft());
    const item = view.querySelector('[data-comparison="T2"]')!;
    expect(item.closest("section")?.querySelector("h2")?.textContent).toBe("함께 동의하거나 고른 내용");
    expect(item.closest("section")?.textContent).toContain("‘맡겨도 괜찮다’는 허용");
    expect(item.closest("section")?.textContent).not.toContain("둘 다 원한다고");
  });
});
