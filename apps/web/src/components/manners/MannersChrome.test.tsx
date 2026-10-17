import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MannersChrome from "./MannersChrome";
import { loadSignedInAside, loadSignedInTopBar } from "./mannersChromeChunks";
import { useAuthStore } from "@/stores/authStore";

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), sessionSync: vi.fn() }));

// 사이드바·상단 바 본체는 각자의 테스트가 본다. 여기서는 어느 쪽이 그려지는지만 본다.
vi.mock("@/components/app/Sidebar", () => ({
  default: ({ isOpen }: { isOpen: boolean }) => <aside data-testid="app-sidebar" data-open={String(isOpen)} />,
}));
vi.mock("@/components/app/TopNav", () => ({
  default: ({ onMenuToggle, loungeWorkspace }: { onMenuToggle: () => void; loungeWorkspace?: boolean }) => (
    <header data-testid="app-top-nav" data-lounge={String(Boolean(loungeWorkspace))}>
      <button type="button" onClick={onMenuToggle}>메뉴 열기</button>
    </header>
  ),
}));
vi.mock("@/hooks/useAuthSessionSync", () => ({ useAuthSessionSync: mocks.sessionSync }));
// 로그인 틀 조각을 불러왔는지 센다. `lazy` 는 처음 한 번만 불러오므로, 조각을 부르는 시험은 아래에서
// 공개 모양만 보는 두 시험(위에서부터 차례로 돈다) 뒤에 둔다.
vi.mock("./mannersChromeChunks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mannersChromeChunks")>();
  return { ...actual, loadSignedInAside: vi.fn(actual.loadSignedInAside), loadSignedInTopBar: vi.fn(actual.loadSignedInTopBar) };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PUBLIC_ASIDE = <aside data-testid="public-aside">공개 사이드바</aside>;
const BODY = <main data-testid="body">본문</main>;

function setCookie(value: string) {
  document.cookie = value;
}
function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]!.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

function signIn() {
  useAuthStore.setState({ user: { id: "u1", email: "a@b.c" }, isInitialized: true });
}
function resetStore() {
  useAuthStore.setState({ user: null, isInitialized: false, isDemo: false, initialize: mocks.initialize });
}

describe("MannersChrome", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.initialize.mockReset();
    mocks.sessionSync.mockReset();
    clearCookies();
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    clearCookies();
    resetStore();
    vi.unstubAllEnvs();
  });

  const render = () =>
    act(async () => root.render(<MannersChrome publicAside={PUBLIC_ASIDE}>{BODY}</MannersChrome>));

  it("shows only the public look to a visitor without a session cookie", async () => {
    await render();
    expect(container.querySelector('[data-testid="public-aside"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="body"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="app-sidebar"]')).toBeNull();
    expect(container.querySelector('[data-testid="app-top-nav"]')).toBeNull();
    // 쿠키가 없으면 로그인 확인도, 세션 동기화도 일어나지 않는다.
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.sessionSync).not.toHaveBeenCalled();
    expect(loadSignedInAside).not.toHaveBeenCalled();
    expect(loadSignedInTopBar).not.toHaveBeenCalled();
  });

  it("renders the public look on the server even when a session cookie is present", () => {
    // 서버 렌더는 쿠키를 보지 않는다. 정적으로 미리 만들어 검색에 노출하는 공개 페이지라
    // 서버 HTML 은 로그인 여부와 무관하게 같아야 한다.
    setCookie("demo_mode=true");
    const html = renderToStaticMarkup(<MannersChrome publicAside={PUBLIC_ASIDE}>{BODY}</MannersChrome>);
    expect(html).toContain('data-testid="public-aside"');
    expect(html).toContain('data-testid="body"');
    expect(html).not.toContain("app-sidebar");
    expect(html).not.toContain("app-top-nav");
    // 서버는 로그인 틀 조각을 불러오지도 않는다.
    expect(loadSignedInAside).not.toHaveBeenCalled();
    expect(loadSignedInTopBar).not.toHaveBeenCalled();
  });

  it("swaps in the app sidebar and top bar for a signed-in reader", async () => {
    setCookie("sb-abcdefghijklmnopqrst-auth-token=x");
    signIn();
    await render();
    await vi.waitFor(() => expect(container.querySelector('[data-testid="app-sidebar"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="app-top-nav"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="public-aside"]')).toBeNull();
    expect(container.querySelector('[data-testid="body"]')).not.toBeNull();
    // 모바일 본문 머리를 내리는 표식(`MannersMobileHeader`)이 같이 남는다.
    expect(container.querySelector("[data-manners-app-chrome]")).not.toBeNull();
    // 라운지와 같은 조밀한 머리. 이 변형은 모바일에서도 알림 종을 둔다.
    expect(container.querySelector('[data-testid="app-top-nav"]')?.getAttribute("data-lounge")).toBe("true");
  });

  it("boots the auth store and follows the real session when the cookie is Supabase's", async () => {
    setCookie("sb-abcdefghijklmnopqrst-auth-token=x");
    await render();
    await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    expect(mocks.sessionSync).toHaveBeenLastCalledWith(true);
  });

  it("does not follow the real session while a demo session is in the store", async () => {
    // 앱에서 체험 세션으로 넘어온 사람의 스토어를 "로그인이 끊겼다"로 읽어 비우지 않는다.
    setCookie("demo_mode=true");
    useAuthStore.setState({ isDemo: true, user: { id: "demo", email: "demo@hanbang.ai" }, isInitialized: true });
    await render();
    await vi.waitFor(() => expect(container.querySelector('[data-testid="app-sidebar"]')).not.toBeNull());
    expect(mocks.sessionSync).toHaveBeenCalled();
    expect(mocks.sessionSync.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
  });

  it("recognises the cookie names Supabase really writes", async () => {
    for (const cookie of ["sb-abcdefghijklmnopqrst-auth-token=x", "sb-abcdefghijklmnopqrst-auth-token.0=x"]) {
      clearCookies();
      setCookie(cookie);
      signIn();
      await render();
      await vi.waitFor(() => expect(container.querySelector('[data-testid="app-sidebar"]'), cookie).not.toBeNull());
      await act(async () => root.render(<></>));
    }
  });

  it("does not treat look-alike cookies as a session", async () => {
    // 힌트가 없으면 무거운 코드를 아예 불러오지 않는다. 스토어가 로그인 상태여도 공개 모양이다.
    setCookie("theme=sb-dark");
    setCookie("xsb-1-auth-token=x");
    signIn();
    await render();
    expect(container.querySelector('[data-testid="public-aside"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="app-sidebar"]')).toBeNull();
  });

  it("ignores the session cookie in preview-stub mode, which has no Supabase values", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    setCookie("demo_mode=true");
    signIn();
    await render();
    expect(container.querySelector('[data-testid="public-aside"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="app-sidebar"]')).toBeNull();
    expect(mocks.sessionSync).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("stays public when the cookie is stale and nobody turns out to be signed in", async () => {
    setCookie("sb-abcdefghijklmnopqrst-auth-token=expired");
    await render();
    await act(async () => {
      useAuthStore.setState({ user: null, isInitialized: true });
    });
    expect(container.querySelector('[data-testid="public-aside"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="app-sidebar"]')).toBeNull();
    expect(container.querySelector('[data-testid="app-top-nav"]')).toBeNull();
    expect(container.querySelector("[data-manners-app-chrome]")).toBeNull();
  });

  it("keeps the article mounted when the chrome changes under it", async () => {
    // 서버 HTML 은 공개 모양이고, 로그인 쿠키가 있는 브라우저에서는 hydration 직후 힌트가 켜진다.
    // 힌트가 꺼져 있다가 켜지는 그 순간을 흉내 낸다.
    await render();
    const body = container.querySelector('[data-testid="body"]');
    expect(container.querySelector('[data-testid="public-aside"]')).not.toBeNull();
    setCookie("sb-abcdefghijklmnopqrst-auth-token=x");
    signIn();
    await render();
    await vi.waitFor(() => expect(container.querySelector('[data-testid="app-sidebar"]')).not.toBeNull());
    // 본문 DOM 이 그대로여야 읽던 자리·검색어·초점이 로그인 확인 때문에 사라지지 않는다.
    expect(container.querySelector('[data-testid="body"]')).toBe(body);
  });

  it("opens the sidebar drawer from the top bar menu button", async () => {
    setCookie("demo_mode=true");
    signIn();
    await render();
    await vi.waitFor(() => expect(container.querySelector('[data-testid="app-top-nav"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="app-sidebar"]')?.getAttribute("data-open")).toBe("false");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="app-top-nav"] button')!.click());
    expect(container.querySelector('[data-testid="app-sidebar"]')?.getAttribute("data-open")).toBe("true");
  });
});
