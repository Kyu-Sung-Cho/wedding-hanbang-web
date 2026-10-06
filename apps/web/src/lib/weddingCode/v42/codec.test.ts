import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V42_VERSION } from "@/constants/weddingCodeV42";
import { WEDDING_CODE_V40_BANK } from "../v40/bank";
import { decodeCode as decodeV40, encodeCode as encodeV40 } from "../v40/codec";
import { decodeGuessCode as decodeV40GuessCode, encodeGuessCode as encodeV40GuessCode } from "../v40/guess/guessLink";
import type { GuessAnswers } from "../v40/guess/types";
import { fixtureByName } from "../v40/fixtures";
import { WEDDING_CODE_V41_BANK } from "../v41/bank";
import { decodeCode as decodeV41, encodeCode as encodeV41, decodeGuessCode as decodeV41Guess, encodeGuessCode as encodeV41Guess } from "../v41/codec";
import { WEDDING_CODE_V42_BANK } from "./bank";
import { buildGatedShareUrl, buildGatedShareUrlWithGuess, buildQuestionOnlyUrl, decodeCode, decodeGuessCode, encodeCode, encodeGuessCode } from "./codec";
import { WEDDING_CODE_V43_BANK as candidateV43Bank } from "../v43/bank";
import * as candidateV43Codec from "../v43/codec";

const guess: GuessAnswers = { set: "1", slots: [{ self: 0, guess: 1 }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }] };

describe("v4.2 exact-version 링크 코드", () => {
  const fixture = fixtureByName("swua-example");
  if (!fixture) throw new Error("fixture missing");

  it("새 코드만 4/5로 시작하고 v4.0·v4.1 코드와 양방향으로 섞이지 않는다", () => {
    for (const formBit of [0, 1] as const) {
      const oldCode = encodeV40(WEDDING_CODE_V40_BANK, formBit, fixture.responses);
      const newCode = encodeCode(WEDDING_CODE_V42_BANK, formBit, fixture.responses);
      const previousCode = encodeV41(WEDDING_CODE_V41_BANK, formBit, fixture.responses);
      expect(oldCode?.[0]).toBe(String(formBit));
      expect(newCode?.[0]).toBe(String(formBit + 4));
      expect(newCode).toHaveLength(70);
      expect(decodeCode(WEDDING_CODE_V42_BANK, newCode)).toEqual({ formBit, responses: fixture.responses });
      expect(decodeCode(WEDDING_CODE_V42_BANK, oldCode)).toBeNull();
      expect(decodeV40(WEDDING_CODE_V40_BANK, newCode)).toBeNull();
      expect(decodeCode(WEDDING_CODE_V42_BANK, previousCode)).toBeNull();
      expect(decodeV41(WEDDING_CODE_V41_BANK, newCode)).toBeNull();
    }
  });

  it("교차 판 URL은 v만 바꾸어도 열리지 않는다", () => {
    const person = { formBit: fixture.formBit, responses: fixture.responses };
    const newUrl = buildGatedShareUrl(WEDDING_CODE_V42_BANK, "https://hanbang.ai", person);
    const oldCode = encodeV40(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
    expect(newUrl).toContain(`#v=${WEDDING_CODE_V42_VERSION}&a=`);
    expect(newUrl?.split("#")[0]).toBe("https://hanbang.ai/wedding-code");
    expect(decodeCode(WEDDING_CODE_V42_BANK, oldCode)).toBeNull();
    expect(buildQuestionOnlyUrl("https://hanbang.ai")).toBe(`https://hanbang.ai/wedding-code?v=${WEDDING_CODE_V42_VERSION}`);
    expect(buildQuestionOnlyUrl("https://hanbang.ai", { explicitVersion: false })).toBe(`https://hanbang.ai/wedding-code?v=${WEDDING_CODE_V42_VERSION}`);
    expect(buildQuestionOnlyUrl("https://hanbang.ai")).not.toContain(WEDDING_CODE_V40_VERSION);
  });

  it("ga/gb도 판별 글자가 달라 다른 판으로 옮길 수 없다", () => {
    const oldCode = encodeV40GuessCode(guess);
    const newCode = encodeGuessCode(guess);
    const previousCode = encodeV41Guess(guess);
    expect(oldCode?.[0]).toBe("1");
    expect(newCode?.[0]).toBe("3");
    expect(decodeGuessCode(newCode)).toEqual(guess);
    expect(decodeGuessCode(oldCode)).toBeNull();
    expect(decodeV40GuessCode(newCode)).toBeNull();
    expect(decodeGuessCode(previousCode)).toBeNull();
    expect(decodeV41Guess(newCode)).toBeNull();
    const person = { formBit: fixture.formBit, responses: fixture.responses };
    const url = buildGatedShareUrlWithGuess(WEDDING_CODE_V42_BANK, "https://hanbang.ai", { code: person, guess });
    expect(url).toContain(`&ga=${newCode}`);
    expect(url).not.toContain(`&ga=${oldCode}`);
  });
});

describe("v4.3은 Preview로 공유된 v4.2의 답을 새 문항으로 다시 읽지 않는다", () => {
  const fixture = fixtureByName("swua-example");
  if (!fixture) throw new Error("fixture missing");

  it("두 배치 모두 6/7 코드만 받아들이고 v4.0·v4.1·v4.2와 양방향으로 거절한다", () => {
    for (const formBit of [0, 1] as const) {
      const code = candidateV43Codec.encodeCode(candidateV43Bank, formBit, fixture.responses);
      expect(code?.[0]).toBe(String(formBit + 6));
      expect(candidateV43Codec.decodeCode(candidateV43Bank, code)).toEqual({ formBit, responses: fixture.responses });
      const previous = [
        [encodeV40(WEDDING_CODE_V40_BANK, formBit, fixture.responses), () => decodeV40(WEDDING_CODE_V40_BANK, code)],
        [encodeV41(WEDDING_CODE_V41_BANK, formBit, fixture.responses), () => decodeV41(WEDDING_CODE_V41_BANK, code)],
        [encodeCode(WEDDING_CODE_V42_BANK, formBit, fixture.responses), () => decodeCode(WEDDING_CODE_V42_BANK, code)],
      ] as const;
      for (const [olderCode, decodeOlder] of previous) {
        expect(candidateV43Codec.decodeCode(candidateV43Bank, olderCode)).toBeNull();
        expect(decodeOlder()).toBeNull();
      }
    }
  });

  it("짐작은 4로 분리하고 한쪽 답 또는 짐작만 구판이면 링크 전체를 거절한다", () => {
    const code = candidateV43Codec.encodeCode(candidateV43Bank, fixture.formBit, fixture.responses);
    const guessed = candidateV43Codec.encodeGuessCode(guess);
    const previousCode = encodeCode(WEDDING_CODE_V42_BANK, fixture.formBit, fixture.responses);
    const previousGuess = encodeGuessCode(guess);
    expect(guessed?.[0]).toBe("4");
    expect(candidateV43Codec.decodeGuessCode(guessed)).toEqual(guess);
    for (const olderGuess of [encodeV40GuessCode(guess), encodeV41Guess(guess), previousGuess]) {
      expect(candidateV43Codec.decodeGuessCode(olderGuess)).toBeNull();
    }
    expect(decodeGuessCode(guessed)).toBeNull();
    expect(candidateV43Codec.decodeGuessedShareParams(candidateV43Bank, { a: code, b: previousCode, ga: guessed, gb: null })).toEqual({ kind: "invalid" });
    expect(candidateV43Codec.decodeGuessedShareParams(candidateV43Bank, { a: code, b: code, ga: previousGuess, gb: null })).toEqual({ kind: "invalid" });
    expect(candidateV43Codec.decodeGuessedShareParams(candidateV43Bank, { a: previousCode, b: code, ga: null, gb: guessed })).toEqual({ kind: "invalid" });
    expect(candidateV43Codec.decodeGuessedShareParams(candidateV43Bank, { a: code, b: null, ga: null, gb: guessed })).toEqual({ kind: "invalid" });
  });

  it("초대·질문 전용 주소도 v4.3을 명시하고 체크섬이 깨진 코드로 답을 만들지 않는다", () => {
    const person = { formBit: fixture.formBit, responses: fixture.responses };
    const code = candidateV43Codec.encodeCode(candidateV43Bank, person.formBit, person.responses);
    if (!code) throw new Error("code missing");
    const url = candidateV43Codec.buildGatedShareUrlWithGuess(candidateV43Bank, "https://hanbang.ai", { code: person, guess });
    const params = new URLSearchParams(url?.split("#")[1]);
    expect(params.get("v")).toBe("v4.3-depth");
    expect(params.get("a")).toBe(code);
    expect(params.get("ga")?.[0]).toBe("4");
    expect(candidateV43Codec.buildQuestionOnlyUrl("https://hanbang.ai", { explicitVersion: false })).toBe("https://hanbang.ai/wedding-code?v=v4.3-depth");
    const corrupted = code.slice(0, -1) + (code.at(-1) === "0" ? "1" : "0");
    expect(candidateV43Codec.decodeCode(candidateV43Bank, corrupted)).toBeNull();
    expect(candidateV43Codec.decodeCode(candidateV43Bank, code.slice(0, -1))).toBeNull();
  });
});
