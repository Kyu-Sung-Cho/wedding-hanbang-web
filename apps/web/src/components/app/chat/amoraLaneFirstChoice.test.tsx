import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AMORA_LANE_CHOICE_COPY,
  amoraLaneStorageKey,
} from "@hanbang/shared/amora-lane-choice";
import { buildAmoraFirstHello } from "@hanbang/shared";

import {
  rememberPendingAmoraFirstHello,
  resetAmoraFirstHelloMemory,
} from "@/lib/amora/pendingFirstHello";
import { JOINED_PLAN_REVIEW_PROMPT } from "@/lib/amora/dashboardCompanion";
import { rememberDemoAmoraPrefill } from "@/lib/chat/demoHandoff";

import ChatContent from "./ChatContent";
import ChatSidePanel from "./ChatSidePanel";

/**
 * 아모라 대화를 처음 열 때 '함께 대화 / 나만 (상담)'을 고르게 한다 — 웹 두 표면(2026-09-26 파운더 결정).
 *
 * 예전에는 전체화면(`ChatContent`)과 옆 패널(`ChatSidePanel`)이 모두 `useState("shared")` 로
 * 시작해, 처음 온 사람의 첫 글이 묻지도 않고 함께 대화 레인(배우자가 읽는 곳)에 저장됐다.
 *
 * 여기서 재는 것(명세의 여섯 가지 + 첫인사 순서):
 *  1. 처음이면 카드가 뜨고 전송이 막힌다. 모델 첫 인사도 부르지 않는다.
 *  2. 고르면 기억되고 다음 방문에 카드가 없다. '나만'을 골라도 첫인사를 본다.
 *  3. 체험이나 역할 없음이면 카드가 없고 '함께'다. 역할 정보 전에는 카드도 없다.
 *  4. `?scope=`·준비 안내(prefill)가 기억을 이긴다. 그 진입은 기억에 쓰지 않는다.
 *  5. 옆 패널과 전체화면이 같은 기억을 쓴다.
 *  6. 저장소 접근이 throw 해도 화면이 깨지지 않는다(카드를 다시 띄운다).
 *  + 서버가 안전 때문에 '나만'으로 옮긴 것은 기억에 쓰지 않는다.
 *
 * 문구는 정본(`AMORA_LANE_CHOICE_COPY`)에서 읽지 않고 **글자로** 적는다. 정본과 화면이
 * 같은 값을 보면 둘 다 틀려도 초록이다.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const TITLE = "이 대화, 누구랑 볼까요?";
const BLOCKED_PLACEHOLDER = "먼저 누구랑 볼지 골라 주세요.";
const UNLINKED_NOTE = "파트너를 연결하면 지금까지 나눈 대화도 같이 보게 돼요.";
const LANE_KEY = amoraLaneStorageKey("user-1") as string;

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
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
  personalHandoffPending: false,
  takePersonalHandoff: vi.fn(),
  search: "",
  auth: {
    profileId: "user-1",
    role: "bride" as "bride" | "groom" | null,
    isDemo: false,
    isInitialized: true,
    isLoading: false,
    partnerLinked: true,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
  usePathname: () => "/wedding/chat",
}));

vi.mock("@/stores/authStore", () => {
  const snapshot = () => ({
    user: { id: mocks.auth.profileId },
    profile: {
      id: mocks.auth.profileId,
      role: mocks.auth.role,
      confirmed_role: null,
      name: "테스트",
      couple_id: "couple-1",
    },
    couple: {
      id: "couple-1",
      bride_id: mocks.auth.profileId,
      groom_id: mocks.auth.partnerLinked ? "user-2" : null,
    },
    journey: null,
    partner: null,
    isDemo: mocks.auth.isDemo,
    isInitialized: mocks.auth.isInitialized,
    isLoading: mocks.auth.isLoading,
  });
  const useAuthStore = Object.assign(
    (selector?: (state: ReturnType<typeof snapshot>) => unknown) => (
      selector ? selector(snapshot()) : snapshot()
    ),
    { getState: snapshot, subscribe: () => () => {} },
  );
  return { useAuthStore };
});

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
    messages: [],
    sharedClearedAt: null,
    privateClearedAt: null,
    isStreaming: false,
    isSending: false,
    streamingContent: "",
    streamingToolResults: [],
    suggestions: [],
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

vi.mock("./ChatBubble", () => ({
  default: ({ message }: { message: { id: string; content: string; visibility: string } }) => (
    <div data-message-id={message.id} data-visibility={message.visibility}>{message.content}</div>
  ),
}));
vi.mock("./ActionCard", () => ({ default: () => <div /> }));
vi.mock("./VendorToolCard", () => ({
  default: () => <div />,
  VENDOR_TOOL_NAMES: new Set<string>(),
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
vi.mock("@/lib/amora/personalActionContinuation", () => ({ personalActionContinuation: {
  hasPending: () => mocks.personalHandoffPending,
  take: (...args: unknown[]) => { mocks.personalHandoffPending = false; return mocks.takePersonalHandoff(...args); },
} }));

type Surface = "chat" | "panel";
const SURFACES: Surface[] = ["chat", "panel"];

describe("아모라 대화를 처음 열면 '함께/나만'을 먼저 고른다", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetAmoraFirstHelloMemory();
    mocks.personalHandoffPending = false;
    mocks.takePersonalHandoff.mockReset().mockResolvedValue("이 개인 할 일을 이어서 상담하고 싶어요.");
    mocks.search = "";
    mocks.auth = {
      profileId: "user-1",
      role: "bride",
      isDemo: false,
      isInitialized: true,
      isLoading: false,
      partnerLinked: true,
    };
    mocks.sendMessage.mockResolvedValue({ userMessage: "persisted", userMessageId: "m-1" });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const render = async (surface: Surface, isOpen = true) => {
    await act(async () => {
      root.render(surface === "chat"
        ? <ChatContent />
        : <ChatSidePanel isOpen={isOpen} onClose={vi.fn()} />);
      await Promise.resolve();
    });
  };

  /** 다음 방문 — 화면을 내리고 새로 연다. 브라우저 저장소는 그대로다. */
  const revisit = async (surface: Surface) => {
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(surface);
  };

  const card = () => container.querySelector('[data-testid="amora-lane-choice"]');
  const cardOption = (lane: "shared" | "private") =>
    container.querySelector<HTMLButtonElement>(`[data-amora-lane-option="${lane}"]`);

  const composer = (surface: Surface) => (
    surface === "chat"
      ? container.querySelector<HTMLTextAreaElement>("textarea")
      : container.querySelector<HTMLInputElement>('input[aria-label="메시지 입력"]')
  );

  const sendButton = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => {
      const label = button.getAttribute("aria-label") ?? "";
      return label.endsWith("메시지 보내기") && !label.startsWith("상대방");
    });

  /** 위쪽 탭(카드가 아니라 범위 탭). 전체화면은 공통 헤더, 옆 패널은 자기 탭. */
  const scopeTab = (label: "함께 대화" | "나만 (상담)") => {
    const group = container.querySelector(
      '[role="group"][aria-label="대화 공개 범위"], [role="group"][aria-label="상담 공개 범위"]',
    );
    expect(group, "범위 탭 묶음을 못 찾았다").not.toBeNull();
    const tab = Array.from(group!.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes(label));
    expect(tab, `범위 탭 '${label}' 을 못 찾았다`).toBeDefined();
    return tab!;
  };

  /** 지금 눌린 탭. 고르기 전에는 null. */
  const pressedLane = () => {
    if (scopeTab("함께 대화").getAttribute("aria-pressed") === "true") return "shared";
    if (scopeTab("나만 (상담)").getAttribute("aria-pressed") === "true") return "private";
    return null;
  };

  const click = async (element: HTMLElement | null | undefined) => {
    expect(element).toBeTruthy();
    await act(async () => {
      element!.click();
      await Promise.resolve();
    });
  };

  const typeAndPressEnter = async (surface: Surface, text: string) => {
    const element = composer(surface);
    expect(element).not.toBeNull();
    await act(async () => {
      const prototype = surface === "chat" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, text);
      element!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // 버튼이 막혀 있어도 Enter 는 전송 함수를 곧바로 부른다 — 함수 안의 막음까지 잰다.
    await act(async () => {
      element!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });
  };

  const greeting = () => container.querySelector('[data-testid="amora-first-hello-message"]');

  // ── 1. 처음이면 카드, 전송 막힘, 모델 인사 없음 ─────────────────────────────

  it.each(SURFACES)("%s: 처음 여는 사람에게 카드를 띄우고 고르기 전에는 보내지 않는다", async (surface) => {
    await render(surface);

    expect(card()).not.toBeNull();
    expect(card()?.textContent).toContain(TITLE);
    expect(cardOption("shared")?.textContent).toContain("함께 대화");
    expect(cardOption("shared")?.textContent).toContain(
      "파트너도 이 대화를 볼 수 있어요. 아모라와 정한 예산이나 일정이 반영되고, 바뀐 건 서로 알림이 가요.",
    );
    expect(cardOption("private")?.textContent).toContain("나만 (상담)");
    expect(cardOption("private")?.textContent).toContain(
      "나만 볼 수 있어요. 예산이나 일정 반영은 함께 대화에서 할 수 있어요.",
    );
    expect(card()?.textContent).toContain("위에서 언제든 바꿀 수 있어요.");
    // 파트너가 연결된 사람에게는 연결 안내를 붙이지 않는다.
    expect(card()?.textContent).not.toContain(UNLINKED_NOTE);

    expect(composer(surface)?.placeholder).toBe(BLOCKED_PLACEHOLDER);
    expect(sendButton()?.disabled).toBe(true);
    expect(pressedLane()).toBeNull();

    await typeAndPressEnter(surface, "예식장 계약금이 얼마예요?");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    // 모델 첫 인사는 함께 대화 레인에 저장된다 — 고르기 전에 부르면 안 된다.
    expect(mocks.requestInitialGreeting).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LANE_KEY)).toBeNull();
  });

  it.each(SURFACES)("%s: 파트너 연결 전인 사람에게만 연결 안내 한 줄을 붙인다", async (surface) => {
    mocks.auth.partnerLinked = false;
    await render(surface);
    expect(card()?.querySelector('[data-testid="amora-lane-choice-unlinked-note"]')?.textContent)
      .toBe(UNLINKED_NOTE);
  });

  it("정본 문구와 화면 글자가 같다", () => {
    expect(AMORA_LANE_CHOICE_COPY.title).toBe(TITLE);
    expect(AMORA_LANE_CHOICE_COPY.composerBlockedPlaceholder).toBe(BLOCKED_PLACEHOLDER);
    expect(AMORA_LANE_CHOICE_COPY.shared.unlinkedPartnerNote).toBe(UNLINKED_NOTE);
  });

  // ── 2. 고르면 기억하고 다음 방문에 카드 없음 ────────────────────────────────

  it.each(SURFACES)("%s: '함께'를 고르면 기억하고, 그때 모델 첫 인사를 부른다", async (surface) => {
    await render(surface);
    await click(cardOption("shared"));

    expect(window.localStorage.getItem(LANE_KEY)).toBe("shared");
    expect(card()).toBeNull();
    expect(pressedLane()).toBe("shared");
    expect(composer(surface)?.placeholder).not.toBe(BLOCKED_PLACEHOLDER);
    await vi.waitFor(() => expect(mocks.requestInitialGreeting).toHaveBeenCalledTimes(1));

    await typeAndPressEnter(surface, "예식장 계약금이 얼마예요?");
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    expect(mocks.sendMessage.mock.calls[0][0].visibility).toBe("shared");

    await revisit(surface);
    expect(card()).toBeNull();
    expect(pressedLane()).toBe("shared");
  });

  it.each(SURFACES)("%s: '나만'을 고르면 기억하고, 모델 인사 대신 화면 첫인사를 나만 레인에 놓는다", async (surface) => {
    await render(surface);
    await click(cardOption("private"));

    expect(window.localStorage.getItem(LANE_KEY)).toBe("private");
    expect(card()).toBeNull();
    expect(pressedLane()).toBe("private");
    expect(mocks.requestInitialGreeting).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(greeting()).not.toBeNull());
    expect(greeting()?.textContent).toContain("안녕하세요, 아모라예요.");
    expect(greeting()?.querySelector("[data-visibility]")?.getAttribute("data-visibility"))
      .toBe("bride_private");

    await typeAndPressEnter(surface, "요즘 마음이 복잡해요");
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    expect(mocks.sendMessage.mock.calls[0][0].visibility).toBe("bride_private");

    await revisit(surface);
    expect(card()).toBeNull();
    expect(pressedLane()).toBe("private");
    expect(mocks.requestInitialGreeting).not.toHaveBeenCalled();
  });

  it.each(SURFACES)("%s: 카드 대신 위쪽 탭을 눌러도 고른 것으로 기억한다", async (surface) => {
    await render(surface);
    await click(scopeTab("나만 (상담)"));

    expect(card()).toBeNull();
    expect(window.localStorage.getItem(LANE_KEY)).toBe("private");

    await click(scopeTab("함께 대화"));
    expect(window.localStorage.getItem(LANE_KEY)).toBe("shared");
  });

  it.each(SURFACES)("%s: 기억은 계정별이다 — 다른 계정의 기억으로 열지 않는다", async (surface) => {
    window.localStorage.setItem(amoraLaneStorageKey("user-9") as string, "private");
    await render(surface);
    expect(card()).not.toBeNull();
  });

  it.each(SURFACES)("%s: 화면을 연 채 계정이 바뀌면 그 계정 기준으로 다시 묻는다", async (surface) => {
    window.localStorage.setItem(LANE_KEY, "private");
    await render(surface);
    expect(card()).toBeNull();
    expect(pressedLane()).toBe("private");

    mocks.auth.profileId = "user-3";
    await render(surface);
    expect(card()).not.toBeNull();
    expect(pressedLane()).toBeNull();
    await typeAndPressEnter(surface, "새 계정의 첫 질문");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    // 앞 계정의 기억은 그대로다.
    expect(window.localStorage.getItem(LANE_KEY)).toBe("private");
  });

  /**
   * 라운지 첫마디는 운영이 실제로 만드는 본문으로 잰다(2026-09-27 검토). 파트너가 아직 없는 새 사용자는
   * 라운지에서 `partnerLinked: false` 로 첫마디를 받고, 그 본문 끝에 초대 문단이 붙는다. 예전 입력은
   * 초대 문단이 없는 문장이라 '나만 (상담)' 탭 맨 위에 "두 사람이 같은 화면을 봐요"가 남는 것을 한 번도
   * 재지 않았다.
   */
  const loungeHelloFor = (partnerLinked: boolean) =>
    buildAmoraFirstHello({ partnerLinked, now: Date.UTC(2026, 8, 27, 3) }).body;
  const INVITE_LINE = "설정에서 초대 코드를 보내면 두 사람이 같은 화면을 봐요.";
  const renderWithLoungeHello = async (surface: Surface, hello: string) => {
    if (surface === "chat") {
      rememberPendingAmoraFirstHello({ preview: "오늘은 한 가지만 같이 정해봐요.", body: hello }, { ownerId: "user-1" });
      await render("chat");
    } else {
      await act(async () => {
        root.render(<ChatSidePanel isOpen onClose={vi.fn()} firstHello={hello} />);
        await Promise.resolve();
      });
    }
  };

  it.each(SURFACES)("%s: 라운지 첫마디는 고르기 전에도 보이지만 초대 문단은 빼고, '나만'을 골라도 빼 둔다", async (surface) => {
    mocks.auth.partnerLinked = false;
    const hello = loungeHelloFor(false);
    // 입력이 운영과 같은 모양인지 먼저 본다. 초대 문단이 없는 본문으로는 이 검사가 아무것도 재지 않는다.
    expect(hello.endsWith(`\n\n${INVITE_LINE}`)).toBe(true);
    await renderWithLoungeHello(surface, hello);

    expect(card()).not.toBeNull();
    expect(greeting()?.textContent).toBe(loungeHelloFor(true));
    // 카드의 '함께' 덧붙임이 같은 말을 한 번만 한다.
    expect(container.textContent).not.toContain("두 사람이 같은 화면");
    expect(card()?.textContent).toContain(UNLINKED_NOTE);

    await click(cardOption("private"));
    expect(greeting()?.textContent).toBe(loungeHelloFor(true));
    expect(greeting()?.textContent).not.toContain("두 사람이 같은 화면");
    expect(greeting()?.querySelector("[data-visibility]")?.getAttribute("data-visibility"))
      .toBe("bride_private");
    expect(mocks.requestInitialGreeting).not.toHaveBeenCalled();
  });

  it.each(SURFACES)("%s: '함께 대화'를 고르면 라운지 첫마디를 초대 문단까지 그대로 보인다", async (surface) => {
    mocks.auth.partnerLinked = false;
    const hello = loungeHelloFor(false);
    await renderWithLoungeHello(surface, hello);

    await click(cardOption("shared"));
    expect(greeting()?.textContent).toBe(hello);
    expect(greeting()?.textContent).toContain(INVITE_LINE);
  });

  // ── 3. 체험·역할 없음·역할 정보 전 ─────────────────────────────────────────

  it.each(SURFACES.flatMap((surface) => [null, "private"].map((remembered) => [surface, remembered] as const)))(
    "%s: 체험이면 카드 없이 '함께'로 연다(기억: %s)",
    async (surface, remembered) => {
      mocks.auth.isDemo = true;
      if (remembered) window.localStorage.setItem(LANE_KEY, remembered);
      await render(surface);

      expect(card()).toBeNull();
      expect(pressedLane()).toBe("shared");
      expect(composer(surface)?.placeholder).not.toBe(BLOCKED_PLACEHOLDER);
    },
  );

  it.each(SURFACES)("%s: 역할이 없으면 카드 없이 '함께'로 연다", async (surface) => {
    mocks.auth.role = null;
    await render(surface);

    expect(card()).toBeNull();
    expect(pressedLane()).toBe("shared");
  });

  it("panel: 역할 정보가 오기 전에는 카드를 띄우지 않고 보내지도 않는다", async () => {
    mocks.auth.isInitialized = false;
    await render("panel");
    expect(card()).toBeNull();
    await typeAndPressEnter("panel", "안녕하세요");
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    mocks.auth.isInitialized = true;
    await render("panel");
    expect(card()).not.toBeNull();
  });

  // ── 4. 레인을 정해서 들어온 길이 이긴다 ────────────────────────────────────

  it("chat: ?scope=private 가 '함께' 기억을 이기고, 기억은 바꾸지 않는다", async () => {
    window.localStorage.setItem(LANE_KEY, "shared");
    mocks.search = "scope=private";
    await render("chat");

    expect(card()).toBeNull();
    expect(pressedLane()).toBe("private");
    expect(window.localStorage.getItem(LANE_KEY)).toBe("shared");
  });

  it("chat: 처음 온 사람도 ?scope=shared 로 들어오면 카드 없이 '함께'로 열고, 기억에 쓰지 않는다", async () => {
    mocks.search = "scope=shared";
    await render("chat");

    expect(card()).toBeNull();
    expect(pressedLane()).toBe("shared");
    expect(window.localStorage.getItem(LANE_KEY)).toBeNull();
  });

  // ── 4-1. 일반 초안(prefill·가입 인계)은 칸을 정하지 않는다(2026-09-27 검토) ──────────────
  //
  // 라운지 '아모라에게 물어보기'·대시보드·온보딩 직후 등 웹에서 대화로 오는 주요 길 대부분이
  // `?prefill=` 을 싣는다. 예전에는 이것을 '함께'를 명시한 진입으로 봐서, 처음 온 사람은 카드를
  // 못 보고 '함께'로 열려 고른 적 없이 함께 대화에 저장됐고, '나만'을 기억한 사람도 매번 '함께'로
  // 끌려갔다. 이 입력은 라운지 버튼이 실제로 싣는 모양(`/chat?prefill=…`)이다.

  const LOUNGE_QUESTION = "예식장 보증인원 줄여도 될까요?";
  const pressEnter = async (surface: Surface) => {
    await act(async () => {
      composer(surface)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });
  };

  it("chat: 기억 없이 prefill 로 들어오면 카드를 띄우고, 고르기 전에는 질문을 보이지도 보내지도 않는다", async () => {
    mocks.search = `prefill=${encodeURIComponent(LOUNGE_QUESTION)}`;
    await render("chat");

    expect(card()).not.toBeNull();
    expect(pressedLane()).toBeNull();
    expect(composer("chat")?.value).toBe("");
    expect(composer("chat")?.placeholder).toBe(BLOCKED_PLACEHOLDER);
    await pressEnter("chat");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LANE_KEY)).toBeNull();
  });

  it.each([
    ["shared", "shared"],
    ["private", "bride_private"],
  ] as const)("chat: prefill 로 온 처음 사람이 '%s'를 고르면 질문이 그 칸 입력창에 들어가고 그 칸으로 간다", async (lane, visibility) => {
    mocks.search = `prefill=${encodeURIComponent(LOUNGE_QUESTION)}`;
    await render("chat");
    await click(cardOption(lane));

    expect(pressedLane()).toBe(lane);
    expect(window.localStorage.getItem(LANE_KEY)).toBe(lane);
    await vi.waitFor(() => expect(composer("chat")?.value).toBe(LOUNGE_QUESTION));
    await pressEnter("chat");
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    expect(mocks.sendMessage.mock.calls[0][0].visibility).toBe(visibility);
    expect(mocks.sendMessage.mock.calls[0][0].content).toBe(LOUNGE_QUESTION);
  });

  it("chat: '나만'을 기억한 사람이 prefill 로 들어오면 카드 없이 나만으로 열고 질문을 나만 입력창에 넣는다", async () => {
    window.localStorage.setItem(LANE_KEY, "private");
    mocks.search = `prefill=${encodeURIComponent(LOUNGE_QUESTION)}`;
    await render("chat");

    expect(card()).toBeNull();
    expect(pressedLane()).toBe("private");
    await vi.waitFor(() => expect(composer("chat")?.value).toBe(LOUNGE_QUESTION));
    expect(window.localStorage.getItem(LANE_KEY)).toBe("private");
    // 함께 대화 입력칸에는 남지 않는다(탭을 바꿔도 질문이 두 벌이 아니다).
    await click(scopeTab("함께 대화"));
    expect(composer("chat")?.value).toBe("");
  });

  it("chat: 가입 인계로 들어온 처음 사람도 카드를 먼저 보고, 고른 칸에 질문이 들어간다", async () => {
    const handoffId = "5d2c1a3e-7f10-4b2a-9c3d-2e4f6a8b0c1d";
    rememberDemoAmoraPrefill(window.localStorage, "결혼식은 작게 준비하려고 해요.", handoffId);
    mocks.search = `startHereHandoff=${handoffId}`;
    await render("chat");

    expect(card()).not.toBeNull();
    expect(composer("chat")?.value).toBe("");
    await pressEnter("chat");
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    await click(cardOption("private"));
    await vi.waitFor(() => expect(composer("chat")?.value).toBe("결혼식은 작게 준비하려고 해요."));
    expect(pressedLane()).toBe("private");
  });

  it("chat: 파트너 합류 직후 계획 점검 문장은 '나만' 기억이어도 함께 대화로 열고, 기억은 바꾸지 않는다", async () => {
    window.localStorage.setItem(LANE_KEY, "private");
    mocks.search = `prefill=${encodeURIComponent(JOINED_PLAN_REVIEW_PROMPT)}`;
    await render("chat");

    expect(card()).toBeNull();
    expect(pressedLane()).toBe("shared");
    expect(composer("chat")?.value).toBe(JOINED_PLAN_REVIEW_PROMPT);
    expect(window.localStorage.getItem(LANE_KEY)).toBe("private");
  });

  it("chat: 준비 안내 질문(amoraSource)은 '나만' 기억이어도 함께 대화로 열고, 기억은 바꾸지 않는다", async () => {
    window.localStorage.setItem(LANE_KEY, "private");
    mocks.search = "amoraSource=c.venue";
    await render("chat");

    expect(card()).toBeNull();
    expect(pressedLane()).toBe("shared");
    expect(window.localStorage.getItem(LANE_KEY)).toBe("private");
  });

  it.each([null, "shared"] as const)(
    "chat: 개인 할 일 이어가기는 주소 없이도 '나만'으로 열고 기억은 건드리지 않는다(기억: %s)",
    async (remembered) => {
      if (remembered) window.localStorage.setItem(LANE_KEY, remembered);
      mocks.personalHandoffPending = true;
      // 다시 읽기에 실패하는 경우 — 이어가기가 탭을 옮기는 것은 처음 한 번뿐이라, 그 한 번을
      // 같은 커밋의 레인 결정이 기억으로 덮으면 사용자는 함께 탭에 남아 안내를 못 본다.
      mocks.takePersonalHandoff.mockRejectedValue(new Error("source no longer exists"));
      await render("chat");
      await vi.waitFor(() => expect(container.textContent).toContain("개인 할 일을 다시 확인하지 못했어요"));

      expect(card()).toBeNull();
      expect(pressedLane()).toBe("private");
      expect(window.localStorage.getItem(LANE_KEY)).toBe(remembered);
    },
  );

  // ── 5. 두 표면이 같은 기억을 쓴다 ────────────────────────────────────────

  it("옆 패널에서 고른 칸으로 전체화면이 열리고, 그 반대도 같다", async () => {
    await render("panel");
    await click(cardOption("private"));

    await act(async () => root.unmount());
    root = createRoot(container);
    await render("chat");
    expect(card()).toBeNull();
    expect(pressedLane()).toBe("private");

    await click(scopeTab("함께 대화"));
    await act(async () => root.unmount());
    root = createRoot(container);
    await render("panel");
    expect(card()).toBeNull();
    expect(pressedLane()).toBe("shared");
  });

  it("panel: 고르지 않고 닫았다가 다른 화면에서 고른 뒤 다시 열면 그 기억으로 연다", async () => {
    await render("panel", true);
    expect(card()).not.toBeNull();

    await render("panel", false);
    // 전체화면에서 고른 것과 같다.
    window.localStorage.setItem(LANE_KEY, "private");
    await render("panel", true);

    expect(card()).toBeNull();
    expect(pressedLane()).toBe("private");
  });

  // ── 6. 저장소가 막혀도 화면은 깨지지 않는다 ─────────────────────────────────

  it.each(SURFACES)("%s: 저장소 읽기·쓰기가 throw 해도 카드를 띄우고, 고르면 그대로 쓴다", async (surface) => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "QuotaExceededError");
    });
    // 누른 순간 저장이 던지면 화면은 바뀌어도 예외가 밖으로 샌다. 그것도 깨진 것으로 본다.
    const escaped: unknown[] = [];
    const onError = (event: ErrorEvent) => { escaped.push(event.error); };
    window.addEventListener("error", onError);
    await render(surface);
    expect(card()).not.toBeNull();

    await click(cardOption("private"));
    window.removeEventListener("error", onError);
    expect(escaped).toEqual([]);
    expect(card()).toBeNull();
    expect(pressedLane()).toBe("private");
    await typeAndPressEnter(surface, "요즘 마음이 복잡해요");
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    expect(mocks.sendMessage.mock.calls[0][0].visibility).toBe("bride_private");

    // 기억을 못 했으니 다음 방문에는 다시 묻는다(모르는 채로 한쪽을 고르지 않는다).
    await revisit(surface);
    expect(card()).not.toBeNull();
  });

  it("chat: localStorage 에 닿는 것 자체가 throw 해도 카드를 띄운다", async () => {
    // jsdom 은 이 속성을 창 자신에 둘 수도, 프로토타입에 둘 수도 있다. 어느 쪽이든 되돌린다.
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      expect(() => window.localStorage).toThrow();
      await render("chat");
      expect(card()).not.toBeNull();
      await click(cardOption("shared"));
      expect(card()).toBeNull();
      expect(pressedLane()).toBe("shared");
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
      else delete (window as unknown as Record<string, unknown>).localStorage;
    }
    expect(() => window.localStorage.getItem("x")).not.toThrow();
  });

  // ── 안전 판정이 옮긴 탭은 기억에 쓰지 않는다 ─────────────────────────────────

  it.each(SURFACES)("%s: 서버가 안전 때문에 '나만'으로 옮겨도 기억은 사람이 고른 '함께'로 남는다", async (surface) => {
    window.localStorage.setItem(LANE_KEY, "shared");
    mocks.sendMessage.mockImplementation((params: {
      onSafetyPrivacyRedirect?: (visibility: "bride_private" | "groom_private") => void;
    }) => {
      params.onSafetyPrivacyRedirect?.("bride_private");
      return Promise.resolve({
        userMessage: "persisted",
        userMessageId: "m-1",
        effectiveVisibility: "bride_private",
        safetyPrivacyRedirected: true,
      });
    });
    await render(surface);
    await typeAndPressEnter(surface, "예식장 계약금 환불이 안 된대요");
    await vi.waitFor(() => expect(pressedLane()).toBe("private"));

    expect(window.localStorage.getItem(LANE_KEY)).toBe("shared");
    await revisit(surface);
    expect(pressedLane()).toBe("shared");
  });
});
