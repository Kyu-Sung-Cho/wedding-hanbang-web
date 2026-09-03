import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatContent from "./ChatContent";
import type { ChatMessage } from "@/types/database.types";

/**
 * 채팅 상단 기억 상태 한 줄 — 같은 입력에 같은 결과.
 *
 * 2026-09-03: 켜짐·꺼짐·못 읽음 세 가지 응답을 실제로 돌려주고 화면에 나오는 글자를
 * 대조한다. 소스에 문자열이 있는지 묻지 않는다 — 있는 문자열이 화면에 안 나올 수 있고,
 * 반대로 조건이 뒤집혀도 문자열은 그대로 있다.
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
  profileRole: "bride" as "bride" | "groom" | null,
  profileId: "user-1",
  coupleId: "couple-1",
  isDemo: false,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
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
      groom_id: "user-2",
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
  default: () => <div />,
  VENDOR_TOOL_NAMES: new Set<string>(["search_venues"]),
}));
vi.mock("./SuggestionButtons", () => ({ default: () => <div /> }));
vi.mock("./StreamingBubble", () => ({ default: () => <div /> }));
vi.mock("./ChatInfoPanel", () => ({ default: () => <div /> }));
vi.mock("./MediationConsentDialog", () => ({ default: () => <div /> }));
vi.mock("./AmoraPersonalizationPrompt", () => ({
  AmoraPersonalizationConfirmation: () => <div />,
  AmoraQuickStart: () => <div />,
}));
vi.mock("./PendingAmoraActionCard", () => ({
  default: () => <div />,
  getPendingAmoraAction: () => null,
  getPendingAmoraBudgetImpactPreview: () => null,
  isPendingAmoraActionExpired: () => false,
}));
vi.mock("@/lib/care/requestProactiveCare", () => ({
  requestProactiveCare: vi.fn(),
}));

type MemorySettingRow = { visibility: string; enabled: boolean };

describe("채팅 상단에서 기억 상태를 읽는다", () => {
  let root: Root;
  let container: HTMLDivElement;

  function answerMemoryWith(
    answer:
      | { kind: "ok"; settings: MemorySettingRow[] }
      | { kind: "error" }
      | { kind: "offline" },
  ) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (!url.includes("/api/amora/memory")) {
        return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      }
      if (answer.kind === "offline") throw new TypeError("Failed to fetch");
      if (answer.kind === "error") {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "기억을 불러오지 못했어요." }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ runtimeEnabled: true, settings: answer.settings, memories: [], profiles: [] }),
      } as unknown as Response;
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messages = [];
    mocks.profileRole = "bride";
    mocks.profileId = "user-1";
    mocks.coupleId = "couple-1";
    mocks.isDemo = false;
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

  async function render() {
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });
    // GET 응답과 그 뒤 setState 까지 흘려보낸다.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const statusNode = () =>
    container.querySelector('[data-testid="amora-memory-status"]');

  it("켜져 있으면 이 탭의 대화가 기억으로 정리된다고 말한다", async () => {
    answerMemoryWith({
      kind: "ok",
      settings: [
        { visibility: "shared", enabled: true },
        { visibility: "bride_private", enabled: true },
      ],
    });
    await render();

    expect(statusNode()?.textContent).toBe("이 탭의 대화는 장기 기억으로 정리돼요");
  });

  it("꺼져 있으면 저장하지 않는다고 말하고 설정으로 가는 길을 준다", async () => {
    answerMemoryWith({
      kind: "ok",
      settings: [
        { visibility: "shared", enabled: false },
        { visibility: "bride_private", enabled: false },
      ],
    });
    await render();

    expect(statusNode()?.textContent).toBe("지금은 장기 기억을 저장하지 않아요 · 설정에서 켜기");
    const link = statusNode()?.querySelector("a");
    expect(link?.getAttribute("href")).toContain("/settings/amora-memory");
  });

  it("응답을 못 읽으면 아무 말도 하지 않는다", async () => {
    answerMemoryWith({ kind: "error" });
    await render();

    expect(statusNode()).toBeNull();
  });

  it("요청 자체가 실패해도 아무 말도 하지 않는다", async () => {
    answerMemoryWith({ kind: "offline" });
    await render();

    expect(statusNode()).toBeNull();
  });

  it("탭마다 그 탭의 기억 범위를 말한다", async () => {
    // 공유 기억은 켜져 있고 나만 상담 기억은 꺼져 있는 커플. 한 줄이 탭을 따라가지
    // 않으면 비공개 탭에서 "정리돼요" 를 읽고 마음 놓고 말하게 된다.
    answerMemoryWith({
      kind: "ok",
      settings: [
        { visibility: "shared", enabled: true },
        { visibility: "bride_private", enabled: false },
      ],
    });
    await render();
    expect(statusNode()?.textContent).toBe("이 탭의 대화는 장기 기억으로 정리돼요");

    const privateTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("나만"));
    expect(privateTab).toBeDefined();
    await act(async () => {
      privateTab!.click();
      await Promise.resolve();
    });

    expect(statusNode()?.textContent).toBe("지금은 장기 기억을 저장하지 않아요 · 설정에서 켜기");
  });
});
