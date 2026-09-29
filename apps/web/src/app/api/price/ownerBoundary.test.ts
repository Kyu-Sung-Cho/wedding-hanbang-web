// @vitest-environment node
import { NextRequest } from "next/server";
import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET as favoritesGet, POST as favoritesPost, DELETE as favoritesDelete } from "../favorites/route";
import { GET as combosGet, POST as combosPost } from "./combos/route";
import { GET as alertsGet, POST as alertsPost, DELETE as alertsDelete } from "./alerts/route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/memory/record-decision", () => ({ recordDecision: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: vi.fn(() => null), rateLimitKey: vi.fn(() => "owner-test") }));

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const mutations = [
  { name: "favorites add", handler: favoritesPost, method: "POST" },
  { name: "favorites remove", handler: favoritesDelete, method: "DELETE" },
  { name: "combos save", handler: combosPost, method: "POST" },
  { name: "alerts add", handler: alertsPost, method: "POST" },
  { name: "alerts remove", handler: alertsDelete, method: "DELETE" },
];
const endpoints = [...mutations,
  { name: "favorites read", handler: favoritesGet, method: "GET" },
  { name: "combos read", handler: combosGet, method: "GET" },
  { name: "alerts read", handler: alertsGet, method: "GET" },
];
function request(method: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/price", {
    method, headers: { Origin: "http://localhost", "Content-Type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: "{}" }),
  });
}
function mockAuth(error: unknown = null, throws = false) {
  const from = vi.fn(), rpc = vi.fn();
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: { getUser: throws ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue({ data: { user: error ? null : { id: OWNER } }, error }) }, from, rpc,
  } as never);
  return { from, rpc };
}

beforeEach(() => { vi.clearAllMocks(); });
describe.each(mutations)("$name expected owner", ({ handler, method }) => {
  it.each<Record<string, string>>([
    {}, { "X-Price-Expected-Owner": OTHER }, { "X-Price-Expected-Owner": "invalid" },
    { Authorization: "Bearer native-token", "X-Price-Expected-Owner": OTHER },
  ])("rejects stale or absent cookie ownership before touching data: %j", async headers => {
    const { from, rpc } = mockAuth();
    const response = await handler(request(method, headers));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PRICE_ACCOUNT_CHANGED" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); expect(createAdminClient).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { "X-Price-Expected-Owner": OWNER }, { "X-Price-Expected-Owner": OWNER.toUpperCase() },
    { Authorization: "Bearer native-token" }, { Authorization: "Bearer native-token", "X-Price-Expected-Owner": OWNER },
  ])("preserves current owner and native compatibility through payload validation: %j", async headers => {
    mockAuth();
    const response = await handler(request(method, headers));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
describe.each(endpoints)("$name authentication", ({ handler, method }) => {
  it.each([
    { error: new AuthApiError("outage", 503, "unexpected_failure"), status: 503, throws: false },
    { error: new AuthApiError("rate limited", 429, "over_request_rate_limit"), status: 503, throws: false },
    { error: new Error("transport"), status: 503, throws: true },
    { error: new AuthSessionMissingError(), status: 401, throws: false },
  ])("fails closed with $status and no data access", async ({ error, status, throws }) => {
    const { from, rpc } = mockAuth(error, throws);
    const response = await handler(request(method, { "X-Price-Expected-Owner": OWNER }));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); expect(createAdminClient).not.toHaveBeenCalled();
  });
});
