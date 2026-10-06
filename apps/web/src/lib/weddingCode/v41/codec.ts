/** v4.1 링크는 코드 본문 첫 글자를 2/3으로 분리한다. 판 태그만 바꾼 v4.0 코드는 열리지 않는다. */
import { WEDDING_CODE_V41_VERSION } from "@/constants/weddingCodeV41";
import { buildGatedShareUrl as buildV40ShareUrl, buildQuestionOnlyUrl as buildV40QuestionOnlyUrl, checksumChar, decodeCode as decodeV40Code, encodeCode as encodeV40Code } from "../v40/codec";
import { decodeGuessCode as decodeV40GuessCode, encodeGuessCode as encodeV40GuessCode, guessChecksumChar } from "../v40/guess/guessLink";
import type { GuessAnswers, GuessedShareParse, GuessedPerson } from "../v40/guess/types";
import type { Bank, CodecBankView, DecodedCode, FormBit, Responses } from "../v40/types";

export function encodeCode(bank: CodecBankView, formBit: FormBit, responses: Responses): string | null {
  const oldCode = encodeV40Code(bank, formBit, responses);
  if (oldCode === null) return null;
  const body = `${formBit === 0 ? "2" : "3"}${oldCode.slice(1, -1)}`;
  return body + checksumChar(body);
}

export function decodeCode(bank: CodecBankView, code: string | null | undefined): DecodedCode | null {
  if (typeof code !== "string" || (code[0] !== "2" && code[0] !== "3") || code.length !== 70) return null;
  const body = code.slice(0, -1);
  try {
    if (code.at(-1) !== checksumChar(body)) return null;
    const oldBody = `${code[0] === "2" ? "0" : "1"}${body.slice(1)}`;
    return decodeV40Code(bank, oldBody + checksumChar(oldBody));
  } catch {
    return null;
  }
}

/** v4.0의 origin 검사와 공개 관문을 통과한 경우에만 새 판 코드로 주소를 만든다. */
export function buildGatedShareUrl(bank: Bank, origin: string, first: DecodedCode, second?: DecodedCode): string | null {
  const gated = buildV40ShareUrl(bank, origin, first, second);
  if (gated === null) return null;
  const cut = gated.indexOf("#");
  if (cut < 0) return null;
  const a = encodeCode(bank, first.formBit, first.responses);
  if (a === null) return null;
  const params = new URLSearchParams({ v: WEDDING_CODE_V41_VERSION, a });
  if (second !== undefined && second !== null) {
    const b = encodeCode(bank, second.formBit, second.responses);
    if (b === null) return null;
    params.set("b", b);
  }
  return `${gated.slice(0, cut)}#${params.toString()}`;
}

export function buildQuestionOnlyUrl(origin: string, options?: { readonly explicitVersion?: boolean }): string {
  // 새 판은 기본 입구가 무엇이든 판 태그가 없으면 안 된다. 호출자가 false를 주어도 명시한다.
  void options;
  const base = buildV40QuestionOnlyUrl(origin, { explicitVersion: false });
  return `${base}?v=${WEDDING_CODE_V41_VERSION}`;
}

/** 짐작 코드도 첫 글자를 2로 분리해 ga/gb만 옛 링크에서 옮기는 일을 막는다. */
export function encodeGuessCode(guess: GuessAnswers): string | null {
  const oldCode = encodeV40GuessCode(guess);
  if (oldCode === null) return null;
  const body = `2${oldCode.slice(1, -1)}`;
  return body + guessChecksumChar(body);
}

export function decodeGuessCode(code: string | null | undefined): GuessAnswers | null {
  if (typeof code !== "string" || code.length !== 8 || code[0] !== "2") return null;
  try {
    const body = code.slice(0, -1);
    if (code.at(-1) !== guessChecksumChar(body)) return null;
    const oldBody = `1${body.slice(1)}`;
    return decodeV40GuessCode(oldBody + guessChecksumChar(oldBody));
  } catch {
    return null;
  }
}

function optionalGuess(code: string | null): GuessAnswers | null | undefined {
  return code === null ? null : decodeGuessCode(code) ?? undefined;
}

export function decodeGuessedShareParams(
  bank: CodecBankView,
  raw: { readonly a: string | null; readonly b: string | null; readonly ga: string | null; readonly gb: string | null },
): GuessedShareParse {
  const { a, b, ga, gb } = raw;
  if (a === null && b === null && ga === null && gb === null) return { kind: "none" };
  if (a === null || (gb !== null && b === null)) return { kind: "invalid" };
  const first = decodeCode(bank, a);
  const second = b === null ? null : decodeCode(bank, b);
  const firstGuess = optionalGuess(ga);
  const secondGuess = optionalGuess(gb);
  if (first === null || (b !== null && second === null) || firstGuess === undefined || secondGuess === undefined) return { kind: "invalid" };
  if (second === null) return { kind: "partner", first, firstGuess };
  return { kind: "both", first, second, firstGuess, secondGuess };
}

export function buildGatedShareUrlWithGuess(bank: Bank, origin: string, first: GuessedPerson, second?: GuessedPerson): string | null {
  if (first === null || typeof first !== "object" || (second !== undefined && second !== null && typeof second !== "object")) return null;
  const base = buildGatedShareUrl(bank, origin, first.code, second?.code);
  if (base === null) return null;
  const firstGuess = first.guess === null ? null : encodeGuessCode(first.guess);
  const secondGuess = second?.guess == null ? null : encodeGuessCode(second.guess);
  if ((first.guess !== null && firstGuess === null) || (second?.guess != null && secondGuess === null)) return null;
  const cut = base.indexOf("#");
  if (cut < 0) return null;
  const params = new URLSearchParams(base.slice(cut + 1));
  if (firstGuess !== null) params.set("ga", firstGuess);
  if (secondGuess !== null) params.set("gb", secondGuess);
  // URLSearchParams의 삽입 순서를 v, a, ga, b, gb로 고정한다.
  const ordered = new URLSearchParams({ v: WEDDING_CODE_V41_VERSION, a: params.get("a") ?? "" });
  if (firstGuess !== null) ordered.set("ga", firstGuess);
  if (params.has("b")) ordered.set("b", params.get("b") ?? "");
  if (secondGuess !== null) ordered.set("gb", secondGuess);
  return `${base.slice(0, cut)}#${ordered.toString()}`;
}
