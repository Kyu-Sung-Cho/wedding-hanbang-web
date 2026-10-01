/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 두 사람 비교(빌드 계획 5.4, 트랙 F2).
 *
 * 두 사람의 짐작과 고름에서 **짐작한 쪽과 상대가 실제로 고른 쪽이 다른 장면**만 줄로 만든다. 같거나, 어느 한쪽이 고르지 않았으면(잘 모르겠어요, 제 상황과
 * 안 맞아요, 지금은 넘어갈게요) 줄이 없다. 누가 맞혔는지, 몇 개 맞았는지, 몇 개 중인지는 어디에도 세지 않는다.
 *
 * 자르지 않는다. 장면이 여섯이라 방향마다 최대 여섯, 장면마다 최대 두 방향이고 화면이 길어지지 않는다. 방향별 세 줄 상한은 없앴다:
 * 넷 이상 어긋나면 조용히 불완전해지고 어느 줄을 뽑을지가 임의가 된다.
 * 줄은 장면(세트 순서)으로 묶어 낸다. 한 장면 안의 줄 순서는 firstGuessedSecond, secondGuessedFirst 이고 화면이 나 기준에 따라 순서를 바꿔 그린다.
 *
 * 한쪽 사람의 짐작만 있으면 oneSided 이고 화면은 아무것도 그리지 않는다(none 과 같다): 누가 건너뛰었는지 흔적을 남기지 않는다.
 * 고른 것이 하나도 없는 값(모양만 있는 GuessAnswers)은 없는 것으로 본다.
 */
import { V40_GUESS_SLOT_COUNT } from "./types";
import type { GuessAnswers, GuessCard } from "./types";
import { hasGuessInfo } from "./guessLink";

export type GuessLineDirection = "firstGuessedSecond" | "secondGuessedFirst";

export interface GuessDiff {
  readonly direction: GuessLineDirection;
  /** 짐작한 카드. */
  readonly guessed: GuessCard;
  /** 상대가 실제로 고른 카드. */
  readonly actual: GuessCard;
}

/** 어긋난 줄이 있는 장면 하나: 장면 색인(세트 순서)과 그 장면의 어긋난 방향(1에서 2개). */
export interface GuessScene {
  readonly index: number;
  readonly diffs: readonly GuessDiff[];
}

export type GuessComparison =
  | { readonly kind: "none" }
  | { readonly kind: "oneSided" }
  | { readonly kind: "both"; readonly scenes: readonly GuessScene[] };

/**
 * 첫 사람(first)과 둘째 사람(second)의 짐작을 견준다.
 * 둘 다 없으면 none, 한 사람만 있으면 oneSided, 둘 다 있으면 both(scenes 가 비면 나란히 놓을 것이 없다).
 * firstGuessedSecond 는 first 의 짐작과 second 의 고름이 둘 다 카드이고 서로 다른 장면, secondGuessedFirst 는 그 반대 방향이다.
 */
export function compareGuesses(first: GuessAnswers | null, second: GuessAnswers | null): GuessComparison {
  const a = hasGuessInfo(first) ? first : null;
  const b = hasGuessInfo(second) ? second : null;
  if (a === null && b === null) return { kind: "none" };
  if (a === null || b === null) return { kind: "oneSided" };
  const scenes: GuessScene[] = [];
  for (let index = 0; index < V40_GUESS_SLOT_COUNT; index += 1) {
    const mine = a.slots[index];
    const theirs = b.slots[index];
    const diffs: GuessDiff[] = [];
    if (mine.guess !== null && theirs.self !== null && mine.guess !== theirs.self) {
      diffs.push({ direction: "firstGuessedSecond", guessed: mine.guess, actual: theirs.self });
    }
    if (theirs.guess !== null && mine.self !== null && theirs.guess !== mine.self) {
      diffs.push({ direction: "secondGuessedFirst", guessed: theirs.guess, actual: mine.self });
    }
    if (diffs.length > 0) scenes.push({ index, diffs });
  }
  return { kind: "both", scenes };
}
