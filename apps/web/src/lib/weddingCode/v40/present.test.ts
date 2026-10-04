import { describe, expect, it } from "vitest";
import {
  V40_BESTWORST_LABELS,
  V40_ESCAPES,
  V40_PAIR_LEVEL_LABELS,
  V40_STATE_COUNTS,
  pairCellAccessibleName,
  reactCellAccessibleName,
  reactGroupDescription,
} from "@/constants/weddingCodeV40";
import type {
  BestWorstItem,
  BestWorstView,
  ChoiceView,
  FormBit,
  Item,
  PairItem,
  PairView,
  ReactItem,
  ReactView,
  RecallItem,
  InstantItem,
  SelfItem,
  SelfView,
  SplitItem,
  SplitView,
  ViewAnswer,
} from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { V40_LAYOUT_BY_ID } from "./layout";
import { answerLabel, answerText, fromStored, isViewAnswerComplete, present, presentModule, toStored, viewPosition } from "./present";
import { stateChar } from "./states";
import { itemValue } from "./value";

const bank = WEDDING_CODE_V40_BANK;
const FORMS: readonly FormBit[] = [0, 1];

const sign = (pole: string): number => (pole === "front" ? 1 : pole === "back" ? -1 : 0);

/** 형식마다 가능한 모든 화면 답(완성된 것). */
function allViewAnswers(item: Item): ViewAnswer[] {
  const answers: ViewAnswer[] = [];
  switch (item.fmt) {
    case "pair":
    case "self":
      for (let cell = 0; cell < 6; cell += 1) answers.push({ fmt: item.fmt, cell });
      break;
    case "react":
      for (let cell = 0; cell < 5; cell += 1) answers.push({ fmt: "react", cell });
      break;
    case "recall":
    case "instant":
      for (let option = 0; option < 4; option += 1) answers.push({ fmt: item.fmt, option });
      break;
    case "bestworst":
      for (let best = 0; best < 4; best += 1) for (let worst = 0; worst < 4; worst += 1) if (best !== worst) answers.push({ fmt: "bestworst", best, worst });
      break;
    case "split":
      for (let a = 0; a <= 6; a += 1) for (let b = 0; a + b <= 6; b += 1) answers.push({ fmt: "split", counts: [a, b, 6 - a - b] });
      break;
  }
  return answers;
}

/** 객체 안의 모든 키를 모은다(뷰에 극, 값, 키 정보가 없는지 보는 데 쓴다). */
function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => allKeys(entry, into));
  else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      into.add(key);
      allKeys(entry, into);
    }
  }
  return into;
}

describe("present: 공통", () => {
  it("모든 문항, 두 폼 비트에서 id, 캡션, 앞말, 두 넘기기 이름을 싣는다", () => {
    for (const item of bank.items) {
      for (const formBit of FORMS) {
        const view = present(item, formBit);
        expect(view.id).toBe(item.id);
        expect(view.caption).toBe(item.caption);
        expect(view.stem).toBe(item.stem);
        expect(view.fmt).toBe(item.fmt);
        expect(view.escapes).toEqual({ unsure: V40_ESCAPES.unsure, notApplicable: V40_ESCAPES.notApplicable });
      }
    }
    expect(V40_ESCAPES.unsure).toBe("잘 모르겠어요");
    expect(V40_ESCAPES.notApplicable).toBe("제 상황과 안 맞아요");
  });

  it("뷰에는 극, 세기, 키, 높은 칸, 앞 구절 필드가 없다", () => {
    const forbidden = ["pole", "strength", "key", "highPole", "recap", "facet", "axis", "section", "screen", "value"];
    for (const item of bank.items) {
      for (const formBit of FORMS) {
        const keys = allKeys(present(item, formBit));
        for (const name of forbidden) expect(keys.has(name), `${item.id} 뷰에 ${name} 가 있다`).toBe(false);
      }
    }
  });

  it("입력 문항을 바꾸지 않고 같은 입력에는 같은 뷰를 낸다(순수)", () => {
    for (const item of bank.items) {
      const before = JSON.stringify(item);
      for (const formBit of FORMS) expect(present(item, formBit)).toEqual(present(item, formBit));
      expect(JSON.stringify(item)).toBe(before);
    }
  });
});

describe("present: pair 와 self", () => {
  const pairs = bank.items.filter((item): item is PairItem | SelfItem => item.fmt === "pair" || item.fmt === "self");

  it("폼 비트 0 이면 은행 순서, 1 이면 위아래를 바꾼다", () => {
    expect(pairs).toHaveLength(20);
    for (const item of pairs) {
      const zero = present(item, 0) as PairView | SelfView;
      const one = present(item, 1) as PairView | SelfView;
      expect(zero.cards.map((card) => card.text)).toEqual([item.cards[0].text, item.cards[1].text]);
      expect(one.cards.map((card) => card.text)).toEqual([item.cards[1].text, item.cards[0].text]);
      if (item.fmt === "pair") {
        expect((zero as PairView).kind).toBe(item.kind);
        expect((one as PairView).kind).toBe(item.kind);
      }
    }
  });

  it("6칸은 DOM 순서 위 카드 아주, 꽤, 조금, 아래 카드 조금, 꽤, 아주이고 폼 비트와 무관하다", () => {
    for (const item of pairs) {
      const zero = present(item, 0) as PairView | SelfView;
      const one = present(item, 1) as PairView | SelfView;
      expect(one.cells).toEqual(zero.cells);
      expect(zero.cells.map((cell) => cell.cell)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(zero.cells.map((cell) => cell.cardIndex)).toEqual([0, 0, 0, 1, 1, 1]);
      expect(zero.cells.map((cell) => cell.level)).toEqual([3, 2, 1, 1, 2, 3]);
      expect(zero.cells.map((cell) => cell.label)).toEqual(["아주", "꽤", "조금", "조금", "꽤", "아주"]);
      expect(zero.cells.map((cell) => cell.label)).toEqual([2, 1, 0, 0, 1, 2].map((index) => V40_PAIR_LEVEL_LABELS[index]));
      zero.cells.forEach((cell) => expect(cell.accessibleName).toBe(pairCellAccessibleName(cell.cardIndex, cell.level)));
      expect(zero.cells[0].accessibleName).toBe("위 카드에 아주 가까워요");
      expect(zero.cells[5].accessibleName).toBe("아래 카드에 아주 가까워요");
    }
  });

  it("칸의 보이는 글자에 번호나 A, B 라벨이 없다", () => {
    for (const item of pairs) {
      for (const cell of (present(item, 0) as PairView).cells) expect(cell.label).not.toMatch(/[0-9A-Za-z]/);
    }
  });
});

describe("present: react", () => {
  const reacts = bank.items.filter((item): item is ReactItem => item.fmt === "react");

  it("폼 비트 1 이면 양끝 이름의 자리를 바꾸고 그룹 설명과 칸 이름이 화면 기준이다", () => {
    expect(reacts).toHaveLength(16);
    for (const item of reacts) {
      const zero = present(item, 0) as ReactView;
      const one = present(item, 1) as ReactView;
      expect(zero.ends).toEqual({ left: item.ends.left, right: item.ends.right });
      expect(one.ends).toEqual({ left: item.ends.right, right: item.ends.left });
      for (const view of [zero, one]) {
        expect(view.groupDescription).toBe(reactGroupDescription(view.ends.left, view.ends.right));
        expect(view.cells.map((cell) => cell.cell)).toEqual([0, 1, 2, 3, 4]);
        view.cells.forEach((cell) =>
          expect(cell.accessibleName).toBe(reactCellAccessibleName(cell.cell as 0 | 1 | 2 | 3 | 4, view.ends.left, view.ends.right)),
        );
        expect(view.question).toBe(item.question);
        expect(view.kind).toBe(item.kind);
      }
      expect(zero.cells[0].accessibleName.startsWith(`${item.ends.left}, `)).toBe(true);
      expect(one.cells[0].accessibleName.startsWith(`${item.ends.right}, `)).toBe(true);
    }
  });

  it("낭독 문구는 구현이 쓴 함수가 아니라 글자 그대로 검사한다: 양끝 칸은 그 끝 이름, 안쪽 칸은 위치, 그룹 설명은 왼쪽 끝 다음에 오른쪽 끝", () => {
    for (const item of reacts) {
      for (const formBit of FORMS) {
        const view = present(item, formBit) as ReactView;
        const { left, right } = view.ends;
        expect(view.groupDescription).toBe(`왼쪽 끝은 「${left}」, 오른쪽 끝은 「${right}」예요.`);
        expect(view.cells.map((cell) => cell.accessibleName)).toEqual([
          `${left}, 다섯 칸 중 왼쪽 끝`,
          "다섯 칸 중 왼쪽에서 두 번째",
          "다섯 칸 중 가운데",
          "다섯 칸 중 오른쪽에서 두 번째",
          `${right}, 다섯 칸 중 오른쪽 끝`,
        ]);
      }
    }
  });

  it("인용문이 있으면 화자와 원문을 싣고 없으면 null", () => {
    for (const item of reacts) {
      for (const formBit of FORMS) {
        const view = present(item, formBit) as ReactView;
        if (item.quote) expect(view.quote).toEqual({ speaker: item.quote.speaker, text: item.quote.text });
        else expect(view.quote).toBeNull();
      }
    }
  });
});

describe("present: recall, instant, bestworst, split", () => {
  it("고르기 보기는 폼 비트 1 이면 순서가 뒤집히고 지난 일 떠올리기에만 이런 일이 없었어요 카드가 있다", () => {
    const choices = bank.items.filter((item): item is RecallItem | InstantItem => item.fmt === "recall" || item.fmt === "instant");
    expect(choices).toHaveLength(16);
    for (const item of choices) {
      const zero = present(item, 0) as ChoiceView;
      const one = present(item, 1) as ChoiceView;
      expect(zero.options.map((option) => option.text)).toEqual(item.options.map((option) => option.text));
      expect(one.options.map((option) => option.text)).toEqual([...item.options].reverse().map((option) => option.text));
      // 문구는 상수를 되읽지 않고 글자 그대로 적는다(상수가 바뀌면 이 시험이 알아챈다)
      const expectedNone = item.fmt === "recall" ? "이런 일이 없었어요" : null;
      expect(zero.noneLabel).toBe(expectedNone);
      expect(one.noneLabel).toBe(expectedNone);
    }
    expect(V40_ESCAPES.recallNone).toBe("이런 일이 없었어요");
  });

  it("가장·가장 아닌 것 카드 네 장은 폼 비트 1 이면 역순이고 두 그룹 이름과 낭독 문장을 싣는다", () => {
    const items = bank.items.filter((item): item is BestWorstItem => item.fmt === "bestworst");
    expect(items).toHaveLength(8);
    for (const item of items) {
      const zero = present(item, 0) as BestWorstView;
      const one = present(item, 1) as BestWorstView;
      expect(zero.cards.map((card) => card.text)).toEqual(item.cards.map((card) => card.text));
      expect(one.cards.map((card) => card.text)).toEqual([...item.cards].reverse().map((card) => card.text));
      for (const view of [zero, one]) {
        expect(view.bestLabel).toBe(V40_BESTWORST_LABELS.best);
        expect(view.worstLabel).toBe(V40_BESTWORST_LABELS.worst);
        expect(view.duplicateAnnounce).toBe(V40_BESTWORST_LABELS.duplicateAnnounce);
        // 두 그룹 이름은 상수를 되읽지 않고 글자 그대로 검사한다(이름이 서로 바뀌면 값이 거꾸로 저장된다)
        expect(view.bestLabel).toBe("가장 나 같은 것");
        expect(view.worstLabel).toBe("가장 나 같지 않은 것");
      }
    }
  });

  it("칸 나누기는 폼 비트 1 이면 앞 두 항목만 자리를 바꾸고 세 번째는 그대로이며 합계는 6", () => {
    const items = bank.items.filter((item): item is SplitItem => item.fmt === "split");
    expect(items).toHaveLength(8);
    for (const item of items) {
      const zero = present(item, 0) as SplitView;
      const one = present(item, 1) as SplitView;
      const [a, b, c] = item.entries.map((entry) => entry.text);
      expect(zero.entries.map((entry) => entry.text)).toEqual([a, b, c]);
      expect(one.entries.map((entry) => entry.text)).toEqual([b, a, c]);
      expect(zero.total).toBe(6);
      expect(one.total).toBe(6);
    }
  });
});

describe("화면에 보이는 것이 값을 정한다(뷰와 toStored 의 일관성)", () => {
  /** 화면에 보인 글자로 은행의 카드, 보기, 항목을 찾는다(은행 검사가 한 문항 안의 같은 문구를 막는다). */
  function bankIndexOf(texts: readonly { readonly text: string }[], shown: string): number {
    const found = texts.findIndex((entry) => entry.text === shown);
    expect(found, `화면 글자 ${shown} 를 은행에서 찾지 못했다`).toBeGreaterThanOrEqual(0);
    return found;
  }

  it("pair: 화면 칸이 가리키는 카드와 세기가 값의 부호와 크기를 정한다(두 폼 비트)", () => {
    for (const item of bank.items.filter((entry): entry is PairItem => entry.fmt === "pair")) {
      for (const formBit of FORMS) {
        const view = present(item, formBit) as PairView;
        for (let cell = 0; cell < 6; cell += 1) {
          const stored = toStored(item, formBit, { fmt: "pair", cell });
          expect(stored).not.toBeNull();
          const cardOnScreen = view.cells[cell].cardIndex;
          const card = item.cards[bankIndexOf(item.cards, view.cards[cardOnScreen].text)];
          const level = view.cells[cell].level;
          expect(itemValue(item, stored as string), `${item.id} 폼 ${formBit} 칸 ${cell}`).toBe(2 * level * sign(card.pole));
        }
      }
    }
  });

  it("self: 화면 칸이 가리키는 카드의 방향이 고른 방향이다", () => {
    for (const item of bank.items.filter((entry): entry is SelfItem => entry.fmt === "self")) {
      for (const formBit of FORMS) {
        const view = present(item, formBit) as SelfView;
        for (let cell = 0; cell < 6; cell += 1) {
          const stored = toStored(item, formBit, { fmt: "self", cell }) as string;
          const card = item.cards[bankIndexOf(item.cards, view.cards[view.cells[cell].cardIndex].text)];
          // 저장 색인 0에서 2 는 은행 위 카드, 3에서 5 는 은행 아래 카드
          const bankCard = ["0", "1", "2"].includes(stored) ? item.cards[0] : item.cards[1];
          expect(bankCard.pole, `${item.id} 폼 ${formBit} 칸 ${cell}`).toBe(card.pole);
        }
      }
    }
  });

  it("react: 화면 왼쪽 끝 칸은 화면 왼쪽에 보이는 이름의 마음이고 값의 부호가 그 이름의 극과 같다", () => {
    for (const item of bank.items.filter((entry): entry is ReactItem => entry.fmt === "react")) {
      for (const formBit of FORMS) {
        const view = present(item, formBit) as ReactView;
        const highEndText = item.ends.right; // 은행에서 오른쪽 끝이 높은 칸이 향하는 극(highPole)
        const highSideOnScreen = view.ends.right === highEndText ? "right" : "left";
        for (let cell = 0; cell < 5; cell += 1) {
          const stored = toStored(item, formBit, { fmt: "react", cell }) as string;
          const towardRight = cell - 2; // 화면 오른쪽 방향이 양수
          const towardHigh = highSideOnScreen === "right" ? towardRight : -towardRight;
          const expected = towardHigh * 3 * sign(item.highPole);
          expect(itemValue(item, stored), `${item.id} 폼 ${formBit} 칸 ${cell}`).toBe(expected === 0 ? 0 : expected);
        }
      }
    }
  });

  it("recall 과 instant: 화면 위에서 j 번째 보기를 고르면 그 글자의 보기가 가진 극과 세기의 값이 된다", () => {
    for (const item of bank.items.filter((entry): entry is RecallItem | InstantItem => entry.fmt === "recall" || entry.fmt === "instant")) {
      for (const formBit of FORMS) {
        const view = present(item, formBit) as ChoiceView;
        for (let option = 0; option < 4; option += 1) {
          const stored = toStored(item, formBit, { fmt: item.fmt, option }) as string;
          const shown = item.options[bankIndexOf(item.options, view.options[option].text)];
          expect(itemValue(item, stored), `${item.id} 폼 ${formBit} 보기 ${option}`).toBe(sign(shown.pole) * (shown.strength === "strong" ? 6 : 2));
        }
      }
    }
  });

  it("bestworst: 화면에서 고른 카드의 극이 값을 정한다(가장 +4/-4, 가장 아닌 것 -2/+2)", () => {
    for (const item of bank.items.filter((entry): entry is BestWorstItem => entry.fmt === "bestworst")) {
      for (const formBit of FORMS) {
        const view = present(item, formBit) as BestWorstView;
        for (const answer of allViewAnswers(item)) {
          if (answer.fmt !== "bestworst" || answer.best === null || answer.worst === null) continue;
          const stored = toStored(item, formBit, answer) as string;
          const best = item.cards[bankIndexOf(item.cards, view.cards[answer.best].text)];
          const worst = item.cards[bankIndexOf(item.cards, view.cards[answer.worst].text)];
          expect(itemValue(item, stored), `${item.id} 폼 ${formBit} ${answer.best}/${answer.worst}`).toBe(4 * sign(best.pole) - 2 * sign(worst.pole));
        }
      }
    }
  });

  it("split: 화면 항목에 놓은 칸 수와 그 항목의 극이 값을 정한다(중립은 뺀다)", () => {
    for (const item of bank.items.filter((entry): entry is SplitItem => entry.fmt === "split")) {
      for (const formBit of FORMS) {
        const view = present(item, formBit) as SplitView;
        const poles = view.entries.map((entry) => item.entries[bankIndexOf(item.entries, entry.text)].pole);
        for (const answer of allViewAnswers(item)) {
          if (answer.fmt !== "split") continue;
          const stored = toStored(item, formBit, answer) as string;
          const expected = answer.counts.reduce((sum, count, index) => sum + count * sign(poles[index]), 0);
          expect(itemValue(item, stored), `${item.id} 폼 ${formBit} ${answer.counts.join("/")}`).toBe(expected === 0 ? 0 : expected);
        }
      }
    }
  });
});

describe("toStored 와 fromStored", () => {
  it("모든 문항 x 폼 비트 x 모든 화면 답에서 저장값으로 갔다가 돌아오면 같은 화면 답이다", () => {
    let count = 0;
    for (const item of bank.items) {
      for (const formBit of FORMS) {
        const seenStored = new Set<string>();
        for (const answer of allViewAnswers(item)) {
          const stored = toStored(item, formBit, answer);
          expect(stored, `${item.id} ${JSON.stringify(answer)}`).not.toBeNull();
          expect(fromStored(item, formBit, stored as string)).toEqual(answer);
          seenStored.add(stored as string);
          count += 1;
        }
        // 화면 답과 저장 상태는 일대일이다
        expect(seenStored.size).toBe(V40_STATE_COUNTS[item.fmt]);
      }
    }
    expect(count).toBe(2 * (20 * 6 + 16 * 5 + 16 * 4 + 8 * 12 + 8 * 28));
  });

  it("모든 저장 상태에서 화면 답으로 갔다가 돌아오면 같은 저장값이다", () => {
    for (const item of bank.items) {
      for (const formBit of FORMS) {
        for (let state = 0; state < V40_STATE_COUNTS[item.fmt]; state += 1) {
          const answer = fromStored(item, formBit, stateChar(state));
          expect(answer).not.toBeNull();
          expect(toStored(item, formBit, answer as ViewAnswer)).toBe(stateChar(state));
        }
      }
    }
  });

  it("폼 비트 규칙: pair, self 는 5 - 칸, react 는 4 - 칸, 고르기와 가장·아닌 것은 3 - 번호, 칸 나누기는 앞 두 항목 교환", () => {
    const pair = bank.byId.get("money.limit.1") as PairItem;
    expect(toStored(pair, 0, { fmt: "pair", cell: 1 })).toBe("1");
    expect(toStored(pair, 1, { fmt: "pair", cell: 1 })).toBe("4");
    const react = bank.byId.get("process.search.1") as ReactItem;
    expect(toStored(react, 0, { fmt: "react", cell: 1 })).toBe("1");
    expect(toStored(react, 1, { fmt: "react", cell: 1 })).toBe("3");
    const recall = bank.byId.get("scope.timing.1") as RecallItem;
    expect(toStored(recall, 0, { fmt: "recall", option: 0 })).toBe("0");
    expect(toStored(recall, 1, { fmt: "recall", option: 0 })).toBe("3");
    const instant = bank.byId.get("money.worth.1") as InstantItem;
    expect(toStored(instant, 1, { fmt: "instant", option: 1 })).toBe("2");
    const bestWorst = bank.byId.get("scope.circle.1") as BestWorstItem;
    // 화면 (best 0, worst 1) -> 폼 비트 0: 상태 0, 폼 비트 1: (best 3, worst 2) -> 3 x 3 + 2 = 11
    expect(toStored(bestWorst, 0, { fmt: "bestworst", best: 0, worst: 1 })).toBe("0");
    expect(toStored(bestWorst, 1, { fmt: "bestworst", best: 0, worst: 1 })).toBe(stateChar(11));
    const split = bank.byId.get("support.give.3") as SplitItem;
    // 화면 칸 수 (2, 1, 3): 폼 비트 0 은 (a, b) = (2, 1) 상태 13 + 1 = 14, 폼 비트 1 은 (a, b) = (1, 2) 상태 7 + 2 = 9
    expect(toStored(split, 0, { fmt: "split", counts: [2, 1, 3] })).toBe(stateChar(14));
    expect(toStored(split, 1, { fmt: "split", counts: [2, 1, 3] })).toBe(stateChar(9));
  });

  it("escape 는 unsure 이면 skip, na 이면 na 이고 fromStored 가 되돌린다", () => {
    for (const item of bank.items) {
      for (const formBit of FORMS) {
        expect(toStored(item, formBit, { fmt: "escape", which: "unsure" })).toBe("skip");
        expect(toStored(item, formBit, { fmt: "escape", which: "na" })).toBe("na");
        expect(fromStored(item, formBit, "skip")).toEqual({ fmt: "escape", which: "unsure" });
        expect(fromStored(item, formBit, "na")).toEqual({ fmt: "escape", which: "na" });
      }
    }
  });

  it("다른 형식, 중간 상태, 범위 밖, 정수가 아닌 값, 합이 6 이 아닌 칸 나누기는 null 이고 던지지 않는다", () => {
    const pair = bank.byId.get("money.limit.1") as PairItem;
    const react = bank.byId.get("process.search.1") as ReactItem;
    const recall = bank.byId.get("scope.timing.1") as RecallItem;
    const instant = bank.byId.get("money.worth.1") as InstantItem;
    const bestWorst = bank.byId.get("scope.circle.1") as BestWorstItem;
    const split = bank.byId.get("support.give.3") as SplitItem;
    const self = bank.byId.get("self.money") as SelfItem;
    const cases: [Item, unknown][] = [
      [pair, { fmt: "react", cell: 1 }],
      [pair, { fmt: "self", cell: 1 }],
      [self, { fmt: "pair", cell: 1 }],
      [pair, { fmt: "pair", cell: 6 }],
      [pair, { fmt: "pair", cell: -1 }],
      [pair, { fmt: "pair", cell: 1.5 }],
      [pair, { fmt: "pair", cell: Number.NaN }],
      [pair, { fmt: "pair", cell: "1" }],
      [pair, { fmt: "pair" }],
      [react, { fmt: "react", cell: 5 }],
      [recall, { fmt: "instant", option: 0 }],
      [instant, { fmt: "recall", option: 0 }],
      [recall, { fmt: "recall", option: 4 }],
      [bestWorst, { fmt: "bestworst", best: 1, worst: 1 }],
      [bestWorst, { fmt: "bestworst", best: null, worst: 1 }],
      [bestWorst, { fmt: "bestworst", best: 1, worst: null }],
      [bestWorst, { fmt: "bestworst", best: 4, worst: 1 }],
      [bestWorst, { fmt: "bestworst", best: 0, worst: -1 }],
      [split, { fmt: "split", counts: [2, 2, 1] }],
      [split, { fmt: "split", counts: [2, 2, 3] }],
      [split, { fmt: "split", counts: [-1, 4, 3] }],
      [split, { fmt: "split", counts: [3, 3] }],
      [split, { fmt: "split", counts: [3, 3, 0, 0] }],
      [split, { fmt: "split", counts: [1.5, 2.5, 2] }],
      [split, { fmt: "split", counts: "222" }],
      [split, { fmt: "split" }],
      [pair, { fmt: "escape", which: "later" }],
      [pair, { fmt: "escape" }],
      [pair, { fmt: "nope" }],
      [pair, {}],
      [pair, null],
      [pair, undefined],
      [pair, 3],
      [pair, "pair"],
    ];
    for (const [item, answer] of cases) {
      for (const formBit of FORMS) {
        expect(toStored(item, formBit, answer as ViewAnswer), JSON.stringify(answer)).toBeNull();
        expect(isViewAnswerComplete(item, answer as ViewAnswer), JSON.stringify(answer)).toBe(false);
      }
    }
  });

  it("fromStored 는 그 형식에 없는 문자에서 null 이다", () => {
    for (const item of bank.items) {
      for (const formBit of FORMS) {
        expect(fromStored(item, formBit, stateChar(V40_STATE_COUNTS[item.fmt]))).toBeNull();
        for (const bad of ["-", "_", ".", "", "가", "00"]) expect(fromStored(item, formBit, bad)).toBeNull();
      }
    }
  });
});

describe("isViewAnswerComplete", () => {
  const bestWorst = bank.byId.get("scope.circle.1") as BestWorstItem;
  const split = bank.byId.get("support.give.3") as SplitItem;

  it("가장·가장 아닌 것은 둘을 모두 고르고 서로 달라야 완성이다", () => {
    expect(isViewAnswerComplete(bestWorst, { fmt: "bestworst", best: 0, worst: 3 })).toBe(true);
    expect(isViewAnswerComplete(bestWorst, { fmt: "bestworst", best: null, worst: 3 })).toBe(false);
    expect(isViewAnswerComplete(bestWorst, { fmt: "bestworst", best: 2, worst: null })).toBe(false);
    expect(isViewAnswerComplete(bestWorst, { fmt: "bestworst", best: null, worst: null })).toBe(false);
    expect(isViewAnswerComplete(bestWorst, { fmt: "bestworst", best: 2, worst: 2 })).toBe(false);
  });

  it("칸 나누기는 합이 6 일 때만 완성이다(한 곳에 몰아도 된다)", () => {
    expect(isViewAnswerComplete(split, { fmt: "split", counts: [6, 0, 0] })).toBe(true);
    expect(isViewAnswerComplete(split, { fmt: "split", counts: [0, 0, 6] })).toBe(true);
    expect(isViewAnswerComplete(split, { fmt: "split", counts: [2, 2, 2] })).toBe(true);
    expect(isViewAnswerComplete(split, { fmt: "split", counts: [2, 2, 1] })).toBe(false);
    expect(isViewAnswerComplete(split, { fmt: "split", counts: [0, 0, 0] })).toBe(false);
  });

  it("escape 는 어떤 형식에서도 완성이고 그 밖의 값은 아니다", () => {
    for (const item of bank.items) {
      expect(isViewAnswerComplete(item, { fmt: "escape", which: "unsure" })).toBe(true);
      expect(isViewAnswerComplete(item, { fmt: "escape", which: "na" })).toBe(true);
    }
  });
});

describe("viewPosition", () => {
  it("pair 는 고른 카드가 화면에서 위(0)인지 아래(1)인지, 세기는 무시한다", () => {
    const pair = bank.byId.get("money.limit.1") as PairItem;
    // 은행 위 카드 아주, 꽤, 조금 = 저장 0, 1, 2 / 은행 아래 카드 = 저장 3, 4, 5
    for (const state of [0, 1, 2]) {
      expect(viewPosition(pair, 0, stateChar(state))).toBe(0);
      expect(viewPosition(pair, 1, stateChar(state))).toBe(1);
    }
    for (const state of [3, 4, 5]) {
      expect(viewPosition(pair, 0, stateChar(state))).toBe(1);
      expect(viewPosition(pair, 1, stateChar(state))).toBe(0);
    }
  });

  it("react 는 화면 칸, recall 과 instant 는 화면 보기 번호", () => {
    const react = bank.byId.get("process.search.1") as ReactItem;
    const recall = bank.byId.get("scope.timing.1") as RecallItem;
    const instant = bank.byId.get("money.worth.1") as InstantItem;
    for (let state = 0; state < 5; state += 1) {
      expect(viewPosition(react, 0, stateChar(state))).toBe(state);
      expect(viewPosition(react, 1, stateChar(state))).toBe(4 - state);
    }
    for (let state = 0; state < 4; state += 1) {
      for (const item of [recall, instant]) {
        expect(viewPosition(item, 0, stateChar(state))).toBe(state);
        expect(viewPosition(item, 1, stateChar(state))).toBe(3 - state);
      }
    }
  });

  it("화면 답에서 나온 위치는 화면 답의 번호와 같다(toStored 와 서로 맞물린다)", () => {
    for (const item of bank.items) {
      for (const formBit of FORMS) {
        for (const answer of allViewAnswers(item)) {
          const stored = toStored(item, formBit, answer) as string;
          const position = viewPosition(item, formBit, stored);
          switch (answer.fmt) {
            case "pair":
              expect(position).toBe(answer.cell < 3 ? 0 : 1);
              break;
            case "react":
              expect(position).toBe(answer.cell);
              break;
            case "recall":
            case "instant":
              expect(position).toBe(answer.option);
              break;
            default:
              expect(position).toBeNull();
          }
        }
      }
    }
  });

  it("skip, na, 잘못된 문자, 그 밖의 형식은 null", () => {
    const pair = bank.byId.get("money.limit.1") as PairItem;
    expect(viewPosition(pair, 0, "skip")).toBeNull();
    expect(viewPosition(pair, 0, "na")).toBeNull();
    expect(viewPosition(pair, 0, "9")).toBeNull();
    expect(viewPosition(pair, 0, "-")).toBeNull();
    expect(viewPosition(pair, 0, "")).toBeNull();
    for (const id of ["scope.circle.1", "support.give.3", "self.money"]) {
      const item = bank.byId.get(id) as Item;
      expect(viewPosition(item, 0, "0")).toBeNull();
      expect(viewPosition(item, 1, "1")).toBeNull();
    }
  });
});

describe("answerText 와 answerLabel", () => {
  it("skip, na, 잘못된 문자는 null 이고 자기 선택은 언제나 null", () => {
    for (const item of bank.items) {
      expect(answerText(item, "skip")).toBeNull();
      expect(answerText(item, "na")).toBeNull();
      expect(answerLabel(item, "skip")).toBeNull();
      expect(answerText(item, stateChar(V40_STATE_COUNTS[item.fmt]))).toBeNull();
      expect(answerText(item, "-")).toBeNull();
    }
    for (const item of bank.self) {
      for (let state = 0; state < 6; state += 1) expect(answerText(item, stateChar(state))).toBeNull();
    }
  });

  it("pair: 고른 카드 원문이고 아주(가장 바깥 칸)일 때만 뒤에 아주 가까워요가 붙는다", () => {
    for (const item of bank.items.filter((entry): entry is PairItem => entry.fmt === "pair")) {
      expect(answerText(item, "0")).toBe(`${item.cards[0].text} (아주 가까워요)`);
      expect(answerText(item, "1")).toBe(item.cards[0].text);
      expect(answerText(item, "2")).toBe(item.cards[0].text);
      expect(answerText(item, "3")).toBe(item.cards[1].text);
      expect(answerText(item, "4")).toBe(item.cards[1].text);
      expect(answerText(item, "5")).toBe(`${item.cards[1].text} (아주 가까워요)`);
    }
  });

  it("react: 앞 구절과 고른 쪽 끝 이름, 안쪽 칸은 조금 가까워요가 붙고 가운데 칸은 null", () => {
    for (const item of bank.items.filter((entry): entry is ReactItem => entry.fmt === "react")) {
      expect(answerText(item, "0")).toBe(`${item.recap} ${item.ends.left}`);
      expect(answerText(item, "1")).toBe(`${item.recap} ${item.ends.left} (조금 가까워요)`);
      expect(answerText(item, "2")).toBeNull();
      expect(answerText(item, "3")).toBe(`${item.recap} ${item.ends.right} (조금 가까워요)`);
      expect(answerText(item, "4")).toBe(`${item.recap} ${item.ends.right}`);
    }
  });

  it("recall 과 instant: 고른 보기 원문", () => {
    for (const item of bank.items.filter((entry): entry is RecallItem | InstantItem => entry.fmt === "recall" || entry.fmt === "instant")) {
      for (let state = 0; state < 4; state += 1) expect(answerText(item, stateChar(state))).toBe(item.options[state].text);
    }
  });

  it("bestworst: 가장 나 같은 것 카드를 감싼 한 문장", () => {
    for (const item of bank.items.filter((entry): entry is BestWorstItem => entry.fmt === "bestworst")) {
      let state = 0;
      for (let best = 0; best < 4; best += 1) {
        for (let worst = 0; worst < 4; worst += 1) {
          if (best === worst) continue;
          expect(answerText(item, stateChar(state))).toBe(`가장 나 같은 것으로 「${item.cards[best].text}」를 골랐어요`);
          state += 1;
        }
      }
    }
  });

  it("split: 값이 0 이면 null, 아니면 값의 부호 쪽 항목과 그 칸 수", () => {
    for (const item of bank.items.filter((entry): entry is SplitItem => entry.fmt === "split")) {
      let state = 0;
      for (let a = 0; a <= 6; a += 1) {
        for (let b = 0; a + b <= 6; b += 1) {
          const counts = [a, b, 6 - a - b];
          const value = counts.reduce((sum, count, index) => sum + count * sign(item.entries[index].pole), 0);
          const text = answerText(item, stateChar(state));
          if (value === 0) expect(text).toBeNull();
          else {
            const index = item.entries.findIndex((entry) => entry.pole === (value > 0 ? "front" : "back"));
            expect(text).toBe(`6칸 중 ${counts[index]}칸을 「${item.entries[index].text}」에 놓았어요`);
          }
          state += 1;
        }
      }
    }
  });

  it("answerLabel 은 캡션과 콜론 뒤에 answerText 를 붙인다", () => {
    for (const item of bank.scored) {
      for (let state = 0; state < V40_STATE_COUNTS[item.fmt]; state += 1) {
        const text = answerText(item, stateChar(state));
        const label = answerLabel(item, stateChar(state));
        if (text === null) expect(label).toBeNull();
        else expect(label).toBe(`${item.caption}: ${text}`);
      }
    }
  });

  it("인용 원문은 값이 0 이 아닌 답에서만 나온다(0 인 답은 인용하지 않는다)", () => {
    for (const item of bank.scored) {
      for (let state = 0; state < V40_STATE_COUNTS[item.fmt]; state += 1) {
        const value = itemValue(item, stateChar(state));
        if (value === 0) expect(answerText(item, stateChar(state)), `${item.id} ${state}`).toBeNull();
        else expect(answerText(item, stateChar(state)), `${item.id} ${state}`).not.toBeNull();
      }
    }
  });
});

describe("계약 묶음", () => {
  it("presentModule 은 계약의 함수 일곱 개를 가진다", () => {
    expect(Object.keys(presentModule).sort()).toEqual(
      ["answerLabel", "answerText", "fromStored", "isViewAnswerComplete", "present", "toStored", "viewPosition"].sort(),
    );
  });

  it("배치 골격의 키와 은행이 맞는다(시험 가정)", () => {
    for (const item of bank.items) expect(V40_LAYOUT_BY_ID.get(item.id)?.key).toBe(item.key);
  });
});
