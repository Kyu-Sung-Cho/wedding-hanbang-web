import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatContent from "./ChatContent";
import type { ChatMessage } from "@/types/database.types";
import {
  rememberPendingAmoraFirstHello,
  resetAmoraFirstHelloMemory,
} from "@/lib/amora/pendingFirstHello";

const HELLO = {
  preview: "오늘은 딱 한 가지만 정해볼까요?",
  body: "안녕하세요, 아모라예요.\n\n오늘은 딱 한 가지만 정해볼까요?",
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
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
  messages: [] as ChatMessage[],
  suggestions: [] as string[],
  error: null as string | null,
  failedRequest: null as null | {
    visibility: "shared" | "bride_private" | "groom_private";
    recoveryKind?: "confirmed_action";
    unavailableReason: string | null;
    canRetry: boolean;
  },
  artifactVisibility: "shared" as "shared" | "bride_private" | "groom_private" | null,
  isStreaming: false,
  streamingContent: "",
  quotaRemaining: null as number | null,
  profileRole: "bride" as "bride" | "groom" | null,
  profileId: "user-1",
  coupleId: "couple-1",
  partnerLinked: true,
  partnerTyping: null as null | {
    sender_role: "bride" | "groom";
    user_id: string;
    updated_at: number;
  },
  queryPrefill: null as string | null,
  startHereHandoffId: null as string | null,
  isDemo: false,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const params = new URLSearchParams();
    if (mocks.queryPrefill) params.set("prefill", mocks.queryPrefill);
    if (mocks.startHereHandoffId) {
      params.set("startHereHandoff", mocks.startHereHandoffId);
    }
    return params;
  },
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    profile: {
      id: mocks.profileId,
      role: mocks.profileRole,
      name: "테스트",
      couple_id: mocks.coupleId,
    },
    couple: {
      id: mocks.coupleId,
      bride_id: mocks.profileId,
      groom_id: mocks.partnerLinked ? "user-2" : null,
    },
    journey: null,
    isDemo: mocks.isDemo,
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
    get messages() {
      return mocks.messages;
    },
    get isStreaming() {
      return mocks.isStreaming;
    },
    isSending: false,
    get streamingContent() {
      return mocks.streamingContent;
    },
    streamingToolResults: [],
    get suggestions() {
      return mocks.suggestions;
    },
    get error() {
      return mocks.error;
    },
    get failedRequest() {
      return mocks.failedRequest;
    },
    get artifactVisibility() {
      return mocks.artifactVisibility;
    },
    isRetrying: false,
    get quotaRemaining() {
      return mocks.quotaRemaining;
    },
    initialLoadDone: true,
    get presence() {
      return { partnerTyping: mocks.partnerTyping };
    },
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
  const useChatStore = Object.assign(
    () => state,
    {
      getState: () => state,
      setState: mocks.setChatState,
    },
  );
  return { useChatStore };
});

vi.mock("./ChatBubble", () => ({ default: () => <div /> }));
vi.mock("./ActionCard", () => ({ default: () => <div /> }));
vi.mock("./VendorToolCard", () => ({
  default: ({ onSend }: { onSend?: (text: string) => void }) => (
    <button type="button" onClick={() => onSend?.("아모라 카드 후속 질문")}>AI 카드 실행</button>
  ),
  VENDOR_TOOL_NAMES: new Set<string>(["search_venues"]),
}));
vi.mock("./SuggestionButtons", () => ({
  default: ({
    suggestions,
    onSelect,
  }: {
    suggestions: string[];
    onSelect: (suggestion: string) => void;
  }) => (
    <div>
      {suggestions.map((suggestion) => (
        <button key={suggestion} type="button" onClick={() => onSelect(suggestion)}>
          {suggestion}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("./StreamingBubble", () => ({
  default: ({ onSend }: { onSend?: (text: string) => void }) => (
    <div>
      <span>스트리밍 응답 표시</span>
      <button type="button" onClick={() => onSend?.("스트리밍 후속 질문")}>스트리밍 AI 실행</button>
    </div>
  ),
}));
vi.mock("./ChatInfoPanel", () => ({ default: () => <div /> }));
vi.mock("./MediationConsentDialog", () => ({ default: () => <div /> }));
vi.mock("./AmoraPersonalizationPrompt", () => ({
  AmoraPersonalizationConfirmation: () => <div />,
  AmoraQuickStart: () => <div />,
}));
vi.mock("./PendingAmoraActionCard", () => ({
  default: () => <div />,
  getPendingAmoraAction: () => null,
  getPendingActionDisabledReason: () => null,
  isPendingAmoraActionExpired: () => false,
}));
vi.mock("@/lib/care/requestProactiveCare", () => ({
  requestProactiveCare: vi.fn(),
}));

describe("전체 페이지 대화에서도 아모라의 첫마디를 만난다", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messages = [];
    mocks.suggestions = [];
    mocks.error = null;
    mocks.failedRequest = null;
    mocks.artifactVisibility = "shared";
    mocks.isStreaming = false;
    mocks.streamingContent = "";
    mocks.quotaRemaining = null;
    mocks.profileRole = "bride";
    mocks.profileId = "user-1";
    mocks.coupleId = "couple-1";
    mocks.partnerLinked = true;
    mocks.partnerTyping = null;
    mocks.queryPrefill = null;
    mocks.startHereHandoffId = null;
    mocks.isDemo = false;
    window.sessionStorage.clear();
    window.localStorage.clear();
    resetAmoraFirstHelloMemory();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  async function render() {
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });
  }

  const helloNode = () =>
    container.querySelector('[data-testid="amora-first-hello-message"]');

  it("사이드바로 들어온 사람에게도 첫마디가 놓여 있다", async () => {
    // 사이드바의 "아모라"는 /chat으로 간다. 라운지의 말풍선은 그 길에 없으므로,
    // 여기서 꺼내지 않으면 그 사람은 첫마디를 아예 만나지 못한다.
    rememberPendingAmoraFirstHello(HELLO, { ownerId: "user-1" });
    await render();

    expect(helloNode()).not.toBeNull();
    // 이미 아모라가 말을 걸어둔 자리라 모델에게 인사를 다시 요청하지 않는다.
    expect(mocks.requestInitialGreeting).not.toHaveBeenCalled();
  });

  it("한 번 보여준 뒤에는 다시 놓이지 않는다", async () => {
    rememberPendingAmoraFirstHello(HELLO, { ownerId: "user-1" });
    await render();
    expect(helloNode()).not.toBeNull();

    // 다음에 다시 켰을 때와 같은 상태 — 보관도 이번 로드의 기억도 비어 있다.
    await act(async () => root.unmount());
    resetAmoraFirstHelloMemory();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await render();

    expect(helloNode()).toBeNull();
    expect(mocks.requestInitialGreeting).toHaveBeenCalled();
  });

  it("남의 인사를 다른 계정 화면에 놓지 않는다", async () => {
    rememberPendingAmoraFirstHello(HELLO, { ownerId: "user-2" });
    await render();

    expect(helloNode()).toBeNull();
  });

  it("첫마디가 없으면 평소대로 모델에게 첫 인사를 요청한다", async () => {
    await render();

    expect(helloNode()).toBeNull();
    expect(mocks.requestInitialGreeting).toHaveBeenCalled();
  });
});
