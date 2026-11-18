import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthResult = {
  data: { user: { id: string } | null };
  error: { name: string } | null;
};

const mocks = vi.hoisted(() => {
  const state: {
    getUser: ReturnType<typeof vi.fn<() => Promise<AuthResult>>>;
    createClient: ReturnType<typeof vi.fn<() => void>>;
    unsubscribe: ReturnType<typeof vi.fn<() => void>>;
    captureEvent: ReturnType<typeof vi.fn<(event: string, payload: { source: string }) => void>>;
    authListener: ((event: string) => void) | null;
    authCallbackActive: boolean;
  } = {
    getUser: vi.fn<() => Promise<AuthResult>>(),
    createClient: vi.fn<() => void>(),
    unsubscribe: vi.fn<() => void>(),
    captureEvent: vi.fn<(event: string, payload: { source: string }) => void>(),
    authListener: null,
    authCallbackActive: false,
  };
  return state;
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    mocks.createClient();
    return {
      auth: {
        getUser: () => {
          if (mocks.authCallbackActive) throw new Error("SDK call inside the auth callback");
          return mocks.getUser();
        },
        onAuthStateChange: (listener: (event: string) => void) => {
          mocks.authListener = listener;
          return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
        },
      },
    };
  },
}));
vi.mock("@/lib/analytics", () => ({ captureEvent: mocks.captureEvent }));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch, onClick, ...props }:
    AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) => {
    void prefetch;
    return <a href={href} {...props} onClick={(event) => {
      event.preventDefault();
      onClick?.(event);
    }}>{children}</a>;
  },
}));

import LandingHeader from "./LandingHeader";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signedOut: AuthResult = { data: { user: null }, error: null };
const signedIn: AuthResult = { data: { user: { id: "verified-member" } }, error: null };
const LOGIN = 'a[href="/login?redirect=%2Fwedding%2Fchat"]';

/**
 * 첫 화면 오른쪽 위 로그인 알약의 세션 계약.
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 머리줄은 로그인 알약
 * 하나가 됐다(옛 머리줄의 아모라 시작 버튼·모바일 메뉴는 없다). 랜딩은 정적 응답이라 로그인
 * 상태는 브라우저에서만 확인하고, 알약은 **로그인했다고 확인될 때만** 감춘다 — 확인 전과
 * 확인이 실패했을 때는 계정 있는 사람이 들어갈 길로 남는다.
 */
describe("landing account navigation", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authListener = null;
    mocks.authCallbackActive = false;
    mocks.getUser.mockResolvedValue(signedOut);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
  });

  async function finishRefresh() {
    await act(async () => {
      await vi.dynamicImportSettled();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
  }

  async function mountHeader() {
    await act(async () => root?.render(<LandingHeader />));
    await finishRefresh();
  }

  function expectLogin(shown: boolean) {
    const links = [...container.querySelectorAll(LOGIN)];
    expect(links).toHaveLength(shown ? 1 : 0);
    if (shown) expect(links[0].textContent).toBe("로그인");
    // 머리줄에는 그 밖의 링크가 없다.
    expect(container.querySelectorAll("a")).toHaveLength(shown ? 1 : 0);
  }

  it("serves the login pill before client verification, with no server auth lookup", () => {
    container.innerHTML = renderToStaticMarkup(<LandingHeader />);
    expectLogin(true);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("keeps login for a verified signed-out visitor", async () => {
    await mountHeader();
    expectLogin(true);
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("hides login for a verified member", async () => {
    mocks.getUser.mockResolvedValue(signedIn);
    await mountHeader();
    expectLogin(false);
  });

  it("recognizes the SDK's missing-session result as signed out", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    await mountHeader();
    expectLogin(true);
  });

  it("keeps the way in when verification fails, even with a stale returned user", async () => {
    mocks.getUser.mockResolvedValue({ data: signedIn.data, error: { name: "AuthRetryableFetchError" } });
    await mountHeader();
    expectLogin(true);
  });

  it("keeps the way in when the lookup throws", async () => {
    mocks.getUser.mockRejectedValue(new Error("network unavailable"));
    await mountHeader();
    expectLogin(true);
  });

  it("checks auth changes after the SDK callback returns", async () => {
    await mountHeader();
    mocks.getUser.mockClear().mockResolvedValue(signedIn);
    await act(async () => {
      mocks.authCallbackActive = true;
      mocks.authListener?.("SIGNED_IN");
      expect(mocks.getUser).not.toHaveBeenCalled();
      mocks.authCallbackActive = false;
    });
    await finishRefresh();
    expectLogin(false);
  });

  it("does not restore a previous member from a lookup that finishes after sign-out", async () => {
    let resolvePrevious: (result: AuthResult) => void = () => {};
    mocks.getUser.mockImplementationOnce(() => new Promise((resolve) => { resolvePrevious = resolve; }));
    await mountHeader();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    await act(async () => mocks.authListener?.("SIGNED_OUT"));
    await finishRefresh();
    expectLogin(true);
    await act(async () => resolvePrevious(signedIn));
    expectLogin(true);
  });

  it("refreshes verification on focus and pageshow", async () => {
    mocks.getUser.mockResolvedValue(signedIn);
    await mountHeader();
    expectLogin(false);
    mocks.getUser.mockResolvedValue(signedOut);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await finishRefresh();
    expectLogin(true);
    mocks.getUser.mockResolvedValue(signedIn);
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    await finishRefresh();
    expectLogin(false);
  });

  it("unsubscribes and ignores resume events or outstanding responses after unmount", async () => {
    let resolvePrevious: (result: AuthResult) => void = () => {};
    mocks.getUser.mockImplementationOnce(() => new Promise((resolve) => { resolvePrevious = resolve; }));
    await mountHeader();
    await act(async () => root?.unmount());
    root = null;
    const requests = mocks.getUser.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    await act(async () => resolvePrevious(signedIn));
    await finishRefresh();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.getUser).toHaveBeenCalledTimes(requests);
    expect(container.childElementCount).toBe(0);
  });

  it("measures the login click under the header slot", async () => {
    await mountHeader();
    await act(async () => container.querySelector(LOGIN)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(mocks.captureEvent).toHaveBeenCalledWith("landing_cta_click", { source: "landing_header" });
  });
});
