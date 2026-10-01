import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { V40_AXIS_KEYS, V40_STORAGE, WEDDING_CODE_V40_VERSION, axisInfo, type Letter } from "@/constants/weddingCodeV40";
import {
  decodeLetterGuess,
  encodeLetterGuess,
  isLetterGuess,
  parseLetterGuessEnvelope,
  serializeLetterGuessEnvelope,
} from "./letterGuessEnvelope";
import type { LetterGuess } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const TTL = V40_STORAGE.ttlMs;
const NOW = Date.UTC(2026, 9, 1, 3, 0, 0);

function guess(...picks: (Letter | null)[]): LetterGuess {
  return picks as unknown as LetterGuess;
}

const SAMPLE = guess("V", null, "U", "A");

/** 봉투 원문을 손으로 만든다(키 순서와 값을 마음대로 바꿔 거절을 시험한다). */
function envelope(overrides: Record<string, unknown> = {}, omit: readonly string[] = []): string {
  const base: Record<string, unknown> = {
    schema: 1,
    version: WEDDING_CODE_V40_VERSION,
    savedAt: NOW - DAY,
    formBit: 1,
    guess: "V-UA",
  };
  for (const [key, value] of Object.entries(overrides)) base[key] = value;
  for (const key of omit) delete base[key];
  return JSON.stringify(base);
}

// ---------------------------------------------------------------------------
// 네 글자 문자열
// ---------------------------------------------------------------------------

describe("encodeLetterGuess, decodeLetterGuess: 네 글자 문자열", () => {
  it("고르지 않은 주제는 하이픈, 고른 주제는 그 주제의 글자(예 V-UA)", () => {
    expect(encodeLetterGuess(SAMPLE)).toBe("V-UA");
    expect(encodeLetterGuess(guess("S", "D", "F", "A"))).toBe("SDFA");
    expect(encodeLetterGuess(guess(null, null, null, "H"))).toBe("---H");
    expect(decodeLetterGuess("V-UA")).toStrictEqual(SAMPLE);
    expect(decodeLetterGuess("---H")).toStrictEqual(guess(null, null, null, "H"));
  });

  it("하나도 안 골랐으면 만들지 않는다(null): 전부 하이픈은 저장하지 않는다", () => {
    expect(encodeLetterGuess(guess(null, null, null, null))).toBeNull();
    expect(decodeLetterGuess("----")).toBeNull();
  });

  it("주제 순서마다 그 주제의 글자만 받는다: 다른 주제의 글자나 모양이 틀린 입력은 null", () => {
    expect(encodeLetterGuess(guess("W", null, null, null))).toBeNull();
    expect(encodeLetterGuess(guess(null, "S", null, null))).toBeNull();
    expect(encodeLetterGuess(guess(null, null, "A", null))).toBeNull();
    expect(encodeLetterGuess(guess(null, null, null, "V"))).toBeNull();
    expect(encodeLetterGuess([null, null, null] as unknown as LetterGuess)).toBeNull();
    expect(encodeLetterGuess(["V", null, null, null, null] as unknown as LetterGuess)).toBeNull();
    expect(encodeLetterGuess(null as unknown as LetterGuess)).toBeNull();
    expect(decodeLetterGuess("W---")).toBeNull();
    expect(decodeLetterGuess("-S--")).toBeNull();
    expect(decodeLetterGuess("--A-")).toBeNull();
    expect(decodeLetterGuess("---V")).toBeNull();
  });

  it("문자열이 아니거나 길이가 네 글자가 아니거나 허용 글자가 아니면 null", () => {
    for (const bad of [undefined, null, 4, true, {}, [], ["V", "-", "U", "A"], "", "V", "V-U", "V-UAA", "V-UA ", " V-UA"]) {
      expect(decodeLetterGuess(bad), JSON.stringify(bad)).toBeNull();
    }
    // 소문자, 숫자, 공백, 밑줄, 가운뎃점, 다른 모양의 하이픈은 고르지 않음 기호가 아니다.
    for (const bad of ["v-UA", "V0UA", "V UA", "V_UA", "V·UA", "V–UA", "V−UA", "V?UA", "SVUA"]) {
      expect(decodeLetterGuess(bad), bad).toBeNull();
    }
  });

  it("고르기 조합 전부(주제마다 고르지 않음, 앞글자, 뒤글자 = 81가지): 하나도 안 고른 것만 null 이고 나머지는 왕복한다", () => {
    const options = V40_AXIS_KEYS.map((axis) => [null, axisInfo(axis).front, axisInfo(axis).back] as const);
    let roundTrips = 0;
    for (const a of options[0]) {
      for (const b of options[1]) {
        for (const c of options[2]) {
          for (const d of options[3]) {
            const value = guess(a, b, c, d);
            const encoded = encodeLetterGuess(value);
            if ([a, b, c, d].every((pick) => pick === null)) {
              expect(encoded).toBeNull();
              continue;
            }
            expect(encoded, `${[a, b, c, d]}`).not.toBeNull();
            expect(encoded).toMatch(/^[VS-][WD-][UF-][HA-]$/u);
            expect(decodeLetterGuess(encoded)).toStrictEqual(value);
            roundTrips += 1;
          }
        }
      }
    }
    expect(roundTrips).toBe(80);
  });

  it("네 글자 문자열 전수: 허용 글자(주제마다 두 글자와 하이픈)와 몇 가지 나쁜 글자를 섞은 모든 문자열의 판정이 규칙과 같다", () => {
    const allowed = V40_AXIS_KEYS.map((axis) => `${axisInfo(axis).front}${axisInfo(axis).back}-`);
    const alphabet = ["V", "S", "W", "D", "U", "F", "H", "A", "-", "v", "0", " "];
    let accepted = 0;
    let total = 0;
    for (const a of alphabet) {
      for (const b of alphabet) {
        for (const c of alphabet) {
          for (const d of alphabet) {
            const text = `${a}${b}${c}${d}`;
            const valid = [a, b, c, d].every((char, index) => allowed[index].includes(char)) && text !== "----";
            const decoded = decodeLetterGuess(text);
            expect(decoded !== null, text).toBe(valid);
            total += 1;
            if (valid) {
              accepted += 1;
              expect(encodeLetterGuess(decoded as LetterGuess), text).toBe(text);
            }
          }
        }
      }
    }
    expect(total).toBe(12 ** 4);
    // 주제마다 세 글자(두 글자와 하이픈)라 3 x 3 x 3 x 3 = 81, 전부 하이픈인 하나를 뺀 80.
    expect(accepted).toBe(80);
  });

  it("isLetterGuess 는 모양만 본다(하나도 안 고른 네 칸도 모양은 맞다)", () => {
    expect(isLetterGuess(guess(null, null, null, null))).toBe(true);
    expect(isLetterGuess(SAMPLE)).toBe(true);
    expect(isLetterGuess("V-UA")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 봉투 만들기
// ---------------------------------------------------------------------------

describe("serializeLetterGuessEnvelope: 보관본 만들기", () => {
  it("키 다섯 개가 정해진 순서로 든 JSON 이다(schema, version, savedAt, formBit, guess)", () => {
    const raw = serializeLetterGuessEnvelope(SAMPLE, 1, NOW);
    expect(raw).toBe(`{"schema":1,"version":"v4.0-tendency","savedAt":${NOW},"formBit":1,"guess":"V-UA"}`);
    const parsed = JSON.parse(raw as string) as Record<string, unknown>;
    expect(Object.keys(parsed)).toStrictEqual(["schema", "version", "savedAt", "formBit", "guess"]);
    expect(parsed.version).toBe(WEDDING_CODE_V40_VERSION);
  });

  it("같은 입력은 늘 같은 문자열이고 폼 비트 0 도 만든다", () => {
    expect(serializeLetterGuessEnvelope(SAMPLE, 0, NOW)).toBe(serializeLetterGuessEnvelope(SAMPLE, 0, NOW));
    const raw = serializeLetterGuessEnvelope(guess(null, "D", null, null), 0, 0);
    expect(raw).toBe('{"schema":1,"version":"v4.0-tendency","savedAt":0,"formBit":0,"guess":"-D--"}');
  });

  it("하나도 안 골랐으면 저장하지 않는다(null). 다른 주제의 글자나 나쁜 폼 비트와 시각도 null", () => {
    expect(serializeLetterGuessEnvelope(guess(null, null, null, null), 0, NOW)).toBeNull();
    expect(serializeLetterGuessEnvelope(guess("W", null, null, null), 0, NOW)).toBeNull();
    for (const formBit of [2, -1, 0.5, "0", null, undefined]) {
      expect(serializeLetterGuessEnvelope(SAMPLE, formBit as never, NOW), String(formBit)).toBeNull();
    }
    for (const savedAt of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined]) {
      expect(serializeLetterGuessEnvelope(SAMPLE, 0, savedAt as never), String(savedAt)).toBeNull();
    }
  });

  it("만든 것을 바로 읽으면 같은 값이 나온다(왕복): 81가지 중 하나도 안 고른 것을 뺀 80가지 x 폼 비트 둘", () => {
    const options = V40_AXIS_KEYS.map((axis) => [null, axisInfo(axis).front, axisInfo(axis).back] as const);
    let count = 0;
    for (const a of options[0]) {
      for (const b of options[1]) {
        for (const c of options[2]) {
          for (const d of options[3]) {
            for (const formBit of [0, 1] as const) {
              const value = guess(a, b, c, d);
              const raw = serializeLetterGuessEnvelope(value, formBit, NOW - 5);
              if ([a, b, c, d].every((pick) => pick === null)) {
                expect(raw).toBeNull();
                continue;
              }
              expect(parseLetterGuessEnvelope(raw, NOW)).toStrictEqual({ status: "ready", guess: value, formBit, savedAt: NOW - 5 });
              count += 1;
            }
          }
        }
      }
    }
    expect(count).toBe(160);
  });
});

// ---------------------------------------------------------------------------
// 봉투 읽기: 엄격함
// ---------------------------------------------------------------------------

describe("parseLetterGuessEnvelope: 읽기는 엄격하다", () => {
  it("없으면 empty, 올바르면 ready(고른 글자, 폼 비트, 저장 시각)", () => {
    expect(parseLetterGuessEnvelope(null, NOW)).toStrictEqual({ status: "empty" });
    expect(parseLetterGuessEnvelope(envelope(), NOW)).toStrictEqual({ status: "ready", guess: SAMPLE, formBit: 1, savedAt: NOW - DAY });
    expect(parseLetterGuessEnvelope(envelope({ formBit: 0, guess: "SDFA" }), NOW)).toStrictEqual({
      status: "ready",
      guess: guess("S", "D", "F", "A"),
      formBit: 0,
      savedAt: NOW - DAY,
    });
  });

  it("키가 정확히 다섯 개여야 한다: 모자라거나 남으면 invalid", () => {
    for (const key of ["schema", "version", "savedAt", "formBit", "guess"]) {
      expect(parseLetterGuessEnvelope(envelope({}, [key]), NOW), `${key} 빠짐`).toStrictEqual({ status: "invalid" });
    }
    expect(parseLetterGuessEnvelope(envelope({ extra: 1 }), NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(envelope({ answers: "V-UA" }), NOW)).toStrictEqual({ status: "invalid" });
    // 키 하나를 다른 이름으로 바꿔 개수만 맞춘 것도 거절한다.
    expect(parseLetterGuessEnvelope(envelope({ guessed: "V-UA" }, ["guess"]), NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope('{"schema":1,"version":"v4.0-tendency","savedAt":1,"formBit":0,"__proto__":{"a":1}}', NOW)).toStrictEqual({ status: "invalid" });
  });

  it("스키마와 판이 다르면 invalid", () => {
    expect(parseLetterGuessEnvelope(envelope({ schema: 2 }), NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(envelope({ schema: "1" }), NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(envelope({ version: "v3.1" }), NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(envelope({ version: "v4.1-tendency" }), NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(envelope({ version: undefined }), NOW)).toStrictEqual({ status: "invalid" });
  });

  it("폼 비트는 0 또는 1 만", () => {
    for (const formBit of [2, -1, "1", "0", true, null, 0.5]) {
      expect(parseLetterGuessEnvelope(envelope({ formBit }), NOW), JSON.stringify(formBit)).toStrictEqual({ status: "invalid" });
    }
  });

  it("저장 시각은 0 이상의 안전한 정수만. 지금보다 미래이면 invalid", () => {
    for (const savedAt of [-1, 1.5, "1", null, true, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseLetterGuessEnvelope(envelope({ savedAt }), NOW), JSON.stringify(savedAt)).toStrictEqual({ status: "invalid" });
    }
    expect(parseLetterGuessEnvelope(envelope({ savedAt: NOW + 1 }), NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(envelope({ savedAt: NOW + DAY }), NOW)).toStrictEqual({ status: "invalid" });
    // 지금과 같은 시각은 미래가 아니다.
    expect(parseLetterGuessEnvelope(envelope({ savedAt: NOW }), NOW)).toStrictEqual({ status: "ready", guess: SAMPLE, formBit: 1, savedAt: NOW });
    expect(parseLetterGuessEnvelope(envelope({ savedAt: 0 }), 5)).toStrictEqual({ status: "ready", guess: SAMPLE, formBit: 1, savedAt: 0 });
  });

  it("고른 글자는 주제마다 그 주제의 글자나 하이픈. 전부 하이픈이거나 길이가 다르거나 타입이 다르면 invalid", () => {
    for (const bad of ["----", "W---", "V-U", "V-UAA", "v-ua", "", 4, null, ["V", null, "U", "A"], { a: 1 }]) {
      expect(parseLetterGuessEnvelope(envelope({ guess: bad }), NOW), JSON.stringify(bad)).toStrictEqual({ status: "invalid" });
    }
  });

  it("JSON 이 아니거나 객체가 아니면 invalid(던지지 않는다)", () => {
    for (const raw of ["", " ", "{", "null", "[]", "[1,2,3,4,5]", "1", '"V-UA"', "true", "{}", "undefined", "V-UA", "{'schema':1}"]) {
      expect(parseLetterGuessEnvelope(raw, NOW), raw).toStrictEqual({ status: "invalid" });
    }
  });

  it("지금 시각이 올바르지 않으면 invalid", () => {
    for (const now of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1" as unknown as number, undefined as unknown as number]) {
      expect(parseLetterGuessEnvelope(envelope(), now), String(now)).toStrictEqual({ status: "invalid" });
      expect(parseLetterGuessEnvelope(null, now), `null/${String(now)}`).toStrictEqual({ status: "invalid" });
    }
  });

  it("문자열이 너무 길면 invalid(올바른 봉투에 공백을 덧대도)", () => {
    const raw = envelope();
    const padded = `${raw}${" ".repeat(300)}`;
    expect(parseLetterGuessEnvelope(raw, NOW).status).toBe("ready");
    expect(parseLetterGuessEnvelope(padded, NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(`{"schema":1,"x":"${"a".repeat(5000)}"}`, NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(42 as unknown as string, NOW)).toStrictEqual({ status: "invalid" });
  });

  it("무작위로 깨뜨린 문자열 2,000개를 던지지 않고 거절하거나 읽는다", () => {
    let seed = 12345;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const base = envelope();
    const alphabet = '{}[]":,0123456789abcVSWDUFHA- \\·';
    const statuses = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const chars = [...base];
      const edits = 1 + Math.floor(next() * 4);
      for (let e = 0; e < edits; e += 1) {
        const at = Math.floor(next() * chars.length);
        const kind = next();
        if (kind < 0.4) chars[at] = alphabet[Math.floor(next() * alphabet.length)];
        else if (kind < 0.7) chars.splice(at, 1);
        else chars.splice(at, 0, alphabet[Math.floor(next() * alphabet.length)]);
      }
      const read = parseLetterGuessEnvelope(chars.join(""), NOW);
      statuses.add(read.status);
      expect(["ready", "invalid", "expired", "empty"]).toContain(read.status);
      if (read.status === "ready") {
        // 읽힌 것은 늘 올바른 모양이다.
        expect(isLetterGuess(read.guess)).toBe(true);
        expect(read.guess.some((pick) => pick !== null)).toBe(true);
        expect(read.savedAt).toBeLessThanOrEqual(NOW);
      }
    }
    // 측정기가 비어 있지 않다: 거절도 읽힘도 실제로 나왔다.
    expect(statuses.has("invalid")).toBe(true);
    expect(statuses.has("ready")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 만료
// ---------------------------------------------------------------------------

describe("parseLetterGuessEnvelope: 기간", () => {
  it("보관 기간은 진행 저장과 같은 30일이다", () => {
    expect(TTL).toBe(30 * DAY);
  });

  it("마지막 저장부터 기간 미만이면 ready, 기간 이상이면 expired(경계 양옆)", () => {
    const at = (age: number) => envelope({ savedAt: NOW - age });
    expect(parseLetterGuessEnvelope(at(0), NOW).status).toBe("ready");
    expect(parseLetterGuessEnvelope(at(TTL - 2), NOW).status).toBe("ready");
    expect(parseLetterGuessEnvelope(at(TTL - 1), NOW).status).toBe("ready");
    expect(parseLetterGuessEnvelope(at(TTL), NOW)).toStrictEqual({ status: "expired" });
    expect(parseLetterGuessEnvelope(at(TTL + 1), NOW)).toStrictEqual({ status: "expired" });
    expect(parseLetterGuessEnvelope(at(TTL * 3), NOW)).toStrictEqual({ status: "expired" });
  });

  it("형식이 틀린 것은 오래돼도 invalid 이고 expired 가 아니다(형식을 먼저 본다)", () => {
    const old = NOW - TTL * 2;
    expect(parseLetterGuessEnvelope(envelope({ savedAt: old, guess: "----" }), NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(envelope({ savedAt: old, formBit: 2 }), NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(envelope({ savedAt: old, extra: 1 }), NOW)).toStrictEqual({ status: "invalid" });
    expect(parseLetterGuessEnvelope(envelope({ savedAt: old, version: "v3.1" }), NOW)).toStrictEqual({ status: "invalid" });
  });

  it("읽기는 저장 시각을 늘리지 않는다: 읽은 값의 savedAt 은 쓴 시각 그대로다", () => {
    const raw = serializeLetterGuessEnvelope(SAMPLE, 0, NOW - 10 * DAY) as string;
    const first = parseLetterGuessEnvelope(raw, NOW);
    const later = parseLetterGuessEnvelope(raw, NOW + 5 * DAY);
    expect(first).toMatchObject({ status: "ready", savedAt: NOW - 10 * DAY });
    expect(later).toMatchObject({ status: "ready", savedAt: NOW - 10 * DAY });
    // 기간이 지나면 읽기만으로 되살아나지 않는다.
    expect(parseLetterGuessEnvelope(raw, NOW + 21 * DAY)).toStrictEqual({ status: "expired" });
  });
});

// ---------------------------------------------------------------------------
// 이 폴더는 저장소도 링크도 모른다
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENT_DIR = resolve(HERE, "../../../../components/wedding-code/v40/letterGuess");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /\.(ts|tsx)$/u.test(name) && !/\.test\./u.test(name) && !/\.d\.ts$/u.test(name))
    .map((name) => join(dir, name));
}

describe("격리: 이 폴더의 소스는 저장소, 링크 코덱, 입구, 통계, 네트워크를 만지지 않는다", () => {
  const files = [...sourceFiles(HERE), ...sourceFiles(COMPONENT_DIR)];

  it("소스 파일을 실제로 읽고 있다(눈이 멀어 초록불이 되지 않는다)", () => {
    const names = files.map((file) => file.replace(/\\/gu, "/").split("/").pop());
    for (const expected of ["types.ts", "letterGuess.ts", "letterGuessEnvelope.ts", "letterGuessStore.ts", "letterGuessCopy.ts", "letterGuessContract.ts", "LetterGuessScreen.tsx", "LetterGuessLines.tsx", "LetterGuessClosedCard.tsx", "index.ts"]) {
      expect(names).toContain(expected);
    }
    for (const file of files) expect(readFileSync(file, "utf8").length, file).toBeGreaterThan(200);
  });

  it("저장소 이름과 메서드, 저장 키를 쓰지 않는다(읽고 쓰고 지우는 일은 클라이언트가 포트로 한다)", () => {
    const forbidden = /localStorage|sessionStorage|indexedDB|\bgetItem\b|\bsetItem\b|\bremoveItem\b|document\.cookie|hanbang:wedding-code|letterGuessKey/u;
    for (const file of files) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
      expect(code, file).not.toMatch(forbidden);
    }
  });

  it("링크 코덱, 짐작 링크, 입구, 통계, 아모라를 가져오지 않고 네트워크를 부르지 않는다", () => {
    const forbiddenImport = /from\s+["'][^"']*(?:\/codec|\/guess\/|guessLink|\/entry|@\/lib\/analytics|amora|sentry|posthog)[^"']*["']/iu;
    const forbiddenCall = /\bfetch\s*\(|sendBeacon|XMLHttpRequest|navigator\.share|captureWeddingCodeEvent|captureEvent|location\.(?:hash|href|search)|history\.(?:pushState|replaceState)/u;
    for (const file of files) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
      expect(code, file).not.toMatch(forbiddenImport);
      expect(code, file).not.toMatch(forbiddenCall);
    }
  });

  it("컴포넌트는 바렐, 부모 폴더 입구, 점 둘 경로를 가져오지 않는다(순환 방지)", () => {
    for (const file of sourceFiles(COMPONENT_DIR)) {
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(/from\s+["']@\/components\/wedding-code\/v40["']/u);
      expect(code, file).not.toMatch(/from\s+["']\.\.["']/u);
      expect(code, file).not.toMatch(/from\s+["']\.\.\/index["']/u);
    }
  });
});
