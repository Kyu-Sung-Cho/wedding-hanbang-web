/**
 * 「255월 후」 같은 글자가 다시 나오지 않게 하는 계약.
 *
 * 요점은 하나다 — **단위는 값에서 나온다.** 부르는 쪽이 단위를 고를 수 없으면
 * 날짜 수 옆에 월 단위가 붙는 조합 자체가 만들어지지 않는다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { formatKoreanDayCount, formatKoreanRelativeDays } from "../koreanDuration.mjs";

test("60일 미만은 날짜 수 그대로", () => {
  assert.equal(formatKoreanDayCount(0), "0일");
  assert.equal(formatKoreanDayCount(1), "1일");
  assert.equal(formatKoreanDayCount(19), "19일");
  assert.equal(formatKoreanDayCount(59), "59일");
});

test("60일부터는 개월로 바꾸고 숫자도 함께 바뀐다", () => {
  assert.equal(formatKoreanDayCount(60), "약 2개월");
  assert.equal(formatKoreanDayCount(255), "약 9개월");
  assert.equal(formatKoreanDayCount(364), "약 12개월");
});

test("1년을 넘으면 연도를 앞에 세운다", () => {
  assert.equal(formatKoreanDayCount(365), "약 1년");
  assert.equal(formatKoreanDayCount(430), "약 1년 2개월");
  assert.equal(formatKoreanDayCount(730), "약 2년");
});

test("개월이 12로 반올림되면 한 해로 올린다", () => {
  // 365 + 355 = 720. 355/30 은 12로 반올림된다. 「약 1년 12개월」 이 나오면 안 된다.
  assert.equal(formatKoreanDayCount(720), "약 2년");
});

test("날짜 수 옆에 월 단위가 붙는 조합은 만들어질 수 없다", () => {
  // 255 는 날짜 수다. 어떤 입력에서도 그 숫자가 월 단위와 함께 나오면 안 된다.
  for (const days of [61, 90, 128, 255, 300, 364, 365, 500, 999, 5000]) {
    const label = formatKoreanDayCount(days);
    assert.equal(
      label.includes(`${days}개월`) || label.includes(`${days}월`),
      false,
      `${days}일이 월 단위로 나왔습니다: ${label}`,
    );
  }
});

test("크기만 말하고 방향은 말하지 않는다", () => {
  assert.equal(formatKoreanDayCount(-19), "19일");
  assert.equal(formatKoreanDayCount(-255), "약 9개월");
});

test("숫자가 아니면 빈 문자열", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "12"]) {
    assert.equal(formatKoreanDayCount(value), "");
    assert.equal(formatKoreanRelativeDays(value), "");
  }
});

test("오늘·내일·어제는 숫자로 말하지 않는다", () => {
  assert.equal(formatKoreanRelativeDays(0), "오늘");
  assert.equal(formatKoreanRelativeDays(1), "내일");
  assert.equal(formatKoreanRelativeDays(-1), "어제");
});

test("앞뒤가 붙어도 단위는 값에서 나온다", () => {
  assert.equal(formatKoreanRelativeDays(8), "8일 후");
  assert.equal(formatKoreanRelativeDays(-8), "8일 전");
  assert.equal(formatKoreanRelativeDays(255), "약 9개월 후");
  assert.equal(formatKoreanRelativeDays(-255), "약 9개월 전");
  assert.equal(formatKoreanRelativeDays(430), "약 1년 2개월 후");
});
