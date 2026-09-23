import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import {
  PAIR_SESSION_CREATE_WINDOW_MS, acknowledgesPairSessionRequest, parsePairSessionRequest, parsePairSessionSnapshot,
  type PairSessionRequest,
} from "./pairSessionContract";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Origin, Sec-Fetch-Site", "Referrer-Policy": "no-referrer" };
const MAX_BODY_BYTES = 2048;
const FAILURE = "비교 결과를 처리하지 못했어요. 잠시 후 같은 화면에서 다시 시도해 주세요.";
function reply(body: unknown, status = 200): NextResponse { return NextResponse.json(body, { status, headers: PRIVATE_HEADERS }); }
function failure(code: string, error: string, status: number): NextResponse { return reply({ code, error }, status); }
export function hashPairSessionToken(token: string): string { return createHash("sha256").update(token, "utf8").digest("hex"); }

function rpcRequest(input: PairSessionRequest): { name: string; params: Record<string, unknown> } {
  const base = { p_room_id: input.roomId };
  if (input.action === "create") return { name: "create_wedding_code_pair_session", params: {
    ...base, p_owner_hash: hashPairSessionToken(input.ownerToken), p_invite_hash: hashPairSessionToken(input.inviteToken),
    p_answer_code: input.answerCode, p_consent_version: input.consentVersion, p_issued_at: input.issuedAt, p_consented: input.consent, p_age_confirmed: input.ageConfirmed,
  } };
  if (input.action === "join") return { name: "join_wedding_code_pair_session", params: {
    ...base, p_invite_hash: hashPairSessionToken(input.inviteToken), p_participant_hash: hashPairSessionToken(input.participantToken),
    p_answer_code: input.answerCode, p_consent_version: input.consentVersion, p_consented: input.consent, p_age_confirmed: input.ageConfirmed,
  } };
  return { name: input.action === "read" ? "read_wedding_code_pair_session" : "revoke_wedding_code_pair_session",
    params: { ...base, p_token_hash: hashPairSessionToken(input.token) } };
}
function rpcFailure(code: string | undefined): NextResponse {
  if (code === "28000") return failure("NOT_FOUND", "이 비교를 열 수 없어요. 받은 링크와 이 브라우저의 연결을 확인해 주세요.", 404);
  if (code === "PT409") return failure("CONFLICT", "이미 참여한 사람이 있거나 비교 내용이 달라졌어요. 새로운 비교를 시작해 주세요.", 409);
  if (code === "55000") return failure("CLOSED", "종료되었거나 기간이 지난 비교예요. 새로운 비교를 시작해 주세요.", 410);
  if (code === "22023") return failure("INVALID_REQUEST", "비교할 답과 확인 내용을 다시 확인해 주세요.", 400);
  return failure("UNAVAILABLE", FAILURE, 503);
}
export async function handlePairSessionRequest(request: Request): Promise<NextResponse> {
  try {
    // 이 경로는 Bearer 로그인 예외를 사용하지 않는 같은 출처의 브라우저 요청이다.
    if (request.headers.has("authorization") || !isTrustedMutationRequest(request)) return failure("INVALID_ORIGIN", "잘못된 요청 출처입니다.", 403);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return failure("INVALID_REQUEST", "요청 형식을 확인해 주세요.", 400);
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) return failure("TOO_LARGE", "요청 내용이 너무 큽니다.", 413);
    const bounded = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!bounded.ok) return failure("INVALID_REQUEST", "요청 내용을 확인하지 못했어요.", bounded.reason === "too_large" ? 413 : 400);
    let value: unknown;
    try { value = JSON.parse(bounded.text); } catch { return failure("INVALID_REQUEST", "요청 형식을 확인해 주세요.", 400); }
    const input = parsePairSessionRequest(value);
    if (!input) return failure("INVALID_REQUEST", "비교할 답과 확인 내용을 다시 확인해 주세요.", 400);
    if (input.action === "create" && Math.abs(Date.now() - input.issuedAt) > PAIR_SESSION_CREATE_WINDOW_MS) {
      return failure("CREATE_EXPIRED", "만들기 요청의 시간이 지났어요. 새로운 비교를 시작해 주세요.", 400);
    }
    const limited = await checkRateLimitPersistent(rateLimitKey(`wedding-code:pair-session:${input.action === "read" ? "read" : "write"}`, request),
      { maxRequests: input.action === "read" ? 120 : 15, windowMs: 60_000 }, { failClosed: true });
    if (limited) {
      for (const [key, val] of Object.entries(PRIVATE_HEADERS)) limited.headers.set(key, val);
      return limited;
    }
    const rpc = rpcRequest(input);
    const { data, error } = await createAdminClient().rpc(rpc.name, rpc.params);
    if (error) return rpcFailure(error.code);
    const snapshot = parsePairSessionSnapshot(data);
    if (!snapshot || !acknowledgesPairSessionRequest(input, snapshot)) return failure("INVALID_RESPONSE", "처리 결과를 확인하지 못했어요. 다시 불러와 주세요.", 503);
    return reply({ snapshot });
  } catch {
    // 원응답·접근 토큰·RPC 오류 원문은 운영 로그에 남기지 않는다.
    return failure("UNAVAILABLE", FAILURE, 503);
  }
}
