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
    updateError: null as string | null, updatingIds: new Set<string>(), ownerScope: "board-owner",
    canCreate: false, create: vi.fn(), cancelCreate: vi.fn(), updateIssues: {} as Record<string, unknown>,
    refresh: vi.fn(), update: vi.fn(), loadMore: vi.fn(), nextCursor: null as string | null, loadingMore: false,
  },
}));
vi.mock("@/hooks/useAmoraPreparationActions", () => ({ useAmoraPreparationActions: () => mocks.data }));
vi.mock("./useDecisionBoard", () => ({ useDecisionBoard: () => mocks.decisions }));
import AmoraDecisionBoard from "./AmoraDecisionBoard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const action: AmoraActionItem = {
  id: "act_test", title: "출장 추가 비용 확인", description: "업체에 서면으로 물어보기", status: "open", source: "chat", priority: "medium",
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", viewVersion: "2026-09-01T00:00:00Z",
};

describe("AmoraDecisionBoard", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(mocks.decisions, { records: [], loading: false, loadingMore: false, error: null, nextCursor: null, available: true, isDemo: false });
    mocks.decisions.refresh.mockReset(); mocks.decisions.loadMore.mockReset();
    Object.assign(mocks.data, { actions: [], loading: false, error: null, count: 0, open_count: 0, truncated: false, isDemo: false, creating: false, createLocked: false, canCreate: false, updateError: null, updatingIds: new Set<string>(), updateIssues: {} });
    mocks.data.refresh.mockReset(); mocks.data.update.mockReset().mockResolvedValue(true); mocks.data.create.mockReset(); mocks.data.cancelCreate.mockReset();
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
    expect(cards[1].querySelector("h4")?.textContent).toBe("결혼식장 예산: 1,300만원 → 1,250만원");
    expect(cards[1].textContent).toContain("준비 계획");
    expect(cards[1].textContent).toContain("결혼식장");
    expect(cards[1].querySelector("a")?.getAttribute("href")).toBe("/wedding/budget");
    // 같은 값을 다시 바꾼 기록이 없으면 마지막 기록 배지와 안내를 붙이지 않는다.
    for (const card of cards) {
      expect(card.textContent).not.toContain("마지막 기록");
      expect(card.textContent).not.toContain("지금 값은 예산 화면에서 확인해 주세요.");
    }
    const original = cards[1].querySelector("details")!;
    expect(original.querySelector("summary")?.textContent).toBe("저장 원문 보기");
    await act(async () => original.querySelector("summary")!.click());
    expect(original.open).toBe(true);
    expect(original.querySelector("p")?.textContent).toBe(originalTitle);
    expect(mocks.decisions.records[1].title).toBe(originalTitle);
    expect(board.textContent).not.toContain("지금의 상태별로");
    expect(board.textContent).toContain("현재 일정 상태는 일정에서 확인");
    expect(board.textContent).toContain("저장된 결정 기록 2개");
    expect(mocks.data.update).not.toHaveBeenCalled();
    expect(mocks.decisions.refresh).not.toHaveBeenCalled();
  });

  it("folds superseded budget values, lists budget decisions under their field, and collapses routine progress saves", async () => {
    const coupleId = "11111111-1111-4111-8111-111111111111";
    const dress = (id: string, createdAt: string, before: number | null, after: number) => {
      const title = `드레스·예식 정장 예산 ${after.toLocaleString("en-US")}원 반영`;
      return { id, couple_id: coupleId, visibility: "shared", category: "budget", title, reasoning: "승인한 구성원의 예산 배정 변경", decision_type: "decided",
        source: "budget", created_at: createdAt, superseded_at: null, memory_key: null, metadata: { origin: "amora_shared_budget_action" },
        chosen_value: { schemaVersion: 1, budgetScope: "category", value: title, categoryKey: "dress", amount: after,
          budgetDelta: { schemaVersion: 1, totalBudget: null, categories: [{ key: "dress", label: "드레스·예식 정장", beforeBudget: before, afterBudget: after }] } } };
    };
    const routine = { id: "33333333-3333-4333-8333-333333333330", couple_id: coupleId, visibility: "shared", category: "plan", title: "진행 상황: 2개 수정", reasoning: null,
      decision_type: "decided", source: "manual", created_at: "2026-09-12T00:00:00Z", superseded_at: null, memory_key: null, metadata: { origin: "couple_plan_change_request" },
      chosen_value: { schemaVersion: 1, changes: { progress_patch: { dress: { category: "dress", status: "in_progress" }, venue: { category: "venue", status: "completed" } }, progress_remove_keys: [] } } };
    mocks.decisions.records = parsePreparationDecisions([
      dress("33333333-3333-4333-8333-333333333339", "2026-09-14T03:00:00Z", 4500000, 4000000),
      dress("33333333-3333-4333-8333-333333333338", "2026-09-14T02:00:00Z", 4000000, 4500000),
      dress("33333333-3333-4333-8333-333333333337", "2026-09-14T01:00:00Z", null, 4000000),
      routine,
    ], coupleId).records;
    await act(async () => root.render(<AmoraDecisionBoard />));
    const board = container.querySelector('[aria-label="준비 결정 기록"]')!;
    const confirmed = board.querySelector('[aria-label="확정 결정"]')!;
    const current = Array.from(confirmed.querySelectorAll("article")).filter(card => !card.closest("details[data-previous-values]"));
    expect(current.map(card => card.querySelector("h4")?.textContent)).toEqual(["드레스·예식 정장 예산 450만원 → 400만원"]);
    // 기록에서 본 마지막 값일 뿐이다. 아모라 초기화·삭제는 기록을 남기지 않으니 지금 값처럼 말하지 않는다.
    expect(current[0].textContent).not.toContain("최근 값");
    expect(current[0].textContent).toContain("마지막 기록");
    expect(current[0].textContent).toContain("지금 값은 예산 화면에서 확인해 주세요.");
    const previous = confirmed.querySelector<HTMLDetailsElement>("details[data-previous-values]")!;
    expect(previous.open).toBe(false);
    expect(previous.querySelector("summary")?.textContent).toBe("이전 값 2개 보기");
    expect(Array.from(previous.querySelectorAll("article"), card => [card.querySelector("h4")?.textContent, card.textContent?.includes("이전 값")])).toEqual([
      ["드레스·예식 정장 예산 400만원 → 450만원", true], ["드레스·예식 정장 예산 미정 → 400만원", true],
    ]);
    // 이전 값 카드에는 마지막 기록 배지와 카드별 안내를 붙이지 않는다(묶음 안내가 이미 있다).
    for (const card of previous.querySelectorAll("article")) {
      expect(card.textContent).not.toContain("마지막 기록");
      expect(card.textContent).not.toContain("지금 값은 예산 화면에서 확인해 주세요.");
    }
    const filters = () => Array.from(board.querySelectorAll<HTMLButtonElement>('[aria-label="결정 분야 필터"] button'));
    expect(filters().map(control => control.textContent)).toEqual(["전체3", "드레스·예식 정장3", "예산3"]);
    await act(async () => filters().find(control => control.textContent?.startsWith("드레스"))!.click());
    expect(confirmed.querySelectorAll("article")).toHaveLength(3);
    expect(board.textContent).not.toContain("진행 상황: 2개 수정");
    const routineBox = board.querySelector<HTMLDetailsElement>("details[data-routine-progress]")!;
    expect(routineBox.querySelector("summary")?.textContent).toBe("진행 상황 저장 1건은 날짜별로 접어 두었어요");
    expect(routineBox.textContent).toContain("9. 12. · 저장 1건 · 분야 2개 수정");
    expect(board.textContent).toContain("저장된 결정 기록 3개");
    expect(mocks.data.update).not.toHaveBeenCalled();
  });

  // 2026-09-16 운영 실측: 일정 화면에서 체크한 저장(schedule·scheduled) 여섯 줄이 결정 목록에 남았고,
  // 아모라 배분 기록 설명이 "한복 1,500,000원, 예단 2,000,000원" 원문으로 보였다.
  it("folds schedule-screen progress saves and reads the Amora allocation detail with screen names while the original stays behind 저장 원문 보기", async () => {
    const coupleId = "11111111-1111-4111-8111-111111111111";
    const value = "총예산 35,000,000원 기준 예산 배분 반영: 한복 1,500,000원, 예단 2,000,000원";
    const allocation = { id: "33333333-3333-4333-8333-333333333339", couple_id: coupleId, visibility: "shared", category: "budget",
      title: "총예산 35,000,000원 기준 예산 배분 반영", reasoning: `승인한 구성원의 예산 배정 변경. ${value}`, decision_type: "decided", source: "budget",
      created_at: "2026-09-15T13:40:51Z", superseded_at: null, memory_key: null, metadata: { origin: "amora_shared_budget_action" },
      chosen_value: { schemaVersion: 1, budgetScope: "allocation", value, budgetDelta: { schemaVersion: 1, totalBudget: { before: 32500000, after: 35000000 },
        categories: [{ key: "hanbok", label: "한복", beforeBudget: null, afterBudget: 1500000 }, { key: "yedan", label: "예단", beforeBudget: null, afterBudget: 2000000 }] } } };
    const scheduleSave = (id: string) => ({ id, couple_id: coupleId, visibility: "shared", category: "schedule", title: "진행 상황: 1개 수정",
      reasoning: "현재 구성원이 확인한 수동 계획 변경", decision_type: "scheduled", source: "schedule", created_at: "2026-09-02T05:53:44Z",
      superseded_at: null, memory_key: null, metadata: { origin: "couple_plan_change_request", surfaceHref: "/schedule" },
      chosen_value: { schemaVersion: 1, changes: { progress_patch: { greeting: { category: "greeting", status: "in_progress",
        checklist: [{ id: "greeting_01", done: true, label: "각자 찾아뵐 날짜와 시간, 만날 곳 확정" }] } }, progress_remove_keys: [] } } });
    mocks.decisions.records = parsePreparationDecisions([
      allocation, scheduleSave("33333333-3333-4333-8333-333333333338"), scheduleSave("33333333-3333-4333-8333-333333333337"),
    ], coupleId).records;
    await act(async () => root.render(<AmoraDecisionBoard />));
    const board = container.querySelector('[aria-label="준비 결정 기록"]')!;
    const cards = Array.from(board.querySelectorAll("article"));
    expect(cards).toHaveLength(1);
    expect(board.textContent).not.toContain("진행 상황: 1개 수정");
    expect(board.querySelector("details[data-routine-progress] summary")?.textContent).toBe("진행 상황 저장 2건은 날짜별로 접어 두었어요");
    const preview = cards[0].querySelector("h4 + p")!;
    expect(preview.textContent).toBe("승인한 구성원의 예산 배정 변경. 총예산 3,250만원 → 3,500만원 · 한복 예산 미정 → 150만원 · 두 가족에게 드릴 선물 예산 미정 → 200만원");
    expect(preview.textContent).not.toContain("예단");
    const original = cards[0].querySelector("details")!;
    expect(original.querySelector("summary")?.textContent).toBe("저장 원문 보기");
    expect(original.textContent).toContain(`승인한 구성원의 예산 배정 변경. ${value}`);
    expect(board.textContent).toContain("저장된 결정 기록 1개");
  });

  // 미리보기는 잘린다. 다시 적은 설명의 전후 금액은 원문에 없으므로 펼친 곳에서 끝까지 보여야 한다.
  it("shows the full rewritten allocation detail inside 저장 원문 보기 when the preview is cut", async () => {
    const coupleId = "11111111-1111-4111-8111-111111111111";
    const items = Array.from({ length: 20 }, (_, i) => ({ key: `custom_${i + 1}`, label: `직접 만든 항목 ${i + 1}번`, beforeBudget: null, afterBudget: 1500000 }));
    const value = `총예산 35,000,000원 기준 예산 배분 반영: ${items.map(item => `${item.label} 1,500,000원`).join(", ")}`;
    mocks.decisions.records = parsePreparationDecisions([{ id: "33333333-3333-4333-8333-333333333336", couple_id: coupleId, visibility: "shared", category: "budget",
      title: "총예산 35,000,000원 기준 예산 배분 반영", reasoning: `승인한 구성원의 예산 배정 변경. ${value}`, decision_type: "decided", source: "budget",
      created_at: "2026-09-15T13:40:51Z", superseded_at: null, memory_key: null, metadata: { origin: "amora_shared_budget_action" },
      chosen_value: { schemaVersion: 1, budgetScope: "allocation", value, budgetDelta: { schemaVersion: 1, totalBudget: null, categories: items } } }], coupleId).records;
    await act(async () => root.render(<AmoraDecisionBoard />));
    const card = container.querySelector('[aria-label="준비 결정 기록"] article')!;
    const full = `승인한 구성원의 예산 배정 변경. ${items.map(item => `${item.label} 예산 미정 → 150만원`).join(" · ")}`;
    expect(card.querySelector("h4 + p")?.textContent).not.toBe(full);
    const texts = [...card.querySelectorAll("details p")].map(p => p.textContent);
    expect(texts).toContain(full);
    expect(texts).toContain(`승인한 구성원의 예산 배정 변경. ${value}`);
  });

  // 체크 저장이 한 페이지를 다 채우면 접고 난 결정이 0개다. 빈 목록이라고 말하지 말고 이어서 불러온다.
  it("keeps loading when a whole page is routine progress saves and never claims there are no decisions while more records exist", async () => {
    const coupleId = "11111111-1111-4111-8111-111111111111";
    mocks.decisions.records = parsePreparationDecisions([{ id: "33333333-3333-4333-8333-333333333338", couple_id: coupleId, visibility: "shared",
      category: "schedule", title: "진행 상황: 1개 수정", reasoning: null, decision_type: "scheduled", source: "schedule", created_at: "2026-09-02T05:53:44Z",
      superseded_at: null, memory_key: null, metadata: { origin: "couple_plan_change_request" },
      chosen_value: { schemaVersion: 1, changes: { progress_patch: { greeting: { category: "greeting", status: "in_progress", checklist: [] } }, progress_remove_keys: [] } } }], coupleId).records;
    mocks.decisions.nextCursor = { id: "33333333-3333-4333-8333-333333333338", createdAt: "2026-09-02T05:53:44Z" };
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(mocks.decisions.loadMore).toHaveBeenCalledTimes(1);
    const board = container.querySelector('[aria-label="준비 결정 기록"]')!;
    expect([...board.querySelectorAll("p")].some((p) => p.textContent === "이 상태로 저장된 결정이 없어요.")).toBe(false);
    expect(board.textContent).toContain("불러온 기록에는 이 상태로 저장된 결정이 없어요. 아래에서 이전 결정을 더 불러올 수 있어요.");
  });

  it("does not auto-load more decision pages when the loaded page already shows a decision", async () => {
    const coupleId = "11111111-1111-4111-8111-111111111111";
    mocks.decisions.records = parsePreparationDecisions([{ id: "33333333-3333-4333-8333-333333333337", couple_id: coupleId, visibility: "shared",
      category: "budget", title: "드레스·예식 정장 예산 4,000,000원 반영", reasoning: "승인한 구성원의 예산 배정 변경", decision_type: "decided", source: "budget",
      created_at: "2026-09-15T06:17:39Z", superseded_at: null, memory_key: null, metadata: { origin: "amora_shared_budget_action" }, chosen_value: null }], coupleId).records;
    mocks.decisions.nextCursor = { id: "33333333-3333-4333-8333-333333333337", createdAt: "2026-09-15T06:17:39Z" };
    await act(async () => root.render(<AmoraDecisionBoard />));
    expect(mocks.decisions.loadMore).not.toHaveBeenCalled();
  });

  it("shows a compact summary strip at phone widths on both boards", async () => {
    await act(async () => root.render(<AmoraDecisionBoard />));
    const strips = Array.from(container.querySelectorAll<HTMLElement>("[data-board-summary]"));
    expect(strips).toHaveLength(2);
    for (const strip of strips) {
      expect(strip.className.split(/\s+/)).toContain("flex");
      expect(strip.className.split(/\s+/)).not.toContain("hidden");
    }
    expect(strips[0].textContent).toContain("두 사람이 모두 확인했다는 뜻은 아니에요");
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
    expect(decisions.textContent).toContain("저장된 결정 기록 3개");
    expect(decisions.textContent).toContain("가장 최근에 확정한 내용을 기준으로 보여드려요");
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
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { category_key: "makeup" }, { version: action.viewVersion, ownerScope: "board-owner" });
    const clickText = async (text: string) => {
      const control = Array.from(container.querySelectorAll<HTMLButtonElement>("article button")).find((node) => node.textContent === text)!;
      await act(async () => control.click());
    };
    await clickText("완료로 표시");
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { status: "done" }, { version: action.viewVersion, ownerScope: "board-owner" });
    await clickText("보류·숨김");
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { status: "dismissed" }, { version: action.viewVersion, ownerScope: "board-owner" });
    mocks.data.actions = [{ ...action, status: "dismissed" }];
    await act(async () => root.render(<AmoraDecisionBoard />));
    await clickText("다시 꺼내기");
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { status: "open" }, { version: action.viewVersion, ownerScope: "board-owner" });
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
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { description: "새 확인 내용" }, { version: action.viewVersion, ownerScope: "board-owner" });
    expect(description.value).toBe("새 확인 내용"); expect(date.value).toBe("양가 일정 맞춘 뒤");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(description, "");
      description.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(date, "");
      date.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector('article form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { description: "", due_date: "" }, { version: action.viewVersion, ownerScope: "board-owner" });
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
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { title: "실제 수정 제목", category_key: "makeup" }, { version: action.viewVersion, ownerScope: "board-owner" });
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
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { title: "새 제목" }, { version: action.viewVersion, ownerScope: "board-owner" });
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
    expect(mocks.data.update).toHaveBeenLastCalledWith(action.id, { title: "새 제목" }, { version: action.viewVersion, ownerScope: "board-owner" });
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

  it("resets activeStatus to open and category to all when a new task is created while filtered", async () => {
    const doneTask: AmoraActionItem = { ...action, id: "done_1", title: "완료된 예식장 확인", categoryKey: "venue", status: "done" };
    const newTask: AmoraActionItem = { ...action, id: "new_1", title: "새로 추가한 드레스 할 일", categoryKey: "dress", status: "open" };
    Object.assign(mocks.data, { actions: [doneTask], count: 1, canCreate: true });
    mocks.data.create.mockImplementation(async () => {
      mocks.data.actions = [newTask, doneTask];
      return true;
    });
    await act(async () => root.render(<AmoraDecisionBoard />));
    await selectBoard("공유 할 일");
    const venueFilter = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="분야 필터"] button')).find(btn => btn.textContent?.includes("결혼식장"))!;
    await act(async () => venueFilter.click());
    const doneStatusBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="할 일 상태"] button')).find(btn => btn.textContent?.includes("완료"))!;
    await act(async () => doneStatusBtn.click());
    expect(doneStatusBtn.getAttribute("aria-pressed")).toBe("true");
    expect(venueFilter.getAttribute("aria-pressed")).toBe("true");

    const openCreateBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="공유 할 일"] button')).find(btn => btn.textContent === "공유 할 일 추가")!;
    await act(async () => openCreateBtn.click());
    const createForm = container.querySelector<HTMLFormElement>('form[aria-label="공유 할 일 추가"]')!;
    const createTitleInput = createForm.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(createTitleInput, "새로 추가한 드레스 할 일");
      createTitleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => createForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => root.render(<AmoraDecisionBoard />));

    const openStatusBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="할 일 상태"] button')).find(btn => btn.textContent?.includes("진행 중"))!;
    const allFilterBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="분야 필터"] button')).find(btn => btn.textContent?.startsWith("전체"))!;
    expect(openStatusBtn.getAttribute("aria-pressed")).toBe("true");
    expect(allFilterBtn.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[aria-label="진행 중 할 일"]')?.textContent).toContain("새로 추가한 드레스 할 일");
  });

  it("syncs editor fields to the latest saved version when clicking 최신 내용으로 불러오기 on a 409 conflict", async () => {
    const latest: AmoraActionItem = {
      ...action,
      title: "상대가 저장한 최신 제목",
      categoryKey: "dress",
      description: "상대가 저장한 최신 메모",
      dueDate: "2026-12-01",
      viewVersion: "2026-09-02T00:00:00Z",
    };
    mocks.data.actions = [{ ...action, categoryKey: "venue" }];
    await act(async () => root.render(<AmoraDecisionBoard />));
    await selectBoard("공유 할 일");
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${action.title} 수정"]`)!.click());
    const titleInput = container.querySelector<HTMLInputElement>("article input[data-action-edit-title]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(titleInput, "내 초안 제목");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.data.update.mockImplementationOnce(async () => {
      mocks.data.actions = [latest];
      mocks.data.updateIssues = {
        [action.id]: {
          kind: "conflict",
          message: "다른 변경이 먼저 저장됐어요.",
          availability: "current",
          latest,
          ownerScope: "board-owner",
          sequence: 1,
        },
      };
      return false;
    });
    const form = container.querySelector("article form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => root.render(<AmoraDecisionBoard />));

    const loadLatestBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("article button")).find(btn => btn.textContent === "최신 내용으로 불러오기")!;
    expect(loadLatestBtn).toBeDefined();
    await act(async () => loadLatestBtn.click());

    expect(titleInput.value).toBe("상대가 저장한 최신 제목");
    expect(container.querySelector<HTMLSelectElement>("article select")!.value).toBe("dress");
    expect(container.querySelector<HTMLTextAreaElement>("article textarea")!.value).toBe("상대가 저장한 최신 메모");
    expect(container.querySelector<HTMLInputElement>("article input[data-plan-date]")!.value).toBe("2026-12-01");
  });
});
