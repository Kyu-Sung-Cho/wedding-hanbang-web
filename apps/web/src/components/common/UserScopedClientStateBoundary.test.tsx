// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  clear: vi.fn(),
  reconcile: vi.fn(),
  unsubscribe: vi.fn(),
  authCallback: null as null | ((event: string, session: { user?: { id?: string } } | null) => void),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      onAuthStateChange: (callback: typeof mocks.authCallback) => {
        mocks.authCallback = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
  }),
}));
vi.mock("@/lib/auth/userScopedClientState", () => ({
  clearUserScopedClientState: mocks.clear,
  reconcileUserScopedClientActor: mocks.reconcile,
  userScopedActorKeyForUser: (id: string) => `user:${id}`,
}));

import UserScopedClientStateBoundary, {
  useUserScopedClientActor,
} from "./UserScopedClientStateBoundary";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function PrivateProbe() {
  const actor = useUserScopedClientActor();
  const [privateValue] = useState(() => (
    actor.status === "ready" ? `${actor.actorKey}:private` : "blank"
  ));
  return <div data-status={actor.status}>{privateValue}</div>;
}

async function flushAsyncWork() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("UserScopedClientStateBoundary", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authCallback = null;
    document.cookie = "demo_mode=; path=/; max-age=0";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("removes A's subtree immediately, then mounts a clean B subtree", async () => {
    const bVerification = deferred<{ data: { user: { id: string } }; error: null }>();
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: { id: "account-a" } }, error: null })
      .mockReturnValueOnce(bVerification.promise);

    await act(async () => {
      root.render(<UserScopedClientStateBoundary><PrivateProbe /></UserScopedClientStateBoundary>);
      await flushAsyncWork();
    });
    expect(container.textContent).toBe("user:account-a:private");

    await act(async () => {
      mocks.authCallback?.("SIGNED_IN", { user: { id: "account-b" } });
      await Promise.resolve();
    });
    expect(container.textContent).toBe("blank");
    expect(container.textContent).not.toContain("account-a");
    expect(mocks.clear).toHaveBeenCalledWith("user:account-a");

    await act(async () => {
      bVerification.resolve({ data: { user: { id: "account-b" } }, error: null });
      await flushAsyncWork();
    });
    expect(container.textContent).toBe("user:account-b:private");
  });

  it("ignores an older verification that resolves after the B generation", async () => {
    const staleA = deferred<{ data: { user: { id: string } }; error: null }>();
    const verifiedB = deferred<{ data: { user: { id: string } }; error: null }>();
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: { id: "account-a" } }, error: null })
      .mockReturnValueOnce(staleA.promise)
      .mockReturnValueOnce(verifiedB.promise);

    await act(async () => {
      root.render(<UserScopedClientStateBoundary><PrivateProbe /></UserScopedClientStateBoundary>);
      await flushAsyncWork();
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      mocks.authCallback?.("SIGNED_IN", { user: { id: "account-b" } });
      await Promise.resolve();
      verifiedB.resolve({ data: { user: { id: "account-b" } }, error: null });
      await flushAsyncWork();
    });
    expect(container.textContent).toBe("user:account-b:private");

    await act(async () => {
      staleA.resolve({ data: { user: { id: "account-a" } }, error: null });
      await flushAsyncWork();
    });
    expect(container.textContent).toBe("user:account-b:private");
    expect(mocks.reconcile).not.toHaveBeenLastCalledWith("user:account-a");
  });

  it("does not mistake a rapid B to A transition for an A token refresh", async () => {
    const staleB = deferred<{ data: { user: { id: string } }; error: null }>();
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: { id: "account-a" } }, error: null })
      .mockReturnValueOnce(staleB.promise)
      .mockResolvedValueOnce({ data: { user: { id: "account-a" } }, error: null });

    await act(async () => {
      root.render(<UserScopedClientStateBoundary><PrivateProbe /></UserScopedClientStateBoundary>);
      await flushAsyncWork();
    });

    await act(async () => {
      mocks.authCallback?.("SIGNED_IN", { user: { id: "account-b" } });
      await Promise.resolve();
      mocks.authCallback?.("SIGNED_IN", { user: { id: "account-a" } });
      await flushAsyncWork();
    });
    expect(container.textContent).toBe("user:account-a:private");

    await act(async () => {
      staleB.resolve({ data: { user: { id: "account-b" } }, error: null });
      await flushAsyncWork();
    });
    expect(container.textContent).toBe("user:account-a:private");
  });

  it("fails closed on session loss instead of painting the old private subtree", async () => {
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: { id: "account-a" } }, error: null })
      .mockResolvedValueOnce({ data: { user: null }, error: null });

    await act(async () => {
      root.render(<UserScopedClientStateBoundary><PrivateProbe /></UserScopedClientStateBoundary>);
      await flushAsyncWork();
    });
    expect(container.textContent).toContain("account-a");

    await act(async () => {
      mocks.authCallback?.("SIGNED_OUT", null);
      await flushAsyncWork();
    });
    expect(container.textContent).toBe("guest:private");
    expect(container.textContent).not.toContain("account-a");
  });
});
