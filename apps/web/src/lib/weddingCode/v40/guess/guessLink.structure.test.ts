/**
 * buildGatedShareUrlWithGuess 의 방어선: 기존 buildGatedShareUrl 이 만든 두 주소의 구조가 어긋나면(한 사람 주소가 두 사람 주소의 앞부분이 아니면)
 * 조용히 틀린 링크를 내지 않고 null 이다. 실제 코덱으로는 이 구조가 깨지지 않으므로 buildGatedShareUrl 만 가짜로 갈아 끼워 본다.
 * 끼우는 자리는 문자열 검색이 아니라 앞부분(single)의 길이로 정한다는 것도 가짜 주소로 정확한 글자열까지 고정한다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../codec")>();
  return { ...actual, buildGatedShareUrl: vi.fn(actual.buildGatedShareUrl) };
});

import { WEDDING_CODE_V40_BANK as bank } from "../bank";
import * as codec from "../codec";
import { V40_FIXTURES } from "../fixtures";
import { buildGatedShareUrlWithGuess } from "./guessLink";
import { guessAnswers } from "./guessFixtures";
import type { GuessedPerson } from "./types";

const first: GuessedPerson = {
  code: { formBit: V40_FIXTURES[0].formBit, responses: V40_FIXTURES[0].responses },
  guess: guessAnswers([0, 1], [1, 1], [null, null], [0, 0], [1, null], [null, 0]),
};
const second: GuessedPerson = {
  code: { formBit: V40_FIXTURES[1].formBit, responses: V40_FIXTURES[1].responses },
  guess: guessAnswers([1, 1], [0, 0], [0, 1], [1, 0], [null, null], [1, 1]),
};
const GA = "1148056W";
const GB = "1401384H";

const base = vi.mocked(codec.buildGatedShareUrl);

describe("buildGatedShareUrlWithGuess: 기본 링크 구조가 어긋나면 만들지 않는다", () => {
  beforeEach(() => {
    base.mockReset();
  });

  it("한 사람 주소가 두 사람 주소의 앞부분이 아니면 null 이다", () => {
    base.mockReturnValueOnce("https://h/wedding-code#v=T&a=AAA").mockReturnValueOnce("https://h/wedding-code#v=T&a=ZZZ&b=BBB");
    expect(buildGatedShareUrlWithGuess(bank, "https://h", first, second)).toBeNull();
    base.mockReturnValueOnce("https://h/wedding-code#v=T&a=AAA").mockReturnValueOnce("https://h/wedding-code#v=T&a=AAA&b=BBB");
    expect(buildGatedShareUrlWithGuess(bank, "https://h", first, second)).not.toBeNull();
  });

  it("두 번째 주소를 못 만들면 null 이고 첫 주소를 못 만들어도 null 이다", () => {
    base.mockReturnValueOnce("https://h/wedding-code#v=T&a=AAA").mockReturnValueOnce(null);
    expect(buildGatedShareUrlWithGuess(bank, "https://h", first, second)).toBeNull();
    base.mockReturnValueOnce(null);
    expect(buildGatedShareUrlWithGuess(bank, "https://h", first, second)).toBeNull();
  });

  it("끼우는 자리는 앞부분의 길이로 정한다: 앞부분 안에 &a= 가 또 있어도 g 는 앞부분 바로 뒤와 맨 끝에 놓인다", () => {
    const single = "https://h&a=x/wedding-code#v=T&a=AAA";
    base.mockReturnValueOnce(single).mockReturnValueOnce(`${single}&b=BBB`);
    expect(buildGatedShareUrlWithGuess(bank, "https://h", first, second)).toBe(`${single}&ga=${GA}&b=BBB&gb=${GB}`);
    base.mockReturnValueOnce(single);
    expect(buildGatedShareUrlWithGuess(bank, "https://h", first)).toBe(`${single}&ga=${GA}`);
  });

  it("짐작이 둘 다 없으면 기본 링크 그대로다(바이트까지)", () => {
    const single = "https://h/wedding-code#v=T&a=AAA";
    base.mockReturnValueOnce(single).mockReturnValueOnce(`${single}&b=BBB`);
    expect(buildGatedShareUrlWithGuess(bank, "https://h", { ...first, guess: null }, { ...second, guess: null })).toBe(`${single}&b=BBB`);
  });

  it("기본 링크는 한 사람 몫과 두 사람 몫을 이 순서로 한 번씩만 부른다", () => {
    const single = "https://h/wedding-code#v=T&a=AAA";
    base.mockReturnValueOnce(single).mockReturnValueOnce(`${single}&b=BBB`);
    buildGatedShareUrlWithGuess(bank, "https://h", first, second);
    expect(base).toHaveBeenCalledTimes(2);
    // 선택 인자(options)는 주지 않았으면 undefined 로 그대로 넘어간다.
    expect(base.mock.calls[0]).toEqual([bank, "https://h", first.code, undefined, undefined]);
    expect(base.mock.calls[1]).toEqual([bank, "https://h", first.code, second.code, undefined]);
    base.mockClear();
    base.mockReturnValueOnce(single);
    buildGatedShareUrlWithGuess(bank, "https://h", first);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("링크 만들기 선택 인자(explicitVersion: 쿼리의 판 이름을 붙일지)는 한 사람 몫과 두 사람 몫 호출에 그대로 넘어간다", () => {
    const single = "https://h/wedding-code#v=T&a=AAA";
    const options = { explicitVersion: false } as const;
    base.mockReturnValueOnce(single).mockReturnValueOnce(`${single}&b=BBB`);
    buildGatedShareUrlWithGuess(bank, "https://h", first, second, options);
    expect(base.mock.calls[0]).toEqual([bank, "https://h", first.code, undefined, options]);
    expect(base.mock.calls[1]).toEqual([bank, "https://h", first.code, second.code, options]);
  });
});
