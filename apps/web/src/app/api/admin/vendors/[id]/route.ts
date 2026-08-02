import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { sendVendorApprovalEmail, sendVendorRejectionEmail } from "@/lib/resend";
import { cleanOptionalText, isRecord, isUuid, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 4 * 1024;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isTrustedMutationRequest(req)) {
      return NextResponse.json({ error: "허용되지 않은 요청 출처입니다." }, { status: 403 });
    }

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "잘못된 업체 ID입니다." }, { status: 400 });
    }

    const { authorized, userId } = await verifyAdmin(req);
    if (!authorized || !userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("admin:vendor-status", req, userId),
      { maxRequests: 30, windowMs: 60 * 60 * 1000 },
    );
    if (limited) return limited;

    const bodyResult = await readBoundedJsonValue(req, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "요청 형식이 올바르지 않습니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    if (!isRecord(bodyResult.value)) {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const action = typeof bodyResult.value.action === "string"
      ? bodyResult.value.action
      : "";
    const reason = cleanOptionalText(bodyResult.value.reason, 1_000);

    if (!["approve", "reject", "revoke"].includes(action)) {
      return NextResponse.json({ error: "유효하지 않은 액션입니다." }, { status: 400 });
    }

    const targetLimited = await checkRateLimitPersistent(
      rateLimitKey("admin:vendor-status:target", req, id),
      { maxRequests: 6, windowMs: 24 * 60 * 60 * 1000 },
    );
    if (targetLimited) return targetLimited;

    const supabase = getServiceClient();
    const newStatus = action === "approve" ? "approved" : action === "revoke" ? "pending" : "rejected";

    const updateData: Record<string, unknown> = { status: newStatus };
    if (action === "reject" && reason) {
      updateData.rejection_reason = reason;
    }
    if (action === "revoke") {
      updateData.rejection_reason = null;
    }

    const { data: vendor, error } = await supabase
      .from("vendors")
      .update(updateData)
      .eq("id", id)
      .neq("status", newStatus)
      .select("id,name,email,status")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "업체 상태 변경에 실패했습니다." }, { status: 500 });
    }
    if (!vendor) {
      return NextResponse.json(
        { error: "이미 적용된 상태이거나 업체를 찾을 수 없습니다." },
        { status: 409 },
      );
    }

    // 알림 이메일 발송
    const vendorEmail = vendor.email;
    const vendorName = vendor.name;

    if (vendorEmail) {
      if (action === "approve") {
        await sendVendorApprovalEmail(vendorEmail, vendorName);
      } else if (action === "reject") {
        await sendVendorRejectionEmail(vendorEmail, vendorName, reason ?? undefined);
      }
    }

    const actionLabel = action === "approve" ? "승인" : action === "revoke" ? "승인 취소" : "반려";
    return NextResponse.json({
      vendor: { id: vendor.id, status: vendor.status },
      message: `업체가 ${actionLabel}되었습니다.`,
    });
  } catch (err) {
    console.error("Admin vendor action error", safeErrorDiagnostic(err));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
