import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatContent from "./ChatContent";
import type { ChatMessage } from "@/types/database.types";
import {
  DEMO_AMORA_PREFILL_STORAGE_KEY,
  rememberDemoAmoraPrefill,
} from "@/lib/chat/demoHandoff";

const HANDOFF_ID = "0f75ca2a-94c1-4d9c-83e3-a45981c98673";
const OTHER_HANDOFF_ID = "ed7eb66a-f86d-45e9-a8bb-9db39c3a9c17";

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
  queryScope: null as string | null,
  startHereHandoffId: null as string | null,
  isDemo: false,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const params = new URLSearchParams();
    if (mocks.queryPrefill) params.set("prefill", mocks.queryPrefill);
    if (mocks.queryScope) params.set("scope", mocks.queryScope);
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

describe("ChatContent composer draft lanes", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
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
    mocks.queryScope = null;
    mocks.startHereHandoffId = null;
    mocks.isDemo = false;
    mocks.sendMessage.mockResolvedValue({
      userMessage: "ephemeral_demo",
      userMessageId: "demo-user-message",
    });
    window.sessionStorage.clear();
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    HTMLElement.prototype.scrollIntoView = vi.fn();

    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("keeps all three valid delivery-lane drafts separate and restores each one", async () => {
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    const typeIntoComposer = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(composer(), value);
        composer()?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await typeIntoComposer("함께 아모라 초안");
    await act(async () => findButton("상대방에게")?.click());
    expect(composer()?.value).toBe("");

    await typeIntoComposer("함께 상대방 초안");
    await act(async () => findButton("나만 (상담)")?.click());
    expect(composer()?.value).toBe("");

    await typeIntoComposer("나만 아모라 초안");
    await act(async () => findButton("함께 대화")?.click());
    expect(composer()?.value).toBe("함께 아모라 초안");

    await act(async () => findButton("상대방에게")?.click());
    expect(composer()?.value).toBe("함께 상대방 초안");

    await act(async () => findButton("나만 (상담)")?.click());
    expect(composer()?.value).toBe("나만 아모라 초안");
  });

  it("keeps the login-free demo in shared mode and labels the account-only private scope", async () => {
    await act(async () => root.unmount());
    container.remove();
    mocks.isDemo = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    const privateScope = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    expect(privateScope?.disabled).toBe(true);
    expect(privateScope?.title).toContain("계정 이용 시");
    expect(container.textContent).toContain("체험용 함께 대화");
    expect(container.textContent).toContain("계정의 준비 기록에 남지 않아요");
    expect(container.textContent).not.toContain("서비스에 저장되며 상대방에게는 보이지 않아요");
  });

  it("opens an explicit private-scope link without sending and preserves the user's later scope choice", async () => {
    mocks.queryScope = "private";
    await act(async () => root.render(<ChatContent />));
    expect(container.textContent).toContain("서비스에 저장되며 상대방에게는 보이지 않아요");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    const shared = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("함께 대화"));
    await act(async () => shared?.click());
    await act(async () => root.render(<ChatContent />));
    expect(shared?.getAttribute("aria-pressed")).toBe("true");
  });

  it.each(["demo", "missing-role"])("does not enter private through a URL with %s", async (kind) => {
    mocks.queryScope = "private";
    mocks.isDemo = kind === "demo";
    if (kind === "missing-role") mocks.profileRole = null;
    await act(async () => root.render(<ChatContent />));
    const privateScope = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    expect(privateScope?.getAttribute("aria-pressed")).toBe("false");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("never offers an Amora reply suggestion while the recipient is the partner", async () => {
    mocks.suggestions = ["일정부터 정리할게요"];
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    expect(findButton("일정부터 정리할게요")).toBeDefined();

    await act(async () => findButton("상대방에게")?.click());

    expect(findButton("일정부터 정리할게요")).toBeUndefined();
  });

  it("keeps a delayed file read in the delivery lane where selection started", async () => {
    const pendingReaders: FileReader[] = [];
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      pendingReaders.push(this);
    });
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["contract"], "amora-contract.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });

    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(pendingReaders).toHaveLength(1);

    await act(async () => findButton("상대방에게")?.click());
    await act(async () => {
      Object.defineProperty(pendingReaders[0], "result", {
        configurable: true,
        value: "data:application/pdf;base64,Y29udHJhY3Q=",
      });
      pendingReaders[0].onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });

    expect(container.textContent).not.toContain("amora-contract.pdf");
    await act(async () => findButton("아모라에게")?.click());
    expect(container.textContent).toContain("amora-contract.pdf");
  });

  it("announces the active privacy scope, recipient, and composer actions", async () => {
    expect(container.querySelector('[role="group"][aria-label="대화 공개 범위"]')).not.toBeNull();
    expect(container.querySelector('[role="group"][aria-label="메시지 받을 대상"]')).not.toBeNull();
    expect(container.querySelector('textarea[aria-label="함께 보는 아모라 메시지 입력"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="파일 첨부"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="함께 보는 아모라 메시지 보내기"]')).not.toBeNull();

    const partnerButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("상대방에게"));
    await act(async () => partnerButton?.click());

    expect(partnerButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('textarea[aria-label="상대방에게 보낼 메시지 입력"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="상대방에게 메시지 보내기"]')).not.toBeNull();
  });

  it("sends only the active lane payload and preserves drafts in the other lanes", async () => {
    mocks.sendMessage.mockResolvedValue(undefined);
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (
      this: FileReader,
      file: Blob,
    ) {
      Object.defineProperty(this, "result", {
        configurable: true,
        value: `data:${file.type};base64,YXR0YWNobWVudA==`,
      });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    const typeIntoComposer = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(composer(), value);
        composer()?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const attach = async (fileName: string, mediaType = "application/pdf") => {
      const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
      const file = new File([fileName], fileName, { type: mediaType });
      Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
      await act(async () => {
        fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    await typeIntoComposer("아모라용 보존 초안");
    await attach("amora-only.pdf");
    await act(async () => findButton("상대방에게")?.click());
    expect(container.textContent).not.toContain("amora-only.pdf");

    await typeIntoComposer("상대방에게 보낼 내용");
    await attach("partner-only.png", "image/png");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="상대방에게 메시지 보내기"]',
      )?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "상대방에게 보낼 내용",
      target: "partner",
      visibility: "shared",
      images: [expect.objectContaining({ fileName: "partner-only.png" })],
    }));
    expect(composer()?.value).toBe("");

    await act(async () => findButton("아모라에게")?.click());
    expect(composer()?.value).toBe("아모라용 보존 초안");
    expect(container.textContent).toContain("amora-only.pdf");

    await act(async () => findButton("나만 (상담)")?.click());
    await typeIntoComposer("나만 상담할 내용");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="나만의 아모라 상담 메시지 보내기"]',
      )?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "나만 상담할 내용",
      target: "ai",
      visibility: "bride_private",
    }));
    await act(async () => findButton("함께 대화")?.click());
    expect(composer()?.value).toBe("아모라용 보존 초안");
    expect(container.textContent).toContain("amora-only.pdf");
  });

  it("moves a non-immediate relationship safety disclosure to private before sending", async () => {
    mocks.sendMessage.mockResolvedValueOnce({
      userMessage: "persisted",
      userMessageId: "private-safety-message",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
    });
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(
        composer(),
        "작년에 신랑이 칼 들고 죽인다고 했는데 지금은 안전해",
      );
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="함께 보는 아모라 메시지 보내기"]',
      )?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      target: "ai",
      visibility: "bride_private",
      images: undefined,
    }));
    expect(container.querySelector(
      'textarea[aria-label="나만의 아모라 상담 메시지 입력"]',
    )).not.toBeNull();
    expect(mocks.notifyTyping).not.toHaveBeenCalled();
  });

  it("fails closed when an authenticated profile has no verified couple role", async () => {
    mocks.profileRole = null;
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    const privateScopeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    expect(privateScopeButton?.disabled).toBe(true);

    await act(async () => privateScopeButton?.click());
    expect(privateScopeButton?.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('textarea[aria-label="함께 보는 아모라 메시지 입력"]')).not.toBeNull();

    const composer = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer, "역할을 확인할 수 없는 메시지");
      composer?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="함께 보는 아모라 메시지 보내기"]',
    );
    expect(sendButton?.disabled).toBe(true);
    await act(async () => sendButton?.click());
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  // 온보딩 직후 진입은 authStore 가 마운트 뒤에 하이드레이션된다.
  // 그 순간 composerIdentity 가 바뀌면서 모든 초안을 비우는데,
  // 방금 넘겨받은 초안까지 지워졌다 — 실제로 운영에서 당했다.
  it("신원이 늦게 확정돼도 온보딩 초안은 살아있다", async () => {
    mocks.queryPrefill = "신혼집부터 먼저 정리하고 싶어요.";
    mocks.profileId = "anonymous";
    mocks.coupleId = "no-couple";

    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    expect(composer()?.value).toBe("신혼집부터 먼저 정리하고 싶어요.");

    // authStore 가 늦게 하이드레이션된 상황
    mocks.profileId = "user-1";
    mocks.coupleId = "couple-1";
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    expect(composer()?.value).toBe("신혼집부터 먼저 정리하고 싶어요.");
  });

  it("places an incoming prefill only in the shared Amora lane", async () => {
    mocks.queryPrefill = "이어 온 아모라 질문";
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    expect(composer()?.value).toBe("이어 온 아모라 질문");

    await act(async () => findButton("상대방에게")?.click());
    expect(composer()?.value).toBe("");

    await act(async () => findButton("나만 (상담)")?.click());
    expect(composer()?.value).toBe("");

    await act(async () => findButton("함께 대화")?.click());
    expect(composer()?.value).toBe("이어 온 아모라 질문");
    expect(mocks.replace).toHaveBeenCalledWith(window.location.pathname, { scroll: false });
  });

  it("restores a signup handoff from the same browser and removes it after applying", async () => {
    mocks.startHereHandoffId = HANDOFF_ID;
    rememberDemoAmoraPrefill(
      window.localStorage,
      "가입 전에 고른 첫 질문",
      HANDOFF_ID,
    );

    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "가입 전에 고른 첫 질문",
    );
    expect(window.localStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith(window.location.pathname, { scroll: false });
  });

  it("prefers the current-tab handoff and clears an older browser handoff", async () => {
    rememberDemoAmoraPrefill(window.sessionStorage, "현재 탭 질문");
    rememberDemoAmoraPrefill(window.localStorage, "이전 가입 질문", HANDOFF_ID);

    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "현재 탭 질문",
    );
    expect(window.sessionStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();
  });

  it("does not expose a browser signup draft on an unrelated chat entry", async () => {
    rememberDemoAmoraPrefill(window.localStorage, "다른 방문자의 질문", HANDOFF_ID);

    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(window.localStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();
  });

  it("rejects and purges a signup draft when the redirect nonce does not match", async () => {
    mocks.startHereHandoffId = OTHER_HANDOFF_ID;
    rememberDemoAmoraPrefill(
      window.localStorage,
      "다른 방문자의 질문",
      HANDOFF_ID,
    );

    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(window.localStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith(window.location.pathname, { scroll: false });
  });

  it("restores text and attachments to the original lane when persistence fails", async () => {
    mocks.sendMessage.mockResolvedValueOnce({
      userMessage: "not_persisted",
      reason: "database",
    });
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (
      this: FileReader,
      file: Blob,
    ) {
      Object.defineProperty(this, "result", {
        configurable: true,
        value: `data:${file.type};base64,cmVzdG9yZQ==`,
      });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer(), "사라지면 안 되는 질문");
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["restore"], "restore-me.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="함께 보는 아모라 메시지 보내기"]',
      )?.click();
      await Promise.resolve();
    });

    expect(composer()?.value).toBe("사라지면 안 되는 질문");
    expect(container.textContent).toContain("restore-me.pdf");
  });

  it("does not consume a typed draft when sending a separate Amora suggestion", async () => {
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer(), "직접 쓰던 긴 초안");
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.suggestions = ["추천 문장만 보내기"];
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });
    const suggestion = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("추천 문장만 보내기"));

    await act(async () => {
      suggestion?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "추천 문장만 보내기",
      images: undefined,
    }));
    expect(composer()?.value).toBe("직접 쓰던 긴 초안");
  });

  it("reuses the same idempotency key after an unknown persistence result", async () => {
    const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mocks.sendMessage
      .mockResolvedValueOnce({ userMessage: "persistence_unknown", clientRequestId: requestId })
      .mockResolvedValueOnce({ userMessage: "persisted", userMessageId: "user-message-1" });
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer(), "결과가 불명확하면 같은 키로 확인해줘");
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = () => container.querySelector<HTMLButtonElement>(
      'button[aria-label="함께 보는 아모라 메시지 보내기"]',
    );

    await act(async () => {
      send()?.click();
      await Promise.resolve();
    });
    expect(composer()?.value).toBe("결과가 불명확하면 같은 키로 확인해줘");

    await act(async () => {
      send()?.click();
      await Promise.resolve();
    });
    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      clientRequestId: requestId,
    }));
    expect(composer()?.value).toBe("");
  });

  it("drops an unknown-send retry key when the restored draft is edited", async () => {
    const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    mocks.sendMessage
      .mockResolvedValueOnce({ userMessage: "persistence_unknown", clientRequestId: requestId })
      .mockResolvedValueOnce({ userMessage: "persisted", userMessageId: "user-message-3" });
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    const typeIntoComposer = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(composer(), value);
        composer()?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const send = () => container.querySelector<HTMLButtonElement>(
      'button[aria-label="함께 보는 아모라 메시지 보내기"]',
    );

    await typeIntoComposer("원래 초안");
    await act(async () => {
      send()?.click();
      await Promise.resolve();
    });
    await typeIntoComposer("사용자가 고친 새 초안");
    await act(async () => {
      send()?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "사용자가 고친 새 초안",
    }));
    expect(mocks.sendMessage).not.toHaveBeenLastCalledWith(expect.objectContaining({
      clientRequestId: requestId,
    }));
  });

  it("blocks the active lane send until every selected file snapshot has finished", async () => {
    const pendingReaders: FileReader[] = [];
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      pendingReaders.push(this);
    });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["pending"], "pending.pdf", { type: "application/pdf" });
    const composer = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer, "파일과 함께 보낼 질문");
      composer?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });

    await act(async () => fileInput?.dispatchEvent(new Event("change", { bubbles: true })));
    const send = () => container.querySelector<HTMLButtonElement>(
      'button[aria-label="함께 보는 아모라 메시지 보내기"]',
    );
    expect(send()?.disabled).toBe(true);
    send()?.click();
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      Object.defineProperty(pendingReaders[0], "result", {
        configurable: true,
        value: "data:application/pdf;base64,cGVuZGluZw==",
      });
      pendingReaders[0].onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });
    expect(send()?.disabled).toBe(false);
  });

  it("admits only one component submission from the same rendered draft", async () => {
    let finishSend: ((value: { userMessage: "persisted"; userMessageId: string }) => void) | null = null;
    mocks.sendMessage.mockImplementationOnce(() => new Promise((resolve) => {
      finishSend = resolve;
    }));
    const composer = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer, "한 번만 보내기");
      composer?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>(
      'button[aria-label="함께 보는 아모라 메시지 보내기"]',
    );

    await act(async () => {
      send?.click();
      send?.click();
      await Promise.resolve();
    });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishSend?.({ userMessage: "persisted", userMessageId: "message-1" });
      await Promise.resolve();
    });
  });

  it("shows transient artifacts only in the visibility that produced them", async () => {
    mocks.artifactVisibility = "bride_private";
    mocks.error = "비공개 요청 실패";
    mocks.failedRequest = {
      visibility: "bride_private",
      unavailableReason: null,
      canRetry: true,
    };
    mocks.suggestions = ["비공개 추천 문장"];
    mocks.quotaRemaining = 2;
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("비공개 요청 실패");
    expect(container.textContent).not.toContain("비공개 추천 문장");
    expect(container.textContent).not.toContain("2회 남았어요");

    const privateScope = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    await act(async () => privateScope?.click());
    expect(container.textContent).toContain("비공개 요청 실패");
    expect(container.textContent).toContain("비공개 추천 문장");
    expect(container.textContent).toContain("2회 남았어요");

    mocks.isStreaming = true;
    mocks.streamingContent = "비공개 스트리밍";
    mocks.artifactVisibility = "shared";
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("스트리밍 응답 표시");

    mocks.artifactVisibility = "bride_private";
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("스트리밍 응답 표시");
  });

  it("keeps Amora card actions AI-directed through the pre-send confirmation", async () => {
    mocks.messages = [{
      id: "ai-tool-message",
      couple_id: "couple-1",
      sender_id: null,
      sender_role: "ai",
      content: "업체 결과",
      visibility: "shared",
      created_at: new Date().toISOString(),
      metadata: {
        toolResults: [{
          toolName: "search_venues",
          toolInput: {},
          toolOutput: {},
          success: true,
          displayMessage: "업체 결과",
        }],
      },
    }];
    mocks.partnerTyping = {
      sender_role: "groom",
      user_id: "user-2",
      updated_at: Date.now(),
    };
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    await act(async () => findButton("상대방에게")?.click());
    await act(async () => findButton("AI 카드 실행")?.click());
    expect(findButton("그래도 보내기")).toBeDefined();

    await act(async () => {
      findButton("그래도 보내기")?.click();
      await Promise.resolve();
    });
    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "아모라 카드 후속 질문",
      target: "ai",
    }));
  });

  it("broadcasts typing only for an explicit partner draft and never for AI 상담", async () => {
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    const typeIntoComposer = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(composer(), value);
        composer()?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await typeIntoComposer("함께 보는 아모라 입력 중");
    expect(mocks.notifyTyping).not.toHaveBeenCalled();

    const partnerTarget = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("상대방에게"));
    await act(async () => partnerTarget?.click());
    await typeIntoComposer("상대방에게 입력 중");
    expect(mocks.notifyTyping).toHaveBeenCalledTimes(1);

    const privateScope = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    await act(async () => privateScope?.click());
    expect(mocks.stopTyping).toHaveBeenCalledWith({
      coupleId: "couple-1",
      userId: "user-1",
      senderRole: "bride",
    });

    mocks.notifyTyping.mockClear();
    await typeIntoComposer("비공개 입력 중");
    expect(mocks.notifyTyping).not.toHaveBeenCalled();
  });

  it("removes the partner target and discards the old-recipient draft when the verified link disappears", async () => {
    const pendingReaders: FileReader[] = [];
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      pendingReaders.push(this);
    });
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    await act(async () => findButton("상대방에게")?.click());
    const partnerComposer = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="상대방에게 보낼 메시지 입력"]',
    );
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(partnerComposer, "연결 확인 후 보낼 상대방 초안");
      partnerComposer?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const oldRecipientImage = new File(["old"], "old-recipient.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [oldRecipientImage],
    });
    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(pendingReaders).toHaveLength(1);

    mocks.partnerLinked = false;
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });
    expect(findButton("상대방에게")).toBeUndefined();
    expect(container.querySelector('[role="group"][aria-label="메시지 받을 대상"]')).toBeNull();
    expect(container.querySelector('textarea[aria-label="함께 보는 아모라 메시지 입력"]')).not.toBeNull();
    expect(mocks.setChatState).toHaveBeenCalledWith(expect.objectContaining({
      artifactVisibility: "shared",
      error: expect.stringContaining("안전을 위해 삭제"),
    }));
    await act(async () => {
      Object.defineProperty(pendingReaders[0], "result", {
        configurable: true,
        value: "data:image/png;base64,b2xk",
      });
      pendingReaders[0].onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });

    mocks.partnerLinked = true;
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });
    await act(async () => findButton("상대방에게")?.click());
    expect(container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="상대방에게 보낼 메시지 입력"]',
    )?.value).toBe("");
    expect(container.textContent).not.toContain("old-recipient.png");
  });

  it("blocks partner documents and uses a human attachment-only partner message", async () => {
    const readSpy = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (
      this: FileReader,
      file: Blob,
    ) {
      Object.defineProperty(this, "result", {
        configurable: true,
        value: `data:${file.type};base64,aW1hZ2U=`,
      });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    await act(async () => findButton("상대방에게")?.click());
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');

    const documentFile = new File(["contract"], "contract.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [documentFile] });
    await act(async () => fileInput?.dispatchEvent(new Event("change", { bubbles: true })));
    expect(readSpy).not.toHaveBeenCalled();
    expect(mocks.setChatState).toHaveBeenCalledWith(expect.objectContaining({
      artifactVisibility: "shared",
      error: expect.stringContaining("아모라에게만"),
    }));

    const imageFile = new File(["image"], "photo.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [imageFile] });
    await act(async () => fileInput?.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="상대방에게 메시지 보내기"]',
      )?.click();
      await Promise.resolve();
    });
    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "파일을 보냈어요. 확인해줘.",
      target: "partner",
      images: [expect.objectContaining({ fileName: "photo.png" })],
    }));
  });

  it("preserves an unknown retry key across busy, database, and thrown attempts", async () => {
    const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    mocks.sendMessage
      .mockResolvedValueOnce({ userMessage: "persistence_unknown", clientRequestId: requestId })
      .mockResolvedValueOnce({ userMessage: "not_persisted", reason: "busy" })
      .mockResolvedValueOnce({ userMessage: "not_persisted", reason: "database" })
      .mockRejectedValueOnce(new Error("transport failed"))
      .mockResolvedValueOnce({ userMessage: "persisted", userMessageId: "message-final" });
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer(), "같은 요청을 안전하게 확인");
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = () => container.querySelector<HTMLButtonElement>(
      'button[aria-label="함께 보는 아모라 메시지 보내기"]',
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => {
        send()?.click();
        await Promise.resolve();
      });
    }
    expect(mocks.sendMessage).toHaveBeenCalledTimes(5);
    for (const call of mocks.sendMessage.mock.calls.slice(1)) {
      expect(call[0]).toEqual(expect.objectContaining({ clientRequestId: requestId }));
    }
  });

  it("resets every composer lane and retry key when the authenticated identity changes", async () => {
    const requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    mocks.sendMessage
      .mockResolvedValueOnce({ userMessage: "persistence_unknown", clientRequestId: requestId })
      .mockResolvedValueOnce({ userMessage: "persisted", userMessageId: "new-couple-message" });
    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    const typeIntoComposer = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(composer(), value);
        composer()?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await typeIntoComposer("이전 커플 초안");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="함께 보는 아모라 메시지 보내기"]',
      )?.click();
      await Promise.resolve();
    });
    expect(composer()?.value).toBe("이전 커플 초안");

    mocks.coupleId = "couple-2";
    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });
    expect(composer()?.value).toBe("");

    await typeIntoComposer("새 커플 초안");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="함께 보는 아모라 메시지 보내기"]',
      )?.click();
      await Promise.resolve();
    });
    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "새 커플 초안",
      coupleId: "couple-2",
    }));
    expect(mocks.sendMessage).not.toHaveBeenLastCalledWith(expect.objectContaining({
      clientRequestId: requestId,
    }));
  });
});
