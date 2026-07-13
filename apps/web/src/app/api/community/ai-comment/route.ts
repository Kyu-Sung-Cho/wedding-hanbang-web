import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createOpenAIResponseWithAudit } from "@/lib/ai/auditedOpenAI";
import { verifyAdmin } from "@/lib/utils/adminAuth";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { reserveAmoraProviderCall } from "@/lib/ai/costGuard";

// 아모라 서비스 계정 ID (환경변수 또는 고정값)
const AMORA_USER_ID = process.env.AMORA_SERVICE_USER_ID ?? "00000000-0000-0000-0000-000000000000";
// Hidden community generation is non-essential and lacks the main chat's
// provider lease/deletion lifecycle. Keep code-hard-disabled to cap spend.
const COMMUNITY_AI_COMMENT_ENABLED = false;

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 카테고리별 프롬프트 힌트
const CATEGORY_HINTS: Record<string, string> = {
  is_normal: "이 글은 가격이나 계약 조건을 묻는 글입니다. 좋고 나쁨을 판정하지 말고 포함 범위와 업체에 확인할 질문을 안내하세요.",
  tour_review: "이 글은 업체 투어/이용 후기입니다. 출처 없는 가격 차이나 절감액을 말하지 말고 계약 조건 확인 방법을 안내하세요.",
  tips_v2: "이 글은 웨딩 팁입니다. 사실로 확인할 수 있는 절차와 질문만 안내하세요.",
  ama: "이 글은 결혼 선배의 AMA입니다. 공감하며 추가 팁을 살짝 알려주세요.",
  free: "이 글은 자유게시판 글입니다. 공감하며 따뜻하게 응원해주세요.",
};

const SYSTEM_PROMPT = `당신은 웨딩한방 AI 플래너 '아모라'입니다. 커뮤니티 게시글에 짧고 도움이 되는 댓글을 작성합니다.

규칙:
- 반드시 2-3문장 이내로 작성
- 따뜻하고 친근한 톤 (도움이 되는 친구처럼)
- 광고처럼 느껴지면 안 됨
- 입력에 출처·조사 시점·항목이 함께 제공된 숫자만 같은 범위로 인용
- 마지막에 반드시 자연스러운 CTA를 넣되, [amora_cta] 마커로 끝내기
- CTA 예시: "더 자세한 상담은 아모라와 대화해보세요 → [amora_cta]"
- 한국어로만 작성

가격/시세 규칙:
- 출처가 함께 제공되지 않은 평균 가격은 말하지 않기
- 항목별 발생 비율·필수성·예상 추가금은 제공된 공식 근거 없이는 만들지 않기
- "정상/비정상"을 단정하지 말고 "계약 전 확인 필요" 중심으로 안내
- 가격 데이터가 있으면 포함 항목, 미포함 항목, 추가금 상한 확인을 우선 안내
- 확실하지 않은 내용은 확실하지 않다고 말하기`;

export async function POST(req: NextRequest) {
  if (!COMMUNITY_AI_COMMENT_ENABLED) {
    return NextResponse.json({ error: "커뮤니티 AI 댓글은 현재 비활성화되어 있습니다." }, { status: 503 });
  }
  try {
    const { authorized, userId } = await verifyAdmin(req);
    if (!authorized || !userId) {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const limited = await checkRateLimitPersistent(rateLimitKey("community:ai-comment", req, userId), {
      maxRequests: 30,
      windowMs: 60 * 60 * 1000,
    }, userId);
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
      costSummary = `\n비용 데이터: 총 ${cd.totalCost ?? "미상"}만원, 지역: ${cd.region ?? "미상"}`;
      if (cd.categories && cd.categories.length > 0) {
        costSummary += "\n항목: " + cd.categories.map((c) => `${c.label} ${c.cost}만원`).join(", ");
      }
    }
    if (post.price_data) {
      const pd = post.price_data as { vendor_category?: string; base_price?: number; extra_price?: number; vendor_name?: string };
      costSummary += `\n가격 데이터: ${pd.vendor_category ?? ""} 기본금 ${pd.base_price ?? 0}만원, 추가금 ${pd.extra_price ?? 0}만원`;
      if (pd.vendor_name) costSummary += `, 업체: ${pd.vendor_name}`;
    }

    // 본문 축약 (너무 긴 글 방지)
    const contentPreview = post.content
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    const userContent = `${categoryHint}

제목: ${post.title}
카테고리: ${post.category}
태그: ${(post.tags ?? []).join(", ") || "없음"}
본문: ${contentPreview}${costSummary}

위 게시글에 대한 아모라의 짧은 댓글을 작성해주세요. (2-3문장 + CTA)`;

    const reservation = await reserveAmoraProviderCall(serviceClient, {
      // provider-only 예약에서는 couple 카운터를 사용하지 않는다.
      coupleId: AMORA_USER_ID,
      isAdmin: true,
    });
    if (!reservation.allowed) {
      return NextResponse.json({ error: reservation.message }, { status: 503 });
    }

    const message = await createOpenAIResponseWithAudit({
      modelRole: "fast",
      maxOutputTokens: 300,
      instructions: SYSTEM_PROMPT,
      input: userContent,
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

    const aiText = message.text;

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
        content: aiText,
        upvote_count: 0,
        is_deleted: false,
        is_ai: true,
      })
      .select("*")
      .single();

    if (commentError) {
      // is_ai 컬럼이 없는 경우 fallback (컬럼 미생성 시)
      const { data: fallbackComment, error: fallbackError } = await serviceClient
        .from("community_comments")
        .insert({
          post_id: postId,
          parent_id: null,
          author_id: AMORA_USER_ID,
          content: aiText,
          upvote_count: 0,
          is_deleted: false,
        })
        .select("*")
        .single();

      if (fallbackError) {
        console.error("AI comment insert error:", fallbackError);
        return NextResponse.json({ error: "댓글 저장 실패" }, { status: 500 });
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
          ...fallbackComment,
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
    console.error("AI comment generation error:", err);
    return NextResponse.json(
      { error: "AI 댓글 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
