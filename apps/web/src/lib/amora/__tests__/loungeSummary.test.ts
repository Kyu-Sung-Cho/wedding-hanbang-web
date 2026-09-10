import { describe, expect, it } from "vitest";
import { formatLoungeBudgetRatio, formatLoungeWon, getLoungeSetupGuidance } from "../loungeSummary";

describe("라운지의 정확한 금액·비율·미입력 안내", () => {
  it.each([
    [0, "0원"], [1, "1원"], [9_999, "9,999원"], [10_000, "1만원"],
    [123_000, "12만3,000원"], [35_000_000, "3,500만원"], [34_877_000, "3,487만7,000원"],
    [-1, "금액 확인 필요"], [1.5, "금액 확인 필요"], [Infinity, "금액 확인 필요"],
  ])("금액 %s를 손실 없이 표시한다", (value, expected) => {
    expect(formatLoungeWon(value)).toBe(expected);
  });

  it.each([
    [0, 35_000_000, "0%"], [1, 35_000_000, "0.1% 미만"], [123_000, 35_000_000, "약 0.4%"],
    [25_000, 100_000, "25%"], [100_001, 100_000, "약 100%"], [120_000, 100_000, "120%"],
    [10_000, 0, "비율 계산 전"], [-1, 100_000, "비율 계산 전"], [Infinity, 100_000, "비율 계산 전"],
  ])("지출 %s / 총액 %s의 비율을 표시한다", (spent, total, expected) => {
    expect(formatLoungeBudgetRatio(spent, total)).toBe(expected);
  });

  it("없는 날짜와 예산만 안내하고 잘못된 달력 날짜를 입력된 값으로 인정하지 않는다", () => {
    expect(getLoungeSetupGuidance("2026-12-20", 35_000_000)).toBeNull();
    expect(getLoungeSetupGuidance("2026-02-30", 35_000_000)).toMatchObject({ needsDate: true, needsBudget: false });
    expect(getLoungeSetupGuidance("2026-12-20", 0)).toMatchObject({ needsDate: false, needsBudget: true });
    expect(getLoungeSetupGuidance(null, 0)).toMatchObject({ needsDate: true, needsBudget: true });
  });
});
