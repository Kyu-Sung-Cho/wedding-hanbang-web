import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerDistribution, AxisAnswerEvidence, CoupleFacetContrast, FacetBreakdown, answerPercent, coupleFacetContrast, tieReason } from "./AnswerEvidence";
import { resultCase } from "./resultTestKit";
import type { CoupleAxisRow } from "@/lib/weddingCode/v40/types";

describe("웨딩코드 v4 응답 방향 비율", () => {
  it("분모가 없으면 비율을 만들지 않는다", () => {
    expect(answerPercent(0, 0)).toBeNull();
    const html = renderToStaticMarkup(<AnswerDistribution axis="money" counts={{ answered: 0, frontCount: 0, backCount: 0, neutralCount: 0 }} />);
    expect(html).toContain("답한 0 / 16문항");
    expect(html).toContain("비율에서 뺀 답 16문항");
    expect(html).toContain("비율을 내지 않았어요");
    expect(html).not.toContain("0%");
    expect(html).not.toContain("data-answer-tiles");
  });

  it("앞, 뒤, 중립 응답을 실제 응답 수로 나눠 표시한다", () => {
    const html = renderToStaticMarkup(<AnswerDistribution axis="money" counts={{ answered: 16, frontCount: 9, backCount: 6, neutralCount: 1 }} />);
    expect(html).toContain("V 조건 먼저");
    expect(html).toContain("S 장면 먼저");
    expect(html).toContain("56.25%");
    expect(html).toContain("9개 / 16문항");
    expect(html).toContain("37.5%");
    expect(html).toContain("6개 / 16문항");
    expect(html).toContain("6.25%");
    expect(html).toContain("1개 / 16문항");
    expect(html).toContain("한쪽으로 기울지 않은 답");
    expect(html).toContain("답한 16 / 16문항");
    expect(html).toContain("비율에서 뺀 답 0문항");
    expect(html).toContain("소수점 둘째 자리까지 표시");
  });

  it("분모 1~16의 비율을 최대 소수 둘째 자리로 계산하고 각 방향을 합계 100에 맞춰 보정하지 않는다", () => {
    for (let answered = 1; answered <= 16; answered += 1) {
      for (let front = 0; front <= answered; front += 1) {
        for (let back = 0; back <= answered - front; back += 1) {
          const neutral = answered - front - back;
          const percentages = [front, back, neutral].map((count) => answerPercent(count, answered)!);
          expect(percentages.every((percent) => percent >= 0 && percent <= 100)).toBe(true);
          expect(Math.abs(percentages.reduce((sum, percent) => sum + percent, 0) - 100)).toBeLessThanOrEqual(0.02);
        }
      }
    }
    expect([answerPercent(7, 16), answerPercent(7, 16), answerPercent(2, 16)]).toEqual([43.75, 43.75, 12.5]);
    expect([answerPercent(1, 3), answerPercent(1, 3), answerPercent(1, 3)]).toEqual([33.33, 33.33, 33.33]);
    expect(answerPercent(-1, 16)).toBeNull();
    expect(answerPercent(17, 16)).toBeNull();
    expect(answerPercent(1, Number.POSITIVE_INFINITY)).toBeNull();
    expect(answerPercent(1.5, 16)).toBeNull();
  });

  it("막대의 칸 수와 너비는 전체 16문항이 아닌 실제 답한 문항을 분모로 삼는다", () => {
    const html = renderToStaticMarkup(<AnswerDistribution axis="money" counts={{ answered: 12, frontCount: 6, backCount: 6, neutralCount: 0 }} compact />);
    const host = document.createElement("div");
    host.innerHTML = html;
    const tiles = host.querySelector<HTMLElement>("[data-answer-tiles]");
    expect(tiles).not.toBeNull();
    expect(tiles!.className).toContain("grid-flow-col auto-cols-fr");
    expect(tiles!.children).toHaveLength(12);
    expect(tiles!.querySelectorAll('.bg-\\[var\\(--hb-action\\)\\]')).toHaveLength(6);
    expect(tiles!.querySelectorAll('.bg-\\[var\\(--hb-text-muted\\)\\]')).toHaveLength(6);
    expect(host.textContent).toContain("답한 12 / 16문항");
    expect(host.textContent).toContain("6개 / 12문항");
    expect(host.textContent?.match(/50%/g)).toHaveLength(2);
    expect(host.textContent).toContain("비율에서 뺀 답 4문항");
  });

  it("답이 하나뿐인 장면은 비율에 남기고 묶음 평균에서만 제외한다고 바로 설명한다", () => {
    const html = renderToStaticMarkup(<FacetBreakdown axis="money" facets={[{
      facet: "limit", answered: 1, frontCount: 1, backCount: 0, neutralCount: 0, counted: false, sum: 3,
    }]} />);
    expect(html).toContain("1개 / 1문항 · 100%");
    expect(html).toContain("묶음 평균 계산에서 제외");
    expect(html).toContain("동점일 때 고르기·반응 답을 비교하는 기준에는 쓰일 수 있어요");
    expect(html).not.toContain("글자 계산에서 뺐어요");
    const noAnswer = renderToStaticMarkup(<FacetBreakdown axis="money" facets={[{
      facet: "limit", answered: 0, frontCount: 0, backCount: 0, neutralCount: 0, counted: false, sum: 0,
    }]} />);
    expect(noAnswer).toContain("남긴 답이 없어 선택 비율을 내지 않았어요");
    expect(noAnswer).not.toContain("data-answer-tiles");
  });

  it("첫 두 동점 보조 기준을 실제 고르기 문항이라고 부른다", () => {
    const axis = resultCase("swua-example").result.axes[0];
    expect(tieReason({ ...axis, tieLevel: 1 })).toContain("고르기 문항에서 선택한 방향과 강도");
    expect(tieReason({ ...axis, tieLevel: 2 })).toContain("반응 문항에서 선택한 방향과 강도");
    expect(tieReason({ ...axis, tieLevel: 3 })).toContain("계산에 포함한 장면 묶음");
    for (const tieLevel of [1, 2] as const) expect(tieReason({ ...axis, tieLevel })).not.toContain("두 가지 중 고르기");
  });

  it("글자에 힘을 실은 장면은 실제 계산에 포함된 측면만 고르고, 반반인 주제는 단정하지 않는다", () => {
    const axes = resultCase("swua-example").result.axes;
    for (const axis of axes) {
      const html = renderToStaticMarkup(<AxisAnswerEvidence axis={axis} />);
      if (axis.shownBand === "even" || axis.letter === null || axis.tieLevel !== 0) {
        expect(html).not.toContain("이 글자에 힘을 실은 장면");
      } else {
        expect(html).toContain("이 글자에 힘을 실은 장면");
        expect(html).toContain("글자 계산에서 같은 쪽으로 작용했어요");
      }
    }
  });

  it("전체 글자가 같아도 장면별 다수 방향이 갈리면 각자의 실제 분모와 대화 질문을 보여 준다", () => {
    const row: CoupleAxisRow = {
      axis: "money", tag: "same", excluded: false,
      first: { letter: "V", shownBand: "lean", provisional: false, answered: 4, frontCount: 3, backCount: 1, neutralCount: 0,
        facets: [{ facet: "limit", answered: 4, frontCount: 3, backCount: 1, neutralCount: 0, counted: true }] },
      second: { letter: "V", shownBand: "lean", provisional: false, answered: 4, frontCount: 1, backCount: 3, neutralCount: 0,
        facets: [{ facet: "limit", answered: 4, frontCount: 1, backCount: 3, neutralCount: 0, counted: true }] },
    };
    expect(coupleFacetContrast(row)?.first.facet).toBe("limit");
    const html = renderToStaticMarkup(<CoupleFacetContrast row={row} perspective="second" />);
    expect(html).toContain("같은 주제 안에서 갈린 장면");
    expect(html).toContain("3개 / 4문항 · 75%");
    expect(html).toContain("상대 ·");
    expect(html).toContain("나 ·");
    expect(html).toContain("먼저 정할 금액의 선");
    expect(coupleFacetContrast({ ...row, excluded: true })).toBeNull();
    expect(coupleFacetContrast({ ...row, second: { ...row.second, facets: [{ ...row.second.facets[0], frontCount: 2, backCount: 2 }] } })).toBeNull();
    expect(coupleFacetContrast({ ...row, second: { ...row.second, facets: [{ ...row.second.facets[0], frontCount: 0, backCount: 1, neutralCount: 3 }] } })).toBeNull();
  });
});
