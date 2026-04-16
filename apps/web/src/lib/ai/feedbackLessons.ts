import { createClient } from "@supabase/supabase-js";

// Service role 클라이언트 (RLS 우회)
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * 커플별 + 전체 사용자의 피드백 학습 내용을 로드
 * 채팅 시스템 프롬프트에 주입하여 AI가 같은 실수를 반복하지 않도록 함
 *
 * @param coupleId - 현재 대화 중인 커플의 ID (null이면 전체 학습만)
 * @returns 학습 내용 문자열 배열 (최대 10개)
 */
export async function loadFeedbackLessons(coupleId: string | null): Promise<string[]> {
  const admin = getServiceClient();
  const lessons: string[] = [];

  try {
    // 1. 커플 전용 피드백: 이 커플이 직접 수정해준 내용 (최근 10개)
    if (coupleId) {
      const { data: coupleFeedback } = await admin
        .from("chat_feedback")
        .select("correction, category, created_at")
        .eq("couple_id", coupleId)
        .eq("rating", "bad")
        .not("correction", "is", null)
        .order("created_at", { ascending: false })
        .limit(10);

      if (coupleFeedback && coupleFeedback.length > 0) {
        // 중복 제거: 동일한 correction은 최근 것만 유지
        const seen = new Set<string>();
        for (const fb of coupleFeedback) {
          const key = (fb.correction as string).trim().toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            const catLabel = fb.category ? ` [${fb.category}]` : "";
            lessons.push(`이 커플 피드백${catLabel}: ${fb.correction}`);
          }
        }
      }
    }

    // 2. 전체 학습: 3명 이상의 사용자가 같은 카테고리에서 부정 피드백을 준 패턴
    // correction 텍스트를 category 기준으로 집계
    const { data: globalFeedback } = await admin
      .from("chat_feedback")
      .select("correction, category, couple_id")
      .eq("rating", "bad")
      .not("correction", "is", null)
      .not("category", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (globalFeedback && globalFeedback.length > 0) {
      // category별로 고유 couple_id 수 집계
      const categoryMap = new Map<string, {
        coupleIds: Set<string>;
        corrections: string[];
      }>();

      for (const fb of globalFeedback) {
        const cat = fb.category as string;
        const correction = fb.correction as string;
        const fbCoupleId = fb.couple_id as string | null;

        if (!categoryMap.has(cat)) {
          categoryMap.set(cat, { coupleIds: new Set(), corrections: [] });
        }

        const entry = categoryMap.get(cat)!;
        if (fbCoupleId) {
          entry.coupleIds.add(fbCoupleId);
        }
        // 중복 correction 방지
        if (!entry.corrections.includes(correction)) {
          entry.corrections.push(correction);
        }
      }

      // 3명 이상 커플이 피드백한 카테고리의 대표 correction 추출
      for (const [cat, entry] of categoryMap) {
        if (entry.coupleIds.size >= 3) {
          // 가장 최근 correction을 대표로 사용
          const representative = entry.corrections[0];
          const globalLesson = `전체 학습 [${cat}]: ${representative} (${entry.coupleIds.size}명 이상 피드백)`;

          // 커플 전용과 중복되지 않으면 추가
          if (!lessons.some((l) => l.includes(representative))) {
            lessons.push(globalLesson);
          }
        }
      }
    }
  } catch (err) {
    // chat_feedback 테이블이 없거나 쿼리 에러 → 빈 배열 반환 (채팅은 정상 작동)
    console.error("피드백 학습 로드 실패 (무시됨):", err);
    return [];
  }

  // 최대 10개로 제한
  return lessons.slice(0, 10);
}
