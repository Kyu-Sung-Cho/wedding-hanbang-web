import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ state: { user: { id: "owner-a" } as { id: string } | null, isDemo: false }, listeners: new Set<() => void>() }));
vi.mock("@/stores/authStore", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useAuthStore: Object.assign((selector: (state: typeof auth.state) => unknown) => useSyncExternalStore(
    listener => { auth.listeners.add(listener); return () => { auth.listeners.delete(listener); }; },
    () => selector(auth.state), () => selector(auth.state)), { getState: () => auth.state }) };
});
import DeletionSupportProofControl from "./DeletionSupportProofControl";

const NOW = Date.parse("2026-09-13T09:00:00Z");
const CODE = `HBDEL1.e30.${"a".repeat(43)}`;
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
const writeText = vi.fn();
function result(overrides = {}) {
  return { proof: CODE, reference: "11111111-1111-4111-8111-111111111111", expiresAt: new Date(NOW + 86_400_000).toISOString(), ownerId: "owner-a", ...overrides };
}
function response(overrides = {}, status = 200) { return new Response(JSON.stringify(result(overrides)), { status, headers: { "content-type": "application/json" } }); }
function button(text: string) {
  const found = [...host.querySelectorAll("button")].find(item => item.textContent?.includes(text));
  expect(found).toBeDefined(); return found!;
}
async function mount(ownerId = "owner-a") { await act(async () => { root.render(<DeletionSupportProofControl ownerId={ownerId} />); }); }
async function click(text: string) { await act(async () => { button(text).click(); }); }
async function changeAuth(userId: string | null, isDemo = false) {
  await act(async () => { auth.state = { user: userId ? { id: userId } : null, isDemo }; auth.listeners.forEach(listener => listener()); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("navigator", { clipboard: { writeText } });
  fetchMock.mockReset().mockResolvedValue(response()); writeText.mockReset().mockResolvedValue(undefined);
  auth.state = { user: { id: "owner-a" }, isDemo: false }; auth.listeners.clear();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("deletion support identity UI", () => {
  it("issues only after a click, distinguishes identity from deletion, and copies without sending email", async () => {
    await mount(); expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("삭제되거나 요청이 접수되지는 않아요");
    await click("만들기");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/auth/delete/support-proof", expect.objectContaining({
      method: "POST", credentials: "same-origin", cache: "no-store", body: JSON.stringify({ intent: "support-identity-only" }),
    }));
    expect(host.textContent).not.toContain(CODE); await click("복사");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(`웨딩한방 탈퇴 문의 본인 확인 코드\n${CODE}`);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("복사했어요");
  });
  it("blocks duplicate issue clicks and ignores an aborted late response after account change", async () => {
    let finish: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>(resolve => { finish = resolve; }));
    await mount(); await click("만들기");
    expect(button("만드는 중").disabled).toBe(true);
    await act(async () => { button("만드는 중").click(); }); expect(fetchMock).toHaveBeenCalledOnce();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await changeAuth("owner-b");
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(response()); });
    expect(host.querySelector("button")).toBeNull(); expect(host.textContent).not.toContain(CODE);
  });
  it("hides a visible fallback code immediately on auth change and starts clean for the new owner", async () => {
    await mount(); await click("만들기"); writeText.mockRejectedValueOnce(new Error("denied")); await click("복사");
    expect(host.querySelector("textarea")?.value).toBe(CODE);
    await changeAuth("owner-b"); expect(host.querySelector("textarea")).toBeNull();
    await mount("owner-b"); expect(host.textContent).toContain("만들기"); expect(host.textContent).not.toContain("유효 기한");
  });
  it("provides a read-only fallback when the clipboard fails, without exposing raw failures", async () => {
    await mount(); await click("만들기"); writeText.mockRejectedValueOnce(new Error("private-browser-message")); await click("복사");
    const field = host.querySelector("textarea"); expect(field?.readOnly).toBe(true); expect(field?.value).toBe(CODE);
    expect(host.textContent).not.toContain("private-browser-message"); expect(host.textContent).not.toContain("복사했어요");
  });
  it("expires an open code, removes visible fallback, and permits a fresh request", async () => {
    await mount(); await click("만들기"); writeText.mockRejectedValueOnce(new Error("denied")); await click("복사");
    await act(async () => { vi.advanceTimersByTime(86_400_000); });
    expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).toContain("유효 기한이 지났어요");
    fetchMock.mockResolvedValue(response({ expiresAt: new Date(NOW + 2 * 86_400_000).toISOString() }));
    await click("만들기"); expect(fetchMock).toHaveBeenCalledTimes(2); expect(host.textContent).toContain("확인 코드 복사");
  });
  it("checks the clock before copying even when background timers have not run", async () => {
    await mount(); await click("만들기"); vi.setSystemTime(NOW + 86_400_000);
    await click("복사"); expect(writeText).not.toHaveBeenCalled(); expect(host.textContent).toContain("유효 기한이 지났어요");
  });
  it("clears an expired code when a suspended tab becomes active again", async () => {
    await mount(); await click("만들기"); vi.setSystemTime(NOW + 86_400_000);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(host.textContent).toContain("유효 기한이 지났어요"); expect(host.textContent).not.toContain("확인 코드 복사");
  });
  it("does not reveal an old code when an in-flight clipboard rejection arrives after switching accounts", async () => {
    let rejectCopy: (error: Error) => void = () => {};
    writeText.mockReturnValue(new Promise((_resolve, reject) => { rejectCopy = reject; }));
    await mount(); await click("만들기"); await click("복사"); await changeAuth("owner-b"); await mount("owner-b");
    await act(async () => { rejectCopy(new Error("permission denied")); });
    expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).toContain("만들기");
  });
  it.each([{ ownerId: "owner-b" }, { expiresAt: "invalid" }, { expiresAt: new Date(NOW).toISOString() }, { proof: "forged-response" }])("rejects wrong-owner, expired or malformed API responses: %j", async overrides => {
    fetchMock.mockResolvedValue(response(overrides)); await mount(); await click("만들기");
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain("확인 코드 복사");
  });
  it("does not show or issue a proof for demo or signed-out state", async () => {
    await changeAuth("owner-a", true); await mount(); expect(host.querySelector("button")).toBeNull();
    await changeAuth(null); expect(host.querySelector("button")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("aborts the request on timeout and shows only a generic retry message", async () => {
    fetchMock.mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("sensitive-transport-error")));
    }));
    await mount(); await click("만들기"); await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(button("만들기").disabled).toBe(false);
    expect(host.textContent).not.toContain("sensitive-transport-error");
  });
});
