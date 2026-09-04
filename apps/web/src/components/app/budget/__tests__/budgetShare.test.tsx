// @vitest-environment jsdom

/**
 * 항목별 비중(도넛)과 양측 분담이 **숫자로 거짓말하지 않는지** 본다.
 *
 * 이 두 화면은 사용자가 눈으로 더하기 쉬운 자리다. 비중이 세로로 줄지어 있고 금액이
 * 그 옆에 있다. 합이 99나 101이면 계산이 틀린 것으로 읽히고, 금액이 있는데 조각이
 * 안 보이면 없어진 것으로 읽힌다. 그 둘을 못 박는다.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import BudgetShareChart from "../BudgetShareChart";
import BudgetSideSplit from "../BudgetSideSplit";
import { formatPercentCell, withPercents } from "../shareMath";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("withPercents", () => {
  it("조각이 몇 개든 비중의 합이 정확히 100이다", () => {
    const cases: number[][] = [
      [1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [100, 33, 33, 33],
      [18_000_000, 9_500_000, 6_200_000, 4_100_000, 3_300_000, 900_000, 700_000, 87_000],
      [999_999, 1],
      [7],
    ];

    for (const amounts of cases) {
      const total = amounts.reduce((sum, value) => sum + value, 0);
      const rows = withPercents(amounts.map((amount) => ({ amount })), total);
      const sum = rows.reduce((acc, row) => acc + row.percent, 0);
      expect(sum, `합이 100이 아님: ${JSON.stringify(amounts)}`).toBe(100);
    }
  });

  it("큰 나머지를 가진 조각이 남는 1%를 먼저 받는다", () => {
    // 셋 다 정확히 33.33…% 이므로 내림하면 99가 되고 1이 남는다.
    // 남은 1은 소수부가 가장 큰 조각(= 금액이 가장 큰 조각)이 받아야 한다.
    const rows = withPercents(
      [{ amount: 34 }, { amount: 33 }, { amount: 33 }],
      100,
    );
    expect(rows.map((row) => row.percent)).toEqual([34, 33, 33]);
  });

  it("총액이 0이면 모두 0이다 — 0으로 나누지 않는다", () => {
    const rows = withPercents([{ amount: 0 }, { amount: 0 }], 0);
    expect(rows.every((row) => row.percent === 0)).toBe(true);
  });
});

describe("formatPercentCell", () => {
  it("금액이 있는데 0%로 내림된 조각은 `1% 미만`으로 적는다", () => {
    // 여기서 1로 올리면 합이 100을 넘는다. 그래서 숫자가 아니라 말로 적는다.
    expect(formatPercentCell(0, 20_000)).toBe("1% 미만");
  });

  it("금액이 0이면 그냥 0%다", () => {
    expect(formatPercentCell(0, 0)).toBe("0%");
  });
});

function render(node: React.ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

describe("BudgetShareChart", () => {
  let mounted: { container: HTMLDivElement; root: Root } | null = null;

  afterEach(() => {
    if (mounted) {
      const { container, root } = mounted;
      act(() => root.unmount());
      container.remove();
      mounted = null;
    }
  });

  const many = Array.from({ length: 11 }, (_, index) => ({
    key: `k${index}`,
    label: `항목${index}`,
    amount: (11 - index) * 1_000_000,
  }));

  it("이름 있는 조각은 일곱까지고 나머지는 `기타`로 묶인다", () => {
    mounted = render(<BudgetShareChart slices={many} basis="spent" />);
    const rows = mounted.container.querySelectorAll("li");
    expect(rows).toHaveLength(8);
    expect(rows[7]?.textContent).toContain("기타 4개");
  });

  it("`기타` 조각의 금액은 묶인 항목들의 합이다", () => {
    mounted = render(<BudgetShareChart slices={many} basis="spent" />);
    const rest = many.slice(7).reduce((sum, slice) => sum + slice.amount, 0);
    const rows = mounted.container.querySelectorAll("li");
    expect(rows[7]?.textContent).toContain(
      `${Math.round(rest / 10000).toLocaleString()}만원`,
    );
  });

  it("금액이 0인 항목은 목록에도 도넛에도 나오지 않는다", () => {
    mounted = render(
      <BudgetShareChart
        slices={[
          { key: "a", label: "예식장", amount: 1_000_000 },
          { key: "b", label: "안 쓴 항목", amount: 0 },
        ]}
        basis="spent"
      />,
    );
    expect(mounted.container.textContent).not.toContain("안 쓴 항목");
    expect(mounted.container.querySelectorAll("li")).toHaveLength(1);
  });

  it("셀 것이 하나도 없으면 카드 자체가 나오지 않는다", () => {
    mounted = render(
      <BudgetShareChart slices={[{ key: "a", label: "예식장", amount: 0 }]} basis="spent" />,
    );
    expect(mounted.container.innerHTML).toBe("");
  });

  it("`기타` 색은 이름 있는 일곱 색 어느 것과도 다르다", () => {
    // 2026-09-04 실측에서 `기타`(#8F8A7A)와 다섯째 조각(#A2937F)의 점이
    // 375px 목록에서 구별되지 않았다. 색이 겹치면 목록과 도넛을 짝지을 수 없다.
    mounted = render(<BudgetShareChart slices={many} basis="spent" />);
    const dots = Array.from(
      mounted.container.querySelectorAll<HTMLElement>("li span[aria-hidden='true']"),
    ).map((dot) => dot.style.backgroundColor);

    expect(dots).toHaveLength(8);
    expect(new Set(dots).size).toBe(8);
  });

  it("각 조각은 앞 조각들의 길이만큼 밀려 시작한다 — 겹치거나 벌어지지 않는다", () => {
    // 누적 변수를 쓰던 것을 순수 계산으로 바꿨다(`react-hooks/immutability` 가
    // 렌더 중 바깥 변수 재할당을 막는다). 눈으로 도넛을 보는 대신 시작점을 숫자로
    // 잰다 — 밀리는 양이 하나라도 틀리면 조각이 겹치거나 빈 자리가 생긴다.
    const circumference = 2 * Math.PI * 48;
    mounted = render(
      <BudgetShareChart
        slices={[
          { key: "a", label: "가", amount: 50 },
          { key: "b", label: "나", amount: 30 },
          { key: "c", label: "다", amount: 20 },
        ]}
        basis="spent"
      />,
    );

    const offsets = Array.from(mounted.container.querySelectorAll("circle"))
      // 첫 원은 배경 트랙이라 dashoffset 이 없다.
      .filter((circle) => circle.hasAttribute("stroke-dashoffset"))
      .map((circle) => Number(circle.getAttribute("stroke-dashoffset")));

    expect(offsets).toHaveLength(3);
    expect(offsets[0]).toBeCloseTo(0, 5);
    expect(offsets[1]).toBeCloseTo(-circumference * 0.5, 5);
    expect(offsets[2]).toBeCloseTo(-circumference * 0.8, 5);
  });

  it("기록 지출이 없을 때는 배정 예산으로 그린다고 화면이 말한다", () => {
    mounted = render(
      <BudgetShareChart slices={[{ key: "a", label: "예식장", amount: 5_000_000 }]} basis="budget" />,
    );
    expect(mounted.container.textContent).toContain("배정 예산");
    expect(mounted.container.textContent).not.toContain("기록 지출");
  });
});

describe("BudgetSideSplit", () => {
  let mounted: { container: HTMLDivElement; root: Root } | null = null;

  afterEach(() => {
    if (mounted) {
      const { container, root } = mounted;
      act(() => root.unmount());
      container.remove();
      mounted = null;
    }
  });

  it("세 기둥의 비중 합이 100이다", () => {
    mounted = render(
      <BudgetSideSplit brideSide={12_000_000} groomSide={9_400_000} shared={22_170_000} />,
    );
    const percents = Array.from(mounted.container.querySelectorAll("li"))
      .map((row) => Number(row.textContent?.match(/(\d+)%/)?.[1] ?? "0"));
    expect(percents).toHaveLength(3);
    expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it("`함께` 가 어느 쪽으로도 세어지지 않았다고 화면에 적는다", () => {
    // 이 문장이 없으면 신부 측 27% / 신랑 측 22% 를 보고 "합이 49밖에 안 된다" 로
    // 읽는다. 나머지 51%가 어디 갔는지는 화면이 말해야 한다.
    mounted = render(
      <BudgetSideSplit brideSide={12_000_000} groomSide={9_400_000} shared={22_170_000} />,
    );
    expect(mounted.container.textContent).toContain("어느 한쪽으로 세지 않았어요");
  });

  it("아무 지출도 없으면 나오지 않는다", () => {
    mounted = render(<BudgetSideSplit brideSide={0} groomSide={0} shared={0} />);
    expect(mounted.container.innerHTML).toBe("");
  });

  it("금액이 있는 기둥은 막대에도 자리를 갖는다", () => {
    // 비중이 0%로 내림돼도 막대에서 사라지면 안 된다 — 목록엔 금액이 남는다.
    mounted = render(
      <BudgetSideSplit brideSide={1_000} groomSide={5_000_000} shared={5_000_000} />,
    );
    const segments = mounted.container.querySelectorAll<HTMLElement>("[data-side]");
    expect(segments).toHaveLength(3);
    expect(Number.parseFloat(segments[0]!.style.width)).toBeGreaterThan(0);
  });
});
