import { describe, expect, it } from "vitest";
import { V40_LINK_KEYS, V40_STATE_ALPHABET, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V40_BANK as bank } from "../bank";
import { MAX_SHARE_HASH_LENGTH, buildGatedShareUrl, decodeCode, encodeCode, parseShareHash } from "../codec";
import { V40_FIXTURES } from "../fixtures";
import { buildResult } from "../score";
import type { DecodedCode } from "../types";
import { guessAnswers } from "./guessFixtures";
import {
  GUESS_CODE_LENGTH,
  V40_GUESS_LINK_KEYS,
  V40_GUESS_SET_IDS,
  buildGatedShareUrlWithGuess,
  decodeGuessCode,
  decodeGuessedShareParams,
  encodeGuessCode,
  guessChecksumChar,
  guessLinkModule,
  hasGuessInfo,
  parseGuessedShareHash,
} from "./guessLink";
import type { GuessAnswers, GuessPick, GuessedPerson } from "./types";

/** 기호 0, 1, 2(고르지 않음)를 쓰는 표기: 2 는 null 이다. */
const pick = (value: number): GuessPick => (value === 2 ? null : (value as GuessPick));
function answers(...pairs: readonly (readonly [number, number])[]): GuessAnswers {
  return guessAnswers(...pairs.map(([self, guess]): readonly [GuessPick, GuessPick] => [pick(self), pick(guess)]));
}
const none6 = [[2, 2], [2, 2], [2, 2], [2, 2], [2, 2], [2, 2]] as const;

// ---------------------------------------------------------------------------
// 골든 벡터(빌드 계획 4.6). 같은 표가 기준 계산기 시험(guessLink.oracle.test.ts)에도 들어 있다.
// ---------------------------------------------------------------------------

const GOLDEN: readonly (readonly [string, readonly (readonly [number, number])[], string])[] = [
  ["섞인 답 A", [[0, 1], [1, 1], [2, 2], [0, 0], [1, 2], [2, 0]], "1148056W"],
  ["섞인 답 B", [[1, 1], [0, 0], [0, 1], [1, 0], [2, 2], [1, 1]], "1401384H"],
  ["자기 고름만", [[0, 2], [1, 2], [0, 2], [1, 2], [0, 2], [1, 2]], "1252525D"],
  ["짐작만", [[2, 0], [2, 1], [2, 0], [2, 1], [2, 0], [2, 1]], "1676767U"],
  ["하나만 답", [[2, 2], [2, 2], [2, 2], [2, 2], [2, 2], [1, 2]], "1888885d"],
  ["모두 첫째", [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], "10000001"],
  ["모두 둘째", [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]], "1444444M"],
];

/** 거절해야 하는 것. 검사 글자를 맞게 다시 계산한 위조를 따로 넣어 규칙이 지워지면 빨개지게 한다(검사 글자가 틀려서 걸리는 것과 구별). */
const REJECT: readonly (readonly [string, unknown])[] = [
  ["전부 없음(검사 맞음)", "1888888y"],
  ["다른 세트 글자(검사 맞음) 둘", "2148056X"],
  ["다른 세트 글자(검사 맞음) 영", "0148056V"],
  ["범위 밖 9(검사 맞음)", "1948056d"],
  ["범위 밖 소문자(검사 맞음)", "1a48056f"],
  ["범위 밖 대문자(검사 맞음)", "1Z48056U"],
  ["범위 밖 마지막 장면(검사 맞음)", "1148059i"],
  ["길이 7", "1148056"],
  ["길이 9", "1148056W0"],
  ["빈 문자열", ""],
  ["검사 틀림", "1148056X"],
  ["세트 글자만 바꿈(검사 그대로)", "2148056W"],
  ["소문자 검사 글자", "1148056w"],
  ["전각 숫자", "１148056W"],
  ["앞 공백", " 1148056W"],
  ["뒤 공백", "1148056W "],
  ["null", null],
  ["숫자 입력", 11480560],
];

describe("g 글자열: 골든 벡터와 거절 표", () => {
  it("받아들일 일곱은 글자열이 그대로 나오고 풀면 그대로 돌아온다", () => {
    for (const [name, pairs, expected] of GOLDEN) {
      const input = answers(...pairs);
      expect(encodeGuessCode(input), name).toBe(expected);
      expect(decodeGuessCode(expected), name).toEqual(input);
      expect(guessChecksumChar(expected.slice(0, GUESS_CODE_LENGTH - 1)), name).toBe(expected[GUESS_CODE_LENGTH - 1]);
    }
  });

  it("거절 열여덟은 모두 null 이다(던지지 않는다)", () => {
    for (const [name, value] of REJECT) {
      expect(() => decodeGuessCode(value as string), name).not.toThrow();
      expect(decodeGuessCode(value as string), name).toBeNull();
    }
    expect(REJECT).toHaveLength(18);
  });

  it("거절하는 이유가 검사 글자 하나가 아니다: 범위, 세트 글자, 전부 없음 위조는 검사 글자가 맞아도 거절된다", () => {
    const forged = ["1888888y", "2148056X", "0148056V", "1948056d", "1a48056f", "1Z48056U", "1148059i"];
    for (const code of forged) {
      expect(guessChecksumChar(code.slice(0, 7)), `${code} 의 검사 글자는 맞아야 시험이 된다`).toBe(code[7]);
      expect(decodeGuessCode(code), code).toBeNull();
    }
  });

  it("골든 벡터 밖 몇 개: 글자가 하나라도 들어 있으면 검사 글자를 맞게 만들어 받아들이고 만든 것을 다시 풀면 같다", () => {
    for (const body of ["1000000", "1888880", "1000008", "1808080", "1777777"]) {
      const code = body + guessChecksumChar(body);
      const decoded = decodeGuessCode(code);
      expect(decoded, code).not.toBeNull();
      expect(encodeGuessCode(decoded as GuessAnswers), code).toBe(code);
    }
  });
});

describe("검사 글자", () => {
  it("알파벳 색인에 위치 가중치 1에서 7 을 곱해 더하고 61 로 나눈 나머지의 글자다", () => {
    expect(guessChecksumChar("")).toBe("0");
    expect(guessChecksumChar("1")).toBe("1");
    expect(guessChecksumChar("0000001")).toBe(V40_STATE_ALPHABET[7]);
    expect(guessChecksumChar("1148056")).toBe("W");
    // 가중치는 위치 그대로다(70자 코드처럼 60 칸에서 되돌아가지 않는다).
    expect(guessChecksumChar("a".repeat(8))).toBe(V40_STATE_ALPHABET[(10 * 36) % 61]);
  });

  it("알파벳 밖 문자는 RangeError 이고 메시지에 입력 글자를 싣지 않는다", () => {
    for (const bad of ["1148056!", "-", "_", "한", "é", "\t", "😀"]) {
      let message = "";
      try {
        guessChecksumChar(`1${bad}`);
      } catch (error) {
        expect(error).toBeInstanceOf(RangeError);
        message = (error as Error).message;
      }
      expect(message, bad).not.toBe("");
      expect(message, bad).not.toContain(bad);
    }
    expect(() => guessChecksumChar(5 as unknown as string)).toThrow(RangeError);
    expect(() => guessChecksumChar(null as unknown as string)).toThrow(RangeError);
  });

  it("글자 하나를 다른 유효 글자로 바꾸면 항상 어긋난다(장면 글자는 0에서 8, 세트 글자는 알파벳 전부)", () => {
    // 알파벳은 62자라서 0 과 Z 가 61 을 법으로 같은 값을 낸다. 그 쌍이 통과하지 못하게 막는 것은 장면 글자의 범위 검사다(위 거절 표). 검사 글자의 성질은 유효 글자 안에서 센다.
    for (const [, pairs, code] of GOLDEN) {
      void pairs;
      for (let index = 0; index < 7; index += 1) {
        for (const replacement of index === 0 ? V40_STATE_ALPHABET : "012345678") {
          if (replacement === code[index]) continue;
          const body = code.slice(0, index) + replacement + code.slice(index + 1, 7);
          expect(guessChecksumChar(body), `${code} ${index}:${replacement}`).not.toBe(code[7]);
        }
      }
    }
  });

  it("서로 다른 두 글자를 맞바꾸면 항상 어긋난다(70자 코드의 60칸 떨어진 맞바꾸기 한계가 없다)", () => {
    for (const [, , code] of GOLDEN) {
      for (let i = 0; i < 7; i += 1) {
        for (let j = i + 1; j < 7; j += 1) {
          if (code[i] === code[j]) continue;
          const chars = [...code.slice(0, 7)];
          [chars[i], chars[j]] = [chars[j], chars[i]];
          expect(guessChecksumChar(chars.join("")), `${code} ${i}<->${j}`).not.toBe(code[7]);
        }
      }
    }
  });
});

describe("encodeGuessCode / decodeGuessCode 입력 방어", () => {
  it("만들 수 없는 입력은 null 이고 던지지 않는다", () => {
    const base = answers([0, 1], ...none6.slice(1));
    const cases: readonly [string, unknown][] = [
      ["고른 것이 하나도 없음", answers(...none6)],
      ["지원하지 않는 세트 글자", { ...base, set: "2" }],
      ["세트 글자가 문자열이 아님", { ...base, set: 1 }],
      ["장면이 다섯", { set: "1", slots: base.slots.slice(0, 5) }],
      ["장면이 일곱", { set: "1", slots: [...base.slots, base.slots[0]] }],
      ["기호가 2", { set: "1", slots: base.slots.map((slot, index) => (index === 0 ? { self: 2, guess: 0 } : slot)) }],
      ["기호가 문자열", { set: "1", slots: base.slots.map((slot, index) => (index === 0 ? { self: "0", guess: 0 } : slot)) }],
      ["기호가 undefined", { set: "1", slots: base.slots.map((slot, index) => (index === 0 ? { self: undefined, guess: 0 } : slot)) }],
      ["장면이 null", { set: "1", slots: base.slots.map((slot, index) => (index === 0 ? null : slot)) }],
      ["성긴 배열", { set: "1", slots: Object.assign(new Array(6), { 1: base.slots[1] }) }],
      ["slots 가 배열이 아님", { set: "1", slots: "abcdef" }],
      ["null", null],
      ["숫자", 7],
      ["문자열", "1148056W"],
    ];
    for (const [name, input] of cases) {
      expect(() => encodeGuessCode(input as GuessAnswers), name).not.toThrow();
      expect(encodeGuessCode(input as GuessAnswers), name).toBeNull();
    }
  });

  it("내 고름이 없고 짐작만 있는 장면(글자 6, 7)도 만들고 푼다(화면은 만들지 않지만 코덱은 받아들인다)", () => {
    const input = answers([2, 0], [2, 1], ...none6.slice(2));
    const code = encodeGuessCode(input);
    expect(code).not.toBeNull();
    expect((code as string).slice(1, 3)).toBe("67");
    expect(decodeGuessCode(code)).toEqual(input);
  });

  it("문자열이 아닌 입력과 이상한 입력에도 던지지 않는다", () => {
    for (const value of [undefined, null, 0, 8, true, {}, [], ["1148056W"], new String("1148056W")]) {
      expect(() => decodeGuessCode(value as unknown as string)).not.toThrow();
      expect(decodeGuessCode(value as unknown as string)).toBeNull();
    }
  });

  it("hasGuessInfo: 고른 것이 하나라도 있을 때만 참이고 모양이 어긋난 값과 null 은 거짓이다", () => {
    expect(hasGuessInfo(answers([0, 2], ...none6.slice(1)))).toBe(true);
    expect(hasGuessInfo(answers([2, 1], ...none6.slice(1)))).toBe(true);
    expect(hasGuessInfo(answers(...none6))).toBe(false);
    expect(hasGuessInfo(null)).toBe(false);
    expect(hasGuessInfo({ set: "9", slots: answers([0, 0], ...none6.slice(1)).slots } as unknown as GuessAnswers)).toBe(false);
    expect(hasGuessInfo("x" as unknown as GuessAnswers)).toBe(false);
  });
});

describe("상수와 계약", () => {
  it("링크 키는 ga, gb 이고 지원 세트 글자는 하나이며 g 는 8자다", () => {
    expect(V40_GUESS_LINK_KEYS).toEqual({ first: "ga", second: "gb" });
    expect(V40_GUESS_SET_IDS).toEqual(["1"]);
    expect(GUESS_CODE_LENGTH).toBe(8);
    // 기존 링크 키 상수는 건드리지 않았다.
    expect(V40_LINK_KEYS).toEqual({ version: "v", first: "a", second: "b" });
  });

  it("모듈 객체가 일곱 함수를 그대로 낸다", () => {
    expect(Object.keys(guessLinkModule).sort()).toEqual(
      ["buildGatedShareUrlWithGuess", "decodeGuessCode", "decodeGuessedShareParams", "encodeGuessCode", "guessChecksumChar", "hasGuessInfo", "parseGuessedShareHash"].sort(),
    );
    expect(guessLinkModule.encodeGuessCode).toBe(encodeGuessCode);
  });
});

// ---------------------------------------------------------------------------
// 링크 수준 규칙과 해시 읽기
// ---------------------------------------------------------------------------

const V = WEDDING_CODE_V40_VERSION;
const openFixtures = V40_FIXTURES.filter((fixture) => buildResult(bank, fixture.formBit, fixture.responses).code !== null);
const gateClosed = V40_FIXTURES.find((fixture) => buildResult(bank, fixture.formBit, fixture.responses).code === null);

function personOf(index: number): DecodedCode {
  const fixture = openFixtures[index % openFixtures.length];
  return { formBit: fixture.formBit, responses: fixture.responses };
}
const codeOf = (person: DecodedCode): string => encodeCode(bank, person.formBit, person.responses) as string;

const A = codeOf(personOf(0));
const B = codeOf(personOf(3));
const GA = "1148056W";
const GB = "1401384H";

describe("고정 표본이 이 시험이 기대하는 모양이다", () => {
  it("관문이 열린 표본이 여럿 있고 닫힌 표본이 하나 있다", () => {
    expect(openFixtures.length).toBeGreaterThanOrEqual(10);
    expect(gateClosed).toBeDefined();
    expect(A).not.toBe(B);
    expect(A).toHaveLength(70);
  });
});

describe("decodeGuessedShareParams: a, b, ga, gb 의 곱", () => {
  const good = { a: A, b: B, ga: GA, gb: GB };
  const bad = { a: `${A.slice(0, -1)}${A.endsWith("0") ? "1" : "0"}`, b: "broken", ga: "1148056X", gb: "1948056d" };

  it("a 는 좋음, 나쁨, 없음 그리고 b, ga, gb 도 그렇게 81가지를 모두 4.8 의 규칙대로 가른다", () => {
    const states = ["good", "bad", "null"] as const;
    let count = 0;
    for (const sa of states) for (const sb of states) for (const sga of states) for (const sgb of states) {
      const raw = {
        a: sa === "null" ? null : sa === "good" ? good.a : bad.a,
        b: sb === "null" ? null : sb === "good" ? good.b : bad.b,
        ga: sga === "null" ? null : sga === "good" ? good.ga : bad.ga,
        gb: sgb === "null" ? null : sgb === "good" ? good.gb : bad.gb,
      };
      let expected: "none" | "invalid" | "partner" | "both";
      if (sa === "null" && sb === "null" && sga === "null" && sgb === "null") expected = "none";
      else if (sa !== "good") expected = "invalid";
      else if (sb === "bad") expected = "invalid";
      else if (sga === "bad") expected = "invalid";
      else if (sgb !== "null" && (sb === "null" || sgb === "bad")) expected = "invalid";
      else expected = sb === "null" ? "partner" : "both";
      const parsed = decodeGuessedShareParams(bank, raw);
      expect(parsed.kind, JSON.stringify([sa, sb, sga, sgb])).toBe(expected);
      if (parsed.kind === "partner") {
        expect(parsed.first).toEqual(decodeCode(bank, A));
        expect(parsed.firstGuess).toEqual(sga === "good" ? decodeGuessCode(GA) : null);
      }
      if (parsed.kind === "both") {
        expect(parsed.second).toEqual(decodeCode(bank, B));
        expect(parsed.secondGuess).toEqual(sgb === "good" ? decodeGuessCode(GB) : null);
      }
      count += 1;
    }
    expect(count).toBe(81);
  });

  it("나쁜 g 가 있으면 멀쩡한 a 도 버린다(한 사람의 답만 살리거나 기본값을 채우지 않는다)", () => {
    expect(decodeGuessedShareParams(bank, { a: A, b: null, ga: "1148056X", gb: null })).toEqual({ kind: "invalid" });
    expect(decodeGuessedShareParams(bank, { a: A, b: B, ga: GA, gb: "1148056X" })).toEqual({ kind: "invalid" });
    expect(decodeGuessedShareParams(bank, { a: A, b: B, ga: "2148056X", gb: null })).toEqual({ kind: "invalid" });
  });

  it("ga 는 a 가 있을 때만, gb 는 b 가 있을 때만 허용한다", () => {
    expect(decodeGuessedShareParams(bank, { a: null, b: null, ga: GA, gb: null })).toEqual({ kind: "invalid" });
    expect(decodeGuessedShareParams(bank, { a: null, b: B, ga: null, gb: null })).toEqual({ kind: "invalid" });
    expect(decodeGuessedShareParams(bank, { a: A, b: null, ga: null, gb: GB })).toEqual({ kind: "invalid" });
  });

  it("짐작이 없으면 firstGuess, secondGuess 는 null 이다", () => {
    const parsed = decodeGuessedShareParams(bank, { a: A, b: B, ga: null, gb: null });
    expect(parsed).toEqual({ kind: "both", first: decodeCode(bank, A), second: decodeCode(bank, B), firstGuess: null, secondGuess: null });
  });

  it("undefined 가 와도 없는 값으로 읽고 던지지 않는다", () => {
    const loose = { a: A, b: undefined, ga: undefined, gb: undefined } as unknown as { a: string; b: null; ga: null; gb: null };
    expect(decodeGuessedShareParams(bank, loose).kind).toBe("partner");
  });
});

describe("parseGuessedShareHash", () => {
  const hashOf = (parts: readonly string[]) => `#${parts.join("&")}`;

  it("정규 순서 v, a, ga, b, gb 를 읽고 순서를 바꿔도 같다(# 가 있어도 없어도)", () => {
    const parts = [`v=${V}`, `a=${A}`, `ga=${GA}`, `b=${B}`, `gb=${GB}`];
    const expected = decodeGuessedShareParams(bank, { a: A, b: B, ga: GA, gb: GB });
    expect(expected.kind).toBe("both");
    const orders = [
      [0, 1, 2, 3, 4], [0, 3, 4, 1, 2], [4, 3, 2, 1, 0], [1, 0, 3, 2, 4], [2, 1, 0, 4, 3], [3, 4, 0, 1, 2],
    ];
    for (const order of orders) {
      const shuffled = order.map((index) => parts[index]);
      expect(parseGuessedShareHash(bank, hashOf(shuffled)), order.join()).toEqual(expected);
      expect(parseGuessedShareHash(bank, shuffled.join("&")), order.join()).toEqual(expected);
    }
  });

  it("없음과 빈 해시는 none, 문자열이 아닌 값은 invalid 이고 던지지 않는다", () => {
    expect(parseGuessedShareHash(bank, null)).toEqual({ kind: "none" });
    expect(parseGuessedShareHash(bank, undefined)).toEqual({ kind: "none" });
    expect(parseGuessedShareHash(bank, "")).toEqual({ kind: "none" });
    expect(parseGuessedShareHash(bank, "#")).toEqual({ kind: "none" });
    expect(parseGuessedShareHash(bank, `#v=${V}`)).toEqual({ kind: "none" });
    for (const value of [5, {}, [], true]) expect(parseGuessedShareHash(bank, value as unknown as string)).toEqual({ kind: "invalid" });
  });

  it("모르는 키, 중복 키, 빈 부분, 판 태그 없음, 다른 판은 모두 invalid 다", () => {
    const bads = [
      hashOf([`v=${V}`, `a=${A}`, `gc=${GA}`]),
      hashOf([`v=${V}`, `a=${A}`, `ga=${GA}`, `ga=${GA}`]),
      hashOf([`v=${V}`, `a=${A}`, `gb=${GB}`]),
      hashOf([`v=${V}`, `ga=${GA}`]),
      hashOf([`v=${V}`, `b=${B}`, `gb=${GB}`]),
      hashOf([`v=${V}`, `a=${A}`, "ga"]),
      hashOf([`v=${V}`, `a=${A}`, "ga="]),
      hashOf([`v=${V}`, `a=${A}`, "=x"]),
      hashOf([`v=${V}`, `a=${A}`, ""]),
      hashOf([`a=${A}`, `ga=${GA}`]),
      hashOf(["v=v3.1-other", `a=${A}`, `ga=${GA}`]),
      hashOf([`v=${V}`, `v=${V}`, `a=${A}`]),
      hashOf([`v=${V}`, `a=${A}`, `GA=${GA}`]),
      hashOf([`v=${V}`, `a=${A}`, `ga=${GA}x`]),
      hashOf([`v=${V}`, `a=${A}`, `ga=${GA.toLowerCase()}`]),
    ];
    for (const hash of bads) expect(parseGuessedShareHash(bank, hash), hash).toEqual({ kind: "invalid" });
  });

  it("길이 상한을 넘으면 쪼개 보지 않고 invalid 다(상한 안쪽의 최장 해시는 읽힌다)", () => {
    const longest = hashOf([`v=${V}`, `a=${A}`, `ga=${GA}`, `b=${B}`, `gb=${GB}`]);
    expect(longest.length - 1).toBeLessThanOrEqual(MAX_SHARE_HASH_LENGTH);
    expect(parseGuessedShareHash(bank, longest).kind).toBe("both");
    expect(parseGuessedShareHash(bank, `${longest}&${"x".repeat(MAX_SHARE_HASH_LENGTH)}`)).toEqual({ kind: "invalid" });
    const padded = `#v=${V}&a=${A}&ga=${GA}&b=${B}&gb=${GB}&${"z".repeat(MAX_SHARE_HASH_LENGTH - longest.length)}`;
    expect(padded.length - 1).toBe(MAX_SHARE_HASH_LENGTH);
    expect(parseGuessedShareHash(bank, padded)).toEqual({ kind: "invalid" });
  });

  it("옛 링크(g 없음)는 오늘의 parseShareHash 와 똑같이 읽힌다: 고정 표본 열둘 곱 링크 모양 전부", () => {
    let checked = 0;
    for (const fixture of V40_FIXTURES) {
      const code = encodeCode(bank, fixture.formBit, fixture.responses);
      if (code === null) continue;
      const other = encodeCode(bank, V40_FIXTURES[(checked + 5) % V40_FIXTURES.length].formBit, V40_FIXTURES[(checked + 5) % V40_FIXTURES.length].responses) ?? code;
      const hashes = [
        `#v=${V}`, `#v=${V}&a=${code}`, `#v=${V}&a=${code}&b=${other}`, `#v=${V}&b=${other}&a=${code}`, `#v=${V}&b=${other}`,
        `v=${V}&a=${code}`, `#v=${V}&a=${code}&a=${code}`, `#v=${V}&a=${code}&x=1`, `#v=other&a=${code}`, `#a=${code}`, "", "#",
      ];
      for (const hash of hashes) {
        const old = parseShareHash(bank, hash);
        const next = parseGuessedShareHash(bank, hash);
        if (old.kind === "none" || old.kind === "invalid") expect(next, `${fixture.name} ${hash}`).toEqual(old);
        else if (old.kind === "partner") expect(next, `${fixture.name} ${hash}`).toEqual({ kind: "partner", first: old.first, firstGuess: null });
        else expect(next, `${fixture.name} ${hash}`).toEqual({ kind: "both", first: old.first, second: old.second, firstGuess: null, secondGuess: null });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// 링크 만들기
// ---------------------------------------------------------------------------

const ORIGIN = "https://hanbang.ai";
const first = (guess: GuessAnswers | null): GuessedPerson => ({ code: personOf(0), guess });
const second = (guess: GuessAnswers | null): GuessedPerson => ({ code: personOf(3), guess });
const guessA = decodeGuessCode(GA) as GuessAnswers;
const guessB = decodeGuessCode(GB) as GuessAnswers;

describe("buildGatedShareUrlWithGuess", () => {
  it("짐작이 둘 다 없으면 buildGatedShareUrl 과 바이트까지 같다(한 사람, 두 사람, origin 셋)", () => {
    for (const origin of [ORIGIN, "http://localhost:3000", "", `${ORIGIN}/`, `${ORIGIN}///`]) {
      expect(buildGatedShareUrlWithGuess(bank, origin, first(null)), origin).toBe(buildGatedShareUrl(bank, origin, personOf(0)));
      expect(buildGatedShareUrlWithGuess(bank, origin, first(null), second(null)), origin).toBe(buildGatedShareUrl(bank, origin, personOf(0), personOf(3)));
    }
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first(null))).not.toBeNull();
  });

  it("정규 순서 v, a, ga, b, gb 로 만들고 g 가 하나씩일 때도 주인 옆에 놓인다", () => {
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA))).toBe(`${ORIGIN}/wedding-code#v=${V}&a=${A}&ga=${GA}`);
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA), second(guessB))).toBe(`${ORIGIN}/wedding-code#v=${V}&a=${A}&ga=${GA}&b=${B}&gb=${GB}`);
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first(null), second(guessB))).toBe(`${ORIGIN}/wedding-code#v=${V}&a=${A}&b=${B}&gb=${GB}`);
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA), second(null))).toBe(`${ORIGIN}/wedding-code#v=${V}&a=${A}&ga=${GA}&b=${B}`);
  });

  it("만든 링크를 해시 읽기가 그대로 되읽는다(왕복)", () => {
    const url = buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA), second(guessB)) as string;
    const parsed = parseGuessedShareHash(bank, url.slice(url.indexOf("#")));
    expect(parsed).toEqual({ kind: "both", first: personOf(0), second: personOf(3), firstGuess: guessA, secondGuess: guessB });
    const single = buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA)) as string;
    expect(parseGuessedShareHash(bank, single.slice(single.indexOf("#")))).toEqual({ kind: "partner", first: personOf(0), firstGuess: guessA });
  });

  it("끼우는 자리를 문자열 검색으로 찾지 않는다: origin 이 &a= 를 품은 유효한 값이어도 g 는 a 바로 뒤에 놓인다", () => {
    const origin = "https://h&a=x";
    const plain = buildGatedShareUrl(bank, origin, personOf(0), personOf(3));
    expect(plain).not.toBeNull();
    expect(buildGatedShareUrlWithGuess(bank, origin, first(null), second(null))).toBe(plain);
    expect(buildGatedShareUrlWithGuess(bank, origin, first(guessA), second(guessB))).toBe(`${origin}/wedding-code#v=${V}&a=${A}&ga=${GA}&b=${B}&gb=${GB}`);
    expect(buildGatedShareUrlWithGuess(bank, origin, first(guessA))).toBe(`${origin}/wedding-code#v=${V}&a=${A}&ga=${GA}`);
  });

  it("관문이 닫힌 사람과 쓸 수 없는 origin 은 null 이다", () => {
    const closed: DecodedCode = { formBit: (gateClosed as { formBit: 0 | 1 }).formBit, responses: (gateClosed as { responses: DecodedCode["responses"] }).responses };
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, { code: closed, guess: guessA })).toBeNull();
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA), { code: closed, guess: guessB })).toBeNull();
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, { code: closed, guess: null })).toBeNull();
    const badOrigins = ["javascript:alert(1)", "//evil.example", `${ORIGIN}#frag`, `${ORIGIN}?q=1`, `${ORIGIN}/path`, "ftp://host", " https://hanbang.ai", `https://${"a".repeat(260)}`, "https://user@host"];
    for (const origin of badOrigins) {
      expect(buildGatedShareUrlWithGuess(bank, origin, first(guessA)), origin).toBeNull();
      expect(buildGatedShareUrlWithGuess(bank, origin, first(null)), origin).toBeNull();
    }
    expect(buildGatedShareUrlWithGuess(bank, 5 as unknown as string, first(guessA))).toBeNull();
  });

  it("만들 수 없는 g(고른 것이 하나도 없음, 지원하지 않는 세트)는 조용히 버리지 않고 null 이다", () => {
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first(answers(...none6)))).toBeNull();
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA), second(answers(...none6)))).toBeNull();
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first({ ...guessA, set: "2" } as unknown as GuessAnswers))).toBeNull();
  });

  it("사람이 없거나 이상한 입력에도 던지지 않는다", () => {
    expect(() => buildGatedShareUrlWithGuess(bank, ORIGIN, null as unknown as GuessedPerson)).not.toThrow();
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, null as unknown as GuessedPerson)).toBeNull();
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA), 5 as unknown as GuessedPerson)).toBeNull();
    // second 가 null 이나 undefined 이면 한 사람 링크다.
    expect(buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA), null as unknown as GuessedPerson)).toBe(buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA)));
  });

  it("가장 긴 정상 해시는 185자이고 주소 전체는 217자 안팎이다(상한 512 안쪽)", () => {
    const url = buildGatedShareUrlWithGuess(bank, ORIGIN, first(guessA), second(guessB)) as string;
    const hash = url.slice(url.indexOf("#") + 1);
    expect(hash).toHaveLength(15 + 3 + 70 + 4 + 8 + 3 + 70 + 4 + 8);
    expect(hash).toHaveLength(185);
    expect(hash.length).toBeLessThanOrEqual(MAX_SHARE_HASH_LENGTH);
    expect(url).toHaveLength(`${ORIGIN}/wedding-code#`.length + 185);
  });
});
