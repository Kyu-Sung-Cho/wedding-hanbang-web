import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V05_QUESTIONS } from "@/constants/weddingCodeV05";
import { toWeddingCodeV05Answers } from "../answers";

describe("WeddingCode v0.5 answer parsing", () => {
  it("keeps only v0.5 question keys with A-D values", () => {
    const parsed = toWeddingCodeV05Answers({
      A1: "A",
      A2: "E",
      B1: "D",
      unknown: "A",
      C1: 1,
    });

    expect(parsed).toEqual({ A1: "A", B1: "D" });
  });

  it("returns an empty object for non-record input", () => {
    expect(toWeddingCodeV05Answers(null)).toEqual({});
    expect(toWeddingCodeV05Answers(["A"])).toEqual({});
  });

  it("accepts a complete v0.5 answer set", () => {
    const parsed = toWeddingCodeV05Answers(
      Object.fromEntries(WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, "C"]))
    );

    expect(Object.keys(parsed)).toHaveLength(16);
  });
});

