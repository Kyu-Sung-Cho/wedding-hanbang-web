/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 타입과 켬 상수(빌드 계획 8.1, 트랙 F2).
 *
 * 이 폴더의 모든 파일은 이 파일의 타입을 쓴다. 이 파일은 코어 타입(DecodedCode)만 가져오고 아무것도 실행하지 않는다.
 * 링크 필드 ga, gb 의 8자(세트 글자 1 + 장면 글자 6 + 검사 글자 1), 비교와 화면은 같은 폴더의 guessLink, guessCompare, 화면 컴포넌트가 맡는다.
 *
 * 한 장면의 기호는 둘이다: 내 답(self)과 상대가 고를 것이라고 한 짐작(guess). 값은 세트 자료의 첫째 카드(0), 둘째 카드(1), 고르지 않음(null).
 * 첫째/둘째는 세트 자료(cards[0], cards[1])의 저장 기준 순서이고, 화면의 위아래는 폼 비트로 뒤집혀도 저장은 이 기준이다.
 * 「잘 모르겠어요」, 「제 상황과 안 맞아요」, 「지금은 넘어갈게요」는 모두 고르지 않음(null)이다(링크는 셋을 구별하지 않는다).
 */
import type { DecodedCode } from "../types";

/** 서로 짐작하기 화면을 켠다(링크 해독은 이 값과 상관없이 늘 켜져 있다: 이미 나간 ga 링크가 깨지지 않게). v4 어두운 진입 뒤에서만 열린다. */
export const V40_PAIR_GUESS_ENABLED: boolean = true;

/** 장면 수. 링크 g 의 장면 글자 개수이기도 하다. */
export const V40_GUESS_SLOT_COUNT = 6 as const;

/** 한 단계 화면의 첫 주 단추를 마운트 직후 이 시간(밀리초) 안에 누른 것은 무시한다(앞 화면의 같은 자리 단추를 두 번 누른 것으로 본다). */
export const GUESS_TURN_GUARD_MS = 300 as const;

/** 지원하는 세트 글자. 세트 자료의 문장을 바꾸면 글자를 올리고(옛 글자는 남기지 않는다) 생성 파일의 V40_GUESS_SET_ID 도 함께 올린다. */
export type GuessSetId = "1";

/** 0 = 세트 자료의 cards[0], 1 = cards[1] (저장 기준 순서). */
export type GuessCard = 0 | 1;
/** null = 고르지 않음(잘 모르겠어요, 제 상황과 안 맞아요, 지금은 넘어갈게요). */
export type GuessPick = GuessCard | null;
export interface GuessSlot {
  readonly self: GuessPick;
  readonly guess: GuessPick;
}
export type GuessSlots = readonly [GuessSlot, GuessSlot, GuessSlot, GuessSlot, GuessSlot, GuessSlot];
export interface GuessAnswers {
  readonly set: GuessSetId;
  readonly slots: GuessSlots;
}

/** 링크를 만들 때 한 사람의 몫: 70자 코드를 푼 답과 그 사람의 짐작(없으면 null). */
export interface GuessedPerson {
  readonly code: DecodedCode;
  readonly guess: GuessAnswers | null;
}

/** 입구가 클라이언트에 넘기는 링크의 짐작: first 는 a(먼저 답한 사람) 옆의 ga, second 는 b 옆의 gb. 없으면 null. */
export interface V40EntryGuess {
  readonly first: GuessAnswers | null;
  readonly second: GuessAnswers | null;
}

export type GuessedShareParse =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | { readonly kind: "partner"; readonly first: DecodedCode; readonly firstGuess: GuessAnswers | null }
  | {
      readonly kind: "both";
      readonly first: DecodedCode;
      readonly second: DecodedCode;
      readonly firstGuess: GuessAnswers | null;
      readonly secondGuess: GuessAnswers | null;
    };

// ---------------------------------------------------------------------------
// 세트 자료의 모양(생성 파일 constants/weddingCodeV40Guess.ts 가 이 타입으로 쓰인다)
// ---------------------------------------------------------------------------

export type GuessEscapeId = "notmine" | "skip" | "unsure";

export interface GuessCardData {
  /** 한 일(요로 끝나는 한 문장). 두 사람 화면의 줄에는 이것만 보인다. */
  readonly act: string;
  /** 그 일의 값(「다만 …」 한 문장). 화면의 카드 글은 act 와 cost 를 공백 하나로 이은 두 문장이다. */
  readonly cost: string;
}

export interface GuessItemData {
  readonly id: string;
  readonly caption: string;
  readonly stem: string;
  readonly cards: readonly [GuessCardData, GuessCardData];
  readonly escapes: { readonly self: readonly GuessEscapeId[]; readonly guess: readonly GuessEscapeId[] };
}

export type GuessSet = readonly [GuessItemData, GuessItemData, GuessItemData, GuessItemData, GuessItemData, GuessItemData];

/** 두 사람 결과 줄 이름표의 꼴 넷: 나 기준을 알면 meGuessedPartner/partnerGuessedMe, 모르면 firstGuessedSecond/secondGuessedFirst. */
export type GuessLineForm = "meGuessedPartner" | "partnerGuessedMe" | "firstGuessedSecond" | "secondGuessedFirst";

export interface GuessRowText {
  /** 방향 소제목(방향별 배치에서만 보인다). */
  readonly subhead: string;
  /** 사실 쪽 행의 이름표(실제로 고른 쪽). */
  readonly actualLabel: string;
  /** 짐작 쪽 행의 이름표(짐작한 쪽). */
  readonly guessLabel: string;
}

export interface GuessTextData {
  readonly title: string;
  readonly intro: string;
  readonly receiverIntro: string;
  readonly skipNote: string;
  readonly prompts: { readonly self: string; readonly guess: string };
  readonly guessNote: string;
  readonly escapeTexts: { readonly notmine: string; readonly skip: string; readonly unsure: string };
  readonly resultBlock: { readonly sub: string; readonly rows: Readonly<Record<GuessLineForm, GuessRowText>> };
  readonly unlistedNote: string;
  readonly tail: string;
  readonly emptyState: string;
  readonly linkNotices: { readonly sendOwn: string; readonly sendCouple: string };
}

/** 세트 장면의 검토 상태. 화면에 나가지 않는 값이고, 사람이 읽은 장면이 없는 동안 humanReviewed 는 false 다. */
export interface GuessReviewData {
  readonly humanReviewed: boolean;
  readonly unreviewedItemIds: readonly string[];
}

/** 두 사람 결과 구역의 배치: byScene = 장면 이름 아래 그 장면의 어긋난 줄(기본), byDirection = 방향 소제목 아래 장면들. */
export type GuessLayout = "byScene" | "byDirection";
