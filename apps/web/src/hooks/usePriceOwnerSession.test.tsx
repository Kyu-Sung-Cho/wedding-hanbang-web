// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { priceResponseOwner, usePriceOwnerSession } from "./usePriceOwnerSession";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const auth = vi.hoisted(() => ({ listener: vi.fn<(event: string, session: { user: { id: string } } | null) => void>(), unsubscribe: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (listener: typeof auth.listener) => {
    auth.listener = listener;
    return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
  },
} }) }));
const OWNER_A = "40000000-0000-4000-8000-000000000001";
const OWNER_B = "40000000-0000-4000-8000-000000000002";

describe("public price owner session", () => {
  let root: Root;
  let scope: ReturnType<typeof usePriceOwnerSession>;
  const onInvalidate = vi.fn();
  function Harness() {
    const current = usePriceOwnerSession(onInvalidate);
    useEffect(() => { scope = current; }, [current]);
    return null;
  }
  beforeEach(async () => {
    vi.clearAllMocks();
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Harness />));
  });
  afterEach(async () => { await act(async () => root.unmount()); });

  it("rejects malformed ownership and ignores a response from a previous account epoch", () => {
    expect(priceResponseOwner({ ownerUserId: "guest" })).toBeNull();
    expect(priceResponseOwner({ ownerUserId: OWNER_A })).toBe(OWNER_A);
    const epoch = scope.state.epoch;
    auth.listener("INITIAL_SESSION", { user: { id: OWNER_A } });
    expect(scope.acceptOwner(OWNER_A, epoch)).toBe(true);
    auth.listener("SIGNED_IN", { user: { id: OWNER_B } });
    expect(scope.isCurrent(epoch)).toBe(false);
    expect(scope.acceptOwner(OWNER_A, epoch)).toBe(false);
    expect(scope.acceptOwner(OWNER_A, scope.state.epoch)).toBe(false);
    expect(scope.acceptOwner(OWNER_B, scope.state.epoch)).toBe(true);
    expect(onInvalidate).toHaveBeenCalledWith(OWNER_A);
  });

  it("does not clear private state on token refresh for the same account", () => {
    auth.listener("INITIAL_SESSION", { user: { id: OWNER_A } });
    scope.acceptOwner(OWNER_A, scope.state.epoch);
    const epoch = scope.state.epoch;
    auth.listener("TOKEN_REFRESHED", { user: { id: OWNER_A } });
    expect(scope.isCurrent(epoch)).toBe(true);
    expect(onInvalidate).not.toHaveBeenCalled();
  });

  it("distinguishes a guest login from replacing an authenticated owner", () => {
    auth.listener("INITIAL_SESSION", null);
    auth.listener("SIGNED_IN", { user: { id: OWNER_A } });
    expect(onInvalidate).toHaveBeenCalledWith(null);
    scope.acceptOwner(OWNER_A, scope.state.epoch);
    scope.invalidate();
    expect(onInvalidate).toHaveBeenLastCalledWith(OWNER_A);
  });

  it("expires a pending read after unmount", async () => {
    const epoch = scope.state.epoch;
    await act(async () => root.render(null));
    expect(scope.isCurrent(epoch)).toBe(false);
    expect(auth.unsubscribe).toHaveBeenCalledOnce();
  });
});
