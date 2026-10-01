/**
 * 결과 전 글자 고르기(letterGuess) 모듈의 계약. 타입만 낸다(런타임 코드 없음).
 * 구현(letterGuess.ts)이 마지막 줄에서 `satisfies LetterGuessModule` 로 이 서명을 지키는지 검사한다.
 * 통합자가 contract.ts 에서 이 인터페이스를 다시 내보낸다.
 *
 * 모든 함수는 순수하다. 시계는 인자(now, savedAt)로 받고 저장소는 모른다. 던지지 않는다(잘못된 입력은 null 이나 상태 이름으로 답한다).
 */
import type { AxisResult, V40Result } from "../types";
import type { LetterGuessLoad, LetterGuessPort, LetterGuessSave } from "./letterGuessStore";
import type { Axis, FormBit, Letter, LetterGuess, LetterGuessRead, LetterGuessSummary } from "./types";

export interface LetterGuessModule {
  /**
   * 결과 화면이 보여 주는 글자가 확정된 주제인가: 글자가 있고(axis.letter), 임시 글자가 아니며(axis.provisional), 화면에 보이는 세기(axis.shownBand)가
   * 뚜렷해요 또는 기울어요. 반반이에요(힌트로 내려간 반반 포함)와 글자를 못 정한 주제와 임시 글자는 아니다.
   * 두 사람 비교와 직접 고른 쪽 대비와 같은 「기울어요 이상」 기준이다.
   */
  isSettledAxis(axis: AxisResult): boolean;
  /** 이 결과 앞에서 글자 고르기를 열 만한가: 코드가 있고(관문이 안 닫힘) 글자가 확정된 주제가 하나 이상. */
  isLetterGuessEligible(result: V40Result): boolean;
  /**
   * 먼저 고른 글자를 결과와 나란히 놓은 요약. 견주는 대상은 결과 화면이 보여 주는 글자와 세기다.
   * 관문이 닫혔거나 guess 가 없거나 모양이 틀렸거나 하나도 안 골랐으면 none. 글자가 확정된 주제만 견준다.
   * 다른 주제가 하나라도 있으면 lines(다른 주제의 줄만), 없고 같은 주제가 있으면 same, 고른 주제가 모두 확정이 아니면 unsettledOnly.
   */
  summarizeLetterGuess(result: V40Result, guess: LetterGuess | null): LetterGuessSummary;
  /** 구역에 그릴 것이 있는가(요약이 none 이 아님). 결과 화면의 슬롯 상자를 none 일 때 만들지 않는 데 쓴다. */
  hasLetterGuessLines(summary: LetterGuessSummary): boolean;
  /** 화면 순서의 두 글자(위, 아래). 폼 비트 0 은 앞 글자가 위, 1 은 뒤 글자가 위(첫 카드가 늘 같은 극이 되는 쏠림을 막는다). */
  letterGuessChoices(formBit: FormBit, axis: Axis): readonly [Letter, Letter];
  /** 보관본 원문을 만든다. 고른 것이 하나도 없으면 null(저장하지 않는다). 키 다섯 개 고정 순서의 JSON 문자열. */
  serializeLetterGuessEnvelope(guess: LetterGuess, formBit: FormBit, savedAt: number): string | null;
  /** 보관본 원문을 푼다. now 는 지금 시각(밀리초). 읽기만으로 보관 기간을 늘리지 않는다. */
  parseLetterGuessEnvelope(raw: string | null, now: number): LetterGuessRead;
  /** 네 글자 문자열(예 V-UA, 고르지 않은 주제는 하이픈). 하나도 안 골랐거나 모양이 틀리면 null. */
  encodeLetterGuess(guess: LetterGuess): string | null;
  /** encodeLetterGuess 의 역. 길이가 4가 아니거나 주제에 없는 글자가 있거나 전부 하이픈이면 null. */
  decodeLetterGuess(text: unknown): LetterGuess | null;
  /**
   * 주입받은 포트로 보관본을 읽는다(포트는 클라이언트가 저장 모듈의 createExtraPort 로 만든다. 이 모듈은 저장소를 모른다). 기간이 지난 것은 읽으면서 지우고 expired 로 답한다.
   * 포트가 없거나 막혔으면 unavailable. 형식이 틀린 것은 지우지 않는다.
   */
  loadLetterGuess(port: LetterGuessPort | null, now: number): LetterGuessLoad;
  /** 읽은 보관본이 지금 시도의 것(폼 비트가 같음)일 때만 고른 글자를 돌려준다. 아니면 null. */
  letterGuessForAttempt(load: LetterGuessLoad, formBit: FormBit): LetterGuess | null;
  /** 보관본을 쓴다. 고른 것이 하나도 없으면 쓰지 않고 이전 보관본을 지운다(cleared). 자동 저장이 꺼져 있으면 포트가 off 로 답한다. */
  saveLetterGuess(port: LetterGuessPort | null, guess: LetterGuess | null, formBit: FormBit, now: number): LetterGuessSave;
  /** 보관본을 지운다. 지웠거나 이미 없으면 참. */
  clearLetterGuess(port: LetterGuessPort | null): boolean;
}
