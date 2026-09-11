import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/types/database.types";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import { getAmoraPendingActionTtlMs } from "@/lib/ai/amoraActionApprovalPolicy";

// 기존 ChatContent fixture의 스토어 경계만 사용하고 제안 카드·확인 시트는 실제로 연다.
const mocks = vi.hoisted(() => ({
  profileId: "user-1", coupleId: "couple-1", messages: [] as ChatMessage[],
  sendMessage: vi.fn(), idle: vi.fn(), subscribe: vi.fn(() => vi.fn()),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: mocks.idle, push: mocks.idle }),
}));
vi.mock("@/stores/authStore", () => {
  const read = () => ({
    user: { id: mocks.profileId },
    profile: { id: mocks.profileId, role: "bride", name: "테스트", couple_id: mocks.coupleId },
    couple: { id: mocks.coupleId, bride_id: mocks.profileId, groom_id: "user-2" },
    journey: null, partner: null, isDemo: false, isInitialized: true, isLoading: false,
  });
  return { useAuthStore: Object.assign(read, { getState: read }) };
});
vi.mock("@/stores/chatStore", () => {
  const state = {
    get messages() { return mocks.messages; },
    isStreaming: false, isSending: false, streamingContent: "", streamingToolResults: [],
    suggestions: [], error: null, failedRequest: null, artifactVisibility: "shared",
    isRetrying: false, quotaRemaining: null, initialLoadDone: true, presence: { partnerTyping: null },
    sendMessage: mocks.sendMessage, loadMessages: mocks.idle, requestInitialGreeting: mocks.idle,
    requestMediation: mocks.idle, clearMessages: mocks.idle, subscribeToMessages: mocks.subscribe,
    pollNewMessages: mocks.idle, notifyTyping: mocks.idle, stopTyping: mocks.idle,
    requestSharedClear: mocks.idle, retryFailedMessage: mocks.idle, dismissFailedMessageRetry: mocks.idle,
  };
  return { useChatStore: Object.assign(() => state, { getState: () => state, setState: mocks.idle }) };
});
vi.mock("@/hooks/useAmoraPersonalization", () => ({
  useAmoraPersonalization: () => ({ profile: null, status: "ready", saving: false, error: null, save: mocks.idle }),
}));
vi.mock("@/lib/care/requestProactiveCare", () => ({ requestProactiveCare: vi.fn() }));
vi.mock("./ChatBubble", () => ({ default: () => <div /> }));

import ChatContent from "./ChatContent";

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

describe("제안을 나중에 정할 때 대화 초점", () => {
  let root: Root;
  let container: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let frameId: number;

  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.profileId = "user-1";
    mocks.coupleId = "couple-1";
    const input = { date: "2027-02-01", title: "드레스 피팅", schedule_scope: "confirmed_fact" };
    const identity = getAmoraToolOperationIdentity("add_schedule_event", input);
    const issuedAt = Date.now() - 1_000;
    mocks.messages = [{
      id: "dismiss-focus-message", couple_id: "couple-1", sender_id: null, sender_role: "ai",
      visibility: "shared", content: "일정을 확인해 주세요.", created_at: new Date().toISOString(),
      metadata: { pending_amora_action: {
        version: 2, actionId: "22222222-2222-4222-8222-222222222222", tool: "add_schedule_event",
        input, inputDigest: identity.inputDigest, operationKey: identity.operationKey,
        confirmation: "드레스 피팅 일정을 추가할까요?",
        issuedAt, expiresAt: issuedAt + getAmoraPendingActionTtlMs("add_schedule_event", input),
      } },
    }];
    window.sessionStorage.clear();
    window.localStorage.clear();
    frames = new Map();
    frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function render() {
    await act(async () => root.render(<ChatContent />));
  }

  async function flushFrames() {
    const pending = [...frames.values()];
    frames.clear();
    await act(async () => pending.forEach(callback => callback(performance.now())));
  }

  function button(label: string, scope: ParentNode = document) {
    const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label);
    expect(found, label).toBeDefined();
    return found!;
  }

  async function deferFromSheet() {
    await render();
    await flushFrames();
    const trigger = button("내용 확인하기");
    trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector('[data-amora-sheet][role="dialog"]');
    expect(dialog).not.toBeNull();
    const defer = button("나중에 정하기", dialog!);
    defer.focus();
    await act(async () => defer.click());
    expect(document.querySelector("[data-amora-sheet]")).toBeNull();
    expect(trigger.isConnected).toBe(false);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    return container.querySelector<HTMLTextAreaElement>("textarea")!;
  }

  it("실제 확인 시트에서 제안을 미루면 없어진 카드 대신 입력창으로 돌아간다", async () => {
    const composer = await deferFromSheet();
    await flushFrames();
    expect(document.activeElement).toBe(composer);
  });

  it("카드에서 바로 적용하지 않기를 선택해도 입력창으로 돌아간다", async () => {
    await render();
    await flushFrames();
    const dismiss = button("지금은 적용하지 않기");
    dismiss.focus();
    await act(async () => dismiss.click());
    await flushFrames();
    expect(document.activeElement).toBe(container.querySelector("textarea"));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("명시 배분 카드를 잠시 숨겨도 새 답변에 다시 실린 같은 카드는 확인할 수 있다", async () => {
    const input = {
      total_budget: 35_000_000, allocation_mode: "explicit",
      allocations: [{ category: "studio", budget: 2_999_000 }, { category: "dress", budget: 3_001_000 }],
      intake_summary: "두 항목만 옮기고 나머지 유지",
    };
    const { inputDigest, operationKey } = getAmoraToolOperationIdentity("apply_budget_plan", input);
    const original = mocks.messages[0];
    const action = {
      ...original.metadata!.pending_amora_action!, tool: "apply_budget_plan", input, inputDigest, operationKey,
      confirmation: "두 항목 배분을 변경할까요?",
    };
    mocks.messages = [
      { ...original, metadata: { pending_amora_action: action } },
      { ...original, id: "first-carry", metadata: { pending_amora_action: action } },
    ];
    await render();
    await act(async () => button("지금은 적용하지 않기").click());
    expect(container.textContent).not.toContain("내용 확인하기");
    await render();
    expect(container.textContent).not.toContain("내용 확인하기");

    mocks.messages = [...mocks.messages,
      { ...original, id: "new-request", sender_role: "bride", sender_id: mocks.profileId, metadata: null, content: "아직 적용하지 말고 같은 변경 내용을 다시 보여줘." },
      { ...original, id: "new-carry", metadata: { pending_amora_action: action } },
    ];
    await render();
    const triggers = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(item => item.textContent?.trim() === "내용 확인하기");
    expect(triggers).toHaveLength(1);
    expect(triggers[0].disabled).toBe(false);
    await act(async () => triggers[0].click());
    expect(document.querySelector('[data-amora-sheet][role="dialog"]')).not.toBeNull();
    expect(mocks.messages.at(-1)?.metadata?.pending_amora_action).toEqual(action);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("다른 조작으로 옮긴 초점을 입력창이 가져오지 않는다", async () => {
    await deferFromSheet();
    const target = button("상대방에게");
    target.focus();
    await flushFrames();
    expect(document.activeElement).toBe(target);
  });

  it("다른 곳에 초점을 옮겼다가 해제해도 이전 제안이 입력창 초점을 되찾지 않는다", async () => {
    await deferFromSheet();
    const target = button("상대방에게");
    target.focus();
    target.blur();
    await flushFrames();
    expect(document.activeElement).not.toBe(container.querySelector("textarea"));
  });

  it("제안 조작에 초점이 없었다면 기존 입력창에 불필요하게 다시 초점을 넣지 않는다", async () => {
    await render();
    await flushFrames();
    const composer = container.querySelector<HTMLTextAreaElement>("textarea")!;
    composer.focus();
    const focus = vi.spyOn(composer, "focus");
    await act(async () => button("지금은 적용하지 않기").click());
    await flushFrames();
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(composer);
  });

  it.each(["나만 (상담)", "상대방에게"])("프레임 전에 %s 범위로 바꾸면 새 입력창에 초점을 넣지 않는다", async (label) => {
    await deferFromSheet();
    const scope = button(label);
    scope.focus();
    await act(async () => scope.click());
    scope.blur();
    await flushFrames();
    expect(document.activeElement).not.toBe(container.querySelector("textarea"));
  });

  it("프레임 전에 계정이 바뀌면 새 사용자의 입력창에 초점을 넣지 않는다", async () => {
    await deferFromSheet();
    mocks.profileId = "user-3";
    await render();
    await flushFrames();
    expect(document.activeElement).not.toBe(container.querySelector("textarea"));
  });
});
