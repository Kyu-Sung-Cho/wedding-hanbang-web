import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { verifyRuntimeSupabaseServiceDestination } from "@/lib/supabase/destinationFence";
import { issueDeletionSupportProof } from "@/lib/accountDeletion/supportProof";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { log } from "@/utils/log";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: HEADERS });
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return error("잘못된 요청 출처입니다.", 403);
  const body = await readBoundedUtf8Text(request, 256);
  if (!body.ok) return error("요청 내용을 확인해 주세요.", body.reason === "too_large" ? 413 : 400);
  let value: unknown;
  try { value = JSON.parse(body.text); } catch { return error("요청 내용을 확인해 주세요.", 400); }
  if (!isRecord(value) || Object.keys(value).length !== 1 || value.intent !== "support-identity-only") {
    return error("요청 내용을 확인해 주세요.", 400);
  }
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user || user.is_anonymous) return error("로그인 후 다시 시도해 주세요.", 401);
    const limited = await checkRateLimitPersistent(rateLimitKey("auth:deletion-support-proof", request, user.id), {
      maxRequests: 3, windowMs: 60 * 60 * 1000,
    }, { failClosed: true });
    if (limited) {
      Object.entries(HEADERS).forEach(([name, content]) => limited.headers.set(name, content));
      return limited;
    }
    const destination = verifyRuntimeSupabaseServiceDestination();
    const proof = issueDeletionSupportProof({
      subject: user.id, projectRef: destination.projectRef, secret: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    });
    // 발급만으로 job·업로드 차단·메일·로그아웃을 만들지 않는다.
    return NextResponse.json({ ...proof, ownerId: user.id }, { headers: HEADERS });
  } catch {
    try { log.error("auth/deletion-support-proof", new Error("DELETION_SUPPORT_PROOF_UNAVAILABLE")); } catch { /* 오류 보고 실패가 응답을 깨지 않게 한다. */ }
    return error("확인 코드를 만들지 못했어요. 잠시 후 다시 시도해 주세요.", 503);
  }
}
