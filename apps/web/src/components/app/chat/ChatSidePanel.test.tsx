import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatSidePanel from "./ChatSidePanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  loadMessages: vi.fn(),
  requestInitialGreeting: vi.fn(),
  clearMessages: vi.fn(),
  subscribeToMessages: vi.fn(() => vi.fn()),
  retryFailedMessage: vi.fn(),
  dismissFailedMessageRetry: vi.fn(),
  setChatState: vi.fn(),
  messages: [] as Array<{
    id: string;
    sender_id: string | null;
    sender_role: "bride" | "groom" | "ai";
    content: string;
    visibility: "shared" | "bride_private" | "groom_private";
    metadata: Record<string, unknown>;
    created_at: string;
  }>,
  profileRole: "bride" as "bride" | "groom" | null,
  push: vi.fn(),
  chatState: {
    error: null as string | null,
    failedRequest: null as null | {
      canRetry: boolean;
      unavailableReason: string | null;
      visibility: "shared" | "bride_private" | "groom_private";
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    profile: { id: "user-1", role: mocks.profileRole, name: "테스트" },
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
      error: mocks.chatState.error,
      failedRequest: mocks.chatState.failedRequest,
      isRetrying: false,
      initialLoadDone: false,
      loadMessages: mocks.loadMessages,
      sendMessage: mocks.sendMessage,
      requestInitialGreeting: mocks.requestInitialGreeting,
      clearMessages: mocks.clearMessages,
      subscribeToMessages: mocks.subscribeToMessages,
      retryFailedMessage: mocks.retryFailedMessage,
      dismissFailedMessageRetry: mocks.dismissFailedMessageRetry,
    }),
    {
      setState: mocks.setChatState,
      getState: () => ({
        messages: mocks.messages,
        isStreaming: false,
        isSending: false,
      }),
    },
  );
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

describe("ChatSidePanel attachment sending", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.messages = [];
    mocks.profileRole = "bride";
    mocks.chatState.error = null;
    mocks.chatState.failedRequest = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    HTMLElement.prototype.scrollIntoView = vi.fn();

    await act(async () => {
      root.render(<ChatSidePanel isOpen onClose={vi.fn()} />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("sends a document attachment even when the text input is empty", async () => {
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, "result", {
        configurable: true,
        value: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==",
      });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const file = new File(["contract"], "contract.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });

    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("docx");

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
        fileName: "contract.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })],
    }));
  });

  it("rejects PDF before FileReader can retain its original bytes", async () => {
    const readSpy = vi.spyOn(FileReader.prototype, "readAsDataURL");
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["contract"], "contract.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });

    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mocks.setChatState).toHaveBeenCalledWith({
      error: expect.stringContaining("PDF"),
    });
    expect(readSpy).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("offers an explicit provider-only retry and a close action", async () => {
    mocks.chatState.error = "AI 응답을 받지 못했습니다.";
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

  it("clears only the currently selected private conversation", async () => {
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

    const clearButton = container.querySelector<HTMLButtonElement>('button[title="대화 초기화"]');
    expect(clearButton).not.toBeNull();
    await act(async () => {
      clearButton?.click();
      await Promise.resolve();
    });

    const confirmButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "삭제");
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(mocks.clearMessages).toHaveBeenCalledWith("couple-1", "view_reset_private");
  });

  it("shows a failed private request only inside its original private scope", async () => {
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
          version: 1,
          actionId,
          tool: "add_budget_item",
          input: { category: "venue", amount: 3_000_000 },
          confirmation: "예식장 예산에 300만 원을 추가할까요?",
          issuedAt,
          expiresAt: issuedAt + 10 * 60 * 1_000,
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
      'button[aria-label="확인한 내용을 이대로 적용"]',
    );
    expect(applyButton?.disabled).toBe(false);

    await act(async () => {
      applyButton?.click();
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: "좋아요. 제안한 변경을 적용해 주세요.",
      target: "ai",
      visibility: "shared",
      confirmedActionId: actionId,
    }));
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
            version: 1,
            actionId,
            tool: "create_schedule",
            input: { title: "드레스 투어" },
            confirmation: "드레스 투어 일정을 추가할까요?",
            issuedAt,
            expiresAt: issuedAt + 10 * 60 * 1_000,
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
      'button[aria-label="확인한 내용을 이대로 적용"]',
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
            version: 1,
            actionId,
            tool: "update_budget",
            input: { amount: 20_000_000 },
            confirmation: "총예산을 2천만 원으로 바꿀까요?",
            issuedAt,
            expiresAt: issuedAt + 10 * 60 * 1_000,
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
      'button[aria-label="확인한 내용을 이대로 적용"]',
    );
    expect(applyButton?.disabled).toBe(false);
    await act(async () => {
      applyButton?.click();
      await Promise.resolve();
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      confirmedActionId: actionId,
    }));
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
          version: 1,
          actionId: "123e4567-e89b-42d3-a456-426614174003",
          tool: "update_budget",
          input: { amount: 20_000_000 },
          confirmation: "총예산을 바꿀까요?",
          issuedAt,
          expiresAt: issuedAt + 10 * 60 * 1_000,
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
    expect(container.querySelector('button[aria-label="확인한 내용을 이대로 적용"]')).toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
