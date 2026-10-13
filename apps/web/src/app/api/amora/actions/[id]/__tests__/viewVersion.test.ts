// @vitest-environment node

import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "act_version_qa";
const VIEW_TOKEN = "2026-10-12T01:02:03.123456Z";
const SAVED_TOKEN = "2026-10-12T01:02:03.123457Z";
function savedReceipt() { return { id: ACTION_ID, couple_id: COUPLE_ID, title: "합성 준비 항목", status: "done", priority: "medium", source: "manual",
  created_at: VIEW_TOKEN, updated_at: SAVED_TOKEN, completed_at: SAVED_TOKEN }; }
const state = vi.hoisted(() => ({ client: null as unknown, rpcRequests: [] as Array<{ name: string; values: Record<string, unknown> }>,
  rpcError: null as { code: string; message: string } | null, overrideReceipt: false, receipt: null as unknown,
  currentOwnerId: "", currentCoupleId: "", lostResponse: false }));

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => state.client }));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));

function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  state.rpcRequests = [];
  state.rpcError = null; state.overrideReceipt = false; state.receipt = null;
  state.currentOwnerId = OWNER_ID; state.currentCoupleId = COUPLE_ID;
  state.lostResponse = false;
  const client = createClient("http://127.0.0.1:55431", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      const name = new URL(request.url).pathname.split("/").at(-1)!;
      if (name === "profiles") return reply({ couple_id: state.currentCoupleId });
      if (request.method !== "POST") throw new Error("A checked edit must not read a replacement token or write a table directly");
      const values: Record<string, unknown> = await request.json();
      state.rpcRequests.push({ name, values });
      if (state.lostResponse) throw new Error("SYNTHETIC_PRIVATE_LOST_RESPONSE");
      if (state.rpcError) return reply(state.rpcError, 400);
      if (state.overrideReceipt) return reply(state.receipt);
      return reply(savedReceipt());
    } },
  });
  vi.spyOn(client.auth, "getUser").mockImplementation(async () => ({ data: { user: { id: state.currentOwnerId } }, error: null } as never));
  state.client = client;
});

async function patch(fields: Record<string, unknown>) {
  const { PATCH } = await import("../route");
  return PATCH(new Request(`https://hanbang.ai/api/amora/actions/${ACTION_ID}`, {
    method: "PATCH", headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
    body: JSON.stringify({ status: "done", expectedOwnerId: OWNER_ID, expectedCoupleId: COUPLE_ID, ...fields }),
  }), { params: Promise.resolve({ id: ACTION_ID }) });
}

describe("the exact action view version is required", () => {
  it.each(["description", "due_date", "category_key"])("rejects an invalid %s instead of silently clearing stored text", async field => {
    for (const value of [42, false, [], {}]) {
      const response = await patch({ expectedUpdatedAt: VIEW_TOKEN, [field]: value });
      expect(response.status).toBe(400);
      expect(state.rpcRequests).toEqual([]);
    }
  });
  it.each(["description", "due_date", "category_key"])("still permits explicitly clearing %s with null or empty text", async field => {
    for (const value of [null, ""]) {
      state.overrideReceipt = true;
      state.receipt = { ...savedReceipt(), [field]: null };
      const response = await patch({ expectedUpdatedAt: VIEW_TOKEN, [field]: value });
      expect(response.status).toBe(200);
      expect(state.rpcRequests.at(-1)?.values.p_values).toMatchObject({ status: "done", [field]: null });
    }
  });
  it("counts the actual request bytes even without a Content-Length header", async () => {
    const { PATCH } = await import("../route");
    const response = await PATCH(new Request(`https://hanbang.ai/api/amora/actions/${ACTION_ID}`, {
      method: "PATCH", headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
      body: JSON.stringify({ status: "done", expectedOwnerId: OWNER_ID, expectedCoupleId: COUPLE_ID,
        expectedUpdatedAt: VIEW_TOKEN, unrelatedText: "가".repeat(24 * 1024) }),
    }), { params: Promise.resolve({ id: ACTION_ID }) });
    expect(response.status).toBe(413);
    expect(state.rpcRequests).toEqual([]);
  });
  it("rejects malformed JSON without a mutation or a generic server error", async () => {
    const { PATCH } = await import("../route");
    const response = await PATCH(new Request(`https://hanbang.ai/api/amora/actions/${ACTION_ID}`, {
      method: "PATCH", headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
      body: '{"status":',
    }), { params: Promise.resolve({ id: ACTION_ID }) });
    expect(response.status).toBe(400);
    expect(state.rpcRequests).toEqual([]);
  });
  it("rejects invalid UTF-8 without a write", async () => {
    const { PATCH } = await import("../route");
    const response = await PATCH(new Request(`https://hanbang.ai/api/amora/actions/${ACTION_ID}`, {
      method: "PATCH", headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
      body: new Uint8Array([0xff, 0xfe]),
    }), { params: Promise.resolve({ id: ACTION_ID }) });
    expect(response.status).toBe(400);
    expect(state.rpcRequests).toEqual([]);
  });
  it("rejects a tokenless edit instead of supplying the current server version", async () => {
    const response = await patch({});
    expect(response.status).toBe(428);
    expect(await response.json()).toMatchObject({ code: "AMORA_ACTION_VERSION_REQUIRED" });
    expect(state.rpcRequests).toEqual([]);
  });
  it.each([null, 1, "", ` ${VIEW_TOKEN}`, `${VIEW_TOKEN} `, "infinity", "2026-02-30T01:02:03Z", "0000-01-01T00:00:00Z", "2026-10-12T01:02:03.1234567Z", "2026-10-12", "2026-10-12T01:02:03+16:00"])("rejects malformed view token %j without a write", async expectedUpdatedAt => {
    const response = await patch({ expectedUpdatedAt });
    expect(response.status).toBe(428);
    expect(await response.json()).toMatchObject({ code: "AMORA_ACTION_VERSION_REQUIRED" });
    expect(state.rpcRequests).toEqual([]);
  });
  it("uses only the storage-aware checked RPC and preserves both raw microsecond tokens", async () => {
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: { id: ACTION_ID, status: "done", updatedAt: SAVED_TOKEN } });
    expect(state.rpcRequests).toEqual([{ name: "patch_own_amora_action_view_v2", values: {
      p_couple_id: COUPLE_ID, p_action_id: ACTION_ID, p_expected_updated_at: VIEW_TOKEN, p_values: { status: "done" },
    } }]);
  });
  it.each([
    ["40001", 409, "AMORA_ACTION_CONFLICT"], ["42501", 403, "AMORA_ACTION_SCOPE_DENIED"],
    ["PGRST202", 503, "AMORA_ACTION_UNAVAILABLE"], ["42883", 503, "AMORA_ACTION_UNAVAILABLE"],
    ["42P01", 503, "AMORA_ACTION_UNAVAILABLE"], ["55000", 503, "AMORA_ACTION_UNAVAILABLE"],
    ["55P03", 503, "AMORA_ACTION_UNAVAILABLE"], ["40P01", 503, "AMORA_ACTION_UNAVAILABLE"],
    ["57014", 503, "AMORA_ACTION_UNAVAILABLE"], ["22023", 400, "AMORA_ACTION_INVALID_INPUT"],
  ])("returns a safe %s failure without a versionless or legacy retry", async (code, status, publicCode) => {
    state.rpcError = { code: String(code), message: "SYNTHETIC_PRIVATE_DATABASE_DETAIL" };
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ code: publicCode });
    expect(body).not.toHaveProperty("action");
    expect(JSON.stringify(body)).not.toContain("SYNTHETIC_PRIVATE_DATABASE_DETAIL");
    expect(state.rpcRequests).toHaveLength(1);
    expect(state.rpcRequests[0].name).toBe("patch_own_amora_action_view_v2");
  });
  it.each([
    false, [], {}, { id: "act_foreign" }, { couple_id: OWNER_ID }, { title: "" }, { title: 4 },
    { priority: "urgent" }, { status: "later" }, { source: "fictional" }, { source: null },
    { updated_at: null }, { updated_at: VIEW_TOKEN }, { updated_at: "2026-10-12T01:02:03.123455Z" },
    { updated_at: "2026-02-30T01:02:03Z" }, { description: {} }, { due_date: false }, { href: "//unsafe.invalid" },
    { completed_at: "now" }, { created_at: "infinity" },
  ].map(value => [value]))("does not turn an invalid storage receipt into success: %j", async changes => {
    state.overrideReceipt = true;
    state.receipt = typeof changes === "object" && !Array.isArray(changes) && Object.keys(changes).length > 0 ? { ...savedReceipt(), ...changes } : changes;
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AMORA_ACTION_UNAVAILABLE" });
    expect(state.rpcRequests).toHaveLength(1);
  });
  it("rejects a well-typed receipt that did not save the approved change", async () => {
    state.overrideReceipt = true;
    state.receipt = { ...savedReceipt(), status: "open" };
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("action");
    expect(state.rpcRequests).toHaveLength(1);
  });
  it("returns not-found only for an explicit null receipt and never falls back", async () => {
    state.overrideReceipt = true; state.receipt = null;
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("action");
    expect(state.rpcRequests).toHaveLength(1);
  });
  it.each(["2026-10-12T01:02:03Z", "2026-10-12T01:02:03.1Z", "2026-10-12T01:02:03.12Z", "2026-10-12T01:02:03.123Z",
    "2026-10-12T01:02:03.1234Z", "2026-10-12T01:02:03.12345Z", VIEW_TOKEN, "2026-10-12T10:02:03.123456+09:00"])("passes valid raw version %s unchanged", async expectedUpdatedAt => {
    const response = await patch({ expectedUpdatedAt });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: { viewVersion: SAVED_TOKEN } });
    expect(state.rpcRequests[0].values.p_expected_updated_at).toBe(expectedUpdatedAt);
  });
  it("accepts a legacy receipt with missing creation time without inventing a view token", async () => {
    state.overrideReceipt = true; state.receipt = { ...savedReceipt(), created_at: null };
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: { createdAt: "1970-01-01T00:00:00.000Z", viewVersion: SAVED_TOKEN } });
  });
  it("returns only action DTO fields instead of leaking unrelated canonical metadata", async () => {
    state.overrideReceipt = true; state.receipt = { ...savedReceipt(), metadata: { SYNTHETIC_PRIVATE: "not public" }, created_by: OWNER_ID };
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("SYNTHETIC_PRIVATE");
  });
  it("accepts valid PostgreSQL character limits without confusing emoji bytes or UTF-16 units", async () => {
    state.overrideReceipt = true; state.receipt = { ...savedReceipt(), title: "💐".repeat(120), description: "💐".repeat(500) };
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(200);
  });
  it.each([{ expectedOwnerId: undefined }, { expectedCoupleId: undefined }, { expectedOwnerId: COUPLE_ID },
    { expectedCoupleId: "malformed" }, { expectedCoupleId: 1 }, { expectedOwnerId: null }])("requires the view's owner and couple before a write: %j", async scope => {
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN, ...scope });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "AMORA_ACTION_SCOPE_DENIED" });
    expect(state.rpcRequests).toEqual([]);
  });
  it.each(["owner", "couple"])("rejects an old edit when the current %s changes even if the action token matches", async binding => {
    if (binding === "owner") state.currentOwnerId = "33333333-3333-4333-8333-333333333333";
    else state.currentCoupleId = "33333333-3333-4333-8333-333333333333";
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "AMORA_ACTION_SCOPE_DENIED" });
    expect(state.rpcRequests).toEqual([]);
  });
  it("does not blindly retry a lost storage response or claim that an unknown outcome saved", async () => {
    state.lostResponse = true;
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).not.toHaveProperty("action");
    expect(JSON.stringify(body)).not.toContain("SYNTHETIC_PRIVATE_LOST_RESPONSE");
    expect(state.rpcRequests).toHaveLength(1);
  });
  it.each(["/\\evil.invalid", "//evil.invalid", "https://evil.invalid", "/wedding/\tchecklist", {}, 4])("rejects malformed href %j without silently saving the other fields", async href => {
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN, href });
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("action");
    expect(state.rpcRequests).toEqual([]);
  });
  it("rejects an unsafe href in the storage receipt without exposing a clickable DTO link", async () => {
    state.overrideReceipt = true; state.receipt = { ...savedReceipt(), href: "/\\evil.invalid" };
    const response = await patch({ expectedUpdatedAt: VIEW_TOKEN });
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("action");
  });
  it.each(["/\\evil.invalid", "//evil.invalid", "https://evil.invalid", "/wedding/\tchecklist", {}, 4])("rejects malformed href %j before creating an otherwise valid action", async href => {
    const { POST } = await import("../../route");
    const response = await POST(new Request("https://hanbang.ai/api/amora/actions", { method: "POST",
      headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
      body: JSON.stringify({ title: "합성 생성 항목", href }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("action");
    expect(state.rpcRequests).toEqual([]);
  });
});
