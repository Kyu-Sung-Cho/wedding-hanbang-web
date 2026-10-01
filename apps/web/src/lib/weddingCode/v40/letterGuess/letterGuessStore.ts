/**
 * 결과 전 글자 고르기의 이 브라우저 보관본을 **주입받은 포트**로 읽고 쓰고 지우는 순수 도우미.
 *
 * 이 파일은 저장소를 모른다. 저장소 이름도 저장 키도 없다. 포트(LetterGuessPort)는 클라이언트가 저장 모듈의 createExtraPort 로 만들어 넘기는 객체이고
 * (구조가 같아서 그대로 대입된다), 시계(now)도 인자로 받는다. 포트가 null 이면 이 브라우저가 저장소를 못 쓰는 것이다(던지지 않고 상태 이름으로 답한다).
 * 자동 저장이 꺼져 있는지는 포트의 write 가 답한다(off). 자동 저장 선호를 읽는 일도 포트를 만드는 쪽의 몫이다.
 *
 * 정책(오래된 고른 글자가 다른 결과와 견줘지지 않게):
 *  - 읽기: 기간이 지난 것(expired)은 읽으면서 지운다. 형식이 틀린 것(invalid)은 지우지 않는다(다른 판이나 어긋난 시계일 수 있다: 부르는 쪽이 정한다).
 *  - 시도 묶기: 보관본의 폼 비트가 지금 시도의 폼 비트와 다르면 쓰지 않는다(letterGuessForAttempt). 폼 비트는 한 비트라 주 방어가 아니고 보조 방어다.
 *    주 방어는 생애 주기다: 처음 시작, 다시 하기, 저장 지우기, 자동 저장 끄기가 clearLetterGuess 로 지우고, 이어 하기는 결과 쪽으로 이어 받을 때만 화면에 올린다(클라이언트의 몫).
 *  - 쓰기: 고른 것이 하나도 없으면(고르지 않고 결과 보기, 잘 모르겠어요만 누름) 쓰지 않고 이전 보관본을 지운다(오래된 고른 글자가 남지 않는다).
 * 읽기만으로 보관 기간을 늘리지 않는다(읽기는 아무것도 쓰지 않는다. 지우는 것뿐이다).
 */
import type { FormBit } from "../types";
import { parseLetterGuessEnvelope, serializeLetterGuessEnvelope } from "./letterGuessEnvelope";
import type { LetterGuess, LetterGuessRead } from "./types";

/**
 * 보관본 하나를 읽고 쓰고 지우는 포트. 저장 모듈의 ExtraPort 와 구조가 같다(대입된다).
 * read: ok 거짓이면 접근이 막혔다. write: saved(쓰고 다시 읽어 확인함), off(자동 저장이 꺼져 있어 쓰지 않음), unavailable(막혔거나 확인 실패).
 * remove: 지웠거나 이미 없으면 참, 접근이 막혔으면 거짓.
 */
export interface LetterGuessPort {
  read(): { readonly ok: true; readonly raw: string | null } | { readonly ok: false };
  write(raw: string): "saved" | "off" | "unavailable";
  remove(): boolean;
}

/** 읽기의 결과: 보관본 읽기와 같고, 포트가 없거나 접근이 막혔으면 unavailable. */
export type LetterGuessLoad = LetterGuessRead | { readonly status: "unavailable" };

/**
 * 쓰기의 결과. saved 쓰고 확인함, off 자동 저장이 꺼져 있어 쓰지 않음, unavailable 막혔거나 확인 실패(포트가 없는 경우 포함),
 * cleared 고른 것이 없어서 쓰지 않고 이전 보관본을 지움, invalid 폼 비트나 글자 모양이 틀림(쓰지 않았다).
 */
export type LetterGuessSave = "saved" | "off" | "unavailable" | "cleared" | "invalid";

/**
 * 보관본을 읽는다. 기간이 지났으면 지우고 expired 로 답한다. 읽기는 쓰지 않는다.
 * 포트가 없거나 접근이 막혔으면 unavailable.
 */
export function loadLetterGuess(port: LetterGuessPort | null, now: number): LetterGuessLoad {
  if (port === null) return { status: "unavailable" };
  const read = port.read();
  if (!read.ok) return { status: "unavailable" };
  const parsed = parseLetterGuessEnvelope(read.raw, now);
  if (parsed.status === "expired") port.remove();
  return parsed;
}

/**
 * 읽은 보관본이 지금 시도의 것일 때만 고른 글자를 돌려준다(폼 비트가 같을 때). 다른 시도의 것이거나 쓸 수 없는 읽기면 null.
 * 이어 받은 흐름의 폼 비트를 넘긴다. 돌려주지 않은 보관본은 부르는 쪽이 clearLetterGuess 로 지운다.
 */
export function letterGuessForAttempt(load: LetterGuessLoad, formBit: FormBit): LetterGuess | null {
  return load.status === "ready" && load.formBit === formBit ? load.guess : null;
}

/**
 * 보관본을 쓴다(자동 저장 규칙은 포트가 지킨다). guess 가 null 이거나 하나도 안 골랐으면 쓰지 않고 이전 보관본을 지운다(cleared).
 * 지우지 못했으면(포트가 없거나 접근이 막힘) unavailable.
 */
export function saveLetterGuess(port: LetterGuessPort | null, guess: LetterGuess | null, formBit: FormBit, now: number): LetterGuessSave {
  if (port === null) return "unavailable";
  if (guess === null || guess.every((pick) => pick === null)) return port.remove() ? "cleared" : "unavailable";
  const raw = serializeLetterGuessEnvelope(guess, formBit, now);
  if (raw === null) return "invalid";
  return port.write(raw);
}

/** 보관본을 지운다. 지웠거나 이미 없으면 참, 포트가 없거나 접근이 막혔으면 거짓. */
export function clearLetterGuess(port: LetterGuessPort | null): boolean {
  return port === null ? false : port.remove();
}
