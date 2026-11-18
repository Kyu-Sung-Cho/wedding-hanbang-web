import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAmoraFirstHello,
  FIRST_RUN_TUTORIAL_COMPLETED_EVENT,
} from "@hanbang/shared";

import AppClientLayout from "./AppClientLayout";
import { useAmoraDock } from "@/components/app/amora/amoraDock";
import LoungeFirstHello from "@/components/app/LoungeFirstHello";
import {
  rememberPendingAmoraFirstHello,
  resetAmoraFirstHelloMemory,
} from "@/lib/amora/pendingFirstHello";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pathname: "/wedding/settings",
  searchParams: new URLSearchParams(),
  isDemo: true,
  isInitialized: true,
  initializeCalls: [] as Array<{ initialDemo?: boolean } | undefined>,
  authSyncCalls: [] as boolean[],
  pageViewCalls: [] as boolean[],
  profile: null as { id?: string; role?: string | null } | null,
  journey: null as
    | { wedding_date?: string | null; progress?: Record<string, unknown> }
    | null,
  partner: null as { id: string } | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.searchParams,
}));

// 새 디자인 틀도 이용 통계 끄기를 지키는지 재려고 판정을 켤 수 있게 한다. 평소에는 실제 판정 그대로다.
const analyticsMocks = vi.hoisted(() => ({ suppressed: false }));
vi.mock("@/lib/analyticsPrivacy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analyticsPrivacy")>();
  return {
    ...actual,
    isAnalyticsSuppressedLocation: (...args: Parameters<typeof actual.isAnalyticsSuppressedLocation>) =>
      analyticsMocks.suppressed || actual.isAnalyticsSuppressedLocation(...args),
  };
});

vi.mock("@/components/common/AiNoticeFooter", () => ({
  default: () => <footer>AI notice</footer>,
}));

vi.mock("@/components/app/Sidebar", () => ({
  default: () => <aside>sidebar</aside>,
}));

vi.mock("@/components/app/TopNav", () => ({
  default: () => <header>top nav</header>,
}));

vi.mock("@/components/app/chat/ChatSidePanel", () => ({
  default: ({
    isOpen,
    onClose,
    firstHello,
    presentation,
    draft,
    headerActions,
  }: {
    isOpen: boolean;
    onClose?: () => void;
    firstHello?: string | null;
    presentation?: "overlay" | "docked";
    draft?: { id: number; text: string } | null;
    headerActions?: React.ReactNode;
  }) => (
    <div
      data-testid="global-amora-panel"
      data-open={String(isOpen)}
      data-first-hello={firstHello ?? ""}
      data-presentation={presentation ?? "overlay"}
      data-draft={draft?.text ?? ""}
    >
      {headerActions}
      <button
        type="button"
        data-testid="global-amora-panel-close"
        onClick={() => onClose?.()}
      />
    </div>
  ),
}));

vi.mock("@/hooks/useAuthSessionSync", () => ({
  useAuthSessionSync: (enabled = true) => {
    mocks.authSyncCalls.push(enabled);
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    initialize: (options?: { initialDemo?: boolean }) => {
      mocks.initializeCalls.push(options);
    },
    isInitialized: mocks.isInitialized,
    isLoading: false,
    isDemo: mocks.isDemo,
    profile: mocks.profile,
    journey: mocks.journey,
    partner: mocks.partner,
  }),
}));

describe("AppClientLayout global Amora panel", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.pathname = "/wedding/settings";
    mocks.searchParams = new URLSearchParams();
    analyticsMocks.suppressed = false;
    mocks.isDemo = true;
    mocks.isInitialized = true;
    mocks.initializeCalls.length = 0;
    mocks.authSyncCalls.length = 0;
    mocks.pageViewCalls.length = 0;
    mocks.profile = null;
    mocks.journey = null;
    mocks.partner = null;
    window.localStorage.clear();
    resetAmoraFirstHelloMemory();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function renderLayout() {
    await act(async () => {
      root.render(
        <AppClientLayout>
          <div>page content</div>
        </AppClientLayout>,
      );
      await Promise.resolve();
    });
  }

  it("hydrates a server-verified demo session without an auth round trip", async () => {
    mocks.isInitialized = false;

    await act(async () => {
      root.render(
        <AppClientLayout initialDemo>
          <div>page content</div>
        </AppClientLayout>,
      );
      await Promise.resolve();
    });

    expect(mocks.initializeCalls).toEqual([{ initialDemo: true }]);
    expect(mocks.authSyncCalls).toEqual([false]);
  });

  it("restores focus to the remounted launcher after closing the panel without taking initial focus", async () => {
    await renderLayout();
    expect(document.activeElement).toBe(document.body);
    const launcher = container.querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')!;
    launcher.focus();
    await act(async () => launcher.click());
    expect(launcher.isConnected).toBe(false);
    const close = container.querySelector<HTMLButtonElement>('[data-testid="global-amora-panel-close"]')!;
    close.focus();
    await act(async () => close.click());
    const restored = container.querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]');
    expect(restored).not.toBeNull();
    expect(document.activeElement).toBe(restored);
  });

  // 아모라 화면 안에서는 아모라를 또 옆에 열지 않는다. 들어가면 옆자리를 내리고, 나오면 닫힌 채로 시작한다.
  it.each(["/wedding/chat", "/wedding/chat/board", "/wedding/chat/missions"])("unmounts and resets the panel when navigation enters Amora's own screen %s", async (pathname) => {
    await renderLayout();

    const launcher = container.querySelector<HTMLButtonElement>(
      'button[aria-label="아모라 AI 상담"]',
    );
    expect(launcher).not.toBeNull();

    await act(async () => launcher?.click());
    expect(container.querySelector('[data-testid="global-amora-panel"]')?.getAttribute("data-open"))
      .toBe("true");

    mocks.pathname = pathname;
    await renderLayout();
    expect(container.querySelector('[data-testid="global-amora-panel"]')).toBeNull();

    mocks.pathname = "/wedding/settings";
    await renderLayout();
    expect(container.querySelector('[data-testid="global-amora-panel"]')?.getAttribute("data-open"))
      .toBe("false");
  });

  // 2026-11-13 파운더 결정: 라운지에서 아모라를 열면 라운지 옆에 붙는다. 그 상태로 체크리스트·
  // 예산 같은 화면을 열어도 아모라는 그대로 옆에 남는다(기능은 아모라 뒤로).
  // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 라운지는 이제 새 디자인 틀이라 옆자리가 없다
  // (넓은 화면은 대화가 왼쪽 칸에 이미 있다). 옛 틀에 남은 화면끼리 옆자리가 이어지는지만 잰다.
  it.each(["/wedding/checklist", "/wedding/budget", "/wedding/schedule", "/wedding/preparation-style"])("keeps Amora open beside the page when moving to %s", async (pathname) => {
    await renderLayout();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')?.click());

    mocks.pathname = pathname;
    await renderLayout();
    expect(container.querySelector('[data-testid="global-amora-panel"]')?.getAttribute("data-open"))
      .toBe("true");
    // 이 화면들은 본문과 하단 탐색으로 아모라를 열므로 오른쪽 아래 고정 버튼은 없다.
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).toBeNull();
  });

  it.each(["/wedding/chat/missions", "/wedding/chat/board"])("keeps %s in the Amora shell with reachable mobile navigation", async (pathname) => {
    mocks.pathname = pathname;
    await renderLayout();
    expect(container.querySelector(".amora-workspace main")).not.toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).toBeNull();
    const nav = container.querySelector('nav[aria-label="모바일 주요 기능"]');
    // 2026-11-13 파운더 결정: 메인은 웨딩 라운지와 아모라 둘이라 아래 메뉴도 둘이다.
    expect([...nav!.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual(["/wedding/lounge", "/wedding/chat"]);
    expect(nav?.querySelector('[aria-current="location"]')?.getAttribute("href")).toBe("/wedding/chat");
    expect(nav?.querySelector('a[href="/wedding/checklist"]')).toBeNull();
  });

  it.each([
    "/wedding/vendors",
    "/wedding/vendors/vendor-123",
    "/wedding/settings",
    "/settings",
  ])("keeps exactly one global Amora launcher on %s", async (pathname) => {
    mocks.pathname = pathname;
    await renderLayout();

    expect(
      container.querySelectorAll('button[aria-label="아모라 AI 상담"]'),
    ).toHaveLength(1);
  });

  it.each([
    ["/wedding/checklist", "/wedding/checklist"],
    ["/checklist", "/wedding/checklist"],
    ["/wedding/budget", "/wedding/budget"],
    ["/budget", "/wedding/budget"],
    ["/wedding/schedule", "/wedding/schedule"],
    ["/schedule", "/wedding/schedule"],
  ])("keeps planner screens behind the two main tabs without a competing global launcher on %s", async (pathname, plannerHref) => {
    mocks.pathname = pathname;
    await renderLayout();
    expect(container.querySelector(".planning-workspace main")).not.toBeNull();
    const nav = container.querySelector('nav[aria-label="모바일 주요 기능"]');
    // 2026-11-13 파운더 결정: 체크리스트·일정·예산은 아래 메뉴에서 빠지고 라운지와 아모라가 연다.
    expect([...nav!.querySelectorAll("a")].map(link => link.textContent)).toEqual(["라운지", "아모라"]);
    expect(nav?.querySelector(`a[href="${plannerHref}"]`)).toBeNull();
    // 그 화면은 두 탭 어디에도 속하지 않으므로 어느 탭도 지금 위치로 표시하지 않는다.
    expect(nav?.querySelectorAll('[aria-current="location"]')).toHaveLength(0);
    expect(nav?.querySelector('a[href="/wedding/chat"] [data-amora-mark="compass"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).toBeNull();
    // 고정 버튼은 없지만 아모라를 옆에 열 자리는 있다(상단 바·본문이 연다). 처음에는 닫혀 있다.
    expect(container.querySelector('[data-testid="global-amora-panel"]')?.getAttribute("data-open")).toBe("false");
    expect(container.textContent).toContain("AI notice");
  });

  // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 라운지·아모라·준비 순서·웨딩홀 비교·편지·상담은
  // 새 디자인이 화면 전체를 그린다. 옛 사이드바·상단 바·아모라 옆자리·아래 두 칸 메뉴가 없고(새 화면의 하단 메뉴가 있다),
  // 서비스 테마(Pretendard 제목·단추 덮어쓰기)가 걸리지 않는다. 옛 라운지 바닥의 AI 고지는 라운지 화면이 직접 그린다.
  it.each([
    "/wedding/lounge",
    "/lounge",
    "/wedding/chat",
    "/wedding/journey",
    "/wedding/halls",
    "/wedding/halls/letter",
    "/wedding/halls/consultation",
  ])("renders %s in the invitation shell without the old chrome or the service heading bridge", async pathname => {
    mocks.pathname = pathname;
    await renderLayout();
    const shell = container.querySelector('[data-app-shell="invitation"]');
    expect(shell).not.toBeNull();
    expect(shell?.querySelector("main")?.textContent).toBe("page content");
    // 제목·단추를 Pretendard 로 덮는 규칙은 서비스 테마 아래에서만 걸린다. 새 틀에는 그 테마가 없다.
    expect(container.querySelector(".hanbang-service-theme")).toBeNull();
    // 승인 카드·저장 시트가 쓰는 아모라 색 변수는 예외 틀 이름(`amora-workspace`)이 준다.
    expect(shell?.classList.contains("amora-workspace")).toBe(true);
    expect(container.textContent).not.toContain("sidebar");
    expect(container.textContent).not.toContain("top nav");
    expect(container.querySelector("[data-amora-dock]")).toBeNull();
    expect(container.querySelector('[data-testid="global-amora-panel"]')).toBeNull();
    expect(container.querySelector('nav[aria-label="모바일 주요 기능"]')).toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).toBeNull();

    mocks.pathname = "/wedding/settings";
    await renderLayout();
    expect(container.querySelector('[data-app-shell="invitation"]')).toBeNull();
    expect(container.querySelector(".planning-workspace main")).not.toBeNull();
    expect(container.querySelectorAll('button[aria-label="아모라 AI 상담"]')).toHaveLength(1);
    expect(container.textContent).toContain("sidebar");
  });

  it("keeps the demo notice, the server-verified demo hydration and the auth wait in the invitation shell", async () => {
    mocks.pathname = "/wedding/lounge";
    mocks.isInitialized = false;
    await act(async () => {
      root.render(
        <AppClientLayout initialDemo banner={<div data-testid="demo-banner">체험</div>}>
          <div>page content</div>
        </AppClientLayout>,
      );
      await Promise.resolve();
    });
    // 인증을 확인하기 전에는 옛 틀과 같은 기다림 화면이다(새 화면을 그리지 않는다).
    expect(container.querySelector('[data-app-shell="invitation"]')).toBeNull();
    expect(container.textContent).not.toContain("page content");
    expect(mocks.initializeCalls).toEqual([{ initialDemo: true }]);
    expect(mocks.authSyncCalls).toEqual([false]);

    mocks.isInitialized = true;
    await act(async () => {
      root.render(
        <AppClientLayout initialDemo banner={<div data-testid="demo-banner">체험</div>}>
          <div>page content</div>
        </AppClientLayout>,
      );
      await Promise.resolve();
    });
    const shell = container.querySelector('[data-app-shell="invitation"]');
    expect(shell?.querySelector('[data-testid="demo-banner"]')).not.toBeNull();
  });

  it("keeps analytics suppression in the invitation shell", async () => {
    analyticsMocks.suppressed = true;
    mocks.pathname = "/wedding/lounge";
    await renderLayout();
    expect(container.querySelector('[data-app-shell="invitation"]')?.classList.contains("ph-no-capture")).toBe(true);
    analyticsMocks.suppressed = false;
    await renderLayout();
    expect(container.querySelector('[data-app-shell="invitation"]')?.classList.contains("ph-no-capture")).toBe(false);
  });

  it("keeps Amora's other screens (board·missions·personal) in the old shell", async () => {
    for (const pathname of ["/wedding/chat/board", "/wedding/chat/personal", "/wedding/chat/missions"]) {
      mocks.pathname = pathname;
      await renderLayout();
      expect(container.querySelector('[data-app-shell="invitation"]')).toBeNull();
      expect(container.querySelector(".amora-workspace main")).not.toBeNull();
    }
  });

  it.each(["/preparation-style", "/wedding/preparation-style"])("keeps %s in the lounge shell without marking a different bottom tab active", async pathname => {
    mocks.pathname = pathname;
    await renderLayout();
    expect(container.querySelector(".amora-workspace main")).not.toBeNull();
    const nav = container.querySelector('nav[aria-label="모바일 주요 기능"]');
    expect(nav?.querySelectorAll("a")).toHaveLength(2);
    expect(nav?.querySelectorAll('[aria-current="location"]')).toHaveLength(0);
    expect(nav?.querySelector('a[href="/wedding/lounge"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).toBeNull();
    expect(container.querySelector('[data-testid="global-amora-panel"]')?.getAttribute("data-open")).toBe("false");
  });

  it("suppresses analytics capture and the Amora launcher only in admin vendor preview mode", async () => {
    mocks.isDemo = false;
    mocks.pathname = "/wedding/vendors";
    mocks.searchParams = new URLSearchParams("preview=1");
    await renderLayout();

    expect(container.querySelector(".ph-no-capture")).not.toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).toBeNull();

    mocks.searchParams = new URLSearchParams();
    await renderLayout();

    expect(container.querySelector(".ph-no-capture")).toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).not.toBeNull();
  });

  it("첫 실행 안내가 끝나면 아모라가 먼저 말을 건다", async () => {
    mocks.isDemo = false;
    mocks.profile = { role: "bride" };
    mocks.journey = {
      wedding_date: "2026-10-17",
      progress: { __stage: "venue_booked" },
    };
    await renderLayout();

    // 안내가 끝나기 전에는 말풍선도 읽지 않음 표시도 없다.
    expect(container.querySelector('[data-testid="amora-first-hello-bubble"]')).toBeNull();
    expect(container.querySelector('[data-testid="amora-first-hello-dot"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT));
    });

    const bubble = container.querySelector('[data-testid="amora-first-hello-bubble"]');
    expect(bubble).not.toBeNull();
    expect(container.querySelector('[data-testid="amora-first-hello-dot"]')).not.toBeNull();
    // 문구는 모델이 아니라 온보딩 입력만으로 만들어진다.
    const expected = buildAmoraFirstHello({
      weddingDate: "2026-10-17",
      preparationStage: "venue_booked",
      partnerLinked: false,
      now: Date.now(),
    });
    expect(bubble?.textContent).toContain(expected.preview);

    // 누르면 대화가 열리고 첫마디 전문이 이미 놓여 있다.
    const openButton = bubble?.querySelector("button");
    await act(async () => (openButton as HTMLButtonElement | null)?.click());

    const panel = container.querySelector('[data-testid="global-amora-panel"]');
    expect(panel?.getAttribute("data-open")).toBe("true");
    expect(panel?.getAttribute("data-first-hello")).toBe(expected.body);
  });

  it("말풍선을 닫으면 다시 뜨지 않는다", async () => {
    mocks.isDemo = false;
    mocks.profile = { role: "groom" };
    await renderLayout();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT));
    });
    expect(container.querySelector('[data-testid="amora-first-hello-bubble"]')).not.toBeNull();

    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="아모라 인사 닫기"]',
    );
    await act(async () => dismiss?.click());

    expect(container.querySelector('[data-testid="amora-first-hello-bubble"]')).toBeNull();
    expect(container.querySelector('[data-testid="amora-first-hello-dot"]')).toBeNull();

    // 그래도 첫마디 자체는 남아 있어 버튼을 눌렀을 때 아모라가 먼저 말한 상태로 열린다.
    const launcher = container.querySelector<HTMLButtonElement>(
      'button[aria-label="아모라 AI 상담"]',
    );
    await act(async () => launcher?.click());
    expect(
      container.querySelector('[data-testid="global-amora-panel"]')
        ?.getAttribute("data-first-hello"),
    ).not.toBe("");
  });
  it("첫마디는 한 번만 건넨다 — 대화를 닫으면 사라진다", async () => {
    // 이 메시지는 chat_messages에 저장되지 않는 화면 전용이라, 남겨두면 패널을 열
    // 때마다 아모라가 같은 인사를 다시 하는 것처럼 보인다. 앱은 이미 한 번만
    // 보여주고 지운다 — 두 플랫폼이 같아야 한다.
    mocks.isDemo = false;
    mocks.profile = { role: "bride" };
    await renderLayout();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT));
    });

    const bubble = container.querySelector('[data-testid="amora-first-hello-bubble"]');
    await act(async () => (bubble?.querySelector("button") as HTMLButtonElement | null)?.click());

    const panel = () => container.querySelector('[data-testid="global-amora-panel"]');
    expect(panel()?.getAttribute("data-first-hello")).not.toBe("");

    // 닫는다.
    const close = container.querySelector<HTMLButtonElement>(
      '[data-testid="global-amora-panel-close"]',
    );
    await act(async () => close?.click());

    // 다시 열면 첫마디는 더 이상 놓여 있지 않다.
    const launcher = container.querySelector<HTMLButtonElement>(
      'button[aria-label="아모라 AI 상담"]',
    );
    await act(async () => launcher?.click());
    expect(panel()?.getAttribute("data-open")).toBe("true");
    expect(panel()?.getAttribute("data-first-hello")).toBe("");
  });

  /** 새로고침 — 같은 계정으로 화면을 처음부터 다시 그린다. */
  async function remountLayout() {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await renderLayout();
  }

  it("새로고침해도 첫마디는 그 계정에서 사라지지 않는다", async () => {
    // 안내 완료는 이미 계정에 적혀 안내가 다시 뜨지 않는다. 화면 상태에만 담아두면
    // 새로고침한 사람은 그 계정으로 첫마디를 영영 못 만난다.
    mocks.isDemo = false;
    mocks.profile = { id: "user-1", role: "bride" };
    await renderLayout();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT));
    });
    const preview = container
      .querySelector('[data-testid="amora-first-hello-bubble"]')
      ?.textContent;
    expect(preview).toBeTruthy();

    await remountLayout();

    expect(
      container.querySelector('[data-testid="amora-first-hello-bubble"]')?.textContent,
    ).toBe(preview);
  });

  it("말풍선을 닫고 새로고침하면 알림은 조용하고 인사는 대화에 남는다", async () => {
    mocks.isDemo = false;
    mocks.profile = { id: "user-1", role: "groom" };
    await renderLayout();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT));
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="아모라 인사 닫기"]')
        ?.click(),
    );

    await remountLayout();

    // 말풍선은 알림이고 첫마디는 인사다. "알림 봤다"가 "인사 필요 없다"는 아니다.
    expect(container.querySelector('[data-testid="amora-first-hello-bubble"]')).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')
        ?.click(),
    );
    expect(
      container
        .querySelector('[data-testid="global-amora-panel"]')
        ?.getAttribute("data-first-hello"),
    ).not.toBe("");
  });

  it("한 번 건넨 뒤에는 새로고침해도 다시 놓이지 않는다", async () => {
    mocks.isDemo = false;
    mocks.profile = { id: "user-1", role: "bride" };
    await renderLayout();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT));
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')
        ?.click(),
    );

    // 이번 페이지 로드의 기억까지 지우면 "다음에 다시 켰을 때"와 같은 상태가 된다.
    resetAmoraFirstHelloMemory();
    await remountLayout();

    expect(container.querySelector('[data-testid="amora-first-hello-bubble"]')).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="아모라 AI 상담"]')
        ?.click(),
    );
    expect(
      container
        .querySelector('[data-testid="global-amora-panel"]')
        ?.getAttribute("data-first-hello"),
    ).toBe("");
  });

});

/** 라운지 본문처럼 `useAmoraDock()` 으로 아모라를 여는 화면 조각. */
function PageOpensAmora({ prefill }: { prefill?: string }) {
  const dock = useAmoraDock();
  return (
    <button
      type="button"
      data-testid="page-opens-amora"
      onClick={() => dock?.open(prefill ? { prefill } : undefined)}
    >
      아모라에게 물어보기
    </button>
  );
}

/** 큰 화면(Tailwind xl 이상) 판정을 흉내 낸다. jsdom 에는 matchMedia 가 없다. */
function mockWideScreen(initial: boolean) {
  const listeners = new Set<() => void>();
  const state = { matches: initial };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(min-width: 80rem)" ? state.matches : false,
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }),
  });
  return {
    set(next: boolean) {
      state.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("AppClientLayout 아모라 옆자리 (2026-11-13 파운더 결정)", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 라운지는 새 디자인 틀이라 옆자리가 없다.
    // 옆자리의 동작(질문을 들고 열기·너비·덮개 전환·첫마디)은 고정 버튼 없이 옆자리를 쓰는 옛 틀 화면(체크리스트)에서
    // 그대로 잰다. 라운지가 하던 역할(고정 버튼 없음, 본문이 여는 아모라)을 이 화면이 똑같이 한다.
    mocks.pathname = "/wedding/checklist";
    mocks.searchParams = new URLSearchParams();
    mocks.isDemo = true;
    mocks.isInitialized = true;
    mocks.profile = null;
    mocks.journey = null;
    mocks.partner = null;
    window.localStorage.clear();
    resetAmoraFirstHelloMemory();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    Reflect.deleteProperty(window, "matchMedia");
  });

  async function renderWith(children: React.ReactNode) {
    await act(async () => {
      root.render(<AppClientLayout>{children}</AppClientLayout>);
      await Promise.resolve();
    });
  }

  const panel = () => container.querySelector('[data-testid="global-amora-panel"]');
  const pane = () => container.querySelector<HTMLElement>("#amora-dock-pane");

  it("라운지 본문에서 질문을 넣어 둔 채로 아모라를 연다(보내지는 않는다)", async () => {
    await renderWith(<PageOpensAmora prefill="  드레스 준비, 지금 뭐부터 하면 될까?  " />);
    expect(panel()?.getAttribute("data-open")).toBe("false");

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="page-opens-amora"]')?.click());

    expect(panel()?.getAttribute("data-open")).toBe("true");
    expect(panel()?.getAttribute("data-draft")).toBe("드레스 준비, 지금 뭐부터 하면 될까?");
    // 화면 폭을 모르는 환경은 예전처럼 덮개로 연다.
    expect(panel()?.getAttribute("data-presentation")).toBe("overlay");
    expect(container.querySelector('[data-amora-dock="overlay"]')).not.toBeNull();
  });

  it("큰 화면에서는 라운지를 옆으로 밀고 반을 차지하고, 버튼 하나로 1/3 이 되며, 고른 너비를 기억한다", async () => {
    mockWideScreen(true);
    await renderWith(<PageOpensAmora />);
    expect(container.querySelector('[data-amora-dock="closed"]')).not.toBeNull();
    // 닫혀 있는 동안 옆자리는 자리를 차지하지 않는다.
    expect(pane()?.className).toContain("hidden");
    expect(container.querySelector('[role="separator"]')).toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="page-opens-amora"]')?.click());

    expect(container.querySelector('[data-amora-dock="open"]')).not.toBeNull();
    expect(panel()?.getAttribute("data-presentation")).toBe("docked");
    expect(pane()?.style.width).toBe("50%");
    const separator = container.querySelector('[role="separator"]');
    expect(separator?.getAttribute("aria-controls")).toBe("amora-dock-pane");
    expect(separator?.getAttribute("aria-valuenow")).toBe("50");

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="아모라 창 좁게 보기"]')?.click());
    expect(pane()?.style.width).toMatch(/^33\.33/);
    expect(container.querySelector('button[aria-label="아모라 창 넓게 보기"]')).not.toBeNull();
    expect(Number(window.localStorage.getItem("hanbang:amora-dock-ratio:v1"))).toBeCloseTo(1 / 3, 5);

    // 새로고침해도 이 브라우저에서 고른 너비로 연다.
    await act(async () => root.unmount());
    container.replaceChildren();
    root = createRoot(container);
    await renderWith(<PageOpensAmora />);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="page-opens-amora"]')?.click());
    expect(pane()?.style.width).toMatch(/^33\.33/);
  });

  it("창을 좁히면 옆자리가 덮개로 바뀌고, 쓰던 대화 자리는 그대로 열려 있다", async () => {
    const screen = mockWideScreen(true);
    await renderWith(<PageOpensAmora prefill="예산 다시 나눠 줘" />);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="page-opens-amora"]')?.click());
    const before = panel();
    expect(before?.getAttribute("data-presentation")).toBe("docked");

    await act(async () => screen.set(false));

    expect(panel()).toBe(before);
    expect(panel()?.getAttribute("data-open")).toBe("true");
    expect(panel()?.getAttribute("data-presentation")).toBe("overlay");
    expect(panel()?.getAttribute("data-draft")).toBe("예산 다시 나눠 줘");
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });

  it("라운지에서는 첫마디를 라운지 카드에 맡기고, 아모라를 열면 그 첫마디를 건넨다", async () => {
    mocks.isDemo = false;
    mocks.profile = { id: "user-1", role: "bride" };
    // 라운지의 첫마디 카드(`LoungeFirstHello`)가 안내가 끝난 직후 보관해 둔 인사.
    const hello = rememberPendingAmoraFirstHello(
      { preview: "안녕하세요, 아모라예요.", body: "안녕하세요, 아모라예요. 오늘은 식장부터 같이 볼까요?" },
      { ownerId: "user-1" },
    );
    expect(hello).not.toBeNull();
    await renderWith(<PageOpensAmora />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT));
    });
    // 라운지에는 고정 버튼과 말풍선이 없다. 인사가 두 군데에 뜨지 않는다.
    expect(container.querySelector('[data-testid="amora-first-hello-bubble"]')).toBeNull();
    expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="page-opens-amora"]')?.click());
    expect(panel()?.getAttribute("data-first-hello")).toBe("안녕하세요, 아모라예요. 오늘은 식장부터 같이 볼까요?");
  });

  it("첫인사 카드의 링크가 아니라 다른 입구로 열어도, 인사는 아모라 쪽에만 남고 카드는 내려간다", async () => {
    mocks.isDemo = false;
    mocks.profile = { id: "user-1", role: "bride" };
    rememberPendingAmoraFirstHello(
      { preview: "안녕하세요, 아모라예요.", body: "안녕하세요, 아모라예요. 오늘은 식장부터 같이 볼까요?" },
      { ownerId: "user-1" },
    );
    await renderWith(<><LoungeFirstHello ownerId="user-1" /><PageOpensAmora /></>);
    const card = () => container.querySelector('section[aria-label="아모라의 첫인사"]');
    expect(card()).not.toBeNull();

    // 상단 바나 「아모라에게 물어보기」처럼 카드 밖의 입구로 연다.
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="page-opens-amora"]')?.click());

    expect(panel()?.getAttribute("data-first-hello")).toBe("안녕하세요, 아모라예요. 오늘은 식장부터 같이 볼까요?");
    expect(card()).toBeNull();
  });
});
