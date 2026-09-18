import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/types/database.types";
import { AMORA_RECAP_REQUEST } from "@hanbang/shared";
import ConversationRecapPanel from "./ConversationRecapPanel";
import ChatInfoPanel from "../ChatInfoPanel";

const userId = "11111111-1111-4111-8111-111111111111";
const coupleId = "22222222-2222-4222-8222-222222222222";
const stores = vi.hoisted(() => ({
  auth: { profile: { id: "11111111-1111-4111-8111-111111111111", couple_id: "22222222-2222-4222-8222-222222222222", role: "bride" },
    couple: { id: "22222222-2222-4222-8222-222222222222", bride_id: "11111111-1111-4111-8111-111111111111" }, isDemo: false },
  chat: { messages: [] as ChatMessage[], initialLoadDone: true, isLoading: false, sharedClearedAt: null as string | null, privateClearedAt: null as string | null },
}));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => stores.auth }));
vi.mock("@/stores/chatStore", () => ({ useChatStore: () => stores.chat }));
vi.mock("./BudgetTab", () => ({ default: () => <p>현재 예산 내용</p> }));
vi.mock("./ChecklistTab", () => ({ default: () => <p>체크리스트 내용</p> }));
vi.mock("./UpcomingTab", () => ({ default: () => <p>임박 일정 내용</p> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const nowMs = Date.parse("2026-09-07T00:00:00Z");
const onDraft = vi.fn();
const shared: ChatMessage = { id: "33333333-3333-4333-8333-333333333333", couple_id: coupleId, sender_id: userId, sender_role: "bride", visibility: "shared", content: "SHARED_QUESTION", created_at: "2026-09-06T23:00:00Z", metadata: null };
describe("대화 정리에서 범위를 지키며 입력창으로만 재개", () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(() => {
    onDraft.mockReset(); stores.auth.isDemo = false; stores.auth.profile.id = userId;
    stores.chat.initialLoadDone = true; stores.chat.sharedClearedAt = null;
    stores.chat.messages = [shared, { ...shared, id: "44444444-4444-4444-8444-444444444444", visibility: "bride_private", content: "PRIVATE_QUESTION" }];
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  async function render(visibility: "shared" | "bride_private" = "shared", canDraft = true) {
    await act(async () => root.render(<ConversationRecapPanel visibility={visibility} nowMs={nowMs} canDraft={canDraft} onDraft={onDraft} />));
  }
  const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.includes(text));
  it("공동/개인 전환마다 현재 범위만 보여 주고 자동 전송하지 않는다", async () => {
    await render(); expect(container.textContent).toContain("SHARED_QUESTION"); expect(container.textContent).not.toContain("PRIVATE_QUESTION");
    await render("bride_private"); expect(container.textContent).toContain("PRIVATE_QUESTION"); expect(container.textContent).not.toContain("SHARED_QUESTION");
    expect(onDraft).not.toHaveBeenCalled();
  });
  it("본인 확인으로 선택한 질문만 입력창에 넣으며 정리 요청은 별도다", async () => {
    await render("bride_private");
    await act(async () => button("이 내용으로 이어서 입력")?.click());
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(onDraft.mock.calls[0][0]).toContain("PRIVATE_QUESTION");
    expect(onDraft.mock.calls[0][0]).not.toContain("SHARED_QUESTION");
    await act(async () => button("대화 정리 요청")?.click());
    expect(onDraft).toHaveBeenLastCalledWith(AMORA_RECAP_REQUEST);
  });
  it("기존 초안이 있으면 덮어쓰지 않고 두 재개 동작을 닫는다", async () => {
    await render("shared", false);
    expect(button("이 내용으로 이어서 입력")?.disabled).toBe(true);
    await act(async () => { button("이 내용으로 이어서 입력")?.click(); button("대화 정리 요청")?.click(); });
    expect(onDraft).not.toHaveBeenCalled();
  });
  it("화면 정리와 계정 변경 직후 이전 내용이 남지 않는다", async () => {
    stores.chat.sharedClearedAt = shared.created_at; await render();
    expect(container.textContent).not.toContain("SHARED_QUESTION");
    stores.chat.sharedClearedAt = null; stores.auth.profile.id = "another-user"; await render();
    expect(container.textContent).not.toContain("SHARED_QUESTION");
  });
  it("로딩/체험 상태를 빈 실제 기록으로 오인하지 않게 한다", async () => {
    stores.chat.initialLoadDone = false; await render(); expect(container.textContent).toContain("불러오는 중");
    stores.auth.isDemo = true; await render(); expect(container.textContent).toContain("체험 대화는 저장되지 않아요");
    expect(button("이 내용으로 이어서 입력")).toBeUndefined();
  });
  it("정보 패널은 하나만 렌더링하고 현황 탭과 닫기/키보드가 작동한다", async () => {
    const close = vi.fn();
    await act(async () => root.render(<ChatInfoPanel isOpen onClose={close} recap={{ visibility: "shared", nowMs, canDraft: true, onDraft }} />));
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="현재 범위 대화 정리"]')).toHaveLength(1);
    await act(async () => button("예산")?.click()); expect(container.textContent).toContain("현재 예산 내용");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).toHaveBeenCalledTimes(1);
    const closeButton = container.querySelector<HTMLButtonElement>('[aria-label="준비 현황 닫기"]');
    await act(async () => closeButton?.click()); expect(close).toHaveBeenCalledTimes(2);
  });
});
