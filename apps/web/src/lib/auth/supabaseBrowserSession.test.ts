// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSupabaseBrowserSession,
  revokeAndClearSupabaseBrowserSession,
} from "./supabaseBrowserSession";

const SUPABASE_URL = "https://project-ref.supabase.co";
const STORAGE_KEY = "sb-project-ref-auth-token";

function setCookie(name: string, value = "secret") {
  document.cookie = `${name}=${value}; Path=/; SameSite=Lax`;
}

function cookieNames() {
  return document.cookie.split(";")
    .map((entry) => entry.trim().split("=", 1)[0])
    .filter(Boolean);
}

describe("Supabase browser session termination", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    for (const name of cookieNames()) {
      document.cookie = `${name}=; Path=/; Max-Age=0`;
    }
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("removes the exact project's session, chunks, verifier, and legacy user state", () => {
    for (const name of [
      STORAGE_KEY,
      `${STORAGE_KEY}.0`,
      `${STORAGE_KEY}-code-verifier`,
      `${STORAGE_KEY}-code-verifier.0`,
      `${STORAGE_KEY}-user`,
    ]) {
      setCookie(name);
      window.localStorage.setItem(name, "secret");
      window.sessionStorage.setItem(name, "secret");
    }
    setCookie("unrelated", "keep");
    setCookie("sb-other-project-auth-token", "keep");
    window.localStorage.setItem("unrelated", "keep");

    clearSupabaseBrowserSession();

    expect(cookieNames()).toEqual(expect.arrayContaining([
      "unrelated",
      "sb-other-project-auth-token",
    ]));
    expect(cookieNames()).not.toEqual(expect.arrayContaining([
      STORAGE_KEY,
      `${STORAGE_KEY}.0`,
      `${STORAGE_KEY}-code-verifier`,
      `${STORAGE_KEY}-code-verifier.0`,
      `${STORAGE_KEY}-user`,
    ]));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(`${STORAGE_KEY}.0`)).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });

  it("still clears the local credential when remote revocation returns an error", async () => {
    setCookie(STORAGE_KEY);
    const signOut = vi.fn().mockResolvedValue({ error: new Error("network") });
    const postMessage = vi.fn();
    const close = vi.fn();
    const construct = vi.fn();
    class BroadcastChannelMock {
      constructor(name: string) {
        construct(name);
      }

      postMessage = postMessage;
      close = close;
    }
    vi.stubGlobal("BroadcastChannel", BroadcastChannelMock);

    await expect(revokeAndClearSupabaseBrowserSession({
      auth: { signOut } as never,
    })).resolves.toEqual({ remoteRevoked: false });

    expect(signOut).toHaveBeenCalledOnce();
    expect(cookieNames()).not.toContain(STORAGE_KEY);
    expect(construct).toHaveBeenCalledWith(STORAGE_KEY);
    expect(postMessage).toHaveBeenCalledWith({ event: "SIGNED_OUT", session: null });
    expect(close).toHaveBeenCalledOnce();
  });

  it("still clears the local credential when the SDK throws", async () => {
    setCookie(STORAGE_KEY);
    const signOut = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(revokeAndClearSupabaseBrowserSession({
      auth: { signOut } as never,
    })).resolves.toEqual({ remoteRevoked: false });

    expect(cookieNames()).not.toContain(STORAGE_KEY);
  });
});
