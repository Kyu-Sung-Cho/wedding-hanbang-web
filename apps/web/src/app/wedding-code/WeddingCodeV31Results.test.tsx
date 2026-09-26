// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V31_OPTIONS, WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_STATUS_OPTIONS, WEDDING_CODE_V31_TASTES, type V31Draft } from "@/constants/weddingCodeV31";
import { buildV31Profile, compareV31, createV31Draft, getV31PriorityOptions } from "@/lib/weddingCode/v31";
import { V31_STYLE_DIMENSIONS } from "@/lib/weddingCode/v31StyleSummary";
import { V31ChoiceInput } from "./WeddingCodeV31Inputs";
import WeddingCodeV31Results from "./WeddingCodeV31Results";

function basicDraft(): V31Draft {
  const draft = createV31Draft();
  draft.answers = { G1: 5, G3: 4, R4: 4, B1: 5, B3: 2, D1: 4, T1: 4, T2: 4, T3: 4, F1: 4, F2: 5, F4: 4, H1: 4, H2: 4, H4: 4 };
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "answered", values: [taste.options[0].value] };
  draft.avoidances = { status: "no_preference" };
  draft.spending = { status: "no_preference" };
  return draft;
}

function render(draft: V31Draft, first: V31Draft | null = null, received = false, readOnly = false) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<WeddingCodeV31Results draft={draft} first={first} received={received} readOnly={readOnly}
    shareOrigin="https://hanbang.ai" onEdit={() => {}} onRestart={() => {}} onMore={() => {}} optionalCount={9} />);
  return container;
}
/** 카드 제목(누구의 코드인지). 요약 카드 섹션의 이름은 이 제목에서 온다. */
function summaryHeading(summary: Element) {
  return summary.querySelector(`[id="${summary.getAttribute("aria-labelledby") ?? ""}"]`)?.textContent;
}

describe("짧은 웨딩코드 결과의 미노출 문항", () => {
  it("네 글자와 독립 문장 척도를 실제 답에서 보여주며 선택 질문을 만들어 채우지 않는다", () => {
    const view = render(basicDraft());
    const summary = view.querySelector('[data-style-summary="KBBB"]');
    expect(summary).not.toBeNull();
    expect(summary?.querySelector('[data-statement-scale="B1"] [role="img"]')?.getAttribute("aria-label")).toBe("다섯 칸 중 다섯 칸");
    expect(summary?.querySelector('[data-statement-scale="B3"] [role="img"]')?.getAttribute("aria-label")).toBe("다섯 칸 중 두 칸");
    expect(summary?.querySelector('[data-statement-scale="T1"] [role="img"]')?.getAttribute("aria-label")).toBe("다섯 칸 중 네 칸");
    expect(summary?.querySelector('[data-statement-scale="T2"] [role="img"]')?.textContent).toBe("●●●●○");
    expect(summary?.querySelector('[role="meter"]')).toBeNull();
    expect(summary?.textContent).not.toContain("%");
    expect(summary?.querySelector('[data-statement-scale="V1"]')).toBeNull();
    expect(summary?.textContent).toContain("코드를 만든 문장 전체 보기");
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
      expect(summary?.querySelector(`[data-statement-scale="${id}"] [role="img"]`)).toBeNull();
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
    expect(summaryHeading(summaries[0])).toBe("상대의 웨딩코드");
    expect(summaryHeading(summaries[1])).toBe("내 웨딩코드");
    expect(summaries[0].querySelectorAll("button")).toHaveLength(0);
    expect(summaries[1].querySelectorAll("button").length).toBeGreaterThan(0);
    const received = render(second, first, true);
    expect([...view.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(["함께 보기", "내 결과", "상대 결과"]);
    expect([...received.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(["함께 보기", "먼저 답한 사람", "나중에 답한 사람"]);
    expect([...received.querySelectorAll("[data-style-summary]")].map(summaryHeading)).toEqual(["먼저 답한 사람의 웨딩코드", "나중에 답한 사람의 웨딩코드"]);
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
    // 상대 결과 탭에서도 같은 카드가 나오므로 ‘내가’라고 쓰지 않는다.
    const selected = [...delegate.querySelectorAll("li")].find(item => item.textContent?.includes("이 설명에서 우선순위로 고른 것"));
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
    // 2026-09-27: 우선순위가 아닌 피하고 싶은 것은 설명 카드 대신 '피하고 싶은 것' 영역의 그 줄에 다음 행동을 붙인다.
    expect(view.querySelector('[data-insight="avoid-loud_music"]')).toBeNull();
    expect(view.querySelector('[data-avoidance-step="loud_music"] [data-next-step]')?.textContent).toContain("음악 크기");
    // 우선순위 안내 카드가 가져간 사진의 다음 행동은 취향 영역에서 다시 쓰지 않는다.
    expect(view.querySelector('[data-taste="photo"] [data-next-step]')).toBeNull();
    expect(view.querySelector('[data-taste="venue"] [data-next-step]')).not.toBeNull();
  });

  it("참여 방식 조합에서 설명한 직접 취향과 회피만 정리하고 다른 회피는 남긴다", () => {
    const draft = basicDraft();
    draft.tastes.ceremony = { status: "answered", values: ["participatory", "our_story"] };
    draft.avoidances = { status: "answered", values: ["stage_participation", "crowded_space"] };
    draft.priorities = { status: "answered", values: ["taste.ceremony"] };
    const view = render(draft);
    expect(view.querySelector('[data-insight="priority-participation-format"]')).not.toBeNull();
    for (const id of ["participation-format", "direct-ceremony", "avoid-stage_participation"]) expect(view.querySelector(`[data-insight="${id}"]`)).toBeNull();
    // 2026-09-27: 다른 피하고 싶은 것은 설명 카드가 아니라 영역의 그 줄에 다음 행동으로 남는다.
    expect(view.querySelector('[data-insight="avoid-crowded_space"]')).toBeNull();
    expect(view.querySelector('[data-avoidance-step="crowded_space"] [data-next-step]')?.textContent).toContain("좌석 간격");
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

describe("두 사람 비교 묶음", () => {
  const sectionTitle = (view: HTMLElement, id: string) => view.querySelector(`[data-comparison="${id}"]`)?.closest("section")?.querySelector("h2")?.textContent;
  const folded = (view: HTMLElement, id: string) => view.querySelector(`[data-comparison="${id}"]`)?.closest("details") ?? null;
  const differenceIds = (view: HTMLElement) => [...view.querySelectorAll('[data-pair-section="difference"] [data-comparison]')].map(item => item.getAttribute("data-comparison"));

  it("서로 반대편에 선 문장은 몇 개든 펼쳐 차이 맨 앞에 두고, 구체 선택의 차이도 접지 않는다", () => {
    const first = basicDraft();
    const second = basicDraft();
    // 네 칸 이상 대 두 칸 이하: 다섯 문장. 예전에는 질문 순서로 세 개만 펼치고 나머지를 접었다.
    Object.assign(second.answers, { G1: 1, G3: 2, R4: 1, B1: 2, D1: 2 });
    first.answers.V1 = 1; second.answers.V1 = 3; // 1 대 3: 정도가 다른 답
    second.tastes.venue = { status: "answered", values: ["outdoor"] };
    second.tastes.guests = { status: "answered", values: ["under50"] };
    first.spending = { status: "answered", values: ["photo"] };
    second.spending = { status: "answered", values: ["meal"] };
    const view = render(second, first);
    const opposite = ["G1", "G3", "R4", "B1", "D1"];
    expect(differenceIds(view).slice(0, 5)).toEqual(opposite);
    for (const id of opposite) {
      expect(view.querySelector(`[data-pair-group="opposite"] [data-comparison="${id}"]`), id).not.toBeNull();
      expect(folded(view, id), id).toBeNull();
    }
    for (const id of ["taste.venue", "taste.guests", "spending"]) {
      expect(view.querySelector(`[data-pair-group="different"] [data-comparison="${id}"]`), id).not.toBeNull();
      expect(folded(view, id), id).toBeNull();
    }
    expect(differenceIds(view).indexOf("taste.venue")).toBeGreaterThan(differenceIds(view).indexOf("D1"));
    expect(folded(view, "V1")?.querySelector("summary")?.textContent).toBe("정도가 다른 답 1개 보기");
    const difference = view.querySelector('[data-pair-section="difference"]')!;
    expect(difference.textContent).toContain("질문 순서대로");
    expect(difference.textContent).not.toContain("우선순위");
    expect(difference.textContent).not.toMatch(/나머지 \d+개 보기/);
    expect(view.querySelector('[data-comparison="spending"]')?.textContent).not.toMatch(/없음|지금 없어요/);
  });

  it("한 사람만 ‘그런 편’ 이상인 문장은 중간 응답으로 접지 않고 따로 펼친다", () => {
    const first = basicDraft();
    const second = basicDraft();
    second.answers.T1 = 3; // 4 대 3
    second.answers.F2 = 3; // 5 대 3
    const view = render(second, first);
    for (const id of ["T1", "F2"]) {
      expect(sectionTitle(view, id), id).toBe("한 사람만 동의한 문장");
      expect(folded(view, id), id).toBeNull();
      expect(view.querySelector(`[data-pair-section="difference"] [data-comparison="${id}"]`), id).toBeNull();
    }
  });

  it("우선순위로 고른 항목은 어느 묶음에서도 접지 않고, 그때만 우선순위 순서를 말한다", () => {
    const first = basicDraft();
    const second = basicDraft();
    second.answers.D1 = 1;
    second.answers.G3 = 1;
    second.tastes.meal = { status: "undecided" };
    first.priorities = { status: "answered", values: ["D1", "taste.meal", "F4"] };
    second.priorities = { status: "answered", values: ["F1", "F2", "T3"] };
    const view = render(second, first);
    expect(view.querySelector('[data-pair-section="difference"]')?.textContent).toContain("둘 중 한 사람이 우선순위로 고른 것을 앞에 뒀어요");
    expect(differenceIds(view).slice(0, 2)).toEqual(["D1", "G3"]);
    for (const id of ["F4", "F1", "F2", "T3"]) {
      expect(sectionTitle(view, id), id).toBe("함께 동의하거나 고른 내용");
      expect(folded(view, id), id).toBeNull();
    }
    expect(folded(view, "G1")).not.toBeNull();
    expect(sectionTitle(view, "taste.meal")).toBe("아직 함께 비교하지 않은 내용");
    expect(folded(view, "taste.meal")).toBeNull();
  });

  it("여러 개 고르는 질문의 일부 겹침은 차이에서 빼고 둘 다 고른 보기와 한 사람만 고른 보기를 나눈다", () => {
    const first = basicDraft();
    const second = basicDraft();
    first.tastes.attire = { status: "answered", values: ["simple", "flowing"] };
    second.tastes.attire = { status: "answered", values: ["flowing", "traditional"] };
    const view = render(second, first);
    expect(sectionTitle(view, "taste.attire")).toBe("일부만 겹치게 고른 것");
    expect(differenceIds(view)).not.toContain("taste.attire");
    const rows = [...view.querySelectorAll('[data-comparison="taste.attire"] [data-overlap-row]')].map(item => item.textContent);
    expect(rows).toEqual(["함께 고른 보기: 하늘하늘한 옷", "상대만 고른 보기: 깔끔하고 단순한 옷", "나만 고른 보기: 한복 같은 전통 혼례복"]);
    const received = render(second, first, true);
    expect([...received.querySelectorAll('[data-comparison="taste.attire"] [data-overlap-row]')].map(item => item.textContent))
      .toEqual(["함께 고른 보기: 하늘하늘한 옷", "먼저 답한 사람만 고른 보기: 깔끔하고 단순한 옷", "나중에 답한 사람만 고른 보기: 한복 같은 전통 혼례복"]);
  });

  it("상대가 해 주길 바라는 도움만 둘 다 바라는 도움으로 묶고 누가 먼저 해줄 수 있는지 묻는다", () => {
    const view = render(basicDraft(), basicDraft());
    for (const id of ["H1", "H2"]) {
      expect(sectionTitle(view, id), id).toBe("둘 다 바라는 도움");
      expect(view.querySelector(`[data-comparison="${id}"]`)?.textContent, id).toContain("누가 먼저");
    }
    // 2026-09-27: H4(잠깐 쉬고 다시 이야기하기)는 상대가 해 주는 도움이 아니라 둘이 같은 방식을 원한다는 답이다.
    expect(sectionTitle(view, "H4")).toBe("함께 동의하거나 고른 내용");
    expect(view.querySelector('[data-comparison="H4"]')?.textContent).not.toMatch(/누가 먼저|해줄 수 있는/);
    expect(sectionTitle(view, "T3")).toBe("함께 동의하거나 고른 내용");
    const request = [...view.querySelectorAll("h2")].find(item => item.textContent === "둘 다 바라는 도움")!.closest("section")!;
    // 묶음 설명은 항목 문장이 묻는 ‘누가 먼저’를 되풀이하지 않는다.
    expect(request.querySelector("h2 + p")?.textContent).toBe("둘 다 상대에게 받고 싶다고 답한 도움이에요.");
  });
});

/**
 * 개인 결과의 되풀이와 고지 (2026-09-27 감사).
 * 한 가상 응답자의 설명 17개 중 15개가 방금 고른 답을 다시 말했고, 설명마다 같은 고지와 버튼 설명이 17번 붙었다.
 * 기본 23개 답(동의 15, 취향 6, 피하고 싶은 것, 더 쓰고 싶은 곳)을 높고 낮고 중간으로 섞은 응답으로 본다.
 */
function mixedDraft(): V31Draft {
  const draft = createV31Draft();
  draft.answers = { G1: 5, G3: 4, R4: 3, B1: 5, B3: 4, D1: 2, T1: 4, T2: 5, T3: 4, F1: 3, F2: 5, F4: 2, H1: 4, H2: 5, H4: 3 };
  draft.tastes = {
    venue: { status: "answered", values: ["outdoor"] },
    photo: { status: "answered", values: ["both_styles"] },
    attire: { status: "answered", values: ["simple", "flowing"] },
    meal: { status: "answered", values: ["buffet"] },
    guests: { status: "answered", values: ["50to100"] },
    ceremony: { status: "answered", values: ["short", "thanks", "participatory"] },
  };
  draft.avoidances = { status: "answered", values: ["crowded_space", "stage_participation"] };
  draft.spending = { status: "answered", values: ["photo"] };
  return draft;
}
const SUMMARY_IDS: readonly string[] = V31_STYLE_DIMENSIONS.flatMap(dimension => [dimension.first.id, dimension.second.id]);

describe("개인 결과는 고른 답을 되풀이하지 않고 고지를 한 번만 쓴다", () => {
  it("취향이나 피하고 싶은 것 하나만으로 설명 카드를 만들지 않고, 카드에 있던 다음 행동은 그 영역의 줄에 둔다", () => {
    const view = render(mixedDraft());
    expect(view.querySelector('[data-insight^="direct-"], [data-insight^="avoid-"]')).toBeNull();
    // 고른 보기에 따라 달라지던 다음 행동이 영역 안에 그대로 남는다(야외면 날씨, 사진 둘 다면 장면 나누기).
    expect(view.querySelector('[data-taste="venue"] [data-next-step]')?.textContent).toContain("비가 오거나");
    expect(view.querySelector('[data-taste="photo"] [data-next-step]')?.textContent).toContain("미리 준비할 장면");
    expect(view.querySelectorAll("[data-taste] [data-next-step]")).toHaveLength(WEDDING_CODE_V31_TASTES.length);
    expect(view.querySelector('[data-avoidance-step="crowded_space"] [data-next-step]')?.textContent).toContain("좌석 간격");
    // 두 답을 잇는 교차 안내는 카드로 남는다.
    expect(view.querySelector('[data-insight="participation-format"]')).not.toBeNull();
    // 2026-09-27: 그 카드가 펼친 채 보이면 무대 참여를 피하고 싶다는 줄은 같은 이야기(자리·무대·진행자)를 다시 하지 않는다.
    expect(view.querySelector('[data-insight="participation-format"]')?.closest("details")).toBeNull();
    expect(view.querySelector('[data-avoidance-step="stage_participation"]')).not.toBeNull();
    expect(view.querySelector('[data-avoidance-step="stage_participation"] [data-next-step]')).toBeNull();
    // 취향을 예약 조건으로 읽지 않게 하는 경계는 판정 고지가 아니라 할 일로 한 번 적는다.
    expect(view.textContent?.match(/예약 조건은 후보를 보면서 따로 정해요/g)).toHaveLength(1);
    expect(view.textContent).not.toContain("예약 조건이 아니라");
  });

  it("카드 사용법과 판정이 아니라는 고지는 화면에 한 번씩만 쓰고, 근거 답은 카드마다 남긴다", () => {
    const view = render(mixedDraft());
    const cards = [...view.querySelectorAll("[data-insight]")];
    expect(cards.length).toBeGreaterThan(3);
    for (const card of cards) {
      const id = card.getAttribute("data-insight");
      expect(card.textContent, `${id}`).not.toMatch(/같은 답이어도|뜻이 다를 수|접어둘 수 있어요|접어 두세요|고치거나|내 생각과 달라요/);
      // 근거 보기·답 수정·접기는 카드 안 한 곳에 모은다.
      expect(card.querySelectorAll("details"), `${id}`).toHaveLength(1);
      const evidence = [...card.querySelectorAll("[data-insight-evidence] li")];
      expect(evidence.length, `${id}`).toBeGreaterThan(0);
      expect(card.querySelectorAll('[data-insight-evidence] button[aria-label$=" 답 수정"]'), `${id}`).toHaveLength(evidence.length);
    }
    expect(view.querySelectorAll("[data-insight-note]")).toHaveLength(1);
    expect(view.textContent?.match(/[^.]*(?:성격|궁합)[^.]*\./g)?.map(sentence => sentence.trim())).toEqual(["성격 진단이나 궁합 점수는 아니에요."]);
    // 카드 본문은 고른 답을 「~라고 답했어요」로 다시 말하지 않는다.
    for (const card of cards) {
      const body = card.querySelector("h3 + p")?.textContent ?? "";
      expect(body, `${card.getAttribute("data-insight")}`).not.toMatch(/답했어요|골랐어요/);
    }
  });

  it("네 글자 요약의 여덟 문장만 근거인 설명은 요약 바로 아래에 펼치지 않고 따로 접는다", () => {
    const draft = mixedDraft();
    const view = render(draft);
    const section = view.querySelector("[data-personal-insights]")!;
    const ids = (root: Element) => [...root.querySelectorAll("[data-insight]")].map(card => card.getAttribute("data-insight"));
    const open = [...section.querySelectorAll("[data-insight]")].filter(card => !card.closest("details"));
    expect(open.map(card => card.getAttribute("data-insight"))).toEqual(["delegate-update", "budget-explicit-spending", "participation-format"]);
    const summaryGroup = section.querySelector('[data-insight-group="summary"]')!;
    expect(ids(summaryGroup)).toEqual(["budget-revisit", "support-listen-help", "single-T1", "single-F2"]);
    expect(summaryGroup.querySelector("summary")?.textContent).toBe("위 네 글자에 쓴 답으로 만든 설명 4개 보기");
    expect(ids(section.querySelector('[data-insight-group="more"]')!)).toEqual(["single-G1", "single-G3"]);
    // 펼친 설명은 요약 밖의 답을 하나 이상 근거로 쓰고, 요약 묶음은 여덟 문장만 근거로 쓴다.
    const evidenceOf = new Map(buildV31Profile(draft).insights.map(item => [item.id, item.evidence.map(answer => answer.id)]));
    for (const card of open) expect(evidenceOf.get(card.getAttribute("data-insight")!)!.some(id => !SUMMARY_IDS.includes(id))).toBe(true);
    for (const id of ids(summaryGroup)) expect(evidenceOf.get(id!)!.every(item => SUMMARY_IDS.includes(item)), `${id}`).toBe(true);
  });

  it("모든 문장을 낮게 답해도 반대 성향 설명을 만들지 않고, 취향의 다음 행동은 남긴다", () => {
    const draft = mixedDraft();
    for (const question of WEDDING_CODE_V31_QUESTIONS) if (draft.answers[question.id] !== undefined) draft.answers[question.id] = 2;
    // 참여 순서와 무대 참여 회피를 잇는 교차 안내는 동의 점수와 상관없이 나오므로 여기서는 빼 둔다.
    draft.avoidances = { status: "answered", values: ["crowded_space", "loud_music"] };
    const view = render(draft);
    expect(view.querySelector("[data-insight]")).toBeNull();
    expect(view.querySelector("[data-personal-insights]")?.textContent).toContain("반대 취향으로 바꾸지 않아요");
    expect(view.querySelectorAll("[data-taste] [data-next-step]")).toHaveLength(WEDDING_CODE_V31_TASTES.length);
    expect(view.querySelectorAll("[data-avoidance-step] [data-next-step]")).toHaveLength(2);
  });
});

/**
 * 화면에 보이는 글(접힌 details 의 안쪽은 뺀다). 사용자가 고른 보기 이름(‘어느 쪽도 아니에요’ 같은 답)과
 * ‘…’ 인용 안은 판정 고지가 아니므로 뺀다.
 */
function visibleSentences(root: Element): string[] {
  const answerLabels = new Set<string>([...WEDDING_CODE_V31_OPTIONS, ...WEDDING_CODE_V31_STATUS_OPTIONS].map(option => option.label));
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (!text || answerLabels.has(text)) continue;
    const folded = node.parentElement?.closest("details:not([open])");
    if (folded && !node.parentElement?.closest("summary")) continue;
    texts.push(text.replace(/‘[^’]*’/g, ""));
  }
  return texts;
}
const JUDGMENT_NOTICE = /아니에요|아니라/;
function judgmentNotices(root: Element): string[] {
  return visibleSentences(root).filter(text => JUDGMENT_NOTICE.test(text));
}

describe("2026-09-27 결과 검토 뒤 고친 것", () => {
  it("우선순위를 한 번도 고르지 않은 결과에서도 결과 화면에서 우선순위를 고를 길이 있다", () => {
    const draft = basicDraft();
    expect(draft.priorities).toBeUndefined();
    expect(getV31PriorityOptions(draft).length).toBeGreaterThan(0);
    const view = render(draft);
    const entry = view.querySelector("[data-priority-entry]");
    expect(entry).not.toBeNull();
    expect(entry?.querySelector("h2")?.textContent).toBe("꼭 지키고 싶은 것도 골라볼 수 있어요");
    expect([...entry!.querySelectorAll("button")].map(item => item.textContent)).toEqual(["꼭 지키고 싶은 것 고르기"]);
    // 고른 적 없는 우선순위를 직접 고른 것처럼 쓰거나 ‘아직 보지 않은 질문’으로 적지 않는다.
    expect(view.textContent).not.toContain("내가 직접 고른 우선순위");
    expect(view.textContent).not.toContain("아직 보지 않은 질문이에요");
    // 이미 답했으면 ‘우선순위 수정’이 그 일을 한다.
    expect(render({ ...draft, priorities: { status: "skipped" } }).querySelector("[data-priority-entry]")).toBeNull();
    // 고를 보기가 없으면 버튼을 두지 않는다(누르면 빈 화면이 나온다).
    const nothing = createV31Draft();
    nothing.answers = { G1: 2, B1: 3 };
    expect(getV31PriorityOptions(nothing)).toHaveLength(0);
    expect(render(nothing).querySelector("[data-priority-entry]")).toBeNull();
    // 답을 수정할 수 없는 화면에는 두지 않는다.
    expect(render(draft, null, false, true).querySelector("[data-priority-entry]")).toBeNull();
  });

  it.each([
    ["기본", () => basicDraft()],
    ["예산을 지키면서 더 쓸 곳을 고름", () => { const draft = basicDraft(); draft.spending = { status: "answered", values: ["photo"] }; return draft; }],
    ["예산 재논의를 우선순위로 고름", () => { const draft = basicDraft(); draft.answers.B3 = 5; draft.priorities = { status: "answered", values: ["B3"] }; return draft; }],
    ["예산 두 문장을 우선순위로 고름", () => { const draft = basicDraft(); draft.answers.B3 = 5; draft.spending = { status: "answered", values: ["meal"] }; draft.priorities = { status: "answered", values: ["B1", "B3"] }; return draft; }],
    ["예산 재논의만 높음", () => { const draft = basicDraft(); draft.answers.B1 = 2; draft.answers.B3 = 5; return draft; }],
    ["여러 답을 섞음", () => mixedDraft()],
  ] as const)("혼자 결과(%s)에서 「~아니에요」류 판정 고지는 머리글 한 번뿐이다", (_name, make) => {
    const hits = judgmentNotices(render(make()));
    expect(hits).toEqual([expect.stringContaining("성격 진단이나 궁합 점수는 아니에요.")]);
  });

  it("두 사람 결과에서도 「~아니에요」류 판정 고지는 머리글 한 번뿐이다", () => {
    const first = mixedDraft();
    const second = basicDraft();
    // 열린 답(어느 쪽도 괜찮아요·더 쓰고 싶은 곳 없음), 서로 다른 피하고 싶은 것과 우선순위, 반대로 답한 문장을 섞는다.
    second.tastes.venue = { status: "no_preference" };
    second.spending = { status: "no_preference" };
    second.avoidances = { status: "answered", values: ["loud_music"] };
    first.priorities = { status: "answered", values: ["B1"] };
    second.priorities = { status: "answered", values: ["G1"] };
    second.answers.D1 = 5; first.answers.D1 = 1;
    for (const view of [render(second, first), render(first, second), render(second, first, true)]) {
      expect(judgmentNotices(view)).toEqual([expect.stringContaining("성격 진단이나 궁합 점수는 아니에요.")]);
    }
    const view = render(second, first);
    const open = [...view.querySelectorAll("h2")].find(item => item.textContent === "열어 두고 있는 답")!.closest("section")!;
    // 묶음 설명은 무엇을 모았는지만 말한다. 할 일은 항목 문장이 말하므로 설명에서 되풀이하지 않는다.
    expect(open.querySelector("h2 + p")?.textContent).toBe("둘 중 한 사람이라도 어느 쪽도 괜찮다고 했거나, 따로 없다고 답한 내용이에요.");
    expect(open.querySelector("h2 + p")?.textContent).not.toMatch(/들어보세요|살펴보세요/);
    expect(open.querySelector('[data-comparison="spending"]')?.textContent).not.toMatch(/반대/);
  });

  it("한 사람만 ‘그런 편’ 이상인 허용 문장(T2 맡겨도 괜찮다)을 ‘원한 것’으로 부르지 않는다", () => {
    const first = basicDraft();
    const second = basicDraft();
    first.answers.T2 = 5;
    second.answers.T2 = 3;
    const view = render(second, first);
    const section = view.querySelector('[data-comparison="T2"]')!.closest("section")!;
    const title = section.querySelector("h2")?.textContent ?? "";
    const description = section.querySelector("h2 + p")?.textContent ?? "";
    expect(title).toBe("한 사람만 동의한 문장");
    expect(description).toContain("동의한 사람의 이유부터 들어보세요.");
    expect(`${title} ${description}`).not.toMatch(/원한|원하는/);
  });

  it("무대 참여 회피 줄의 다음 행동은 참여 방식 카드가 펼친 채 보일 때만 뺀다", () => {
    // 우선순위 안내 카드가 참여 방식 조합을 가져간 경우.
    const guided = basicDraft();
    guided.tastes.ceremony = { status: "answered", values: ["participatory", "our_story"] };
    guided.avoidances = { status: "answered", values: ["stage_participation", "crowded_space"] };
    guided.priorities = { status: "answered", values: ["taste.ceremony"] };
    const guidedView = render(guided);
    expect(guidedView.querySelector('[data-insight="priority-participation-format"]')).not.toBeNull();
    expect(guidedView.querySelector('[data-avoidance-step="stage_participation"] [data-next-step]')).toBeNull();
    expect(guidedView.querySelector('[data-avoidance-step="crowded_space"] [data-next-step]')).not.toBeNull();
    // 설명이 많아 참여 방식 카드가 ‘다른 설명 더 보기’ 안에 접히면, 줄의 다음 행동을 남긴다.
    const folded = mixedDraft();
    folded.answers.V1 = 5; folded.answers.R3 = 5;
    folded.avoidances = { status: "answered", values: ["heavy_decoration", "stage_participation"] };
    const foldedView = render(folded);
    expect(foldedView.querySelector('[data-insight="participation-format"]')?.closest('[data-insight-group="more"]')).not.toBeNull();
    expect(foldedView.querySelector('[data-avoidance-step="stage_participation"] [data-next-step]')?.textContent).toContain("진행자");
    // 하객 없이 둘만 하는 예식도 고른 경우, 같은 이야기를 카드와 줄에서 두 번 하지 않는다.
    const noGuests = mixedDraft();
    noGuests.answers.G1 = 2; noGuests.answers.G3 = 2;
    noGuests.tastes.guests = { status: "answered", values: ["no_guests"] };
    const noGuestsView = render(noGuests);
    expect(noGuestsView.querySelector('[data-insight="participation-format"]')?.closest("details")).toBeNull();
    expect(noGuestsView.textContent?.match(/하객 없이 둘만 하는 예식도 골랐어요/g)).toHaveLength(1);
  });

  it("두 사람 결과에서 서로 다른 답은 함께 동의한 내용 바로 다음에 온다", () => {
    const first = basicDraft();
    const second = basicDraft();
    second.answers.B1 = 2; // 5 대 2: 서로 반대
    first.tastes.attire = { status: "answered", values: ["simple", "flowing"] };
    second.tastes.attire = { status: "answered", values: ["flowing", "traditional"] }; // 일부 겹침
    const view = render(second, first);
    expect(view.querySelector('[data-pair-kind="shared_request"]')).not.toBeNull();
    expect(view.querySelector('[data-pair-kind="partial_overlap"]')).not.toBeNull();
    const panel = view.querySelector('[role="tabpanel"]')!;
    const titles = [...panel.querySelectorAll("h2")].map(item => item.textContent).filter(title => !title?.endsWith("웨딩코드"));
    expect(titles.slice(0, 2)).toEqual(["함께 동의하거나 고른 내용", "먼저 이야기해 볼 차이"]);
    expect(titles.indexOf("둘 다 바라는 도움")).toBeGreaterThan(1);
    expect(titles.indexOf("일부만 겹치게 고른 것")).toBeGreaterThan(1);
  });

  it("접힌 ‘정도가 다른 답’ 항목은 묶음 제목 아래 한 단계 낮은 제목으로 선다", () => {
    for (const withOpposite of [true, false]) {
      const first = basicDraft();
      const second = basicDraft();
      first.answers.V1 = 1; second.answers.V1 = 3; // 1 대 3: 정도가 다른 답
      if (withOpposite) second.answers.G1 = 1;
      const folded = render(second, first).querySelector('[data-pair-group="degree-folded"]')!;
      const headings = [...folded.querySelectorAll("h1, h2, h3, h4, h5, h6")];
      expect(headings.map(item => item.tagName), String(withOpposite)).toEqual(["H3", "H4"]);
      expect(headings[0].textContent).toBe("정도가 다른 답");
      expect(headings[0].className).toContain("sr-only");
      expect(headings[1].closest('[data-comparison="V1"]')).not.toBeNull();
    }
  });

  it("우선순위 비교 칸은 사용자가 누른 버튼 이름을 그대로 인용하고, 그 화면에 없던 보기 이름을 쓰지 않는다", () => {
    const input = document.createElement("div");
    input.innerHTML = renderToStaticMarkup(<V31ChoiceInput value={undefined} options={[{ value: "B1", label: "처음 정한 전체 예산 지키기" }]} max={3} onChange={() => {}} kind="priorities" />);
    const buttonLabels = [...input.querySelectorAll("button")].map(item => item.textContent?.trim());
    const first = basicDraft(); const second = basicDraft();
    first.priorities = { status: "no_preference" };
    second.priorities = { status: "undecided" };
    const item = compareV31(first, second).find(entry => entry.id === "priorities")!;
    expect(buttonLabels).toContain(item.first);
    expect(buttonLabels).toContain(item.second);
    const view = render(second, first);
    const cell = view.querySelector('[data-comparison="priorities"]')!;
    expect(cell.textContent).toContain("꼭 지키고 싶은 건 따로 없어요");
    expect(cell.textContent).not.toContain("특히 지킬 것을 따로 고르지");
    // 고르지 않고 넘어간 답은 ‘지금 답하지 않을게요’(우선순위 화면에 없는 보기)로 인용하지 않는다.
    first.priorities = { status: "skipped" };
    const skipped = render(second, first);
    expect(skipped.querySelector('[data-comparison="priorities"]')?.textContent).toContain("고르지 않고 넘어갔어요");
    expect(skipped.querySelector('[data-comparison="priorities"]')?.textContent).not.toContain("지금 답하지 않을게요");
    const solo = render(first);
    const states = [...solo.querySelectorAll("details")].find(entry => entry.querySelector("summary")?.textContent === "모름·계획 없음·답하지 않음·맞는 보기 없음")!;
    const priorityRow = [...states.querySelectorAll("li")].find(entry => entry.textContent?.startsWith("이번 결혼식에서 특히 지키고 싶은 것"));
    expect(priorityRow?.textContent).toContain("고르지 않고 넘어갔어요");
    expect(priorityRow?.textContent).not.toContain("지금 답하지 않을게요");
    const none = basicDraft(); none.priorities = { status: "no_preference" };
    expect(render(none).textContent).toContain("꼭 지키고 싶은 건 따로 없다고 답했어요.");
  });
});
