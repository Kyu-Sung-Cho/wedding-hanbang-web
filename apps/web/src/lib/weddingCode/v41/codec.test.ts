import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V41_VERSION } from "@/constants/weddingCodeV41";
import { WEDDING_CODE_V40_BANK } from "../v40/bank";
import { decodeCode as decodeV40, encodeCode as encodeV40 } from "../v40/codec";
import { decodeGuessCode as decodeV40GuessCode, encodeGuessCode as encodeV40GuessCode } from "../v40/guess/guessLink";
import type { GuessAnswers } from "../v40/guess/types";
import { fixtureByName } from "../v40/fixtures";
import { WEDDING_CODE_V41_BANK } from "./bank";
import { buildGatedShareUrl, buildGatedShareUrlWithGuess, buildQuestionOnlyUrl, decodeCode, decodeGuessCode, encodeCode, encodeGuessCode } from "./codec";

const guess: GuessAnswers = { set: "1", slots: [{ self: 0, guess: 1 }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }] };

describe("v4.1 exact-version 링크 코드", () => {
  const fixture = fixtureByName("swua-example");
  if (!fixture) throw new Error("fixture missing");

  it("새 코드만 2/3으로 시작하고 v4.0 코드와 양방향으로 섞이지 않는다", () => {
    for (const formBit of [0, 1] as const) {
      const oldCode = encodeV40(WEDDING_CODE_V40_BANK, formBit, fixture.responses);
      const newCode = encodeCode(WEDDING_CODE_V41_BANK, formBit, fixture.responses);
      expect(oldCode?.[0]).toBe(String(formBit));
      expect(newCode?.[0]).toBe(String(formBit + 2));
      expect(newCode).toHaveLength(70);
      expect(decodeCode(WEDDING_CODE_V41_BANK, newCode)).toEqual({ formBit, responses: fixture.responses });
      expect(decodeCode(WEDDING_CODE_V41_BANK, oldCode)).toBeNull();
      expect(decodeV40(WEDDING_CODE_V40_BANK, newCode)).toBeNull();
    }
  });

  it("교차 판 URL은 v만 바꾸어도 열리지 않는다", () => {
    const person = { formBit: fixture.formBit, responses: fixture.responses };
    const newUrl = buildGatedShareUrl(WEDDING_CODE_V41_BANK, "https://hanbang.ai", person);
    const oldCode = encodeV40(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
    expect(newUrl).toContain(`#v=${WEDDING_CODE_V41_VERSION}&a=`);
    expect(newUrl?.split("#")[0]).toBe("https://hanbang.ai/wedding-code");
    expect(decodeCode(WEDDING_CODE_V41_BANK, oldCode)).toBeNull();
    expect(buildQuestionOnlyUrl("https://hanbang.ai")).toBe(`https://hanbang.ai/wedding-code?v=${WEDDING_CODE_V41_VERSION}`);
    expect(buildQuestionOnlyUrl("https://hanbang.ai", { explicitVersion: false })).toBe(`https://hanbang.ai/wedding-code?v=${WEDDING_CODE_V41_VERSION}`);
    expect(buildQuestionOnlyUrl("https://hanbang.ai")).not.toContain(WEDDING_CODE_V40_VERSION);
  });

  it("ga/gb도 판별 글자가 달라 다른 판으로 옮길 수 없다", () => {
    const oldCode = encodeV40GuessCode(guess);
    const newCode = encodeGuessCode(guess);
    expect(oldCode?.[0]).toBe("1");
    expect(newCode?.[0]).toBe("2");
    expect(decodeGuessCode(newCode)).toEqual(guess);
    expect(decodeGuessCode(oldCode)).toBeNull();
    expect(decodeV40GuessCode(newCode)).toBeNull();
    const person = { formBit: fixture.formBit, responses: fixture.responses };
    const url = buildGatedShareUrlWithGuess(WEDDING_CODE_V41_BANK, "https://hanbang.ai", { code: person, guess });
    expect(url).toContain(`&ga=${newCode}`);
    expect(url).not.toContain(`&ga=${oldCode}`);
  });
});
