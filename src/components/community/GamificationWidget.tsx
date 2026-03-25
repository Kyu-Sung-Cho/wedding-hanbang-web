"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Trophy, Flame, Star } from "lucide-react";
import { getLevelInfo, ACHIEVEMENT_MAP } from "@/constants/achievements";
import { useToast } from "@/components/community/Toast";
import XPGain from "@/components/community/XPGain";

// API 응답 타입
interface GamificationData {
  profile: {
    total_xp: number;
    level: number;
    nickname: string;
    avatar_url: string | null;
    badge: string;
    post_count: number;
    comment_count: number;
    total_upvotes_received: number;
  };
  streak: {
    current_streak: number;
    longest_streak: number;
    total_logins: number;
  };
  achievements: string[];
  leaderboard: {
    user_id: string;
    nickname: string;
    total_xp: number;
    weekly_xp: number;
    level: number;
    avatar_url: string | null;
  }[];
}

interface LoginResponse {
  already_logged: boolean;
  streak: number;
  xp_earned: number;
}

export default function GamificationWidget() {
  const [data, setData] = useState<GamificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(true);
  const [xpGain, setXpGain] = useState<number>(0);
  const loginRecorded = useRef(false);

  const { toast } = useToast();

  // 게이미피케이션 데이터 조회
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/community/gamification");
      if (res.status === 401) {
        setLoggedIn(false);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      // 테이블 미존재 등 오류 무시
    } finally {
      setLoading(false);
    }
  }, []);

  // 출석 체크 (한 번만 실행)
  const recordLogin = useCallback(async () => {
    if (loginRecorded.current) return;
    loginRecorded.current = true;

    try {
      const res = await fetch("/api/community/gamification/login", {
        method: "POST",
      });
      if (!res.ok) return;
      const json: LoginResponse = await res.json();

      // 오늘 첫 방문이면 토스트 + XP 애니메이션
      if (!json.already_logged && json.xp_earned > 0) {
        toast.success(`\uD83D\uDD25 ${json.streak}일 연속 출석! +${json.xp_earned}XP`);
        setXpGain(json.xp_earned);
        // 데이터 갱신하여 XP 반영
        fetchData();
      }
    } catch {
      // 출석 기록 실패 무시
    }
  }, [toast, fetchData]);

  useEffect(() => {
    fetchData();
    recordLogin();
  }, [fetchData, recordLogin]);

  // 비로그인 CTA
  if (!loggedIn) {
    return (
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5">
        <p className="mb-3 text-center text-sm font-semibold text-[#1c1c1e]">
          커뮤니티 레벨업
        </p>
        <p className="mb-4 text-center text-xs text-[#6B7280] leading-relaxed">
          로그인하고 활동하면 XP를 모아<br />레벨을 올릴 수 있어요!
        </p>
        <Link
          href="/login"
          className="block w-full rounded-lg bg-[#2563EB] px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
        >
          로그인하고 레벨업하세요
        </Link>
      </div>
    );
  }

  // 로딩 스켈레톤
  if (loading) {
    return (
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 animate-pulse" />
            <div>
              <div className="h-3 w-16 bg-white/20 rounded animate-pulse mb-1" />
              <div className="h-2 w-10 bg-white/20 rounded animate-pulse" />
            </div>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="h-2 w-full bg-[#F4F6F8] rounded-full animate-pulse" />
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-1 h-12 bg-[#F4F6F8] rounded-lg animate-pulse" />
            ))}
          </div>
          <div className="space-y-1.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 bg-[#F4F6F8] rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 데이터 없음 (테이블 미존재 등)
  if (!data) return null;

  const { profile, streak, achievements, leaderboard } = data;
  const levelInfo = getLevelInfo(profile.total_xp);
  const recentAchievements = achievements.slice(-3).reverse();

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm overflow-hidden">
      {/* 레벨 헤더 */}
      <div className="bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold text-white">
              {levelInfo.current.level}
            </div>
            <div>
              <div className="text-xs font-semibold text-white/90">
                {levelInfo.current.title}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-white/60">
                <span>{profile.total_xp} XP</span>
                {xpGain > 0 && (
                  <XPGain amount={xpGain} onComplete={() => setXpGain(0)} />
                )}
              </div>
            </div>
          </div>
          {streak.current_streak > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-white/15 rounded-full">
              <span className={streak.current_streak > 7 ? "animate-flame-pulse" : ""}>
                <Flame className="w-3 h-3 text-orange-300" />
              </span>
              <span className="text-[10px] font-semibold text-white">
                {streak.current_streak}일
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* XP 프로그레스 바 */}
        <div>
          <div className="flex items-center justify-between text-[10px] text-[#6B7280] mb-1">
            <span>Lv.{levelInfo.current.level}</span>
            {levelInfo.next && <span>Lv.{levelInfo.next.level}</span>}
          </div>
          <div className="h-2 bg-[#F4F6F8] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#7C3AED] to-[#A78BFA] rounded-full transition-all duration-700 ease-out"
              style={{ width: `${levelInfo.progress}%` }}
            />
          </div>
          {levelInfo.next && (
            <div className="text-[10px] text-[#9CA3AF] mt-1 text-right">
              다음 레벨까지 {levelInfo.next.minXP - profile.total_xp} XP
            </div>
          )}
        </div>

        {/* 스트릭 섹션 */}
        <div className="flex items-center gap-3 px-3 py-2.5 bg-[#F4F6F8] rounded-lg">
          <span
            className={`text-xl ${streak.current_streak > 7 ? "animate-flame-pulse" : ""}`}
          >
            {"\uD83D\uDD25"}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#1c1c1e]">
              {streak.current_streak}일 연속 출석
            </p>
            <p className="text-[10px] text-[#6B7280]">
              {streak.current_streak >= 30
                ? "대단해요! 꾸준한 활동!"
                : streak.current_streak >= 7
                  ? "일주일 넘었어요! 계속 가보자!"
                  : "매일 접속하면 보너스 XP!"}
            </p>
          </div>
        </div>

        {/* 활동 통계 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 text-center py-2 bg-[#F4F6F8] rounded-lg">
            <div className="text-xs font-bold text-[#1c1c1e]">
              {profile.post_count}
            </div>
            <div className="text-[10px] text-[#6B7280]">글</div>
          </div>
          <div className="flex-1 text-center py-2 bg-[#F4F6F8] rounded-lg">
            <div className="text-xs font-bold text-[#1c1c1e]">
              {profile.comment_count}
            </div>
            <div className="text-[10px] text-[#6B7280]">댓글</div>
          </div>
          <div className="flex-1 text-center py-2 bg-[#F4F6F8] rounded-lg">
            <div className="text-xs font-bold text-[#1c1c1e]">
              {profile.total_upvotes_received}
            </div>
            <div className="text-[10px] text-[#6B7280]">추천</div>
          </div>
        </div>

        {/* 최근 업적 */}
        {recentAchievements.length > 0 && (
          <div>
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-[#1c1c1e] mb-2">
              <Trophy className="w-3 h-3 text-[#6B7280]" />
              최근 업적
            </h4>
            <div className="space-y-1.5">
              {recentAchievements.map((key) => {
                const ach = ACHIEVEMENT_MAP[key];
                // 비밀 업적 (정의 없는 경우)
                if (!ach) {
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-2 px-2.5 py-1.5 bg-[#F4F6F8] rounded-lg"
                    >
                      <span className="text-sm">{"\u2753"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-[#6B7280] truncate">
                          비밀 업적
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 px-2.5 py-1.5 bg-[#F4F6F8] rounded-lg"
                  >
                    <span className="text-sm">{ach.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-[#1c1c1e] truncate">
                        {ach.label}
                      </div>
                    </div>
                    <span className="text-[10px] text-[#7C3AED] font-medium">
                      +{ach.xpReward}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 주간 리더보드 (top 5) */}
        {leaderboard.length > 0 && (
          <div>
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-[#1c1c1e] mb-2">
              <Star className="w-3 h-3 text-[#6B7280]" />
              주간 랭킹
            </h4>
            <div className="space-y-1">
              {leaderboard.slice(0, 5).map((entry, i) => {
                const rank = i + 1;
                const rankColor =
                  rank === 1
                    ? "text-amber-500"
                    : rank === 2
                      ? "text-gray-400"
                      : rank === 3
                        ? "text-amber-700"
                        : "text-[#6B7280]";
                const avatarLetter = entry.nickname?.charAt(0) || "?";
                const displayXP = entry.weekly_xp ?? entry.total_xp;

                return (
                  <div
                    key={entry.user_id}
                    className="flex items-center gap-2 px-2.5 py-1.5"
                  >
                    <span className={`text-[11px] font-bold w-4 text-center ${rankColor}`}>
                      {rank}
                    </span>
                    {entry.avatar_url ? (
                      <Image
                        src={entry.avatar_url}
                        alt={entry.nickname}
                        width={20}
                        height={20}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-[#E5E7EB] text-[10px] font-bold text-[#6B7280] flex items-center justify-center shrink-0">
                        {avatarLetter}
                      </span>
                    )}
                    <span className="text-xs text-[#1c1c1e] truncate flex-1">
                      {entry.nickname}
                    </span>
                    <span className="text-[10px] text-[#6B7280] font-medium shrink-0">
                      {displayXP.toLocaleString()} XP
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
