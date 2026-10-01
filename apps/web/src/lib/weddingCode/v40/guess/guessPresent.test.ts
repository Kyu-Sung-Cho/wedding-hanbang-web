import { describe, expect, it } from "vitest";
import { V40_GUESS_SET } from "@/constants/weddingCodeV40Guess";
import type { EscapeLabels, FormBit } from "../types";
import { cardAct, cardText, choiceAnswerOf, guessChoiceView, screenOptionOf, storedPickOf } from "./guessPresent";
import type { GuessCard, GuessItemData } from "./types";

const BITS: readonly FormBit[] = [0, 1];
const CARDS: readonly GuessCard[] = [0, 1];
const ESCAPES: EscapeLabels = { unsure: "모름", notApplicable: "해당 없음" };

/** 세트 문장에 기대지 않는 표본 장면(시험이 장면 글을 적지 않는다). */
const SAMPLE: GuessItemData = {
  id: "sample.scene",
  caption: "표본 이름",
  stem: "표본 장면 글이에요. 비슷한 일이면 괜찮아요.",
  cards: [
    { act: "첫째 카드의 한 일이에요.", cost: "다만 첫째 카드의 값이 있어요." },
    { act: "둘째 카드의 한 일이에요.", cost: "다만 둘째 카드의 값이 있어요." },
  ],
  escapes: { self: ["notmine", "skip"], guess: ["unsure"] },
};

describe("저장 카드와 화면 번호의 한 쌍(유일한 변환기)", () => {
  it("폼 비트 0 이면 카드 순서 그대로, 폼 비트 1 이면 위아래가 뒤집힌다", () => {
    expect(screenOptionOf(0, 0)).toBe(0);
    expect(screenOptionOf(0, 1)).toBe(1);
    expect(screenOptionOf(1, 0)).toBe(1);
    expect(screenOptionOf(1, 1)).toBe(0);
    expect(storedPickOf(0, 0)).toBe(0);
    expect(storedPickOf(0, 1)).toBe(1);
    expect(storedPickOf(1, 0)).toBe(1);
    expect(storedPickOf(1, 1)).toBe(0);
  });

  it("폼 비트 둘 x 카드 둘 전수: 화면 번호로 갔다 돌아오면 같은 카드이고 둘은 서로의 역이다", () => {
    for (const bit of BITS) {
      for (const card of CARDS) {
        expect(storedPickOf(bit, screenOptionOf(bit, card)), `${bit}:${card}`).toBe(card);
      }
      for (const option of [0, 1]) {
        const card = storedPickOf(bit, option) as GuessCard;
        expect(screenOptionOf(bit, card), `${bit}:${option}`).toBe(option);
      }
    }
  });

  it("범위 밖 화면 번호는 null 이다", () => {
    for (const bit of BITS) {
      for (const option of [-1, 2, 3, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "0" as unknown as number]) {
        expect(storedPickOf(bit, option), `${bit}:${String(option)}`).toBeNull();
      }
    }
  });
});

describe("guessChoiceView: 장면 하나를 보기 둘짜리 고르기 뷰로", () => {
  it("폼 비트 0 은 첫째 카드가 위, 폼 비트 1 은 둘째 카드가 위다. 보기 글은 한 일과 값을 공백 하나로 이은 두 문장이다", () => {
    const upright = guessChoiceView(SAMPLE, 0, ESCAPES);
    const flipped = guessChoiceView(SAMPLE, 1, ESCAPES);
    expect(upright.options.map((option) => option.text)).toEqual([cardText(SAMPLE.cards[0]), cardText(SAMPLE.cards[1])]);
    expect(flipped.options.map((option) => option.text)).toEqual([cardText(SAMPLE.cards[1]), cardText(SAMPLE.cards[0])]);
    expect(cardText(SAMPLE.cards[0])).toBe("첫째 카드의 한 일이에요. 다만 첫째 카드의 값이 있어요.");
  });

  it("뷰의 모양: 그때 나는 형식, 보기 둘, 이런 일이 없었어요 카드 없음, 이름과 글과 탈출구 이름을 그대로 싣는다", () => {
    for (const bit of BITS) {
      const view = guessChoiceView(SAMPLE, bit, ESCAPES);
      expect(view.fmt).toBe("instant");
      expect(view.options).toHaveLength(2);
      expect(view.noneLabel).toBeNull();
      expect(view.id).toBe(SAMPLE.id);
      expect(view.caption).toBe(SAMPLE.caption);
      expect(view.stem).toBe(SAMPLE.stem);
      expect(view.escapes).toEqual(ESCAPES);
    }
  });

  it("카드 위아래가 폼 비트를 따르고 저장 카드로 되돌린 번호가 화면 위치와 맞는다(실제 세트 장면 전부 x 폼 비트 둘)", () => {
    expect(V40_GUESS_SET).toHaveLength(6);
    for (const item of V40_GUESS_SET) {
      for (const bit of BITS) {
        const view = guessChoiceView(item, bit, ESCAPES);
        for (const card of CARDS) {
          const screenOption = screenOptionOf(bit, card);
          expect(view.options[screenOption].text, `${item.id} ${bit}:${card}`).toBe(cardText(item.cards[card]));
        }
      }
    }
  });

  it("한 장면의 두 물음은 같은 순서다: 같은 폼 비트에서 같은 카드가 같은 위치에 온다", () => {
    for (const bit of BITS) {
      const a = guessChoiceView(SAMPLE, bit, ESCAPES);
      const b = guessChoiceView(SAMPLE, bit, ESCAPES);
      expect(a.options).toEqual(b.options);
    }
  });
});

describe("choiceAnswerOf: 저장 카드를 입력 컴포넌트의 화면 답으로", () => {
  it("고르지 않았으면 null 이고, 고른 카드는 화면 위치(번호)로 알린다", () => {
    for (const bit of BITS) {
      expect(choiceAnswerOf(bit, null)).toBeNull();
      for (const card of CARDS) {
        const answer = choiceAnswerOf(bit, card);
        expect(answer).toEqual({ fmt: "instant", option: screenOptionOf(bit, card) });
        if (answer?.fmt === "instant") expect(storedPickOf(bit, answer.option)).toBe(card);
      }
    }
  });
});

describe("카드 글", () => {
  it("두 사람 화면의 줄에는 한 일만 보이고 값은 보이지 않는다", () => {
    for (const card of CARDS) {
      expect(cardAct(SAMPLE, card)).toBe(SAMPLE.cards[card].act);
      expect(cardAct(SAMPLE, card)).not.toContain(SAMPLE.cards[card].cost);
    }
  });

  it("실제 세트의 모든 카드 글에는 번호, 인용 부호, 라벨이 없다", () => {
    for (const item of V40_GUESS_SET) {
      for (const card of item.cards) {
        for (const text of [card.act, card.cost, cardText(card)]) {
          expect(text, item.id).not.toMatch(/[0-9「」"'`]/u);
          expect(text, item.id).not.toMatch(/^[A-Za-z가나다]\s*[.)]/u);
        }
      }
    }
  });
});
