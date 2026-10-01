/**
 * 「서로 짐작하기」 링크 코덱(guessLink.ts)과 기준 계산기(scripts/lib/wedding-code-v41-guess-ref.mjs)의 거울 증명(빌드 계획 4.12, M1에서 M8).
 *
 * 기준 계산기는 계획의 명세 글(4.3, 4.7, 4.8, 4.9, 5.4)에서 다시 구현한 순수 JS 다(TS 구현의 스케치를 베끼지 않았다). 이 파일은 셋을 대조한다:
 * TS 구현, JS 기준 계산기, 그리고 이 파일 안에서 4.7 의 술어를 글 그대로 옮긴 세 번째 판정(specAccepts). 전수 대조(M1, M8)는 수십만 건이라
 * 기본 15초 시간 제한이 거짓 빨강을 낼 수 있어 시간 제한을 60초로 명시한다(이 저장소는 vitest 일꾼 둘).
 */
import { describe, expect, it } from "vitest";
import * as v40ref from "../../../../../../../scripts/lib/wedding-code-v40-ref.mjs";
import * as guessRef from "../../../../../../../scripts/lib/wedding-code-v41-guess-ref.mjs";
import { V40_BANK_DATA } from "@/constants/weddingCodeV40Bank";
import { V40_STATE_ALPHABET, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { parseWeddingCodeEntryHash } from "@/app/wedding-code/entry";
import { WEDDING_CODE_V40_BANK as bank } from "../bank";
import { buildGatedShareUrl, encodeCode } from "../codec";
import { V40_FIXTURES } from "../fixtures";
import { buildResult } from "../score";
import type { DecodedCode } from "../types";
import { compareGuesses } from "./guessCompare";
import { guessAnswers } from "./guessFixtures";
import {
  buildGatedShareUrlWithGuess,
  decodeGuessCode,
  decodeGuessedShareParams,
  encodeGuessCode,
  guessChecksumChar,
  parseGuessedShareHash,
} from "./guessLink";
import type { GuessAnswers, GuessPick, GuessedPerson } from "./types";

interface GuessRefApi {
  GUESS_SET_IDS: readonly string[];
  guessChecksumChar(body: string): string;
  encodeGuessCode(answers: unknown): string | null;
  decodeGuessCode(code: unknown): unknown;
  decodeGuessedShareParams(bank: unknown, raw: unknown): unknown;
  buildShareUrlWithGuess(bank: unknown, origin: unknown, first: unknown, second?: unknown): string | null;
  parseGuessedShareHash(bank: unknown, hash: unknown): unknown;
  compareGuesses(first: unknown, second: unknown): unknown;
}
interface V40RefApi {
  makeBank(data: unknown): unknown;
  mulberry32(seed: number): () => number;
}

const ref = guessRef as unknown as GuessRefApi;
const v40 = v40ref as unknown as V40RefApi;
const oracleBank = v40.makeBank(V40_BANK_DATA);

const V = WEDDING_CODE_V40_VERSION;
const ALPHABET = V40_STATE_ALPHABET;
const SLOT_CHARS = "012345678";

/** 4.7 의 술어를 글 그대로 옮긴 세 번째 판정: 길이 8, 세트 글자 1, 장면 글자 여섯이 0에서 8, 모두 8 이 아님, 검사 글자가 맞음. */
function specAccepts(code: unknown): boolean {
  if (typeof code !== "string" || code.length !== 8) return false;
  if (code[0] !== "1") return false;
  for (let i = 1; i <= 6; i += 1) if (code[i] < "0" || code[i] > "8" || code[i].length !== 1) return false;
  if (code.slice(1, 7) === "888888") return false;
  let total = 0;
  for (let i = 0; i < 7; i += 1) total += (i + 1) * ALPHABET.indexOf(code[i]);
  return code[7] === ALPHABET[total % 61];
}
const specChecksum = (body: string): string => {
  let total = 0;
  for (let i = 0; i < body.length; i += 1) total += (i + 1) * ALPHABET.indexOf(body[i]);
  return ALPHABET[total % 61];
};

const pick = (value: number): GuessPick => (value === 2 ? null : (value as GuessPick));
function randomAnswers(rng: () => number, set = "1"): GuessAnswers {
  const slots = Array.from({ length: 6 }, () => [pick(Math.floor(rng() * 3)), pick(Math.floor(rng() * 3))] as const);
  return { ...guessAnswers(...(slots as unknown as readonly (readonly [GuessPick, GuessPick])[])), set } as GuessAnswers;
}

describe("M1 검사 글자 전수 대조", () => {
  it("몸통 1 + 장면 글자 여섯의 모든 경우(531,441)에서 TS, JS, 글 그대로의 술어가 같은 글자를 낸다", { timeout: 60_000 }, () => {
    let count = 0;
    const digits = [0, 0, 0, 0, 0, 0];
    for (let n = 0; n < 9 ** 6; n += 1) {
      let rest = n;
      for (let i = 5; i >= 0; i -= 1) {
        digits[i] = rest % 9;
        rest = Math.floor(rest / 9);
      }
      const body = `1${digits.join("")}`;
      const expected = specChecksum(body);
      if (guessChecksumChar(body) !== expected || ref.guessChecksumChar(body) !== expected) {
        throw new Error(`검사 글자가 갈렸다: ${body}`);
      }
      count += 1;
    }
    expect(count).toBe(531_441);
  });

  it("세트 글자 62가지 x 무작위 몸통, 길이 1에서 20 의 무작위 알파벳 열도 같다", { timeout: 60_000 }, () => {
    const rng = v40.mulberry32(41_001);
    let count = 0;
    for (const set of ALPHABET) {
      for (let k = 0; k < 40; k += 1) {
        const body = set + Array.from({ length: 6 }, () => SLOT_CHARS[Math.floor(rng() * 9)]).join("");
        expect(guessChecksumChar(body)).toBe(specChecksum(body));
        expect(ref.guessChecksumChar(body)).toBe(specChecksum(body));
        count += 1;
      }
    }
    for (let k = 0; k < 1500; k += 1) {
      const length = 1 + Math.floor(rng() * 20);
      const body = Array.from({ length }, () => ALPHABET[Math.floor(rng() * ALPHABET.length)]).join("");
      expect(guessChecksumChar(body), body).toBe(specChecksum(body));
      expect(ref.guessChecksumChar(body), body).toBe(specChecksum(body));
      count += 1;
    }
    expect(count).toBeGreaterThan(3900);
  });

  it("알파벳 밖 문자가 들면 둘 다 RangeError 다", () => {
    for (const body of ["1!", "-", "한", "1 2", "é", "1😀"]) {
      expect(() => guessChecksumChar(body), body).toThrow(RangeError);
      expect(() => ref.guessChecksumChar(body), body).toThrow(RangeError);
    }
  });
});

describe("M2 무작위 짐작과 고름 3,000개", () => {
  it("TS 인코드 = JS 인코드, 왕복이 같고, 고른 것이 없으면 둘 다 null 이다", () => {
    const rng = v40.mulberry32(42_002);
    let informative = 0;
    let empty = 0;
    for (let i = 0; i < 3000; i += 1) {
      const answers = i % 11 === 0 ? guessAnswers([null, null], [null, null], [null, null], [null, null], [null, null], [null, null]) : randomAnswers(rng);
      const ts = encodeGuessCode(answers);
      const js = ref.encodeGuessCode(answers);
      expect(ts, `#${i}`).toBe(js);
      if (ts === null) {
        empty += 1;
        continue;
      }
      informative += 1;
      expect(decodeGuessCode(ts), `#${i}`).toEqual(answers);
      expect(ref.decodeGuessCode(ts), `#${i}`).toEqual(answers);
      expect(specAccepts(ts), `#${i}`).toBe(true);
    }
    expect(informative).toBeGreaterThan(2500);
    expect(empty).toBeGreaterThan(200);
  });

  it("지원하지 않는 세트 글자와 모양이 어긋난 입력은 둘 다 null 이다", () => {
    const rng = v40.mulberry32(42_003);
    for (let i = 0; i < 100; i += 1) {
      const answers = randomAnswers(rng, ALPHABET[2 + (i % 60)]);
      expect(encodeGuessCode(answers), `${answers.set}`).toBeNull();
      expect(ref.encodeGuessCode(answers), `${answers.set}`).toBeNull();
    }
    const odd = [null, undefined, 0, "1148056W", {}, { set: "1" }, { set: "1", slots: [] }, { set: "1", slots: Array.from({ length: 6 }, () => ({ self: 3, guess: 0 })) }];
    for (const value of odd) {
      expect(encodeGuessCode(value as unknown as GuessAnswers), String(value)).toBeNull();
      expect(ref.encodeGuessCode(value), String(value)).toBeNull();
    }
  });
});

describe("M3 손상 코퍼스: 둘의 판정이 같고 글 그대로의 술어와도 같다", () => {
  const rng = v40.mulberry32(43_003);
  const bases = [
    "1148056W", "1401384H", "1252525D", "1676767U", "1888885d", "10000001", "1444444M",
    ...Array.from({ length: 30 }, () => encodeGuessCode(randomAnswers(rng)) ?? "10000001"),
  ];
  const strange = ["-", "_", " ", "한", "é", "Ａ", "０", "\t", "\n", "٣", "😀"];

  function verdictsAgree(code: string, label: string): boolean {
    const ts = decodeGuessCode(code) !== null;
    const js = ref.decodeGuessCode(code) !== null;
    const spec = specAccepts(code);
    if (ts !== js || ts !== spec) throw new Error(`판정이 갈렸다 ${label}: ${JSON.stringify(code)} ts ${ts} js ${js} spec ${spec}`);
    return ts;
  }

  it("자리 x 알파벳 62 x 이상한 글자 치환, 그리고 치환마다 검사 글자를 맞게 다시 계산한 위조도 같은 판정이다", () => {
    let accepted = 0;
    let rejectedDespiteGoodCheck = 0;
    let total = 0;
    for (const base of bases) {
      for (let position = 0; position < 8; position += 1) {
        for (const replacement of [...ALPHABET, ...strange]) {
          const mutated = base.slice(0, position) + replacement + base.slice(position + 1);
          total += 1;
          verdictsAgree(mutated, `치환 ${base} ${position}`);
          if (position < 7 && mutated.length === 8) {
            // 위조: 몸통을 바꾸고 검사 글자를 맞게 다시 계산한다. 범위 밖 글자, 다른 세트 글자, 전부 8 은 검사 글자가 맞아도 거절돼야 한다.
            const body = mutated.slice(0, 7);
            let forged: string;
            try {
              forged = body + specChecksum(body);
            } catch {
              continue;
            }
            if (!/^[0-9a-zA-Z]{7}$/.test(body)) continue;
            const ok = verdictsAgree(forged, `위조 ${base} ${position}`);
            if (ok) accepted += 1;
            else if (guessChecksumChar(body) === forged[7]) rejectedDespiteGoodCheck += 1;
          }
        }
      }
    }
    expect(total).toBeGreaterThan(20_000);
    // 이 시험이 헛돌지 않게: 위조 가운데 받아들여지는 것(범위 안의 다른 장면 글자)과 검사 글자가 맞는데도 규칙이 거절하는 것이 모두 많다.
    expect(accepted).toBeGreaterThan(100);
    expect(rejectedDespiteGoodCheck).toBeGreaterThan(1000);
  });

  it("자르기, 늘리기, 맞바꿈, 대소문자, 전각, 공백도 같은 판정이다", () => {
    let total = 0;
    for (const base of bases) {
      for (let cut = 0; cut <= 8; cut += 1) {
        verdictsAgree(base.slice(0, cut), "자르기");
        verdictsAgree(base.slice(cut), "앞 자르기");
        total += 2;
      }
      for (const extra of ["0", "W", " ", "\n", "888"]) {
        verdictsAgree(base + extra, "뒤 늘리기");
        verdictsAgree(extra + base, "앞 늘리기");
        total += 2;
      }
      for (let i = 0; i < 8; i += 1) {
        for (let j = i + 1; j < 8; j += 1) {
          const chars = [...base];
          [chars[i], chars[j]] = [chars[j], chars[i]];
          verdictsAgree(chars.join(""), "맞바꿈");
          total += 1;
        }
      }
      verdictsAgree(base.toLowerCase(), "소문자");
      verdictsAgree(base.toUpperCase(), "대문자");
      verdictsAgree(base.replace(/\d/g, (digit) => String.fromCharCode(0xff10 + Number(digit))), "전각");
      verdictsAgree(` ${base}`, "앞 공백");
      verdictsAgree(`${base} `, "뒤 공백");
      verdictsAgree(`${base}\n`, "뒤 줄바꿈");
      total += 6;
    }
    expect(total).toBeGreaterThan(2000);
  });
});

// ---------------------------------------------------------------------------
// M4 링크 조립, M5 링크 수준, M6 입구와 해시 읽기
// ---------------------------------------------------------------------------

const openFixtures = V40_FIXTURES.filter((fixture) => buildResult(bank, fixture.formBit, fixture.responses).code !== null);
const closedFixture = V40_FIXTURES.find((fixture) => buildResult(bank, fixture.formBit, fixture.responses).code === null) as (typeof V40_FIXTURES)[number];
const personOf = (index: number): DecodedCode => ({ formBit: openFixtures[index % openFixtures.length].formBit, responses: openFixtures[index % openFixtures.length].responses });
const closedPerson: DecodedCode = { formBit: closedFixture.formBit, responses: closedFixture.responses };
const codeOf = (person: DecodedCode): string => encodeCode(bank, person.formBit, person.responses) as string;

const GA = "1148056W";
const GB = "1401384H";
const guessA = decodeGuessCode(GA) as GuessAnswers;
const guessB = decodeGuessCode(GB) as GuessAnswers;

describe("M4 링크 조립", () => {
  it("고정 표본 쌍 x g 조합 넷 x origin 셋: TS 주소 = JS 주소이고 g 가 없으면 buildGatedShareUrl 과 같다", () => {
    let count = 0;
    const origins = ["https://hanbang.ai", "http://localhost:3000", ""];
    const combos: readonly (readonly [GuessAnswers | null, GuessAnswers | null])[] = [[null, null], [guessA, null], [null, guessB], [guessA, guessB]];
    for (let index = 0; index < openFixtures.length; index += 1) {
      for (const origin of origins) {
        for (const [ga, gb] of combos) {
          const first: GuessedPerson = { code: personOf(index), guess: ga };
          const second: GuessedPerson = { code: personOf(index + 3), guess: gb };
          const ts = buildGatedShareUrlWithGuess(bank, origin, first, second);
          expect(ts, `${index} ${origin}`).toBe(ref.buildShareUrlWithGuess(oracleBank, origin, first, second));
          expect(ts, `${index} ${origin}`).not.toBeNull();
          if (ga === null && gb === null) expect(ts).toBe(buildGatedShareUrl(bank, origin, first.code, second.code));
          const single = buildGatedShareUrlWithGuess(bank, origin, first);
          expect(single).toBe(ref.buildShareUrlWithGuess(oracleBank, origin, first));
          if (ga === null) expect(single).toBe(buildGatedShareUrl(bank, origin, first.code));
          count += 2;
        }
      }
    }
    expect(count).toBeGreaterThan(250);
  });

  it("관문이 닫힌 표본 쌍과 나쁜 origin 은 둘 다 null 이고 origin https://h&a=x 는 둘 다 같은 주소를 낸다", () => {
    const open: GuessedPerson = { code: personOf(0), guess: guessA };
    const closed: GuessedPerson = { code: closedPerson, guess: guessB };
    for (const [first, second] of [[closed, undefined], [open, closed], [closed, open], [{ ...closed, guess: null }, undefined]] as const) {
      expect(buildGatedShareUrlWithGuess(bank, "https://hanbang.ai", first, second)).toBeNull();
      expect(ref.buildShareUrlWithGuess(oracleBank, "https://hanbang.ai", first, second)).toBeNull();
    }
    const longHost = `https://${"a".repeat(256)}`;
    for (const origin of ["javascript:alert(1)", "//host", "https://hanbang.ai#frag", "https://hanbang.ai?q=1", "https://hanbang.ai/path", longHost, "ftp://host", "https://u@h", " https://h"]) {
      expect(buildGatedShareUrlWithGuess(bank, origin, open), origin).toBeNull();
      expect(ref.buildShareUrlWithGuess(oracleBank, origin, open), origin).toBeNull();
    }
    const odd = "https://h&a=x";
    const both = [{ code: personOf(1), guess: guessA }, { code: personOf(5), guess: guessB }] as const;
    expect(buildGatedShareUrlWithGuess(bank, odd, both[0], both[1])).toBe(ref.buildShareUrlWithGuess(oracleBank, odd, both[0], both[1]));
    expect(buildGatedShareUrlWithGuess(bank, odd, both[0], both[1])).toBe(`${odd}/wedding-code#v=${V}&a=${codeOf(personOf(1))}&ga=${GA}&b=${codeOf(personOf(5))}&gb=${GB}`);
  });

  it("만들 수 없는 g(고른 것이 없음)도 둘 다 null 이다", () => {
    const empty = guessAnswers([null, null], [null, null], [null, null], [null, null], [null, null], [null, null]);
    const first: GuessedPerson = { code: personOf(0), guess: empty };
    expect(buildGatedShareUrlWithGuess(bank, "https://hanbang.ai", first)).toBeNull();
    expect(ref.buildShareUrlWithGuess(oracleBank, "https://hanbang.ai", first)).toBeNull();
  });
});

describe("M5 링크 수준 판정의 곱", () => {
  it("{a, b, ga, gb} 각각 {좋은 값, 나쁜 값, null} 의 81가지 x 표본 쌍 여섯", () => {
    const states = ["good", "bad", "null"] as const;
    let count = 0;
    for (let pair = 0; pair < 6; pair += 1) {
      const a = codeOf(personOf(pair));
      const b = codeOf(personOf(pair + 4));
      for (const sa of states) for (const sb of states) for (const sga of states) for (const sgb of states) {
        const raw = {
          a: sa === "null" ? null : sa === "good" ? a : `${a.slice(0, 69)}${a[69] === "0" ? "1" : "0"}`,
          b: sb === "null" ? null : sb === "good" ? b : "broken",
          ga: sga === "null" ? null : sga === "good" ? GA : "1948056d",
          gb: sgb === "null" ? null : sgb === "good" ? GB : "1148056X",
        };
        expect(decodeGuessedShareParams(bank, raw), JSON.stringify([pair, sa, sb, sga, sgb])).toEqual(ref.decodeGuessedShareParams(oracleBank, raw));
        count += 1;
      }
    }
    expect(count).toBe(486);
  });
});

describe("M6 해시 읽기와 입구", () => {
  const a = codeOf(personOf(0));
  const b = codeOf(personOf(3));
  const keys: readonly (readonly [string, string])[] = [["v", V], ["a", a], ["ga", GA], ["b", b], ["gb", GB]];

  function hashVectors(): string[] {
    const vectors = new Set<string>();
    const subsets = [[0, 1], [0, 1, 2], [0, 1, 3], [0, 1, 3, 4], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 2], [0, 4], [1, 2], [0, 3], [0, 1, 4]];
    const rotate = <T,>(list: readonly T[], by: number): T[] => [...list.slice(by), ...list.slice(0, by)];
    for (const subset of subsets) {
      const parts = subset.map((index) => `${keys[index][0]}=${keys[index][1]}`);
      for (let by = 0; by < parts.length; by += 1) {
        vectors.add(`#${rotate(parts, by).join("&")}`);
        vectors.add(rotate(parts, by).join("&"));
      }
      vectors.add(`#${[...parts].reverse().join("&")}`);
    }
    for (const bad of [`ga=${GA}x`, "ga=", "ga", "gc=1", `ga=${GA}&ga=${GA}`, `gb=${GB.toLowerCase()}`]) vectors.add(`#v=${V}&a=${a}&${bad}`);
    vectors.add("");
    vectors.add("#");
    vectors.add(`#v=${V}`);
    return [...vectors];
  }

  it("벡터 약 60 에서 TS 파서 = JS 파서 이고 만든 링크의 읽기와 같다", () => {
    const vectors = hashVectors();
    expect(vectors.length).toBeGreaterThan(55);
    for (const hash of vectors) expect(parseGuessedShareHash(bank, hash), hash).toEqual(ref.parseGuessedShareHash(oracleBank, hash));
  });

  it("길이 512 경계: 상한 안쪽은 읽고 넘으면 invalid 이다(파서끼리만 견준다: 입구의 상한은 따로 12,000자다)", () => {
    const base = `#v=${V}&a=${a}&ga=${GA}&b=${b}&gb=${GB}`;
    for (const extra of [0, 1, 100, 512 - (base.length - 1), 512 - (base.length - 1) + 1, 600]) {
      const hash = extra === 0 ? base : `${base}&${"q".repeat(Math.max(0, extra - 1))}`;
      expect(parseGuessedShareHash(bank, hash), `${hash.length}`).toEqual(ref.parseGuessedShareHash(oracleBank, hash));
    }
    expect(parseGuessedShareHash(bank, `${base}&${"q".repeat(512)}`)).toEqual({ kind: "invalid" });
  });

  it("문자열이 아닌 값과 없는 값도 같다", () => {
    for (const value of [null, undefined, 5, {}, [], true]) {
      expect(parseGuessedShareHash(bank, value as string), String(value)).toEqual(ref.parseGuessedShareHash(oracleBank, value));
    }
  });

  // 입구(entry.ts)가 ga, gb 를 읽는 변경은 통합자의 몫이다(계획 4.13). 변경이 들어오면 이 대조가 저절로 돈다: 입구와 해시 읽기가 같은 벡터에서 같은 판정을 내야 한다.
  const entrySupportsGuess = (() => {
    try {
      return parseWeddingCodeEntryHash(`#v=${V}&a=${a}&ga=${GA}`)?.kind === "v40";
    } catch {
      return false;
    }
  })();
  it.skipIf(!entrySupportsGuess)("입구의 읽기와 해시 읽기가 같은 벡터에서 같은 판정이다(키 순서 바꿔 넣기 포함)", () => {
    for (const hash of hashVectors()) {
      if (hash === "" || hash === "#" || hash === `#v=${V}`) continue;
      const parsed = parseGuessedShareHash(bank, hash);
      const entry = parseWeddingCodeEntryHash(hash.startsWith("#") ? hash : `#${hash}`);
      if (parsed.kind === "none" || parsed.kind === "invalid") {
        expect(entry === null || entry.kind === "error" || (entry.kind === "v40" && entry.initial.partner === null && entry.initial.both === null), hash).toBe(true);
        continue;
      }
      expect(entry?.kind, hash).toBe("v40");
      if (entry?.kind !== "v40") continue;
      const guess = (entry.initial as { guess?: { first: GuessAnswers | null; second: GuessAnswers | null } }).guess ?? null;
      if (parsed.kind === "partner") {
        expect(entry.initial.partner, hash).toEqual(parsed.first);
        expect(guess?.first ?? null, hash).toEqual(parsed.firstGuess);
      } else {
        expect(entry.initial.both, hash).toEqual({ first: parsed.first, second: parsed.second });
        expect(guess?.first ?? null, hash).toEqual(parsed.firstGuess);
        expect(guess?.second ?? null, hash).toEqual(parsed.secondGuess);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// M7 골든 벡터를 TS 와 JS 에 각각 고정한다
// ---------------------------------------------------------------------------

describe("M7 골든 벡터", () => {
  const GOLDEN: readonly (readonly [readonly (readonly [number, number])[], string])[] = [
    [[[0, 1], [1, 1], [2, 2], [0, 0], [1, 2], [2, 0]], "1148056W"],
    [[[1, 1], [0, 0], [0, 1], [1, 0], [2, 2], [1, 1]], "1401384H"],
    [[[0, 2], [1, 2], [0, 2], [1, 2], [0, 2], [1, 2]], "1252525D"],
    [[[2, 0], [2, 1], [2, 0], [2, 1], [2, 0], [2, 1]], "1676767U"],
    [[[2, 2], [2, 2], [2, 2], [2, 2], [2, 2], [1, 2]], "1888885d"],
    [[[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], "10000001"],
    [[[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]], "1444444M"],
  ];
  const REJECT = [
    "1888888y", "2148056X", "0148056V", "1948056d", "1a48056f", "1Z48056U", "1148059i",
    "1148056", "1148056W0", "", "1148056X", "2148056W", "1148056w", "１148056W", " 1148056W", "1148056W ",
  ];

  it("받아들일 일곱은 TS 와 JS 모두 같은 글자열이다", () => {
    for (const [pairs, code] of GOLDEN) {
      const input = guessAnswers(...pairs.map(([s, g]): readonly [GuessPick, GuessPick] => [pick(s), pick(g)]));
      expect(encodeGuessCode(input)).toBe(code);
      expect(ref.encodeGuessCode(input)).toBe(code);
      expect(decodeGuessCode(code)).toEqual(input);
      expect(ref.decodeGuessCode(code)).toEqual(input);
    }
  });

  it("거절 열여섯(과 null, 숫자)은 TS 와 JS 모두 거절한다", () => {
    for (const code of [...REJECT, null, 11480560]) {
      expect(decodeGuessCode(code as string), String(code)).toBeNull();
      expect(ref.decodeGuessCode(code), String(code)).toBeNull();
    }
    expect(REJECT).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// M8 전수
// ---------------------------------------------------------------------------

describe("M8 전수", () => {
  it("모든 몸통의 왕복(531,440): 만든 코드를 TS 와 JS 가 모두 풀고 다시 만들면 같다", { timeout: 60_000 }, () => {
    let count = 0;
    const digits = [0, 0, 0, 0, 0, 0];
    for (let n = 0; n < 9 ** 6; n += 1) {
      let rest = n;
      for (let i = 5; i >= 0; i -= 1) {
        digits[i] = rest % 9;
        rest = Math.floor(rest / 9);
      }
      const body = `1${digits.join("")}`;
      const code = body + specChecksum(body);
      const allNone = digits.every((digit) => digit === 8);
      const ts = decodeGuessCode(code);
      if (allNone) {
        if (ts !== null || ref.decodeGuessCode(code) !== null) throw new Error(`전부 없음을 받아들였다 ${code}`);
        continue;
      }
      if (ts === null) throw new Error(`못 풀었다 ${code}`);
      if (encodeGuessCode(ts) !== code) throw new Error(`왕복이 다르다 ${code}`);
      const js = ref.decodeGuessCode(code) as GuessAnswers | null;
      if (js === null || ref.encodeGuessCode(js) !== code) throw new Error(`JS 왕복이 다르다 ${code}`);
      count += 1;
    }
    expect(count).toBe(531_440);
  });

  const rng = v40.mulberry32(48_008);
  const samples: string[] = [];
  while (samples.length < 200) {
    const code = encodeGuessCode(randomAnswers(rng));
    if (code !== null) samples.push(code);
  }

  it("표본 200개 x 모든 자리 x 알파벳 전부와 이상한 글자의 모든 치환은 거절된다. 거절 이유를 검사 글자와 규칙으로 나눠 센다", { timeout: 60_000 }, () => {
    const extra = ["-", "_", " ", "한", "\n", "é"];
    let byCheck = 0;
    let byRule = 0;
    let acceptedForged = 0;
    let total = 0;
    for (const code of samples) {
      for (let position = 0; position < 8; position += 1) {
        for (const replacement of [...ALPHABET, ...extra]) {
          if (replacement === code[position]) continue;
          const mutated = code.slice(0, position) + replacement + code.slice(position + 1);
          total += 1;
          // 검사 글자를 다시 계산하지 않은 치환: 장면 글자 자리(1에서 6)는 유효 글자로 바꾸면 항상 어긋나고, 범위 밖 글자는 범위가 거절한다.
          // 세트 글자 자리와 검사 글자 자리의 치환은 알파벳이 62자라서 61 을 법으로 같은 값을 내는 쌍(0 과 Z)이 있어도 세트 글자 규칙과 검사 글자 비교가 거절한다.
          if (decodeGuessCode(mutated) !== null || ref.decodeGuessCode(mutated) !== null) {
            // 받아들여졌다면 61 을 법으로 같은 값을 내는 쌍(0 과 Z)을 맞바꾼 경우여야 한다. 장면 글자 자리에서는 범위가 막으므로 일어날 수 없다.
            throw new Error(`치환이 받아들여졌다 ${code} ${position}:${replacement}`);
          }
          if (position < 7) {
            // 검사 글자를 맞게 다시 계산한 위조: 범위 안이면 새 코드로 받아들여지고 범위 밖(다른 세트 글자, 8 밖, 알파벳 밖)이면 검사 글자가 맞아도 거절된다.
            const body = mutated.slice(0, 7);
            if (!/^[0-9a-zA-Z]{7}$/.test(body)) continue;
            const forged = body + specChecksum(body);
            const verdict = decodeGuessCode(forged) !== null;
            expect(verdict, `${forged}`).toBe(specAccepts(forged));
            expect(ref.decodeGuessCode(forged) !== null, `${forged}`).toBe(verdict);
            if (verdict) acceptedForged += 1;
            else byRule += 1;
          } else {
            byCheck += 1;
          }
        }
      }
    }
    expect(total).toBeGreaterThan(90_000);
    // 이유를 나눠 센다: 검사 글자 자리를 바꾼 것(검사가 거절), 위조인데 규칙이 거절한 것(범위, 세트 글자, 전부 8), 위조가 규칙 안이라 새 코드가 된 것이 모두 있다.
    expect(byCheck).toBeGreaterThan(10_000);
    expect(byRule).toBeGreaterThan(10_000);
    expect(acceptedForged).toBeGreaterThan(1000);
  });

  it("두 글자가 동시에 바뀌면 약 61분의 1 이 통과한다: 검사 글자는 오타를 잡는 장치이지 위조를 막는 장치가 아니다(계약에 그대로 적는 한계)", () => {
    let tried = 0;
    let passed = 0;
    for (const code of samples.slice(0, 40)) {
      for (let i = 1; i <= 6; i += 1) {
        for (let j = i + 1; j <= 6; j += 1) {
          for (const x of SLOT_CHARS) {
            for (const y of SLOT_CHARS) {
              // 정확히 두 자리가 모두 바뀐 경우만 센다.
              if (x === code[i] || y === code[j]) continue;
              const chars = [...code];
              chars[i] = x;
              chars[j] = y;
              const mutated = chars.join("");
              const accepted = decodeGuessCode(mutated) !== null;
              expect(ref.decodeGuessCode(mutated) !== null, mutated).toBe(accepted);
              tried += 1;
              if (accepted) passed += 1;
            }
          }
        }
      }
    }
    const rate = passed / tried;
    expect(tried).toBeGreaterThan(30_000);
    // 0 이 아니다(막지 못한다)이고 61분의 1(약 1.6퍼센트) 근처다.
    expect(rate).toBeGreaterThan(0.005);
    expect(rate).toBeLessThan(0.04);
  });

  it("표본 200개에서 몸통의 서로 다른 두 글자를 맞바꾼 것은 모두 거절된다", () => {
    let total = 0;
    for (const code of samples) {
      for (let i = 0; i < 7; i += 1) {
        for (let j = i + 1; j < 7; j += 1) {
          if (code[i] === code[j]) continue;
          const chars = [...code];
          [chars[i], chars[j]] = [chars[j], chars[i]];
          const swapped = chars.join("");
          total += 1;
          expect(decodeGuessCode(swapped), swapped).toBeNull();
          expect(ref.decodeGuessCode(swapped), swapped).toBeNull();
        }
      }
    }
    expect(total).toBeGreaterThan(2000);
  });
});

// ---------------------------------------------------------------------------
// 두 사람 비교(5.4)도 같은 기준 계산기로 대조한다
// ---------------------------------------------------------------------------

describe("두 사람 비교의 대조", () => {
  it("무작위 쌍 2,000개에서 TS 비교 = JS 비교이고, 둘 중 하나를 바꿔 넣으면 방향만 뒤집힌다", () => {
    const rng = v40.mulberry32(49_009);
    for (let i = 0; i < 2000; i += 1) {
      const first = i % 17 === 0 ? null : randomAnswers(rng);
      const second = i % 19 === 0 ? null : randomAnswers(rng);
      const ts = compareGuesses(first, second);
      expect(ts, `#${i}`).toEqual(ref.compareGuesses(first, second));
      const swapped = compareGuesses(second, first);
      if (ts.kind === "both" && swapped.kind === "both") {
        expect(swapped.scenes.map((scene) => scene.index), `#${i}`).toEqual(ts.scenes.map((scene) => scene.index));
        for (const [at, scene] of ts.scenes.entries()) {
          const flipped = scene.diffs.map((diff) => ({ ...diff, direction: diff.direction === "firstGuessedSecond" ? "secondGuessedFirst" : "firstGuessedSecond" }));
          const mine = [...flipped].sort((x, y) => x.direction.localeCompare(y.direction));
          const theirs = [...swapped.scenes[at].diffs].sort((x, y) => x.direction.localeCompare(y.direction));
          expect(theirs, `#${i}`).toEqual(mine);
        }
      } else {
        expect(swapped.kind, `#${i}`).toBe(ts.kind);
      }
    }
  });
});
