import { describe, expect, it } from "vitest";
import { V40_COUNTS, V40_STATE_ALPHABET, V40_STATE_COUNTS, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import type { CodecBankView, DecodedCode, FormBit, ResponseValue, Responses, V40Result } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import * as codecExports from "./codec";
import { V40_LAYOUT } from "./layout";
import {
  MAX_SHARE_HASH_LENGTH,
  buildGatedShareUrl,
  buildQuestionOnlyUrl,
  canShare,
  checksumChar,
  codecModule,
  decodeCode,
  decodeShareParams,
  encodeCode,
  parseShareHash,
} from "./codec";
import { V40_FIXTURES } from "./fixtures";
import { buildResult } from "./score";
import { isResponseValueFor, stateChar } from "./states";

const bank = WEDDING_CODE_V40_BANK;
const VALID_CHARS = `${V40_STATE_ALPHABET}-_`;

/** 문항 순서 i 번째에 그 형식의 (i mod 상태 수) 번째 상태를 준 응답. */
function goldenResponses(): Responses {
  const responses: Record<string, ResponseValue> = {};
  bank.items.forEach((item, i) => {
    responses[item.id] = stateChar(i % V40_STATE_COUNTS[item.fmt]);
  });
  return responses;
}

/** 건너뜀(7의 배수 자리에서 3 남는 곳)과 해당 없음(11 로 나눠 5 남는 곳)이 섞인 응답. */
function mixedResponses(): Responses {
  const responses: Record<string, ResponseValue> = {};
  bank.items.forEach((item, i) => {
    responses[item.id] = i % 7 === 3 ? "skip" : i % 11 === 5 ? "na" : stateChar((i * 5) % V40_STATE_COUNTS[item.fmt]);
  });
  return responses;
}

// 기준 계산기로 한 번 만들어 붙여 둔 고정 코드(배치가 바뀌면 판을 올려야 하므로 바뀌지 않는다).
const GOLDEN_FORM0 = "00123451721a30d2042630l25o11345212340813341630h2204232p41013301234501L";
const GOLDEN_FORM1 = "10123451721a30d2042630l25o11345212340813341630h2204232p41013301234501M";
const GOLDEN_MIXED_FORM1 = "1054-k_0b41-30920_-630l01-10_212-0320c5-321630-200_a3-d05010-_52321-5N";

/** 시험이 따로 쓰는 체크섬 계산(README 4절 공식을 그대로). */
function referenceChecksum(body: string): string {
  let total = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    const value = char === "-" ? 59 : char === "_" ? 60 : V40_STATE_ALPHABET.indexOf(char);
    total += ((i % 60) + 1) * value;
  }
  return V40_STATE_ALPHABET[total % 61];
}

/** 몸통을 바꾼 뒤 체크섬을 다시 맞춘 코드(체크섬은 맞고 다른 규칙이 어긋나는 코드를 만든다). */
function resealed(body: string): string {
  return body + referenceChecksum(body);
}

describe("체크섬", () => {
  it("공식과 손계산 표본: 위치 i 의 가중치는 (i mod 60) + 1, 값은 알파벳 색인, - 는 59, _ 는 60, 합을 61 로 나눈 나머지", () => {
    expect(checksumChar("")).toBe("0");
    expect(checksumChar("0".repeat(69))).toBe("0");
    expect(checksumChar(`${"0".repeat(68)}1`)).toBe("9"); // 위치 68: 가중치 9 x 값 1
    expect(checksumChar(`-${"0".repeat(68)}`)).toBe("X"); // 위치 0: 가중치 1 x 59 = 59, 알파벳[59] = X
    expect(checksumChar(`0_${"0".repeat(67)}`)).toBe("X"); // 위치 1: 가중치 2 x 60 = 120, 120 mod 61 = 59
    expect(checksumChar(`${"0".repeat(59)}1${"0".repeat(9)}`)).toBe("Y"); // 위치 59: 가중치 60 x 1 = 60, 알파벳[60] = Y
    expect(checksumChar(`${"0".repeat(60)}1${"0".repeat(8)}`)).toBe("1"); // 위치 60: 가중치가 다시 1
    expect(checksumChar(`${"0".repeat(61)}a${"0".repeat(7)}`)).toBe("k"); // 위치 61: 가중치 2 x 값 10 = 20, 알파벳[20] = k
    expect(checksumChar("Z")).toBe("0"); // 값 61 은 61 로 나눈 나머지 0
  });

  it("고정 코드의 마지막 글자가 몸통의 체크섬이다", () => {
    for (const code of [GOLDEN_FORM0, GOLDEN_FORM1, GOLDEN_MIXED_FORM1]) {
      expect(code).toHaveLength(70);
      expect(checksumChar(code.slice(0, 69))).toBe(code[69]);
      expect(referenceChecksum(code.slice(0, 69))).toBe(code[69]);
    }
  });

  it("알파벳, -, _ 밖의 문자와 문자열이 아닌 입력은 RangeError", () => {
    for (const bad of ["ab!", "가", "a b", ".", "0.1", "\n", "Ａ"]) expect(() => checksumChar(bad), JSON.stringify(bad)).toThrow(RangeError);
    expect(() => checksumChar(5 as unknown as string)).toThrow(RangeError);
    expect(() => checksumChar(null as unknown as string)).toThrow(RangeError);
  });

  it("검증 성질: 한 위치에서 쓸 수 있는 문자(상태 색인 0에서 27, 59, 60)는 61 로 나눈 나머지가 모두 다르다", () => {
    const values = [...Array.from({ length: 28 }, (_, i) => i), 59, 60];
    expect(new Set(values.map((value) => value % 61)).size).toBe(values.length);
    // 가중치 1에서 60 은 61 로 나누어떨어지지 않는다
    for (let weight = 1; weight <= 60; weight += 1) expect(weight % 61).not.toBe(0);
  });
});

describe("encodeCode", () => {
  it("고정 응답의 코드가 고정 문자열과 같다(폼 비트 0, 1)", () => {
    expect(encodeCode(bank, 0, goldenResponses())).toBe(GOLDEN_FORM0);
    expect(encodeCode(bank, 1, goldenResponses())).toBe(GOLDEN_FORM1);
    expect(encodeCode(bank, 1, mixedResponses())).toBe(GOLDEN_MIXED_FORM1);
  });

  it("코드는 70자: 폼 비트 1, 채점 문항 64, 자기 선택 4, 체크섬 1 이고 문항 문자는 저장값 그대로다", () => {
    const code = encodeCode(bank, 1, mixedResponses()) as string;
    expect(code).toHaveLength(V40_COUNTS.codeLength);
    expect(code[0]).toBe("1");
    bank.items.forEach((item, index) => {
      const value = mixedResponses()[item.id];
      const char = code[index + 1];
      expect(char).toBe(value === "skip" ? "-" : value === "na" ? "_" : value);
      expect(isResponseValueFor(item.fmt, char === "-" ? "skip" : char === "_" ? "na" : char)).toBe(true);
    });
    // 채점 64개 다음에 자기 선택 4개
    expect(bank.items.slice(64).every((item) => item.fmt === "self")).toBe(true);
    expect(code.slice(65, 69)).toBe(bank.self.map((item) => (mixedResponses()[item.id] === "skip" ? "-" : mixedResponses()[item.id] === "na" ? "_" : mixedResponses()[item.id])).join(""));
  });

  it("답하지 않은 문항이 하나라도 있으면 null", () => {
    const responses: Record<string, ResponseValue> = { ...goldenResponses() };
    for (const item of bank.items) {
      const without = { ...responses };
      delete without[item.id];
      expect(encodeCode(bank, 0, without), item.id).toBeNull();
    }
    expect(encodeCode(bank, 0, {})).toBeNull();
  });

  it("그 형식에 없는 상태 문자가 하나라도 있으면 null", () => {
    for (const item of bank.items) {
      const responses: Record<string, ResponseValue> = { ...goldenResponses(), [item.id]: stateChar(V40_STATE_COUNTS[item.fmt]) };
      expect(encodeCode(bank, 0, responses), item.id).toBeNull();
    }
    for (const bad of ["-", "_", ".", "", "가", "SKIP", "Na"]) {
      expect(encodeCode(bank, 0, { ...goldenResponses(), [bank.items[0].id]: bad })).toBeNull();
    }
  });

  it("상태 문자가 하나도 없으면(전부 건너뜀이나 해당 없음) null, 하나만 있으면 만든다", () => {
    const allSkip: Record<string, ResponseValue> = {};
    const skipAndNa: Record<string, ResponseValue> = {};
    bank.items.forEach((item, i) => {
      allSkip[item.id] = "skip";
      skipAndNa[item.id] = i % 2 === 0 ? "skip" : "na";
    });
    expect(encodeCode(bank, 0, allSkip)).toBeNull();
    expect(encodeCode(bank, 1, skipAndNa)).toBeNull();
    const one = { ...allSkip, [bank.items[10].id]: "0" };
    const code = encodeCode(bank, 0, one);
    expect(code).not.toBeNull();
    expect(decodeCode(bank, code)?.responses).toEqual(one);
  });

  it("폼 비트가 0, 1 이 아니면 null", () => {
    for (const bad of [2, -1, "0", null, undefined, Number.NaN]) {
      expect(encodeCode(bank, bad as unknown as FormBit, goldenResponses())).toBeNull();
    }
  });

  it("상속된 키는 응답으로 치지 않는다", () => {
    const inherited = Object.create({ ...goldenResponses() }) as Responses;
    expect(encodeCode(bank, 0, inherited)).toBeNull();
    expect(encodeCode(bank, 0, null as unknown as Responses)).toBeNull();
    expect(encodeCode(bank, 0, undefined as unknown as Responses)).toBeNull();
  });

  it("같은 입력에는 같은 코드를 낸다(순수)", () => {
    const frozen = Object.freeze(goldenResponses());
    expect(encodeCode(bank, 0, frozen)).toBe(encodeCode(bank, 0, frozen));
  });
});

describe("decodeCode", () => {
  it("고정 코드를 풀면 만든 응답과 폼 비트가 그대로 나온다", () => {
    expect(decodeCode(bank, GOLDEN_FORM0)).toEqual({ formBit: 0, responses: goldenResponses() });
    expect(decodeCode(bank, GOLDEN_FORM1)).toEqual({ formBit: 1, responses: goldenResponses() });
    expect(decodeCode(bank, GOLDEN_MIXED_FORM1)).toEqual({ formBit: 1, responses: mixedResponses() });
  });

  it("풀린 응답은 68개 문항이 모두 채워져 있다", () => {
    const decoded = decodeCode(bank, GOLDEN_MIXED_FORM1) as DecodedCode;
    expect(Object.keys(decoded.responses)).toHaveLength(68);
    expect(Object.keys(decoded.responses)).toEqual(bank.items.map((item) => item.id));
  });

  it("문자열이 아니거나 길이가 70 이 아니면 null", () => {
    for (const bad of [null, undefined, 5, {}, [], true, ""]) expect(decodeCode(bank, bad as unknown as string)).toBeNull();
    expect(decodeCode(bank, GOLDEN_FORM0.slice(0, 69))).toBeNull();
    expect(decodeCode(bank, `${GOLDEN_FORM0}0`)).toBeNull();
    expect(decodeCode(bank, `${GOLDEN_FORM0}${GOLDEN_FORM0}`)).toBeNull();
    expect(decodeCode(bank, ` ${GOLDEN_FORM0}`)).toBeNull();
    expect(decodeCode(bank, `${GOLDEN_FORM0} `)).toBeNull();
  });

  it("체크섬이 맞아도 폼 비트 문자가 0, 1 이 아니면 null", () => {
    for (const formChar of ["2", "a", "-", "_", "Z"]) {
      expect(decodeCode(bank, resealed(formChar + GOLDEN_FORM0.slice(1, 69)))).toBeNull();
    }
  });

  it("체크섬이 맞아도 그 위치의 형식에 없는 문자면 null(위치별 범위)", () => {
    bank.items.forEach((item, index) => {
      const body = GOLDEN_FORM0.slice(0, 69);
      for (const bad of [stateChar(V40_STATE_COUNTS[item.fmt]), "Z", "z"]) {
        const changed = `${body.slice(0, index + 1)}${bad}${body.slice(index + 2)}`;
        expect(decodeCode(bank, resealed(changed)), `${item.id} ${bad}`).toBeNull();
      }
    });
  });

  it("체크섬이 맞아도 알파벳 밖 문자는 null(몸통이 체크섬 계산을 못 해도 던지지 않는다)", () => {
    for (const bad of ["!", "가", " ", ".", "=", "#", "&", "%", "Ａ"]) {
      const body = `${GOLDEN_FORM0.slice(0, 5)}${bad}${GOLDEN_FORM0.slice(6, 69)}`;
      expect(decodeCode(bank, `${body}0`)).toBeNull();
    }
  });

  it("체크섬만 어긋나도 null", () => {
    const body = GOLDEN_FORM0.slice(0, 69);
    for (const char of V40_STATE_ALPHABET.slice(0, 61)) {
      if (char === GOLDEN_FORM0[69]) continue;
      expect(decodeCode(bank, body + char), char).toBeNull();
    }
  });

  it("상태 문자가 하나도 없으면(전부 건너뜀과 해당 없음) 체크섬이 맞아도 null", () => {
    const body = `0${"-".repeat(34)}${"_".repeat(34)}`;
    expect(body).toHaveLength(69);
    expect(decodeCode(bank, resealed(body))).toBeNull();
    // 하나만 상태 문자이면 풀린다
    const one = `0${"-".repeat(33)}0${"_".repeat(34)}`;
    expect(decodeCode(bank, resealed(one))).not.toBeNull();
  });

  it("한 글자를 다른 유효 글자로 바꾼 모든 경우를 거절한다(70자 x 유효 문자 전수, 코드 세 개)", () => {
    for (const code of [GOLDEN_FORM0, GOLDEN_FORM1, GOLDEN_MIXED_FORM1]) {
      let checked = 0;
      for (let at = 0; at < 70; at += 1) {
        for (const replacement of VALID_CHARS) {
          if (replacement === code[at]) continue;
          expect(decodeCode(bank, `${code.slice(0, at)}${replacement}${code.slice(at + 1)}`), `${at} ${replacement}`).toBeNull();
          checked += 1;
        }
      }
      expect(checked).toBe(70 * (VALID_CHARS.length - 1));
    }
  });

  it("서로 다른 이웃 글자를 바꾼 모든 경우를 거절한다", () => {
    for (const code of [GOLDEN_FORM0, GOLDEN_MIXED_FORM1]) {
      let swapped = 0;
      for (let at = 0; at < 69; at += 1) {
        if (code[at] === code[at + 1]) continue;
        expect(decodeCode(bank, `${code.slice(0, at)}${code[at + 1]}${code[at]}${code.slice(at + 2)}`), `위치 ${at}`).toBeNull();
        swapped += 1;
      }
      expect(swapped).toBeGreaterThan(40);
    }
  });

  it("알려진 한계: 60칸 떨어진 두 자리(0에서 8번과 60에서 68번)를 맞바꾸면 체크섬이 그대로다(가중치가 같다). 체크섬은 오타용이고 위조 방지가 아니다", () => {
    let sameChecksum = 0;
    let accepted = 0;
    for (const code of [GOLDEN_FORM0, GOLDEN_FORM1, GOLDEN_MIXED_FORM1]) {
      for (let at = 0; at <= 8; at += 1) {
        const far = at + 60;
        if (code[at] === code[far]) continue;
        const chars = [...code];
        [chars[at], chars[far]] = [chars[far], chars[at]];
        const swapped = chars.join("");
        // 가중치 (i mod 60) + 1 이 i 와 i + 60 에서 같으므로 합이 같다.
        expect(checksumChar(swapped.slice(0, 69)), `${at} <-> ${far}`).toBe(code[69]);
        sameChecksum += 1;
        // 두 자리 모두 서로의 형식에서도 유효한 문자일 때만 풀린다(위치별 범위 검사는 그대로 걸러 낸다).
        if (decodeCode(bank, swapped) !== null) accepted += 1;
      }
    }
    expect(sameChecksum).toBeGreaterThan(10);
    expect(accepted).toBeGreaterThan(0);
  });

  it("던지지 않는다: 무작위 문자열 4,000개 중 풀린 것은 다시 만들면 같은 코드다", () => {
    let seed = 987654321;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pool = `${VALID_CHARS}!가 .=#&%Ａ\u0000`;
    let decodedCount = 0;
    for (let n = 0; n < 4000; n += 1) {
      const mode = n % 4;
      let text = "";
      if (mode === 0) for (let i = 0; i < 70; i += 1) text += pool[Math.floor(next() * pool.length)];
      else if (mode === 1) {
        // 정상 코드를 조금 흔든다
        const base = [GOLDEN_FORM0, GOLDEN_FORM1, GOLDEN_MIXED_FORM1][n % 3].split("");
        for (let hits = 0; hits < 1 + (n % 3); hits += 1) base[Math.floor(next() * 70)] = pool[Math.floor(next() * pool.length)];
        text = base.join("");
      } else if (mode === 2) for (let i = 0; i < Math.floor(next() * 140); i += 1) text += pool[Math.floor(next() * pool.length)];
      else text = "0".repeat(Math.floor(next() * 90));
      const decoded = decodeCode(bank, text);
      if (decoded !== null) {
        decodedCount += 1;
        expect(encodeCode(bank, decoded.formBit, decoded.responses)).toBe(text);
      }
    }
    // 무작위로는 유효 코드가 거의 나오지 않는다
    expect(decodedCount).toBeLessThan(40);
  });
});

describe("왕복", () => {
  it("여러 응답이 encode -> decode 하면 폼 비트와 응답이 그대로다", () => {
    let seed = 24680;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let n = 0; n < 300; n += 1) {
      const responses: Record<string, ResponseValue> = {};
      for (const item of bank.items) {
        const r = next();
        responses[item.id] = r < 0.08 ? "skip" : r < 0.14 ? "na" : stateChar(Math.floor(next() * V40_STATE_COUNTS[item.fmt]));
      }
      const formBit = (n % 2) as FormBit;
      const code = encodeCode(bank, formBit, responses);
      expect(code).not.toBeNull();
      const decoded = decodeCode(bank, code);
      expect(decoded).toEqual({ formBit, responses });
    }
  });
});

describe("링크 만들기", () => {
  const first: DecodedCode = { formBit: 0, responses: goldenResponses() };
  const second: DecodedCode = { formBit: 1, responses: mixedResponses() };

  it("내 답과 함께 보내기: origin/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=<70자>(쿼리의 판 이름은 서버가 처음부터 v4 화면을 그리게 한다)", () => {
    expect(WEDDING_CODE_V40_VERSION).toBe("v4.0-tendency");
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", first)).toBe(`https://hanbang.ai/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${GOLDEN_FORM0}`);
  });

  it("두 사람 결과 링크는 &b= 를 더하고 키 순서는 v, a, b", () => {
    const url = buildGatedShareUrl(bank, "https://hanbang.ai", first, second) as string;
    expect(url).toBe(`https://hanbang.ai/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${GOLDEN_FORM0}&b=${GOLDEN_MIXED_FORM1}`);
    const fragment = url.split("#")[1];
    expect(fragment.indexOf("v=")).toBeLessThan(fragment.indexOf("&a="));
    expect(fragment.indexOf("&a=")).toBeLessThan(fragment.indexOf("&b="));
  });

  it("origin 끝의 / 는 모두 떼고, 쿼리는 판 이름 하나뿐이다", () => {
    const expected = `https://hanbang.ai/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${GOLDEN_FORM0}`;
    expect(buildGatedShareUrl(bank, "https://hanbang.ai/", first)).toBe(expected);
    expect(buildGatedShareUrl(bank, "https://hanbang.ai////", first)).toBe(expected);
    expect(buildGatedShareUrl(bank, "http://localhost:3000", first)).toBe(`http://localhost:3000/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${GOLDEN_FORM0}`);
    const url = buildGatedShareUrl(bank, "https://hanbang.ai", first) as string;
    // 쿼리는 서버가 읽는 판 이름 하나뿐이고 답은 # 뒤에만 있다(서버는 # 뒤를 보지 못한다).
    const [beforeHash, fragment] = url.split("#");
    expect(url.split("#")).toHaveLength(2);
    expect(beforeHash.split("?")).toHaveLength(2);
    expect(beforeHash.split("?")[1]).toBe("v=v4.0-tendency");
    expect(fragment).not.toContain("?");
  });

  it("기본 진입이 v4 로 바뀐 뒤(explicitVersion false)에는 쿼리를 빼서 질문만 보내기 링크와 같은 규칙을 따른다. 옛 링크(쿼리 없음)의 해시는 그대로다", () => {
    const withQuery = buildGatedShareUrl(bank, "https://hanbang.ai", first) as string;
    const withoutQuery = buildGatedShareUrl(bank, "https://hanbang.ai", first, undefined, { explicitVersion: false }) as string;
    expect(withoutQuery).toBe(`https://hanbang.ai/wedding-code#v=v4.0-tendency&a=${GOLDEN_FORM0}`);
    expect(withQuery.split("#")[1]).toBe(withoutQuery.split("#")[1]);
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", first, undefined, { explicitVersion: true })).toBe(withQuery);
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", first, undefined, {})).toBe(withQuery);
    const pair = buildGatedShareUrl(bank, "https://hanbang.ai", first, second, { explicitVersion: false }) as string;
    expect(pair).toBe(`https://hanbang.ai/wedding-code#v=v4.0-tendency&a=${GOLDEN_FORM0}&b=${GOLDEN_MIXED_FORM1}`);
    // 둘 다 같은 대표 주소로 열린다: 쿼리의 판 이름은 서버의 첫 화면과 카드 미리보기만 정한다.
    expect(buildGatedShareUrl(bank, "", first)).toBe(`/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${GOLDEN_FORM0}`);
  });

  it("링크에는 코드 문자열 외에 글자, 세기, 결과가 없다", () => {
    const url = buildGatedShareUrl(bank, "https://hanbang.ai", first, second) as string;
    const fragment = url.split("#")[1];
    expect(fragment.split("&").map((part) => part.split("=")[0])).toEqual(["v", "a", "b"]);
    // 쿼리에도 답은 없다(판 이름뿐).
    expect(url.split("#")[0]).not.toMatch(/[?&][ab]=/u);
  });

  it("어느 쪽이든 만들 수 없으면 null", () => {
    const partial: DecodedCode = { formBit: 0, responses: { ...goldenResponses(), [bank.items[0].id]: "skip", [bank.items[1].id]: "Q" } };
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", partial)).toBeNull();
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", first, partial)).toBeNull();
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", partial, second)).toBeNull();
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", { formBit: 2 as unknown as FormBit, responses: goldenResponses() })).toBeNull();
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", null as unknown as DecodedCode)).toBeNull();
  });

  it("질문만 보내기: 기본은 ?v=v4.0-tendency, explicitVersion false 이면 쿼리 없음", () => {
    expect(buildQuestionOnlyUrl("https://hanbang.ai")).toBe("https://hanbang.ai/wedding-code?v=v4.0-tendency");
    expect(buildQuestionOnlyUrl("https://hanbang.ai/", { explicitVersion: true })).toBe("https://hanbang.ai/wedding-code?v=v4.0-tendency");
    expect(buildQuestionOnlyUrl("https://hanbang.ai", {})).toBe("https://hanbang.ai/wedding-code?v=v4.0-tendency");
    expect(buildQuestionOnlyUrl("https://hanbang.ai//", { explicitVersion: false })).toBe("https://hanbang.ai/wedding-code");
    expect(buildQuestionOnlyUrl("https://hanbang.ai")).not.toContain("#");
  });

  it("아주 긴 슬래시 열에서도 빠르게 끝난다", () => {
    const started = Date.now();
    expect(buildQuestionOnlyUrl(`https://a.test${"/".repeat(200_000)}`, { explicitVersion: false })).toBe("https://a.test/wedding-code");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("origin 이 쓸 수 없는 값이면 답이 든 링크를 만들지 않는다(null): 문자열이 아님, 다른 스킴, 프로토콜 상대, 조각, 질문, 공백, 사용자 정보", () => {
    const bads: unknown[] = [
      undefined,
      null,
      42,
      {},
      "javascript:alert(1)",
      "data:text/html,x",
      "//evil.example",
      "hanbang.ai",
      "ftp://hanbang.ai",
      "https://a.example#frag",
      "https://a.example?x=1",
      "https://a.example/path",
      "https://a.example/path/",
      "https://a b.example",
      "https://a.example\n",
      "https://user@a.example",
      "https://a.example\\evil.example",
      "https://",
      `https://${"a".repeat(300)}.example`,
    ];
    for (const origin of bads) {
      expect(buildGatedShareUrl(bank, origin as string, first), String(origin)).toBeNull();
      expect(buildGatedShareUrl(bank, origin as string, first, second), String(origin)).toBeNull();
    }
  });

  it("쓸 수 있는 origin: http, https, 포트, IPv6, 빈 문자열(같은 사이트 상대 주소)은 그대로 링크가 된다", () => {
    for (const origin of ["https://hanbang.ai", "http://localhost:3000", "https://www.hanbang.ai/", "http://[::1]:3000", "HTTPS://HANBANG.AI"]) {
      const url = buildGatedShareUrl(bank, origin, first);
      expect(url, origin).toBe(`${origin.replace(/\/+$/u, "")}/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${GOLDEN_FORM0}`);
    }
    expect(buildGatedShareUrl(bank, "", first)).toBe(`/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${GOLDEN_FORM0}`);
    expect(buildGatedShareUrl(bank, "///", first)).toBe(`/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${GOLDEN_FORM0}`);
  });

  it("질문만 보내기는 쓸 수 없는 origin 이면 던지지 않고 같은 사이트 상대 주소로 낸다(엉뚱한 호스트로 가지 않는다)", () => {
    for (const origin of [undefined, null, 42, "javascript:alert(1)", "//evil.example", "https://a.example#frag", "https://a b.example"]) {
      expect(buildQuestionOnlyUrl(origin as unknown as string), String(origin)).toBe("/wedding-code?v=v4.0-tendency");
      expect(buildQuestionOnlyUrl(origin as unknown as string, { explicitVersion: false }), String(origin)).toBe("/wedding-code");
    }
  });
});

describe("buildGatedShareUrl: 관문이 닫힌 응답은 링크를 만들지 않는다(설계 5절 관문, 8절)", () => {
  const fixtureCode = (name: string): DecodedCode => {
    const found = V40_FIXTURES.find((entry) => entry.name === name);
    if (!found) throw new Error(`없는 표본: ${name}`);
    return { formBit: found.formBit, responses: found.responses };
  };
  const open = fixtureCode("swua-example");
  const partner = fixtureCode("couple-partner");
  const rhythmClosed = fixtureCode("rhythm-gate");
  /** 문항 하나만 답하고 나머지는 건너뛴 응답: 코드는 만들 수 있지만 확정 글자가 없어 관문이 닫힌다(noInformation). */
  const informationClosed: DecodedCode = {
    formBit: 0,
    responses: Object.fromEntries(bank.items.map((item, index) => [item.id, index === 0 ? stateChar(0) : "skip"])),
  };

  it("전제: 세 응답 모두 70자 코드는 만들 수 있고, 관문은 열림, 위치 반복으로 닫힘, 정보 없음으로 닫힘이다", () => {
    for (const person of [open, rhythmClosed, informationClosed]) expect(encodeCode(bank, person.formBit, person.responses)).not.toBeNull();
    expect(buildResult(bank, open.formBit, open.responses).gate).toEqual({ closed: false, reason: null });
    expect(buildResult(bank, rhythmClosed.formBit, rhythmClosed.responses).gate).toEqual({ closed: true, reason: "rhythm" });
    expect(buildResult(bank, informationClosed.formBit, informationClosed.responses).gate).toEqual({ closed: true, reason: "noInformation" });
  });

  it("링크를 만드는 길은 buildGatedShareUrl 하나다: 조립만 하는 buildShareUrl 은 공개하지 않는다(codecModule 에도 없다)", () => {
    expect(Object.keys(codecModule)).toContain("buildGatedShareUrl");
    expect(Object.keys(codecModule)).not.toContain("buildShareUrl");
    expect("buildShareUrl" in codecExports).toBe(false);
    // 닫힌 응답의 코드는 만들 수 있어도(encodeCode) 링크는 나가지 않는다.
    expect(encodeCode(bank, rhythmClosed.formBit, rhythmClosed.responses)).not.toBeNull();
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", rhythmClosed)).toBeNull();
  });

  it("열린 응답은 코드 두 개를 그대로 이은 링크다(혼자 보내기와 두 사람 링크)", () => {
    const a = encodeCode(bank, open.formBit, open.responses);
    const b = encodeCode(bank, partner.formBit, partner.responses);
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", open)).toBe(`https://hanbang.ai/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${a}`);
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", open, partner)).toBe(`https://hanbang.ai/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=${a}&b=${b}`);
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", open)).toContain("#v=v4.0-tendency&a=");
  });

  it("first 든 second 든 관문이 닫혀 있으면 null 이다", () => {
    for (const closed of [rhythmClosed, informationClosed]) {
      expect(buildGatedShareUrl(bank, "https://hanbang.ai", closed)).toBeNull();
      expect(buildGatedShareUrl(bank, "https://hanbang.ai", closed, open)).toBeNull();
      expect(buildGatedShareUrl(bank, "https://hanbang.ai", open, closed)).toBeNull();
    }
  });

  it("모양이 틀린 입력과 쓸 수 없는 origin 은 던지지 않고 null 이다", () => {
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", null as unknown as DecodedCode)).toBeNull();
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", { formBit: 2 as unknown as FormBit, responses: open.responses })).toBeNull();
    expect(buildGatedShareUrl(bank, "https://hanbang.ai", open, { formBit: 0, responses: null as unknown as Responses })).toBeNull();
    expect(buildGatedShareUrl(bank, "javascript:alert(1)", open)).toBeNull();
  });
});

describe("decodeShareParams", () => {
  it("둘 다 없으면 none, a 만 있으면 partner, 둘 다 있으면 both(first = a, second = b)", () => {
    expect(decodeShareParams(bank, null, null)).toEqual({ kind: "none" });
    expect(decodeShareParams(bank, GOLDEN_FORM0, null)).toEqual({ kind: "partner", first: decodeCode(bank, GOLDEN_FORM0) });
    expect(decodeShareParams(bank, GOLDEN_FORM0, GOLDEN_MIXED_FORM1)).toEqual({
      kind: "both",
      first: decodeCode(bank, GOLDEN_FORM0),
      second: decodeCode(bank, GOLDEN_MIXED_FORM1),
    });
  });

  it("a 없이 b 만 있거나 하나라도 깨졌으면 invalid(한 사람의 답만 살리지 않는다)", () => {
    const damaged = `${GOLDEN_FORM0.slice(0, 20)}${GOLDEN_FORM0[20] === "0" ? "1" : "0"}${GOLDEN_FORM0.slice(21)}`;
    expect(decodeShareParams(bank, null, GOLDEN_FORM0)).toEqual({ kind: "invalid" });
    expect(decodeShareParams(bank, damaged, null)).toEqual({ kind: "invalid" });
    expect(decodeShareParams(bank, damaged, GOLDEN_FORM0)).toEqual({ kind: "invalid" });
    expect(decodeShareParams(bank, GOLDEN_FORM0, damaged)).toEqual({ kind: "invalid" });
    expect(decodeShareParams(bank, "", null)).toEqual({ kind: "invalid" });
    expect(decodeShareParams(bank, GOLDEN_FORM0, "")).toEqual({ kind: "invalid" });
  });

  it("undefined 는 없는 값으로 본다", () => {
    expect(decodeShareParams(bank, undefined as unknown as null, undefined as unknown as null)).toEqual({ kind: "none" });
    expect(decodeShareParams(bank, GOLDEN_FORM0, undefined as unknown as null).kind).toBe("partner");
  });
});

describe("parseShareHash", () => {
  const version = "v4.0-tendency";
  const a = GOLDEN_FORM0;
  const b = GOLDEN_MIXED_FORM1;

  it("정상 해시: # 유무, 키 순서와 관계없이 읽는다", () => {
    const partner = { kind: "partner", first: decodeCode(bank, a) };
    const both = { kind: "both", first: decodeCode(bank, a), second: decodeCode(bank, b) };
    expect(parseShareHash(bank, `#v=${version}&a=${a}`)).toEqual(partner);
    expect(parseShareHash(bank, `v=${version}&a=${a}`)).toEqual(partner);
    expect(parseShareHash(bank, `#a=${a}&v=${version}`)).toEqual(partner);
    expect(parseShareHash(bank, `#v=${version}&a=${a}&b=${b}`)).toEqual(both);
    expect(parseShareHash(bank, `#b=${b}&a=${a}&v=${version}`)).toEqual(both);
    expect(parseShareHash(bank, `#a=${a}&b=${b}&v=${version}`)).toEqual(both);
  });

  it("없거나 비어 있으면 none, 판 태그만 있어도 none", () => {
    for (const empty of [null, undefined, "", "#"]) expect(parseShareHash(bank, empty)).toEqual({ kind: "none" });
    expect(parseShareHash(bank, `#v=${version}`)).toEqual({ kind: "none" });
  });

  it("어긋나는 해시는 모두 invalid 이고 던지지 않는다", () => {
    const damaged = `${a.slice(0, 30)}${a[30] === "0" ? "1" : "0"}${a.slice(31)}`;
    const cases: string[] = [
      `#a=${a}`, // 판 태그 없음
      `#v=v4.0&a=${a}`, // 다른 판
      `#v=${version.toUpperCase()}&a=${a}`,
      `#V=${version}&a=${a}`,
      `#v=${version}&a=${a}&a=${a}`, // 중복 키
      `#v=${version}&v=${version}&a=${a}`,
      `#v=${version}&a=${a}&c=${b}`, // 모르는 키
      `#v=${version}&a=${a}&__proto__=${b}`,
      `#v=${version}&a=${a}&constructor=${b}`,
      `#v=${version}&a=${a}&toString=${b}`,
      `#v=${version}&b=${b}`, // a 없이 b
      `#v=${version}&a=${damaged}`,
      `#v=${version}&a=${a}&b=${damaged}`,
      `#v=${version}&a=${a}&&b=${b}`, // 빈 부분
      `#v=${version}&a=${a}&b=${b}&`,
      `#&v=${version}&a=${a}`,
      `#v=${version}&a=`,
      `#v=${version}&a=${a}&b=`,
      `#v=${version}&a`,
      `#v=${version}&=${a}`,
      `#v=${version}&a=${a}=x`,
      `#v=${version}&a=${b.replace("-", "%2D")}`, // 퍼센트 인코딩은 풀지 않는다(b 는 건너뜀 문자를 가진 코드)
      `#v=${version}&a=${a} `,
      `#v=${version}&a=${a}#extra`,
      `#${"x".repeat(5000)}`,
      `#v=${version}&a=${a}${"x".repeat(MAX_SHARE_HASH_LENGTH)}`,
      "#garbage",
      "#=",
      "#&",
      "##v=v4.0-tendency",
    ];
    for (const hash of cases) {
      expect(parseShareHash(bank, hash).kind, hash.slice(0, 60)).toBe("invalid");
    }
    expect(parseShareHash(bank, 12345 as unknown as string).kind).toBe("invalid");
    expect(parseShareHash(bank, {} as unknown as string).kind).toBe("invalid");
  });

  it("문자열이 아닌 입력은 문자열로 바꿔 읽지 않고 invalid 로 답한다(toString 이 던지는 객체, 심볼, 배열)", () => {
    const hostile = {
      toString(): string {
        throw new Error("toString 이 던진다");
      },
    };
    expect(() => parseShareHash(bank, hostile as unknown as string)).not.toThrow();
    expect(parseShareHash(bank, hostile as unknown as string)).toEqual({ kind: "invalid" });
    expect(parseShareHash(bank, Symbol("hash") as unknown as string)).toEqual({ kind: "invalid" });
    // 배열은 String() 으로 바꾸면 정상 해시처럼 읽히는 값이지만 문자열이 아니므로 받지 않는다.
    expect(parseShareHash(bank, [`v=${version}&a=${a}`] as unknown as string)).toEqual({ kind: "invalid" });
    expect(parseShareHash(bank, Object.create(null) as unknown as string)).toEqual({ kind: "invalid" });
  });

  it("가장 긴 정상 해시(v, a, b 모두)는 길이 상한 안에 들어온다", () => {
    const longest = `#v=${version}&a=${a}&b=${b}`;
    expect(longest.length).toBeLessThan(MAX_SHARE_HASH_LENGTH);
    expect(parseShareHash(bank, longest).kind).toBe("both");
  });

  it("buildGatedShareUrl 이 만든 주소의 # 뒤를 다시 읽으면 처음 답이 나온다", () => {
    const first: DecodedCode = { formBit: 1, responses: goldenResponses() };
    const second: DecodedCode = { formBit: 0, responses: mixedResponses() };
    const url = buildGatedShareUrl(bank, "https://hanbang.ai", first, second) as string;
    const parsed = parseShareHash(bank, url.slice(url.indexOf("#")));
    expect(parsed).toEqual({ kind: "both", first, second });
  });
});

describe("canShare", () => {
  it("코드가 있으면 true, 관문이 닫혀 코드가 null 이면 false", () => {
    const open = buildResult(bank, 0, goldenResponses());
    expect(open.code).not.toBeNull();
    expect(canShare(open)).toBe(true);
    const allSkip: Record<string, ResponseValue> = {};
    for (const item of bank.items) allSkip[item.id] = "skip";
    const closed = buildResult(bank, 0, allSkip);
    expect(closed.code).toBeNull();
    expect(closed.gate.closed).toBe(true);
    expect(canShare(closed)).toBe(false);
    expect(canShare({ code: null } as unknown as V40Result)).toBe(false);
    expect(canShare({ code: "V···" } as unknown as V40Result)).toBe(true);
  });
});

describe("은행 인자는 가벼운 보기(CodecBankView)면 된다: 입구가 문항 문구 없이 배치 골격만으로 링크를 푼다", () => {
  /** entry.ts 가 넘기는 모양. 문항 문구가 든 은행(bank.ts, 생성된 문항 파일)을 가져오지 않고 배치 골격만 쓴다. */
  const layoutView: CodecBankView = { items: V40_LAYOUT };
  const openPeople: DecodedCode[] = ["swua-example", "couple-partner", "all-clear"].map((name) => {
    const found = V40_FIXTURES.find((entry) => entry.name === name);
    if (!found) throw new Error(`없는 표본: ${name}`);
    return { formBit: found.formBit, responses: found.responses };
  });

  it("코드 만들기, 코드 풀기, 링크 풀기, 해시 읽기가 온전한 은행과 배치 골격에서 같은 답을 낸다", () => {
    for (const person of openPeople) {
      const full = encodeCode(bank, person.formBit, person.responses);
      expect(full).not.toBeNull();
      expect(encodeCode(layoutView, person.formBit, person.responses)).toBe(full);
      expect(decodeCode(layoutView, full)).toEqual(decodeCode(bank, full));
      expect(decodeCode(layoutView, full)).toEqual(person);
    }
    const a = encodeCode(bank, openPeople[0].formBit, openPeople[0].responses) as string;
    const b = encodeCode(bank, openPeople[1].formBit, openPeople[1].responses) as string;
    expect(decodeShareParams(layoutView, a, b)).toEqual(decodeShareParams(bank, a, b));
    expect(decodeShareParams(layoutView, a, b).kind).toBe("both");
    const hash = `#v=${WEDDING_CODE_V40_VERSION}&a=${a}&b=${b}`;
    expect(parseShareHash(layoutView, hash)).toEqual(parseShareHash(bank, hash));
    expect(parseShareHash(layoutView, hash).kind).toBe("both");
  });

  it("배치 골격의 형식이 은행과 같아서 위치별 범위 검사도 같다(깨진 코드는 둘 다 거절한다)", () => {
    const code = encodeCode(bank, openPeople[0].formBit, openPeople[0].responses) as string;
    const damaged = `${code.slice(0, 30)}${code[30] === "0" ? "1" : "0"}${code.slice(31)}`;
    expect(decodeCode(layoutView, damaged)).toBeNull();
    expect(decodeCode(bank, damaged)).toBeNull();
    expect(decodeCode(layoutView, code.slice(0, 69))).toBeNull();
  });

  it("보기의 문항이 68개가 아니면 풀지 않는다(문항 수가 어긋난 보기로 링크를 풀지 않는다)", () => {
    const code = encodeCode(bank, openPeople[0].formBit, openPeople[0].responses) as string;
    expect(decodeCode({ items: V40_LAYOUT.slice(0, 67) }, code)).toBeNull();
    expect(decodeCode({ items: [] }, code)).toBeNull();
  });
});

describe("계약 묶음", () => {
  it("codecModule 은 계약의 함수 여덟 개를 가진다(링크를 만드는 길은 buildGatedShareUrl 하나)", () => {
    expect(Object.keys(codecModule).sort()).toEqual(
      ["buildGatedShareUrl", "buildQuestionOnlyUrl", "canShare", "checksumChar", "decodeCode", "decodeShareParams", "encodeCode", "parseShareHash"].sort(),
    );
  });
});
