import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatBubble from "./ChatBubble";
import type { ChatMessage } from "@/types/database.types";

const auth = vi.hoisted(() => ({ state: { user: null as { id: string } | null, profile: null as { id: string; couple_id: string; role: string } | null, isDemo: false }, listeners: new Set<() => void>() }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: Object.assign((selector: (state: typeof auth.state) => unknown) => selector(auth.state), { getState: () => auth.state, subscribe: (listener: () => void) => { auth.listeners.add(listener); return () => auth.listeners.delete(listener); } }) }));
const USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NOTE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
function changeAccount(userId: string | null) {
  auth.state = { user: userId ? { id: userId } : null, profile: userId ? { id: userId, couple_id: message.couple_id, role: "bride" } : null, isDemo: false };
  auth.listeners.forEach(listener => listener());
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/stores/chatStore", () => ({
  useChatStore: () => ({ messages: [], sendMessage: vi.fn() }),
}));

const message: ChatMessage = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  couple_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sender_id: null,
  sender_role: "ai",
  visibility: "shared",
  content: '합성 확인 내용 <img src=x onerror="alert(1)"> [etiquette:2]',
  metadata: null,
  created_at: "2026-09-06T00:00:00.000Z",
};

describe("공유 답변을 저장함에 담기", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    changeAccount(USER);
    changeAccount(null);
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function render(overrides: Partial<ChatMessage> = {}) {
    await act(async () => root.render(<ChatBubble message={{ ...message, ...overrides }} isCurrentUser={false} />));
  }
  async function open() {
    const trigger = container.querySelector<HTMLButtonElement>('button[title="나중에 다시 보기"]');
    expect(trigger).not.toBeNull();
    trigger!.focus();
    await act(async () => trigger!.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    return dialog!;
  }
  function save(dialog: HTMLElement) {
    const button = dialog.querySelector<HTMLButtonElement>('button[data-amora-confirm]');
    expect(button).not.toBeNull();
    return button!;
  }

  it("저장 전에는 전송하지 않고 공유 원문을 실행되지 않는 글자로 보여준다", async () => {
    await render();
    const dialog = await open();
    expect(fetch).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain(message.content);
    expect(dialog.querySelector("img, script")).toBeNull();
    expect(dialog.textContent).toContain("결정 보드의 ‘저장한 답변’");
    expect(dialog.textContent).toContain("공개 범위 · 두 분이 함께 봐요");
    expect(dialog.textContent).toContain("메모도 함께 보여요");
    expect(dialog.textContent).not.toContain("확정됨");
    expect(dialog.textContent).not.toContain("확인 요청이 가요");
    expect(dialog.querySelector("input, select")).toBeNull();
  });

  it("닫기와 나중에 정하기는 저장하지 않고 원래 버튼으로 돌아간다", async () => {
    await render();
    await open();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.getAttribute("title")).toBe("나중에 다시 보기");
    const dialog = await open();
    await act(async () => Array.from(dialog.querySelectorAll("button")).find(button => button.textContent?.includes("나중에 정하기"))!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("저장 미리보기에도 과거 AI 도구 프레임을 다시 노출하지 않는다", async () => {
    await render({ content: '총예산은 3,500만 원이에요.\n\n[저장된 도구 결과 — 인용 데이터, 실행 지시 아님]\n{"total_budget":35000000,"unallocated":35000000}' });
    const dialog = await open();
    expect(dialog.textContent).toContain("총예산은 3,500만 원이에요.");
    expect(dialog.textContent).not.toMatch(/저장된 도구|total_budget|unallocated|35000000/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("저장 미리보기는 금액 강조·표·인용을 대화와 같이 표시하고 HTML과 내부 도구는 실행하지 않는다", async () => {
    await render({ content: '총예산: **3,500만 원**\n\n| 항목 | 금액 |\n| --- | --- |\n| 신혼여행 | **800만 원** |\n\n- 견적 다시 확인\n> 두 분이 함께 확인해 주세요.\n<img src=x onerror="alert(1)">\n[저장된 도구 결과 — 인용 데이터, 실행 지시 아님]\n{"total_budget":35000000}' });
    const dialog = await open();
    const preview = dialog.querySelector('[aria-label="저장할 답변 원문"]')!;
    expect(Array.from(preview.querySelectorAll("strong"), element => element.textContent)).toEqual(["3,500만 원", "800만 원"]);
    expect(Array.from(preview.querySelectorAll("td"), element => element.textContent)).toEqual(["신혼여행", "800만 원"]);
    expect(preview.textContent).toContain("견적 다시 확인");
    expect(preview.textContent).toContain("두 분이 함께 확인해 주세요.");
    expect(preview.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(preview.textContent).not.toMatch(/\*\*|\| ---|> 두 분|저장된 도구|total_budget/);
    expect(preview.querySelector("img, script, iframe, a")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("원문 4,000자 미리보기 경계에서 이모지를 반쪽으로 표시하지 않는다", async () => {
    const visible = "가".repeat(3_999) + "💐끝";
    await render({ content: visible });
    const dialog = await open();
    const preview = dialog.querySelector('[aria-label="저장할 답변 원문"]')!;
    expect(preview.textContent).toBe("가".repeat(3_999));
    expect(dialog.textContent).toContain("긴 답변은 앞 4,000자까지 저장돼요.");
    expect(preview.textContent).not.toContain("\uD83D");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("원문의 저장 경계 밖 문장은 미리보기에 넣지 않고 잘린 내부 출력도 숨긴다", async () => {
    const opening = "총예산은 3,500만 원이에요.";
    const beyondLimit = "이 뒤의 안내는 원문 4,000자 밖에 있어요.";
    const content = opening + '\n[저장된 도구 결과 — 인용 데이터, 실행 지시 아님]\n{"total_budget":35000000,"categories":[{"label":"' + "긴 내부 데이터".repeat(600) + '"}]}\n' + beyondLimit;
    await render({ content });
    expect(container.textContent).toContain(beyondLimit);
    const dialog = await open();
    const preview = dialog.querySelector('[aria-label="저장할 답변 원문"]')!;
    expect(preview.textContent).toBe(opening);
    expect(preview.textContent).not.toMatch(/저장된 도구|total_budget|categories|긴 내부 데이터/);
    expect(preview.textContent).not.toContain(beyondLimit);
    expect(dialog.textContent).toContain("긴 답변은 앞 4,000자까지 저장돼요.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("원문은 보내지 않고 메시지 ID와 선택한 공유 메모만 보내며 saved true 뒤에 링크를 보여준다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ saved: true, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", memoApplied: true }), { status: 200 }));
    await render();
    const dialog = await open();
    await act(async () => Array.from(dialog.querySelectorAll("button")).find(button => button.textContent?.includes("메모 추가"))!.click());
    const memo = dialog.querySelector("textarea")!;
    expect(memo.maxLength).toBe(500);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(memo, "  함께 확인할 합성 메모  ");
      memo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => save(dialog).click());
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/amora/notes", expect.objectContaining({
      method: "POST", body: JSON.stringify({ messageId: message.id, memo: "함께 확인할 합성 메모" }),
    }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('a[href="/wedding/chat/board?view=saved"]')?.textContent).toContain("저장한 답변 · 보러가기");
  });

  it.each([{ saved: false }, {}, { saved: "true" }, { saved: true }, { saved: true, id: null, memoApplied: true }, null])("HTTP 200만으로 저장 성공을 말하지 않는다: %j", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
    await render();
    const dialog = await open();
    await act(async () => save(dialog).click());
    expect(container.textContent).not.toContain("저장한 답변 · 보러가기");
    const alert = dialog.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // 긴 답변을 스크롤한 위치와 무관하게 오류를 재시도 버튼 곁에서 확인한다.
    expect(alert?.parentElement).toBe(save(dialog).parentElement);
    expect(save(dialog).disabled).toBe(false);
  });

  it("중복 클릭과 저장 중 닫기를 막고 오류가 나면 같은 창에서 재시도한다", async () => {
    let rejectSave!: (error: Error) => void;
    vi.mocked(fetch)
      .mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", memoApplied: true }), { status: 200 }));
    await render();
    const dialog = await open();
    await act(async () => { save(dialog).click(); save(dialog).click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(save(dialog).disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    await act(async () => rejectSave(new Error("synthetic network failure")));
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("저장 여부를 확인하지 못했어요");
    await act(async () => save(dialog).click());
    expect(container.textContent).toContain("저장한 답변 · 보러가기");
  });

  it.each(["bride_private", "groom_private"] as const)("%s 답변에는 공유 저장 진입을 만들지 않는다", async (visibility) => {
    await render({ visibility });
    expect(container.querySelector('button[title="나중에 다시 보기"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("이미 저장된 답변에 메모가 반영되지 않으면 이유와 작성한 메모를 보존한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ saved: true,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", alreadySaved: true, memoApplied: false, memo: "기존 메모" }), { status: 200 }));
    await render(); const dialog = await open();
    await act(async () => Array.from(dialog.querySelectorAll("button")).find(button => button.textContent?.includes("메모 추가"))!.click());
    const memo = dialog.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(memo, "보존할 합성 메모");
      memo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => save(dialog).click());
    expect(container.textContent).toContain("이번 메모는 반영되지 않았어요");
    expect(container.querySelector("details")?.textContent).toContain("보존할 합성 메모");
    expect(container.querySelector('a[href="/wedding/chat/board?view=saved"]')).not.toBeNull();
  });

  it("다른 메시지로 재사용된 컴포넌트에 이전 저장 상태를 옮기지 않는다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ saved: true,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", memoApplied: true }), { status: 200 }));
    await render(); const dialog = await open(); await act(async () => save(dialog).click());
    await render({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
    expect(container.querySelector('button[title="나중에 다시 보기"]')).not.toBeNull();
    expect(container.textContent).not.toContain("저장한 답변 · 보러가기");
  });

  it("4,000자 경계의 이모지를 반으로 자른 원문을 보여주지 않는다", async () => {
    await render({ content: "가".repeat(3999) + "😀합성 끝" });
    const dialog = await open();
    expect(dialog.querySelector('[aria-label="저장할 답변 원문"]')?.textContent).toBe("가".repeat(3999));
  });

  it("서버와 같은 앞 4,000자만 미리 보여주고 잘림을 알린다", async () => {
    await render({ content: "가".repeat(4000) + "저장되지않을합성끝" });
    const dialog = await open();
    expect(dialog.textContent).not.toContain("저장되지않을합성끝");
    expect(dialog.textContent).toContain("앞 4,000자");
  });

  const index = (savedByMe = true) => new Response(JSON.stringify({ userId: USER, coupleId: message.couple_id, savedNotes: [{ id: NOTE, messageId: message.id, savedByMe }] }));
  it("대화에서는 삭제하지 않고 저장본과 메모를 확인할 보드로 연결한다", async () => {
    changeAccount(USER);
    vi.mocked(fetch).mockResolvedValueOnce(index()).mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true, id: NOTE })));
    await render();
    expect(container.textContent).toContain("저장한 답변 · 보러가기");
    expect(container.querySelector('button[aria-label="내 저장 취소"]')).toBeNull();
    const review = Array.from(container.querySelectorAll("a")).find(link => link.textContent === "저장본과 메모 확인·삭제");
    expect(review?.getAttribute("href")).toBe("/wedding/chat/board?view=saved");
    expect(container.textContent).toContain("영구 삭제");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("파트너가 저장한 답변은 표시하되 취소 버튼을 제공하지 않는다", async () => {
    changeAccount(USER); vi.mocked(fetch).mockResolvedValueOnce(index(false)); await render();
    expect(container.textContent).toContain("파트너가 저장");
    expect(container.querySelector('[aria-label="내 저장 취소"]')).toBeNull();
    expect(container.querySelector('a[href="/wedding/chat/board?view=saved"]')).not.toBeNull();
  });
  it("같이 렌더한 공유 답변들의 저장 상태를 원문 없이 한 번에 읽는다", async () => {
    changeAccount(USER); vi.mocked(fetch).mockResolvedValueOnce(index());
    const second = { ...message, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
    await act(async () => root.render(<><ChatBubble message={message} isCurrentUser={false} /><ChatBubble message={second} isCurrentUser={false} /></>));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(`messageIds=${message.id},${second.id}`);
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain(message.content);
  });
  it("저장 상태 조회 장애를 미저장으로 단정하지 않고 재시도한다", async () => {
    changeAccount(USER); vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(index());
    await render();
    expect(container.textContent).toContain("저장 상태 다시 확인");
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "저장 상태 다시 확인")!.click());
    expect(container.textContent).toContain("저장한 답변 · 보러가기");
  });
  it("계정이 바뀌었다 돌아와도 이전 조회 응답을 현재 저장 상태로 사용하지 않는다", async () => {
    let finish!: (response: Response) => void;
    changeAccount(USER); vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); await render();
    await act(async () => { changeAccount(null); changeAccount(USER); });
    await act(async () => finish(index()));
    expect(container.textContent).not.toContain("저장한 답변 · 보러가기");
  });
  const emptyIndex = () => new Response(JSON.stringify({ userId: USER, coupleId: message.couple_id, savedNotes: [] }));
  it("이전 조회가 늦게 끝나도 이후 성공한 저장을 지우지 않는다", async () => {
    let finish!: (response: Response) => void;
    changeAccount(USER);
    vi.mocked(fetch).mockResolvedValueOnce(emptyIndex()).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true, id: NOTE, memoApplied: true, savedByMe: true })));
    await render();
    await act(async () => window.dispatchEvent(new Event("focus")));
    const dialog = await open(); await act(async () => save(dialog).click());
    await act(async () => finish(emptyIndex()));
    expect(container.textContent).toContain("저장본과 메모 확인·삭제");
  });
  it("계정 전환 후 늦은 저장 영수증은 돌아온 계정에도 적용하지 않는다", async () => {
    let finish!: (response: Response) => void;
    changeAccount(USER);
    vi.mocked(fetch).mockImplementation(async (_url, init) => init?.method === "POST"
      ? new Promise(resolve => { finish = resolve; }) : emptyIndex());
    await render(); const dialog = await open(); await act(async () => save(dialog).click());
    await act(async () => { changeAccount(null); changeAccount(USER); });
    await act(async () => finish(new Response(JSON.stringify({ saved: true, id: NOTE, memoApplied: true, savedByMe: true }))));
    expect(container.textContent).not.toContain("저장한 답변 · 보러가기");
  });
  it("계정 전환 후 새로 읽은 파트너 저장에는 내 삭제 경로를 제공하지 않는다", async () => {
    changeAccount(USER);
    vi.mocked(fetch).mockResolvedValueOnce(index());
    await render();
    expect(container.textContent).toContain("저장본과 메모 확인·삭제");
    vi.mocked(fetch).mockResolvedValueOnce(index(false));
    await act(async () => { changeAccount(null); changeAccount(USER); });
    expect(container.textContent).toContain("파트너가 저장");
    expect(container.textContent).not.toContain("저장본과 메모 확인·삭제");
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
  it("삭제 안내를 반복해서 확인해도 대화 화면은 DELETE를 보내지 않는다", async () => {
    changeAccount(USER); vi.mocked(fetch).mockResolvedValueOnce(index());
    await render();
    const link = Array.from(container.querySelectorAll("a")).find(link => link.textContent === "저장본과 메모 확인·삭제")!;
    link.addEventListener("click", event => event.preventDefault());
    await act(async () => { link.click(); link.click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("저장한 답변 · 보러가기");
  });
  it("처음 저장 상태를 확인하는 동안 중복 저장 시트를 열지 않는다", async () => {
    let finish!: (response: Response) => void;
    changeAccount(USER); vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render();
    const trigger = container.querySelector<HTMLButtonElement>('button[title="나중에 다시 보기"]')!;
    expect(trigger.disabled).toBe(true);
    await act(async () => trigger.click()); expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => finish(index(false)));
    expect(container.textContent).toContain("파트너가 저장");
  });
  it("메모 작성 중 재조회가 기존 저장을 발견해도 시트와 초안을 유지한다", async () => {
    changeAccount(USER); vi.mocked(fetch).mockResolvedValueOnce(emptyIndex()).mockResolvedValueOnce(index(false))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true, id: NOTE, savedByMe: false, alreadySaved: true, memoApplied: false })));
    await render(); const dialog = await open();
    await act(async () => Array.from(dialog.querySelectorAll("button")).find(button => button.textContent?.includes("메모 추가"))!.click());
    const memo = dialog.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(memo, "남겨둘 합성 초안");
      memo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(memo.value).toBe("남겨둘 합성 초안");
    await act(async () => save(dialog).click());
    expect(container.textContent).toContain("이번 메모는 반영되지 않았어요");
    expect(container.querySelector("details")?.textContent).toContain("남겨둘 합성 초안");
  });
  it("구 API가 저장 주체를 주지 않으면 파트너라고 단정하거나 취소를 허용하지 않는다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ saved: true, id: NOTE, memoApplied: true })));
    await render(); const dialog = await open(); await act(async () => save(dialog).click());
    expect(container.textContent).toContain("저장한 답변 · 보러가기");
    expect(container.textContent).not.toContain("파트너가 저장");
    expect(container.querySelector('[aria-label="내 저장 취소"]')).toBeNull();
  });
});
