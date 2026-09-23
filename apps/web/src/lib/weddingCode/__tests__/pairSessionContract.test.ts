import { afterEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V31_TASTES } from "@/constants/weddingCodeV31";
import { createV31Draft, encodeV31 } from "../v31";
import { V31_CORE_RATING_IDS } from "../v31Flow";
import {
  PAIR_SESSION_CONSENT_VERSION, acknowledgesPairSessionRequest, createPairSessionKeys, isPairSessionAnswer,
  getPairSessionIssuedAt, parsePairSessionRequest, parsePairSessionSnapshot, requestPairSession, type PairSessionRequest,
} from "../pairSessionContract";

function completed() {
  const draft = createV31Draft();
  for (const id of V31_CORE_RATING_IDS) draft.answers[id] = 4;
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "undecided" };
  draft.avoidances = { status: "no_preference" }; draft.spending = { status: "no_preference" };
  return draft;
}
const issuedAt = Date.parse("2026-09-23T10:00:00Z");
const time = issuedAt.toString(16).padStart(12, "0");
const roomId = `${time.slice(0, 8)}-${time.slice(8)}-4111-8111-111111111111`;
const answerCode = encodeV31(completed());
const create: PairSessionRequest = { action: "create", roomId, ownerToken: "a".repeat(64), inviteToken: "b".repeat(64), answerCode,
  issuedAt, consentVersion: PAIR_SESSION_CONSENT_VERSION, consent: true, ageConfirmed: true };
const waiting = { roomId, role: "owner", state: "waiting", expiresAt: "2026-09-30T10:00:00Z", ownAnswerCode: answerCode };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("비공개 비교 세션의 입력·응답 경계", () => {
  it("핵심 응답 완료와 canonical 판을 요구하되 추가 응답은 강요하지 않는다", () => {
    expect(isPairSessionAnswer(answerCode)).toBe(true);
    const partial = completed(); delete partial.answers.G1;
    expect(isPairSessionAnswer(encodeV31(partial))).toBe(false);
    expect(isPairSessionAnswer(encodeV31(createV31Draft()))).toBe(false);
    expect(isPairSessionAnswer(answerCode.replace("31_", "30_"))).toBe(false);
    expect(isPairSessionAnswer(`${answerCode}\n`)).toBe(false);
    expect(isPairSessionAnswer("a".repeat(257))).toBe(false);
  });
  it("전부 모름·건너뜀만 있는 응답을 비교 내용으로 만들지 않는다", () => {
    const draft = completed();
    for (const id of V31_CORE_RATING_IDS) draft.answers[id] = "skipped";
    draft.avoidances = { status: "undecided" }; draft.spending = { status: "skipped" };
    expect(isPairSessionAnswer(encodeV31(draft))).toBe(false);
  });
  it("실제 동의와 연령 확인을 모두 받고, 초대와 본인 접근 권한을 분리한다", () => {
    expect(parsePairSessionRequest(create)).toEqual(create);
    for (const field of ["consent", "ageConfirmed"] as const) {
      for (const value of [undefined, false, "true", 1, null]) expect(parsePairSessionRequest({ ...create, [field]: value })).toBeNull();
    }
    for (const invalid of [{ ownerToken: create.inviteToken }, { ownerToken: "A".repeat(64) }, { ownerToken: "a".repeat(63) },
      { consentVersion: "2026-09-20" }, { roomId: roomId.replace("4111", "1111") }, { role: "owner" }, { issuedAt: Infinity }]) {
      expect(parsePairSessionRequest({ ...create, ...invalid })).toBeNull();
    }
    expect(parsePairSessionRequest({ action: "read", roomId, token: create.ownerToken, role: "owner" })).toBeNull();
    expect(parsePairSessionRequest({ ...create, issuedAt: issuedAt + 1 })).toBeNull();
    expect(parsePairSessionRequest({ ...create, issuedAt: issuedAt + 8 * 86400000 })).toBeNull();
  });
  it("서버가 초대 권한에 답을 넣거나 종료 후 답을 돌려주면 거절한다", () => {
    const base = { roomId, role: "invite", state: "waiting", expiresAt: waiting.expiresAt };
    for (const state of ["waiting", "ready", "closed"]) {
      expect(parsePairSessionSnapshot({ ...base, state })).not.toBeNull();
      expect(parsePairSessionSnapshot({ ...base, state, ownAnswerCode: answerCode })).toBeNull();
      expect(parsePairSessionSnapshot({ ...base, state, partnerAnswerCode: answerCode })).toBeNull();
    }
    expect(parsePairSessionSnapshot({ ...waiting, state: "closed" })).toBeNull();
    expect(parsePairSessionSnapshot({ ...base, state: "closed", role: "participant" })).not.toBeNull();
  });
  it("대기·완료·참여자 응답 필드를 정확히 구분하고 잘못된 판을 거절한다", () => {
    expect(parsePairSessionSnapshot(waiting)).toEqual(waiting);
    expect(parsePairSessionSnapshot({ ...waiting, role: "participant" })).toBeNull();
    expect(parsePairSessionSnapshot({ ...waiting, partnerAnswerCode: answerCode })).toBeNull();
    expect(parsePairSessionSnapshot({ ...waiting, state: "ready" })).toBeNull();
    expect(parsePairSessionSnapshot({ ...waiting, state: "ready", partnerAnswerCode: answerCode })).not.toBeNull();
    expect(parsePairSessionSnapshot({ ...waiting, state: "ready", partnerAnswerCode: "v1.2-code" })).toBeNull();
    expect(parsePairSessionSnapshot({ ...waiting, role: "administrator" })).toBeNull();
    expect(parsePairSessionSnapshot({ ...waiting, role: ["owner"] })).toBeNull();
    expect(parsePairSessionSnapshot({ ...waiting, state: ["waiting"] })).toBeNull();
    expect(parsePairSessionSnapshot({ ...waiting, expiresAt: "invalid" })).toBeNull();
    expect(parsePairSessionSnapshot({ ...waiting, expiresAt: "1" })).toBeNull();
  });
  it("생성·참여 성공은 요청한 방과 본인 답까지 일치해야 인정한다", () => {
    const snapshot = parsePairSessionSnapshot(waiting)!;
    expect(acknowledgesPairSessionRequest(create, snapshot)).toBe(true);
    expect(acknowledgesPairSessionRequest(create, { ...snapshot, roomId: "22222222-2222-4222-8222-222222222222" })).toBe(false);
    expect(acknowledgesPairSessionRequest(create, { ...snapshot, ownAnswerCode: answerCode.replaceAll("4", "5") })).toBe(false);
    const join: PairSessionRequest = { action: "join", roomId, inviteToken: create.inviteToken, participantToken: "c".repeat(64), answerCode,
      consentVersion: PAIR_SESSION_CONSENT_VERSION, consent: true, ageConfirmed: true };
    expect(acknowledgesPairSessionRequest(join, snapshot)).toBe(false);
    expect(acknowledgesPairSessionRequest(join, { ...snapshot, state: "ready", role: "participant", partnerAnswerCode: answerCode })).toBe(true);
    expect(parsePairSessionRequest({ ...join, participantToken: join.inviteToken })).toBeNull();
  });
  it("브라우저가 만드는 세 권한은 서로 다르고 각 256비트다", () => {
    const keys = createPairSessionKeys();
    expect(keys.roomId).toMatch(/^[0-9a-f-]{36}$/);
    expect(getPairSessionIssuedAt(keys.roomId)).toBe(keys.issuedAt);
    expect(parsePairSessionRequest({ ...create, ...keys, participantToken: undefined })).toBeNull();
    expect(parsePairSessionRequest({ ...create, roomId: keys.roomId, ownerToken: keys.ownerToken, inviteToken: keys.inviteToken, issuedAt: keys.issuedAt })).not.toBeNull();
    expect(new Set([keys.ownerToken, keys.inviteToken, keys.participantToken]).size).toBe(3);
    for (const token of [keys.ownerToken, keys.inviteToken, keys.participantToken]) expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
  it("클라이언트는 네트워크 성공만으로 저장 성공을 말하지 않는다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ snapshot: { ...waiting, role: "invite" } }) });
    vi.stubGlobal("fetch", fetcher);
    expect(await requestPairSession(create)).toMatchObject({ ok: false, code: "INVALID_RESPONSE" });
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ snapshot: waiting }) });
    expect(await requestPairSession(create)).toEqual({ ok: true, snapshot: waiting });
    expect(fetcher).toHaveBeenLastCalledWith("/api/wedding-code/session", expect.objectContaining({ method: "POST", cache: "no-store" }));
    fetcher.mockRejectedValue(new Error("offline"));
    expect(await requestPairSession(create)).toMatchObject({ ok: false, code: "NETWORK_ERROR" });
  });
  it("응답이 멈추면 15초에 요청을 취소하고 같은 키로 재시도할 수 있게 안내한다", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      signal = init.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    const pending = requestPairSession(create);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("성공·서버 오류·응답 해석 오류 뒤에는 제한 시간을 모두 해제한다", async () => {
    vi.useFakeTimers();
    for (const response of [
      { ok: true, json: async () => ({ snapshot: waiting }) },
      { ok: false, json: async () => ({ code: "CLOSED", error: "종료된 비교예요." }) },
      { ok: true, json: async () => { throw new SyntaxError("bad json"); } },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await requestPairSession(create);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});
