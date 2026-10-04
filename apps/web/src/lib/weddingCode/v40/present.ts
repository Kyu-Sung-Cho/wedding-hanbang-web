/**
 * 웨딩코드 4.0 문항 뷰와 화면 답 변환(PresentModule, 설계 3절 형식, 5절 폼 비트, README 3절).
 *
 * 폼 비트 0 이면 은행에 적힌 순서 그대로, 1 이면 화면에서만 순서를 뒤집는다. 저장 상태는 폼 비트와 무관하고
 * 화면 번호를 저장 상태로 바꾸는 곳은 toStored 하나, 저장 상태를 화면 번호로 바꾸는 곳은 fromStored 와 viewPosition 두 곳뿐이다.
 * 뷰와 화면 답에는 극, 값, 키, 세기 정보가 없다. 잘못된 입력은 던지지 않고 null 이나 false 로 답한다.
 */
import {
  V40_BESTWORST_LABELS,
  V40_ESCAPES,
  V40_PAIR_LEVEL_LABELS,
  V40_SPLIT_TOTAL,
  pairCellAccessibleName,
  reactCellAccessibleName,
  reactGroupDescription,
} from "@/constants/weddingCodeV40";
import type {
  BestWorstView,
  ChoiceView,
  EscapeLabels,
  FormBit,
  Item,
  ItemView,
  PairCellView,
  PairView,
  ReactCellView,
  ReactView,
  ResponseValue,
  SelfView,
  SplitView,
  ViewAnswer,
  ViewText,
} from "./types";
import type { PresentModule } from "./contract";
import { bestWorstPairOf, bestWorstStateOf, isStateFor, splitCountsOf, splitStateOf, stateChar, stateIndex } from "./states";
import { itemValue } from "./value";

/** 두 가지 중 고르기와 자기 선택의 6칸(DOM 순서: 위 카드 아주, 꽤, 조금, 아래 카드 조금, 꽤, 아주). 모든 문항이 같아서 한 번만 만든다. */
const PAIR_CELLS: readonly PairCellView[] = Object.freeze(
  [0, 1, 2, 3, 4, 5].map((cell) => {
    const cardIndex: 0 | 1 = cell < 3 ? 0 : 1;
    const level = (cell < 3 ? 3 - cell : cell - 2) as 1 | 2 | 3;
    return Object.freeze({
      cell,
      cardIndex,
      level,
      label: V40_PAIR_LEVEL_LABELS[level - 1],
      accessibleName: pairCellAccessibleName(cardIndex, level),
    });
  }),
);

function escapesOf(): EscapeLabels {
  return { unsure: V40_ESCAPES.unsure, notApplicable: V40_ESCAPES.notApplicable };
}

/** 주어진 문자 배열을 폼 비트에 맞게 뒤집은 새 배열(폼 비트 1 이면 역순). */
function ordered<T>(list: readonly T[], formBit: FormBit): T[] {
  const copy = [...list];
  return formBit === 1 ? copy.reverse() : copy;
}

function viewText(text: string): ViewText {
  return { text };
}

/**
 * 문항 뷰(설계 3절 형식, 5절 폼 비트). 캡션, 앞말, 두 넘기기 이름을 싣고 형식별로 보기를 화면 순서로 늘어놓는다.
 * 극, 세기, 키, highPole, recap 은 뷰에 넣지 않는다.
 */
export function present(item: Item, formBit: FormBit): ItemView {
  const flip = formBit === 1;
  const base = { id: item.id, caption: item.caption, stem: item.stem, escapes: escapesOf() };
  switch (item.fmt) {
    case "pair": {
      const cards = ordered(item.cards, formBit);
      const view: PairView = {
        ...base,
        fmt: "pair",
        kind: item.kind,
        cards: [viewText(cards[0].text), viewText(cards[1].text)],
        cells: PAIR_CELLS,
      };
      return view;
    }
    case "self": {
      const cards = ordered(item.cards, formBit);
      const view: SelfView = {
        ...base,
        fmt: "self",
        cards: [viewText(cards[0].text), viewText(cards[1].text)],
        cells: PAIR_CELLS,
      };
      return view;
    }
    case "react": {
      const ends = flip ? { left: item.ends.right, right: item.ends.left } : { left: item.ends.left, right: item.ends.right };
      const cells: ReactCellView[] = [0, 1, 2, 3, 4].map((cell) => ({
        cell,
        accessibleName: reactCellAccessibleName(cell as 0 | 1 | 2 | 3 | 4, ends.left, ends.right),
      }));
      const view: ReactView = {
        ...base,
        fmt: "react",
        kind: item.kind,
        quote: item.quote ? { speaker: item.quote.speaker, text: item.quote.text } : null,
        question: item.question,
        ends,
        groupDescription: reactGroupDescription(ends.left, ends.right),
        cells,
      };
      return view;
    }
    case "recall":
    case "instant": {
      const view: ChoiceView = {
        ...base,
        fmt: item.fmt,
        options: ordered(item.options, formBit).map((option) => viewText(option.text)),
        noneLabel: item.fmt === "recall" ? V40_ESCAPES.recallNone : null,
      };
      return view;
    }
    case "bestworst": {
      const view: BestWorstView = {
        ...base,
        fmt: "bestworst",
        cards: ordered(item.cards, formBit).map((card) => viewText(card.text)),
        bestLabel: V40_BESTWORST_LABELS.best,
        worstLabel: V40_BESTWORST_LABELS.worst,
        duplicateAnnounce: V40_BESTWORST_LABELS.duplicateAnnounce,
      };
      return view;
    }
    case "split": {
      const [first, second, third] = item.entries;
      const entries: readonly [ViewText, ViewText, ViewText] = flip
        ? [viewText(second.text), viewText(first.text), viewText(third.text)]
        : [viewText(first.text), viewText(second.text), viewText(third.text)];
      const view: SplitView = { ...base, fmt: "split", entries, total: V40_SPLIT_TOTAL };
      return view;
    }
  }
}

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

/**
 * 화면 답이 저장 상태로 바꿀 수 있게 완성됐는가(설계 3절): escape 는 항상, 단일 선택은 범위 안이면,
 * 가장·가장 아닌 것은 서로 다른 0에서 3, 칸 나누기는 세 칸 수가 0 이상 정수이고 합 6 이면 true. 형식이 다르면 false.
 */
export function isViewAnswerComplete(item: Item, answer: ViewAnswer): boolean {
  if (answer === null || typeof answer !== "object") return false;
  if (answer.fmt === "escape") return answer.which === "unsure" || answer.which === "na";
  if (answer.fmt !== item.fmt) return false;
  switch (answer.fmt) {
    case "pair":
    case "self":
      return isInt(answer.cell) && answer.cell >= 0 && answer.cell <= 5;
    case "react":
      return isInt(answer.cell) && answer.cell >= 0 && answer.cell <= 4;
    case "recall":
    case "instant":
      return isInt(answer.option) && answer.option >= 0 && answer.option <= 3;
    case "bestworst":
      return (
        isInt(answer.best) &&
        isInt(answer.worst) &&
        answer.best >= 0 &&
        answer.best <= 3 &&
        answer.worst >= 0 &&
        answer.worst <= 3 &&
        answer.best !== answer.worst
      );
    case "split": {
      const counts: unknown = answer.counts;
      return (
        Array.isArray(counts) &&
        counts.length === 3 &&
        counts.every((count) => isInt(count) && count >= 0) &&
        counts[0] + counts[1] + counts[2] === V40_SPLIT_TOTAL
      );
    }
    default:
      return false;
  }
}

/**
 * 화면 답 -> 저장값(설계 5절, README 3절 폼 비트 표). escape 는 unsure 이면 skip, na 이면 na.
 * 형식이 다르거나 중간 상태이거나 범위 밖이면 null. 그 밖에는 화면 번호를 폼 비트로 되돌려 저장 색인을 만든다.
 */
export function toStored(item: Item, formBit: FormBit, answer: ViewAnswer): ResponseValue | null {
  if (!isViewAnswerComplete(item, answer)) return null;
  if (answer.fmt === "escape") return answer.which === "unsure" ? "skip" : "na";
  const flip = formBit === 1;
  switch (answer.fmt) {
    case "pair":
    case "self":
      return stateChar(flip ? 5 - answer.cell : answer.cell);
    case "react":
      return stateChar(flip ? 4 - answer.cell : answer.cell);
    case "recall":
    case "instant":
      return stateChar(flip ? 3 - answer.option : answer.option);
    case "bestworst": {
      if (answer.best === null || answer.worst === null) return null;
      const best = flip ? 3 - answer.best : answer.best;
      const worst = flip ? 3 - answer.worst : answer.worst;
      return stateChar(bestWorstStateOf(best, worst));
    }
    case "split": {
      const [first, second] = answer.counts;
      const [a, b] = flip ? [second, first] : [first, second];
      return stateChar(splitStateOf(a, b));
    }
    default:
      return null;
  }
}

/** 저장값 -> 화면 답(toStored 의 역, 설계 5절 폼 비트). skip 은 unsure, na 는 na escape. 그 형식에 없는 문자이면 null. */
export function fromStored(item: Item, formBit: FormBit, value: ResponseValue): ViewAnswer | null {
  if (value === "skip") return { fmt: "escape", which: "unsure" };
  if (value === "na") return { fmt: "escape", which: "na" };
  if (!isStateFor(item.fmt, value)) return null;
  const state = stateIndex(value);
  if (state === null) return null;
  const flip = formBit === 1;
  switch (item.fmt) {
    case "pair":
      return { fmt: "pair", cell: flip ? 5 - state : state };
    case "self":
      return { fmt: "self", cell: flip ? 5 - state : state };
    case "react":
      return { fmt: "react", cell: flip ? 4 - state : state };
    case "recall":
    case "instant":
      return { fmt: item.fmt, option: flip ? 3 - state : state };
    case "bestworst": {
      const { best, worst } = bestWorstPairOf(state);
      return { fmt: "bestworst", best: flip ? 3 - best : best, worst: flip ? 3 - worst : worst };
    }
    case "split": {
      const [a, b, c] = splitCountsOf(state);
      return { fmt: "split", counts: flip ? [b, a, c] : [a, b, c] };
    }
    default:
      return null;
  }
}

/**
 * 위치 반복 검사용 화면 위치(설계 5절 주의 검사 1). pair 는 고른 카드가 화면에서 위(0)인지 아래(1)인지(세기는 무시),
 * react 는 화면 칸 0에서 4, recall 과 instant 는 화면 보기 0에서 3. 그 밖의 형식, skip, na, 잘못된 값은 null.
 */
export function viewPosition(item: Item, formBit: FormBit, value: ResponseValue): number | null {
  if (typeof value !== "string" || !isStateFor(item.fmt, value)) return null;
  const state = stateIndex(value);
  if (state === null) return null;
  switch (item.fmt) {
    case "pair": {
      const bankCard = state < 3 ? 0 : 1;
      return formBit === 1 ? 1 - bankCard : bankCard;
    }
    case "react":
      return formBit === 1 ? 4 - state : state;
    case "recall":
    case "instant":
      return formBit === 1 ? 3 - state : state;
    default:
      return null;
  }
}

/**
 * 결과 인용 원문(캡션 없음, 설계 7절 내가 고른 답, README 7절 13항). skip, na, 값이 없는 답, 자기 선택은 null.
 * pair 는 고른 카드 원문(아주면 " (아주 가까워요)"), react 는 앞 구절과 고른 쪽 끝 이름, 고르기는 보기 원문,
 * 가장·아닌 것은 카드 원문을 감싼 한 문장, 칸 나누기는 값이 0 이 아닐 때 고른 극 쪽 항목과 그 칸 수.
 */
export function answerText(item: Item, value: ResponseValue): string | null {
  if (typeof value !== "string" || value === "skip" || value === "na") return null;
  if (!isStateFor(item.fmt, value)) return null;
  const state = stateIndex(value);
  if (state === null) return null;
  switch (item.fmt) {
    case "pair": {
      const card = state < 3 ? item.cards[0] : item.cards[1];
      const level = state < 3 ? 3 - state : state - 2;
      return level === 3 ? `${card.text} (아주 가까워요)` : card.text;
    }
    case "react": {
      if (state === 2) return null;
      const end = state < 2 ? item.ends.left : item.ends.right;
      const near = state === 1 || state === 3 ? " (조금 가까워요)" : "";
      return `${item.recap} ${end}${near}`;
    }
    case "recall":
    case "instant":
      return item.options[state].text;
    case "bestworst": {
      const { best } = bestWorstPairOf(state);
      return `가장 나 같은 것으로 「${item.cards[best].text}」를 골랐어요`;
    }
    case "split": {
      const number = itemValue(item, value);
      if (number === null || number === 0) return null;
      const counts = splitCountsOf(state);
      const wanted = number > 0 ? "front" : "back";
      const index = item.entries.findIndex((entry) => entry.pole === wanted);
      if (index < 0) return null;
      const chunks = counts[index];
      if (chunks === V40_SPLIT_TOTAL) return `여섯 칸을 모두 「${item.entries[index].text}」에 놓았어요`;
      return `${V40_SPLIT_TOTAL}칸 중 ${chunks}칸을 「${item.entries[index].text}」에 놓았어요`;
    }
    default:
      return null;
  }
}

/** answerText 앞에 `${caption}: `을 붙인 문장. answerText 가 null 이면 null(설계 7절). */
export function answerLabel(item: Item, value: ResponseValue): string | null {
  const text = answerText(item, value);
  return text === null ? null : `${item.caption}: ${text}`;
}

/** 이 파일의 함수를 계약(PresentModule)대로 묶은 객체. */
export const presentModule = {
  present,
  toStored,
  fromStored,
  isViewAnswerComplete,
  viewPosition,
  answerText,
  answerLabel,
} satisfies PresentModule;
