import { describe, expect, it } from "vitest";
import { cleanOptionalKoreanMobile, isUuid } from "../requestValidation";

describe("cleanOptionalKoreanMobile (알림톡/문자 채널 번호 정규화)", () => {
  it("하이픈·공백 입력을 숫자만으로 정규화한다", () => {
    expect(cleanOptionalKoreanMobile("010-1234-5678")).toBe("01012345678");
    expect(cleanOptionalKoreanMobile("010 1234 5678")).toBe("01012345678");
    expect(cleanOptionalKoreanMobile("01012345678")).toBe("01012345678");
  });

  it("구형 번호(011 등, 7자리 국번)도 허용한다", () => {
    expect(cleanOptionalKoreanMobile("011-123-4567")).toBe("0111234567");
  });

  it("빈 입력은 삭제 의도(null)", () => {
    expect(cleanOptionalKoreanMobile("")).toBeNull();
    expect(cleanOptionalKoreanMobile(null)).toBeNull();
    expect(cleanOptionalKoreanMobile(undefined)).toBeNull();
    expect(cleanOptionalKoreanMobile("---")).toBeNull();
  });

  it("형식 오류는 undefined (일반전화·짧은 번호·문자열 아님)", () => {
    expect(cleanOptionalKoreanMobile("02-1234-5678")).toBeUndefined();
    expect(cleanOptionalKoreanMobile("010-123")).toBeUndefined();
    expect(cleanOptionalKoreanMobile("010123456789")).toBeUndefined();
    expect(cleanOptionalKoreanMobile(1012345678)).toBeUndefined();
  });
});

describe("isUuid", () => {
  it("accepts RFC variant UUIDs used as WeddingCode capabilities", () => {
    expect(isUuid("223e4567-e89b-42d3-a456-426614174000")).toBe(true);
  });

  it("rejects all-zero and structurally loose UUID-like values", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isUuid("223e4567-e89b-02d3-7456-426614174000")).toBe(false);
  });
});
