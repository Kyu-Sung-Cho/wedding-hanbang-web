// 플랫폼 표준 계약 템플릿 조회 (공개)
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ContractTemplateRow, contractTemplateRowToModel } from "@/types/contract.types";

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");

    let query = supabase
      .from("contract_templates")
      .select("*")
      .eq("is_active", true)
      .order("category")
      .order("version", { ascending: false });

    if (category) {
      query = query.eq("category", category);
    }

    const { data, error } = await query;
    if (error) throw error;

    const templates = (data as ContractTemplateRow[]).map(contractTemplateRowToModel);
    return NextResponse.json({ templates });
  } catch (err) {
    console.error("표준 템플릿 조회 에러:", err);
    return NextResponse.json({ error: "템플릿 조회에 실패했습니다." }, { status: 500 });
  }
}
