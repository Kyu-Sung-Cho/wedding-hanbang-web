import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: {
  user: { id: "user-a" }, profile: { id: "user-a", couple_id: "couple-a" }, isDemo: false, isInitialized: true,
} }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: Object.assign(
  (selector: (state: typeof mocks.auth) => unknown) => selector(mocks.auth), { getState: () => mocks.auth },
) }));
import SavedNotesContent from "./SavedNotesContent";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const note = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", messageId: null,
  content: "첫 번째 공유 답변", memo: "기존 메모", savedByMe: true, createdAt: "2026-09-06T00:00:00Z" };
const second = { ...note, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", content: "두 번째 공유 답변", memo: "두 번째 메모" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const conflict = () => response({ error: "다른 변경과 겹쳤어요. 현재 메모를 다시 불러온 뒤 확인해 주세요." }, 409);

describe("공유 메모 초안 보존과 충돌 복구", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    vi.stubGlobal("fetch", vi.fn()); container = document.createElement("div");
    document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const render = () => act(async () => root.render(<SavedNotesContent embedded />));
  function button(label: string) {
    const found = [...container.querySelectorAll("button")].find(value => value.textContent === label);
    expect(found, label).toBeDefined(); return found!;
  }
  const click = (label: string) => act(async () => button(label).click());
  async function edit(label = "기존 메모") {
    await click(label); const field = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "내가 작성 중인 메모");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return field;
  }

  it("다른 행의 메모를 눌러도 현재 초안을 버리지 않고 저장·취소 뒤에만 새 편집을 허용한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note, second] }));
    await render(); const field = await edit();
    expect(button("두 번째 메모").disabled).toBe(true);
    await click("두 번째 메모");
    expect(container.querySelector("textarea")).toBe(field);
    expect(field.value).toBe("내가 작성 중인 메모");
    expect(container.textContent).toContain("먼저 이 메모를 저장하거나 취소");
    expect(fetch).toHaveBeenCalledTimes(1);
    await click("취소"); expect(button("두 번째 메모").disabled).toBe(false);
    await click("두 번째 메모"); expect(container.querySelector("textarea")?.value).toBe(second.memo);
  });

  it("409 뒤 최신 메모를 읽어 보여주고 별도 명시 저장만 최신 CAS 값으로 제출한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] })).mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(response({ notes: [{ ...note, memo: "상대가 먼저 수정한 메모" }] }))
      .mockResolvedValueOnce(response({ updated: true, id: note.id, memo: "내가 작성 중인 메모" }));
    await render(); const field = await edit(); await click("메모 저장");
    expect(button("메모 저장").disabled).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
    await click("현재 메모 확인");
    expect(container.textContent).toContain("상대가 먼저 수정한 메모");
    expect(field.value).toBe("내가 작성 중인 메모"); expect(fetch).toHaveBeenCalledTimes(3);
    await click("확인한 메모 대신 내 초안 저장");
    expect(fetch).toHaveBeenLastCalledWith("/api/amora/notes", expect.objectContaining({ method: "PATCH",
      body: JSON.stringify({ id: note.id, memo: "내가 작성 중인 메모", expectedMemo: "상대가 먼저 수정한 메모" }) }));
    expect(container.querySelector("textarea")).toBeNull(); expect(button("내가 작성 중인 메모")).toBeDefined();
  });

  it.each([null, "  공백을 포함한 실제 원문  "])("확인한 원문 %j를 정규화하지 않고 비교값으로 보낸다", async latest => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] })).mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(response({ notes: [{ ...note, memo: latest }] }))
      .mockResolvedValueOnce(response({ updated: true, id: note.id }));
    await render(); await edit(); await click("메모 저장"); await click("현재 메모 확인");
    if (latest === null) expect(container.textContent).toContain("현재 저장된 메모가 없어요");
    await click("확인한 메모 대신 내 초안 저장");
    expect(fetch).toHaveBeenLastCalledWith("/api/amora/notes", expect.objectContaining({
      body: JSON.stringify({ id: note.id, memo: "내가 작성 중인 메모", expectedMemo: latest }) }));
  });

  it.each(["missing", "malformed", "duplicate", "error"] as const)("최신 조회가 %s이면 초안을 남기고 자동 저장·삭제 단정을 하지 않는다", async kind => {
    const latest = kind === "missing" ? { notes: [second] } : kind === "malformed" ? { notes: [{ ...note, memo: 3 }] }
      : kind === "duplicate" ? { notes: [note, { ...note, memo: "어느 원문인지 모름" }] } : { error: "unavailable" };
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] })).mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(response(latest, kind === "error" ? 503 : 200));
    await render(); const field = await edit(); await click("메모 저장"); await click("현재 메모 확인");
    expect(field.value).toBe("내가 작성 중인 메모"); expect(button("메모 저장").disabled).toBe(true);
    expect(container.textContent).toContain("현재 메모를 확인하지 못했어요");
    expect(container.textContent).not.toContain("삭제됐어요"); expect(fetch).toHaveBeenCalledTimes(3);
    expect([...container.querySelectorAll("button")].some(value => value.textContent === "확인한 메모 대신 내 초안 저장")).toBe(false);
  });

  it("재조회 실패 뒤 다시 확인해도 초안을 유지하고 취소할 때 확인한 최신 원문으로 돌아간다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] })).mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(response({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(response({ notes: [{ ...note, memo: "재확인한 실제 메모" }] }));
    await render(); const field = await edit(); await click("메모 저장"); await click("현재 메모 확인");
    await click("현재 메모 확인"); expect(field.value).toBe("내가 작성 중인 메모");
    expect(fetch).toHaveBeenCalledTimes(4); await click("취소");
    expect(button("재확인한 실제 메모")).toBeDefined();
    expect(container.querySelector("textarea")).toBeNull(); expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("더보기로 읽은 메모는 해당 페이지를 한 번만 확인하며 다른 페이지를 자동 탐색하지 않는다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note], next_cursor: "older+/=" }))
      .mockResolvedValueOnce(response({ notes: [second], next_cursor: "further" })).mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(response({ notes: [{ ...second, memo: "이전 페이지의 최신 메모" }], next_cursor: "further" }));
    await render(); await click("이전 답변 더 보기"); await edit(second.memo); await click("메모 저장"); await click("현재 메모 확인");
    expect(fetch).toHaveBeenLastCalledWith("/api/amora/notes?cursor=older%2B%2F%3D", expect.objectContaining({ cache: "no-store" }));
    expect(fetch).toHaveBeenCalledTimes(4); expect(container.textContent).toContain("이전 페이지의 최신 메모");
  });

  it("재확인 대기 중 중복 클릭을 막고 커플이 바뀐 뒤 늦은 원문을 노출하지 않는다", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] })).mockResolvedValueOnce(conflict())
      .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render(); await edit(); await click("메모 저장");
    await act(async () => { button("현재 메모 확인").click(); button("현재 메모 확인").click(); });
    expect(fetch).toHaveBeenCalledTimes(3);
    mocks.auth.profile = { id: "user-a", couple_id: "couple-b" };
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [] })); await render();
    await act(async () => finish(response({ notes: [{ ...note, memo: "이전 커플의 늦은 메모" }] })));
    expect(container.textContent).not.toContain("이전 커플의 늦은 메모");
    expect(container.querySelector("textarea")).toBeNull(); expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("확인 뒤 또 바뀌면 이전 확인을 폐기하고 다시 현재 메모를 읽기 전 저장을 막는다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] })).mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(response({ notes: [{ ...note, memo: "한 번 수정" }] })).mockResolvedValueOnce(conflict());
    await render(); const field = await edit(); await click("메모 저장"); await click("현재 메모 확인");
    await click("확인한 메모 대신 내 초안 저장");
    expect(field.value).toBe("내가 작성 중인 메모"); expect(button("메모 저장").disabled).toBe(true);
    expect(button("현재 메모 확인")).toBeDefined(); expect(fetch).toHaveBeenCalledTimes(4);
  });
});
