/**
 * 결과 전 글자 고르기(letterGuess)의 모델: 어떤 결과 앞에서 열지, 먼저 고른 글자를 결과와 어떻게 나란히 놓을지.
 *
 * 이 파일은 글자 엔진을 읽기만 한다(buildResult 가 낸 V40Result 를 받는다). 채점, 관문, 동점 사슬, 세기 문턱은 한 줄도 바꾸지 않고 다시 계산하지도 않는다.
 * 클라이언트와 화면은 이 파일 하나에서 모델과 보관본 함수와 타입을 가져간다(보관본 함수는 letterGuessEnvelope.ts, 포트를 주입받는 읽기와 쓰기와 지우기 도우미는
 * letterGuessStore.ts 에 있고 여기서 다시 내보낸다).
 *
 * 나란히 놓는 규칙(계획 7.4). 견주는 대상은 결과 화면이 **보여 주는** 글자와 세기다: axis.letter, axis.shownBand(힌트로 낮춘 뒤), axis.provisional.
 *   관문이 닫힘(코드 없음)                       그리지 않는다
 *   글자 없음(가운뎃점), 임시 글자, 반반이에요     줄 없음(견줄 글자가 없거나 일치 여부가 뜻이 없다. 힌트로 내려간 반반도 같다)
 *   글자가 확정된 주제(뚜렷해요, 기울어요)만 견준다: 두 사람 비교와 직접 고른 쪽 대비와 같은 「기울어요 이상」 기준
 *   다른 주제가 있으면 그 주제의 줄만(같은 주제는 말하지 않는다), 없으면 같음 한 줄, 고른 주제가 모두 확정이 아니면 한 줄
 *   아무것도 안 골랐으면 그리지 않는다
 * 맞혔다, 틀렸다, 개수, 비율, 까닭은 말하지 않는다. 어긋남의 흔한 까닭(그날의 기분, 문항 문구, 잡음)을 제품은 모른다.
 */
import { axisInfo } from "@/constants/weddingCodeV40";
import type { Axis, AxisResult, FormBit, Letter, V40Result } from "../types";
import type { LetterGuessModule } from "./letterGuessContract";
import {
  decodeLetterGuess,
  encodeLetterGuess,
  isLetterGuess,
  parseLetterGuessEnvelope,
  serializeLetterGuessEnvelope,
} from "./letterGuessEnvelope";
import {
  clearLetterGuess,
  letterGuessForAttempt,
  loadLetterGuess,
  saveLetterGuess,
} from "./letterGuessStore";
import type { LetterGuess, LetterGuessLine, LetterGuessSummary } from "./types";

export {
  decodeLetterGuess,
  encodeLetterGuess,
  isLetterGuess,
  parseLetterGuessEnvelope,
  serializeLetterGuessEnvelope,
};
export { clearLetterGuess, letterGuessForAttempt, loadLetterGuess, saveLetterGuess };
export type { LetterGuessLoad, LetterGuessPort, LetterGuessSave } from "./letterGuessStore";
export { V40_LETTER_GUESS_ENABLED } from "./types";
export type {
  LetterGuess,
  LetterGuessLine,
  LetterGuessRead,
  LetterGuessStorageMode,
  LetterGuessSummary,
} from "./types";

/**
 * 결과 화면이 보여 주는 글자가 확정된 주제인가. 글자가 있고, 임시 글자가 아니고, 화면에 보이는 세기가 뚜렷해요 또는 기울어요일 때만 참이다.
 * 반반이에요는 한 글자만 적을 수 있어서 그 글자를 적은 것일 뿐이라 일치 여부가 뜻이 없다(힌트가 기울어요를 반반이에요로 낮춘 주제도 같다).
 */
export function isSettledAxis(axis: AxisResult): boolean {
  return axis.letter !== null && !axis.provisional && (axis.shownBand === "clear" || axis.shownBand === "lean");
}

/** 이 결과 앞에서 글자 고르기를 열 만한가: 관문이 안 닫혀 코드가 있고, 글자가 확정된 주제가 하나라도 있다. */
export function isLetterGuessEligible(result: V40Result): boolean {
  return result.code !== null && result.axes.some(isSettledAxis);
}

/** 고른 것이 하나라도 있는가. */
export function hasLetterGuessPick(guess: LetterGuess | null): guess is LetterGuess {
  return guess !== null && guess.some((pick) => pick !== null);
}

/**
 * 먼저 고른 글자를 결과와 나란히 놓은 요약(계획 7.4의 표). 관문이 닫혔거나 guess 가 없거나 모양이 틀렸거나 하나도 안 골랐으면 none.
 * 주제 순서로 본다. 같은 주제는 줄로 만들지 않는다(칭찬이나 합격 표시로 읽히지 않게).
 */
export function summarizeLetterGuess(result: V40Result, guess: LetterGuess | null): LetterGuessSummary {
  if (result.code === null || !isLetterGuess(guess) || !hasLetterGuessPick(guess)) return { kind: "none" };
  const lines: LetterGuessLine[] = [];
  let same = 0;
  result.axes.forEach((axis, index) => {
    const guessed = guess[index];
    if (guessed === null) return;
    const shown = axis.letter;
    if (shown === null || !isSettledAxis(axis)) return;
    if (guessed === shown) same += 1;
    else lines.push({ axis: axis.axis, guessed, shown });
  });
  if (lines.length > 0) return { kind: "lines", lines };
  if (same > 0) return { kind: "same" };
  return { kind: "unsettledOnly" };
}

/**
 * 구역에 그릴 것이 있는가(요약이 none 이 아님). 결과 화면이 슬롯을 감싸는 상자를 요약이 none 일 때 아예 만들지 않게 쓴다
 * (안이 비어도 상자가 있으면 구역 사이 간격만 남는다).
 */
export function hasLetterGuessLines(summary: LetterGuessSummary): boolean {
  return summary.kind !== "none";
}

/**
 * 주제의 두 글자를 화면 순서(위, 아래)로. 폼 비트 0 은 앞 글자가 위, 1 은 뒤 글자가 위다.
 * 두 카드의 순서가 늘 앞 글자 먼저이면 첫 카드가 곧 한쪽 글자라는 쏠림이 생기므로 질문 화면의 폼 비트를 그대로 따른다.
 */
export function letterGuessChoices(formBit: FormBit, axis: Axis): readonly [Letter, Letter] {
  const info = axisInfo(axis);
  return formBit === 1 ? [info.back, info.front] : [info.front, info.back];
}

/** 이 파일과 보관본 파일의 함수를 계약(LetterGuessModule)대로 묶은 객체. */
export const letterGuessModule = {
  isSettledAxis,
  isLetterGuessEligible,
  summarizeLetterGuess,
  hasLetterGuessLines,
  letterGuessChoices,
  serializeLetterGuessEnvelope,
  parseLetterGuessEnvelope,
  encodeLetterGuess,
  decodeLetterGuess,
  loadLetterGuess,
  letterGuessForAttempt,
  saveLetterGuess,
  clearLetterGuess,
} satisfies LetterGuessModule;
