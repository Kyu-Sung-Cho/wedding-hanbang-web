"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Wallet, CalendarCheck, Lock, ArrowRight, Sparkles, X, MessageSquarePlus } from "lucide-react";
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
 * 커뮤니티 좌측 사이드바 "내 도구" 위젯.
 *
 * 동작:
 * - 잠금 풀린 카드 클릭 → 해당 도구 페이지로 이동
 * - 잠금 카드 클릭 → 모달 팝업 (진행률 + "글쓰기로 가기" CTA)
 * - 5개 작성 후 삭제로 다시 5개 미만이 되면 잠금 자동 복귀 → 다시 모달
 * - 데모 모드: 항상 잠금 해제
 */
export default function MyToolsWidget() {
  const router = useRouter();
  const { postCount, unlocked, isDemo, loading, refetch } = usePostCount();
  const [modalTool, setModalTool] = useState<ToolCard | null>(null);

  const remaining = postCount !== null
    ? Math.max(0, REQUIRED_POSTS_FOR_TOOLS - postCount)
    : REQUIRED_POSTS_FOR_TOOLS;
  const progressPct = postCount !== null
    ? Math.min(100, Math.round((postCount / REQUIRED_POSTS_FOR_TOOLS) * 100))
    : 0;

  const handleClick = (tool: ToolCard) => {
    // 클릭 시 항상 fresh count 재조회 — 글 작성/삭제 직후 정확한 상태 반영
    refetch();
    if (unlocked || isDemo) {
      router.push(tool.href);
    } else {
      setModalTool(tool);
    }
  };

  return (
    <>
      <div className="mb-10">
        <div className="flex items-center gap-2 border-b border-[#e4e2e1] pb-2 mb-4">
          <Sparkles className="w-4 h-4 text-[#C9A96E]" />
          <h3 className="font-serif-kr text-lg text-[#1C1917]">내 도구</h3>
        </div>

        {/* 도구 카드 — 항상 클릭 가능 */}
        <div className="space-y-2">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            const enabled = unlocked || isDemo;

            return (
              <button
                key={tool.href}
                type="button"
                onClick={() => handleClick(tool)}
                disabled={loading}
                className={`group w-full flex items-start gap-3 p-3 rounded-xl transition-all text-left ${
                  enabled
                    ? "bg-white hover:bg-[#F5F0EE]/60 shadow-sm"
                    : "bg-[#F5F0EE]/40 hover:bg-[#F5F0EE]/80"
                } ${loading ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
              >
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    enabled
                      ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white"
                      : "bg-white/80 text-[#795252]"
                  }`}
                >
                  {enabled ? <Icon className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-[#1C1917]">
                      {tool.label}
                    </span>
                    <ArrowRight className="w-3 h-3 text-[#B5ADA3] group-hover:text-[#795252] group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <p className="text-xs text-[#504444] mt-0.5 leading-snug">
                    {tool.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 잠금 모달 — 카드 클릭 시 표시 */}
      {modalTool && (
        <LockModal
          tool={modalTool}
          postCount={postCount ?? 0}
          remaining={remaining}
          progressPct={progressPct}
          onClose={() => setModalTool(null)}
        />
      )}
    </>
  );
}

interface LockModalProps {
  tool: ToolCard;
  postCount: number;
  remaining: number;
  progressPct: number;
  onClose: () => void;
}

function LockModal({ tool, postCount, remaining, progressPct, onClose }: LockModalProps) {
  const Icon = tool.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl p-8 sm:p-10 max-w-md w-full shadow-[0_20px_60px_rgba(0,0,0,0.15)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 닫기 */}
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-[#B5ADA3] hover:text-[#795252] hover:bg-[#F5F0EE] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* 아이콘 */}
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#795252]/15 to-[#946a6a]/10 flex items-center justify-center mx-auto mb-5">
          <Icon className="w-6 h-6 text-[#795252]" />
        </div>

        {/* 라벨 */}
        <p className="text-xs tracking-[0.25em] uppercase text-[#795252] font-medium text-center mb-2">
          Community First
        </p>

        {/* 제목 */}
        <h2 className="font-serif-kr text-2xl text-[#1C1917] font-light text-center mb-3 leading-snug">
          {tool.label}은<br />글 5개부터 시작해요
        </h2>

        {/* 설명 */}
        <p className="text-sm text-[#504444] leading-relaxed text-center mb-6 max-w-xs mx-auto">
          먼저 커뮤니티에 결혼 준비 이야기를 5개 나눠 주세요.
          <br />
          <span className="text-[#795252] font-medium">나누면 받습니다.</span>
        </p>

        {/* 진행률 */}
        <div className="bg-[#F5F0EE] rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-[#504444]">내 작성 글</span>
            <span className="font-serif-kr text-2xl text-[#795252] font-medium">
              {postCount} / {REQUIRED_POSTS_FOR_TOOLS}
            </span>
          </div>
          <div className="w-full h-2 bg-white rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-[#504444] text-center">
            <Sparkles className="inline w-3 h-3 text-[#C9A96E] mr-1" />
            앞으로 <strong className="text-[#795252]">{remaining}개</strong>만 더 쓰면 모든 도구가 열려요
          </p>
        </div>

        {/* CTA */}
        <Link
          href="/community/post/write"
          onClick={onClose}
          className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.3)] transition-all"
        >
          <MessageSquarePlus className="w-4 h-4" />
          지금 글 쓰러 가기
          <ArrowRight className="w-4 h-4" />
        </Link>

        {/* 부가 안내 */}
        <p className="text-[11px] text-[#B5ADA3] text-center mt-4 leading-relaxed">
          ※ 베타 단계 정책. 정식 출시 시 잠금이 해제될 수 있습니다.
        </p>
      </div>
    </div>
  );
}
