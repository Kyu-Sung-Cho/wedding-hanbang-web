import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import { useAuthSessionSync } from "./useAuthSessionSync";

const mocks = vi.hoisted(() => ({
  onAuth: null as ((event: string, session: { user: { id: string } } | null) => void) | null,
  resetChat: vi.fn(), bindViewer: vi.fn(), resetCommunity: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  signOut: mocks.signOut,
  onAuthStateChange: (callback: typeof mocks.onAuth) => {
    mocks.onAuth = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  },
} }) }));
vi.mock("@/stores/chatStore", () => ({ useChatStore: { getState: () => ({ reset: mocks.resetChat }) } }));
vi.mock("@/stores/communityStore", () => ({ useCommunityStore: { getState: () => ({
  reset: mocks.resetCommunity, bindViewer: mocks.bindViewer,
}) } }));

function Probe() { useAuthSessionSync(); return null; }
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((finish) => { resolve = finish; });
  return { promise, resolve };
}
function signedInResponse(id: string) {
  return new Response(JSON.stringify({ user: { id, email: `${id}@example.invalid` } }), { status: 200 });
}
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.cookie = "demo_mode=; Max-Age=0; path=/";
  useAuthStore.getState().reset();
  useAuthStore.setState({ user: { id: "old", email: "old@example.invalid" }, isInitialized: true });
  vi.clearAllMocks();
  mocks.signOut.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useAuthStore.getState().reset();
  vi.unstubAllGlobals();
});

describe("authentication refresh failure ownership", () => {
  it("does not restore the outgoing account while explicit logout is waiting for cookie removal", async () => {
    let finish!: () => void;
    mocks.signOut.mockReturnValueOnce(new Promise((_, reject) => {
      finish = () => reject(new Error("logout unavailable"));
    }));
    const fetchMock = vi.fn(async () => signedInResponse("old"));
    vi.stubGlobal("fetch", fetchMock);
    const logout = useAuthStore.getState().signOut().catch(() => {});
    try {
      expect(useAuthStore.getState().user).toBeNull();
      await act(async () => useAuthStore.getState().initialize());
      await act(async () => window.dispatchEvent(new Event("focus")));
      await act(async () => mocks.onAuth?.("SIGNED_OUT", null));
      expect(useAuthStore.getState().user).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      finish();
      await logout;
    }
  });

  it("does not clear chat or the verified account on a focus refresh 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(useAuthStore.getState().user?.id).toBe("old");
    expect(mocks.resetChat).not.toHaveBeenCalled();
  });

  it.each(["SIGNED_OUT", "SIGNED_IN"])("clears the outgoing account before %s even when the replacement read fails", async (event) => {
    const deferred = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise));
    await act(async () => mocks.onAuth?.(event, event === "SIGNED_IN" ? { user: { id: "new" } } : null));
    expect(useAuthStore.getState().user).toBeNull();
    expect(mocks.resetChat).toHaveBeenCalledOnce();
    await act(async () => deferred.resolve(new Response("", { status: 503 })));
    expect(useAuthStore.getState()).toMatchObject({ user: null, profile: null, journey: null, isInitialized: false });
  });

  it("still clears chat on an actual focus refresh 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(useAuthStore.getState().user).toBeNull();
    expect(mocks.resetChat).toHaveBeenCalledOnce();
  });

  it("does not clear a newly verified account's chat when an older focus request fails late", async () => {
    const deferred = deferredResponse();
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce(signedInResponse("new")));
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => mocks.onAuth?.("SIGNED_IN", { user: { id: "new" } }));
    expect(useAuthStore.getState().user?.id).toBe("new");
    expect(mocks.resetChat).toHaveBeenCalledOnce();
    mocks.resetChat.mockClear();
    await act(async () => deferred.resolve(new Response("", { status: 503 })));
    expect(useAuthStore.getState().user?.id).toBe("new");
    expect(mocks.resetChat).not.toHaveBeenCalled();
  });

  it("invalidates a pending account switch when logout arrives before that account is verified", async () => {
    const deferred = deferredResponse();
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce(new Response("", { status: 401 })));
    await act(async () => mocks.onAuth?.("SIGNED_IN", { user: { id: "new" } }));
    expect(useAuthStore.getState().user).toBeNull();
    await act(async () => mocks.onAuth?.("SIGNED_OUT", null));
    await act(async () => deferred.resolve(signedInResponse("new")));
    expect(useAuthStore.getState()).toMatchObject({ user: null, isInitialized: true });
  });
});
