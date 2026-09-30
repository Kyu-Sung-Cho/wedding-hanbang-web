import { describe, expect, it } from "vitest";
import { V40_STATE_COUNTS } from "@/constants/weddingCodeV40";
import type { Item, ScoredFormat, ScoredItem, SelfItem } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { V40_LAYOUT_BY_ID } from "./layout";
import { stateChar } from "./states";
import { itemValue, selfChoice, stateValue, valueModule } from "./value";

const bank = WEDDING_CODE_V40_BANK;

/**
 * 시험이 따로 쓰는 값 표. 구현(극 필드에서 계산)과 달리 배치 골격의 key 와 형식별 표만으로 계산한다.
 * key +1 이면 위 카드가 앞극, 높은 칸이 앞극, 보기 배열 (뒤 약, 앞 강, 앞 약, 뒤 강), 카드 극 배열 (앞, 뒤, 뒤, 앞), 항목 극 배열 (앞, 뒤, 중립).
 */
function expectedTable(fmt: ScoredFormat, key: 1 | -1): number[] {
  const table: number[] = [];
  switch (fmt) {
    case "pair":
      for (let s = 0; s < 6; s += 1) table.push(s < 3 ? key * 2 * (3 - s) : -key * 2 * (s - 2));
      break;
    case "react":
      for (let s = 0; s < 5; s += 1) table.push(key * (s - 2) * 3);
      break;
    case "recall":
    case "instant":
      for (const base of [-2, 6, 2, -6]) table.push(key * base);
      break;
    case "bestworst": {
      const arrangement = [1, -1, -1, 1];
      for (let best = 0; best < 4; best += 1) {
        for (let worst = 0; worst < 4; worst += 1) {
          if (best === worst) continue;
          table.push(4 * key * arrangement[best] - 2 * key * arrangement[worst]);
        }
      }
      break;
    }
    case "split":
      for (let a = 0; a <= 6; a += 1) for (let b = 0; a + b <= 6; b += 1) table.push(key * (a - b));
      break;
  }
  // 값 0 은 언제나 +0 이다(키 -1 과 0 을 곱한 -0 을 남기지 않는다).
  return table.map((value) => (value === 0 ? 0 : value));
}

describe("itemValue: 배치 골격의 키와 형식표에서 계산한 값과 모든 상태에서 같다", () => {
  it("64개 채점 문항 x 모든 상태", () => {
    let checked = 0;
    for (const item of bank.scored) {
      const slot = V40_LAYOUT_BY_ID.get(item.id);
      expect(slot, item.id).toBeDefined();
      const table = expectedTable(item.fmt, slot!.key);
      expect(table).toHaveLength(V40_STATE_COUNTS[item.fmt]);
      table.forEach((expected, state) => {
        expect(itemValue(item, stateChar(state)), `${item.id} ${state}`).toBe(expected);
        expect(stateValue(item, state), `${item.id} ${state}`).toBe(expected);
        checked += 1;
      });
    }
    expect(checked).toBe(
      16 * 6 /* pair */ + 16 * 5 /* react */ + 8 * 4 /* recall */ + 8 * 4 /* instant */ + 8 * 12 /* bestworst */ + 8 * 28 /* split */,
    );
  });

  it("값의 범위와 종류: 정수 -6에서 +6, -0 이 없고 형식별 가능한 값만 나온다", () => {
    const allowed: Record<ScoredFormat, number[]> = {
      pair: [-6, -4, -2, 2, 4, 6],
      react: [-6, -3, 0, 3, 6],
      recall: [-6, -2, 2, 6],
      instant: [-6, -2, 2, 6],
      bestworst: [-6, -2, 2, 6],
      split: [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6],
    };
    for (const item of bank.scored) {
      const seen = new Set<number>();
      for (let state = 0; state < V40_STATE_COUNTS[item.fmt]; state += 1) {
        const value = itemValue(item, stateChar(state));
        expect(value).not.toBeNull();
        expect(Number.isInteger(value)).toBe(true);
        expect(Object.is(value, -0), `${item.id} ${state}`).toBe(false);
        expect(allowed[item.fmt]).toContain(value);
        seen.add(value as number);
      }
      // 형식마다 가능한 값이 모두 나온다
      expect([...seen].sort((a, b) => a - b)).toEqual(item.fmt === "split" ? allowed.split : allowed[item.fmt]);
    }
  });

  it("한 문항의 앞극 값과 뒤극 값은 서로 부호를 뒤집은 집합이다(어느 쪽이 더 크다고 정하지 않는다)", () => {
    for (const item of bank.scored) {
      const values: number[] = [];
      for (let state = 0; state < V40_STATE_COUNTS[item.fmt]; state += 1) values.push(itemValue(item, stateChar(state)) as number);
      expect(values.reduce((a, b) => a + Math.max(0, b), 0), item.id).toBe(values.reduce((a, b) => a + Math.max(0, -b), 0));
    }
  });

  it("빠진 값과 잘못된 저장값은 0 이 아니라 null 이다", () => {
    for (const item of bank.scored) {
      expect(itemValue(item, "skip")).toBeNull();
      expect(itemValue(item, "na")).toBeNull();
      expect(itemValue(item, undefined)).toBeNull();
      // 그 형식에 없는 문자
      expect(itemValue(item, stateChar(V40_STATE_COUNTS[item.fmt]))).toBeNull();
      for (const bad of ["-", "_", ".", "", "가", "00", "ab"]) expect(itemValue(item, bad), `${item.id} ${JSON.stringify(bad)}`).toBeNull();
    }
    expect(itemValue(bank.scored[0], 5 as unknown as string)).toBeNull();
    expect(itemValue(bank.scored[0], null as unknown as string)).toBeNull();
    expect(itemValue(bank.scored[0], {} as unknown as string)).toBeNull();
  });

  it("자기 선택 문항을 itemValue 에 넣어도 던지지 않고 null 이다(값이 없다)", () => {
    for (const item of bank.self) expect(itemValue(item as unknown as ScoredItem, "0")).toBeNull();
  });
});

describe("itemValue: 예시 문항으로 손계산과 대조", () => {
  const byId = (id: string): ScoredItem => bank.byId.get(id) as ScoredItem;

  it("pair 키 +1(money.limit.1): 위 카드 아주 +6, 꽤 +4, 조금 +2, 아래 카드 조금 -2, 꽤 -4, 아주 -6", () => {
    const item = byId("money.limit.1");
    expect(["0", "1", "2", "3", "4", "5"].map((s) => itemValue(item, s))).toEqual([6, 4, 2, -2, -4, -6]);
  });

  it("pair 키 -1(process.owner.1): 부호가 반대", () => {
    const item = byId("process.owner.1");
    expect(["0", "1", "2", "3", "4", "5"].map((s) => itemValue(item, s))).toEqual([-6, -4, -2, 2, 4, 6]);
  });

  it("react 키 +1(process.search.1): 왼쪽 끝 -6, 가운데 0, 오른쪽 끝 +6, 키 -1(scope.form.1)은 반대", () => {
    expect(["0", "1", "2", "3", "4"].map((s) => itemValue(byId("process.search.1"), s))).toEqual([-6, -3, 0, 3, 6]);
    expect(["0", "1", "2", "3", "4"].map((s) => itemValue(byId("scope.form.1"), s))).toEqual([6, 3, 0, -3, -6]);
  });

  it("recall 키 -1(scope.timing.1): (앞 약, 뒤 강, 뒤 약, 앞 강) = +2, -6, -2, +6 이고 키 +1(support.recover.1)은 -2, +6, +2, -6", () => {
    expect(["0", "1", "2", "3"].map((s) => itemValue(byId("scope.timing.1"), s))).toEqual([2, -6, -2, 6]);
    expect(["0", "1", "2", "3"].map((s) => itemValue(byId("support.recover.1"), s))).toEqual([-2, 6, 2, -6]);
  });

  it("bestworst 키 +1(scope.circle.1): 극 배열 (앞, 뒤, 뒤, 앞)에서 가장 0번 카드, 가장 아닌 것 1번 카드는 +4 + 2 = +6", () => {
    const item = byId("scope.circle.1");
    // s = 3 x best + (worst < best ? worst : worst - 1): best 0, worst 1 -> 0
    expect(itemValue(item, "0")).toBe(6);
    // best 0, worst 3(앞극 카드) -> s = 2 : +4 - 2 = +2
    expect(itemValue(item, "2")).toBe(2);
    // best 1(뒤극), worst 0(앞극) -> s = 3 : -4 - 2 = -6
    expect(itemValue(item, "3")).toBe(-6);
    // best 3(앞극), worst 1(뒤극) -> s = 9 + 1 = 10 : +4 + 2 = +6
    expect(itemValue(item, "a")).toBe(6);
  });

  it("split 키 +1(support.give.3): (앞, 뒤, 중립) 칸 (a, b, c) 에서 값 = a - b, 중립 칸은 값에 넣지 않는다", () => {
    const item = byId("support.give.3");
    // (6,0,0) = 27 -> +6 / (0,6,0) = 6 -> -6 / (0,0,6) = 0 -> 0 / (2,2,2) = 15 -> 0 / (3,1,2): s = 3*12/2 + 1 = 19 -> +2
    expect(itemValue(item, stateChar(27))).toBe(6);
    expect(itemValue(item, stateChar(6))).toBe(-6);
    expect(itemValue(item, stateChar(0))).toBe(0);
    expect(itemValue(item, stateChar(15))).toBe(0);
    expect(itemValue(item, stateChar(19))).toBe(2);
    // 키 -1 (support.vent.1): (뒤, 앞, 중립)이라 부호가 반대
    const mirrored = byId("support.vent.1");
    expect(itemValue(mirrored, stateChar(27))).toBe(-6);
    expect(itemValue(mirrored, stateChar(6))).toBe(6);
  });
});

describe("selfChoice", () => {
  const selfItems = bank.self as readonly SelfItem[];

  it("6개 상태의 방향과 세기: 위 카드 아주, 꽤, 조금, 아래 카드 조금, 꽤, 아주", () => {
    for (const item of selfItems) {
      const slot = V40_LAYOUT_BY_ID.get(item.id);
      const topSide = slot!.key === 1 ? "front" : "back";
      const bottomSide = slot!.key === 1 ? "back" : "front";
      const expected = [
        { side: topSide, level: 3 },
        { side: topSide, level: 2 },
        { side: topSide, level: 1 },
        { side: bottomSide, level: 1 },
        { side: bottomSide, level: 2 },
        { side: bottomSide, level: 3 },
      ];
      expected.forEach((want, state) => expect(selfChoice(item, stateChar(state)), `${item.id} ${state}`).toEqual(want));
    }
  });

  it("빠진 값, 없음, 잘못된 문자는 null", () => {
    for (const item of selfItems) {
      for (const bad of ["skip", "na", undefined, "6", "a", "-", "_", ".", "", "가"]) {
        expect(selfChoice(item, bad as string | undefined), `${item.id} ${String(bad)}`).toBeNull();
      }
    }
  });

  it("채점 문항을 넣어도 던지지 않고 null", () => {
    expect(selfChoice(bank.scored[0] as unknown as SelfItem, "0")).toBeNull();
  });
});

describe("계약 묶음", () => {
  it("valueModule 은 itemValue 와 selfChoice 를 가진다", () => {
    expect(Object.keys(valueModule).sort()).toEqual(["itemValue", "selfChoice"]);
  });

  it("문항 배열은 채점 64개와 자기 선택 4개로 나뉜다", () => {
    const all: readonly Item[] = bank.items;
    expect(all.filter((item) => item.fmt === "self")).toHaveLength(4);
    expect(bank.scored).toHaveLength(64);
  });
});
