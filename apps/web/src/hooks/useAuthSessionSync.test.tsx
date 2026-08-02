import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthSessionSync } from "./useAuthSessionSync";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const state = {
    user: { id: "user-a" } as { id: string } | null,
    isDemo: false,
    initialize: vi.fn<() => Promise<void>>(),
    reset: vi.fn(),
  };
  return {
    state,
    authCallback: null as null | ((event: string, session: { user: { id: string } } | null) => void),
    unsubscribe: vi.fn(),
    clearUserScopedClientState: vi.fn(),
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (callback: typeof mocks.authCallback) => {
        mocks.authCallback = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
  }),
}));

vi.mock("@/lib/auth/userScopedClientState", () => ({
  clearUserScopedClientState: mocks.clearUserScopedClientState,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: { getState: () => mocks.state },
}));

function Harness() {
  const ready = useAuthSessionSync(true);
  return <div>{ready ? "secret protected content" : "checking"}</div>;
}

describe("useAuthSessionSync", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.state.user = { id: "user-a" };
    mocks.state.isDemo = false;
    mocks.state.initialize.mockReset();
    mocks.state.initialize.mockResolvedValue();
    mocks.state.reset.mockReset();
    mocks.state.reset.mockImplementation(() => {
      mocks.state.user = null;
    });
    mocks.authCallback = null;
    mocks.unsubscribe.mockReset();
    mocks.clearUserScopedClientState.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("blanks and purges before mounting a different authenticated identity", async () => {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toBe("secret protected content");

    let releaseNewIdentity: (() => void) | undefined;
    mocks.state.initialize.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseNewIdentity = resolve;
      });
      mocks.state.user = { id: "user-b" };
    });

    await act(async () => {
      mocks.authCallback?.("SIGNED_IN", { user: { id: "user-b" } });
      await Promise.resolve();
    });

    expect(container.textContent).toBe("checking");
    expect(mocks.clearUserScopedClientState).toHaveBeenCalledOnce();
    expect(mocks.state.reset).toHaveBeenCalledOnce();

    await act(async () => {
      releaseNewIdentity?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("secret protected content");
    expect(mocks.state.user?.id).toBe("user-b");
  });
});
