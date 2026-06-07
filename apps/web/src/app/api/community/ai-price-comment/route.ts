import { NextRequest, NextResponse } from "next/server";
import type { PriceData } from "@/types/community.types";
import { logAIInteraction, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";
import { createClientFromRequest } from "@/lib/supabase/server";
import { buildSourceBackedPriceComment } from "@/lib/community/priceComment";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { priceData: PriceData };
    const { priceData } = body;

    if (!priceData || typeof priceData.base_price !== "number") {
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

    const limited = checkRateLimit(rateLimitKey("community:ai-price-comment", req, loggingUserId ?? undefined), {
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
    console.error("AI price comment error:", err);
    void logAIInteraction({
      interactionType: "community_amora_comment",
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      metadata: { endpoint: "ai-price-comment" },
    });
    return NextResponse.json(
      { error: "AI 코멘트 생성 실패" },
      { status: 500 }
    );
  }
}
