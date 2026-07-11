import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  ACCOUNT_DELETION_ALLOWED_REASONS,
  type AccountDeletionReason,
} from "@/lib/accountDeletion";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { cleanOptionalText, isBodyTooLarge, isRecord } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;
const allowedReasons = new Set<string>(ACCOUNT_DELETION_ALLOWED_REASONS);

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function parseReason(value: unknown): AccountDeletionReason {
  const candidate = cleanOptionalText(value, 40);
  return candidate && allowedReasons.has(candidate)
    ? candidate as AccountDeletionReason
    : "unknown";
}

async function enqueueAccountDeletion(request: Request) {
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
  }

  const supabase = await createClientFromRequest(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const admin = getAdminClient();
  const { data: lifecycle, error: lifecycleError } = await admin
    .from("profiles")
    .select("account_deleting_at")
    .eq("id", user.id)
    .maybeSingle();
  if (lifecycleError) {
    return NextResponse.json(
      { error: "계정 삭제 요청 상태를 확인하지 못했습니다." },
      { status: 503 },
    );
  }

  if (!lifecycle?.account_deleting_at) {
    const limited = checkRateLimit(rateLimitKey("auth:delete", request, user.id), {
      maxRequests: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;
  }

  let reason: AccountDeletionReason = "unknown";
  try {
    const body = await request.json();
    reason = parseReason(isRecord(body) ? body.reason : null);
  } catch {
    // Empty bodies remain supported for older clients.
  }

  const { data, error } = await admin.rpc("request_account_deletion", {
    p_user_id: user.id,
    p_reason: reason,
  });
  if (error || !isRecord(data) || typeof data.job_id !== "string" || typeof data.status !== "string") {
    // Never include the database error or user identifier in the response/log.
    console.error("[account-delete] durable enqueue failed");
    return NextResponse.json(
      { error: "계정 삭제 요청을 안전하게 접수하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  if (data.status === "dead_letter") {
    return NextResponse.json(
      {
        error: "삭제 요청은 보관되어 있지만 자동 처리가 중단되었습니다. 고객센터 확인이 필요합니다.",
        status: "dead_letter",
      },
      { status: 503 },
    );
  }

  // The request is durable at this point. The client can clear its local
  // session immediately; completion no longer depends on browser polling.
  return NextResponse.json(
    {
      queued: true,
      status: data.status,
      retryAfterMs: 300_000,
    },
    { status: 202, headers: { "Retry-After": "300" } },
  );
}

export async function DELETE(request: Request) {
  try {
    return await enqueueAccountDeletion(request);
  } catch {
    console.error("[account-delete] request failed");
    return NextResponse.json(
      { error: "계정 삭제 요청을 안전하게 접수하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}
