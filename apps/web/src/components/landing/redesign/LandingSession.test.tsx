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

  function expectActions(label: string, showLogin: boolean) {
    const primaryLinks = [...container.querySelectorAll('a[href="/wedding/chat"]')];
    expect(primaryLinks).toHaveLength(2);
    expect(primaryLinks.map((link) => link.textContent)).toEqual([label, label]);
    expect(container.querySelectorAll('a[href^="/login"]').length).toBe(showLogin ? 2 : 0);
  }

  it("serves neutral working primary links before client verification, with no server auth lookup", () => {
    container.innerHTML = renderToStaticMarkup(<LandingHeader />);
    expectActions("아모라 열기", false);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("offers start and login to a verified signed-out visitor", async () => {
    await mountHeader();
    expectActions("아모라 시작하기", true);
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("offers continue and hides login for a verified member on both navigation surfaces", async () => {
    mocks.getUser.mockResolvedValue(signedIn);
    await mountHeader();
    expectActions("아모라 이어가기", false);
  });

  it("recognizes the SDK's missing-session result as signed out", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    await mountHeader();
    expectActions("아모라 시작하기", true);
  });

  it("retains neutral links when session verification fails, including a stale returned user", async () => {
    mocks.getUser.mockResolvedValue({ data: signedIn.data, error: { name: "AuthRetryableFetchError" } });
    await mountHeader();
    expectActions("아모라 열기", false);
  });

  it("retains neutral links when the lookup throws", async () => {
    mocks.getUser.mockRejectedValue(new Error("network unavailable"));
    await mountHeader();
    expectActions("아모라 열기", false);
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
    expectActions("아모라 이어가기", false);
  });

  it("does not restore a previous member from a lookup that finishes after sign-out", async () => {
    let resolvePrevious: (result: AuthResult) => void = () => {};
    mocks.getUser.mockImplementationOnce(() => new Promise((resolve) => { resolvePrevious = resolve; }));
    await mountHeader();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    await act(async () => mocks.authListener?.("SIGNED_OUT"));
    await finishRefresh();
    expectActions("아모라 시작하기", true);
    await act(async () => resolvePrevious(signedIn));
    expectActions("아모라 시작하기", true);
  });

  it("refreshes verification on focus and pageshow", async () => {
    mocks.getUser.mockResolvedValue(signedIn);
    await mountHeader();
    mocks.getUser.mockResolvedValue(signedOut);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await finishRefresh();
    expectActions("아모라 시작하기", true);
    mocks.getUser.mockResolvedValue(signedIn);
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    await finishRefresh();
    expectActions("아모라 이어가기", false);
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

  it("preserves mobile account selection, outside-click and Escape closing", async () => {
    mocks.getUser.mockResolvedValue(signedIn);
    await mountHeader();
    const details = container.querySelector("details");
    const summary = container.querySelector<HTMLElement>("summary");
    const open = async () => {
      await act(async () => {
        if (!details) return;
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
      });
    };

    await open();
    await act(async () => container.querySelector('nav[aria-label="모바일 주요 메뉴"] a[href="/wedding/chat"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(details?.open).toBe(false);
    expect(mocks.captureEvent).toHaveBeenCalledWith("landing_cta_click", { source: "landing_header" });

    await open();
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(details?.open).toBe(false);

    await open();
    await act(async () => details?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(details?.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });
});
