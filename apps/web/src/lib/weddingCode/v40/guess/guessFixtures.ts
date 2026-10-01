/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 시험 표본(빌드 계획 5.7, 트랙 F2).
 *
 * 시험이 쓰는 표본이라 장면 id 나 문장을 한 줄도 적지 않고 개수 여섯과 기호(0 첫째 카드, 1 둘째 카드, null 고르지 않음)만 안다.
 * 세트 자료의 문장이 바뀌어도 이 표본과 링크 코덱 시험은 그대로 돈다. 링크 문자열, 한 글자 대문자 값, 개발 메모 값은 여기에 두지 않는다
 * (골든 값은 시험 파일 안에만 둔다).
 */
import type { GuessAnswers, GuessPick, GuessSlot, GuessSlots } from "./types";

/** [내 고름, 짐작] 여섯 쌍으로 짐작 답을 만든다(세트 글자는 지원하는 글자). */
export function guessAnswers(...pairs: readonly (readonly [GuessPick, GuessPick])[]): GuessAnswers {
  if (pairs.length !== 6) throw new RangeError("장면은 여섯이다");
  const slots = pairs.map(([self, guess]): GuessSlot => ({ self, guess }));
  return { set: "1", slots: slots as unknown as GuessSlots };
}

export interface GuessFixture {
  readonly name: string;
  readonly first: GuessAnswers | null;
  readonly second: GuessAnswers | null;
  /** 두 사람 비교가 낼 어긋난 장면의 색인(세트 순서). 한쪽만 있거나 둘 다 없으면 null(줄을 그리지 않는다). */
  readonly sceneIndexes: readonly number[] | null;
  /** 장면마다 어긋난 방향의 수(1 또는 2). */
  readonly directionCounts: readonly number[] | null;
}

const same = guessAnswers([0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]);
const other = guessAnswers([1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]);

export const GUESS_FIXTURES: readonly GuessFixture[] = [
  // 두 사람이 서로의 고름을 모두 맞게 짐작했다: 나란히 놓을 것이 없다.
  {
    name: "all-same",
    first: guessAnswers([0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]),
    second: guessAnswers([1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0]),
    sceneIndexes: [],
    directionCounts: [],
  },
  // 여섯 장면 모두 두 방향이 어긋났다: 자르지 않고 여섯 장면이 모두 나온다.
  { name: "all-differ", first: same, second: other, sceneIndexes: [0, 1, 2, 3, 4, 5], directionCounts: [2, 2, 2, 2, 2, 2] },
  // 여섯 장면 모두 한 방향(먼저 답한 사람이 짐작한 것)만 어긋났다.
  {
    name: "six-differ",
    first: guessAnswers([0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]),
    second: guessAnswers([0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]),
    sceneIndexes: [0, 1, 2, 3, 4, 5],
    directionCounts: [1, 1, 1, 1, 1, 1],
  },
  // 한쪽만 했다: 아무것도 그리지 않는다.
  { name: "one-sided", first: other, second: null, sceneIndexes: null, directionCounts: null },
  // 둘 다 내 고름만 했다(짐작 없음): 나란히 놓을 것이 없다.
  {
    name: "self-only",
    first: guessAnswers([0, null], [1, null], [0, null], [1, null], [0, null], [1, null]),
    second: guessAnswers([1, null], [0, null], [1, null], [0, null], [1, null], [0, null]),
    sceneIndexes: [],
    directionCounts: [],
  },
  // 내 고름 없이 짐작만 있는 장면(링크의 글자 6, 7)이 있어도 코덱과 비교는 받아들인다.
  {
    name: "guess-only",
    first: guessAnswers([null, 0], [null, 1], [null, null], [null, null], [null, null], [null, null]),
    second: guessAnswers([1, null], [1, null], [0, null], [0, null], [null, null], [null, null]),
    sceneIndexes: [0],
    directionCounts: [1],
  },
];
