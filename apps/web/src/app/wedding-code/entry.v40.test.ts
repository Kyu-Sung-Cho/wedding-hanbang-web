import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_VERSION } from "@/constants/weddingCodeV06";
import { WEDDING_CODE_V12_VERSION } from "@/constants/weddingCodeV12";
import { WEDDING_CODE_V30_VERSION } from "@/constants/weddingCodeV30";
import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { V40_NA_CHAR, V40_SKIP_CHAR, V40_STATE_ALPHABET, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { createV31Draft, encodeV31 } from "@/lib/weddingCode/v31";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { checksumChar, decodeCode, encodeCode } from "@/lib/weddingCode/v40/codec";
import { fromCodeChar, isResponseValueFor } from "@/lib/weddingCode/v40/states";
import { V40_ENTRY_COPY as V40_ENTRY_COPY_FROM_COPY } from "@/lib/weddingCode/v40/copy";
import { V40_ENTRY_COPY } from "@/lib/weddingCode/v40/entryCopy";
import { V40_FIXTURES, fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import {
  EMPTY_V40_ENTRY,
  EMPTY_WEDDING_CODE_ENTRY,
  OLDER_V31_ENTRY,
  WEDDING_CODE_DEFAULT_VERSION,
  defaultWeddingCodeEntry,
  mentionsWeddingCodeV40,
  parseWeddingCodeEntryHash,
  parseWeddingCodeEntryQuery,
  weddingCodeDefaultsToV40,
  weddingCodeEntryHash,
  weddingCodeEntryInAddressContext,
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

  it("v4 판 이름이 아닌 값은 v4 화면을 열지 않는다: 이름이 보이지 않으면 예전 오류 그대로이고, 이름이 보이면(대소문자 무시) 같은 오류가 v4 문구와 v4 다시 시작을 쓴다", () => {
    // 끝의 공백은 2026-10-04 결정으로 걷어내고 읽는다(아래 「링크 끝에 붙은 글자」). 앞의 공백은 붙어 올 수 없어서 그대로 거절한다.
    for (const version of ["", "v4.0", "v4-tendency"]) {
      expect(parseWeddingCodeEntryQuery({ v: version }), JSON.stringify(version)).toEqual(GENERIC_ERROR);
    }
    // 이름이 보이는 값은 열리지 않고(정확히 같은 이름만 연다) 오류 화면만 v4 것을 쓴다(2026-10-04 재확인 항목 3).
    for (const version of [" v4.0-tendency", "V4.0-TENDENCY", "v4.0-tendency-x", "V4.0-Tendency", "v4%2E0%2Dtendency", "x%76%34.0-tendency"]) {
      expect(parseWeddingCodeEntryQuery({ v: version }), JSON.stringify(version)).toEqual(V40_BROKEN);
      expect(parseWeddingCodeEntryQuery(new URLSearchParams({ v: version })), JSON.stringify(version)).toEqual(V40_BROKEN);
    }
    // 반복된 v 중 하나에라도 이름이 보이면 같다. v 가 아닌 키에 이름이 있는 것은 판 이름이 아니라서 오류 문구를 바꾸지 않는다.
    expect(parseWeddingCodeEntryQuery({ v: ["V4.0-TENDENCY", "v3.1-preferences"] })).toEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryQuery({ v: V31, other: V40 })).toEqual(GENERIC_ERROR);
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
      `#v=${V40}&a=${A}&b=`, `#v=${V40}&a=${"x".repeat(70)}`, `#v=${V40}&a=${A}0`, `#v=${V40}&a=${A}&b=${B}x`, `#v=${V40}&a`,
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

  it("문항 형식에 없는 상태 값은 체크섬을 맞게 다시 계산해도 링크 전체를 거절한다(체크섬은 0 과 Z 처럼 같은 값을 내는 글자를 구별하지 못하므로 형식별 범위 검사가 막는다)", () => {
    let planted = 0;
    WEDDING_CODE_V40_BANK.items.forEach((item, index) => {
      for (const char of V40_STATE_ALPHABET) {
        const value = fromCodeChar(char);
        if (value === null || isResponseValueFor(item.fmt, value)) continue;
        // 코드의 index + 1 번째 글자가 문항 index 의 답이다. 그 자리만 형식에 없는 글자로 바꾸고 체크섬을 다시 맞춘다.
        const body = `${A.slice(0, index + 1)}${char}${A.slice(index + 2, A.length - 1)}`;
        const forged = `${body}${checksumChar(body)}`;
        expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${forged}`), `${item.id}:${char}`).toEqual(V40_BROKEN);
        expect(parseWeddingCodeEntryHash(`${soloHash}&b=${forged}`), `b ${item.id}:${char}`).toEqual(V40_BROKEN);
        planted += 1;
      }
    });
    // 이 시험이 비어 지나가지 않게: 문항 68개마다 형식에 없는 글자가 여럿 있다.
    expect(planted).toBeGreaterThan(500);
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
      // 4.1 단계 2: 서로 짐작하기의 링크 코덱 하나(상수, states, codec, 타입만 가져오는 파일. 문구와 세트 자료와 화면은 가져오지 않는다: entry.guess.test.ts 가 이어서 확인한다).
      "@/lib/weddingCode/v40/guess/guessLink",
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

/**
 * 링크 끝에 붙은 글자(2026-10-04 파운더 결정, 감사 A46).
 *
 * 예전에는 판 이름과 코드가 정확히 같을 때만 읽어서 끝에 마침표 하나만 붙어도 링크 전체를 거절했고, 문장 속에 주소를 넣어 보내면 흔히 생겼다
 * (위의 「v4 판 이름이 아닌 값은 v4 로 추정하지 않는다」가 그 엄격함을 못박고 있었다). 이제 읽는 규칙은 이렇다.
 *   - 값 끝에서 그 값의 마지막 글자가 될 수 없는 글자(문장부호, 괄호, 슬래시, 공백, 한글 조사)의 덩어리를 한 번만 걷어낸다.
 *   - 걷어낸 결과가 판 이름이나 코드와 정확히 같을 때만 읽는다. 체크섬과 길이 검사는 그대로고, 일부만 읽는 일은 없다.
 *   - 엄격함이 지키던 것은 그대로다: 틀린 판으로 열리지 않고, 틀린 답을 보여 주지 않는다. 걷어낼 수 없는 것(영문자나 숫자가 더 붙음, 대소문자, 앞의 글자,
 *     판 이름 오타)과 체크섬이 틀린 코드, 길이가 다른 코드, 알 수 없는 판은 계속 거절한다.
 */
describe("링크 끝에 붙은 글자: 한 번 걷어낸 결과가 정확히 같을 때만 연다", () => {
  const TAILS = [".", ",", ")", "!", "?", "~", "/", " ", "\n", "요", "를", "입니다", ".)", ").", "...", "。"];
  const EMPTY_V40 = { kind: "v40", initial: { partner: null, both: null } };

  it("답 없는 v4 입구(?v=v4.0-tendency)는 끝에 붙은 글자를 걷어내고 v4 입구로 연다", () => {
    for (const tail of TAILS) {
      expect(parseWeddingCodeEntryQuery({ v: `${V40}${tail}` }), JSON.stringify(tail)).toEqual(EMPTY_V40);
      expect(parseWeddingCodeEntryQuery(new URLSearchParams({ v: `${V40}${tail}` })), JSON.stringify(tail)).toEqual(EMPTY_V40);
    }
    // 유입 경로 매개변수는 예전처럼 무시한다.
    expect(parseWeddingCodeEntryQuery({ v: `${V40}.`, utm_source: "kakao" })).toEqual(EMPTY_V40);
  });

  it("끝에 붙은 글자가 있어도 쿼리에 실린 답은 여전히 거절하고 v4 오류 화면으로 보낸다(답은 # 뒤로만 받는다)", () => {
    expect(parseWeddingCodeEntryQuery({ v: `${V40}.`, a: A })).toEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryQuery({ v: [`${V40}.`, V40] })).toEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryQuery({ v: [`${V40}.`], a: [A, A] })).toEqual(V40_BROKEN);
  });

  it("v4 답 링크의 코드(a, b) 끝에 붙은 글자도 한 번 걷어내고 읽으며, 읽은 결과는 붙지 않은 링크와 같다", () => {
    for (const tail of TAILS) {
      expect(parseWeddingCodeEntryHash(`${soloHash}${tail}`), JSON.stringify(tail)).toEqual(parseWeddingCodeEntryHash(soloHash));
      expect(parseWeddingCodeEntryHash(`${pairHash}${tail}`), JSON.stringify(tail)).toEqual(parseWeddingCodeEntryHash(pairHash));
    }
    // 판 이름 끝도 같다.
    expect(parseWeddingCodeEntryHash(`#v=${V40}.&a=${A}`)).toEqual(parseWeddingCodeEntryHash(soloHash));
  });

  it("걷어낸 결과가 체크섬이나 길이에 맞지 않으면 끝 글자를 걷어내도 거절한다(틀린 답을 보여 주지 않는다)", () => {
    const damaged = `${A.slice(0, 10)}${A[10] === "0" ? "1" : "0"}${A.slice(11)}`;
    expect(decodeCode(WEDDING_CODE_V40_BANK, damaged)).toBeNull();
    for (const tail of ["", ".", ")", "요"]) {
      expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${damaged}${tail}`), JSON.stringify(tail)).toEqual(V40_BROKEN);
      expect(parseWeddingCodeEntryHash(`${soloHash}&b=${damaged}${tail}`), JSON.stringify(tail)).toEqual(V40_BROKEN);
      // 길이가 다른 코드(한 글자 모자라거나 한 글자 많음)
      expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A.slice(0, -1)}${tail}`), JSON.stringify(tail)).toEqual(V40_BROKEN);
      expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}0${tail}`), JSON.stringify(tail)).toEqual(V40_BROKEN);
    }
  });

  it("걷어낼 수 없는 글자(영문자와 숫자)가 붙은 판 이름과 코드는 거절한다: 오타, 대소문자, 앞의 글자", () => {
    for (const version of [`${V40}x`, `${V40}0`, V40.slice(0, -1), `${V40.slice(0, -1)}.`, V40.toUpperCase(), `.${V40}`, "v4.0-tendancy", "v4.0-tendency-x."]) {
      // 열리지 않는 것은 모두 같다. 판 이름이 보이는 값만 오류 화면이 v4 문구를 쓴다(대소문자 무시).
      expect(parseWeddingCodeEntryQuery({ v: version }), version).toEqual(version.toLowerCase().includes(V40) ? V40_BROKEN : GENERIC_ERROR);
      expect(parseWeddingCodeEntryHash(`#v=${version}&a=${A}`), version).not.toMatchObject({ kind: "v40" });
      expect(parseWeddingCodeEntryHash(`#v=${version}&a=${A}`)?.kind, version).toBe("error");
    }
    for (const code of [`${A}x`, `.${A}`, ` ${A}`, A.toLowerCase(), `${A}.x`]) {
      expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${code}`), code).toEqual(V40_BROKEN);
    }
    // 끝 글자를 걷어낸 결과가 비면 원래 값 그대로 거절한다.
    for (const version of [".", ")", "요", "  "]) {
      expect(parseWeddingCodeEntryQuery({ v: version }), version).toEqual(GENERIC_ERROR);
    }
  });

  it("v3.1 코드도 v4 처럼 끝에 영문자와 숫자가 붙으면 대소문자와 상관없이 거절하고, 문장부호만 걷어낸다", () => {
    const code = encodeV31({ ...createV31Draft(), answers: { B1: 5 } });
    const clean = parseWeddingCodeEntryHash(`#v=${V31}&a=${code}`);
    expect(clean?.kind).toBe("v31");
    expect(clean).toMatchObject({ initial: { partnerCode: code } });
    for (const tail of [".", "..", ")", "요", "_", ". "]) {
      expect(parseWeddingCodeEntryHash(`#v=${V31}&a=${code}${tail}`), JSON.stringify(tail)).toEqual(clean);
    }
    for (const tail of ["A", "X", "Z", "x", "0", "9", "A.", "AB", "-A"]) {
      expect(parseWeddingCodeEntryHash(`#v=${V31}&a=${code}${tail}`), JSON.stringify(tail)).toEqual(GENERIC_ERROR);
      expect(parseWeddingCodeEntryHash(`#v=${V31}&a=${code}&b=${code}${tail}`), `b ${JSON.stringify(tail)}`).toEqual(GENERIC_ERROR);
    }
  });

  it("끝 글자를 걷어내도 판은 섞이지 않는다: 다른 판의 이름과 코드는 그 판으로만 열린다", () => {
    expect(parseWeddingCodeEntryQuery({ v: `${V31}.` }).kind).toBe("v31");
    expect(parseWeddingCodeEntryQuery({ v: `${WEDDING_CODE_V30_VERSION}.` }).kind).toBe("v30");
    expect(parseWeddingCodeEntryQuery({ v: `${WEDDING_CODE_V12_VERSION}.` }).kind).toBe("legacy");
    // 알 수 없는 판 이름은 걷어내도 알 수 없다.
    expect(parseWeddingCodeEntryQuery({ v: "v9-unknown." })).toEqual(GENERIC_ERROR);
    // v3.1 코드를 v4 판 이름으로 보내면 열리지 않는다.
    const v31Code = encodeV31({ ...createV31Draft(), answers: { B1: 5 } });
    expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${v31Code}.`)).toEqual(V40_BROKEN);
  });

  it("# 뒤에 문서 안 이동 표시(#top)만 있거나 링크 끝에 더 붙어도 링크를 읽는다. 링크 모양이 아닌 짧은 조각은 링크가 아니다", () => {
    expect(parseWeddingCodeEntryHash(`${soloHash}#top`)).toEqual(parseWeddingCodeEntryHash(soloHash));
    expect(parseWeddingCodeEntryHash(`${pairHash}#section-2`)).toEqual(parseWeddingCodeEntryHash(pairHash));
    // 평소 입구로 열려도 되는 것은 =, & 가 없고 링크 키 이름으로 시작하지 않는 32자 이하의 조각뿐이다.
    for (const anchor of ["#top", "#x", "#section-2", "##top", "#about", "#back", "#guide", `#${"x".repeat(32)}`]) {
      expect(parseWeddingCodeEntryHash(anchor), anchor).toBeNull();
    }
    // 링크 키가 하나라도 있으면 예전처럼 엄격하다(여기서는 코드가 없거나 어긋나서 거절).
    for (const hash of ["#a", "#v", "#a=", "#v=bogus", `#v=${V40}`, `#v=${V40}&a=${A}&utm_source=x`]) {
      expect(parseWeddingCodeEntryHash(hash), hash).not.toBeNull();
    }
  });

  it("깨진 링크가 평소 시작 화면으로 새지 않는다: =, &(인코딩 포함), 링크 키 이름으로 시작하는 토큰, 32자를 넘는 해시는 링크 시도로 보고 오류다", () => {
    const encodedWithTail = `#${encodeURIComponent(soloHash.slice(1))}%`;
    const attempts = [
      encodedWithTail, // 해시 전체를 인코딩하고 끝에 % 하나가 붙어 풀리지 않는 링크
      `#v%3Dv4.0-tendency%26a%3D${A}%`,
      `#V=${V40}&A=${A}`, // 대문자 키
      `#ver=${V40}&a=${A}`, `#link=${V40}&a=${A}`, // 오타 키
      `#v=${V40}&Ａ=${A}`,
      "#a=1", "#v=bogus", "#utm_source=kakao", "#room=abc&invite=def", "#x=1", "#a", "#A", "#V", "#ga", "#v.x",
      `#${"x".repeat(33)}`, `#${"x".repeat(12000)}`, `#v%26a`, `#top%3Dx`,
    ];
    for (const options of [undefined, { defaultVersion: WEDDING_CODE_V40_VERSION }] as const) {
      for (const hash of attempts) {
        expect(parseWeddingCodeEntryHash(hash, options), hash.slice(0, 80)).not.toBeNull();
        expect(parseWeddingCodeEntryHash(hash, options)?.kind, hash.slice(0, 80)).toBe("error");
      }
    }
    // 같은 모양이라도 키가 옳고 코드가 맞으면 평소처럼 열린다(위 거절이 키와 코드 때문임을 확인한다).
    expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}`)?.kind).toBe("v40");
  });

  it("브라우저가 떼어 내는 :~:text= 텍스트 지시문이 남아 있어도 무시한다", () => {
    expect(parseWeddingCodeEntryHash(`${soloHash}:~:text=hello`)).toEqual(parseWeddingCodeEntryHash(soloHash));
    expect(parseWeddingCodeEntryHash(`${pairHash}#top:~:text=a%20b`)).toEqual(parseWeddingCodeEntryHash(pairHash));
    for (const anchor of ["#top:~:text=hello", "#:~:text=hello", "#x:~:text=a&b"]) {
      expect(parseWeddingCodeEntryHash(anchor), anchor).toBeNull();
    }
  });

  it("# 뒤 전체가 퍼센트 인코딩되어 와도 한 번 풀어 읽는다(풀 수 없으면 거절한다)", () => {
    const encoded = `#${encodeURIComponent(soloHash.slice(1))}`;
    expect(encoded).toContain("%3D");
    expect(parseWeddingCodeEntryHash(encoded)).toEqual(parseWeddingCodeEntryHash(soloHash));
    expect(parseWeddingCodeEntryHash(`#${encodeURIComponent(pairHash.slice(1))}`)).toEqual(parseWeddingCodeEntryHash(pairHash));
    // 끝에 붙은 글자와 같이 와도 같다.
    expect(parseWeddingCodeEntryHash(`${encoded}%29`)).toEqual(parseWeddingCodeEntryHash(soloHash));
    // 풀 수 없는 퍼센트 부호는 던지지 않고 거절한다(인코딩된 구분자가 있으면 링크 시도라서 시작 화면이 아니라 오류 화면이다).
    expect(() => parseWeddingCodeEntryHash("#v%3Dv4.0-tendency%26a%3D%")).not.toThrow();
    // v4 판 이름이 보이는 풀 수 없는 링크는 v4 오류다(오류 화면이 v4 문구와 v4 다시 시작을 쓴다). 열리지는 않는다.
    expect(parseWeddingCodeEntryHash("#v%3Dv4.0-tendency%26a%3D%")).toEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryHash(`${encoded}%`)).toEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryHash("#%3D%E0%A4%A")).toEqual(GENERIC_ERROR);
  });

  it("v4 판 이름이 보이는 깨진 해시는 어떻게 깨졌든 v4 오류다(대소문자 무시, 퍼센트 부호로 적은 이름 포함). 열리지는 않고, 이름이 보이지 않는 깨진 해시는 예전 오류 그대로다", () => {
    const encoded = encodeURIComponent(soloHash.slice(1));
    const broken = [
      `#V=${V40}&A=${A}`, // 대문자 키
      `#V=${V40.toUpperCase()}&A=${A}`, // 대문자 이름
      `#v=${V40.toUpperCase()}&a=${A}`, // 이름만 대문자(열리지 않는다)
      `#${encoded}%`, // 통째로 인코딩하고 끝에 % 가 붙어 풀리지 않는 링크
      `#${encoded.replace(/\./gu, "%2E").replace(/-/gu, "%2D")}%`, // 이름의 점과 줄까지 인코딩
      `#ver=${V40}&a=${A}`, `#link=${V40}&a=${A}`, // 오타 키
      `#utm_source=${V40}`, `#x=1&v4.0-tendency`,
      `#v=${V40}&a=${A}&utm_source=kakao`, // 모르는 키가 섞인 링크
    ];
    for (const options of [undefined, { defaultVersion: WEDDING_CODE_V40_VERSION }] as const) {
      for (const hash of broken) {
        expect(parseWeddingCodeEntryHash(hash, options), hash.slice(0, 80)).toEqual(V40_BROKEN);
      }
      // 이름이 보이지 않으면 예전 그대로다(다른 판의 깨진 링크, 추적 해시, 이름 오타).
      for (const hash of ["#V=v3.1-preferences&A=x", "#utm_source=kakao", "#room=abc&invite=def", "#v=v4.0-tendancy&a=x", "#v=v4.0&a=x", `#${encodeURIComponent("v=v3.1-preferences&a=x")}%`]) {
        expect(parseWeddingCodeEntryHash(hash, options), hash).toEqual(GENERIC_ERROR);
      }
    }
    // 이름이 보여도 열리는 규칙은 그대로다: 맞는 링크는 열리고, 체크섬이나 길이가 어긋나면 일부만 살리지 않고 모두 거절한다.
    expect(parseWeddingCodeEntryHash(soloHash)?.kind).toBe("v40");
    expect(parseWeddingCodeEntryHash(`${soloHash}&b=${A.slice(0, -1)}`)).toEqual(V40_BROKEN);
    expect(parseWeddingCodeEntryHash(`#V=${V40}&A=${A}&b=${B}`)).toEqual(V40_BROKEN);
    // 이름만 보이고 열리지 않는 모양은 끝까지 오류다(던지지 않는다).
    for (const hash of broken) expect(() => parseWeddingCodeEntryHash(hash)).not.toThrow();
  });

  it("v4 판 이름 찾기(mentionsWeddingCodeV40): 대소문자 무시, 퍼센트 부호 풀이, 이름이 아닌 것은 거짓, 긴 입력에서도 선형", () => {
    for (const text of [V40, V40.toUpperCase(), `x${V40}y`, `v=${V40}&a=1`, "v4%2E0%2Dtendency", "%76%34.0-tendency", `#v%3Dv4.0-tendency%26a%3D%`, `${"%".repeat(5000)}${V40}`]) {
      expect(mentionsWeddingCodeV40(text), text.slice(0, 40)).toBe(true);
    }
    for (const text of ["", "%", "%zz", "v4.0", "v4-tendency", "v4.0-tendancy", "v3.1-preferences", "v4%2E0%2Dtendenc", "%E0%A4%A", "tendency-v4.0"]) {
      expect(mentionsWeddingCodeV40(text), text).toBe(false);
    }
    const started = Date.now();
    expect(mentionsWeddingCodeV40("%".repeat(1_000_000))).toBe(false);
    expect(mentionsWeddingCodeV40(`%41`.repeat(300_000))).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("해시만으로 판을 알 수 없는 읽을 수 없는 조각은 주소의 쿼리가 v4 일 때 v4 오류다(weddingCodeEntryInAddressContext)", () => {
    const hashEntry = parseWeddingCodeEntryHash("#utm_source=kakao");
    expect(hashEntry).toEqual(GENERIC_ERROR);
    expect(weddingCodeEntryInAddressContext(hashEntry, `?v=${V40}`)).toEqual(V40_BROKEN);
    expect(weddingCodeEntryInAddressContext(hashEntry, "?v=V4.0-TENDENCY")).toEqual(V40_BROKEN);
    // 쿼리가 v4 가 아니면 그대로, 오류가 아니거나 이미 v4 오류인 것도 그대로다.
    expect(weddingCodeEntryInAddressContext(hashEntry, "")).toEqual(GENERIC_ERROR);
    expect(weddingCodeEntryInAddressContext(hashEntry, `?v=${V31}`)).toEqual(GENERIC_ERROR);
    expect(weddingCodeEntryInAddressContext(null, `?v=${V40}`)).toBeNull();
    const opened = parseWeddingCodeEntryHash(soloHash);
    expect(weddingCodeEntryInAddressContext(opened, `?v=${V40}`)).toBe(opened);
    expect(weddingCodeEntryInAddressContext(V40_BROKEN, "")).toBe(V40_BROKEN);
  });

  it("끝 글자 읽기는 긴 입력에서 역추적하지 않는다(선형 시간)", () => {
    const started = Date.now();
    const noisy = "!".repeat(11000);
    expect(parseWeddingCodeEntryQuery({ v: `${V40}${noisy}` })).toEqual(EMPTY_V40);
    expect(parseWeddingCodeEntryHash(`#v=${V40}&a=${A}${noisy}`)).toEqual(parseWeddingCodeEntryHash(soloHash));
    expect(parseWeddingCodeEntryQuery({ v: `${noisy}x` })).toEqual(GENERIC_ERROR);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
