import { describe, expect, it } from "vitest";
import { V40_AXIS_KEYS, V40_COUNTS, guideKeyOf } from "@/constants/weddingCodeV40";
import type { Axis, FlowAction, FlowState, GuideKey, Item, ItemId, Page, PagePack, QuestionsPage, ViewAnswer } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { encodeProgressAnswers } from "./storage";
import {
  allResolved,
  buildPages,
  createFlowReducer,
  flowModule,
  initialFlowState,
  placementOf,
  progressSegments,
  skippedReviewIds,
  snapshotOf,
  viewAnswerOf,
} from "./flow";
import { V40_FIXTURES } from "./fixtures";
import { isViewAnswerComplete, toStored } from "./present";
import { buildResult } from "./score";
import { isResponseValueFor } from "./states";

const bank = WEDDING_CODE_V40_BANK;
const reduce = createFlowReducer(bank);

// ---------------------------------------------------------------------------
// 시험 도구
// ---------------------------------------------------------------------------

function item(id: ItemId): Item {
  const found = bank.byId.get(id);
  if (!found) throw new Error(`없는 문항: ${id}`);
  return found;
}

/** 형식에 맞는 완성된 화면 답. n 으로 조금씩 다르게 만든다. */
function completeAnswer(target: Item, n = 0): ViewAnswer {
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

const UNSURE: ViewAnswer = { fmt: "escape", which: "unsure" };
const NOT_APPLICABLE: ViewAnswer = { fmt: "escape", which: "na" };

function page(state: FlowState): Page {
  return state.pages[state.pageIndex];
}

function questions(state: FlowState): QuestionsPage {
  const current = page(state);
  if (current.kind !== "questions") throw new Error(`질문 화면이 아니다: ${current.kind}`);
  return current;
}

function started(formBit: 0 | 1 = 0, pack: PagePack = "screen"): FlowState {
  return reduce(initialFlowState(bank, { pack }), { type: "start", formBit });
}

/** 지금 화면의 문항을 모두 답한다. choose 가 답을 정한다. */
function answerPage(state: FlowState, choose: (target: Item, n: number) => ViewAnswer = (target, n) => completeAnswer(target, n)): FlowState {
  let current = state;
  questions(state).itemIds.forEach((id, index) => {
    current = reduce(current, { type: "answer", itemId: id, answer: choose(item(id), index + current.pageIndex) });
  });
  return current;
}

/** 결과(또는 필터가 열릴 때)까지 화면마다 답하고 다음을 누른다. */
function playToEnd(state: FlowState, choose?: (target: Item, n: number) => ViewAnswer): FlowState {
  let current = state;
  for (let guard = 0; guard < 400; guard += 1) {
    const now = page(current);
    if (now.kind === "result" || current.filter !== null) return current;
    current = now.kind === "questions" ? reduce(answerPage(current, choose), { type: "next" }) : reduce(current, { type: "next" });
  }
  throw new Error("끝나지 않았다");
}

function toResult(pack: PagePack = "screen", formBit: 0 | 1 = 0): FlowState {
  const end = playToEnd(started(formBit, pack));
  expect(page(end).kind).toBe("result");
  return end;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const kindsOf = (pages: readonly Page[]): string[] => pages.map((entry) => entry.kind);

// ---------------------------------------------------------------------------
// buildPages
// ---------------------------------------------------------------------------

describe("buildPages: 전체 흐름", () => {
  const pages = buildPages(bank);

  it("소개, 구간 네 개(사이에 쉬는 카드 셋), 마지막 정리 카드, 자기 선택 화면 둘, 결과로 모두 48쪽", () => {
    expect(pages).toHaveLength(48);
    const expected = ["intro"];
    for (let section = 0; section < 4; section += 1) {
      expected.push(...Array<string>(10).fill("questions"));
      expected.push(section < 3 ? "rest" : "selfIntro");
    }
    expected.push("questions", "questions", "result");
    expect(kindsOf(pages)).toEqual(expected);
  });

  it("질문 화면 42개는 화면 번호 0에서 41 순서이고 은행의 화면 배치를 그대로 따른다", () => {
    const list = pages.filter((entry): entry is QuestionsPage => entry.kind === "questions");
    expect(list.map((entry) => entry.screen)).toEqual(Array.from({ length: V40_COUNTS.screens }, (_, index) => index));
    for (const entry of list) {
      expect(entry.itemIds).toEqual(bank.screens[entry.screen]);
      expect(entry.itemIds.length).toBeGreaterThanOrEqual(1);
      expect(entry.itemIds.length).toBeLessThanOrEqual(2);
      for (const id of entry.itemIds) expect(item(id).section).toBe(entry.section);
    }
    expect(list.flatMap((entry) => entry.itemIds)).toEqual(bank.items.map((entry) => entry.id));
  });

  it("쉬는 카드는 구간 0, 1, 2 뒤에 하나씩 있고 마지막 구간 뒤에는 마지막 정리 카드가 온다", () => {
    const rests = pages.filter((entry) => entry.kind === "rest");
    expect(rests.map((entry) => (entry.kind === "rest" ? entry.after : -1))).toEqual([0, 1, 2]);
    const index = pages.findIndex((entry) => entry.kind === "selfIntro");
    const before = pages[index - 1];
    const after = pages[index + 1];
    expect(before.kind === "questions" && before.section).toBe(3);
    expect(after.kind === "questions" && after.section).toBe(4);
    expect(pages[0].kind).toBe("intro");
    expect(pages[pages.length - 1].kind).toBe("result");
  });

  it("key 는 안정된 문자열이고 겹치지 않는다", () => {
    const keys = pages.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(pages.length);
    expect(keys[0]).toBe("intro");
    expect(keys[keys.length - 1]).toBe("result");
    expect(keys).toContain("rest:0");
    expect(keys).toContain("rest:2");
    expect(keys).toContain("selfIntro");
    for (const entry of pages) if (entry.kind === "questions") expect(entry.key).toBe(`q:${entry.itemIds[0]}`);
  });

  it("같은 입력에는 같은 화면 목록이 나온다(순수)", () => {
    expect(buildPages(bank)).toEqual(pages);
    expect(buildPages(bank, { pack: "screen" })).toEqual(pages);
  });

  it("형식 안내는 그 형식이 처음 나오는 화면에만 있고 다섯 가지가 한 번씩이다", () => {
    const seen = new Set<GuideKey>();
    for (const entry of pages) {
      if (entry.kind !== "questions") continue;
      const wanted: GuideKey[] = [];
      for (const id of entry.itemIds) {
        const guide = guideKeyOf(item(id).fmt);
        if (guide !== null && !seen.has(guide)) {
          seen.add(guide);
          wanted.push(guide);
        }
      }
      expect(entry.guides).toEqual(wanted);
    }
    const all = pages.flatMap((entry) => (entry.kind === "questions" ? entry.guides : []));
    expect([...all].sort()).toEqual(["bestworst", "choose", "pair", "react", "split"]);
  });

  it("첫 화면은 이럴 때와 두 가지 중 고르기이고 각각의 안내가 붙는다", () => {
    const first = pages[1] as QuestionsPage;
    expect(first.itemIds.map((id) => item(id).fmt)).toEqual(["react", "pair"]);
    expect(first.guides).toEqual(["react", "pair"]);
  });

  it("어른 안내는 정하는 사람 주제가 처음 나오는 화면 하나에만 있다", () => {
    const hinted = pages.filter((entry): entry is QuestionsPage => entry.kind === "questions" && entry.elderHint);
    expect(hinted).toHaveLength(1);
    const firstScope = bank.items.find((entry) => entry.axis === "scope");
    expect(hinted[0].itemIds).toContain(firstScope?.id);
    const earlier = pages.slice(0, pages.indexOf(hinted[0]));
    for (const entry of earlier) {
      if (entry.kind === "questions") for (const id of entry.itemIds) expect(item(id).axis).not.toBe("scope");
    }
  });
});

describe("buildPages: 한 쪽에 하나씩(single)", () => {
  const pages = buildPages(bank, { pack: "single" });

  it("질문 68쪽이 되어 모두 74쪽이다", () => {
    expect(pages).toHaveLength(74);
    const list = pages.filter((entry): entry is QuestionsPage => entry.kind === "questions");
    expect(list).toHaveLength(68);
    for (const entry of list) expect(entry.itemIds).toHaveLength(1);
    expect(list.map((entry) => entry.itemIds[0])).toEqual(bank.items.map((entry) => entry.id));
  });

  it("원래 화면 번호를 그대로 유지하고 key 는 겹치지 않는다", () => {
    const list = pages.filter((entry): entry is QuestionsPage => entry.kind === "questions");
    for (const entry of list) expect(entry.screen).toBe(item(entry.itemIds[0]).screen);
    expect(new Set(pages.map((entry) => entry.key)).size).toBe(pages.length);
  });

  it("형식 안내는 그 형식이 처음 나오는 문항의 쪽에 붙고 어른 안내는 정하는 사람의 첫 문항 쪽에 붙는다", () => {
    const list = pages.filter((entry): entry is QuestionsPage => entry.kind === "questions");
    const seen = new Set<GuideKey>();
    for (const entry of list) {
      const guide = guideKeyOf(item(entry.itemIds[0]).fmt);
      const first = guide !== null && !seen.has(guide);
      if (guide !== null) seen.add(guide);
      expect(entry.guides).toEqual(first && guide !== null ? [guide] : []);
    }
    const hinted = list.filter((entry) => entry.elderHint);
    expect(hinted).toHaveLength(1);
    expect(hinted[0].itemIds[0]).toBe(bank.items.find((entry) => entry.axis === "scope")?.id);
  });
});

describe("buildPages: only", () => {
  it("주어진 문항의 질문 화면만 만들고 소개, 쉬는 카드, 결과, 안내가 없다", () => {
    const pages = buildPages(bank, { only: ["money.limit.1", "money.worth.4"] });
    expect(kindsOf(pages)).toEqual(["questions", "questions"]);
    for (const entry of pages) {
      expect(entry.kind === "questions" && entry.guides).toEqual([]);
      expect(entry.kind === "questions" && entry.elderHint).toBe(false);
    }
  });

  it("같은 화면의 문항은 한 쪽에 남고(원래 화면을 따름) single 이면 하나씩이다", () => {
    const together = buildPages(bank, { only: ["process.search.1", "money.limit.1"] });
    expect(together).toHaveLength(1);
    expect((together[0] as QuestionsPage).itemIds).toEqual(["process.search.1", "money.limit.1"]);
    expect((together[0] as QuestionsPage).screen).toBe(0);
    const single = buildPages(bank, { only: ["process.search.1", "money.limit.1"], pack: "single" });
    expect(single.map((entry) => (entry as QuestionsPage).itemIds)).toEqual([["process.search.1"], ["money.limit.1"]]);
  });

  it("주어진 순서와 겹침에 상관없이 질문 순서로 만들고 모르는 id 는 버린다", () => {
    const forward = buildPages(bank, { only: ["money.limit.1", "scope.form.4", "money.worth.2"] });
    const scrambled = buildPages(bank, { only: ["scope.form.4", "nope", "money.worth.2", "money.limit.1", "money.limit.1"] });
    expect(scrambled).toEqual(forward);
    expect(forward.map((entry) => (entry as QuestionsPage).itemIds[0])).toEqual(["money.limit.1", "money.worth.2", "scope.form.4"]);
    expect(buildPages(bank, { only: [] })).toEqual([]);
    expect(buildPages(bank, { only: ["nope"] })).toEqual([]);
  });

  it("주제 하나의 채점 문항 16개를 열면 문항 16개가 질문 순서로 나온다", () => {
    for (const axis of V40_AXIS_KEYS) {
      const ids = bank.scoredByAxis[axis].map((entry) => entry.id);
      const pages = buildPages(bank, { only: ids });
      expect(pages.flatMap((entry) => (entry as QuestionsPage).itemIds)).toEqual(ids);
    }
  });
});

// ---------------------------------------------------------------------------
// initialFlowState, start
// ---------------------------------------------------------------------------

describe("initialFlowState와 start", () => {
  it("처음 상태는 시작 전이고 소개 쪽이다", () => {
    const state = initialFlowState(bank);
    expect(state).toMatchObject({ formBit: 0, started: false, responses: {}, drafts: {}, pack: "screen", pageIndex: 0, filter: null, skippedReviewDone: false, notice: null });
    expect(page(state).kind).toBe("intro");
    expect(state.pages).toHaveLength(48);
    expect(initialFlowState(bank, { pack: "single" }).pages).toHaveLength(74);
  });

  it("여러 상태가 함께 쓰는 전체 화면 목록은 얼려 있어 실수로 바꿀 수 없다(같은 묶음이면 같은 배열)", () => {
    const a = initialFlowState(bank);
    const b = initialFlowState(bank);
    expect(a.pages).toBe(b.pages);
    expect(Object.isFrozen(a.pages)).toBe(true);
    for (const entry of a.pages) {
      expect(Object.isFrozen(entry)).toBe(true);
      if (entry.kind === "questions") {
        expect(Object.isFrozen(entry.itemIds)).toBe(true);
        expect(Object.isFrozen(entry.guides)).toBe(true);
      }
    }
    expect(initialFlowState(bank, { pack: "single" }).pages).not.toBe(a.pages);
  });

  it("start 는 폼 비트를 정하고 첫 질문 화면으로 간다", () => {
    for (const formBit of [0, 1] as const) {
      const state = started(formBit);
      expect(state.started).toBe(true);
      expect(state.formBit).toBe(formBit);
      expect(state.pageIndex).toBe(1);
      expect(questions(state).screen).toBe(0);
    }
  });

  it("이미 시작했으면 start 는 상태를 그대로 돌려준다(폼 비트가 바뀌지 않는다)", () => {
    const state = started(1);
    expect(reduce(state, { type: "start", formBit: 0 })).toBe(state);
  });

  it("잘못된 폼 비트는 0 으로 읽는다", () => {
    const state = reduce(initialFlowState(bank), { type: "start", formBit: 7 as unknown as 0 });
    expect(state.formBit).toBe(0);
  });

  it("시작 전에는 답하기, 다음, 뒤로, 필터가 모두 무시된다", () => {
    const state = initialFlowState(bank);
    for (const action of [
      { type: "next" },
      { type: "back" },
      { type: "answer", itemId: "process.search.1", answer: { fmt: "react", cell: 1 } },
      { type: "openFilter", filter: { kind: "axis", axis: "money" } },
    ] as FlowAction[]) {
      expect(reduce(state, action)).toBe(state);
    }
  });
});

describe("initialFlowState: 이어 하기", () => {
  const partial = () => {
    let state = started(1);
    for (let count = 0; count < 5; count += 1) state = reduce(answerPage(state), { type: "next" });
    return state;
  };

  it("진행 저장 스냅샷에서 이어 하면 cursor 문항이 든 질문 화면으로 간다", () => {
    const before = partial();
    const snapshot = snapshotOf(bank, before);
    expect(snapshot).not.toBeNull();
    const resumed = initialFlowState(bank, { snapshot: snapshot ?? undefined });
    expect(resumed.started).toBe(true);
    expect(resumed.formBit).toBe(1);
    expect(resumed.responses).toEqual(before.responses);
    expect(resumed.pageIndex).toBe(before.pageIndex);
    expect(page(resumed)).toEqual(page(before));
    expect(resumed.drafts).toEqual({});
  });

  it("앞 화면으로 돌아가 고치던 자리에서 저장하면 첫 미답 화면이 아니라 그 자리로 이어진다", () => {
    let state = partial();
    const frontier = state.pageIndex;
    state = reduce(reduce(state, { type: "back" }), { type: "back" });
    expect(state.pageIndex).toBe(frontier - 2);
    const resumed = initialFlowState(bank, { snapshot: snapshotOf(bank, state) ?? undefined });
    expect(resumed.pageIndex).toBe(frontier - 2);
    expect(page(resumed)).toEqual(page(state));
    // 모두 답한 뒤 마지막 화면으로 돌아와 고치던 자리도 같다.
    const editing = reduce(toResult(), { type: "back" });
    const back = initialFlowState(bank, { snapshot: snapshotOf(bank, editing) ?? undefined });
    expect(page(back)).toEqual(page(editing));
    expect(back.pageIndex).toBe(editing.pageIndex);
  });

  it("화면 묶음이 달라도 cursor 문항이 든 쪽으로 이어진다", () => {
    const before = partial();
    const snapshot = snapshotOf(bank, before);
    const single = initialFlowState(bank, { pack: "single", snapshot: snapshot ?? undefined });
    expect(single.pack).toBe("single");
    expect(questions(single).itemIds).toContain(bank.items[snapshot?.cursor ?? 0].id);
  });

  it("result 스냅샷은 68개가 모두 있으면 결과 쪽으로, 모자라면 첫 미답 화면으로 간다", () => {
    const done = toResult();
    const snapshot = snapshotOf(bank, done);
    expect(snapshot).toMatchObject({ screen: "result", cursor: 0 });
    const resumed = initialFlowState(bank, { snapshot: snapshot ?? undefined });
    expect(page(resumed).kind).toBe("result");
    const missing = { ...done.responses };
    delete missing["money.limit.1"];
    const forged = initialFlowState(bank, { snapshot: { formBit: 0, responses: missing, screen: "result", cursor: 0, skippedReviewDone: false } });
    expect(questions(forged).itemIds).toContain("money.limit.1");
  });

  it("이어 하다가 앞에 빈 문항이 남은 채 끝에 이르면 결과가 아니라 첫 미답 화면으로 돌려보내고 안내한다", () => {
    const done = toResult();
    const gapped = { ...done.responses };
    delete gapped["money.limit.1"];
    const resumed = initialFlowState(bank, { snapshot: { formBit: 0, responses: gapped, screen: "questions", cursor: bank.codeIndexById.get("self.money") ?? 0, skippedReviewDone: false } });
    expect(questions(resumed).itemIds).toContain("self.money");
    let state = reduce(resumed, { type: "next" });
    expect(questions(state).itemIds).toContain("self.support");
    state = reduce(state, { type: "next" });
    expect(page(state).kind).toBe("questions");
    expect(questions(state).itemIds).toContain("money.limit.1");
    expect(state.notice).toEqual({ kind: "incomplete", itemIds: ["money.limit.1"] });
    // 빈 문항을 채우고 다음으로 가면 그 화면 뒤부터 다시 이어져 결국 결과에 이른다.
    state = reduce(state, { type: "answer", itemId: "money.limit.1", answer: completeAnswer(item("money.limit.1")) });
    expect(state.notice).toBeNull();
    state = playToEnd(state);
    expect(page(state).kind).toBe("result");
    expect(allResolved(bank, state.responses)).toBe(true);
  });

  it("범위 밖 cursor 와 잘못된 저장값은 던지지 않고 걸러 낸다", () => {
    const state = initialFlowState(bank, {
      snapshot: {
        formBit: 3 as unknown as 0,
        responses: { "money.limit.1": "9", "process.search.1": "2", "ghost.item.1": "1", "scope.form.1": "skip" },
        screen: "questions",
        cursor: 999,
        skippedReviewDone: "yes" as unknown as boolean,
      },
    });
    expect(state.formBit).toBe(0);
    expect(state.skippedReviewDone).toBe(false);
    expect(state.responses).toEqual({ "process.search.1": "2", "scope.form.1": "skip" });
    expect(questions(state).itemIds).toContain("money.limit.1");
  });
});

// ---------------------------------------------------------------------------
// answer
// ---------------------------------------------------------------------------

describe("answer", () => {
  it("형식마다 완성된 답은 저장 상태로 responses 에, 화면 답은 drafts 에 들어가고 자동으로 넘어가지 않는다", () => {
    for (const formBit of [0, 1] as const) {
      const seenFormats = new Set<string>();
      let state = started(formBit);
      for (let guard = 0; guard < 80 && seenFormats.size < 7; guard += 1) {
        const current = page(state);
        if (current.kind === "questions") {
          for (const id of current.itemIds) {
            const target = item(id);
            const answer = completeAnswer(target, 3);
            const next = reduce(state, { type: "answer", itemId: id, answer });
            expect(next.responses[id]).toBe(toStored(target, formBit, answer));
            expect(next.drafts[id]).toEqual(answer);
            expect(next.pageIndex).toBe(state.pageIndex);
            expect(next.pages).toBe(state.pages);
            expect(viewAnswerOf(bank, next, id)).toEqual(answer);
            seenFormats.add(target.fmt);
          }
          state = reduce(answerPage(state), { type: "next" });
        } else {
          state = reduce(state, { type: "next" });
        }
      }
      expect([...seenFormats].sort()).toEqual(["bestworst", "instant", "pair", "react", "recall", "self", "split"]);
    }
  });

  it("어느 형식에서도 잘 모르겠어요와 제 상황과 안 맞아요는 skip 과 na 로 저장된다", () => {
    const state = started();
    for (const id of questions(state).itemIds) {
      expect(reduce(state, { type: "answer", itemId: id, answer: UNSURE }).responses[id]).toBe("skip");
      expect(reduce(state, { type: "answer", itemId: id, answer: NOT_APPLICABLE }).responses[id]).toBe("na");
    }
    const heavy = bank.items.find((entry) => entry.fmt === "bestworst")!;
    const there = playUntilPage(heavy.id);
    expect(reduce(there, { type: "answer", itemId: heavy.id, answer: UNSURE }).responses[heavy.id]).toBe("skip");
    const split = bank.items.find((entry) => entry.fmt === "split")!;
    expect(reduce(playUntilPage(split.id), { type: "answer", itemId: split.id, answer: NOT_APPLICABLE }).responses[split.id]).toBe("na");
  });

  function playUntilPage(id: ItemId, formBit: 0 | 1 = 0): FlowState {
    let state = started(formBit);
    for (let guard = 0; guard < 80; guard += 1) {
      const current = page(state);
      if (current.kind === "questions" && current.itemIds.includes(id)) return state;
      state = current.kind === "questions" ? reduce(answerPage(state), { type: "next" }) : reduce(state, { type: "next" });
    }
    throw new Error("찾지 못했다");
  }

  it("지금 화면에 없는 문항, 형식이 다른 답, 모양이 깨진 답은 무시하고 상태를 그대로 돌려준다", () => {
    const state = started();
    const [first] = questions(state).itemIds;
    const other = "scope.form.4";
    const react = item("process.search.1");
    expect(reduce(state, { type: "answer", itemId: other, answer: completeAnswer(item(other)) })).toBe(state);
    expect(reduce(state, { type: "answer", itemId: first, answer: { fmt: "split", counts: [2, 2, 2] } })).toBe(state);
    for (const bad of [null, undefined, 3, "pair", {}, { fmt: "react" }, { fmt: "react", cell: "1" }, { fmt: "react", cell: 9 }, { fmt: "react", cell: 1.5 }, { fmt: "bestworst", best: 1 }]) {
      expect(reduce(state, { type: "answer", itemId: react.id, answer: bad as unknown as ViewAnswer })).toBe(state);
    }
    for (const id of ["__proto__", "constructor", "toString", 5, null] as unknown[]) {
      expect(reduce(state, { type: "answer", itemId: id as string, answer: UNSURE })).toBe(state);
    }
  });

  it("다른 형식의 중간 상태도 받지 않는다(두 가지 중 고르기 문항에 칸 나누기나 가장·아닌 것의 중간 답)", () => {
    const state = started();
    const [pairId] = state.pages[state.pageIndex].kind === "questions" ? (questions(state).itemIds.filter((id) => item(id).fmt === "pair")) : [];
    const [reactId] = questions(state).itemIds.filter((id) => item(id).fmt === "react");
    expect(pairId).toBeDefined();
    expect(reactId).toBeDefined();
    for (const half of [{ fmt: "bestworst", best: 1, worst: null }, { fmt: "split", counts: [1, 1, 1] }, { fmt: "bestworst", best: null, worst: null }] as ViewAnswer[]) {
      expect(reduce(state, { type: "answer", itemId: pairId, answer: half })).toBe(state);
      expect(reduce(state, { type: "answer", itemId: reactId, answer: half })).toBe(state);
    }
    // 자기 선택 화면의 문항과 두 가지 중 고르기 답은 서로 다른 형식이다.
    const self = bank.items.find((entry) => entry.fmt === "self")!;
    const atSelf = { ...state, pageIndex: state.pages.findIndex((entry) => entry.kind === "questions" && entry.itemIds.includes(self.id)) };
    expect(reduce(atSelf, { type: "answer", itemId: self.id, answer: { fmt: "pair", cell: 1 } })).toBe(atSelf);
    expect(reduce(atSelf, { type: "answer", itemId: self.id, answer: { fmt: "self", cell: 1 } }).responses[self.id]).toBeDefined();
  });

  it("가장·아닌 것에서 하나만 고르면 중간 상태라 drafts 에만 남고, 둘 다 고르면 저장된다", () => {
    const heavy = bank.items.find((entry) => entry.fmt === "bestworst")!;
    const at = playUntilPage(heavy.id);
    const half = reduce(at, { type: "answer", itemId: heavy.id, answer: { fmt: "bestworst", best: 2, worst: null } });
    expect(half.responses[heavy.id]).toBeUndefined();
    expect(half.drafts[heavy.id]).toEqual({ fmt: "bestworst", best: 2, worst: null });
    expect(half.partialIds).toEqual([heavy.id]);
    expect(viewAnswerOf(bank, half, heavy.id)).toEqual({ fmt: "bestworst", best: 2, worst: null });
    const full = reduce(half, { type: "answer", itemId: heavy.id, answer: { fmt: "bestworst", best: 2, worst: 0 } });
    expect(full.responses[heavy.id]).toBeDefined();
    expect(full.partialIds).toEqual([]);
    // 완성해 둔 답을 한쪽만 다시 눌러 중간 상태로 만들어도 마지막 완성 값은 지워지지 않는다(화면은 중간 답을 보여 준다).
    const again = reduce(full, { type: "answer", itemId: heavy.id, answer: { fmt: "bestworst", best: 1, worst: null } });
    expect(again.responses[heavy.id]).toBe(full.responses[heavy.id]);
    expect(again.responses).toBe(full.responses);
    expect(again.partialIds).toEqual([heavy.id]);
    expect(viewAnswerOf(bank, again, heavy.id)).toEqual({ fmt: "bestworst", best: 1, worst: null });
    expect(reduce(at, { type: "answer", itemId: heavy.id, answer: { fmt: "bestworst", best: null, worst: null } }).drafts[heavy.id]).toEqual({ fmt: "bestworst", best: null, worst: null });
  });

  it("같은 카드를 가장과 가장 아닌 것에 함께 고른 답은 받지 않는다", () => {
    const heavy = bank.items.find((entry) => entry.fmt === "bestworst")!;
    const at = playUntilPage(heavy.id);
    expect(reduce(at, { type: "answer", itemId: heavy.id, answer: { fmt: "bestworst", best: 1, worst: 1 } })).toBe(at);
    expect(reduce(at, { type: "answer", itemId: heavy.id, answer: { fmt: "bestworst", best: 4, worst: null } })).toBe(at);
  });

  it("칸 나누기는 합이 6 미만이면 중간 상태, 6 이면 저장, 그 밖은 무시한다", () => {
    const split = bank.items.find((entry) => entry.fmt === "split")!;
    const at = playUntilPage(split.id, 1);
    const partial = reduce(at, { type: "answer", itemId: split.id, answer: { fmt: "split", counts: [2, 1, 0] } });
    expect(partial.responses[split.id]).toBeUndefined();
    expect(partial.drafts[split.id]).toEqual({ fmt: "split", counts: [2, 1, 0] });
    const done = reduce(partial, { type: "answer", itemId: split.id, answer: { fmt: "split", counts: [2, 1, 3] } });
    expect(done.responses[split.id]).toBe(toStored(split, 1, { fmt: "split", counts: [2, 1, 3] }));
    expect(reduce(at, { type: "answer", itemId: split.id, answer: { fmt: "split", counts: [4, 3, 0] } })).toBe(at);
    expect(reduce(at, { type: "answer", itemId: split.id, answer: { fmt: "split", counts: [-1, 3, 4] } })).toBe(at);
    expect(reduce(at, { type: "answer", itemId: split.id, answer: { fmt: "split", counts: [1.5, 1.5, 3] } })).toBe(at);
    expect(reduce(at, { type: "answer", itemId: split.id, answer: { fmt: "split", counts: [1, 1] } as unknown as ViewAnswer })).toBe(at);
  });

  it("호출자가 넘긴 답 객체를 나중에 바꿔도 상태는 그대로다", () => {
    const state = started();
    const [id] = questions(state).itemIds;
    const answer = { fmt: "react" as const, cell: 3 };
    const next = reduce(state, { type: "answer", itemId: id, answer: id === "process.search.1" ? answer : { fmt: "pair", cell: 3 } });
    (answer as { cell: number }).cell = 0;
    expect(next.drafts[id]).toMatchObject({ cell: 3 });
  });

  it("답을 고치면 notice 가 지워진다", () => {
    const state = started();
    const noticed = reduce(state, { type: "next" });
    expect(noticed.notice).not.toBeNull();
    const [id] = questions(state).itemIds;
    expect(reduce(noticed, { type: "answer", itemId: id, answer: completeAnswer(item(id)) }).notice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// next, back, notice
// ---------------------------------------------------------------------------

describe("next", () => {
  it("화면의 문항이 모두 답해지기 전에는 넘어가지 않고 빠진 문항이 든 notice incomplete 를 낸다", () => {
    const state = started();
    const ids = questions(state).itemIds;
    expect(ids).toHaveLength(2);
    const none = reduce(state, { type: "next" });
    expect(none.pageIndex).toBe(state.pageIndex);
    expect(none.notice).toEqual({ kind: "incomplete", itemIds: [...ids] });
    const one = reduce(reduce(state, { type: "answer", itemId: ids[1], answer: completeAnswer(item(ids[1])) }), { type: "next" });
    expect(one.pageIndex).toBe(state.pageIndex);
    expect(one.notice).toEqual({ kind: "incomplete", itemIds: [ids[0]] });
  });

  it("모두 답하면 다음 쪽으로 넘어가고 drafts 와 notice 를 비운다", () => {
    const state = answerPage(started());
    expect(Object.keys(state.drafts)).toHaveLength(2);
    const next = reduce(state, { type: "next" });
    expect(next.pageIndex).toBe(state.pageIndex + 1);
    expect(next.drafts).toEqual({});
    expect(next.notice).toBeNull();
  });

  it("칸을 다 놓지 않은 칸 나누기와 하나만 고른 가장·아닌 것은 넘어가지 않고 안내를 낸다", () => {
    for (const fmt of ["split", "bestworst"] as const) {
      const target = bank.items.find((entry) => entry.fmt === fmt)!;
      let state = started();
      for (let guard = 0; guard < 80 && !questions(state).itemIds.includes(target.id); guard += 1) state = reduce(answerPage(state), { type: "next" });
      const half: ViewAnswer = fmt === "split" ? { fmt: "split", counts: [1, 1, 1] } : { fmt: "bestworst", best: 0, worst: null };
      const drafted = reduce(state, { type: "answer", itemId: target.id, answer: half });
      const tried = reduce(drafted, { type: "next" });
      expect(tried.pageIndex).toBe(drafted.pageIndex);
      expect(tried.notice).toEqual({ kind: "incomplete", itemIds: [target.id] });
      expect(tried.drafts[target.id]).toEqual(half);
      const fixed = reduce(tried, { type: "answer", itemId: target.id, answer: completeAnswer(target, 5) });
      expect(fixed.notice).toBeNull();
      expect(reduce(fixed, { type: "next" }).pageIndex).toBe(drafted.pageIndex + 1);
    }
  });

  it("dismissNotice 는 notice 만 지운다", () => {
    const noticed = reduce(started(), { type: "next" });
    const cleared = reduce(noticed, { type: "dismissNotice" });
    expect(cleared.notice).toBeNull();
    expect({ ...cleared, notice: noticed.notice }).toEqual(noticed);
    expect(reduce(cleared, { type: "dismissNotice" })).toBe(cleared);
  });

  it("쉬는 카드와 마지막 정리 카드는 무조건 다음 쪽이고, 소개와 결과에서 다음은 무시된다", () => {
    const state = toResult();
    expect(reduce(state, { type: "next" })).toBe(state);
    const intro = initialFlowState(bank);
    expect(reduce(intro, { type: "next" })).toBe(intro);
    const rest = state.pages.findIndex((entry) => entry.kind === "rest");
    const atRest = { ...state, pageIndex: rest };
    expect(reduce(atRest, { type: "next" }).pageIndex).toBe(rest + 1);
    const selfIntro = state.pages.findIndex((entry) => entry.kind === "selfIntro");
    expect(reduce({ ...state, pageIndex: selfIntro }, { type: "next" }).pageIndex).toBe(selfIntro + 1);
  });

  it("끝까지 답하면 결과 쪽에 이르고 68개가 모두 저장값을 갖는다", () => {
    for (const pack of ["screen", "single"] as const) {
      const state = toResult(pack, 1);
      expect(allResolved(bank, state.responses)).toBe(true);
      expect(state.skippedReviewDone).toBe(false);
      const result = buildResult(bank, state.formBit, state.responses);
      expect(result.axes).toHaveLength(4);
    }
  });
});

describe("건너뛴 질문 다시 보기", () => {
  /** 정하는 사람 주제를 모두 잘 모르겠어요로 답한다(유효 답 0개). */
  const skipScope = (target: Item, n: number): ViewAnswer => (target.axis === "scope" ? UNSURE : completeAnswer(target, n));

  it("결과 직전에 유효 답이 12개 미만인 주제의 건너뛴 질문만 한 번 다시 보여 준다", () => {
    const state = playToEnd(started(), skipScope);
    const ids = bank.scoredByAxis.scope.map((entry) => entry.id);
    expect(state.filter).toEqual({ kind: "skipped", itemIds: ids });
    expect(state.skippedReviewDone).toBe(true);
    expect(state.notice).toEqual({ kind: "skippedReview", itemIds: ids });
    expect(state.pageIndex).toBe(0);
    expect(state.pages.flatMap((entry) => (entry.kind === "questions" ? entry.itemIds : []))).toEqual(ids);
    expect(kindsOf(state.pages).every((kind) => kind === "questions")).toBe(true);
    expect(placementOf(state)).toBe("edit");
  });

  it("다시 본 뒤 필터의 마지막 쪽에서 다음은 필터를 닫고 결과로 간다(두 번 보여 주지 않는다)", () => {
    let state = playToEnd(started(), skipScope);
    expect(state.filter?.kind).toBe("skipped");
    for (let guard = 0; guard < 40 && state.filter !== null; guard += 1) {
      state = reduce(answerPage(state, (target, n) => completeAnswer(target, n)), { type: "next" });
    }
    expect(state.filter).toBeNull();
    expect(page(state).kind).toBe("result");
    expect(state.pages).toEqual(buildPages(bank));
    expect(state.skippedReviewDone).toBe(true);
    expect(allResolved(bank, state.responses)).toBe(true);
  });

  it("그대로 넘겨도 한 번뿐이고 결과 쪽에서 끝난다", () => {
    let state = playToEnd(started(), skipScope);
    for (let guard = 0; guard < 40 && state.filter !== null; guard += 1) {
      state = reduce(answerPage(state, () => UNSURE), { type: "next" });
    }
    expect(state.filter).toBeNull();
    expect(page(state).kind).toBe("result");
    const result = buildResult(bank, state.formBit, state.responses);
    expect(result.axes[2].unusable).toBe(true);
    expect(result.code?.[2]).toBe("·");
  });

  it("다시 본 뒤 그대로 두고 결과에서 뒤로 갔다가 다시 다음을 눌러도 두 번째로 보여 주지 않는다", () => {
    let state = playToEnd(started(), skipScope);
    for (let guard = 0; guard < 40 && state.filter !== null; guard += 1) state = reduce(answerPage(state, () => UNSURE), { type: "next" });
    expect(page(state).kind).toBe("result");
    const back = reduce(state, { type: "back" });
    expect(page(back).kind).toBe("questions");
    const again = reduce(back, { type: "next" });
    expect(again.filter).toBeNull();
    expect(page(again).kind).toBe("result");
    expect(skippedReviewIds(bank, again.responses).length).toBeGreaterThan(0);
  });

  it("건너뛴 질문이 없거나 na 뿐이면 다시 보여 주지 않는다", () => {
    const naOnly = playToEnd(started(), (target, n) => (target.axis === "scope" ? NOT_APPLICABLE : completeAnswer(target, n)));
    expect(page(naOnly).kind).toBe("result");
    expect(naOnly.filter).toBeNull();
  });

  it("skippedReviewIds 는 유효 답이 12개 미만인 주제의 skip 문항만 질문 순서로 낸다", () => {
    const byName = (name: string) => V40_FIXTURES.find((fixture) => fixture.name === name)!;
    expect(skippedReviewIds(bank, byName("swua-example").responses)).toEqual([]);
    expect(skippedReviewIds(bank, byName("all-clear").responses)).toEqual([]);
    const unusable = skippedReviewIds(bank, byName("unusable-axis").responses);
    expect(unusable).toEqual(["scope.circle.1", "scope.timing.3", "scope.timing.4", "scope.circle.4"]);
    const order = unusable.map((id) => bank.codeIndexById.get(id) ?? -1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const id of unusable) expect(byName("unusable-axis").responses[id]).toBe("skip");
    expect(skippedReviewIds(bank, {})).toEqual(bank.scored.filter(() => false).map((entry) => entry.id));
  });

  it("유효 답이 12개 이상인 주제의 건너뜀은 다시 보여 주지 않는다", () => {
    const responses = { ...V40_FIXTURES.find((fixture) => fixture.name === "all-clear")!.responses };
    for (const entry of bank.scoredByAxis.money.slice(0, 4)) responses[entry.id] = "skip";
    expect(skippedReviewIds(bank, responses)).toEqual([]);
    responses[bank.scoredByAxis.money[4].id] = "skip";
    expect(skippedReviewIds(bank, responses)).toEqual(bank.scoredByAxis.money.slice(0, 5).map((entry) => entry.id));
  });
});

describe("back", () => {
  it("첫 질문 화면에서는 무시되어 소개로 돌아가지 않는다", () => {
    const state = started();
    expect(reduce(state, { type: "back" })).toBe(state);
  });

  it("한 쪽 앞으로 가고 drafts 와 notice 를 비운다(쉬는 카드도 지나간다)", () => {
    let state = started();
    for (let step = 0; step < 10; step += 1) state = reduce(answerPage(state), { type: "next" });
    expect(page(state).kind).toBe("rest");
    const back = reduce(state, { type: "back" });
    expect(back.pageIndex).toBe(state.pageIndex - 1);
    expect(page(back).kind).toBe("questions");
    expect(back.notice).toBeNull();
    const again = reduce(back, { type: "back" });
    expect(again.pageIndex).toBe(back.pageIndex - 1);
  });

  it("고친 답은 남고 답을 지우지 않는다", () => {
    let state = started();
    state = reduce(answerPage(state), { type: "next" });
    const before = state.responses;
    const back = reduce(state, { type: "back" });
    expect(back.responses).toEqual(before);
    expect(viewAnswerOf(bank, back, questions(back).itemIds[0])).not.toBeNull();
  });

  it("결과에서는 마지막 질문 화면으로 돌아간다", () => {
    const state = toResult();
    const back = reduce(state, { type: "back" });
    expect(back.pageIndex).toBe(state.pageIndex - 1);
    expect(questions(back).screen).toBe(V40_COUNTS.screens - 1);
  });

  it("마지막 화면에서 답을 고치고 다음을 누르면 결과로 다시 간다(건너뛴 질문 다시 보기는 한 번뿐)", () => {
    const state = toResult();
    const back = reduce(state, { type: "back" });
    const ids = questions(back).itemIds;
    const fixed = reduce(back, { type: "answer", itemId: ids[0], answer: completeAnswer(item(ids[0]), 4) });
    expect(page(reduce(fixed, { type: "next" })).kind).toBe("result");
  });
});

// ---------------------------------------------------------------------------
// 필터
// ---------------------------------------------------------------------------

describe("openFilter와 closeFilter", () => {
  it("이 주제 답 다시 보기는 그 주제 16개를 질문 순서로 여는 필터다", () => {
    const state = toResult();
    for (const axis of V40_AXIS_KEYS) {
      const opened = reduce(state, { type: "openFilter", filter: { kind: "axis", axis } });
      expect(opened.filter).toEqual({ kind: "axis", axis });
      expect(opened.pageIndex).toBe(0);
      expect(opened.pages.flatMap((entry) => (entry.kind === "questions" ? entry.itemIds : []))).toEqual(bank.scoredByAxis[axis].map((entry) => entry.id));
      expect(opened.responses).toBe(state.responses);
      expect(opened.skippedReviewDone).toBe(state.skippedReviewDone);
    }
  });

  it("필터 흐름에서 고친 답은 저장되고 마지막 쪽에서 다음은 필터를 닫고 결과로 간다", () => {
    let state = reduce(toResult(), { type: "openFilter", filter: { kind: "axis", axis: "money" } });
    const first = questions(state).itemIds[0];
    state = reduce(state, { type: "answer", itemId: first, answer: UNSURE });
    expect(state.responses[first]).toBe("skip");
    for (let guard = 0; guard < 40 && state.filter !== null; guard += 1) state = reduce(answerPage(state), { type: "next" });
    expect(state.filter).toBeNull();
    expect(page(state).kind).toBe("result");
    expect(state.responses[first]).not.toBe("skip");
  });

  it("필터의 첫 쪽에서 뒤로는 필터를 닫고 결과로 간다", () => {
    const opened = reduce(toResult(), { type: "openFilter", filter: { kind: "axis", axis: "scope" } });
    const closed = reduce(opened, { type: "back" });
    expect(closed.filter).toBeNull();
    expect(page(closed).kind).toBe("result");
    const second = reduce(reduce(answerPage(opened), { type: "next" }), { type: "back" });
    expect(second.pageIndex).toBe(0);
    expect(second.filter).not.toBeNull();
  });

  it("closeFilter 는 필터와 drafts 를 비우고 전체 흐름의 결과로 돌아간다", () => {
    const opened = reduce(toResult("single"), { type: "openFilter", filter: { kind: "axis", axis: "process" } });
    const drafted = reduce(opened, { type: "answer", itemId: questions(opened).itemIds[0], answer: UNSURE });
    expect(Object.keys(drafted.drafts)).toHaveLength(1);
    const closed = reduce(drafted, { type: "closeFilter" });
    expect(closed.filter).toBeNull();
    expect(closed.drafts).toEqual({});
    expect(closed.pack).toBe("single");
    expect(page(closed).kind).toBe("result");
    expect(closed.pages).toHaveLength(74);
    expect(reduce(closed, { type: "closeFilter" })).toBe(closed);
  });

  it("68개가 모두 답해지지 않았으면 closeFilter 는 첫 미답 질문 화면으로 간다", () => {
    let state = started();
    state = reduce(answerPage(state), { type: "next" });
    const opened = reduce(state, { type: "openFilter", filter: { kind: "axis", axis: "money" } });
    const closed = reduce(opened, { type: "closeFilter" });
    expect(closed.filter).toBeNull();
    expect(page(closed).kind).toBe("questions");
    expect(closed.pageIndex).toBe(state.pageIndex);
  });

  it("건너뛴 질문 필터는 주어진 문항만 열고 다시 보여 주기를 마친 것으로 센다", () => {
    const state = toResult();
    const opened = reduce(state, { type: "openFilter", filter: { kind: "skipped", itemIds: ["scope.form.4", "money.limit.1", "nope"] } });
    expect(opened.filter).toEqual({ kind: "skipped", itemIds: ["money.limit.1", "scope.form.4"] });
    expect(opened.skippedReviewDone).toBe(true);
  });

  it("잘못된 필터는 무시한다", () => {
    const state = toResult();
    for (const filter of [null, {}, { kind: "axis", axis: "nope" }, { kind: "axis" }, { kind: "skipped", itemIds: [] }, { kind: "skipped", itemIds: ["nope"] }, { kind: "skipped", itemIds: "money.limit.1" }, { kind: "other" }]) {
      expect(reduce(state, { type: "openFilter", filter: filter as never })).toBe(state);
    }
  });

  it("필터 흐름의 낭독 진행은 그 문항의 구간을 가리킨다", () => {
    const opened = reduce(toResult(), { type: "openFilter", filter: { kind: "axis", axis: "support" } });
    const segments = progressSegments(bank, opened);
    const current = segments.filter((segment) => segment.current);
    expect(current).toHaveLength(1);
    expect(current[0].index).toBe(questions(opened).section);
  });

  it("넘어간 질문 다시 보기에서는 어느 칸도 지금이 아니다(첫 문항의 구간 이름을 붙이면 처음으로 돌아간 것처럼 읽힌다)", () => {
    const skippedIds = ["money.limit.1", "scope.form.2"];
    const opened = reduce(toResult(), { type: "openFilter", filter: { kind: "skipped", itemIds: skippedIds } });
    expect(opened.filter?.kind).toBe("skipped");
    const segments = progressSegments(bank, opened);
    expect(segments.some((segment) => segment.current)).toBe(false);
    // 막대가 차오른 정도는 그대로다(문항 기준)
    expect(segments.every((segment) => segment.done === segment.total)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// repack, restart
// ---------------------------------------------------------------------------

describe("repack", () => {
  it("지금 쪽의 첫 문항이 든 쪽으로 이어진다(screen 에서 single 로, 다시 돌아와도)", () => {
    let state = started();
    for (let step = 0; step < 3; step += 1) state = reduce(answerPage(state), { type: "next" });
    const firstId = questions(state).itemIds[0];
    const single = reduce(state, { type: "repack", pack: "single" });
    expect(single.pack).toBe("single");
    expect(single.pages).toHaveLength(74);
    expect(questions(single).itemIds).toEqual([firstId]);
    const secondOfScreen = questions(state).itemIds[1];
    const advanced = reduce(reduce(single, { type: "answer", itemId: firstId, answer: completeAnswer(item(firstId)) }), { type: "next" });
    if (secondOfScreen) expect(questions(advanced).itemIds).toEqual([secondOfScreen]);
    const back = reduce(advanced, { type: "repack", pack: "screen" });
    expect(questions(back).itemIds).toContain(questions(advanced).itemIds[0]);
    expect(back.responses).toEqual(advanced.responses);
  });

  it("질문 화면이 아니면 같은 key 의 쪽으로 이어진다", () => {
    const state = toResult();
    const single = reduce(state, { type: "repack", pack: "single" });
    expect(page(single).kind).toBe("result");
    let atRest = started();
    for (let step = 0; step < 10; step += 1) atRest = reduce(answerPage(atRest), { type: "next" });
    const moved = reduce(atRest, { type: "repack", pack: "single" });
    expect(page(moved)).toEqual({ kind: "rest", key: "rest:0", after: 0 });
    const beforeStart = reduce(initialFlowState(bank), { type: "repack", pack: "single" });
    expect(page(beforeStart).kind).toBe("intro");
    expect(beforeStart.started).toBe(false);
  });

  it("필터 흐름에서도 그 필터의 문항을 유지한 채 묶음을 바꾼다", () => {
    const opened = reduce(toResult(), { type: "openFilter", filter: { kind: "axis", axis: "money" } });
    const single = reduce(opened, { type: "repack", pack: "single" });
    expect(single.filter).toEqual({ kind: "axis", axis: "money" });
    expect(single.pages.flatMap((entry) => (entry.kind === "questions" ? entry.itemIds : []))).toEqual(bank.scoredByAxis.money.map((entry) => entry.id));
  });

  it("같은 묶음이거나 잘못된 묶음이면 상태를 그대로 돌려준다", () => {
    const state = started();
    expect(reduce(state, { type: "repack", pack: "screen" })).toBe(state);
    expect(reduce(state, { type: "repack", pack: "many" as unknown as PagePack })).toBe(state);
  });

  it("지금 쪽의 중간 답과 안내는 새 쪽에 남을 때만 이어진다", () => {
    const heavy = bank.items.find((entry) => entry.fmt === "bestworst")!;
    let state = started();
    for (let guard = 0; guard < 80 && !questions(state).itemIds.includes(heavy.id); guard += 1) state = reduce(answerPage(state), { type: "next" });
    const drafted = reduce(state, { type: "answer", itemId: heavy.id, answer: { fmt: "bestworst", best: 3, worst: null } });
    const noticed = reduce(drafted, { type: "next" });
    const single = reduce(noticed, { type: "repack", pack: "single" });
    expect(single.drafts[heavy.id]).toEqual({ fmt: "bestworst", best: 3, worst: null });
    expect(single.notice).toEqual(noticed.notice);
    const twoItems = started();
    const partial = reduce(reduce(twoItems, { type: "answer", itemId: questions(twoItems).itemIds[0], answer: completeAnswer(item(questions(twoItems).itemIds[0])) }), { type: "next" });
    const moved = reduce(partial, { type: "repack", pack: "single" });
    expect(moved.notice).toBeNull();
    expect(Object.keys(moved.drafts)).toEqual([questions(twoItems).itemIds[0]]);
  });
});

describe("restart", () => {
  it("답, 폼 비트, 필터, 안내를 지우고 소개로 가며 묶음은 유지한다", () => {
    const state = reduce(toResult("single", 1), { type: "openFilter", filter: { kind: "axis", axis: "money" } });
    const fresh = reduce(state, { type: "restart" });
    expect(fresh).toEqual(initialFlowState(bank, { pack: "single" }));
    expect(fresh.started).toBe(false);
    expect(fresh.formBit).toBe(0);
    expect(page(fresh).kind).toBe("intro");
  });
});

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

describe("viewAnswerOf", () => {
  it("drafts 의 화면 답을 먼저 보이고 없으면 저장값을 화면 답으로 바꾼다", () => {
    const state = started(1);
    const [id] = questions(state).itemIds;
    expect(viewAnswerOf(bank, state, id)).toBeNull();
    const answered = reduce(state, { type: "answer", itemId: id, answer: completeAnswer(item(id), 2) });
    expect(viewAnswerOf(bank, answered, id)).toEqual(completeAnswer(item(id), 2));
    const next = reduce(reduce(answered, { type: "answer", itemId: questions(state).itemIds[1], answer: completeAnswer(item(questions(state).itemIds[1]), 1) }), { type: "next" });
    expect(next.drafts).toEqual({});
    expect(viewAnswerOf(bank, next, id)).toEqual(completeAnswer(item(id), 2));
    expect(viewAnswerOf(bank, next, "no.such.item")).toBeNull();
    expect(viewAnswerOf(bank, next, "__proto__")).toBeNull();
  });

  it("건너뜀과 해당 없음은 넘기기 답으로 보인다", () => {
    const state = started();
    const [id] = questions(state).itemIds;
    expect(viewAnswerOf(bank, reduce(state, { type: "answer", itemId: id, answer: NOT_APPLICABLE }), id)).toEqual(NOT_APPLICABLE);
  });
});

describe("progressSegments와 placementOf", () => {
  it("다섯 칸은 구간 16, 16, 16, 16과 마지막 정리 4개이고 done 은 저장값이 있는 문항 수다", () => {
    const fresh = progressSegments(bank, initialFlowState(bank));
    expect(fresh.map((segment) => segment.total)).toEqual([16, 16, 16, 16, 4]);
    expect(fresh.map((segment) => segment.name)).toEqual(["처음", "이어서", "조금만 더", "마지막 구간", "마지막 정리"]);
    expect(fresh.every((segment) => segment.done === 0 && !segment.current)).toBe(true);
    let state = started();
    for (let step = 0; step < 4; step += 1) state = reduce(answerPage(state), { type: "next" });
    const segments = progressSegments(bank, state);
    expect(segments[0].done).toBe(Object.keys(state.responses).length);
    expect(segments[0].current).toBe(true);
    const done = toResult();
    expect(progressSegments(bank, done).map((segment) => segment.done)).toEqual([16, 16, 16, 16, 4]);
    expect(progressSegments(bank, done).some((segment) => segment.current)).toBe(false);
  });

  it("current 는 지금 쪽의 구간이다(쉬는 카드는 방금 끝낸 구간, 마지막 정리 카드는 마지막 정리)", () => {
    const state = toResult();
    state.pages.forEach((entry, index) => {
      const segments = progressSegments(bank, { ...state, pageIndex: index });
      const current = segments.findIndex((segment) => segment.current);
      if (entry.kind === "questions") expect(current).toBe(entry.section);
      else if (entry.kind === "rest") expect(current).toBe(entry.after);
      else if (entry.kind === "selfIntro") expect(current).toBe(4);
      else expect(current).toBe(-1);
    });
  });

  it("placement 는 소개 intro, 구간 c1에서 c4, 자기 선택 self, 결과 result, 필터 edit 이다", () => {
    const state = toResult();
    const names = state.pages.map((entry, index) => placementOf({ ...state, pageIndex: index }));
    expect(names[0]).toBe("intro");
    expect(names.slice(1, 11)).toEqual(Array(10).fill("c1"));
    expect(names[11]).toBe("c1");
    expect(names.slice(12, 22)).toEqual(Array(10).fill("c2"));
    expect(names.slice(23, 33)).toEqual(Array(10).fill("c3"));
    expect(names.slice(34, 44)).toEqual(Array(10).fill("c4"));
    expect(names.slice(44, 47)).toEqual(["self", "self", "self"]);
    expect(names[47]).toBe("result");
    expect(placementOf(initialFlowState(bank))).toBe("intro");
    expect(placementOf(reduce(state, { type: "openFilter", filter: { kind: "axis", axis: "money" } }))).toBe("edit");
  });
});

describe("snapshotOf", () => {
  it("시작 전에는 null 이다", () => {
    expect(snapshotOf(bank, initialFlowState(bank))).toBeNull();
  });

  it("질문 화면에서는 그 쪽의 첫 문항 코드 색인이다(쉬는 카드와 마지막 정리 카드는 다음 질문 화면)", () => {
    const state = started(1);
    expect(snapshotOf(bank, state)).toEqual({ formBit: 1, responses: {}, screen: "questions", cursor: 0, skippedReviewDone: false });
    const moved = reduce(answerPage(state), { type: "next" });
    const snapshot = snapshotOf(bank, moved);
    expect(snapshot?.cursor).toBe(bank.codeIndexById.get(questions(moved).itemIds[0]));
    let atRest = started();
    for (let step = 0; step < 10; step += 1) atRest = reduce(answerPage(atRest), { type: "next" });
    expect(page(atRest).kind).toBe("rest");
    expect(snapshotOf(bank, atRest)?.cursor).toBe(bank.codeIndexById.get(questions({ ...atRest, pageIndex: atRest.pageIndex + 1 }).itemIds[0]));
    const selfIntro = toResult().pages.findIndex((entry) => entry.kind === "selfIntro");
    const atSelf = { ...toResult(), pageIndex: selfIntro };
    expect(snapshotOf(bank, atSelf)?.cursor).toBe(bank.codeIndexById.get("self.money"));
  });

  it("결과에서는 result 와 cursor 0, 필터 흐름에서도 모두 답했으면 result 다", () => {
    const state = toResult(undefined, 1);
    expect(snapshotOf(bank, state)).toMatchObject({ screen: "result", cursor: 0, formBit: 1 });
    expect(snapshotOf(bank, reduce(state, { type: "openFilter", filter: { kind: "axis", axis: "money" } }))).toMatchObject({ screen: "result", cursor: 0 });
  });

  it("필터 흐름에서 미답이 남았으면 첫 미답 화면 기준이다", () => {
    let state = started();
    state = reduce(answerPage(state), { type: "next" });
    const opened = reduce(state, { type: "openFilter", filter: { kind: "axis", axis: "scope" } });
    expect(snapshotOf(bank, opened)).toMatchObject({ screen: "questions", cursor: bank.codeIndexById.get(questions(state).itemIds[0]) });
  });

  it("결과 쪽에 있어도 저장값이 모자라면(있을 수 없는 상태) result 라고 하지 않고 첫 미답 화면을 가리킨다", () => {
    const done = toResult();
    const missing = { ...done.responses };
    delete missing["scope.form.4"];
    const forged: FlowState = { ...done, responses: missing };
    const target = done.pages.find((entry): entry is QuestionsPage => entry.kind === "questions" && entry.itemIds.includes("scope.form.4"));
    expect(snapshotOf(bank, forged)).toMatchObject({ screen: "questions", cursor: bank.codeIndexById.get(target?.itemIds[0] ?? "") });
  });

  it("모두 답한 뒤 앞 화면으로 돌아가 고치는 중이면 questions 와 그 쪽이다", () => {
    const back = reduce(toResult(), { type: "back" });
    expect(snapshotOf(bank, back)).toMatchObject({ screen: "questions", cursor: bank.codeIndexById.get(questions(back).itemIds[0]) });
  });

  it("스냅샷은 중간 상태(drafts)를 담지 않고 진행 저장 표기로 바꿀 수 있다", () => {
    const heavy = bank.items.find((entry) => entry.fmt === "bestworst")!;
    let state = started();
    for (let guard = 0; guard < 80 && !questions(state).itemIds.includes(heavy.id); guard += 1) state = reduce(answerPage(state), { type: "next" });
    const drafted = reduce(state, { type: "answer", itemId: heavy.id, answer: { fmt: "bestworst", best: 1, worst: null } });
    const snapshot = snapshotOf(bank, drafted);
    expect(snapshot?.responses[heavy.id]).toBeUndefined();
    expect(encodeProgressAnswers(bank, snapshot?.responses ?? {})).not.toBeNull();
  });

  it("스냅샷으로 이어 하면 같은 자리에서 같은 답으로 다시 시작한다(왕복)", () => {
    for (const pack of ["screen", "single"] as const) {
      let state = started(1, pack);
      for (let step = 0; step < 40; step += 1) {
        const snapshot = snapshotOf(bank, state);
        const resumed = initialFlowState(bank, { pack, snapshot: snapshot ?? undefined });
        expect(resumed.responses).toEqual(state.responses);
        expect(resumed.formBit).toBe(1);
        const now = page(state);
        if (now.kind === "questions") expect(page(resumed)).toEqual(now);
        else if (now.kind === "result") expect(page(resumed).kind).toBe("result");
        else expect(page(resumed)).toEqual(state.pages[state.pageIndex + 1]);
        state = now.kind === "questions" ? reduce(answerPage(state), { type: "next" }) : reduce(state, { type: "next" });
      }
    }
  });
});

describe("allResolved", () => {
  it("68개 문항이 모두 그 형식의 저장값일 때만 참이다", () => {
    const full = V40_FIXTURES[0].responses;
    expect(allResolved(bank, full)).toBe(true);
    const missing = { ...full };
    delete missing["scope.form.4"];
    expect(allResolved(bank, missing)).toBe(false);
    expect(allResolved(bank, { ...full, "money.limit.1": "9" })).toBe(false);
    expect(allResolved(bank, {})).toBe(false);
    for (const fixture of V40_FIXTURES) expect(allResolved(bank, fixture.responses)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 무작위 행동열: 어떤 순서로 눌러도 불변식이 지켜진다
// ---------------------------------------------------------------------------

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

function checkInvariants(state: FlowState, label: string): void {
  const where = `[${label}]`;
  expect(state.pageIndex, where).toBeGreaterThanOrEqual(0);
  expect(state.pageIndex, where).toBeLessThan(state.pages.length);
  const current = page(state);
  if (!state.started) {
    expect(state.pageIndex, where).toBe(0);
    expect(current.kind, where).toBe("intro");
    expect(state.filter, where).toBeNull();
    expect(state.responses, where).toEqual({});
  }
  for (const [id, value] of Object.entries(state.responses)) {
    const target = bank.byId.get(id);
    expect(target, `${where} 알 수 없는 문항 ${id}`).toBeDefined();
    expect(target !== undefined && isResponseValueFor(target.fmt, value), `${where} ${id}=${value}`).toBe(true);
  }
  const onPage = current.kind === "questions" ? current.itemIds : [];
  const partial: string[] = [];
  for (const [id, draft] of Object.entries(state.drafts)) {
    expect(onPage, `${where} drafts ${id} 는 지금 화면의 문항이어야 한다`).toContain(id);
    const target = item(id);
    // 완성된 화면 답은 그대로 저장값이다. 중간 상태의 화면 답은 저장값을 건드리지 않는다(이미 있던 값이 남거나 계속 비어 있다).
    if (isViewAnswerComplete(target, draft)) expect(state.responses[id], where).toBe(toStored(target, state.formBit, draft) ?? "never");
    else partial.push(id);
  }
  expect([...state.partialIds].sort(), `${where} partialIds 는 중간 상태인 화면 답과 정확히 같다`).toEqual(partial.sort());
  expect(state.filter === null, `${where} filterOrigin 은 필터가 있을 때만 있다`).toBe(state.filterOrigin === null);
  if (state.filter === null) {
    expect(state.pages, where).toEqual(buildPages(bank, { pack: state.pack }));
    expect(state.skippedReviewDone || state.notice?.kind !== "skippedReview", where).toBe(true);
  } else {
    expect(state.pages.every((entry) => entry.kind === "questions"), where).toBe(true);
    const ids = state.pages.flatMap((entry) => (entry.kind === "questions" ? entry.itemIds : []));
    const wanted = state.filter.kind === "axis" ? bank.scoredByAxis[state.filter.axis].map((entry) => entry.id) : state.filter.itemIds;
    expect(ids, where).toEqual(wanted);
    expect(state.pages, where).toEqual(buildPages(bank, { only: wanted, pack: state.pack }));
    if (state.filter.kind === "skipped") expect(state.skippedReviewDone, where).toBe(true);
  }
  if (current.kind === "result") {
    expect(state.filter, where).toBeNull();
    expect(allResolved(bank, state.responses), `${where} 결과 쪽인데 미답이 있다`).toBe(true);
  }
  const notice = state.notice;
  if (notice?.kind === "incomplete") {
    expect(notice.itemIds.length, where).toBeGreaterThan(0);
    for (const id of notice.itemIds) {
      expect(onPage, where).toContain(id);
      // 저장값이 없거나, 저장값은 있어도 지금 화면 답이 중간 상태여서 넘어가지 못한 문항이다.
      expect(state.responses[id] === undefined || state.partialIds.includes(id), `${where} ${id}`).toBe(true);
    }
  }
  if (notice?.kind === "skippedReview") expect(state.filter?.kind, where).toBe("skipped");
  const segments = progressSegments(bank, state);
  expect(segments.reduce((sum, segment) => sum + segment.done, 0), where).toBe(Object.keys(state.responses).length);
  for (const segment of segments) expect(segment.done, where).toBeLessThanOrEqual(segment.total);
  expect(segments.filter((segment) => segment.current).length, where).toBeLessThanOrEqual(1);
  const snapshot = snapshotOf(bank, state);
  expect(snapshot === null, where).toBe(!state.started);
  if (snapshot !== null) {
    expect(snapshot.cursor, where).toBeGreaterThanOrEqual(0);
    expect(snapshot.cursor, where).toBeLessThan(bank.items.length);
    if (snapshot.screen === "result") expect(allResolved(bank, snapshot.responses), where).toBe(true);
    expect(encodeProgressAnswers(bank, snapshot.responses), where).not.toBeNull();
  }
  expect(["intro", "c1", "c2", "c3", "c4", "self", "result", "edit"], where).toContain(placementOf(state));
}

function randomAction(rng: () => number, state: FlowState): FlowAction {
  const roll = rng();
  const current = page(state);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  if (roll < 0.34 && current.kind === "questions") {
    const id = pick(current.itemIds);
    const target = item(id);
    const kind = rng();
    if (kind < 0.1) return { type: "answer", itemId: id, answer: pick([UNSURE, NOT_APPLICABLE]) };
    if (kind < 0.25 && target.fmt === "bestworst") return { type: "answer", itemId: id, answer: { fmt: "bestworst", best: pick([null, 0, 1, 2, 3]), worst: pick([null, 0, 1, 2, 3]) } };
    if (kind < 0.25 && target.fmt === "split") return { type: "answer", itemId: id, answer: { fmt: "split", counts: [Math.floor(rng() * 5), Math.floor(rng() * 4), Math.floor(rng() * 3)] } };
    if (kind < 0.3) return { type: "answer", itemId: id, answer: completeAnswer(pick(bank.items), Math.floor(rng() * 30)) };
    return { type: "answer", itemId: id, answer: completeAnswer(target, Math.floor(rng() * 30)) };
  }
  if (roll < 0.4) return { type: "answer", itemId: pick(bank.items).id, answer: completeAnswer(pick(bank.items), Math.floor(rng() * 30)) };
  if (roll < 0.62) return { type: "next" };
  if (roll < 0.7) return { type: "back" };
  if (roll < 0.74) return { type: "openFilter", filter: pick([{ kind: "axis", axis: pick(V40_AXIS_KEYS) as Axis }, { kind: "skipped", itemIds: [pick(bank.items).id, pick(bank.items).id] }] as const) };
  if (roll < 0.78) return { type: "closeFilter" };
  if (roll < 0.83) return { type: "repack", pack: pick(["screen", "single"] as const) };
  if (roll < 0.86) return { type: "dismissNotice" };
  if (roll < 0.87) return { type: "restart" };
  if (roll < 0.9) return { type: "start", formBit: pick([0, 1] as const) };
  if (roll < 0.95) return { type: "next" };
  return pick([{ type: "bogus" }, null, undefined, 7, { type: "answer" }, { type: "openFilter" }, { type: "repack", pack: 3 }] as unknown[]) as FlowAction;
}

/** 지금 화면을 성실하게 채우고 다음을 누르는 행동 묶음(무작위 행동열이 깊은 화면까지 가도록). */
function pageMacro(rng: () => number, state: FlowState, scopeSkipRate: number): FlowAction[] {
  const current = page(state);
  if (current.kind !== "questions") return [{ type: "next" }];
  const actions: FlowAction[] = current.itemIds.map((id) => {
    const target = item(id);
    if (target.axis === "scope" && rng() < scopeSkipRate) return { type: "answer", itemId: id, answer: UNSURE };
    if (rng() < 0.06) return { type: "answer", itemId: id, answer: NOT_APPLICABLE };
    return { type: "answer", itemId: id, answer: completeAnswer(target, Math.floor(rng() * 40)) };
  });
  return [...actions, { type: "next" }];
}

describe("무작위 행동열", () => {
  it("어떤 행동을 어떤 순서로 해도 던지지 않고 불변식이 지켜진다(입력 상태는 바뀌지 않는다)", () => {
    const seen = { actions: 0, result: 0, filtered: 0, skippedReview: 0, incomplete: 0, partial: 0, repacked: 0, restarted: 0, rest: 0 };
    for (let seed = 1; seed <= 60; seed += 1) {
      const rng = mulberry32(seed * 7919);
      let state: FlowState = deepFreeze(initialFlowState(bank, { pack: seed % 3 === 0 ? "single" : "screen" }));
      let lockedFormBit: 0 | 1 | null = null;
      let step = 0;
      while (step < 500) {
        const actions = rng() < 0.25 ? pageMacro(rng, state, seed % 4 === 0 ? 0.7 : 0.05) : [randomAction(rng, state)];
        for (const action of actions) {
          const before = JSON.stringify(state);
          const next = reduce(state, action);
          expect(JSON.stringify(state), `seed ${seed} step ${step}: 입력 상태가 바뀌었다`).toBe(before);
          expect(reduce(state, action), `seed ${seed} step ${step}: 같은 입력에 같은 상태`).toEqual(next);
          const typed = action !== null && typeof action === "object" ? action : null;
          if (typed?.type === "answer" && next !== state) {
            expect(next.pageIndex, "답해도 자동으로 넘어가지 않는다").toBe(state.pageIndex);
            expect(next.pages).toBe(state.pages);
          }
          if (typed?.type !== "restart") {
            const lost = Object.keys(state.responses).filter((id) => next.responses[id] === undefined);
            expect(lost, `seed ${seed} step ${step}: 한 번 완성한 답은 restart 밖에서 사라지지 않는다`).toEqual([]);
          }
          if (next.started && lockedFormBit !== null && typed?.type !== "restart") expect(next.formBit, "시작한 뒤 폼 비트는 바뀌지 않는다").toBe(lockedFormBit);
          lockedFormBit = next.started ? next.formBit : null;
          if (typed?.type === "repack" && next.pack !== state.pack) seen.repacked += 1;
          if (typed?.type === "restart" && state.started) seen.restarted += 1;
          state = deepFreeze(next);
          checkInvariants(state, `seed ${seed} step ${step}`);
          step += 1;
          seen.actions += 1;
          if (page(state).kind === "result") seen.result += 1;
          if (page(state).kind === "rest") seen.rest += 1;
          if (state.filter !== null) seen.filtered += 1;
          if (state.notice?.kind === "skippedReview") seen.skippedReview += 1;
          if (state.notice?.kind === "incomplete") seen.incomplete += 1;
          if (Object.entries(state.drafts).some(([id, draft]) => !isViewAnswerComplete(item(id), draft))) seen.partial += 1;
        }
      }
    }
    // 무작위 열이 각 갈래를 실제로 지나갔는지 센다(지나가지 않았다면 이 시험은 그 갈래를 지키지 못한 것이다).
    expect(seen.actions).toBeGreaterThanOrEqual(30000);
    for (const [name, count] of Object.entries(seen)) expect(count, `무작위 열이 ${name} 갈래를 지나가지 않았다`).toBeGreaterThan(0);
  }, 60_000);

  it("성실하게 답하는 무작위 흐름은 반드시 결과에 이른다", () => {
    let reached = 0;
    for (let seed = 1; seed <= 25; seed += 1) {
      const rng = mulberry32(seed * 104729);
      let state: FlowState = initialFlowState(bank, { pack: seed % 2 === 0 ? "single" : "screen" });
      state = reduce(state, { type: "start", formBit: (seed % 2) as 0 | 1 });
      for (let step = 0; step < 900 && page(state).kind !== "result"; step += 1) {
        const roll = rng();
        const current = page(state);
        if (current.kind === "questions" && roll < 0.7) {
          state = answerPage(state, (target, n) => {
            const pickAnswer = rng();
            if (pickAnswer < 0.08) return UNSURE;
            if (pickAnswer < 0.12) return NOT_APPLICABLE;
            return completeAnswer(target, n + Math.floor(rng() * 40));
          });
        }
        state = reduce(state, roll < 0.05 ? { type: "back" } : roll < 0.08 ? { type: "repack", pack: state.pack === "screen" ? "single" : "screen" } : { type: "next" });
        checkInvariants(state, `성실 seed ${seed} step ${step}`);
      }
      expect(page(state).kind, `seed ${seed}`).toBe("result");
      expect(allResolved(bank, state.responses)).toBe(true);
      reached += 1;
    }
    expect(reached).toBe(25);
  });
});

describe("계약", () => {
  it("flowModule 은 계약의 함수 아홉 개를 모두 가진다", () => {
    expect(Object.keys(flowModule).sort()).toEqual(
      ["allResolved", "buildPages", "createFlowReducer", "initialFlowState", "placementOf", "progressSegments", "skippedReviewIds", "snapshotOf", "viewAnswerOf"].sort(),
    );
  });
});
