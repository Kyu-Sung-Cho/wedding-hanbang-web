import { describe, expect, it } from "vitest";
import { GUESS_FIXTURES, guessAnswers } from "./guessFixtures";
import { compareGuesses, type GuessComparison, type GuessDiff } from "./guessCompare";
import { V40_GUESS_SLOT_COUNT, type GuessAnswers, type GuessPick } from "./types";

/** 기호 0, 1, 2(고르지 않음) 표기. */
const pick = (value: number): GuessPick => (value === 2 ? null : (value as GuessPick));
function answers(...pairs: readonly (readonly [number, number])[]): GuessAnswers {
  return guessAnswers(...pairs.map(([self, guess]): readonly [GuessPick, GuessPick] => [pick(self), pick(guess)]));
}
const blank = [[2, 2], [2, 2], [2, 2], [2, 2], [2, 2], [2, 2]] as const;
/** 한 장면만 값을 주고 나머지는 고르지 않은 답. */
function onlyScene(index: number, self: number, guess: number): GuessAnswers {
  return answers(...blank.map((pair, at): readonly [number, number] => (at === index ? [self, guess] : pair)));
}
function scenesOf(comparison: GuessComparison) {
  if (comparison.kind !== "both") throw new Error(`both 가 아니다: ${comparison.kind}`);
  return comparison.scenes;
}

describe("compareGuesses: 종류", () => {
  it("둘 다 없으면 none, 한 사람만 있으면 oneSided, 둘 다 있으면 both 다", () => {
    const some = onlyScene(0, 0, 1);
    expect(compareGuesses(null, null)).toEqual({ kind: "none" });
    expect(compareGuesses(some, null)).toEqual({ kind: "oneSided" });
    expect(compareGuesses(null, some)).toEqual({ kind: "oneSided" });
    expect(compareGuesses(some, some).kind).toBe("both");
  });

  it("고른 것이 하나도 없는 값은 없는 것으로 본다(모양만 있는 GuessAnswers)", () => {
    const empty = answers(...blank);
    const some = onlyScene(2, 1, 0);
    expect(compareGuesses(empty, empty)).toEqual({ kind: "none" });
    expect(compareGuesses(empty, null)).toEqual({ kind: "none" });
    expect(compareGuesses(empty, some)).toEqual({ kind: "oneSided" });
    expect(compareGuesses(some, empty)).toEqual({ kind: "oneSided" });
  });

  it("고정 표본 여섯: 종류, 어긋난 장면의 색인, 장면마다 방향 수가 기대와 같다", () => {
    expect(GUESS_FIXTURES.map((fixture) => fixture.name)).toEqual(["all-same", "all-differ", "six-differ", "one-sided", "self-only", "guess-only"]);
    for (const fixture of GUESS_FIXTURES) {
      const result = compareGuesses(fixture.first, fixture.second);
      if (fixture.sceneIndexes === null) {
        expect(result.kind, fixture.name).toBe(fixture.first !== null && fixture.second !== null ? "none" : "oneSided");
        continue;
      }
      expect(result.kind, fixture.name).toBe("both");
      const scenes = scenesOf(result);
      expect(scenes.map((scene) => scene.index), fixture.name).toEqual(fixture.sceneIndexes);
      expect(scenes.map((scene) => scene.diffs.length), fixture.name).toEqual(fixture.directionCounts);
    }
  });
});

describe("compareGuesses: 방향과 줄", () => {
  it("firstGuessedSecond 는 first 의 짐작과 second 의 고름이 둘 다 카드이고 다를 때다", () => {
    const first = onlyScene(0, 0, 1);
    const second = onlyScene(0, 0, 2);
    const scenes = scenesOf(compareGuesses(first, second));
    expect(scenes).toEqual([{ index: 0, diffs: [{ direction: "firstGuessedSecond", guessed: 1, actual: 0 }] }]);
  });

  it("secondGuessedFirst 는 반대 방향이다", () => {
    const first = onlyScene(3, 1, 2);
    const second = onlyScene(3, 2, 0);
    const scenes = scenesOf(compareGuesses(first, second));
    expect(scenes).toEqual([{ index: 3, diffs: [{ direction: "secondGuessedFirst", guessed: 0, actual: 1 }] }]);
  });

  it("같은 카드이거나 한쪽이 고르지 않았으면(탈출구) 줄이 없다", () => {
    for (let index = 0; index < V40_GUESS_SLOT_COUNT; index += 1) {
      // 그 장면 밖에 고른 것이 하나 있어야 둘 다 있는 것으로 읽힌다(고른 것이 하나도 없는 값은 없는 것으로 본다).
      const other = (index + 1) % V40_GUESS_SLOT_COUNT;
      const elsewhere = (self: number, guess: number) =>
        answers(...blank.map((pair, at): readonly [number, number] => (at === other ? [self, guess] : pair)));
      const withElsewhere = (target: GuessAnswers, self: number, guess: number) =>
        answers(...target.slots.map((slot, at): readonly [number, number] => (at === other ? [self, guess] : [slot.self ?? 2, slot.guess ?? 2])));
      // 같은 카드
      expect(scenesOf(compareGuesses(withElsewhere(onlyScene(index, 0, 1), 0, 2), withElsewhere(onlyScene(index, 1, 0), 0, 2)))).toEqual([]);
      // first 가 짐작하지 않음, second 가 고르지 않음(제 상황과 안 맞아요, 지금은 넘어갈게요)
      expect(scenesOf(compareGuesses(withElsewhere(onlyScene(index, 0, 2), 0, 2), elsewhere(0, 2)))).toEqual([]);
      // first 의 짐작은 있지만 second 가 고르지 않음
      expect(scenesOf(compareGuesses(withElsewhere(onlyScene(index, 0, 1), 0, 2), elsewhere(0, 2)))).toEqual([]);
      // second 의 고름은 있지만 first 가 짐작하지 않음
      expect(scenesOf(compareGuesses(withElsewhere(onlyScene(index, 0, 2), 0, 2), withElsewhere(onlyScene(index, 1, 0), 0, 2)))).toEqual([]);
    }
  });

  it("두 방향이 모두 어긋난 장면은 한 장면 안에 firstGuessedSecond, secondGuessedFirst 순서로 둘이다", () => {
    const first = onlyScene(1, 0, 0);
    const second = onlyScene(1, 1, 1);
    expect(scenesOf(compareGuesses(first, second))).toEqual([
      {
        index: 1,
        diffs: [
          { direction: "firstGuessedSecond", guessed: 0, actual: 1 },
          { direction: "secondGuessedFirst", guessed: 1, actual: 0 },
        ],
      },
    ]);
  });

  it("장면은 세트 순서(색인 오름차순)로 나온다", () => {
    const first = answers([0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]);
    const second = answers([0, 2], [0, 2], [0, 2], [0, 2], [0, 2], [0, 2]);
    expect(scenesOf(compareGuesses(first, second)).map((scene) => scene.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("자르지 않는다: 여섯 장면이 모두 어긋나면 장면 여섯 블록과 줄 열둘이 모두 나온다", () => {
    const all = GUESS_FIXTURES.find((fixture) => fixture.name === "all-differ");
    expect(all).toBeDefined();
    const scenes = scenesOf(compareGuesses((all as { first: GuessAnswers }).first, (all as { second: GuessAnswers }).second));
    expect(scenes).toHaveLength(6);
    expect(scenes.flatMap((scene) => scene.diffs)).toHaveLength(12);
    const oneWay = GUESS_FIXTURES.find((fixture) => fixture.name === "six-differ") as { first: GuessAnswers; second: GuessAnswers };
    expect(scenesOf(compareGuesses(oneWay.first, oneWay.second)).flatMap((scene) => scene.diffs)).toHaveLength(6);
  });

  it("누가 맞혔는지, 개수, 점수에 해당하는 필드가 결과에 없다", () => {
    const all = GUESS_FIXTURES.find((fixture) => fixture.name === "all-differ") as { first: GuessAnswers; second: GuessAnswers };
    const result = compareGuesses(all.first, all.second);
    expect(Object.keys(result).sort()).toEqual(["kind", "scenes"]);
    const scene = scenesOf(result)[0];
    expect(Object.keys(scene).sort()).toEqual(["diffs", "index"]);
    expect(Object.keys(scene.diffs[0]).sort()).toEqual(["actual", "direction", "guessed"]);
  });
});

describe("compareGuesses: 대칭과 순수성", () => {
  function randomAnswers(seed: number): GuessAnswers {
    let state = seed >>> 0;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    return answers(...Array.from({ length: 6 }, (): readonly [number, number] => [Math.floor(next() * 3), Math.floor(next() * 3)]));
  }
  const key = (diff: GuessDiff, index: number) => `${index}:${diff.direction}:${diff.guessed}:${diff.actual}`;
  const flip = (diff: GuessDiff): GuessDiff => ({ ...diff, direction: diff.direction === "firstGuessedSecond" ? "secondGuessedFirst" : "firstGuessedSecond" });

  it("first 와 second 를 바꿔 넣으면 같은 (장면, 줄) 집합에서 방향 이름만 뒤바뀐다(300쌍)", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const first = randomAnswers(seed);
      const second = randomAnswers(seed * 7919);
      const forward = compareGuesses(first, second);
      const backward = compareGuesses(second, first);
      expect(backward.kind, `#${seed}`).toBe(forward.kind);
      if (forward.kind !== "both" || backward.kind !== "both") continue;
      const a = forward.scenes.flatMap((scene) => scene.diffs.map((diff) => key(flip(diff), scene.index))).sort();
      const b = backward.scenes.flatMap((scene) => scene.diffs.map((diff) => key(diff, scene.index))).sort();
      expect(b, `#${seed}`).toEqual(a);
    }
  });

  it("입력을 바꾸지 않고(얼린 입력) 같은 입력에는 같은 결과를 낸다", () => {
    const first = randomAnswers(11);
    const second = randomAnswers(12);
    const frozen = (value: GuessAnswers): GuessAnswers => {
      const slots = value.slots.map((slot) => Object.freeze({ ...slot })) as unknown as GuessAnswers["slots"];
      return Object.freeze({ set: value.set, slots: Object.freeze(slots) as GuessAnswers["slots"] });
    };
    const one = compareGuesses(frozen(first), frozen(second));
    const two = compareGuesses(frozen(first), frozen(second));
    expect(two).toEqual(one);
    expect(first).toEqual(randomAnswers(11));
  });
});
