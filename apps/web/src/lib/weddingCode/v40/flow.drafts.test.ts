/**
 * 웨딩코드 4.0 흐름: 중간 상태의 화면 답(draft)과 넘어간 질문 다시 보기의 이전 단추 (통합 정리 2026-09-30).
 *
 * 1. 한 번 완성한 답은 중간 상태(하나만 고른 가장·아닌 것, 합 6 미만의 칸 나누기)로 바뀌어도 지워지지 않는다.
 *    예전에는 한 번 눌러 중간 상태로 바꾸는 순간 저장값이 지워져서, 이전으로 나오면 결과에 이를 수 없었다.
 *    지금은 responses 가 그대로고 중간 답은 drafts 와 partialIds(문항별 깃발)에만 있으며, 깃발이 선 문항이 있으면 다음은 넘어가지 않는다.
 * 2. 결과 앞에서 저절로 열린 넘어간 질문 다시 보기의 첫 쪽에서 이전은 결과가 아니라 마지막 질문 화면으로 돌아간다(filterOrigin).
 *
 * 이 파일은 flow.test.ts 의 시험 도구를 조금 덜어 다시 갖는다(그 파일은 무작위 열을 돌려 느리고, 여기는 몇 초 안에 끝나 변형 증명에 쓴다).
 */
import { describe, expect, it } from "vitest";
import type { FlowState, Item, ItemId, Page, PagePack, QuestionsPage, ViewAnswer } from "./types";
import { WEDDING_CODE_V40_BANK } from "./bank";
import { V40_FIXTURES } from "./fixtures";
import { allResolved, buildPages, createFlowReducer, initialFlowState, placementOf, snapshotOf, viewAnswerOf } from "./flow";
import { toStored } from "./present";

const bank = WEDDING_CODE_V40_BANK;
const reduce = createFlowReducer(bank);

const UNSURE: ViewAnswer = { fmt: "escape", which: "unsure" };

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

/** 저장 상태로 바꿀 수 없는 중간 화면 답(가장·아닌 것은 가장만 고름, 칸 나누기는 합 3). */
function partialAnswer(target: Item): ViewAnswer {
  if (target.fmt === "bestworst") return { fmt: "bestworst", best: 1, worst: null };
  if (target.fmt === "split") return { fmt: "split", counts: [1, 1, 1] };
  throw new Error(`중간 상태가 없는 형식: ${target.fmt}`);
}

const page = (state: FlowState): Page => state.pages[state.pageIndex];

function questions(state: FlowState): QuestionsPage {
  const current = page(state);
  if (current.kind !== "questions") throw new Error(`질문 화면이 아니다: ${current.kind}`);
  return current;
}

function started(formBit: 0 | 1 = 0, pack: PagePack = "screen"): FlowState {
  return reduce(initialFlowState(bank, { pack }), { type: "start", formBit });
}

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

/** 그 문항이 든 질문 화면에 이를 때까지 앞 화면을 모두 성실하게 답한다(그 화면의 문항은 아직 답하지 않은 상태). */
function playToPage(id: ItemId, formBit: 0 | 1 = 0, pack: PagePack = "screen"): FlowState {
  let state = started(formBit, pack);
  for (let guard = 0; guard < 200; guard += 1) {
    const current = page(state);
    if (current.kind === "questions" && current.itemIds.includes(id)) return state;
    state = current.kind === "questions" ? reduce(answerPage(state), { type: "next" }) : reduce(state, { type: "next" });
  }
  throw new Error(`도달하지 못했다: ${id}`);
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

/** 정하는 사람 주제를 모두 잘 모르겠어요로 답한다(유효 답 0개 -> 결과 앞에서 넘어간 질문 다시 보기가 저절로 열린다). */
const skipScope = (target: Item, n: number): ViewAnswer => (target.axis === "scope" ? UNSURE : completeAnswer(target, n));

const PARTIAL_FORMATS = ["bestworst", "split"] as const;
const firstOf = (fmt: (typeof PARTIAL_FORMATS)[number]): Item => bank.items.find((entry) => entry.fmt === fmt)!;

// ---------------------------------------------------------------------------
// 1. 한 번 완성한 답은 중간 상태가 되어도 지워지지 않는다
// ---------------------------------------------------------------------------

describe("중간 상태의 화면 답: 마지막 완성 값이 남는다", () => {
  for (const fmt of PARTIAL_FORMATS) {
    const target = firstOf(fmt);

    it(`${fmt}: 완성해 둔 답을 중간 상태로 바꿔도 responses 는 그대로이고 깃발이 서며 화면은 중간 답을 보여 준다`, () => {
      const complete = answerPage(playToPage(target.id));
      const stored = complete.responses[target.id];
      expect(stored).toBeDefined();
      const edited = reduce(deepFreeze(complete), { type: "answer", itemId: target.id, answer: partialAnswer(target) });
      expect(edited.responses, "중간 상태는 responses 를 건드리지 않는다").toBe(complete.responses);
      expect(edited.responses[target.id]).toBe(stored);
      expect(edited.drafts[target.id]).toEqual(partialAnswer(target));
      expect(edited.partialIds).toEqual([target.id]);
      expect(viewAnswerOf(bank, edited, target.id), "화면은 저장값이 아니라 중간 답을 보여 준다").toEqual(partialAnswer(target));
      expect(edited.notice).toBeNull();
      expect(edited.pageIndex).toBe(complete.pageIndex);
    });

    it(`${fmt}: 깃발이 서 있으면 저장값이 있어도 다음은 넘어가지 않고 notice incomplete 를 내며, 다시 완성하면 넘어간다`, () => {
      const complete = answerPage(playToPage(target.id));
      const edited = reduce(complete, { type: "answer", itemId: target.id, answer: partialAnswer(target) });
      const tried = reduce(edited, { type: "next" });
      expect(tried.pageIndex, "쪽이 그대로다").toBe(edited.pageIndex);
      expect(tried.notice).toEqual({ kind: "incomplete", itemIds: [target.id] });
      expect(tried.drafts[target.id]).toEqual(partialAnswer(target));
      expect(tried.partialIds).toEqual([target.id]);
      expect(tried.responses).toBe(edited.responses);
      const fixed = reduce(tried, { type: "answer", itemId: target.id, answer: completeAnswer(target, 5) });
      expect(fixed.notice).toBeNull();
      expect(fixed.partialIds).toEqual([]);
      expect(fixed.responses[target.id]).toBe(toStored(target, 0, completeAnswer(target, 5)));
      expect(reduce(fixed, { type: "next" }).pageIndex).toBe(edited.pageIndex + 1);
    });

    it(`${fmt}: 쪽을 벗어나면(이전) 중간 답은 버리고 마지막 완성 값이 화면에 다시 보인다`, () => {
      const complete = answerPage(playToPage(target.id));
      const stored = complete.responses[target.id];
      const previousIndex = complete.pageIndex - 1;
      const edited = reduce(complete, { type: "answer", itemId: target.id, answer: partialAnswer(target) });
      const left = reduce(edited, { type: "back" });
      expect(left.pageIndex).toBe(previousIndex);
      expect(left.drafts).toEqual({});
      expect(left.partialIds).toEqual([]);
      expect(left.responses[target.id], "저장값은 그대로다").toBe(stored);
      const returned = reduce(left, { type: "next" });
      expect(returned.pageIndex).toBe(complete.pageIndex);
      expect(returned.partialIds).toEqual([]);
      expect(viewAnswerOf(bank, returned, target.id)).toEqual(viewAnswerOf(bank, complete, target.id));
      // 돌아온 쪽은 이미 저장값이 있으니 그대로 다음으로 갈 수 있다.
      expect(reduce(returned, { type: "next" }).pageIndex).toBe(complete.pageIndex + 1);
    });

    it(`${fmt}: 저장값이 없던 문항의 중간 답은 계속 비어 있고 다음이 막힌다(답하지 않은 문항은 그대로 미답이다)`, () => {
      const fresh = playToPage(target.id);
      expect(fresh.responses[target.id]).toBeUndefined();
      const edited = reduce(fresh, { type: "answer", itemId: target.id, answer: partialAnswer(target) });
      expect(edited.responses[target.id]).toBeUndefined();
      expect(edited.partialIds).toEqual([target.id]);
      const tried = reduce(edited, { type: "next" });
      // 이 화면의 문항은 모두 미답이므로(화면 전체를 아직 답하지 않았다) 전부 든다.
      expect(tried.notice).toEqual({ kind: "incomplete", itemIds: [...questions(edited).itemIds] });
      expect(tried.notice?.kind === "incomplete" && tried.notice.itemIds.includes(target.id)).toBe(true);
      expect(tried.pageIndex).toBe(edited.pageIndex);
    });

    it(`${fmt}: 잘 모르겠어요나 제 상황과 안 맞아요를 누르면 깃발이 지워지고 skip 과 na 가 저장값이 된다`, () => {
      const complete = answerPage(playToPage(target.id));
      const edited = reduce(complete, { type: "answer", itemId: target.id, answer: partialAnswer(target) });
      const skipped = reduce(edited, { type: "answer", itemId: target.id, answer: UNSURE });
      expect(skipped.partialIds).toEqual([]);
      expect(skipped.responses[target.id]).toBe("skip");
      const notApplicable = reduce(edited, { type: "answer", itemId: target.id, answer: { fmt: "escape", which: "na" } });
      expect(notApplicable.partialIds).toEqual([]);
      expect(notApplicable.responses[target.id]).toBe("na");
      expect(reduce(skipped, { type: "next" }).pageIndex).toBe(edited.pageIndex + 1);
    });
  }

  it("배치 사실: 가장·아닌 것과 칸 나누기는 언제나 홀로 한 화면이라 화면마다 깃발은 최대 하나다(배치가 바뀌면 깃발 여러 개를 시험해야 한다)", () => {
    const heavyScreens = bank.screens.filter((ids) => ids.some((id) => item(id).fmt === "bestworst" || item(id).fmt === "split"));
    expect(heavyScreens.length).toBeGreaterThan(0);
    for (const ids of heavyScreens) expect(ids, ids.join(",")).toHaveLength(1);
    // 그래서 partialIds 가 한 번에 가지는 문항은 하나뿐이고, 그 문항이 든 쪽의 다른 문항은 없다.
    const target = firstOf("bestworst");
    const edited = reduce(playToPage(target.id), { type: "answer", itemId: target.id, answer: partialAnswer(target) });
    expect(questions(edited).itemIds).toEqual([target.id]);
    expect(edited.partialIds).toEqual([target.id]);
  });

  it("같은 문항을 거듭 눌러도 깃발은 하나이고, 지금 화면에 없는 문항의 답은 받지 않아 깃발도 늘지 않는다", () => {
    const target = firstOf("split");
    let state = playToPage(target.id);
    state = reduce(state, { type: "answer", itemId: target.id, answer: { fmt: "split", counts: [1, 0, 0] } });
    state = reduce(state, { type: "answer", itemId: target.id, answer: { fmt: "split", counts: [1, 1, 0] } });
    expect(state.partialIds).toEqual([target.id]);
    expect(state.drafts[target.id]).toEqual({ fmt: "split", counts: [1, 1, 0] });
    // 지금 화면에 없는 문항의 답은 받지 않으므로 깃발도 늘지 않는다.
    const other = bank.items.find((entry) => entry.fmt === "bestworst")!;
    expect(reduce(state, { type: "answer", itemId: other.id, answer: partialAnswer(other) })).toBe(state);
  });

  it("중간 답이 있는 상태에서 만든 진행 저장 스냅샷은 마지막 완성 값을 담고, 이어 하면 깃발 없이 결과에 이른다", () => {
    const target = firstOf("split");
    const done = toResult();
    // 결과에서 그 문항의 주제를 다시 열어 그 문항 쪽까지 간 뒤 중간 상태로 바꾼다.
    let editing = reduce(done, { type: "openFilter", filter: { kind: "axis", axis: target.axis } });
    for (let guard = 0; guard < 40 && !questions(editing).itemIds.includes(target.id); guard += 1) editing = reduce(editing, { type: "next" });
    expect(questions(editing).itemIds).toContain(target.id);
    const edited = reduce(editing, { type: "answer", itemId: target.id, answer: partialAnswer(target) });
    expect(edited.partialIds).toEqual([target.id]);
    const snapshot = snapshotOf(bank, edited);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.responses).toBe(done.responses);
    expect(snapshot?.screen).toBe("result");
    const resumed = initialFlowState(bank, { snapshot: snapshot ?? undefined });
    expect(resumed.partialIds).toEqual([]);
    expect(resumed.drafts).toEqual({});
    expect(page(resumed).kind).toBe("result");
    expect(allResolved(bank, resumed.responses)).toBe(true);
  });

  it("묶음을 바꾸면 새 쪽에 남는 문항의 깃발만 남는다", () => {
    const target = firstOf("bestworst");
    const complete = answerPage(playToPage(target.id));
    const edited = reduce(complete, { type: "answer", itemId: target.id, answer: partialAnswer(target) });
    const single = reduce(edited, { type: "repack", pack: "single" });
    const onSinglePage = questions(single).itemIds;
    if (onSinglePage.includes(target.id)) {
      expect(single.partialIds).toEqual([target.id]);
      expect(single.drafts[target.id]).toEqual(partialAnswer(target));
    } else {
      expect(single.partialIds).toEqual([]);
      expect(single.drafts).toEqual({});
    }
    expect(single.partialIds.every((id) => onSinglePage.includes(id))).toBe(true);
    expect([...single.partialIds].sort()).toEqual(Object.keys(single.drafts).filter((id) => single.partialIds.includes(id)).sort());
    // 화면 묶음을 되돌려도 저장값은 그대로다.
    expect(reduce(single, { type: "repack", pack: "screen" }).responses).toBe(complete.responses);
  });

  it("처음부터 다시(restart)와 시작(start)과 필터 열기·닫기는 깃발을 남기지 않는다", () => {
    const target = firstOf("split");
    const edited = reduce(playToPage(target.id), { type: "answer", itemId: target.id, answer: partialAnswer(target) });
    expect(edited.partialIds).toEqual([target.id]);
    expect(reduce(edited, { type: "restart" }).partialIds).toEqual([]);
    expect(reduce(edited, { type: "openFilter", filter: { kind: "axis", axis: target.axis } }).partialIds).toEqual([]);
    expect(initialFlowState(bank).partialIds).toEqual([]);
  });

  it("검토가 잡은 장면: 결과에서 주제 다시 보기를 열어 칸 나누기를 한 번 눌러 중간 상태로 만들고 이전으로 나와도 결과에 이른다", () => {
    const fixture = V40_FIXTURES.find((entry) => entry.name === "swua-example")!;
    const result = initialFlowState(bank, { snapshot: { formBit: fixture.formBit, responses: fixture.responses, screen: "result", cursor: 0, skippedReviewDone: false } });
    expect(page(result).kind).toBe("result");
    const target = bank.scoredByAxis.support.find((entry) => entry.fmt === "split")!;
    let state = reduce(result, { type: "openFilter", filter: { kind: "axis", axis: "support" } });
    for (let guard = 0; guard < 40 && !questions(state).itemIds.includes(target.id); guard += 1) state = reduce(state, { type: "next" });
    const shown = viewAnswerOf(bank, state, target.id);
    if (shown === null || shown.fmt !== "split") throw new Error("저장된 칸 나누기 답이 화면에 보이지 않는다");
    const counts = [...shown.counts];
    const index = counts.findIndex((count) => count > 0);
    counts[index] -= 1;
    state = reduce(state, { type: "answer", itemId: target.id, answer: { fmt: "split", counts: [counts[0], counts[1], counts[2]] } });
    expect(state.partialIds).toEqual([target.id]);
    expect(state.responses[target.id]).toBe(fixture.responses[target.id]);
    for (let guard = 0; guard < 40 && state.filter !== null; guard += 1) state = reduce(state, { type: "back" });
    expect(state.filter).toBeNull();
    expect(page(state).kind, "이전으로 나와도 68개가 저장값을 가져서 결과에 이른다").toBe("result");
    expect(allResolved(bank, state.responses)).toBe(true);
    expect(state.responses).toEqual(fixture.responses);
  });

  it("주제 다시 보기에서 중간 상태로 만든 채 그대로 결과 보기(closeFilter)를 눌러도 결과에 이른다", () => {
    const result = toResult();
    const target = firstOf("bestworst");
    let state = reduce(result, { type: "openFilter", filter: { kind: "axis", axis: target.axis } });
    for (let guard = 0; guard < 40 && !questions(state).itemIds.includes(target.id); guard += 1) state = reduce(state, { type: "next" });
    state = reduce(state, { type: "answer", itemId: target.id, answer: partialAnswer(target) });
    const closed = reduce(state, { type: "closeFilter" });
    expect(page(closed).kind).toBe("result");
    expect(closed.partialIds).toEqual([]);
    expect(closed.drafts).toEqual({});
    expect(closed.responses[target.id]).toBe(result.responses[target.id]);
  });
});

// ---------------------------------------------------------------------------
// 2. 넘어간 질문 다시 보기의 첫 쪽에서 이전
// ---------------------------------------------------------------------------

describe("넘어간 질문 다시 보기: 이전 단추", () => {
  const lastQuestionIndex = (pages: readonly Page[]): number => {
    let index = pages.length - 1;
    while (index >= 0 && pages[index].kind !== "questions") index -= 1;
    return index;
  };

  it("결과 앞에서 저절로 열린 다시 보기는 filterOrigin advance 이고, 결과에서 사람이 연 필터는 open 이다", () => {
    const review = playToEnd(started(), skipScope);
    expect(review.filter?.kind).toBe("skipped");
    expect(review.filterOrigin).toBe("advance");
    const result = toResult();
    expect(result.filterOrigin).toBeNull();
    const opened = reduce(result, { type: "openFilter", filter: { kind: "axis", axis: "money" } });
    expect(opened.filterOrigin).toBe("open");
    const skipped = reduce(result, { type: "openFilter", filter: { kind: "skipped", itemIds: [bank.items[0].id] } });
    expect(skipped.filterOrigin).toBe("open");
  });

  it("저절로 열린 다시 보기의 첫 쪽에서 이전은 마지막 질문 화면으로 돌아간다(결과로 가서 다시 보기를 끝내 버리지 않는다)", () => {
    const review = deepFreeze(playToEnd(started(), skipScope));
    expect(review.pageIndex).toBe(0);
    const back = reduce(review, { type: "back" });
    expect(back.filter).toBeNull();
    expect(back.filterOrigin).toBeNull();
    expect(back.pages).toEqual(buildPages(bank));
    expect(back.pageIndex).toBe(lastQuestionIndex(back.pages));
    expect(back.pageIndex).toBe(back.pages.length - 2);
    expect(page(back).kind).toBe("questions");
    expect(questions(back).itemIds).toEqual(bank.screens[bank.screens.length - 1]);
    expect(back.notice).toBeNull();
    expect(back.drafts).toEqual({});
    expect(back.partialIds).toEqual([]);
    expect(back.responses, "답은 그대로다").toBe(review.responses);
    expect(back.skippedReviewDone, "이미 본 다시 보기는 두 번 열리지 않는다").toBe(true);
    expect(placementOf(back)).toBe("self");
  });

  it("돌아온 마지막 질문 화면에서 다음을 누르면 다시 보기 없이 곧바로 결과다", () => {
    const review = playToEnd(started(), skipScope);
    const back = reduce(review, { type: "back" });
    const forward = reduce(back, { type: "next" });
    expect(forward.filter).toBeNull();
    expect(page(forward).kind).toBe("result");
    expect(allResolved(bank, forward.responses)).toBe(true);
  });

  it("다시 보기의 둘째 쪽 이후에서 이전은 앞 쪽으로 가고 필터와 origin 은 그대로이며, 첫 쪽에 이르러서야 마지막 질문 화면으로 나간다", () => {
    const review = playToEnd(started(), skipScope);
    expect(review.pages.length).toBeGreaterThan(2);
    const second = reduce(review, { type: "next" });
    expect(second.pageIndex).toBe(1);
    expect(second.filterOrigin).toBe("advance");
    const first = reduce(second, { type: "back" });
    expect(first.pageIndex).toBe(0);
    expect(first.filter).toEqual(review.filter);
    expect(first.filterOrigin).toBe("advance");
    const out = reduce(first, { type: "back" });
    expect(out.filter).toBeNull();
    expect(page(out).kind).toBe("questions");
    expect(out.pageIndex).toBe(out.pages.length - 2);
  });

  it("사람이 결과에서 연 넘어간 질문 다시 보기와 주제 다시 보기의 첫 쪽에서 이전은 결과로 돌아간다", () => {
    const result = toResult();
    const ids = bank.scoredByAxis.money.slice(0, 3).map((entry) => entry.id);
    for (const filter of [{ kind: "skipped", itemIds: ids }, { kind: "axis", axis: "money" }] as const) {
      const opened = reduce(result, { type: "openFilter", filter });
      expect(opened.pageIndex).toBe(0);
      const back = reduce(opened, { type: "back" });
      expect(back.filter).toBeNull();
      expect(back.filterOrigin).toBeNull();
      expect(page(back).kind).toBe("result");
      expect(back.pageIndex).toBe(back.pages.length - 1);
    }
  });

  it("묶음이 single 이어도 마지막 질문 화면(쪽 하나에 문항 하나)으로 돌아간다", () => {
    const review = playToEnd(started(0, "single"), skipScope);
    expect(review.filterOrigin).toBe("advance");
    expect(review.pack).toBe("single");
    const back = reduce(review, { type: "back" });
    expect(back.pack).toBe("single");
    expect(back.pages).toEqual(buildPages(bank, { pack: "single" }));
    expect(back.pageIndex).toBe(back.pages.length - 2);
    expect(questions(back).itemIds).toHaveLength(1);
    expect(questions(back).itemIds[0]).toBe(bank.items[bank.items.length - 1].id);
  });

  it("다시 보기 중에 묶음을 바꾸어도 origin 이 남아 이전은 새 묶음의 마지막 질문 화면으로 간다", () => {
    const review = playToEnd(started(), skipScope);
    const repacked = reduce(review, { type: "repack", pack: "single" });
    expect(repacked.filter).toEqual(review.filter);
    expect(repacked.filterOrigin).toBe("advance");
    const back = reduce(repacked, { type: "back" });
    expect(back.pack).toBe("single");
    expect(back.pageIndex).toBe(back.pages.length - 2);
  });

  it("다시 보기 중에 고친 답은 이전으로 나가도 남고, 중간 답은 버려진다", () => {
    const review = playToEnd(started(), skipScope);
    const target = questions(review).itemIds[0];
    const changed = reduce(review, { type: "answer", itemId: target, answer: completeAnswer(item(target), 3) });
    const stored = changed.responses[target];
    expect(stored).toBe(toStored(item(target), changed.formBit, completeAnswer(item(target), 3)));
    const back = reduce(changed, { type: "back" });
    expect(back.responses[target]).toBe(stored);
    expect(back.drafts).toEqual({});
  });

  it("저절로 열린 다시 보기의 끝에서 다음(또는 그대로 결과 보기)은 여전히 결과로 간다", () => {
    let state = playToEnd(started(), skipScope);
    for (let guard = 0; guard < 40 && state.filter !== null; guard += 1) state = reduce(state, { type: "next" });
    expect(state.filter).toBeNull();
    expect(state.filterOrigin).toBeNull();
    expect(page(state).kind).toBe("result");
    const review = playToEnd(started(), skipScope);
    const closed = reduce(review, { type: "closeFilter" });
    expect(page(closed).kind).toBe("result");
    expect(closed.filterOrigin).toBeNull();
  });

  it("마지막 질문 화면으로 돌아온 뒤 한 번 더 이전은 앞 화면으로 가고 결과에서 뒤로 가도 마지막 질문 화면이다", () => {
    const review = playToEnd(started(), skipScope);
    const last = reduce(review, { type: "back" });
    const before = reduce(last, { type: "back" });
    expect(before.pageIndex).toBe(last.pageIndex - 1);
    const result = reduce(last, { type: "next" });
    expect(reduce(result, { type: "back" }).pageIndex).toBe(last.pageIndex);
  });
});
