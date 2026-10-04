import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V30_VERSION } from "@/constants/weddingCodeV30";
import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { decodeCode, encodeCode } from "@/lib/weddingCode/v40/codec";
import { fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import { decodeGuessCode } from "@/lib/weddingCode/v40/guess/guessLink";
import type { GuessAnswers } from "@/lib/weddingCode/v40/guess/types";
import { parseWeddingCodeEntryHash, parseWeddingCodeEntryQuery, weddingCodeEntryHash, weddingCodeEntryKey, type WeddingCodeEntry } from "./entry";

/**
 * 입구(entry.ts)가 서로 짐작하기의 ga, gb 를 읽는 규칙(빌드 계획 4.2, 4.8, 4.13).
 * 링크 수준의 규칙은 guess/guessLink 가 맡고 입구는 그것을 부른다. 여기서는 입구가 끝에서 끝까지 같은 결과를 내는지 본다:
 * 해시의 키(허용, 중복, 순서), 쿼리의 거절, 다른 판의 거절, g 가 없을 때 옛 링크와 키 하나까지 같음, 해시 만들기와 key.
 * 골든 g 값(1148056W, 1401384H)은 계획 4.6 의 표다(guessLink 시험들이 따로 고정한다).
 */

const V40 = WEDDING_CODE_V40_VERSION;
const V31 = WEDDING_CODE_V31_VERSION;
const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), "utf8");
const specifiers = (source: string) => [...source.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/gu)].map((match) => match[1]);

function codeOf(name: string): string {
  const fixture = fixtureByName(name);
  if (!fixture) throw new Error(`고정 표본이 없어요: ${name}`);
  const code = encodeCode(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
  if (code === null) throw new Error(`코드를 만들 수 없어요: ${name}`);
  return code;
}

const A = codeOf("swua-example");
const B = codeOf("couple-partner");
const GA = "1148056W";
const GB = "1401384H";
/** 검사 글자만 틀린 g(길이와 세트 글자와 장면 글자는 모두 맞다). */
const BAD_G = "1148056X";

const decodedA = decodeCode(WEDDING_CODE_V40_BANK, A);
const decodedB = decodeCode(WEDDING_CODE_V40_BANK, B);
const guessA = decodeGuessCode(GA) as GuessAnswers;
const guessB = decodeGuessCode(GB) as GuessAnswers;

const V40_BROKEN = { kind: "error", version: V40 } as const;
const GENERIC_ERROR = { kind: "error" } as const;

describe("입구 ga, gb: 시험의 전제", () => {
  it("표본 코드와 골든 g 가 풀린다", () => {
    expect(decodedA).not.toBeNull();
    expect(decodedB).not.toBeNull();
    expect(guessA).not.toBeNull();
    expect(guessB).not.toBeNull();
    expect(decodeGuessCode(BAD_G)).toBeNull();
    expect(guessA).not.toEqual(guessB);
  });
});

describe("입구 ga, gb: {a, b, ga, gb} 각각 {좋은 값, 나쁜 값, 없음} 의 곱(계획 4.8)", () => {
  type Slot = "good" | "bad" | "none";
  const SLOTS: readonly Slot[] = ["good", "bad", "none"];

  function expectedEntry(a: Slot, b: Slot, ga: Slot, gb: Slot): WeddingCodeEntry {
    // 해시에는 a 가 꼭 있어야 하고, 나쁜 값이 하나라도 있으면 링크 전체를 거절하며, gb 는 b 가 있을 때만 허용한다.
    if (a !== "good") return V40_BROKEN;
    if (b === "bad" || ga === "bad" || gb === "bad") return V40_BROKEN;
    if (gb !== "none" && b === "none") return V40_BROKEN;
    if (b === "none") {
      return {
        kind: "v40",
        initial: ga === "good" ? { partner: decodedA!, both: null, guess: { first: guessA, second: null } } : { partner: decodedA!, both: null },
      };
    }
    const both = { first: decodedA!, second: decodedB! };
    if (ga === "none" && gb === "none") return { kind: "v40", initial: { partner: null, both } };
    return {
      kind: "v40",
      initial: { partner: null, both, guess: { first: ga === "good" ? guessA : null, second: gb === "good" ? guessB : null } },
    };
  }

  function hashOf(a: Slot, b: Slot, ga: Slot, gb: Slot): string {
    const pick = (slot: Slot, good: string, bad: string): string | null => (slot === "good" ? good : slot === "bad" ? bad : null);
    const parts: [string, string | null][] = [
      ["v", V40],
      ["a", pick(a, A, "broken")],
      ["ga", pick(ga, GA, BAD_G)],
      ["b", pick(b, B, "broken")],
      ["gb", pick(gb, GB, BAD_G)],
    ];
    return `#${parts.filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join("&")}`;
  }

  it("81가지가 모두 표대로 읽힌다(좋은 a 에 대해서는 나머지가 모두 표대로, 나쁜 a 와 없는 a 는 모두 v4 오류)", () => {
    let count = 0;
    let okCount = 0;
    for (const a of SLOTS) {
      for (const b of SLOTS) {
        for (const ga of SLOTS) {
          for (const gb of SLOTS) {
            const hash = hashOf(a, b, ga, gb);
            const expected = expectedEntry(a, b, ga, gb);
            expect(parseWeddingCodeEntryHash(hash), hash).toStrictEqual(expected);
            if (expected.kind === "v40") okCount += 1;
            count += 1;
          }
        }
      }
    }
    expect(count).toBe(81);
    // 읽히는 경우가 비어 있지 않다: a 좋음, b 는 좋음 또는 없음, ga 는 좋음 또는 없음, gb 는 b 가 좋을 때만 좋음 또는 없음 = (1 x 2 x 2) + 추가 gb 좋음 둘.
    expect(okCount).toBe(2 * 2 + 2);
  });

  it("깨진 ga 는 멀쩡한 a 를 버린다(한 사람의 답만 살리지 않는다)", () => {
    for (const hash of [`#v=${V40}&a=${A}&ga=${BAD_G}`, `#v=${V40}&a=${A}&ga=${GA.slice(0, -1)}`, `#v=${V40}&a=${A}&ga=`, `#v=${V40}&a=${A}&b=${B}&gb=${BAD_G}`, `#v=${V40}&a=${A}&b=${B}&ga=${BAD_G}&gb=${GB}`]) {
      expect(parseWeddingCodeEntryHash(hash), hash).toStrictEqual(V40_BROKEN);
    }
  });

  it("ga 만 있고 a 가 없으면, gb 만 있고 b 가 없으면 거절한다", () => {
    expect(parseWeddingCodeEntryHash(`#v=${V40}&ga=${GA}`)).toStrictEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryHash(`#v=${V40}&b=${B}&gb=${GB}`)).toStrictEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&gb=${GB}`)).toStrictEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&ga=${GA}&gb=${GB}`)).toStrictEqual(V40_BROKEN);
  });
});

describe("입구 ga, gb: 해시의 키", () => {
  const keys: readonly (readonly [string, string])[] = [["v", V40], ["a", A], ["ga", GA], ["b", B], ["gb", GB]];
  const canonical = `#${keys.map(([key, value]) => `${key}=${value}`).join("&")}`;

  function permutations<T>(list: readonly T[]): T[][] {
    if (list.length <= 1) return [[...list]];
    return list.flatMap((item, index) => permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [item, ...rest]));
  }

  it("키 순서를 어떻게 바꿔도(다섯 키의 120가지 순열) 같은 링크로 읽는다", () => {
    const expected = parseWeddingCodeEntryHash(canonical);
    expect(expected).toStrictEqual({ kind: "v40", initial: { partner: null, both: { first: decodedA, second: decodedB }, guess: { first: guessA, second: guessB } } });
    const orders = permutations(keys);
    expect(orders).toHaveLength(120);
    for (const order of orders) {
      const hash = `#${order.map(([key, value]) => `${key}=${value}`).join("&")}`;
      expect(parseWeddingCodeEntryHash(hash), hash).toStrictEqual(expected);
    }
  });

  it("# 없이도 읽는다", () => {
    expect(parseWeddingCodeEntryHash(canonical.slice(1))).toStrictEqual(parseWeddingCodeEntryHash(canonical));
  });

  it("같은 키가 둘이면(값이 같아도 달라도) 링크 전체를 거절한다", () => {
    for (const hash of [
      `${canonical}&ga=${GA}`, `${canonical}&ga=${GB}`, `${canonical}&gb=${GB}`, `${canonical}&gb=${GA}`,
      `#v=${V40}&a=${A}&ga=${GA}&ga=${GA}`, `#v=${V40}&a=${A}&ga=${GA}&ga=`,
    ]) {
      expect(parseWeddingCodeEntryHash(hash), hash).toStrictEqual(V40_BROKEN);
    }
  });

  it("g 로 시작하더라도 ga, gb 가 아닌 이름과 대소문자, 앞뒤 공백이 붙은 이름은 모르는 키라서 거절한다", () => {
    for (const name of ["g", "gc", "GA", "Ga", "gA", "ga ", " ga", "gaa", "g_a", "ga%20"]) {
      expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&${name}=${GA}`), name).toStrictEqual(V40_BROKEN);
    }
  });

  it("주소의 퍼센트 부호는 URLSearchParams 가 풀고 나서 읽는다: 풀면 맞는 g 는 받아들이고, 풀어도 전각이거나 다른 글자이면 거절한다(a 가 이미 그렇게 읽힌다)", () => {
    // 입구는 엄격한 해시 읽기(parseGuessedShareHash)가 아니라 URLSearchParams 로 읽는다. 앱이 받아들이는 것이 무엇인지를 여기서 못박는다.
    const encoded = `#v=${V40}&a=${A}&ga=%31${GA.slice(1)}`;
    expect(parseWeddingCodeEntryHash(encoded)).toStrictEqual(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&ga=${GA}`));
    expect(parseWeddingCodeEntryHash(encoded)).toMatchObject({ kind: "v40", initial: { guess: { first: guessA } } });
    for (const value of ["%EF%BC%91148056W", "%00148056W", "%31148056%57X", "%GG148056W"]) {
      expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&ga=${value}`), value).toStrictEqual(V40_BROKEN);
    }
  });

  it("소문자로 바꾼 검사 글자, 전각 글자, 앞에 공백이 붙은 g 는 거절한다", () => {
    for (const value of [GA.toLowerCase(), "１148056W", ` ${GA}`, `${GA}0`, GA.slice(1)]) {
      expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&ga=${value}`), JSON.stringify(value)).toStrictEqual(V40_BROKEN);
    }
  });

  /**
   * 2026-10-04 파운더 결정(감사 A46): 링크 끝에 붙은 문장부호, 공백, 조사는 한 번 걷어낸 결과가 정확히 같을 때만 읽는다. g 도 a, b 와 같다(8자 g 는 검사 글자로 끝난다).
   * 걷어낼 수 없는 것(영문자나 숫자가 더 붙음, 앞의 글자)과 검사 글자가 틀린 g 는 그대로 거절한다.
   */
  it("g 끝에 붙은 공백과 문장부호는 한 번 걷어내고 읽는다(검사 글자와 길이는 그대로 요구한다)", () => {
    const expected = parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&ga=${GA}`);
    expect(expected).toMatchObject({ kind: "v40", initial: { guess: { first: guessA } } });
    for (const tail of [" ", ".", ")", "요", "!!", "?", "~", "-", "_"]) {
      expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&ga=${GA}${tail}`), JSON.stringify(tail)).toStrictEqual(expected);
    }
    // 틀린 g 는 끝 글자를 걷어내도 체크섬이 맞지 않아 거절한다.
    expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&ga=${GA.slice(0, -1)}X.`)).toStrictEqual(V40_BROKEN);
  });
});

describe("입구 ga, gb: 쿼리에 실려 오면 서버가 보게 되므로 읽지 않는다", () => {
  it("v4 의 쿼리에 ga 나 gb 가 오면(a 와 함께든 아니든) v4 오류다", () => {
    for (const query of [{ v: V40, ga: GA }, { v: V40, gb: GB }, { v: V40, ga: GA, gb: GB }, { v: V40, a: A, ga: GA }, { v: V40, a: A, b: B, ga: GA, gb: GB }, { v: V40, ga: "" }, { v: V40, ga: "broken" }]) {
      expect(parseWeddingCodeEntryQuery(query), JSON.stringify(query)).toStrictEqual(V40_BROKEN);
    }
    expect(parseWeddingCodeEntryQuery(new URLSearchParams(`v=${V40}&ga=${GA}`))).toStrictEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryQuery(new URLSearchParams(`v=${V40}&a=${A}&ga=${GA}`))).toStrictEqual(V40_BROKEN);
  });

  it("v4 를 가리키며 ga, gb 가 배열(반복된 키)로 오면 v4 오류다", () => {
    for (const query of [{ v: V40, ga: [GA, GA] }, { v: V40, gb: [GB] }, { ga: [GA, GA], v: [V40] }, { v: [V40], gb: [GB, GB] }]) {
      expect(parseWeddingCodeEntryQuery(query), JSON.stringify(query)).toStrictEqual(V40_BROKEN);
    }
    expect(parseWeddingCodeEntryQuery(new URLSearchParams(`v=${V40}&ga=${GA}&ga=${GA}`))).toStrictEqual(V40_BROKEN);
  });

  it("v4 가 아닌 쿼리의 ga 는 예전처럼 모르는 키다(맨 주소는 맨 주소의 입구를 연다)", () => {
    expect(parseWeddingCodeEntryQuery({ ga: GA })).toStrictEqual(parseWeddingCodeEntryQuery({}));
    expect(parseWeddingCodeEntryQuery({ ga: [GA, GA] })).toStrictEqual(parseWeddingCodeEntryQuery({}));
    expect(parseWeddingCodeEntryQuery({ v: V31, ga: GA })).toStrictEqual(GENERIC_ERROR);
  });
});

describe("입구 ga, gb: 다른 판의 링크에 ga 가 붙으면 예전처럼 거절한다", () => {
  it("v 가 없거나 v3.1 이거나 다른 판인 해시의 ga, gb 는 모르는 키(예전 오류)이고 v4 오류가 아니다", () => {
    for (const hash of [
      `#a=${A}&ga=${GA}`, `#v=${V31}&a=${A}&ga=${GA}`, `#v=${V31}&a=${A}&b=${B}&gb=${GB}`, `#v=${WEDDING_CODE_V30_VERSION}&a=${A}&ga=${GA}`, `#v=v9-unknown&a=${A}&ga=${GA}`, `#v=v2.0-agreement&a=${A}&gb=${GB}`,
    ]) {
      expect(parseWeddingCodeEntryHash(hash), hash).toStrictEqual(GENERIC_ERROR);
    }
  });
});

describe("입구 ga, gb: 짐작이 없는 링크는 옛 링크와 키 하나까지 같다", () => {
  it("g 가 없으면 initial 에 guess 키가 없다(toStrictEqual 이 키 유무까지 본다)", () => {
    const solo = parseWeddingCodeEntryHash(`#v=${V40}&a=${A}`);
    const pair = parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&b=${B}`);
    expect(solo).toStrictEqual({ kind: "v40", initial: { partner: decodedA, both: null } });
    expect(pair).toStrictEqual({ kind: "v40", initial: { partner: null, both: { first: decodedA, second: decodedB } } });
    expect(solo !== null && solo.kind === "v40" && "guess" in solo.initial).toBe(false);
    expect(pair !== null && pair.kind === "v40" && "guess" in pair.initial).toBe(false);
  });

  it("한 사람의 g 만 있으면 guess 에 그 쪽만 들고 다른 쪽은 null 이다", () => {
    expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&ga=${GA}`)).toStrictEqual({ kind: "v40", initial: { partner: decodedA, both: null, guess: { first: guessA, second: null } } });
    expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}&b=${B}&gb=${GB}`)).toStrictEqual({
      kind: "v40",
      initial: { partner: null, both: { first: decodedA, second: decodedB }, guess: { first: null, second: guessB } },
    });
  });
});

describe("입구 ga, gb: 해시 만들기와 진입 key", () => {
  const withGuess = `#v=${V40}&a=${A}&ga=${GA}&b=${B}&gb=${GB}`;

  it("읽은 링크를 해시로 되돌리면 정규 순서(v, a, ga, b, gb)의 원래 링크와 같다", () => {
    for (const hash of [`#v=${V40}&a=${A}&ga=${GA}`, withGuess, `#v=${V40}&a=${A}&b=${B}&gb=${GB}`, `#v=${V40}&a=${A}&ga=${GA}&b=${B}`, `#v=${V40}&a=${A}`, `#v=${V40}&a=${A}&b=${B}`]) {
      const entry = parseWeddingCodeEntryHash(hash)!;
      expect(weddingCodeEntryHash(entry), hash).toBe(hash);
      expect(parseWeddingCodeEntryHash(weddingCodeEntryHash(entry)!), hash).toStrictEqual(entry);
    }
    // 키 순서를 뒤섞어 넣어도 되돌린 해시는 정규 순서다.
    expect(weddingCodeEntryHash(parseWeddingCodeEntryHash(`#gb=${GB}&b=${B}&ga=${GA}&a=${A}&v=${V40}`)!)).toBe(withGuess);
  });

  it("답이 같고 짐작만 다른 두 링크는 다른 key 라서 같은 클라이언트 state 를 다시 쓰지 않는다", () => {
    const entries = [`#v=${V40}&a=${A}`, `#v=${V40}&a=${A}&ga=${GA}`, `#v=${V40}&a=${A}&ga=${GB}`, `#v=${V40}&a=${A}&b=${B}`, `#v=${V40}&a=${A}&b=${B}&gb=${GB}`, `#v=${V40}&a=${A}&b=${B}&gb=${GA}`, withGuess].map((hash) => parseWeddingCodeEntryHash(hash)!);
    expect(new Set(entries.map(weddingCodeEntryKey)).size).toBe(entries.length);
    // g 가 없는 링크의 key 는 예전 그대로(해시 자체)다.
    expect(weddingCodeEntryKey(entries[0])).toBe(`#v=${V40}&a=${A}`);
    expect(weddingCodeEntryKey(entries[3])).toBe(`#v=${V40}&a=${A}&b=${B}`);
    expect(weddingCodeEntryKey(entries[6])).toBe(withGuess);
  });

  it("짐작이 있는데 g 를 만들 수 없으면(고른 것이 하나도 없음) 해시를 만들지 않는다(조용히 g 를 빼지 않는다)", () => {
    const empty: GuessAnswers = { set: "1", slots: [{ self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }] };
    const entry: WeddingCodeEntry = { kind: "v40", initial: { partner: decodedA!, both: null, guess: { first: empty, second: null } } };
    expect(weddingCodeEntryHash(entry)).toBeNull();
    const both: WeddingCodeEntry = { kind: "v40", initial: { partner: null, both: { first: decodedA!, second: decodedB! }, guess: { first: guessA, second: empty } } };
    expect(weddingCodeEntryHash(both)).toBeNull();
  });
});

describe("입구 ga, gb: 가져오는 모듈", () => {
  it("입구 파일이 새로 가져오는 v4 모듈은 링크 코덱(guess/guessLink) 하나이고, 그 파일은 문구, 은행, 세트 자료, 화면을 가져오지 않는다", () => {
    const entryImports = specifiers(read("entry.ts")).filter((spec) => /guess/iu.test(spec));
    expect(entryImports).toEqual(["@/lib/weddingCode/v40/guess/guessLink"]);
    const linkImports = [...new Set(specifiers(read("../../lib/weddingCode/v40/guess/guessLink.ts")))].sort();
    expect(linkImports).toEqual(["../codec", "../states", "../types", "./guessContract", "./types", "@/constants/weddingCodeV40"].sort());
    // 짐작 파일 어디도 입구가 쓰지 못하는 큰 것(화면 문구, 문항 은행, 세트 자료)을 가져오지 않는다.
    // 타입만 낸다: 계약과 타입 파일이 가져오는 것도 코어 타입과 서로뿐이다(문구, 은행, 세트 자료, 화면, 통계 없음).
    expect(specifiers(read("../../lib/weddingCode/v40/guess/guessContract.ts")).sort()).toEqual(["../types", "./types"]);
    expect(specifiers(read("../../lib/weddingCode/v40/guess/types.ts"))).toEqual(["../types"]);
    for (const spec of linkImports) expect(/copy|bank|weddingCodeV40Guess|components|analytics|fetch/iu.test(spec), spec).toBe(false);
  });
});
