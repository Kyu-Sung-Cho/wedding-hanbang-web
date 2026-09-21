import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatContent from "./ChatContent";
import { resetChatComposerSession } from "@/stores/chatComposerStore";
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
  linkedPartnerId: "user-2" as string | null,
  isDemo: false,
  sharedClearedAt: null as string | null,
  privateClearedAt: null as string | null,
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
      groom_id: mocks.linkedPartnerId,
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
    get sharedClearedAt() { return mocks.sharedClearedAt; },
    get privateClearedAt() { return mocks.privateClearedAt; },
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
const memoryResponse = (enabled: boolean) => new Response(JSON.stringify({
  runtimeEnabled: true, settings: [{ visibility: "shared", enabled }],
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe("채팅 상단에서 기억 상태를 읽는다", () => {
  let root: Root;
  let container: HTMLDivElement;

  function answerMemoryWith(
    answer:
      | { kind: "ok"; settings: MemorySettingRow[]; runtimeEnabled?: boolean }
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
        json: async () => ({ runtimeEnabled: answer.runtimeEnabled ?? true, settings: answer.settings, memories: [], profiles: [] }),
      } as unknown as Response;
    }));
  }

  beforeEach(() => {
    resetChatComposerSession();
    vi.clearAllMocks();
    mocks.messages = [];
    mocks.profileRole = "bride";
    mocks.profileId = "user-1";
    mocks.coupleId = "couple-1";
    mocks.linkedPartnerId = "user-2";
    mocks.isDemo = false;
    mocks.sharedClearedAt = null;
    mocks.privateClearedAt = null;
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

  it("켜져 있으면 모든 대화의 저장을 보장하지 않고 유효한 기억 사용 상태만 말한다", async () => {
    answerMemoryWith({
      kind: "ok",
      settings: [
        { visibility: "shared", enabled: true },
        { visibility: "bride_private", enabled: true },
      ],
    });
    await render();

    expect(statusNode()?.textContent).toBe("이 탭의 장기 기억 사용이 켜져 있어요");
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

  it("동의가 켜져 있어도 서버 런타임이 중지되면 기억 중이라고 약속하지 않는다", async () => {
    answerMemoryWith({
      kind: "ok",
      runtimeEnabled: false,
      settings: [{ visibility: "shared", enabled: true }],
    });
    await render();

    expect(statusNode()?.textContent).toBe("지금은 장기 기억 기능이 중지되어 있어요 · 설정에서 확인");
    expect(statusNode()?.querySelector("a")?.getAttribute("href")).toContain("/settings/amora-memory");
  });

  it("비공개 삭제 커서가 바뀌면 서버에서 꺼진 기억 상태를 다시 읽는다", async () => {
    answerMemoryWith({ kind: "ok", settings: [{ visibility: "bride_private", enabled: true }] });
    await render();
    const privateTab = Array.from(container.querySelectorAll("button"))
      .find(button => button.textContent?.includes("나만"));
    await act(async () => { privateTab!.click(); });
    expect(statusNode()?.textContent).toBe("이 탭의 장기 기억 사용이 켜져 있어요");

    answerMemoryWith({ kind: "ok", settings: [{ visibility: "bride_private", enabled: false }] });
    mocks.privateClearedAt = "2026-09-20T00:00:00.000Z";
    await render();

    expect(statusNode()?.textContent).toBe("지금은 장기 기억을 저장하지 않아요 · 설정에서 켜기");
  });

  it("같은 커플의 계정이 바뀌고 조회가 실패하면 이전 계정의 기억 상태를 남기지 않는다", async () => {
    answerMemoryWith({ kind: "ok", settings: [{ visibility: "shared", enabled: true }] });
    await render();
    expect(statusNode()).not.toBeNull();

    mocks.profileId = "user-3";
    answerMemoryWith({ kind: "error" });
    await render();

    expect(statusNode()).toBeNull();
  });

  it("같은 계정으로 돌아와도 이전 인증 세대의 기억 상태를 다시 사용하지 않는다", async () => {
    answerMemoryWith({ kind: "ok", settings: [{ visibility: "shared", enabled: true }] });
    await render();
    expect(statusNode()).not.toBeNull();

    answerMemoryWith({ kind: "error" });
    await act(async () => { resetChatComposerSession(); });
    await render();

    expect(statusNode()).toBeNull();
  });

  it("연결된 파트너 구성이 바뀌면 이전 구성의 기억 상태를 재사용하지 않는다", async () => {
    mocks.linkedPartnerId = null;
    answerMemoryWith({ kind: "ok", settings: [{ visibility: "shared", enabled: false }] });
    await render();
    expect(statusNode()).not.toBeNull();

    mocks.linkedPartnerId = "user-3";
    answerMemoryWith({ kind: "error" });
    await render();

    expect(statusNode()).toBeNull();
  });

  it("설정 확인 후 창으로 돌아오면 서버에서 현재 동의를 다시 읽는다", async () => {
    answerMemoryWith({ kind: "ok", settings: [{ visibility: "shared", enabled: true }] });
    await render();
    expect(statusNode()).not.toBeNull();

    answerMemoryWith({ kind: "ok", settings: [{ visibility: "shared", enabled: false }] });
    await act(async () => { window.dispatchEvent(new Event("focus")); });

    expect(statusNode()?.textContent).toBe("지금은 장기 기억을 저장하지 않아요 · 설정에서 켜기");
  });

  it.each([undefined, null, "true", 1])("런타임 값 %j를 확인하지 못하면 켜짐을 추정하지 않는다", async runtimeEnabled => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      runtimeEnabled, settings: [{ visibility: "shared", enabled: true }],
    }))));
    await render();
    expect(statusNode()).toBeNull();
  });

  it("확인된 삭제 뒤 재조회가 실패하면 이전 켜짐을 남기지 않는다", async () => {
    answerMemoryWith({ kind: "ok", settings: [{ visibility: "shared", enabled: true }] });
    await render();
    answerMemoryWith({ kind: "error" });
    mocks.sharedClearedAt = "2026-09-20T00:00:00.000Z";
    await render();
    expect(statusNode()).toBeNull();
  });

  it("원문 삭제 없는 화면 정리 뒤에는 서버의 켜짐을 임의로 끄지 않는다", async () => {
    answerMemoryWith({ kind: "ok", settings: [{ visibility: "shared", enabled: true }] });
    await render();
    mocks.sharedClearedAt = "2026-09-20T00:00:00.000Z";
    await render();
    expect(statusNode()?.textContent).toBe("이 탭의 장기 기억 사용이 켜져 있어요");
  });

  it("새 계정 조회가 끝난 뒤 도착한 이전 계정의 응답을 무시한다", async () => {
    const oldResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementation(async () => memoryResponse(false)));
    await render();
    expect(statusNode()).toBeNull();
    mocks.profileId = "user-3";
    await render();
    expect(statusNode()?.textContent).toBe("지금은 장기 기억을 저장하지 않아요 · 설정에서 켜기");

    await act(async () => { oldResponse.resolve(memoryResponse(true)); });
    expect(statusNode()?.textContent).toBe("지금은 장기 기억을 저장하지 않아요 · 설정에서 켜기");
  });

  it("같은 계정의 재조회가 뒤집혀 도착해도 최신 결과만 표시한다", async () => {
    answerMemoryWith({ kind: "ok", settings: [{ visibility: "shared", enabled: true }] });
    await render();
    const oldResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementation(async () => memoryResponse(false)));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(statusNode()).toBeNull();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(statusNode()?.textContent).toBe("지금은 장기 기억을 저장하지 않아요 · 설정에서 켜기");

    await act(async () => { oldResponse.resolve(memoryResponse(true)); });
    expect(statusNode()?.textContent).toBe("지금은 장기 기억을 저장하지 않아요 · 설정에서 켜기");
  });

  it("데모로 바뀌면 실제 계정의 기억 상태를 숨긴다", async () => {
    answerMemoryWith({ kind: "ok", settings: [{ visibility: "shared", enabled: true }] });
    await render();
    mocks.isDemo = true;
    await render();
    expect(statusNode()).toBeNull();
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
    expect(statusNode()?.textContent).toBe("이 탭의 장기 기억 사용이 켜져 있어요");

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
