"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
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

// 레벨별 그라데이션 색상 매핑
const LEVEL_GRADIENTS: Record<number, { from: string; to: string; ring: string }> = {
  1: { from: "from-green-500", to: "to-emerald-400", ring: "ring-green-200" },
  2: { from: "from-blue-500", to: "to-cyan-400", ring: "ring-blue-200" },
  3: { from: "from-violet-500", to: "to-purple-400", ring: "ring-violet-200" },
  4: { from: "from-amber-500", to: "to-yellow-400", ring: "ring-amber-200" },
  5: { from: "from-orange-500", to: "to-red-400", ring: "ring-orange-200" },
  6: { from: "from-red-500", to: "to-rose-400", ring: "ring-red-200" },
};

const LEVEL_BAR_COLORS: Record<number, string> = {
  1: "from-green-400 to-emerald-500",
  2: "from-blue-400 to-cyan-500",
  3: "from-violet-400 to-purple-500",
  4: "from-amber-400 to-yellow-500",
  5: "from-orange-400 to-red-500",
  6: "from-red-400 to-rose-500",
};

export default function GamificationWidget() {
  const [data, setData] = useState<GamificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(true);
  const [xpGain, setXpGain] = useState<number>(0);
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

      // 오늘 첫 방문이면 토스트 + XP 애니메이션
      if (!json.already_logged && json.xp_earned > 0) {
        toast.success(`\uD83D\uDD25 ${json.streak}일 연속 출석! +${json.xp_earned}XP`);
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
      <div className="rounded-xl border border-[#E5E7EB] bg-gradient-to-br from-white to-[#F0F4FF] p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#2563EB] to-[#7C3AED] shadow-lg shadow-blue-200/50">
            <span className="text-2xl">🎮</span>
          </div>
        </div>
        <p className="mb-2 text-center text-base font-bold text-[#1c1c1e]">
          레벨업 & 업적 도전!
        </p>
        <p className="mb-5 text-center text-sm text-[#6B7280] leading-relaxed">
          글 쓰고, 댓글 달고, 추천하면<br />
          XP를 모아 웨딩 레전드가 되세요!
        </p>
        <Link
          href="/login"
          className="block w-full rounded-xl bg-gradient-to-r from-[#2563EB] to-[#7C3AED] px-4 py-3 text-center text-sm font-bold text-white shadow-lg shadow-blue-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-blue-300/50 hover:scale-[1.02] active:scale-[0.98]"
        >
          로그인하고 시작하기
        </Link>
      </div>
    );
  }

  // 로딩 스켈레톤
  if (loading) {
    return (
      <div className="space-y-3">
        {/* 레벨 카드 스켈레톤 */}
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-[#F4F6F8] animate-pulse" />
            <div className="flex-1">
              <div className="h-4 w-24 bg-[#F4F6F8] rounded animate-pulse mb-2" />
              <div className="h-3 w-32 bg-[#F4F6F8] rounded animate-pulse" />
            </div>
          </div>
          <div className="h-2.5 w-full bg-[#F4F6F8] rounded-full animate-pulse mb-3" />
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-1 h-14 bg-[#F4F6F8] rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
        {/* 스트릭 스켈레톤 */}
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="h-4 w-20 bg-[#F4F6F8] rounded animate-pulse mb-3" />
          <div className="h-8 w-16 bg-[#F4F6F8] rounded animate-pulse mb-3" />
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="w-8 h-8 rounded-full bg-[#F4F6F8] animate-pulse" />
            ))}
          </div>
        </div>
        {/* 업적 스켈레톤 */}
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="h-4 w-28 bg-[#F4F6F8] rounded animate-pulse mb-3" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-[#F4F6F8] rounded-lg animate-pulse" />
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
  const unlockedSet = new Set(achievements);
  const gradient = LEVEL_GRADIENTS[levelInfo.current.level] || LEVEL_GRADIENTS[1];
  const barColor = LEVEL_BAR_COLORS[levelInfo.current.level] || LEVEL_BAR_COLORS[1];
  const remainingXP = levelInfo.next ? levelInfo.next.minXP - profile.total_xp : 0;

  // 주간 출석 시각화 (streak % 7 기반)
  const streakDays = streak.current_streak % 7;
  const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];

  // 업적: 언락된 것 + 잠긴 것 합쳐서 표시
  const unlockedAchievements = ACHIEVEMENTS.filter((a) => unlockedSet.has(a.key));
  const lockedAchievements = ACHIEVEMENTS.filter((a) => !unlockedSet.has(a.key));
  const displayAchievements = showAllAchievements
    ? [...unlockedAchievements, ...lockedAchievements]
    : [...unlockedAchievements, ...lockedAchievements].slice(0, 6);

  return (
    <div className="space-y-3">
      {/* Section 1: 레벨 카드 */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm transition-all duration-200">
        <div className="flex items-center gap-3 mb-4">
          {/* 레벨 원형 배지 */}
          <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradient.from} ${gradient.to} shadow-lg ring-4 ${gradient.ring}`}>
            <span className="text-lg font-bold text-white leading-none">
              {levelInfo.current.level}
            </span>
            {xpGain > 0 && (
              <div className="absolute -top-2 -right-2">
                <XPGain amount={xpGain} onComplete={() => setXpGain(0)} />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[#1c1c1e]">
                {levelInfo.current.title}
              </span>
              <span className={`text-xs font-semibold ${levelInfo.current.color}`}>
                Lv.{levelInfo.current.level}
              </span>
            </div>
            {levelInfo.next ? (
              <p className="text-sm text-[#9CA3AF] mt-0.5">
                다음 레벨까지 <span className="font-semibold text-[#6B7280]">{remainingXP} XP</span>
              </p>
            ) : (
              <p className="text-sm text-[#9CA3AF] mt-0.5">최고 레벨 달성!</p>
            )}
          </div>
        </div>

        {/* XP 프로그레스 바 */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-[#9CA3AF] mb-1.5">
            <span className="font-medium">{profile.total_xp} XP</span>
            {levelInfo.next && <span>{levelInfo.next.minXP} XP</span>}
          </div>
          <div className="h-2.5 bg-[#F4F6F8] rounded-full overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-700 ease-out`}
              style={{ width: `${levelInfo.progress}%` }}
            />
          </div>
        </div>

        {/* 활동 통계 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#F8F9FB] rounded-lg transition-all duration-200 hover:bg-[#F0F2F5]">
            <span className="text-sm">📝</span>
            <span className="text-xs text-[#6B7280]">글</span>
            <span className="text-sm font-bold text-[#1c1c1e]">{profile.post_count}</span>
          </div>
          <div className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#F8F9FB] rounded-lg transition-all duration-200 hover:bg-[#F0F2F5]">
            <span className="text-sm">💬</span>
            <span className="text-xs text-[#6B7280]">댓글</span>
            <span className="text-sm font-bold text-[#1c1c1e]">{profile.comment_count}</span>
          </div>
          <div className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#F8F9FB] rounded-lg transition-all duration-200 hover:bg-[#F0F2F5]">
            <span className="text-sm">👍</span>
            <span className="text-xs text-[#6B7280]">추천</span>
            <span className="text-sm font-bold text-[#1c1c1e]">{profile.total_upvotes_received}</span>
          </div>
        </div>
      </div>

      {/* Section 2: 출석 스트릭 & 데일리 */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm transition-all duration-200">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🔥</span>
          <h3 className="text-sm font-bold text-[#1c1c1e]">출석 스트릭</h3>
        </div>

        {/* 스트릭 숫자 강조 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-baseline gap-1">
            <span className={`text-3xl font-bold text-[#1c1c1e] tabular-nums ${streak.current_streak >= 7 ? "animate-flame-pulse" : ""}`}>
              {streak.current_streak}
            </span>
            <span className="text-sm font-semibold text-[#6B7280]">일 연속</span>
          </div>
          <div className="w-px h-6 bg-[#E5E7EB]" />
          <div className="flex items-baseline gap-1">
            <span className="text-xs text-[#9CA3AF]">최장</span>
            <span className="text-sm font-bold text-[#6B7280]">{streak.longest_streak}일</span>
          </div>
        </div>

        {/* 주간 트래커 */}
        <div className="flex items-center justify-between gap-1 mb-3">
          {dayLabels.map((day, i) => {
            const isFilled = i < streakDays || (streakDays === 0 && streak.current_streak >= 7);
            const isToday = i === streakDays && streakDays > 0;
            return (
              <div key={day} className="flex flex-col items-center gap-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200 ${
                    isToday
                      ? "bg-gradient-to-br from-orange-400 to-red-500 text-white shadow-md shadow-orange-200/50 scale-110"
                      : isFilled
                        ? "bg-gradient-to-br from-green-400 to-emerald-500 text-white"
                        : "bg-[#F4F6F8] text-[#D1D5DB]"
                  }`}
                >
                  {isFilled || isToday ? "✓" : ""}
                </div>
                <span className={`text-xs ${isToday ? "font-bold text-[#1c1c1e]" : "text-[#9CA3AF]"}`}>
                  {day}
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-[#9CA3AF] text-center">
          {streak.current_streak >= 30
            ? "🎉 대단해요! 한 달 넘는 꾸준함!"
            : streak.current_streak >= 7
              ? "🔥 일주일 넘었어요! 계속 가보자!"
              : "매일 접속하면 보너스 XP!"}
        </p>
      </div>

      {/* Section 3: 업적 */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm transition-all duration-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🏆</span>
            <h3 className="text-sm font-bold text-[#1c1c1e]">업적</h3>
          </div>
          <span className="text-xs font-semibold text-[#7C3AED] bg-[#F5F3FF] px-2.5 py-1 rounded-full">
            {achievements.length}/{ACHIEVEMENTS.length} 달성
          </span>
        </div>

        {/* 업적 목록 */}
        <div className="space-y-2">
          {displayAchievements.map((ach) => {
            const isUnlocked = unlockedSet.has(ach.key);
            const isSecret = ach.isSecret && !isUnlocked;
            return (
              <div
                key={ach.key}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                  isUnlocked
                    ? "bg-[#F0FDF4] border border-green-200"
                    : "bg-[#F8F9FB] border border-transparent"
                }`}
              >
                <span className={`text-base ${isUnlocked ? "" : isSecret ? "grayscale" : "opacity-40"}`}>
                  {isSecret ? "🦉" : ach.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold truncate ${isUnlocked ? "text-[#1c1c1e]" : "text-[#9CA3AF]"}`}>
                    {isSecret ? "???" : ach.label}
                  </div>
                  <div className={`text-xs truncate ${isUnlocked ? "text-green-600" : "text-[#D1D5DB]"}`}>
                    {isSecret ? "시크릿 업적" : ach.description}
                  </div>
                </div>
                <div className="shrink-0">
                  {isUnlocked ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white text-xs">
                      ✓
                    </span>
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E5E7EB] text-[#9CA3AF] text-xs">
                      🔒
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 전체 업적 보기 토글 */}
        {ACHIEVEMENTS.length > 6 && (
          <button
            onClick={() => setShowAllAchievements(!showAllAchievements)}
            className="mt-3 w-full text-center text-xs font-semibold text-[#7C3AED] hover:text-[#6D28D9] transition-all duration-200 py-2 rounded-lg hover:bg-[#F5F3FF]"
          >
            {showAllAchievements ? "접기" : `전체 업적 보기 →`}
          </button>
        )}
      </div>

      {/* Section 4: 주간 리더보드 */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm transition-all duration-200">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">👑</span>
          <h3 className="text-sm font-bold text-[#1c1c1e]">이번 주 TOP 기여자</h3>
        </div>

        {leaderboard.length === 0 ? (
          <div className="text-center py-6">
            <span className="text-2xl mb-2 block">🏅</span>
            <p className="text-xs text-[#9CA3AF]">이번 주 첫 기여자가 되어보세요!</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {leaderboard.slice(0, 5).map((entry, i) => {
              const rank = i + 1;
              const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
              const avatarLetter = entry.nickname?.charAt(0) || "?";
              const displayXP = entry.weekly_xp ?? entry.total_xp;
              const isCurrentUser = entry.nickname === profile.nickname;
              const maxXP = leaderboard[0]?.weekly_xp ?? leaderboard[0]?.total_xp ?? 1;
              const barWidth = Math.max((displayXP / maxXP) * 100, 8);

              return (
                <div
                  key={entry.user_id}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                    isCurrentUser
                      ? "bg-[#EEF2FF] border border-[#C7D2FE]"
                      : rank <= 3
                        ? "bg-[#FFFBEB]/50"
                        : "hover:bg-[#F8F9FB]"
                  }`}
                >
                  {/* 순위 */}
                  <span className="w-6 text-center text-sm shrink-0">
                    {medal || <span className="text-xs font-bold text-[#9CA3AF]">{rank}</span>}
                  </span>

                  {/* 아바타 */}
                  {entry.avatar_url ? (
                    <Image
                      src={entry.avatar_url}
                      alt={entry.nickname}
                      width={28}
                      height={28}
                      className="w-7 h-7 rounded-full object-cover shrink-0 ring-2 ring-white"
                    />
                  ) : (
                    <span className="flex w-7 h-7 items-center justify-center rounded-full bg-gradient-to-br from-[#E5E7EB] to-[#D1D5DB] text-xs font-bold text-[#6B7280] shrink-0 ring-2 ring-white">
                      {avatarLetter}
                    </span>
                  )}

                  {/* 이름 + XP 바 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm truncate ${isCurrentUser ? "font-bold text-[#4F46E5]" : "font-medium text-[#1c1c1e]"}`}>
                        {entry.nickname}
                        {isCurrentUser && <span className="ml-1 text-xs">(나)</span>}
                      </span>
                      <span className="text-sm font-bold text-[#6B7280] tabular-nums shrink-0 ml-2">
                        {displayXP.toLocaleString()} XP
                      </span>
                    </div>
                    <div className="h-1.5 bg-[#F4F6F8] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          rank === 1
                            ? "bg-gradient-to-r from-amber-400 to-yellow-300"
                            : rank === 2
                              ? "bg-gradient-to-r from-gray-300 to-gray-400"
                              : rank === 3
                                ? "bg-gradient-to-r from-amber-600 to-amber-500"
                                : "bg-gradient-to-r from-[#C7D2FE] to-[#A5B4FC]"
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
