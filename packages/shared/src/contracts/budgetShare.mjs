/**
 * 예산 비중 — **웹과 모바일이 같은 답을 내게 하는 한 구현.**
 *
 * ## 왜 shared 인가
 *
 * 같은 예산 화면이 두 앱에 있고 둘 다 `progress[key].payer` 를 읽는다. 비중을 각자
 * 계산하면 두 화면이 같은 커플에게 다른 숫자를 말한다. 이 저장소는 그 병을 여러 번
 * 앓았다 — 웹만 고치고 모바일이 안 따라온 일(2026-08-26), 표면마다 따로 세다가 한
 * 카드 안에서 숫자가 갈린 일(2026-08-24).
 *
 * **숫자를 세는 것은 여기가 아니다.** 무엇을 합계에 넣을지는 각 화면이 정하고
 * (`lib/budgetTotals.ts` 가 그 규칙의 정본이다), 여기는 이미 정해진 금액을 받아
 * 비중으로 나누고 글자로 적기만 한다.
 */

/**
 * 반올림해도 합이 정확히 100이 되게 비중을 나눈다(최대잔여법).
 *
 * 그냥 반올림하면 조각이 여럿일 때 합이 99나 101이 된다. 두 화면 모두 비중을 세로로
 * 줄 세워 보여주기 때문에 사용자가 눈으로 더하고, 틀린 계산으로 읽는다.
 *
 * 금액이 0보다 크지만 0.5% 가 안 되는 조각은 0을 받는다. 부르는 쪽이 그 경우를
 * `1% 미만` 으로 적는다(`formatPercentCell`) — 여기서 1로 올리면 합이 100을 넘는다.
 *
 * @param {readonly {amount: number}[]} items
 * @param {number} total
 */
export function withPercents(items, total) {
  if (!(total > 0)) return items.map((item) => ({ ...item, percent: 0 }));

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

/** 원 단위 정수를 만원으로 적는다. 두 앱의 예산 화면이 쓰는 단위다. */
export function formatManwon(won) {
  return `${Math.round(won / 10000).toLocaleString()}만원`;
}

/** 배정·기록 금액은 원 단위를 반올림하지 않는다. */
export function formatWonExact(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError("Won amounts must be non-negative safe integers.");
  }
  const normalizedAmount = Object.is(amount, -0) ? 0 : amount;
  if (normalizedAmount !== 0 && normalizedAmount % 10_000 === 0) {
    return `${(normalizedAmount / 10_000).toLocaleString("ko-KR")}만원`;
  }
  return `${normalizedAmount.toLocaleString("ko-KR")}원`;
}

/** 비중 한 칸에 적을 글자. `0%` 로 적으면 "안 썼다" 로 읽히므로 갈라 준다. */
export function formatPercentCell(percent, amount) {
  return percent === 0 && amount > 0 ? "1% 미만" : `${percent}%`;
}

/**
 * 분담 네 값을 세 기둥으로 접는다.
 *
 *   신부 측 ← `bride_parents`
 *   신랑 측 ← `groom_parents`
 *   함께   ← `couple` + `both_parents`
 *
 * `couple`(두 사람의 돈)과 `both_parents`(두 가족의 돈)는 뜻이 다르지만 **어느 한쪽
 * 편이 아니라는 점이 같아서** 한 기둥에 든다. 접은 것을 펼 자리(원래의 네 칸)를 화면에
 * 함께 두어야 정보가 지워지지 않는다.
 *
 * 새 `payer` 값을 여기에 더하지 마라. 그 목록은 세 곳이 들고 있고 그중 하나가 DB
 * 트리거다(`20260802200000_journey_budget_progress_integrity.sql`) — 목록에 없는 값은
 * `COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS` 로 저장이 거절된다.
 *
 * @param {Partial<Record<string, number>>} payerSummary
 */
export function foldPayerSides(payerSummary) {
  const at = (key) => {
    const value = payerSummary?.[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    brideSide: at("bride_parents"),
    groomSide: at("groom_parents"),
    shared: at("couple") + at("both_parents"),
  };
}
