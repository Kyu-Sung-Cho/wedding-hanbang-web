/**
 * 웨딩코드 4.0 화면 묶음과 순수 reducer(FlowModule, 설계 6절 흐름, README 6절, contract.ts 의 FlowModule).
 *
 * 화면 묶음(buildPages)은 소개, 구간 네 개(사이에 쉬는 카드 셋), 마지막 정리 카드와 자기 선택 화면, 결과를 순서대로 늘어놓는다.
 * reducer 는 시계, 난수, 저장소를 모르고 같은 입력에 같은 상태를 낸다. 입력 상태를 바꾸지 않고 새 객체를 돌려준다.
 * 답을 골라도 자동으로 넘어가지 않는다. 다음으로만 넘어가고, 칸을 다 놓지 않은 칸 나누기와 하나만 고른 가장·아닌 것은
 * 넘어가지 않고 notice incomplete 를 낸다. 결과는 언제나 responses 에서 다시 계산하며 이 파일은 결과를 저장하지 않는다.
 *
 * 한 번 완성한 답은 지워지지 않는다: 화면 답이 중간 상태(하나만 고른 가장·아닌 것, 합 6 미만의 칸 나누기)가 되어도 responses 는 그대로이고
 * 중간 답은 drafts 와 partialIds(문항별 깃발)에만 있다. 다음은 그 깃발이 서 있는 동안 넘어가지 않고, 쪽을 벗어나면 중간 답을 버리고 마지막 완성 값을 쓴다.
 * 그래서 responses 에서 키가 사라지는 길은 restart 뿐이고, 모든 문항에 완성된 값이 있으면 언제든 결과에 이를 수 있다.
 */
import { V40_AXIS_KEYS, V40_COUNTS, V40_SEGMENT_NAMES, guideKeyOf } from "@/constants/weddingCodeV40";
import type {
  Bank,
  BuildPagesOptions,
  FilterOrigin,
  FlowAction,
  FlowInit,
  FlowNotice,
  FlowState,
  GuideKey,
  Item,
  ItemId,
  Page,
  PageFilter,
  PagePack,
  ProgressSegment,
  ProgressSnapshot,
  QuestionsPage,
  Responses,
  SectionIndex,
  V40Placement,
  ViewAnswer,
} from "./types";
import type { FlowModule } from "./contract";
import { fromStored, toStored } from "./present";
import { scoreResponses } from "./score";
import { isResponseValueFor, responseAt } from "./states";

const hasOwn = (target: object, key: string): boolean => Object.prototype.hasOwnProperty.call(target, key);

// ---------------------------------------------------------------------------
// 화면 묶음
// ---------------------------------------------------------------------------

/** 질문 화면 한 쪽이 될 문항 묶음(원래 화면 번호와 구간을 함께 든다). */
interface Group {
  readonly ids: readonly ItemId[];
  readonly section: SectionIndex;
  readonly screen: number;
}

/**
 * 질문 화면 묶음을 화면 번호 순으로 만든다. wanted 가 있으면 그 문항만 남기고(원래 화면을 따르므로 같은 화면의 남은 문항이 한 쪽),
 * pack 이 single 이면 문항 하나씩 쪽을 나눈다. 은행에 없는 id 는 버린다.
 */
function questionGroups(bank: Bank, pack: PagePack, wanted: ReadonlySet<ItemId> | null): Group[] {
  const groups: Group[] = [];
  bank.screens.forEach((ids, screen) => {
    if (!ids) return;
    const kept = ids.filter((id) => bank.byId.has(id) && (wanted === null || wanted.has(id)));
    if (kept.length === 0) return;
    const first = bank.byId.get(kept[0]);
    if (!first) return;
    if (pack === "single") {
      for (const id of kept) groups.push({ ids: [id], section: first.section, screen });
    } else {
      groups.push({ ids: kept, section: first.section, screen });
    }
  });
  return groups;
}

function questionPage(group: Group, guides: readonly GuideKey[], elderHint: boolean): QuestionsPage {
  return { kind: "questions", key: `q:${group.ids[0]}`, itemIds: group.ids, section: group.section, screen: group.screen, guides, elderHint };
}

/**
 * 화면 목록(설계 6절 화면 묶음, contract.ts). only 가 없으면 소개, 구간별 질문 화면, 구간 0에서 2 뒤의 쉬는 카드,
 * 마지막 정리 카드, 자기 선택 화면, 결과 순서다. 형식 안내는 그 형식이 처음 나오는 쪽에만, 어른 안내는 정하는 사람 주제가 처음 나오는 쪽에만 붙는다.
 * only 가 있으면 그 문항의 질문 화면만 원래 화면(화면 묶음 screen) 또는 하나씩(single)으로 만들고 안내는 붙이지 않는다.
 */
export function buildPages(bank: Bank, options?: BuildPagesOptions): readonly Page[] {
  const pack: PagePack = options?.pack === "single" ? "single" : "screen";
  const only = options?.only;
  if (only !== undefined) {
    const wanted = new Set<ItemId>(Array.isArray(only) ? only.filter((id): id is ItemId => typeof id === "string") : []);
    return questionGroups(bank, pack, wanted).map((group) => questionPage(group, [], false));
  }
  const pages: Page[] = [{ kind: "intro", key: "intro" }];
  const seenGuides = new Set<GuideKey>();
  let elderShown = false;
  let previous: SectionIndex | null = null;
  for (const group of questionGroups(bank, pack, null)) {
    if (previous !== null && group.section !== previous) {
      if (previous === 0 || previous === 1 || previous === 2) pages.push({ kind: "rest", key: `rest:${previous}`, after: previous });
      if (group.section === 4) pages.push({ kind: "selfIntro", key: "selfIntro" });
    }
    previous = group.section;
    const guides: GuideKey[] = [];
    let elderHint = false;
    for (const id of group.ids) {
      const item = bank.byId.get(id);
      if (!item) continue;
      const guide = guideKeyOf(item.fmt);
      if (guide !== null && !seenGuides.has(guide)) {
        seenGuides.add(guide);
        guides.push(guide);
      }
      if (item.axis === "scope" && !elderShown) {
        elderShown = true;
        elderHint = true;
      }
    }
    pages.push(questionPage(group, guides, elderHint));
  }
  pages.push({ kind: "result", key: "result" });
  return pages;
}

const FULL_PAGES = new WeakMap<Bank, Partial<Record<PagePack, readonly Page[]>>>();

/** 전체 흐름(only 없음) 화면 목록. 같은 은행과 묶음이면 같은 배열을 다시 쓴다(화면이 참조 비교로 다시 그리지 않게). */
function fullPages(bank: Bank, pack: PagePack): readonly Page[] {
  let byPack = FULL_PAGES.get(bank);
  if (!byPack) {
    byPack = {};
    FULL_PAGES.set(bank, byPack);
  }
  let pages = byPack[pack];
  if (!pages) {
    pages = freezePages(buildPages(bank, { pack }));
    byPack[pack] = pages;
  }
  return pages;
}

/** 여러 상태가 함께 쓰는 화면 목록이라 실수로 바꾸지 못하게 얼린다(쪽, 문항 목록, 안내 목록까지). */
function freezePages(pages: readonly Page[]): readonly Page[] {
  for (const page of pages) {
    if (page.kind === "questions") {
      Object.freeze(page.itemIds);
      Object.freeze(page.guides);
    }
    Object.freeze(page);
  }
  return Object.freeze(pages);
}

// ---------------------------------------------------------------------------
// 조회 도우미
// ---------------------------------------------------------------------------

function isResolved(item: Item, responses: Responses): boolean {
  const value = responseAt(responses, item.id);
  return value !== undefined && isResponseValueFor(item.fmt, value);
}

function isItemResolved(bank: Bank, responses: Responses, id: ItemId): boolean {
  const item = bank.byId.get(id);
  return item !== undefined && isResolved(item, responses);
}

function firstQuestionIndex(pages: readonly Page[]): number {
  return pages.findIndex((page) => page.kind === "questions");
}

function pageIndexOfItem(pages: readonly Page[], id: ItemId): number {
  return pages.findIndex((page) => page.kind === "questions" && page.itemIds.includes(id));
}

function firstUnresolved(bank: Bank, responses: Responses): Item | undefined {
  return bank.items.find((item) => !isResolved(item, responses));
}

/** 전체 흐름에서 이어 갈 자리: 68개가 모두 저장값이면 결과 쪽, 아니면 첫 미답 문항이 든 질문 화면. */
function landing(bank: Bank, pack: PagePack, responses: Responses): { readonly pages: readonly Page[]; readonly pageIndex: number } {
  const pages = fullPages(bank, pack);
  const unresolved = firstUnresolved(bank, responses);
  if (unresolved === undefined) return { pages, pageIndex: Math.max(0, pages.length - 1) };
  const index = pageIndexOfItem(pages, unresolved.id);
  return { pages, pageIndex: index >= 0 ? index : Math.max(0, firstQuestionIndex(pages)) };
}

/** 모르는 입력에서 화면 답을 새 객체로 옮긴다. 모양이 맞지 않으면 null(화면 답이 아닌 것). */
function cloneAnswer(input: unknown): ViewAnswer | null {
  if (input === null || typeof input !== "object") return null;
  const answer = input as Readonly<Record<string, unknown>>;
  switch (answer.fmt) {
    case "escape":
      return answer.which === "unsure" || answer.which === "na" ? { fmt: "escape", which: answer.which } : null;
    case "pair":
    case "self":
    case "react":
      return typeof answer.cell === "number" ? { fmt: answer.fmt, cell: answer.cell } : null;
    case "recall":
    case "instant":
      return typeof answer.option === "number" ? { fmt: answer.fmt, option: answer.option } : null;
    case "bestworst": {
      const { best, worst } = answer;
      const ok = (value: unknown): value is number | null => value === null || typeof value === "number";
      return ok(best) && ok(worst) ? { fmt: "bestworst", best, worst } : null;
    }
    case "split": {
      const counts = answer.counts;
      if (!Array.isArray(counts) || counts.length !== 3 || !counts.every((count) => typeof count === "number")) return null;
      return { fmt: "split", counts: [counts[0], counts[1], counts[2]] };
    }
    default:
      return null;
  }
}

const isSmallInt = (value: number | null, max: number): boolean => value === null || (Number.isInteger(value) && value >= 0 && value <= max);

/** 저장 상태로 바꿀 수는 없지만 화면에 남겨 둘 만한 중간 상태인가(하나만 고른 가장·아닌 것, 합 6 미만의 칸 나누기). */
function isPartialDraft(answer: ViewAnswer): boolean {
  if (answer.fmt === "bestworst") {
    if (!isSmallInt(answer.best, 3) || !isSmallInt(answer.worst, 3)) return false;
    // 둘 다 고른 답은 toStored 가 이미 받았거나(서로 다름) 잘못된 답(같은 카드)이다. 중간 상태는 한쪽 이상이 비어 있는 것뿐이다.
    return answer.best === null || answer.worst === null;
  }
  if (answer.fmt === "split") {
    const [a, b, c] = answer.counts;
    const ok = [a, b, c].every((count) => Number.isInteger(count) && count >= 0);
    return ok && a + b + c < 6;
  }
  return false;
}

/** drafts 와 partialIds(중간 답의 깃발)는 언제나 한 쌍으로 바뀐다. 깃발이 drafts 와 어긋나지 않게 상태의 이 두 필드는 아래 두 함수로만 만든다. */
interface DraftFields {
  readonly drafts: Readonly<Record<ItemId, ViewAnswer>>;
  readonly partialIds: readonly ItemId[];
}

/** 화면 답이 하나도 없는 상태(쪽을 옮기거나 필터를 열고 닫을 때). */
function noDrafts(): DraftFields {
  return { drafts: {}, partialIds: [] };
}

/** 이 화면 답들의 drafts 와, 그중 저장 상태로 바꿀 수 없는 중간 답의 깃발. */
function draftFields(drafts: Readonly<Record<ItemId, ViewAnswer>>): DraftFields {
  return { drafts, partialIds: Object.keys(drafts).filter((id) => isPartialDraft(drafts[id])) };
}

function goTo(state: FlowState, pageIndex: number): FlowState {
  if (pageIndex < 0 || pageIndex >= state.pages.length) return state;
  return { ...state, pageIndex, ...noDrafts(), notice: null };
}

// ---------------------------------------------------------------------------
// 상태 만들기
// ---------------------------------------------------------------------------

/** 스냅샷의 응답에서 은행 문항의 유효한 저장값만 새 객체로 옮긴다. */
function sanitizeResponses(bank: Bank, responses: Responses | null | undefined): Responses {
  const clean: Record<ItemId, string> = {};
  for (const item of bank.items) {
    const value = responseAt(responses, item.id);
    if (value !== undefined && isResponseValueFor(item.fmt, value)) clean[item.id] = value;
  }
  return clean;
}

/**
 * 처음 상태(설계 6절 저장과 수정, 이어 하기). 소개 쪽에서 시작하지 않은 상태(started false)이고, snapshot 이 있으면 진행 저장에서 이어 하는 상태다:
 * started true, screen 이 result 이고 68개가 모두 있으면 결과 쪽, 아니면 cursor 문항이 든 질문 화면(범위 밖이면 첫 미답 화면).
 */
export function initialFlowState(bank: Bank, init?: FlowInit): FlowState {
  const pack: PagePack = init?.pack === "single" ? "single" : "screen";
  const pages = fullPages(bank, pack);
  const base: FlowState = {
    formBit: 0,
    started: false,
    responses: {},
    ...noDrafts(),
    pack,
    pages,
    pageIndex: 0,
    filter: null,
    filterOrigin: null,
    skippedReviewDone: false,
    notice: null,
  };
  const snapshot = init?.snapshot;
  if (snapshot === undefined || snapshot === null || typeof snapshot !== "object") return base;
  const responses = sanitizeResponses(bank, snapshot.responses);
  const resolvedAll = allResolved(bank, responses);
  const fallback = landing(bank, pack, responses).pageIndex;
  let pageIndex = fallback;
  if (snapshot.screen === "result") {
    pageIndex = resolvedAll ? pages.length - 1 : fallback;
  } else {
    const cursorItem = Number.isInteger(snapshot.cursor) ? bank.items[snapshot.cursor] : undefined;
    const found = cursorItem ? pageIndexOfItem(pages, cursorItem.id) : -1;
    pageIndex = found >= 0 ? found : resolvedAll ? Math.max(0, firstQuestionIndex(pages)) : fallback;
  }
  return {
    ...base,
    formBit: snapshot.formBit === 1 ? 1 : 0,
    started: true,
    responses,
    pageIndex,
    skippedReviewDone: snapshot.skippedReviewDone === true,
  };
}

// ---------------------------------------------------------------------------
// 조회 함수
// ---------------------------------------------------------------------------

/** 68개 문항이 모두 responses 에 있는가(그 형식의 상태 문자, skip, na 중 하나). 설계 6절 결과는 모두 답한 뒤에만 연다. */
export function allResolved(bank: Bank, responses: Responses): boolean {
  return bank.items.every((item) => isResolved(item, responses));
}

/**
 * 결과 전에 한 번 다시 보여 줄 문항 id(설계 5절 빠진 값). 유효 답이 12개 미만인 주제의 skip(잘 모르겠어요) 채점 문항을
 * 질문 순서로 낸다. 해당 없음(na)은 뺀다. 없으면 빈 배열.
 */
export function skippedReviewIds(bank: Bank, responses: Responses): readonly ItemId[] {
  const wanted = new Set<ItemId>();
  for (const axis of scoreResponses(bank, responses).axes) {
    if (axis.answered >= V40_COUNTS.minValidAnswers) continue;
    for (const item of bank.scoredByAxis[axis.axis]) if (responseAt(responses, item.id) === "skip") wanted.add(item.id);
  }
  return bank.scored.filter((item) => wanted.has(item.id)).map((item) => item.id);
}

/** 지금 화면에 보일 답(README 6절): drafts 의 화면 답이 있으면 그것, 없으면 저장값을 fromStored 로. 답이 없으면 null. */
export function viewAnswerOf(bank: Bank, state: FlowState, itemId: ItemId): ViewAnswer | null {
  const item = bank.byId.get(itemId);
  if (!item) return null;
  if (hasOwn(state.drafts, itemId)) {
    const draft = state.drafts[itemId];
    if (draft) return draft;
  }
  const value = responseAt(state.responses, itemId);
  return value === undefined ? null : fromStored(item, state.formBit, value);
}

/**
 * 지금 쪽이 속한 구간(README 6절 진행 표시). 쉬는 카드는 방금 끝낸 구간, 마지막 정리 카드는 마지막 정리, 소개와 결과는 없음.
 * 넘어간 질문 다시 보기(필터 skipped)도 없음: 여러 구간의 문항이 섞여 있고 막대는 이미 모두 차 있는데 첫 문항의 구간 이름(처음)을 붙이면
 * 처음으로 돌아간 것처럼 읽힌다. 축 다시 보기는 그 문항의 구간을 그대로 가리킨다.
 */
function currentSection(state: FlowState): SectionIndex | null {
  if (!state.started) return null;
  if (state.filter?.kind === "skipped") return null;
  const page = state.pages[state.pageIndex];
  if (!page) return null;
  switch (page.kind) {
    case "questions":
      return page.section;
    case "rest":
      return page.after;
    case "selfIntro":
      return 4;
    default:
      return null;
  }
}

/**
 * 진행 막대 다섯 칸(설계 6절 진행 표시): 구간 0에서 3은 문항 16개, 마지막 정리는 4개. done 은 저장값이 있는 문항 수.
 * current 는 지금 쪽의 구간이다(축 다시 보기에서는 지금 열린 문항의 구간). 소개와 결과, 넘어간 질문 다시 보기에서는 어느 칸도 아니다.
 */
export function progressSegments(bank: Bank, state: FlowState): readonly ProgressSegment[] {
  const total = [0, 0, 0, 0, 0];
  const done = [0, 0, 0, 0, 0];
  for (const item of bank.items) {
    total[item.section] += 1;
    if (isResolved(item, state.responses)) done[item.section] += 1;
  }
  const current = currentSection(state);
  return ([0, 1, 2, 3, 4] as const).map((index): ProgressSegment => ({
    index,
    name: V40_SEGMENT_NAMES[index],
    done: done[index],
    total: total[index],
    current: current === index,
  }));
}

/**
 * 진행 저장용 스냅샷(README 7절 8항). 시작 전이면 null. cursor 는 지금 쪽(쉬는 카드와 마지막 정리 카드이면 다음 질문 화면)의 첫 문항 코드 색인.
 * 필터 흐름과 결과이면 모두 답했을 때 result, 아니면 첫 미답 화면의 첫 문항. 필터 흐름 자체는 저장하지 않는다.
 */
export function snapshotOf(bank: Bank, state: FlowState): ProgressSnapshot | null {
  if (!state.started) return null;
  const build = (screen: "questions" | "result", cursor: number): ProgressSnapshot => ({
    formBit: state.formBit,
    responses: state.responses,
    screen,
    cursor,
    skippedReviewDone: state.skippedReviewDone,
  });
  const cursorOfPage = (page: Page | undefined): number | null => {
    if (!page || page.kind !== "questions") return null;
    const index = bank.codeIndexById.get(page.itemIds[0]);
    return index === undefined ? null : index;
  };
  const unresolvedCursor = (): number => {
    const target = landing(bank, state.pack, state.responses);
    return cursorOfPage(target.pages[target.pageIndex]) ?? 0;
  };
  if (state.filter !== null) return allResolved(bank, state.responses) ? build("result", 0) : build("questions", unresolvedCursor());
  const page = state.pages[state.pageIndex];
  if (!page) return build("questions", unresolvedCursor());
  switch (page.kind) {
    case "result":
      return allResolved(bank, state.responses) ? build("result", 0) : build("questions", unresolvedCursor());
    case "questions":
      return build("questions", cursorOfPage(page) ?? 0);
    case "rest":
    case "selfIntro":
      return build("questions", cursorOfPage(state.pages[state.pageIndex + 1]) ?? unresolvedCursor());
    default:
      return build("questions", cursorOfPage(state.pages[firstQuestionIndex(state.pages)]) ?? 0);
  }
}

/** 이용 통계 placement(contract.ts): 소개 intro, 구간 0에서 3은 c1에서 c4, 자기 선택 self, 결과 result, 필터 흐름 edit. 쉬는 카드는 방금 끝낸 구간이다. */
export function placementOf(state: FlowState): V40Placement {
  if (state.filter !== null) return "edit";
  if (!state.started) return "intro";
  const page = state.pages[state.pageIndex];
  if (!page) return "intro";
  const sectionName = (section: SectionIndex): V40Placement => {
    switch (section) {
      case 0:
        return "c1";
      case 1:
        return "c2";
      case 2:
        return "c3";
      case 3:
        return "c4";
      default:
        return "self";
    }
  };
  switch (page.kind) {
    case "questions":
      return sectionName(page.section);
    case "rest":
      return sectionName(page.after);
    case "selfIntro":
      return "self";
    case "result":
      return "result";
    default:
      return "intro";
  }
}

// ---------------------------------------------------------------------------
// reducer
// ---------------------------------------------------------------------------

function closeFilter(bank: Bank, state: FlowState): FlowState {
  if (state.filter === null) return state;
  const target = landing(bank, state.pack, state.responses);
  return { ...state, pages: target.pages, pageIndex: target.pageIndex, filter: null, filterOrigin: null, ...noDrafts(), notice: null };
}

/** 결과 앞에서 다음을 눌렀을 때 저절로 여는 넘어간 질문 다시 보기. 첫 쪽의 이전이 마지막 질문 화면으로 돌아가도록 origin 을 advance 로 적는다. */
function openSkippedReview(bank: Bank, state: FlowState, ids: readonly ItemId[]): FlowState {
  const pages = buildPages(bank, { only: ids, pack: state.pack });
  if (pages.length === 0) return state;
  const origin: FilterOrigin = "advance";
  return {
    ...state,
    pages,
    pageIndex: 0,
    filter: { kind: "skipped", itemIds: ids },
    filterOrigin: origin,
    skippedReviewDone: true,
    ...noDrafts(),
    notice: { kind: "skippedReview", itemIds: ids },
  };
}

/**
 * 저절로 열린 다시 보기의 첫 쪽에서 이전: 전체 흐름의 마지막 질문 화면으로 돌아간다(다시 보기는 이미 봤으므로 skippedReviewDone 은 true 로 남아 두 번 열리지 않는다).
 * 전체 흐름에 질문 화면이 없으면(있을 수 없다) 필터를 닫는 것으로 대신한다.
 */
function leaveReviewBackward(bank: Bank, state: FlowState): FlowState {
  const pages = fullPages(bank, state.pack);
  let index = pages.length - 1;
  while (index >= 0 && pages[index].kind !== "questions") index -= 1;
  if (index < 0) return closeFilter(bank, state);
  return { ...state, pages, pageIndex: index, filter: null, filterOrigin: null, ...noDrafts(), notice: null };
}

function start(state: FlowState, formBit: unknown): FlowState {
  if (state.started) return state;
  const index = firstQuestionIndex(state.pages);
  if (index < 0) return state;
  return { ...state, formBit: formBit === 1 ? 1 : 0, started: true, pageIndex: index, ...noDrafts(), notice: null };
}

function answer(bank: Bank, state: FlowState, itemId: unknown, input: unknown): FlowState {
  if (!state.started || typeof itemId !== "string") return state;
  const page = state.pages[state.pageIndex];
  if (!page || page.kind !== "questions" || !page.itemIds.includes(itemId)) return state;
  const item = bank.byId.get(itemId);
  if (!item) return state;
  const view = cloneAnswer(input);
  if (view === null || (view.fmt !== "escape" && view.fmt !== item.fmt)) return state;
  const stored = toStored(item, state.formBit, view);
  if (stored !== null) {
    return { ...state, responses: { ...state.responses, [itemId]: stored }, ...draftFields({ ...state.drafts, [itemId]: view }), notice: null };
  }
  if (!isPartialDraft(view)) return state;
  // 중간 상태는 화면에만 둔다. 이미 완성해 둔 저장값이 있으면 그대로 남는다(되돌아가도 결과에 이를 수 있다).
  return { ...state, ...draftFields({ ...state.drafts, [itemId]: view }), notice: null };
}

/** 이 쪽의 문항이 모두 저장값을 가진 뒤 다음 쪽으로 가는 규칙(README 6절): 결과 직전이면 건너뛴 질문 다시 보기를 한 번 거친다. */
function advance(bank: Bank, state: FlowState): FlowState {
  if (state.filter !== null) return state.pageIndex >= state.pages.length - 1 ? closeFilter(bank, state) : goTo(state, state.pageIndex + 1);
  const following = state.pages[state.pageIndex + 1];
  if (following === undefined) return state;
  if (following.kind !== "result") return goTo(state, state.pageIndex + 1);
  if (!allResolved(bank, state.responses)) {
    const target = landing(bank, state.pack, state.responses);
    const page = target.pages[target.pageIndex];
    const missing = page && page.kind === "questions" ? page.itemIds.filter((id) => !isItemResolved(bank, state.responses, id)) : [];
    const notice: FlowNotice | null = missing.length > 0 ? { kind: "incomplete", itemIds: missing } : null;
    return { ...state, pages: target.pages, pageIndex: target.pageIndex, ...noDrafts(), notice };
  }
  if (!state.skippedReviewDone) {
    const ids = skippedReviewIds(bank, state.responses);
    if (ids.length > 0) return openSkippedReview(bank, state, ids);
  }
  return goTo(state, state.pageIndex + 1);
}

function next(bank: Bank, state: FlowState): FlowState {
  if (!state.started) return state;
  const page = state.pages[state.pageIndex];
  if (!page) return state;
  switch (page.kind) {
    case "intro":
    case "result":
      return state;
    case "rest":
    case "selfIntro":
      return goTo(state, state.pageIndex + 1);
    default: {
      // 저장값이 없는 문항, 그리고 저장값은 있어도 지금 화면 답이 중간 상태인 문항(깃발이 선 것)이 있으면 넘어가지 않는다.
      const blocked = page.itemIds.filter((id) => state.partialIds.includes(id) || !isItemResolved(bank, state.responses, id));
      if (blocked.length > 0) return { ...state, notice: { kind: "incomplete", itemIds: blocked } };
      return advance(bank, state);
    }
  }
}

function back(bank: Bank, state: FlowState): FlowState {
  if (!state.started) return state;
  if (state.filter !== null) {
    if (state.pageIndex > 0) return goTo(state, state.pageIndex - 1);
    return state.filterOrigin === "advance" ? leaveReviewBackward(bank, state) : closeFilter(bank, state);
  }
  if (state.pageIndex <= firstQuestionIndex(state.pages)) return state;
  return goTo(state, state.pageIndex - 1);
}

function openFilter(bank: Bank, state: FlowState, filter: unknown): FlowState {
  if (!state.started || filter === null || typeof filter !== "object") return state;
  const request = filter as Readonly<Record<string, unknown>>;
  let ids: ItemId[];
  let normalized: PageFilter;
  if (request.kind === "axis" && typeof request.axis === "string" && (V40_AXIS_KEYS as readonly string[]).includes(request.axis)) {
    const axis = request.axis as (typeof V40_AXIS_KEYS)[number];
    ids = bank.scoredByAxis[axis].map((item) => item.id);
    normalized = { kind: "axis", axis };
  } else if (request.kind === "skipped" && Array.isArray(request.itemIds)) {
    const wanted = new Set<unknown>(request.itemIds);
    ids = bank.items.filter((item) => wanted.has(item.id)).map((item) => item.id);
    normalized = { kind: "skipped", itemIds: ids };
  } else {
    return state;
  }
  const pages = buildPages(bank, { only: ids, pack: state.pack });
  if (pages.length === 0) return state;
  const origin: FilterOrigin = "open";
  return {
    ...state,
    pages,
    pageIndex: 0,
    filter: normalized,
    filterOrigin: origin,
    ...noDrafts(),
    notice: null,
    skippedReviewDone: state.skippedReviewDone || normalized.kind === "skipped",
  };
}

/** 묶음을 바꾼다. 지금 보던 쪽의 첫 문항이 든 쪽으로, 질문 화면이 아니면 같은 key 의 쪽으로 이어진다(없으면 가장 가까운 쪽). */
function repack(bank: Bank, state: FlowState, pack: unknown): FlowState {
  if ((pack !== "screen" && pack !== "single") || pack === state.pack) return state;
  let pages: readonly Page[];
  if (state.filter === null) {
    pages = fullPages(bank, pack);
  } else {
    const ids = state.filter.kind === "axis" ? bank.scoredByAxis[state.filter.axis].map((item) => item.id) : state.filter.itemIds;
    pages = buildPages(bank, { only: ids, pack });
  }
  if (pages.length === 0) return state;
  const current = state.pages[state.pageIndex];
  let index = -1;
  if (current) index = current.kind === "questions" ? pageIndexOfItem(pages, current.itemIds[0]) : pages.findIndex((page) => page.key === current.key);
  if (index < 0) index = Math.min(Math.max(state.pageIndex, 0), pages.length - 1);
  const target = pages[index];
  const onPage = (id: ItemId): boolean => target.kind === "questions" && target.itemIds.includes(id);
  const drafts: Record<ItemId, ViewAnswer> = {};
  for (const id of Object.keys(state.drafts)) if (onPage(id)) drafts[id] = state.drafts[id];
  const held = state.notice;
  let notice: FlowNotice | null = null;
  if (held !== null && held.kind === "incomplete" && held.itemIds.every(onPage)) notice = held;
  if (held !== null && held.kind === "skippedReview" && state.filter?.kind === "skipped" && index === 0) notice = held;
  return { ...state, pack, pages, pageIndex: index, ...draftFields(drafts), notice };
}

/**
 * 순수 reducer(contract.ts createFlowReducer): start, answer, next, back, openFilter, closeFilter, repack, dismissNotice, restart.
 * 알 수 없는 행동, 시작 전의 행동, 지금 화면에 없는 문항의 답은 상태를 그대로 돌려준다. 던지지 않는다.
 */
export function createFlowReducer(bank: Bank): (state: FlowState, action: FlowAction) => FlowState {
  return (state, action) => {
    if (action === null || typeof action !== "object") return state;
    switch (action.type) {
      case "start":
        return start(state, action.formBit);
      case "answer":
        return answer(bank, state, action.itemId, action.answer);
      case "next":
        return next(bank, state);
      case "back":
        return back(bank, state);
      case "openFilter":
        return openFilter(bank, state, action.filter);
      case "closeFilter":
        return closeFilter(bank, state);
      case "repack":
        return repack(bank, state, action.pack);
      case "dismissNotice":
        return state.notice === null ? state : { ...state, notice: null };
      case "restart":
        return initialFlowState(bank, { pack: state.pack });
      default:
        return state;
    }
  };
}

/** 이 파일의 함수를 계약(FlowModule)대로 묶은 객체. 서명이 계약과 어긋나면 여기서 타입 오류가 난다. */
export const flowModule = {
  buildPages,
  initialFlowState,
  createFlowReducer,
  viewAnswerOf,
  allResolved,
  skippedReviewIds,
  progressSegments,
  snapshotOf,
  placementOf,
} satisfies FlowModule;
