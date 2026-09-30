import { describe, expect, it } from "vitest";
import { V40_FORMATS, V40_STATE_ALPHABET, V40_STATE_COUNTS } from "@/constants/weddingCodeV40";
import type { Format, ResponseValue, Responses } from "./types";
import {
  bestWorstPairOf,
  bestWorstStateOf,
  fromCodeChar,
  isResponseValueFor,
  isStateFor,
  responseAt,
  splitCountsOf,
  splitStateOf,
  stateChar,
  stateIndex,
  statesModule,
  toCodeChar,
} from "./states";

describe("알파벳과 색인", () => {
  it("알파벳은 0-9a-zA-Z 62자이고 중복이 없다", () => {
    expect(V40_STATE_ALPHABET).toHaveLength(62);
    expect(new Set(V40_STATE_ALPHABET).size).toBe(62);
    expect(V40_STATE_ALPHABET).toBe("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });

  it("stateChar 와 stateIndex 는 62자 전부에서 서로의 역이다", () => {
    for (let index = 0; index < 62; index += 1) {
      const char = stateChar(index);
      expect(char).toBe(V40_STATE_ALPHABET[index]);
      expect(stateIndex(char)).toBe(index);
    }
    expect(stateChar(0)).toBe("0");
    expect(stateChar(9)).toBe("9");
    expect(stateChar(10)).toBe("a");
    expect(stateChar(35)).toBe("z");
    expect(stateChar(36)).toBe("A");
    expect(stateChar(61)).toBe("Z");
  });

  it("stateChar 는 범위 밖이나 정수가 아니면 RangeError 를 던진다", () => {
    for (const bad of [-1, 62, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => stateChar(bad), String(bad)).toThrow(RangeError);
    }
    expect(() => stateChar("1" as unknown as number)).toThrow(RangeError);
    expect(() => stateChar(null as unknown as number)).toThrow(RangeError);
  });

  it("stateIndex 는 알파벳 밖 문자와 길이가 1이 아닌 값을 던지지 않고 null 로 답한다", () => {
    for (const probe of ["-", "_", ".", " ", "", "ab", "00", "가", "Ａ", "\n", "!"]) {
      expect(stateIndex(probe), JSON.stringify(probe)).toBeNull();
    }
    for (const probe of [undefined, null, 3, {}, [], ["a"]]) {
      expect(stateIndex(probe as unknown as string)).toBeNull();
    }
  });
});

describe("형식별 상태 범위", () => {
  const expectedCounts: Record<Format, number> = { pair: 6, react: 5, recall: 4, instant: 4, bestworst: 12, split: 28, self: 6 };

  it("상수의 상태 수가 README 표와 같다", () => {
    expect(V40_STATE_COUNTS).toEqual(expectedCounts);
  });

  it("isStateFor 는 형식마다 앞에서 상태 수만큼의 알파벳만 참이다", () => {
    for (const format of V40_FORMATS) {
      for (let index = 0; index < 62; index += 1) {
        expect(isStateFor(format, stateChar(index)), `${format} ${index}`).toBe(index < expectedCounts[format]);
      }
      for (const special of ["-", "_", ".", "", "가"]) expect(isStateFor(format, special)).toBe(false);
    }
  });

  it("isStateFor 는 모르는 형식과 프로토타입 이름에도 던지지 않고 false 다", () => {
    for (const format of ["nope", "toString", "constructor", "__proto__", "hasOwnProperty", ""]) {
      expect(isStateFor(format as Format, "0")).toBe(false);
    }
  });

  it("isResponseValueFor 는 skip, na 를 모든 형식에서 받고 상태 문자는 범위 안일 때만 받는다", () => {
    for (const format of V40_FORMATS) {
      expect(isResponseValueFor(format, "skip")).toBe(true);
      expect(isResponseValueFor(format, "na")).toBe(true);
      expect(isResponseValueFor(format, stateChar(expectedCounts[format] - 1))).toBe(true);
      expect(isResponseValueFor(format, stateChar(expectedCounts[format]))).toBe(false);
      expect(isResponseValueFor(format, "-")).toBe(false);
      expect(isResponseValueFor(format, "_")).toBe(false);
      expect(isResponseValueFor(format, "SKIP")).toBe(false);
    }
  });
});

describe("칸 나누기 색인", () => {
  it("28개 상태가 0에서 27을 한 번씩 채우고 왕복한다", () => {
    const seen = new Set<number>();
    let expectedNext = 0;
    for (let a = 0; a <= 6; a += 1) {
      for (let b = 0; a + b <= 6; b += 1) {
        const state = splitStateOf(a, b);
        expect(state).toBe(expectedNext);
        expectedNext += 1;
        seen.add(state);
        expect(splitCountsOf(state)).toEqual([a, b, 6 - a - b]);
      }
    }
    expect(seen.size).toBe(28);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(27);
  });

  it("알려진 값: (0,0)=0, (0,6)=6, (1,0)=7, (6,0)=27, (2,2)=15", () => {
    expect(splitStateOf(0, 0)).toBe(0);
    expect(splitStateOf(0, 6)).toBe(6);
    expect(splitStateOf(1, 0)).toBe(7);
    expect(splitStateOf(6, 0)).toBe(27);
    expect(splitStateOf(2, 2)).toBe(15);
    expect(splitCountsOf(15)).toEqual([2, 2, 2]);
  });

  it("범위 밖과 정수가 아닌 값은 RangeError", () => {
    for (const [a, b] of [[-1, 0], [0, -1], [7, 0], [0, 7], [4, 3], [1.5, 1], [1, 0.5], [Number.NaN, 0], [0, Number.NaN]]) {
      expect(() => splitStateOf(a, b), `${a},${b}`).toThrow(RangeError);
    }
    for (const bad of [-1, 28, 100, 1.5, Number.NaN]) expect(() => splitCountsOf(bad), String(bad)).toThrow(RangeError);
  });
});

describe("가장·가장 아닌 것 색인", () => {
  it("12개 상태가 0에서 11을 한 번씩 채우고 왕복한다", () => {
    let expectedNext = 0;
    for (let best = 0; best < 4; best += 1) {
      for (let worst = 0; worst < 4; worst += 1) {
        if (best === worst) continue;
        const state = bestWorstStateOf(best, worst);
        expect(state).toBe(expectedNext);
        expectedNext += 1;
        expect(bestWorstPairOf(state)).toEqual({ best, worst });
      }
    }
    expect(expectedNext).toBe(12);
  });

  it("같은 카드이거나 범위 밖이면 RangeError", () => {
    for (const [best, worst] of [[0, 0], [3, 3], [-1, 0], [0, 4], [1.5, 2], [Number.NaN, 1]]) {
      expect(() => bestWorstStateOf(best, worst), `${best},${worst}`).toThrow(RangeError);
    }
    for (const bad of [-1, 12, 1.5, Number.NaN]) expect(() => bestWorstPairOf(bad), String(bad)).toThrow(RangeError);
  });
});

describe("링크 코드 문자", () => {
  it("skip 은 -, na 는 _, 상태 문자는 그대로", () => {
    expect(toCodeChar("skip")).toBe("-");
    expect(toCodeChar("na")).toBe("_");
    for (const char of V40_STATE_ALPHABET) expect(toCodeChar(char)).toBe(char);
  });

  it("fromCodeChar 는 toCodeChar 의 역이고 그 밖은 null 이다", () => {
    expect(fromCodeChar("-")).toBe("skip");
    expect(fromCodeChar("_")).toBe("na");
    for (const char of V40_STATE_ALPHABET) expect(fromCodeChar(char)).toBe(char);
    for (const bad of [".", " ", "", "가", "ab", "--", "+", "!"]) expect(fromCodeChar(bad), JSON.stringify(bad)).toBeNull();
    for (const value of ["skip", "na", "0", "Z"] as ResponseValue[]) expect(fromCodeChar(toCodeChar(value))).toBe(value);
  });
});

describe("responseAt", () => {
  it("자기 소유 문자열 값만 읽고 상속 키나 문자열이 아닌 값은 없는 것으로 본다", () => {
    const responses = { "money.limit.1": "3", "money.limit.2": "skip" } as Responses;
    expect(responseAt(responses, "money.limit.1")).toBe("3");
    expect(responseAt(responses, "money.limit.2")).toBe("skip");
    expect(responseAt(responses, "money.limit.3")).toBeUndefined();
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) expect(responseAt(responses, key)).toBeUndefined();
    expect(responseAt({ a: 3 } as unknown as Responses, "a")).toBeUndefined();
    expect(responseAt({ a: null } as unknown as Responses, "a")).toBeUndefined();
    expect(responseAt(null, "a")).toBeUndefined();
    expect(responseAt(undefined, "a")).toBeUndefined();
    expect(responseAt("text" as unknown as Responses, "length")).toBeUndefined();
  });

  it("Object.create(null) 응답도 읽는다", () => {
    const bare = Object.assign(Object.create(null) as Record<string, string>, { x: "1" }) as Responses;
    expect(responseAt(bare, "x")).toBe("1");
  });
});

describe("계약 묶음", () => {
  it("statesModule 은 계약의 함수 열한 개를 모두 가진다", () => {
    expect(Object.keys(statesModule).sort()).toEqual(
      [
        "bestWorstPairOf",
        "bestWorstStateOf",
        "fromCodeChar",
        "isResponseValueFor",
        "isStateFor",
        "responseAt",
        "splitCountsOf",
        "splitStateOf",
        "stateChar",
        "stateIndex",
        "toCodeChar",
      ].sort(),
    );
  });
});
