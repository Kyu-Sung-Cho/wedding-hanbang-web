import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import TodayOnePreferenceControl, { __resetTodayOnePreferenceCacheForTests } from "./TodayOnePreferenceControl";
import { GET, PUT } from "@/app/api/amora/today-one/preferences/route";

const backend = vi.hoisted(() => ({ owner: "", enabled: false, writes: [] as string[] }));
vi.mock("@/lib/features/amoraCareFlags", () => ({ isAmoraTodayOneEnabled: () => true }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "synthetic-owner" }));
vi.mock("@/utils/trustedMutation", () => ({ isTrustedMutationRequest: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: backend.owner } } }) },
  from: (table: string) => {
    const q = { select: () => q, eq: () => q,
      single: async () => ({ data: table === "profiles" ? { couple_id: "63000000-0000-4000-8000-000000000003", role: "bride" } : { bride_id: backend.owner, groom_id: null }, error: null }),
      maybeSingle: async () => ({ data: { enabled: backend.enabled, opted_in_at: backend.enabled ? "2026-09-20T00:00:00Z" : null, paused_until: null, daily_limit: 1 }, error: null }),
    }; return q;
  },
  rpc: async (_name: string, values: { p_enabled: boolean }) => {
    backend.writes.push(backend.owner); backend.enabled = values.p_enabled;
    return { data: { enabled: backend.enabled, optedInAt: backend.enabled ? "2026-09-20T00:00:00Z" : null, pausedUntil: null, dailyLimit: 1 }, error: null };
  },
}) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = "61000000-0000-4000-8000-000000000001";
const B = "62000000-0000-4000-8000-000000000002";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const prior = useAuthStore.getState();
beforeEach(() => {
  backend.owner = A; backend.enabled = false; backend.writes.length = 0;
  __resetTodayOnePreferenceCacheForTests();
  useAuthStore.setState({ user: { id: A, email: "synthetic@example.invalid" } });
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request("https://hanbang.ai/api/amora/today-one/preferences", init);
    return init?.method === "PUT" ? PUT(request) : GET(request);
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); useAuthStore.setState(prior);
  __resetTodayOnePreferenceCacheForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("rejects an A-screen change before the B-authenticated API writes, and never shows B's preference", async () => {
  await act(async () => root.render(<TodayOnePreferenceControl />));
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]'); expect(toggle).toBeTruthy();
  backend.owner = B; backend.enabled = true;
  await act(async () => toggle!.click());
  expect(backend.writes).toEqual([]);
  expect(host.querySelector('[role="switch"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeTruthy();
});

it("loads and saves the same owner's preference through the real API", async () => {
  await act(async () => root.render(<TodayOnePreferenceControl />));
  expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(backend.writes).toEqual([A]);
  expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
});

it("does not display another owner's initial preference", async () => {
  backend.owner = B; backend.enabled = true;
  await act(async () => root.render(<TodayOnePreferenceControl />));
  expect(host.querySelector('[role="switch"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeTruthy();
  expect(backend.writes).toEqual([]);
});

it.each([undefined, null, "", B, 42, {}])("rejects missing, malformed or mismatched owners before writing: %j", async expectedOwnerId => {
  const result = await PUT(new Request("https://hanbang.ai/api/amora/today-one/preferences", {
    method: "PUT", body: JSON.stringify({ mode: "enable", expectedOwnerId }),
  }));
  expect(result.status).toBe(409);
  expect(backend.writes).toEqual([]);
  expect(await result.json()).toMatchObject({ code: "TODAY_ONE_OWNER_CHANGED" });
});

it.each([undefined, B])("rejects a missing or foreign owner in an otherwise valid read receipt: %s", async ownerId => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ available: true, ownerId,
    preference: { enabled: true, optedInAt: "2026-09-20T00:00:00Z", pausedUntil: null, dailyLimit: 1 },
  })));
  await act(async () => root.render(<TodayOnePreferenceControl />));
  expect(host.querySelector('[role="switch"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeTruthy();
});
