import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { PREPARATION_STYLE_OWNER_HEADER } from "@/lib/weddingCode/preparationStyle";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { DELETE, GET, PUT } from "./route";
import { DELETE as UNSHARE, PUT as SHARE } from "./share/route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: vi.fn(() => null), rateLimitKey: vi.fn(() => "preparation-style:test") }));
vi.mock("@/utils/trustedMutation", () => ({ isTrustedMutationRequest: vi.fn(() => true) }));

const OWNER = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "33333333-3333-4333-8333-333333333333";
const answer = { sceneVersion: "v1.2-code", answerCode: "A".repeat(20), revision: 5, savedAt: "2026-09-20T00:00:00.000Z" };
const snapshot = { ownerUserId: OWNER, stateRevision: 5, coupleId: COUPLE, partnerUserId: PEER, own: answer, sharing: null, partner: null };
const saveBody = { expectedOwnerUserId: OWNER, expectedRevision: null, sceneVersion: answer.sceneVersion, answerCode: answer.answerCode, saveConsentVersion: "2026-09-20" };
const revisionBody = { expectedOwnerUserId: OWNER, expectedRevision: 5 };
const shareBody = { ...revisionBody, expectedCoupleId: COUPLE, expectedPartnerUserId: PEER, shareConsentVersion: "2026-09-20" };
function request(method: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request("https://hanbang.ai/api/wedding-code/preparation-style", {
    method, headers: { "content-type": "application/json", [PREPARATION_STYLE_OWNER_HEADER]: OWNER, ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function mockClient(options: { userId?: string | null; data?: unknown; error?: { code: string; message?: string } | null } = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: options.data === undefined ? snapshot : options.data, error: options.error ?? null });
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.userId === null ? null : { id: options.userId ?? OWNER } }, error: null }) }, rpc };
  vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
  return rpc;
}
describe("authenticated preparation style API", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(checkRateLimit).mockReturnValue(null); vi.mocked(isTrustedMutationRequest).mockReturnValue(true); });

  it("returns only a validated private snapshot for the expected logged-in owner", async () => {
    const rpc = mockClient(); const response = await GET(request("GET"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ snapshot }); expect(rpc).toHaveBeenCalledExactlyOnceWith("get_own_wedding_preparation_style", {});
  });
  it("does not call persistence for an anonymous visitor", async () => {
    const rpc = mockClient({ userId: null }); const response = await GET(request("GET"));
    expect(response.status).toBe(401); expect(rpc).not.toHaveBeenCalled();
  });
  it("requires expected owner on reads and refuses a changed cookie identity before reading", async () => {
    const rpc = mockClient(); expect((await GET(new Request("https://hanbang.ai/api/wedding-code/preparation-style"))).status).toBe(400);
    const changedRpc = mockClient({ userId: PEER }); const response = await GET(request("GET"));
    expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty("snapshot"); expect(rpc).not.toHaveBeenCalled(); expect(changedRpc).not.toHaveBeenCalled();
  });
  it.each([[PUT, "PUT", saveBody], [DELETE, "DELETE", revisionBody], [SHARE, "PUT", shareBody], [UNSHARE, "DELETE", revisionBody]] as const)("rejects changed-owner and untrusted mutations before RPC: %j", async (handler, method, body) => {
    const rpc = mockClient({ userId: PEER }); expect((await handler(request(method, body))).status).toBe(409); expect(rpc).not.toHaveBeenCalled();
    const untrustedRpc = mockClient(); vi.mocked(isTrustedMutationRequest).mockReturnValue(false);
    expect((await handler(request(method, body))).status).toBe(403); expect(untrustedRpc).not.toHaveBeenCalled();
  });
  it("saves only explicitly consented own answers, without accepting client-supplied owner targets", async () => {
    const rpc = mockClient(); const response = await PUT(request("PUT", saveBody));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_own_wedding_preparation_style", { p_expected_revision: null, p_scene_version: "v1.2-code", p_answer_code: answer.answerCode, p_save_consent_version: "2026-09-20" });
    rpc.mockClear(); expect((await PUT(request("PUT", { ...saveBody, partnerAnswers: answer.answerCode }))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...saveBody, saveConsentVersion: null }, { ...saveBody, answerCode: "-".repeat(20) },
    { ...saveBody, answerCode: "A".repeat(19) + "C" }, { ...saveBody, sceneVersion: "v1.1-code" },
    { ...saveBody, answerCode: "a".repeat(20) }, { ...saveBody, expectedRevision: -1 },
  ])("rejects unsupported input/consent before saving: %j", async body => {
    const rpc = mockClient(); expect((await PUT(request("PUT", body))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("accepts partial answers without fabricating skipped responses", async () => {
    const answerCode = "A" + "-".repeat(19); const rpc = mockClient({ data: { ...snapshot, own: { ...answer, answerCode } } });
    expect((await PUT(request("PUT", { ...saveBody, answerCode }))).status).toBe(200);
    expect(rpc.mock.calls[0][1].p_answer_code).toBe(answerCode);
  });
  it("requires the exact partner and separate share confirmation, then verifies the resulting grant", async () => {
    const shared = { ...snapshot, stateRevision: 6, own: { ...answer, revision: 6 }, sharing: { responseRevision: 6, sharedAt: answer.savedAt } };
    const rpc = mockClient({ data: shared }); expect((await SHARE(request("PUT", shareBody))).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("share_own_wedding_preparation_style", { p_expected_revision: 5, p_expected_couple_id: COUPLE, p_expected_partner_user_id: PEER, p_share_consent_version: "2026-09-20" });
    rpc.mockClear(); expect((await SHARE(request("PUT", { ...shareBody, shareConsentVersion: undefined }))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
    mockClient({ data: { ...snapshot, stateRevision: 6, own: { ...answer, revision: 6 } } }); expect((await SHARE(request("PUT", shareBody))).status).toBe(503);
    mockClient({ data: { ...snapshot, sharing: { responseRevision: 5, sharedAt: answer.savedAt } } }); expect((await SHARE(request("PUT", shareBody))).status).toBe(503);
  });
  it("confirms share revocation and personal deletion from returned state, not merely a successful transport", async () => {
    const rpc = mockClient({ data: { ...snapshot, stateRevision: 6, own: { ...answer, revision: 6 } } }); expect((await UNSHARE(request("DELETE", revisionBody))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("unshare_own_wedding_preparation_style", { p_expected_revision: 5 });
    expect((await DELETE(request("DELETE", revisionBody))).status).toBe(503);
    mockClient({ data: { ...snapshot, stateRevision: 6, own: null } }); expect((await DELETE(request("DELETE", revisionBody))).status).toBe(200);
    expect((await UNSHARE(request("DELETE", revisionBody))).status).toBe(200);
    mockClient(); expect((await UNSHARE(request("DELETE", revisionBody))).status).toBe(503);
    mockClient({ data: { ...snapshot, own: null } }); expect((await DELETE(request("DELETE", revisionBody))).status).toBe(503);
  });
  it("never returns another account, unexpected partner payload or mismatched saved values as success", async () => {
    for (const data of [{ ...snapshot, ownerUserId: PEER }, { ...snapshot, partner: answer }, { ...snapshot, own: { ...answer, answerCode: "B".repeat(20) } }]) {
      mockClient({ data }); const response = await PUT(request("PUT", saveBody));
      expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty("snapshot");
    }
  });
  it.each([["40001", 409], ["22023", 400], ["42883", 503]] as const)("maps RPC %s to %s without exposing raw answers or SQL", async (code, status) => {
    mockClient({ error: { code, message: `SQL payload ${answer.answerCode}` } }); const response = await PUT(request("PUT", saveBody));
    expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain(answer.answerCode);
  });
  it("bounds request size and preserves private headers on rate limiting", async () => {
    const rpc = mockClient(); expect((await PUT(request("PUT", { ...saveBody, extra: "X".repeat(3000) }))).status).toBe(413); expect(rpc).not.toHaveBeenCalled();
    vi.mocked(checkRateLimit).mockReturnValue(NextResponse.json({ error: "limit" }, { status: 429 }));
    const limited = await GET(request("GET")); expect(limited.status).toBe(429); expect(limited.headers.get("cache-control")).toContain("no-store"); expect(rpc).not.toHaveBeenCalled();
  });
});
