import assert from "node:assert/strict";
import { test } from "node:test";

import {
  foldPayerSides,
  formatManwon,
  formatWonExact,
  formatPercentCell,
  withPercents,
} from "../budgetShare.mjs";

test("비중의 합은 조각이 몇 개든 정확히 100이다", () => {
  const cases = [
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
    assert.equal(sum, 100, `합이 100이 아님: ${JSON.stringify(amounts)}`);
  }
});

test("남는 1%는 소수부가 가장 큰 조각이 먼저 받는다", () => {
  const rows = withPercents([{ amount: 34 }, { amount: 33 }, { amount: 33 }], 100);
  assert.deepEqual(rows.map((row) => row.percent), [34, 33, 33]);
});

test("총액이 0이면 0으로 나누지 않고 전부 0을 준다", () => {
  assert.deepEqual(
    withPercents([{ amount: 0 }, { amount: 0 }], 0).map((row) => row.percent),
    [0, 0],
  );
});

test("원래 필드는 그대로 남는다 — 비중만 얹는다", () => {
  const rows = withPercents([{ key: "venue", label: "예식장", amount: 10 }], 10);
  assert.equal(rows[0].key, "venue");
  assert.equal(rows[0].label, "예식장");
  assert.equal(rows[0].percent, 100);
});

test("금액이 있는데 0%로 내림된 조각은 `1% 미만`으로 적는다", () => {
  // 여기서 1로 올리면 합이 100을 넘는다. 그래서 숫자가 아니라 말로 적는다.
  assert.equal(formatPercentCell(0, 20_000), "1% 미만");
  assert.equal(formatPercentCell(0, 0), "0%");
  assert.equal(formatPercentCell(41, 18_000_000), "41%");
});

test("금액은 만원 단위로 적는다", () => {
  assert.equal(formatManwon(18_000_000), "1,800만원");
  assert.equal(formatManwon(0), "0만원");
});

test("저장한 예산과 기록 지출은 소액·억 단위도 원 단위를 그대로 표시한다", () => {
  for (const [amount, label] of [
    [0, "0원"], [-0, "0원"], [1, "1원"], [5_000, "5,000원"],
    [14_999, "14,999원"], [5_995_000, "5,995,000원"],
    [100_001_000, "100,001,000원"], [30_000_000, "3,000만원"],
  ]) assert.equal(formatWonExact(amount), label);
});

test("잘못된 원 단위 값을 정상 금액으로 표시하지 않는다", () => {
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatWonExact(amount), RangeError);
  }
});

test("분담 네 값이 세 기둥으로 접힌다", () => {
  const sides = foldPayerSides({
    couple: 10,
    bride_parents: 20,
    groom_parents: 30,
    both_parents: 40,
  });
  assert.deepEqual(sides, { brideSide: 20, groomSide: 30, shared: 50 });
});

test("접어도 총액은 그대로다 — 어느 기둥에도 안 든 값이 없다", () => {
  const summary = { couple: 7, bride_parents: 11, groom_parents: 13, both_parents: 17 };
  const sides = foldPayerSides(summary);
  const before = Object.values(summary).reduce((sum, value) => sum + value, 0);
  const after = sides.brideSide + sides.groomSide + sides.shared;
  assert.equal(after, before);
});

test("없는 값·음수·숫자가 아닌 것은 0으로 센다", () => {
  assert.deepEqual(
    foldPayerSides({ bride_parents: -5, groom_parents: "10", both_parents: NaN }),
    { brideSide: 0, groomSide: 0, shared: 0 },
  );
  assert.deepEqual(foldPayerSides(undefined), { brideSide: 0, groomSide: 0, shared: 0 });
});

test("모르는 분담 값은 어느 기둥에도 안 든다", () => {
  // 새 `payer` 값은 DB 트리거가 거절하므로 화면에 도달할 수 없다. 혹시 들어와도
  // 조용히 어느 한쪽에 얹히면 안 된다 — 합이 틀린 채로 그려진다.
  const sides = foldPayerSides({ couple: 10, bride: 999 });
  assert.deepEqual(sides, { brideSide: 0, groomSide: 0, shared: 10 });
});
