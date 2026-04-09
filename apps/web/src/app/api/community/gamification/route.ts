import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// GET /api/community/gamification
// 유저의 게이미피케이션 데이터 조회 (XP, 레벨, 스트릭, 업적, 리더보드)
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 모든 게이미피케이션 데이터 병렬 조회
    const [profileRes, streakRes, achievementsRes, leaderboardRes] =
      await Promise.all([
        supabase
          .from("community_profiles")
          .select(
            "total_xp, level, nickname, avatar_url, badge, post_count, comment_count, total_upvotes_received"
          )
          .eq("user_id", user.id)
          .single(),
        supabase
          .from("community_streaks")
          .select("*")
          .eq("user_id", user.id)
          .single(),
        supabase
          .from("community_achievements")
          .select("achievement_key, unlocked_at")
          .eq("user_id", user.id),
        supabase.rpc("community_weekly_leaderboard", { p_limit: 5 }),
      ]);

    return NextResponse.json({
      profile: profileRes.data ?? { total_xp: 0, level: 1 },
      streak: streakRes.data ?? {
        current_streak: 0,
        longest_streak: 0,
        total_logins: 0,
      },
      achievements: (achievementsRes.data ?? []).map(
        (a: { achievement_key: string }) => a.achievement_key
      ),
      leaderboard: leaderboardRes.data ?? [],
    });
  } catch (error) {
    console.error("게이미피케이션 데이터 조회 오류:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
