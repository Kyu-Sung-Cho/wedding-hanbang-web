import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { QUOTE_CHECK_SURVEY_REFERENCE } from "@/constants/hiddenCosts";

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

    const analysis =
      data.analysis && typeof data.analysis === "object"
        ? (data.analysis as Record<string, unknown>)
        : {};
    const count = (value: unknown) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
    };
    const unconfirmedItemCount = Object.prototype.hasOwnProperty.call(
      analysis,
      "unconfirmedItemCount"
    )
      ? count(analysis.unconfirmedItemCount)
      : count(analysis.missingCriticalCount) +
        count(analysis.missingHighCount) +
        count(analysis.missingMediumCount);
    const storedQuotePrice = Number(data.quote_price_manwon);
    const quotePriceManwon =
      Number.isFinite(storedQuotePrice) && storedQuotePrice > 0 ? storedQuotePrice : 0;

    // 공개 가능 필드만 선별 — 개인정보, 협상 스크립트 등은 본인 페이지에서만.
    // 점수·등급·판정·추정액은 제품에서 제거됨(사실만 노출) — 과거 저장분도 노출하지 않는다.
    const publicAnalysis = {
      category: data.category,
      quotePriceManwon,
      unconfirmedItemCount,
      summaryTitle:
        unconfirmedItemCount > 0
          ? `${unconfirmedItemCount}개 항목의 포함 여부를 더 확인해보세요`
          : "선택한 확인 항목을 모두 포함으로 표시했어요",
      summaryText:
        "체크하지 않은 항목은 미포함 판정이 아니라 사용자가 아직 포함으로 표시하지 않은 항목입니다. 실제 포함 범위와 금액은 업체 답변과 계약서로 확인하세요.",
      sourceNote: `${QUOTE_CHECK_SURVEY_REFERENCE.label}: 스드메 기본금 평균 ${QUOTE_CHECK_SURVEY_REFERENCE.basicPriceManwon}만원, 추가 지불 평균 ${QUOTE_CHECK_SURVEY_REFERENCE.additionalPaymentManwon}만원. ${QUOTE_CHECK_SURVEY_REFERENCE.note}`,
      sourceUrl: QUOTE_CHECK_SURVEY_REFERENCE.url,
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
