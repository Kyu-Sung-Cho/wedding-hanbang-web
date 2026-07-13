import { NextRequest, NextResponse } from "next/server";
import {
  analyzeAmoraQuoteCheck,
  type AmoraQuoteCategory,
  type AmoraQuoteCheckInput,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { sanitizeText } from "@/utils/sanitize";

export const dynamic = "force-dynamic";

const CATEGORY_SET = new Set<AmoraQuoteCategory>(["sdm_package", "studio", "dress", "makeup"]);
const REGION_SET = new Set<AmoraQuoteRegion>(["seoul", "gyeonggi", "busan", "daegu", "other"]);
const BOOKING_CHANNEL_SET = new Set(["walk_in", "planner", "agency_package", "platform", "unknown"]);
const QUOTE_STAGE_SET = new Set(["quote_only", "contracted"]);
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

interface QuoteCheckBody {
  category?: string;
  region?: string;
  quotePriceManwon?: number;
  includedItemIds?: string[];
  vendorName?: string;
  memo?: string;
  bookingChannel?: string;
  quoteStage?: string;
  contractYm?: string;
  weddingYm?: string;
  plannerFeeManwon?: number;
  saveToAccount?: boolean;
}

function parseBody(body: QuoteCheckBody): AmoraQuoteCheckInput {
  const category = body.category;
  const region = body.region;
  const quotePriceManwon = Number(body.quotePriceManwon);

  if (!CATEGORY_SET.has(category as AmoraQuoteCategory)) {
    throw new Error("지원하지 않는 견적 카테고리입니다.");
  }

  if (!REGION_SET.has(region as AmoraQuoteRegion)) {
    throw new Error("지원하지 않는 지역입니다.");
  }

  if (!Number.isFinite(quotePriceManwon) || quotePriceManwon <= 0 || quotePriceManwon > 10000) {
    throw new Error("견적 금액은 1만원 이상 1억원 이하로 입력해주세요.");
  }

  return {
    category: category as AmoraQuoteCategory,
    region: region as AmoraQuoteRegion,
    quotePriceManwon,
    includedItemIds: Array.isArray(body.includedItemIds)
      ? body.includedItemIds.map((item) => sanitizeText(String(item))).filter(Boolean).slice(0, 80)
      : [],
    vendorName: body.vendorName ? sanitizeText(body.vendorName).slice(0, 80) : undefined,
    memo: body.memo ? sanitizeText(body.memo).slice(0, 2000) : undefined,
  };
}

// 분포 통계의 조건축 — 엔진 입력이 아니라 저장 조건이라 별도 파싱.
// 미입력은 강제 추정 대신 정직한 결측(unknown/quote_only/null)으로 남긴다.
function parseConditions(body: QuoteCheckBody) {
  const bookingChannel = BOOKING_CHANNEL_SET.has(body.bookingChannel ?? "")
    ? (body.bookingChannel as string)
    : "unknown";
  const quoteStage = QUOTE_STAGE_SET.has(body.quoteStage ?? "")
    ? (body.quoteStage as string)
    : "quote_only";
  const contractYm = body.contractYm && YM_RE.test(body.contractYm) ? body.contractYm : null;
  const weddingYm = body.weddingYm && YM_RE.test(body.weddingYm) ? body.weddingYm : null;
  const fee = Number(body.plannerFeeManwon);
  const plannerFeeManwon = Number.isFinite(fee) && fee >= 0 && fee <= 10000 ? fee : null;
  return { bookingChannel, quoteStage, contractYm, weddingYm, plannerFeeManwon };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const limited = await checkRateLimitPersistent(rateLimitKey("amora:quote-check", req, user?.id), {
      maxRequests: user ? 40 : 12,
      windowMs: 60 * 60 * 1000,
    }, user?.id);
    if (limited) return limited;

    const body = (await req.json()) as QuoteCheckBody;
    const input = parseBody(body);
    const conditions = parseConditions(body);
    const analysis = analyzeAmoraQuoteCheck(input);

    let savedId: string | null = null;
    let saveStatus: "not_requested" | "authentication_required" | "saved" | "save_failed" =
      "not_requested";

    // Result calculation is ephemeral by default. Account storage is performed only
    // after an explicit, boolean opt-in from an authenticated user.
    if (body.saveToAccount === true && !user) {
      saveStatus = "authentication_required";
    } else if (body.saveToAccount === true && user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", user.id)
        .maybeSingle();

      const admin = createAdminClient();

      const { data: saved, error: saveError } = await admin
        .from("amora_quote_checks")
        .insert({
          user_id: user.id,
          couple_id: profile?.couple_id ?? null,
          category: input.category,
          region: input.region,
          vendor_name: input.vendorName ?? null,
          quote_price_manwon: input.quotePriceManwon,
          included_item_ids: input.includedItemIds,
          memo: input.memo ?? null,
          analysis,
          source: "community_quote_check",
          booking_channel: conditions.bookingChannel,
          quote_stage: conditions.quoteStage,
          contract_ym: conditions.contractYm,
          wedding_ym: conditions.weddingYm,
          planner_fee_manwon: conditions.plannerFeeManwon,
          is_public: false,
          published_at: null,
        })
        .select("id")
        .maybeSingle();

      if (saveError) {
        console.warn("Amora quote check save skipped:", saveError.message);
        saveStatus = "save_failed";
      } else {
        savedId = saved?.id ?? null;
        saveStatus = savedId ? "saved" : "save_failed";
      }
    }

    return NextResponse.json(
      { analysis, savedId, saveStatus },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "체크리스트 결과를 가져오지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
