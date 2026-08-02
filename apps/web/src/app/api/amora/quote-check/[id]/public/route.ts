import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AmoraQuoteCategory, AmoraQuoteRegion } from "@/lib/amora/quoteCheck";
import { normalizePublicQuoteAnalysis } from "@/lib/quoteCheck/publicResult";
import { isUuid } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkPublicServiceReadRateLimit } from "@/lib/http/publicServiceReadRateLimit";

export const dynamic = "force-dynamic";

const CATEGORY_SET = new Set<AmoraQuoteCategory>(["sdm_package", "studio", "dress", "makeup"]);
const REGION_SET = new Set<AmoraQuoteRegion>(["seoul", "gyeonggi", "busan", "daegu", "other"]);
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function publicJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

// 공개 진단 결과 GET — 개인정보 제거된 요약만 반환.
// 카톡 공유로 친구가 받은 링크로 진입해도 안전하게 볼 수 있도록.
// 사용자 식별 정보(user_id, couple_id, vendor_name, memo, 전체 contractQuestions/negotiationScript)는 제외.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return publicJson({ error: "잘못된 ID입니다." }, 400);
    }

    const limited = await checkPublicServiceReadRateLimit(req, "published-quote-result");
    if (limited) {
      for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
        limited.headers.set(name, value);
      }
      return limited;
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("amora_quote_checks")
      .select("id, category, region, analysis")
      .eq("id", id)
      .not("published_at", "is", null)
      .maybeSingle();

    if (error) {
      console.error("Public quote check fetch error", safeErrorDiagnostic(error));
      return publicJson({ error: "결과를 불러올 수 없습니다." }, 500);
    }

    if (!data) {
      return publicJson({ error: "결과를 찾을 수 없습니다." }, 404);
    }

    if (
      !CATEGORY_SET.has(data.category as AmoraQuoteCategory)
      || !REGION_SET.has(data.region as AmoraQuoteRegion)
    ) {
      return publicJson({ error: "결과를 찾을 수 없습니다." }, 404);
    }

    const analysis = normalizePublicQuoteAnalysis(
      data.analysis,
      data.category as AmoraQuoteCategory,
    );
    if (!analysis) {
      return publicJson({ error: "결과를 찾을 수 없습니다." }, 404);
    }

    // 공개 가능 필드만 선별 — 개인정보, 협상 스크립트 등은 본인 페이지에서만.
    // 과거 저장분의 점수·판정·고정 중위가도 정규화 단계에서 제거한다.

    return publicJson({
      id: data.id,
      category: data.category,
      region: data.region,
      analysis,
    });
  } catch {
    // 내부 에러 원문은 노출하지 않는다 (2026-07-23 보안 감사).
    return publicJson({ error: "결과를 불러올 수 없습니다." }, 500);
  }
}
