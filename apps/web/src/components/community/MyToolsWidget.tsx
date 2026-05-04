"use client";

import Link from "next/link";
import { MessageCircle, Wallet, CalendarCheck, Lock, ArrowRight, Sparkles } from "lucide-react";
import { usePostCount, REQUIRED_POSTS_FOR_TOOLS } from "@/hooks/usePostCount";

interface ToolCard {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TOOLS: ToolCard[] = [
  {
    href: "/chat",
    label: "아모라 상담",
    description: "AI 웨딩 플래너와 24시간 대화",
    icon: MessageCircle,
  },
  {
    href: "/budget",
    label: "예산 관리",
    description: "20개 카테고리 + 시세 비교",
    icon: Wallet,
  },
  {
    href: "/schedule",
    label: "일정 관리",
    description: "D-day 체크리스트 + 캘린더",
    icon: CalendarCheck,
  },
];

/**
 * 커뮤니티 우측 사이드바에 노출되는 "내 도구" 위젯.
 * - 미인증: 로그인 유도
 * - 잠금(글 5개 미만): 진행률 + 글쓰기 CTA
 * - 잠금 해제: 도구 카드 활성화
 * - 데모 모드: 잠금 해제 상태로 노출 (체험)
 */
export default function MyToolsWidget() {
  const { postCount, unlocked, isDemo, loading } = usePostCount();

  const remaining = postCount !== null
    ? Math.max(0, REQUIRED_POSTS_FOR_TOOLS - postCount)
    : REQUIRED_POSTS_FOR_TOOLS;
  const progressPct = postCount !== null
    ? Math.min(100, Math.round((postCount / REQUIRED_POSTS_FOR_TOOLS) * 100))
    : 0;

  return (
    <div className="mb-10">
      <div className="flex items-center gap-2 border-b border-[#e4e2e1] pb-2 mb-4">
        <Sparkles className="w-4 h-4 text-[#C9A96E]" />
        <h3 className="font-serif-kr text-lg text-[#1C1917]">내 도구</h3>
      </div>

      {/* 진행률 배너 (잠금 시에만) */}
      {!unlocked && !loading && postCount !== null && (
        <div className="bg-[#F5F0EE] rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#504444]">잠금 해제 진행률</span>
            <span className="font-serif-kr text-base text-[#795252] font-medium">
              {postCount} / {REQUIRED_POSTS_FOR_TOOLS}
            </span>
          </div>
          <div className="w-full h-1.5 bg-white rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-[#504444] leading-relaxed">
            글 <strong className="text-[#795252]">{remaining}개</strong>만 더 쓰면 모든 도구가 열려요
          </p>
        </div>
      )}

      {/* 도구 카드 */}
      <div className="space-y-2">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const enabled = unlocked || isDemo;

          return (
            <Link
              key={tool.href}
              href={enabled ? tool.href : "/community/post/write"}
              className={`group flex items-start gap-3 p-3 rounded-xl transition-all ${
                enabled
                  ? "bg-white hover:bg-[#F5F0EE]/60 shadow-sm"
                  : "bg-[#F5F0EE]/40"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  enabled
                    ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white"
                    : "bg-white/60 text-[#B5ADA3]"
                }`}
              >
                {enabled ? <Icon className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-sm font-medium ${
                      enabled ? "text-[#1C1917]" : "text-[#504444]"
                    }`}
                  >
                    {tool.label}
                  </span>
                  {enabled && (
                    <ArrowRight className="w-3 h-3 text-[#B5ADA3] group-hover:text-[#795252] group-hover:translate-x-0.5 transition-all" />
                  )}
                </div>
                <p
                  className={`text-xs mt-0.5 leading-snug ${
                    enabled ? "text-[#504444]" : "text-[#B5ADA3]"
                  }`}
                >
                  {enabled ? tool.description : "글 5개 작성 후 사용 가능"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* CTA */}
      {!unlocked && !isDemo && (
        <Link
          href="/community/post/write"
          className="mt-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-sm font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.3)] transition-all"
        >
          지금 글 쓰러 가기
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  );
}
