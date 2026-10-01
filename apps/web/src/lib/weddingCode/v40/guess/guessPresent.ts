/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 장면 한 개를 화면으로 바꾸는 도우미(빌드 계획 5.5, 트랙 F2).
 *
 * 카드 위아래는 **내 폼 비트를 따른다**: 폼 비트 1 이면 둘째 카드가 위에 온다(첫째 카드가 늘 위인 자리 편향을 없앤다). 한 장면의 두 물음은 같은 순서다.
 * 저장은 카드 기준(첫째 0, 둘째 1)이다. 화면 번호를 저장 카드로 바꾸는 곳은 storedPickOf, 저장 카드를 화면 번호로 바꾸는 곳은 screenOptionOf 한 쌍뿐이고
 * 둘은 서로의 역이다(질문 은행의 present.toStored 와 같은 원칙).
 *
 * 카드에 쓸 글은 한 일(act)과 값(cost)을 공백 하나로 이은 두 문장이다. 두 사람 화면의 줄에는 한 일(act)만 보인다(값을 넣으면 상대의 성질을 말하는 줄로 읽힌다).
 * 입력은 카드 둘에만 기존 ChoiceInput 을 재사용한다: 장면을 ChoiceView(그때 나는 형식, 보기 둘, 이런 일이 없었어요 카드 없음)로 바꿔 넘긴다.
 */
import type { ChoiceView, EscapeLabels, FormBit, ViewAnswer } from "../types";
import type { GuessCard, GuessCardData, GuessItemData, GuessPick } from "./types";

/** 저장 카드 -> 화면 번호(위가 0). 폼 비트 1 이면 위아래가 뒤집힌다. */
export function screenOptionOf(formBit: FormBit, card: GuessCard): 0 | 1 {
  const flipped = formBit === 1;
  if (card === 0) return flipped ? 1 : 0;
  return flipped ? 0 : 1;
}

/** 화면 번호(위가 0) -> 저장 카드. 0, 1 이 아닌 번호는 null. screenOptionOf 의 역이다. */
export function storedPickOf(formBit: FormBit, screenOption: number): GuessCard | null {
  if (screenOption !== 0 && screenOption !== 1) return null;
  const flipped = formBit === 1;
  if (screenOption === 0) return flipped ? 1 : 0;
  return flipped ? 0 : 1;
}

/** 화면의 카드 글: 한 일 + 공백 하나 + 값. */
export function cardText(card: GuessCardData): string {
  return `${card.act} ${card.cost}`;
}

/** 두 사람 화면의 줄에 보이는 카드 글: 한 일만. */
export function cardAct(item: GuessItemData, card: GuessCard): string {
  return item.cards[card].act;
}

/** 장면 하나를 보기 둘짜리 고르기 뷰로 바꾼다. 보기 순서는 폼 비트를 반영한 화면 순서이고, 카드에는 번호도 라벨도 없다. */
export function guessChoiceView(item: GuessItemData, formBit: FormBit, escapes: EscapeLabels): ChoiceView {
  const ordered = formBit === 1 ? [item.cards[1], item.cards[0]] : [item.cards[0], item.cards[1]];
  return {
    id: item.id,
    caption: item.caption,
    stem: item.stem,
    escapes,
    fmt: "instant",
    options: [{ text: cardText(ordered[0]) }, { text: cardText(ordered[1]) }],
    noneLabel: null,
  };
}

/** 저장 카드를 입력 컴포넌트가 받는 화면 답으로. 고르지 않았으면 null. */
export function choiceAnswerOf(formBit: FormBit, pick: GuessPick): ViewAnswer | null {
  if (pick === null) return null;
  return { fmt: "instant", option: screenOptionOf(formBit, pick) };
}
