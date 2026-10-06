import { describe, expect, it } from "vitest";
import { V40_NICKNAMES, nicknameForCode } from "./nickname";

describe("v4 웨딩코드 놀이 별칭", () => {
  it("네 축의 완성 코드 열여섯 조합에 서로 다른 별칭을 준다", () => {
    expect(Object.keys(V40_NICKNAMES)).toHaveLength(16);
    expect(new Set(Object.values(V40_NICKNAMES)).size).toBe(16);
    for (const money of ["V", "S"]) {
      for (const process of ["W", "D"]) {
        for (const scope of ["U", "F"]) {
          for (const support of ["H", "A"]) {
            expect(nicknameForCode(`${money}${process}${scope}${support}`)).toBeTruthy();
          }
        }
      }
    }
  });

  it("글자가 빠진 코드나 주제가 다른 글자는 별칭을 만들지 않는다", () => {
    expect(nicknameForCode(null)).toBeNull();
    expect(nicknameForCode("V·UH")).toBeNull();
    expect(nicknameForCode("VVUH")).toBeNull();
    expect(nicknameForCode("vwuh")).toBe("함께 살피는 수달");
  });
});
