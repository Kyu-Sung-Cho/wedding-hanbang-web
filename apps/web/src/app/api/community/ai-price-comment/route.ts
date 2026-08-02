import { NextRequest, NextResponse } from "next/server";
import type { PriceData } from "@/types/community.types";
import { logAIInteraction, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";
import { createClientFromRequest } from "@/lib/supabase/server";
import { buildSourceBackedPriceComment } from "@/lib/community/priceComment";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const MAX_BODY_BYTES = 24 * 1024;
const PRICE_CATEGORIES = new Set<PriceData["vendor_category"]>([
  "venue",
  "studio",
  "dress",
  "makeup",
  "snap",
  "ring",
  "honeymoon",
  "other",
]);

function invalidBodyResponse(reason?: "too_large" | "read_error") {
  return NextResponse.json(
    { error: reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
    { status: reason === "too_large" ? 413 : 400 },
  );
}

function parsePriceData(value: Record<string, unknown>): PriceData | null {
  const vendorCategory = value.vendor_category;
  const basePrice = value.base_price;
  if (
    typeof vendorCategory !== "string"
    || !PRICE_CATEGORIES.has(vendorCategory as PriceData["vendor_category"])
    || typeof basePrice !== "number"
    || !Number.isFinite(basePrice)
  ) {
    return null;
  }

  const priceData: PriceData = {
    vendor_category: vendorCategory as PriceData["vendor_category"],
    base_price: basePrice,
  };
  if (typeof value.extra_price === "number" && Number.isFinite(value.extra_price)) {
    priceData.extra_price = value.extra_price;
  }
  if (typeof value.vendor_name === "string") priceData.vendor_name = value.vendor_name;
  if (typeof value.region === "string") priceData.region = value.region;
  if (typeof value.details === "string") priceData.details = value.details;
  return priceData;
}

export async function POST(req: NextRequest) {
  try {
    // Charge an IP-scoped ingress bucket before reading or parsing the body so
    // malformed and oversized attempts cannot bypass the shared abuse limit.
    const ingressLimited = await checkRateLimitPersistent(
      rateLimitKey("community:ai-price-comment:ingress", req),
      { maxRequests: 120, windowMs: 60 * 60 * 1000 },
    );
    if (ingressLimited) return ingressLimited;

    const boundedBody = await readBoundedUtf8Text(req, MAX_BODY_BYTES);
    if (!boundedBody.ok) return invalidBodyResponse(boundedBody.reason);

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(boundedBody.text);
    } catch {
      return invalidBodyResponse();
    }
    if (!isRecord(parsedBody) || !isRecord(parsedBody.priceData)) {
      return invalidBodyResponse();
    }
    const priceData = parsePriceData(parsedBody.priceData);
    if (!priceData) {
      return NextResponse.json({ error: "priceData 누락" }, { status: 400 });
    }

    let loggingUserId: string | null = null;
    try {
      const supabase = await createClientFromRequest(req);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      loggingUserId = user?.id ?? null;
    } catch {
      // Anonymous/sessionless requests can still receive deterministic guidance.
    }

    const limited = await checkRateLimitPersistent(rateLimitKey("community:ai-price-comment", req, loggingUserId ?? undefined), {
      maxRequests: loggingUserId ? 80 : 30,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    const startedAt = startLatencyClock();
    const model = "deterministic-price-benchmark-v1";
    const aiComment = buildSourceBackedPriceComment(priceData);

    void logAIInteraction({
      userId: loggingUserId,
      interactionType: "community_amora_comment",
      specialistType: "budget_optimizer",
      userInput: JSON.stringify(priceData),
      aiOutput: JSON.stringify(aiComment),
      latencyMs: elapsedMs(startedAt),
      success: true,
      model,
      metadata: {
        endpoint: "ai-price-comment",
        vendor_category: priceData.vendor_category ?? null,
        region: priceData.region ?? null,
        comment_position: "top_level",
        source_policy: "source_backed_or_unknown",
      },
    });

    return NextResponse.json({ aiComment });
  } catch (err) {
    console.error("AI price comment error:", safeErrorDiagnostic(err));
    void logAIInteraction({
      interactionType: "community_amora_comment",
      success: false,
      errorMessage: "AI_PRICE_COMMENT_FAILED",
      metadata: { endpoint: "ai-price-comment" },
    });
    return NextResponse.json(
      { error: "AI 코멘트 생성 실패" },
      { status: 500 }
    );
  }
}
