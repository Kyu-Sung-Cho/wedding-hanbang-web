import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V05_QUESTIONS } from "@/constants/weddingCodeV05";
import { toWeddingCodeV05Answers } from "../answers";

describe("WeddingCode candidate.10 answer parsing", () => {
  it("keeps only current question keys with A-B values", () => {
    const parsed = toWeddingCodeV05Answers({
      A1: "A",
      A2: "C",
      B1: "B",
      unknown: "A",
      C1: 1,
    });

    expect(parsed).toEqual({ A1: "A", B1: "B" });
  });

  it("returns an empty object for non-record input", () => {
    expect(toWeddingCodeV05Answers(null)).toEqual({});
    expect(toWeddingCodeV05Answers(["A"])).toEqual({});
  });

  it("accepts a complete v0.5 answer set", () => {
    const parsed = toWeddingCodeV05Answers(
      Object.fromEntries(WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, "B"]))
    );

    expect(Object.keys(parsed)).toHaveLength(16);
  });
});

