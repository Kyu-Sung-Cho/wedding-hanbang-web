"use client";

import Link from "next/link";
import { Sparkles, Lock, ArrowRight, MessageSquarePlus } from "lucide-react";
import { usePostCount, REQUIRED_POSTS_FOR_TOOLS } from "@/hooks/usePostCount";
import { useAuthStore } from "@/stores/authStore";

interface PostCountGateProps {
  /** 도구 이름 (잠금 화면에 노출) */
  featureName: string;
  /** 도구 설명 (잠금 화면에 노출) */
  featureDescription: string;
  /** 도구 본체 — 잠금 풀리면 렌더 */
  children: React.ReactNode;
}

/**
 * 도구 진입 게이트.
 * 베타 단계: 커뮤니티 글 5개 작성한 사용자만 아모라/예산/일정 도구 사용 가능.
 *
 * 우회 조건:
 * - 데모 모드 (isDemo === true)
 * - 미로그인 (별도 로그인 안내, 게이트 적용 X)
 *
 * 잠금 시: 큰 안내 카드 + 진행률 + "글 쓰러 가기" CTA.
 */
export default function PostCountGate({
  featureName,
  featureDescription,
  children,
}: PostCountGateProps) {
  const { profile, isDemo } = useAuthStore();
  const { postCount, unlocked, loading } = usePostCount();

  // 데모는 우회
  if (isDemo) return <>{children}</>;

  // 미로그인 — 게이트 적용 안 함, 기존 (app) 미들웨어가 처리
  if (!profile) return <>{children}</>;

  // 로딩 중 — children 렌더 막고 placeholder 표시
  if (loading || postCount === null) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#795252] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#B5ADA3]">잠금 상태 확인 중...</p>
        </div>
      </div>
    );
  }

  // 잠금 해제 — 본체 렌더
  if (unlocked) return <>{children}</>;

  // 잠금 화면
  const remaining = REQUIRED_POSTS_FOR_TOOLS - postCount;
  const progressPct = Math.round((postCount / REQUIRED_POSTS_FOR_TOOLS) * 100);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div className="bg-white rounded-2xl p-8 sm:p-12 shadow-[0_8px_30px_rgb(0,0,0,0.04)] text-center">
        {/* 아이콘 */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#795252]/15 to-[#946a6a]/10 flex items-center justify-center mx-auto mb-6">
          <Lock className="w-7 h-7 text-[#795252]" />
        </div>

        {/* 라벨 */}
        <p className="text-xs tracking-[0.25em] uppercase text-[#795252] font-medium mb-3">
          Community First
        </p>

        {/* 제목 */}
        <h1 className="font-serif-kr text-2xl sm:text-3xl text-[#1C1917] font-light mb-3">
          {featureName}은 글 5개부터 시작해요
        </h1>

        {/* 설명 */}
        <p className="text-base text-[#504444] leading-relaxed mb-8 max-w-md mx-auto">
          {featureDescription}
          <br />
          먼저 커뮤니티에 결혼 준비 이야기를 5개 나눠 주세요.
          <br />
          <span className="text-[#795252] font-medium">
            나누면 받습니다.
          </span>
        </p>

        {/* 진행률 */}
        <div className="bg-[#F5F0EE] rounded-xl p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-[#504444]">내 작성 글</span>
            <span className="font-serif-kr text-2xl text-[#795252] font-medium">
              {postCount} / {REQUIRED_POSTS_FOR_TOOLS}
            </span>
          </div>
          <div className="w-full h-2 bg-white rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-sm text-[#504444] mt-3">
            <Sparkles className="inline w-3.5 h-3.5 text-[#C9A96E] mr-1" />
            앞으로 <strong className="text-[#795252]">{remaining}개</strong>만 더 쓰면 모든 도구가 열려요
          </p>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/community/post/write"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.3)] transition-all"
          >
            <MessageSquarePlus className="w-4 h-4" />
            지금 글 쓰러 가기
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/community"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-white text-[#795252] text-base font-medium border border-[#795252]/20 hover:border-[#795252]/40 hover:bg-[#795252]/5 transition-all"
          >
            커뮤니티 둘러보기
          </Link>
        </div>

        {/* 부가 안내 */}
        <p className="text-xs text-[#B5ADA3] mt-8 leading-relaxed">
          ※ 베타 단계 정책. 정식 출시 시 도구 잠금이 해제될 수 있습니다.
        </p>
      </div>
    </div>
  );
}
