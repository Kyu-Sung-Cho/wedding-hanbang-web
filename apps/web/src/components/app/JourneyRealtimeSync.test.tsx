import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  return { channel, createChannel: vi.fn(() => channel), removeChannel: vi.fn(), pathname: "/budget" };
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ channel: mocks.createChannel, removeChannel: mocks.removeChannel }) }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
import { useAuthStore } from "@/stores/authStore";
import type { Couple, Profile, WeddingJourney } from "@/types/database.types";
import BudgetContent from "./budget/BudgetContent";
import BudgetTab from "./chat/panel/BudgetTab";
import JourneyRealtimeSync from "./JourneyRealtimeSync";
const scope = (owner = "user-a", couple = "couple-a") => ({
  user: { id: owner, email: `${owner}@test.invalid` },
  profile: { id: owner, couple_id: couple, role: "bride", name: owner } as Profile,
  couple: { id: couple } as Couple, partner: null,
  journey: { id: `journey-${couple}`, couple_id: couple, total_budget: 25_000_000, state_revision: 0,
    wedding_date: null, venue: null, created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
    progress: { venue: { category: "venue", status: "in_progress", budget: 9_000_000, spent: 10_001 }, reserve: { category: "reserve", status: "not_started", budget: 100_000 } },
  } as WeddingJourney, isDemo: false, isInitialized: true, isLoading: false,
});
const response = (data: ReturnType<typeof scope>) => ({ ok: true, json: async () => data });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
describe("JourneyRealtimeSync", () => {
  const original = useAuthStore.getState();
  let container: HTMLDivElement; let root: Root; let server: ReturnType<typeof scope>;
  const fetchMock = vi.fn();
  const render = async (withBudget = false) => { await act(async () => root.render(<><JourneyRealtimeSync />{withBudget && <BudgetContent />}</>)); };
  const renderChatBudget = async () => { await act(async () => root.render(<><JourneyRealtimeSync /><BudgetTab /></>)); };
  const tick = async (ms = 10_000) => { await act(async () => vi.advanceTimersByTimeAsync(ms)); };
  const event = async (name: string, target: Window | Document = window) => { await act(async () => target.dispatchEvent(new Event(name))); };
  const handler = (table: string) => mocks.channel.on.mock.calls.find(call => call[1].table === table)?.[2] as () => void;
  const status = async (value: string) => {
    const callback = mocks.channel.subscribe.mock.calls.at(-1)?.[0] as ((value: string) => void) | undefined;
    expect(callback, "subscription recovery callback").toBeTypeOf("function");
    await act(async () => callback!(value));
  };
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    mocks.channel.on.mockReturnValue(mocks.channel); mocks.channel.subscribe.mockReturnValue(mocks.channel); mocks.pathname = "/budget";
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    server = scope(); useAuthStore.setState(server);
    fetchMock.mockReset().mockImplementation(async () => response(server)); vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); useAuthStore.setState(original);
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  it.each(["wedding_journeys", "couples"])("refetches canonical data for the exact %s subscription", async table => {
    await render(); expect(mocks.createChannel).toHaveBeenCalledWith("web-journey-sync:couple-a:user-a");
    expect(mocks.channel.on).toHaveBeenCalledWith("postgres_changes", { event: "UPDATE", schema: "public", table,
      filter: table === "couples" ? "id=eq.couple-a" : "couple_id=eq.couple-a" }, expect.any(Function));
    server = { ...server, journey: { ...server.journey, total_budget: 35_000_000, state_revision: 1 } };
    await act(async () => handler(table)()); expect(useAuthStore.getState().journey?.total_budget).toBe(35_000_000);
  });
  it.each(["/budget", "/wedding/budget"])("updates the already-open %s within ten seconds when every realtime event is lost", async (pathname) => {
    mocks.pathname = pathname;
    await render(true);
    server = { ...server, journey: { ...server.journey, total_budget: 35_000_000, state_revision: 1,
      progress: { ...server.journey.progress, venue: { ...server.journey.progress.venue, budget: 9_500_000 }, reserve: { ...server.journey.progress.reserve, budget: 0 } } } };
    await tick();
    expect(container.textContent).toContain("3,500");
    expect(container.querySelector('button[title="결혼식장 예산 수정"]')?.textContent).toContain("950");
    expect(container.querySelector('button[title="결혼식장 기록 지출 수정"]')?.textContent).toContain("10,001원");
    expect(useAuthStore.getState().journey?.progress.reserve.budget).toBe(0);
    expect(fetchMock.mock.calls.every(call => call[0] === "/api/auth/me" && !call[1]?.method)).toBe(true);
  });
  it("keeps an open amount draft while canonical amounts refresh underneath it", async () => {
    await render(true); await act(async () => container.querySelector<HTMLButtonElement>('button[title="총 예산 수정"]')!.click());
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, "4123.4567"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    server = { ...server, journey: { ...server.journey, total_budget: 35_000_000, state_revision: 1 } };
    await tick(); expect(useAuthStore.getState().journey?.total_budget).toBe(35_000_000);
    expect(container.querySelector("input")).toBe(input); expect(input.value).toBe("4123.4567");
  });
  it.each(["/budget", "/wedding/budget"])("recovers a missed subscription window and backs off healthy %s polling to ten seconds", async (pathname) => {
    mocks.pathname = pathname;
    await render(); server = { ...server, journey: { ...server.journey, total_budget: 36_000_000 } };
    await status("SUBSCRIBED"); expect(useAuthStore.getState().journey?.total_budget).toBe(36_000_000);
    fetchMock.mockClear(); await tick(9_999); expect(fetchMock).not.toHaveBeenCalled(); await tick(1); expect(fetchMock).toHaveBeenCalledTimes(1);
    await status("CHANNEL_ERROR"); fetchMock.mockClear(); await tick(5_000); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("pauses hidden/offline polling and refreshes on foreground, online and bfcache return", async () => {
    await render(); fetchMock.mockClear();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); await event("visibilitychange", document); await tick(30_000); expect(fetchMock).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); await event("visibilitychange", document); expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false); await event("offline"); fetchMock.mockClear(); await tick(30_000); expect(fetchMock).not.toHaveBeenCalled();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); await event("online"); expect(fetchMock).toHaveBeenCalledTimes(1);
    await event("pageshow"); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["/settings", "/wedding/settings", "/wedding-code"])("does not poll unrelated %s or demo sessions", async (pathname) => {
    mocks.pathname = pathname; await render(); await status("SUBSCRIBED"); fetchMock.mockClear(); await tick(60_000); expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => useAuthStore.setState({ isDemo: true })); await event("online"); await tick(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("coalesces an event burst during a read into one trailing read", async () => {
    await render(); fetchMock.mockClear(); const pending = deferred<ReturnType<typeof response>>(); fetchMock.mockImplementationOnce(() => pending.promise);
    await act(async () => { handler("wedding_journeys")(); handler("couples")(); handler("wedding_journeys")(); }); expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(response(server))); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not send old callbacks into a returned A owner after a batched A-B-A switch", async () => {
    await render(); const oldHandler = handler("wedding_journeys");
    await act(async () => { useAuthStore.setState(scope("user-b", "couple-b")); useAuthStore.setState(scope()); });
    fetchMock.mockClear(); await act(async () => oldHandler()); expect(fetchMock).not.toHaveBeenCalled(); await tick(); expect(fetchMock).toHaveBeenCalled();
  });
  it("aborts a disposed read and refuses a late response even if fetch ignores abort", async () => {
    await render(); const pending = deferred<ReturnType<typeof response>>(); fetchMock.mockImplementationOnce(() => pending.promise);
    await act(async () => handler("wedding_journeys")()); const signal = fetchMock.mock.calls.at(-1)?.[1]?.signal as AbortSignal | undefined;
    await act(async () => root.render(null)); expect(signal?.aborted).toBe(true); const before = useAuthStore.getState().journey;
    await act(async () => pending.resolve(response({ ...server, journey: { ...server.journey, total_budget: 1 } }))); expect(useAuthStore.getState().journey).toBe(before);
    fetchMock.mockClear(); await tick(); expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channel);
  });
  it("times out a stalled read and recovers on a subsequent poll", async () => {
    await render(); fetchMock.mockClear();
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    await act(async () => handler("wedding_journeys")()); await tick(20_000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true); expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
  it("does not roll back a newer same-journey receipt with an older in-flight read", async () => {
    await render(); const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    await act(async () => handler("wedding_journeys")());
    const newer = { ...server.journey, state_revision: 2, total_budget: 38_000_000 };
    await act(async () => useAuthStore.setState({ journey: newer }));
    await act(async () => pending.resolve(response(server)));
    expect(useAuthStore.getState().journey).toBe(newer);
  });
  it.each(["another-owner", "same-owner-another-couple"])("refuses a late response after %s replaces the subscription", async mode => {
    await render(); const oldHandler = handler("wedding_journeys"); const oldServer = server;
    const pending = deferred<ReturnType<typeof response>>(); fetchMock.mockImplementationOnce(() => pending.promise);
    await act(async () => oldHandler());
    server = scope(mode === "another-owner" ? "user-b" : "user-a", "couple-b");
    await act(async () => useAuthStore.setState(server));
    await act(async () => pending.resolve(response(oldServer)));
    expect(useAuthStore.getState().journey?.couple_id).toBe("couple-b");
    fetchMock.mockClear(); await act(async () => oldHandler()); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["/chat", "/wedding/chat"])("refreshes the mounted %s budget panel after thirty seconds with no realtime events", async pathname => {
    mocks.pathname = pathname;
    await renderChatBudget(); await status("SUBSCRIBED");
    expect(container.textContent).toContain("총 예산2,500만원");
    expect(container.textContent).toContain("배정 900만원");
    fetchMock.mockClear();
    server = { ...server, journey: { ...server.journey, total_budget: 35_000_000, state_revision: 1,
      progress: { ...server.journey.progress, venue: { ...server.journey.progress.venue, budget: 9_500_000 } } } };
    // No postgres_changes, resume or remount: even a healthy subscription can lose every event.
    await tick(29_999);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("총 예산2,500만원");
    expect(container.textContent).toContain("배정 900만원");
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("총 예산3,500만원");
    expect(container.textContent).toContain("배정 950만원");
    expect(container.textContent).toContain("기록 10,001원");
    expect(fetchMock.mock.calls.every(call => call[0] === "/api/auth/me" && !call[1]?.method)).toBe(true);
  });
  it.each(["/chat", "/wedding/chat"])("pauses %s panel refresh while hidden or offline and reads on resume", async pathname => {
    mocks.pathname = pathname;
    await renderChatBudget(); await status("SUBSCRIBED"); fetchMock.mockClear();
    server = { ...server, journey: { ...server.journey, total_budget: 36_000_000, state_revision: 1 } };
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await event("visibilitychange", document); await tick(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("총 예산2,500만원");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await event("visibilitychange", document);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("총 예산3,600만원");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await event("offline"); fetchMock.mockClear();
    server = { ...server, journey: { ...server.journey, total_budget: 37_000_000, state_revision: 2 } };
    await tick(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("총 예산3,600만원");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); await event("online");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("총 예산3,700만원");
  });
  it.each(["/chat", "/wedding/chat"])("does not poll a %s demo panel or revive its previous subscription", async pathname => {
    mocks.pathname = pathname;
    useAuthStore.setState({ isDemo: true });
    await renderChatBudget(); await tick(60_000);
    expect(mocks.createChannel).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => useAuthStore.setState({ isDemo: false }));
    await status("SUBSCRIBED"); const oldHandler = handler("wedding_journeys");
    await act(async () => useAuthStore.setState({ isDemo: true }));
    fetchMock.mockClear();
    await act(async () => oldHandler()); await event("online"); await tick(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channel);
  });
  it.each(["/chat", "/wedding/chat"].flatMap(pathname =>
    ["another-owner", "same-owner-another-couple"].map(mode => ({ pathname, mode })),
  ))("aborts the old $pathname panel poll when its owner changes: $mode", async ({ pathname, mode }) => {
    mocks.pathname = pathname;
    await renderChatBudget(); await status("SUBSCRIBED");
    const oldHandler = handler("wedding_journeys");
    const oldServer = { ...server, journey: { ...server.journey, total_budget: 35_000_000, state_revision: 1 } };
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    await tick(30_000);
    const signal = fetchMock.mock.calls.at(-1)?.[1]?.signal as AbortSignal | undefined;
    const next = scope(mode === "another-owner" ? "user-b" : "user-a", "couple-b");
    server = { ...next, journey: { ...next.journey, total_budget: 42_000_000, state_revision: 2 } };
    await act(async () => useAuthStore.setState(server));
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(response(oldServer)));
    expect(useAuthStore.getState().journey?.couple_id).toBe("couple-b");
    expect(container.textContent).toContain("총 예산4,200만원");
    expect(container.textContent).not.toContain("총 예산3,500만원");
    fetchMock.mockClear(); await act(async () => oldHandler()); expect(fetchMock).not.toHaveBeenCalled();
    await tick(30_000); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retries failed reads without blanking the current budget or claiming a saved change", async () => {
    await render(true); const before = useAuthStore.getState().journey;
    fetchMock.mockResolvedValueOnce({ ok: false });
    await act(async () => handler("wedding_journeys")());
    expect(useAuthStore.getState().journey).toBe(before);
    expect(container.textContent).not.toContain("변경 내용을 저장했어요");
    server = { ...server, journey: { ...server.journey, total_budget: 36_000_000, state_revision: 1 } };
    await tick(); expect(useAuthStore.getState().journey?.total_budget).toBe(36_000_000);
  });
});
