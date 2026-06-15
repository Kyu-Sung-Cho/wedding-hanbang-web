"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Sparkles, X, MessageCircle, ArrowRight } from "lucide-react";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";

interface AmoraMessage {
  id: string;
  title: string;
  body: string;
  cta?: { label: string; href: string };
  priority: number; // 높을수록 우선
}

interface AmoraDirectorProps {
  context: "vendors" | "budget" | "schedule" | "dashboard";
  // 컨텍스트별 데이터
  categoryName?: string | null;
  favoriteCount?: number;
  hasPreferences?: boolean;
  budgetOverage?: boolean;
  userName?: string | null;
}

const STORAGE_KEY_SEEN = "hanbang_amora_seen_v1";
const STORAGE_KEY_DISMISSED = "hanbang_amora_dismissed_until";

export default function AmoraDirector({
  context,
  categoryName,
  favoriteCount = 0,
  hasPreferences = false,
  budgetOverage = false,
  userName,
}: AmoraDirectorProps) {
  const [expanded, setExpanded] = useState(false);
  const [currentMsg, setCurrentMsg] = useState<AmoraMessage | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const seenMessages = useRef<Set<string>>(new Set());

  // 초기: 상태 복원
  useEffect(() => {
    let shouldDismiss = false;
    try {
      const seen = JSON.parse(localStorage.getItem(STORAGE_KEY_SEEN) ?? "[]");
      seenMessages.current = new Set(seen);

      const dismissedUntil = parseInt(localStorage.getItem(STORAGE_KEY_DISMISSED) ?? "0");
      if (Date.now() < dismissedUntil) {
        shouldDismiss = true;
      }
    } catch {
      /* ignore */
    }

    if (!shouldDismiss) return;

    const timer = window.setTimeout(() => setDismissed(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 컨텍스트 기반 메시지 선택
  useEffect(() => {
    if (dismissed) return;

    const candidates: AmoraMessage[] = [];

    // 공통: 선호도 없으면 안내
    if (context === "vendors" && !hasPreferences) {
      candidates.push({
        id: "vendors_no_prefs",
        title: "맞춤 추천 받을까요?",
        body: "예산과 스타일을 알려주시면 어울리는 업체에 AI 추천 뱃지를 달아드려요",
        cta: { label: "선호도 설정", href: weddingPath("/settings") },
        priority: 5,
      });
    }

    // 업체 탐색: 첫 방문
    if (context === "vendors") {
      candidates.push({
        id: "vendors_welcome",
        title: `${userName ? userName + "님, " : ""}안녕하세요!`,
        body: "어떤 업체부터 찾아볼까요? 카테고리를 선택하면 제가 팁을 드릴게요",
        priority: 1,
      });
    }

    // 업체 탐색: 카테고리 선택 시
    if (context === "vendors" && categoryName && categoryName !== "전체") {
      candidates.push({
        id: `vendors_category_${categoryName}`,
        title: `${categoryName} 탐색 중이시네요`,
        body: getCategoryTip(categoryName),
        cta: { label: "시세 보기", href: weddingPath("/market-prices") },
        priority: 3,
      });
    }

    // 찜 3개 달성 → 비교 제안
    if (context === "vendors" && favoriteCount >= 3) {
      candidates.push({
        id: "vendors_compare",
        title: `${favoriteCount}곳 찜하셨네요!`,
        body: "투어 가기 전에 제가 가격과 서비스를 비교해드릴까요?",
        cta: { label: "비교해보기", href: weddingPath("/chat") },
        priority: 8,
      });
    }

    // 예산 초과 감지
    if (context === "budget" && budgetOverage) {
      candidates.push({
        id: "budget_overage",
        title: "예산을 넘고 있어요",
        body: "비슷한 가성비 옵션을 제가 찾아드릴 수 있어요",
        cta: { label: "아모라와 상담", href: weddingPath("/chat") },
        priority: 10,
      });
    }

    // 우선순위 높은 + 아직 안 본 메시지 선택
    const unseen = candidates
      .filter((m) => !seenMessages.current.has(m.id))
      .sort((a, b) => b.priority - a.priority);

    const picked = unseen[0] ?? null;
    const timer = window.setTimeout(() => setCurrentMsg(picked), 0);
    return () => window.clearTimeout(timer);
  }, [context, categoryName, favoriteCount, hasPreferences, budgetOverage, userName, dismissed]);

  function markSeen() {
    if (!currentMsg) return;
    seenMessages.current.add(currentMsg.id);
    try {
      localStorage.setItem(STORAGE_KEY_SEEN, JSON.stringify([...seenMessages.current]));
    } catch { /* ignore */ }
  }

  function handleDismiss() {
    markSeen();
    setExpanded(false);
    setCurrentMsg(null);
  }

  function handleDismissForever() {
    // 24시간 동안 안 보이기
    try {
      localStorage.setItem(STORAGE_KEY_DISMISSED, String(Date.now() + 24 * 60 * 60 * 1000));
    } catch { /* ignore */ }
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <div className="fixed bottom-6 right-4 z-40 hidden max-w-[calc(100vw-2rem)] animate-fade-in sm:block sm:right-6">
      {/* 확장된 메시지 패널 */}
      {expanded && currentMsg ? (
        <div className="bg-white rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.12)] w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden border border-[#e4e2e1]/50">
          {/* 헤더 */}
          <div className="flex items-start justify-between p-5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[#dee6c4]" />
              </div>
              <div>
                <p className="text-xs tracking-widest uppercase text-white/70 font-medium">AMORA</p>
                <p className="font-serif-kr text-lg">아모라</p>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="text-white/70 hover:text-white transition-colors p-1"
              aria-label="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 메시지 */}
          <div className="p-5">
            <p className="font-serif-kr text-xl text-[#1b1c1c] mb-2 leading-snug">
              {currentMsg.title}
            </p>
            <p className="text-base text-[#504444] leading-relaxed mb-5">
              {currentMsg.body}
            </p>

            {currentMsg.cta && (
              <Link
                {...weddingLinkProps(currentMsg.cta.href)}
                className="inline-flex items-center gap-2 w-full justify-center px-4 py-3 rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all mb-2"
                onClick={() => markSeen()}
              >
                {currentMsg.cta.label}
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}

            <Link
              {...weddingLinkProps("/chat")}
              className="inline-flex items-center gap-2 w-full justify-center px-4 py-2.5 rounded-xl bg-[#f6f3f2] text-[#504444] text-sm font-medium hover:bg-[#e4e2e1] transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              아모라와 대화하기
            </Link>

            <button
              onClick={handleDismissForever}
              className="w-full mt-3 text-xs text-[#B5ADA3] hover:text-[#504444] transition-colors"
            >
              오늘은 그만 보기
            </button>
          </div>
        </div>
      ) : currentMsg ? (
        // 접힌 상태 — 플로팅 버블
        <button
          onClick={() => setExpanded(true)}
          className="group relative flex items-center gap-3 rounded-full bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-all hover:shadow-[0_12px_32px_rgba(0,0,0,0.16)] sm:max-w-[300px] sm:pr-5"
          aria-label={currentMsg.title}
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center shrink-0 relative">
            <Sparkles className="w-5 h-5 text-[#dee6c4]" />
            {/* 알림 점 */}
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#C9A96E] border-2 border-white animate-pulse" />
          </div>
          <span className="hidden text-left text-base font-medium text-[#1b1c1c] line-clamp-1 sm:block">
            {currentMsg.title}
          </span>
        </button>
      ) : null}
    </div>
  );
}

// 카테고리별 팁 메시지
function getCategoryTip(category: string): string {
  const tips: Record<string, string> = {
    스튜디오: "평균 280만원이에요. 원본 USB/앨범 추가비 꼭 확인하세요",
    드레스: "평균 150만원이고, 속옷·글러브는 별도인 경우가 많아요",
    메이크업: "평균 80만원. 리허설 메이크업이 포함인지 확인해보세요",
    예식장: "대관료 + 식대 조합이 대부분. 최소보증인원도 중요해요",
    한복: "대여 기준 평균 30만원. 양가 혼주 한복도 미리 챙기세요",
    예물: "예산 비중이 큰 편. 스타일을 먼저 정하면 좋아요",
    신혼여행: "비수기 출발이 20~30% 저렴해요",
  };
  return tips[category] ?? "이 카테고리에서 좋은 업체 찾으실 수 있게 도와드릴게요";
}
