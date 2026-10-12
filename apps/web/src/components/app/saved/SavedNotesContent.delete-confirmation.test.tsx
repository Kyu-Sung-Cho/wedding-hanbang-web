import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: {
  user: { id: "user-a" }, profile: { id: "user-a", couple_id: "couple-a" },
  isDemo: false, isInitialized: true,
} }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: Object.assign(
  (selector: (state: typeof mocks.auth) => unknown) => selector(mocks.auth),
  { getState: () => mocks.auth },
) }));
import SavedNotesContent from "./SavedNotesContent";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const note = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", messageId: null,
  content: "삭제 대상을 확인할 합성 답변", memo: "지워질 저장 메모", savedByMe: true, createdAt: "2026-10-12T00:00:00Z" };
const second = { ...note, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", content: "다른 저장 답변" };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("저장 답변의 명시적 삭제 확인", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ deleted: true, id: note.id })));
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note, second] }));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const render = () => act(async () => root.render(<SavedNotesContent />));
  const deletes = () => vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "DELETE");
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
  function confirm() {
    const found = dialog()?.querySelector<HTMLButtonElement>('[data-amora-confirm]');
    expect(found).toBeDefined(); return found!;
  }
  const open = () => act(async () => container.querySelector<HTMLButtonElement>('[aria-label="저장 지우기"]')!.click());

  it("지우기만 눌러서는 삭제하지 않고 영구 삭제 범위와 원문 보존을 알려준다", async () => {
    await render(); await open();
    expect(deletes()).toHaveLength(0);
    expect(dialog()?.textContent).toContain("영구 삭제");
    expect(dialog()?.textContent).toContain("되돌릴 수 없어요");
    expect(dialog()?.textContent).toContain("원래 대화는 이 작업으로 삭제하지 않아요");
    expect(dialog()?.textContent).toContain(note.content);
    expect(dialog()?.textContent).toContain(note.memo);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it.each(["나중에 정하기", "확인 창 닫기", "Escape"])("%s로 취소하면 삭제하지 않고 작성 중인 메모도 보존한다", async action => {
    await render();
    const memo = Array.from(container.querySelectorAll("button")).find(button => button.textContent === note.memo)!;
    await act(async () => memo.click());
    const field = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "저장 전 합성 초안");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await open();
    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain("작성 중인 메모도 함께 닫혀요");
    await act(async () => {
      if (action === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else Array.from(dialog()!.querySelectorAll<HTMLButtonElement>("button"))
        .find(button => button.textContent === action || button.getAttribute("aria-label") === action)!.click();
    });
    expect(dialog()).toBeNull();
    expect(deletes()).toHaveLength(0);
    expect(container.querySelector("textarea")).toBe(field);
    expect(field.value).toBe("저장 전 합성 초안");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("명시적으로 확인한 뒤 정확한 DELETE 영수증으로 선택한 저장본만 없앤다", async () => {
    await render(); await open();
    expect(deletes()).toHaveLength(0);
    await act(async () => confirm().click());
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]).toEqual(["/api/amora/notes", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ id: note.id, expectedMemo: note.memo }) })]);
    expect(dialog()).toBeNull();
    expect(container.textContent).not.toContain(note.content);
    expect(container.textContent).toContain(second.content);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "/api/amora/notes")).toBe(true);
  });

  it("확인 연타와 대기 중 닫기를 막으며 미확인 영수증은 삭제로 표시하지 않는다", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    // 첫 GET은 beforeEach에서 예약했고 이 응답은 그 다음 DELETE에 사용한다.
    await render(); await open();
    await act(async () => { confirm().click(); confirm().click(); });
    expect(deletes()).toHaveLength(1);
    expect(confirm().disabled).toBe(true);
    expect(dialog()?.querySelector<HTMLButtonElement>('[aria-label="확인 창 닫기"]')?.disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dialog()).not.toBeNull();
    await act(async () => finish(response({ deleted: true, id: second.id })));
    expect(dialog()?.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain(note.content);
    expect(confirm().disabled).toBe(false);
    expect(deletes()).toHaveLength(1);
  });

  it("커플 변경 전에 띄운 확인은 새 커플에서 요청을 보내지 않는다", async () => {
    await render(); await open(); const oldConfirm = confirm();
    mocks.auth.profile = { id: "user-a", couple_id: "couple-b" };
    await act(async () => oldConfirm.click());
    expect(deletes()).toHaveLength(0);
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [] })); await render();
    expect(dialog()).toBeNull();
    expect(container.textContent).not.toContain(note.content);
  });

  it("삭제 충돌 뒤 최신 저장본을 읽어도 새 승인 전에는 삭제하지 않는다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: "SAVED_NOTE_CHANGED", error: "저장된 메모가 바뀌었어요." }), { status: 409 }))
      .mockResolvedValueOnce(response({ notes: [{ ...note, memo: "다른 탭에서 바꾼 메모" }, second] }));
    await render(); await open(); await act(async () => confirm().click());
    expect(deletes()).toHaveLength(1);
    expect(confirm().disabled).toBe(true);
    expect(dialog()?.textContent).toContain(note.memo);
    const reload = Array.from(dialog()!.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "삭제할 저장본 다시 확인");
    expect(reload).toBeDefined(); await act(async () => reload!.click());
    expect(dialog()?.textContent).toContain("다른 탭에서 바꾼 메모");
    expect(deletes()).toHaveLength(1);
    expect(confirm().disabled).toBe(false);
    await act(async () => confirm().click());
    expect(deletes()).toHaveLength(2);
    expect(JSON.parse(String(deletes()[1][1]?.body))).toEqual({ id: note.id, expectedMemo: "다른 탭에서 바꾼 메모" });
  });
});
