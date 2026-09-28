// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V31_OPTIONS, WEDDING_CODE_V31_STATUS_OPTIONS, type V31Draft, type V31Response } from "@/constants/weddingCodeV31";
import { createV31Draft } from "@/lib/weddingCode/v31";
import {
  V31_STYLE_BORDERLINE_TAG, V31_STYLE_CHANGE_NOTICE, V31_STYLE_DIMENSIONS, V31_STYLE_DOTS_LEGEND, V31_STYLE_LETTER_RULE,
  buildV31StyleSummary, v31StyleShowsLetterRule,
} from "@/lib/weddingCode/v31StyleSummary";
import WeddingCodeV31StyleSummary, { WeddingCodeV31PairSummary } from "./WeddingCodeV31StyleSummary";

function draftOf(answers: V31Draft["answers"]): V31Draft {
  const draft = createV31Draft();
  draft.answers = { ...answers };
  return draft;
}
function paired(first: V31Response, second: V31Response): V31Draft {
  return draftOf({ B1: first, B3: second, T1: first, T2: second, F1: first, F2: second, H1: first, H2: second });
}
function render(draft: V31Draft, props: { onEdit?: (id?: string) => void } = {}) {
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

/** 두 자리(일 나누기 4 대 3·가족과 상의 3 대 4)만 한 문장 쪽으로 한 칸 차이로 기운 글자다. */
const MIXED = { B1: 5, B3: 5, T1: 4, T2: 3, F1: 3, F2: 4, H1: 3, H2: 3 } as const;
/** 두 문장의 칸이 넓게 갈린 답(5 대 1, 3 대 3, 4 대 4). 아슬한 글자는 없다. */
const SPREAD = { B1: 5, B3: 5, T1: 4, T2: 4, F1: 5, F2: 1, H1: 3, H2: 3 } as const;
const TOPIC_NAMES: Record<string, string> = { budget: "예산", teamwork: "일 나누기", family: "가족과 상의", support: "받고 싶은 도움" };

describe("웨딩코드 v3.1 네 글자 요약 화면", () => {
  it("한 칸 차이로 갈린 글자가 어느 주제인지 코드보다 먼저 이름으로 알리고, 그 주제 줄에 글로 된 표시를 단다", () => {
    const summary = render(draftOf(MIXED));
    expect(summary.getAttribute("data-style-summary")).toBe("BTCM");
    expect(summary.getAttribute("data-borderline-count")).toBe("2");
    const notice = summary.querySelector("[data-borderline-notice]")!;
    const code = summary.querySelector("[data-code]")!;
    // 「밑줄 친 2개」처럼 눈으로만 알 수 있는 말 대신 주제 이름과 사실(실제로 고른 두 보기, 한 칸 차이)을 적는다.
    expect(notice.textContent).toBe("‘일 나누기’, ‘가족과 상의’ 글자는 두 문장의 답이 ‘그런 편이에요’와 ‘어느 쪽도 아니에요’로 한 칸 차이예요.");
    expect(summary.querySelector("[data-code-notice]")?.textContent).toBe("‘일 나누기’, ‘가족과 상의’ 글자는 두 문장의 답이 ‘그런 편이에요’와 ‘어느 쪽도 아니에요’로 한 칸 차이예요. 다시 답하면 글자가 달라질 수 있어요.");
    expect(notice.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 안내가 적은 주제 이름은 실제로 표시한 줄과 같다.
    const tagged = [...summary.querySelectorAll("[data-summary-topic]")].filter(row => row.querySelector("[data-borderline-tag]"));
    expect(tagged.map(row => row.getAttribute("data-summary-topic"))).toEqual(["teamwork", "family"]);
    for (const row of summary.querySelectorAll("[data-summary-topic]")) {
      const topicName = TOPIC_NAMES[row.getAttribute("data-summary-topic")!];
      expect(notice.textContent!.includes(`‘${topicName}’`), topicName).toBe(row.querySelector("[data-borderline-tag]") !== null);
    }
    for (const tag of summary.querySelectorAll("[data-borderline-tag]")) expect(tag.textContent).toBe(V31_STYLE_BORDERLINE_TAG);
    // 화면 읽기 프로그램도 어느 글자인지 글로 듣는다. 안내와 표시는 숨긴 영역 밖에 있다.
    for (const element of [notice, ...summary.querySelectorAll("[data-borderline-tag]")]) {
      expect(element.closest('[aria-hidden="true"]')).toBeNull();
      expect(element.closest(".sr-only")).toBeNull();
    }
    const letters = [...summary.querySelectorAll<HTMLElement>("[data-code-letter]")];
    expect(letters.map(item => item.textContent).join("")).toBe("BTCM");
    // 안내가 밑줄을 가리키지 않으므로 코드 글자에 밑줄을 긋지 않는다(설명 없는 표시가 된다).
    expect(letters.some(item => item.className.includes("underline"))).toBe(false);

    // 아슬한 글자가 없으면 그 줄은 없고, 다시 답하면 달라질 수 있다는 말만 코드보다 먼저 한 번 둔다.
    for (const steadyDraft of [paired(5, 5), paired(4, 4), draftOf(SPREAD), paired(5, 1)]) {
      const steady = render(steadyDraft);
      expect(steady.querySelector("[data-borderline-notice]")).toBeNull();
      expect(steady.querySelectorAll("[data-borderline-tag]")).toHaveLength(0);
      expect(steady.querySelector("[data-code-notice]")?.textContent).toBe(V31_STYLE_CHANGE_NOTICE);
      expect(steady.textContent).not.toContain("한 칸 옮겨도 그대로");
    }
    // 4 대 4 는 B 라 아슬하지 않다(예전 기준에서는 네 글자 모두 아슬했다).
    expect(render(paired(4, 4)).getAttribute("data-borderline-count")).toBe("0");
    const shaky = render(paired(4, 3));
    expect(shaky.querySelector("[data-borderline-notice]")?.textContent).toBe("네 글자 모두 두 문장의 답이 ‘그런 편이에요’와 ‘어느 쪽도 아니에요’로 한 칸 차이예요.");
    expect(shaky.querySelectorAll("[data-borderline-tag]")).toHaveLength(4);
    expect(render(createV31Draft()).querySelector("[data-code-notice]")).toBeNull();
  });

  it("아슬 표시와 안내는 두 답이 ‘그런 편이에요’와 ‘어느 쪽도 아니에요’인 칸에만 붙고, 한 칸 차이인 B·M·N 칸에는 같은 말이 없다", () => {
    const agree = WEDDING_CODE_V31_OPTIONS.find(option => option.value === 4)!.label;
    const neutral = WEDDING_CODE_V31_OPTIONS.find(option => option.value === 3)!.label;
    // 표시는 두 보기 이름을 줄여 인용한다. 보기 이름이 바뀌면 여기서 빨개진다.
    const tagQuotes = [...V31_STYLE_BORDERLINE_TAG.matchAll(/‘([^’]*)’/g)].map(match => match[1]);
    expect(tagQuotes).toHaveLength(2);
    expect(agree.startsWith(tagQuotes[0]) && neutral.startsWith(tagQuotes[1])).toBe(true);
    const ratings = [1, 2, 3, 4, 5] as const;
    let oneApartUntagged = 0;
    for (const definition of V31_STYLE_DIMENSIONS) for (const a of ratings) for (const b of ratings) {
      const summary = render(draftOf({ ...paired(5, 5).answers, [definition.first.id]: a, [definition.second.id]: b }));
      const name = `${definition.key} ${a}/${b}`;
      // 안내와 표시가 말하는 사실을 답에서 바로 계산한다: 한 답은 정확히 ‘그런 편이에요’, 다른 답은 정확히 ‘어느 쪽도 아니에요’.
      const fact = (a === 4 && b === 3) || (a === 3 && b === 4);
      const tagged = [...summary.querySelectorAll("[data-summary-topic]")].filter(row => row.querySelector("[data-borderline-tag]"));
      expect(tagged.map(row => row.getAttribute("data-summary-topic")), name).toEqual(fact ? [definition.key] : []);
      const notice = summary.querySelector("[data-borderline-notice]")?.textContent ?? null;
      if (fact) {
        // 안내가 인용한 두 보기는 그 줄에 실제로 보이는 두 답이다.
        const shown = [...tagged[0].querySelectorAll("[data-letter-answer]")].map(item => item.lastElementChild?.lastElementChild?.textContent);
        expect(new Set(shown), name).toEqual(new Set([agree, neutral]));
        expect(notice, name).toBe(`‘${TOPIC_NAMES[definition.key]}’ 글자는 두 문장의 답이 ‘${agree}’와 ‘${neutral}’로 한 칸 차이예요.`);
        continue;
      }
      expect(notice, name).toBeNull();
      expect(summary.textContent, name).not.toContain("한 칸 차이");
      expect(summary.textContent, name).not.toContain(V31_STYLE_BORDERLINE_TAG);
      if (Math.abs(a - b) === 1) oneApartUntagged += 1;
    }
    // 두 답이 한 칸 차이지만 표시가 없는 칸: 4,5·5,4(B)·2,3·3,2(M)·1,2·2,1(N) 여섯 칸 × 네 주제.
    expect(oneApartUntagged).toBe(24);
  });

  it("다시 답하면 달라질 수 있다는 말은 카드마다 한 번, 코드보다 먼저 둔다", () => {
    // 2026-09-28: 두 사람을 함께 보는 탭은 이 카드 대신 두 사람 표를 쓴다(그 표의 한 번은 아래 두 사람 표 테스트).
    const drafts = [draftOf(MIXED), draftOf(SPREAD), paired(4, 3), paired(1, 1), paired(3, 3)];
    for (const draft of drafts) {
      const summary = render(draft);
      expect(summary.textContent?.split(V31_STYLE_CHANGE_NOTICE).length, summary.getAttribute("data-style-summary")!).toBe(2);
      const change = summary.querySelector("[data-change-notice]")!;
      expect(change.compareDocumentPosition(summary.querySelector("[data-code]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // 아슬한 글자 안내는 그 사람의 글자에 대한 사실이라 카드에 있다.
      expect(summary.querySelector("[data-borderline-notice]")?.textContent ?? null).toBe(buildV31StyleSummary(draft).borderlineNotice);
    }
  });

  it("글자마다 두 문장에 고른 답을 다섯 칸 점과 보기 이름으로 보여주고 퍼센트와 막대는 쓰지 않는다", () => {
    const summary = render(draftOf(SPREAD), { onEdit: () => {} });
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

  it("‘~스타일’ 이름·이름 출처 줄·헤드라인을 어떤 답에서도 화면에 두지 않는다 (2026-09-27 파운더 결정)", () => {
    // 예전 이름·헤드라인 문장. 글자 뜻 줄(BOTH_LABELS·문장 라벨)과 겹치지 않는 것만 적는다.
    const oldCopy = [
      "업체는 시간을 맞춰 함께 찾아보고 싶어요", "업체는 함께 찾고", "처음 정한 전체 예산 안에서 준비하고 싶어요",
      "전체 예산을 늘릴지도 다시 의논하고 싶어요", "전체 예산을 지키고 싶고", "가족의 바람을 준비 초반에 들어보고 싶어요",
      "마지막 선택은 우리 둘이 하고 싶어요", "힘들 때 해결책보다 이야기를 먼저 들어주면 좋겠어요",
      "일이 몰리면 일부를 맡아주는 도움이 있으면 좋겠어요", "몰린 일의 일부도 맡아주면 좋겠어요", "고른 답은 아래에서 하나씩 볼 수 있어요",
    ];
    const ratings = [1, 2, 3, 4, 5] as const;
    const drafts = [
      ...ratings.flatMap(first => ratings.map(second => paired(first, second))),
      draftOf(MIXED), draftOf(SPREAD), createV31Draft(), paired("undecided", 5), paired("not_applicable", "not_applicable"),
      draftOf({ B1: 5, B3: "undecided", T1: 3, T2: 3, F1: 1, F2: 1, H1: 2, H2: 3 }),
    ];
    for (const draft of drafts) {
      const summary = render(draft, { onEdit: () => {} });
      const code = summary.getAttribute("data-style-summary")!;
      expect(summary.querySelector("[data-style-name], [data-name-source]"), code).toBeNull();
      expect(summary.textContent, code).not.toMatch(/스타일|이름은|이름을 붙이|이름도 바뀌|따왔어요|따와요/);
      for (const text of oldCopy) expect(summary.textContent, `${code} ${text}`).not.toContain(text);
      // 코드 바로 다음은 주제 순서 설명이다. 이름·헤드라인이 끼어들 자리가 없다.
      expect(summary.querySelector("[data-code]")?.nextElementSibling?.hasAttribute("data-topic-order"), code).toBe(true);
      // 제목은 누구의 코드인지 하나뿐이다(이름을 제목으로 세우지 않는다).
      expect([...summary.querySelectorAll("h1, h2")].map(item => item.textContent), code).toEqual(["내 웨딩코드"]);
    }
  });

  it("카드의 첫 제목은 누구의 코드인지이고, 그 아래 아슬한 글자 안내·코드·주제 순서 설명·주제별 줄 순서로 읽힌다", () => {
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
      const order = ["[data-borderline-notice]", "[data-change-notice]", "[data-code]", "[data-topic-order]", "[data-summary-topic]"].map(selector => summary.querySelector(selector)!);
      expect(order.every(Boolean), String(label)).toBe(true);
      expect(summary.querySelector("[data-topic-order]")?.textContent).toBe("예산, 일 나누기, 가족과 상의, 받고 싶은 도움 순서로 주제마다 한 글자씩 붙였어요.");
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
    // 규칙 한 줄(2026-09-28)이 붙는 답(한 문장·두 문장 모두에서 나온 글자)도 함께 훑는다.
    const drafts = [draftOf(MIXED), paired(1, 1), paired(3, 3), paired(4, 2), paired(4, 3), paired(5, 5), paired(4, 1), createV31Draft(), (() => {
      const draft = paired(5, 5); draft.answers.F1 = "not_applicable"; draft.answers.B1 = "undecided"; draft.answers.H2 = "skipped"; return draft;
    })()];
    for (const draft of drafts) {
      for (const text of textNodes(render(draft))) {
        expect(text, text).not.toMatch(/%|[—–]/);
        expect(text, text).not.toMatch(/선택값|요약 보류|\d+\/\d+개|요약 근거|Both|Middle|Neither|Unassigned|확인해 주세요/);
        expect(text, text).not.toMatch(/[A-Za-z][가-힣]/);
        if (optionLabels.has(text)) continue;
        expect(text.replace(/‘[^’]*’/g, ""), text).not.toContain("아니");
      }
    }
  });

  it("카드 아래 개인 결과에 결혼식 취향이 따로 있다고 알린다", () => {
    // 2026-09-27: 「~넣지 않았어요」 대신 어디에 있는지를 말한다. 판정 고지는 결과 머리글에서 한 번만 한다.
    // 2026-09-28: 좁은 카드(함께 보기)가 두 사람 표로 바뀌어 이 카드는 늘 아래에 개인 결과가 붙는다.
    expect(render(draftOf(MIXED)).textContent).toContain("결혼식 취향은 아래에 따로 모았어요.");
    expect(render(draftOf(MIXED)).textContent).not.toContain("넣지 않았어요");
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

const RATINGS = [1, 2, 3, 4, 5] as const;
/** 한 문장·두 문장 모두에서 나온 글자(K·R·T·D·F·C·L·A·B)가 있는 답. */
const RULE_DRAFTS = (): [string, V31Draft][] => [["MIXED", draftOf(MIXED)], ["4/3", paired(4, 3)], ["5/5", paired(5, 5)], ["4/1", paired(4, 1)]];
/** M·N·‘?’만 있는 답. */
const NO_RULE_DRAFTS = (): [string, V31Draft][] => [["3/3", paired(3, 3)], ["1/1", paired(1, 1)], ["모름", paired("undecided", "undecided")], ["빈 답", createV31Draft()]];
const count = (text: string | null | undefined, part: string) => (text ?? "").split(part).length - 1;

describe("2026-09-28 코드 카드의 규칙 한 줄", () => {
  it("주제마다 붙던 ‘그런 편’ 근거 줄은 어떤 답에서도 두지 않는다", () => {
    const drafts = [...RATINGS.flatMap(first => RATINGS.map(second => paired(first, second))), draftOf(MIXED), draftOf(SPREAD), createV31Draft(), paired("undecided", 5)];
    for (const draft of drafts) expect(render(draft).textContent, buildV31StyleSummary(draft).code).not.toMatch(/‘그런 편’ 이상으로 답했어요/);
  });

  it("글자가 정해진 자리가 있으면 칠한 칸 설명 뒤에 규칙을 한 번 두고, M·N·‘?’만이면 두지 않는다", () => {
    for (const [name, draft] of RULE_DRAFTS()) {
      const summary = render(draft);
      expect(v31StyleShowsLetterRule(buildV31StyleSummary(draft)), name).toBe(true);
      expect(count(summary.textContent, V31_STYLE_LETTER_RULE), name).toBe(1);
      // 규칙은 칠한 칸 설명과 같은 문단에서 그 뒤에 온다(‘그 문장’이 가리킬 앞 절이 있다).
      const legend = [...summary.querySelectorAll("p")].find(item => item.textContent?.includes(V31_STYLE_LETTER_RULE));
      expect(legend?.textContent, name).toBe(`${V31_STYLE_DOTS_LEGEND} ${V31_STYLE_LETTER_RULE}`);
    }
    for (const [name, draft] of NO_RULE_DRAFTS()) {
      const summary = render(draft);
      expect(v31StyleShowsLetterRule(buildV31StyleSummary(draft)), name).toBe(false);
      expect(summary.textContent, name).not.toContain(V31_STYLE_LETTER_RULE);
      expect(summary.textContent, name).toContain(V31_STYLE_DOTS_LEGEND);
    }
  });

  it("한 주제가 ‘?’여도 다른 주제에 글자가 정해졌으면 규칙은 한 번이고, ‘?’ 안내는 그 주제 이름을 적는다", () => {
    const summary = render(draftOf({ B1: 5, B3: "undecided", T1: 5, T2: 1, F1: 4, F2: 4, H1: 1, H2: 1 }));
    expect(summary.getAttribute("data-style-summary")).toBe("?TBN");
    expect(count(summary.textContent, V31_STYLE_LETTER_RULE)).toBe(1);
    expect(summary.querySelector('[data-code-letter="budget"]')?.textContent).toBe("?");
    expect(summary.querySelector("[data-pending-notice]")?.textContent).toContain("‘예산’");
  });

  it("코드에 쓰지 않은 문장을 여는 ‘다른 문장에 고른 답도 보기’는 두지 않는다(문장별 답 모두 보기에 칸과 함께 있다)", () => {
    for (const draft of [draftOf({ ...MIXED, V1: 5, G1: 3, T3: 4, H4: "undecided" }), draftOf(MIXED), createV31Draft()]) {
      const summary = render(draft, { onEdit: () => {} });
      expect(summary.querySelector("[data-extra-statement-scales]")).toBeNull();
      expect(summary.textContent).not.toContain("다른 문장에 고른 답도 보기");
      expect(summary.textContent).not.toContain("네 글자에는 넣지 않았어요");
    }
  });
});

/** 함께 보기 탭이 받는 이름. 읽기 전용(본인이 확인된 두 사람 결과)은 받지 않은 결과와 이름이 같다. */
const PAIR_LABEL_SETS = [
  { name: "받지 않은 결과", labels: { first: "상대", second: "나" }, tabNames: ["내 결과", "상대 결과"] },
  { name: "읽기 전용", labels: { first: "상대", second: "나" }, tabNames: ["내 결과", "상대 결과"] },
  { name: "받은 링크", labels: { first: "먼저 답한 사람", second: "나중에 답한 사람" }, tabNames: ["먼저 답한 사람", "나중에 답한 사람"] },
] as const;
function renderPair(first: V31Draft, second: V31Draft, set: (typeof PAIR_LABEL_SETS)[number] = PAIR_LABEL_SETS[0]) {
  const changeNotice = [first, second].map(item => buildV31StyleSummary(item).changeNotice).find(notice => notice !== null) ?? null;
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<WeddingCodeV31PairSummary first={first} second={second} labels={set.labels} tabNames={set.tabNames} changeNotice={changeNotice} />);
  return container.querySelector<HTMLElement>("[data-pair-summary]")!;
}
const UNDECIDED_MIX = draftOf({ B1: "undecided", B3: 5, T1: "not_applicable", T2: "not_applicable", F1: 4, F2: 3, H1: "skipped", H2: 2 });
const PAIRS = (): [string, V31Draft, V31Draft][] => [
  ["MIXED·SPREAD", draftOf(MIXED), draftOf(SPREAD)],
  ["4/3·1/1", paired(4, 3), paired(1, 1)],
  ["3/3·1/1", paired(3, 3), paired(1, 1)],
  ["빈 답·MIXED", createV31Draft(), draftOf(MIXED)],
  ["모름 섞임·5/1", UNDECIDED_MIX, paired(5, 1)],
];

describe("2026-09-28 함께 보기의 두 사람 코드 표", () => {
  it("두 코드를 먼저 답한 사람부터 따로 두고, 주제 줄마다 누구의 글자인지 글자 옆에 보이게 적는다", () => {
    for (const set of PAIR_LABEL_SETS) for (const [name, first, second] of PAIRS()) {
      const table = renderPair(first, second, set);
      const label = `${set.name} ${name}`;
      expect([...table.querySelectorAll("[data-pair-code]")].map(item => item.getAttribute("data-pair-code")), label)
        .toEqual([buildV31StyleSummary(first).code, buildV31StyleSummary(second).code]);
      const rows = [...table.querySelectorAll("[data-summary-topic]")];
      expect(rows.map(row => row.getAttribute("data-summary-topic")), label).toEqual(V31_STYLE_DIMENSIONS.map(item => item.key));
      for (const row of rows) {
        const cells = [...row.querySelectorAll("[data-pair-letter]")];
        expect(cells.map(cell => cell.getAttribute("data-pair-letter")), label).toEqual(["first", "second"]);
        for (const cell of cells) {
          const owner = cell.querySelector("[data-pair-owner]")!;
          expect(owner.textContent, label).toBe(cell.getAttribute("data-pair-letter") === "first" ? set.labels.first : set.labels.second);
          expect(owner.className, label).not.toContain("sr-only");
          expect(owner.closest('[aria-hidden="true"], .sr-only'), label).toBeNull();
        }
      }
      expect(table.querySelectorAll("button"), label).toHaveLength(0);
      expect(table.querySelector("details"), label).toBeNull();
    }
  });

  it("「글자가 달라요」는 두 글자가 모두 정해졌고 다를 때만 달고, ‘?’가 있으면 달지 않는다", () => {
    let marked = 0;
    for (const [name, first, second] of [...PAIRS(), ["5/1·1/5", paired(5, 1), paired(1, 5)], ["같은 답", draftOf(MIXED), draftOf(MIXED)]] as [string, V31Draft, V31Draft][]) {
      const table = renderPair(first, second);
      const [a, b] = [buildV31StyleSummary(first), buildV31StyleSummary(second)];
      for (const [index, row] of [...table.querySelectorAll("[data-summary-topic]")].entries()) {
        const [x, y] = [a.dimensions[index].letter, b.dimensions[index].letter];
        const expected = x !== "?" && y !== "?" && x !== y;
        expect(row.querySelector("[data-letters-differ]") !== null, `${name} ${x}/${y}`).toBe(expected);
        if (expected) { marked += 1; expect(row.querySelector("[data-letters-differ]")?.textContent).toBe("글자가 달라요"); }
      }
    }
    expect(marked).toBeGreaterThan(0);
  });

  it("코드를 만든 여덟 문장을 영문 낱말과 함께 두고, 두 사람의 답을 다섯 칸 점과 보기 이름으로 나란히 둔다", () => {
    const table = renderPair(draftOf(MIXED), draftOf(SPREAD));
    const statements = [...table.querySelectorAll("[data-pair-statement]")];
    const definitions = V31_STYLE_DIMENSIONS.flatMap(item => [item.first, item.second]);
    expect(statements.map(item => item.getAttribute("data-pair-statement"))).toEqual(definitions.map(item => item.id));
    for (const [index, statement] of statements.entries()) expect(statement.textContent).toContain(definitions[index].englishLabel);
    // 모든 답이 칸으로 고른 답이면 주제마다 네 칸 묶음(두 문장 × 두 사람)이다.
    for (const row of table.querySelectorAll("[data-summary-topic]")) expect(row.querySelectorAll('[role="img"]')).toHaveLength(4);
    expect(table.querySelector('[data-pair-statement="F2"] [role="img"][aria-label="다섯 칸 중 한 칸"]')).not.toBeNull();
    expect(table.querySelector('[data-pair-statement="F2"]')?.textContent).toContain("전혀 그렇지 않아요");
    // 칸이 없는 답은 보기 이름만 적는다.
    const pending = renderPair(UNDECIDED_MIX, paired(5, 1));
    expect(pending.querySelectorAll('[data-summary-topic="budget"] [role="img"]')).toHaveLength(3);
    expect(pending.querySelector('[data-pair-statement="B1"]')?.textContent).toContain("아직 모르겠어요");
  });

  it("M·N 칸에는 글자 뜻 한 줄을 두고, 그 밖의 칸에는 두지 않으며, ‘?’는 물음표로 읽는다", () => {
    const table = renderPair(paired(3, 3), paired(1, 1));
    for (const row of table.querySelectorAll("[data-summary-topic]")) {
      expect(row.querySelector('[data-pair-letter="first"] [data-letter-meaning]')?.textContent).toBe("중간으로 답한 문장이 있어요");
      expect(row.querySelector('[data-pair-letter="second"] [data-letter-meaning]')?.textContent).toBe("두 문장 모두 낮게 답했어요");
    }
    const lettered = renderPair(paired(5, 5), paired(5, 1));
    expect(lettered.querySelector("[data-letter-meaning]")).toBeNull();
    const unknown = renderPair(createV31Draft(), paired(5, 5));
    for (const cell of unknown.querySelectorAll('[data-pair-letter="first"]')) {
      expect(cell.querySelector(".sr-only")?.textContent).toBe("물음표");
      expect(cell.querySelector("[data-letter-meaning]")).toBeNull();
    }
    expect(unknown.querySelector('[data-pair-code="????"] .sr-only')?.textContent).toBe("네 글자 코드 물음표, 물음표, 물음표, 물음표");
  });

  it("규칙 한 줄은 두 사람 중 한 사람이라도 글자가 정해진 자리가 있을 때만 한 번 둔다", () => {
    expect(renderPair(paired(3, 3), paired(1, 1)).textContent).not.toContain(V31_STYLE_LETTER_RULE);
    expect(renderPair(paired(3, 3), paired(1, 1)).textContent).toContain(V31_STYLE_DOTS_LEGEND);
    expect(renderPair(createV31Draft(), paired("undecided", "undecided")).textContent).not.toContain(V31_STYLE_LETTER_RULE);
    for (const [first, second] of [[draftOf(MIXED), paired(1, 1)], [paired(1, 1), paired(5, 5)], [paired(4, 3), paired(4, 1)]]) {
      expect(count(renderPair(first, second).textContent, V31_STYLE_LETTER_RULE)).toBe(1);
    }
  });

  it("다시 답하면 달라질 수 있다는 말과 사람별 안내는 코드보다 먼저 두고, 나머지는 사람별 탭에서 본다고 탭 이름으로 알린다", () => {
    for (const set of PAIR_LABEL_SETS) {
      const table = renderPair(draftOf(MIXED), UNDECIDED_MIX, set);
      const codes = [...table.querySelectorAll("[data-pair-code] [data-code]")];
      expect(table.querySelectorAll("[data-change-notice]")).toHaveLength(1);
      expect(table.querySelector("p")?.querySelector("[data-change-notice]")).not.toBeNull();
      const firstNotice = table.querySelector('[data-pair-notice="first"]')!;
      const secondNotice = table.querySelector('[data-pair-notice="second"]')!;
      expect(firstNotice.querySelector("[data-borderline-notice]")?.textContent).toBe(buildV31StyleSummary(draftOf(MIXED)).borderlineNotice);
      expect(firstNotice.querySelector("[data-pending-notice]")).toBeNull();
      expect(secondNotice.querySelector("[data-pending-notice]")?.textContent).toBe(buildV31StyleSummary(UNDECIDED_MIX).pendingNotice);
      for (const notice of [table.querySelector("[data-change-notice]")!, firstNotice, secondNotice]) {
        for (const code of codes) expect(notice.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING, set.name).toBeTruthy();
      }
      expect(table.querySelector("[data-pair-pointer]")?.textContent).toBe(`코드를 만든 문장 전체와 나머지 답은 ‘${set.tabNames[0]}’, ‘${set.tabNames[1]}’ 탭에서 볼 수 있어요.`);
    }
    expect(renderPair(createV31Draft(), createV31Draft()).querySelector("[data-change-notice]")).toBeNull();
  });

  it("표가 스스로 덧붙이는 문장에는 퍼센트·줄표·시스템 말투·영문 뒤 조사·이름·‘아니’ 고지·같다·일치·점수가 없다", () => {
    const optionLabels = new Set<string>([...WEDDING_CODE_V31_OPTIONS, ...WEDDING_CODE_V31_STATUS_OPTIONS].map(option => option.label));
    const drafts = [draftOf(MIXED), paired(4, 3), paired(1, 1), paired(3, 3), createV31Draft(), UNDECIDED_MIX];
    for (const set of PAIR_LABEL_SETS) for (const first of drafts) for (const second of drafts) {
      for (const text of textNodes(renderPair(first, second, set))) {
        expect(text, text).not.toMatch(/%|[—–]/);
        expect(text, text).not.toMatch(/선택값|요약 보류|\d+\/\d+개|요약 근거|Both|Middle|Neither|Unassigned|확인해 주세요/);
        expect(text, text).not.toMatch(/[A-Za-z][가-힣]/);
        expect(text, text).not.toMatch(/스타일|이름은|이름을 붙이|이름도 바뀌|따왔어요|따와요/);
        expect(text, text).not.toMatch(/같아요|일치|궁합|점수/);
        if (optionLabels.has(text)) continue;
        expect(text.replace(/‘[^’]*’/g, ""), text).not.toContain("아니");
      }
    }
  });
});
