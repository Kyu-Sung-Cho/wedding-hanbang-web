import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatContent from "./ChatContent";
import ChatSidePanel from "./ChatSidePanel";

/**
 * 두 웹 채팅 표면이 스토어와 같은 안전 레인을 고르는가.
 *
 * 2026-09-03: 화면은 `planAmoraCrisisDelivery` 에 `externalSafetySignal` 을 안
 * 넘기고 스토어(`chatStore.sendMessage`)와 서버는 넘겼다. 그래서 폭력·강압 서술이
 * 나만 보기 레인으로 옮겨졌는데 화면은 함께 대화 탭에 그대로 남아, 내 말풍선도
 * 아모라 답도 오류도 스피너도 없는 빈 화면이 됐다.
 *
 * 그래서 소스 문자열이 아니라 **같은 문장을 두 표면에 넣어 같은 결론이 나오는지**로
 * 잰다. 판정을 낮추는 것이 아니라 화면을 이미 내려진 판정에 맞추는 것이므로,
 * 안전 신호가 없는 대조군이 계속 `shared` 로 남는지도 함께 잰다.
 */
const PRIVATE_LANE_SENTENCES = [
  "남편이 저를 때립니다",
  "손찌검을 한 적이 있어요",
  "목을 조른 적도 있어요",
  "화나면 물건을 집어 던져요",
  "집에 못 나가게 가둬놨어요",
  "동의 없이 관계를 강요당했어요",
];

const SHARED_LANE_SENTENCES = [
  "예식장 계약금 환불이 안 된대요",
  "청첩장 문구 확인했어요",
];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  sendMessage: vi.fn(),
  loadMessages: vi.fn(),
  requestInitialGreeting: vi.fn(),
  requestMediation: vi.fn(),
  clearMessages: vi.fn(),
  subscribeToMessages: vi.fn(() => vi.fn()),
  pollNewMessages: vi.fn(),
  notifyTyping: vi.fn(),
  stopTyping: vi.fn(),
  requestSharedClear: vi.fn(),
  retryFailedMessage: vi.fn(),
  dismissFailedMessageRetry: vi.fn(),
  setChatState: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    profile: {
      id: "user-1",
      role: "bride",
      name: "테스트",
      couple_id: "couple-1",
    },
    couple: { id: "couple-1", bride_id: "user-1", groom_id: "user-2" },
    journey: null,
    isDemo: false,
    isInitialized: true,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useAmoraPersonalization", () => ({
  useAmoraPersonalization: () => ({
    profile: null,
    status: "ready",
    saving: false,
    error: null,
    save: vi.fn(),
  }),
}));

vi.mock("@/stores/chatStore", () => {
  const state = {
    messages: [],
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
    presence: { partnerTyping: null },
    loadMessages: mocks.loadMessages,
    sendMessage: mocks.sendMessage,
    requestInitialGreeting: mocks.requestInitialGreeting,
    requestMediation: mocks.requestMediation,
    clearMessages: mocks.clearMessages,
    subscribeToMessages: mocks.subscribeToMessages,
    pollNewMessages: mocks.pollNewMessages,
    notifyTyping: mocks.notifyTyping,
    stopTyping: mocks.stopTyping,
    requestSharedClear: mocks.requestSharedClear,
    retryFailedMessage: mocks.retryFailedMessage,
    dismissFailedMessageRetry: mocks.dismissFailedMessageRetry,
  };
  const useChatStore = Object.assign(() => state, {
    getState: () => state,
    setState: mocks.setChatState,
  });
  return { useChatStore };
});

vi.mock("./ChatBubble", () => ({ default: () => <div /> }));
vi.mock("./ActionCard", () => ({ default: () => <div /> }));
vi.mock("./VendorToolCard", () => ({
  default: () => <div />,
  VENDOR_TOOL_NAMES: new Set<string>(),
}));
vi.mock("./SuggestionButtons", () => ({ default: () => <div /> }));
vi.mock("./StreamingBubble", () => ({ default: () => <div /> }));
vi.mock("./ChatInfoPanel", () => ({ default: () => <div /> }));
vi.mock("./MediationConsentDialog", () => ({ default: () => <div /> }));
vi.mock("./AmoraPersonalizationPrompt", () => ({
  AmoraPersonalizationConfirmation: () => <div />,
  AmoraQuickStart: () => <div />,
}));
vi.mock("@/lib/care/requestProactiveCare", () => ({
  requestProactiveCare: vi.fn(),
}));

type Surface = "chat" | "panel";

const SEND_LABEL: Record<Surface, string> = {
  chat: "함께 보는 아모라 메시지 보내기",
  panel: "메시지 보내기",
};

describe("web chat surfaces pick the same Amora safety lane", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue({
      userMessage: "persisted",
      userMessageId: "user-message-1",
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const mount = async (surface: Surface) => {
    await act(async () => {
      root.render(surface === "chat"
        ? <ChatContent />
        : <ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
  };

  // 전체화면 채팅은 textarea, 사이드 패널은 input[type=text] 를 쓴다.
  const composer = (surface: Surface) => (
    surface === "chat"
      ? container.querySelector<HTMLTextAreaElement>("textarea")
      : container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]')
  );

  const typeIntoComposer = async (surface: Surface, value: string) => {
    const element = composer(surface);
    expect(element).not.toBeNull();
    await act(async () => {
      const prototype = surface === "chat"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      valueSetter?.call(element, value);
      element?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  const clickSend = async (surface: Surface) => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.getAttribute("aria-label") === SEND_LABEL[surface]);
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
  };

  /** 한 표면에 문장 하나를 넣고 스토어로 나간 visibility 를 돌려준다. */
  const sendAndReadVisibility = async (surface: Surface, sentence: string) => {
    await mount(surface);
    await typeIntoComposer(surface, sentence);
    await clickSend(surface);
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    const call = mocks.sendMessage.mock.calls.at(-1)?.[0] as
      | { visibility?: string; content?: string }
      | undefined;
    return call?.visibility;
  };

  it.each(PRIVATE_LANE_SENTENCES)(
    "moves %s to the private lane on both surfaces",
    async (sentence) => {
      const fromChat = await sendAndReadVisibility("chat", sentence);
      await act(async () => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      mocks.sendMessage.mockClear();
      const fromPanel = await sendAndReadVisibility("panel", sentence);

      expect(fromChat).toBe("bride_private");
      expect(fromPanel).toBe(fromChat);
    },
  );

  it.each(SHARED_LANE_SENTENCES)(
    "keeps %s in the shared lane on both surfaces",
    async (sentence) => {
      const fromChat = await sendAndReadVisibility("chat", sentence);
      await act(async () => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      mocks.sendMessage.mockClear();
      const fromPanel = await sendAndReadVisibility("panel", sentence);

      expect(fromChat).toBe("shared");
      expect(fromPanel).toBe(fromChat);
    },
  );

  it("moves the full-screen chat to the private tab so the answer is not invisible", async () => {
    await mount("chat");
    await typeIntoComposer("chat", PRIVATE_LANE_SENTENCES[0]);
    await clickSend("chat");
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());

    await vi.waitFor(() => {
      expect(composer("chat")?.placeholder).toContain("아모라에게 솔직히");
    });
  });

  it("restores the held draft into the private composer instead of losing it", async () => {
    mocks.sendMessage.mockResolvedValue({
      userMessage: "ephemeral_safety",
      safetyCardId: "amora-crisis-preflight:couple-1:1",
      effectiveVisibility: "bride_private",
    });
    await mount("chat");
    await typeIntoComposer("chat", "지금 죽고 싶어");
    await clickSend("chat");
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());

    await vi.waitFor(() => {
      expect(composer("chat")?.placeholder).toContain("아모라에게 솔직히");
      expect(composer("chat")?.value).toBe("지금 죽고 싶어");
    });
  });

  it("restores the held draft in the side panel composer too", async () => {
    mocks.sendMessage.mockResolvedValue({
      userMessage: "ephemeral_safety",
      safetyCardId: "amora-crisis-preflight:couple-1:2",
      effectiveVisibility: "bride_private",
    });
    await mount("panel");
    await typeIntoComposer("panel", "지금 죽고 싶어");
    await clickSend("panel");
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());

    await vi.waitFor(() => {
      expect(composer("panel")?.value).toBe("지금 죽고 싶어");
    });
  });
});
