/**
 * 웨딩코드 4.0 저장 상태 문자 도우미(StatesModule).
 *
 * 저장 상태 표(types.ts 4절, README 3절, 설계 5절)의 색인 계산을 한 곳에 모은다. 다른 모듈은 상태 문자를 직접 계산하지 않고
 * 이 파일의 함수만 부른다. 부동소수를 쓰지 않고(칸 나누기 색인의 나눗셈은 항상 짝수를 2로 나눈다) 입력이 잘못돼도
 * 던지지 않는 함수(stateIndex, isStateFor, isResponseValueFor, fromCodeChar)와 범위를 어기면 RangeError 를 던지는 함수
 * (stateChar, splitStateOf, splitCountsOf, bestWorstStateOf, bestWorstPairOf)를 구분한다.
 */
import { V40_NA_CHAR, V40_SKIP_CHAR, V40_STATE_ALPHABET, V40_STATE_COUNTS } from "@/constants/weddingCodeV40";
import type { Format, ItemId, ResponseValue, Responses, StateChar } from "./types";
import type { StatesModule } from "./contract";

/** 알파벳 문자 -> 색인 표. 문자 하나짜리 키만 들어 있어 프로토타입 키와 겹치지 않는다. */
const ALPHABET_INDEX: ReadonlyMap<string, number> = new Map([...V40_STATE_ALPHABET].map((char, index) => [char, index]));

const hasOwn = (target: object, key: string): boolean => Object.prototype.hasOwnProperty.call(target, key);

/** 알파벳[index]. 0 이상 62 미만의 정수가 아니면 RangeError(설계 5절 저장 상태 표). */
export function stateChar(index: number): StateChar {
  if (!Number.isInteger(index) || index < 0 || index >= V40_STATE_ALPHABET.length) {
    throw new RangeError(`상태 색인 범위 밖: ${String(index)}`);
  }
  return V40_STATE_ALPHABET[index];
}

/** 알파벳 색인(README 3절). 알파벳 밖의 문자(-, _, ., 한글 포함)나 길이가 1이 아닌 값은 null(던지지 않는다). */
export function stateIndex(char: string): number | null {
  if (typeof char !== "string" || char.length !== 1) return null;
  return ALPHABET_INDEX.get(char) ?? null;
}

/** 이 형식에서 쓸 수 있는 상태 문자인가: 알파벳 색인이 0 이상 V40_STATE_COUNTS[format] 미만(README 3절). */
export function isStateFor(format: Format, char: string): boolean {
  if (typeof format !== "string" || !hasOwn(V40_STATE_COUNTS, format)) return false;
  const index = stateIndex(char);
  return index !== null && index < V40_STATE_COUNTS[format];
}

/** skip, na, 또는 그 형식의 상태 문자이면 true(형식 기준 저장값 검증, README 3절). */
export function isResponseValueFor(format: Format, value: string): value is ResponseValue {
  return value === "skip" || value === "na" || isStateFor(format, value);
}

/** 칸 나누기 상태 색인(README 3절) s = a x (15 - a) / 2 + b. a, b 가 0 이상 정수이고 a + b <= 6 이 아니면 RangeError. 결과 0에서 27. */
export function splitStateOf(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a + b > 6) {
    throw new RangeError(`칸 수 범위 밖: ${String(a)}, ${String(b)}`);
  }
  return (a * (15 - a)) / 2 + b;
}

/** splitStateOf 의 역(README 3절): 색인 s 에서 [a, b, 6 - a - b]. 0에서 27 밖이면 RangeError. */
export function splitCountsOf(state: number): readonly [number, number, number] {
  if (!Number.isInteger(state) || state < 0 || state > 27) {
    throw new RangeError(`칸 나누기 상태 범위 밖: ${String(state)}`);
  }
  for (let a = 6; a >= 0; a -= 1) {
    const start = (a * (15 - a)) / 2;
    if (state >= start) {
      const b = state - start;
      return [a, b, 6 - a - b];
    }
  }
  throw new RangeError(`도달할 수 없는 칸 나누기 상태: ${String(state)}`);
}

/** 가장·가장 아닌 것 상태 색인(README 3절) s = 3 x best + (worst < best ? worst : worst - 1). best, worst 는 0에서 3의 서로 다른 정수. 결과 0에서 11. */
export function bestWorstStateOf(best: number, worst: number): number {
  const inRange = (x: number) => Number.isInteger(x) && x >= 0 && x <= 3;
  if (!inRange(best) || !inRange(worst) || best === worst) {
    throw new RangeError(`가장·아닌 것 범위 밖: ${String(best)}, ${String(worst)}`);
  }
  return 3 * best + (worst < best ? worst : worst - 1);
}

/** bestWorstStateOf 의 역(README 3절). 0에서 11 밖이면 RangeError. */
export function bestWorstPairOf(state: number): { readonly best: number; readonly worst: number } {
  if (!Number.isInteger(state) || state < 0 || state > 11) {
    throw new RangeError(`가장·아닌 것 상태 범위 밖: ${String(state)}`);
  }
  const best = Math.floor(state / 3);
  const remainder = state % 3;
  return { best, worst: remainder < best ? remainder : remainder + 1 };
}

/** 메모리 저장값 -> 링크 코드 문자: skip 은 -, na 는 _, 상태 문자는 그대로(README 4절). */
export function toCodeChar(value: ResponseValue): string {
  if (value === "skip") return V40_SKIP_CHAR;
  if (value === "na") return V40_NA_CHAR;
  return value;
}

/** 링크 코드 문자 -> 메모리 저장값(README 4절): - 는 skip, _ 는 na, 알파벳 문자는 그대로. 그 밖은 null(형식별 범위 검사는 isResponseValueFor). */
export function fromCodeChar(char: string): ResponseValue | null {
  if (char === V40_SKIP_CHAR) return "skip";
  if (char === V40_NA_CHAR) return "na";
  return stateIndex(char) !== null ? char : null;
}

/**
 * 응답 맵에서 문항 하나의 저장값을 읽는다(계약 StatesModule.responseAt). 자기 소유 키만 읽어 상속 키와 겹치지 않고,
 * 문자열이 아닌 값은 없는 것으로 본다. score, gates, codec 이 같은 방식으로 응답을 읽도록 한 곳에 둔다.
 */
export function responseAt(responses: Responses | null | undefined, id: ItemId): ResponseValue | undefined {
  if (responses === null || responses === undefined || typeof responses !== "object") return undefined;
  if (!hasOwn(responses, id)) return undefined;
  const value = (responses as Readonly<Record<string, unknown>>)[id];
  return typeof value === "string" ? value : undefined;
}

/** 이 파일의 함수를 계약(StatesModule)대로 묶은 객체. 서명이 계약과 어긋나면 여기서 타입 오류가 난다. */
export const statesModule = {
  stateChar,
  stateIndex,
  isStateFor,
  isResponseValueFor,
  splitStateOf,
  splitCountsOf,
  bestWorstStateOf,
  bestWorstPairOf,
  toCodeChar,
  fromCodeChar,
  responseAt,
} satisfies StatesModule;
