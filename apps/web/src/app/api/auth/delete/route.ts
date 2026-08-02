import { NextResponse } from "next/server";

import {
  AccountDeletionStorageError,
  requestAccountDeletion,
} from "@/lib/accountDeletion/communityStorageSaga";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 8 * 1024;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const ACCOUNT_DELETION_REASON_CODES = new Set([
  "unknown",
  "unsatisfied",
  "alternative",
  "wedding_done",
  "privacy",
  "low_usage",
  "other",
  "mobile_request",
]);

function accountDeletionReasonCode(value: unknown): string {
  return typeof value === "string" && ACCOUNT_DELETION_REASON_CODES.has(value)
    ? value
    : "unknown";
}

export async function DELETE(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    // Intake is a separate boundary from worker progression. During an
    // expand-only release we must be able to deploy the durable saga without
    // creating jobs, upload fences, or logout side effects before the legal
    // and manual-review operating policy is approved.
    if (process.env.ACCOUNT_DELETION_INTAKE_ENABLED !== "true") {
      return NextResponse.json(
        {
          error: "자동 계정 삭제 접수를 점검 중이에요. support@hanbang.ai로 요청해 주시면 확인 후 안내해 드릴게요.",
          code: "ACCOUNT_DELETION_INTAKE_DISABLED",
          supportEmail: "support@hanbang.ai",
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json(
        { error: "요청 데이터가 너무 큽니다." },
        { status: 413, headers: NO_STORE_HEADERS },
      );
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const limited = await checkRateLimitPersistent(rateLimitKey("auth:delete", request, user.id), {
      maxRequests: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    let reason = "unknown";
    try {
      const body = await request.json();
      reason = isRecord(body)
        ? accountDeletionReasonCode(body.reason)
        : "unknown";
    } catch {
      // A reason is optional; the durable deletion boundary is not.
    }

    const result = await requestAccountDeletion(
      createAdminClient(),
      user.id,
      reason,
      Date.now(),
      {
        processImmediately:
          process.env.ACCOUNT_DELETION_CRON_ENABLED === "true",
      },
    );
    if (result.status === "completed") {
      return NextResponse.json(
        { success: true, pending: false },
        { headers: NO_STORE_HEADERS },
      );
    }
    if (result.status === "manual_review") {
      return NextResponse.json(
        {
          success: false,
          pending: true,
          code: "ACCOUNT_DELETION_REVIEW_REQUIRED",
          message: "안전한 삭제를 위해 확인이 필요한 파일이 있어 검토 중이에요.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      {
        success: false,
        pending: true,
        code: "ACCOUNT_DELETION_PENDING",
        message: "계정 삭제를 안전하게 처리 중이에요. 처리 중에는 새 파일 업로드가 제한돼요.",
      },
      { status: 202, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[auth/delete] durable deletion request failed", {
      code: error instanceof AccountDeletionStorageError
        ? error.code
        : "account_deletion_request_failed",
    });
    return NextResponse.json(
      { error: "계정 삭제 요청을 시작하지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
