import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { amoraLaneStorageKey } from "@hanbang/shared/amora-lane-choice";

import ChatContent from "./ChatContent";
import { AmoraNavigationTargetContext } from "@/components/app/amora/AmoraNavigationContext";
import type { ChatMessage } from "@/types/database.types";
import { buildWeddingTasteAmoraText, createEmptyWeddingTasteDraft } from "@/lib/weddingCode/taste";
import { prepareWeddingTasteChat, WEDDING_TASTE_CHAT_KEY, WEDDING_TASTE_HANDOFF_TTL_MS } from "@/lib/weddingCode/tasteHandoff";
import { requestProactiveCare } from "@/lib/care/requestProactiveCare";
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
  sharedClearedAt: null as string | null,
  privateClearedAt: null as string | null,
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
  isSending: false,
  streamingContent: "",
  quotaRemaining: null as number | null,
  profileRole: "bride" as "bride" | "groom" | null,
  profileId: "user-1" as string | null,
  coupleId: "couple-1" as string | null,
  partnerLinked: true,
  partnerTyping: null as null | {
    sender_role: "bride" | "groom";
    user_id: string;
    updated_at: number;
  },
  queryPrefill: null as string | null,
  queryScope: null as string | null,
  tasteNonces: [] as string[],
  preparationSources: [] as string[],
  resolvePreparation: vi.fn(),
  startHereHandoffId: null as string | null,
  isDemo: false,
  personalHandoffPending: false,
  takePersonalHandoff: vi.fn(),
}));

vi.mock("@/lib/amora/preparationHandoff", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/amora/preparationHandoff")>(),
  resolveAmoraPreparationSource: mocks.resolvePreparation,
}));

vi.mock("@/lib/amora/personalActionContinuation", () => ({ personalActionContinuation: {
  hasPending: () => mocks.personalHandoffPending,
  take: (...args: unknown[]) => { mocks.personalHandoffPending = false; return mocks.takePersonalHandoff(...args); },
} }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const params = new URLSearchParams();
    if (mocks.queryPrefill) params.set("prefill", mocks.queryPrefill);
    if (mocks.queryScope) params.set("scope", mocks.queryScope);
    mocks.tasteNonces.forEach(nonce => params.append("wcTasteChat", nonce));
    mocks.preparationSources.forEach(source => params.append("amoraSource", source));
    if (mocks.startHereHandoffId) {
      params.set("startHereHandoff", mocks.startHereHandoffId);
    }
    return params;
  },
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(() => ({
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
  }), { getState: () => ({
    user: { id: mocks.profileId }, profile: { id: mocks.profileId, couple_id: mocks.coupleId, role: mocks.profileRole },
    couple: { id: mocks.coupleId, bride_id: mocks.profileRole === "bride" ? mocks.profileId : "user-2", groom_id: mocks.profileRole === "groom" ? mocks.profileId : "user-2" },
    isDemo: mocks.isDemo, isInitialized: true, isLoading: false,
  }) }),
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
    get isStreaming() {
      return mocks.isStreaming;
    },
    get isSending() { return mocks.isSending; },
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
    mocks.personalHandoffPending = false; mocks.takePersonalHandoff.mockReset();
    vi.clearAllMocks();
    mocks.messages = [];
    mocks.sharedClearedAt = null;
    mocks.privateClearedAt = null;
    mocks.requestSharedClear.mockReset().mockResolvedValue({ ok: true });
    mocks.suggestions = [];
    mocks.error = null;
    mocks.failedRequest = null;
    mocks.artifactVisibility = "shared";
    mocks.isStreaming = false;
    mocks.isSending = false;
    mocks.streamingContent = "";
    mocks.quotaRemaining = null;
    mocks.profileRole = "bride";
    mocks.profileId = "user-1";
    mocks.coupleId = "couple-1";
    mocks.partnerLinked = true;
    mocks.partnerTyping = null;
    mocks.queryPrefill = null;
    mocks.queryScope = null;
    mocks.tasteNonces = [];
    mocks.preparationSources = [];
    mocks.resolvePreparation.mockReset().mockResolvedValue({
      text: "결혼식장 · 견적 확인 준비를 도와주세요.",
      sourceLabel: "결혼식장 · 견적 확인",
      sourceHref: "/checklist?category=venue",
    });
    mocks.startHereHandoffId = null;
    mocks.isDemo = false;
    mocks.sendMessage.mockResolvedValue({
      userMessage: "ephemeral_demo",
      userMessageId: "demo-user-message",
    });
    window.sessionStorage.clear();
    window.localStorage.clear();
    // 2026-09-26 부터 처음 여는 사람은 '함께/나만'을 먼저 고른다(`amoraLaneFirstChoice.test.tsx`).
    // 이 파일은 레인별 초안을 재므로, 여기 나오는 계정은 모두 이미 '함께'를 고른 사람이다.
    for (const userId of ["user-1", "other-user", "next-user", "different-user"]) {
      window.localStorage.setItem(amoraLaneStorageKey(userId) as string, "shared");
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollTo = vi.fn();

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

  it("recovers unsent text in its own lane after a remount without sending", async () => {
    const typeText = async (text: string) => act(async () => {
      const textarea = container.querySelector("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, text);
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await typeText("함께 보는 미전송 초안");
    const privateButton = () => Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("나만 (상담)"));
    await act(async () => privateButton()?.click());
    await typeText("나만 보는 미전송 초안");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<ChatContent />));
    await act(async () => privateButton()?.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("나만 보는 미전송 초안");
    const shared = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("함께 대화"));
    await act(async () => shared?.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("함께 보는 미전송 초안");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("does not expose community publishing from a shared answer while discovery is hidden", async () => {
    const base = { couple_id: "couple-1", visibility: "shared" as const, metadata: {}, created_at: new Date().toISOString() };
    mocks.messages = [
      { ...base, id: "human-question", sender_id: "user-1", sender_role: "bride", content: "상견례 대화 주제를 알려줘" },
      { ...base, id: "ai-answer", sender_id: null, sender_role: "ai", content: "가벼운 일상 이야기부터 나눠 보세요." },
    ];
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector('button[aria-label*="커뮤니티에"]')).toBeNull();
  });

  const tasteDraft = () => ({ ...createEmptyWeddingTasteDraft(), mood: { status: "answered" as const, values: ["natural" as const] } });
  const queueTaste = () => {
    const href = prepareWeddingTasteChat(tasteDraft())!.href;
    const params = new URL(href, "https://hanbang.ai").searchParams;
    mocks.queryScope = "private"; mocks.tasteNonces = params.getAll("wcTasteChat");
  };
  const buttonWith = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes(label))!;
  const history = (visibility: ChatMessage["visibility"], count = 200): ChatMessage[] => Array.from({ length: count }, (_, index) => ({
    id: `${visibility}-${index}`, couple_id: mocks.coupleId!, sender_id: mocks.profileId,
    sender_role: "bride", content: `이전 상담 ${index}`, visibility,
    created_at: "2026-09-10T00:00:00.000Z", metadata: {},
  }));
  const renderAndSettle = async () => {
    await act(async () => root.render(<ChatContent />));
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 10)); });
  };
  it("keeps the chosen private scope in the URL and follows back navigation without sending drafts", async () => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", "/wedding/chat?scope=shared&keep=1#anchor");
    try {
      mocks.queryScope = "shared";
      await renderAndSettle();
      await act(async () => buttonWith("나만 (상담)").click());
      expect(mocks.push).toHaveBeenCalledWith("/wedding/chat?scope=private&keep=1#anchor", { scroll: false });
      mocks.queryScope = "private";
      await renderAndSettle();
      expect(buttonWith("나만 (상담)").getAttribute("aria-pressed")).toBe("true");
      mocks.queryScope = "shared";
      await renderAndSettle();
      expect(buttonWith("함께 대화").getAttribute("aria-pressed")).toBe("true");
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });
  it("sends the latest scope navigation when returning before the first navigation completes", async () => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", "/wedding/chat?scope=shared");
    try {
      mocks.queryScope = "shared";
      await renderAndSettle();
      await act(async () => buttonWith("나만 (상담)").click());
      // The route still reports shared while Next is completing the first push.
      await act(async () => buttonWith("함께 대화").click());
      expect(mocks.push.mock.calls.map(([destination]) => destination)).toEqual([
        "/wedding/chat?scope=private", "/wedding/chat?scope=shared",
      ]);
      expect(buttonWith("함께 대화").getAttribute("aria-pressed")).toBe("true");
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    } finally { window.history.replaceState(null, "", originalUrl); }
  });
  const openSharedClearRequest = async () => {
    if (!mocks.messages.length) { mocks.messages = history("shared", 1); await renderAndSettle(); }
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="대화 화면 정리"]')!.click());
    await act(async () => buttonWith("둘의 화면 함께 정리").click());
  };

  it("keeps a dismissed long-chat banner hidden in the same scope and segment after polling", async () => {
    mocks.messages = history("shared"); await renderAndSettle();
    expect(buttonWith("괜찮아요")).toBeDefined();
    await act(async () => buttonWith("괜찮아요").click());
    mocks.messages = history("shared", 201); await renderAndSettle();
    expect(buttonWith("괜찮아요")).toBeUndefined();
  });

  it("counts the active scope and keeps shared and private banner dismissals separate", async () => {
    mocks.messages = [...history("shared"), ...history("bride_private", 1)]; await renderAndSettle();
    await act(async () => buttonWith("괜찮아요").click());
    await act(async () => buttonWith("나만 (상담)").click()); await renderAndSettle();
    expect(buttonWith("괜찮아요")).toBeUndefined();
    mocks.messages = [...history("shared"), ...history("bride_private")]; await renderAndSettle();
    expect(buttonWith("괜찮아요")).toBeDefined();
    await act(async () => buttonWith("괜찮아요").click());
    await act(async () => buttonWith("함께 대화").click()); await renderAndSettle();
    expect(buttonWith("괜찮아요")).toBeUndefined();
  });

  it("shows the banner for a new cleared conversation segment without restoring the old dismissal", async () => {
    mocks.messages = history("shared"); await renderAndSettle();
    await act(async () => buttonWith("괜찮아요").click());
    mocks.sharedClearedAt = "2026-09-10T01:00:00.000Z";
    mocks.messages = []; await renderAndSettle();
    expect(buttonWith("괜찮아요")).toBeUndefined();
    mocks.messages = history("shared").map(message => ({ ...message, created_at: "2026-09-10T02:00:00.000Z" }));
    await renderAndSettle(); expect(buttonWith("괜찮아요")).toBeDefined();
  });

  it("does not carry a banner dismissal across another account or a return login", async () => {
    mocks.messages = history("shared"); await renderAndSettle();
    await act(async () => buttonWith("괜찮아요").click());
    mocks.profileId = "other-user"; mocks.coupleId = "other-couple";
    mocks.messages = history("shared"); await renderAndSettle();
    expect(buttonWith("괜찮아요")).toBeDefined();
    await act(async () => buttonWith("괜찮아요").click());
    mocks.profileId = "user-1"; mocks.coupleId = "couple-1";
    mocks.messages = history("shared"); await renderAndSettle();
    expect(buttonWith("괜찮아요")).toBeDefined();
  });

  it.each(["result", "throw"])("keeps a failed shared clear request open with a safe retry message (%s)", async failure => {
    if (failure === "result") mocks.requestSharedClear.mockResolvedValueOnce({ ok: false, error: "private-token@example.test" });
    else mocks.requestSharedClear.mockRejectedValueOnce(new Error("private-token@example.test"));
    await openSharedClearRequest();
    await act(async () => buttonWith("동의 요청 보내기").click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain("동의 요청을 보내지 못했어요");
    expect(container.textContent).not.toContain("private-token@example.test");
    expect(mocks.clearMessages).not.toHaveBeenCalled();
    await act(async () => buttonWith("동의 요청 보내기").click());
    expect(mocks.requestSharedClear).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("submits a shared clear request once while pending and closes only after success", async () => {
    let finish!: (value: { ok: boolean }) => void;
    mocks.requestSharedClear.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await openSharedClearRequest();
    const submit = buttonWith("동의 요청 보내기");
    await act(async () => { submit.click(); submit.click(); });
    expect(mocks.requestSharedClear).toHaveBeenCalledTimes(1);
    expect(submit.disabled).toBe(true);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => finish({ ok: true }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.clearMessages).not.toHaveBeenCalled();
  });

  it.each(["back", "close"])("keeps a pending shared request locked across %s and reopening", async navigation => {
    let finish!: (value: { ok: boolean }) => void;
    mocks.requestSharedClear.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await openSharedClearRequest();
    await act(async () => buttonWith("동의 요청 보내기").click());
    if (navigation === "back") {
      await act(async () => buttonWith("돌아가기").click());
      await act(async () => buttonWith("둘의 화면 함께 정리").click());
    } else {
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await openSharedClearRequest();
    }
    const submit = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.textContent?.includes("동의 요청 보내"))!;
    expect(submit.disabled).toBe(true);
    await act(async () => submit.click());
    expect(mocks.requestSharedClear).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("둘의 화면 정리 동의를 요청할게요");
    expect(buttonWith("동의 요청 보내기").disabled).toBe(false);
  });

  it("cannot close another account's clear dialog when an earlier request settles", async () => {
    let finish!: (value: { ok: boolean }) => void;
    mocks.requestSharedClear.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await openSharedClearRequest();
    await act(async () => buttonWith("동의 요청 보내기").click());
    mocks.profileId = "other-user"; mocks.coupleId = "other-couple";
    mocks.messages = history("shared", 1); await renderAndSettle();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await openSharedClearRequest();
    await act(async () => finish({ ok: true }));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("둘의 화면 정리 동의를 요청할게요");
    expect(buttonWith("동의 요청 보내기").disabled).toBe(false);
  });

  it("cannot close a private clear dialog when a prior shared request settles", async () => {
    let finish!: (value: { ok: boolean }) => void;
    mocks.requestSharedClear.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await openSharedClearRequest();
    await act(async () => buttonWith("동의 요청 보내기").click());
    await act(async () => buttonWith("나만 (상담)").click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="대화 화면 정리"]')!.click());
    await act(async () => finish({ ok: true }));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("비공개 상담 화면 정리");
    expect(mocks.clearMessages).not.toHaveBeenCalled();
  });
  const typeComposer = (value: string) => {
    const textarea = container.querySelector("textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
  };
  it("places confirmed wedding taste only in private_ai, with no initial greeting, proactive write or automatic send under StrictMode", async () => {
    await act(async () => root.unmount());
    queueTaste(); vi.clearAllMocks(); root = createRoot(container);
    await act(async () => { root.render(<StrictMode><ChatContent /></StrictMode>); await Promise.resolve(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(buildWeddingTasteAmoraText(tasteDraft()));
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.requestInitialGreeting).not.toHaveBeenCalled();
    expect(requestProactiveCare).not.toHaveBeenCalled();
    const shared = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.includes("함께 대화"))!;
    await act(async () => shared.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
  });
  it("rejects mixed personal taste and public prefill without copying either into a composer", async () => {
    queueTaste(); mocks.queryPrefill = "함께 보는 질문";
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    const shared = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.includes("함께 대화"))!;
    await act(async () => shared.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
  it.each(["source", "prefill"])("accepts a later explicit %s on the same mounted page without moving private taste into shared", async kind => {
    await act(async () => root.unmount());
    queueTaste(); vi.clearAllMocks(); root = createRoot(container);
    await act(async () => root.render(<ChatContent />));
    const tasteText = buildWeddingTasteAmoraText(tasteDraft());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(tasteText);
    // Next의 query 교체는 같은 ChatContent를 유지한다. 먼저 소비된 nonce 주소를 정리한다.
    mocks.tasteNonces = []; mocks.queryScope = null;
    await act(async () => root.render(<ChatContent />));
    await act(async () => buttonWith("함께 대화").click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    const nextText = "새 준비 항목을 함께 확인해 주세요.";
    if (kind === "source") {
      mocks.resolvePreparation.mockResolvedValue({ text: nextText, sourceLabel: "새 항목", sourceHref: "/checklist" });
      mocks.preparationSources = ["c.venue"];
    } else mocks.queryPrefill = nextText;
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(nextText);
    if (kind === "source") expect(mocks.resolvePreparation).toHaveBeenCalledExactlyOnceWith("c.venue");
    await act(async () => buttonWith("나만 (상담)").click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(tasteText);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.requestInitialGreeting).not.toHaveBeenCalled();
    expect(requestProactiveCare).not.toHaveBeenCalled();
  });
  it.each(["source", "prefill"])("keeps the original mixed %s suppressed after nonce-only removal but accepts a later clean visit", async kind => {
    queueTaste();
    if (kind === "source") mocks.preparationSources = ["c.venue"];
    else mocks.queryPrefill = "나중에 직접 연 질문";
    await act(async () => root.render(<ChatContent />));
    mocks.tasteNonces = [];
    await act(async () => root.render(<ChatContent />));
    await act(async () => buttonWith("함께 대화").click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(mocks.resolvePreparation).not.toHaveBeenCalled();
    // 모든 인계 파라미터가 정리된 뒤 같은 출처를 새로 열면 별도 명시적 방문이다.
    mocks.preparationSources = []; mocks.queryPrefill = null; mocks.queryScope = null;
    await act(async () => root.render(<ChatContent />));
    if (kind === "source") mocks.preparationSources = ["c.venue"];
    else mocks.queryPrefill = "나중에 직접 연 질문";
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      kind === "source" ? "결혼식장 · 견적 확인 준비를 도와주세요." : "나중에 직접 연 질문",
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
  it.each(["source", "signup", "duplicate", "wrong-scope"])("rejects a wedding taste handoff mixed with %s", async kind => {
    queueTaste();
    if (kind === "source") mocks.preparationSources = ["checklist:venue"];
    if (kind === "signup") mocks.startHereHandoffId = HANDOFF_ID;
    if (kind === "duplicate") mocks.tasteNonces.push(mocks.tasteNonces[0]);
    if (kind === "wrong-scope") mocks.queryScope = "shared";
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).toBeNull();
    expect(mocks.resolvePreparation).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
  it("preserves an existing private draft and applies pending taste only after explicit retry, then sends only privately", async () => {
    await act(async () => buttonWith("나만 (상담)").click());
    await act(async () => typeComposer("기존 개인 초안"));
    queueTaste(); await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("기존 개인 초안");
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).not.toBeNull();
    expect(buttonWith("이어 온 내 취향 불러오기").disabled).toBe(true);
    await act(async () => typeComposer(""));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    await act(async () => { buttonWith("이어 온 내 취향 불러오기").click(); buttonWith("이어 온 내 취향 불러오기").click(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(buildWeddingTasteAmoraText(tasteDraft()));
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="나만의 아모라 상담 메시지 보내기"]')!.click());
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ target: "ai", visibility: "bride_private", content: buildWeddingTasteAmoraText(tasteDraft()) }));
    expect(mocks.sendMessage.mock.calls[0][0]).not.toHaveProperty("preparationSource");
  });
  it("does not overwrite typing queued in the same tick as a pending taste retry", async () => {
    await act(async () => buttonWith("나만 (상담)").click());
    await act(async () => typeComposer("먼저 쓴 글"));
    queueTaste(); await act(async () => root.render(<ChatContent />));
    await act(async () => typeComposer(""));
    const retry = buttonWith("이어 온 내 취향 불러오기");
    await act(async () => { typeComposer("새로 쓰는 글"); retry.click(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("새로 쓰는 글");
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).not.toBeNull();
  });
  it.each(["image/png", "application/pdf"])("keeps pending %s reads and attachments, and only applies after their removal", async mediaType => {
    await act(async () => buttonWith("나만 (상담)").click());
    const readers: FileReader[] = [];
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) { readers.push(this); });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["content"], mediaType === "image/png" ? "photo.png" : "contract.pdf", { type: mediaType })] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    queueTaste(); await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).not.toBeNull();
    expect(buttonWith("이어 온 내 취향 불러오기").disabled).toBe(true);
    await act(async () => {
      Object.defineProperty(readers[0], "result", { configurable: true, value: `data:${mediaType};base64,Y29udGVudA==` });
      readers[0].onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });
    expect(buttonWith("이어 온 내 취향 불러오기").disabled).toBe(true);
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label*="첨부 삭제"], button[aria-label*="제거"]');
    expect(remove).not.toBeNull();
    await act(async () => remove!.click());
    await act(async () => buttonWith("이어 온 내 취향 불러오기").click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(buildWeddingTasteAmoraText(tasteDraft()));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
  it.each(["streaming", "sending"])("keeps taste pending during %s and resumes when it ends", async kind => {
    queueTaste(); if (kind === "streaming") mocks.isStreaming = true; else mocks.isSending = true;
    await act(async () => root.render(<ChatContent />));
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    mocks.isStreaming = false; mocks.isSending = false;
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(buildWeddingTasteAmoraText(tasteDraft()));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
  it.each(["owner", "couple"])("discards a pending taste handoff on %s change and never restores it when returning", async kind => {
    queueTaste(); mocks.isStreaming = true;
    await act(async () => root.render(<ChatContent />));
    if (kind === "owner") mocks.profileId = "next-user"; else mocks.coupleId = "next-couple";
    mocks.isStreaming = false;
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).toBeNull();
    mocks.profileId = "user-1"; mocks.coupleId = "couple-1";
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
  it("retains a pending nonce through remount and never reapplies an already consumed nonce", async () => {
    queueTaste(); mocks.isStreaming = true;
    await act(async () => root.render(<ChatContent />));
    await act(async () => root.unmount()); root = createRoot(container); mocks.isStreaming = false;
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(buildWeddingTasteAmoraText(tasteDraft()));
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(container.textContent).toContain("유효 시간을 확인하지 못했어요");
  });
  it("revalidates expiry on retry without replacing an existing draft or silently truncating text", async () => {
    await act(async () => buttonWith("나만 (상담)").click());
    await act(async () => typeComposer("아직 보내지 않은 글"));
    queueTaste(); await act(async () => root.render(<ChatContent />));
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + WEDDING_TASTE_HANDOFF_TTL_MS + 1);
    await act(async () => typeComposer(""));
    await act(async () => buttonWith("이어 온 내 취향 불러오기").click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY)).toBeNull();
    expect(container.textContent).toContain("유효 시간을 확인하지 못했어요");
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

  it("portals the real scope controls into the header while preserving every delivery-lane draft", async () => {
    const target = document.createElement("header");
    document.body.prepend(target);
    await act(async () => root.render(<AmoraNavigationTargetContext.Provider value={target}><ChatContent /></AmoraNavigationTargetContext.Provider>));
    const headerButton = (label: string) => Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes(label));
    expect(headerButton("함께 대화")).toBeDefined();
    expect(headerButton("나만 (상담)")).toBeDefined();
    expect(container.querySelector('[aria-label="대화 공개 범위"]')).toBeNull();
    const composer = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => typeComposer("공유 AI 초안"));
    await act(async () => buttonWith("상대방에게").click());
    await act(async () => typeComposer("상대에게 보낼 초안"));
    await act(async () => headerButton("나만 (상담)")!.click());
    expect(composer.value).toBe("");
    await act(async () => typeComposer("개인 상담 초안"));
    expect(headerButton("나만 (상담)")!.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("상대방에게는 보이지 않아요");
    await act(async () => headerButton("함께 대화")!.click());
    expect(composer.value).toBe("공유 AI 초안");
    await act(async () => buttonWith("상대방에게").click());
    expect(composer.value).toBe("상대에게 보낼 초안");
    await act(async () => headerButton("나만 (상담)")!.click());
    expect(composer.value).toBe("개인 상담 초안");
    expect(container.querySelector('button[aria-label="대화 검색"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="정보 패널 · 대화 정리와 준비 현황"]')).not.toBeNull();
    expect(container.querySelector('a[aria-label="AI 정책"]')).not.toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.push.mock.calls.map(([destination]) => destination)).toEqual([
      "/?scope=private", "/?scope=shared", "/?scope=private",
    ]);
  });

  it.each(["streaming", "sending"] as const)("locks header scope and board navigation during %s without losing the draft", async kind => {
    const target = document.createElement("header");
    document.body.prepend(target);
    const render = () => root.render(<AmoraNavigationTargetContext.Provider value={target}><ChatContent /></AmoraNavigationTargetContext.Provider>);
    await act(async () => render());
    const privateButton = () => Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("나만 (상담)"));
    expect(privateButton()).toBeDefined();
    await act(async () => typeComposer("전송 상태에서 보존할 초안"));
    mocks.isStreaming = kind === "streaming";
    mocks.isSending = kind === "sending";
    await act(async () => render());
    expect(privateButton()!.disabled).toBe(true);
    expect(target.querySelector('a[href*="/chat/board"]')).toBeNull();
    await act(async () => privateButton()!.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("전송 상태에서 보존할 초안");
    mocks.isStreaming = false; mocks.isSending = false;
    await act(async () => render());
    expect(privateButton()!.disabled).toBe(false);
    expect(target.querySelector('a[href*="/chat/board"]')).not.toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("moves navigation from its inline fallback to a late header target without remounting the private composer", async () => {
    const target = document.createElement("header");
    document.body.prepend(target);
    await act(async () => root.render(<AmoraNavigationTargetContext.Provider value={null}><ChatContent /></AmoraNavigationTargetContext.Provider>));
    await act(async () => buttonWith("나만 (상담)").click());
    await act(async () => typeComposer("헤더 준비 중인 개인 초안"));
    const composer = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => root.render(<AmoraNavigationTargetContext.Provider value={target}><ChatContent /></AmoraNavigationTargetContext.Provider>));
    const privateButton = Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("나만 (상담)"));
    expect(privateButton).toBeDefined();
    expect(privateButton!.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("textarea")).toBe(composer);
    expect(composer.value).toBe("헤더 준비 중인 개인 초안");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps a consumed private URL from overriding a later header scope selection", async () => {
    const target = document.createElement("header");
    document.body.prepend(target);
    mocks.queryScope = "private";
    const render = () => root.render(<AmoraNavigationTargetContext.Provider value={target}><ChatContent /></AmoraNavigationTargetContext.Provider>);
    await act(async () => render());
    const button = (label: string) => Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.includes(label));
    expect(button("나만 (상담)")?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("함께 대화")!.click());
    await act(async () => render());
    expect(button("함께 대화")!.getAttribute("aria-pressed")).toBe("true");
    expect(button("나만 (상담)")!.getAttribute("aria-pressed")).toBe("false");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("does not portal embedded controls or introduce external navigation when a header target exists", async () => {
    const target = document.createElement("header");
    document.body.prepend(target);
    await act(async () => root.render(<AmoraNavigationTargetContext.Provider value={target}><ChatContent embedded /></AmoraNavigationTargetContext.Provider>));
    expect(target.children).toHaveLength(0);
    expect(container.querySelector('[aria-label="대화 공개 범위"]')).not.toBeNull();
    expect(container.querySelector('a[href*="/chat/board"]')).toBeNull();
    expect(container.querySelector('a[href*="/chat/missions"]')).toBeNull();
    await act(async () => buttonWith("나만 (상담)").click());
    expect(buttonWith("나만 (상담)").getAttribute("aria-pressed")).toBe("true");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps embedded conversation controls and private drafts without introducing page navigation or an automatic send", async () => {
    expect(container.querySelector('a[href="/wedding/chat/board"]')?.textContent).toBe("결정 보드");
    expect(container.querySelector('a[href="/wedding/chat/missions"]')).toBeNull();
    await act(async () => root.render(<ChatContent embedded />));
    expect(container.querySelector('a[href="/wedding/chat/board"]')).toBeNull();
    expect(container.querySelector('a[href="/wedding/chat/missions"]')).toBeNull();
    const composer = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer, "함께 대화 초안");
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const scope = (name: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="대화 공개 범위"] button')).find(button => button.textContent?.includes(name))!;
    await act(async () => scope("나만 (상담)").click());
    expect(composer.value).toBe("");
    expect(scope("나만 (상담)").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("서비스에 저장되며 상대방에게는 보이지 않아요");
    await act(async () => scope("함께 대화").click());
    expect(composer.value).toBe("함께 대화 초안");
    expect(container.querySelector('button[aria-label="대화 검색"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="정보 패널 · 대화 정리와 준비 현황"]')).not.toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
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
    mocks.profileId = null;
    mocks.coupleId = null;

    await act(async () => {
      root.render(<ChatContent />);
      await Promise.resolve();
    });

    const composer = () => container.querySelector<HTMLTextAreaElement>("textarea");
    // 아직 인증 신원이 없으면 전송 가능한 작성창 자체를 노출하지 않는다.
    expect(composer()).toBeNull();

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

  it.each(["owner", "couple"])("never restores a consumed prefill after a verified %s changes", async (change) => {
    mocks.queryPrefill = "이전 공간에서 이어 온 질문";
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(mocks.queryPrefill);
    mocks.queryPrefill = null;
    if (change === "owner") mocks.profileId = "different-user";
    else mocks.coupleId = "different-couple";
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("resolves a short preparation source once, keeps it as an unsent draft and removes its URL", async () => {
    mocks.preparationSources = ["c.venue.venue_04"];
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    expect(mocks.resolvePreparation).toHaveBeenCalledExactlyOnceWith("c.venue.venue_04");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("결혼식장 · 견적 확인 준비를 도와주세요.");
    expect(container.textContent).not.toContain("에서 이어 왔어요");
    expect(container.textContent).not.toContain("이어 온 질문 보기");
    expect(container.textContent).not.toContain("함께 볼 참고 안내");
    expect(container.querySelector('button[aria-label="첨부한 준비 안내 제거"]')).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith(window.location.pathname, { scroll: false });
    await act(async () => root.render(<ChatContent />));
    expect(mocks.resolvePreparation).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("sends a reference ID separately from the short question and clears it after successful send", async () => {
    mocks.preparationSources = ["g.cost-saving.section-3"];
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    expect(container.textContent).not.toContain("함께 볼 참고 안내");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="함께 보는 아모라 메시지 보내기"]')?.click());
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      content: "결혼식장 · 견적 확인 준비를 도와주세요.", preparationSource: "g.cost-saving.section-3",
    }));
    expect(mocks.sendMessage.mock.calls[0][0]).not.toHaveProperty("referenceText");
    expect(container.querySelector('button[aria-label="첨부한 준비 안내 제거"]')).toBeNull();
  });

  it("restores an unknown-send reference and retry key, while clearing the question starts a new request without the reference", async () => {
    const key = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    mocks.sendMessage.mockResolvedValueOnce({ userMessage: "persistence_unknown", clientRequestId: key });
    mocks.sendMessage.mockResolvedValueOnce({ userMessage: "persistence_unknown", clientRequestId: key });
    mocks.preparationSources = ["c.venue"];
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    const send = () => container.querySelector<HTMLButtonElement>('button[aria-label="함께 보는 아모라 메시지 보내기"]');
    await act(async () => send()?.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("결혼식장 · 견적 확인 준비를 도와주세요.");
    await act(async () => send()?.click());
    expect(mocks.sendMessage.mock.calls[1][0]).toEqual(expect.objectContaining({ preparationSource: "c.venue", clientRequestId: key }));
    await act(async () => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "새 질문");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => send()?.click());
    expect(mocks.sendMessage.mock.calls[2][0]).not.toHaveProperty("preparationSource");
    expect(mocks.sendMessage.mock.calls[2][0]).not.toHaveProperty("clientRequestId");
  });

  it.each(["", "   "])("clearing an imported question to %j also removes its reference before a new question", async cleared => {
    mocks.preparationSources = ["g.cost-saving.section-3"];
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    const input = (text: string) => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, text);
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => input(cleared));
    expect(container.textContent).not.toContain("이어 온 질문 보기");
    await act(async () => input("여행지 고르는 기준이 궁금해요."));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="함께 보는 아모라 메시지 보내기"]')?.click());
    expect(mocks.sendMessage.mock.calls[0][0]).toEqual(expect.objectContaining({ content: "여행지 고르는 기준이 궁금해요." }));
    expect(mocks.sendMessage.mock.calls[0][0]).not.toHaveProperty("preparationSource");
  });

  it("keeps the public reference for an edited nonempty question without sending it automatically", async () => {
    mocks.preparationSources = ["c.venue"];
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    await act(async () => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "견적에서 추가 비용부터 확인하고 싶어요.");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="함께 보는 아모라 메시지 보내기"]')?.click());
    expect(mocks.sendMessage.mock.calls[0][0]).toEqual(expect.objectContaining({ content: "견적에서 추가 비용부터 확인하고 싶어요.", preparationSource: "c.venue" }));
    expect(container.textContent).not.toContain("이어 온 질문 보기");
  });

  it.each(["private", "partner"])("keeps the imported question in shared AI without sending its source to %s", async lane => {
    mocks.preparationSources = ["c.venue"];
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    const button = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.includes(label));
    await act(async () => button(lane === "private" ? "나만 (상담)" : "상대방에게")?.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    await act(async () => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "이번 주말에 시간 괜찮을까요?");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const sendLabel = lane === "private" ? "나만의 아모라 상담 메시지 보내기" : "상대방에게 메시지 보내기";
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${sendLabel}"]`)?.click());
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage.mock.calls[0][0]).not.toHaveProperty("preparationSource");
    await act(async () => button(lane === "private" ? "함께 대화" : "아모라에게")?.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("결혼식장 · 견적 확인 준비를 도와주세요.");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="함께 보는 아모라 메시지 보내기"]')?.click());
    expect(mocks.sendMessage.mock.calls[1][0]).toEqual(expect.objectContaining({ preparationSource: "c.venue", visibility: "shared", target: "ai" }));
  });

  it("rejects duplicate source IDs without falling through to an arbitrary legacy prefill", async () => {
    mocks.preparationSources = ["c.venue", "g.cost-saving"];
    mocks.queryPrefill = "검증되지 않은 대체 질문";
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    expect(mocks.resolvePreparation).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(container.textContent).toContain("준비 항목을 확인하지 못했어요");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("does not mix a guide source with a signup nonce or consume its private stored draft", async () => {
    mocks.preparationSources = ["c.venue"];
    mocks.startHereHandoffId = HANDOFF_ID;
    rememberDemoAmoraPrefill(window.localStorage, "가입 때 입력한 개인 조건", HANDOFF_ID);
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    expect(mocks.resolvePreparation).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(container.textContent).not.toContain("가입 때 입력한 개인 조건");
    expect(mocks.replace).toHaveBeenCalledWith(window.location.pathname, { scroll: false });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("uses a new explicit source on the same page after the previous source query was consumed", async () => {
    mocks.preparationSources = ["c.venue"];
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    mocks.preparationSources = [];
    await act(async () => root.render(<ChatContent />));
    await act(async () => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.resolvePreparation.mockResolvedValue({ text: "새 절의 질문", sourceLabel: "새 절", sourceHref: "/manners/cost-saving#section-2" });
    mocks.preparationSources = ["g.cost-saving.section-2"];
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("새 절의 질문");
    expect(mocks.resolvePreparation).toHaveBeenCalledTimes(2);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps meaningful punctuation in a legacy URL draft and never sends it automatically", async () => {
    mocks.queryPrefill = "예산 & 준비? 10% + 다음 단계\n무엇부터 할까요";
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(mocks.queryPrefill);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it.each(["질".repeat(20_001), "질문\u0000본문"])("rejects a legacy draft the request contract cannot accept", async draft => {
    mocks.queryPrefill = draft;
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(container.textContent).toContain("형식이나 길이를 확인하지 못했어요");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("a legacy link does not overwrite a draft already being written", async () => {
    await act(async () => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "작성 중인 질문");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.queryPrefill = "새로 온 질문";
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("작성 중인 질문");
    expect(container.textContent).toContain("작성 중인 함께 대화는 그대로");
  });

  it.each(["unknown", "error"])("does not fabricate a question when catalog resolution has %s", async kind => {
    if (kind === "unknown") mocks.resolvePreparation.mockResolvedValue(null);
    else mocks.resolvePreparation.mockRejectedValue(new Error("private transport details"));
    mocks.preparationSources = ["c.unknown"];
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(container.textContent).not.toContain("private transport details");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith(window.location.pathname, { scroll: false });
  });

  it("keeps an existing private draft and offers a manual shared-composer handoff", async () => {
    const button = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.includes(label));
    await act(async () => button("나만 (상담)")?.click());
    await act(async () => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "개인적으로 쓰던 질문");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.preparationSources = ["c.venue.venue_04"];
    await act(async () => { root.render(<ChatContent />); await Promise.resolve(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("개인적으로 쓰던 질문");
    await act(async () => button("함께 대화에 질문 불러오기")?.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("결혼식장 · 견적 확인 준비를 도와주세요.");
    expect(button("함께 대화에 질문 불러오기")).toBeUndefined();
    expect(container.textContent).not.toContain("함께 볼 참고 안내");
    await act(async () => button("나만 (상담)")?.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("개인적으로 쓰던 질문");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it.each(["typed", "owner", "couple", "owner-aba"])("does not insert a delayed source over %s", async change => {
    let resolve!: (value: { text: string; sourceLabel: string; sourceHref: string }) => void;
    mocks.resolvePreparation.mockReturnValue(new Promise(done => { resolve = done; }));
    mocks.preparationSources = ["c.venue.venue_04"];
    await act(async () => root.render(<ChatContent />));
    if (change === "typed") {
      await act(async () => {
        const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "지금 작성한 질문");
        textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    } else {
      if (change === "couple") mocks.coupleId = "next-couple";
      else mocks.profileId = "next-user";
      await act(async () => root.render(<ChatContent />));
      if (change === "owner-aba") {
        mocks.profileId = "user-1";
        await act(async () => root.render(<ChatContent />));
      }
    }
    await act(async () => { resolve({ text: "오래된 준비 질문", sourceLabel: "출처", sourceHref: "/checklist" }); await Promise.resolve(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(change === "typed" ? "지금 작성한 질문" : "");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
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

  it("places a confirmed personal handoff in the private composer without sending or modifying shared drafts", async () => {
    await act(async () => root.unmount()); root = createRoot(container);
    mocks.personalHandoffPending = true; mocks.takePersonalHandoff.mockResolvedValue("이 개인 할 일을 이어서 상담하고 싶어요.\n제목: 내 기준");
    await act(async () => root.render(<ChatContent />));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain("제목: 내 기준");
    expect(container.querySelector('button[aria-label="나만의 아모라 상담 메시지 보내기"]')).not.toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    const shared = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("함께 대화"));
    await act(async () => shared?.click()); expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
  });

  it("a personal handoff never overwrites a private draft typed while its fresh read is pending", async () => {
    let resolve!: (value: string) => void;
    await act(async () => root.unmount()); root = createRoot(container);
    mocks.personalHandoffPending = true; mocks.takePersonalHandoff.mockReturnValue(new Promise<string>(done => { resolve = done; }));
    await act(async () => root.render(<ChatContent />));
    const privateScope = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("나만 (상담)"));
    await act(async () => privateScope?.click());
    await act(async () => {
      const textarea = container.querySelector("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "이미 쓰는 개인 초안");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => resolve("전달하려던 개인 내용"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("이미 쓰는 개인 초안");
    expect(container.textContent).toContain("작성 중인 나만 상담은 그대로 두었어요");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("a personal continuation resolving after a couple switch cannot enter the new composer", async () => {
    let resolve!: (value: string) => void;
    await act(async () => root.unmount()); root = createRoot(container);
    mocks.personalHandoffPending = true; mocks.takePersonalHandoff.mockReturnValue(new Promise<string>(done => { resolve = done; }));
    await act(async () => root.render(<ChatContent />));
    mocks.coupleId = "couple-2";
    await act(async () => root.render(<ChatContent />));
    await act(async () => resolve("이전 커플에서 선택한 개인 내용"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(""); expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("shows a failed personal handoff in the private view even while shared AI artifacts are selected", async () => {
    await act(async () => root.unmount()); root = createRoot(container);
    mocks.artifactVisibility = "shared"; mocks.personalHandoffPending = true; mocks.takePersonalHandoff.mockRejectedValue(new Error("source no longer exists"));
    await act(async () => root.render(<ChatContent />));
    expect(container.textContent).toContain("개인 할 일을 다시 확인하지 못했어요");
    expect(container.querySelector('button[aria-label="나만의 아모라 상담 메시지 보내기"]')).not.toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
