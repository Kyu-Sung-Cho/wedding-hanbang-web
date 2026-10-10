import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ITEMS21, createEmptyAnswers } from "@/lib/weddingCode/preferences21/bank";
import { buildReport } from "@/lib/weddingCode/preferences21/report";
import type { Answers, Response } from "@/lib/weddingCode/preferences21/types";
import PreferenceReport from "./PreferenceReport";

function all(response: Response): Answers {
  const answers = createEmptyAnswers();
  for (const item of ITEMS21) answers[item.id] = response;
  return answers;
}

function render(answers: Answers): HTMLDivElement {
  const node = document.createElement("div");
  node.innerHTML = renderToStaticMarkup(<PreferenceReport report={buildReport(answers)} onEdit={() => {}} />);
  return node;
}

describe("원문·원답을 근거로 읽는 21문항 결과 화면", () => {
  it("Q05·Q06은 정확한 B 상황에 있고 서로 다른 선호를 각각 읽을 수 있다", () => {
    const answers = createEmptyAnswers(); answers.Q05 = 5; answers.Q06 = 4;
    const node = render(answers);
    const groups = [...node.querySelectorAll("section")].filter((section) => section.querySelector(":scope > h3"));
    expect(groups.map((section) => section.querySelectorAll("details").length)).toEqual([4, 8, 4, 5]);
    const budget = groups[0]; const candidates = groups[1];
    expect(budget.textContent).not.toContain("예식장을 찾기 시작할 때부터");
    expect(candidates.textContent).toContain("5. 예식장을 찾기 시작할 때부터, 상대와 후보를 함께 보며 이야기하고 싶다.");
    expect(candidates.textContent).toContain("6. 예식장을 찾을 때, 내 마음에 드는 후보를 먼저 몇 곳 찾아본 뒤 상대와 이야기하고 싶다.");
    expect(candidates.textContent).toContain("내 답 · 아주 잘 맞아요");
    expect(candidates.textContent).toContain("내 답 · 대체로 맞아요");
    expect(candidates.textContent).toContain("두 사람 모두 준비할 시간이 있고");
    expect(node.textContent).toContain("함께 보는 범위와 먼저 찾아볼 범위는 이 답만으로 정할 수 없어요");
  });

  it.each([1, 3, 5] as const)("모두 %d에서도 첫 화면 핵심 선호와 전체 원답·맥락·질문·행동이 있다", (response) => {
    const node = render(all(response));
    const core = node.querySelector("section");
    expect(core?.querySelectorAll("li")).toHaveLength(4);
    expect(core?.textContent).toContain("1–5 응답 21개");
    expect(node.querySelectorAll("details")).toHaveLength(21);
    expect(node.textContent).toContain("해석이 달라질 수 있는 조건");
    expect(node.textContent).toContain("파트너와 확인할 질문");
    expect(node.textContent).toContain("이렇게 부탁해 보세요");
    expect(node.textContent).toContain("아직 이 답만으로 알 수 없는 것");
    if (response === 1) expect(core?.textContent).toContain("맞지 않는다고 답했어요");
    if (response === 3) expect(core?.textContent).toContain("반반이라고 답했어요");
    if (response === 5) expect(core?.textContent).toContain("넣고 싶다고 답했어요");
  });

  it.each(["unknown", "not-applicable", "skipped", null] as const)("모두 %s에도 수치 선호를 만들어내지 않고 일곱 결과 영역을 읽을 수 있다", (response) => {
    const node = render(all(response));
    expect(node.textContent).toContain("1–5 응답 0개");
    expect(node.textContent).toContain("네 장면에서 읽은 내 답");
    expect(node.textContent).toContain("답의 근거");
    expect(node.textContent).toContain("남긴 상태만으로 더 편한 방식을 정하지 않아요");
    expect(node.textContent).toContain("파트너와 확인");
    expect(node.textContent).toContain("해볼 일");
    expect(node.textContent).toContain("아직 이 답만으로 알 수 없는 것");
    expect(node.textContent).not.toContain("이 답에서 읽은 선호");
    expect(node.querySelectorAll("details")).toHaveLength(21);
  });

  it("함께·혼자 첫 휴식 모두 동의는 원답 두 개와 아직 모르는 조건을 함께 표시한다", () => {
    const answers = createEmptyAnswers(); answers.Q20 = 4; answers.Q21 = 5;
    const node = render(answers);
    expect(node.textContent).toContain("처음 쉬는 시간을 함께 보내는 것과 혼자 보내는 것에 모두 동의했어요");
    expect(node.textContent).toContain("어느 조건이나 순서가 편한지는 이 답만으로 정할 수 없어요");
    expect(node.textContent).toContain("문항 20 · 21");
    expect(node.textContent).not.toContain("모순된 답");
    expect(node.textContent).not.toContain("독립형");
  });

  it("가족 전체 비해당은 원답을 보존하며 관계·가치관이나 캐릭터를 확정하지 않는다", () => {
    const answers = all(4);
    answers.Q13 = "not-applicable"; answers.Q14 = "not-applicable"; answers.Q15 = "not-applicable"; answers.Q16 = "not-applicable";
    const node = render(answers);
    const family = [...node.querySelectorAll("section")].find((section) => section.querySelector("h3")?.textContent === "가족과 준비 이야기를 나눌 때");
    expect(family?.textContent).toContain("수치 응답으로 확인한 선호가 아직 없어요");
    expect(family?.querySelectorAll("details")).toHaveLength(4);
    expect(family?.textContent).not.toContain("이 답에서 읽은 선호");
    expect(node.textContent).toContain("가족 관계나 가치관을 추정하지 않았어요");
    expect(node.textContent).toContain("네 글자·16캐릭터의 연결은 아직 설계 중이에요");
  });
});
