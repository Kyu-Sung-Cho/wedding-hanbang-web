// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V31_OPTIONS, WEDDING_CODE_V31_STATUS_OPTIONS, type V31Draft, type V31Response } from "@/constants/weddingCodeV31";
import { createV31Draft } from "@/lib/weddingCode/v31";
import { V31_STYLE_BORDERLINE_TAG, V31_STYLE_CHANGE_NOTICE, V31_STYLE_DIMENSIONS, buildV31StyleSummary } from "@/lib/weddingCode/v31StyleSummary";
import WeddingCodeV31StyleSummary from "./WeddingCodeV31StyleSummary";

function draftOf(answers: V31Draft["answers"]): V31Draft {
  const draft = createV31Draft();
  draft.answers = { ...answers };
  return draft;
}
function paired(first: V31Response, second: V31Response): V31Draft {
  return draftOf({ B1: first, B3: second, T1: first, T2: second, F1: first, F2: second, H1: first, H2: second });
}
function render(draft: V31Draft, props: { compact?: boolean; onEdit?: (id?: string) => void; showChangeNotice?: boolean } = {}) {
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
    expect(notice.textContent).toBe("‘일 나누기’, ‘가족과 상의’ 글자는 두 문장의 답이 ‘그런 편이에요’와 ‘동의하지도 반대하지도 않아요’로 한 칸 차이예요.");
    expect(summary.querySelector("[data-code-notice]")?.textContent).toBe("‘일 나누기’, ‘가족과 상의’ 글자는 두 문장의 답이 ‘그런 편이에요’와 ‘동의하지도 반대하지도 않아요’로 한 칸 차이예요. 다시 답하면 글자가 달라질 수 있어요.");
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
    expect(shaky.querySelector("[data-borderline-notice]")?.textContent).toBe("네 글자 모두 두 문장의 답이 ‘그런 편이에요’와 ‘동의하지도 반대하지도 않아요’로 한 칸 차이예요.");
    expect(shaky.querySelectorAll("[data-borderline-tag]")).toHaveLength(4);
    expect(render(createV31Draft()).querySelector("[data-code-notice]")).toBeNull();
  });

  it("아슬 표시와 안내는 두 답이 ‘그런 편이에요’와 ‘동의하지도 반대하지도 않아요’인 칸에만 붙고, 한 칸 차이인 B·M·N 칸에는 같은 말이 없다", () => {
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
      // 안내와 표시가 말하는 사실을 답에서 바로 계산한다: 한 답은 정확히 ‘그런 편이에요’, 다른 답은 정확히 ‘동의하지도 반대하지도 않아요’.
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

  it("다시 답하면 달라질 수 있다는 말은 카드마다 한 번이고, 두 사람 카드처럼 바깥에서 말하면 카드에서는 뺀다", () => {
    const drafts = [draftOf(MIXED), draftOf(SPREAD), paired(4, 3), paired(1, 1), paired(3, 3)];
    for (const draft of drafts) for (const compact of [false, true]) {
      const summary = render(draft, { compact });
      expect(summary.textContent?.split(V31_STYLE_CHANGE_NOTICE).length, summary.getAttribute("data-style-summary")!).toBe(2);
      const change = summary.querySelector("[data-change-notice]")!;
      expect(change.compareDocumentPosition(summary.querySelector("[data-code]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const outside = render(draft, { compact, showChangeNotice: false });
      expect(outside.textContent).not.toContain(V31_STYLE_CHANGE_NOTICE);
      // 아슬한 글자 안내는 그 사람의 글자에 대한 사실이라 카드에 남는다.
      expect(outside.querySelector("[data-borderline-notice]")?.textContent ?? null).toBe(buildV31StyleSummary(draft).borderlineNotice);
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
    for (const draft of drafts) for (const compact of [false, true]) {
      const summary = render(draft, { compact, onEdit: () => {} });
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
