/**
 * 웨딩코드 4.0 링크 코드(CodecModule, README 4절, 설계 8절).
 *
 * 70자: [0] 폼 비트 문자, [1..64] 채점 문항 64개(질문 순서), [65..68] 자기 선택 4개, [69] 체크섬 문자.
 * 문항 문자는 그 형식의 상태 문자, - (건너뜀), _ (해당 없음) 중 하나이고 폼 비트로 뒤집지 않은 저장값 그대로다.
 * 체크섬 T = 합 ((i mod 60) + 1) x v(body[i]) (v: 알파벳 색인, - 는 59, _ 는 60), 체크섬 문자 = 알파벳[T mod 61].
 * 체크섬은 오타를 잡는 장치이지 위조를 막는 장치가 아니다(계산법이 공개돼 누구나 맞는 코드를 만들 수 있다). 한 글자 바꾸기와 이웃한 두 글자 맞바꾸기는
 * 모두 잡지만, 61 을 법으로 한 가중치가 60가지뿐이라 69자를 다 다르게 덮을 수 없어서 60칸 떨어진 두 자리(0에서 8번과 60에서 68번)의 맞바꾸기는
 * 잡지 못한다(알려진 한계, 적대적 검토 2026-09-30). 본문 길이를 바꾸는 검사 문자 추가는 판을 올려야 하는 변경이라 계약 변경 요청으로 남겼다.
 * 디코드는 길이, 알파벳 밖 문자, 위치별 범위, 폼 비트 문자, 체크섬, 상태 문자 없음 중 하나라도 어긋나면 링크 전체를 거절하고
 * 한 사람의 답만 살리거나 기본값을 채우지 않는다. 주소나 저장소에서 온 문자열이라 어떤 입력에도 던지지 않는다.
 *
 * 은행 인자: 코드를 만들고 푸는 함수(encodeCode, decodeCode, decodeShareParams, parseShareHash)는 질문 순서의 문항 id 와 형식만 읽으므로
 * CodecBankView 를 받는다. 배치 골격 V40_LAYOUT 도 그 모양이라, 입구(entry.ts)는 문항 문구가 든 은행을 가져오지 않고 받은 링크를 풀 수 있다(형변환 없이).
 * 이 파일이 직접 가져오는 것은 상수, states, score 뿐이고(score 를 거쳐 value, present, gates 가 딸려 온다) 문구(bank, copy)와 화면은 가져오지 않는다.
 *
 * 링크를 만드는 길은 buildGatedShareUrl 하나다(공개하지 않는 조립 함수 assembleShareUrl 은 이 파일 안에서만 쓴다). 관문이 닫힌 응답에는 링크가 나가지 않는다.
 * origin 규칙: 끝의 / 를 모두 뗀 뒤 빈 문자열(같은 사이트 상대 주소)이거나 http(s)://호스트[:포트] 한 덩어리여야 한다. 그 밖(문자열이 아님, 다른 스킴, 프로토콜 상대,
 * 경로, 질문, 조각, 공백, 사용자 정보, 255자 초과)은 buildGatedShareUrl 이 null, buildQuestionOnlyUrl 이 같은 사이트 상대 주소로 답한다.
 */
import {
  V40_COUNTS,
  V40_LINK_KEYS,
  V40_NA_CHAR,
  V40_SKIP_CHAR,
  V40_STATE_ALPHABET,
  WEDDING_CODE_V40_VERSION,
} from "@/constants/weddingCodeV40";
import type { Bank, CodecBankView, DecodedCode, FormBit, ItemId, ResponseValue, Responses, ShareParse, V40Result } from "./types";
import type { CodecModule } from "./contract";
import { buildResult } from "./score";
import { fromCodeChar, isResponseValueFor, responseAt, stateIndex, toCodeChar } from "./states";

/** 해시 전체 길이 상한. 가장 긴 정상 해시(v, a, b 모두)는 앞의 # 을 빼고 161자라서 넉넉한 상한을 두어 긴 입력을 바로 거절한다. */
export const MAX_SHARE_HASH_LENGTH = 512;

/** 체크섬 값에서 건너뜀 문자 - 의 값. */
const SKIP_VALUE = 59;
/** 체크섬 값에서 해당 없음 문자 _ 의 값. */
const NA_VALUE = 60;

/** 체크섬에 쓰는 문자 값: 알파벳 색인, - 는 59, _ 는 60. 그 밖의 문자는 RangeError. */
function codeCharValue(char: string): number {
  if (char === V40_SKIP_CHAR) return SKIP_VALUE;
  if (char === V40_NA_CHAR) return NA_VALUE;
  const index = stateIndex(char);
  if (index === null) throw new RangeError(`체크섬에 쓸 수 없는 문자: ${JSON.stringify(char)}`);
  return index;
}

/** body(69자)의 체크섬 문자. body 에 알파벳, -, _ 밖의 문자가 있으면 RangeError(README 4절). */
export function checksumChar(body: string): string {
  if (typeof body !== "string") throw new RangeError("체크섬 입력이 문자열이 아니다");
  let total = 0;
  for (let index = 0; index < body.length; index += 1) {
    total += ((index % 60) + 1) * codeCharValue(body[index]);
  }
  return V40_STATE_ALPHABET[total % 61];
}

/**
 * 68개 문항이 모두 유효 저장값이고 상태 문자가 하나 이상이면 70자 코드, 아니면 null(README 4절).
 * 답하지 않은 문항, 형식에 없는 문자, 전부 건너뜀과 해당 없음이면 null. 관문 여부는 여기서 보지 않는다(canShare).
 */
export function encodeCode(bank: CodecBankView, formBit: FormBit, responses: Responses): string | null {
  if (formBit !== 0 && formBit !== 1) return null;
  let body = String(formBit);
  let stateChars = 0;
  for (const item of bank.items) {
    const value = responseAt(responses, item.id);
    if (value === undefined || !isResponseValueFor(item.fmt, value)) return null;
    if (value !== "skip" && value !== "na") stateChars += 1;
    body += toCodeChar(value);
  }
  if (stateChars === 0) return null;
  return body + checksumChar(body);
}

/**
 * 70자 코드 -> DecodedCode(README 4절). 68개 문항이 모두 채워진 responses 를 낸다.
 * 길이, 폼 비트 문자, 위치별 범위, 체크섬, 상태 문자 없음 중 하나라도 어긋나면 null. 입력이 문자열이 아니어도 던지지 않는다.
 */
export function decodeCode(bank: CodecBankView, code: string | null | undefined): DecodedCode | null {
  if (typeof code !== "string" || code.length !== V40_COUNTS.codeLength) return null;
  if (bank.items.length !== V40_COUNTS.items) return null;
  const formChar = code[0];
  if (formChar !== "0" && formChar !== "1") return null;
  const responses: Record<ItemId, ResponseValue> = {};
  let stateChars = 0;
  for (let index = 0; index < bank.items.length; index += 1) {
    const item = bank.items[index];
    const value = fromCodeChar(code[index + 1]);
    if (value === null || !isResponseValueFor(item.fmt, value)) return null;
    if (value !== "skip" && value !== "na") stateChars += 1;
    responses[item.id] = value;
  }
  let expected: string;
  try {
    expected = checksumChar(code.slice(0, V40_COUNTS.codeLength - 1));
  } catch {
    return null;
  }
  if (code[V40_COUNTS.codeLength - 1] !== expected) return null;
  if (stateChars === 0) return null;
  return { formBit: (formChar === "1" ? 1 : 0) as FormBit, responses };
}

/** origin 끝의 / 를 모두 뗀다(정규식 없이: 긴 입력에서 역추적하지 않는다). */
function trimTrailingSlashes(origin: string): string {
  let end = origin.length;
  while (end > 0 && origin[end - 1] === "/") end -= 1;
  return origin.slice(0, end);
}

/** origin 으로 받는 모양: http 또는 https, 호스트[:포트] 하나. 공백, /, ?, #, 역슬래시, @ 가 들면 거절한다. */
const ORIGIN_PATTERN = /^https?:\/\/[^\s/?#\\@]+$/i;
/** origin 길이 상한(정상 값은 수십 자). */
const MAX_ORIGIN_LENGTH = 255;

/**
 * origin 을 링크 앞머리로 쓸 수 있게 다듬는다. 끝의 / 를 떼고, 빈 문자열(같은 사이트 상대 주소)이거나 http(s)://호스트[:포트] 이면 그 값,
 * 문자열이 아니거나 다른 스킴(javascript:), 프로토콜 상대(//host), 조각이나 질문이 붙은 값이면 null(README 4절).
 */
function normalizeOrigin(origin: unknown): string | null {
  if (typeof origin !== "string") return null;
  const trimmed = trimTrailingSlashes(origin);
  if (trimmed === "") return "";
  if (trimmed.length > MAX_ORIGIN_LENGTH) return null;
  return ORIGIN_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * 보내기 링크 조립(설계 8절): `${origin}/wedding-code#v=v4.0-tendency&a=${a}` 이고 second 가 있으면 `&b=${b}`.
 * 하나라도 encode 가 null 이거나 origin 이 쓸 수 없는 값이면 null. 링크에 글자, 세기, 결과를 싣지 않는다.
 * 관문은 이 함수가 보지 않는다. 그래서 공개하지 않고(export 없음) 관문까지 확인하는 buildGatedShareUrl 만 부른다.
 */
function assembleShareUrl(bank: CodecBankView, origin: string, first: DecodedCode, second?: DecodedCode): string | null {
  const prefix = normalizeOrigin(origin);
  if (prefix === null) return null;
  if (first === null || typeof first !== "object") return null;
  const a = encodeCode(bank, first.formBit, first.responses);
  if (a === null) return null;
  const { version: versionKey, first: firstKey, second: secondKey } = V40_LINK_KEYS;
  const base = `${prefix}/wedding-code#${versionKey}=${WEDDING_CODE_V40_VERSION}&${firstKey}=${a}`;
  if (second === undefined || second === null) return base;
  const b = encodeCode(bank, second.formBit, second.responses);
  return b === null ? null : `${base}&${secondKey}=${b}`;
}

/** 이 사람의 답으로 만든 결과가 코드와 링크를 낼 수 있는가(설계 5절 관문, canShare). 폼 비트나 답이 모양을 갖추지 못하면 false. */
function canShareDecoded(bank: Bank, person: DecodedCode): boolean {
  if (person === null || typeof person !== "object") return false;
  if (person.formBit !== 0 && person.formBit !== 1) return false;
  return canShare(buildResult(bank, person.formBit, person.responses));
}

/**
 * 보내기 링크를 만드는 유일한 길(설계 5절 관문, 8절). first 나 second 로 만든 결과(buildResult)의 관문이 닫혀 있으면(위치 반복 세 형식, 확정 글자 없음) null 이다.
 * 설계는 관문이 닫힌 응답에 코드도 링크도 만들지 않는다고 하므로 화면은 링크를 만들 때 언제나 이 함수를 쓴다(두 사람 링크도 같다).
 * 채점이 필요해서 온전한 Bank 를 받는다. 그 밖의 어긋남(답이 빠짐, 폼 비트 오류, 쓸 수 없는 origin)도 던지지 않고 null 이다.
 */
export function buildGatedShareUrl(bank: Bank, origin: string, first: DecodedCode, second?: DecodedCode): string | null {
  if (!canShareDecoded(bank, first)) return null;
  if (second !== undefined && second !== null && !canShareDecoded(bank, second)) return null;
  return assembleShareUrl(bank, origin, first, second);
}

/**
 * 질문만 보내기 링크(답 없음, 설계 8절). explicitVersion(기본 true)이면 `${origin}/wedding-code?v=v4.0-tendency`
 * (기본 진입이 아직 v3.1 인 동안), false 이면 `${origin}/wedding-code`(기본 진입을 v4 로 교체한 뒤).
 * origin 이 쓸 수 없는 값이면 같은 사이트 상대 주소(`/wedding-code...`)로 낸다(던지지 않고, 엉뚱한 호스트로 가는 링크를 만들지 않는다).
 */
export function buildQuestionOnlyUrl(origin: string, options?: { readonly explicitVersion?: boolean }): string {
  const explicitVersion = options?.explicitVersion !== false;
  const base = `${normalizeOrigin(origin) ?? ""}/wedding-code`;
  return explicitVersion ? `${base}?${V40_LINK_KEYS.version}=${WEDDING_CODE_V40_VERSION}` : base;
}

/**
 * 해시의 a, b 값 -> ShareParse(README 4절, 설계 8절). a 와 b 가 모두 없으면 none, a 없이 b 만 있으면 invalid,
 * 하나라도 decodeCode 가 null 이면 invalid. a 만 있으면 partner, 둘 다 있으면 both(first = a, second = b).
 */
export function decodeShareParams(bank: CodecBankView, a: string | null, b: string | null): ShareParse {
  const first = a ?? null;
  const second = b ?? null;
  if (first === null && second === null) return { kind: "none" };
  if (first === null) return { kind: "invalid" };
  const firstCode = decodeCode(bank, first);
  if (firstCode === null) return { kind: "invalid" };
  if (second === null) return { kind: "partner", first: firstCode };
  const secondCode = decodeCode(bank, second);
  if (secondCode === null) return { kind: "invalid" };
  return { kind: "both", first: firstCode, second: secondCode };
}

/**
 * 주소의 해시 전체(# 포함 또는 제외)를 읽는다(README 4절). 키는 v, a, b 만 한 번씩 허용하고 v 는 판 태그여야 한다.
 * 없거나 비어 있으면 none, 그 밖의 모든 어긋남(모르는 키, 중복 키, 빈 부분, 긴 입력, 판 태그 없음)은 invalid.
 * 길이 상한(MAX_SHARE_HASH_LENGTH)을 넘는 입력은 쪼개 보지 않고 바로 invalid 로 답한다. 던지지 않는다.
 */
export function parseShareHash(bank: CodecBankView, hash: string | null | undefined): ShareParse {
  if (hash === null || hash === undefined) return { kind: "none" };
  // 문자열이 아닌 값은 String() 으로 바꾸지 않는다(toString 이 던지는 객체도 있다). 문자열만 읽고 나머지는 invalid.
  if (typeof hash !== "string") return { kind: "invalid" };
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (body === "") return { kind: "none" };
  if (body.length > MAX_SHARE_HASH_LENGTH) return { kind: "invalid" };
  const seen = new Map<string, string>();
  for (const part of body.split("&")) {
    const equals = part.indexOf("=");
    if (equals <= 0) return { kind: "invalid" };
    const key = part.slice(0, equals);
    const value = part.slice(equals + 1);
    if ((key !== "v" && key !== "a" && key !== "b") || seen.has(key)) return { kind: "invalid" };
    seen.set(key, value);
  }
  if (seen.get("v") !== WEDDING_CODE_V40_VERSION) return { kind: "invalid" };
  return decodeShareParams(bank, seen.get("a") ?? null, seen.get("b") ?? null);
}

/** 코드 복사, 링크 보내기가 열려도 되는가: result.code !== null(설계 5절 관문, README 7절 5항). */
export function canShare(result: V40Result): boolean {
  return result.code !== null;
}

/** 이 파일의 함수를 계약(CodecModule)대로 묶은 객체. */
export const codecModule = {
  encodeCode,
  decodeCode,
  checksumChar,
  buildGatedShareUrl,
  buildQuestionOnlyUrl,
  decodeShareParams,
  parseShareHash,
  canShare,
} satisfies CodecModule;
