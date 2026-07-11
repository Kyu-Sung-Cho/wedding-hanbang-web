import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AmoraQuoteCheckResult } from "@/lib/amora/quoteCheck";

export const dynamic = "force-dynamic";

// Explicitly published diagnosis result GET — returns a privacy-redacted summary only.
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
      .eq("is_public", true)
      .maybeSingle();

    if (error) {
      console.error("[public-quote-check] read_failed");
      return NextResponse.json(
        { error: "결과를 불러올 수 없습니다.", code: "quote_check_unavailable" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ error: "결과를 찾을 수 없습니다." }, { status: 404 });
    }

    const analysis = data.analysis as AmoraQuoteCheckResult;

    // 공개 가능 필드만 선별 — 개인정보, 협상 스크립트 등은 본인 페이지에서만.
    // 점수·등급·판정·추정액은 제품에서 제거됨(사실만 노출) — 과거 저장분도 노출하지 않는다.
    const publicAnalysis = {
      category: analysis.category,
      quotePriceManwon: analysis.quotePriceManwon,
      marketMedianManwon: analysis.marketMedianManwon,
      marketComparatorLabel: analysis.marketComparatorLabel ?? null,
      priceDiffPercent: analysis.priceDiffPercent,
      missingCriticalCount: analysis.missingCriticalCount,
      missingHighCount: analysis.missingHighCount,
      missingMediumCount: analysis.missingMediumCount,
      summaryTitle: analysis.summaryTitle,
      summaryText: analysis.summaryText,
      sourceNote: analysis.sourceNote,
    };

    return NextResponse.json(
      {
        id: data.id,
        category: data.category,
        region: data.region,
        analysis: publicAnalysis,
        createdAt: data.created_at,
      },
      // Revocation must take effect immediately, so bearer-link responses are never cached.
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    console.error("[public-quote-check] request_failed");
    return NextResponse.json(
      { error: "결과를 불러올 수 없습니다.", code: "quote_check_unavailable" },
      { status: 500 }
    );
  }
}
