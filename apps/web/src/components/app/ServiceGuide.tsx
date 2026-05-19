"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Users,
  Wallet,
  MessageCircle,
  AlertTriangle,
  Check,
  RefreshCw,
  Shield,
  Heart,
} from "lucide-react";

const STORAGE_KEY = "hanbang_service_guide_seen";
const TOTAL_SLIDES = 6;

// ─── Slide 1: Welcome ────────────────────────────────────────────────
function SlideWelcome() {
  return (
    <div className="flex flex-col items-center px-6 pt-2 pb-2 sm:pt-4">
      {/* 로고 — 모바일에선 작게 */}
      <div className="relative w-16 h-16 sm:w-24 sm:h-24 mb-4 sm:mb-6">
        <Image
          src="/images/logo-512-transparent.png"
          alt="웨딩한방"
          fill
          className="object-contain"
        />
      </div>

      {/* 타이틀 — 모바일 사이즈 다운 */}
      <h2 className="font-serif-kr text-2xl sm:text-4xl font-normal text-[#1b1c1c] text-center leading-snug mb-2 sm:mb-3">
        결혼 준비,{"\n"}이제 혼자 고민하지 마세요
      </h2>
      <p className="text-sm sm:text-[17px] text-[#504444] text-center mb-5 sm:mb-8">
        웨딩한방이 처음부터 끝까지 함께합니다
      </p>

      {/* 3가지 핵심 가치 */}
      <div className="flex items-stretch gap-3 w-full max-w-[380px] mb-7">
        {[
          { icon: <MessageCircle className="w-6 h-6" />, label: "AI 상담", sub: "24시간 플래너" },
          { icon: <Users className="w-6 h-6" />, label: "커플 연동", sub: "실시간 동기화" },
          { icon: <Wallet className="w-6 h-6" />, label: "예산 관리", sub: "숨은 비용 경고" },
        ].map((item, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center gap-2 py-5 px-2 rounded-2xl bg-[#fcf9f8] border border-[#f6f3f2]"
          >
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#795252] to-[#C9A96E] flex items-center justify-center text-white">
              {item.icon}
            </div>
            <span className="text-base font-medium text-[#1b1c1c]">{item.label}</span>
            <span className="text-sm text-[#B5ADA3]">{item.sub}</span>
          </div>
        ))}
      </div>

      {/* 그라데이션 라인 애니메이션 */}
      <div className="w-full max-w-[300px] h-[2px] rounded-full overflow-hidden bg-[#f6f3f2]">
        <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-[#795252] via-[#C9A96E] to-[#795252] animate-guide-shimmer" />
      </div>
    </div>
  );
}

// ─── Slide 2: Dashboard ──────────────────────────────────────────────
function SlideDashboard() {
  return (
    <div className="flex flex-col items-center px-6 pt-2 pb-2">
      <h2 className="font-serif-kr text-3xl font-normal text-[#1b1c1c] text-center mb-2">
        대시보드
      </h2>
      <p className="text-base text-[#504444] text-center mb-6">
        한눈에 보는 결혼 준비 현황
      </p>

      {/* Mock 대시보드 */}
      <div className="w-full max-w-[380px] flex flex-col gap-3">
        {/* D-day 카드 */}
        <div className="relative">
          <div className="rounded-2xl bg-[#1b1c1c] p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-[#B5ADA3] mb-0.5">우리의 결혼식</p>
              <p className="text-sm text-[#f6f3f2]">2026. 09. 12 (토)</p>
            </div>
            <div className="text-right">
              <span className="font-display text-[40px] font-light leading-none bg-gradient-to-br from-[#795252] to-[#C9A96E] bg-clip-text text-transparent">
                D-149
              </span>
            </div>
          </div>
          {/* 어노테이션 */}
          <div className="absolute -right-1 -top-2 flex items-center gap-1">
            <span className="text-sm text-[#795252] font-medium bg-white/90 rounded-full px-2.5 py-0.5 shadow-sm border border-[#795252]/20">
              결혼까지 남은 날짜
            </span>
          </div>
        </div>

        {/* 진행률 카드 */}
        <div className="relative rounded-2xl bg-white border border-[#f6f3f2] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-base font-medium text-[#1b1c1c]">전체 진행률</span>
            <span className="text-base font-medium text-[#795252]">35%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#f6f3f2] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#795252] to-[#C9A96E]"
              style={{ width: "35%" }}
            />
          </div>
          {/* 어노테이션 */}
          <div className="absolute -left-1 -bottom-2 flex items-center gap-1">
            <span className="text-sm text-[#795252] font-medium bg-white/90 rounded-full px-2.5 py-0.5 shadow-sm border border-[#795252]/20">
              전체 진행 상황
            </span>
          </div>
        </div>

        {/* 카테고리 상태 */}
        <div className="rounded-2xl bg-white border border-[#f6f3f2] p-4">
          <p className="text-sm text-[#504444] mb-3">카테고리 현황</p>
          <div className="flex flex-wrap gap-2">
            {[
              { name: "예식장", status: "done", emoji: "check" },
              { name: "스드메", status: "progress", emoji: "refresh" },
              { name: "예물", status: "todo", emoji: "empty" },
              { name: "신혼여행", status: "todo", emoji: "empty" },
              { name: "혼수", status: "progress", emoji: "refresh" },
            ].map((cat, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium ${
                  cat.status === "done"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : cat.status === "progress"
                    ? "bg-amber-50 text-amber-700 border border-amber-200"
                    : "bg-[#fcf9f8] text-[#B5ADA3] border border-[#f6f3f2]"
                }`}
              >
                {cat.status === "done" && <Check className="w-3 h-3" />}
                {cat.status === "progress" && <RefreshCw className="w-3 h-3" />}
                {cat.status === "todo" && <span className="w-3 h-3 rounded-sm border border-[#B5ADA3]/40" />}
                {cat.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Slide 3: AI Amora — Integration Hub ────────────────────────────
function SlideChat() {
  return (
    <div className="flex flex-col items-center px-6 pt-2 pb-2">
      <h2 className="font-serif-kr text-3xl font-normal text-[#1b1c1c] text-center mb-2">
        아모라 — 모든 걸 연결하는 중심
      </h2>
      <p className="text-base text-[#504444] text-center mb-5">
        채팅 한 줄로 견적 체크리스트부터 커플 합의까지
      </p>

      {/* Mock 채팅 UI: 견적 체크리스트 시나리오 */}
      <div className="w-full max-w-[380px] flex flex-col gap-3">
        {/* 유저 메시지 (오른쪽) */}
        <div className="flex justify-end">
          <div className="max-w-[75%] rounded-2xl rounded-tr-md bg-[#1b1c1c] text-white px-4 py-2.5">
            <p className="text-base leading-relaxed">강남 스튜디오 380만원 견적 받았는데 적정해?</p>
          </div>
        </div>

        {/* AI 메시지 (왼쪽) */}
        <div className="flex justify-start gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#795252] to-[#C9A96E] flex items-center justify-center flex-shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col gap-2 max-w-[80%]">
            <div className="rounded-2xl rounded-tl-md bg-[#fcf9f8] border border-[#f6f3f2] px-4 py-2.5">
              <p className="text-base text-[#1b1c1c] leading-relaxed">
                기본가는 적정. 다만 <span className="font-semibold text-amber-700">원본 데이터 비용</span>이 빠져 있어요.
              </p>
            </div>

            {/* 통합 액션 — 아모라가 한 번에 해주는 것들 */}
            <div className="rounded-xl bg-white border border-[#f6f3f2] p-3 shadow-sm">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sage-500 shrink-0" />
                  <span className="text-sm text-[#504444]">예산 항목에 <span className="text-[#1b1c1c] font-medium">스튜디오 380만원</span> 자동 추가</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sage-500 shrink-0" />
                  <span className="text-sm text-[#504444]"><span className="text-[#1b1c1c] font-medium">상담 일정</span> 캘린더에 등록</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-sage-500 shrink-0" />
                  <span className="text-sm text-[#504444]">파트너에게 보낼 <span className="text-[#1b1c1c] font-medium">메시지 초안</span> 작성</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 통합 영역 칩 — 아모라가 챙겨주는 전 영역 */}
        <div className="mt-1">
          <p className="text-sm text-[#928980] mb-1.5 text-center">아모라가 다 챙겨줘요</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {[
              "견적 체크리스트",
              "계약서 풀이",
              "예산 자동",
              "일정 자동",
              "양가·상견례 코칭",
              "본식 식순 가이드",
              "숨은 비용 경고",
            ].map((label) => (
              <span
                key={label}
                className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#fcf9f8] border border-[#f6f3f2] text-sm text-[#504444]"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Slide 4: Budget ─────────────────────────────────────────────────
function SlideBudget() {
  return (
    <div className="flex flex-col items-center px-6 pt-2 pb-2">
      <h2 className="font-serif-kr text-3xl font-normal text-[#1b1c1c] text-center mb-2">
        예산 관리
      </h2>
      <p className="text-base text-[#504444] text-center mb-6">
        숨은 비용까지 관리
      </p>

      {/* Mock 예산 UI */}
      <div className="w-full max-w-[380px] flex flex-col gap-3">
        {/* 총 예산 카드 */}
        <div className="rounded-2xl bg-[#1b1c1c] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-[#B5ADA3]">총 예산</span>
            <span className="text-base font-medium text-[#fcf9f8]">3,000만원</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-[#2A2A30] overflow-hidden">
            <div className="flex h-full">
              <div className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a]" style={{ width: "36%" }} />
              <div className="h-full bg-[#C9A96E]/60" style={{ width: "18%" }} />
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-sm text-[#B5ADA3]">1,080만원 사용</span>
            <span className="text-sm text-[#C9A96E]">540만원 진행중</span>
          </div>
        </div>

        {/* 카테고리 리스트 */}
        <div className="rounded-2xl bg-white border border-[#f6f3f2] overflow-hidden divide-y divide-[#f6f3f2]">
          {[
            {
              name: "예식장",
              spent: 600,
              total: 800,
              tag: "커플",
              tagColor: "bg-[#795252]/10 text-[#795252]",
              warning: false,
            },
            {
              name: "스드메",
              spent: 280,
              total: 350,
              tag: "신부측",
              tagColor: "bg-purple-50 text-purple-600",
              warning: true,
              warningText: "+50~150만원 추가 예상",
            },
            {
              name: "신혼여행",
              spent: 200,
              total: 300,
              tag: "커플",
              tagColor: "bg-[#795252]/10 text-[#795252]",
              warning: false,
            },
          ].map((row, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-base font-medium text-[#1b1c1c]">{row.name}</span>
                  <span className={`text-sm font-medium px-1.5 py-0.5 rounded-full ${row.tagColor}`}>
                    {row.tag === "커플" ? "👫 " : "👰 "}{row.tag}
                  </span>
                </div>
                <span className="text-sm text-[#504444]">
                  <span className="text-[#1b1c1c] font-medium">{row.spent}</span>/{row.total}만원
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[#f6f3f2] overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    row.warning
                      ? "bg-gradient-to-r from-amber-400 to-amber-500"
                      : "bg-gradient-to-r from-[#795252] to-[#C9A96E]"
                  }`}
                  style={{ width: `${(row.spent / row.total) * 100}%` }}
                />
              </div>
              {row.warning && (
                <div className="flex items-center gap-1 mt-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-sm text-amber-600 font-medium">
                    {row.warningText}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 어노테이션 */}
        <div className="flex justify-center">
          <span className="text-sm text-[#795252] font-medium bg-white/90 rounded-full px-3 py-1 shadow-sm border border-[#795252]/20">
            숨은 비용 경고와 양가 분담 추적
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Slide 5: Couple Sync ────────────────────────────────────────────
function SlideCouple() {
  return (
    <div className="flex flex-col items-center px-6 pt-2 pb-2">
      <h2 className="font-serif-kr text-3xl font-normal text-[#1b1c1c] text-center mb-2">
        파트너와 함께
      </h2>
      <p className="text-base text-[#504444] text-center mb-6">
        모든 변경사항이 실시간으로 동기화
      </p>

      {/* Mock 커플 동기화 UI */}
      <div className="w-full max-w-[380px] flex flex-col gap-3">
        {/* 커플 아바타 */}
        <div className="flex items-center justify-center gap-6 py-3">
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center">
              <span className="text-[24px]">👰</span>
            </div>
            <span className="text-base font-medium text-[#1b1c1c]">신부</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <Heart className="w-6 h-6 text-[#795252] animate-guide-pulse" />
            <span className="text-sm text-[#B5ADA3]">연결됨</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#6B8EBD] to-[#8EAED3] flex items-center justify-center">
              <span className="text-[24px]">🤵</span>
            </div>
            <span className="text-base font-medium text-[#1b1c1c]">신랑</span>
          </div>
        </div>

        {/* 활동 피드 */}
        <div className="rounded-2xl bg-white border border-[#f6f3f2] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#f6f3f2] bg-[#fcf9f8]">
            <p className="text-sm text-[#504444] font-medium">최근 활동</p>
          </div>
          {[
            {
              avatar: "🤵",
              bgColor: "bg-[#6B8EBD]/10",
              text: "신랑이 예식장을 '진행중'으로 변경했어요",
              time: "2분 전",
            },
            {
              avatar: "👰",
              bgColor: "bg-[#795252]/10",
              text: "신부가 스튜디오 예산을 수정했어요",
              time: "15분 전",
            },
            {
              avatar: "🤵",
              bgColor: "bg-[#6B8EBD]/10",
              text: "신랑이 메모를 남겼어요: \"여기 좋은 것 같아!\"",
              time: "1시간 전",
            },
          ].map((item, i) => (
            <div
              key={i}
              className={`flex items-start gap-2.5 px-4 py-3 ${
                i < 2 ? "border-b border-[#f6f3f2]" : ""
              }`}
            >
              <div className={`w-8 h-8 rounded-full ${item.bgColor} flex items-center justify-center flex-shrink-0`}>
                <span className="text-base">{item.avatar}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base text-[#1b1c1c] leading-relaxed">{item.text}</p>
                <p className="text-sm text-[#B5ADA3] mt-0.5">{item.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Slide 6: Get Started ────────────────────────────────────────────
function SlideStart({ onStart, neverShow, onNeverShowChange }: {
  onStart: () => void;
  neverShow: boolean;
  onNeverShowChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col items-center px-6 pt-6 pb-2">
      {/* 로고 */}
      <div className="relative w-24 h-24 mb-6">
        <Image
          src="/images/logo-512-transparent.png"
          alt="웨딩한방"
          fill
          className="object-contain"
        />
      </div>

      <h2 className="font-serif-kr text-4xl font-normal text-[#1b1c1c] text-center leading-snug mb-3">
        준비되셨나요?
      </h2>
      <p className="text-[17px] text-[#504444] text-center mb-8">
        무료로 모든 기능을 이용할 수 있어요
      </p>

      {/* CTA 버튼 */}
      <button
        onClick={onStart}
        className="w-full max-w-[320px] py-3.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-base font-medium rounded-2xl shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all mb-5"
      >
        시작하기
      </button>

      {/* 다시 보지 않기 */}
      <label className="flex items-center gap-2 cursor-pointer select-none mb-6">
        <input
          type="checkbox"
          checked={neverShow}
          onChange={(e) => onNeverShowChange(e.target.checked)}
          className="w-4 h-4 rounded border-[#B5ADA3] text-[#795252] focus:ring-[#795252]/30 accent-[#795252]"
        />
        <span className="text-base text-[#B5ADA3]">다시 보지 않기</span>
      </label>

      {/* 신뢰 배지 */}
      <div className="flex items-center justify-center gap-5">
        {[
          { icon: <Sparkles className="w-4 h-4" />, label: "무료" },
          { icon: <Shield className="w-4 h-4" />, label: "광고 없음" },
          { icon: <Check className="w-4 h-4" />, label: "데이터 보호" },
        ].map((badge, i) => (
          <div key={i} className="flex items-center gap-1 text-[#B5ADA3]">
            {badge.icon}
            <span className="text-sm">{badge.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────
export default function ServiceGuide() {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [neverShow, setNeverShow] = useState(false);
  // 엔트리 애니메이션: 처음 마운트될 때 false → true
  const [entered, setEntered] = useState(false);
  // 슬라이드 트랜지션: "visible" | "fading-out" | "fading-in"
  const [slidePhase, setSlidePhase] = useState<"visible" | "fading-out" | "fading-in">("visible");

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        setVisible(true);
        // 약간 딜레이 후 엔트리 애니메이션
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setEntered(true));
        });
      }
    } catch {
      // localStorage 접근 실패 시 가이드 표시하지 않음
    }
  }, []);

  const close = useCallback(() => {
    setEntered(false);
    setTimeout(() => setVisible(false), 250);
    if (neverShow) {
      try {
        localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        // 무시
      }
    }
    try {
      window.dispatchEvent(new CustomEvent("hanbang:service-guide-completed"));
    } catch {
      // 무시
    }
  }, [neverShow]);

  const goTo = useCallback(
    (index: number) => {
      if (animating || index < 0 || index >= TOTAL_SLIDES || index === current) return;
      setAnimating(true);
      setSlidePhase("fading-out");
      setTimeout(() => {
        setCurrent(index);
        setSlidePhase("fading-in");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setSlidePhase("visible");
            setTimeout(() => setAnimating(false), 280);
          });
        });
      }, 200);
    },
    [animating, current]
  );

  const next = useCallback(() => {
    if (current < TOTAL_SLIDES - 1) goTo(current + 1);
  }, [current, goTo]);

  const prev = useCallback(() => {
    if (current > 0) goTo(current - 1);
  }, [current, goTo]);

  const handleStart = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // 무시
    }
    setEntered(false);
    setTimeout(() => setVisible(false), 250);
    try {
      window.dispatchEvent(new CustomEvent("hanbang:service-guide-completed"));
    } catch {
      // 무시
    }
  }, []);

  // 키보드 네비게이션
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, next, prev, close]);

  if (!visible) return null;

  const isLast = current === TOTAL_SLIDES - 1;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ${
        entered ? "bg-black/50 backdrop-blur-sm" : "bg-black/0"
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`relative w-full max-w-[560px] mx-4 my-4 sm:my-0 max-h-[calc(100vh-2rem)] overflow-y-auto bg-white rounded-3xl shadow-2xl transition-all duration-300 ${
          entered
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-4"
        }`}
      >
        {/* 상단 헤더: 페이지 번호 + 건너뛰기 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <span className="text-sm text-[#B5ADA3] font-medium">
            {current + 1}/{TOTAL_SLIDES}
          </span>
          <button
            onClick={close}
            className="flex items-center gap-1 text-sm text-[#B5ADA3] hover:text-[#1b1c1c] transition-colors"
          >
            건너뛰기
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 프로그레스 바 */}
        <div className="px-6 mb-3">
          <div className="w-full h-[3px] rounded-full bg-[#f6f3f2] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#795252] to-[#C9A96E] transition-all duration-500 ease-out"
              style={{ width: `${((current + 1) / TOTAL_SLIDES) * 100}%` }}
            />
          </div>
        </div>

        {/* 슬라이드 콘텐츠 — 모바일에서 height 조여서 화면 가득 채우는 느낌 회피 */}
        <div
          className={`min-h-[360px] sm:min-h-[480px] transition-all duration-200 ease-out ${
            slidePhase === "fading-out"
              ? "opacity-0 scale-[0.96]"
              : slidePhase === "fading-in"
              ? "opacity-0 scale-[1.02]"
              : "opacity-100 scale-100"
          }`}
        >
          {current === 0 && <SlideWelcome />}
          {current === 1 && <SlideDashboard />}
          {current === 2 && <SlideChat />}
          {current === 3 && <SlideBudget />}
          {current === 4 && <SlideCouple />}
          {current === 5 && (
            <SlideStart
              onStart={handleStart}
              neverShow={neverShow}
              onNeverShowChange={setNeverShow}
            />
          )}
        </div>

        {/* 하단 네비게이션 */}
        <div className="px-6 pb-5 pt-2">
          {!isLast && (
            <div className="flex items-center justify-between">
              <button
                onClick={prev}
                disabled={current === 0}
                className="flex items-center gap-1 px-4 py-3 text-base text-[#504444] hover:text-[#1b1c1c] disabled:opacity-0 disabled:pointer-events-none transition-all rounded-xl"
              >
                <ChevronLeft className="w-4 h-4" />
                이전
              </button>
              <button
                onClick={next}
                className="flex items-center gap-1 px-6 py-3 bg-[#795252] hover:bg-[#946a6a] text-white text-base font-medium rounded-xl transition-colors"
              >
                다음
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 도트 인디케이터 */}
          <div className="flex items-center justify-center gap-2 mt-4">
            {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`rounded-full transition-all duration-300 ${
                  i === current
                    ? "w-6 h-2 bg-[#795252]"
                    : "w-2 h-2 bg-[#B5ADA3]/40 hover:bg-[#B5ADA3]/70"
                }`}
                aria-label={`슬라이드 ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
