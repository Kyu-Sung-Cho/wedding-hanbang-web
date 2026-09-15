import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatContent from "./ChatContent";
import type { ChatMessage } from "@/types/database.types";

/**
 * 말풍선 색 안내 한 줄 — 2026-09-15.
 *
 * 말풍선 색은 본인이 설정에서 고른 역할(confirmed_role)로만 정한다. 고르기 전에는 두
 * 사람이 같은 중립색이라 누가 말했는지 색으로 구분되지 않는다. 가입 순서로 추측하지
 * 않고, 고르지 않은 사람에게만 바꾸는 곳을 조용히 알려준다.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  setChatState: vi.fn(),
  messages: [] as ChatMessage[],
  profileId: "user-1",
  confirmedRole: null as "bride" | "groom" | null,
  hasPartner: true,
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
      role: "bride",
      confirmed_role: mocks.confirmedRole,
      name: "테스트",
      couple_id: "couple-1",
    },
    couple: { id: "couple-1", bride_id: mocks.profileId, groom_id: "user-2" },
    partner: mocks.hasPartner ? { id: "user-2", name: null, confirmed_role: null, avatar_url: null } : null,
    journey: null,
    isDemo: mocks.isDemo,
    isInitialized: true,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useAmoraPersonalization", () => ({
  useAmoraPersonalization: () => ({ profile: null, status: "ready", saving: false, error: null, save: vi.fn() }),
}));

vi.mock("@/stores/chatStore", () => {
  const noop = vi.fn();
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
    loadMessages: noop,
    sendMessage: noop,
    requestInitialGreeting: noop,
    requestMediation: noop,
    clearMessages: noop,
    subscribeToMessages: vi.fn(() => vi.fn()),
    pollNewMessages: noop,
    notifyTyping: noop,
    stopTyping: noop,
    requestSharedClear: noop,
    retryFailedMessage: noop,
    dismissFailedMessageRetry: noop,
  };
  const useChatStore = Object.assign(() => state, { getState: () => state, setState: mocks.setChatState });
  return { useChatStore };
});

vi.mock("./ChatBubble", () => ({ default: () => <div /> }));
vi.mock("./ActionCard", () => ({ default: () => <div /> }));
vi.mock("./VendorToolCard", () => ({ default: () => <div />, VENDOR_TOOL_NAMES: new Set<string>(["search_venues"]) }));
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
vi.mock("@/lib/care/requestProactiveCare", () => ({ requestProactiveCare: vi.fn() }));

const HINT = "설정에서 나의 역할을 신랑·신부로 고르면 내 말풍선이 색으로 구분돼요";

describe("말풍선 색 안내", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messages = [];
    mocks.profileId = "user-1";
    mocks.confirmedRole = null;
    mocks.hasPartner = true;
    mocks.isDemo = false;
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response));
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
    await act(async () => {
      await Promise.resolve();
    });
  }

  const hint = () => container.querySelector('[data-testid="chat-role-color-hint"]');

  it("역할을 고르지 않았으면 설정의 역할 편집으로 가는 한 줄을 보여준다", async () => {
    await render();

    expect(hint()?.textContent).toContain(HINT);
    const link = hint()?.querySelector("a");
    expect(link?.getAttribute("href")).toContain("/settings#wedding-role");
  });

  it.each(["bride", "groom"] as const)("역할(%s)을 이미 골랐으면 보이지 않는다", async (role) => {
    mocks.confirmedRole = role;
    await render();

    expect(hint()).toBeNull();
  });

  it("상대가 연결되지 않았거나 체험 화면이면 보이지 않는다", async () => {
    mocks.hasPartner = false;
    await render();
    expect(hint()).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.hasPartner = true;
    mocks.isDemo = true;
    await render();
    expect(hint()).toBeNull();
  });

  it("닫으면 사라지고 같은 계정으로 다시 열어도 보이지 않는다", async () => {
    await render();
    const close = hint()?.querySelector<HTMLButtonElement>('button[aria-label="말풍선 색 안내 닫기"]');
    expect(close).toBeTruthy();
    await act(async () => close!.click());
    expect(hint()).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(hint()).toBeNull();

    // 다른 계정에는 닫은 기록이 옮겨가지 않는다.
    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.profileId = "user-3";
    await render();
    expect(hint()?.textContent).toContain(HINT);
  });

  it("브라우저 저장이 막혀 있어도 화면은 그려지고 닫기는 이번 화면에서 동작한다", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await render();

    expect(hint()?.textContent).toContain(HINT);
    await act(async () => hint()!.querySelector<HTMLButtonElement>("button")!.click());
    expect(hint()).toBeNull();
  });
});
