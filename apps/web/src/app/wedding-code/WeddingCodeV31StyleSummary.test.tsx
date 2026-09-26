// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V31_OPTIONS, WEDDING_CODE_V31_STATUS_OPTIONS, type V31Draft, type V31Response } from "@/constants/weddingCodeV31";
import { createV31Draft } from "@/lib/weddingCode/v31";
import { V31_STYLE_NAME_FALLBACK } from "@/lib/weddingCode/v31StyleSummary";
import WeddingCodeV31StyleSummary from "./WeddingCodeV31StyleSummary";

function draftOf(answers: V31Draft["answers"]): V31Draft {
  const draft = createV31Draft();
  draft.answers = { ...answers };
  return draft;
}
function paired(first: V31Response, second: V31Response): V31Draft {
  return draftOf({ B1: first, B3: second, T1: first, T2: second, F1: first, F2: second, H1: first, H2: second });
}
function render(draft: V31Draft, props: { compact?: boolean; onEdit?: (id?: string) => void } = {}) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<WeddingCodeV31StyleSummary draft={draft} {...props} />);
  return container.querySelector<HTMLElement>("[data-style-summary]")!;
}
function textNodes(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent?.trim()) texts.push(node.textContent.trim());
  return texts;
}

/** 두 자리(일 나누기·받고 싶은 도움)만 한 칸 차이로 글자가 바뀐다. */
const MIXED = { B1: 5, B3: 5, T1: 4, T2: 4, F1: 5, F2: 1, H1: 3, H2: 3 } as const;

describe("웨딩코드 v3.1 네 글자 요약 화면", () => {
  it("아슬한 글자가 몇 개인지 코드보다 먼저 알리고, 그 글자와 그 주제 줄에 표시를 단다", () => {
    const summary = render(draftOf(MIXED));
    expect(summary.getAttribute("data-style-summary")).toBe("BBFM");
    expect(summary.getAttribute("data-borderline-count")).toBe("2");
    const notice = summary.querySelector("[data-borderline-notice]")!;
    const code = summary.querySelector("[data-code]")!;
    expect(notice.textContent).toBe("네 글자 중 밑줄 친 2개는 답 하나만 한 칸 달라져도 바뀌어요. 다시 답하면 달라질 수 있어요.");
    expect(notice.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const letters = [...summary.querySelectorAll<HTMLElement>("[data-code-letter]")];
    expect(letters.map(item => item.textContent).join("")).toBe("BBFM");
    expect(letters.filter(item => item.className.includes("underline")).map(item => item.getAttribute("data-code-letter"))).toEqual(["teamwork", "support"]);
    expect([...summary.querySelectorAll("[data-summary-topic]")].filter(row => row.querySelector("[data-borderline-tag]")).map(row => row.getAttribute("data-summary-topic"))).toEqual(["teamwork", "support"]);
    expect(summary.querySelector('[data-summary-topic="teamwork"] [data-borderline-tag]')?.textContent).toBe("바뀔 수 있어요");

    const steady = render(paired(5, 5));
    expect(steady.querySelector("[data-borderline-notice]")?.textContent).toBe("지금 글자는 어느 답을 한 칸 옮겨도 그대로예요.");
    expect(steady.querySelectorAll("[data-borderline-tag]")).toHaveLength(0);
    expect([...steady.querySelectorAll("[data-code-letter]")].some(item => item.className.includes("underline"))).toBe(false);
    const shaky = render(paired(4, 4));
    expect(shaky.querySelector("[data-borderline-notice]")?.textContent).toContain("네 글자 모두");
    expect(shaky.querySelectorAll("[data-borderline-tag]")).toHaveLength(4);
    expect(render(createV31Draft()).querySelector("[data-borderline-notice]")).toBeNull();
  });

  it("글자마다 두 문장에 고른 답을 다섯 칸 점과 보기 이름으로 보여주고 퍼센트와 막대는 쓰지 않는다", () => {
    const summary = render(draftOf(MIXED), { onEdit: () => {} });
    expect(summary.querySelector('[role="meter"]')).toBeNull();
    expect(summary.innerHTML).not.toContain("aria-valuenow");
    expect(summary.textContent).not.toContain("%");
    for (const element of summary.querySelectorAll("[aria-label]")) expect(element.getAttribute("aria-label")).not.toContain("%");
    const family = summary.querySelector('[data-summary-topic="family"]')!;
    expect([...family.querySelectorAll("[data-letter-answer]")].map(item => item.getAttribute("data-letter-answer"))).toEqual(["F1", "F2"]);
    const f1 = family.querySelector('[data-letter-answer="F1"]')!;
    expect(f1.querySelector('[role="img"]')?.textContent).toBe("●●●●●");
    expect(f1.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("다섯 칸 중 다섯 칸");
    expect(f1.textContent).toContain("매우 그래요");
    const f2 = family.querySelector('[data-letter-answer="F2"]')!;
    expect(f2.querySelector('[role="img"]')?.textContent).toBe("●○○○○");
    expect(f2.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("다섯 칸 중 한 칸");
    expect(f2.textContent).toContain("전혀 그렇지 않아요");
    expect(summary.querySelector('[data-letter-answer="H1"] [role="img"]')?.getAttribute("aria-label")).toBe("다섯 칸 중 세 칸");
    expect(summary.querySelector('[data-letter-answer="T2"] [role="img"]')?.getAttribute("aria-label")).toBe("다섯 칸 중 네 칸");
    expect(summary.querySelector('[data-statement-scale="B3"] [role="img"]')?.textContent).toBe("●●●●●");
    expect(summary.querySelector('[data-statement-scale="B3"] button')?.textContent).toBe("답 수정");
  });

  it("이름 바로 위에 어느 주제의 답에서 따온 이름인지 적고, 이름이 없을 때도 자연스럽게 말한다", () => {
    const summary = render(draftOf(MIXED));
    const source = summary.querySelector("[data-name-source]")!;
    expect(source.getAttribute("data-name-source")).toBe("teamwork");
    expect(source.textContent).toBe("이름은 ‘일 나누기’ 답에서 따왔어요");
    expect(source.nextElementSibling?.tagName).toBe("H2");
    expect(source.nextElementSibling?.textContent).toBe("함께 찾고, 세부는 맡겨도 되는 스타일");

    const budget = render(draftOf({ T1: 3, T2: 3, B1: 2, B3: 5 }));
    expect(budget.querySelector("[data-name-source]")?.textContent).toBe("이름은 ‘예산’ 답에서 따왔어요");
    expect(budget.querySelector("h2")?.textContent).toBe("예산을 다시 의논하는 스타일");

    const none = render(paired(3, 3));
    expect(none.querySelector("[data-name-source]")?.getAttribute("data-name-source")).toBe("none");
    expect(none.querySelector("[data-name-source]")?.textContent).toBe(V31_STYLE_NAME_FALLBACK.nameSource);
    expect(none.querySelector("h2")?.textContent).toBe(V31_STYLE_NAME_FALLBACK.name);
  });

  it("이번 계획에 없다는 답은 사실대로 적고 다시 보라는 안내에서 빼며, 모름·건너뜀만 다시 보게 한다", () => {
    const draft = paired(5, 5);
    draft.answers.F1 = "not_applicable";
    draft.answers.F2 = "not_applicable";
    draft.answers.B1 = "undecided";
    const summary = render(draft);
    expect(summary.getAttribute("data-style-summary")).toBe("?B?B");
    const family = summary.querySelector('[data-summary-topic="family"]')!;
    expect(family.getAttribute("data-pending")).toBe("not_in_plan");
    expect(family.textContent).toContain("이번 계획에 없어요");
    expect(family.querySelector('[role="img"]')).toBeNull();
    expect(summary.querySelector('[data-summary-topic="budget"]')?.getAttribute("data-pending")).toBe("open");
    const notice = summary.querySelector("[data-pending-notice]")!.textContent!;
    expect(notice).toBe("‘예산’ 주제는 아직 모르거나 답하지 않은 문장이 있어서 ‘?’로 남겼어요. 아래에서 그 답을 다시 볼 수 있어요. ‘가족과 상의’ 주제는 이번 계획에 없다고 답해서 ‘?’로 적었어요.");
    expect(summary.textContent).not.toContain("요약 보류");
    expect(summary.textContent).not.toContain("확인해 주세요");

    const onlyNotInPlan = paired(5, 5);
    onlyNotInPlan.answers.H2 = "not_applicable";
    const notInPlan = render(onlyNotInPlan).querySelector("[data-pending-notice]")!.textContent!;
    expect(notInPlan).toBe("‘받고 싶은 도움’ 주제는 이번 계획에 없다고 답해서 ‘?’로 적었어요.");
    expect(notInPlan).not.toContain("다시 볼");
    expect(render(paired(5, 1)).querySelector("[data-pending-notice]")).toBeNull();
  });

  it("영문 낱말은 한 문장에서 나온 글자의 한국어 뜻 뒤에만 보조로 붙인다", () => {
    const summary = render(draftOf({ B1: 5, B3: 1, T1: 4, T2: 4, F1: 1, F2: 1, H1: 3, H2: "skipped" }));
    expect(summary.getAttribute("data-style-summary")).toBe("KBN?");
    const english = [...summary.querySelectorAll("[data-english-label]")];
    expect(english.map(item => item.textContent)).toEqual(["Keep"]);
    const meaning = english[0].parentElement!;
    expect(meaning.textContent).toBe("처음 정한 전체 예산 지키기Keep");
    expect(meaning.firstChild?.textContent).toBe("처음 정한 전체 예산 지키기");
    expect(summary.textContent).not.toMatch(/Both|Middle|Neither|Unassigned/);
    expect(summary.querySelector("[data-code] .sr-only")?.textContent).toBe("네 글자 코드 K, B, N, 물음표");
  });

  it("요약이 스스로 덧붙이는 문장에는 퍼센트·줄표·시스템 말투·영문 뒤 조사·‘아니에요’ 고지가 없다", () => {
    const optionLabels = new Set<string>([...WEDDING_CODE_V31_OPTIONS, ...WEDDING_CODE_V31_STATUS_OPTIONS].map(option => option.label));
    const drafts = [draftOf(MIXED), paired(1, 1), paired(3, 3), paired(4, 2), createV31Draft(), (() => {
      const draft = paired(5, 5); draft.answers.F1 = "not_applicable"; draft.answers.B1 = "undecided"; draft.answers.H2 = "skipped"; return draft;
    })()];
    for (const draft of drafts) for (const compact of [false, true]) {
      for (const text of textNodes(render(draft, { compact }))) {
        expect(text, text).not.toMatch(/%|[—–]/);
        expect(text, text).not.toMatch(/선택값|요약 보류|\d+\/\d+개|요약 근거|Both|Middle|Neither|Unassigned|확인해 주세요/);
        expect(text, text).not.toMatch(/[A-Za-z][가-힣]/);
        if (optionLabels.has(text)) continue;
        expect(text.replace(/‘[^’]*’/g, ""), text).not.toContain("아니");
      }
    }
  });

  it("아래 개인 결과가 붙는 넓은 화면에서만 결혼식 취향이 따로 있다고 알린다", () => {
    expect(render(draftOf(MIXED)).textContent).toContain("결혼식 취향은 네 글자에 넣지 않았어요. 아래 개인 결과에서 따로 볼 수 있어요.");
    expect(render(draftOf(MIXED), { compact: true }).textContent).not.toContain("아래 개인 결과");
  });
});
