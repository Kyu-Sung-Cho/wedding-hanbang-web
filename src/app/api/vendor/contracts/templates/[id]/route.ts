// 업체 커스텀 계약 템플릿 수정/삭제
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  VendorContractTemplateRow,
  vendorContractTemplateRowToModel,
} from "@/types/contract.types";

async function getVendor(supabase: ReturnType<typeof createClient> extends Promise<infer R> ? R : never) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("owner_id", user.id)
    .single();
  return vendor;
}

// PUT: 템플릿 수정
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const vendor = await getVendor(supabase);
    if (!vendor) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const { title, content, cancellationPolicy, depositRate, isDefault } = body;

    // 기본 템플릿으로 설정 시 기존 기본을 해제
    if (isDefault) {
      await supabase
        .from("vendor_contract_templates")
        .update({ is_default: false })
        .eq("vendor_id", vendor.id)
        .eq("is_default", true);
    }

    // 제공된 필드만 업데이트 (undefined 방지)
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (cancellationPolicy !== undefined) updateData.cancellation_policy = cancellationPolicy;
    if (depositRate !== undefined) updateData.deposit_rate = depositRate;
    if (isDefault !== undefined) updateData.is_default = isDefault;

    const { data, error } = await supabase
      .from("vendor_contract_templates")
      .update(updateData)
      .eq("id", id)
      .eq("vendor_id", vendor.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      template: vendorContractTemplateRowToModel(data as VendorContractTemplateRow),
    });
  } catch (err) {
    console.error("업체 템플릿 수정 에러:", err);
    return NextResponse.json({ error: "템플릿 수정에 실패했습니다." }, { status: 500 });
  }
}

// DELETE: 템플릿 삭제
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const vendor = await getVendor(supabase);
    if (!vendor) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { error } = await supabase
      .from("vendor_contract_templates")
      .delete()
      .eq("id", id)
      .eq("vendor_id", vendor.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("업체 템플릿 삭제 에러:", err);
    return NextResponse.json({ error: "템플릿 삭제에 실패했습니다." }, { status: 500 });
  }
}
