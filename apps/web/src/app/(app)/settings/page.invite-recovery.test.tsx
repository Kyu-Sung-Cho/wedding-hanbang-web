// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://hanbang.ai/settings" }
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { Couple, Profile } from "@/types/database.types";

vi.mock("@/components/app/TodayOnePreferenceControl", () => ({ default: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const OLD_CODE = "WH-A3F91B2C7D40";
const NEW_CODE = "WH-B3F91B2C7D40";
const payload = (inviteCode = OLD_CODE) => ({ inviteCode, isFullyLinked: false, isMembershipSealed: false });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let identity = 0;
describe("settings invite regeneration recovery", () => {
  let original: ReturnType<typeof useAuthStore.getState>;
  let root: Root;
  let container: HTMLDivElement;
  let post: ReturnType<typeof deferred<Response>>;
  let owner: string;
  let couple: Couple;
  let profile: Profile;
  const reissue = () => [...container.querySelectorAll("button")].find(button => /코드 재발급|재발급 중/.test(button.textContent ?? ""));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    original = useAuthStore.getState();
    owner = `10000000-0000-4000-8000-${String(++identity).padStart(12, "0")}`;
    couple = { id: `20000000-0000-4000-8000-${String(identity).padStart(12, "0")}`, bride_id: owner, groom_id: null,
      invite_code: OLD_CODE, membership_sealed_at: null, created_at: "2026-09-20", updated_at: "2026-09-20" };
    profile = { id: owner, name: "내 이름", role: "bride", couple_id: couple.id, avatar_url: null, onboarding_completed: true,
      onboarding_step: 9, is_admin: false, created_at: "2026-09-20", updated_at: "2026-09-20" };
    useAuthStore.setState({ user: { id: owner, email: "owner@example.invalid" }, profile, couple, partner: null, journey: null, isDemo: false });
    post = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/auth/me") return json({ user: { id: owner }, capabilities: { accountDeletionIntake: false } });
      if (String(url) === "/api/couple/code") return init?.method === "POST" ? post.promise : json(payload());
      throw new Error(`Unexpected request: ${String(url)}`);
    }));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    await act(async () => post.resolve(json(payload(NEW_CODE))));
    useAuthStore.setState(original); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
  });
  async function start() {
    await act(async () => root.render(<SettingsPage />));
    expect(container.textContent).toContain(OLD_CODE);
    await act(async () => reissue()!.click());
  }
  it.each(["http", "network", "body"])("actually rereads and restores the code after a %s failure", async failure => {
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === "/api/couple/code" && init?.method === "POST") {
        if (failure === "network") throw new Error("SYNTHETIC_NETWORK_FAILURE");
        return failure === "http" ? new Response(JSON.stringify(payload(NEW_CODE)), { status: 503 })
          : new Response("not-json", { status: 200 });
      }
      return fallback(url, init);
    });
    await start();
    const codeCalls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === "/api/couple/code");
    expect(codeCalls.filter(([, init]) => init?.method !== "POST").length).toBeGreaterThanOrEqual(2);
    expect(codeCalls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(container.textContent).toContain(OLD_CODE);
    expect(container.textContent).not.toContain(NEW_CODE);
    expect(container.textContent).toContain("현재 연결 상태를 다시 불러왔어요");
    expect(reissue()?.disabled).toBe(false);
  });
  it("ends a stalled regeneration wait at thirty seconds without claiming failure", async () => {
    await start();
    await act(async () => vi.advanceTimersByTimeAsync(30_001));
    expect(container.textContent).toContain("재발급 결과를 아직 확인하지 못했어요");
    expect(container.textContent).not.toContain("초대 코드를 다시 만들지 못했어요");
    expect(container.textContent).not.toContain("재발급 중...");
    expect(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.signal?.aborted).toBe(true);
  });
  it("does not authorize another regeneration from a GET while the original POST is pending, including remount", async () => {
    await start();
    await act(async () => vi.advanceTimersByTimeAsync(30_001));
    expect(container.textContent).toContain(OLD_CODE);
    expect(reissue()?.disabled).toBe(true);
    await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "현재 연결 상태 다시 확인")!.click());
    expect(reissue()?.disabled).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<SettingsPage />));
    expect(container.textContent).toContain("재발급 결과를 아직 확인하지 못했어요");
    expect(reissue()?.disabled).toBe(true);
    await act(async () => reissue()!.click());
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("rejects a late POST code after a same-tick account A to B to A transition", async () => {
    await start();
    await act(async () => {
      useAuthStore.setState({ user: { id: "other-owner", email: "other@example.invalid" }, profile: { ...profile, id: "other-owner" }, couple: null });
      useAuthStore.setState({ user: { id: owner, email: "owner@example.invalid" }, profile, couple });
    });
    await act(async () => post.resolve(json(payload(NEW_CODE))));
    expect(container.textContent).not.toContain(NEW_CODE);
    expect(container.textContent).toContain(OLD_CODE);
  });
  it("rechecks after a late POST settles during an older recovery GET body", async () => {
    await start();
    const oldBody = deferred<unknown>();
    const oldRead = json({}); vi.spyOn(oldRead, "json").mockReturnValue(oldBody.promise);
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    let reads = 0;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === "/api/couple/code" && init?.method !== "POST") return ++reads === 1 ? oldRead : json(payload("WH-C3F91B2C7D40"));
      return fallback(url, init);
    });
    await act(async () => vi.advanceTimersByTimeAsync(30_001));
    await act(async () => post.resolve(json(payload(NEW_CODE))));
    await act(async () => oldBody.resolve(payload(OLD_CODE)));
    expect(container.textContent).toContain("WH-C3F91B2C7D40");
    expect(container.textContent).not.toContain(OLD_CODE);
    expect(container.textContent).not.toContain(NEW_CODE);
    expect(reissue()?.disabled).toBe(false);
  });
  it("does not treat malformed HTTP 200 recovery data as a verified connection and offers retry", async () => {
    await start();
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    let valid = false;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === "/api/couple/code" && init?.method !== "POST") return json(valid ? payload(NEW_CODE) : { unrelated: true });
      return fallback(url, init);
    });
    await act(async () => post.resolve(new Response("not JSON", { status: 200 })));
    expect(container.textContent).toContain("연결 상태를 불러오지 못했어요");
    expect(container.textContent).not.toContain("현재 연결 상태를 다시 불러왔어요");
    expect(reissue()).toBeUndefined();
    valid = true;
    await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "현재 연결 상태 다시 확인")!.click());
    expect(container.textContent).toContain(NEW_CODE);
    expect(reissue()?.disabled).toBe(false);
  });
  it("reconciles an invalid POST receipt instead of silently losing the code", async () => {
    await start();
    await act(async () => post.resolve(json({ success: true })));
    expect(container.textContent).toContain(OLD_CODE);
    expect(container.textContent).toContain("조회 이후에도 앞선 요청이 늦게 반영될 수 있어요");
  });
  it("applies a valid response only to the unchanged owner and keeps the normal reissue path", async () => {
    await start();
    await act(async () => post.resolve(json(payload(NEW_CODE))));
    expect(container.textContent).toContain(NEW_CODE);
    expect(container.textContent).not.toContain(OLD_CODE);
    expect(container.textContent).not.toContain("재발급 결과를 아직 확인하지 못했어요");
    expect(reissue()?.disabled).toBe(false);
  });
  it("uses one thirty-second deadline for headers and a stalled POST body", async () => {
    await start();
    const body = deferred<unknown>();
    const response = json({}); vi.spyOn(response, "json").mockReturnValue(body.promise);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await act(async () => post.resolve(response));
    await act(async () => vi.advanceTimersByTimeAsync(10_001));
    expect(container.textContent).toContain("재발급 결과를 아직 확인하지 못했어요");
    expect(reissue()?.disabled).toBe(true);
    await act(async () => body.resolve(payload(NEW_CODE)));
    expect(container.textContent).not.toContain(NEW_CODE);
    expect(container.textContent).toContain(OLD_CODE);
    expect(reissue()?.disabled).toBe(false);
  });
  it.each(["owner", "couple"])("does not display an old POST code after the %s changes", async change => {
    await start();
    const nextOwner = change === "owner" ? "next-owner" : owner;
    const nextCouple = { ...couple, id: "next-couple", bride_id: nextOwner };
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === "/api/couple/code" && init?.method !== "POST") return json(payload("WH-C3F91B2C7D40"));
      return fallback(url, init);
    });
    await act(async () => useAuthStore.setState({ user: { id: nextOwner, email: "next@example.invalid" }, couple: nextCouple, profile: { ...profile, id: nextOwner, couple_id: nextCouple.id } }));
    await act(async () => post.resolve(json(payload(NEW_CODE))));
    expect(container.textContent).toContain("WH-C3F91B2C7D40");
    expect(container.textContent).not.toContain(NEW_CODE);
  });
  it("reconciles through the current mounted page after an unmounted request settles", async () => {
    await start();
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<SettingsPage />));
    expect(reissue()?.disabled).toBe(true);
    await act(async () => post.resolve(json(payload(NEW_CODE))));
    expect(container.textContent).not.toContain(NEW_CODE);
    expect(container.textContent).toContain(OLD_CODE);
    expect(reissue()?.disabled).toBe(false);
  });
  it("does not display raw API errors even when an error body contains a plausible code", async () => {
    await start();
    await act(async () => post.resolve(new Response(JSON.stringify({ ...payload(NEW_CODE), error: "PRIVATE_RAW_ERROR" }), { status: 500 })));
    expect(container.textContent).not.toContain("PRIVATE_RAW_ERROR");
    expect(container.textContent).not.toContain(NEW_CODE);
    expect(container.textContent).toContain(OLD_CODE);
    expect(container.textContent).toContain("조회 이후에도 앞선 요청이 늦게 반영될 수 있어요");
  });
  it("does not dispatch two POSTs for repeated clicks before React commits the busy state", async () => {
    await act(async () => root.render(<SettingsPage />));
    const button = reissue()!;
    await act(async () => { button.click(); button.click(); });
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(reissue()?.disabled).toBe(true);
  });
  it("does not let an older GET overwrite a normal successful POST after a same-owner refresh", async () => {
    await start();
    const oldBody = deferred<unknown>();
    const oldRead = json({}); vi.spyOn(oldRead, "json").mockReturnValue(oldBody.promise);
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === "/api/couple/code" && init?.method !== "POST") return oldRead;
      return fallback(url, init);
    });
    await act(async () => useAuthStore.setState({ couple: { ...couple } }));
    await act(async () => post.resolve(json(payload(NEW_CODE))));
    expect(container.textContent).toContain(NEW_CODE);
    await act(async () => oldBody.resolve(payload(OLD_CODE)));
    expect(container.textContent).toContain(NEW_CODE);
    expect(container.textContent).not.toContain(OLD_CODE);
  });
});
