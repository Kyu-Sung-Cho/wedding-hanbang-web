import { describe, expect, it } from "vitest";
import { storedMoneyToWon } from "@hanbang/shared";

describe("persisted wedding money unit", () => {
  it.each([10_000, 50_000, 90_000, 100_000])(
    "keeps ₩%i in won instead of guessing that it is 만원",
    (won) => expect(storedMoneyToWon(won)).toBe(won)
  );

  it("accepts serialized numbers and rejects invalid values", () => {
    expect(storedMoneyToWon("50000")).toBe(50_000);
    expect(storedMoneyToWon("not-money")).toBe(0);
    expect(storedMoneyToWon(-1)).toBe(0);
  });
});
