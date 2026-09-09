import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAmoraPersonalization } from "./useAmoraPersonalization";
import { DEFAULT_AMORA_PERSONALIZATION } from "@/lib/amora/personalization";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const identity = vi.hoisted(() => ({ id: "owner-a" }));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign((selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: identity.id } }), {
    getState: () => ({ user: { id: identity.id } }),
  }),
}));
function profile(mode: "listen_first" | "action_first", revision = 1) {
  return { preferences: { ...DEFAULT_AMORA_PERSONALIZATION, supportOrder: mode }, revision,
    confirmedAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z" };
}
function reply(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function deferred() { let resolve!: (v: Response) => void; const promise = new Promise<Response>(r => { resolve = r; }); return { promise, resolve }; }
describe("personalization request ownership", () => {
  let root: Root; let container: HTMLDivElement; let current: ReturnType<typeof useAmoraPersonalization>;
  function Harness() {
    const value = useAmoraPersonalization(true);
    useEffect(() => { current = value; }, [value]);
    return <div>{value.profile?.preferences.supportOrder}</div>;
  }
  async function render() { await act(async () => { root.render(<Harness />); }); }
  beforeEach(() => { identity.id = "owner-a"; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  it("reloads for a different owner even though enabled stays true and ignores the old read", async () => {
    const old = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(reply({ profile: profile("action_first") }));
    vi.stubGlobal("fetch", fetcher);
    await render();
    identity.id = "owner-b";
    await render();
    await act(async () => old.resolve(reply({ profile: profile("listen_first") })));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(current!.profile?.preferences.supportOrder).toBe("action_first");
  });
  it("does not report an old owner's delayed save as the new owner's success", async () => {
    const write = deferred();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ profile: profile("listen_first") }))
      .mockReturnValueOnce(write.promise).mockResolvedValueOnce(reply({ profile: profile("action_first", 7) })));
    await render();
    let saving!: Promise<unknown>;
    await act(async () => { saving = current.save({ supportOrder: "action_first" }); });
    identity.id = "owner-b"; await render();
    await act(async () => write.resolve(reply({ profile: profile("listen_first", 2) })));
    expect(await saving).toBeNull();
    expect(current!.profile?.revision).toBe(7);
  });
  it("serializes two same-tick saves instead of issuing two PUTs", async () => {
    const write = deferred();
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ profile: profile("listen_first") })).mockReturnValue(write.promise);
    vi.stubGlobal("fetch", fetcher); await render();
    let first!: Promise<unknown>; let second!: Promise<unknown>;
    await act(async () => { first = current.save({ supportOrder: "action_first" }); second = current.save({ workMode: "together" }); });
    await act(async () => write.resolve(reply({ profile: profile("action_first", 2) })));
    expect(await second).toBeNull(); await first;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("refuses writes after a failed initial read", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ error: "unavailable" }, 503));
    vi.stubGlobal("fetch", fetcher); await render();
    await act(async () => { expect(await current.save({ workMode: "together" })).toBeNull(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("a revision conflict loads current values but does not retry the write", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ profile: profile("listen_first") }))
      .mockResolvedValueOnce(reply({ code: "PERSONALIZATION_REVISION_CONFLICT", current: profile("action_first", 9), error: "다른 화면에서 바뀌었어요." }, 409));
    vi.stubGlobal("fetch", fetcher); await render();
    await act(async () => { expect(await current.save({ workMode: "together" })).toBeNull(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(current!.profile?.revision).toBe(9);
    expect(current!.error).toContain("바뀌었어요");
  });
  it("binds GET to the visible account so a replacement cookie session cannot be loaded into it", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const expectedOwner = new Headers(init.headers).get("X-Amora-Expected-Owner");
      return Promise.resolve(expectedOwner === "owner-a"
        ? reply({ code: "PERSONALIZATION_OWNER_MISMATCH", error: "로그인 계정이 바뀌었어요." }, 409)
        : reply({ profile: profile("action_first") }));
    });
    vi.stubGlobal("fetch", fetcher); await render();
    expect(current!.status).toBe("error");
    expect(current!.profile).toBeNull();
    await act(async () => { expect(await current.save({ workMode: "together" })).toBeNull(); });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(["save", "reset"] as const)("blocks %s when the cookie owner changes while the client store still names the first owner", async method => {
    let cookieOwner = "owner-a"; let writes = 0;
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      if (!init.method) return Promise.resolve(reply({ profile: profile("listen_first", 3) }));
      const body = JSON.parse(String(init.body));
      if (body.expectedOwnerUserId && body.expectedOwnerUserId !== cookieOwner) {
        return Promise.resolve(reply({ code: "PERSONALIZATION_OWNER_MISMATCH", error: "로그인 계정이 바뀌었어요." }, 409));
      }
      writes += 1;
      return Promise.resolve(reply(method === "save" ? { profile: profile("action_first", 4) } : { deleted: true, profile: null }));
    });
    vi.stubGlobal("fetch", fetcher); await render(); cookieOwner = "owner-b";
    await act(async () => {
      if (method === "save") expect(await current.save({ supportOrder: "action_first" })).toBeNull();
      else expect(await current.reset()).toBe(false);
    });
    expect(writes).toBe(0);
    expect(current!.profile).toBeNull();
    expect(current!.status).toBe("error");
    const body = JSON.parse(String(fetcher.mock.calls[1][1].body));
    expect(body.expectedOwnerUserId).toBe("owner-a");
    await act(async () => { expect(await current.save({ workMode: "together" })).toBeNull(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not treat a cookie-owner mismatch payload as a retryable same-owner revision conflict", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ profile: profile("listen_first") }))
      .mockResolvedValueOnce(reply({ code: "PERSONALIZATION_OWNER_MISMATCH", current: profile("action_first", 9), error: "로그인 계정이 바뀌었어요." }, 409));
    vi.stubGlobal("fetch", fetcher); await render();
    await act(async () => { await current.save({ workMode: "together" }); });
    expect(current!.profile).toBeNull();
    expect(current!.status).toBe("error");
  });
});
