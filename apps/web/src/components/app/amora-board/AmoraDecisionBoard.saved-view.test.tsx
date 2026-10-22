import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { isInitialized: true, isDemo: false, user: { id: "user-a" }, profile: { id: "user-a", couple_id: "couple-a" } },
  decisions: { records: [], loading: false, loadingMore: false, error: null, nextCursor: null, available: true, isDemo: false, refresh: vi.fn(), loadMore: vi.fn() },
  actions: { actions: [{ id: "task-a", title: "서면 견적 확인", status: "open", source: "manual", viewVersion: "2026-10-12T00:00:00.123456Z" }], loading: false, loadingMore: false,
    error: null, count: 1, truncated: false, nextCursor: null, isDemo: false, updatingIds: new Set<string>(),
    creating: false, createLocked: false, canCreate: false, ownerScope: "owner-a", refresh: vi.fn(), update: vi.fn(), loadMore: vi.fn() },
}));
vi.mock("@/stores/authStore", () => ({ useAuthStore: Object.assign(
  (selector: (state: typeof mocks.auth) => unknown) => selector(mocks.auth), { getState: () => mocks.auth },
) }));
vi.mock("@/hooks/useAmoraPreparationActions", () => ({ useAmoraPreparationActions: () => mocks.actions }));
vi.mock("./useDecisionBoard", () => ({ useDecisionBoard: () => mocks.decisions }));
import AmoraDecisionBoard from "./AmoraDecisionBoard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const note = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", messageId: null, content: "같이 확인할 참고 답변", memo: "기존 공유 메모", savedByMe: false, createdAt: "2026-09-10T00:00:00Z" };

describe("보드 안의 저장한 답변 탐색", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    mocks.actions.update.mockReset(); mocks.actions.refresh.mockReset(); mocks.decisions.refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ notes: [note] }), { status: 200 })));
    window.history.replaceState(null, "", "/wedding/chat/board?utm_source=mission#anchor");
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); window.history.replaceState(null, "", "/"); vi.unstubAllGlobals(); });
  const render = () => act(async () => root.render(<AmoraDecisionBoard />));
  function control(label: string) {
    const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === label || button.getAttribute("aria-label") === label);
    expect(found, label).toBeDefined(); return found!;
  }
  const click = (label: string) => act(async () => { control(label).focus(); control(label).click(); });
  function savedPanel() {
    const id = control("저장한 답변").getAttribute("aria-controls");
    const found = id ? document.getElementById(id) : null;
    expect(found).not.toBeNull(); return found!;
  }
  async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("처음에는 저장함을 조회하지 않고 새 탭에서 공유 참고 답변을 보여준다", async () => {
    await render(); expect(fetch).not.toHaveBeenCalled();
    await click("저장한 답변");
    expect(savedPanel().hidden).toBe(false);
    expect(savedPanel().textContent).toContain(note.content);
    expect(savedPanel().textContent).toContain("두 분이 함께 보는 참고 답변");
    expect(savedPanel().textContent).toContain("확정된 결정은 아니에요");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/amora/notes", expect.objectContaining({ cache: "no-store" }));
    expect(savedPanel().querySelector('[aria-label="저장 지우기"]')).toBeNull();
    expect(container.querySelector('[aria-label="아모라 화면 이동"]')).toBeNull();
    expect(container.querySelector('a[href="/wedding/saved"]')).toBeNull();
    expect(container.querySelector('[aria-label="보드 검색 열기"]')).toBeNull();
    expect(mocks.actions.update).not.toHaveBeenCalled();
  });

  it("직접 saved URL과 뒤로·앞으로를 따르고 query/hash 및 메모 초안을 보존한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ notes: [{ ...note, savedByMe: true }] }), { status: 200 }));
    window.history.replaceState(null, "", "/wedding/chat/board?view=saved&utm_source=mission#anchor");
    await render(); await click(note.memo);
    const textarea = savedPanel().querySelector("textarea")!; await type(textarea, "아직 저장하지 않은 메모");
    await click("공유 할 일"); expect(savedPanel().hidden).toBe(true);
    expect(new URL(window.location.href).searchParams.get("utm_source")).toBe("mission");
    expect(window.location.hash).toBe("#anchor");
    await act(async () => { window.history.replaceState(null, "", "/wedding/chat/board?view=saved&utm_source=mission#anchor"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(savedPanel().hidden).toBe(false);
    expect(savedPanel().querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("아직 저장하지 않은 메모");
    await click("결정 기록"); await click("저장한 답변");
    expect(textarea.value).toBe("아직 저장하지 않은 메모");
    expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.actions.update).not.toHaveBeenCalled();
  });

  it("할 일 편집과 검색을 saved 왕복으로 지우지 않는다", async () => {
    await render(); await click("공유 할 일");
    const taskPanel = container.querySelector<HTMLElement>('section[aria-label="공유 할 일"]')!;
    const search = taskPanel.querySelector<HTMLInputElement>('input[type="search"]')!;
    await type(search, "서면"); await click("서면 견적 확인 수정");
    const title = taskPanel.querySelector<HTMLInputElement>("article input")!; await type(title, "정정 중인 제목");
    await click("저장한 답변"); await click("공유 할 일");
    expect(taskPanel.hidden).toBe(false); expect(search.value).toBe("서면"); expect(title.value).toBe("정정 중인 제목");
    expect(mocks.actions.update).not.toHaveBeenCalled();
  });

  it("보관 탭이 숨겨진 동안 커플이 바뀌어도 이전 메모를 새 커플에 남기지 않는다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ notes: [{ ...note, savedByMe: true }] }), { status: 200 }));
    await render(); await click("저장한 답변"); await click(note.memo);
    await type(savedPanel().querySelector("textarea")!, "이전 커플의 미저장 메모"); await click("공유 할 일");
    mocks.auth.profile = { id: "user-a", couple_id: "couple-b" };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ notes: [] }), { status: 200 }));
    await render(); await click("저장한 답변");
    expect(savedPanel().querySelector("textarea")).toBeNull();
    expect(savedPanel().textContent).not.toContain(note.content);
    expect(savedPanel().textContent).not.toContain("이전 커플의 미저장 메모");
    expect(mocks.actions.update).not.toHaveBeenCalled();
  });
});
