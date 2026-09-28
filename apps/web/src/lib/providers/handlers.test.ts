// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { buildSignupConsentServerEvidence } from "@hanbang/shared";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), client: vi.fn(), rate: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: mocks.client }));
vi.mock("@/lib/utils/adminAuth", () => ({ verifyAdmin: mocks.admin }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimitPersistent: mocks.rate, rateLimitKey: () => "test-provider" }));
import { POST as submit } from "@/app/api/provider/applications/route";
import { PATCH as update } from "@/app/api/provider/profiles/[id]/route";
import { PATCH as review } from "@/app/api/admin/providers/[id]/route";
import { GET as workspace } from "@/app/api/provider/workspace/route";
import { providerBody } from "./api";
import { applicationInputSchema } from "./validation";

const id = "aa000000-0000-4000-8000-000000000001";
const requestId = "aa000000-0000-4000-8000-000000000002";
const actor: User = { id, app_metadata: { signup_consent: buildSignupConsentServerEvidence({ termsAgreed: true, privacyAgreed: true, ageOver14Confirmed: true, marketingAgreed: false, consentPolicyVersion: "2026-09-28" }, "2026-09-28T00:00:00.000Z") }, user_metadata: {}, aud: "authenticated", created_at: "2026-09-28T00:00:00Z", email: "provider@example.test", email_confirmed_at: "2026-09-28T00:00:00Z" };
const input = { request_id: requestId, kind: "individual", name: "사진가", categories: ["photography"], regions: ["서울"], contact_name: "담당자", application_note: "", consents: { privacy: true, price_transparency: true, extra_charges: true, standard_terms: true, version: "2026-09-28" } };
function req(body: unknown, method = "POST", origin = "https://hanbang.ai") { return new Request("https://hanbang.ai/api/provider/applications", { method, headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }); }
const context = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: actor }, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.auth }, rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { provider_id: id, application_id: requestId, status: "pending" }, error: null });
  mocks.rate.mockResolvedValue(null); mocks.admin.mockResolvedValue({ authorized: true });
});
describe("제공자 API 권한·접수 증거", () => {
  it("다른 출처의 쿠키 쓰기는 인증 조회 전 차단한다", async () => {
    expect((await submit(req(input, "POST", "https://attacker.test"))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["https://attacker.test", null])("관리자 심사는 신뢰할 수 없는 출처 %s를 본문·인증·권한·RPC 처리 전에 차단한다", async (origin) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (origin) headers.set("origin", origin);
    const request = new Request(`https://hanbang.ai/api/admin/providers/${id}`, { method: "PATCH", headers, body: "malformed-private-body" });
    const readBody = vi.spyOn(request.body!, "getReader");
    const response = await review(request, context);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "UNTRUSTED_ORIGIN" });
    expect(readBody).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("비로그인 요청을 접수하지 않는다", async () => {
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
    expect((await submit(req(input))).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("계정 필수 동의가 없으면 접수하지 않는다", async () => {
    mocks.auth.mockResolvedValue({ data: { user: { ...actor, app_metadata: {}, user_metadata: {} } }, error: null });
    expect((await submit(req(input))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["owner_id", "status", "contact_email"])("신청 본문의 %s 주입을 거부한다", async (key) => {
    expect((await submit(req({ ...input, [key]: "approved" }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("확정된 접수 영수증만 성공으로 돌려준다", async () => {
    const response = await submit(req(input));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ provider_id: id, application_id: requestId, status: "pending" });
    const args = mocks.rpc.mock.calls[0][1];
    expect(args.p_request_id).toBe(requestId); expect(args.p_input).not.toHaveProperty("owner_id"); expect(args.p_input).not.toHaveProperty("contact_email");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("불명확한 DB 응답은 성공으로 만들지 않는다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await submit(req(input))).status).toBe(503);
  });
  it("낡은 버전 저장은 충돌로 남기고 사적 DB 오류를 공개하지 않는다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "PROVIDER_VERSION_CONFLICT" } });
    const response = await update(req({ action: "publish", expected_version: 1 }, "PATCH"), context);
    expect(response.status).toBe(409);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database password private-error" } });
    const failed = await submit(req(input));
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("private-error");
  });
  it("비관리자는 승인 RPC를 실행할 수 없다", async () => {
    mocks.admin.mockResolvedValue({ authorized: false });
    expect((await review(req({ kind: "application", action: "approve", expected_version: 1 }, "PATCH"), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("심사 사유 없는 반려는 DB 호출 전에 차단한다", async () => {
    expect((await review(req({ kind: "application", action: "reject", expected_version: 1 }, "PATCH"), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["잘못된 주소", "javascript:alert(1)", "https://name:secret@example.test"])("잘못된 공개 링크 %s는 입력 오류로 처리한다", async (website) => {
    const response = await update(req({ action: "save", expected_version: 1, introduction: "소개", website, instagram: website }, "PATCH"), context);
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("workspace의 저장경로·내부 개인정보 필드는 응답 스키마로 제거한다", async () => {
    mocks.rpc.mockResolvedValue({ data: { profiles: [], applications: [], offerings: [], media: [], business_inquiries: [], secret: "private" }, error: null });
    expect(await (await workspace(new Request("https://hanbang.ai/api/provider/workspace"))).json()).not.toHaveProperty("secret");
  });
  it("Content-Length 없이 큰 본문을 흘려보내도 제한한다", async () => {
    await expect(providerBody(req({ ...input, application_note: "x".repeat(80_000) }), applicationInputSchema)).rejects.toMatchObject({ status: 413 });
  });
});
