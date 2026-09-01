import { NextRequest, NextResponse } from "next/server";
import { log } from "@/utils/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOpenAIResponseWithAudit } from "@/lib/ai/auditedOpenAI";
import { reserveAmoraTurn } from "@/lib/ai/costGuard";
import { verifyAdmin } from "@/lib/utils/adminAuth";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

// 아모라 서비스 계정 ID (환경변수 또는 고정값)
const AMORA_USER_ID = process.env.AMORA_SERVICE_USER_ID ?? "00000000-0000-0000-0000-000000000000";
const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_CHARS = 500;
const MAX_TAGS = 10;
const MAX_TAG_CHARS = 40;
const MAX_COST_CATEGORIES = 12;
const MAX_COST_LABEL_CHARS = 60;
const MAX_MODEL_INPUT_CHARS = 3_000;
const COMMUNITY_AI_COMMENT_MAX_INPUT_TOKENS = 64_000;
const COMMUNITY_AI_COMMENT_MAX_COST_MICROUSD = 88_400;

class CommunityAiCommentUnavailableError extends Error {
  constructor() {
    super("COMMUNITY_AI_COMMENT_UNAVAILABLE");
    this.name = "CommunityAiCommentUnavailableError";
  }
}

function plainText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getServiceClient() {
  return createAdminClient();
}

// 카테고리별 프롬프트 힌트
const CATEGORY_HINTS: Record<string, string> = {
  is_normal: "이 글은 가격/상황이 정상인지 묻는 글입니다. 평균 가격 비교나 숨은 비용 관련 조언을 해주세요.",
  tour_review: "이 글은 업체 투어/이용 후기입니다. 시기별 가격 차이나 패키지 절약 팁을 알려주세요.",
  tips_v2: "이 글은 웨딩 꿀팁입니다. 관련 추가 정보나 주의사항을 알려주세요.",
  ama: "이 글은 결혼 선배의 AMA입니다. 공감하며 추가 팁을 살짝 알려주세요.",
  free: "이 글은 자유게시판 글입니다. 공감하며 따뜻하게 응원해주세요.",
};

const SYSTEM_PROMPT = `당신은 웨딩한방 AI 동반자 '아모라'입니다. 커뮤니티 게시글에 짧고 도움이 되는 댓글을 작성합니다.

규칙:
- 반드시 2-3문장 이내로 작성
- 따뜻하고 친근한 톤 (도움이 되는 친구처럼)
- 광고처럼 느껴지면 안 됨
- 구체적인 숫자/팁이 있으면 포함
- 마지막에 반드시 자연스러운 CTA를 넣되, [amora_cta] 마커로 끝내기
- CTA 예시: "더 자세한 상담은 아모라와 대화해보세요 → [amora_cta]"
- 한국어로만 작성

가격/시세 규칙:
- 출처가 함께 제공되지 않은 평균 가격은 말하지 않기
- "정상/비정상"을 단정하지 말고 "계약 전 확인 필요" 중심으로 안내
- 가격 데이터가 있으면 포함 항목, 미포함 항목, 추가금 상한 확인을 우선 안내
- 확실하지 않은 내용은 확실하지 않다고 말하기`;

export async function POST(req: NextRequest) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { authorized, userId } = await verifyAdmin(req);
    if (!authorized) {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    if (process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED !== "true") {
      return NextResponse.json(
        {
          error: "커뮤니티 AI 댓글 기능이 비활성화되어 있습니다.",
          code: "COMMUNITY_AI_COMMENT_DISABLED",
        },
        { status: 503 }
      );
    }

    const limited = await checkRateLimitPersistent(rateLimitKey("community:ai-comment", req, userId), {
      maxRequests: 30,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    const { postId } = (await req.json()) as { postId: string };

    if (!postId) {
      return NextResponse.json({ error: "postId가 필요합니다." }, { status: 400 });
    }

    const serviceClient = getServiceClient();

    // 게시글 조회 (author_id 포함 — 로깅 추적용)
    const { data: post, error: postError } = await serviceClient
      .from("community_posts")
      .select("id, title, content, category, cost_data, price_data, tags, author_id")
      .eq("id", postId)
      .single();

    if (postError || !post) {
      return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
    }

    // 이미 아모라 댓글이 있는지 확인
    const { data: existingComment } = await serviceClient
      .from("community_comments")
      .select("id")
      .eq("post_id", postId)
      .eq("author_id", AMORA_USER_ID)
      .maybeSingle();

    if (existingComment) {
      return NextResponse.json({ error: "이미 AI 댓글이 존재합니다.", commentId: existingComment.id }, { status: 409 });
    }

    // 카테고리 힌트
    const categoryHint = CATEGORY_HINTS[post.category] ?? CATEGORY_HINTS.free;

    // 비용 데이터 요약
    let costSummary = "";
    if (post.cost_data) {
      const cd = post.cost_data as { totalCost?: number; region?: string; categories?: Array<{ label: string; cost: number }> };
      const totalCost = typeof cd.totalCost === "number" && Number.isFinite(cd.totalCost)
        ? cd.totalCost
        : "미상";
      costSummary = `\n비용 데이터: 총 ${totalCost}만원, 지역: ${plainText(cd.region, 60) || "미상"}`;
      if (cd.categories && cd.categories.length > 0) {
        costSummary += "\n항목: " + cd.categories
          .slice(0, MAX_COST_CATEGORIES)
          .map((c) => `${plainText(c.label, MAX_COST_LABEL_CHARS)} ${Number.isFinite(c.cost) ? c.cost : "미상"}만원`)
          .join(", ");
      }
    }
    if (post.price_data) {
      const pd = post.price_data as { vendor_category?: string; base_price?: number; extra_price?: number; vendor_name?: string };
      const basePrice = typeof pd.base_price === "number" && Number.isFinite(pd.base_price)
        ? pd.base_price
        : "미상";
      const extraPrice = typeof pd.extra_price === "number" && Number.isFinite(pd.extra_price)
        ? pd.extra_price
        : "미상";
      costSummary += `\n가격 데이터: ${plainText(pd.vendor_category, 60)} 기본금 ${basePrice}만원, 추가금 ${extraPrice}만원`;
      if (pd.vendor_name) costSummary += `, 업체: ${plainText(pd.vendor_name, 100)}`;
    }

    // 본문 축약 (너무 긴 글 방지)
    const contentPreview = plainText(post.content, MAX_CONTENT_CHARS);
    const titlePreview = plainText(post.title, MAX_TITLE_CHARS);
    const categoryPreview = plainText(post.category, 40);
    const tagPreview = (Array.isArray(post.tags) ? post.tags : [])
      .slice(0, MAX_TAGS)
      .map((tag) => plainText(tag, MAX_TAG_CHARS))
      .filter(Boolean)
      .join(", ");

    const postContext = `${categoryHint}

제목: ${titlePreview}
카테고리: ${categoryPreview}
태그: ${tagPreview || "없음"}
본문: ${contentPreview}${costSummary}

`.slice(0, MAX_MODEL_INPUT_CHARS);

    const userContent = `${postContext}
위 게시글에 대한 아모라의 짧은 댓글을 작성해주세요. (2-3문장 + CTA)`;

    const message = await createOpenAIResponseWithAudit({
      modelRole: "fast",
      maxInputTokens: COMMUNITY_AI_COMMENT_MAX_INPUT_TOKENS,
      maxOutputTokens: 300,
      instructions: SYSTEM_PROMPT,
      input: userContent,
      // 위의 kill switch 검사 뒤에 DB 조회가 두 번 있다. 그 사이에 기능이 꺼질 수
      // 있으므로 어떤 provider 요청보다 먼저 스위치를 다시 확인한다. 유료 생성
      // 게이트는 토큰 계산 뒤에 오므로 계산 요청을 막지 못한다.
      beforeProviderEgress: () => {
        if (process.env.AMORA_COMMUNITY_AI_COMMENT_ENABLED !== "true") {
          throw new CommunityAiCommentUnavailableError();
        }
      },
      beforeGeneration: async () => {
        let reservation;
        try {
          reservation = await reserveAmoraTurn(serviceClient, {
            coupleId: AMORA_USER_ID,
            isAdmin: false,
            quotaScope: "background",
            maxCostMicrousd: COMMUNITY_AI_COMMENT_MAX_COST_MICROUSD,
          });
        } catch {
          throw new CommunityAiCommentUnavailableError();
        }
        if (!reservation.allowed) {
          throw new CommunityAiCommentUnavailableError();
        }
      },
      audit: {
        userId: post.author_id ?? null,
        interactionType: "community_amora_comment",
        specialistType: "general",
        userInput: null,
        metadata: {
          endpoint: "ai-comment",
          post_id: post.id,
          post_author_id: post.author_id ?? null,
          post_category: post.category,
          comment_position: "top_level",
        },
      },
    });

    const aiText = message.text.trim();

    if (!aiText) {
      return NextResponse.json({ error: "AI 응답 생성 실패" }, { status: 500 });
    }

    // 아모라 프로필 자동 생성 (없을 경우)
    const { data: amoraProfile } = await serviceClient
      .from("community_profiles")
      .select("user_id")
      .eq("user_id", AMORA_USER_ID)
      .maybeSingle();

    if (!amoraProfile) {
      await serviceClient.from("community_profiles").upsert({
        user_id: AMORA_USER_ID,
        nickname: "아모라 AI",
        rank: "master",
        post_count: 0,
        comment_count: 0,
        total_upvotes_received: 0,
        avatar_url: null,
      }, { onConflict: "user_id" });
    }

    // 댓글 저장 (is_ai 플래그 포함)
    const { data: comment, error: commentError } = await serviceClient
      .from("community_comments")
      .insert({
        post_id: postId,
        parent_id: null,
        author_id: AMORA_USER_ID,
        content_origin: "ai",
        content: aiText,
        upvote_count: 0,
        is_deleted: false,
        is_ai: true,
      })
      .select("*")
      .single();

    if (commentError) {
      // 출처 플래그를 저장하지 못한 AI 답변을 일반 회원 답변처럼 남기지 않는다.
      console.error("AI comment origin persistence error:", commentError);
      return NextResponse.json(
        {
          error: "AI 답변의 출처를 안전하게 저장하지 못했습니다.",
          code: "COMMUNITY_AI_ORIGIN_PERSISTENCE_FAILED",
        },
        { status: 500 },
      );
    }

    // comment_count 증가
    await serviceClient
      .from("community_posts")
      .select("comment_count")
      .eq("id", postId)
      .single()
      .then(({ data }) => {
        return serviceClient
          .from("community_posts")
          .update({ comment_count: (data?.comment_count ?? 0) + 1 })
          .eq("id", postId);
      });

    return NextResponse.json({
      comment: {
        ...comment,
        author: {
          nickname: "아모라 AI",
          rank: "master",
          avatar_url: null,
          wedding_year: null,
          wedding_month: null,
        },
        is_ai: true,
      },
    }, { status: 201 });
  } catch (err) {
    log.error("api/community/ai-comment", err);
    if (err instanceof CommunityAiCommentUnavailableError) {
      return NextResponse.json(
        {
          error: "커뮤니티 AI 댓글을 안전하게 생성할 수 없습니다.",
          code: "COMMUNITY_AI_COMMENT_UNAVAILABLE",
        },
        { status: 503 }
      );
    }
    console.error("AI comment generation error:", err);
    return NextResponse.json(
      { error: "AI 댓글 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
