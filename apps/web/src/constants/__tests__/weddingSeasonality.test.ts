import { describe, expect, it } from "vitest";
import { getWeddingSeason } from "../weddingSeasonality";

describe("wedding seasonality", () => {
  it.each([
    [1, "off_peak"],
    [2, "off_peak"],
    [3, "off_peak"],
    [4, "peak"],
    [5, "peak"],
    [6, "peak"],
    [7, "off_peak"],
    [8, "off_peak"],
    [9, "peak"],
    [10, "peak"],
    [11, "peak"],
    [12, "off_peak"],
  ] as const)("classifies month %i as %s", (month, expected) => {
    expect(getWeddingSeason(month)).toBe(expected);
  });
});
