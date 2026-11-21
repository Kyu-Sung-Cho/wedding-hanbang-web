import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASK_CONDITIONS_COPY,
  FIRST_CHAT_COPY,
  FIRST_CHAT_INPUT_COPY,
  HOME_COPY,
  HOME_STATE_COPY,
} from "@hanbang/shared/invitation";

import type { ComputedNotification } from "@/hooks/useNotifications";

import { readFirstChatLater, resetFirstChatLaterForTest } from "../firstChatLater";
import LiveLounge from "../LiveLounge";
import { ACTIVITY, MISSING_CONDITIONS, conditionsResponse, hallsResponse, homeResponse, journeyResponse } from "./liveFixtures";
import { buttonNamed, cleanup, clearWide, click, json, linkTo, mockApi, mockWide, render, text } from "./liveTestKit";

/**
 * 웨딩 라운지의 첫 대화에서 나가는 길과 사진 머리 아래 알림 자리(2026-11-17 파운더 디자인 아티팩트, 원문 "이 디자인
 * 완전 같아야해", 같은 날 리드 지시). 지운 옛 라운지 시험 넷(`page.first-arrival`·`page.solo-couple-handoff` 등)에서
 * 새 화면에도 맞는 약속을 여기로 옮겼다.
 */

const COUPLE = "20000000-0000-4000-8000-000000000001";

type AuthState = {
  isDemo: boolean;
  user: { id: string; email: string } | null;
  profile: Record<string, unknown> | null;
  partner: Record<string, unknown> | null;
  journey: Record<string, unknown> | null;
};

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
  auth: {} as AuthState,
  notifications: {
    notifications: [] as ComputedNotification[],
    newCount: 0,
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => mocks.params,
  usePathname: () => "/wedding/lounge",
}));

// 실제 링크처럼 `as`(보이는 주소)가 있으면 그것을 주소로 그린다(`weddingLinkProps`).
vi.mock("next/link", () => ({
  default: ({ href, as, children, ...rest }: { href: string; as?: string; children?: ReactNode }) => {
    const attributes: Record<string, unknown> = { ...rest };
    delete attributes.prefetch;
    return (
      <a href={as ?? href} {...attributes}>
        {children}
      </a>
    );
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector?: (state: AuthState) => unknown) => (selector ? selector(mocks.auth) : mocks.auth),
}));

vi.mock("@/stores/chatStore", () => ({
  useChatStore: (selector: (state: { isStreaming: boolean }) => unknown) => selector({ isStreaming: false }),
}));

vi.mock("@/components/app/chat/ChatSidePanel", () => ({
  default: ({ presentation }: { presentation?: string }) => <div data-chat-panel={presentation ?? "overlay"} />,
}));

vi.mock("@/components/app/chat/ChatContent", () => ({ default: () => <div data-full-chat /> }));
vi.mock("@/lib/care/requestProactiveCare", () => ({ requestProactiveCare: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

// 안내 엔진 자체는 `FirstRunLoungeTutorial.test.tsx` 가 잰다. 여기서는 홈이 어떤 단계로 다는지만 본다.
vi.mock("@/components/app/FirstRunLoungeTutorial", () => ({
  default: ({ stepIds }: { stepIds?: readonly string[] }) => <div data-first-run-tutorial={(stepIds ?? []).join(",")} />,
}));

vi.mock("@/hooks/useNotifications", () => ({
  useNotificationPrefs: () => ({ prefs: { schedule: true, budget: true }, togglePref: vi.fn() }),
  useNotifications: () => mocks.notifications,
}));

// 알림창 자체(확인·거절 경로)는 `NotificationPanel.test.tsx` 가 잰다. 여기서는 알림 자리가 그 창을 어떻게 여닫는지 본다.
vi.mock("@/components/app/NotificationPanel", () => ({
  default: ({
    notifications,
    onOpen,
    onClose,
  }: {
    notifications: ComputedNotification[];
    onOpen?: (notification: ComputedNotification) => void;
    onClose: () => void;
  }) => (
    <div data-notification-panel>
      {notifications.map((notification) => (
        <button key={notification.id} type="button" onClick={() => onOpen?.(notification)}>
          {notification.title}
        </button>
      ))}
      <button type="button" onClick={onClose}>
        알림 닫기
      </button>
    </div>
  ),
}));

const PROFILE = { id: "user-1", name: "민지", onboarding_completed: true, couple_id: COUPLE };
const PARTNER = { id: "user-2", name: "준호", couple_id: COUPLE };
const JOURNEY = {
  id: "journey-1",
  couple_id: COUPLE,
  wedding_date: "2026-12-20",
  venue: "라온제나 강남",
  total_budget: 30_000_000,
  progress: { venue: { category: "venue", status: "completed", spent: 10_000_000 } },
  state_revision: 3,
  updated_at: "2026-11-17T00:00:00Z",
};
/** 온보딩만 끝낸 상태 — 단계와 분위기만 있고 커플이 만든 자료는 아직 없다(옛 첫 도착 시험과 같은 값). */
const EMPTY_JOURNEY = {
  ...JOURNEY,
  venue: null,
  total_budget: 0,
  progress: { __stage: "venue_booked", __preferences: { weddingStyle: "natural" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  resetFirstChatLaterForTest();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/wedding/lounge");
  mocks.params = new URLSearchParams();
  mocks.auth = {
    isDemo: false,
    user: { id: "user-1", email: "user@example.test" },
    profile: { ...PROFILE },
    partner: { ...PARTNER },
    journey: { ...JOURNEY },
  };
  mocks.notifications.notifications = [];
  mocks.notifications.newCount = 0;
  clearWide();
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearWide();
});

function routes(overrides: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/invitation/conditions": json(conditionsResponse()),
    "GET /api/invitation/home": json(homeResponse()),
    // 홈 알림 자리의 오늘의 한 가지. 운영의 지금 상태(서버 스위치 꺼짐)다.
    "GET /api/amora/today-one": json({ available: false }),
    ...overrides,
  });
}

function decisionIds(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll("[data-decision]")).map((row) => row.getAttribute("data-decision") ?? "");
}

describe("첫 대화에서 나가는 길(이미 쓰던 커플이 갇히지 않게)", () => {
  it("나중에 할게요는 이 사람만 이 브라우저에 기억하고 홈을 연다. 홈의 정할 것 맨 앞에 조건 묻기 줄(함께)이 온다", async () => {
    routes({ "GET /api/invitation/conditions": json(MISSING_CONDITIONS) });
    const { container } = await render(<LiveLounge />);
    const chat = container.querySelector('[data-invitation-screen="chat"]');
    expect(chat).not.toBeNull();
    // 갇혀 있는 동안에도 다른 화면·설정으로 가는 링크와 AI 서비스 고지가 있다.
    expect(chat?.querySelector("[data-live-footer]")).not.toBeNull();
    expect(linkTo(chat as Element, "/wedding/settings")).not.toBeNull();

    await click(buttonNamed(container, FIRST_CHAT_INPUT_COPY.later));
    expect(container.querySelector('[data-invitation-screen="chat"]')).toBeNull();
    expect(container.querySelector('[data-invitation-screen="home"]')).not.toBeNull();
    expect(window.localStorage.getItem("hanbang_invitation_first_chat_later:user-1")).toBe("1");
    // 사람마다 기억한다. 같은 브라우저의 다른 사람에게는 첫 대화가 그대로 열린다.
    expect(readFirstChatLater("user-9")).toBe(false);

    const rows = decisionIds(container);
    expect(rows[0]).toBe("ask-conditions");
    expect(rows.length).toBeGreaterThan(1);
    const ask = container.querySelector('[data-decision="ask-conditions"]');
    expect(ask?.getAttribute("href")).toBe("/wedding/lounge?conditions=1");
    expect(text(ask)).toContain(ASK_CONDITIONS_COPY.title);
    expect(text(ask)).toContain(ASK_CONDITIONS_COPY.sub);
    expect(text(ask)).toContain(HOME_COPY.together);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("뒤로는 로그아웃 화면(랜딩)이 아니라 홈으로 가고, 건너뛴 것을 기억해 홈이 다시 첫 대화를 열지 않는다", async () => {
    routes({ "GET /api/invitation/conditions": json(MISSING_CONDITIONS) });
    const { container } = await render(<LiveLounge />);
    const back = container.querySelector<HTMLAnchorElement>(`a[aria-label="${FIRST_CHAT_COPY.back}"]`);
    expect(back?.getAttribute("href")).toBe("/wedding/lounge");
    expect(container.querySelector('a[href="/landing"]')).toBeNull();

    back?.addEventListener("click", (event) => event.preventDefault());
    await click(back);
    expect(readFirstChatLater("user-1")).toBe(true);
    expect(container.querySelector('[data-invitation-screen="home"]')).not.toBeNull();
  });

  it("건너뛴 기록을 읽지 못하는 브라우저는 첫 대화에 가두지 않고 홈을 연다(조건 묻기 줄로 다시 열 수 있다)", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    routes({ "GET /api/invitation/conditions": json(MISSING_CONDITIONS) });
    const { container } = await render(<LiveLounge />);
    expect(container.querySelector('[data-invitation-screen="chat"]')).toBeNull();
    expect(decisionIds(container)[0]).toBe("ask-conditions");
  });

  it("건너뛴 것을 적지 못하는 브라우저도 이 탭에서는 기억하고 홈을 연다", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    routes({ "GET /api/invitation/conditions": json(MISSING_CONDITIONS) });
    const { container } = await render(<LiveLounge />);
    await click(buttonNamed(container, FIRST_CHAT_INPUT_COPY.later));
    expect(container.querySelector('[data-invitation-screen="home"]')).not.toBeNull();
  });

  it("건너뛰었어도 ?conditions=1(조건 묻기 줄·조건 알려 주기)이면 첫 대화를 다시 열고, 나중에 할게요는 주소의 표시를 지운다", async () => {
    window.localStorage.setItem("hanbang_invitation_first_chat_later:user-1", "1");
    routes({ "GET /api/invitation/conditions": json(MISSING_CONDITIONS) });
    const plain = await render(<LiveLounge />);
    expect(plain.container.querySelector('[data-invitation-screen="home"]')).not.toBeNull();
    await cleanup();

    mocks.params = new URLSearchParams("conditions=1");
    const { container } = await render(<LiveLounge />);
    expect(container.querySelector('[data-invitation-screen="chat"]')).not.toBeNull();
    await click(buttonNamed(container, FIRST_CHAT_INPUT_COPY.later));
    expect(mocks.replace).toHaveBeenCalledWith("/wedding/lounge");
  });

  it("조건이 다 있으면 조건 묻기 줄이 없다", async () => {
    routes();
    const { container } = await render(<LiveLounge />);
    expect(decisionIds(container)).not.toContain("ask-conditions");
  });

  it("넓은 화면: 조건 묻기 줄이 두 분이 정할 것 맨 앞에 오고, 그 줄과 어긋나는 '정할 것이 없어요'는 빼 둔다", async () => {
    mockWide(true);
    window.localStorage.setItem("hanbang_invitation_first_chat_later:user-1", "1");
    routes({
      "GET /api/invitation/conditions": json(MISSING_CONDITIONS),
      "GET /api/invitation/home": json(homeResponse({ home: { ...homeResponse().home, decisions: [] } })),
      "GET /api/invitation/activity": json(ACTIVITY),
      "GET /api/invitation/halls": json(hallsResponse({ compare: null, missing: ["region"] })),
      "GET /api/invitation/journey": json(journeyResponse()),
    });
    const { container } = await render(<LiveLounge />);
    const today = container.querySelector('[data-panel="today"]');
    expect(decisionIds(today as Element)).toEqual(["ask-conditions"]);
    expect(today?.textContent).not.toContain(HOME_STATE_COPY.noDecisions);
    // 웨딩홀 후보 칸의 "조건 알려 주기"도 첫 대화를 다시 연다.
    expect(linkTo(container.querySelector('[data-panel="halls"]') as Element, "/wedding/lounge?conditions=1")).not.toBeNull();
  });
});

describe("사진 머리 아래 알림 자리", () => {
  it("파트너 합류 직후(?joined=1, 상대가 실제로 들어와 있음): 함께 보게 된 계획을 읽어 주고 저장했다고 말하지 않으며, 확인하면 표시만 지운다", async () => {
    window.history.replaceState(null, "", "/wedding/lounge?joined=1");
    routes();
    const { container } = await render(<LiveLounge />);
    const handoff = container.querySelector<HTMLElement>('[data-testid="joined-plan-handoff"]');
    expect(handoff?.textContent).toContain("이제 이 계획을 함께 봐요");
    expect(handoff?.textContent).toContain("2026년 12월 20일");
    expect(handoff?.textContent).toContain("라온제나 강남");
    expect(handoff?.textContent).toContain("3,000만원");
    expect(handoff?.textContent).toContain("새로 저장하거나 변경한 내용은 없어요");
    expect(handoff?.textContent).not.toMatch(/저장했|반영했|변경했어요/);

    const review = Array.from(handoff?.querySelectorAll("a") ?? []).find((link) => link.textContent?.includes("함께 확인할 내용 찾기"));
    expect(new URL(review?.getAttribute("href") ?? "", "https://hanbang.ai").searchParams.get("prefill")).toContain("변경하거나 담당자를 정하지 말고");
    // 합류 안내가 떠 있을 때는 오늘의 한 가지와 첫 도착 카드를 접는다(환영 카드가 겹치지 않게).
    expect(container.querySelector("[data-live-today-one]")).toBeNull();
    expect(container.querySelector('[data-testid="lounge-first-arrival"]')).toBeNull();

    await click(buttonNamed(handoff as Element, "이 내용 확인했어요"));
    expect(container.querySelector('[data-testid="joined-plan-handoff"]')).toBeNull();
    expect(window.location.search).toBe("");
    expect(container.querySelector("[data-live-today-one]")).not.toBeNull();
  });

  it("합류 표시가 있어도 상대가 이 커플에 없으면 함께 봐요 카드를 띄우지 않는다", async () => {
    window.history.replaceState(null, "", "/wedding/lounge?joined=1");
    mocks.auth.partner = null;
    routes();
    const solo = await render(<LiveLounge />);
    expect(solo.container.querySelector('[data-testid="joined-plan-handoff"]')).toBeNull();
    await cleanup();

    mocks.auth.partner = { ...PARTNER, couple_id: "previous-couple" };
    const other = await render(<LiveLounge />);
    expect(other.container.querySelector('[data-testid="joined-plan-handoff"]')).toBeNull();
  });

  it("계정·커플을 바꾸는 사이 이전 커플의 계획(장소·체크 내용)을 알림 자리에 보이지 않는다", async () => {
    window.history.replaceState(null, "", "/wedding/lounge?joined=1");
    mocks.auth.journey = {
      ...JOURNEY,
      couple_id: "previous-couple",
      venue: "이전 커플의 장소",
      progress: { venue: { status: "in_progress", checklist: [{ id: "private", label: "이전 커플의 확인 내용", done: false }], budget: 990_001 } },
    };
    routes();
    const { container } = await render(<LiveLounge />);
    const notices = container.querySelector("[data-live-notices]");
    expect(notices?.textContent).not.toContain("이전 커플의 장소");
    expect(notices?.textContent).not.toContain("이전 커플의 확인 내용");
    expect(notices?.textContent).not.toContain("99만1원");
    expect(container.querySelector('[data-testid="joined-plan-handoff"]')?.textContent).toContain("장소 미정");
  });

  it("첫 도착: 자료가 없으면 말한 것을 되읽고 다음 걸음 하나를 세운다. 판정·추천·지어낸 금액이 없고, 혼자면 초대 카드가 안내의 초대 단계를 받는다", async () => {
    mocks.auth.partner = null;
    mocks.auth.journey = { ...EMPTY_JOURNEY };
    routes();
    const { container } = await render(<LiveLounge />);
    const card = container.querySelector<HTMLElement>('[data-testid="lounge-first-arrival"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("말씀해주신 내용이에요");
    expect(card?.textContent).toContain("12월 20일");
    expect(card?.textContent).not.toContain("2026-12-20");
    expect(card?.textContent).toContain("결혼식장을 계약했어요");
    expect(card?.textContent).toContain("편안한 분위기");
    expect(card?.textContent).toContain("다음 걸음 하나");
    expect(card?.textContent).toContain("체크리스트 열기");
    expect(card?.textContent).not.toContain("늦");
    expect(card?.textContent).not.toContain("추천");
    expect(card?.textContent).not.toMatch(/\d+만원/);
    expect(card?.querySelector('[data-tutorial-target="lounge-invite"]')?.getAttribute("href")).toBe("/wedding/settings");
  });

  it("첫 도착: 커플이 무언가 남기는 순간 저절로 사라진다", async () => {
    mocks.auth.journey = {
      ...EMPTY_JOURNEY,
      total_budget: 30_000_000,
      progress: { ...EMPTY_JOURNEY.progress, venue: { category: "venue", status: "in_progress" } },
    };
    routes();
    const { container } = await render(<LiveLounge />);
    expect(container.querySelector('[data-testid="lounge-first-arrival"]')).toBeNull();
  });

  it("오늘의 한 가지: 혼자면 혼자 할 한 가지를, 둘이면 담당자를 정하지 않고 나눌 일을 아모라에게 묻는 길이다", async () => {
    mocks.auth.partner = null;
    routes();
    const solo = await render(<LiveLounge />);
    const soloLink = Array.from(solo.container.querySelectorAll("[data-live-today-one] a")).find((link) => link.textContent?.includes("오늘 한 가지 시작하기"));
    expect(new URL(soloLink?.getAttribute("href") ?? "", "https://hanbang.ai").searchParams.get("prefill")).toContain("오늘 제가 먼저 해야 할 일 한 가지만");
    await cleanup();

    mocks.auth.partner = { ...PARTNER };
    const couple = await render(<LiveLounge />);
    const coupleLink = Array.from(couple.container.querySelectorAll("[data-live-today-one] a")).find((link) => link.textContent?.includes("오늘 할 일 같이 나누기"));
    const prompt = new URL(coupleLink?.getAttribute("href") ?? "", "https://hanbang.ai").searchParams.get("prefill");
    expect(prompt).toContain("같이 볼 것과 나눠 맡아도 되는 일");
    expect(prompt).toContain("담당자는 정하지 말고");
  });

  it("알림: 새 알림도 내가 답할 변경 요청도 없으면 자리를 만들지 않는다. 있으면 한 줄로 알리고 옛 알림창을 연다", async () => {
    routes();
    const quiet = await render(<LiveLounge />);
    expect(quiet.container.querySelector("[data-live-notifications]")).toBeNull();
    await cleanup();

    mocks.notifications.newCount = 2;
    mocks.notifications.notifications = [
      { id: "partner-1", type: "partner", title: "준호 님이 총예산을 바꿨어요", message: "3,000만원 → 3,200만원", priority: "medium", href: "/budget", isNew: true },
      { id: "schedule-1", type: "schedule", title: "예식장 확인 시점이에요", message: "확인해 주세요", priority: "low", isNew: true },
    ];
    const { container } = await render(<LiveLounge />);
    await click(buttonNamed(container, "새 알림 2개"));
    const panel = container.querySelector("[data-notification-panel]");
    expect(panel).not.toBeNull();
    await click(buttonNamed(panel as Element, "준호 님이 총예산을 바꿨어요"));
    expect(mocks.notifications.dismiss).toHaveBeenCalledWith("partner-1");
    expect(mocks.push).toHaveBeenCalledWith("/wedding/budget");
    expect(container.querySelector("[data-notification-panel]")).toBeNull();
  });

  it("알림: 읽었어도 내가 답해야 하는 계획 변경 요청이 있으면 자리가 남고, 열어도 읽음으로 지우지 않는다", async () => {
    mocks.notifications.notifications = [
      { id: "plan-1", type: "partner", title: "준호 님이 예산 변경을 요청했어요", message: "확인해 주세요", priority: "medium", href: "/budget", eventKind: "approval_requested", toolName: "manual_plan_change", actionId: "action-1", isNew: false },
    ];
    routes();
    const { container } = await render(<LiveLounge />);
    await click(buttonNamed(container, "알림"));
    await click(buttonNamed(container.querySelector("[data-notification-panel]") as Element, "준호 님이 예산 변경을 요청했어요"));
    expect(mocks.notifications.dismiss).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/wedding/budget");
  });

  it("첫 실행 안내는 홈에 있는 자리(초대 카드·아모라)만 가리키고, 그 자리가 실제로 있다", async () => {
    routes();
    const narrow = await render(<LiveLounge />);
    expect(narrow.container.querySelector("[data-first-run-tutorial]")?.getAttribute("data-first-run-tutorial")).toBe("lounge-invite,amora-fab");
    const nav = narrow.container.querySelector(`nav[aria-label="${HOME_COPY.nav.label}"]`);
    expect(nav?.querySelector('[data-tutorial-target="amora-fab"]')?.getAttribute("href")).toBe("/wedding/chat");
    await cleanup();

    mockWide(true);
    routes({
      "GET /api/invitation/activity": json(ACTIVITY),
      "GET /api/invitation/halls": json(hallsResponse()),
      "GET /api/invitation/journey": json(journeyResponse()),
    });
    const wide = await render(<LiveLounge />);
    expect(wide.container.querySelector('[data-tutorial-target="amora-fab"] [data-chat-panel="invitation"]')).not.toBeNull();
    expect(wide.container.querySelector("[data-first-run-tutorial]")).not.toBeNull();
  });

  it("라운지는 커뮤니티를 부르지 않고, 웨딩코드와 견적 확인 도구는 바닥 링크로 연다", async () => {
    const api = routes();
    const { container } = await render(<LiveLounge />);
    expect(api.calls.some((call) => call.url.startsWith("/api/community/"))).toBe(false);
    expect(linkTo(container, "/wedding/preparation-style")?.textContent).toBe("웨딩코드");
    expect(linkTo(container, "/wedding/community/quote-check")).not.toBeNull();
  });

  it("체험 모드(예시 커플)에는 알림 자리를 그리지 않는다", async () => {
    mocks.auth.isDemo = true;
    mockApi({});
    const { container } = await render(<LiveLounge />);
    expect(container.querySelector("[data-live-notices]")).toBeNull();
    expect(container.querySelector("[data-first-run-tutorial]")).toBeNull();
  });
});
