import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_COPY,
  COMPARE_STATE_COPY,
  CONSULTATION_STATE_COPY,
  EXAMPLE_COPY,
  FIRST_CHAT_COPY,
  FIRST_CHAT_INPUT_COPY,
  HOME_COPY,
  HOME_STATE_COPY,
  JOURNEY_COPY,
  JOURNEY_STATE_COPY,
  LETTER_COPY,
  LETTER_STATE_COPY,
  STATUS_COPY,
} from "@hanbang/shared/invitation";

import { resetFirstChatLaterForTest } from "../firstChatLater";
import LiveChat from "../LiveChat";
import LiveConsultation from "../LiveConsultation";
import LiveHalls from "../LiveHalls";
import LiveJourney from "../LiveJourney";
import LiveLetter from "../LiveLetter";
import LiveLounge from "../LiveLounge";
import {
  ACTIVITY,
  FINGERPRINT,
  HALL_A,
  LETTER_ID,
  MISSING_CONDITIONS,
  PARTNER,
  REPLY,
  VERSION,
  VIEWER,
  approverResponse,
  conditionsResponse,
  consultationResponse,
  hallsResponse,
  homeResponse,
  journeyResponse,
  letterResponse,
} from "./liveFixtures";
import { apiError, buttonNamed, cleanup, clearWide, click, flush, json, linkTo, mockApi, mockWide, never, render, text } from "./liveTestKit";

/** 승인 방식 제안 ID(확인·거절이 그대로 돌려보낸다). */
const PROPOSAL = "99999999-9999-4999-8999-999999999999";

/**
 * 실제 커플 화면의 연결(2026-11-17 파운더 디자인 아티팩트, 원문 "이 디자인 완전 같아야해").
 * 같은 화면 컴포넌트에 서버 모델을 넣고, 콜백이 서버를 부르는지, 빈·실패·409·보내기 꺼짐 상태가 상태 문구로
 * 보이는지 잰다. 서버는 `fetch` 를 흉내 낸다.
 */

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  params: new URLSearchParams(),
  auth: {
    isDemo: false,
    user: { id: "user-1", email: "user@example.test" } as { id: string; email: string } | null,
    profile: { id: "user-1", name: "민지", onboarding_completed: true } as Record<string, unknown> | null,
    partner: { id: "user-2", name: "준호" } as Record<string, unknown> | null,
    journey: { id: "journey-1", state_revision: 3, updated_at: "2026-11-17T00:00:00Z" } as Record<string, unknown> | null,
  },
  proactive: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  useSearchParams: () => mocks.params,
  usePathname: () => "/wedding/lounge",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector?: (state: typeof mocks.auth) => unknown) => (selector ? selector(mocks.auth) : mocks.auth),
}));

vi.mock("@/stores/chatStore", () => ({
  useChatStore: (selector: (state: { isStreaming: boolean }) => unknown) => selector({ isStreaming: false }),
}));

vi.mock("@/components/app/chat/ChatSidePanel", () => ({
  default: ({ presentation, isOpen }: { presentation?: string; isOpen: boolean }) => (
    <div data-chat-panel={presentation ?? "overlay"} data-open={String(isOpen)} />
  ),
}));

vi.mock("@/components/app/chat/ChatContent", () => ({ default: () => <div data-full-chat /> }));

vi.mock("@/lib/care/requestProactiveCare", () => ({ requestProactiveCare: mocks.proactive }));

// 알림 자리의 첫 실행 안내·알림 종은 자기 시험이 따로 있다(`liveLounge.test.tsx`). 여기서는 자리만 둔다.
vi.mock("@/components/app/FirstRunLoungeTutorial", () => ({ default: () => null }));
vi.mock("@/hooks/useNotifications", () => ({
  useNotificationPrefs: () => ({ prefs: { schedule: true, budget: true }, togglePref: vi.fn() }),
  useNotifications: () => ({ notifications: [], newCount: 0, dismiss: vi.fn(), dismissAll: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetFirstChatLaterForTest();
  window.history.replaceState(null, "", "/wedding/lounge");
  mocks.params = new URLSearchParams();
  mocks.auth.isDemo = false;
  mocks.auth.user = { id: "user-1", email: "user@example.test" };
  mocks.auth.profile = { id: "user-1", name: "민지", onboarding_completed: true };
  mocks.auth.partner = { id: "user-2", name: "준호" };
  mocks.auth.journey = { id: "journey-1", state_revision: 3, updated_at: "2026-11-17T00:00:00Z" };
  window.sessionStorage.clear();
  window.localStorage.clear();
  clearWide();
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  clearWide();
});

function homeRoutes(overrides: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/invitation/conditions": json(conditionsResponse()),
    "GET /api/invitation/home": json(homeResponse()),
    // 홈 알림 자리의 오늘의 한 가지. 운영의 지금 상태(서버 스위치 꺼짐)다.
    "GET /api/amora/today-one": json({ available: false }),
    ...overrides,
  });
}

describe("웨딩 라운지 /lounge", () => {
  it("온보딩을 마쳤는데 조건이 비어 있으면 청첩장 홈 대신 첫 대화를 보인다", async () => {
    homeRoutes({ "GET /api/invitation/conditions": json(MISSING_CONDITIONS) });
    const { container } = await render(<LiveLounge />);

    expect(container.querySelector('[data-invitation-screen="chat"]')).not.toBeNull();
    expect(container.querySelector('[data-invitation-screen="home"]')).toBeNull();
    expect(container.textContent).toContain(FIRST_CHAT_COPY.greeting);
    expect(container.textContent).toContain(FIRST_CHAT_INPUT_COPY.askWhereAndGuests);
    // 아직 아무것도 고르지 않았으니 사람 말풍선과 초안의 마지막 줄이 없고, 확인 단추는 잠겨 있다.
    expect(container.textContent).not.toContain("정도요");
    expect(container.textContent).not.toContain("어딘가에서");
    expect(container.textContent).not.toContain(FIRST_CHAT_COPY.stages[0].answer);
    expect(buttonNamed(container, FIRST_CHAT_COPY.confirm).disabled).toBe(true);
  });

  it("첫 대화: 고른 단계·달·지역·하객 수가 말풍선과 초안이 되고, 좋아요를 누르면 저장한 뒤 웨딩홀로 간다", async () => {
    const api = homeRoutes({
      "GET /api/invitation/conditions": json(MISSING_CONDITIONS),
      "PATCH /api/invitation/conditions": json(conditionsResponse()),
    });
    const { container } = await render(<LiveLounge />);

    await click(buttonNamed(container, FIRST_CHAT_COPY.stages[1].label));
    await click(buttonNamed(container, FIRST_CHAT_COPY.monthLabel(5)));
    await click(buttonNamed(container, "서울"));
    await click(buttonNamed(container, FIRST_CHAT_INPUT_COPY.guestChoiceLabel(200)));
    expect(container.textContent).toContain(FIRST_CHAT_COPY.stages[1].answer);
    expect(container.textContent).toContain(FIRST_CHAT_COPY.regionGuestsAnswer("서울", 200));
    expect(text(container.querySelector('[data-invitation-card="draft"]'))).toContain(FIRST_CHAT_COPY.draftLine("서울", 200));

    await click(buttonNamed(container, FIRST_CHAT_COPY.confirm));
    const body = api.last("PATCH", "/api/invitation/conditions")?.body as Record<string, unknown>;
    const kstYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
    expect(body).toEqual({ hopedYear: kstYear + 1, hopedMonth: 5, region: "서울", guestCount: 200, startStage: "researching" });
    expect(mocks.push).toHaveBeenCalledWith("/wedding/halls");
    // 저장 직후 홈이 잠깐 비치지 않는다.
    expect(container.querySelector('[data-invitation-screen="home"]')).toBeNull();
  });

  it("첫 대화: 저장하지 못하면 다시 누르라고 말하고 첫 대화에 남는다. 고칠게요는 고른 답을 비운다", async () => {
    homeRoutes({
      "GET /api/invitation/conditions": json(MISSING_CONDITIONS),
      "PATCH /api/invitation/conditions": apiError(503, "PLAN_CHANGE_UNAVAILABLE", "저장 상태를 확인하지 못했어요."),
    });
    const { container } = await render(<LiveLounge />);
    await click(buttonNamed(container, FIRST_CHAT_COPY.monthLabel(5)));
    await click(buttonNamed(container, "부산"));
    await click(buttonNamed(container, FIRST_CHAT_INPUT_COPY.guestChoiceLabel(150)));
    await click(buttonNamed(container, FIRST_CHAT_COPY.confirm));

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(FIRST_CHAT_INPUT_COPY.saveFailed);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.querySelector('[data-invitation-screen="chat"]')).not.toBeNull();

    await click(buttonNamed(container, FIRST_CHAT_COPY.edit));
    expect(container.textContent).not.toContain(FIRST_CHAT_COPY.regionGuestsAnswer("부산", 150));
    expect(buttonNamed(container, "부산").getAttribute("aria-pressed")).toBe("false");
    expect(buttonNamed(container, FIRST_CHAT_COPY.confirm).disabled).toBe(true);
  });

  it("좁은 화면: 조건이 다 있으면 서버 모델로 청첩장 홈을 그리고, 하단 메뉴는 라운지·대화·준비 순서·일정이다", async () => {
    const api = homeRoutes();
    const { container } = await render(<LiveLounge />);

    expect(container.querySelector('[data-invitation-screen="home"]')).not.toBeNull();
    expect(api.count("GET", "/api/invitation/home")).toBe(1);
    const nav = container.querySelector(`nav[aria-label="${HOME_COPY.nav.label}"]`);
    expect(Array.from(nav?.querySelectorAll("a") ?? []).map((link) => link.getAttribute("href"))).toEqual([
      "/wedding/lounge",
      "/wedding/chat",
      "/wedding/journey",
      "/wedding/schedule",
    ]);
    // 옛 사이드바를 걷어 낸 자리라 다른 화면 링크와 AI 서비스 고지가 홈 맨 아래에 있다.
    for (const href of ["/wedding/budget", "/wedding/checklist", "/wedding/settings", "/wedding/manners"]) {
      expect(linkTo(container, href)).not.toBeNull();
    }
    expect(container.textContent).toContain("AI 기반 서비스 고지");
    expect(mocks.proactive).toHaveBeenCalledTimes(1);
  });

  it("무엇을 했나요? 목록은 담당자가 한 일을 아모라의 일처럼 쓰지 않는다", async () => {
    homeRoutes();
    const { container } = await render(<LiveLounge />);
    await click(buttonNamed(container, HOME_COPY.whatDidYouDo));
    const steps = Array.from(container.querySelectorAll("ol li")).map((item) => text(item));
    expect(steps).toEqual([
      `${ACTIVITY_COPY.actorLabel.operator} · 승인한 편지를 2곳에 보냈어요`,
      `${ACTIVITY_COPY.actorLabel.operator} · 가온 웨딩홀 답장을 정리했어요`,
    ]);
  });

  it("홈을 읽지 못하면 상태 문구와 다시 불러오기를 보이고, 누르면 다시 읽는다", async () => {
    const api = homeRoutes({
      "GET /api/invitation/home": [apiError(503, "HOME_UNAVAILABLE", "홈을 불러오지 못했어요."), json(homeResponse())],
    });
    const { container } = await render(<LiveLounge />);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(HOME_STATE_COPY.loadFailed);

    await click(buttonNamed(container, "다시 불러오기"));
    expect(api.count("GET", "/api/invitation/home")).toBe(2);
    expect(container.querySelector('[data-invitation-screen="home"]')).not.toBeNull();
  });

  it("두 분이 정할 것을 읽지 못했으면 빈 목록으로 숨기지 않는다. 정말 없으면 그렇다고 말한다", async () => {
    homeRoutes({ "GET /api/invitation/home": json(homeResponse({ degraded: ["decisions"] })) });
    const first = await render(<LiveLounge />);
    // 홈 전체가 아니라 정할 것 목록만 읽지 못했다는 상태 문구다.
    expect(first.container.querySelector('[role="alert"]')?.textContent).toBe(HOME_STATE_COPY.decisionsUnavailable);
    expect(buttonNamed(first.container, "다시 불러오기")).toBeDefined();
    await cleanup();

    homeRoutes({ "GET /api/invitation/home": json(homeResponse({ home: { ...homeResponse().home, decisions: [] } })) });
    const second = await render(<LiveLounge />);
    expect(second.container.textContent).toContain(HOME_STATE_COPY.noDecisions);
  });

  it("넓은 화면: 두 칸이고 왼쪽에는 실제 대화 칸 하나(청첩장 모양), 오른쪽에는 홈과 누가 한 일인지 붙은 오늘 한 일", async () => {
    mockWide(true);
    homeRoutes({
      "GET /api/invitation/activity": json(ACTIVITY),
      "GET /api/invitation/halls": json(hallsResponse()),
      "GET /api/invitation/journey": json(journeyResponse()),
    });
    const { container } = await render(<LiveLounge />);

    expect(container.querySelector('[data-invitation-screen="web"]')).not.toBeNull();
    const panels = container.querySelectorAll("[data-chat-panel]");
    expect(panels).toHaveLength(1);
    expect(panels[0].getAttribute("data-chat-panel")).toBe("invitation");
    expect(panels[0].getAttribute("data-open")).toBe("true");
    const activity = Array.from(container.querySelectorAll("li[data-actor]")).map((item) => [
      item.getAttribute("data-actor"),
      text(item.querySelector("span:first-child")),
      text(item.querySelector("span:last-child")),
    ]);
    expect(activity).toEqual([
      ["operator", "13:40", `${ACTIVITY_COPY.actorLabel.operator} · 가온 웨딩홀 답장을 정리했어요`],
      ["couple", "11:05", `${ACTIVITY_COPY.actorLabel.couple} · 소담 하우스 상담을 일정에 넣었어요`],
    ]);
    expect(container.querySelector("[data-live-footer]")).not.toBeNull();
  });

  it("넓은 화면: 확인한 홀이 없으면 웨딩홀 후보 칸이 그렇다고 말한다(운영의 지금 모습)", async () => {
    mockWide(true);
    homeRoutes({
      "GET /api/invitation/activity": json({ activity: [] }),
      "GET /api/invitation/halls": json(hallsResponse({ compare: { ...hallsResponse().compare!, halls: [] } })),
      "GET /api/invitation/journey": json(journeyResponse()),
    });
    const { container } = await render(<LiveLounge />);
    expect(container.querySelector('[data-panel="halls"]')?.textContent).toContain(COMPARE_STATE_COPY.noHalls);
    expect(container.querySelector('[data-panel="today"]')?.textContent).toContain(ACTIVITY_COPY.empty);
  });

  it("체험 모드는 서버를 부르지 않고 예시 커플을, 예시라는 줄과 함께 보인다", async () => {
    mocks.auth.isDemo = true;
    const api = mockApi({});
    const { container } = await render(<LiveLounge />);
    expect(api.calls).toHaveLength(0);
    expect(container.querySelector("[data-example-banner]")?.textContent).toBe(EXAMPLE_COPY.banner);
    expect(container.querySelector('[data-invitation-screen="home"]')).not.toBeNull();
    expect(mocks.proactive).not.toHaveBeenCalled();
  });

  it("같은 탭에서 계정이 바뀌면 앞 사람의 청첩장을 곧바로 지운다", async () => {
    homeRoutes({ "GET /api/invitation/home": [json(homeResponse()), never] });
    const view = await render(<LiveLounge />);
    expect(view.container.textContent).toContain("민지");

    mocks.auth.user = { id: "user-9", email: "next@example.test" };
    mocks.auth.profile = { id: "user-9", name: "다른 사람", onboarding_completed: true };
    mocks.auth.partner = null;
    await view.rerender(<LiveLounge />);
    expect(view.container.textContent).not.toContain("민지");
    expect(view.container.textContent).not.toContain("준호");
  });
});

describe("아모라와 대화 /chat", () => {
  it("좁은 화면: 첫 대화 머리(뒤로·오브·듣고 있어요) 아래 실제 대화 칸을 청첩장 모양으로 연다", async () => {
    mockApi({});
    const { container } = await render(<LiveChat />);
    const screen = container.querySelector('[data-invitation-screen="live-chat"]');
    expect(screen).not.toBeNull();
    expect(screen?.textContent).toContain(FIRST_CHAT_COPY.listening);
    expect(screen?.querySelector(`a[aria-label="${FIRST_CHAT_COPY.back}"]`)?.getAttribute("href")).toBe("/wedding/lounge");
    expect(container.querySelectorAll('[data-chat-panel="invitation"]')).toHaveLength(1);
    expect(container.querySelector("[data-full-chat]")).toBeNull();
  });

  it.each(["scope=private", "prefill=%EC%98%88%EC%82%B0", "amoraExpand=nonce", "wcTasteChat=1", "startHereHandoff=abc", "amoraSource=c.venue"])(
    "다른 화면의 인계(%s)를 들고 오면 그 인계를 처리하는 전체 화면 대화를 연다",
    async (query) => {
      mocks.params = new URLSearchParams(query);
      mockApi({});
      const view = await render(<LiveChat />);
      expect(view.container.querySelector("[data-full-chat]")).not.toBeNull();
      expect(view.container.querySelector("[data-chat-panel]")).toBeNull();

      // 전체 화면 대화가 인계를 받고 주소를 지워도 이 방문 동안은 그대로 둔다(쓰던 초안이 사라지지 않게).
      mocks.params = new URLSearchParams();
      await view.rerender(<LiveChat />);
      expect(view.container.querySelector("[data-full-chat]")).not.toBeNull();
    },
  );

  it("넓은 화면은 라운지와 같은 두 칸이다", async () => {
    mockWide(true);
    homeRoutes({
      "GET /api/invitation/activity": json(ACTIVITY),
      "GET /api/invitation/halls": json(hallsResponse()),
      "GET /api/invitation/journey": json(journeyResponse()),
    });
    const { container } = await render(<LiveChat />);
    expect(container.querySelector('[data-invitation-screen="web"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-chat-panel="invitation"]')).toHaveLength(1);
  });
});

describe("웨딩홀 비교 /halls", () => {
  it("조건이 모자라면 같은 기준으로 맞춰 보려면 조건이 필요하다고 말하고 첫 대화를 다시 연다(건너뛰었어도)", async () => {
    mockApi({ "GET /api/invitation/halls": json(hallsResponse({ compare: null, missing: ["region", "guests"] })) });
    const { container } = await render(<LiveHalls />);
    const empty = container.querySelector("[data-compare-empty]");
    expect(empty?.textContent).toContain(COMPARE_STATE_COPY.needConditions);
    expect(linkTo(empty as Element, "/wedding/lounge?conditions=1")?.textContent).toBe(COMPARE_STATE_COPY.needConditionsAction);
    expect(container.textContent).not.toContain("문의 편지 쓰기");
  });

  it("확인한 홀이 없으면 그렇다고 말한다(운영에서 지금 보이는 화면)", async () => {
    mockApi({ "GET /api/invitation/halls": json(hallsResponse({ compare: { ...hallsResponse().compare!, halls: [] } })) });
    const { container } = await render(<LiveHalls />);
    const empty = container.querySelector("[data-compare-empty]");
    expect(empty?.textContent).toContain(COMPARE_STATE_COPY.noHalls);
    expect(empty?.textContent).toContain(COMPARE_STATE_COPY.noHallsSub);
  });

  it("불러오지 못하면 상태 문구와 다시 불러오기", async () => {
    const api = mockApi({
      "GET /api/invitation/halls": [apiError(503, "HALLS_UNAVAILABLE", "웨딩홀을 불러오지 못했어요."), json(hallsResponse())],
    });
    const { container } = await render(<LiveHalls />);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(COMPARE_STATE_COPY.loadFailed);
    await click(buttonNamed(container, "다시 불러오기"));
    expect(api.count("GET", "/api/invitation/halls")).toBe(2);
    expect(container.querySelector(`[data-hall="${HALL_A}"]`)).not.toBeNull();
  });

  it("홀이 있으면 https 사진을 그대로 쓰고, 아직 안 담았으면 담으라고 안내하며 문의 단추는 잠겨 있다", async () => {
    mockApi({
      "GET /api/invitation/halls": json(hallsResponse()),
      [`POST /api/invitation/halls/${HALL_A}/shortlist`]: json({ hallId: HALL_A, picked: true, pickedCount: 1 }),
    });
    const { container } = await render(<LiveHalls />);
    expect(container.querySelector(`[data-hall="${HALL_A}"] img`)?.getAttribute("src")).toBe("https://images.example.test/hall-a.webp");
    expect(container.textContent).toContain(COMPARE_STATE_COPY.pickFirst);

    await click(buttonNamed(container, "하나 웨딩홀 상담 후보에 담기"));
    expect(container.textContent).not.toContain(COMPARE_STATE_COPY.pickFirst);
    expect(linkTo(container, "/wedding/halls/letter")).not.toBeNull();
  });

  it("정렬 칩은 그 기준으로 서버에 다시 묻는다", async () => {
    const api = mockApi({ "GET /api/invitation/halls": json(hallsResponse()) });
    const { container } = await render(<LiveHalls />);
    await click(buttonNamed(container, "교통"));
    expect(api.last("GET", "/api/invitation/halls")?.url).toBe("/api/invitation/halls?sort=transit");
  });
});

describe("보내기 전 편지 확인 /halls/letter", () => {
  function letterRoutes(overrides: Parameters<typeof mockApi>[0] = {}) {
    return mockApi({
      "GET /api/invitation/approver": json(approverResponse()),
      "GET /api/invitation/letter": json(letterResponse()),
      ...overrides,
    });
  }

  it("시트 안에서 누가 승인할지 고른다(두 사람·두 분 모두)", async () => {
    const api = letterRoutes({
      "PUT /api/invitation/approver": json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 2 } })),
    });
    const { container } = await render(<LiveLetter />);
    const picker = container.querySelector("[data-letter-approver]");
    expect(picker?.textContent).toContain(LETTER_STATE_COPY.approverHeading);
    expect(picker?.textContent).toContain(LETTER_STATE_COPY.approverUnset);

    await click(buttonNamed(container, LETTER_STATE_COPY.approverBoth));
    expect(api.last("PUT", "/api/invitation/approver")?.body).toEqual({ mode: "both" });
    expect(container.querySelector("[data-letter-approver]")?.textContent).toContain(LETTER_STATE_COPY.approverNeedsBoth);
  });

  it("보내기를 눌러도 보내기 스위치가 꺼져 있으면 업체에 가지 않았다고 사실대로 말한다", async () => {
    letterRoutes({
      "PUT /api/invitation/letter": json({
        ...letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT }),
        saved: { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, created: true },
      }),
      "POST /api/invitation/letter/approve": json({
        result: { status: "approved_not_queued", notQueuedReason: "sending_disabled", queuedCount: 0, duplicateHallIds: [], waitingFor: [] },
        letter: letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, status: "approved_not_queued", notQueuedReason: "sending_disabled" }),
      }),
    });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.send));
    expect(container.textContent).toContain(LETTER_STATE_COPY.approvedNotSent);
  });

  it("그 사이 편지가 바뀌었으면 다시 확인하라고 말한다(409)", async () => {
    letterRoutes({
      "GET /api/invitation/letter": json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT })),
      "POST /api/invitation/letter/approve": apiError(409, "LETTER_VERSION_CHANGED", "편지 내용이 바뀌었어요."),
    });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.send));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(LETTER_STATE_COPY.versionChanged);
  });

  it("이미 보낸 편지는 보내기가 잠기고 그렇다고 말한다", async () => {
    letterRoutes({
      "GET /api/invitation/letter": json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, status: "queued", viewerCanApprove: false })),
    });
    const { container } = await render(<LiveLetter />);
    expect(buttonNamed(container, LETTER_COPY.send).disabled).toBe(true);
    expect(container.textContent).toContain(LETTER_STATE_COPY.alreadySent);
  });

  it("담은 홀이 없으면 먼저 담으라고 하고 비교로 돌아가는 길을 준다", async () => {
    letterRoutes({ "GET /api/invitation/letter": json({ letter: null, state: null, missing: ["shortlist"] }) });
    const { container } = await render(<LiveLetter />);
    expect(container.textContent).toContain(LETTER_STATE_COPY.needShortlist);
    expect(container.querySelector(`a[aria-label="${FIRST_CHAT_COPY.back}"]`)?.getAttribute("href")).toBe("/wedding/halls");
  });

  it("문구 고치기를 누르면 편지 글을 고치는 칸이 열린다", async () => {
    letterRoutes();
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.editText));
    expect(container.querySelector(`textarea[aria-label="${LETTER_COPY.editText}"]`)).not.toBeNull();
  });

  it("보내기를 같은 순간 두 번 눌러도 승인은 한 번만 나간다", async () => {
    const api = letterRoutes({
      "GET /api/invitation/letter": json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT })),
      "POST /api/invitation/letter/approve": json({
        result: { status: "approved_not_queued", notQueuedReason: "sending_disabled", queuedCount: 0, duplicateHallIds: [], waitingFor: [] },
        letter: letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, status: "approved_not_queued", notQueuedReason: "sending_disabled" }),
      }),
    });
    const { container } = await render(<LiveLetter />);
    const send = buttonNamed(container, LETTER_COPY.send);
    // 같은 그림에서 두 번 — 단추가 잠기기 전이다.
    await act(async () => {
      send.click();
      send.click();
    });
    await flush();
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(1);
  });

  it("편지를 불러오지 못했는데 서버가 이유를 말하지 않으면 편지의 상태 문구를 쓴다", async () => {
    letterRoutes({ "GET /api/invitation/letter": () => Promise.reject(new TypeError("Failed to fetch")) });
    const { container } = await render(<LiveLetter />);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(LETTER_STATE_COPY.loadFailed);
  });

  it("상대가 아직 들어오지 않았으면(회원 한 명) 승인할 사람을 고를 수 없다고 말하고 고르는 단추를 두지 않는다", async () => {
    letterRoutes({ "GET /api/invitation/approver": json(approverResponse({ members: [{ id: VIEWER, name: "민지", isViewer: true }] })) });
    const { container } = await render(<LiveLetter />);
    const box = container.querySelector('[data-letter-approver="unavailable"]');
    expect(box?.textContent).toContain(LETTER_STATE_COPY.approverUnavailable);
    expect(box?.querySelectorAll("button")).toHaveLength(0);
  });

  it("승인 방식 제안: 제안한 사람에게는 상대가 확인하면 바뀐다고만 말하고 확인·거절 단추를 주지 않는다", async () => {
    letterRoutes({
      "GET /api/invitation/approver": json(approverResponse({
        setting: { mode: "both", designatedUserId: null, revision: 3 },
        pending: { proposalId: PROPOSAL, mode: "designated", designatedUserId: VIEWER, proposedBy: VIEWER, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: false },
      })),
    });
    const { container } = await render(<LiveLetter />);
    const waiting = container.querySelector('[data-letter-approver-pending="waiting"]');
    expect(waiting?.textContent).toBe(LETTER_STATE_COPY.approverPending);
    // 확인 전까지는 지금 방식(두 분 모두)이 그대로이고, 제안한 쪽(민지)은 점선으로만 표시한다.
    expect(buttonNamed(container, LETTER_STATE_COPY.approverBoth).getAttribute("aria-pressed")).toBe("true");
    expect(buttonNamed(container, LETTER_STATE_COPY.approverPerson("민지")).getAttribute("aria-pressed")).toBe("false");
    expect(buttonNamed(container, LETTER_STATE_COPY.approverPerson("민지")).className).toContain("border-dashed");
    const names = Array.from(container.querySelectorAll("button")).map((button) => text(button));
    expect(names).not.toContain(LETTER_STATE_COPY.approverConfirm);
    expect(names).not.toContain(LETTER_STATE_COPY.approverDecline);
    expect(container.querySelector('[data-letter-approver-pending="respond"]')).toBeNull();
  });

  it("승인 방식 제안: 상대는 누가 무엇을 제안했는지 보고 확인하면 그 제안 ID 로 확인을 보내고 편지 상태를 다시 읽는다", async () => {
    const api = letterRoutes({
      "GET /api/invitation/approver": json(approverResponse({
        setting: { mode: "both", designatedUserId: null, revision: 3 },
        pending: { proposalId: PROPOSAL, mode: "designated", designatedUserId: PARTNER, proposedBy: PARTNER, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: true },
      })),
      "POST /api/invitation/approver/confirm": json(approverResponse({
        setting: { mode: "designated", designatedUserId: PARTNER, revision: 4 },
        pending: null,
        outcome: "confirmed",
      })),
    });
    const { container } = await render(<LiveLetter />);
    const respond = container.querySelector('[data-letter-approver-pending="respond"]');
    expect(respond?.textContent).toContain(LETTER_STATE_COPY.approverProposedBy("준호", "준호"));
    expect(respond?.textContent).toContain("준호 님이 승인할 사람을 준호로 바꾸자고 했어요.");

    await click(buttonNamed(respond as Element, LETTER_STATE_COPY.approverConfirm));
    expect(api.last("POST", "/api/invitation/approver/confirm")?.body).toEqual({ proposalId: PROPOSAL });
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
    expect(container.querySelector('[data-letter-approver-pending="respond"]')).toBeNull();
    expect(container.querySelector("[data-letter-approver]")?.textContent).toContain(LETTER_STATE_COPY.approverDesignated("준호"));
  });

  it("승인 방식 제안: 그 사이 제안이 바뀌었으면(409) 서버가 말한 이유를 보이고 승인 방식을 다시 읽는다. 거절은 편지를 다시 읽지 않는다", async () => {
    const pending = { proposalId: PROPOSAL, mode: "designated" as const, designatedUserId: PARTNER, proposedBy: PARTNER, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: true };
    const api = letterRoutes({
      "GET /api/invitation/approver": json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 3 }, pending })),
      "POST /api/invitation/approver/decline": [
        apiError(409, "APPROVER_PROPOSAL_CHANGED", "제안이 바뀌었어요. 다시 확인해 주세요."),
        json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 3 }, pending: null, outcome: "declined" })),
      ],
    });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_STATE_COPY.approverDecline));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("제안이 바뀌었어요. 다시 확인해 주세요.");
    expect(api.count("GET", "/api/invitation/approver")).toBe(2);

    await click(buttonNamed(container, LETTER_STATE_COPY.approverDecline));
    expect(api.count("POST", "/api/invitation/approver/decline")).toBe(2);
    expect(api.count("GET", "/api/invitation/letter")).toBe(1);
    expect(container.querySelector('[data-letter-approver-pending="respond"]')).toBeNull();
  });

  it("상대의 권한을 줄이는 변경은 제안으로만 남아 편지를 다시 읽지 않는다", async () => {
    const api = letterRoutes({
      "GET /api/invitation/approver": json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 3 } })),
      "PUT /api/invitation/approver": json(approverResponse({
        setting: { mode: "both", designatedUserId: null, revision: 3 },
        pending: { proposalId: PROPOSAL, mode: "designated", designatedUserId: VIEWER, proposedBy: VIEWER, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: false },
        outcome: "proposed",
      })),
    });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_STATE_COPY.approverPerson("민지")));
    expect(api.last("PUT", "/api/invitation/approver")?.body).toEqual({ mode: "designated", designatedUserId: VIEWER });
    expect(api.count("GET", "/api/invitation/letter")).toBe(1);
    expect(container.querySelector('[data-letter-approver-pending="waiting"]')?.textContent).toBe(LETTER_STATE_COPY.approverPending);
  });

  it("제안한 사람은 지금 방식을 다시 골라 제안을 거둔다(편지는 다시 읽지 않는다). 바로 바뀌면 편지를 다시 읽는다", async () => {
    const api = letterRoutes({
      "GET /api/invitation/approver": json(approverResponse({
        setting: { mode: "both", designatedUserId: null, revision: 3 },
        pending: { proposalId: PROPOSAL, mode: "designated", designatedUserId: VIEWER, proposedBy: VIEWER, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: false },
      })),
      "PUT /api/invitation/approver": [
        json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 3 }, pending: null, outcome: "withdrawn" })),
        json(approverResponse({ setting: { mode: "designated", designatedUserId: PARTNER, revision: 4 }, pending: null, outcome: "applied" })),
      ],
    });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_STATE_COPY.approverBoth));
    expect(api.last("PUT", "/api/invitation/approver")?.body).toEqual({ mode: "both" });
    expect(container.querySelector("[data-letter-approver-pending]")).toBeNull();
    expect(api.count("GET", "/api/invitation/letter")).toBe(1);

    await click(buttonNamed(container, LETTER_STATE_COPY.approverPerson("준호")));
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
  });

  it("문의 보내기가 켜진 지금, 꺼진 동안 승인한 사람은 다시 승인해야 하므로 기다리는 사람으로 말한다(꺼져 있으면 말하지 않는다)", async () => {
    const paused = { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, status: "awaiting_approval" as const, approver: { mode: "both" as const, designatedUserId: null, revision: 3 }, approvedBy: [], waitingFor: [VIEWER], approvedWhilePaused: [PARTNER] };
    letterRoutes({ "GET /api/invitation/letter": json(letterResponse({ ...paused, sendingEnabled: true })) });
    const on = await render(<LiveLetter />);
    expect(on.container.textContent).toContain(LETTER_STATE_COPY.waitingFor("준호"));
    await cleanup();

    letterRoutes({ "GET /api/invitation/letter": json(letterResponse({ ...paused, sendingEnabled: false })) });
    const off = await render(<LiveLetter />);
    expect(off.container.textContent).not.toContain(LETTER_STATE_COPY.waitingFor("준호"));
  });

  it("서비스 전체의 하루 상한(global_daily_cap)도 하루 상한과 같은 말로 알린다", async () => {
    letterRoutes({
      "GET /api/invitation/letter": json(letterResponse({ letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT })),
      "POST /api/invitation/letter/approve": json({
        result: { status: "approved_not_queued", notQueuedReason: "global_daily_cap", queuedCount: 0, duplicateHallIds: [], waitingFor: [] },
        letter: null,
      }),
    });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.send));
    expect(container.textContent).toContain(LETTER_STATE_COPY.dailyCap);
  });
});

describe("답장과 상담 확정 /halls/consultation", () => {
  it("확정된 상담이 없으면 아직 없다고 말하고 전체 일정으로 가는 길을 준다", async () => {
    mockApi({ "GET /api/invitation/consultation": json({ consultation: null, replyId: null, inCalendar: false, startsAt: null }) });
    const { container } = await render(<LiveConsultation />);
    expect(container.textContent).toContain(CONSULTATION_STATE_COPY.none);
    expect(container.textContent).toContain(CONSULTATION_STATE_COPY.noneSub);
    expect(linkTo(container, "/wedding/schedule")?.textContent).toBe(CONSULTATION_STATE_COPY.fullSchedule);
  });

  it("불러오지 못했는데 서버가 이유를 말하지 않으면 상담의 상태 문구를 쓰고, 이유를 말하면 그 문장을 쓴다", async () => {
    mockApi({ "GET /api/invitation/consultation": () => Promise.reject(new TypeError("Failed to fetch")) });
    const first = await render(<LiveConsultation />);
    expect(first.container.querySelector('[role="alert"]')?.textContent).toBe(CONSULTATION_STATE_COPY.loadFailed);
    await cleanup();

    mockApi({ "GET /api/invitation/consultation": apiError(401, "UNAUTHORIZED", "로그인이 필요해요.") });
    const second = await render(<LiveConsultation />);
    expect(second.container.querySelector('[role="alert"]')?.textContent).toBe("로그인이 필요해요.");
  });

  it("일정에 없으면 일정에 넣기를 눌러야만 넣고, 넣은 뒤 그렇다고 바꾼다", async () => {
    const api = mockApi({
      "GET /api/invitation/consultation": json(consultationResponse()),
      "POST /api/invitation/consultation/schedule": json({ added: true, alreadyInCalendar: false, eventId: "event-1" }),
    });
    const { container } = await render(<LiveConsultation />);
    expect(api.count("POST", "/api/invitation/consultation/schedule")).toBe(0);

    await click(buttonNamed(container, CONSULTATION_STATE_COPY.addToCalendar));
    expect(api.last("POST", "/api/invitation/consultation/schedule")?.body).toEqual({ replyId: REPLY });
    expect(buttonNamed(container, CONSULTATION_STATE_COPY.added)).toBeDefined();
  });

  it("서버 경로가 없는 업체 답하기·공유 단추는 그리지 않는다(눌러도 아무 일이 없는 단추를 두지 않는다)", async () => {
    mockApi({ "GET /api/invitation/consultation": json(consultationResponse({ inCalendar: true })) });
    const { container } = await render(<LiveConsultation />);
    expect(container.textContent).not.toContain(STATUS_COPY.requestThisTime);
    expect(container.textContent).not.toContain(STATUS_COPY.askOtherTime);
    expect(container.textContent).not.toContain(STATUS_COPY.shareWith("준호"));
    await click(buttonNamed(container, STATUS_COPY.inCalendar));
    expect(mocks.push).toHaveBeenCalledWith("/wedding/schedule");
  });
});

describe("준비 순서 /journey", () => {
  it("빼기를 저장하지 못하면 되돌리고 다시 누르라고 말한다", async () => {
    mockApi({
      "GET /api/invitation/journey": json(journeyResponse()),
      "PATCH /api/invitation/journey-plan": apiError(503, "PLAN_CHANGE_UNAVAILABLE", "저장 상태를 확인하지 못했어요."),
    });
    const { container } = await render(<LiveJourney />);
    const row = () => container.querySelector('[data-step="families"]');
    await click(row()?.querySelector("button"));
    expect(row()?.getAttribute("data-off")).toBe("false");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(JOURNEY_STATE_COPY.saveFailed);
  });

  it("불러오지 못했는데 서버가 이유를 말하지 않으면(연결 끊김) 준비 순서의 상태 문구를 쓴다", async () => {
    mockApi({ "GET /api/invitation/journey": () => Promise.reject(new TypeError("Failed to fetch")) });
    const { container } = await render(<LiveJourney />);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(JOURNEY_STATE_COPY.loadFailed);
    expect(container.textContent).not.toContain("잠시 후 다시 시도해 주세요");
  });

  it("이 순서로 할게요는 저장이 끝난 뒤 청첩장 홈으로 간다", async () => {
    const api = mockApi({
      "GET /api/invitation/journey": json(journeyResponse()),
      "PATCH /api/invitation/journey-plan": json(journeyResponse({ off: ["honeymoon"], addOns: [] })),
    });
    const { container } = await render(<LiveJourney />);
    await click(container.querySelector('[data-step="honeymoon"] button'));
    await click(buttonNamed(container, JOURNEY_COPY.confirm));
    await flush();
    expect(api.last("PATCH", "/api/invitation/journey-plan")?.body).toEqual({ off: ["honeymoon"], addOns: [] });
    expect(mocks.push).toHaveBeenCalledWith("/wedding/lounge");
    expect(container.querySelector('[data-step="honeymoon"]')?.getAttribute("data-off")).toBe("true");
  });
});
