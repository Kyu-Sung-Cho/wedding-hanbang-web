import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { click, createHarness } from "@/components/wedding-code/v40/inputTestKit";
import { ITEMS } from "@/lib/weddingCode/likert/bank";
import { buildComparison, buildResult } from "@/lib/weddingCode/likert/model";
import { CHARACTERS } from "@/lib/weddingCode/likert/characters";
import { LETTER_DEFINITIONS, type Answer, type Answers } from "@/lib/weddingCode/likert/types";
import PersonalReport from "./PersonalReport";
import CoupleReport from "./CoupleReport";

const noop = () => {};
function all(answer: Answer): Answers {
  return Object.fromEntries(ITEMS.map(item => [item.id, { ...answer }]));
}
function view(html: string): HTMLDivElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

describe("원답과 공개 결과의 의미", () => {
  it("같은 CJOL의 장면별 부탁 차이가 개인 화면과 선택한 커플 장면에 연결된다", async () => {
    const first: Answers = Object.fromEntries(ITEMS.map(item => [item.id, { status: "rated", value: ["C", "J", "O", "L"].includes(item.facet) ? 5 : 1 }]));
    const second: Answers = { ...first,
      "likert.support.contact.L.v1": { status: "rated", value: 1 },
      "likert.support.contact.A.v1": { status: "rated", value: 5 },
      "likert.support.contact.alone-rest.v1": { status: "rated", value: 5 },
    };
    for (const [answers, listens] of [[first, true], [second, false]] as const) {
      const result = buildResult(answers);
      expect(result.character?.name).toBe("세심한 수달");
      const content = view(renderToStaticMarkup(<PersonalReport result={result} onEdit={noop} onShare={noop} />));
      const contact = content.querySelector('#personal-support [data-scene-reading="likert.support.contact.v1"]');
      const request = contact?.querySelector("blockquote")?.textContent;
      expect(contact?.textContent).toContain("관찰한 응답");
      expect(contact?.textContent).toContain("이렇게 읽어 볼 수 있어요");
      expect(contact?.textContent).toContain("이 읽기를 만든 질문과 내 응답");
      expect(contact?.textContent).toContain("내가 확인해 볼 점");
      expect(request?.includes("내 이야기 경청")).toBe(listens);
      expect(request?.includes("업체 답변 메모 정리")).toBe(!listens);
      expect(request?.includes("잠시 혼자 쉴 시간")).toBe(!listens);
      expect(contact?.textContent).not.toMatch(/회피|감정 상담|위로/);
    }
    const rendered = createHarness();
    try {
      await rendered.render(<CoupleReport result={buildComparison(first, second)} onBack={noop} />);
      await click([...rendered.container.querySelectorAll("button")].find(button => button.textContent?.includes("대화와 실무 도움")));
      const select = rendered.container.querySelector<HTMLSelectElement>("#couple-scene");
      if (!select) throw new Error("장면 선택 요소가 없어요");
      await act(async () => { select.value = "likert.support.contact.v1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
      const contact = rendered.container.querySelector('[data-couple-scene-reading="likert.support.contact.v1"]');
      expect(contact?.textContent).toContain("다른 칸 3개");
      const requests = contact?.querySelectorAll("blockquote");
      expect(requests).toHaveLength(2);
      expect(requests?.[0]?.textContent).toContain("내 이야기 경청");
      expect(requests?.[0]?.textContent).not.toContain("메모 정리");
      expect(requests?.[1]?.textContent).toContain("업체 답변 메모 정리");
      expect(requests?.[1]?.textContent).toContain("잠시 혼자 쉴 시간");
      expect(requests?.[1]?.textContent).not.toContain("내 이야기 경청");
      expect(contact?.textContent).toContain("업체 연락을 마친 지금은 상대가 내 이야기를 들어 줬으면 좋겠다.");
      expect(contact?.textContent).toContain("업체 연락을 마친 지금은 상대가 업체 답변 메모를 정리해 줬으면 좋겠다.");
    } finally { await rendered.unmount(); }
  });

  it("캐릭터 설명이 바라는 응답을 실제 수행이나 도움 수령으로 바꾸지 않는다", () => {
    expect(CHARACTERS.every(character => character.tagline.includes("대표 표"))).toBe(true);
    expect(CHARACTERS.some(character => character.tagline.includes("도움을 받는 장면"))).toBe(false);
  });
  it("L5의 사실 전달 요청을 감정이나 고민으로 좁히지 않는다", () => {
    expect(LETTER_DEFINITIONS.L.definition).toBe("준비 직후 상대가 내 이야기를 들어주는 도움을 받고 싶은 마음");
    const answers = all({ status: "rated", value: 1 });
    for (const item of ITEMS.filter(entry => entry.facet === "L")) answers[item.id] = { status: "rated", value: 5 };
    const html = renderToStaticMarkup(<PersonalReport result={buildResult(answers)} onEdit={noop} onShare={noop} />);
    expect(html).toContain(LETTER_DEFINITIONS.L.definition);
    expect(html).not.toContain("내가 느끼거나 고민한");
  });

  it("C와 E 모두 동의한 세 장면은 독립적인 100% 두 개와 3/3 근거로 보인다", () => {
    const answers = all({ status: "rated", value: 3 });
    for (const item of ITEMS.filter(entry => entry.domain === "money")) {
      answers[item.id] = { status: "rated", value: item.facet === "C" ? 5 : 4 };
    }
    const content = view(renderToStaticMarkup(<PersonalReport result={buildResult(answers)} onEdit={noop} onShare={noop} />));
    const percentages = content.querySelectorAll('[aria-label="동의한 응답 비율"]');
    expect([...percentages].filter(entry => entry.textContent?.includes("100%") && entry.textContent.includes("3/3"))).toHaveLength(2);
    expect(content.textContent).toContain("두 비율의 합이 100%일 필요는 없어요");
    expect(content.textContent).toContain("대표 글자는 별도로");
  });

  it("답이 없는 도움 장면을 없음이나 일인칭 부탁으로 만들어내지 않는다", () => {
    const content = view(renderToStaticMarkup(<PersonalReport result={buildResult(all({ status: "unknown" }))} onEdit={noop} onShare={noop} />));
    const support = content.querySelector("#personal-support");
    expect(support?.textContent).toContain("아직 확인하지 않은 응답");
    expect(support?.textContent).not.toContain("이 장면에서는 없음");
    expect(support?.querySelectorAll("blockquote")).toHaveLength(0);
    expect(content.textContent).toContain("비율을 계산할 응답 없음");
  });

  it("순환 소수는 설명대로 정수로 표시하고 실제 분자와 분모는 보존한다", () => {
    const answers = all({ status: "rated", value: 1 });
    answers["likert.money.venue.C.v1"] = { status: "rated", value: 4 };
    const content = view(renderToStaticMarkup(<PersonalReport result={buildResult(answers)} onEdit={noop} onShare={noop} />));
    const ratios = [...content.querySelectorAll('[aria-label="동의한 응답 비율"]')];
    expect(ratios.some(entry => entry.textContent?.includes("33%") && entry.textContent.includes("1/3"))).toBe(true);
    expect(content.textContent).not.toContain("33.333");
  });

  it("첫 문항이 같아도 같은 장면의 다음 문항 차이가 첫 대화에 남는다", () => {
    const first = all({ status: "rated", value: 5 });
    const second = all({ status: "rated", value: 5 });
    const item = ITEMS.find(entry => entry.id === "likert.money.venue.E.v1");
    if (!item) throw new Error("Fixture item missing");
    second[item.id] = { status: "rated", value: 1 };
    const content = view(renderToStaticMarkup(<CoupleReport result={buildComparison(first, second)} onBack={noop} />));
    const discussion = content.querySelector('[aria-label="이 장면에서 함께 확인할 응답"]');
    expect(discussion?.textContent).toContain(item.text);
    expect(discussion?.textContent).toContain("5 · 매우 그렇다");
    expect(discussion?.textContent).toContain("1 · 전혀 그렇지 않다");
    expect(discussion?.textContent).toContain("동의한 이유와 동의하지 않은 이유");
  });
});
