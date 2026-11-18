import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { amoraLaneStorageKey } from "@hanbang/shared/amora-lane-choice";
import { WEB_COPY } from "@hanbang/shared/invitation";

import ChatSidePanel from "./ChatSidePanel";

/**
 * 대화 칸의 청첩장 모양(`presentation="invitation"`, 2026-11-17 파운더 디자인 아티팩트, 원문 "이 디자인 완전 같아야해").
 *
 * 모양만 달라야 한다. 그래서 두 가지를 잰다.
 *   1. 모양: 덮개가 아니라 화면의 한 칸(대화 상자 의미·닫기·초점 가두기·스크롤 잠금 없음), 아티팩트의 입력 알약과
 *      먹색 보내기, 그리고 아티팩트에 자리가 없는 AI 답변 안내와 공개 범위 줄이 늘 보이는지.
 *   2. 동작: 같은 문장을 보내면 덮개 모양과 같은 요청이 스토어로 나가는지(레인·대상·내용·문맥).
 * 안전 레인 판정이 같은지는 `amoraSafetyLaneParity.test.tsx` 가 세 표면으로 잰다.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  sendMessage: vi.fn(),
  loadMessages: vi.fn(),
  requestInitialGreeting: vi.fn(),
  requestMediation: vi.fn(),
  clearMessages: vi.fn(),
  subscribeToMessages: vi.fn(() => vi.fn()),
  retryFailedMessage: vi.fn(),
  dismissFailedMessageRetry: vi.fn(),
  setChatState: vi.fn(),
  messages: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/stores/authStore", () => {
  const state = {
    user: { id: "user-1" },
    profile: { id: "user-1", role: "bride", name: "테스트", couple_id: "couple-1", confirmed_role: null },
    couple: { id: "couple-1", bride_id: "user-1", groom_id: "user-2" },
    journey: null,
    partner: null,
    isDemo: false,
    isInitialized: true,
    isLoading: false,
  };
  // 전체 화면으로 넓히기는 지금 계정을 `getState` 로 다시 확인한다(`getComposerExpandActor`).
  return { useAuthStore: Object.assign(() => state, { getState: () => state }) };
});

vi.mock("@/hooks/useAmoraPersonalization", () => ({
  useAmoraPersonalization: () => ({ profile: null, status: "ready", saving: false, error: null, save: vi.fn() }),
}));

vi.mock("@/stores/chatStore", () => {
  const state = {
    get messages() {
      return mocks.messages;
    },
    isStreaming: false,
    isSending: false,
    streamingContent: "",
    streamingToolResults: [],
    suggestions: [],
    error: null,
    failedRequest: null,
    artifactVisibility: "shared",
    isRetrying: false,
    quotaRemaining: null,
    initialLoadDone: true,
    loadMessages: mocks.loadMessages,
    sendMessage: mocks.sendMessage,
    requestInitialGreeting: mocks.requestInitialGreeting,
    requestMediation: mocks.requestMediation,
    clearMessages: mocks.clearMessages,
    subscribeToMessages: mocks.subscribeToMessages,
    retryFailedMessage: mocks.retryFailedMessage,
    dismissFailedMessageRetry: mocks.dismissFailedMessageRetry,
  };
  const useChatStore = Object.assign(() => state, { getState: () => state, setState: mocks.setChatState });
  return { useChatStore };
});

vi.mock("./ChatBubble", () => ({
  default: ({ message, presentation }: { message: { id: string; content: string }; presentation?: string }) => (
    <div data-message={message.id} data-presentation={presentation ?? "default"}>
      {message.content}
    </div>
  ),
}));
vi.mock("./ActionCard", () => ({ default: () => <div /> }));
vi.mock("./VendorToolCard", () => ({ default: () => <div />, VENDOR_TOOL_NAMES: new Set<string>() }));
vi.mock("./MediationConsentDialog", () => ({ default: () => <div /> }));

describe("ChatSidePanel 청첩장 모양", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messages = [];
    window.localStorage.clear();
    window.localStorage.setItem(amoraLaneStorageKey("user-1") as string, "shared");
    mocks.sendMessage.mockResolvedValue({ userMessage: "persisted", userMessageId: "user-message-1" });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    document.body.style.overflow = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  async function mount(presentation?: "invitation") {
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} presentation={presentation} />);
      await Promise.resolve();
    });
  }

  function panel() {
    return container.querySelector<HTMLElement>("[data-amora-panel-presentation]");
  }

  async function typeAndSend(text: string) {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="메시지 보내기"]')?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    const call = mocks.sendMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    const { content, senderId, senderRole, coupleId, senderName, weddingContext, target, visibility, images } = call;
    return { content, senderId, senderRole, coupleId, senderName, weddingContext, target, visibility, images };
  }

  it("덮개가 아니라 화면의 이름 붙은 한 칸이다: 대화 상자·닫기가 없고 스크롤을 잠그거나 초점을 옮기지 않는다", async () => {
    await mount("invitation");

    expect(panel()?.getAttribute("data-amora-panel-presentation")).toBe("invitation");
    // 좁은 화면의 대화는 이 칸이 화면 전부라, 읽어 주는 이름이 이 칸에 있어야 한다(2026-11-17 리드 지시).
    expect(panel()?.getAttribute("role")).toBe("region");
    expect(panel()?.getAttribute("aria-label")).toBe("아모라");
    expect(panel()?.getAttribute("aria-modal")).toBeNull();
    expect(container.querySelector('button[aria-label="아모라 상담 패널 닫기"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(document.body);
    // 머리줄(옛 "아모라 AI" 제목)은 바깥 화면이 로고·두 사람·오브로 대신 그린다.
    expect(container.textContent).not.toContain("아모라 AI");
  });

  it("아티팩트에 자리가 없는 AI 답변 안내와 공개 범위 줄을 늘 보인다", async () => {
    await mount("invitation");

    const disclosure = container.querySelector("[data-amora-ai-disclosure]");
    expect(disclosure?.textContent).toContain("AI 생성 답변");
    expect(disclosure?.textContent).toContain("계약·가격·중요 일정은 원문을 다시 확인해 주세요");
    expect(disclosure?.querySelector('a[href="/ai-policy"]')?.textContent).toBe("AI 정책");
    expect(container.querySelector('[role="group"][aria-label="상담 공개 범위"]')).not.toBeNull();
    expect(container.textContent).toContain("현재 범위 · 함께 대화");
    expect(container.textContent).toContain("미전송 글은 이 탭에서 30분 이내에 복구할 수 있어요.");
  });

  it("입력칸은 아티팩트의 알약이고 보내기는 44px 먹색 단추다", async () => {
    await mount("invitation");

    const input = container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    expect(input?.placeholder).toBe(WEB_COPY.inputPlaceholder);
    expect(input?.className).toContain("h-[46px]");
    expect(input?.parentElement?.className).toContain("rounded-[28px]");
    const send = container.querySelector<HTMLButtonElement>('button[aria-label="메시지 보내기"]');
    expect(send?.className).toEqual(expect.stringContaining("size-11"));
    expect(send?.className).toEqual(expect.stringContaining("bg-inv-ink"));
    expect(send?.className).toEqual(expect.stringContaining("rounded-[22px]"));
  });

  it("말풍선 모양을 청첩장으로 넘긴다(무엇을 그릴지는 말풍선이 정한다)", async () => {
    mocks.messages = [
      { id: "m1", couple_id: "couple-1", sender_id: null, sender_role: "ai", visibility: "shared", content: "안녕하세요", metadata: {}, created_at: "2026-11-17T00:00:00Z" },
    ];
    await mount("invitation");
    expect(container.querySelector('[data-message="m1"]')?.getAttribute("data-presentation")).toBe("invitation");
  });

  it("같은 문장을 보내면 덮개 모양과 같은 요청이 스토어로 나간다", async () => {
    await mount();
    const fromOverlay = await typeAndSend("예식장 계약금 환불이 안 된대요");

    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.sendMessage.mockClear();
    await mount("invitation");
    const fromInvitation = await typeAndSend("예식장 계약금 환불이 안 된대요");

    expect(fromInvitation).toEqual(fromOverlay);
    expect(fromInvitation.visibility).toBe("shared");
    expect(fromInvitation.target).toBe("ai");
  });

  it("대화 화면 정리는 머리줄 대신 안내 줄에 있고 같은 확인을 연다", async () => {
    mocks.messages = [
      { id: "m1", couple_id: "couple-1", sender_id: null, sender_role: "ai", visibility: "shared", content: "안녕하세요", metadata: {}, created_at: "2026-11-17T00:00:00Z" },
    ];
    await mount("invitation");
    const clear = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "대화 화면 정리");
    expect(clear).toBeDefined();
    await act(async () => clear?.click());
    expect(container.textContent).toContain("함께 대화의 이전 메시지를 내 화면에서만 숨길까요?");
  });

  it("전체 화면으로 보기는 머리줄 대신 안내 줄에 있고, 옆자리와 같은 인계로 전체 화면 대화를 연다", async () => {
    await mount("invitation");
    const expand = container.querySelector<HTMLButtonElement>('button[aria-label="아모라 상담 전체 화면으로 보기"]');
    expect(expand?.textContent).toBe("전체 화면으로 보기");
    expect(expand?.closest("[data-amora-panel-presentation]")).toBe(panel());

    await act(async () => expand?.click());
    expect(mocks.push).toHaveBeenCalledTimes(1);
    const destination = new URL(mocks.push.mock.calls[0][0] as string, "https://hanbang.ai");
    expect(destination.pathname).toBe("/wedding/chat");
    expect(destination.searchParams.get("scope")).toBe("shared");
    expect(destination.searchParams.get("amoraExpand")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
