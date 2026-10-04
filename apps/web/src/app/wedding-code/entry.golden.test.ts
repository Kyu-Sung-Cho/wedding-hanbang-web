import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import {
  WEDDING_CODE_DEFAULT_VERSION,
  parseWeddingCodeEntryHash,
  parseWeddingCodeEntryQuery,
  weddingCodeEntryHash,
  weddingCodeEntryKey,
  type WeddingCodeEntry,
  type WeddingCodeEntryOptions,
} from "./entry";
import golden from "./entry.golden.json";

/**
 * 골든 표: v4 를 더하기 전의 entry.ts 가 낸 결과를 그대로 적어 둔 표다(entry.golden.json, 136줄).
 * 모든 판(v0.6 부터 v3.1)의 링크, 깨진 링크, 해시와 쿼리, 반복된 키, 유입 경로 매개변수를 담는다.
 * 기본 진입이 v3.1 인 동안 새 파서는 이 표와 글자 그대로 같아야 하고, 기본 진입이 v4 로 바뀐 뒤에도
 * 「v 없는 답 없는 입구」와 「명시 v3.1(답 없음)」 두 가지만 달라야 한다(스펙 9절 5항).
 *
 * 표를 다시 뽑아 이 시험을 통과시키는 것은 회귀를 지우는 일이다. 옛 링크의 의미를 바꾸려면 판을 올리는 결정부터 한다.
 *
 * 2026-10-04 파운더 결정으로 표를 손본 곳은 이 둘뿐이다(감사 A46, 카오스 #top). 나머지 행은 한 줄도 바뀌지 않았다.
 * (1) 「query 뒤 공백 버전」(v: "v3.1-preferences ")의 기대값이 오류에서 v3.1 빈 입구로 바뀌었다: 판 이름 끝의 공백, 문장부호, 조사를 한 번 걷어내고 이름이 정확히 같으면 그 판으로 연다
 *     (entry.v40.test.ts 의 「링크 끝에 붙은 글자」가 새 규칙을 고정한다). 행은 지우지 않고 새 기대값으로 남겨 두어 규칙이 되돌려지면 이 표가 빨개진다. 앞 공백 행은 그대로 오류다.
 * (2) 「hash 등호 없는 조각」(#justtext)은 오류에서 null(링크가 없는 해시)로 바뀌었다: =, & 가 없고 링크 키 이름으로 시작하지 않는 짧은 조각(32자 이하)은
 *     #top 같은 문서 안 이동 표시라서 평소 입구를 연다. 「#a&b」처럼 링크 모양이면 그대로 오류다. 「hash 긴 해시 12000자」와 12001자 행은 원래대로 오류다(32자를 넘으면 링크 시도로 본다).
 */

type GoldenInput = Record<string, string | string[] | undefined> | string;
type GoldenRow = {
  label: string;
  mode: "query" | "search" | "hash";
  input: GoldenInput;
  expected: null | { kind: string; hash: string | null; key: string; digest: string };
};

const rows = golden as unknown as GoldenRow[];

function parseRow(row: GoldenRow, options?: WeddingCodeEntryOptions): WeddingCodeEntry | null {
  if (row.mode === "hash") return parseWeddingCodeEntryHash(row.input as string, options);
  if (row.mode === "search") return parseWeddingCodeEntryQuery(new URLSearchParams(row.input as string), options);
  return parseWeddingCodeEntryQuery(row.input as Record<string, string | string[] | undefined>, options);
}

function summarize(entry: WeddingCodeEntry | null) {
  if (entry === null) return null;
  return {
    kind: entry.kind,
    hash: weddingCodeEntryHash(entry),
    key: weddingCodeEntryKey(entry),
    digest: createHash("sha1").update(JSON.stringify(entry)).digest("hex").slice(0, 16),
  };
}

/** 이 행이 「버전이 없고 답도 없는」 입구인가. 기본 진입이 바뀌면 여기만 달라진다. */
function isBareEntry(row: GoldenRow): boolean {
  if (row.mode !== "query" || typeof row.input === "string") return false;
  return row.input.v === undefined && row.expected?.kind === "v31" && row.expected.hash === null;
}

/** 이 행이 명시 v3.1(답 없음) 입구인가. */
function isExplicitV31Entry(row: GoldenRow): boolean {
  if (row.mode !== "query" || typeof row.input === "string") return false;
  // 판 이름 끝에 붙은 공백(「query 뒤 공백 버전」)도 걷어내고 같은 판으로 읽으므로 같은 입구다.
  return typeof row.input.v === "string" && row.input.v.trimEnd() === WEDDING_CODE_V31_VERSION && row.expected?.kind === "v31" && row.expected.hash === null;
}

describe("entry.ts 골든 표", () => {
  it("표가 비어 가지 않았다: 모든 종류의 링크가 충분히 있다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(130);
    const kinds = new Map<string, number>();
    for (const row of rows) kinds.set(row.expected?.kind ?? "null", (kinds.get(row.expected?.kind ?? "null") ?? 0) + 1);
    expect(kinds.get("v31") ?? 0).toBeGreaterThanOrEqual(8);
    expect(kinds.get("v30") ?? 0).toBeGreaterThanOrEqual(3);
    expect(kinds.get("v20") ?? 0).toBeGreaterThanOrEqual(6);
    expect(kinds.get("legacy") ?? 0).toBeGreaterThanOrEqual(30);
    expect(kinds.get("error") ?? 0).toBeGreaterThanOrEqual(60);
    expect(kinds.get("null") ?? 0).toBe(3);
    expect(new Set(rows.map((row) => row.label)).size).toBe(rows.length);
    expect(rows.some((row) => JSON.stringify(row).includes(WEDDING_CODE_V40_VERSION))).toBe(false);
  });

  it("기본 진입은 v3.1 이다(어둡게 출시)", () => {
    expect(WEDDING_CODE_DEFAULT_VERSION).toBe(WEDDING_CODE_V31_VERSION);
  });

  it.each(rows.map((row) => [row.label, row] as const))("%s: 기본 진입 v3.1 에서 옛 파서와 같다", (_label, row) => {
    expect(summarize(parseRow(row))).toEqual(row.expected);
    expect(summarize(parseRow(row, { defaultVersion: WEDDING_CODE_V31_VERSION }))).toEqual(row.expected);
  });

  it.each(rows.map((row) => [row.label, row] as const))("%s: 기본 진입이 v4 로 바뀌어도 두 가지 입구만 달라진다", (_label, row) => {
    const actual = parseRow(row, { defaultVersion: WEDDING_CODE_V40_VERSION });
    if (isBareEntry(row)) {
      expect(actual).toEqual({ kind: "v40", initial: { partner: null, both: null } });
      return;
    }
    if (isExplicitV31Entry(row)) {
      expect(actual).toMatchObject({ kind: "v31", older: true, initial: { partnerDraft: null, partnerCode: null, bothDrafts: null } });
      expect(weddingCodeEntryKey(actual as WeddingCodeEntry)).toBe(row.expected?.key);
      return;
    }
    expect(summarize(actual)).toEqual(row.expected);
  });

  it("기본 진입이 바뀌어도 달라지는 행은 정확히 그 두 종류뿐이다", () => {
    const changed = rows.filter((row) => isBareEntry(row) || isExplicitV31Entry(row));
    expect(changed.map((row) => row.label)).toEqual([
      "query 빈 query",
      "query 유입 경로만",
      "query 유입 경로 둘",
      "query v 없음, 알 수 없는 키",
      "query 답 없는 v3.1-preferences",
      "query 뒤 공백 버전",
      "query 알 수 없는 키 배열",
      "query 값이 undefined 인 키(JSON 에서는 빈 객체)",
    ]);
  });
});

/**
 * 표의 「긴 해시」 두 행은 코드 없는 x 덩어리고, 「공백 버전」 행은 이름이 v3.1 이라서 어느 쪽으로 읽어도 오류다.
 * 그래서 해시 길이 상한(12000자)과 버전 이름의 앞뒤 공백 검사가 사라져도 표는 초록으로 남는다.
 * 옛 파서가 지키던 이 두 경계를 표 안의 유효한 행에서 만든 링크로 직접 잠근다.
 */
describe("entry.ts 골든 표가 못 밝히는 두 경계", () => {
  const rowByLabel = (label: string): GoldenRow => {
    const row = rows.find((candidate) => candidate.label === label);
    if (!row) throw new Error(`골든 행이 없어요: ${label}`);
    return row;
  };
  const optionsList = [undefined, { defaultVersion: WEDDING_CODE_V40_VERSION }] as const;

  it("해시 길이 상한: # 뒤 12000자까지는 읽고 12001자부터는 오류다(빈 조각은 무시되므로 유효한 링크를 길게 늘일 수 있다)", () => {
    const valid = rowByLabel("hash v2.0 a");
    const base = valid.input as string;
    const padded = (rawLength: number) => base + "&".repeat(rawLength - (base.length - 1));
    for (const options of optionsList) {
      expect(summarize(parseWeddingCodeEntryHash(padded(base.length - 1), options))).toEqual(valid.expected);
      expect(summarize(parseWeddingCodeEntryHash(padded(12000), options))).toEqual(valid.expected);
      expect(parseWeddingCodeEntryHash(padded(12001), options)).toEqual({ kind: "error" });
      expect(parseWeddingCodeEntryHash(padded(20000), options)).toEqual({ kind: "error" });
    }
  });

  it("버전 이름 앞의 공백은 이름이 옳아도 오류다(장면 판 여섯 개, v2.0, v3.0, v3.1). 끝의 공백은 2026-10-04 결정으로 걷어내고 같은 판으로 읽는다", () => {
    const names = ["v0.6-scene", "v0.8-code", "v0.9-code", "v1.0-code", "v1.1-code", "v1.2-code", "v2.0-agreement", "v3.0-preferences", "v3.1-preferences"];
    for (const options of optionsList) {
      for (const name of names) {
        for (const spaced of [` ${name}`, `\t${name}`]) {
          expect(parseWeddingCodeEntryQuery({ v: spaced }, options), JSON.stringify(spaced)).toEqual({ kind: "error" });
          expect(parseWeddingCodeEntryQuery(new URLSearchParams({ v: spaced }), options), JSON.stringify(spaced)).toEqual({ kind: "error" });
        }
        // 끝의 공백은 링크 끝에 붙어 올 수 있는 글자라서 한 번 걷어낸다(앞 공백은 붙어 올 수 없다).
        for (const spaced of [`${name} `, `${name}\n`]) {
          expect(parseWeddingCodeEntryQuery({ v: spaced }, options), JSON.stringify(spaced)).toEqual(parseWeddingCodeEntryQuery({ v: name }, options));
          expect(parseWeddingCodeEntryQuery(new URLSearchParams({ v: spaced }), options), JSON.stringify(spaced)).toEqual(parseWeddingCodeEntryQuery(new URLSearchParams({ v: name }), options));
        }
      }
      // 해시로 와도 같다. 표의 유효한 링크에서 이름에 공백만 더한다(달라진 것이 공백뿐임을 확인한다).
      const valid = rowByLabel("hash v1.2-code a");
      const hash = valid.input as string;
      expect(summarize(parseWeddingCodeEntryHash(hash, options))).toEqual(valid.expected);
      const leading = hash.replace("v=v1.2-code", "v=%20v1.2-code");
      expect(leading).not.toBe(hash);
      expect(parseWeddingCodeEntryHash(leading, options), leading).toEqual({ kind: "error" });
      const trailing = hash.replace("v=v1.2-code", "v=v1.2-code%20");
      expect(trailing).not.toBe(hash);
      expect(summarize(parseWeddingCodeEntryHash(trailing, options)), trailing).toEqual(valid.expected);
    }
  });
});
