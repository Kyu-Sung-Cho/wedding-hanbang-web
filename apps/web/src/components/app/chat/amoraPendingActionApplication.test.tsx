import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatContent from "./ChatContent";
import ChatSidePanel from "./ChatSidePanel";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";

/**
 * 제안 카드의 안내 문구가 두 표면에서 같은가, 그리고 그 근거가 반영 성공인가.
 *
 * 2026-09-03: 전체화면 채팅은 **확인 메시지가 있다**는 것만으로 "이 제안은
 * 적용됐어요" 로 잠갔고(서버가 거절해도 똑같았다), 사이드 패널은 그 판정을 아예
 * 하지 않아 **성공한 직후에도** "새 대화가 이어져 이 제안은 적용할 수 없어요" 를
 * 띄웠다. 그래서 같은 메시지 배열을 두 표면에 넣어 같은 결론이 나오는지로 잰다.
 */
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type TestMessage = {
  id: string;
  couple_id: string;
  sender_id: string | null;
  sender_role: "bride" | "groom" | "ai";
  content: string;
  visibility: "shared" | "bride_private" | "groom_private";
  metadata: Record<string, unknown>;
  created_at: string;
};

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
  messages: [] as unknown[],
  isStreaming: false,
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
    get messages() {
      return mocks.messages;
    },
    get isStreaming() {
      return mocks.isStreaming;
    },
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

vi.mock("./ChatBubble", () => ({
  default: ({ message }: { message: { content: string } }) => <div>{message.content}</div>,
}));
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

const ACTION_ID = "123e4567-e89b-42d3-a456-426614174010";
const TOOL = "add_schedule_event";
const TOOL_INPUT = {
  date: "2026-08-01",
  title: "드레스 투어",
  schedule_scope: "confirmed_fact",
};
const ISSUED_AT = Date.now() - 1_000;

/** 카드에 붙는 안내 문구. `PendingAmoraActionCard` 의 DISABLED_COPY 와 같다. */
const COPY = {
  applied: "이 제안은 적용됐어요.",
  not_latest: "새 대화가 이어져 이 제안은 적용할 수 없어요.",
  busy: "현재 답변이 끝나면 다시 확인할 수 있어요.",
} as const;

function proposalMessage(): TestMessage {
  const identity = getAmoraToolOperationIdentity(TOOL, TOOL_INPUT);
  return {
    id: "proposal-1",
    couple_id: "couple-1",
    sender_id: null,
    sender_role: "ai",
    content: "일정을 추가할 수 있어요.",
    visibility: "shared",
    metadata: {
      target: "ai",
      pending_amora_action: {
        version: 2,
        actionId: ACTION_ID,
        tool: TOOL,
        input: TOOL_INPUT,
        inputDigest: identity.inputDigest,
        operationKey: identity.operationKey,
        confirmation: "드레스 투어 일정을 추가할까요?",
        issuedAt: ISSUED_AT,
        expiresAt: ISSUED_AT + 24 * 60 * 60 * 1_000,
      },
    },
    created_at: new Date(ISSUED_AT).toISOString(),
  };
}

function confirmationMessage(): TestMessage {
  return {
    id: "confirmation-1",
    couple_id: "couple-1",
    sender_id: "user-1",
    sender_role: "bride",
    content: "좋아요. 제안한 변경을 적용해 주세요.",
    visibility: "shared",
    metadata: { target: "ai", confirmed_amora_action_id: ACTION_ID },
    created_at: new Date(ISSUED_AT + 500).toISOString(),
  };
}

function answerMessage(success: boolean): TestMessage {
  return {
    id: "answer-1",
    couple_id: "couple-1",
    sender_id: null,
    sender_role: "ai",
    content: success ? "일정에 추가했어요." : "그 사이 내용이 바뀌어 아무것도 변경하지 않았어요.",
    visibility: "shared",
    metadata: {
      target: "ai",
      in_reply_to_user_message_id: "confirmation-1",
      toolResults: [{
        toolName: TOOL,
        toolInput: {},
        toolOutput: {},
        success,
        displayMessage: success ? "추가했어요" : "변경하지 않았어요",
      }],
    },
    created_at: new Date(ISSUED_AT + 900).toISOString(),
  };
}

type Surface = "chat" | "panel";

/** 화면에 실제로 렌더된 카드 상태. 두 표면에서 같아야 한다. */
interface RenderedCardState {
  applyDisabled: boolean;
  copy: string | null;
}

describe("both web chat surfaces describe an applied proposal the same way", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messages = [];
    mocks.isStreaming = false;
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

  const readCardState = async (surface: Surface): Promise<RenderedCardState> => {
    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(surface === "chat"
        ? <ChatContent />
        : <ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    const applyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="변경 내용 확인하기"]',
    );
    expect(applyButton).not.toBeNull();
    const text = container.textContent ?? "";
    const copy = Object.values(COPY).find((candidate) => text.includes(candidate)) ?? null;
    return { applyDisabled: Boolean(applyButton?.disabled), copy };
  };

  const readBothSurfaces = async () => ({
    chat: await readCardState("chat"),
    panel: await readCardState("panel"),
  });

  it("calls a proposal applied only after the confirmed tool reports success", async () => {
    mocks.messages = [proposalMessage(), confirmationMessage(), answerMessage(true)];

    const { chat, panel } = await readBothSurfaces();

    expect(chat).toEqual({ applyDisabled: true, copy: COPY.applied });
    expect(panel).toEqual(chat);
  });

  it("never claims success when the confirmed tool reported a failure", async () => {
    mocks.messages = [proposalMessage(), confirmationMessage(), answerMessage(false)];

    const { chat, panel } = await readBothSurfaces();

    expect(chat.copy).not.toBe(COPY.applied);
    expect(chat).toEqual({ applyDisabled: true, copy: COPY.not_latest });
    expect(panel).toEqual(chat);
  });

  it("says the answer is still running while no result has come back", async () => {
    mocks.messages = [proposalMessage(), confirmationMessage()];
    mocks.isStreaming = true;

    const { chat, panel } = await readBothSurfaces();

    expect(chat).toEqual({ applyDisabled: true, copy: COPY.busy });
    expect(panel).toEqual(chat);
  });

  it("leaves an untouched latest proposal pressable on both surfaces", async () => {
    mocks.messages = [proposalMessage()];

    const { chat, panel } = await readBothSurfaces();

    expect(chat).toEqual({ applyDisabled: false, copy: null });
    expect(panel).toEqual(chat);
  });
});
