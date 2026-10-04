/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 링크 코덱(빌드 계획 4절, 트랙 F2).
 *
 * 기존 70자 코드(codec.ts)와 그 해시 읽기·보내기 조립은 한 줄도 바꾸지 않고, 이 파일이 그것을 **감싸서** 선택 필드 ga, gb 를 더한다.
 *
 *   #v=v4.0-tendency&a=<70자>[&ga=<8자>][&b=<70자>[&gb=<8자>]]
 *
 * ga 는 a 를 낸 사람(먼저 답한 사람)의 짐작과 고름이고 gb 는 b 를 낸 사람의 것이다. g 는 그 옆 a, b 의 주인 것이다.
 * 만드는 쪽의 정규 순서는 v, a, ga, b, gb 이고 읽는 쪽은 순서를 따지지 않는다. 같은 키는 한 번만, ga 는 a 가 있을 때만, gb 는 b 가 있을 때만 허용한다.
 *
 * g 는 8자다: [0] 세트 글자(지금은 하나) + [1..6] 장면 여섯의 글자 + [7] 검사 글자.
 * 장면 글자 = 3 x 내 고름 + 짐작, 기호 값 첫째 카드 0, 둘째 카드 1, 고르지 않음 2 (문자 0에서 8). 검사 글자 = 알파벳[(i + 1) x 값 의 합 mod 61].
 * 「잘 모르겠어요」, 「제 상황과 안 맞아요」, 「지금은 넘어갈게요」는 모두 고르지 않음이다(링크는 셋을 구별하지 않는다).
 * 디코드는 길이, 세트 글자, 장면 글자의 범위, 모두 고르지 않음, 검사 글자 중 하나라도 어긋나면 null 이고 링크 전체를 거절한다
 * (한 사람의 짐작만 살리거나 기본값을 채우지 않는다: 나쁜 g 가 있으면 멀쩡한 a 도 버린다). 입력이 무엇이어도 던지지 않는다.
 *
 * 검사 글자는 오타를 잡는 장치이지 위조를 막는 장치가 아니다(계산법이 공개돼 누구나 맞는 g 를 만들 수 있다). 글자 하나가 바뀌거나 서로 다른 두 글자가
 * 맞바뀌면 항상 잡지만 두 글자가 동시에 바뀌면 약 61분의 1 이 통과한다. 그래서 두 사람 결과 화면은 짐작과 답을 링크에서 옮겼다고 밝히고 가릴 길을 준다.
 *
 * 세트 글자: 세트 자료(여섯 장면의 문장)를 바꾸면 글자를 올리고 지원 목록(V40_GUESS_SET_IDS)에 옛 글자를 남기지 않는다. 남기면 옛 링크의 첫째 카드가
 * 새 문장을 가리키는 조용한 오독이 난다. 옛 글자가 든 링크는 전체 거절이다.
 *
 * 이 파일이 가져오는 것: 상수, states, codec, 타입뿐이다(copy, bank, 세트 자료, 화면은 가져오지 않는다). 던지는 오류의 메시지에는 입력 글자를 싣지 않는다.
 */
import { V40_LINK_KEYS, V40_STATE_ALPHABET, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import type { Bank, CodecBankView } from "../types";
import { MAX_SHARE_HASH_LENGTH, buildGatedShareUrl, decodeShareParams, type ShareUrlOptions } from "../codec";
import { stateIndex } from "../states";
import type { GuessLinkModule } from "./guessContract";
import { V40_GUESS_SLOT_COUNT } from "./types";
import type { GuessAnswers, GuessPick, GuessSetId, GuessSlot, GuessedPerson, GuessedShareParse } from "./types";

/** 링크 해시의 짐작 키. ga 는 a 옆, gb 는 b 옆이다. */
export const V40_GUESS_LINK_KEYS = { first: "ga", second: "gb" } as const;

/** 지원하는 세트 글자. 문장을 바꾸면 이 목록을 새 글자 하나로 바꾼다(옛 글자를 남기지 않는다). */
export const V40_GUESS_SET_IDS = ["1"] as const;

/** g 한 개의 길이: 세트 글자 1 + 장면 글자 6 + 검사 글자 1. */
export const GUESS_CODE_LENGTH = 8 as const;

/** 장면 글자로 쓰는 문자(값 0에서 8). */
const SLOT_DIGITS = "012345678";
/** 고르지 않음의 기호 값. */
const NONE_VALUE = 2;
/** 검사 글자의 법. */
const CHECK_MODULUS = 61;

const isPick = (value: unknown): value is GuessPick => value === null || value === 0 || value === 1;

const isSupportedSet = (value: unknown): value is GuessSetId =>
  typeof value === "string" && (V40_GUESS_SET_IDS as readonly string[]).includes(value);

/** 세트 글자가 지원 목록에 있고 장면이 정확히 여섯이며 모든 기호가 0, 1, null 인 값. 입력이 이상해도 던지지 않는다. */
function isGuessAnswers(value: unknown): value is GuessAnswers {
  if (value === null || typeof value !== "object") return false;
  const { set, slots } = value as { readonly set?: unknown; readonly slots?: unknown };
  if (!isSupportedSet(set) || !Array.isArray(slots) || slots.length !== V40_GUESS_SLOT_COUNT) return false;
  for (let index = 0; index < V40_GUESS_SLOT_COUNT; index += 1) {
    const slot: unknown = slots[index];
    if (slot === null || typeof slot !== "object") return false;
    const { self, guess } = slot as { readonly self?: unknown; readonly guess?: unknown };
    if (!isPick(self) || !isPick(guess)) return false;
  }
  return true;
}

const pickValue = (pick: GuessPick): number => (pick === null ? NONE_VALUE : pick);

/** 고른 것이 하나라도 있는가(내 고름이나 짐작 중 하나라도 0 또는 1). 모양이 어긋난 값과 null 은 false. */
export function hasGuessInfo(answers: GuessAnswers | null): answers is GuessAnswers {
  if (!isGuessAnswers(answers)) return false;
  return answers.slots.some((slot) => slot.self !== null || slot.guess !== null);
}

/**
 * 검사 글자: 알파벳[(합 (i + 1) x 알파벳 색인(body[i])) mod 61]. body 가 문자열이 아니거나 알파벳 밖 문자가 들면 RangeError(고정 메시지, 입력 글자를 싣지 않는다).
 * 70자 코드의 검사 글자(codec.ts checksumChar)와 달리 가중치가 위치 그대로 1에서 7이라, 장면 글자(0에서 8)를 다른 장면 글자로 바꾸거나 서로 다른 두 글자를 맞바꾸면 항상 어긋난다.
 * 알파벳이 62자라서 0 과 Z 처럼 61 을 법으로 같은 값을 내는 쌍은 검사 글자가 구별하지 못한다. 그런 글자가 장면 자리에 오는 것은 범위 검사(0에서 8)가 막는다.
 */
export function guessChecksumChar(body: string): string {
  if (typeof body !== "string") throw new RangeError("검사 글자 입력이 문자열이 아니다");
  let total = 0;
  for (let index = 0; index < body.length; index += 1) {
    const value = stateIndex(body[index]);
    if (value === null) throw new RangeError("검사 글자에 쓸 수 없는 문자");
    total += (index + 1) * value;
  }
  return V40_STATE_ALPHABET[total % CHECK_MODULUS];
}

/**
 * 짐작과 고름 -> 8자 g. 세트 글자가 지원 목록에 없거나 장면이 여섯이 아니거나 기호가 어긋났거나 고른 것이 하나도 없으면 null(만들지 않는다).
 * 던지지 않는다. 내 고름은 없고 짐작만 있는 장면(글자 6, 7)도 만들 수 있다(화면은 만들지 않지만 코덱은 받아들인다).
 */
export function encodeGuessCode(answers: GuessAnswers): string | null {
  if (!hasGuessInfo(answers)) return null;
  let body: string = answers.set;
  for (const slot of answers.slots) body += String(3 * pickValue(slot.self) + pickValue(slot.guess));
  return body + guessChecksumChar(body);
}

/**
 * 8자 g -> 짐작과 고름. 길이 8, 지원하는 세트 글자, 장면 글자 여섯이 모두 0에서 8, 모두 8(고른 것 없음)이 아님, 검사 글자가 맞음 중 하나라도 어긋나면 null.
 * 문자열이 아닌 입력에도 던지지 않는다.
 */
export function decodeGuessCode(code: string | null | undefined): GuessAnswers | null {
  if (typeof code !== "string" || code.length !== GUESS_CODE_LENGTH) return null;
  const set = code[0];
  if (!isSupportedSet(set)) return null;
  const slots: GuessSlot[] = [];
  let informative = false;
  for (let index = 1; index <= V40_GUESS_SLOT_COUNT; index += 1) {
    const value = SLOT_DIGITS.indexOf(code[index]);
    if (value < 0) return null;
    if (value !== 8) informative = true;
    const self = Math.floor(value / 3);
    const guess = value % 3;
    slots.push({ self: self === NONE_VALUE ? null : (self as GuessPick), guess: guess === NONE_VALUE ? null : (guess as GuessPick) });
  }
  if (!informative) return null;
  if (code[GUESS_CODE_LENGTH - 1] !== guessChecksumChar(code.slice(0, GUESS_CODE_LENGTH - 1))) return null;
  return { set, slots: slots as unknown as GuessAnswers["slots"] };
}

/** 한 사람 몫의 g 값을 풀어 보이는 도우미: 값이 없으면 null 로 두고, 있는데 못 풀면 undefined(링크 전체 거절). */
function decodeOptional(code: string | null): GuessAnswers | null | undefined {
  if (code === null) return null;
  return decodeGuessCode(code) ?? undefined;
}

/**
 * 링크 수준 규칙(계획 4.8). a, b, ga, gb 는 해시에서 뽑은 값(없으면 null)이다.
 *   네 값이 모두 없으면 none. a 가 없는데 b, ga, gb 중 하나라도 있으면 invalid.
 *   기존 decodeShareParams 가 invalid 면 invalid. ga 가 있는데 못 풀면 invalid. gb 가 있는데 b 가 없거나 못 풀면 invalid.
 *   b 가 없으면 partner, 있으면 both. 짐작이 없으면 null 이다. 한 사람의 답만 살리거나 기본값을 채우지 않는다.
 */
export function decodeGuessedShareParams(
  bank: CodecBankView,
  raw: { readonly a: string | null; readonly b: string | null; readonly ga: string | null; readonly gb: string | null },
): GuessedShareParse {
  const a = raw.a ?? null;
  const b = raw.b ?? null;
  const ga = raw.ga ?? null;
  const gb = raw.gb ?? null;
  if (a === null && b === null && ga === null && gb === null) return { kind: "none" };
  if (a === null) return { kind: "invalid" };
  const base = decodeShareParams(bank, a, b);
  if (base.kind !== "partner" && base.kind !== "both") return { kind: "invalid" };
  const firstGuess = decodeOptional(ga);
  if (firstGuess === undefined) return { kind: "invalid" };
  if (gb !== null && b === null) return { kind: "invalid" };
  const secondGuess = decodeOptional(gb);
  if (secondGuess === undefined) return { kind: "invalid" };
  if (base.kind === "partner") return { kind: "partner", first: base.first, firstGuess };
  return { kind: "both", first: base.first, second: base.second, firstGuess, secondGuess };
}

/** 해시에서 읽는 키의 집합: v, a, ga, b, gb. */
const HASH_KEYS: readonly string[] = [V40_LINK_KEYS.version, V40_LINK_KEYS.first, V40_GUESS_LINK_KEYS.first, V40_LINK_KEYS.second, V40_GUESS_LINK_KEYS.second];

/**
 * 주소의 해시 전체(# 포함 또는 제외)를 읽는다(parseShareHash 의 짐작 판). 키는 v, a, ga, b, gb 만 한 번씩 허용하고 v 는 판 태그여야 한다.
 * 없거나 비어 있으면 none, 그 밖의 모든 어긋남(모르는 키, 중복 키, 빈 부분, 긴 입력, 판 태그 없음)은 invalid.
 * 길이 상한(MAX_SHARE_HASH_LENGTH)을 넘는 입력은 쪼개 보지 않고 바로 invalid 로 답한다. 던지지 않는다.
 *
 * 기준 읽기(reference)다: 앱은 이 함수를 부르지 않는다. 앱의 입구(app/wedding-code/entry.ts)는 주소를 URLSearchParams 로 읽어(퍼센트 부호와 더하기를 풀고,
 * 빈 부분을 건너뛰고, 더 넓은 길이 상한을 쓴다) decodeGuessedShareParams 에 키별 값을 넘긴다. 그래서 이 함수의 더 엄격한 읽기(풀지 않음, 512자 상한)는
 * 사용자의 브라우저가 받아들이는 것이 아니다. 앱이 받아들이는 것은 entry.guess.test.ts 가 고정한다.
 */
export function parseGuessedShareHash(bank: CodecBankView, hash: string | null | undefined): GuessedShareParse {
  if (hash === null || hash === undefined) return { kind: "none" };
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
    if (!HASH_KEYS.includes(key) || seen.has(key)) return { kind: "invalid" };
    seen.set(key, value);
  }
  if (seen.get(V40_LINK_KEYS.version) !== WEDDING_CODE_V40_VERSION) return { kind: "invalid" };
  return decodeGuessedShareParams(bank, {
    a: seen.get(V40_LINK_KEYS.first) ?? null,
    b: seen.get(V40_LINK_KEYS.second) ?? null,
    ga: seen.get(V40_GUESS_LINK_KEYS.first) ?? null,
    gb: seen.get(V40_GUESS_LINK_KEYS.second) ?? null,
  });
}

/** 한 사람 몫이 주어졌는가(런타임에서 null 이나 undefined 가 들어와도 던지지 않게). */
const isPerson = (person: unknown): person is GuessedPerson => person !== null && typeof person === "object";

/**
 * 짐작이 든 보내기 링크(계획 4.9): 기존 buildGatedShareUrl 의 관문과 origin 규칙 그대로 기본 링크를 만들고 그 사이에 ga, 끝에 gb 를 끼운다.
 * 정규 순서 v, a, ga, b, gb. 두 g 가 모두 없으면 buildGatedShareUrl 의 결과와 바이트까지 같다. options(explicitVersion)는 buildGatedShareUrl 에 그대로 넘긴다(쿼리 `?v=` 를 붙일지).
 * 끼우는 자리를 문자열 검색으로 찾지 않는다: origin 이 https://h&a=x 처럼 유효하게 &a= 를 품을 수 있어서, 앞부분(single)을 접두어로 쓴다.
 * 관문이 닫힌 사람, 쓸 수 없는 origin, 만들 수 없는 g(고른 것이 하나도 없음 포함), 구조가 달라진 기본 링크는 null(조용히 틀린 링크를 내지 않는다).
 */
export function buildGatedShareUrlWithGuess(bank: Bank, origin: string, first: GuessedPerson, second?: GuessedPerson, options?: ShareUrlOptions): string | null {
  if (!isPerson(first)) return null;
  const hasSecond = second !== undefined && second !== null;
  if (hasSecond && !isPerson(second)) return null;
  const single = buildGatedShareUrl(bank, origin, first.code, undefined, options);
  if (single === null) return null;
  const full = hasSecond ? buildGatedShareUrl(bank, origin, first.code, second.code, options) : single;
  if (full === null || !full.startsWith(single)) return null;
  let firstPart = "";
  if (first.guess !== null && first.guess !== undefined) {
    const code = encodeGuessCode(first.guess);
    if (code === null) return null;
    firstPart = `&${V40_GUESS_LINK_KEYS.first}=${code}`;
  }
  let secondPart = "";
  if (hasSecond && second.guess !== null && second.guess !== undefined) {
    const code = encodeGuessCode(second.guess);
    if (code === null) return null;
    secondPart = `&${V40_GUESS_LINK_KEYS.second}=${code}`;
  }
  return single + firstPart + full.slice(single.length) + secondPart;
}


/** 이 파일의 함수를 계약(GuessLinkModule)대로 묶은 객체. 서명이 계약과 어긋나면 여기서 타입 오류가 난다. */
export const guessLinkModule = {
  guessChecksumChar,
  encodeGuessCode,
  decodeGuessCode,
  hasGuessInfo,
  decodeGuessedShareParams,
  parseGuessedShareHash,
  buildGatedShareUrlWithGuess,
} satisfies GuessLinkModule;
