import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_VERSION } from "@/constants/weddingCodeV06";
import { WEDDING_CODE_V12_VERSION } from "@/constants/weddingCodeV12";
import { WEDDING_CODE_V30_VERSION } from "@/constants/weddingCodeV30";
import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { V40_NA_CHAR, V40_SKIP_CHAR, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { createV31Draft, encodeV31 } from "@/lib/weddingCode/v31";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { checksumChar, decodeCode, encodeCode } from "@/lib/weddingCode/v40/codec";
import { V40_ENTRY_COPY as V40_ENTRY_COPY_FROM_COPY } from "@/lib/weddingCode/v40/copy";
import { V40_ENTRY_COPY } from "@/lib/weddingCode/v40/entryCopy";
import { V40_FIXTURES, fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import {
  EMPTY_V40_ENTRY,
  EMPTY_WEDDING_CODE_ENTRY,
  OLDER_V31_ENTRY,
  WEDDING_CODE_DEFAULT_VERSION,
  defaultWeddingCodeEntry,
  parseWeddingCodeEntryHash,
  parseWeddingCodeEntryQuery,
  weddingCodeDefaultsToV40,
  weddingCodeEntryHash,
  weddingCodeEntryKey,
  weddingCodeRestartEntry,
  weddingCodeRestartSearch,
} from "./entry";

const V40 = WEDDING_CODE_V40_VERSION;
const V31 = WEDDING_CODE_V31_VERSION;
const here = dirname(fileURLToPath(import.meta.url));

function codeOf(name: string): string {
  const fixture = fixtureByName(name);
  if (!fixture) throw new Error(`고정 표본이 없어요: ${name}`);
  const code = encodeCode(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
  if (code === null) throw new Error(`코드를 만들 수 없어요: ${name}`);
  return code;
}

const A = codeOf("swua-example");
const B = codeOf("couple-partner");
const soloHash = `#v=${V40}&a=${A}`;
const pairHash = `${soloHash}&b=${B}`;
const V40_BROKEN = { kind: "error", version: V40 } as const;
const GENERIC_ERROR = { kind: "error" } as const;

describe("웨딩코드 4.0 진입: 기본 판과 어둡게 출시", () => {
  it("기본 진입은 v3.1 이고, 상수 하나가 그것을 정한다", () => {
    expect(WEDDING_CODE_DEFAULT_VERSION).toBe(V31);
    expect(weddingCodeDefaultsToV40()).toBe(false);
    expect(weddingCodeDefaultsToV40(V40)).toBe(true);
    expect(defaultWeddingCodeEntry()).toBe(EMPTY_WEDDING_CODE_ENTRY);
    expect(defaultWeddingCodeEntry(V40)).toBe(EMPTY_V40_ENTRY);
  });

  it("v 없는 맨 주소는 v3.1, v4 는 명시 진입으로만 열린다", () => {
    expect(parseWeddingCodeEntryQuery({}).kind).toBe("v31");
    expect(parseWeddingCodeEntryQuery({ utm_source: "landing" }).kind).toBe("v31");
    expect(parseWeddingCodeEntryQuery({ v: V31 })).toEqual(EMPTY_WEDDING_CODE_ENTRY);
    expect(parseWeddingCodeEntryQuery({ v: V31 })).not.toHaveProperty("older");
    expect(parseWeddingCodeEntryQuery({ v: V40 })).toEqual({ kind: "v40", initial: { partner: null, both: null } });
  });
});

describe("웨딩코드 4.0 진입: 답 없는 명시 진입(?v=v4.0-tendency)", () => {
  it("빈 v4 입구를 연다", () => {
    for (const entry of [
      parseWeddingCodeEntryQuery({ v: V40 }),
      parseWeddingCodeEntryQuery(new URLSearchParams(`v=${V40}`)),
    ]) {
      expect(entry).toEqual({ kind: "v40", initial: { partner: null, both: null } });
      expect(weddingCodeEntryKey(entry)).toBe("v40:clean");
      expect(weddingCodeEntryHash(entry)).toBeNull();
    }
  });

  it("유입 경로 매개변수는 무시하고 답이 든 키만 막는다(질문만 보내기 링크가 앱 안 브라우저에서 깨지지 않게)", () => {
    expect(parseWeddingCodeEntryQuery({ v: V40, utm_source: "kakao", fbclid: "x" }).kind).toBe("v40");
    expect(parseWeddingCodeEntryQuery(new URLSearchParams(`v=${V40}&utm_source=kakao&fbclid=x`)).kind).toBe("v40");
    // v3.0, v3.1 의 명시 입구는 예전처럼 엄격하다.
    expect(parseWeddingCodeEntryQuery({ v: V31, other: "1" })).toEqual(GENERIC_ERROR);
  });

  it("query 에 a 나 b 가 오면 서버가 보게 되므로 읽지 않는다", () => {
    for (const query of [
      { v: V40, a: A }, { v: V40, b: B }, { v: V40, a: A, b: B }, { v: V40, a: "" }, { v: V40, a: "broken" },
      { v: V40, a: [A, A] }, { a: [A, A], v: [V40] }, { v: [V40, V40] }, { v: [V40, V31] },
    ]) {
      expect(parseWeddingCodeEntryQuery(query), JSON.stringify(query)).toEqual(V40_BROKEN);
    }
    expect(parseWeddingCodeEntryQuery(new URLSearchParams(`v=${V40}&a=${A}`))).toEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryQuery(new URLSearchParams(`v=${V40}&v=${V40}`))).toEqual(V40_BROKEN);
  });

  it("v4 판 이름이 아닌 값은 v4 로 추정하지 않고 예전 오류 그대로다", () => {
    for (const version of ["", " v4.0-tendency", "v4.0-tendency ", "V4.0-TENDENCY", "v4.0", "v4.0-tendency-x", "v4-tendency"]) {
      expect(parseWeddingCodeEntryQuery({ v: version }), JSON.stringify(version)).toEqual(GENERIC_ERROR);
    }
  });
});

describe("웨딩코드 4.0 진입: 받은 링크와 두 사람 결과(#v=v4.0-tendency&a=…[&b=…])", () => {
  const decodedA = decodeCode(WEDDING_CODE_V40_BANK, A);
  const decodedB = decodeCode(WEDDING_CODE_V40_BANK, B);

  it("표본 코드가 은행으로 풀린다(시험의 전제)", () => {
    expect(decodedA).not.toBeNull();
    expect(decodedB).not.toBeNull();
    expect(A).toHaveLength(70);
  });

  it("a 만 있으면 받는 사람 화면, a 와 b 가 있으면 두 사람 결과이고, 해시로 되돌리면 원래 링크와 같다", () => {
    const solo = parseWeddingCodeEntryHash(soloHash);
    expect(solo).toEqual({ kind: "v40", initial: { partner: decodedA, both: null } });
    expect(weddingCodeEntryHash(solo!)).toBe(soloHash);
    const pair = parseWeddingCodeEntryHash(pairHash);
    expect(pair).toEqual({ kind: "v40", initial: { partner: null, both: { first: decodedA, second: decodedB } } });
    expect(weddingCodeEntryHash(pair!)).toBe(pairHash);
  });

  it("# 없이도 읽고, 키 순서가 달라도 같은 링크로 읽는다(빈 조각은 다른 판과 똑같이 무시한다)", () => {
    expect(parseWeddingCodeEntryHash(soloHash.slice(1))).toEqual(parseWeddingCodeEntryHash(soloHash));
    expect(parseWeddingCodeEntryHash(`#v=${V40}&&a=${A}`)).toEqual(parseWeddingCodeEntryHash(soloHash));
    expect(parseWeddingCodeEntryHash(`#b=${B}&a=${A}&v=${V40}`)).toEqual(parseWeddingCodeEntryHash(pairHash));
  });

  it("상대 답이 하나만 바뀌어도 진입 state 의 key 가 달라진다", () => {
    const solo = parseWeddingCodeEntryHash(soloHash)!;
    const pair = parseWeddingCodeEntryHash(pairHash)!;
    const sameTwice = parseWeddingCodeEntryHash(`${soloHash}&b=${A}`)!;
    expect(weddingCodeEntryKey(solo)).toBe(soloHash);
    expect(new Set([solo, pair, sameTwice].map(weddingCodeEntryKey)).size).toBe(3);
  });

  it("깨진 v4 링크는 하나도 살리지 않고 v4 오류로 거절한다", () => {
    const allSkip = `0${V40_SKIP_CHAR.repeat(68)}`;
    const onlyNa = `1${V40_NA_CHAR.repeat(68)}`;
    const v31Code = encodeV31({ ...createV31Draft(), answers: { B1: 5 } });
    const malformed = [
      `#v=${V40}`, `#v=${V40}&b=${B}`, `#v=${V40}&a=`, `#v=${V40}&a=${A}&a=${A}`, `#v=${V40}&a=${A}&b=${B}&b=${B}`,
      `#v=${V40}&a=${A}&v=${V40}`, `#v=${V40}&a=${A}&other=1`, `#v=${V40}&a=${A}&utm_source=x`, `#v=${V40}&a=${A}&b=broken`,
      `#v=${V40}&a=${A}&b=${B.slice(0, -1)}`, `#v=${V40}&a=${A.slice(0, -1)}`, `#v=${V40}&a=${A}x`, `#v=${V40}&a=${A.toLowerCase()}`,
      `#v=${V40}&a=${v31Code}`, `#v=${V40}&a=${allSkip}${checksumChar(allSkip)}`, `#v=${V40}&a=${onlyNa}${checksumChar(onlyNa)}`,
      `#v=${V40}&a=${A}&b=`, `#v=${V40}&a=${"x".repeat(70)}`, `#v=${V40}&a=${A} `, `#v=${V40}&a`,
    ];
    for (const hash of malformed) expect(parseWeddingCodeEntryHash(hash), hash).toEqual(V40_BROKEN);
  });

  it("코드의 어느 한 글자를 바꿔도 링크 전체를 거절한다(체크섬)", () => {
    for (let index = 0; index < A.length; index += 1) {
      for (const replacement of ["0", "1", "z", "Z", V40_SKIP_CHAR, V40_NA_CHAR]) {
        if (A[index] === replacement) continue;
        const damaged = `${A.slice(0, index)}${replacement}${A.slice(index + 1)}`;
        expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${damaged}`), `${index}:${replacement}`).toEqual(V40_BROKEN);
        expect(parseWeddingCodeEntryHash(`${soloHash}&b=${damaged}`), `b ${index}:${replacement}`).toEqual(V40_BROKEN);
      }
    }
  });

  it("v4 코드는 옛 판 링크로 읽히지 않고, 다른 판의 깨진 링크는 v4 오류가 되지 않는다", () => {
    for (const hash of [
      `#a=${A}`, `#a=${A}&b=${B}`, `#v=${V31}&a=${A}`, `#v=${WEDDING_CODE_V30_VERSION}&a=${A}`, `#v=${WEDDING_CODE_V06_VERSION}&a=${A}`,
      `#v=${WEDDING_CODE_V12_VERSION}&a=${A}&b=${B}`, `#v=v2.0-agreement&a=${A}`, `#v=v9-unknown&a=${A}`,
    ]) {
      expect(parseWeddingCodeEntryHash(hash), hash).toEqual(GENERIC_ERROR);
    }
    expect(parseWeddingCodeEntryHash(`#v=${V31}&a=broken`)).toEqual(GENERIC_ERROR);
  });

  it("문항 은행 없이 배치 골격으로 풀어도 은행으로 푼 것과 모든 고정 표본에서 같다", () => {
    expect(V40_FIXTURES.length).toBeGreaterThanOrEqual(12);
    for (const fixture of V40_FIXTURES) {
      const code = encodeCode(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
      if (code === null) continue;
      const expected = decodeCode(WEDDING_CODE_V40_BANK, code);
      const hash = `#v=${V40}&a=${code}`;
      expect(parseWeddingCodeEntryHash(hash), fixture.name).toEqual({ kind: "v40", initial: { partner: expected, both: null } });
      expect(weddingCodeEntryHash(parseWeddingCodeEntryHash(hash)!), fixture.name).toBe(hash);
    }
  });

  it("아무 문자열이나 넣어도 은행으로 푼 결과와 같은 판정이고 던지지 않는다", () => {
    let seed = 20260929;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
    for (let round = 0; round < 200; round += 1) {
      const length = round % 5 === 0 ? 70 : next() % 90;
      let text = "";
      for (let index = 0; index < length; index += 1) text += alphabet[next() % alphabet.length];
      const viaBank = decodeCode(WEDDING_CODE_V40_BANK, text);
      const entry = parseWeddingCodeEntryHash(`#v=${V40}&a=${text}`);
      expect(entry !== null && entry.kind === "v40", text).toBe(viaBank !== null);
    }
  });
});

describe("웨딩코드 4.0 진입: 기본 진입을 v4 로 바꿨을 때(상수 하나)", () => {
  const options = { defaultVersion: V40 } as const;

  it("v 없는 답 없는 입구는 v4, 명시 v3.1(답 없음)은 이전 판 안내가 붙은 v3.1 이다", () => {
    expect(parseWeddingCodeEntryQuery({}, options)).toEqual(EMPTY_V40_ENTRY);
    expect(parseWeddingCodeEntryQuery({ utm_source: "landing" }, options)).toEqual(EMPTY_V40_ENTRY);
    expect(parseWeddingCodeEntryQuery({ v: V31 }, options)).toEqual(OLDER_V31_ENTRY);
    expect(parseWeddingCodeEntryQuery({ v: V31 }, options)).toMatchObject({ kind: "v31", older: true });
    expect(parseWeddingCodeEntryQuery({ v: V40 }, options)).toEqual(EMPTY_V40_ENTRY);
  });

  it("답이 든 옛 링크와 다른 판의 입구, 오류는 예전 그대로다", () => {
    const code = encodeV31({ ...createV31Draft(), answers: { B1: 5 } });
    expect(parseWeddingCodeEntryHash(`#v=${V31}&a=${code}`, options)).toEqual(parseWeddingCodeEntryHash(`#v=${V31}&a=${code}`));
    expect(parseWeddingCodeEntryHash(`#v=${V31}&a=${code}`, options)).not.toHaveProperty("older");
    expect(parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V30_VERSION }, options).kind).toBe("v30");
    expect(parseWeddingCodeEntryQuery({ v: V31, a: code }, options)).toEqual(GENERIC_ERROR);
    expect(parseWeddingCodeEntryQuery({ v: V31, other: "1" }, options)).toEqual(GENERIC_ERROR);
    expect(parseWeddingCodeEntryHash(soloHash, options)).toEqual(parseWeddingCodeEntryHash(soloHash));
  });
});

describe("웨딩코드 4.0 진입: 다시 시작의 도착 판", () => {
  it("도착 판마다 입구와 주소의 쿼리가 정해져 있다(기본 판이 v3.1 인 동안)", () => {
    expect(weddingCodeRestartEntry("default")).toBe(EMPTY_WEDDING_CODE_ENTRY);
    expect(weddingCodeRestartEntry("v31")).toBe(EMPTY_WEDDING_CODE_ENTRY);
    expect(weddingCodeRestartEntry("v40")).toBe(EMPTY_V40_ENTRY);
    expect(weddingCodeRestartSearch("default")).toBe("");
    expect(weddingCodeRestartSearch("v31")).toBe("");
    expect(weddingCodeRestartSearch("v40")).toBe(`?v=${V40}`);
  });

  it("기본 판이 v4 로 바뀐 뒤: v3.1 의 다시 시작은 v3.1 빈 입구(이전 판 안내), 기본은 v4", () => {
    expect(weddingCodeRestartEntry("default", V40)).toBe(EMPTY_V40_ENTRY);
    expect(weddingCodeRestartEntry("v31", V40)).toBe(OLDER_V31_ENTRY);
    expect(weddingCodeRestartEntry("v40", V40)).toBe(EMPTY_V40_ENTRY);
    expect(weddingCodeRestartSearch("default", V40)).toBe("");
    expect(weddingCodeRestartSearch("v31", V40)).toBe(`?v=${V31}`);
    expect(weddingCodeRestartSearch("v40", V40)).toBe("");
  });

  it("다시 시작 주소의 쿼리에는 판 이름만 있고 답은 없다", () => {
    for (const target of ["default", "v31", "v40"] as const) {
      for (const defaultVersion of [V31, V40] as const) {
        const search = weddingCodeRestartSearch(target, defaultVersion);
        expect(search === "" || search === `?v=${V31}` || search === `?v=${V40}`).toBe(true);
        // 그 주소를 다시 읽으면 도착 판의 입구가 되어 새로고침해도 같은 판이 열린다.
        const reopened = parseWeddingCodeEntryQuery(new URLSearchParams(search), { defaultVersion });
        expect(weddingCodeEntryKey(reopened)).toBe(weddingCodeEntryKey(weddingCodeRestartEntry(target, defaultVersion)));
      }
    }
  });
});

describe("웨딩코드 4.0 진입: v4 문구와 화면이 v3.1 길로 들어오지 않는다", () => {
  const read = (name: string) => readFileSync(join(here, name), "utf8");
  const specifiers = (source: string) => [...source.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/gu)].map((match) => match[1]);

  it("entry.ts 는 v4 의 코덱, 배치 골격, 타입, 상수만 가져온다(문구가 든 은행과 화면은 가져오지 않는다)", () => {
    const imports = specifiers(read("entry.ts")).filter((spec) => /v40|V40/u.test(spec));
    expect(imports.sort()).toEqual([
      "@/constants/weddingCodeV40",
      "@/lib/weddingCode/v40/codec",
      "@/lib/weddingCode/v40/layout",
      "@/lib/weddingCode/v40/types",
    ]);
  });

  it("입구 클라이언트는 v4 화면을 next/dynamic 으로만 부르고, v4 에서는 작은 입구 문구(entryCopy)와 타입만 가져온다", () => {
    const source = read("WeddingCodeEntryClient.tsx");
    const imports = specifiers(source);
    expect(imports.filter((spec) => /WeddingCodeV40Client/u.test(spec))).toEqual(["./WeddingCodeV40Client"]);
    expect(source).toMatch(/dynamic<WeddingCodeV40ClientProps>\(\(\) => import\("\.\/WeddingCodeV40Client"\)/u);
    expect(source).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+["']\.\/WeddingCodeV40Client["']/mu);
    // 화면 문구 전체(copy.ts)는 크기가 커서, 입구가 가져오면 v4 를 쓰지 않는 방문자의 기본(v3.1) 첫 화면에도 실린다.
    expect(imports.filter((spec) => /lib\/weddingCode\/v40/u.test(spec)).sort()).toEqual([
      "@/lib/weddingCode/v40/entryCopy",
      "@/lib/weddingCode/v40/types",
    ]);
  });

  it("입구 파일 어디도 큰 화면 문구(copy.ts)를 가져오지 않고, 작은 입구 문구 파일은 아무것도 가져오지 않는다", () => {
    for (const name of ["entry.ts", "WeddingCodeEntryClient.tsx"]) {
      const bigCopy = specifiers(read(name)).filter((spec) => /(^|\/)copy(\.ts)?$/u.test(spec) && /v40/u.test(spec));
      expect(bigCopy, `${name} 이 v4 화면 문구(copy.ts)를 가져온다`).toEqual([]);
    }
    const entryCopySource = readFileSync(join(here, "../../lib/weddingCode/v40/entryCopy.ts"), "utf8");
    expect(specifiers(entryCopySource), "entryCopy.ts 는 다른 파일을 가져오지 않는다").toEqual([]);
    // 입구 문구는 이 작은 파일 한 곳에만 있고 화면 문구(copy.ts)는 같은 값을 가리킨다(같은 말이 두 곳에서 갈라지지 않는다).
    expect(V40_ENTRY_COPY_FROM_COPY).toBe(V40_ENTRY_COPY);
  });

  it("v3.1 진행 저장을 입구가 직접 읽지 않는다(그 감지는 v4 저장 모듈의 probeLegacyV31Progress 뿐)", () => {
    for (const name of ["entry.ts", "WeddingCodeEntryClient.tsx", "page.tsx", "WeddingCodeV40Client.tsx"]) {
      const imports = specifiers(read(name));
      expect(imports.filter((spec) => /useV31LocalProgress|v31LocalProgress|weddingCode\/v31LocalProgress/u.test(spec)), name).toEqual([]);
      expect(read(name), name).not.toMatch(/hanbang:wedding-code:v3\.1|localStorage/u);
    }
  });
});
