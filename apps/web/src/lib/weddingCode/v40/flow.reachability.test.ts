// @vitest-environment node
/**
 * 웨딩코드 4.0 흐름의 성질 시험: 무작위 행동열에서 「결과에 이를 수 있는가 = 모든 문항에 완성된 저장값이 있는가」.
 *
 * 예전에는 완성해 둔 칸 나누기나 가장·아닌 것을 한 번 눌러 중간 상태로 바꾸면 저장값이 지워져서, 이전으로 나온 뒤 결과에 이를 수 없었다.
 * 지금은 responses 에서 키가 사라지는 길이 restart 뿐이다. 이 시험은 그것을 세 가지로 지킨다.
 *  1. 단조: restart 가 아닌 모든 행동(쓰레기 행동 포함) 뒤에도 그 전에 있던 저장값은 모두 남는다. 중간 상태의 답은 responses 를 같은 객체로 둔다.
 *  2. 결과 쪽은 68개 완성 저장값의 증거: 결과 쪽에 있으면(필터 없이) 언제나 allResolved.
 *  3. 도달 가능성: 아무 상태에서나 「마무리 행동열」(중간 답은 저장된 값 그대로 다시 고르고, 다음을 누르고, 필터는 끝까지 넘김; 새 답은 하나도 만들지 않는다)을 돌리면
 *     결과 쪽에 이르는 것과 allResolved 인 것이 정확히 같다.
 * 시드 무작위 열은 시작 화면에서 출발하는 것과 결과 스냅샷에서 이어 하는 것을 섞고, 쓰레기 행동도 끼운다(던지지 않는다).
 */
import { describe, expect, it } from "vitest";
import { V40_AXIS_KEYS } from "@/constants/weddingCodeV40";
import type { Axis, FlowAction, FlowState, Item, ItemId, Page, PagePack, ViewAnswer } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { V40_FIXTURES } from "./fixtures";
import { allResolved, createFlowReducer, initialFlowState, skippedReviewIds } from "./flow";
import { fromStored } from "./present";

const bank = WEDDING_CODE_V40_BANK;
const reduce = createFlowReducer(bank);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function item(id: ItemId): Item {
  const found = bank.byId.get(id);
  if (!found) throw new Error(`없는 문항: ${id}`);
  return found;
}

const page = (state: FlowState): Page => state.pages[state.pageIndex];

function completeAnswer(target: Item, n: number): ViewAnswer {
  switch (target.fmt) {
    case "pair":
    case "self":
      return { fmt: target.fmt, cell: n % 6 };
    case "react":
      return { fmt: "react", cell: n % 5 };
    case "recall":
    case "instant":
      return { fmt: target.fmt, option: n % 4 };
    case "bestworst":
      return { fmt: "bestworst", best: n % 4, worst: (n + 1) % 4 };
    case "split": {
      const a = n % 7;
      const b = (n * 3) % (7 - a);
      return { fmt: "split", counts: [a, b, 6 - a - b] };
    }
  }
}

/** 마무리 행동열: 새 답을 만들지 않는다(중간 답은 저장된 값 그대로 다시 고른다). 더 나아갈 수 없으면 거기서 멈춘다. */
function finish(from: FlowState): FlowState {
  let state = from;
  for (let step = 0; step < 400; step += 1) {
    if (!state.started) return state;
    const current = page(state);
    if (state.filter === null && current.kind === "result") return state;
    if (current.kind === "questions") {
      for (const id of state.partialIds) {
        const stored = state.responses[id];
        if (stored === undefined) return state; // 저장값이 없는 중간 답은 완성하지 않고는 넘어갈 수 없다
        const view = fromStored(item(id), state.formBit, stored);
        if (view !== null) state = reduce(state, { type: "answer", itemId: id, answer: view });
      }
    }
    const before = state;
    state = reduce(state, { type: "next" });
    if (state === before) return state;
    if (state.notice?.kind === "incomplete" && state.pageIndex === before.pageIndex && state.filter === before.filter && state.pages === before.pages) return state;
  }
  return state;
}

function randomAction(rng: () => number, state: FlowState): FlowAction {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  const current = page(state);
  const roll = rng();
  if (roll < 0.36 && current.kind === "questions") {
    const id = pick(current.itemIds);
    const target = item(id);
    const kind = rng();
    if (kind < 0.1) return { type: "answer", itemId: id, answer: pick([{ fmt: "escape", which: "unsure" }, { fmt: "escape", which: "na" }] as const) };
    if (target.fmt === "bestworst" && kind < 0.6) return { type: "answer", itemId: id, answer: { fmt: "bestworst", best: pick([null, 0, 1, 2, 3]), worst: pick([null, 0, 1, 2, 3]) } };
    if (target.fmt === "split" && kind < 0.6) {
      return { type: "answer", itemId: id, answer: { fmt: "split", counts: [Math.floor(rng() * 4), Math.floor(rng() * 3), Math.floor(rng() * 3)] } };
    }
    return { type: "answer", itemId: id, answer: completeAnswer(target, Math.floor(rng() * 40)) };
  }
  if (roll < 0.42) return { type: "answer", itemId: pick(bank.items).id, answer: completeAnswer(pick(bank.items), Math.floor(rng() * 40)) };
  if (roll < 0.62) return { type: "next" };
  if (roll < 0.72) return { type: "back" };
  if (roll < 0.78) {
    const ids = skippedReviewIds(bank, state.responses);
    return {
      type: "openFilter",
      filter: rng() < 0.5 || ids.length === 0 ? { kind: "axis", axis: pick(V40_AXIS_KEYS) as Axis } : { kind: "skipped", itemIds: ids },
    };
  }
  if (roll < 0.83) return { type: "closeFilter" };
  if (roll < 0.88) return { type: "repack", pack: pick(["screen", "single"] as const) };
  if (roll < 0.9) return { type: "dismissNotice" };
  if (roll < 0.905) return { type: "restart" };
  if (roll < 0.925) return { type: "start", formBit: pick([0, 1] as const) };
  return pick([{ type: "bogus" }, null, undefined, 7, { type: "answer" }, { type: "openFilter" }, { type: "repack", pack: 3 }] as unknown[]) as FlowAction;
}

/** 지금 화면을 성실하게 채우고 다음을 누르는 행동 묶음(시작 화면에서 출발하는 열이 깊은 화면까지 가도록). */
function pageMacro(rng: () => number, state: FlowState): FlowAction[] {
  const current = page(state);
  if (current.kind !== "questions") return [{ type: "next" }];
  const actions: FlowAction[] = current.itemIds.map((id) => ({ type: "answer", itemId: id, answer: completeAnswer(item(id), Math.floor(rng() * 40)) }));
  return [...actions, { type: "next" }];
}

function startState(seed: number): FlowState {
  const pack: PagePack = seed % 2 === 0 ? "screen" : "single";
  if (seed % 3 === 0) return initialFlowState(bank, { pack });
  if (seed % 4 === 1) {
    // 마지막 질문 화면에서 이어 하기: 유효 답이 12개 미만인 주제가 있는 표본이면 다음에 넘어간 질문 다시 보기가 저절로 열린다(그 첫 쪽의 이전을 지나가게).
    const skippy = V40_FIXTURES.find((entry) => entry.name === "unusable-axis")!;
    // 커서는 마지막 문항으로 둔다(묶음이 single 이면 마지막 화면의 문항 둘이 쪽 둘로 나뉘는데 그중 뒤쪽 쪽이다).
    const lastItem = bank.items[bank.items.length - 1];
    return initialFlowState(bank, {
      pack,
      snapshot: { formBit: skippy.formBit, responses: skippy.responses, screen: "questions", cursor: bank.codeIndexById.get(lastItem.id) ?? 0, skippedReviewDone: false },
    });
  }
  // 결과 스냅샷에서 이어 하기: 열두 표본을 돌아가며, 두 폼 비트를 섞는다.
  const fixture = V40_FIXTURES[seed % V40_FIXTURES.length];
  return initialFlowState(bank, {
    pack,
    snapshot: { formBit: fixture.formBit, responses: fixture.responses, screen: "result", cursor: 0, skippedReviewDone: seed % 5 === 0 },
  });
}

describe("결과에 이를 수 있다 = 모든 문항에 완성된 저장값이 있다", () => {
  it("무작위 행동열: 저장값은 restart 밖에서 사라지지 않고, 중간 답은 responses 를 건드리지 않으며, 마무리하면 결과에 이르는 것이 allResolved 와 같다", () => {
    const seen = { actions: 0, checks: 0, reachable: 0, unreachable: 0, partialOverStored: 0, partialWithoutStored: 0, filtered: 0, restarted: 0, adviceBack: 0 };
    for (let seed = 1; seed <= 36; seed += 1) {
      const rng = mulberry32(seed * 7331);
      let state: FlowState = startState(seed);
      let step = 0;
      // 마지막 질문 화면에서 이어 하는 열은 넘어간 질문 다시 보기가 저절로 열리는 길(다음, 이전, 다음, 이전)로 시작한다.
      const forced: FlowAction[] = seed % 4 === 1 ? [{ type: "next" }, { type: "back" }, { type: "next" }, { type: "back" }] : [];
      while (step < 320) {
        const actions = forced.length > 0 ? [forced.shift() as FlowAction] : rng() < 0.22 && state.started ? pageMacro(rng, state) : [randomAction(rng, state)];
        for (const action of actions) {
          const before = state;
          const next = reduce(state, action);
          const label = `seed ${seed} step ${step}`;
          const typed = action !== null && typeof action === "object" ? action : null;
          // 1. 단조
          if (typed?.type !== "restart") {
            for (const id of Object.keys(before.responses)) expect(next.responses[id], `${label}: 저장값 ${id} 가 사라졌다`).toBeDefined();
            if (before.started) expect(allResolved(bank, next.responses) || !allResolved(bank, before.responses), `${label}: 모두 답한 뒤에 미답이 생겼다`).toBe(true);
          } else if (before.started) {
            seen.restarted += 1;
          }
          if (typed?.type === "answer" && next !== before && next.partialIds.length > 0) {
            const id = typed.itemId as ItemId;
            if (next.partialIds.includes(id)) {
              expect(next.responses, `${label}: 중간 답은 responses 를 같은 객체로 둔다`).toBe(before.responses);
              if (before.responses[id] !== undefined) seen.partialOverStored += 1;
              else seen.partialWithoutStored += 1;
            }
          }
          if (before.filterOrigin === "advance" && next.filter === null && typed?.type === "back") seen.adviceBack += 1;
          state = next;
          // 2. 결과 쪽은 68개 완성 저장값의 증거
          if (state.filter === null && page(state).kind === "result") expect(allResolved(bank, state.responses), `${label}: 결과 쪽인데 미답이 있다`).toBe(true);
          if (state.filter !== null) seen.filtered += 1;
          // 3. 도달 가능성(비용 때문에 여섯 걸음마다)
          if (step % 6 === 0 && state.started) {
            const end = finish(state);
            const reached = end.filter === null && page(end).kind === "result";
            expect(reached, `${label}: 결과에 이를 수 있는가 = allResolved`).toBe(allResolved(bank, state.responses));
            if (reached) {
              expect(end.responses, `${label}: 마무리는 저장값을 바꾸지 않는다`).toEqual(state.responses);
              seen.reachable += 1;
            } else {
              seen.unreachable += 1;
            }
            seen.checks += 1;
          }
          step += 1;
          seen.actions += 1;
        }
      }
    }
    // 무작위 열이 각 갈래를 실제로 지나갔는지 센다(지나가지 않았다면 이 시험은 그 갈래를 지키지 못한 것이다).
    expect(seen.actions).toBeGreaterThanOrEqual(10000);
    for (const [name, count] of Object.entries(seen)) expect(count, `무작위 열이 ${name} 갈래를 지나가지 않았다`).toBeGreaterThan(0);
  });

  it("손으로 만든 반례: 한 문항만 비어 있으면 어떻게 마무리해도 결과에 이르지 못하고, 채우면 이른다", () => {
    const fixture = V40_FIXTURES.find((entry) => entry.name === "swua-example")!;
    const gapId = bank.items[20].id;
    const gapped = { ...fixture.responses };
    delete gapped[gapId];
    for (const pack of ["screen", "single"] as const) {
      const cursor = bank.codeIndexById.get(gapId) ?? 0;
      const resumed = initialFlowState(bank, { pack, snapshot: { formBit: fixture.formBit, responses: gapped, screen: "questions", cursor, skippedReviewDone: false } });
      expect(allResolved(bank, resumed.responses)).toBe(false);
      const stuck = finish(resumed);
      expect(page(stuck).kind).toBe("questions");
      expect(stuck.notice?.kind).toBe("incomplete");
      // 채우면 이른다.
      const filled = reduce(resumed, { type: "answer", itemId: gapId, answer: completeAnswer(item(gapId), 1) });
      expect(allResolved(bank, filled.responses)).toBe(true);
      const end = finish(filled);
      expect(end.filter === null && page(end).kind === "result").toBe(true);
    }
  });

  it("손으로 만든 반례: 모두 답한 상태에서 중간 답을 만들고 필터를 이전과 닫기와 다시 열기로 오가도 언제나 결과에 이른다", () => {
    const fixture = V40_FIXTURES.find((entry) => entry.name === "all-clear")!;
    const base = initialFlowState(bank, { snapshot: { formBit: fixture.formBit, responses: fixture.responses, screen: "result", cursor: 0, skippedReviewDone: false } });
    const heavy = bank.items.filter((entry) => entry.fmt === "bestworst" || entry.fmt === "split");
    for (const target of heavy) {
      let state = reduce(base, { type: "openFilter", filter: { kind: "axis", axis: target.axis as Axis } });
      for (let guard = 0; guard < 60; guard += 1) {
        const current = page(state);
        if (current.kind === "questions" && current.itemIds.includes(target.id)) break;
        state = reduce(state, { type: "next" });
      }
      const partial: ViewAnswer = target.fmt === "split" ? { fmt: "split", counts: [2, 0, 0] } : { fmt: "bestworst", best: 3, worst: null };
      state = reduce(state, { type: "answer", itemId: target.id, answer: partial });
      expect(state.partialIds, target.id).toEqual([target.id]);
      const ways: FlowAction[][] = [[{ type: "back" }, { type: "back" }, { type: "back" }], [{ type: "closeFilter" }], [{ type: "repack", pack: "single" }, { type: "closeFilter" }]];
      for (const way of ways) {
        let after = state;
        for (const action of way) after = reduce(after, action);
        const end = finish(after);
        expect(end.filter === null && page(end).kind === "result", `${target.id} ${JSON.stringify(way)}`).toBe(true);
        expect(allResolved(bank, after.responses)).toBe(true);
      }
    }
  });
});
