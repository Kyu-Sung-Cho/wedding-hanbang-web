// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "11111111-1111-4111-8111-111111111111";
const ID = "act_single_qa";
const TOKEN = "2026-10-12T00:00:00.123456Z";
const row = () => ({ id: ID, couple_id: COUPLE, title: "합성 단일 항목", priority: "medium", status: "open", source: "manual", created_at: TOKEN, updated_at: TOKEN });
const legacy = () => ({ id: ID, title: "합성 단일 항목", priority: "medium", status: "open", source: "manual", createdAt: TOKEN, updatedAt: TOKEN });
const state = vi.hoisted(() => ({ client: null as unknown, user: true, couple: "", canonical: null as unknown, journey: null as unknown,
  canonicalError: null as unknown, journeyError: null as unknown, requests: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => state.client }));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
beforeEach(() => {
  state.user = true; state.couple = COUPLE; state.canonical = row(); state.journey = { progress: { __amora_actions: [legacy()] } };
  state.canonicalError = null; state.journeyError = null; state.requests = [];
  const client = createClient("http://127.0.0.1:55432", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const request = new Request(input, init); const url = new URL(request.url); const table = url.pathname.split("/").at(-1)!;
    expect(request.method).toBe("GET"); state.requests.push(table);
    if (table === "profiles") return response({ couple_id: state.couple });
    expect(url.searchParams.get("couple_id")).toBe(`eq.${COUPLE}`);
    if (table === "amora_actions") { expect(url.searchParams.get("id")).toBe(`eq.${ID}`); return response(state.canonicalError ?? state.canonical, state.canonicalError ? 500 : 200); }
    if (table === "wedding_journeys") return response(state.journeyError ?? state.journey, state.journeyError ? 500 : 200);
    throw new Error("Single-card recovery must not call any write RPC");
  } } });
  vi.spyOn(client.auth, "getUser").mockImplementation(async () => ({ data: { user: state.user ? { id: OWNER } : null }, error: null } as never));
  state.client = client;
});
async function get() { const { GET } = await import("../route"); return GET(new Request(`https://hanbang.ai/api/amora/actions/${ID}`), { params: Promise.resolve({ id: ID }) }); }
describe("one exact current action for explicit edit recovery", () => {
  it("reads canonical authority and returns only a no-store DTO", async () => {
    state.canonical = { ...row(), metadata: { PRIVATE_DETAIL: "not public" }, created_by: OWNER };
    const result = await get(); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
    const body = await result.json(); expect(body).toMatchObject({ action: { id: ID, viewVersion: TOKEN } }); expect(JSON.stringify(body)).not.toContain("PRIVATE_DETAIL");
    expect(state.requests).toEqual(["profiles", "amora_actions"]);
  });
  it("uses only a genuinely absent canonical row to read the legacy card", async () => {
    state.canonical = null; const result = await get(); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ action: { viewVersion: TOKEN } });
  });
  it.each(["42P01", "PGRST205", "42501"])("does not treat canonical %s failure as permission to read legacy", async code => {
    state.canonicalError = { code, message: "PRIVATE_DATABASE" }; const result = await get(); expect(result.status).toBe(code === "42501" ? 403 : 503);
    expect(await result.json()).not.toHaveProperty("action"); expect(state.requests).toEqual(["profiles", "amora_actions"]);
  });
  it("returns 404 only for an exact absent record", async () => { state.canonical = null; state.journey = { progress: {} }; expect((await get()).status).toBe(404); });
  it("requires authentication without revealing any records", async () => { state.user = false; expect((await get()).status).toBe(401); expect(state.requests).toEqual([]); });
  it.each([undefined, "infinity", "2026-02-30T00:00:00Z"])("does not invent a token for a malformed canonical version %j", async updated_at => {
    state.canonical = { ...row(), updated_at }; const result = await get(); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ action: { viewVersion: null } });
  });
  it.each([{ progress: null }, { progress: { __amora_actions: {} } }, { progress: { __amora_actions: [legacy(), legacy()] } },
    { progress: { __amora_actions: [{ ...legacy(), source: null }] } }])("fails closed for malformed or ambiguous legacy storage: %j", async journey => {
    state.canonical = null; state.journey = journey; const result = await get(); expect(result.status).toBe(503); expect(await result.json()).not.toHaveProperty("action");
  });
  it("does not expose a foreign-couple receipt even when the transport lies", async () => { state.canonical = { ...row(), couple_id: OWNER }; expect((await get()).status).toBe(503); });
  it("drops an unsafe stored link and marks the view unversioned", async () => { state.canonical = { ...row(), href: "/\\evil.invalid" }; const result = await get(); const body = await result.json(); expect(body.action.href).toBeUndefined(); expect(body.action.viewVersion).toBeNull(); });
});
