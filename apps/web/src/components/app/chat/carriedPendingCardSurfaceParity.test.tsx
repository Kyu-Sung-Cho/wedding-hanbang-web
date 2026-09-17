import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatContent from "./ChatContent";
import ChatSidePanel from "./ChatSidePanel";
import {
  CARRIED_PENDING_ACTION_LABEL,
  CONTINUED_PENDING_ACTION_COPY,
  QUEUED_CARD_SKIP_LABEL,
} from "./PendingAmoraActionCard";
import { AMORA_QUEUED_CARD_SKIP_TEXT } from "@/lib/ai/amoraQueuedCardSkip";
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

/**
 * 여러 변경을 한 번에 부탁해 서버가 첫 건만 카드로 내고 나머지 2건을 대기열로 든 대화
 * (2026-09-18). 이 카드에는 "이 항목 건너뛰기" 가 따로 나온다.
 *
 * 대기열은 **바로 이 카드**를 가리킨다(`currentActionId`). 남은 요청의 입력은 화면에
 * 쓰지 않으므로 건수만 맞춰 둔다.
 */
function messagesWithQueuedCard(): ChatMessage[] {
  const [userMessage, aiMessage] = messagesWithCarryCount(0);
  const metadata = aiMessage.metadata as Record<string, unknown>;
  return [
    { ...userMessage, content: "결혼식장 예산이랑 드레스 예산이랑 헤어메이크업 예산 다 바꿔줘" },
    {
      ...aiMessage,
      metadata: {
        ...metadata,
        pending_amora_action_queue: {
          version: 1,
          queueId: ACTION_ID,
          currentActionId: ACTION_ID,
          totalCount: 3,
          completedCount: 0,
          remainingActions: [
            { tool: "update_category_budget", input: { category: "드레스", amount: 3_000_000 } },
            { tool: "update_category_budget", input: { category: "헤어메이크업", amount: 1_000_000 } },
          ],
        },
      },
    } as unknown as ChatMessage,
  ];
}

/**
 * 사용자가 버튼 대신 "응 적용해줘" 라고 쳐서 같은 카드가 최신 답변으로 옮겨진 대화
 * (2026-09-15). 원래 답변(`ai-msg-1`)과 옮겨진 답변(`ai-msg-2`)이 같은 제안을 든다.
 */
function messagesWithCardMovedToLatestReply(): ChatMessage[] {
  const [userMessage, original] = messagesWithCarryCount(0);
  const originalMetadata = original.metadata as Record<string, unknown>;
  return [
    userMessage,
    original,
    {
      id: "user-msg-2",
      couple_id: "couple-1",
      sender_id: "user-1",
      sender_role: "bride",
      content: "응 적용해줘",
      metadata: { target: "ai" },
      visibility: "shared",
      created_at: new Date(ISSUED_AT + 1_000).toISOString(),
    } as ChatMessage,
    {
      id: "ai-msg-2",
      couple_id: "couple-1",
      sender_id: null,
      sender_role: "ai",
      content: "아래 카드에서 확인해 주세요.",
      metadata: {
        target: "ai",
        pending_amora_action: originalMetadata.pending_amora_action,
        pending_amora_action_carry_count: 1,
      },
      visibility: "shared",
      created_at: new Date(ISSUED_AT + 2_000).toISOString(),
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

/** 대기열 카드의 "이 항목 건너뛰기". 보이는 글자로 찾는다 — 없으면 undefined. */
function skipButton(section: HTMLElement): HTMLButtonElement | undefined {
  return [...section.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === QUEUED_CARD_SKIP_LABEL);
}

/** 화면에서만 치우는 버튼. 서버에는 아무것도 가지 않는다. */
function hideButton(section: HTMLElement): HTMLButtonElement {
  const button = [...section.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.getAttribute("aria-label") === "지금은 적용하지 않기");
  expect(button, "치우기 버튼이 없다").not.toBeUndefined();
  return button!;
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
    await renderMessages(surface, messagesWithCarryCount(carryCount));
    return cardSection(container);
  }

  async function renderMessages(
    surface: "content" | "panel",
    messages: ChatMessage[],
  ): Promise<void> {
    mocks.messages = messages;
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

  it("최신 답변으로 옮겨진 카드는 두 표면 모두 원래 자리에서 그 카드를 가리키고 버튼을 거둔다", async () => {
    const oldCards: string[] = [];
    for (const surface of ["content", "panel"] as const) {
      await renderMessages(surface, messagesWithCardMovedToLatestReply());
      const sections = container.querySelectorAll<HTMLElement>(
        "section[data-pending-action-carried]",
      );
      expect(sections, surface).toHaveLength(2);
      const [oldCard, latestCard] = sections;

      expect(oldCard.dataset.pendingActionContinued, surface).toBe("true");
      expect(oldCard.textContent, surface).toContain(CONTINUED_PENDING_ACTION_COPY);
      expect(oldCard.textContent, surface).not.toContain("적용할 수 없어요");
      expect(oldCard.querySelectorAll("button"), surface).toHaveLength(0);

      // 누를 곳은 최신 답변의 카드 한 군데다.
      expect(latestCard.dataset.pendingActionContinued, surface).toBeUndefined();
      expect(latestCard.dataset.pendingActionCarried, surface).toBe("true");
      expect(latestCard.textContent, surface).not.toContain(CONTINUED_PENDING_ACTION_COPY);
      expect(
        latestCard.querySelector('button[aria-label="변경 내용 확인하기"]'),
        surface,
      ).not.toBeNull();

      oldCards.push(oldCard.outerHTML);
      await resetRoot();
    }
    expect(oldCards[1]).toBe(oldCards[0]);
  });

  it("이월 값이 없으면 두 표면 모두 라벨을 붙이지 않는다", async () => {
    for (const surface of ["content", "panel"] as const) {
      const section = await renderSurface(surface, 0);
      expect(section.dataset.pendingActionCarried, surface).toBe("false");
      expect(section.textContent, surface).not.toContain(CARRIED_PENDING_ACTION_LABEL);
      await resetRoot();
    }
  });

  /**
   * 2026-09-18: 건너뛰기는 전체 화면에만 있었다. 옆 패널에서 대기열 카드를 만난 사람에게는
   * 그 항목을 적용하는 것 말고 다음으로 갈 길이 없고, 남은 요청은 이월 상한에서 말없이
   * 사라진다 — 같은 카드가 어느 화면에서 열렸는지에 따라 길이 있거나 없었다.
   */
  it("대기열 카드는 두 표면 모두 건너뛰기 버튼을 내고, 카드가 같다", async () => {
    const cards: string[] = [];
    for (const surface of ["content", "panel"] as const) {
      await renderMessages(surface, messagesWithQueuedCard());
      const section = cardSection(container);
      const skip = skipButton(section);
      expect(skip, surface).not.toBeUndefined();
      // 보이는 글자와 접근성 이름이 같다(WCAG 2.5.3).
      expect(skip!.getAttribute("aria-label"), surface).toBe(skip!.textContent?.trim());
      expect(skip!.disabled, surface).toBe(false);
      cards.push(section.outerHTML);
      await resetRoot();
    }
    expect(cards[1]).toBe(cards[0]);
  });

  it("대기열이 아닌 카드에는 두 표면 모두 건너뛰기 버튼이 없다", async () => {
    for (const surface of ["content", "panel"] as const) {
      const section = await renderSurface(surface, 0);
      expect(skipButton(section), surface).toBeUndefined();
      await resetRoot();
    }
  });

  it("건너뛰기를 누르면 두 표면 모두 고정 문장만 보낸다 — 확인 id 는 보내지 않는다", async () => {
    for (const surface of ["content", "panel"] as const) {
      mocks.sendMessage.mockClear();
      await renderMessages(surface, messagesWithQueuedCard());
      await act(async () => skipButton(cardSection(container))!.click());

      expect(mocks.sendMessage, surface).toHaveBeenCalledOnce();
      const payload = mocks.sendMessage.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.content, surface).toBe(AMORA_QUEUED_CARD_SKIP_TEXT);
      expect(payload.target, surface).toBe("ai");
      expect(payload.visibility, surface).toBe("shared");
      // 건너뛰기는 적용이 아니다. 확인 id 가 함께 가면 서버에서 확인이 이긴다.
      expect(payload, surface).not.toHaveProperty("confirmedActionId");
      await resetRoot();
    }
  });

  /**
   * 2026-09-18: 옆 패널은 치운 카드를 `actionId` 로 기억했다. 서버가 같은 제안을 새 답변에
   * 다시 붙여도(route.ts 의 캐리포워드) 계속 숨겨, 한 번 치우면 그 대기열은 이 화면에서
   * 영영 확인할 수 없었다. 앱이 같은 병으로 고쳐졌고(2026-09-18), 전체 화면은 누른 순간의
   * **메시지 id** 로 기억한다.
   */
  it("치운 카드가 새 답변으로 다시 오면 두 표면 모두 다시 확인할 수 있다", async () => {
    for (const surface of ["content", "panel"] as const) {
      await renderMessages(surface, messagesWithQueuedCard());
      await act(async () => hideButton(cardSection(container)).click());
      expect(
        container.querySelector("section[data-pending-action-carried]"),
        surface,
      ).toBeNull();

      await renderMessages(surface, messagesWithCardMovedToLatestReply());
      const sections = container.querySelectorAll<HTMLElement>(
        "section[data-pending-action-carried]",
      );
      // 치운 답변(`ai-msg-1`)만 숨고, 옮겨온 답변(`ai-msg-2`)의 카드는 누를 수 있다.
      expect(sections, surface).toHaveLength(1);
      expect(
        sections[0].querySelector('button[aria-label="변경 내용 확인하기"]'),
        surface,
      ).not.toBeNull();
      await resetRoot();
    }
  });
});
