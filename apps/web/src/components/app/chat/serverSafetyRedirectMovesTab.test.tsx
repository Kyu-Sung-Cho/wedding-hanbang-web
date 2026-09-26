import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { amoraLaneStorageKey } from "@hanbang/shared/amora-lane-choice";

import ChatContent from "./ChatContent";
import ChatSidePanel from "./ChatSidePanel";

/**
 * 서버만 나만 레인으로 옮겼을 때 두 웹 채팅 표면이 따라가는가 (2026-09-26).
 *
 * 화면의 사전 판정은 `continue`(함께 대화)인데 서버(`POST /api/chat/messages`)가 저장 직전에
 * 나만 레인으로 옮기는 경우가 있다 — 배포 직후 옛 번들이 떠 있거나, 서버에만 있는 판정이
 * 붙었을 때다. 그때 화면이 함께 탭에 남으면 사용자는 **자기 말풍선도 아모라 답도 안내도 못
 * 본다**(메시지는 나만 레인에 저장됐다). 2026-09-03 에 화면 사전 판정 쪽으로 같은 증상을
 * 고쳤는데(`amoraSafetyLaneParity.test.tsx`), 서버만 옮기는 경우는 남아 있었다. 앱은
 * `chat.tsx` 에서 이미 처리한다.
 *
 * 여기서 재는 것:
 *  - 스토어가 저장 직후(답을 기다리기 **전**) `onSafetyPrivacyRedirect` 로 알리면 곧바로 탭을 옮긴다.
 *  - 그 알림이 없어도 결과(`persisted` + `safetyPrivacyRedirected`)를 보고 옮긴다.
 *  - 대조군: 서버가 옮기지 않았으면 함께 탭에 그대로 있다.
 *
 * 문장은 일부러 안전 신호가 없는 평범한 문장이다 — 화면 사전 판정이 `continue` 여야 이
 * 경로만 잴 수 있다.
 */
const ORDINARY_SENTENCE = "예식장 계약금 환불이 안 된대요";

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

type SendParams = {
  visibility?: string;
  onSafetyPrivacyRedirect?: (visibility: "bride_private" | "groom_private") => void;
};

const REDIRECTED_OUTCOME = {
  userMessage: "persisted",
  userMessageId: "user-message-1",
  effectiveVisibility: "bride_private",
  safetyPrivacyRedirected: true,
} as const;

describe("web chat surfaces follow a server-only private safety redirect", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // 2026-09-26 부터 처음 여는 사람은 '함께/나만'을 먼저 고른다(`amoraLaneFirstChoice.test.tsx`).
    // 이 파일은 이미 '함께'를 고른 사람이 보낸 글을 서버가 옮기는 경우만 잰다.
    window.localStorage.clear();
    window.localStorage.setItem(amoraLaneStorageKey("user-1") as string, "shared");
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

  const composer = (surface: Surface) => (
    surface === "chat"
      ? container.querySelector<HTMLTextAreaElement>("textarea")
      : container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]')
  );

  /** 지금 이 표면이 나만(상담) 레인을 보고 있는가. 표면마다 드러내는 방법이 다르다. */
  const showsPrivateLane = (surface: Surface) => {
    if (surface === "chat") {
      return composer("chat")?.placeholder.includes("아모라에게 솔직히") ?? false;
    }
    const privateScope = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent?.includes("나만 (상담)"));
    expect(privateScope, "사이드패널의 나만(상담) 버튼을 못 찾았다").toBeDefined();
    return privateScope?.getAttribute("aria-pressed") === "true";
  };

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

  const lastSendParams = () => mocks.sendMessage.mock.calls.at(-1)?.[0] as SendParams | undefined;

  it.each<Surface>(["chat", "panel"])(
    "%s: moves to the private lane as soon as the store reports the server redirect — before the answer finishes",
    async (surface) => {
      let finish: (value: unknown) => void = () => {};
      mocks.sendMessage.mockImplementation((params: SendParams) => {
        params.onSafetyPrivacyRedirect?.("bride_private");
        // 아모라 답이 아직 스트리밍 중이다 — 결과는 돌아오지 않았다.
        return new Promise((resolve) => { finish = resolve; });
      });
      await mount(surface);
      expect(showsPrivateLane(surface)).toBe(false);
      await typeIntoComposer(surface, ORDINARY_SENTENCE);
      await clickSend(surface);
      await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());

      // 화면 사전 판정은 함께 대화로 보냈다 — 옮긴 것은 서버다.
      expect(lastSendParams()?.visibility).toBe("shared");
      expect(typeof lastSendParams()?.onSafetyPrivacyRedirect).toBe("function");
      await vi.waitFor(() => expect(showsPrivateLane(surface)).toBe(true));

      await act(async () => {
        finish(REDIRECTED_OUTCOME);
        await Promise.resolve();
      });
      expect(showsPrivateLane(surface)).toBe(true);
    },
  );

  it.each<Surface>(["chat", "panel"])(
    "%s: moves to the private lane from the send result when no early report arrived",
    async (surface) => {
      mocks.sendMessage.mockResolvedValue(REDIRECTED_OUTCOME);
      await mount(surface);
      await typeIntoComposer(surface, ORDINARY_SENTENCE);
      await clickSend(surface);
      await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());

      await vi.waitFor(() => expect(showsPrivateLane(surface)).toBe(true));
    },
  );

  it.each<Surface>(["chat", "panel"])(
    "%s: a private effective visibility alone also moves the lane",
    async (surface) => {
      mocks.sendMessage.mockResolvedValue({
        userMessage: "persisted",
        userMessageId: "user-message-1",
        effectiveVisibility: "bride_private",
      });
      await mount(surface);
      await typeIntoComposer(surface, ORDINARY_SENTENCE);
      await clickSend(surface);
      await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());

      await vi.waitFor(() => expect(showsPrivateLane(surface)).toBe(true));
    },
  );

  it.each<Surface>(["chat", "panel"])(
    "%s: stays in the shared lane when the server kept the message shared",
    async (surface) => {
      mocks.sendMessage.mockResolvedValue({
        userMessage: "persisted",
        userMessageId: "user-message-1",
      });
      await mount(surface);
      await typeIntoComposer(surface, ORDINARY_SENTENCE);
      await clickSend(surface);
      await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(lastSendParams()?.visibility).toBe("shared");
      expect(showsPrivateLane(surface)).toBe(false);
    },
  );
});
