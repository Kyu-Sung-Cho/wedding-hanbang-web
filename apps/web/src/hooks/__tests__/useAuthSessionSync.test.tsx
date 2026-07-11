import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  resetAuth: vi.fn(),
  initializeAuth: vi.fn(),
  resetChat: vi.fn(),
  resetCommunity: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: {
    getState: () => ({
      user: null,
      reset: mocks.resetAuth,
      initialize: mocks.initializeAuth,
    }),
  },
}));

vi.mock("@/stores/chatStore", () => ({
  useChatStore: {
    getState: () => ({ reset: mocks.resetChat }),
  },
}));

vi.mock("@/stores/communityStore", () => ({
  useCommunityStore: {
    getState: () => ({ reset: mocks.resetCommunity }),
  },
}));

import { useAuthSessionSync } from "../useAuthSessionSync";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ enabled = true }: { enabled?: boolean }) {
  useAuthSessionSync(enabled);
  return null;
}

describe("useAuthSessionSync", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllEnvs();
  });

  it.each([
    ["both values", "", ""],
    ["the URL", "", "test-anon-key"],
    ["the anon key", "https://test.supabase.co", ""],
    ["whitespace-only values", " ", "\t"],
  ])("does not create a Supabase client when %s are missing", (_label, url, key) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", key);
    mocks.createClient.mockImplementation(() => {
      throw new Error("supabaseUrl is required");
    });

    expect(() => {
      act(() => root.render(<Harness />));
    }).not.toThrow();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("subscribes and cleans up when the public environment is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mocks.unsubscribe } },
    });
    mocks.createClient.mockReturnValue({
      auth: { onAuthStateChange: mocks.onAuthStateChange },
    });

    act(() => root.render(<Harness />));

    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.onAuthStateChange).toHaveBeenCalledTimes(1);

    act(() => root.render(<Harness enabled={false} />));
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
