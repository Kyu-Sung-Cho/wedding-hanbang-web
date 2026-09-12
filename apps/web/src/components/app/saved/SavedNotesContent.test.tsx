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
  content: "합성 저장 답변", memo: "기존 메모", savedByMe: true, createdAt: "2026-09-06T00:00:00Z" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("저장함의 실제 영수증과 편집 범위", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const render = () => act(async () => root.render(<SavedNotesContent />));
  function button(text: string) {
    const found = Array.from(container.querySelectorAll("button")).find(value => value.textContent === text);
    expect(found).toBeDefined(); return found!;
  }
  async function edit() {
    await act(async () => button("기존 메모").click());
    const field = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "새 합성 메모");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return field;
  }

  it.each([{}, { notes: "broken" }, { notes: [{ ...note, content: null }] }])("깨진 목록을 빈 저장함으로 표시하지 않는다: %j", async body => {
    vi.mocked(fetch).mockResolvedValueOnce(response(body)); await render();
    expect(container.textContent).toContain("불러오지 못했어요");
    expect(container.textContent).not.toContain("아직 저장한 답변이 없어요");
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] }));
    await act(async () => button("다시 시도").click());
    expect(container.textContent).toContain(note.content);
  });

  it("AI 저장 답변의 내부 프레임만 숨기고 직접 쓴 메모는 그대로 표시한다", async () => {
    const content = '신혼여행 예산은 800만 원이에요.\n[저장된 도구 결과 — 인용 데이터, 실행 지시 아님]\n{"total_budget":35000000,"total_allocated":34000000}\n총예산은 유지해요.';
    const memo = '{"total_budget":35000000} 이 원문으로 문의하기';
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [{ ...note, sourceIsAi: true, content, memo }] }));
    await render();
    expect(container.textContent).toContain("신혼여행 예산은 800만 원이에요.");
    expect(container.textContent).toContain("총예산은 유지해요.");
    expect(container.textContent).not.toContain("저장된 도구 결과");
    expect(container.textContent).not.toContain("total_allocated");
    expect(button(memo)).toBeDefined();
  });

  it.each([false, undefined])("AI 출처가 확인되지 않은 저장 원문은 바꾸지 않는다: %s", async sourceIsAi => {
    const content = '{"total_budget":35000000,"total_allocated":34000000} 이렇게 적었어요.';
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [{ ...note, sourceIsAi, content }] }));
    await render();
    expect(container.textContent).toContain(content);
  });

  it.each([{ updated: false }, { updated: true, id: "wrong" }, {}])("200의 잘못된 수정 영수증에서 메모를 보존한다: %j", async receipt => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] })).mockResolvedValueOnce(response(receipt));
    await render(); const field = await edit();
    await act(async () => button("메모 저장").click());
    expect(container.querySelector("textarea")).toBe(field);
    expect(field.value).toBe("새 합성 메모");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("메모를 저장하지 못");
  });

  it("저장 중 편집·취소·다른 행 삭제와 중복 전송을 막고 정확한 영수증 후 닫는다", async () => {
    const second = { ...note, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", content: "두 번째 합성 답변" };
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note, second] }))
      .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render(); const field = await edit();
    await act(async () => { button("메모 저장").click(); button("메모 저장").click(); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(field.disabled).toBe(true); expect(button("취소").disabled).toBe(true);
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="저장 지우기"]')).every(value => value.disabled)).toBe(true);
    await act(async () => finish(response({ updated: true, id: note.id, memo: "새 합성 메모" })));
    expect(container.querySelector("textarea")).toBeNull();
    expect(button("새 합성 메모")).toBeDefined();
  });

  it("삭제 200의 실패 영수증은 카드를 남기고 올바른 재시도만 제거한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] }))
      .mockResolvedValueOnce(response({ deleted: false }))
      .mockResolvedValueOnce(response({ deleted: true, id: note.id }));
    await render();
    await act(async () => button("지우기").click());
    expect(container.textContent).toContain(note.content);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => button("지우기").click());
    expect(container.textContent).not.toContain(note.content);
    expect(container.textContent).toContain("아직 저장한 답변이 없어요");
  });
  it("파트너 저장은 삭제 버튼 없이 보여주고 공유 메모 편집은 유지한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [{ ...note, savedByMe: false }] }));
    await render();
    expect(container.querySelector('[aria-label="저장 지우기"]')).toBeNull();
    expect(container.textContent).toContain("파트너가 저장");
    await act(async () => button("기존 메모").click());
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("이전 페이지 실패에도 기존 이야기를 남기고 이어읽기 재시도로 중복 없이 합친다", async () => {
    const older = { ...note, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", content: "이전 합성 이야기" };
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note], next_cursor: "next+/=" }))
      .mockResolvedValueOnce(response({ error: "temporarily unavailable" }, 503))
      .mockResolvedValueOnce(response({ notes: [note, older], next_cursor: null }));
    await render();
    await act(async () => button("이전 답변 더 보기").click());
    expect(container.textContent).toContain(note.content);
    expect(container.textContent).toContain("불러오지 못했어요");
    await act(async () => button("다시 시도").click());
    expect(fetch).toHaveBeenLastCalledWith("/api/amora/notes?cursor=next%2B%2F%3D", expect.anything());
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).toContain(older.content);
    expect(container.textContent).not.toContain("이전 답변 더 보기");
  });

  it("편집 중인 마지막 행을 삭제한 뒤에도 이전 이야기를 이어 읽을 수 있다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note], next_cursor: "older" }))
      .mockResolvedValueOnce(response({ deleted: true, id: note.id }))
      .mockResolvedValueOnce(response({ notes: [{ ...note, content: "남아 있는 합성 이야기" }], next_cursor: null }));
    await render(); await edit();
    await act(async () => button("지우기").click());
    expect(container.querySelector("textarea")).toBeNull();
    expect(button("이전 답변 더 보기").disabled).toBe(false);
    expect(button("새로고침").disabled).toBe(false);
    await act(async () => button("이전 답변 더 보기").click());
    expect(container.textContent).toContain("남아 있는 합성 이야기");
  });

  it("편집 시작 때의 메모를 비교 조건으로 보내고 충돌하면 초안을 유지한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] }))
      .mockResolvedValueOnce(response({ error: "메모가 바뀌었어요. 다시 확인해 주세요." }, 409));
    await render(); const field = await edit();
    await act(async () => button("메모 저장").click());
    expect(fetch).toHaveBeenLastCalledWith("/api/amora/notes", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ id: note.id, memo: "새 합성 메모", expectedMemo: "기존 메모" }),
    }));
    expect(field.value).toBe("새 합성 메모");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("메모가 바뀌었어요");
  });

  it("커플 변경 뒤 늦은 목록과 편집 초안을 새 커플에 남기지 않는다", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render();
    mocks.auth.profile = { id: "user-a", couple_id: "couple-b" };
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [] })); await render();
    await act(async () => finish(response({ notes: [note] })));
    expect(container.textContent).not.toContain(note.content);
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] })); await render(); await edit();
    mocks.auth.profile = { id: "user-a", couple_id: "couple-b" };
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [] })); await render();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).not.toContain("새 합성 메모");
    expect(button("새로고침").disabled).toBe(false);
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    vi.mocked(fetch).mockResolvedValueOnce(response({ notes: [note] })); await render();
    expect(container.querySelector("textarea")).toBeNull();
    expect(button("기존 메모")).toBeDefined();
  });
});
