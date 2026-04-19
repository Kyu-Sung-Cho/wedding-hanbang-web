"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { ACHIEVEMENTS, getLevelInfo } from "@/constants/achievements";
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

// 리더보드 순위 opacity
const RANK_OPACITY: Record<number, string> = {
  1: "opacity-100",
  2: "opacity-80",
  3: "opacity-60",
  4: "opacity-40",
  5: "opacity-30",
};

export default function GamificationWidget() {
  const [data, setData] = useState<GamificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(true);
  const [xpGain, setXpGain] = useState<number>(0);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showAllAchievements, setShowAllAchievements] = useState(false);
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

      if (!json.already_logged && json.xp_earned > 0) {
        toast.success(`${json.streak}일 연속 출석! +${json.xp_earned}XP`);
        setXpGain(json.xp_earned);
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
      <div className="rounded-xl bg-[#FDFCFA] p-8">
        <p className="mb-1 text-center font-serif-kr text-lg italic text-[#1A1A1F]">
          커뮤니티에 참여하세요
        </p>
        <p className="mb-6 text-center text-sm text-[#B5ADA3] leading-relaxed">
          글을 쓰고 댓글을 달면<br />
          활동 기록이 쌓여요
        </p>
        <Link
          href="/login"
          className="block w-full rounded-xl bg-gradient-to-br from-[#C4967E] to-[#9A6B62] px-5 py-3.5 text-center text-sm font-medium text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all duration-200"
        >
          로그인
        </Link>
      </div>
    );
  }

  // 로딩 스켈레톤
  if (loading) {
    return (
      <div className="space-y-10">
        <div className="rounded-xl bg-[#FDFCFA] p-8">
          <div className="h-4 w-16 bg-[#F0EFED] rounded animate-pulse mb-5" />
          <div className="h-3 w-32 bg-[#F0EFED] rounded animate-pulse mb-3" />
          <div className="h-1.5 w-full bg-[#F0EFED] rounded-full animate-pulse mb-5" />
          <div className="flex gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-1">
                <div className="h-5 w-8 bg-[#F0EFED] rounded animate-pulse mb-1" />
                <div className="h-3 w-6 bg-[#F0EFED] rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-[#FDFCFA] p-8">
          <div className="h-4 w-24 bg-[#F0EFED] rounded animate-pulse mb-3" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 bg-[#F0EFED] rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 데이터 없음
  if (!data) return null;

  const { profile, streak, achievements, leaderboard } = data;
  const levelInfo = getLevelInfo(profile.total_xp);
  const unlockedSet = new Set(achievements);

  // 업적: 언락된 것 + 잠긴 것
  const unlockedAchievements = ACHIEVEMENTS.filter((a) => unlockedSet.has(a.key));
  const lockedAchievements = ACHIEVEMENTS.filter((a) => !unlockedSet.has(a.key));
  const allAchievements = [...unlockedAchievements, ...lockedAchievements];
  const displayAchievements = showAllAchievements
    ? allAchievements
    : allAchievements.slice(0, 5);

  return (
    <div className="space-y-10">
      {/* 내 활동 + 업적 */}
      <div className="rounded-xl bg-[#FDFCFA]">
        {/* Section 1: 내 활동 */}
        <div className="p-8">
          <div className="relative">
            <h3 className="font-serif-kr text-lg italic text-[#1A1A1F] border-b border-[#F0EFED] pb-2 mb-5">
              내 활동
            </h3>
            {xpGain > 0 && (
              <div className="absolute top-0 right-0">
                <XPGain amount={xpGain} onComplete={() => setXpGain(0)} />
              </div>
            )}
          </div>

          {/* 레벨 + 프로그레스 */}
          <div className="mb-6">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-sm font-medium text-[#C4967E]">
                Lv. {levelInfo.current.level}
              </span>
              <span className="text-sm text-[#504444]">
                {levelInfo.current.title}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-[#F0EFED] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#C4967E] rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${levelInfo.progress}%` }}
                />
              </div>
              <span className="text-xs text-[#B5ADA3] shrink-0 tabular-nums">
                {profile.total_xp} XP
              </span>
            </div>
          </div>

          {/* 활동 통계 3열 */}
          <div className="flex items-center mb-6">
            <div className="flex-1 text-center">
              <div className="text-lg font-medium text-[#1A1A1F] tabular-nums">
                {profile.post_count}
              </div>
              <div className="text-xs text-[#B5ADA3] tracking-wide">글</div>
            </div>
            <div className="w-px h-8 bg-[#F0EFED]/60" />
            <div className="flex-1 text-center">
              <div className="text-lg font-medium text-[#1A1A1F] tabular-nums">
                {profile.comment_count}
              </div>
              <div className="text-xs text-[#B5ADA3] tracking-wide">댓글</div>
            </div>
            <div className="w-px h-8 bg-[#F0EFED]/60" />
            <div className="flex-1 text-center">
              <div className="text-lg font-medium text-[#1A1A1F] tabular-nums">
                {profile.total_upvotes_received}
              </div>
              <div className="text-xs text-[#B5ADA3] tracking-wide">추천</div>
            </div>
          </div>

          {/* 연속 출석 */}
          <div className="text-sm">
            <span className="text-[#B5ADA3]">연속 출석 </span>
            <span className="font-medium text-[#1A1A1F] tabular-nums">
              {streak.current_streak}일
            </span>
          </div>
        </div>

        {/* 구분: 배경 전환 */}
        <div className="h-px bg-[#F0EFED]/60" />

        <div className="px-8 py-3">
          <button
            onClick={() => setShowAchievements(!showAchievements)}
            className="flex items-center justify-between w-full text-xs text-[#878680] hover:text-[#C4967E] transition-colors duration-200"
          >
            <span className="tracking-wide uppercase">업적 {achievements.length}/{ACHIEVEMENTS.length}</span>
            <span>{showAchievements ? "접기" : "더보기"}</span>
          </button>
        </div>

        {/* Section 2: 업적 (접힌 상태가 기본) */}
        {showAchievements && (
          <div className="px-8 pb-8">
            <div className="space-y-3">
              {displayAchievements.map((ach) => {
                const isUnlocked = unlockedSet.has(ach.key);
                const isSecret = ach.isSecret && !isUnlocked;

                return (
                  <div
                    key={ach.key}
                    className="flex items-center gap-3"
                  >
                    <div className="shrink-0">
                      {isUnlocked ? (
                        <CheckCircle2 className="w-4 h-4 text-[#C4967E]" />
                      ) : (
                        <Circle className="w-4 h-4 text-[#B5ADA3]" />
                      )}
                    </div>

                    <span
                      className={`text-sm shrink-0 ${
                        isUnlocked ? "text-[#1A1A1F]" : "text-[#B5ADA3]"
                      }`}
                    >
                      {isSecret ? "???" : ach.label}
                    </span>

                    <span className="text-xs text-[#B5ADA3] truncate">
                      {isSecret ? "시크릿 업적" : ach.description}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 전체 보기 */}
            {ACHIEVEMENTS.length > 5 && (
              <button
                onClick={() => setShowAllAchievements(!showAllAchievements)}
                className="mt-4 text-xs text-[#C4967E] hover:opacity-80 transition-opacity duration-200"
              >
                {showAllAchievements ? "접기" : "전체 보기"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Section 3: 리더보드 */}
      <div className="rounded-xl bg-[#FDFCFA] p-8">
        <h3 className="font-serif-kr text-lg italic text-[#1A1A1F] border-b border-[#F0EFED] pb-2 mb-5">
          이번 주 활동 랭킹
        </h3>

        {leaderboard.length === 0 ? (
          <p className="text-sm text-[#B5ADA3] py-6 text-center">
            이번 주 첫 기여자가 되어보세요
          </p>
        ) : (
          <div className="space-y-1">
            {leaderboard.slice(0, 5).map((entry, i) => {
              const rank = i + 1;
              const avatarLetter = entry.nickname?.charAt(0) || "?";
              const displayXP = Math.min(entry.weekly_xp ?? 0, entry.total_xp);
              const isCurrentUser = entry.nickname === profile.nickname;
              const opacity = RANK_OPACITY[rank] || "opacity-25";

              return (
                <div
                  key={entry.user_id}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl ${
                    isCurrentUser ? "bg-[#F6F3F2]" : ""
                  }`}
                >
                  {/* 순위: serif italic 18px */}
                  <span className={`w-6 font-serif-kr text-lg italic font-medium shrink-0 text-[#C4967E] tabular-nums ${opacity}`}>
                    {String(rank).padStart(2, "0")}
                  </span>

                  {entry.avatar_url ? (
                    <Image
                      src={entry.avatar_url}
                      alt={entry.nickname}
                      width={28}
                      height={28}
                      className="w-7 h-7 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <span className="flex w-7 h-7 items-center justify-center rounded-full bg-[#F0EFED] text-xs font-medium text-[#878680] shrink-0">
                      {avatarLetter}
                    </span>
                  )}

                  <span className="flex-1 text-sm text-[#1A1A1F] truncate min-w-0">
                    {entry.nickname}
                  </span>

                  <span className="text-xs text-[#B5ADA3] shrink-0 tabular-nums">
                    {displayXP.toLocaleString()} XP
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
