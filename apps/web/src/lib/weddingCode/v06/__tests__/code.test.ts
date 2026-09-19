import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_QUESTIONS } from "@/constants/weddingCodeV06";
import { WEDDING_CODE_V12_QUESTIONS } from "@/constants/weddingCodeV12";
import {
  decodeWeddingCodeV06,
  encodeWeddingCodeV06,
  isCompatibleWeddingCodeV06Version,
  isCompleteWeddingCodeV06,
} from "../code";
import type { WeddingCodeV06Answers } from "../gap";

const FULL: WeddingCodeV06Answers = Object.fromEntries(
  WEDDING_CODE_V06_QUESTIONS.map((question, index) => [
    question.key,
    (["A", "B", "C", "D"] as const)[index % 4],
  ]),
);

describe("응답 코드", () => {
  it("답 16개를 16글자로 싣고 그대로 되돌린다", () => {
    const code = encodeWeddingCodeV06(FULL);
    expect(code).toHaveLength(16);
    expect(decodeWeddingCodeV06(code)).toEqual(FULL);
  });

  it("빠진 답은 -로 남고 되돌려도 빠진 채다", () => {
    const partial: WeddingCodeV06Answers = { ...FULL };
    delete partial.A1;
    delete partial.D4;
    const code = encodeWeddingCodeV06(partial);
    expect(code[0]).toBe("-");
    expect(code[15]).toBe("-");
    const back = decodeWeddingCodeV06(code)!;
    expect(back.A1).toBeUndefined();
    expect(back.D4).toBeUndefined();
    expect(back.B1).toBe(partial.B1);
  });

  /**
   * 이 제품에서 제일 위험한 버그. 잘못된 코드에 기본값을 채우면 상대가 고르지도 않은
   * 문장이 「상대는 이렇게 답했어요」로 화면에 뜬다.
   */
  it("망가진 코드는 조용히 채우지 않고 null이다", () => {
    expect(decodeWeddingCodeV06("ABCD")).toBeNull();
    expect(decodeWeddingCodeV06("ABCDABCDABCDABCDABCD")).toBeNull();
    expect(decodeWeddingCodeV06("ABCEABCDABCDABCD")).toBeNull();
    expect(decodeWeddingCodeV06("ABC DABCDABCDABC")).toBeNull();
    expect(decodeWeddingCodeV06("")).toBeNull();
    expect(decodeWeddingCodeV06(null)).toBeNull();
    expect(decodeWeddingCodeV06(undefined)).toBeNull();
    expect(decodeWeddingCodeV06("----------------")).toBeNull();
  });

  it("소문자와 공백은 받아준다 — 카톡에서 복사하면 흔하다", () => {
    const code = encodeWeddingCodeV06(FULL);
    expect(decodeWeddingCodeV06(` ${code.toLowerCase()} `)).toEqual(FULL);
  });

  it("코드 한 글자가 바뀌면 그 문항 답만 바뀐다", () => {
    const code = encodeWeddingCodeV06(FULL);
    const flipped = `B${code.slice(1)}`;
    const back = decodeWeddingCodeV06(flipped)!;
    expect(back.A1).toBe("B");
    expect(back.A2).toBe(FULL.A2);
  });

  it("코드 자리 순서가 문항 순서와 같다", () => {
    const only: WeddingCodeV06Answers = { [WEDDING_CODE_V06_QUESTIONS[5].key]: "C" };
    const code = encodeWeddingCodeV06(only);
    expect(code[5]).toBe("C");
    expect(code.replace(/-/g, "")).toBe("C");
  });

  it("완료 여부를 판단한다", () => {
    expect(isCompleteWeddingCodeV06(FULL)).toBe(true);
    const partial = { ...FULL };
    delete partial.C3;
    expect(isCompleteWeddingCodeV06(partial)).toBe(false);
  });

  it("값이 채워져 있어도 그 문항에 없는 보기면 완료나 공유 코드로 만들지 않는다", () => {
    const valid: WeddingCodeV06Answers = Object.fromEntries(
      WEDDING_CODE_V12_QUESTIONS.map(question => [question.key, question.options[0].value]),
    );
    expect(isCompleteWeddingCodeV06(valid, WEDDING_CODE_V12_QUESTIONS)).toBe(true);
    const invalid = { ...valid, D1: "D" } as const;
    expect(isCompleteWeddingCodeV06(invalid, WEDDING_CODE_V12_QUESTIONS)).toBe(false);
    expect(() => encodeWeddingCodeV06(invalid, WEDDING_CODE_V12_QUESTIONS))
      .toThrow("INVALID_WEDDING_CODE_SCENE_ANSWER");
  });

  it("새 링크는 현재 버전만 받고 버전 없는 초기 링크는 호환한다", () => {
    expect(isCompatibleWeddingCodeV06Version(undefined)).toBe(true);
    expect(isCompatibleWeddingCodeV06Version("")).toBe(true);
    expect(isCompatibleWeddingCodeV06Version("v0.6-scene")).toBe(true);
    expect(isCompatibleWeddingCodeV06Version("v9-unknown")).toBe(false);
  });
});
