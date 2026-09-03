import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatContent from "./ChatContent";
import ChatSidePanel from "./ChatSidePanel";
import { CARRIED_PENDING_ACTION_LABEL } from "./PendingAmoraActionCard";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { ChatMessage } from "@/types/database.types";

/**
 * 웹 두 표면이 같은 카드에 같은 말을 한다 (2026-09-04).
 *
 * 아모라 대화는 전체 화면(`ChatContent`)과 옆 패널(`ChatSidePanel`) 두 곳에서 보이고,
 * 이월 라벨을 한쪽에만 붙이면 같은 카드가 화면마다 다르게 읽힌다. 그래서 **같은 메시지
 * 배열**을 두 표면에 넣고 그려진 카드를 통째로 대조한다 — 소스에 문자열이 있는지 묻지
 * 않는다. 있는 문자열이 화면에 안 나올 수 있고, 조건이 뒤집혀도 문자열은 그대로 있다.
 */

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
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    profile: { id: "user-1", role: "bride", name: "테스트", couple_id: "couple-1" },
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
    isStreaming: false,
    isSending: false,
    streamingContent: "",
    streamingToolResults: [],
    suggestions: [] as string[],
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

// 카드 자체는 **진짜**를 쓴다. 주변만 걷어낸다.
vi.mock("./ChatBubble", () => ({
  default: ({ message }: { message: { content: string } }) => <div>{message.content}</div>,
}));
vi.mock("./ActionCard", () => ({ default: () => <div /> }));
vi.mock("./VendorToolCard", () => ({
  default: () => <div />,
  VENDOR_TOOL_NAMES: new Set<string>(["search_vendors"]),
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

const ISSUED_AT = Date.now() - 60_000;
const ACTION_ID = "55555555-5555-4555-8555-555555555555";
const identity = getAmoraToolOperationIdentity("update_budget", { totalBudget: 30_000_000 });

function messagesWithCarryCount(carryCount: number): ChatMessage[] {
  return [
    {
      id: "user-msg-1",
      couple_id: "couple-1",
      sender_id: "user-1",
      sender_role: "bride",
      content: "부케는 어디서 알아봐?",
      metadata: { target: "ai" },
      visibility: "shared",
      created_at: new Date(ISSUED_AT - 1_000).toISOString(),
    } as ChatMessage,
    {
      id: "ai-msg-1",
      couple_id: "couple-1",
      sender_id: null,
      sender_role: "ai",
      content: "9월 10일 일정을 등록할까요?",
      metadata: {
        target: "ai",
        pending_amora_action: {
          version: 2,
          actionId: ACTION_ID,
          tool: "update_budget",
          input: { totalBudget: 30_000_000 },
          inputDigest: identity.inputDigest,
          operationKey: identity.operationKey,
          confirmation: "총예산을 3,000만 원으로 변경할까요?",
          issuedAt: ISSUED_AT,
          expiresAt: ISSUED_AT + 24 * 60 * 60 * 1_000,
        },
        ...(carryCount > 0
          ? { pending_amora_action_carry_count: carryCount }
          : {}),
      },
      visibility: "shared",
      created_at: new Date(ISSUED_AT).toISOString(),
    } as unknown as ChatMessage,
  ];
}

function cardSection(container: HTMLElement): HTMLElement {
  const section = container.querySelector<HTMLElement>(
    "section[data-pending-action-carried]",
  );
  expect(section, "카드가 그려지지 않았다").not.toBeNull();
  return section!;
}

describe("이월 카드는 두 표면에서 같게 보인다", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response)));
    window.sessionStorage.clear();
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  async function renderSurface(
    surface: "content" | "panel",
    carryCount: number,
  ): Promise<HTMLElement> {
    mocks.messages = messagesWithCarryCount(carryCount);
    await act(async () => {
      root.render(
        surface === "content"
          ? <ChatContent />
          : <ChatSidePanel isOpen onClose={vi.fn()} />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return cardSection(container);
  }

  async function resetRoot() {
    await act(async () => root.unmount());
    container.replaceChildren();
    root = createRoot(container);
  }

  for (const carryCount of [0, 1, 2]) {
    it(`carry_count ${carryCount} — 전체 화면과 옆 패널의 카드가 같다`, async () => {
      const fromContent = (await renderSurface("content", carryCount)).outerHTML;
      await resetRoot();
      const fromPanel = (await renderSurface("panel", carryCount)).outerHTML;
      expect(fromPanel).toBe(fromContent);
    });
  }

  it("이월 값이 있으면 두 표면 모두 라벨을 붙인다", async () => {
    for (const surface of ["content", "panel"] as const) {
      const section = await renderSurface(surface, 1);
      expect(section.dataset.pendingActionCarried, surface).toBe("true");
      expect(section.textContent, surface).toContain(CARRIED_PENDING_ACTION_LABEL);
      // 이 턴의 문장("9월 10일 일정을 등록할까요?")이 아니라 카드가 실제로 바꾸는
      // 것을 제목 자리에 둔다.
      expect(section.querySelector("h3")?.textContent, surface)
        .toBe("총예산을 3,000만 원으로 변경할까요?");
      await resetRoot();
    }
  });

  it("이월 값이 없으면 두 표면 모두 라벨을 붙이지 않는다", async () => {
    for (const surface of ["content", "panel"] as const) {
      const section = await renderSurface(surface, 0);
      expect(section.dataset.pendingActionCarried, surface).toBe("false");
      expect(section.textContent, surface).not.toContain(CARRIED_PENDING_ACTION_LABEL);
      await resetRoot();
    }
  });
});
