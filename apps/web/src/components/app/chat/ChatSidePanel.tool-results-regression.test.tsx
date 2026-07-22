import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatSidePanel from "./ChatSidePanel";

// QA regression: .gstack/qa-reports/qa-report-127-0-0-1-3010-2026-07-18.md
// Distinct tool calls may share a success message; only truly identical calls should be collapsed.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  loadMessages: vi.fn(),
  requestInitialGreeting: vi.fn(),
  subscribeToMessages: vi.fn(() => vi.fn()),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    profile: { id: "user-1", role: "bride", name: "테스트" },
    couple: { id: "couple-1", bride_id: "user-1", groom_id: "user-2" },
    journey: null,
    isDemo: false,
  }),
}));

vi.mock("@/stores/chatStore", () => {
  const useChatStore = Object.assign(
    () => ({
      messages: mocks.messages,
      isStreaming: false,
      isSending: false,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      error: null,
      failedRequest: null,
      isRetrying: false,
      initialLoadDone: true,
      loadMessages: mocks.loadMessages,
      sendMessage: vi.fn(),
      requestInitialGreeting: mocks.requestInitialGreeting,
      clearMessages: vi.fn(),
      subscribeToMessages: mocks.subscribeToMessages,
      retryFailedMessage: vi.fn(),
      dismissFailedMessageRetry: vi.fn(),
    }),
    {
      setState: vi.fn(),
      getState: () => ({ messages: mocks.messages, isStreaming: false, isSending: false }),
    },
  );
  return { useChatStore };
});

vi.mock("./ChatBubble", () => ({
  default: ({ message }: { message: { content: string } }) => <div>{message.content}</div>,
}));
vi.mock("./ActionCard", () => ({
  default: ({ result }: { result: { toolInput: { title?: string } } }) => (
    <div data-testid="action-card">{result.toolInput.title}</div>
  ),
}));
vi.mock("./VendorToolCard", () => ({
  default: () => <div />,
  VENDOR_TOOL_NAMES: new Set<string>(),
}));
vi.mock("./SuggestionButtons", () => ({ default: () => <div /> }));
vi.mock("./StreamingBubble", () => ({ default: () => <div /> }));

function toolResult(title: string) {
  return {
    toolName: "add_amora_action",
    toolInput: { title },
    toolOutput: { action: { id: title } },
    success: true,
    displayMessage: "아모라 행동 카드를 저장했어요.",
  };
}

describe("ChatSidePanel tool-result deduplication", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("keeps distinct actions even when their display messages match", async () => {
    mocks.messages = [{
      id: "message-1",
      sender_id: null,
      sender_role: "ai",
      content: "두 가지 할 일을 저장했어요.",
      visibility: "shared",
      metadata: {
        toolResults: [toolResult("드레스 투어 예약"), toolResult("메이크업 상담 예약")],
      },
      created_at: "2026-07-18T00:00:00.000Z",
    }];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const cards = container.querySelectorAll('[data-testid="action-card"]');
    expect(cards).toHaveLength(2);
    expect(container.textContent).toContain("드레스 투어 예약");
    expect(container.textContent).toContain("메이크업 상담 예약");
  });

  it("still collapses an exact repeated call", async () => {
    const duplicate = toolResult("드레스 투어 예약");
    mocks.messages = [{
      id: "message-2",
      sender_id: null,
      sender_role: "ai",
      content: "할 일을 저장했어요.",
      visibility: "shared",
      metadata: { toolResults: [duplicate, { ...duplicate }] },
      created_at: "2026-07-18T00:00:00.000Z",
    }];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.querySelectorAll('[data-testid="action-card"]')).toHaveLength(1);
  });
});
