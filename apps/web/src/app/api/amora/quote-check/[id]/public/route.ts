import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AmoraQuoteCategory, AmoraQuoteRegion } from "@/lib/amora/quoteCheck";
import { normalizePublicQuoteAnalysis } from "@/lib/quoteCheck/publicResult";

export const dynamic = "force-dynamic";

const CATEGORY_SET = new Set<AmoraQuoteCategory>(["sdm_package", "studio", "dress", "makeup"]);
const REGION_SET = new Set<AmoraQuoteRegion>(["seoul", "gyeonggi", "busan", "daegu", "other"]);

// 공개 진단 결과 GET — 개인정보 제거된 요약만 반환.
// 카톡 공유로 친구가 받은 링크로 진입해도 안전하게 볼 수 있도록.
// 사용자 식별 정보(user_id, couple_id, vendor_name, memo, 전체 contractQuestions/negotiationScript)는 제외.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("amora_quote_checks")
      .select("id, category, region, quote_price_manwon, analysis, created_at")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Public quote check fetch error:", error.message);
      return NextResponse.json({ error: "결과를 불러올 수 없습니다." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "결과를 찾을 수 없습니다." }, { status: 404 });
    }

    if (
      !CATEGORY_SET.has(data.category as AmoraQuoteCategory)
      || !REGION_SET.has(data.region as AmoraQuoteRegion)
    ) {
      return NextResponse.json({ error: "결과를 찾을 수 없습니다." }, { status: 404 });
    }

    const analysis = normalizePublicQuoteAnalysis(
      data.analysis,
      data.category as AmoraQuoteCategory,
    );
    if (!analysis) {
      return NextResponse.json({ error: "결과를 찾을 수 없습니다." }, { status: 404 });
    }

    // 공개 가능 필드만 선별 — 개인정보, 협상 스크립트 등은 본인 페이지에서만.
    // 과거 저장분의 점수·판정·고정 중위가도 정규화 단계에서 제거한다.

    return NextResponse.json(
      {
        id: data.id,
        category: data.category,
        region: data.region,
        analysis,
        createdAt: data.created_at,
      },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } }
    );
  } catch {
    // 내부 에러 원문은 노출하지 않는다 (2026-07-23 보안 감사).
    return NextResponse.json({ error: "결과를 불러올 수 없습니다." }, { status: 500 });
  }
}
