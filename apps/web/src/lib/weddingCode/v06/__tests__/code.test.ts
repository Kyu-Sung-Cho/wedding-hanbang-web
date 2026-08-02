import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_QUESTIONS } from "@/constants/weddingCodeV06";
import {
  buildWeddingCodeV06ShareUrl,
  decodeWeddingCodeV06ShareHash,
  decodeWeddingCodeV06,
  encodeWeddingCodeV06,
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
  it("공유 답변을 서버에 전송되지 않는 fragment URL로 만든다", () => {
    const first = encodeWeddingCodeV06(FULL);
    const second = first.replace(/^A/, "B");
    const url = buildWeddingCodeV06ShareUrl("https://hanbang.ai/", first, second);

    expect(url).toBe(`https://hanbang.ai/wedding-code#a=${first}&b=${second}`);
    expect(new URL(url).search).toBe("");
  });

  it("fragment 공유 답변은 검증 후에만 복원한다", () => {
    const first = encodeWeddingCodeV06(FULL);
    const parsed = decodeWeddingCodeV06ShareHash(`#a=${first.toLowerCase()}&b=invalid`);

    expect(parsed?.firstCode).toBe(first);
    expect(parsed?.firstAnswers).toEqual(FULL);
    expect(parsed?.secondCode).toBeNull();
    expect(parsed?.secondAnswers).toBeNull();
    expect(decodeWeddingCodeV06ShareHash("#a=invalid")).toBeNull();
    expect(decodeWeddingCodeV06ShareHash(`#a=${"A".repeat(257)}`)).toBeNull();
  });
});
