import { NextRequest, NextResponse } from "next/server";

import {
  analyzeAmoraQuoteCheck,
  type AmoraQuoteCategory,
  type AmoraQuoteCheckInput,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { sanitizeText } from "@/utils/sanitize";

export const dynamic = "force-dynamic";

const CATEGORY_SET = new Set<AmoraQuoteCategory>(["sdm_package", "studio", "dress", "makeup"]);
const REGION_SET = new Set<AmoraQuoteRegion>(["seoul", "gyeonggi", "busan", "daegu", "other"]);

interface QuoteCheckBody {
  category?: string;
  region?: string;
  quotePriceManwon?: number;
  includedItemIds?: string[];
  notNeededItemIds?: string[];
}

function parseItemIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => sanitizeText(String(item)))
      .filter(Boolean)
      .slice(0, 80)
    : [];
}

function parseBody(body: QuoteCheckBody): AmoraQuoteCheckInput {
  const category = body.category;
  const region = body.region;
  const hasQuotePrice = body.quotePriceManwon !== undefined;
  const quotePriceManwon = hasQuotePrice ? Number(body.quotePriceManwon) : 0;

  if (!CATEGORY_SET.has(category as AmoraQuoteCategory)) {
    throw new Error("지원하지 않는 견적 분야입니다.");
  }
  if (!REGION_SET.has(region as AmoraQuoteRegion)) {
    throw new Error("지원하지 않는 지역입니다.");
  }
  if (
    hasQuotePrice
    && (!Number.isFinite(quotePriceManwon) || quotePriceManwon <= 0 || quotePriceManwon > 10_000)
  ) {
    throw new Error("견적 금액은 1만원 이상 1억원 이하로 입력해 주세요.");
  }

  return {
    category: category as AmoraQuoteCategory,
    region: region as AmoraQuoteRegion,
    quotePriceManwon,
    includedItemIds: parseItemIds(body.includedItemIds),
    notNeededItemIds: parseItemIds(body.notNeededItemIds),
  };
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
    });
    if (limited) return limited;

    const input = parseBody((await req.json()) as QuoteCheckBody);
    const analysis = analyzeAmoraQuoteCheck(input);

    return NextResponse.json(
      { analysis, storageStatus: "not_stored" as const },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "체크리스트 결과를 가져오지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
