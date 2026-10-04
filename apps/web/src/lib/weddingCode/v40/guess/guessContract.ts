/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 링크 모듈 계약(빌드 계획 8.1, 트랙 F2).
 *
 * 이 파일은 타입만 낸다(런타임 코드 없음). 구현 파일 guessLink.ts 가 마지막 줄에서 객체로 묶어 satisfies 로 검사한다.
 * 통합자가 contract.ts 에서 이 인터페이스를 다시 내보낸다.
 */
import type { Bank, CodecBankView } from "../types";
import type { GuessAnswers, GuessedPerson, GuessedShareParse } from "./types";

export interface GuessLinkModule {
  /** 검사 글자. body 가 알파벳 밖 문자를 품으면 RangeError(고정 메시지, 입력 글자를 싣지 않는다). */
  guessChecksumChar(body: string): string;
  /** 짐작과 고름 -> 8자 g. 만들 수 없으면 null. 던지지 않는다. */
  encodeGuessCode(answers: GuessAnswers): string | null;
  /** 8자 g -> 짐작과 고름. 하나라도 어긋나면 null. 던지지 않는다. */
  decodeGuessCode(code: string | null | undefined): GuessAnswers | null;
  /** 고른 것이 하나라도 있는가. */
  hasGuessInfo(answers: GuessAnswers | null): answers is GuessAnswers;
  /** a, b, ga, gb -> 링크 수준 판정. */
  decodeGuessedShareParams(
    bank: CodecBankView,
    raw: { readonly a: string | null; readonly b: string | null; readonly ga: string | null; readonly gb: string | null },
  ): GuessedShareParse;
  /** 주소 해시 전체 -> 링크 수준 판정(키 v, a, ga, b, gb). */
  parseGuessedShareHash(bank: CodecBankView, hash: string | null | undefined): GuessedShareParse;
  /** 짐작이 든 보내기 링크. 만들 수 없으면 null. */
  buildGatedShareUrlWithGuess(bank: Bank, origin: string, first: GuessedPerson, second?: GuessedPerson, options?: { readonly explicitVersion?: boolean }): string | null;
}
