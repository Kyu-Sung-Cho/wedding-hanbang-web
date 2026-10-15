import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";

export function serviceClient() {
  return createAdminClient();
}

export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "x-wedding-code-access-token" } });
}

export function accessHash(token: string) {
  return createHash("sha256").update(token.toLowerCase()).digest("hex");
}

export function ownerCredentials(value: unknown): { responseId: string; hash: string } | null {
  if (!isRecord(value) || !isUuid(value.response_id) || !isUuid(value.access_token)) return null;
  return { responseId: value.response_id, hash: accessHash(value.access_token) };
}

export async function readSmallJson(request: NextRequest, maxBytes = 16 * 1024): Promise<unknown> {
  const result = await readBoundedUtf8Text(request, maxBytes, request.signal);
  if (!result.ok) {
    if (result.reason === "too_large") throw new Error("body_too_large");
    return null;
  }
  try { return JSON.parse(result.text); } catch { return null; }
}

export async function limitRequest(request: NextRequest, operation: string, maxRequests = 60) {
  return checkRateLimitPersistent(rateLimitKey(`wedding-code36-${operation}`, request), { maxRequests, windowMs: 60 * 60 * 1000 });
}

export function rpcObject(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return isRecord(row) ? row : null;
}

export function rpcFailure(row: Record<string, unknown>) {
  switch (row.error) {
    case "unauthorized": return privateJson({ error: "이 결과에 접근할 수 없어요." }, 403);
    case "expired": return privateJson({ error: "결과 보관 기간이 끝났어요. 새로 답해 주세요.", resultStatus: "expired" }, 410);
    case "deleted": return privateJson({ error: "삭제한 결과는 다시 저장하거나 열 수 없어요.", resultStatus: "deleted" }, 410);
    case "invite_not_found": return privateJson({ error: "초대 링크를 찾을 수 없어요.", pairingStatus: "invalid" }, 404);
    case "self_pair": return privateJson({ error: "내 결과에 나를 다시 연결할 수 없어요.", pairingStatus: "self" }, 409);
    default: return privateJson({ error: "요청을 확인해 주세요." }, 400);
  }
}

export function serverFailure(error: unknown) {
  if (error instanceof Error && error.message === "body_too_large") return privateJson({ error: "요청 데이터가 너무 큽니다." }, 413);
  // 비밀키·개인 답변을 서버 로그에 남기지 않는다.
  console.error("[wedding-code36] 요청 처리 실패");
  return privateJson({ error: "잠시 후 다시 시도해 주세요." }, 503);
}
