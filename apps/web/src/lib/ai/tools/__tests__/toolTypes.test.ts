import { describe, expect, it } from "vitest";

import { formatWon } from "../toolTypes";

describe("formatWon", () => {
  it.each([
    [0, "0원"],
    [4_999, "4,999원"],
    [5_000, "5,000원"],
    [10_000, "1만원"],
    [15_000, "15,000원"],
    [800_000, "80만원"],
  ] as const)("formats %i without changing its value", (amount, expected) => {
    expect(formatWon(amount)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1])(
    "rejects an invalid won amount: %s",
    (amount) => {
      expect(() => formatWon(amount)).toThrow("non-negative safe integers");
    },
  );

  it("normalizes negative zero", () => {
    expect(formatWon(-0)).toBe("0원");
  });
});
