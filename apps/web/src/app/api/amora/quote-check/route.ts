import { NextRequest, NextResponse } from "next/server";

import {
  analyzeAmoraQuoteCheck,
  type AmoraQuoteCategory,
  type AmoraQuoteCheckInput,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  isRecord,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { sanitizeText } from "@/utils/sanitize";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";

const CATEGORY_SET = new Set<AmoraQuoteCategory>(["sdm_package", "studio", "dress", "makeup"]);
const REGION_SET = new Set<AmoraQuoteRegion>(["seoul", "gyeonggi", "busan", "daegu", "other"]);
const MAX_BODY_BYTES = 16 * 1024;

class QuoteCheckInputError extends Error {}

interface QuoteCheckBody {
  category?: unknown;
  region?: unknown;
  quotePriceManwon?: unknown;
  includedItemIds?: unknown;
  notNeededItemIds?: unknown;
}

function parseItemIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string")
      .map((item) => sanitizeText(item))
      .filter(Boolean)
      .slice(0, 80)
    : [];
}

function parseBody(body: QuoteCheckBody): AmoraQuoteCheckInput {
  const category = body.category;
  const region = body.region;
  const hasQuotePrice = body.quotePriceManwon !== undefined;
  const quotePriceManwon = hasQuotePrice && typeof body.quotePriceManwon === "number"
    ? body.quotePriceManwon
    : 0;

  if (!CATEGORY_SET.has(category as AmoraQuoteCategory)) {
    throw new QuoteCheckInputError("지원하지 않는 견적 분야입니다.");
  }
  if (!REGION_SET.has(region as AmoraQuoteRegion)) {
    throw new QuoteCheckInputError("지원하지 않는 지역입니다.");
  }
  if (
    hasQuotePrice
    && (
      typeof body.quotePriceManwon !== "number"
      || !Number.isFinite(quotePriceManwon)
      || quotePriceManwon <= 0
      || quotePriceManwon > 10_000
    )
  ) {
    throw new QuoteCheckInputError("견적 금액은 1만원 이상 1억원 이하로 입력해 주세요.");
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
    if (!isTrustedMutationRequest(req)) {
      return NextResponse.json(
        { error: "신뢰할 수 없는 요청입니다." },
        { status: 403, headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
    }

    const rawBody = await readBoundedUtf8Text(req, MAX_BODY_BYTES);
    if (!rawBody.ok) {
      return NextResponse.json(
        { error: rawBody.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "잘못된 요청입니다." },
        { status: rawBody.reason === "too_large" ? 413 : 400 },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.text);
    } catch {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const input = parseBody(body);
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const limited = await checkRateLimitPersistent(rateLimitKey("amora:quote-check", req, user?.id), {
      maxRequests: user ? 40 : 12,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    const analysis = analyzeAmoraQuoteCheck(input);

    return NextResponse.json(
      { analysis, storageStatus: "not_stored" as const },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (err) {
    const message = err instanceof QuoteCheckInputError
      ? err.message
      : "체크리스트 결과를 가져오지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
