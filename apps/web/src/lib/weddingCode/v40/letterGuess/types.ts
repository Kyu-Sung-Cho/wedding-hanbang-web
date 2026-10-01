/**
 * 웨딩코드 4.1 단계 2, 결과 전 글자 고르기(코드 안 이름 letterGuess)의 타입.
 *
 * 화면 낱말은 「골라 보기」다. 본인이 결과를 보기 전에 주제마다 두 글자 중 가까운 쪽을 골라 두고, 결과를 본 뒤에 결과 글자와 나란히 놓는 선택 기능이다.
 * 글자 엔진, 채점, 관문, 링크 코드에는 한 줄도 손대지 않는다. 이 폴더의 파일은 글자 엔진을 읽기만 한다(결과 V40Result 를 받아 줄을 만든다).
 * 고른 글자는 링크, 아모라, 이용 통계, 서버 어디에도 가지 않는다. 이 브라우저의 보관본은 문자열을 만들고 푸는 순수 함수(letterGuessEnvelope.ts)뿐이고
 * 읽고 쓰고 지우는 일은 클라이언트가 저장 모듈의 포트로 한다(이 폴더는 저장소를 모른다).
 */
import type { Axis, FormBit, Letter } from "../types";

export type { Axis, FormBit, Letter };

/**
 * 기능 켬 상수. 끄면 화면만 사라진다(결과 계산, 링크, 저장에는 영향이 없다). 어둡게 둔 v4 입구 뒤에서만 열리므로 기본값은 켬이다.
 * 클라이언트의 stages 주입이 이 값을 기본으로 읽는다.
 */
export const V40_LETTER_GUESS_ENABLED: boolean = true;

/** 주제 순서(V40_AXIS_KEYS: 돈, 준비, 정하는 사람, 지쳤을 때)로 네 칸. 고르지 않았거나 「잘 모르겠어요」를 누른 주제는 null 이다. */
export type LetterGuess = readonly [Letter | null, Letter | null, Letter | null, Letter | null];

/** 먼저 고른 글자와 결과 글자가 다른 주제 하나. guessed 는 먼저 고른 글자, shown 은 결과 화면에 보이는 글자다. */
export interface LetterGuessLine {
  readonly axis: Axis;
  readonly guessed: Letter;
  readonly shown: Letter;
}

/**
 * 결과 화면 「먼저 고른 글자와 나란히」 구역이 말할 것.
 * none: 아무것도 그리지 않는다(고른 것이 없거나, 관문이 닫혔거나, 보관본이 이 결과와 맞지 않는다).
 * lines: 글자가 정해진 주제 가운데 먼저 고른 글자와 결과 글자가 다른 주제의 줄(같은 주제는 말하지 않는다). 주제 순서다.
 * same: 글자가 정해진 주제를 골랐고 모두 같다.
 * unsettledOnly: 골랐지만 고른 주제가 모두 글자를 정하지 못했거나 반반이라 나란히 놓을 수 없다.
 */
export type LetterGuessSummary =
  | { readonly kind: "none" }
  | { readonly kind: "lines"; readonly lines: readonly LetterGuessLine[] }
  | { readonly kind: "same" }
  | { readonly kind: "unsettledOnly" };

/** 저장 모드 셋. 화면의 저장 안내 한 줄이 이것을 따른다(on 이 아니면 저장하지 않는다고 말한다). */
export type LetterGuessStorageMode = "on" | "off" | "blocked";

/**
 * 보관본 읽기의 결과.
 * ready: 올바른 보관본(고른 글자, 그 때의 폼 비트, 저장 시각).
 * empty: 보관본이 없다(키에 아무것도 없다).
 * invalid: 형식 위반 하나라도(모르는 키, 다른 판, 미래 시각, 주제에 없는 글자, 전부 고르지 않음 등). 호출자가 지울지 정한다.
 * expired: 올바른 보관본이지만 마지막 저장부터 기간이 지났다. 호출자가 지운다.
 */
export type LetterGuessRead =
  | { readonly status: "ready"; readonly guess: LetterGuess; readonly formBit: FormBit; readonly savedAt: number }
  | { readonly status: "empty" | "invalid" | "expired" };
