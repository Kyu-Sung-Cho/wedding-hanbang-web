import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROFILE_ROLE_HEADERS, ProfileRoleError, isRoleRevision, isConfirmedWeddingRole, readProfileWeddingRole, saveProfileWeddingRole } from "@/lib/profileWeddingRole";
import { isRecord } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { log } from "@/utils/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function response(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: PROFILE_ROLE_HEADERS }); }
function failure(error: unknown) {
  const status = error instanceof ProfileRoleError ? error.status : 503;
  const code = error instanceof ProfileRoleError ? error.code : "PROFILE_ROLE_UNAVAILABLE";
  if (status >= 500) log.error("profile-role:request-failed", new Error(code));
  return response({ code, error: status === 409 ? "다른 곳에서 역할이 바뀌었어요. 다시 불러온 뒤 선택해 주세요."
    : status === 400 || status === 413 ? "신랑·신부·미선택 중 하나를 선택해 주세요." : "역할 저장 결과를 확인하지 못했어요. 다시 시도해 주세요." }, status);
}

export async function GET(request: Request) {
  try {
    const client = await createClientFromRequest(request);
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user || user.is_anonymous) return response({ error: "로그인이 필요해요." }, 401);
    return response(await readProfileWeddingRole(createAdminClient(), user.id));
  } catch (error) { return failure(error); }
}

async function readRole(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new ProfileRoleError("PROFILE_ROLE_INVALID", 400);
  if (Number(request.headers.get("content-length")) > 512) throw new ProfileRoleError("PROFILE_ROLE_INVALID", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ProfileRoleError("PROFILE_ROLE_INVALID", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > 512) { await reader.cancel(); throw new ProfileRoleError("PROFILE_ROLE_INVALID", 413); }
    chunks.push(part.value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ProfileRoleError("PROFILE_ROLE_INVALID", 400); }
  if (!isRecord(body) || Object.keys(body).length !== 3 || !Object.prototype.hasOwnProperty.call(body, "confirmed_role")
    || !Object.prototype.hasOwnProperty.call(body, "expected_revision") || !isConfirmedWeddingRole(body.confirmed_role)
    || !isRoleRevision(body.expected_revision) || typeof body.expected_user_id !== "string"
    || !isRoleRevision(body.expected_user_id)) throw new ProfileRoleError("PROFILE_ROLE_INVALID", 400);
  return { role: body.confirmed_role, revision: body.expected_revision, expectedUserId: body.expected_user_id };
}

export async function PUT(request: Request) {
  if (!isTrustedMutationRequest(request)) return response({ error: "올바르지 않은 요청 출처예요." }, 403);
  try {
    const client = await createClientFromRequest(request);
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user || user.is_anonymous) return response({ error: "로그인이 필요해요." }, 401);
    const limited = await checkRateLimitPersistent(rateLimitKey("profile:wedding-role", request, user.id), { maxRequests: 20, windowMs: 60 * 60 * 1000 }, { failClosed: true });
    if (limited) {
      for (const [name, value] of Object.entries(PROFILE_ROLE_HEADERS)) limited.headers.set(name, value);
      return limited;
    }
    const input = await readRole(request);
    // 쿠키 계정이 바뀌어도 이전 화면의 초안을 새 계정에 다시 지정하지 않는다.
    if (input.expectedUserId !== user.id) throw new ProfileRoleError("PROFILE_ROLE_OWNER_CHANGED", 409);
    return response(await saveProfileWeddingRole(createAdminClient(), user.id, input.role, input.revision));
  } catch (error) { return failure(error); }
}
