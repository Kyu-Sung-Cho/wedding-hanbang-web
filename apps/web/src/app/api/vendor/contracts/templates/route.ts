// 업체 커스텀 계약 템플릿 CRUD
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  VendorContractTemplateRow,
  vendorContractTemplateRowToModel,
} from "@/types/contract.types";

// 업체 인증 헬퍼
async function getVendor(supabase: ReturnType<typeof createClient> extends Promise<infer R> ? R : never) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, category")
    .eq("owner_id", user.id)
    .single();
  return vendor;
}

// GET: 업체의 커스텀 템플릿 목록
export async function GET() {
  try {
    const supabase = await createClient();
    const vendor = await getVendor(supabase);
    if (!vendor) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("vendor_contract_templates")
      .select("*")
      .eq("vendor_id", vendor.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const templates = (data as VendorContractTemplateRow[]).map(vendorContractTemplateRowToModel);
    return NextResponse.json({ templates });
  } catch (err) {
    console.error("업체 템플릿 조회 에러:", err);
    return NextResponse.json({ error: "템플릿 조회에 실패했습니다." }, { status: 500 });
  }
}

// POST: 새 커스텀 템플릿 생성
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const vendor = await getVendor(supabase);
    if (!vendor) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const { baseTemplateId, title, content, cancellationPolicy, depositRate, isDefault } = body;

    if (!title || !content || content.length === 0) {
      return NextResponse.json({ error: "제목과 내용은 필수입니다." }, { status: 400 });
    }

    // 기본 템플릿으로 설정 시 기존 기본을 해제
    if (isDefault) {
      await supabase
        .from("vendor_contract_templates")
        .update({ is_default: false })
        .eq("vendor_id", vendor.id)
        .eq("is_default", true);
    }

    const { data, error } = await supabase
      .from("vendor_contract_templates")
      .insert({
        vendor_id: vendor.id,
        base_template_id: baseTemplateId || null,
        title,
        content,
        cancellation_policy: cancellationPolicy || [],
        deposit_rate: depositRate ?? 0.3,
        is_default: isDefault ?? false,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      template: vendorContractTemplateRowToModel(data as VendorContractTemplateRow),
    });
  } catch (err) {
    console.error("업체 템플릿 생성 에러:", err);
    return NextResponse.json({ error: "템플릿 생성에 실패했습니다." }, { status: 500 });
  }
}
