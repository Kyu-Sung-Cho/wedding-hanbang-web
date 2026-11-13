import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { amoraLaneStorageKey } from "@hanbang/shared/amora-lane-choice";

import ChatSidePanel from "./ChatSidePanel";
import { amoraPersonalizationPendingStorageKey } from "./amoraPersonalizationFlow";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function pendingIdentity(
  tool: string,
  input: Record<string, unknown>,
) {
  const { inputDigest, operationKey } = getAmoraToolOperationIdentity(tool, input);
  return { inputDigest, operationKey };
}

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  loadMessages: vi.fn(),
  requestInitialGreeting: vi.fn(),
  requestMediation: vi.fn(),
  clearMessages: vi.fn(),
  subscribeToMessages: vi.fn(() => vi.fn()),
  retryFailedMessage: vi.fn(),
  dismissFailedMessageRetry: vi.fn(),
  applicationFetch: vi.fn(),
  setChatState: vi.fn(),
  suggestions: [] as string[],
  initialLoadDone: false,
  personalizationStatus: "ready" as "idle" | "loading" | "ready" | "error",
  personalizationProfile: null as null | {
    preferences: {
      decisionStart: "recommend_first";
      answerDetail: "adaptive";
      supportOrder: "ask_each_time";
      workMode: "ask_each_time";
      familyOrder: "ask_each_time";
    };
    revision: number;
    confirmedAt: string;
    updatedAt: string;
  },
  savePersonalization: vi.fn(),
  messages: [] as Array<{
    id: string;
    couple_id?: string;
    sender_id: string | null;
    sender_role: "bride" | "groom" | "ai";
    content: string;
    visibility: "shared" | "bride_private" | "groom_private";
    metadata: Record<string, unknown>;
    created_at: string;
  }>,
  profileId: "user-1" as string | null,
  confirmedRole: null as "bride" | "groom" | null,
  partner: null as null | { id: string; name: string; couple_id: string; confirmed_role: "bride" | "groom" | null; avatar_url?: string | null },
  coupleId: "couple-1" as string | null,
  hasLinkedPartner: true,
  isDemo: false,
  profileRole: "bride" as "bride" | "groom" | null,
  push: vi.fn(),
  chatState: {
    artifactVisibility: "shared" as "shared" | "bride_private" | "groom_private" | null,
    error: null as string | null,
    quotaRemaining: null as number | null,
    isStreaming: false,
    isSending: false,
    streamingContent: "",
    failedRequest: null as null | {
      canRetry: boolean;
      unavailableReason: string | null;
      visibility: "shared" | "bride_private" | "groom_private";
      recoveryKind?: "confirmed_action" | "interrupted_turn" | "requires_reattach";
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => {
    const currentUserId = mocks.profileId;
    const isGroom = mocks.profileRole === "groom";
    return {
      profile: currentUserId
        ? {
            id: currentUserId,
            role: mocks.profileRole,
            confirmed_role: mocks.confirmedRole,
            name: "테스트",
            couple_id: mocks.coupleId,
          }
        : null,
      couple: mocks.coupleId && currentUserId
        ? {
            id: mocks.coupleId,
            bride_id: isGroom
              ? (mocks.hasLinkedPartner ? "partner-bride" : null)
              : currentUserId,
            groom_id: isGroom
              ? currentUserId
              : (mocks.hasLinkedPartner ? "partner-groom" : null),
          }
        : null,
      journey: null,
      partner: mocks.partner,
      isDemo: mocks.isDemo,
      isInitialized: true,
      isLoading: false,
    };
  },
}));

vi.mock("@/hooks/useAmoraPersonalization", () => ({
  useAmoraPersonalization: () => ({
    profile: mocks.personalizationProfile,
    status: mocks.personalizationStatus,
    saving: false,
    error: null,
    save: mocks.savePersonalization,
  }),
}));

vi.mock("@/stores/chatStore", () => {
  const useChatStore = Object.assign(
    () => ({
      messages: mocks.messages,
      isStreaming: mocks.chatState.isStreaming,
      isSending: mocks.chatState.isSending,
      streamingContent: mocks.chatState.streamingContent,
      streamingToolResults: [],
      suggestions: mocks.suggestions,
      artifactVisibility: mocks.chatState.artifactVisibility,
      error: mocks.chatState.error,
      quotaRemaining: mocks.chatState.quotaRemaining,
      failedRequest: mocks.chatState.failedRequest,
      isRetrying: false,
      initialLoadDone: mocks.initialLoadDone,
      loadMessages: mocks.loadMessages,
      sendMessage: mocks.sendMessage,
      requestInitialGreeting: mocks.requestInitialGreeting,
      requestMediation: mocks.requestMediation,
      clearMessages: mocks.clearMessages,
      subscribeToMessages: mocks.subscribeToMessages,
      retryFailedMessage: mocks.retryFailedMessage,
      dismissFailedMessageRetry: mocks.dismissFailedMessageRetry,
    }),
    {
      setState: mocks.setChatState,
      getState: () => ({
        messages: mocks.messages,
        isStreaming: mocks.chatState.isStreaming,
        isSending: mocks.chatState.isSending,
      }),
    },
  );
  return { useChatStore };
});

vi.mock("./ChatBubble", () => ({
  default: ({ message, senderConfirmedRole, senderAvatarUrl }: { message: { id: string; content: string }; senderConfirmedRole?: string | null; senderAvatarUrl?: string | null }) => <div data-role-message={message.id} data-confirmed-role={senderConfirmedRole ?? ""} data-avatar={senderAvatarUrl ?? ""}>{message.content}</div>,
}));
vi.mock("./ActionCard", () => ({ default: () => <div /> }));
vi.mock("./VendorToolCard", () => ({
  default: ({ onSend }: { onSend: (message: string) => void }) => (
    <button type="button" onClick={() => onSend("업체 카드 후속 질문")}>업체 카드 후속 질문</button>
  ),
  VENDOR_TOOL_NAMES: new Set<string>(["search_vendors"]),
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
  default: ({ content }: { content?: string }) => (
    <div data-testid="streaming-bubble">{content || "응답 생성 중"}</div>
  ),
}));

describe("ChatSidePanel attachment sending", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    // 2026-09-26 부터 처음 여는 사람은 '함께/나만'을 먼저 고른다(`amoraLaneFirstChoice.test.tsx`).
    // 이 파일은 레인별 전송·초안을 재므로, 여기 나오는 계정은 모두 이미 '함께'를 고른 사람이다.
    window.localStorage.clear();
    for (const userId of ["user-1", "user-new"]) {
      window.localStorage.setItem(amoraLaneStorageKey(userId) as string, "shared");
    }
    mocks.messages = [];
    mocks.suggestions = [];
    mocks.sendMessage.mockResolvedValue({
      userMessage: "ephemeral_demo",
      userMessageId: "demo-sidepanel-message",
    });
    mocks.profileId = "user-1";
    mocks.partner = null;
    mocks.confirmedRole = null;
    mocks.coupleId = "couple-1";
    mocks.hasLinkedPartner = true;
    mocks.isDemo = false;
    mocks.profileRole = "bride";
    mocks.initialLoadDone = false;
    mocks.personalizationStatus = "ready";
    mocks.personalizationProfile = null;
    mocks.savePersonalization.mockResolvedValue({
      preferences: {
        decisionStart: "recommend_first",
        answerDetail: "adaptive",
        supportOrder: "ask_each_time",
        workMode: "ask_each_time",
        familyOrder: "ask_each_time",
      },
      revision: 1,
      confirmedAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    });
    mocks.chatState.error = null;
    mocks.chatState.artifactVisibility = "shared";
    mocks.chatState.quotaRemaining = null;
    mocks.chatState.isStreaming = false;
    mocks.chatState.isSending = false;
    mocks.chatState.streamingContent = "";
    mocks.chatState.failedRequest = null;
    mocks.applicationFetch.mockReset();
    mocks.applicationFetch.mockResolvedValue(new Response(JSON.stringify({
      applicationGranted: true,
      retryAfterMs: 0,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", mocks.applicationFetch);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    HTMLElement.prototype.scrollIntoView = vi.fn();

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
  });

  it.each(["user-1", "partner-groom", "former-partner", null])("현재 본인·상대의 확정 역할만 전달한다: %s", async senderId => {
    mocks.confirmedRole = "groom";
    mocks.partner = { id: "partner-groom", name: "상대", couple_id: "couple-1", confirmed_role: "bride", avatar_url: "🌷" };
    mocks.messages = [{ id: "role-binding", couple_id: "couple-1", sender_id: senderId, sender_role: "groom", visibility: "shared", content: "안녕하세요", metadata: {}, created_at: "2026-09-13T00:00:00Z" }];
    await act(async () => root.render(<ChatSidePanel isOpen onClose={vi.fn()} />));
    expect(container.querySelector('[data-role-message="role-binding"]')?.getAttribute("data-confirmed-role"))
      .toBe(senderId === "user-1" ? "groom" : senderId === "partner-groom" ? "bride" : "");
    expect(container.querySelector('[data-role-message="role-binding"]')?.getAttribute("data-avatar"))
      .toBe(senderId === "partner-groom" ? "🌷" : "");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("sends a document attachment even when the text input is empty", async () => {
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, "result", {
        configurable: true,
        value: "data:application/pdf;base64,Y29udHJhY3Q=",
      });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const file = new File(["contract"], "contract.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });

    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("pdf");
    expect(container.textContent).toContain(
      "PDF·DOCX 파일은 아모라 분석에만 사용되며 대화 첨부로 저장되지 않아요.",
    );

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const sendButton = buttons.at(-1);
    expect(sendButton).toBeDefined();
    expect(sendButton?.disabled).toBe(false);

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: "이 문서를 분석해주세요.",
      visibility: "shared",
      images: [expect.objectContaining({
        fileName: "contract.pdf",
        mediaType: "application/pdf",
      })],
    }));
  });

  it("메시지 입력칸이 키보드 초점을 받으면 둘레에 초점 표시가 생기는 클래스를 갖는다", () => {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    expect(input).not.toBeNull();
    const tokens = (input?.parentElement?.className ?? "").split(/\s+/);
    expect(tokens).toEqual(expect.arrayContaining([
      "has-[input:focus-visible]:outline-2",
      "has-[input:focus-visible]:-outline-offset-2",
      "has-[input:focus-visible]:outline-[var(--hb-focus-ring)]",
    ]));
  });

  it("submits only once when the send control fires twice before React rerenders", async () => {
    let finishSend: (() => void) | undefined;
    mocks.sendMessage.mockImplementationOnce(() => new Promise((resolve) => {
      finishSend = () => resolve({
        userMessage: "persisted",
        userMessageId: "double-submit-guarded",
      });
    }));
    const input = container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "한 번만 보내줘");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="메시지 보내기"]',
    );

    await act(async () => {
      sendButton?.click();
      sendButton?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(sendButton?.disabled).toBe(true);

    await act(async () => {
      finishSend?.();
      await Promise.resolve();
    });
  });

  it("cancels a mediation offer without sending or creating a shared message", async () => {
    mocks.messages = [
      {
        id: "conflict-bride",
        couple_id: "couple-1",
        sender_id: "user-1",
        sender_role: "bride",
        content: "너는 맨날 내 말을 안 들어서 너무 서운해.",
        visibility: "shared",
        metadata: { target: "partner" },
        created_at: "2026-07-31T00:00:00.000Z",
      },
      {
        id: "conflict-groom",
        couple_id: "couple-1",
        sender_id: "user-2",
        sender_role: "groom",
        content: "난 절대 반대야. 그건 동의 못 해.",
        visibility: "shared",
        metadata: { target: "partner" },
        created_at: "2026-07-31T00:00:01.000Z",
      },
    ];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const offerButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("아모라에게 상담 요청하기"));
    expect(offerButton).toBeDefined();

    await act(async () => offerButton?.click());
    expect(container.textContent).toContain(
      "상대방에게 직접 보낸 메시지나 비공개 대화는 자동으로 가져오지 않아요",
    );

    const cancelButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "취소");
    await act(async () => cancelButton?.click());

    expect(mocks.requestMediation).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("내가 전달할 상황 요약");
  });

  it("routes confirmed mediation through the structured request with only a self-summary", async () => {
    mocks.messages = [
      {
        id: "conflict-bride",
        couple_id: "couple-1",
        sender_id: "user-1",
        sender_role: "bride",
        content: "너는 맨날 내 말을 안 들어서 너무 서운해. PARTNER_RAW_ONE",
        visibility: "shared",
        metadata: { target: "partner" },
        created_at: "2026-07-31T00:00:00.000Z",
      },
      {
        id: "conflict-groom",
        couple_id: "couple-1",
        sender_id: "user-2",
        sender_role: "groom",
        content: "난 절대 반대야. 그건 동의 못 해. PARTNER_RAW_TWO",
        visibility: "shared",
        metadata: { target: "partner" },
        created_at: "2026-07-31T00:00:01.000Z",
      },
    ];
    mocks.requestMediation.mockResolvedValue(undefined);

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    const offerButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("아모라에게 상담 요청하기"));
    expect(offerButton).toBeDefined();
    await act(async () => offerButton?.click());

    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea',
    );
    await act(async () => {
      if (!textarea) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "예산 상한선을 두고 의견이 달라요.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirmButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("이 요약으로 초안 요청"));
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(mocks.requestMediation).toHaveBeenCalledWith(expect.objectContaining({
      coupleId: "couple-1",
      senderRole: "bride",
      conflictContext: "예산 상한선을 두고 의견이 달라요.",
    }));
    const serializedCall = JSON.stringify(mocks.requestMediation.mock.calls[0]?.[0]);
    expect(serializedCall).not.toContain("PARTNER_RAW_ONE");
    expect(serializedCall).not.toContain("PARTNER_RAW_TWO");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("sends quick-start to shared Amora and confirms only the exact correlated reply", async () => {
    const greeting = {
      id: "greeting-1",
      couple_id: "couple-1",
      sender_id: null,
      sender_role: "ai" as const,
      content: "무엇부터 함께 정리할까요?",
      visibility: "shared" as const,
      metadata: { target: "ai" },
      created_at: "2026-07-31T00:00:00.000Z",
    };
    const quickStartMessage =
      "추천안 하나부터 보고 싶어요. 지금 제 결혼 준비에서 가장 먼저 정할 한 가지를 알려주세요.";
    mocks.initialLoadDone = true;
    mocks.messages = [greeting];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("지금 어떤 도움부터 받을까요?");
    const partnerButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "상대방에게");
    await act(async () => {
      partnerButton?.click();
      await Promise.resolve();
    });

    const recommendationButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("추천안 하나부터"));
    await act(async () => {
      recommendationButton?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: quickStartMessage,
      target: "ai",
      visibility: "shared",
    }));
    const pendingStorageKey = amoraPersonalizationPendingStorageKey(
      "user-1",
      "couple-1",
    );
    expect(window.sessionStorage.getItem(pendingStorageKey)).toBe(
      "recommendation",
    );
    expect(mocks.savePersonalization).not.toHaveBeenCalled();

    const selectedUserMessage = {
      id: "quick-user-1",
      couple_id: "couple-1",
      sender_id: "user-1",
      sender_role: "bride" as const,
      content: quickStartMessage,
      visibility: "shared" as const,
      metadata: { target: "ai" },
      created_at: "2026-07-31T00:00:01.000Z",
    };
    mocks.messages = [
      greeting,
      selectedUserMessage,
      {
        id: "unrelated-ai-1",
        couple_id: "couple-1",
        sender_id: null,
        sender_role: "ai",
        content: "다른 질문에 대한 답변",
        visibility: "shared",
        metadata: { in_reply_to_user_message_id: "other-user-message" },
        created_at: "2026-07-31T00:00:02.000Z",
      },
    ];
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain(
      "앞으로 결정이 필요할 때 추천안 하나를 먼저 보여드릴까요?",
    );
    expect(mocks.savePersonalization).not.toHaveBeenCalled();

    mocks.messages = [
      ...mocks.messages,
      {
        id: "correlated-ai-1",
        couple_id: "couple-1",
        sender_id: null,
        sender_role: "ai",
        content: "먼저 예식 날짜 범위를 정해보세요.",
        visibility: "shared",
        metadata: { in_reply_to_user_message_id: "quick-user-1" },
        created_at: "2026-07-31T00:00:03.000Z",
      },
    ];
    await act(async () => {
      root.unmount();
    });
    container.replaceChildren();
    root = createRoot(container);
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain(
      "앞으로 결정이 필요할 때 추천안 하나를 먼저 보여드릴까요?",
    );

    const saveButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "이대로 저장");
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });
    expect(mocks.savePersonalization).toHaveBeenCalledWith({
      decisionStart: "recommend_first",
    });
    expect(window.sessionStorage.getItem(pendingStorageKey)).toBeNull();
    expect(container.textContent).not.toContain(
      "앞으로 결정이 필요할 때 추천안 하나를 먼저 보여드릴까요?",
    );
  });

  it("clears a recovered quick-start choice immediately when used only once", async () => {
    const quickStartMessage =
      "추천안 하나부터 보고 싶어요. 지금 제 결혼 준비에서 가장 먼저 정할 한 가지를 알려주세요.";
    const pendingStorageKey = amoraPersonalizationPendingStorageKey(
      "user-1",
      "couple-1",
    );
    window.sessionStorage.setItem(pendingStorageKey, "recommendation");
    mocks.initialLoadDone = true;
    mocks.messages = [
      {
        id: "quick-user-recovered",
        couple_id: "couple-1",
        sender_id: "user-1",
        sender_role: "bride",
        content: quickStartMessage,
        visibility: "shared",
        metadata: { target: "ai" },
        created_at: "2026-07-31T00:00:01.000Z",
      },
      {
        id: "quick-ai-recovered",
        couple_id: "couple-1",
        sender_id: null,
        sender_role: "ai",
        content: "먼저 예식 날짜 범위를 정해보세요.",
        visibility: "shared",
        metadata: {
          in_reply_to_user_message_id: "quick-user-recovered",
        },
        created_at: "2026-07-31T00:00:02.000Z",
      },
    ];

    await act(async () => {
      root.unmount();
    });
    container.replaceChildren();
    root = createRoot(container);
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const confirmation = container.querySelector<HTMLElement>(
      '[aria-labelledby="amora-personalization-confirm-title"]',
    );
    expect(confirmation).not.toBeNull();
    const buttons = confirmation?.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => {
      buttons?.item(1).click();
      await Promise.resolve();
    });

    expect(window.sessionStorage.getItem(pendingStorageKey)).toBeNull();
    expect(mocks.savePersonalization).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        '[aria-labelledby="amora-personalization-confirm-title"]',
      ),
    ).toBeNull();
  });

  it("deletes a stale recovered choice after a newer shared Amora turn", async () => {
    const quickStartMessage =
      "추천안 하나부터 보고 싶어요. 지금 제 결혼 준비에서 가장 먼저 정할 한 가지를 알려주세요.";
    const pendingStorageKey = amoraPersonalizationPendingStorageKey(
      "user-1",
      "couple-1",
    );
    window.sessionStorage.setItem(pendingStorageKey, "recommendation");
    mocks.initialLoadDone = true;
    mocks.messages = [
      {
        id: "quick-user-stale",
        couple_id: "couple-1",
        sender_id: "user-1",
        sender_role: "bride",
        content: quickStartMessage,
        visibility: "shared",
        metadata: { target: "ai" },
        created_at: "2026-07-31T00:00:01.000Z",
      },
      {
        id: "quick-ai-stale",
        couple_id: "couple-1",
        sender_id: null,
        sender_role: "ai",
        content: "먼저 예식 날짜 범위를 정해보세요.",
        visibility: "shared",
        metadata: {
          in_reply_to_user_message_id: "quick-user-stale",
        },
        created_at: "2026-07-31T00:00:02.000Z",
      },
      {
        id: "newer-amora-turn",
        couple_id: "couple-1",
        sender_id: "user-2",
        sender_role: "groom",
        content: "그다음에는 무엇을 할까요?",
        visibility: "shared",
        metadata: { target: "ai" },
        created_at: "2026-07-31T00:00:03.000Z",
      },
    ];

    await act(async () => {
      root.unmount();
    });
    container.replaceChildren();
    root = createRoot(container);
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(window.sessionStorage.getItem(pendingStorageKey)).toBeNull();
    expect(
      container.querySelector(
        '[aria-labelledby="amora-personalization-confirm-title"]',
      ),
    ).toBeNull();
    expect(mocks.savePersonalization).not.toHaveBeenCalled();
  });

  it("offers an explicit provider-only retry and a close action", async () => {
    mocks.chatState.error = "아모라의 답변을 받지 못했어요. 다시 시도해 주세요.";
    mocks.chatState.failedRequest = {
      canRetry: true,
      unavailableReason: null,
      visibility: "shared",
    };

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const retryButton = buttons.find((button) => button.textContent?.includes("다시 시도"));
    const closeButton = buttons.find((button) => button.textContent?.trim() === "닫기");
    expect(retryButton).toBeDefined();
    expect(closeButton).toBeDefined();

    await act(async () => {
      retryButton?.click();
      closeButton?.click();
      await Promise.resolve();
    });

    expect(mocks.retryFailedMessage).toHaveBeenCalledTimes(1);
    expect(mocks.dismissFailedMessageRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a durable confirmation recovery as a neutral continue action", async () => {
    mocks.chatState.error =
      "확인은 안전하게 저장됐어요. 반영을 이어서 완료해 주세요.";
    mocks.chatState.failedRequest = {
      canRetry: true,
      unavailableReason: null,
      visibility: "shared",
      recoveryKind: "confirmed_action",
    };

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    );
    const continueButton = buttons.find(
      (button) => button.textContent?.trim() === "반영 계속하기",
    );
    const laterButton = buttons.find(
      (button) => button.textContent?.trim() === "나중에",
    );
    expect(continueButton).toBeDefined();
    expect(laterButton).toBeDefined();

    await act(async () => {
      continueButton?.click();
      laterButton?.click();
      await Promise.resolve();
    });
    expect(mocks.retryFailedMessage).toHaveBeenCalledTimes(1);
    expect(mocks.dismissFailedMessageRetry).toHaveBeenCalledTimes(1);
  });

  it("shows an unanswered durable turn as a neutral user-controlled resume", async () => {
    mocks.chatState.error =
      "질문은 안전하게 저장됐지만 답변이 시작되지 않았어요. 원할 때 이어서 받을 수 있어요.";
    mocks.chatState.failedRequest = {
      canRetry: true,
      unavailableReason: null,
      visibility: "shared",
      recoveryKind: "interrupted_turn",
    };

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const resumeButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "답변 이어받기");
    expect(resumeButton).toBeDefined();
    await act(async () => {
      resumeButton?.click();
      await Promise.resolve();
    });
    expect(mocks.retryFailedMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps a lost-attachment recovery neutral without offering a replay", async () => {
    mocks.chatState.error = "질문은 저장됐지만 첨부한 파일이 필요한 답변은 이어받지 못했어요.";
    mocks.chatState.failedRequest = {
      canRetry: false,
      unavailableReason: "파일을 다시 첨부해 새 메시지로 보내주세요.",
      visibility: "shared",
      recoveryKind: "requires_reattach",
    };

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).toContain("파일을 다시 첨부해 새 메시지로 보내주세요.");
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .some((button) => button.textContent?.trim() === "답변 이어받기")).toBe(false);
  });

  it("supports Escape, traps keyboard focus, and restores the opening control", async () => {
    const onClose = vi.fn();
    const openingControl = document.createElement("button");
    openingControl.textContent = "아모라 열기";
    document.body.insertBefore(openingControl, container);

    await act(async () => {
      root.render(<ChatSidePanel isOpen={false} onClose={onClose} />);
      await Promise.resolve();
    });
    const closedDialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(closedDialog?.getAttribute("aria-hidden")).toBe("true");
    expect(closedDialog?.hasAttribute("inert")).toBe(true);
    openingControl.focus();

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={onClose} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const closeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="아모라 상담 패널 닫기"]',
    );
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-hidden")).toBe("false");
    expect(dialog?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(closeButton);

    const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ) ?? []);
    const first = focusable[0];
    const last = focusable.at(-1);
    last?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);

    first?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    }));
    expect(document.activeElement).toBe(last);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<ChatSidePanel isOpen={false} onClose={onClose} />);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(openingControl);
  });

  // 2026-11-13 파운더 결정: 큰 화면에서는 아모라가 라운지를 덮지 않고 옆자리를 차지한다.
  // 그때 이 패널은 대화 창이 아니라 화면의 한 칸이다.
  it("옆자리로 열면 화면의 한 칸이라 뒤를 잠그거나 초점을 가두지 않고, 초점이 안에 있을 때만 Escape 로 닫는다", async () => {
    const onClose = vi.fn();
    const pageControl = document.createElement("button");
    pageControl.textContent = "아모라에게 물어보기";
    document.body.insertBefore(pageControl, container);

    await act(async () => {
      root.render(<ChatSidePanel isOpen={false} onClose={onClose} presentation="docked" />);
      await Promise.resolve();
    });
    pageControl.focus();
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={onClose} presentation="docked" />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const region = container.querySelector<HTMLElement>('[role="complementary"]');
    expect(region?.getAttribute("aria-label")).toBe("아모라");
    expect(region?.hasAttribute("aria-modal")).toBe(false);
    expect(region?.hasAttribute("inert")).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // 라운지는 계속 스크롤된다.
    expect(document.body.style.overflow).toBe("");
    // 연 사람이 바로 쓰도록 입력칸이 초점을 받는다.
    const composer = container.querySelector<HTMLInputElement>("[data-amora-composer-input]");
    expect(document.activeElement).toBe(composer);

    // 라운지를 보던 사람의 Escape 는 가로채지 않는다.
    pageControl.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    // Tab 도 가두지 않는다.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(pageControl);

    composer?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // 초점이 안에 있을 때 닫히면 연 자리로 돌아간다.
    await act(async () => {
      root.render(<ChatSidePanel isOpen={false} onClose={onClose} presentation="docked" />);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(pageControl);
    pageControl.remove();
  });

  it("들고 온 질문은 입력칸에 한 번만 넣고, 보내지 않고, 쓰던 글을 덮지 않으며, 모델 첫 인사를 따로 부르지 않는다", async () => {
    const composer = () => container.querySelector<HTMLInputElement>("[data-amora-composer-input]");
    const typeIntoComposer = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer(), value);
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      root.render(<ChatSidePanel isOpen={false} onClose={vi.fn()} presentation="docked" />);
      await Promise.resolve();
    });
    // 대화 기록을 이미 불러온 상태에서 질문을 들고 연다. 이때 첫 인사가 먼저 나가면 안 된다.
    mocks.initialLoadDone = true;
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} presentation="docked" draft={{ id: 1, text: "드레스 준비, 지금 뭐부터 하면 될까?" }} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(composer()?.value).toBe("드레스 준비, 지금 뭐부터 하면 될까?");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.requestInitialGreeting).not.toHaveBeenCalled();

    // 사람이 지운 질문은 같은 번호로 다시 그려도 되살아나지 않는다.
    await typeIntoComposer("");
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} presentation="docked" draft={{ id: 1, text: "드레스 준비, 지금 뭐부터 하면 될까?" }} />);
      await Promise.resolve();
    });
    expect(composer()?.value).toBe("");

    // 새 질문을 들고 와도 쓰던 글은 덮지 않는다.
    await typeIntoComposer("내가 쓰던 글");
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} presentation="docked" draft={{ id: 2, text: "예산 다시 나눠 줘" }} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(composer()?.value).toBe("내가 쓰던 글");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("옆자리에서는 머리줄에 너비 조작을 더하고, 자동 스크롤이 라운지가 아니라 대화 목록만 움직인다", async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    mocks.messages = [{
      id: "m1", couple_id: "couple-1", sender_id: null, sender_role: "ai", visibility: "shared",
      content: "안녕하세요", metadata: {}, created_at: "2026-11-13T00:00:00.000Z",
    }];
    await act(async () => {
      root.render(
        <ChatSidePanel
          isOpen
          onClose={vi.fn()}
          presentation="docked"
          headerActions={<button type="button" aria-label="아모라 창 좁게 보기" />}
        />,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.querySelector('[role="complementary"] button[aria-label="아모라 창 좁게 보기"]')).not.toBeNull();
    scrollIntoView.mockClear();
    mocks.messages = [...mocks.messages, {
      id: "m2", couple_id: "couple-1", sender_id: null, sender_role: "ai", visibility: "shared",
      content: "다음 답", metadata: {}, created_at: "2026-11-13T00:00:01.000Z",
    }];
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} presentation="docked" />);
      await Promise.resolve();
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("yields keyboard handling to a checklist sheet and resumes after that sheet closes", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<ChatSidePanel isOpen onClose={onClose} />));
    const sheet = document.createElement("section");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("data-planning-sheet", "");
    const control = document.createElement("button");
    control.textContent = "항목 완료";
    sheet.appendChild(control);
    document.body.appendChild(sheet);
    control.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(control);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    sheet.remove();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps shared and private conversations visually separated and sends the selected private scope", async () => {
    mocks.messages = [
      {
        id: "shared-1",
        sender_id: "user-1",
        sender_role: "bride",
        content: "함께 볼 메시지",
        visibility: "shared",
        metadata: {},
        created_at: "2026-07-17T00:00:00.000Z",
      },
      {
        id: "private-1",
        sender_id: "user-1",
        sender_role: "bride",
        content: "나만 볼 메시지",
        visibility: "bride_private",
        metadata: {},
        created_at: "2026-07-17T00:01:00.000Z",
      },
    ];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("함께 볼 메시지");
    expect(container.textContent).not.toContain("나만 볼 메시지");

    const partnerTargetButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "상대방에게");
    await act(async () => {
      partnerTargetButton?.click();
      await Promise.resolve();
    });

    const privateScopeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    expect(privateScopeButton).toBeDefined();

    await act(async () => {
      privateScopeButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("현재 범위 · 나만 (상담)");
    expect(container.textContent).toContain("나만 볼 메시지");
    expect(container.textContent).not.toContain("함께 볼 메시지");
    expect(privateScopeButton?.getAttribute("aria-pressed")).toBe("true");
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .some((button) => button.textContent?.trim() === "상대방에게")).toBe(false);

    const input = container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    expect(input).not.toBeNull();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "개인 후속 질문");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="메시지 보내기"]');
    expect(sendButton).not.toBeNull();
    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: "개인 후속 질문",
      target: "ai",
      visibility: "bride_private",
    }));
  });

  it("truthfully hides only the shared conversation from this screen", async () => {
    mocks.messages = [{
      id: "shared-1",
      sender_id: "user-1",
      sender_role: "bride",
      content: "함께 볼 메시지",
      visibility: "shared",
      metadata: {},
      created_at: "2026-07-17T00:00:00.000Z",
    }];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const clearButton = container.querySelector<HTMLButtonElement>('button[title="대화 화면 정리"]');
    expect(clearButton).not.toBeNull();
    expect(clearButton?.getAttribute("aria-label")).toBe("현재 대화 범위를 내 화면에서 정리");
    await act(async () => {
      clearButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("함께 대화의 이전 메시지를 내 화면에서만 숨길까요?");
    expect(container.textContent).toContain("해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요.");
    expect(container.textContent).not.toContain("삭제");
    expect(container.textContent).not.toContain("초기화");
    const confirmButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "내 화면에서만 숨기기");
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(mocks.clearMessages).toHaveBeenCalledWith("couple-1", "view_reset_shared");
  });

  it("truthfully hides only the selected private conversation from this screen", async () => {
    mocks.messages = [{
      id: "private-1",
      sender_id: "user-1",
      sender_role: "bride",
      content: "나만 볼 메시지",
      visibility: "bride_private",
      metadata: {},
      created_at: "2026-07-17T00:01:00.000Z",
    }];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const privateScopeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    await act(async () => {
      privateScopeButton?.click();
      await Promise.resolve();
    });

    const clearButton = container.querySelector<HTMLButtonElement>('button[title="대화 화면 정리"]');
    expect(clearButton).not.toBeNull();
    expect(clearButton?.getAttribute("aria-label")).toBe("현재 대화 범위를 내 화면에서 정리");
    await act(async () => {
      clearButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("나만의 상담 이전 메시지를 내 화면에서만 숨길까요?");
    expect(container.textContent).toContain("해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요.");
    expect(container.textContent).not.toContain("삭제");
    expect(container.textContent).not.toContain("초기화");
    const confirmButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "내 화면에서만 숨기기");
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(mocks.clearMessages).toHaveBeenCalledWith("couple-1", "view_reset_private");
  });

  it("shows a failed private request only inside its original private scope", async () => {
    mocks.chatState.artifactVisibility = "bride_private";
    mocks.chatState.error = "개인 상담 답변을 받지 못했어요.";
    mocks.chatState.failedRequest = {
      canRetry: true,
      unavailableReason: null,
      visibility: "bride_private",
    };

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("개인 상담 답변을 받지 못했어요.");

    const privateScopeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    await act(async () => {
      privateScopeButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("개인 상담 답변을 받지 못했어요.");
  });

  it("shows error, retry, suggestions, and quota only in their artifact visibility", async () => {
    mocks.chatState.artifactVisibility = "bride_private";
    mocks.chatState.error = "개인 상담 일시 오류";
    mocks.chatState.quotaRemaining = 2;
    mocks.chatState.failedRequest = {
      canRetry: true,
      unavailableReason: null,
      visibility: "bride_private",
    };
    mocks.suggestions = ["개인 상담 후속 질문"];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("개인 상담 일시 오류");
    expect(container.textContent).not.toContain("개인 상담 후속 질문");
    expect(container.textContent).not.toContain("무료 상담이 2회 남았어요");
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .some((button) => button.textContent?.trim() === "다시 시도")).toBe(false);

    const privateScopeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    await act(async () => {
      privateScopeButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("개인 상담 일시 오류");
    expect(container.textContent).toContain("개인 상담 후속 질문");
    expect(container.textContent).toContain("무료 상담이 2회 남았어요");
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .some((button) => button.textContent?.trim() === "다시 시도")).toBe(true);
  });

  it("shows streaming output only in its artifact visibility", async () => {
    mocks.chatState.artifactVisibility = "bride_private";
    mocks.chatState.isStreaming = true;
    mocks.chatState.streamingContent = "개인 상담 스트리밍";
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="streaming-bubble"]')).toBeNull();

    mocks.chatState.isStreaming = false;
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    const privateScopeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    await act(async () => {
      privateScopeButton?.click();
      await Promise.resolve();
    });

    mocks.chatState.isStreaming = true;
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="streaming-bubble"]')?.textContent)
      .toContain("개인 상담 스트리밍");
  });

  it("fails closed when the signed-in profile has no verified couple role", async () => {
    mocks.profileRole = null;
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const privateScopeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    expect(privateScopeButton?.disabled).toBe(true);

    await act(async () => {
      privateScopeButton?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("현재 범위 · 함께 대화");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps unsent composer drafts inside the scope where they were written", async () => {
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    const typeIntoComposer = async (value: string) => {
      const input = container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(input, value);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await act(async () => {
      findButton("나만 (상담)")?.click();
      await Promise.resolve();
    });
    await typeIntoComposer("개인 상담 초안");

    await act(async () => {
      findButton("함께 대화")?.click();
      await Promise.resolve();
    });
    expect(container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]')?.value).toBe("");
    await typeIntoComposer("함께 대화 초안");

    await act(async () => {
      findButton("나만 (상담)")?.click();
      await Promise.resolve();
    });
    expect(container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]')?.value)
      .toBe("개인 상담 초안");
  });

  it.each(["shared", "private"])("recovers an unsent %s text after panel remount without sending it", async lane => {
    const findButton = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.textContent?.includes(label));
    const composer = () => container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    if (lane === "private") await act(async () => findButton("나만 (상담)")?.click());
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer(), `${lane} 미전송 초안`);
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<ChatSidePanel isOpen onClose={vi.fn()} />));
    if (lane === "private") await act(async () => findButton("나만 (상담)")?.click());
    expect(composer()?.value).toBe(`${lane} 미전송 초안`);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(container.textContent).toContain("전송·공유되지는 않으며");
  });
  it("does not recover a partial text-only request while an attachment is still being read", async () => {
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(() => {});
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "파일 내용도 함께 확인해줘");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["draft"], "contract.pdf", { type: "application/pdf" })] });
    await act(async () => fileInput?.dispatchEvent(new Event("change", { bubbles: true })));
    expect(sessionStorage.getItem("hanbang:amora-text-drafts:v1:panel")).toBeNull();
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<ChatSidePanel isOpen onClose={vi.fn()} />));
    expect(container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]')?.value).toBe("");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps shared drafts inside the recipient where they were written", async () => {
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    const composer = () => container.querySelector<HTMLInputElement>(
      'input[aria-label="메시지 입력"]',
    );
    const typeIntoComposer = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(composer(), value);
        composer()?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await typeIntoComposer("아모라에게 보낼 초안");

    await act(async () => {
      findButton("상대방에게")?.click();
      await Promise.resolve();
    });
    expect(composer()?.value).toBe("");

    await typeIntoComposer("상대방에게 보낼 초안");

    await act(async () => {
      findButton("아모라에게")?.click();
      await Promise.resolve();
    });
    expect(composer()?.value).toBe("아모라에게 보낼 초안");
  });

  it("sends only the selected recipient draft and preserves the other shared draft", async () => {
    mocks.sendMessage.mockResolvedValue(undefined);
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    const composer = () => container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    const typeIntoComposer = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(composer(), value);
        composer()?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await typeIntoComposer("아모라에게 남길 초안");
    await act(async () => findButton("상대방에게")?.click());
    await typeIntoComposer("상대방에게 보낼 내용");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="메시지 보내기"]')?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "상대방에게 보낼 내용",
      target: "partner",
      visibility: "shared",
    }));
    expect(composer()?.value).toBe("");

    await act(async () => findButton("아모라에게")?.click());
    expect(composer()?.value).toBe("아모라에게 남길 초안");
  });

  it("blocks non-image attachments before reading them in the partner lane", async () => {
    const readAsDataUrl = vi.spyOn(FileReader.prototype, "readAsDataURL");
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    await act(async () => {
      findButton("상대방에게")?.click();
      await Promise.resolve();
    });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput?.accept).not.toContain("application/pdf");
    const file = new File(["contract"], "partner-contract.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });

    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(readAsDataUrl).not.toHaveBeenCalled();
    expect(mocks.setChatState).toHaveBeenCalledWith(expect.objectContaining({
      artifactVisibility: "shared",
      error: "파트너에게 보내는 첨부파일은 이미지 형식만 지원해요.",
    }));
  });

  it("asks the partner to confirm an attachment-only image instead of analyze it", async () => {
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (
      this: FileReader,
    ) {
      Object.defineProperty(this, "result", {
        configurable: true,
        value: "data:image/png;base64,aW1hZ2U=",
      });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    await act(async () => {
      findButton("상대방에게")?.click();
      await Promise.resolve();
    });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["image"], "partner-image.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="메시지 보내기"]',
      )?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "이 이미지를 확인해주세요.",
      target: "partner",
      images: [expect.objectContaining({ fileName: "partner-image.png" })],
    }));
  });

  it("never offers an Amora reply suggestion while the recipient is the partner", async () => {
    mocks.suggestions = ["예산부터 정리할게요"];
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    expect(findButton("예산부터 정리할게요")).toBeDefined();

    await act(async () => {
      findButton("상대방에게")?.click();
      await Promise.resolve();
    });

    expect(findButton("예산부터 정리할게요")).toBeUndefined();
  });

  it("scopes demo welcome suggestions to the shared artifact visibility", async () => {
    mocks.isDemo = true;
    mocks.setChatState.mockClear();
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const stateUpdater = mocks.setChatState.mock.calls
      .map(([nextState]) => nextState)
      .find((nextState) => typeof nextState === "function") as ((state: {
        messages: typeof mocks.messages;
        suggestions: string[];
      }) => Record<string, unknown>) | undefined;
    expect(stateUpdater).toBeDefined();
    expect(stateUpdater?.({ messages: [], suggestions: [] })).toEqual(expect.objectContaining({
      artifactVisibility: "shared",
    }));
  });

  it("always sends vendor-card follow-ups to Amora even in the partner composer lane", async () => {
    mocks.messages = [{
      id: "vendor-result",
      sender_id: null,
      sender_role: "ai",
      content: "업체를 찾았어요.",
      visibility: "shared",
      metadata: {
        target: "ai",
        toolResults: [{
          toolName: "search_vendors",
          success: true,
          toolInput: { category: "스튜디오" },
          toolOutput: { vendors: [] },
        }],
      },
      created_at: "2026-07-31T00:00:00.000Z",
    }];
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));

    await act(async () => {
      findButton("상대방에게")?.click();
      await Promise.resolve();
      findButton("업체 카드 후속 질문")?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "업체 카드 후속 질문",
      target: "ai",
      visibility: "shared",
    }));
  });

  it("keeps a delayed file read in the delivery lane where selection started", async () => {
    const pendingReaders: FileReader[] = [];
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      pendingReaders.push(this);
    });
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    const attachedFile = () => container.querySelector<HTMLButtonElement>(
      'button[aria-label="amora-contract.pdf 첨부 제거"]',
    );
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["contract"], "amora-contract.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });

    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(pendingReaders).toHaveLength(1);
    expect(findButton("상대방에게")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(
      'button[aria-label="파일 첨부"]',
    )?.disabled).toBe(true);

    await act(async () => {
      Object.defineProperty(pendingReaders[0], "result", {
        configurable: true,
        value: "data:application/pdf;base64,Y29udHJhY3Q=",
      });
      pendingReaders[0].onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });

    expect(attachedFile()).not.toBeNull();
    expect(findButton("상대방에게")?.disabled).toBe(false);
    await act(async () => findButton("상대방에게")?.click());
    expect(attachedFile()).toBeNull();
    await act(async () => findButton("아모라에게")?.click());
    expect(attachedFile()).not.toBeNull();
  });

  it("clears all composer lanes and retry state when the profile or couple changes", async () => {
    const retryId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    mocks.sendMessage
      .mockResolvedValueOnce({ userMessage: "persistence_unknown", clientRequestId: retryId })
      .mockResolvedValueOnce({ userMessage: "persisted", userMessageId: "new-session" });
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    const composer = () => container.querySelector<HTMLInputElement>(
      'input[aria-label="메시지 입력"]',
    );
    const typeIntoComposer = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(composer(), value);
        composer()?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await typeIntoComposer("이전 계정 AI 초안");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="메시지 보내기"]')?.click();
      await Promise.resolve();
    });
    await act(async () => findButton("상대방에게")?.click());
    await typeIntoComposer("이전 계정 파트너 초안");
    await act(async () => findButton("나만 (상담)")?.click());
    await typeIntoComposer("이전 계정 개인 초안");

    mocks.profileId = "user-new";
    mocks.coupleId = "couple-new";
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("현재 범위 · 함께 대화");
    expect(composer()?.value).toBe("");
    await act(async () => findButton("상대방에게")?.click());
    expect(composer()?.value).toBe("");
    await act(async () => findButton("나만 (상담)")?.click());
    expect(composer()?.value).toBe("");
    await act(async () => findButton("함께 대화")?.click());
    await typeIntoComposer("새 계정 질문");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="메시지 보내기"]')?.click();
      await Promise.resolve();
    });

    const latestSend = mocks.sendMessage.mock.calls.at(-1)?.[0];
    expect(latestSend).not.toHaveProperty("clientRequestId");
    expect(latestSend).toEqual(expect.objectContaining({
      content: "새 계정 질문",
      coupleId: "couple-new",
      senderId: "user-new",
    }));
  });

  it("clears private drafts when the verified couple role changes", async () => {
    const privateScopeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    await act(async () => privateScopeButton?.click());
    const composer = () => container.querySelector<HTMLInputElement>(
      'input[aria-label="메시지 입력"]',
    );
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer(), "신부 역할의 개인 초안");
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    mocks.profileRole = "groom";
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    // 2026-09-26: 같은 계정이 위쪽 탭으로 '나만'을 골랐으므로 역할이 바뀐 뒤에도 그 칸으로 다시
    // 연다(기억은 계정별이다). 예전에는 '함께'로 되돌아갔다. 재는 것은 그대로 — 이전 역할의
    // 나만 초안이 새 역할의 나만 입력창에 남지 않는다.
    expect(container.textContent).toContain("현재 범위 · 나만 (상담)");
    expect(composer()?.value).toBe("");
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("나만 (상담)"))
        ?.click();
    });
    expect(composer()?.value).toBe("");
  });

  it("can request an initial greeting again after the couple identity changes", async () => {
    mocks.initialLoadDone = true;
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    expect(mocks.requestInitialGreeting).toHaveBeenCalledTimes(1);

    mocks.coupleId = "couple-new";
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(mocks.requestInitialGreeting).toHaveBeenCalledTimes(2);
    expect(mocks.requestInitialGreeting).toHaveBeenLastCalledWith(expect.objectContaining({
      coupleId: "couple-new",
    }));
  });

  it("shows Amora's own first hello instead of asking the model for a second greeting", async () => {
    // 첫 실행 안내 직후에는 아모라가 이미 먼저 말을 걸어뒀다. 여기서 인사를 또
    // 요청하면 같은 자리에 인사가 두 번 뜬다.
    mocks.initialLoadDone = true;
    await act(async () => {
      root.render(
        <ChatSidePanel
          isOpen
          onClose={vi.fn()}
          firstHello={"안녕하세요, 아모라예요.\n\n오늘은 딱 한 가지만 정해볼까요?"}
        />,
      );
      await Promise.resolve();
    });

    expect(mocks.requestInitialGreeting).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="amora-first-hello-message"]')).not.toBeNull();
    expect(container.textContent).toContain("오늘은 딱 한 가지만 정해볼까요?");
  });

  it("invalidates a pending file read when the profile or couple changes", async () => {
    const pendingReaders: FileReader[] = [];
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      pendingReaders.push(this);
    });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["old"], "old-account.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector<HTMLButtonElement>(
      'button[aria-label="파일 첨부"]',
    )?.disabled).toBe(true);

    mocks.profileId = "user-new";
    mocks.coupleId = "couple-new";
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    expect(container.querySelector<HTMLButtonElement>(
      'button[aria-label="파일 첨부"]',
    )?.disabled).toBe(false);

    await act(async () => {
      Object.defineProperty(pendingReaders[0], "result", {
        configurable: true,
        value: "data:application/pdf;base64,b2xk",
      });
      pendingReaders[0].onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });
    expect(container.textContent).not.toContain("old-account.pdf");
  });

  it("fails closed to Amora and discards the old-recipient draft when the verified link disappears", async () => {
    const pendingReaders: FileReader[] = [];
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      pendingReaders.push(this);
    });
    const findButton = (label: string) => Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(label));
    await act(async () => findButton("상대방에게")?.click());
    const composer = () => container.querySelector<HTMLInputElement>(
      'input[aria-label="메시지 입력"]',
    );
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer(), "연결 해제된 파트너 초안");
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
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

    mocks.hasLinkedPartner = false;
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(findButton("상대방에게")).toBeUndefined();
    expect(composer()?.value).toBe("");
    expect(composer()?.placeholder).toContain("결혼 준비");
    expect(mocks.setChatState).toHaveBeenCalledWith(expect.objectContaining({
      artifactVisibility: "shared",
      error: expect.stringContaining("안전을 위해 삭제"),
    }));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    await act(async () => {
      Object.defineProperty(pendingReaders[0], "result", {
        configurable: true,
        value: "data:image/png;base64,b2xk",
      });
      pendingReaders[0].onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });

    mocks.hasLinkedPartner = true;
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    await act(async () => findButton("상대방에게")?.click());
    expect(composer()?.value).toBe("");
    expect(container.textContent).not.toContain("old-recipient.png");
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
    const composer = () => container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer(), "복구해야 하는 질문");
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["restore"], "restore-sidepanel.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="메시지 보내기"]')?.click();
      await Promise.resolve();
    });

    expect(composer()?.value).toBe("복구해야 하는 질문");
    expect(container.querySelector(
      'button[aria-label="restore-sidepanel.pdf 첨부 제거"]',
    )).not.toBeNull();
  });

  it("does not consume a typed draft when sending a separate Amora suggestion", async () => {
    const composer = () => container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer(), "직접 쓰던 사이드패널 초안");
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.suggestions = ["추천 답장만 보내기"];
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    const suggestion = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("추천 답장만 보내기"));

    await act(async () => {
      suggestion?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      content: "추천 답장만 보내기",
      images: undefined,
      target: "ai",
    }));
    expect(composer()?.value).toBe("직접 쓰던 사이드패널 초안");
  });

  it("reuses the same idempotency key after an unknown persistence result", async () => {
    const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    mocks.sendMessage
      .mockResolvedValueOnce({ userMessage: "persistence_unknown", clientRequestId: requestId })
      .mockResolvedValueOnce({ userMessage: "persisted", userMessageId: "user-message-2" });
    const composer = () => container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer(), "사이드패널도 같은 키로 확인해줘");
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = () => container.querySelector<HTMLButtonElement>(
      'button[aria-label="메시지 보내기"]',
    );

    await act(async () => {
      send()?.click();
      await Promise.resolve();
    });
    expect(composer()?.value).toBe("사이드패널도 같은 키로 확인해줘");

    await act(async () => {
      send()?.click();
      await Promise.resolve();
    });
    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      clientRequestId: requestId,
    }));
    expect(composer()?.value).toBe("");
  });

  it.each([
    {
      label: "busy",
      secondOutcome: { userMessage: "not_persisted", reason: "busy" },
      expectedRetryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    {
      label: "not_persisted result key",
      secondOutcome: {
        userMessage: "not_persisted",
        reason: "storage",
        clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
      expectedRetryId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
    {
      label: "thrown send",
      secondOutcome: new Error("network unavailable"),
      expectedRetryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  ])("preserves the submitted retry id after $label", async ({
    secondOutcome,
    expectedRetryId,
  }) => {
    const originalRetryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockResolvedValueOnce({
      userMessage: "persistence_unknown",
      clientRequestId: originalRetryId,
    });
    if (secondOutcome instanceof Error) {
      mocks.sendMessage.mockRejectedValueOnce(secondOutcome);
    } else {
      mocks.sendMessage.mockResolvedValueOnce(secondOutcome);
    }
    mocks.sendMessage.mockResolvedValueOnce({
      userMessage: "persisted",
      userMessageId: "retry-finished",
    });
    const composer = () => container.querySelector<HTMLInputElement>(
      'input[aria-label="메시지 입력"]',
    );
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(composer(), "같은 요청인지 확인해줘");
      composer()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const clickSend = async () => {
      await act(async () => {
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="메시지 보내기"]',
        )?.click();
        await Promise.resolve();
      });
    };

    await clickSend();
    await clickSend();
    expect(composer()?.value).toBe("같은 요청인지 확인해줘");
    await clickSend();

    expect(mocks.sendMessage).toHaveBeenNthCalledWith(3, expect.objectContaining({
      clientRequestId: expectedRetryId,
    }));
  });

  it("uses the verified groom-private visibility without falling back to bride-private", async () => {
    mocks.profileRole = "groom";
    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const privateScopeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    await act(async () => {
      privateScopeButton?.click();
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "신랑 개인 질문");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="메시지 보내기"]')?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      senderRole: "groom",
      visibility: "groom_private",
    }));
  });

  it("applies the latest valid shared Amora proposal with its exact server action id", async () => {
    const issuedAt = Date.now() - 1_000;
    const actionId = "123e4567-e89b-42d3-a456-426614174000";
    mocks.messages = [{
      id: "proposal-1",
      sender_id: null,
      sender_role: "ai",
      content: "예산 항목을 추가해 둘게요.",
      visibility: "shared",
      metadata: {
        target: "ai",
        pending_amora_action: {
          version: 2,
          actionId,
          tool: "add_custom_category",
          input: { label: "추가 예산" },
          ...pendingIdentity("add_custom_category", { label: "추가 예산" }),
          confirmation: "예식장 예산에 300만 원을 추가할까요?",
          issuedAt,
          expiresAt: issuedAt + 24 * 60 * 60 * 1_000,
        },
      },
      created_at: new Date(issuedAt).toISOString(),
    }];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("예식장 예산에 300만 원을 추가할까요?");
    const applyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="변경 내용 확인하기"]',
    );
    expect(applyButton?.disabled).toBe(false);

    await act(async () => {
      applyButton?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[data-amora-confirm]')?.click());
    await vi.waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        content: "좋아요. 제안한 변경을 적용해 주세요.",
        target: "ai",
        visibility: "shared",
        confirmedActionId: actionId,
      }));
    });
  });

  it("gives a portal review sheet keyboard control while preserving the parent panel", async () => {
    const issuedAt = Date.now() - 1_000;
    mocks.messages = [{
      id: "proposal-keyboard",
      sender_id: null,
      sender_role: "ai",
      content: "예산을 확인해 주세요.",
      visibility: "shared",
      metadata: {
        target: "ai",
        pending_amora_action: {
          version: 2,
          actionId: "123e4567-e89b-42d3-a456-426614174010",
          tool: "update_budget",
          input: { totalBudget: 30_000_000 },
          ...pendingIdentity("update_budget", { totalBudget: 30_000_000 }),
          confirmation: "총예산을 3,000만 원으로 변경할까요?",
          issuedAt,
          expiresAt: issuedAt + 24 * 60 * 60 * 1_000,
        },
      },
      created_at: new Date(issuedAt).toISOString(),
    }];
    const onClose = vi.fn();
    await act(async () => root.render(<ChatSidePanel isOpen onClose={onClose} />));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    trigger.focus();
    await act(async () => trigger.click());
    const sheet = document.querySelector<HTMLElement>('[role="dialog"] button[data-amora-confirm]')!.closest('[role="dialog"]')!;
    const confirm = sheet.querySelector<HTMLButtonElement>('button[data-amora-confirm]')!;
    confirm.focus();
    const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => document.dispatchEvent(forward));
    // JSDOM은 기본 Tab 이동을 실행하지 않는다. 부모가 가로채지 않아야 브라우저가 다음 버튼으로 이동한다.
    expect(forward.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(confirm);
    const backwards = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => document.dispatchEvent(backwards));
    expect(backwards.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(confirm);

    let resolveClaim!: (response: Response) => void;
    mocks.applicationFetch.mockReturnValueOnce(new Promise((resolve) => { resolveClaim = resolve; }));
    await act(async () => confirm.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.isConnected).toBe(true);
    await act(async () => resolveClaim(new Response(JSON.stringify({ error: "다시 확인해 주세요." }), { status: 409 })));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(sheet.isConnected).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => trigger.click());
    await act(async () => root.unmount());
    // 경로 이동처럼 부모와 시트를 함께 없애도 스크롤 잠금이 남지 않는다.
    expect(document.body.style.overflow).not.toBe("hidden");
    root = createRoot(container);
  });

  it("fails closed when a newer shared Amora-context message follows the proposal", async () => {
    const issuedAt = Date.now() - 1_000;
    const actionId = "123e4567-e89b-42d3-a456-426614174001";
    mocks.messages = [
      {
        id: "proposal-1",
        sender_id: null,
        sender_role: "ai",
        content: "일정을 추가할 수 있어요.",
        visibility: "shared",
        metadata: {
          target: "ai",
          pending_amora_action: {
            version: 2,
            actionId,
            tool: "add_schedule_event",
            input: {
              date: "2026-08-01",
              title: "드레스 투어",
              schedule_scope: "confirmed_fact",
            },
            ...pendingIdentity("add_schedule_event", {
              date: "2026-08-01",
              title: "드레스 투어",
              schedule_scope: "confirmed_fact",
            }),
            confirmation: "드레스 투어 일정을 추가할까요?",
            issuedAt,
            expiresAt: issuedAt + 24 * 60 * 60 * 1_000,
          },
        },
        created_at: new Date(issuedAt).toISOString(),
      },
      {
        id: "new-context-1",
        sender_id: "user-1",
        sender_role: "bride",
        content: "잠깐, 날짜를 다시 볼게.",
        visibility: "shared",
        metadata: { target: "ai" },
        created_at: new Date(issuedAt + 500).toISOString(),
      },
    ];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const applyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="변경 내용 확인하기"]',
    );
    expect(applyButton?.disabled).toBe(true);
    expect(container.textContent).toContain("새 대화가 이어져 이 제안은 적용할 수 없어요.");

    await act(async () => {
      applyButton?.click();
      await Promise.resolve();
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("does not invalidate a current proposal when partners only message each other", async () => {
    const issuedAt = Date.now() - 1_000;
    const actionId = "123e4567-e89b-42d3-a456-426614174002";
    mocks.messages = [
      {
        id: "proposal-1",
        sender_id: null,
        sender_role: "ai",
        content: "예산 변경을 준비했어요.",
        visibility: "shared",
        metadata: {
          target: "ai",
          pending_amora_action: {
            version: 2,
            actionId,
            tool: "add_schedule_event",
            input: {
              date: "2026-08-01",
              title: "드레스 투어",
              schedule_scope: "confirmed_fact",
            },
            ...pendingIdentity("add_schedule_event", {
              date: "2026-08-01",
              title: "드레스 투어",
              schedule_scope: "confirmed_fact",
            }),
            confirmation: "드레스 투어 일정을 추가할까요?",
            issuedAt,
            expiresAt: issuedAt + 24 * 60 * 60 * 1_000,
          },
        },
        created_at: new Date(issuedAt).toISOString(),
      },
      {
        id: "partner-only-1",
        sender_id: "user-1",
        sender_role: "bride",
        content: "이건 우리끼리 이야기하자.",
        visibility: "shared",
        metadata: { target: "partner" },
        created_at: new Date(issuedAt + 500).toISOString(),
      },
    ];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const applyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="변경 내용 확인하기"]',
    );
    expect(applyButton?.disabled).toBe(false);
    await act(async () => {
      applyButton?.click();
      await Promise.resolve();
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[data-amora-confirm]')?.click());
    await vi.waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        confirmedActionId: actionId,
      }));
    });
  });

  it("never renders an executable action from private-message metadata", async () => {
    const issuedAt = Date.now() - 1_000;
    mocks.messages = [{
      id: "private-proposal-1",
      sender_id: null,
      sender_role: "ai",
      content: "개인 상담 제안",
      visibility: "bride_private",
      metadata: {
        target: "ai",
        pending_amora_action: {
          version: 2,
          actionId: "123e4567-e89b-42d3-a456-426614174003",
          tool: "update_budget",
          input: { amount: 20_000_000 },
          ...pendingIdentity("update_budget", { amount: 20_000_000 }),
          confirmation: "총예산을 바꿀까요?",
          issuedAt,
          expiresAt: issuedAt + 24 * 60 * 60 * 1_000,
        },
      },
      created_at: new Date(issuedAt).toISOString(),
    }];

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    const privateScopeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("나만 (상담)"));
    await act(async () => {
      privateScopeButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("개인 상담 제안");
    expect(container.querySelector('button[aria-label="변경 내용 확인하기"]')).toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
