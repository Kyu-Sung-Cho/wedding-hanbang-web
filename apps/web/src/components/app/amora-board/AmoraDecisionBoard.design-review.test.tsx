import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmoraActionItem } from "@/lib/amora/actions";
import type { AmoraPreparationActionUpdate } from "@/hooks/useAmoraPreparationActions";
import { parsePreparationDecisions, type PreparationDecision } from "@/lib/amora/preparationBoard";

const mocks = vi.hoisted(() => ({
  decisions: { records: [] as PreparationDecision[], loading: false, loadingMore: false, error: null, nextCursor: null, available: true, isDemo: false, refresh: vi.fn(), loadMore: vi.fn() },
  actions: { actions: [] as AmoraActionItem[], loading: false, loadingMore: false, error: null, count: 1, truncated: false, nextCursor: null, isDemo: false, updateError: null, updatingIds: new Set<string>(), update: vi.fn(), refresh: vi.fn(), loadMore: vi.fn() },
}));
vi.mock("./useDecisionBoard", () => ({ useDecisionBoard: () => mocks.decisions }));
vi.mock("@/hooks/useAmoraPreparationActions", () => ({ useAmoraPreparationActions: () => mocks.actions }));
import AmoraDecisionBoard from "./AmoraDecisionBoard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const task: AmoraActionItem = { id: "task-focus", title: "출장 비용 확인", categoryKey: "makeup", status: "open", priority: "medium", source: "chat", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" };

describe("decision board URL and post-action focus", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    window.history.replaceState(null, "", "/wedding/chat/board");
    mocks.actions.actions = [{ ...task }]; mocks.actions.isDemo = false; mocks.decisions.isDemo = false; mocks.decisions.records = [];
    mocks.actions.update.mockReset().mockImplementation(async (_id: string, updates: AmoraPreparationActionUpdate) => {
      mocks.actions.actions = mocks.actions.actions.map(action => ({ ...action, ...(updates.status ? { status: updates.status } : {}), ...(updates.title ? { title: updates.title } : {}), ...(updates.category_key !== undefined ? { categoryKey: updates.category_key } : {}) }));
      root.render(<AmoraDecisionBoard />);
      return true;
    });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); window.history.replaceState(null, "", "/"); vi.restoreAllMocks(); });
  const render = () => act(async () => root.render(<AmoraDecisionBoard />));
  const button = (name: string) => {
    const control = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(node => node.getAttribute("aria-label") === name || node.textContent === name);
    expect(control, name).toBeDefined(); return control!;
  };
  const click = (name: string) => act(async () => { const control = button(name); control.focus(); control.click(); });
  const panel = () => container.querySelector<HTMLElement>('[aria-label="공유 할 일"]')!;
  const titleInput = () => panel().querySelector<HTMLInputElement>("article input")!;
  const fillTitle = (value: string) => act(async () => {
    const input = titleInput(); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const announcement = () => container.querySelector('[data-board-announcement]')?.textContent ?? "";

  it("keeps the full decision through parsing, suffix search and an expandable original", async () => {
    const coupleId = "00000000-0000-4000-8000-000000000001";
    const title = "장소 조건 ".repeat(90) + "마지막 제목 조건";
    const detail = "서면으로 받은 조건 ".repeat(100) + "잔금지급전재검토";
    const parsed = parsePreparationDecisions([{ id: "00000000-0000-4000-8000-000000000002", couple_id: coupleId, visibility: "shared", category: "venue", title, reasoning: detail, decision_type: "decided", source: "chat", created_at: "2026-09-08T00:00:00Z", superseded_at: null, memory_key: null, metadata: null }], coupleId);
    expect(parsed.records[0].title).toBe(title); expect(parsed.records[0].detail).toBe(detail);
    mocks.decisions.records = parsed.records; await render();
    const input = container.querySelector<HTMLInputElement>('[aria-label="준비 결정 기록"] input[type="search"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "잔금지급전재검토"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const card = container.querySelector('[aria-label="준비 결정 기록"] article')!;
    expect(card).not.toBeNull();
    const summary = Array.from(card.querySelectorAll("summary")).find(node => node.textContent === "전체 결정 내용 보기")!;
    expect(summary).toBeDefined(); expect(summary.parentElement?.textContent).toContain(title); expect(summary.parentElement?.textContent).toContain(detail);
    await act(async () => summary.click()); expect(summary.parentElement?.hasAttribute("open")).toBe(true);
    expect(mocks.actions.update).not.toHaveBeenCalled();
  });

  it("opens the requested task view and preserves other URL values when switching", async () => {
    window.history.replaceState(null, "", "/wedding/chat/board?view=tasks&utm_source=mission#saved");
    await render(); expect(panel().hidden).toBe(false);
    await click("결정 기록");
    const url = new URL(window.location.href); expect(url.searchParams.get("view")).toBe("decisions"); expect(url.searchParams.get("utm_source")).toBe("mission"); expect(url.hash).toBe("#saved"); expect(panel().hidden).toBe(true);
    expect(mocks.actions.update).not.toHaveBeenCalled();
  });

  it("does not split an emoji at either decision preview boundary", async () => {
    mocks.decisions.records = [{ id: "emoji", category: "venue", title: "가".repeat(179) + "💐 조건", detail: "나".repeat(399) + "💍 조건", createdAt: "2026-09-08T00:00:00Z", status: "confirmed", stateLabel: "결정 기록", source: "chat" }];
    await render();
    const card = container.querySelector('[aria-label="준비 결정 기록"] article')!;
    expect(card.querySelector("h4")?.textContent).toBe("가".repeat(179) + "…");
    expect(card.querySelector(":scope > p")?.textContent).toBe("나".repeat(399) + "…");
    expect(card.querySelector("details")?.textContent).toContain("💐 조건"); expect(card.querySelector("details")?.textContent).toContain("💍 조건");
  });

  it("follows back/forward URL selection without losing a task edit draft", async () => {
    await render(); expect(panel().hidden).toBe(true); await click("공유 할 일"); await click(`${task.title} 수정`); await fillTitle("서면 견적 확인");
    await click("결정 기록");
    await act(async () => { window.history.replaceState(null, "", "/wedding/chat/board?view=tasks"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(panel().hidden).toBe(false); expect(titleInput().value).toBe("서면 견적 확인");
    await act(async () => { window.history.replaceState(null, "", "/wedding/chat/board"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(panel().hidden).toBe(true); expect(mocks.actions.update).not.toHaveBeenCalled();
  });

  it("keeps default modes and ignores unsupported URL values", async () => {
    window.history.replaceState(null, "", "/wedding/chat/board?view=delete"); await render(); expect(panel().hidden).toBe(true);
    mocks.actions.isDemo = true; mocks.decisions.isDemo = true; await render(); expect(panel().hidden).toBe(false);
    await act(async () => { window.history.replaceState(null, "", "/wedding/chat/board?view=decisions"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(panel().hidden).toBe(true); expect(mocks.actions.update).not.toHaveBeenCalled();
  });

  it("focuses the title on edit and returns focus after cancellation and a successful save", async () => {
    await render(); await click("공유 할 일"); await click(`${task.title} 수정`); expect(document.activeElement).toBe(titleInput());
    await click("취소"); expect(document.activeElement).toBe(button(`${task.title} 수정`));
    await click(`${task.title} 수정`); await fillTitle("서면 견적 확인"); await click("수정 저장");
    expect(mocks.actions.update).toHaveBeenCalledWith(task.id, { title: "서면 견적 확인" }); expect(document.activeElement).toBe(button("서면 견적 확인 수정"));
  });

  it("keeps a failed edit open and does not announce success", async () => {
    mocks.actions.update.mockResolvedValue(false); await render(); await click("공유 할 일"); await click(`${task.title} 수정`); await fillTitle("보존할 초안"); await click("수정 저장");
    expect(titleInput().value).toBe("보존할 초안"); expect(announcement()).toBe("");
  });

  it("announces a successful status change and focuses the current task status control", async () => {
    await render(); await click("공유 할 일"); await click("완료로 표시");
    expect(mocks.actions.update).toHaveBeenCalledWith(task.id, { status: "done" }); expect(announcement()).toContain("완료"); expect(announcement()).toContain(task.title);
    expect(document.activeElement).toBe(panel().querySelector('[aria-label="할 일 상태"] button[aria-pressed="true"]'));
    await act(async () => root.render(<AmoraDecisionBoard />)); expect(mocks.actions.update).toHaveBeenCalledTimes(1);
  });

  it("does not announce success or redirect focus when a status write fails", async () => {
    mocks.actions.update.mockResolvedValue(false); await render(); await click("공유 할 일"); await click("보류·숨김");
    expect(announcement()).toBe(""); expect(document.activeElement).toBe(button("보류·숨김")); expect(mocks.actions.actions[0].status).toBe("open");
  });

  it("does not steal focus when the user moves away during a successful status write", async () => {
    let resolve!: (value: boolean) => void;
    mocks.actions.update.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    await render(); await click("공유 할 일"); await click("완료로 표시");
    const elsewhere = button("결정 기록"); elsewhere.focus();
    await act(async () => { mocks.actions.actions = [{ ...task, status: "done" }]; resolve(true); });
    expect(document.activeElement).toBe(elsewhere); expect(announcement()).toContain("완료");
  });

  it("does not steal focus when the user moves away during an edit save", async () => {
    let resolve!: (value: boolean) => void;
    mocks.actions.update.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    await render(); await click("공유 할 일"); await click(`${task.title} 수정`); await fillTitle("변경 제목"); await click("수정 저장");
    const elsewhere = button("결정 기록"); elsewhere.focus();
    await act(async () => { mocks.actions.actions = [{ ...task, title: "변경 제목" }]; resolve(true); });
    expect(document.activeElement).toBe(elsewhere); expect(panel().querySelector("article input")).toBeNull();
  });

  const editFilteredCategory = async () => {
    await render(); await click("공유 할 일");
    const filter = Array.from(panel().querySelectorAll<HTMLButtonElement>('[aria-label="분야 필터"] button')).find(node => node.textContent?.startsWith("헤어·메이크업"))!;
    await act(async () => { filter.focus(); filter.click(); }); await click(`${task.title} 수정`);
    const select = panel().querySelector<HTMLSelectElement>("article select")!;
    await act(async () => { select.focus(); select.value = "venue"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  };

  it("returns focus to the current status when the category filter removes a saved card", async () => {
    await editFilteredCategory(); await click("수정 저장");
    expect(mocks.actions.update).toHaveBeenCalledWith(task.id, { category_key: "venue" }); expect(panel().querySelector("article")).toBeNull();
    expect(document.activeElement).toBe(panel().querySelector('[aria-label="할 일 상태"] button[aria-pressed="true"]'));
  });

  it("preserves the user's new focus when the category filter removes a saved card", async () => {
    let resolve!: (value: boolean) => void;
    mocks.actions.update.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    await editFilteredCategory(); await click("수정 저장");
    const elsewhere = button("결정 기록"); elsewhere.focus();
    await act(async () => { mocks.actions.actions = [{ ...task, categoryKey: "venue" }]; root.render(<AmoraDecisionBoard />); resolve(true); });
    expect(panel().querySelector("article")).toBeNull(); expect(document.activeElement).toBe(elsewhere);
  });
});
