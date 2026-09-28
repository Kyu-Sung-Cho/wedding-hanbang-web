import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import { hasRecordedSignupConsent } from "@hanbang/shared";
import { verifyAdmin } from "@/lib/utils/adminAuth";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { log } from "@/utils/log";

export class ProviderError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export function providerJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export function providerError(error: unknown) {
  if (!(error instanceof z.ZodError) && (!(error instanceof ProviderError) || error.status >= 500)) {
    log.error("providers/request", new Error("PROVIDER_REQUEST_UNAVAILABLE"));
  }
  if (error instanceof ProviderError) return providerJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof z.ZodError) return providerJson({ error: "입력 내용을 확인해 주세요.", code: "PROVIDER_INVALID_INPUT" }, 400);
  return providerJson({ error: "지금은 처리 결과를 확인할 수 없어요. 새로고침한 뒤 다시 확인해 주세요.", code: "PROVIDER_UNAVAILABLE" }, 503);
}
export async function providerAccount(request: Request, mutation = false, admin = false) {
  if (mutation && !isTrustedMutationRequest(request)) throw new ProviderError("UNTRUSTED_ORIGIN", 403, "올바른 서비스 화면에서 다시 시도해 주세요.");
  const client = await createClientFromRequest(request);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new ProviderError("PROVIDER_AUTH_REQUIRED", 401, "로그인이 필요해요.");
  if (!hasRecordedSignupConsent(user.app_metadata)) throw new ProviderError("CONSENT_REQUIRED", 403, "제공자 센터에서 이용약관과 개인정보 처리 동의를 확인해 주세요.");
  if (admin && !(await verifyAdmin(request)).authorized) throw new ProviderError("PROVIDER_FORBIDDEN", 403, "관리자 권한이 필요해요.");
  return { client, user };
}
export async function providerRateLimit(request: Request, userId: string, prefix = "provider-write") {
  const result = await checkRateLimitPersistent(rateLimitKey(prefix, request, userId), { maxRequests: prefix === "provider-media" ? 20 : 30, windowMs: 10 * 60 * 1000 });
  if (result) throw new ProviderError(result.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_UNAVAILABLE", result.status, result.status === 429 ? "요청이 많아요. 잠시 후 다시 시도해 주세요." : "지금은 요청을 처리할 수 없어요.");
}
export async function readProviderBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new ProviderError("PROVIDER_TOO_LARGE", 413, "첨부 내용이 너무 커요.");
  if (!request.body) throw new ProviderError("PROVIDER_INVALID_INPUT", 400, "입력 내용이 필요해요.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ProviderError("PROVIDER_TOO_LARGE", 413, "첨부 내용이 너무 커요."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export async function providerBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new ProviderError("PROVIDER_INVALID_INPUT", 400, "JSON 형식의 입력이 필요해요.");
  const bytes = await readProviderBytes(request, 64 * 1024);
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ProviderError("PROVIDER_INVALID_INPUT", 400, "입력 내용을 읽지 못했어요."); }
  return schema.parse(input);
}
const ERROR_MAP: Record<string, [number, string]> = {
  PROVIDER_AUTH_REQUIRED: [401, "로그인이 필요해요."], PROVIDER_EMAIL_REQUIRED: [403, "확인된 이메일이 있는 계정으로 신청해 주세요."],
  PROVIDER_FORBIDDEN: [403, "이 내용을 관리할 권한이 없어요."], PROVIDER_NOT_FOUND: [404, "요청한 내용을 찾을 수 없어요."],
  PROVIDER_INVALID_INPUT: [400, "입력 내용을 확인해 주세요."], PROVIDER_VERSION_CONFLICT: [409, "다른 곳에서 내용이 바뀌었어요. 새로고침 후 확인해 주세요."],
  PROVIDER_NOT_APPROVED: [403, "한방의 등록 승인 후 사용할 수 있어요."], PROVIDER_INVALID_STATE: [409, "현재 상태에서는 처리할 수 없어요. 새로고침 후 확인해 주세요."],
  PROVIDER_MEDIA_LIMIT: [409, "사진은 최대 12장까지 등록할 수 있어요."], PROVIDER_MEDIA_NOT_UPLOADED: [409, "사진 저장이 끝나지 않았어요. 새로고침 후 확인해 주세요."],
  PROVIDER_IDEMPOTENCY_CONFLICT: [409, "같은 요청이 다른 내용으로 접수되었어요. 처리 결과를 먼저 확인해 주세요."],
  PROVIDER_ACCOUNT_DELETION_PENDING: [409, "계정 삭제 중에는 내용을 추가할 수 없어요."],
  PROVIDER_ACCOUNT_DELETING: [409, "계정 삭제 중에는 내용을 추가할 수 없어요."],
  PROVIDER_CONSENT_REQUIRED: [403, "제공자 센터에서 이용약관과 개인정보 처리 동의를 확인해 주세요."],
};
export async function providerRpc(client: SupabaseClient, name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const code = Object.keys(ERROR_MAP).find((candidate) => error.message === candidate || error.message.startsWith(`${candidate}:`));
    if (code) { const [status, message] = ERROR_MAP[code]; throw new ProviderError(code, status, message); }
    throw new ProviderError("PROVIDER_UNAVAILABLE", 503, "지금은 요청 결과를 확인할 수 없어요. 새로고침 후 다시 확인해 주세요.");
  }
  return data;
}
