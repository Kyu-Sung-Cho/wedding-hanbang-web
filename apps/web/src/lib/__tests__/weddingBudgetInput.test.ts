import { describe, expect, it } from "vitest";
import { parseWeddingBudgetManwonInput } from "../weddingBudget";

describe("exact positive wedding budget input in 만원", () => {
  it.each([
    ["0.0001", 1], ["3300", 33_000_000], ["3300.1234", 33_001_234],
    ["3,300.1234", 33_001_234], [" 0001.0001 ", 10_001],
    ["100000", 1_000_000_000], ["100,000.0000", 1_000_000_000],
  ])("parses %s without dropping or rounding a won", (input, expected) => {
    expect(parseWeddingBudgetManwonInput(input)).toBe(expected);
  });

  it.each(["", " ", "0", "-1", "100000.0001", "0.00001", "3300.12345", "1e5", "Infinity", "1abc", "33,00", "1,00,000", "99999999999999999999999999999999999999999"])("rejects %s before a save request", (input) => {
    expect(parseWeddingBudgetManwonInput(input)).toBeNull();
  });
});
