import { decodeV31, encodeV31 } from "./v31";
import { isV31CoreComplete } from "./v31Flow";

export const PAIR_SESSION_CONSENT_VERSION = "2026-09-23";
export const PAIR_SESSION_RETENTION_DAYS = 7;
export const PAIR_SESSION_CREATE_WINDOW_MS = 5 * 60 * 1000;
export const PAIR_SESSION_REQUEST_TIMEOUT_MS = 15_000;
/** 만들기 요청의 시각이 어긋났을 때 화면에 꼭 들어가는 안내. 서버 문구와 화면이 같은 문장을 쓴다. */
export const PAIR_SESSION_CLOCK_HINT = "휴대폰 날짜와 시간이 맞는지 확인해 주세요.";
export type PairSessionRequest =
  | { action: "create"; roomId: string; ownerToken: string; inviteToken: string; answerCode: string; consentVersion: typeof PAIR_SESSION_CONSENT_VERSION; consent: true; ageConfirmed: true; issuedAt: number }
  | { action: "read" | "revoke"; roomId: string; token: string }
  | { action: "join"; roomId: string; inviteToken: string; participantToken: string; answerCode: string; consentVersion: typeof PAIR_SESSION_CONSENT_VERSION; consent: true; ageConfirmed: true };
export type PairSessionSnapshot = {
  roomId: string;
  state: "waiting" | "ready" | "closed";
  role: "owner" | "participant" | "invite";
  expiresAt: string;
  ownAnswerCode?: string;
  partnerAnswerCode?: string;
};
export type PairSessionResult = { ok: true; snapshot: PairSessionSnapshot } | { ok: false; error: string; code: string };

export function isPairSessionRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function hasPairSessionKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function isPairSessionRoomId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function isPairSessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
export function getPairSessionIssuedAt(roomId: string): number {
  return Number.parseInt(roomId.replaceAll("-", "").slice(0, 12), 16);
}
export function isPairSessionAnswer(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  const draft = decodeV31(value);
  return draft !== null && isV31CoreComplete(draft) && encodeV31(draft) === value;
}
export function parsePairSessionRequest(value: unknown): PairSessionRequest | null {
  if (!isPairSessionRecord(value) || !isPairSessionRoomId(value.roomId)) return null;
  if (value.action === "read" || value.action === "revoke") {
    return hasPairSessionKeys(value, ["action", "roomId", "token"]) && isPairSessionToken(value.token)
      ? { action: value.action, roomId: value.roomId, token: value.token } : null;
  }
  if (!isPairSessionAnswer(value.answerCode) || value.consentVersion !== PAIR_SESSION_CONSENT_VERSION || !isPairSessionToken(value.inviteToken)
    || value.consent !== true || value.ageConfirmed !== true) return null;
  if (value.action === "create") {
    return hasPairSessionKeys(value, ["action", "roomId", "ownerToken", "inviteToken", "answerCode", "consentVersion", "consent", "ageConfirmed", "issuedAt"])
      && isPairSessionToken(value.ownerToken) && value.ownerToken !== value.inviteToken
      && typeof value.issuedAt === "number" && Number.isSafeInteger(value.issuedAt) && value.issuedAt > 0
      && getPairSessionIssuedAt(value.roomId) === value.issuedAt
      ? { action: "create", roomId: value.roomId, ownerToken: value.ownerToken, inviteToken: value.inviteToken, answerCode: value.answerCode, consentVersion: value.consentVersion, consent: true, ageConfirmed: true, issuedAt: value.issuedAt } : null;
  }
  if (value.action === "join") {
    return hasPairSessionKeys(value, ["action", "roomId", "inviteToken", "participantToken", "answerCode", "consentVersion", "consent", "ageConfirmed"])
      && isPairSessionToken(value.participantToken) && value.participantToken !== value.inviteToken
      ? { action: "join", roomId: value.roomId, inviteToken: value.inviteToken, participantToken: value.participantToken, answerCode: value.answerCode, consentVersion: value.consentVersion, consent: true, ageConfirmed: true } : null;
  }
  return null;
}
export function parsePairSessionSnapshot(value: unknown): PairSessionSnapshot | null {
  if (!isPairSessionRecord(value) || !isPairSessionRoomId(value.roomId)
    || typeof value.state !== "string" || !["waiting", "ready", "closed"].includes(value.state)
    || typeof value.role !== "string" || !["owner", "participant", "invite"].includes(value.role)
    || typeof value.expiresAt !== "string" || value.expiresAt.length > 40
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.expiresAt)
    || !Number.isFinite(Date.parse(value.expiresAt))) return null;
  const base = ["roomId", "state", "role", "expiresAt"];
  if (value.state === "closed" || value.role === "invite") {
    if (!hasPairSessionKeys(value, base)) return null;
  } else if (value.state === "waiting") {
    if (value.role !== "owner" || !hasPairSessionKeys(value, [...base, "ownAnswerCode"]) || !isPairSessionAnswer(value.ownAnswerCode)) return null;
  } else if (!hasPairSessionKeys(value, [...base, "ownAnswerCode", "partnerAnswerCode"])
    || !isPairSessionAnswer(value.ownAnswerCode) || !isPairSessionAnswer(value.partnerAnswerCode)) return null;
  return {
    roomId: value.roomId,
    state: value.state as PairSessionSnapshot["state"], role: value.role as PairSessionSnapshot["role"], expiresAt: value.expiresAt,
    ...(typeof value.ownAnswerCode === "string" ? { ownAnswerCode: value.ownAnswerCode } : {}),
    ...(typeof value.partnerAnswerCode === "string" ? { partnerAnswerCode: value.partnerAnswerCode } : {}),
  };
}
export function acknowledgesPairSessionRequest(request: PairSessionRequest, snapshot: PairSessionSnapshot): boolean {
  if (snapshot.roomId !== request.roomId) return false;
  if (request.action === "revoke") return snapshot.state === "closed" && snapshot.role !== "invite";
  if (request.action === "create") return snapshot.role === "owner" && snapshot.state !== "closed" && snapshot.ownAnswerCode === request.answerCode;
  if (request.action === "join") return snapshot.role === "participant" && snapshot.state === "ready" && snapshot.ownAnswerCode === request.answerCode;
  return true;
}
export function createPairSessionKeys(): { roomId: string; ownerToken: string; inviteToken: string; participantToken: string; issuedAt: number } {
  const tokens = new Set<string>();
  while (tokens.size < 3) tokens.add(Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""));
  const [ownerToken, inviteToken, participantToken] = [...tokens];
  const issuedAt = Date.now();
  const time = issuedAt.toString(16).padStart(12, "0");
  // 방 주소의 시각을 고정해 삭제 후 옛 주소에 새 시각을 붙여 되살릴 수 없게 한다.
  // 접근 권한은 주소의 무작위성이 아니라 별도의 256비트 토큰으로 확인한다.
  const roomId = `${time.slice(0, 8)}-${time.slice(8)}${crypto.randomUUID().slice(13)}`;
  return { roomId, ownerToken, inviteToken, participantToken, issuedAt };
}
export async function requestPairSession(input: PairSessionRequest): Promise<PairSessionResult> {
  if (!parsePairSessionRequest(input)) return { ok: false, code: "INVALID_REQUEST", error: "보낸 답이나 동의 항목에 문제가 있어요. 화면에서 다시 확인해 주세요." };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAIR_SESSION_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/wedding-code/session", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store", credentials: "same-origin", signal: controller.signal,
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      // code 가 있는 응답만 이 경로가 직접 만든 문구다. code 가 없는 응답(요청 제한, 출처 확인)은 다른 라우트와 공유하는 문장이라
      // 합니다체나 영어 식별자가 섞여 있을 수 있어서, 화면에는 상태 번호로 고른 해요체 문장만 쓴다.
      const fallback = response.status === 429 ? "요청이 잠깐 몰렸어요. 조금 뒤에 같은 화면에서 다시 시도해 주세요."
        : response.status === 503 ? "지금은 확인하지 못했어요. 조금 뒤에 같은 화면에서 다시 시도해 주세요."
          : response.status === 403 ? "요청을 확인하지 못했어요. 웨딩코드 화면을 새로 열고 다시 시도해 주세요."
            : "함께 보기 결과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
      if (isPairSessionRecord(value) && typeof value.code === "string") {
        // 서버가 5xx 와 함께 보낸 INVALID_RESPONSE 는 지금 확인이 안 된다는 일시 오류다. 200 인데 해석할 수 없는 본문(아래)만 확정 오류로 남는다.
        const code = value.code === "INVALID_RESPONSE" && response.status >= 500 ? "UNAVAILABLE" : value.code;
        return { ok: false, code, error: typeof value.error === "string" ? value.error : fallback };
      }
      return { ok: false, code: "UNAVAILABLE", error: fallback };
    }
    const snapshot = isPairSessionRecord(value) && hasPairSessionKeys(value, ["snapshot"]) ? parsePairSessionSnapshot(value.snapshot) : null;
    if (snapshot && acknowledgesPairSessionRequest(input, snapshot)) return { ok: true, snapshot };
    return { ok: false, code: "INVALID_RESPONSE", error: "처리가 끝났는지 확인하지 못했어요. 잠시 후 다시 확인해 주세요." };
  } catch {
    if (controller.signal.aborted) return { ok: false, code: "TIMEOUT", error: "연결이 너무 오래 걸렸어요. 같은 화면에서 다시 시도해 주세요." };
    return { ok: false, code: "NETWORK_ERROR", error: "연결이 끊겼어요. 같은 화면에서 다시 시도해 주세요." };
  } finally {
    clearTimeout(timeout);
  }
}
