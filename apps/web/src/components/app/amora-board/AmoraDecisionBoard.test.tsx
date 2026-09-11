import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmoraActionItem } from "@/lib/amora/actions";
import { parsePreparationDecisions, type PreparationDecision } from "@/lib/amora/preparationBoard";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";

const mocks = vi.hoisted(() => ({
  decisions: { records: [] as PreparationDecision[], loading: false, loadingMore: false, error: null as string | null, nextCursor: null as { id: string; createdAt: string } | null, available: true, isDemo: false, refresh: vi.fn(), loadMore: vi.fn() },
  data: {
    actions: [] as AmoraActionItem[], loading: false, error: null as string | null,
    count: 0, open_count: 0, truncated: false, isDemo: false, creating: false, createLocked: false,
    updateError: null as string | null, updatingIds: new Set<string>(),
    refresh: vi.fn(), update: vi.fn(), loadMore: vi.fn(), nextCursor: null as string | null, loadingMore: false,
  },
}));
vi.mock("@/hooks/useAmoraPreparationActions", () => ({ useAmoraPreparationActions: () => mocks.data }));
vi.mock("./useDecisionBoard", () => ({ useDecisionBoard: () => mocks.decisions }));
import AmoraDecisionBoard from "./AmoraDecisionBoard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const action: AmoraActionItem = {
  id: "act_test", title: "출장 추가 비용 확인", description: "업체에 서면으로 물어보기", status: "open", source: "chat", priority: "medium",
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
};

describe("AmoraDecisionBoard", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(mocks.decisions, { records: [], loading: false, loadingMore: false, error: null, nextCursor: null, available: true, isDemo: false });
    mocks.decisions.refresh.mockReset(); mocks.decisions.loadMore.mockReset();
    Object.assign(mocks.data, { actions: [], loading: false, error: null, count: 0, open_count: 0, truncated: false, isDemo: false, creating: false, createLocked: false, updateError: null, updatingIds: new Set<string>() });
    mocks.data.refresh.mockReset(); mocks.data.update.mockReset().mockResolvedValue(true);
    mocks.data.loadMore.mockReset(); mocks.data.nextCursor = null; mocks.data.loadingMore = false;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const selectBoard = async (label: "결정 기록" | "공유 할 일") => {
    const control = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="보드 보기"] button')).find(button => button.textContent === label)!;
    await act(async () => control.click());
    expect(control.getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById(control.getAttribute("aria-controls")!)?.hidden).toBe(false);
  };

  it("switches between decision records and shared tasks without conflating their states", async () => {
    mocks.data.actions = [{ ...action, status: "done" }];
    await act(async () => root.render(<AmoraDecisionBoard />));
    const decisions = container.querySelector('[aria-label="준비 결정 기록"]')!.parentElement!;
    const tasks = container.querySelector<HTMLElement>('[aria-label="공유 할 일"]')!;
    expect(decisions.hidden).toBe(false);
    expect(tasks.hidden).toBe(true);
    await selectBoard("공유 할 일");
    expect(decisions.hidden).toBe(true);
    expect(tasks.textContent).toContain("완료한 할 일");
    await selectBoard("결정 기록");
    expect(tasks.hidden).toBe(true);
    expect(mocks.data.update).not.toHaveBeenCalled();
    expect(mocks.data.refresh).not.toHaveBeenCalled();
    expect(mocks.decisions.refresh).not.toHaveBeenCalled();
  });

  it("shows historical schedule actions and a readable generated budget title without changing categories or its stored original", async () => {
    const coupleId = "11111111-1111-4111-8111-111111111111";
    const eventId = "22222222-2222-4222-8222-222222222222";
    const originalTitle = "venue 예산: 13000000원 → 12500000원";
    const common = { couple_id: coupleId, visibility: "shared", reasoning: null, created_at: "2026-09-11T00:00:00Z", superseded_at: null, memory_key: null };
    mocks.decisions.records = parsePreparationDecisions([
      { ...common, id: "33333333-3333-4333-8333-333333333333", category: "general", title: "일정 취소: 확인할 일정", source: "schedule", decision_type: "scheduled",
        metadata: { origin: "couple_plan_change_request", mutationKind: "cancel", eventId },
        chosen_value: { schemaVersion: 1, mutationKind: "cancel", eventId, before: { id: eventId, status: "planned" }, after: { id: eventId, status: "cancelled" } } },
      { ...common, id: "33333333-3333-4333-8333-333333333332", category: "plan", title: originalTitle, source: "manual", decision_type: "decided",
        metadata: { origin: "couple_plan_change_request" },
        chosen_value: { schemaVersion: 1, changes: { progress_patch: { venue: { category: "venue", budget: 12500000 } } } } },
    ], coupleId).records;
    await act(async () => root.render(<AmoraDecisionBoard />));
    const board = container.querySelector('[aria-label="준비 결정 기록"]')!;
    const cards = Array.from(board.querySelectorAll("article"));
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("일정 취소 기록");
    expect(cards[0].textContent).toContain("일반 준비");
    expect(cards[0].textContent).not.toContain("일정 확정");
    expect(cards[1].querySelector("h4")?.textContent).toBe("결혼식장 예산: 13000000원 → 12500000원");
    expect(cards[1].textContent).toContain("준비 계획");
    const original = cards[1].querySelector("details")!;
    expect(original.querySelector("summary")?.textContent).toBe("저장 원문 보기");
    await act(async () => original.querySelector("summary")!.click());
    expect(original.open).toBe(true);
    expect(original.querySelector("p")?.textContent).toBe(originalTitle);
    expect(mocks.decisions.records[1].title).toBe(originalTitle);
    expect(board.textContent).not.toContain("지금의 상태별로");
    expect(board.textContent).toContain("현재 일정 상태는 일정에서 확인");
    expect(board.textContent).toContain("불러온 결정 2개");
    expect(mocks.data.update).not.toHaveBeenCalled();
    expect(mocks.decisions.refresh).not.toHaveBeenCalled();
  });

  it("refreshes only the selected board and keeps its read and pending-write guards", async () => {
    await act(async () => root.render(<AmoraDecisionBoard />));
    const refresh = () => container.querySelector<HTMLButtonElement>('button[aria-label$="새로고침"]')!;
    expect(refresh().getAttribute("aria-label")).toBe("결정 새로고침");
    await act(async () => refresh().click());
    expect(mocks.decisions.refresh).toHaveBeenCalledOnce();
    expect(mocks.data.refresh).not.toHaveBeenCalled();
    mocks.decisions.loadingMore = true;
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(refresh().disabled).toBe(true);
    await selectBoard("공유 할 일");
    expect(refresh().disabled).toBe(false);
    await act(async () => refresh().click());
    expect(mocks.data.refresh).toHaveBeenCalledOnce();
    expect(mocks.decisions.refresh).toHaveBeenCalledOnce();
    mocks.data.updatingIds = new Set([action.id]);
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(refresh().disabled).toBe(true);
    await act(async () => refresh().click());
    expect(mocks.data.refresh).toHaveBeenCalledOnce();
    mocks.data.updatingIds = new Set(); mocks.data.isDemo = true;
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(refresh().disabled).toBe(true);
    expect(mocks.data.update).not.toHaveBeenCalled();
  });

  it("filters only loaded decisions by field and search while preserving unknown fields and pagination", async () => {
    mocks.decisions.records = [
      { id: "venue", title: "장소 비교", category: "venue", detail: "동선을 확인하기", status: "considering", stateLabel: "고려 중", source: "chat", createdAt: "2026-09-07T00:00:00Z" },
      { id: "makeup", title: "출장 비용", category: "makeup", detail: null, status: "confirmed", stateLabel: "예약 기록", source: "manual", createdAt: "2026-09-06T00:00:00Z" },
      { id: "legacy", title: "과거 결정", category: "legacy-field", detail: null, status: "exploring", stateLabel: "탐색 중", source: "unknown", createdAt: "2026-09-05T00:00:00Z" },
    ];
    mocks.decisions.nextCursor = { id: "legacy", createdAt: "2026-09-05T00:00:00Z" };
    mocks.data.actions = [action];
    await act(async () => root.render(<AmoraDecisionBoard />));
    const decisions = container.querySelector('[aria-label="준비 결정 기록"]')!;
    const filter = (label: string) => Array.from(decisions.querySelectorAll<HTMLButtonElement>('[aria-label="결정 분야 필터"] button')).find(button => button.textContent?.includes(label))!;
    await act(async () => filter("헤어·메이크업").click());
    expect(Array.from(decisions.querySelectorAll("article"), card => card.getAttribute("aria-label"))).toEqual(["출장 비용"]);
    await act(async () => filter("분야 미정").click());
    expect(Array.from(decisions.querySelectorAll("article"), card => card.getAttribute("aria-label"))).toEqual(["과거 결정"]);
    expect(decisions.querySelector("article a")).toBeNull();
    await act(async () => filter("전체").click());
    const input = decisions.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "동선");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(Array.from(decisions.querySelectorAll("article"), card => card.getAttribute("aria-label"))).toEqual(["장소 비교"]);
    expect(decisions.querySelector("article")?.textContent).toContain("대화에서 남긴 기록");
    expect(decisions.textContent).toContain("불러온 결정 3개");
    expect(decisions.textContent).toContain("숫자와 검색은 불러온 기록 기준");
    await selectBoard("공유 할 일");
    expect(container.querySelector('[aria-label="공유 할 일"] article')?.textContent).toContain(action.title);
    await selectBoard("결정 기록");
    expect(input.value).toBe("동선");
    await act(async () => Array.from(decisions.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "이전 결정 더 보기")!.click());
    expect(mocks.decisions.loadMore).toHaveBeenCalledOnce();
    expect(mocks.data.loadMore).not.toHaveBeenCalled();
  });

  it("uses stored decision domains for counts, labels, search and destinations without inferring from source", async () => {
    mocks.decisions.records = [
      { id: "budget", title: "초대장·꽃·하객선물 1,501,000원", category: "budget", source: "budget" },
      { id: "schedule", title: "둘이 확인하는 시간", category: "schedule", source: "schedule" },
      { id: "plan", title: "준비 기준 정리", category: "plan", source: "manual" },
      { id: "general", title: "자유롭게 남긴 기록", category: "general", source: "chat" },
      { id: "venue", title: "예식장 비교", category: "venue", source: "budget" },
      { id: "unknown", title: "출처만 알려진 기록", category: "unknown", source: "budget" },
      { id: "empty", title: "분야가 없는 기록", category: "", source: "schedule" },
    ].map(row => ({ ...row, detail: null, status: "confirmed", stateLabel: "결정 기록", createdAt: "2026-09-11T00:00:00Z" }));
    await act(async () => root.render(<AmoraDecisionBoard />));
    const decisions = container.querySelector('[aria-label="준비 결정 기록"]')!;
    const filters = () => Array.from(decisions.querySelectorAll<HTMLButtonElement>('[aria-label="결정 분야 필터"] button'));
    const filter = (label: string) => filters().find(button => button.textContent?.startsWith(label))!;
    expect(filters().map(button => button.textContent)).toEqual(expect.arrayContaining(["예산1", "일정1", "준비 계획1", "일반 준비1", "분야 미정2"]));
    for (const [label, title, href, linkLabel] of [
      ["예산", "초대장·꽃·하객선물 1,501,000원", "/wedding/budget", "예산 보기"],
      ["일정", "둘이 확인하는 시간", "/wedding/schedule", "일정 보기"],
      ["준비 계획", "준비 기준 정리", null, null],
      ["일반 준비", "자유롭게 남긴 기록", null, null],
    ] as const) {
      await act(async () => filter(label).click());
      const cards = decisions.querySelectorAll("article");
      expect(cards).toHaveLength(1);
      expect(cards[0].getAttribute("aria-label")).toBe(title);
      expect(cards[0].textContent).toContain(label);
      expect(cards[0].querySelector("a")?.getAttribute("href") ?? null).toBe(href);
      expect(cards[0].querySelector("a")?.textContent ?? null).toBe(linkLabel);
    }
    await act(async () => filter("분야 미정").click());
    expect(Array.from(decisions.querySelectorAll("article"), card => card.getAttribute("aria-label"))).toEqual(["출처만 알려진 기록", "분야가 없는 기록"]);
    expect(decisions.querySelector("article a")).toBeNull();
    await act(async () => filter("전체").click());
    const venue = decisions.querySelector('article[aria-label="예식장 비교"]')!;
    expect(venue.querySelector("a")?.getAttribute("href")).toBe("/wedding/checklist?category=venue");
    const input = decisions.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "예산");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(Array.from(decisions.querySelectorAll("article"), card => card.getAttribute("aria-label"))).toEqual(["초대장·꽃·하객선물 1,501,000원"]);
    expect(mocks.data.update).not.toHaveBeenCalled();
    expect(mocks.decisions.refresh).not.toHaveBeenCalled();
  });

  it("retains all existing checklist category labels and deep links on decision cards", async () => {
    mocks.decisions.records = CATEGORY_CHECKLISTS.map(item => ({ id: item.key, title: `기록 ${item.key}`, category: item.key, detail: null, status: "confirmed", stateLabel: "결정 기록", source: "manual", createdAt: "2026-09-11T00:00:00Z" }));
    await act(async () => root.render(<AmoraDecisionBoard />));
    const decisions = container.querySelector('[aria-label="준비 결정 기록"]')!;
    expect(CATEGORY_CHECKLISTS).toHaveLength(21);
    for (const item of CATEGORY_CHECKLISTS) {
      const card = decisions.querySelector(`article[aria-label="기록 ${item.key}"]`)!;
      expect(card.textContent).toContain(item.label);
      expect(card.querySelector("a")?.getAttribute("href")).toBe(`/wedding/checklist?category=${item.key}`);
      expect(card.querySelector("a")?.textContent).toBe("분야 체크리스트 보기");
    }
  });

  it("opens mobile search in the active panel, preserves both queries when folded, and exposes an applied filter with a clear action", async () => {
    mocks.decisions.records = [{ id: "venue", title: "장소 비교", category: "venue", detail: null, status: "confirmed", stateLabel: "결정 기록", source: "chat", createdAt: "2026-09-07T00:00:00Z" }];
    mocks.data.actions = [action];
    await act(async () => root.render(<AmoraDecisionBoard />));
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="보드 검색 열기"]')!;
    const decisions = container.querySelector('[aria-label="준비 결정 기록"]')!;
    const decisionInput = decisions.querySelector<HTMLInputElement>('input[type="search"]')!;
    const taskInput = container.querySelector<HTMLInputElement>('[aria-label="공유 할 일"] input[type="search"]')!;
    const enter = async (input: HTMLInputElement, text: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.contains(decisionInput)).toBe(true);
    expect(document.activeElement).toBe(decisionInput);
    await enter(decisionInput, "장소");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    expect(decisionInput.value).toBe("장소");
    expect(toggle.getAttribute("aria-label")).toContain("검색 적용 중");
    expect(container.textContent).toContain("검색 적용 중: 장소");
    await act(async () => toggle.click());
    expect(document.activeElement).toBe(decisionInput);
    expect(decisionInput.value).toBe("장소");
    await selectBoard("공유 할 일");
    expect(document.activeElement).toBe(taskInput);
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.contains(taskInput)).toBe(true);
    expect(taskInput.value).toBe("");
    await enter(taskInput, "없는 단어");
    await act(async () => toggle.click());
    expect(taskInput.value).toBe("없는 단어");
    expect(container.querySelector('[aria-label="공유 할 일"] article')).toBeNull();
    expect(container.textContent).toContain("검색 적용 중: 없는 단어");
    await selectBoard("결정 기록");
    expect(decisionInput.value).toBe("장소");
    expect(taskInput.value).toBe("없는 단어");
    expect(container.textContent).toContain("검색 적용 중: 장소");
    await selectBoard("공유 할 일");
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(control => control.textContent === "검색 해제")!.click());
    expect(taskInput.value).toBe("");
    expect(decisionInput.value).toBe("장소");
    expect(container.querySelector('[aria-label="공유 할 일"] article')?.textContent).toContain(action.title);
    expect(toggle.getAttribute("aria-label")).not.toContain("검색 적용 중");
    expect(document.activeElement).toBe(toggle);
    expect(mocks.data.update).not.toHaveBeenCalled();
  });

  it.each([
    { state: "demo", values: { isDemo: true } },
    { state: "unavailable", values: { available: false } },
    { state: "loading", values: { loading: true } },
    { state: "error", values: { error: "결정 기록을 확인하지 못했어요" } },
  ])("disables decision search with no dangling controls while $state and still opens shared task search", async ({ values }) => {
    Object.assign(mocks.decisions, values);
    mocks.data.actions = [action];
    await act(async () => root.render(<AmoraDecisionBoard />));
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="보드 검색 열기"]')!;
    expect(container.querySelector('[aria-label="준비 결정 기록"] input[type="search"]')).toBeNull();
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-controls")).toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await selectBoard("공유 할 일");
    expect(toggle.disabled).toBe(false);
    const input = container.querySelector<HTMLInputElement>('[aria-label="공유 할 일"] input[type="search"]')!;
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.contains(input)).toBe(true);
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(mocks.decisions.refresh).not.toHaveBeenCalled();
    expect(mocks.data.update).not.toHaveBeenCalled();
  });

  it("preserves an open decision query through a read interruption and restores only the available input focus", async () => {
    mocks.decisions.records = [{ id: "venue", title: "장소 비교", category: "venue", detail: null, status: "confirmed", stateLabel: "결정 기록", source: "chat", createdAt: "2026-09-07T00:00:00Z" }];
    await act(async () => root.render(<AmoraDecisionBoard />));
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="보드 검색 열기"]')!;
    await act(async () => toggle.click());
    const originalInput = container.querySelector<HTMLInputElement>('[aria-label="준비 결정 기록"] input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(originalInput, "장소");
      originalInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.decisions.loading = true;
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBeNull();
    expect(container.textContent).toContain("검색 적용 중: 장소");
    await selectBoard("공유 할 일");
    const taskInput = container.querySelector<HTMLInputElement>('[aria-label="공유 할 일"] input[type="search"]')!;
    expect(document.activeElement).toBe(taskInput);
    expect(taskInput.value).toBe("");
    Object.assign(mocks.decisions, { loading: false, error: "결정 기록을 확인하지 못했어요" });
    await selectBoard("결정 기록");
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-controls")).toBeNull();
    mocks.decisions.error = null;
    await act(async () => root.render(<AmoraDecisionBoard />));
    const restoredInput = container.querySelector<HTMLInputElement>('[aria-label="준비 결정 기록"] input[type="search"]')!;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(restoredInput.value).toBe("장소");
    expect(document.activeElement).toBe(restoredInput);
    expect(taskInput.value).toBe("");
    expect(mocks.data.update).not.toHaveBeenCalled();
  });

  it("shows an uncategorized legacy decision without inventing a field link", async () => {
    mocks.decisions.records = [{ id: "legacy", title: "과거의 공동 결정", category: "", detail: null, status: "confirmed", stateLabel: "결정 기록", source: "", createdAt: "2026-09-07T00:00:00Z" }];
    await act(async () => root.render(<AmoraDecisionBoard />));
    const card = container.querySelector('[aria-label="과거의 공동 결정"]');
    expect(card?.textContent).toContain("준비 결정");
    expect(card?.querySelector('a[href*="checklist"]')).toBeNull();
  });

  it("renders actual decision states without inventing two-person acknowledgement and pages independently", async () => {
    mocks.decisions.records = [
      { id: "decision1", title: "실제로 기록한 예산 방향", category: "venue", detail: "저장된 이유", status: "confirmed", stateLabel: "결정 기록", source: "budget", createdAt: "2026-09-07T00:00:00Z" },
      { id: "decision2", title: "아직 고려 중인 장소", category: "venue", detail: null, status: "considering", stateLabel: "고려 중", source: "chat", createdAt: "2026-09-06T00:00:00Z" },
    ];
    mocks.decisions.nextCursor = { id: "decision2", createdAt: "2026-09-06T00:00:00Z" };
    mocks.data.actions = [{ ...action, status: "done" }];
    await act(async () => root.render(<AmoraDecisionBoard />));
    const decisions = container.querySelector('[aria-label="준비 결정 기록"]')!;
    expect(decisions.querySelector('[aria-label="확정 결정"]')?.textContent).toContain("실제로 기록한 예산 방향");
    expect(decisions.querySelector('[aria-label="논의 중 결정"]')?.textContent).toContain("아직 고려 중인 장소");
    expect(decisions.textContent).not.toContain(action.title);
    expect(decisions.textContent).not.toMatch(/두 분 모두 확인|신랑 확인 대기|나도 확인/);
    const considering = Array.from(decisions.querySelectorAll<HTMLButtonElement>('[aria-label="결정 상태"] button')).find(button => button.textContent?.includes("논의 중"))!;
    await act(async () => considering.click()); expect(considering.getAttribute("aria-pressed")).toBe("true");
    await act(async () => Array.from(decisions.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "이전 결정 더 보기")!.click());
    expect(mocks.decisions.loadMore).toHaveBeenCalledOnce(); expect(mocks.data.loadMore).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="공유 할 일"]')?.textContent).toContain(action.title);
  });

  it("distinguishes decision failure and retry from no data without hiding the shared tasks", async () => {
    mocks.decisions.error = "결정 기록을 확인하지 못했어요";
    mocks.data.actions = [action];
    await act(async () => root.render(<AmoraDecisionBoard />));
    const decisions = container.querySelector('[aria-label="준비 결정 기록"]')!;
    expect(decisions.querySelector('[role="alert"]')?.textContent).toContain("확인하지 못했어요");
    expect(decisions.textContent).not.toContain("이 상태로 저장된 결정이 없어요");
    await act(async () => Array.from(decisions.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "결정 다시 불러오기")!.click());
    expect(mocks.decisions.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="공유 할 일"]')?.textContent).toContain(action.title);
  });

  it("distinguishes loading, read error, empty data, and a partial loaded board", async () => {
    mocks.data.loading = true;
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(container.textContent).toContain("불러오는 중");
    expect(container.textContent).not.toContain("아직 저장된 할 일이 없어요");
    mocks.data.loading = false; mocks.data.error = "불러오지 못했어요";
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("불러오지 못했어요");
    expect(container.textContent).not.toContain("아직 저장된 할 일이 없어요");
    mocks.data.error = null;
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(container.textContent).toContain("아직 저장된 할 일이 없어요");
    Object.assign(mocks.data, { actions: [action], count: 100, open_count: 90, truncated: true });
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(container.textContent).toContain("전체 100개 중 1개");
    expect(container.textContent).toContain("불러온 카드 기준");
    expect(container.textContent).not.toMatch(/두 분 모두 확인|상대가 확인하면 확정|신랑 확인 대기/);
  });

  it("disables existing card mutations during create and does not call an uncertain empty snapshot unsaved", async () => {
    Object.assign(mocks.data, { actions: [action], creating: true, createLocked: true });
    await act(async () => root.render(<AmoraDecisionBoard />));
    const card = container.querySelector('[data-preparation-action="act_test"]')!;
    expect([...card.querySelectorAll<HTMLButtonElement>("button")].every(button => button.disabled)).toBe(true);
    Object.assign(mocks.data, { actions: [], creating: false });
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(container.textContent).not.toContain("아직 저장된 할 일이 없어요");
    expect(container.textContent).toContain("저장 여부는 목록을 새로고쳐 확인해 주세요");
  });

  it("filters actual titles and categories and exposes a truthful mobile status selection", async () => {
    mocks.data.actions = [{ ...action, categoryKey: "makeup" }, { ...action, id: "act_other", title: "예식장 후보 비교", categoryKey: "venue", status: "done" }];
    mocks.data.count = 2;
    await act(async () => root.render(<AmoraDecisionBoard />));
    const makeupFilter = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="분야 필터"] button')).find((node) => node.textContent?.includes("헤어·메이크업"))!;
    await act(async () => makeupFilter.click());
    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(container.querySelector("article")?.textContent).toContain(action.title);
    const all = container.querySelector<HTMLButtonElement>('[aria-label="분야 필터"] button')!;
    await act(async () => all.click());
    const input = container.querySelector<HTMLInputElement>('[aria-label="공유 할 일"] input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "예식장");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(container.querySelector("article")?.textContent).toContain("예식장 후보 비교");
    const done = container.querySelector<HTMLButtonElement>('[aria-label="할 일 상태"] button')!;
    await act(async () => done.click());
    expect(done.getAttribute("aria-pressed")).toBe("true");
  });

  it("sends completion, dismissal, restoration, and a canonical 21-category choice to the existing mutation", async () => {
    mocks.data.actions = [action]; mocks.data.count = 1;
    await act(async () => root.render(<AmoraDecisionBoard />));
    const select = container.querySelector("select")!;
    expect(Array.from(select.options).filter((option) => option.value).map((option) => option.value)).toEqual(CATEGORY_CHECKLISTS.map((category) => category.key));
    await act(async () => { select.value = "makeup"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { category_key: "makeup" });
    const clickText = async (text: string) => {
      const control = Array.from(container.querySelectorAll<HTMLButtonElement>("article button")).find((node) => node.textContent === text)!;
      await act(async () => control.click());
    };
    await clickText("완료로 표시");
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { status: "done" });
    await clickText("보류·숨김");
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { status: "dismissed" });
    mocks.data.actions = [{ ...action, status: "dismissed" }];
    await act(async () => root.render(<AmoraDecisionBoard />));
    await clickText("다시 꺼내기");
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { status: "open" });
  });

  it("keeps provenance modest, safe category links real, and unsafe legacy hrefs inert", async () => {
    mocks.data.actions = [{ ...action, categoryKey: "makeup", href: "//outside.example" }];
    await act(async () => root.render(<AmoraDecisionBoard />));
    const card = container.querySelector("article")!;
    expect(card.textContent).toContain("대화에서 추가된 할 일");
    expect(card.textContent).not.toContain("저장 버튼");
    expect(card.querySelector("a")?.getAttribute("href")).toBe("/wedding/checklist?category=makeup");
    expect(card.textContent).not.toContain("연결된 화면 보기");
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe(action.updatedAt);
  });

  it("edits and clears plan fields, preserves failed drafts and never resends an untouched legacy date", async () => {
    mocks.data.actions = [{ ...action, categoryKey: "venue", dueDate: "양가 일정 맞춘 뒤" }]; mocks.data.count = 1;
    await act(async () => root.render(<AmoraDecisionBoard />));
    await selectBoard("공유 할 일");
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${action.title} 수정"]`)!.click());
    const description = container.querySelector<HTMLTextAreaElement>('article textarea')!;
    const date = container.querySelector<HTMLInputElement>('article input[data-plan-date]')!;
    expect(date.type).toBe("text"); expect(date.value).toBe("양가 일정 맞춘 뒤");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(description, "새 확인 내용");
      description.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.data.update.mockResolvedValueOnce(false);
    await act(async () => container.querySelector('article form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { description: "새 확인 내용" });
    expect(description.value).toBe("새 확인 내용"); expect(date.value).toBe("양가 일정 맞춘 뒤");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(description, "");
      description.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(date, "");
      date.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector('article form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { description: "", due_date: "" });
    expect(container.querySelector('article textarea')).toBeNull();
  });

  it("edits title and category through the existing action and keeps the draft on failure", async () => {
    mocks.data.actions = [{ ...action, categoryKey: "venue" }]; mocks.data.count = 1;
    await act(async () => root.render(<AmoraDecisionBoard />));
    await selectBoard("공유 할 일");
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${action.title} 수정"]`)!.click());
    const input = container.querySelector<HTMLInputElement>("article input")!;
    const select = container.querySelector<HTMLSelectElement>("article select")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  실제 수정 제목  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      select.value = "makeup"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await selectBoard("결정 기록");
    expect(container.querySelector("article input")).toBe(input);
    await selectBoard("공유 할 일");
    expect(input.value).toBe("  실제 수정 제목  ");
    expect(select.value).toBe("makeup");
    expect(mocks.data.update).not.toHaveBeenCalled();
    const form = container.querySelector("article form")!;
    mocks.data.update.mockResolvedValueOnce(false);
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { title: "실제 수정 제목", category_key: "makeup" });
    expect(container.querySelector("article input")).toBe(input); expect(input.value).toBe("  실제 수정 제목  ");
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector("article input")).toBeNull();
  });

  it("does not overwrite a partner's refreshed plan fields while editing only the title", async () => {
    mocks.data.actions = [{ ...action, categoryKey: "venue", dueDate: "다음 주 중" }];
    await act(async () => root.render(<AmoraDecisionBoard />)); await selectBoard("공유 할 일");
    expect(container.querySelector("article")!.textContent).toContain("예정일 다음 주 중");
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${action.title} 수정"]`)!.click());
    const title = container.querySelector<HTMLInputElement>("article input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "새 제목");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.data.actions = [{ ...action, categoryKey: "venue", description: "상대가 새로 적은 설명", dueDate: "다음 달 중" }];
    await act(async () => root.render(<AmoraDecisionBoard />));
    await act(async () => container.querySelector('article form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { title: "새 제목" });
  });

  it("allows title-only editing without shortening oversized legacy plan fields", async () => {
    mocks.data.actions = [{ ...action, categoryKey: "venue", description: "가".repeat(501), dueDate: "나".repeat(41) }];
    await act(async () => root.render(<AmoraDecisionBoard />)); await selectBoard("공유 할 일");
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${action.title} 수정"]`)!.click());
    const title = container.querySelector<HTMLInputElement>("article input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "새 제목");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = container.querySelector<HTMLButtonElement>('article button[type="submit"]')!;
    expect(save.disabled).toBe(false);
    await act(async () => container.querySelector('article form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { title: "새 제목" });
  });

  it("loads older records through the real cursor control and exposes the saved-answer view", async () => {
    Object.assign(mocks.data, { actions: [action], count: 81, truncated: true, nextCursor: "next" });
    await act(async () => root.render(<AmoraDecisionBoard />));
    const more = Array.from(container.querySelectorAll("button")).find(value => value.textContent === "이전 기록 더 보기")!;
    await act(async () => more.click()); expect(mocks.data.loadMore).toHaveBeenCalledOnce();
    const saved = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="보드 보기"] button')).find(control => control.textContent === "저장한 답변");
    expect(saved).toBeDefined();
    expect(document.getElementById(saved!.getAttribute("aria-controls")!)).not.toBeNull();
    mocks.data.loadingMore = true;
    await act(async () => root.render(<AmoraDecisionBoard />)); expect(more.disabled).toBe(true);
  });

  it("labels demo changes as local and exposes a failed save without fake success", async () => {
    Object.assign(mocks.data, { actions: [action], isDemo: true, updateError: "변경을 저장하지 못했어요" });
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(container.querySelector<HTMLElement>('[aria-label="공유 할 일"]')?.hidden).toBe(false);
    expect(container.querySelector('[aria-label="준비 결정 기록"]')?.parentElement?.hidden).toBe(true);
    expect(container.querySelector('[aria-label="공유 할 일"] [role="note"]')?.textContent).toContain("실제 준비 기록에 저장되지 않아요");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("저장하지 못했어요");
    expect(container.querySelector("article")?.textContent).toContain("완료로 표시");
  });
});
