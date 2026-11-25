import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_COPY,
  COMPARE_STATE_COPY,
  CONSULTATION_STATE_COPY,
  EXAMPLE_COPY,
  EXAMPLE_LETTER,
  FIRST_CHAT_COPY,
  FIRST_CHAT_INPUT_COPY,
  HOME_COPY,
  HOME_STATE_COPY,
  JOURNEY_COPY,
  JOURNEY_STATE_COPY,
  LETTER_COPY,
  LETTER_STATE_COPY,
  SELF_SEND_COPY,
  STATUS_COPY,
  VENDOR_REPLY_COPY,
  readVendorReply,
} from "@hanbang/shared/invitation";

import { resetFirstChatLaterForTest } from "../firstChatLater";
import LiveChat from "../LiveChat";
import LiveConsultation from "../LiveConsultation";
import LiveHalls from "../LiveHalls";
import LiveJourney from "../LiveJourney";
import LiveLetter from "../LiveLetter";
import LiveLounge from "../LiveLounge";
import SelfSendPanel from "../SelfSendPanel";
import {
  ACTIVITY,
  FINGERPRINT,
  HALL_A,
  HALL_B,
  LETTER_ID,
  MISSING_CONDITIONS,
  NEXT_FINGERPRINT,
  NEXT_VERSION,
  PARTNER,
  REPLY,
  REPLY_PASTE,
  VERSION,
  VIEWER,
  approverResponse,
  conditionsResponse,
  consultationResponse,
  hallsResponse,
  homeResponse,
  journeyResponse,
  letterResponse,
  replyPaste,
  selfSendFor,
  selfSendLetterResponse,
} from "./liveFixtures";
import {
  apiError,
  buttonNamed,
  cleanup,
  clearWide,
  click,
  flush,
  json,
  linkNamed,
  linkTo,
  mockApi,
  mockWide,
  never,
  render,
  text,
  typeInto,
} from "./liveTestKit";

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

  // `wcTasteChat`(웨딩코드 넘겨받기)는 2026-11-22 웨딩코드를 내리면서 끊어 이 목록에서 뺐다.
  it.each(["scope=private", "prefill=%EC%98%88%EC%82%B0", "amoraExpand=nonce", "startHereHandoff=abc", "amoraSource=c.venue"])(
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

/** 공유 창·클립보드·브라우저 이름표·옛 복사 명령을 시험 안에서만 바꾼다. jsdom 에는 공유 창과 클립보드가 없다. */
const NAVIGATOR_STUBS = ["share", "canShare", "clipboard", "userAgent"] as const;

/** 문자 앱을 여는 폰의 브라우저 이름표. jsdom 의 기본 이름표는 컴퓨터(`other`)로 읽혀 "문자로 열기"가 없다. */
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

function stubNavigator(key: (typeof NAVIGATOR_STUBS)[number], value: unknown) {
  Object.defineProperty(window.navigator, key, { configurable: true, writable: true, value });
}

function stubExecCommand(copied: boolean) {
  const execCommand = vi.fn(() => copied);
  Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: execCommand });
  return execCommand;
}

function restoreBrowserStubs() {
  for (const key of NAVIGATOR_STUBS) Reflect.deleteProperty(window.navigator, key);
  Reflect.deleteProperty(document, "execCommand");
}

/** 판단하는 말(`hallCompare.test.ts` 와 같은 목록). 우리가 붙이는 이름표에는 없어야 한다. */
const JUDGEMENT_WORDS = /추천|최고|가성비|저렴|1위|합리적|순위|점수|등급|보장/;

describe("직접 보내기(D-83 1단계) /halls/letter", () => {
  const SAVED = { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, status: "awaiting_approval" as const };

  function selfSendRoutes(overrides: Parameters<typeof mockApi>[0] = {}) {
    return mockApi({
      "GET /api/invitation/approver": json(approverResponse()),
      "GET /api/invitation/letter": json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor() })),
      ...overrides,
    });
  }

  function card(scope: ParentNode, hallId: string): Element {
    const found = scope.querySelector(`[data-self-send-message="${hallId}"]`);
    if (!found) throw new Error(`보낼 글 ${hallId} 이 없다`);
    return found;
  }

  const statusOf = (scope: Element) => scope.querySelector('[role="status"]')?.textContent ?? null;

  afterEach(restoreBrowserStubs);

  it("꺼진 서버(칸 없음)는 예전 그대로다: 승인 칸·보내기 단추·상태 줄이 있고, 보낼 글·조건 묻기·다른 요청은 없다", async () => {
    const api = mockApi({
      "GET /api/invitation/approver": json(approverResponse()),
      "GET /api/invitation/letter": json(letterResponse(
        { ...SAVED, status: "approved_not_queued", notQueuedReason: "sending_disabled" },
        { missing: ["month", "guests"] },
      )),
    });
    const { container } = await render(<LiveLetter />);

    expect(text(container.querySelector("h1"))).toBe(LETTER_COPY.title(2));
    expect(container.querySelector("[data-letter-approver]")).not.toBeNull();
    expect(buttonNamed(container, LETTER_COPY.send)).toBeDefined();
    expect(container.textContent).toContain(LETTER_STATE_COPY.approvedNotSent);
    expect(container.querySelector("[data-self-send]")).toBeNull();
    expect(container.querySelector("[data-self-send-missing]")).toBeNull();
    for (const line of [SELF_SEND_COPY.intro, SELF_SEND_COPY.save, SELF_SEND_COPY.saveFirst, SELF_SEND_COPY.missingConditions, SELF_SEND_COPY.beforeSave]) {
      expect(container.textContent).not.toContain(line);
    }
    expect(api.calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /api/invitation/approver",
      "GET /api/invitation/letter",
    ]);
  });

  it("꺼진 서버는 저장한 판이 없는 초안이어도 저장하면 보낼 글이 나온다는 줄을 보이지 않는다(보내기가 판을 저장하고 승인한다)", async () => {
    const api = mockApi({
      "GET /api/invitation/approver": json(approverResponse()),
      "GET /api/invitation/letter": json(letterResponse()),
    });
    const { container } = await render(<LiveLetter />);

    expect(buttonNamed(container, LETTER_COPY.send).disabled).toBe(false);
    expect(container.querySelector("[data-letter-approver]")).not.toBeNull();
    expect(container.querySelector("[data-self-send-before-save]")).toBeNull();
    expect(container.textContent).not.toContain(SELF_SEND_COPY.beforeSave);
    expect(api.calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /api/invitation/approver",
      "GET /api/invitation/letter",
    ]);
  });

  it("저장한 판이 있으면 받는 곳마다 보낼 글과 복사·공유·문자·찾아보기를 보이고, 승인 칸·승인 줄·상대가 읽었다는 줄은 없다", async () => {
    stubNavigator("userAgent", ANDROID_UA);
    const response = selfSendLetterResponse({ ...SAVED, status: "approved_not_queued", notQueuedReason: "sending_disabled" }, { selfSend: selfSendFor() });
    selfSendRoutes({ "GET /api/invitation/letter": json({ ...response, letter: { ...response.letter!, partnerApprovedName: "준호" } }) });
    const { container } = await render(<LiveLetter />);

    expect(text(container.querySelector("h1"))).toBe(LETTER_COPY.title(2));
    expect(container.querySelector("[data-letter-approver]")).toBeNull();
    expect(container.textContent).not.toContain(LETTER_STATE_COPY.approverHeading);
    expect(container.textContent).not.toContain(LETTER_STATE_COPY.approvedNotSent);
    expect(container.textContent).not.toContain(LETTER_COPY.partnerRead("준호"));
    // 이미 저장한 판이고 고친 것이 없으니 저장 단추는 잠겨 있다. 승인(보내기) 단추는 없다.
    expect(buttonNamed(container, SELF_SEND_COPY.save).disabled).toBe(true);
    expect(container.textContent).not.toContain(LETTER_COPY.send);

    expect(container.querySelector("[data-self-send]")?.textContent).toContain(SELF_SEND_COPY.intro);
    expect(Array.from(container.querySelectorAll("[data-self-send-message]")).map((node) => node.getAttribute("data-self-send-message")))
      .toEqual([HALL_A, HALL_B]);
    const message = selfSendFor().messages[0];
    const first = card(container, HALL_A);
    expect(text(first.querySelector("h2"))).toBe(SELF_SEND_COPY.messageFor("하나 웨딩홀"));
    // 서버가 엮은 글 그대로(줄바꿈 포함)다.
    expect(first.querySelector("[data-self-send-text]")?.textContent).toBe(message.text);
    expect(buttonNamed(first, SELF_SEND_COPY.copy)).toBeDefined();
    expect(buttonNamed(first, SELF_SEND_COPY.share)).toBeDefined();
    expect(linkNamed(first, SELF_SEND_COPY.sms).getAttribute("href")).toBe(`sms:?body=${encodeURIComponent(message.text)}`);
    const find = linkNamed(first, SELF_SEND_COPY.findHall);
    expect(find.getAttribute("href")).toBe(`https://m.search.naver.com/search.naver?query=${encodeURIComponent("하나 웨딩홀")}`);
    expect(find.getAttribute("target")).toBe("_blank");
    expect(find.getAttribute("rel")).toBe("noopener noreferrer");
    expect(statusOf(first)).toBe("");
    expect(container.textContent).toContain(SELF_SEND_COPY.afterSend);
    expect(linkTo(container, "/wedding/halls/consultation")?.textContent).toBe(SELF_SEND_COPY.openConsultation);
    expect(container.querySelector("[data-self-send-phone-omitted]")).toBeNull();
  });

  it("보낼 글은 화면 글자에만 있고, 클릭 흔적이 싣는 이름표 속성(aria-label·title·alt·name)에는 없다", async () => {
    selfSendRoutes();
    const { container } = await render(<LiveLetter />);
    const sample = EXAMPLE_LETTER.body.slice(0, 24);
    expect(container.querySelector("[data-self-send-text]")?.textContent).toContain(sample);
    for (const element of Array.from(container.querySelectorAll("*"))) {
      for (const attribute of ["aria-label", "title", "alt", "name"]) {
        expect(element.getAttribute(attribute) ?? "").not.toContain(sample);
      }
    }
  });

  it("고치면 보낼 글을 숨기고 먼저 저장하라고 말한다. 이 편지로 할게요는 PUT 만 부르고 승인은 부르지 않으며 새 판의 글을 보인다", async () => {
    const api = selfSendRoutes({
      "PUT /api/invitation/letter": json({
        ...selfSendLetterResponse(
          { ...SAVED, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT },
          { selfSend: selfSendFor(NEXT_VERSION, NEXT_FINGERPRINT) },
        ),
        saved: { letterId: LETTER_ID, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT, created: true },
      }),
    });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.switchLabel("예산")));
    expect(container.querySelector("[data-self-send]")).toBeNull();
    expect(container.textContent).toContain(SELF_SEND_COPY.saveFirst);
    const save = buttonNamed(container, SELF_SEND_COPY.save);
    expect(save.disabled).toBe(false);

    await click(save);
    const put = api.last("PUT", "/api/invitation/letter")?.body as { letterId: string; recipientHallIds: string[]; shares: { budget: { on: boolean } } };
    expect(put.letterId).toBe(LETTER_ID);
    expect(put.recipientHallIds).toEqual([HALL_A, HALL_B]);
    expect(put.shares.budget.on).toBe(true);
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
    expect(container.textContent).not.toContain(SELF_SEND_COPY.saveFirst);
    expect(container.querySelector(`[data-self-send-message="${HALL_A}"]`)).not.toBeNull();
    expect(buttonNamed(container, SELF_SEND_COPY.save).disabled).toBe(true);
  });

  it("저장하지 못했는데 서버가 이유를 말하지 않으면(연결 끊김) 다시 누르라고 말하고, 고친 내용과 저장하라는 줄을 그대로 둔다", async () => {
    const api = selfSendRoutes({ "PUT /api/invitation/letter": () => Promise.reject(new TypeError("Failed to fetch")) });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.switchLabel("예산")));
    await click(buttonNamed(container, SELF_SEND_COPY.save));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(LETTER_STATE_COPY.saveFailed);
    expect(container.textContent).toContain(SELF_SEND_COPY.saveFirst);
    expect(container.querySelector("[data-self-send]")).toBeNull();
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
    expect(api.count("GET", "/api/invitation/letter")).toBe(1);
  });

  it("저장하지 못했는데 서버가 이유를 말하면 그 문장을 보인다(이 단계는 아무것도 보내지 않으므로 이미 보냈다고 하지 않는다)", async () => {
    const api = selfSendRoutes({ "PUT /api/invitation/letter": apiError(503, "INQUIRY_UNAVAILABLE", "잠시 후 다시 시도해 주세요.") });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.switchLabel("예산")));
    await click(buttonNamed(container, SELF_SEND_COPY.save));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("잠시 후 다시 시도해 주세요.");
    expect(container.textContent).toContain(SELF_SEND_COPY.saveFirst);
    expect(api.count("GET", "/api/invitation/letter")).toBe(1);
  });

  it("받는 홀이 바뀌어 저장이 409 로 막히면 서버가 말한 이유를 보이고 편지를 다시 읽어 지금 받는 곳을 보인다. 다시 저장하면 그 곳으로 저장하고 글이 나온다", async () => {
    const onlyA = [{ hallId: HALL_A, name: "하나 웨딩홀" }];
    const reread = selfSendLetterResponse({ letterId: LETTER_ID, recipients: onlyA }, { selfSend: null });
    const api = selfSendRoutes({
      "GET /api/invitation/letter": [
        json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor() })),
        json({ ...reread, letter: { ...reread.letter!, recipients: ["하나 웨딩홀"] } }),
      ],
      "PUT /api/invitation/letter": [
        apiError(409, "RECIPIENTS_UNAVAILABLE", "받는 홀이 바뀌었어요. 담은 홀을 다시 확인해 주세요."),
        json({
          ...selfSendLetterResponse(
            { ...SAVED, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT, recipients: onlyA },
            { selfSend: selfSendFor(NEXT_VERSION, NEXT_FINGERPRINT, { messages: [selfSendFor().messages[0]] }) },
          ),
          saved: { letterId: LETTER_ID, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT, created: true },
        }),
      ],
    });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.switchLabel("예산")));
    await click(buttonNamed(container, SELF_SEND_COPY.save));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("받는 홀이 바뀌었어요. 담은 홀을 다시 확인해 주세요.");
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
    expect(text(container.querySelector("h1"))).toBe(LETTER_COPY.title(1));
    const save = buttonNamed(container, SELF_SEND_COPY.save);
    expect(save.disabled).toBe(false);

    await click(save);
    expect((api.last("PUT", "/api/invitation/letter")?.body as { recipientHallIds: string[] }).recipientHallIds).toEqual([HALL_A]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(Array.from(container.querySelectorAll("[data-self-send-message]"), (node) => node.getAttribute("data-self-send-message")))
      .toEqual([HALL_A]);
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
  });

  it("잠긴 편지(409 LETTER_LOCKED)를 저장하려 하면 서버가 말한 이유를 보이고 이미 보냈다고 하지 않으며 편지를 다시 읽는다", async () => {
    const api = selfSendRoutes({
      "PUT /api/invitation/letter": apiError(409, "LETTER_LOCKED", "이미 보낼 준비를 마친 편지예요. 새 편지로 써 주세요."),
    });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.switchLabel("예산")));
    await click(buttonNamed(container, SELF_SEND_COPY.save));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("이미 보낼 준비를 마친 편지예요. 새 편지로 써 주세요.");
    expect(container.textContent).not.toContain(LETTER_STATE_COPY.alreadySent);
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
  });

  it("저장한 판이 없고 희망 시기·하객 수가 비어 있으면 조건 알려 주기를 먼저 보인다(막지는 않는다). 저장하면 보낼 글이 나온다", async () => {
    const api = selfSendRoutes({
      "GET /api/invitation/letter": json(selfSendLetterResponse({}, { missing: ["month", "guests"], selfSend: null })),
      "PUT /api/invitation/letter": json({
        ...selfSendLetterResponse(SAVED, { missing: ["month", "guests"], selfSend: selfSendFor() }),
        saved: { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, created: true },
      }),
    });
    const { container } = await render(<LiveLetter />);
    const notice = container.querySelector("[data-self-send-missing]");
    expect(notice?.textContent).toContain(SELF_SEND_COPY.missingConditions);
    expect(linkTo(notice as Element, "/wedding/lounge?conditions=1")?.textContent).toBe(SELF_SEND_COPY.missingConditionsAction);
    expect(container.querySelector("[data-self-send]")).toBeNull();
    // 조건 묻기 아래에는 저장하면 보낼 글이 나온다는 줄이 함께 있다.
    expect(container.querySelector("[data-self-send-before-save]")?.textContent).toBe(SELF_SEND_COPY.beforeSave);
    expect(buttonNamed(container, SELF_SEND_COPY.save).disabled).toBe(false);

    await click(buttonNamed(container, SELF_SEND_COPY.save));
    expect((api.last("PUT", "/api/invitation/letter")?.body as { letterId: unknown }).letterId).toBeNull();
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
    // 판을 저장한 뒤에는 조건이 바뀌어도 글이 다시 만들어지지 않으므로 더 묻지 않는다.
    expect(container.querySelector("[data-self-send-missing]")).toBeNull();
    expect(container.querySelector("[data-self-send]")).not.toBeNull();
    expect(container.querySelector("[data-self-send-before-save]")).toBeNull();
  });

  it("저장한 판이 없으면 저장 단추 위에 저장하면 보낼 글이 나온다고 말한다. 저장해서 보낼 글이 나오면 그 줄은 사라진다", async () => {
    const api = selfSendRoutes({
      "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })),
      "PUT /api/invitation/letter": json({
        ...selfSendLetterResponse(SAVED, { selfSend: selfSendFor() }),
        saved: { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, created: true },
      }),
    });
    const { container } = await render(<LiveLetter />);
    const line = container.querySelector("[data-self-send-before-save]");
    const save = buttonNamed(container, SELF_SEND_COPY.save);
    expect(line?.textContent).toBe(SELF_SEND_COPY.beforeSave);
    expect(line && line.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(save.disabled).toBe(false);
    expect(container.textContent).not.toContain(SELF_SEND_COPY.saveFirst);
    expect(container.querySelector("[data-self-send]")).toBeNull();
    expect(container.querySelector("[data-self-send-missing]")).toBeNull();

    await click(save);
    expect(api.count("PUT", "/api/invitation/letter")).toBe(1);
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
    expect(container.querySelector(`[data-self-send-message="${HALL_A}"]`)).not.toBeNull();
    expect(container.querySelector("[data-self-send-before-save]")).toBeNull();
    expect(container.textContent).not.toContain(SELF_SEND_COPY.beforeSave);
  });

  it("담은 웨딩홀이 바뀌어 저장한 판을 쓸 수 없으면(편지는 그대로, 판은 없음) 같은 줄을 보이고 저장할 수 있다. 같은 편지로 지금 담은 곳에 저장하면 그 곳의 글이 나온다", async () => {
    const onlyA = [{ hallId: HALL_A, name: "하나 웨딩홀" }];
    const stale = selfSendLetterResponse({ letterId: LETTER_ID, recipients: onlyA }, { selfSend: null });
    const api = selfSendRoutes({
      "GET /api/invitation/letter": json({ ...stale, letter: { ...stale.letter!, recipients: ["하나 웨딩홀"] } }),
      "PUT /api/invitation/letter": json({
        ...selfSendLetterResponse(
          { ...SAVED, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT, recipients: onlyA },
          { selfSend: selfSendFor(NEXT_VERSION, NEXT_FINGERPRINT, { messages: [selfSendFor().messages[0]] }) },
        ),
        saved: { letterId: LETTER_ID, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT, created: true },
      }),
    });
    const { container } = await render(<LiveLetter />);
    expect(text(container.querySelector("h1"))).toBe(LETTER_COPY.title(1));
    expect(container.querySelector("[data-self-send-before-save]")?.textContent).toBe(SELF_SEND_COPY.beforeSave);
    expect(container.querySelector("[data-self-send]")).toBeNull();
    const save = buttonNamed(container, SELF_SEND_COPY.save);
    expect(save.disabled).toBe(false);

    await click(save);
    const put = api.last("PUT", "/api/invitation/letter")?.body as { letterId: string; recipientHallIds: string[] };
    expect(put.letterId).toBe(LETTER_ID);
    expect(put.recipientHallIds).toEqual([HALL_A]);
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
    expect(Array.from(container.querySelectorAll("[data-self-send-message]"), (node) => node.getAttribute("data-self-send-message")))
      .toEqual([HALL_A]);
    expect(container.querySelector("[data-self-send-before-save]")).toBeNull();
  });

  it("담은 웨딩홀이 바뀌어 판이 내려간 편지는 조건이 비어 있어도 조건을 묻지 않는다(저장한 글을 그대로 쓰므로 알려 줘도 글에 들어가지 않는다)", async () => {
    const onlyA = [{ hallId: HALL_A, name: "하나 웨딩홀" }];
    selfSendRoutes({
      "GET /api/invitation/letter": json(selfSendLetterResponse(
        { letterId: LETTER_ID, recipients: onlyA },
        { missing: ["month", "guests"], selfSend: null },
      )),
    });
    const { container } = await render(<LiveLetter />);
    expect(container.querySelector("[data-self-send-missing]")).toBeNull();
    expect(container.textContent).not.toContain(SELF_SEND_COPY.missingConditions);
    expect(container.querySelector("[data-self-send-before-save]")?.textContent).toBe(SELF_SEND_COPY.beforeSave);
    expect(buttonNamed(container, SELF_SEND_COPY.save).disabled).toBe(false);
  });

  it("저장하는 동안에도 저장하면 보낼 글이 나온다는 줄은 그대로 있다(앱과 같다)", async () => {
    const pendingPut = new Promise<Response>(() => undefined);
    selfSendRoutes({
      "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })),
      "PUT /api/invitation/letter": () => pendingPut,
    });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, SELF_SEND_COPY.save));
    expect(buttonNamed(container, SELF_SEND_COPY.saving).disabled).toBe(true);
    expect(container.querySelector("[data-self-send-before-save]")?.textContent).toBe(SELF_SEND_COPY.beforeSave);
  });

  it("고치는 중이면 먼저 저장하라는 줄만 보이고 저장하면 글이 나온다는 줄은 없다. 고친 것을 되돌리면 그 줄이 다시 나온다", async () => {
    selfSendRoutes({ "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })) });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.switchLabel("예산")));
    expect(container.querySelector("[data-self-send-save-first]")?.textContent).toBe(SELF_SEND_COPY.saveFirst);
    expect(container.querySelector("[data-self-send-before-save]")).toBeNull();
    expect(container.textContent).not.toContain(SELF_SEND_COPY.beforeSave);

    await click(buttonNamed(container, LETTER_COPY.switchLabel("예산")));
    expect(container.querySelector("[data-self-send-save-first]")).toBeNull();
    expect(container.querySelector("[data-self-send-before-save]")?.textContent).toBe(SELF_SEND_COPY.beforeSave);
  });

  it("저장할 수 없으면(대기열에 넣은 옛 편지, 글을 만든 판이 화면의 판과 다름) 저장하면 글이 나온다는 줄을 보이지 않는다", async () => {
    selfSendRoutes({
      "GET /api/invitation/letter": json(selfSendLetterResponse({ ...SAVED, status: "queued", viewerCanApprove: false }, { selfSend: null })),
    });
    const queued = await render(<LiveLetter />);
    expect(buttonNamed(queued.container, SELF_SEND_COPY.save).disabled).toBe(true);
    expect(queued.container.textContent).toContain(LETTER_STATE_COPY.alreadySent);
    expect(queued.container.querySelector("[data-self-send-before-save]")).toBeNull();
    await cleanup();

    selfSendRoutes({ "GET /api/invitation/letter": json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor(NEXT_VERSION, NEXT_FINGERPRINT) })) });
    const mismatch = await render(<LiveLetter />);
    expect(buttonNamed(mismatch.container, SELF_SEND_COPY.save).disabled).toBe(true);
    expect(mismatch.container.querySelector("[data-self-send]")).toBeNull();
    expect(mismatch.container.querySelector("[data-self-send-before-save]")).toBeNull();
  });

  it("직접 보내기 서버는 휴대폰 번호 줄을 빼고 준다: 번호 줄과 번호 적는 칸이 없고, 저장 본문의 번호는 꺼져 있다", async () => {
    const api = selfSendRoutes({
      "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })),
      "PUT /api/invitation/letter": json({
        ...selfSendLetterResponse(SAVED, { selfSend: selfSendFor() }),
        saved: { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, created: true },
      }),
    });
    const { container } = await render(<LiveLetter />);
    const rows = () => Array.from(container.querySelectorAll("[data-share]"), (row) => row.getAttribute("data-share"));
    expect(rows()).toEqual(["name", "budget"]);
    expect(container.querySelector("[data-letter-phone]")).toBeNull();
    expect(container.querySelector('input[type="tel"]')).toBeNull();

    await click(buttonNamed(container, LETTER_COPY.switchLabel("예산")));
    await click(buttonNamed(container, SELF_SEND_COPY.save));
    const put = api.last("PUT", "/api/invitation/letter")?.body as { shares: unknown };
    expect(put.shares).toEqual({ name: { on: true, value: "김민지" }, phone: { on: false, value: null }, budget: { on: true } });
    expect(rows()).toEqual(["name", "budget"]);
    expect(container.querySelector("[data-letter-phone]")).toBeNull();
  });

  it("복사는 그 곳의 글을 클립보드에 쓰고 그 곳 아래에만 복사했다고 말한다. 막히면 옛 복사 명령까지 해 보고, 안 되면 글을 직접 골라 복사하라고 한다", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    stubNavigator("clipboard", { writeText });
    selfSendRoutes();
    const { container } = await render(<LiveLetter />);
    const [first, second] = [card(container, HALL_A), card(container, HALL_B)];

    await click(buttonNamed(first, SELF_SEND_COPY.copy));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(selfSendFor().messages[0].text);
    expect(statusOf(first)).toBe(SELF_SEND_COPY.copied);
    expect(statusOf(second)).toBe("");

    writeText.mockRejectedValueOnce(new DOMException("막힘", "NotAllowedError"));
    const execCommand = stubExecCommand(false);
    await click(buttonNamed(second, SELF_SEND_COPY.copy));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(statusOf(second)).toBe(SELF_SEND_COPY.copyFailed);
    expect(statusOf(first)).toBe("");
  });

  it("공유는 누른 순간 그 곳의 글로 공유 창을 열고 앱을 고르라고 말한다. 닫으면(취소) 그 줄을 거두고 복사하지 않는다", async () => {
    let closeSheet: (reason: unknown) => void = () => undefined;
    const share = vi.fn<(data: ShareData) => Promise<void>>(() => new Promise<void>((_resolve, reject) => {
      closeSheet = reject;
    }));
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    stubNavigator("share", share);
    stubNavigator("clipboard", { writeText });
    selfSendRoutes();
    const { container } = await render(<LiveLetter />);
    const first = card(container, HALL_A);

    await click(buttonNamed(first, SELF_SEND_COPY.share));
    expect(share).toHaveBeenCalledExactlyOnceWith({ text: selfSendFor().messages[0].text });
    expect(statusOf(first)).toBe(SELF_SEND_COPY.shareOpened);

    await act(async () => closeSheet(new DOMException("닫음", "AbortError")));
    await flush();
    expect(statusOf(first)).toBe("");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("공유 창이 없는 브라우저에서 공유를 누르면 복사로 넘어가고, 그냥 복사한 줄이 아니라 앱을 열지 못해 복사했다고 말한다", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    stubNavigator("clipboard", { writeText });
    selfSendRoutes();
    const { container } = await render(<LiveLetter />);
    const second = card(container, HALL_B);
    await click(buttonNamed(second, SELF_SEND_COPY.share));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(selfSendFor().messages[1].text);
    expect(statusOf(second)).toBe(SELF_SEND_COPY.copiedInstead);
    // 복사 단추는 그대로 복사했다고만 말한다.
    await click(buttonNamed(second, SELF_SEND_COPY.copy));
    expect(statusOf(second)).toBe(SELF_SEND_COPY.copied);
  });

  it("공유 창을 열었는데 닫은 것이 아닌 까닭으로 실패해 복사로 넘어가도 앱을 열지 못해 복사했다고 말한다", async () => {
    let failSheet: (reason: unknown) => void = () => undefined;
    const share = vi.fn<(data: ShareData) => Promise<void>>(() => new Promise<void>((_resolve, reject) => {
      failSheet = reject;
    }));
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    stubNavigator("share", share);
    stubNavigator("clipboard", { writeText });
    selfSendRoutes();
    const { container } = await render(<LiveLetter />);
    const first = card(container, HALL_A);
    await click(buttonNamed(first, SELF_SEND_COPY.share));
    expect(statusOf(first)).toBe(SELF_SEND_COPY.shareOpened);

    await act(async () => failSheet(new DOMException("막힘", "NotAllowedError")));
    await flush();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(selfSendFor().messages[0].text);
    expect(statusOf(first)).toBe(SELF_SEND_COPY.copiedInstead);
  });

  it("컴퓨터(폰이 아닌 브라우저)에서는 문자 앱을 열 수 없으므로 문자로 열기를 두지 않는다. 복사·공유·찾아보기는 그대로 있다", async () => {
    stubNavigator("userAgent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36");
    selfSendRoutes();
    const { container } = await render(<LiveLetter />);
    for (const hallId of [HALL_A, HALL_B]) {
      const scope = card(container, hallId);
      expect(Array.from(scope.querySelectorAll("a"), (link) => text(link))).not.toContain(SELF_SEND_COPY.sms);
      expect(scope.querySelector('a[href^="sms:"]')).toBeNull();
      expect(buttonNamed(scope, SELF_SEND_COPY.copy)).toBeDefined();
      expect(buttonNamed(scope, SELF_SEND_COPY.share)).toBeDefined();
      expect(linkNamed(scope, SELF_SEND_COPY.findHall)).toBeDefined();
    }
    expect(container.textContent).not.toContain(SELF_SEND_COPY.smsOpened);
  });

  it("문자로 열기는 받는 번호 없이 글만 담은 문자 앱 주소이고, 누르면 번호를 넣어 보내라고 말한다. iOS 는 &body= 꼴이다", async () => {
    stubNavigator("userAgent", ANDROID_UA);
    selfSendRoutes();
    const first = await render(<LiveLetter />);
    const sms = linkNamed(card(first.container, HALL_A), SELF_SEND_COPY.sms);
    // jsdom 은 문자 앱 주소로 옮겨 가지 못하므로 이동만 막고 누른다.
    sms.addEventListener("click", (event) => event.preventDefault());
    await click(sms);
    expect(statusOf(card(first.container, HALL_A))).toBe(SELF_SEND_COPY.smsOpened);
    expect(sms.getAttribute("href")).toBe(`sms:?body=${encodeURIComponent(selfSendFor().messages[0].text)}`);
    await cleanup();

    stubNavigator("userAgent", IPHONE_UA);
    selfSendRoutes();
    const second = await render(<LiveLetter />);
    expect(linkNamed(card(second.container, HALL_A), SELF_SEND_COPY.sms).getAttribute("href"))
      .toBe(`sms:&body=${encodeURIComponent(selfSendFor().messages[0].text)}`);
  });

  it("휴대폰 번호 알려주기를 켰으면 글에 넣지 않았다고 알린다. 글을 만든 판이 화면의 판과 다르면 보낼 글을 숨긴다", async () => {
    selfSendRoutes({
      "GET /api/invitation/letter": json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor(VERSION, FINGERPRINT, { phoneOmitted: true }) })),
    });
    const first = await render(<LiveLetter />);
    expect(first.container.querySelector("[data-self-send-phone-omitted]")?.textContent).toBe(SELF_SEND_COPY.phoneOmitted);
    await cleanup();

    selfSendRoutes({ "GET /api/invitation/letter": json(selfSendLetterResponse(SAVED, { selfSend: selfSendFor(NEXT_VERSION, NEXT_FINGERPRINT) })) });
    const second = await render(<LiveLetter />);
    expect(second.container.querySelector("[data-self-send]")).toBeNull();
    expect(second.container.querySelector("[data-letter-approver]")).toBeNull();
  });

  it("복사·공유·문자·찾아보기는 우리 서버를 부르지 않고, 어느 단추를 눌러도 화면은 보냈다고 말하지 않는다(보내는 것은 두 분 폰이다)", async () => {
    const SENT = /보냈|발송|전송했|전달했/;
    const sentClaims = (scope: HTMLElement) =>
      [scope.textContent ?? "", ...Array.from(scope.querySelectorAll("[aria-label],[title]"), (element) =>
        `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`)].filter((value) => SENT.test(value));
    stubNavigator("share", vi.fn<(data: ShareData) => Promise<void>>(async () => undefined));
    stubNavigator("clipboard", { writeText: vi.fn<(text: string) => Promise<void>>(async () => undefined) });
    stubNavigator("userAgent", ANDROID_UA);
    const api = selfSendRoutes();
    const { container } = await render(<LiveLetter />);
    const first = card(container, HALL_A);
    expect(sentClaims(container)).toEqual([]);

    await click(buttonNamed(first, SELF_SEND_COPY.copy));
    expect(statusOf(first)).toBe(SELF_SEND_COPY.copied);
    await click(buttonNamed(first, SELF_SEND_COPY.share));
    expect(sentClaims(container)).toEqual([]);
    for (const name of [SELF_SEND_COPY.sms, SELF_SEND_COPY.findHall]) {
      const link = linkNamed(first, name);
      // jsdom 은 문자 앱·새 탭으로 옮겨 가지 못하므로 이동만 막고 누른다.
      link.addEventListener("click", (event) => event.preventDefault());
      await click(link);
      expect(sentClaims(container)).toEqual([]);
    }
    expect(api.calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /api/invitation/approver",
      "GET /api/invitation/letter",
    ]);
  });

  it("저장하는 동안 아래 단추는 저장하고 있어요로 바뀌고 잠긴다. PUT 은 한 번이고 승인은 부르지 않는다", async () => {
    let finish: (response: Response) => void = () => undefined;
    const pendingPut = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const api = selfSendRoutes({ "PUT /api/invitation/letter": () => pendingPut });
    const { container } = await render(<LiveLetter />);
    await click(buttonNamed(container, LETTER_COPY.switchLabel("예산")));
    await click(buttonNamed(container, SELF_SEND_COPY.save));

    const saving = buttonNamed(container, SELF_SEND_COPY.saving);
    expect(saving.disabled).toBe(true);
    expect(saving.getAttribute("aria-busy")).toBe("true");
    await click(saving);
    expect(api.count("PUT", "/api/invitation/letter")).toBe(1);

    await act(async () => finish(json({
      ...selfSendLetterResponse(
        { ...SAVED, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT },
        { selfSend: selfSendFor(NEXT_VERSION, NEXT_FINGERPRINT) },
      ),
      saved: { letterId: LETTER_ID, versionId: NEXT_VERSION, version: 2, fingerprint: NEXT_FINGERPRINT, created: true },
    })));
    await flush();
    expect(buttonNamed(container, SELF_SEND_COPY.save).disabled).toBe(true);
    expect(container.querySelector(`[data-self-send-message="${HALL_A}"]`)).not.toBeNull();
    expect(api.count("POST", "/api/invitation/letter/approve")).toBe(0);
  });

  it("비어 있는 조건만 묻는다: 희망 시기만 비면 희망 시기를, 하객 수만 비면 하객 수를, 둘 다 비면 둘을 함께 묻는다", async () => {
    const cases: [("month" | "guests")[], string][] = [
      [["month"], SELF_SEND_COPY.missingMonth],
      [["guests"], SELF_SEND_COPY.missingGuests],
      [["month", "guests"], SELF_SEND_COPY.missingConditions],
    ];
    for (const [missing, sentence] of cases) {
      selfSendRoutes({ "GET /api/invitation/letter": json(selfSendLetterResponse({}, { missing, selfSend: null })) });
      const { container } = await render(<LiveLetter />);
      const notice = container.querySelector("[data-self-send-missing]");
      expect(text(notice?.querySelector("p"))).toBe(sentence);
      expect(linkTo(notice as Element, "/wedding/lounge?conditions=1")?.textContent).toBe(SELF_SEND_COPY.missingConditionsAction);
      await cleanup();
    }
  });

  it("편지를 저장한 적이 있으면 고치는 중이거나 담은 웨딩홀이 바뀌어 다시 저장해야 할 때도 상담 화면으로 가는 줄을 한 번만 보인다. 저장한 적 없는 초안에는 없다", async () => {
    const afterLines = (scope: HTMLElement) => scope.querySelectorAll("[data-self-send-after]");
    const consultationLinks = (scope: HTMLElement) => scope.querySelectorAll('a[href="/wedding/halls/consultation"]');

    selfSendRoutes();
    const saved = await render(<LiveLetter />);
    expect(saved.container.querySelector("[data-self-send]")).not.toBeNull();
    expect(afterLines(saved.container)).toHaveLength(1);
    expect(consultationLinks(saved.container)).toHaveLength(1);
    // 고치는 중이면 보낼 글은 숨지만 상담 화면으로 가는 줄은 남는다.
    await click(buttonNamed(saved.container, LETTER_COPY.switchLabel("예산")));
    expect(saved.container.querySelector("[data-self-send]")).toBeNull();
    expect(text(afterLines(saved.container)[0]?.querySelector("p"))).toBe(SELF_SEND_COPY.afterSend);
    expect(text(consultationLinks(saved.container)[0])).toBe(SELF_SEND_COPY.openConsultation);
    expect(afterLines(saved.container)).toHaveLength(1);
    await cleanup();

    const onlyA = [{ hallId: HALL_A, name: "하나 웨딩홀" }];
    selfSendRoutes({ "GET /api/invitation/letter": json(selfSendLetterResponse({ letterId: LETTER_ID, recipients: onlyA }, { selfSend: null })) });
    const stale = await render(<LiveLetter />);
    expect(stale.container.querySelector("[data-self-send-before-save]")).not.toBeNull();
    expect(afterLines(stale.container)).toHaveLength(1);
    expect(consultationLinks(stale.container)).toHaveLength(1);
    await cleanup();

    selfSendRoutes({ "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })) });
    const draft = await render(<LiveLetter />);
    expect(afterLines(draft.container)).toHaveLength(0);
    expect(draft.container.textContent).not.toContain(SELF_SEND_COPY.afterSend);
  });

  it("저장이 끝나 보낼 글이 나타나면 글의 첫 줄로 초점을 옮긴다(잠긴 저장 단추에 초점이 남지 않는다). 처음 열 때와 고친 것을 되돌릴 때는 옮기지 않는다", async () => {
    selfSendRoutes({
      "GET /api/invitation/letter": json(selfSendLetterResponse({}, { selfSend: null })),
      "PUT /api/invitation/letter": json({
        ...selfSendLetterResponse(SAVED, { selfSend: selfSendFor() }),
        saved: { letterId: LETTER_ID, versionId: VERSION, version: 1, fingerprint: FINGERPRINT, created: true },
      }),
    });
    const { container } = await render(<LiveLetter />);
    const save = buttonNamed(container, SELF_SEND_COPY.save);
    save.focus();
    await click(save);
    const intro = container.querySelector<HTMLElement>("[data-self-send-intro]");
    expect(text(intro)).toBe(SELF_SEND_COPY.intro);
    expect(document.activeElement).toBe(intro);
    await cleanup();

    selfSendRoutes();
    const reopened = await render(<LiveLetter />);
    expect(reopened.container.querySelector("[data-self-send-intro]")).not.toBeNull();
    expect(document.activeElement).toBe(reopened.container.querySelector('[role="dialog"]'));
    const budget = buttonNamed(reopened.container, LETTER_COPY.switchLabel("예산"));
    budget.focus();
    await click(budget);
    expect(reopened.container.querySelector("[data-self-send-intro]")).toBeNull();
    await click(buttonNamed(reopened.container, LETTER_COPY.switchLabel("예산")));
    expect(reopened.container.querySelector("[data-self-send-intro]")).not.toBeNull();
    expect(document.activeElement).toBe(budget);
  });

  it("보낼 글 칸은 처음 그릴 때와 다시 그릴 때 초점을 가져가지 않고, 저장 횟수가 늘 때만 첫 줄로 초점을 옮긴다(시트의 첫 초점에 기대지 않는다)", async () => {
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();
    const props = { selfSend: selfSendFor(), dirty: false, hasSavedLetter: true, missingConditions: [], canSave: false } as const;
    const { container, rerender } = await render(<SelfSendPanel {...props} preparedCount={0} />);
    expect(container.querySelector("[data-self-send-intro]")).not.toBeNull();
    expect(document.activeElement).toBe(outside);
    // 고쳐서 글이 숨었다가(되돌려) 다시 나와도 초점을 옮기지 않는다.
    await rerender(<SelfSendPanel {...props} dirty preparedCount={0} />);
    await rerender(<SelfSendPanel {...props} preparedCount={0} />);
    expect(document.activeElement).toBe(outside);

    await rerender(<SelfSendPanel {...props} preparedCount={1} />);
    expect(document.activeElement).toBe(container.querySelector("[data-self-send-intro]"));
    outside.remove();
  });

  it("이 단계 전에 상대가 낸 승인 방식 제안에 답할 수 있으면 바꾸기·두기를 보이고, 답하는 동안 저장 단추는 저장한다고 말하지 않는다. 확인하면 편지를 다시 읽는다", async () => {
    let finishConfirm: (response: Response) => void = () => undefined;
    const pending = { proposalId: PROPOSAL, mode: "designated" as const, designatedUserId: PARTNER, proposedBy: PARTNER, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: true };
    const api = selfSendRoutes({
      "GET /api/invitation/approver": json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 3 }, pending })),
      "POST /api/invitation/approver/confirm": () => new Promise<Response>((resolve) => {
        finishConfirm = resolve;
      }),
    });
    const { container } = await render(<LiveLetter />);
    // 고르는 칸은 그리지 않는다. 답할 제안만 한 번 보인다.
    expect(container.querySelector("[data-letter-approver]")).toBeNull();
    const respond = container.querySelectorAll('[data-letter-approver-pending="respond"]');
    expect(respond).toHaveLength(1);
    expect(respond[0].textContent).toContain(LETTER_STATE_COPY.approverProposedBy("준호", "준호"));
    expect(buttonNamed(respond[0], LETTER_STATE_COPY.approverDecline)).toBeDefined();

    await click(buttonNamed(respond[0], LETTER_STATE_COPY.approverConfirm));
    expect(api.last("POST", "/api/invitation/approver/confirm")?.body).toEqual({ proposalId: PROPOSAL });
    const save = buttonNamed(container, SELF_SEND_COPY.save);
    expect(save.getAttribute("aria-busy")).not.toBe("true");
    expect(container.textContent).not.toContain(SELF_SEND_COPY.saving);

    await act(async () => finishConfirm(json(approverResponse({
      setting: { mode: "designated", designatedUserId: PARTNER, revision: 4 },
      pending: null,
      outcome: "confirmed",
    }))));
    await flush();
    expect(api.count("GET", "/api/invitation/letter")).toBe(2);
    expect(container.querySelector("[data-letter-approver-pending]")).toBeNull();
    expect(container.querySelector("[data-self-send]")).not.toBeNull();
  });

  it("승인 방식 제안에 답하는 동안에도 저장하면 보낼 글이 나온다는 줄은 그대로다(사라졌다 나타나지 않는다). 저장할 수 없는 옛 편지(대기열에 넣음)에는 그 사이에도 그 줄이 없다", async () => {
    const pending = { proposalId: PROPOSAL, mode: "designated" as const, designatedUserId: PARTNER, proposedBy: PARTNER, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: true };
    const confirmed = () => json(approverResponse({ setting: { mode: "designated", designatedUserId: PARTNER, revision: 4 }, pending: null, outcome: "confirmed" }));
    const beforeSave = (scope: HTMLElement) => scope.querySelector("[data-self-send-before-save]");

    for (const [state, savable] of [[{}, true], [{ ...SAVED, status: "queued" as const, viewerCanApprove: false }, false]] as const) {
      let finishConfirm: (response: Response) => void = () => undefined;
      const api = selfSendRoutes({
        "GET /api/invitation/approver": json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 3 }, pending })),
        "GET /api/invitation/letter": json(selfSendLetterResponse(state, { selfSend: null })),
        "POST /api/invitation/approver/confirm": () => new Promise<Response>((resolve) => {
          finishConfirm = resolve;
        }),
      });
      const { container } = await render(<LiveLetter />);
      expect(beforeSave(container) !== null).toBe(savable);

      await click(buttonNamed(container, LETTER_STATE_COPY.approverConfirm));
      // 답하는 동안: 줄은 그대로이고, 저장 단추는 잠기되 저장한다고 말하지 않는다.
      expect(api.count("POST", "/api/invitation/approver/confirm")).toBe(1);
      expect(beforeSave(container) !== null).toBe(savable);
      expect(buttonNamed(container, SELF_SEND_COPY.save).disabled).toBe(true);

      await act(async () => finishConfirm(confirmed()));
      await flush();
      expect(api.count("GET", "/api/invitation/letter")).toBe(2);
      expect(beforeSave(container) !== null).toBe(savable);
      expect(buttonNamed(container, SELF_SEND_COPY.save).disabled).toBe(!savable);
      await cleanup();
    }
  });

  it("제안한 사람(답할 수 없는 쪽)에게는 직접 보내기에서 제안 줄도 고르는 칸도 그리지 않는다. 꺼진 서버는 제안 칸을 고르는 칸 안에 한 번만 그린다", async () => {
    const own = { proposalId: PROPOSAL, mode: "designated" as const, designatedUserId: VIEWER, proposedBy: VIEWER, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: false };
    selfSendRoutes({ "GET /api/invitation/approver": json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 3 }, pending: own })) });
    const mine = await render(<LiveLetter />);
    expect(mine.container.querySelector("[data-letter-approver-pending]")).toBeNull();
    expect(mine.container.querySelector("[data-letter-approver]")).toBeNull();
    expect(mine.container.textContent).not.toContain(LETTER_STATE_COPY.approverPending);
    await cleanup();

    const theirs = { ...own, designatedUserId: PARTNER, proposedBy: PARTNER, viewerCanRespond: true };
    mockApi({
      "GET /api/invitation/approver": json(approverResponse({ setting: { mode: "both", designatedUserId: null, revision: 3 }, pending: theirs })),
      "GET /api/invitation/letter": json(letterResponse(SAVED)),
    });
    const off = await render(<LiveLetter />);
    const respond = off.container.querySelectorAll('[data-letter-approver-pending="respond"]');
    expect(respond).toHaveLength(1);
    expect(off.container.querySelector("[data-letter-approver]")?.contains(respond[0])).toBe(true);
  });
});

describe("받은 답 붙여 넣기(D-83 1단계) /halls/consultation", () => {
  const EMPTY = { consultation: null, replyId: null, inCalendar: false, startsAt: null };
  const REPLY_TEXT = "2026년 11월 30일 (월) 오후 2시 상담 가능합니다. 문의는 010-1234-5678 로 주세요.";
  const ADDED = { added: true, alreadyInCalendar: false, eventId: "event-9" };

  const pasteArea = (container: HTMLElement) => {
    const found = container.querySelector<HTMLElement>("[data-vendor-reply]");
    if (!found) throw new Error("붙여 넣기 칸이 없다");
    return found;
  };

  async function readReply(container: HTMLElement, reply: string) {
    await click(buttonNamed(container, VENDOR_REPLY_COPY.open));
    await typeInto(pasteArea(container).querySelector("textarea"), reply);
    await click(buttonNamed(container, VENDOR_REPLY_COPY.read));
    return pasteArea(container);
  }

  const fieldValue = (scope: ParentNode, selector: string) => (scope.querySelector(selector) as HTMLInputElement | null)?.value;

  // 칩은 한국 오늘을 기준으로 읽는다(해 없는 날짜의 해를 고르고, 올해가 아닌 날짜는 칩에 해를 적는다).
  // 그래서 오늘을 2026-11-18(수) 한국 낮으로 둔다. 2026-11-30 은 월요일이다.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T03:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("꺼진 서버(칸 없음)는 빈 화면과 상담 화면 모두 붙여 넣기를 그리지 않고 다른 요청도 없다", async () => {
    const first = mockApi({ "GET /api/invitation/consultation": json(EMPTY) });
    const empty = await render(<LiveConsultation />);
    expect(empty.container.querySelector("[data-vendor-reply]")).toBeNull();
    expect(empty.container.textContent).not.toContain(VENDOR_REPLY_COPY.open);
    expect(first.calls).toHaveLength(1);
    await cleanup();

    const second = mockApi({ "GET /api/invitation/consultation": json(consultationResponse()) });
    const confirmed = await render(<LiveConsultation />);
    expect(confirmed.container.querySelector("[data-vendor-reply]")).toBeNull();
    expect(second.calls).toHaveLength(1);
  });

  it("빈 화면의 둘째 줄: 직접 보내기에서는 편지를 보내고 답이 오면 아래에 붙여 넣으라고 하고, 꺼진 서버는 예전 줄 그대로다", async () => {
    mockApi({ "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }) });
    const on = await render(<LiveConsultation />);
    expect(on.container.textContent).toContain(CONSULTATION_STATE_COPY.none);
    expect(on.container.textContent).toContain(VENDOR_REPLY_COPY.emptySub);
    expect(on.container.textContent).not.toContain(CONSULTATION_STATE_COPY.noneSub);
    await cleanup();

    mockApi({ "GET /api/invitation/consultation": json(EMPTY) });
    const off = await render(<LiveConsultation />);
    expect(off.container.textContent).toContain(CONSULTATION_STATE_COPY.none);
    expect(off.container.textContent).toContain(CONSULTATION_STATE_COPY.noneSub);
    expect(off.container.textContent).not.toContain(VENDOR_REPLY_COPY.emptySub);
  });

  it("빈 화면: 붙여 넣은 답을 이 기기에서 읽어 가린 글과 칩을 보이고, 고른 홀·날짜·시간만 보내 일정에 넣는다", async () => {
    const api = mockApi({
      "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }),
      "POST /api/invitation/consultation/paste-schedule": json(ADDED),
    });
    const { container } = await render(<LiveConsultation />);
    expect(container.textContent).toContain(CONSULTATION_STATE_COPY.none);
    await click(buttonNamed(container, VENDOR_REPLY_COPY.open));
    const textarea = pasteArea(container).querySelector("textarea") as HTMLTextAreaElement;
    // 글을 밖으로 보낼 수 있는 맞춤법 검사는 끈다.
    expect(textarea.getAttribute("spellcheck")).toBe("false");
    await typeInto(textarea, REPLY_TEXT);
    await click(buttonNamed(container, VENDOR_REPLY_COPY.read));
    const area = pasteArea(container);

    // 원문이 아니라 가린 글을 보인다. 붙여 넣은 원문(전화번호)은 화면 어디에도 남지 않는다.
    expect(area.querySelector("[data-vendor-reply-masked]")?.textContent)
      .toBe("2026년 11월 30일 (월) 오후 2시 상담 가능합니다. 문의는 [전화번호] 로 주세요.");
    expect(container.innerHTML).not.toContain("010-1234-5678");
    expect(area.textContent).toContain(VENDOR_REPLY_COPY.masked(1));
    expect(area.querySelector("[data-vendor-reply-phrases]")?.textContent).toContain("상담 가능합니다.");
    const chipLabels = Array.from(area.querySelectorAll("[data-vendor-reply-chips] li")).map((item) => text(item));
    expect(chipLabels).toContain("11월 30일 (월) 오후 2시");
    for (const label of chipLabels) expect(label).not.toMatch(JUDGEMENT_WORDS);

    await click(buttonNamed(area, "둘 컨벤션"));
    await click(buttonNamed(area, "11월 30일 (월) 오후 2시"));
    expect(fieldValue(area, 'input[type="date"]')).toBe("2026-11-30");
    expect(fieldValue(area, 'input[type="time"]')).toBe("14:00");
    expect(buttonNamed(area, "11월 30일 (월) 오후 2시").getAttribute("aria-pressed")).toBe("true");
    expect(area.querySelector("[data-vendor-reply-meridiem]")).toBeNull();
    // 칩을 눌러도 넣지 않는다. 넣는 것은 넣기 단추뿐이다.
    expect(api.count("POST", "/api/invitation/consultation/paste-schedule")).toBe(0);

    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(api.last("POST", "/api/invitation/consultation/paste-schedule")?.body).toEqual({ hallId: HALL_B, date: "2026-11-30", time: "14:00" });
    expect(area.querySelector('[role="status"]')?.textContent).toBe(VENDOR_REPLY_COPY.added);
    // 붙여 넣은 글은 어느 요청에도 실리지 않는다.
    for (const call of api.calls) expect(JSON.stringify(call.body ?? null)).not.toContain("상담 가능");
    expect(window.sessionStorage.length + window.localStorage.length).toBe(0);
  });

  it("업체가 오전·오후를 적지 않은 시간은 사람이 고르기 전에는 넣지 않는다. 고를 홀이 하나면 미리 골라 둔다", async () => {
    const api = mockApi({
      "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: replyPaste({ halls: [REPLY_PASTE.halls[0]] }) }),
      "POST /api/invitation/consultation/paste-schedule": json(ADDED),
    });
    const { container } = await render(<LiveConsultation />);
    const area = await readReply(container, "2026년 12월 3일 2시 가능해요");
    expect(buttonNamed(area, "하나 웨딩홀").getAttribute("aria-pressed")).toBe("true");

    // 업체가 오전·오후를 적지 않았으므로 칩에도 적지 않는다.
    await click(buttonNamed(area, "12월 3일 (목) 2시"));
    expect(area.querySelector("[data-vendor-reply-meridiem]")?.textContent).toContain(VENDOR_REPLY_COPY.meridiemQuestion);
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(api.count("POST", "/api/invitation/consultation/paste-schedule")).toBe(0);
    expect(area.querySelector('[role="alert"]')?.textContent).toBe(VENDOR_REPLY_COPY.meridiemQuestion);

    await click(buttonNamed(area, VENDOR_REPLY_COPY.am));
    expect(fieldValue(area, 'input[type="time"]')).toBe("02:00");
    expect(area.querySelector("[data-vendor-reply-meridiem]")).toBeNull();
    expect(area.querySelector('[role="alert"]')).toBeNull();
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(api.last("POST", "/api/invitation/consultation/paste-schedule")?.body).toEqual({ hallId: HALL_A, date: "2026-12-03", time: "02:00" });
  });

  it("홀이나 날짜를 고르지 않으면 무엇을 고르라고 말하고, 시간 없이 넣기를 고르면 시간을 빼고 보낸다", async () => {
    const api = mockApi({
      "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }),
      "POST /api/invitation/consultation/paste-schedule": json({ added: false, alreadyInCalendar: true, eventId: "event-9" }),
    });
    const { container } = await render(<LiveConsultation />);
    const area = await readReply(container, "네 확인했습니다 감사합니다");
    expect(area.textContent).toContain(VENDOR_REPLY_COPY.none);

    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(area.querySelector('[role="alert"]')?.textContent).toBe(VENDOR_REPLY_COPY.pickHall);
    await click(buttonNamed(area, "하나 웨딩홀"));
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(area.querySelector('[role="alert"]')?.textContent).toBe(VENDOR_REPLY_COPY.pickDate);
    expect(api.count("POST", "/api/invitation/consultation/paste-schedule")).toBe(0);

    await typeInto(area.querySelector('input[type="date"]'), "2026-12-12");
    await typeInto(area.querySelector('input[type="time"]'), "15:30");
    await click(area.querySelector('input[type="checkbox"]'));
    expect((area.querySelector('input[type="time"]') as HTMLInputElement).disabled).toBe(true);
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(api.last("POST", "/api/invitation/consultation/paste-schedule")?.body).toEqual({ hallId: HALL_A, date: "2026-12-12" });
    expect(area.querySelector('[role="status"]')?.textContent).toBe(VENDOR_REPLY_COPY.alreadyAdded);
  });

  it("넣지 못하면 서버가 말한 까닭을, 까닭이 없으면(연결 끊김) 다시 누르라고 말한다", async () => {
    mockApi({
      "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }),
      "POST /api/invitation/consultation/paste-schedule": [
        apiError(409, "SCHEDULE_FULL", "일정이 너무 많아 더 넣을 수 없어요."),
        () => Promise.reject(new TypeError("Failed to fetch")),
      ],
    });
    const { container } = await render(<LiveConsultation />);
    const area = await readReply(container, REPLY_TEXT);
    await click(buttonNamed(area, "하나 웨딩홀"));
    await click(buttonNamed(area, "11월 30일 (월) 오후 2시"));
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(area.querySelector('[role="alert"]')?.textContent).toBe("일정이 너무 많아 더 넣을 수 없어요.");
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(area.querySelector('[role="alert"]')?.textContent).toBe(VENDOR_REPLY_COPY.failed);
  });

  it("넣을 수 없는 날짜(지난 30일부터 3년 뒤 밖)를 서버가 400 으로 거절하면 서버가 보낸 문장을 그대로 보인다", async () => {
    const api = mockApi({
      "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }),
      "POST /api/invitation/consultation/paste-schedule": apiError(400, "PASTE_SCHEDULE_INVALID", VENDOR_REPLY_COPY.dateOutOfRange),
    });
    const { container } = await render(<LiveConsultation />);
    const area = await readReply(container, "네 확인했습니다 감사합니다");
    await click(buttonNamed(area, "하나 웨딩홀"));
    await typeInto(area.querySelector('input[type="date"]'), "2030-01-05");
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(api.last("POST", "/api/invitation/consultation/paste-schedule")?.body).toEqual({ hallId: HALL_A, date: "2030-01-05" });
    expect(area.querySelector('[role="alert"]')?.textContent).toBe(VENDOR_REPLY_COPY.dateOutOfRange);
    expect(area.textContent).not.toContain(VENDOR_REPLY_COPY.failed);
  });

  it("상담이 잡힌 화면에서는 상담 카드 아래 맨 위에 두고, 닫으면 붙여 넣은 글을 버린다", async () => {
    mockApi({ "GET /api/invitation/consultation": json(consultationResponse({ replyPaste: REPLY_PASTE })) });
    const { container } = await render(<LiveConsultation />);
    expect(container.querySelector('[data-invitation-screen="status"] [data-vendor-reply]')).not.toBeNull();

    await click(buttonNamed(container, VENDOR_REPLY_COPY.open));
    await typeInto(pasteArea(container).querySelector("textarea"), REPLY_TEXT);
    await click(buttonNamed(container, VENDOR_REPLY_COPY.close));
    expect(container.innerHTML).not.toContain("010-1234-5678");
    expect(window.sessionStorage.length + window.localStorage.length).toBe(0);
    await click(buttonNamed(container, VENDOR_REPLY_COPY.open));
    expect((pasteArea(container).querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("고를 웨딩홀이 없으면 먼저 담으라고 하고 웨딩홀 비교 화면으로 가는 단추를 두며 넣기 단추는 두지 않는다. 다시 붙여 넣기는 빈 칸으로 돌아간다", async () => {
    mockApi({ "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: replyPaste({ halls: [] }) }) });
    const { container } = await render(<LiveConsultation />);
    const area = await readReply(container, REPLY_TEXT);
    const noHalls = area.querySelector("[data-vendor-reply-no-halls]");
    expect(noHalls?.textContent).toContain(VENDOR_REPLY_COPY.noHalls);
    expect(linkTo(noHalls as Element, "/wedding/halls")?.textContent).toBe(VENDOR_REPLY_COPY.noHallsAction);
    expect(area.textContent).not.toContain(VENDOR_REPLY_COPY.add);
    expect(area.querySelector('input[type="date"]')).toBeNull();

    await click(buttonNamed(area, VENDOR_REPLY_COPY.again));
    expect((pasteArea(container).querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
    expect(container.querySelector("[data-vendor-reply-reading]")).toBeNull();
  });

  it("고를 웨딩홀이 없고 날짜나 금액도 찾지 못하면, 직접 골라 넣으라는 뒤 문장 없이 찾지 못했다고만 말한다(웨딩홀이 있으면 그 문장까지 말한다)", async () => {
    mockApi({ "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: replyPaste({ halls: [] }) }) });
    const first = await render(<LiveConsultation />);
    const none = (await readReply(first.container, "네 확인했습니다 감사합니다")).querySelector("[data-vendor-reply-none]");
    expect(none?.textContent).toBe(VENDOR_REPLY_COPY.noneOnly);
    expect(first.container.textContent).not.toContain(VENDOR_REPLY_COPY.none);
    expect(first.container.querySelector("[data-vendor-reply-no-halls]")?.textContent).toContain(VENDOR_REPLY_COPY.noHalls);
    await cleanup();

    mockApi({ "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }) });
    const second = await render(<LiveConsultation />);
    const withHalls = (await readReply(second.container, "네 확인했습니다 감사합니다")).querySelector("[data-vendor-reply-none]");
    expect(withHalls?.textContent).toBe(VENDOR_REPLY_COPY.none);
    expect(second.container.querySelector("[data-vendor-reply-no-halls]")).toBeNull();
  });

  it("계좌·결제 이야기와 긴 글: 정해진 안내 줄·가린 곳 수·앞부분만 읽은 줄을 보이고, 계좌번호·링크와 업체 말은 화면 글자 밖(이름표 속성)에 없으며, 넣기 전에는 아무 요청도 없다", async () => {
    const api = mockApi({ "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }) });
    const { container } = await render(<LiveConsultation />);
    const reply = [
      "계약금은 국민은행 123456-01-234567 로 입금 부탁드려요.",
      "토요일 오후는 마감입니다.",
      "결제는 pay.example.com/abc 에서 해 주세요.",
      "안내 문구입니다. ".repeat(500),
    ].join("\n");
    const area = await readReply(container, reply);
    // 업체가 쓴 말은 가린 글과 따옴표 안에 글자로 보인다.
    expect(area.querySelector("[data-vendor-reply-phrases]")?.textContent).toContain("토요일 오후는 마감입니다.");

    const preview = area.querySelector("[data-vendor-reply-preview]");
    expect(preview?.querySelector("[data-vendor-reply-caution]")?.textContent).toBe(VENDOR_REPLY_COPY.caution);
    expect(preview?.textContent).toContain(VENDOR_REPLY_COPY.truncated);
    const { maskedCount } = readVendorReply(reply);
    expect(maskedCount).toBeGreaterThanOrEqual(2);
    expect(preview?.textContent).toContain(VENDOR_REPLY_COPY.masked(maskedCount));
    const masked = area.querySelector("[data-vendor-reply-masked]")?.textContent ?? "";
    expect(masked).toContain(VENDOR_REPLY_COPY.maskLabels.account);
    expect(masked).toContain(VENDOR_REPLY_COPY.maskLabels.link);
    for (const original of ["123456-01-234567", "pay.example.com"]) expect(container.innerHTML).not.toContain(original);

    // 오류 보고의 클릭 흔적은 이름표 속성을 싣는다. 업체가 쓴 말은 그 속성에 들어가지 않는다.
    for (const element of Array.from(container.querySelectorAll("*"))) {
      for (const attribute of ["aria-label", "title", "alt", "name"]) {
        const value = element.getAttribute(attribute) ?? "";
        for (const words of ["입금 부탁", "마감입니다"]) expect(value).not.toContain(words);
      }
    }
    expect(api.calls).toHaveLength(1);
  });

  it("업체가 적은 요일이 달력과 다르면 다른 안내 줄과 같은 자리·모양으로 한 번만 알리고, 칩은 달력의 요일을 적는다. 요일이 맞으면 그 줄이 없다", async () => {
    const api = mockApi({ "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }) });
    const { container } = await render(<LiveConsultation />);
    const area = await readReply(container, "11월 30일 (토) 오후 2시 가능해요");
    const note = area.querySelector("[data-vendor-reply-preview] [data-vendor-reply-weekday-mismatch]");
    expect(note?.textContent).toBe(VENDOR_REPLY_COPY.weekdayMismatch);
    // 경고색·경고 읽기(alert)가 아니라 가린 곳 수·결제 안내와 같은 차분한 줄이다.
    expect(note?.getAttribute("role")).toBeNull();
    expect(note?.className).not.toContain("warn");
    expect(buttonNamed(area, "11월 30일 (월) 오후 2시")).toBeDefined();

    // 요일이 어긋난 날짜가 둘이어도 줄은 한 번이다.
    await click(buttonNamed(area, VENDOR_REPLY_COPY.again));
    await typeInto(pasteArea(container).querySelector("textarea"), "11월 30일 (토) 오후 2시나 12월 1일 (토) 오후 3시 가능해요");
    await click(buttonNamed(container, VENDOR_REPLY_COPY.read));
    const twice = pasteArea(container);
    expect(buttonNamed(twice, "12월 1일 (화) 오후 3시")).toBeDefined();
    expect(twice.querySelectorAll("[data-vendor-reply-weekday-mismatch]")).toHaveLength(1);
    expect((twice.textContent ?? "").split(VENDOR_REPLY_COPY.weekdayMismatch)).toHaveLength(2);

    await click(buttonNamed(twice, VENDOR_REPLY_COPY.again));
    await typeInto(pasteArea(container).querySelector("textarea"), "11월 30일 (월) 오후 2시 가능해요");
    await click(buttonNamed(container, VENDOR_REPLY_COPY.read));
    const matching = pasteArea(container);
    expect(buttonNamed(matching, "11월 30일 (월) 오후 2시")).toBeDefined();
    expect(matching.querySelector("[data-vendor-reply-weekday-mismatch]")).toBeNull();
    expect(matching.textContent).not.toContain(VENDOR_REPLY_COPY.weekdayMismatch);
    // 읽기는 이 기기 안에서만 한다.
    expect(api.calls).toHaveLength(1);
  });

  it("붙여 넣은 답으로 넣은 상담이 있으면 빈 화면은 아직 없다고 하지 않고 넣은 상담 수를 말하며, 둘째 줄과 전체 일정 단추는 그대로다", async () => {
    mockApi({ "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: replyPaste({ addedCount: 2 }) }) });
    const { container } = await render(<LiveConsultation />);
    expect(container.textContent).toContain(VENDOR_REPLY_COPY.addedSoFar(2));
    expect(container.textContent).not.toContain(CONSULTATION_STATE_COPY.none);
    expect(container.textContent).toContain(VENDOR_REPLY_COPY.emptySub);
    expect(linkTo(container, "/wedding/schedule")?.textContent).toBe(CONSULTATION_STATE_COPY.fullSchedule);
    expect(container.querySelector("[data-vendor-reply]")).not.toBeNull();
    await cleanup();

    mockApi({ "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }) });
    const none = await render(<LiveConsultation />);
    expect(none.container.textContent).toContain(CONSULTATION_STATE_COPY.none);
    expect(none.container.textContent).not.toContain(VENDOR_REPLY_COPY.addedSoFar(0));
    expect(linkTo(none.container, "/wedding/schedule")?.textContent).toBe(CONSULTATION_STATE_COPY.fullSchedule);
  });

  it("새 상담을 일정에 넣으면 상담을 다시 읽어 넣은 상담 수를 맞춘다. 이미 있던 일정이면 다시 읽지 않는다", async () => {
    const api = mockApi({
      "GET /api/invitation/consultation": [
        json({ ...EMPTY, replyPaste: REPLY_PASTE }),
        json({ ...EMPTY, replyPaste: replyPaste({ addedCount: 1 }) }),
      ],
      "POST /api/invitation/consultation/paste-schedule": [
        json(ADDED),
        json({ added: false, alreadyInCalendar: true, eventId: "event-9" }),
      ],
    });
    const { container } = await render(<LiveConsultation />);
    const area = await readReply(container, REPLY_TEXT);
    await click(buttonNamed(area, "하나 웨딩홀"));
    await click(buttonNamed(area, "11월 30일 (월) 오후 2시"));
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(api.count("GET", "/api/invitation/consultation")).toBe(2);
    expect(container.textContent).toContain(VENDOR_REPLY_COPY.addedSoFar(1));
    expect(container.textContent).not.toContain(CONSULTATION_STATE_COPY.none);
    // 다시 읽어도 붙여 넣기 칸과 결과 줄은 그대로다.
    expect(pasteArea(container).querySelector('[role="status"]')?.textContent).toBe(VENDOR_REPLY_COPY.added);

    await click(buttonNamed(pasteArea(container), VENDOR_REPLY_COPY.add));
    expect(pasteArea(container).querySelector('[role="status"]')?.textContent).toBe(VENDOR_REPLY_COPY.alreadyAdded);
    expect(api.count("GET", "/api/invitation/consultation")).toBe(2);
  });

  it("넣는 동안 홀·날짜·시간을 바꾸면 그 값으로 넣은 것이 아니므로 끝난 뒤에도 넣었다는 줄을 보이지 않는다. 바꾸지 않았으면 보인다", async () => {
    let finishAdd: (response: Response) => void = () => undefined;
    mockApi({
      "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }),
      "POST /api/invitation/consultation/paste-schedule": [
        () => new Promise<Response>((resolve) => {
          finishAdd = resolve;
        }),
        json(ADDED),
      ],
    });
    const { container } = await render(<LiveConsultation />);
    const area = await readReply(container, REPLY_TEXT);
    await click(buttonNamed(area, "하나 웨딩홀"));
    await click(buttonNamed(area, "11월 30일 (월) 오후 2시"));
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    await typeInto(area.querySelector('input[type="date"]'), "2026-12-01");
    await act(async () => finishAdd(json(ADDED)));
    await flush();
    expect(fieldValue(area, 'input[type="date"]')).toBe("2026-12-01");
    expect(area.querySelector('[role="status"]')).toBeNull();
    expect(area.textContent).not.toContain(VENDOR_REPLY_COPY.added);

    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(area.querySelector('[role="status"]')?.textContent).toBe(VENDOR_REPLY_COPY.added);
  });

  it("시간 칸에 덜 고른 시간이 남아 있으면(분을 지움) 날짜만 넣지 않고 끝까지 고르라고 하며 아무것도 보내지 않는다. 시간 없이 넣기를 고르면 날짜만 보낸다", async () => {
    const api = mockApi({
      "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }),
      "POST /api/invitation/consultation/paste-schedule": json(ADDED),
    });
    const { container } = await render(<LiveConsultation />);
    const area = await readReply(container, "네 확인했습니다 감사합니다");
    await click(buttonNamed(area, "하나 웨딩홀"));
    await typeInto(area.querySelector('input[type="date"]'), "2026-12-12");
    const time = area.querySelector<HTMLInputElement>('input[type="time"]');
    await typeInto(time, "15:30");
    // 브라우저의 시간 칸에서 분을 지우면 값은 빈 글이 되고 칸은 덜 고른 값(badInput)을 들고 있다. jsdom 에는 그 상태가 없어 흉내 낸다.
    stubBadInput(time, true);
    await typeInto(time, "");
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(area.querySelector('[role="alert"]')?.textContent).toBe(VENDOR_REPLY_COPY.timeIncomplete);
    expect(api.count("POST", "/api/invitation/consultation/paste-schedule")).toBe(0);

    await click(area.querySelector('input[type="checkbox"]'));
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(api.last("POST", "/api/invitation/consultation/paste-schedule")?.body).toEqual({ hallId: HALL_A, date: "2026-12-12" });
    expect(area.querySelector('[role="status"]')?.textContent).toBe(VENDOR_REPLY_COPY.added);
  });

  it("빈 시간 칸에서 시만 고르면(값이 그대로라 바뀜이 오지 않는다) 칸을 떠날 때 읽어 두고, 넣기를 누르면 끝까지 고르라고 한다. 칩으로 시간을 채우면 넣는다", async () => {
    const api = mockApi({
      "GET /api/invitation/consultation": json({ ...EMPTY, replyPaste: REPLY_PASTE }),
      "POST /api/invitation/consultation/paste-schedule": json(ADDED),
    });
    const { container } = await render(<LiveConsultation />);
    const area = await readReply(container, REPLY_TEXT);
    await click(buttonNamed(area, "하나 웨딩홀"));
    await typeInto(area.querySelector('input[type="date"]'), "2026-11-30");
    const time = area.querySelector<HTMLInputElement>('input[type="time"]');
    stubBadInput(time, true);
    await act(async () => {
      time?.focus();
      time?.blur();
    });
    await flush();
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(area.querySelector('[role="alert"]')?.textContent).toBe(VENDOR_REPLY_COPY.timeIncomplete);
    expect(api.count("POST", "/api/invitation/consultation/paste-schedule")).toBe(0);

    // 칩이 시간 칸을 끝까지 채운다(브라우저도 그때 덜 고른 값을 버린다).
    stubBadInput(time, false);
    await click(buttonNamed(area, "11월 30일 (월) 오후 2시"));
    await click(buttonNamed(area, VENDOR_REPLY_COPY.add));
    expect(api.last("POST", "/api/invitation/consultation/paste-schedule")?.body).toEqual({ hallId: HALL_A, date: "2026-11-30", time: "14:00" });
  });
});

/** 시간 칸의 덜 고른 값(`validity.badInput`)을 흉내 낸다. jsdom 의 시간 칸은 늘 거짓이다. */
function stubBadInput(input: HTMLInputElement | null, badInput: boolean) {
  if (!input) throw new Error("시간 칸이 없다");
  Object.defineProperty(input, "validity", { configurable: true, get: () => ({ badInput, valid: !badInput }) });
}

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
