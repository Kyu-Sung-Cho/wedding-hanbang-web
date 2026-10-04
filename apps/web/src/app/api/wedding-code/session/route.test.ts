import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimitPersistent: mocks.limit, rateLimitKey: (prefix: string) => `${prefix}:test-bucket` }));
import { POST } from "./route";

const now = Date.parse("2026-09-23T10:00:00Z");
const time = now.toString(16).padStart(12, "0");
const roomId = `${time.slice(0, 8)}-${time.slice(8)}-4111-8111-111111111111`;
const answerCode = "31_-4-4-44-4-4--444-44-444-4_u.u.u.u.u.u_p_-_p";
const otherAnswer = answerCode.replaceAll("4", "5");
const create = { action: "create", roomId, ownerToken: "a".repeat(64), inviteToken: "b".repeat(64), answerCode,
  consentVersion: "2026-09-23", consent: true, ageConfirmed: true, issuedAt: now };
const waiting = { roomId, state: "waiting", role: "owner", expiresAt: "2026-09-30T10:00:00Z", ownAnswerCode: answerCode };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://hanbang.ai/api/wedding-code/session", { method: "POST", headers: {
    "content-type": "application/json", origin: "https://hanbang.ai", "sec-fetch-site": "same-origin", ...headers,
  }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  mocks.limit.mockResolvedValue(null); mocks.rpc.mockResolvedValue({ data: waiting, error: null });
});
afterEach(() => vi.useRealTimers());

describe("POST /api/wedding-code/session", () => {
  it("개인 토큰은 해시로만 RPC에 전달하고 승인된 답·동의만 저장한다", async () => {
    const response = await POST(request(create));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshot: waiting });
    expect(mocks.rpc).toHaveBeenCalledWith("create_wedding_code_pair_session", {
      p_room_id: roomId, p_owner_hash: hash(create.ownerToken), p_invite_hash: hash(create.inviteToken), p_answer_code: answerCode,
      p_consent_version: "2026-09-23", p_issued_at: now, p_consented: true, p_age_confirmed: true,
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(create.ownerToken);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("다른 출처와 임의 Bearer로 출처 확인을 우회하지 못한다", async () => {
    const invalidHeaders: Record<string, string>[] = [{ origin: "https://other.example" }, { "sec-fetch-site": "cross-site" }, { authorization: "Bearer fake" }];
    for (const headers of invalidHeaders) {
      expect((await POST(request(create, headers))).status).toBe(403);
    }
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("누락·거짓·문자열 동의, 다른 판, 미완료 답, 추가 소유자 필드를 거절한다", async () => {
    for (const invalid of [{ consent: false }, { ageConfirmed: "true" }, { ageConfirmed: undefined }, { consentVersion: "old" },
      { answerCode: "31_-------------------------_-.-.-.-.-.-_-_-_-" }, { answerCode: answerCode.replace("31_", "30_") }, { role: "owner" }]) {
      expect((await POST(request({ ...create, ...invalid }))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("원문 길이·형식과 과거·미래 생성 요청을 제한한다", async () => {
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request("x".repeat(2049)))).status).toBe(413);
    expect((await POST(request("한".repeat(700)))).status).toBe(413);
    expect((await POST(request(create, { "content-type": "text/plain" }))).status).toBe(400);
    for (const delta of [-300001, 300001]) {
      const issuedAt = now + delta;
      const stamp = issuedAt.toString(16).padStart(12, "0");
      const response = await POST(request({ ...create, issuedAt, roomId: `${stamp.slice(0, 8)}-${stamp.slice(8)}-4111-8111-111111111111` }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "CREATE_EXPIRED" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("삭제된 옛 방의 시각만 현재로 바꾸는 재생 요청을 저장소에 보내지 않는다", async () => {
    vi.setSystemTime(now + 8 * 86400000);
    const response = await POST(request({ ...create, issuedAt: Date.now() }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("공유 요청 제한 저장소 장애에서는 허용하지 않고 응답도 캐시하지 않는다", async () => {
    mocks.limit.mockResolvedValue(NextResponse.json({ error: "unavailable" }, { status: 503 }));
    const response = await POST(request(create));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.limit).toHaveBeenCalledWith("wedding-code:pair-session:write:test-bucket", expect.anything(), { failClosed: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("초대 조회에는 참여 상태만 반환하며 서버에서 실수로 포함한 답도 거절한다", async () => {
    const body = { action: "read", roomId, token: create.inviteToken };
    const invite = { roomId, role: "invite", state: "ready", expiresAt: waiting.expiresAt };
    mocks.rpc.mockResolvedValue({ data: invite, error: null });
    expect(await (await POST(request(body))).json()).toEqual({ snapshot: invite });
    expect(mocks.rpc).toHaveBeenLastCalledWith("read_wedding_code_pair_session", { p_room_id: roomId, p_token_hash: hash(create.inviteToken) });
    mocks.rpc.mockResolvedValue({ data: { ...invite, partnerAnswerCode: answerCode }, error: null });
    expect((await POST(request(body))).status).toBe(503);
  });
  it("참여 성공은 본인 답과 상대 답이 정확히 연결된 경우만 승인한다", async () => {
    const body = { action: "join", roomId, inviteToken: create.inviteToken, participantToken: "c".repeat(64),
      answerCode: otherAnswer, consentVersion: "2026-09-23", consent: true, ageConfirmed: true };
    const ready = { ...waiting, state: "ready", role: "participant", ownAnswerCode: otherAnswer, partnerAnswerCode: answerCode };
    mocks.rpc.mockResolvedValue({ data: ready, error: null });
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("join_wedding_code_pair_session", expect.objectContaining({
      p_invite_hash: hash(body.inviteToken), p_participant_hash: hash(body.participantToken), p_consented: true, p_age_confirmed: true,
    }));
    for (const wrong of [{ ...ready, ownAnswerCode: answerCode }, { ...ready, role: "owner" }, waiting,
      { ...ready, roomId: "22222222-2222-4222-8222-222222222222" }]) {
      mocks.rpc.mockResolvedValue({ data: wrong, error: null }); expect((await POST(request(body))).status).toBe(503);
    }
  });
  it("철회 성공은 원답 없는 종료 응답만 인정한다", async () => {
    const closed = { roomId, state: "closed", role: "owner", expiresAt: waiting.expiresAt };
    const body = { action: "revoke", roomId, token: create.ownerToken };
    mocks.rpc.mockResolvedValue({ data: closed, error: null }); expect((await POST(request(body))).status).toBe(200);
    mocks.rpc.mockResolvedValue({ data: waiting, error: null }); expect((await POST(request(body))).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: { ...closed, ownAnswerCode: answerCode }, error: null }); expect((await POST(request(body))).status).toBe(503);
  });
  it.each(["create", "join"])("%s의 업무 충돌은 재시도 없이 안내하고 원답을 보내지 않는다", async (action) => {
    const body = action === "create" ? create : { action, roomId, inviteToken: create.inviteToken, participantToken: "c".repeat(64),
      answerCode: otherAnswer, consentVersion: "2026-09-23", consent: true, ageConfirmed: true };
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PT409", message: `${create.ownerToken} ${answerCode}` } });
    const response = await POST(request(body));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "CONFLICT", error: "이미 다른 사람이 참여했거나 보낸 답이 달라졌어요. 새로 초대를 만들거나, 초대한 사람에게 새 초대를 요청해 주세요." });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each([["28000", 404], ["PT409", 409], ["40001", 503], ["55000", 410], ["22023", 400], ["XX000", 503]])("SQL 오류 %s는 안전한 오류 %d로 변환한다", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: `${create.ownerToken} ${answerCode}` } });
    const response = await POST(request(create));
    expect(response.status).toBe(status);
    const text = await response.text(); expect(text).not.toContain(create.ownerToken); expect(text).not.toContain(answerCode);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
