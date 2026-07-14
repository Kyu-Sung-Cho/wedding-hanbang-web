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
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

vi.mock("next/dynamic", () => ({
  default: () => () => null,
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
});
