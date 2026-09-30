/**
 * 웨딩코드 4.0 문항 값(ValueModule, 설계 5절 문항값).
 *
 * 값은 카드, 보기, 항목의 극(pole) 필드에서 계산하며 key 필드는 읽지 않는다(key 는 은행 검사가 극 배열과 대조한다).
 * 부호 규칙: 정수 -6에서 +6, 양수는 앞극(front) 쪽. 건너뜀, 해당 없음, 없음, 그 형식에 없는 문자는 null 이며 0 으로 세지 않는다.
 * 정수만 쓴다. 값 0 은 언제나 +0 이다(-0 을 만들지 않는다).
 */
import { V40_STATE_COUNTS } from "@/constants/weddingCodeV40";
import type { Pole, ResponseValue, ScoredItem, SelfItem, Side } from "./types";
import type { ValueModule } from "./contract";
import { bestWorstPairOf, splitCountsOf, stateIndex } from "./states";

/** 극의 부호: front +1, back -1, neutral(칸 나누기 중립) 0. */
function poleSign(pole: Pole): -1 | 0 | 1 {
  return pole === "front" ? 1 : pole === "back" ? -1 : 0;
}

/** 값 0 을 +0 으로 고친다. */
function plain(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * 상태 색인 s 의 문항 값(설계 5절 문항값, README 3절 표). 채점 문항만 받는다.
 * s 는 그 형식의 상태 수 안의 정수여야 하며 호출자가 미리 확인한다(itemValue 가 확인한다).
 */
export function stateValue(item: ScoredItem, state: number): number {
  switch (item.fmt) {
    case "pair": {
      const card = state < 3 ? item.cards[0] : item.cards[1];
      const level = state < 3 ? 3 - state : state - 2;
      return plain(2 * level * poleSign(card.pole));
    }
    case "react":
      return plain((state - 2) * 3 * poleSign(item.highPole));
    case "recall":
    case "instant": {
      const option = item.options[state];
      return plain(poleSign(option.pole) * (option.strength === "strong" ? 6 : 2));
    }
    case "bestworst": {
      const { best, worst } = bestWorstPairOf(state);
      return plain(4 * poleSign(item.cards[best].pole) - 2 * poleSign(item.cards[worst].pole));
    }
    case "split": {
      const counts = splitCountsOf(state);
      return plain(counts.reduce((sum, count, index) => sum + count * poleSign(item.entries[index].pole), 0));
    }
  }
}

/** 채점 문항의 정수 값(-6에서 +6, 양수는 앞극). 빠진 값과 잘못된 저장값은 null. 설계 5절 문항값. */
export function itemValue(item: ScoredItem, value: ResponseValue | undefined): number | null {
  if ((item.fmt as string) === "self") return null;
  if (typeof value !== "string" || value === "skip" || value === "na") return null;
  const state = stateIndex(value);
  if (state === null || state >= V40_STATE_COUNTS[item.fmt]) return null;
  return stateValue(item, state);
}

/** 자기 선택의 고른 방향과 세기(1 조금, 2 꽤, 3 아주). 빠진 값과 잘못된 저장값은 null. 설계 3절 자기 선택. */
export function selfChoice(item: SelfItem, value: ResponseValue | undefined): { readonly side: Side; readonly level: 1 | 2 | 3 } | null {
  if (item.fmt !== "self") return null;
  if (typeof value !== "string" || value === "skip" || value === "na") return null;
  const state = stateIndex(value);
  if (state === null || state >= V40_STATE_COUNTS.self) return null;
  const card = state < 3 ? item.cards[0] : item.cards[1];
  const level = (state < 3 ? 3 - state : state - 2) as 1 | 2 | 3;
  return { side: card.pole, level };
}

/** 이 파일의 함수를 계약(ValueModule)대로 묶은 객체. */
export const valueModule = { itemValue, selfChoice } satisfies ValueModule;
