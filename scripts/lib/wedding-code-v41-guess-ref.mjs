/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 기준 계산기(reference oracle, 빌드 계획 4.12, 트랙 F2).
 *
 * TypeScript 구현(apps/web/src/lib/weddingCode/v40/guess)과 섞이지 않는 순수 JS 이고, **계획의 명세 글(4.3, 4.7, 4.8, 4.9, 5.4)에서 다시 구현했다**:
 * TS 구현의 스케치를 베끼지 않는다(같은 맹점을 나누지 않으려고). 판정은 정규식과 표로, 조립은 조각 이어 붙이기로 TS 와 다른 길로 한다.
 * 기존 기준 계산기 wedding-code-v40-ref.mjs 는 고치지 않고 읽어 쓴다(ALPHABET, encodeCode, decodeCode, buildResult).
 * 다만 그 기준 계산기는 TS 코덱과 다른 점이 둘 있다: buildShareUrl 은 관문(canShare)을 보지 않고 origin 을 끝의 / 만 떼어 쓰며, parseShareHash 에는 길이 상한(512)이 없다.
 * 그래서 이 파일은 관문(buildResult(...).code !== null), origin 검사(빈 문자열 또는 http(s)://호스트[:포트] 한 덩어리, 255자 이하), 512 상한을 명세 글에서 따로 구현한다.
 *
 * 내보내는 것: GUESS_SET_IDS, guessChecksumChar, encodeGuessCode, decodeGuessCode, decodeGuessedShareParams, buildShareUrlWithGuess, parseGuessedShareHash, compareGuesses.
 *
 * 표현 약속: answers = { set, slots: [{ self, guess } x 6] }, 기호 0(첫째 카드), 1(둘째 카드), null(고르지 않음).
 *            person = { code: { formBit, responses }, guess: answers | null }.
 */
import { ALPHABET, buildResult, decodeCode, encodeCode } from "./wedding-code-v40-ref.mjs";

export const GUESS_SET_IDS = ["1"];
export const GUESS_SLOTS = 6;
export const MAX_HASH_LENGTH = 512;
const VERSION_TAG = "v4.0-tendency";

// ---------------------------------------------------------------------------
// 검사 글자와 g 글자열 (명세 4.3)
// ---------------------------------------------------------------------------

/** 알파벳[(합 (i + 1) x 알파벳 색인(body[i]) 을 61 로 나눈 나머지)]. 알파벳 밖 문자가 들면 RangeError. */
export function guessChecksumChar(body) {
  if (typeof body !== "string") throw new RangeError("문자열이 아니다");
  const total = [...body].reduce((sum, ch, i) => {
    const at = ALPHABET.indexOf(ch);
    if (at < 0) throw new RangeError("알파벳 밖 문자");
    return sum + (i + 1) * at;
  }, 0);
  return ALPHABET[total % 61];
}

const isPick = (x) => x === null || x === 0 || x === 1;

/** 명세의 입력 술어: 세트 글자가 지원 목록에 있고, 장면이 정확히 여섯이고, 기호가 모두 null, 0, 1. */
function validAnswers(answers) {
  if (answers === null || typeof answers !== "object") return false;
  if (!GUESS_SET_IDS.includes(answers.set)) return false;
  const { slots } = answers;
  if (!Array.isArray(slots) || slots.length !== GUESS_SLOTS) return false;
  for (let i = 0; i < GUESS_SLOTS; i += 1) {
    const slot = slots[i];
    if (slot === null || typeof slot !== "object" || !isPick(slot.self) || !isPick(slot.guess)) return false;
  }
  return true;
}

/** 고른 것(0 또는 1)이 내 고름이나 짐작에 하나라도 있는가. */
export function hasInfo(answers) {
  return validAnswers(answers) && answers.slots.some((s) => s.self !== null || s.guess !== null);
}

/** 상황 글자 = 3 x 내 고름 + 짐작 (고르지 않음은 2). */
const slotDigit = (slot) => String(3 * (slot.self ?? 2) + (slot.guess ?? 2));

export function encodeGuessCode(answers) {
  if (!hasInfo(answers)) return null;
  const body = answers.set + answers.slots.map(slotDigit).join("");
  return body + guessChecksumChar(body);
}

/** 정규식으로 모양을 먼저 거른다: 세트 글자 하나, 0에서 8 여섯 개, 알파벳 한 글자(전체 8자). */
const CODE_SHAPE = new RegExp(`^([${GUESS_SET_IDS.join("")}])([0-8]{6})([0-9a-zA-Z])$`);

export function decodeGuessCode(code) {
  if (typeof code !== "string") return null;
  const m = CODE_SHAPE.exec(code);
  if (m === null) return null;
  const digits = [...m[2]].map(Number);
  if (digits.every((v) => v === 8)) return null;
  if (guessChecksumChar(m[1] + m[2]) !== m[3]) return null;
  return {
    set: m[1],
    slots: digits.map((v) => ({
      self: [0, 1, null][Math.floor(v / 3)],
      guess: [0, 1, null][v % 3],
    })),
  };
}

// ---------------------------------------------------------------------------
// 링크 수준 규칙 (명세 4.8)
// ---------------------------------------------------------------------------

export function decodeGuessedShareParams(bank, raw) {
  const a = raw.a ?? null;
  const b = raw.b ?? null;
  const ga = raw.ga ?? null;
  const gb = raw.gb ?? null;
  if ([a, b, ga, gb].every((x) => x === null)) return { kind: "none" };
  if (a === null) return { kind: "invalid" };
  const first = decodeCode(bank, a);
  if (first === null) return { kind: "invalid" };
  let second = null;
  if (b !== null) {
    second = decodeCode(bank, b);
    if (second === null) return { kind: "invalid" };
  }
  let firstGuess = null;
  if (ga !== null) {
    firstGuess = decodeGuessCode(ga);
    if (firstGuess === null) return { kind: "invalid" };
  }
  let secondGuess = null;
  if (gb !== null) {
    if (b === null) return { kind: "invalid" };
    secondGuess = decodeGuessCode(gb);
    if (secondGuess === null) return { kind: "invalid" };
  }
  return second === null ? { kind: "partner", first, firstGuess } : { kind: "both", first, second, firstGuess, secondGuess };
}

/** 해시 전체를 읽는다: 키 v, a, ga, b, gb 한 번씩, v 는 판 태그, 길이 512 이하(넘으면 쪼개지 않고 invalid). */
export function parseGuessedShareHash(bank, hash) {
  if (hash === null || hash === undefined) return { kind: "none" };
  if (typeof hash !== "string") return { kind: "invalid" };
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (body === "") return { kind: "none" };
  if (body.length > MAX_HASH_LENGTH) return { kind: "invalid" };
  const found = {};
  for (const part of body.split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return { kind: "invalid" };
    const key = part.slice(0, eq);
    if (!["v", "a", "ga", "b", "gb"].includes(key) || Object.hasOwn(found, key)) return { kind: "invalid" };
    found[key] = part.slice(eq + 1);
  }
  if (found.v !== VERSION_TAG) return { kind: "invalid" };
  return decodeGuessedShareParams(bank, { a: found.a ?? null, b: found.b ?? null, ga: found.ga ?? null, gb: found.gb ?? null });
}

// ---------------------------------------------------------------------------
// 보내기 링크 조립 (명세 4.9)
// ---------------------------------------------------------------------------

/** origin: 끝의 / 를 모두 떼고 빈 문자열이거나 http(s)://호스트[:포트] 한 덩어리(공백, /, ?, #, 역슬래시, @ 없음), 255자 이하. 아니면 null. */
function originPrefix(origin) {
  if (typeof origin !== "string") return null;
  const trimmed = origin.replace(/\/+$/, "");
  if (trimmed === "") return "";
  if (trimmed.length > 255) return null;
  return /^https?:\/\/[^\s/?#\\@]+$/i.test(trimmed) ? trimmed : null;
}

/** 이 사람의 결과가 코드를 낼 수 있는가(관문): formBit 이 0 또는 1 이고 buildResult 의 code 가 null 이 아니다. */
function mayShare(bank, person) {
  if (person === null || typeof person !== "object") return false;
  const { code } = person;
  if (code === null || typeof code !== "object") return false;
  if (code.formBit !== 0 && code.formBit !== 1) return false;
  return buildResult(bank, code.formBit, code.responses).code !== null;
}

export function buildShareUrlWithGuess(bank, origin, first, second) {
  const people = second === undefined || second === null ? [first] : [first, second];
  if (!people.every((p) => mayShare(bank, p))) return null;
  const prefix = originPrefix(origin);
  if (prefix === null) return null;
  const pieces = [];
  for (const [index, person] of people.entries()) {
    const keys = index === 0 ? ["a", "ga"] : ["b", "gb"];
    const code = encodeCode(bank, person.code.formBit, person.code.responses);
    if (code === null) return null;
    pieces.push(`&${keys[0]}=${code}`);
    if (person.guess !== null && person.guess !== undefined) {
      const g = encodeGuessCode(person.guess);
      if (g === null) return null;
      pieces.push(`&${keys[1]}=${g}`);
    }
  }
  return `${prefix}/wedding-code#v=${VERSION_TAG}${pieces.join("")}`;
}

// ---------------------------------------------------------------------------
// 두 사람 비교 (명세 5.4)
// ---------------------------------------------------------------------------

/** 장면마다: first 의 짐작과 second 의 고름이 둘 다 카드이고 다르면 firstGuessedSecond, 반대 방향이면 secondGuessedFirst. 고른 것이 없는 쪽은 없는 것으로 본다. */
export function compareGuesses(first, second) {
  const a = hasInfo(first) ? first : null;
  const b = hasInfo(second) ? second : null;
  if (a === null && b === null) return { kind: "none" };
  if (a === null || b === null) return { kind: "oneSided" };
  const differs = (guessed, actual) => guessed !== null && actual !== null && guessed !== actual;
  const scenes = [];
  a.slots.forEach((mine, index) => {
    const theirs = b.slots[index];
    const diffs = [];
    if (differs(mine.guess, theirs.self)) diffs.push({ direction: "firstGuessedSecond", guessed: mine.guess, actual: theirs.self });
    if (differs(theirs.guess, mine.self)) diffs.push({ direction: "secondGuessedFirst", guessed: theirs.guess, actual: mine.self });
    if (diffs.length > 0) scenes.push({ index, diffs });
  });
  return { kind: "both", scenes };
}
