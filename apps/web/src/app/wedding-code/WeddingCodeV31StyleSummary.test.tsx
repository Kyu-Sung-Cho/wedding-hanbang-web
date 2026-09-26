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
  it("아슬한 글자가 어느 주제인지 코드보다 먼저 이름으로 알리고, 그 주제 줄에 글로 된 표시를 단다", () => {
    const summary = render(draftOf(MIXED));
    expect(summary.getAttribute("data-style-summary")).toBe("BBFM");
    expect(summary.getAttribute("data-borderline-count")).toBe("2");
    const notice = summary.querySelector("[data-borderline-notice]")!;
    const code = summary.querySelector("[data-code]")!;
    // 2026-09-27: 「밑줄 친 2개」는 눈으로만 알 수 있고 화면 읽기 프로그램은 어느 글자인지 몰랐다. 주제 이름을 적는다.
    expect(notice.textContent).toBe("‘일 나누기’, ‘받고 싶은 도움’ 글자는 답 하나만 한 칸 달라져도 바뀌어요. 다른 글자도 다시 답하면 달라질 수 있어요.");
    expect(notice.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 안내가 적은 주제 이름은 실제로 아슬하다고 표시한 줄과 같다.
    const tagged = [...summary.querySelectorAll("[data-summary-topic]")].filter(row => row.querySelector("[data-borderline-tag]"));
    expect(tagged.map(row => row.getAttribute("data-summary-topic"))).toEqual(["teamwork", "support"]);
    const topicNames: Record<string, string> = { budget: "예산", teamwork: "일 나누기", family: "가족과 상의", support: "받고 싶은 도움" };
    for (const row of summary.querySelectorAll("[data-summary-topic]")) {
      const topicName = topicNames[row.getAttribute("data-summary-topic")!];
      expect(notice.textContent!.includes(`‘${topicName}’`), topicName).toBe(row.querySelector("[data-borderline-tag]") !== null);
    }
    const letters = [...summary.querySelectorAll<HTMLElement>("[data-code-letter]")];
    expect(letters.map(item => item.textContent).join("")).toBe("BBFM");
    // 안내가 더는 밑줄을 가리키지 않으므로 코드 글자에 밑줄을 긋지 않는다(설명 없는 표시가 된다).
    expect(letters.some(item => item.className.includes("underline"))).toBe(false);
    expect(summary.querySelector('[data-summary-topic="teamwork"] [data-borderline-tag]')?.textContent).toBe("바뀔 수 있어요");

    const steady = render(paired(5, 5));
    expect(steady.querySelector("[data-borderline-notice]")?.textContent).toBe("지금 글자는 답 하나를 한 칸 옮겨도 그대로예요. 다시 답하면 달라질 수 있어요.");
    expect(steady.querySelectorAll("[data-borderline-tag]")).toHaveLength(0);
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
    // 일 나누기(4 대 4)는 한 칸 차이로 바뀌는 글자라 이름도 바뀔 수 있다고 먼저 말한다.
    expect(source.textContent).toBe("이름은 ‘일 나누기’ 답에서 따와서, 이 글자가 바뀌면 이름도 바뀌어요");
    expect(source.nextElementSibling?.hasAttribute("data-style-name")).toBe(true);
    expect(source.nextElementSibling?.textContent).toBe("함께 찾고, 세부는 맡겨도 되는 스타일");

    const budget = render(draftOf({ T1: 3, T2: 3, B1: 2, B3: 5 }));
    expect(budget.querySelector("[data-name-source]")?.textContent).toBe("이름은 ‘예산’ 답에서 따왔어요");
    expect(budget.querySelector("[data-style-name]")?.textContent).toBe("예산을 다시 의논하는 스타일");

    const none = render(paired(3, 3));
    expect(none.querySelector("[data-name-source]")?.getAttribute("data-name-source")).toBe("none");
    expect(none.querySelector("[data-name-source]")?.textContent).toBe(V31_STYLE_NAME_FALLBACK.nameSource);
    expect(none.querySelector("[data-style-name]")?.textContent).toBe(V31_STYLE_NAME_FALLBACK.name);

    // ‘아직 모르겠어요’도 고른 답이라, 한 문장만 칸으로 답한 주제는 이름을 내지 않는다고 사실대로 적는다.
    const unknown = render(draftOf({ B1: 5, B3: "undecided", T1: 3, T2: 3, F1: 1, F2: 1, H1: 2, H2: 3 }));
    expect(unknown.getAttribute("data-style-summary")).toBe("?MNM");
    expect(unknown.querySelector("[data-name-source]")?.textContent).toBe("이름은 두 문장 모두 동의하는 정도를 고르고, 그중 ‘그런 편’ 이상이 있는 주제에서 따와요");
  });

  it("카드의 첫 제목은 누구의 코드인지이고, 그 아래 아슬한 글자 안내·코드·이름 출처·이름 순서로 읽힌다", () => {
    const cases: [string | undefined, string][] = [[undefined, "내 웨딩코드"], ["나", "내 웨딩코드"], ["상대", "상대의 웨딩코드"], ["먼저 답한 사람", "먼저 답한 사람의 웨딩코드"]];
    for (const [label, heading] of cases) {
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(<WeddingCodeV31StyleSummary draft={draftOf(MIXED)} label={label} />);
      const summary = container.querySelector<HTMLElement>("[data-style-summary]")!;
      const headings = [...summary.querySelectorAll("h1, h2, h3, h4, h5, h6")];
      expect(headings[0]?.tagName, String(label)).toBe("H2");
      expect(headings[0]?.textContent, String(label)).toBe(heading);
      // 섹션 이름은 이 제목에서 가져온다(이름이 두 번 읽히지 않게).
      expect(summary.getAttribute("aria-labelledby")).toBe(headings[0]!.id);
      expect(summary.hasAttribute("aria-label")).toBe(false);
      // 이름은 제목이 아니다. 제목으로 건너뛰어도 이름보다 안내와 코드를 먼저 듣는다.
      expect(headings.some(item => item.textContent === "함께 찾고, 세부는 맡겨도 되는 스타일")).toBe(false);
      const order = ["[data-borderline-notice]", "[data-code]", "[data-name-source]", "[data-style-name]"].map(selector => summary.querySelector(selector)!);
      expect(headings[0]!.compareDocumentPosition(order[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      for (let index = 1; index < order.length; index += 1) {
        expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING, `${index}`).toBeTruthy();
      }
    }
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
    expect(family.querySelector("[data-letter-meaning]")?.textContent).toBe("이번 계획에 없어서 글자 대신 ‘?’를 뒀어요");
    expect(family.querySelector('[role="img"]')).toBeNull();
    expect(summary.querySelector('[data-summary-topic="budget"]')?.getAttribute("data-pending")).toBe("open");
    const notice = summary.querySelector("[data-pending-notice]")!.textContent!;
    expect(notice).toBe("‘예산’ 주제는 아직 모르거나 답하지 않은 문장이 있어서 ‘?’로 남겼어요. 그 문장에 동의하는 정도를 고르면 글자가 생겨요. ‘가족과 상의’ 주제는 이번 계획에 없다고 답해서 ‘?’로 적었어요.");
    expect(summary.textContent).not.toContain("요약 보류");
    expect(summary.textContent).not.toContain("확인해 주세요");

    // 2026-09-27: 한 문장(H2)만 계획에 없다고 답했는데 주제 전체를 계획에 없다고 답했다고 적던 것을 고친다.
    const onlyNotInPlan = paired(5, 5);
    onlyNotInPlan.answers.H2 = "not_applicable";
    const notInPlan = render(onlyNotInPlan).querySelector("[data-pending-notice]")!.textContent!;
    expect(notInPlan).toBe("‘받고 싶은 도움’ 주제는 한 문장에 ‘이번 계획에는 없어요’로 답해서 ‘?’로 적었어요.");
    expect(notInPlan).not.toContain("이번 계획에 없다고 답해서");
    expect(notInPlan).not.toContain("글자가 생겨요");
    expect(render(paired(5, 1)).querySelector("[data-pending-notice]")).toBeNull();
  });

  it("‘?’·M·N 자리는 라벨 한 줄과 답 줄만 두고, 같은 안내를 주제마다 되풀이하지 않는다", () => {
    const cases: [string, V31Draft][] = [
      ["모두 모름", paired("undecided", "undecided")],
      ["모두 계획 없음", paired("not_applicable", "not_applicable")],
      ["모두 중간", paired(3, 3)],
      ["모두 낮음", paired(1, 1)],
      ["안 본 문장", createV31Draft()],
    ];
    for (const [name, draft] of cases) {
      const summary = render(draft);
      const rows = [...summary.querySelectorAll("[data-summary-topic]")];
      for (const row of rows) {
        // 라벨과 답 줄 두 칸만 있다. 근거 칸을 비워 두고 그리지도 않는다.
        const cells = [...row.querySelectorAll("dd")];
        expect(cells, name).toHaveLength(2);
        expect(cells.every(item => (item.textContent?.trim().length ?? 0) > 0), name).toBe(true);
      }
      // ‘?’가 왜 생겼고 어떻게 채우는지는 카드 위에서 한 번만 말한다. 주제마다 같은 안내 문장을 되풀이하지 않는다.
      const sentences = (summary.textContent ?? "").split(/(?<=요\.)/).map(item => item.trim()).filter(item => item.length > 12);
      for (const sentence of new Set(sentences)) expect(sentences.filter(item => item === sentence), `${name}: ${sentence}`).toHaveLength(1);
      expect((summary.textContent?.match(/글자가 생겨요/g) ?? []).length, name).toBeLessThanOrEqual(1);
      expect((summary.textContent?.match(/아직 모르겠어요’로 남긴/g) ?? []).length, name).toBe(0);
      expect(summary.textContent, name).not.toContain("글자 대신 ‘?’를 둬요");
    }
  });

  it("한 문장에서 나온 글자는 뜻을 한 줄 더 쓰지 않고, 그 글자가 나온 답 줄에만 영문 낱말을 붙인다", () => {
    const summary = render(draftOf({ B1: 5, B3: 1, T1: 4, T2: 4, F1: 1, F2: 1, H1: 3, H2: "skipped" }));
    expect(summary.getAttribute("data-style-summary")).toBe("KBN?");
    const english = [...summary.querySelectorAll("[data-english-label]")];
    expect(english.map(item => item.textContent)).toEqual(["Keep"]);
    // 영문 낱말은 글자가 나온 문장(B1)의 답 줄에 붙는다.
    expect(english[0].closest("[data-letter-answer]")?.getAttribute("data-letter-answer")).toBe("B1");
    expect(english[0].getAttribute("data-letter-source")).toBe("K");
    expect(english[0].parentElement?.firstChild?.textContent).toBe("처음 정한 전체 예산 지키기");
    // 2026-09-27: 뜻 줄 「처음 정한 전체 예산 지키기 Keep」 바로 아래 답 줄이 같은 말을 되풀이했다.
    const budget = summary.querySelector('[data-summary-topic="budget"]')!;
    expect(budget.querySelector("[data-letter-meaning]")).toBeNull();
    expect(budget.textContent?.split("처음 정한 전체 예산 지키기").length).toBe(2);
    // 두 문장 모두·N·‘?’ 자리는 특정 답 줄이 아니라 뜻 줄로 적는다.
    for (const key of ["teamwork", "family", "support"]) expect(summary.querySelector(`[data-summary-topic="${key}"] [data-letter-meaning]`), key).not.toBeNull();
    expect(summary.textContent).not.toMatch(/Both|Middle|Neither|Unassigned/);
    expect(summary.querySelector("[data-code] .sr-only")?.textContent).toBe("네 글자 코드 K, B, N, 물음표");
  });

  it("한 문장에서 나온 글자의 주제 줄에서는 출처 문장의 이름이 한 번만 나온다", () => {
    const pairs: [V31Response, V31Response][] = [[5, 1], [1, 5], [4, 3], [3, 4], [5, 2]];
    for (const [first, second] of pairs) {
      const summary = render(paired(first, second));
      for (const row of summary.querySelectorAll("[data-summary-topic]")) {
        const source = row.querySelector("[data-letter-source]");
        expect(source, `${String(first)}/${String(second)}`).not.toBeNull();
        const shortLabel = source!.parentElement!.firstChild!.textContent!;
        expect(row.textContent?.split(shortLabel).length, `${String(first)}/${String(second)} ${shortLabel}`).toBe(2);
      }
    }
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
    // 2026-09-27: 「~넣지 않았어요」 대신 어디에 있는지를 말한다. 판정 고지는 결과 머리글에서 한 번만 한다.
    expect(render(draftOf(MIXED)).textContent).toContain("결혼식 취향은 아래에 따로 모았어요.");
    expect(render(draftOf(MIXED)).textContent).not.toContain("넣지 않았어요");
    expect(render(draftOf(MIXED), { compact: true }).textContent).not.toContain("아래에 따로");
  });

  it("칸의 뜻과 칸 없는 답을 명사형이나 화면에 없는 이름으로 부르지 않는다", () => {
    const summary = render(draftOf(MIXED), { onEdit: () => {} });
    expect(summary.textContent).toContain("칠한 칸이 많을수록 그 문장에 더 동의했다는 거예요.");
    expect(summary.textContent).not.toContain("동의한 답이에요");
    const fold = summary.querySelector("[data-core-statement-scales]")!;
    expect(fold.textContent).toContain("‘아직 모르겠어요’, ‘이번 계획에는 없어요’, ‘지금 답하지 않을게요’는 칸 없이 그 답만 적었어요.");
    // 칸 없는 답은 실제 보기 이름으로 부른다(화면 어디에도 없는 ‘건너뜀’·‘모름’으로 부르지 않는다).
    expect(fold.textContent).not.toMatch(/건너뜀|모름,/);
    for (const label of WEDDING_CODE_V31_STATUS_OPTIONS.map(option => option.label)) expect(fold.textContent).toContain(`‘${label}’`);
  });
});
