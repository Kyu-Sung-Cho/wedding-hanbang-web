import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAmoraFirstHello,
  FIRST_RUN_TUTORIAL_COMPLETED_EVENT,
} from "@hanbang/shared";

import AppClientLayout from "./AppClientLayout";
import { resetAmoraFirstHelloMemory } from "@/lib/amora/pendingFirstHello";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pathname: "/wedding/lounge",
  searchParams: new URLSearchParams(),
  isDemo: true,
  isInitialized: true,
  isLoading: false,
  initError: null as "timeout" | "network" | null,
  initializeCalls: [] as Array<{ initialDemo?: boolean; force?: boolean } | undefined>,
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

vi.mock("lucide-react", () => ({
  Sparkles: () => <span>sparkles</span>,
}));

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
  }: {
    isOpen: boolean;
    onClose?: () => void;
    firstHello?: string | null;
  }) => (
    <div
      data-testid="global-amora-panel"
      data-open={String(isOpen)}
      data-first-hello={firstHello ?? ""}
    >
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
    initialize: (options?: { initialDemo?: boolean; force?: boolean }) => {
      mocks.initializeCalls.push(options);
    },
    isInitialized: mocks.isInitialized,
    isLoading: mocks.isLoading,
    initError: mocks.initError,
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
    mocks.pathname = "/wedding/lounge";
    mocks.searchParams = new URLSearchParams();
    mocks.isDemo = true;
    mocks.isInitialized = true;
    mocks.isLoading = false;
    mocks.initError = null;
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

  /**
   * 딥링크로 `/wedding/*` 를 처음 열 때 이 화면이 유일한 관문이다. 여기가 끝나지
   * 않으면 그 밑의 route loading.tsx 도 Suspense fallback 도 그려지지 않는다 —
   * 사람은 "웨딩 라운지를 불러오는 중..." 만 20~50초 보다가, 때로는 영영 본다.
   */
  describe("불러오지 못했을 때", () => {
    function loadingText() {
      return container.textContent?.includes("웨딩 라운지를 불러오는 중");
    }
    function retryButton() {
      return [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "다시 시도");
    }

    it("끝나지 않는 스피너 대신 다시 시도를 준다", async () => {
      mocks.isDemo = false;
      mocks.initError = "timeout";
      await renderLayout();

      expect(loadingText()).toBe(false);
      expect(container.textContent).toContain("시간이 너무 오래 걸려요");
      expect(retryButton()).toBeDefined();
    });

    it("응답이 왔다는 듯 빈 화면으로 넘기지 않는다", async () => {
      // 서버 레이아웃이 방금 세션을 확인해 들여보낸 사람이다. 여기서 그냥
      // 통과시키면 로그인해 있는데 로그아웃한 것 같은 화면을 만난다.
      mocks.isDemo = false;
      mocks.initError = "network";
      await renderLayout();

      expect(container.textContent).toContain("불러오지 못했어요");
      expect(container.querySelector("aside")).toBeNull();
      expect(container.textContent).not.toContain("page content");
    });

    it("다시 시도는 서버에 다시 물어본다", async () => {
      mocks.isDemo = false;
      mocks.initError = "timeout";
      await renderLayout();
      mocks.initializeCalls.length = 0;

      await act(async () => retryButton()?.click());

      // force 가 없으면 isInitialized 가 true 라 initialize 가 그대로 되돌아온다.
      expect(mocks.initializeCalls).toEqual([{ force: true }]);
    });

    it("다시 시도하는 동안에는 실패 문구 대신 로딩을 보여준다", async () => {
      mocks.isDemo = false;
      mocks.initError = "timeout";
      mocks.isLoading = true;
      await renderLayout();

      expect(loadingText()).toBe(true);
      expect(container.textContent).not.toContain("시간이 너무 오래 걸려요");
    });
  });

  it("unmounts and resets the global panel when navigation enters the full chat page", async () => {
    await renderLayout();

    const launcher = container.querySelector<HTMLButtonElement>(
      'button[aria-label="아모라 AI 상담"]',
    );
    expect(launcher).not.toBeNull();

    await act(async () => launcher?.click());
    expect(container.querySelector('[data-testid="global-amora-panel"]')?.getAttribute("data-open"))
      .toBe("true");

    mocks.pathname = "/wedding/chat";
    await renderLayout();
    expect(container.querySelector('[data-testid="global-amora-panel"]')).toBeNull();

    mocks.pathname = "/wedding/lounge";
    await renderLayout();
    expect(container.querySelector('[data-testid="global-amora-panel"]')?.getAttribute("data-open"))
      .toBe("false");
  });

  it.each([
    "/wedding/vendors",
    "/wedding/vendors/vendor-123",
  ])("keeps exactly one global Amora launcher on %s", async (pathname) => {
    mocks.pathname = pathname;
    await renderLayout();

    expect(
      container.querySelectorAll('button[aria-label="아모라 AI 상담"]'),
    ).toHaveLength(1);
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
