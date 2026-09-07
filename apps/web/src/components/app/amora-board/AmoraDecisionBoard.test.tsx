import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmoraActionItem } from "@/lib/amora/actions";
import type { PreparationDecision } from "@/lib/amora/preparationBoard";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";

const mocks = vi.hoisted(() => ({
  decisions: { records: [] as PreparationDecision[], loading: false, loadingMore: false, error: null as string | null, nextCursor: null as { id: string; createdAt: string } | null, available: true, isDemo: false, refresh: vi.fn(), loadMore: vi.fn() },
  data: {
    actions: [] as AmoraActionItem[], loading: false, error: null as string | null,
    count: 0, open_count: 0, truncated: false, isDemo: false,
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
    Object.assign(mocks.data, { actions: [], loading: false, error: null, count: 0, open_count: 0, truncated: false, isDemo: false, updateError: null, updatingIds: new Set<string>() });
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

  it("loads older records through the real cursor control and links saved answers separately", async () => {
    Object.assign(mocks.data, { actions: [action], count: 81, truncated: true, nextCursor: "next" });
    await act(async () => root.render(<AmoraDecisionBoard />));
    const more = Array.from(container.querySelectorAll("button")).find(value => value.textContent === "이전 기록 더 보기")!;
    await act(async () => more.click()); expect(mocks.data.loadMore).toHaveBeenCalledOnce();
    expect(container.querySelector('a[href="/wedding/saved"]')).not.toBeNull();
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
