import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { sendVendorApprovalEmail, sendVendorRejectionEmail } from "@/lib/resend";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const password = req.headers.get("x-admin-password");
    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { action, reason } = await req.json();

    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "유효하지 않은 액션입니다." }, { status: 400 });
    }

    const supabase = getServiceClient();
    const newStatus = action === "approve" ? "approved" : "rejected";

    const updateData: Record<string, unknown> = { status: newStatus };
    if (action === "reject" && reason) {
      updateData.rejection_reason = reason;
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
      } else {
        await sendVendorRejectionEmail(vendorEmail, vendorName, reason);
      }
    }

    return NextResponse.json({ vendor, message: `업체가 ${action === "approve" ? "승인" : "반려"}되었습니다.` });
  } catch (err) {
    console.error("Admin vendor action error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
