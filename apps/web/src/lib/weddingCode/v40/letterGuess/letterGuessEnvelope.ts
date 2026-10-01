/**
 * 결과 전 글자 고르기의 보관본: 문자열을 만들고 푸는 순수 함수 넷.
 *
 * 이 파일은 저장소를 만지지 않는다. 읽고 쓰고 지우는 일은 클라이언트가 저장 모듈의 포트(ExtraPort)로 하고, 여기서는 그 포트가 나르는 문자열만 다룬다.
 * 그래서 저장소 이름도 저장 키도 이 폴더에 없다(소스 가드 규칙 5). 링크 코덱도 가져오지 않는다: 고른 글자는 링크에 가지 않는다(규칙 13).
 *
 * 봉투 모양(키 다섯 개가 정확히, 이 순서):
 *   { "schema": 1, "version": "v4.0-tendency", "savedAt": <밀리초>, "formBit": 0 또는 1, "guess": "<네 글자>" }
 * guess 는 주제 순서(돈, 준비, 정하는 사람, 지쳤을 때)마다 그 주제의 두 글자 중 하나 또는 하이픈(고르지 않음). 예 V-UA.
 * 전부 하이픈이면 저장하지 않는다(serialize 가 null).
 *
 * 만료는 마지막 저장부터 V40_STORAGE.ttlMs 이고 경계는 진행 저장과 같다(지난 시간이 기간 이상이면 expired). 미래 시각은 거절한다.
 * 읽기만으로 보관 기간을 늘리지 않는다(이 파일의 함수는 아무것도 쓰지 않는다).
 *
 * formBit 은 다른 시도의 보관본이 지금 결과와 견줘지는 것을 막는 보조 방어일 뿐이다(1비트라 같은 값이 우연히 나올 수 있다).
 * 주 방어는 생애 주기다: 처음 시작, 다시 하기, 저장 지우기, 자동 저장 끄기가 보관본을 지우고, 이어 하기는 결과 쪽으로 이어 받을 때만 화면에 올린다(클라이언트의 몫).
 */
import { V40_AXIS_KEYS, V40_STORAGE, WEDDING_CODE_V40_VERSION, axisOfLetter, isLetter } from "@/constants/weddingCodeV40";
import type { FormBit } from "../types";
import type { LetterGuess, LetterGuessRead } from "./types";

const ENVELOPE_SCHEMA = 1;
const ENVELOPE_KEYS = ["schema", "version", "savedAt", "formBit", "guess"] as const;
/** 봉투 문자열 길이 상한(실제 봉투는 100자 안팎이라 넉넉하게 둔다). */
const MAX_ENVELOPE_LENGTH = 256;
/** 네 글자 문자열에서 고르지 않은 주제를 적는 기호. */
const NOT_CHOSEN = "-";
const GUESS_LENGTH = V40_AXIS_KEYS.length;

/** 순수 객체(배열과 특수 객체는 아님)인가. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>): boolean {
  const own = Object.keys(record);
  return own.length === ENVELOPE_KEYS.length && own.every((key) => (ENVELOPE_KEYS as readonly string[]).includes(key));
}

/** 0 이상의 안전한 정수(밀리초 시각)인가. */
function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** 네 칸 모양이고 칸마다 null 이거나 그 주제의 글자인가(고른 것이 하나도 없어도 모양은 맞다). */
export function isLetterGuess(value: unknown): value is LetterGuess {
  if (!Array.isArray(value) || value.length !== GUESS_LENGTH) return false;
  return V40_AXIS_KEYS.every((axis, index) => {
    const pick: unknown = value[index];
    return pick === null || (isLetter(pick) && axisOfLetter(pick) === axis);
  });
}

/**
 * 네 글자 문자열로 만든다(예 V-UA). 모양이 틀렸거나 하나도 안 골랐으면 null.
 * 주제마다 그 주제의 글자만 받는다(다른 주제의 글자가 들어가면 null).
 */
export function encodeLetterGuess(guess: LetterGuess): string | null {
  if (!isLetterGuess(guess) || guess.every((pick) => pick === null)) return null;
  return guess.map((pick) => pick ?? NOT_CHOSEN).join("");
}

/** encodeLetterGuess 의 역. 문자열이 아니거나 길이가 네 글자가 아니거나, 주제에 없는 글자가 있거나, 전부 하이픈이면 null. */
export function decodeLetterGuess(text: unknown): LetterGuess | null {
  if (typeof text !== "string" || text.length !== GUESS_LENGTH) return null;
  const picks: unknown[] = [];
  for (let index = 0; index < GUESS_LENGTH; index += 1) {
    const char = text[index];
    if (char === NOT_CHOSEN) {
      picks.push(null);
      continue;
    }
    if (!isLetter(char) || axisOfLetter(char) !== V40_AXIS_KEYS[index]) return null;
    picks.push(char);
  }
  if (picks.every((pick) => pick === null)) return null;
  return picks as unknown as LetterGuess;
}

/**
 * 보관본 원문을 만든다. 고른 것이 하나도 없거나, 글자가 주제와 맞지 않거나, 폼 비트나 시각이 올바르지 않으면 null(저장하지 않는다).
 * 키 순서는 고정이다(같은 입력은 늘 같은 문자열).
 */
export function serializeLetterGuessEnvelope(guess: LetterGuess, formBit: FormBit, savedAt: number): string | null {
  const encoded = encodeLetterGuess(guess);
  if (encoded === null || (formBit !== 0 && formBit !== 1) || !isTimestamp(savedAt)) return null;
  return JSON.stringify({
    schema: ENVELOPE_SCHEMA,
    version: WEDDING_CODE_V40_VERSION,
    savedAt,
    formBit,
    guess: encoded,
  });
}

/**
 * 보관본 원문을 푼다. now 는 지금 시각(밀리초).
 * 없음 empty(원문이 null), 형식 위반 invalid, 마지막 저장부터 기간이 지남 expired, 그 밖에는 ready.
 * 확인 순서는 진행 저장 읽기와 같다: 형식을 모두 확인한 뒤에야 기간을 본다. 그래서 형식이 틀린 것은 오래돼도 invalid 다.
 * savedAt 이 지금보다 미래이면 invalid(시계가 어긋났거나 다른 곳이 쓴 값일 수 있다).
 */
export function parseLetterGuessEnvelope(raw: string | null, now: number): LetterGuessRead {
  if (!isTimestamp(now)) return { status: "invalid" };
  if (raw === null || raw === undefined) return { status: "empty" };
  if (typeof raw !== "string" || raw.length > MAX_ENVELOPE_LENGTH) return { status: "invalid" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }
  if (!isRecord(value) || !hasExactKeys(value)) return { status: "invalid" };
  if (value.schema !== ENVELOPE_SCHEMA || value.version !== WEDDING_CODE_V40_VERSION) return { status: "invalid" };
  const { savedAt, formBit } = value;
  if (!isTimestamp(savedAt) || savedAt > now) return { status: "invalid" };
  if (formBit !== 0 && formBit !== 1) return { status: "invalid" };
  const guess = decodeLetterGuess(value.guess);
  if (guess === null) return { status: "invalid" };
  if (now - savedAt >= V40_STORAGE.ttlMs) return { status: "expired" };
  return { status: "ready", guess, formBit, savedAt };
}
