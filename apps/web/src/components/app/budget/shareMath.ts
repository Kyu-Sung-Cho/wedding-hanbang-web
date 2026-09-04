/**
 * 비중을 보여주는 화면 둘(`BudgetShareChart`·`BudgetSideSplit`)이 같은 규칙으로
 * 반올림하고 같은 단위로 적게 한다.
 *
 * 두 화면은 같은 카드 안에 위아래로 놓인다. 한쪽이 `Math.round`, 다른 쪽이
 * 최대잔여법을 쓰면 **같은 화면에서 합이 99와 100으로 갈린다**. 예산 화면은
 * 그 사고를 이미 한 번 겪었다(`lib/budgetTotals.ts` 머리말, 2026-08-24).
 */

/** 원 단위 정수를 만원으로 적는다. 예산 화면 전체가 쓰는 단위다. */
export function formatManwon(won: number): string {
  return `${Math.round(won / 10000).toLocaleString()}만원`;
}

/**
 * 반올림해도 합이 정확히 100이 되게 비중을 나눈다(최대잔여법).
 *
 * 그냥 반올림하면 조각이 여럿일 때 합이 99나 101이 된다. 목록에 숫자가 세로로
 * 나란히 서 있어서 사용자가 눈으로 더하고, 틀린 계산으로 읽는다.
 *
 * 금액이 0보다 크지만 0.5% 가 안 되는 조각은 0을 받는다. 부르는 쪽이 그 경우를
 * `1% 미만` 으로 적는다 — 여기서 1로 올리면 합이 100을 넘는다.
 */
export function withPercents<T extends { amount: number }>(
  items: readonly T[],
  total: number,
): (T & { percent: number })[] {
  if (total <= 0) return items.map((item) => ({ ...item, percent: 0 }));

  const exact = items.map((item) => (item.amount / total) * 100);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);

  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const { index } of byFraction) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }

  return items.map((item, index) => ({ ...item, percent: floors[index] }));
}

/** 비중 한 칸에 적을 글자. 0% 로 적으면 "안 썼다" 로 읽히므로 갈라 준다. */
export function formatPercentCell(percent: number, amount: number): string {
  return percent === 0 && amount > 0 ? "1% 미만" : `${percent}%`;
}
