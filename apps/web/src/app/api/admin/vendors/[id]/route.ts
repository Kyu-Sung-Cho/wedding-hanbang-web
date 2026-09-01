import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { sendVendorApprovalEmail, sendVendorRejectionEmail } from "@/lib/resend";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { id } = await params;
    const { authorized } = await verifyAdmin(req);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { action, reason } = await req.json();

    if (!["approve", "reject", "revoke"].includes(action)) {
      return NextResponse.json({ error: "유효하지 않은 액션입니다." }, { status: 400 });
    }

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
      .select("*")
      .single();

    if (error || !vendor) {
      return NextResponse.json({ error: "업체 상태 변경에 실패했습니다." }, { status: 500 });
    }

    // 알림 이메일 발송
    const vendorEmail = vendor.email;
    const vendorName = vendor.name;

    if (vendorEmail) {
      if (action === "approve") {
        await sendVendorApprovalEmail(vendorEmail, vendorName);
      } else if (action === "reject") {
        await sendVendorRejectionEmail(vendorEmail, vendorName, reason);
      }
    }

    const actionLabel = action === "approve" ? "승인" : action === "revoke" ? "승인 취소" : "반려";
    return NextResponse.json({ vendor, message: `업체가 ${actionLabel}되었습니다.` });
  } catch (err) {
    log.error("api/admin/vendors/[id]", err);
    console.error("Admin vendor action error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
