import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommunityAuthInitializer from "@/components/community/CommunityAuthInitializer";
import CommunityAmoraLauncher from "@/components/community/CommunityAmoraLauncher";
import { useCommunityRealtime } from "@/hooks/useCommunityRealtime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  usePathname: vi.fn(() => "/wedding"),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
}));

vi.mock("@/components/common/AuthInitializer", () => ({
  default: () => <div>auth initialized</div>,
}));

function PublicLandingOptionalEffects() {
  useCommunityRealtime();
  return <CommunityAuthInitializer />;
}

describe("public landing preview stub", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://production.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "accidental-production-key");
    mocks.createBrowserClient.mockReset();
    mocks.usePathname.mockReset();
    mocks.usePathname.mockReturnValue("/wedding");
    mocks.createBrowserClient.mockImplementation(() => {
      throw new Error("preview stub must not create a Supabase client");
    });
    vi.stubGlobal("fetch", vi.fn());

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips optional auth and realtime clients even if live config is injected", async () => {
    await act(async () => {
      root.render(<PublicLandingOptionalEffects />);
      await Promise.resolve();
    });

    expect(mocks.createBrowserClient).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("auth initialized");
  });

  it("opens the login prompt without calling an API", async () => {
    await act(async () => {
      root.render(<CommunityAmoraLauncher />);
      await Promise.resolve();
    });

    const launcher = container.querySelector<HTMLButtonElement>("button[title]");
    expect(launcher).not.toBeNull();

    await act(async () => {
      launcher?.click();
      await Promise.resolve();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it("does not cover the mobile write action bar with a second floating action", async () => {
    mocks.usePathname.mockReturnValue("/wedding/community/post/write");

    await act(async () => {
      root.render(<CommunityAmoraLauncher />);
      await Promise.resolve();
    });

    expect(container.querySelector("button[title]")).toBeNull();
  });

  it("does not cover quote-check controls with the floating launcher", async () => {
    mocks.usePathname.mockReturnValue("/wedding/community/quote-check");

    await act(async () => {
      root.render(<CommunityAmoraLauncher />);
      await Promise.resolve();
    });

    expect(container.querySelector("button[title]")).toBeNull();
  });

  it("keeps keyboard focus inside the login prompt and restores the launcher", async () => {
    await act(async () => {
      root.render(<CommunityAmoraLauncher />);
      await Promise.resolve();
    });

    const launcher = container.querySelector<HTMLButtonElement>("button[title]");
    launcher?.focus();
    await act(async () => {
      launcher?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',
    ) ?? []);
    const first = focusable[0];
    const last = focusable.at(-1);
    expect(document.activeElement).toBe(first);

    last?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("releases an open login prompt when navigation enters the write route", async () => {
    await act(async () => {
      root.render(<CommunityAmoraLauncher />);
      await Promise.resolve();
    });

    const launcher = container.querySelector<HTMLButtonElement>("button[title]");
    await act(async () => {
      launcher?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");

    mocks.usePathname.mockReturnValue("/wedding/community/post/write");
    await act(async () => {
      root.render(<CommunityAmoraLauncher />);
      await Promise.resolve();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});
