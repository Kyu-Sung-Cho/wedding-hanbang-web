"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  X,
  ChevronLeft,
  ChevronRight,
  CalendarCheck,
  Sparkles,
  Users,
  Wallet,
  MessageCircle,
  Check,
  RefreshCw,
} from "lucide-react";

const STORAGE_KEY = "hanbang_service_guide_seen_v2";
const SESSION_DISMISSED_KEY = "hanbang_service_guide_dismissed_session_v2";
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
      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[var(--hb-text-strong)] text-center leading-snug mb-2 sm:mb-3">
        결혼 준비,{"\n"}아모라와 처음부터 끝까지.
      </h2>
      <p className="text-sm sm:text-base text-[var(--hb-text-body)] text-center mb-5 sm:mb-6">
        고민을 아모라에게 말하면, 두 분이 확인한 것만 예산·체크리스트·일정에 남아요.
      </p>

      {/* 3가지 핵심 가치 */}
      <div className="flex items-stretch gap-3 w-full max-w-[380px] mb-7">
        {[
          { icon: <MessageCircle className="w-6 h-6" />, label: "아모라", sub: "지금 상황 말하기" },
          { icon: <CalendarCheck className="w-6 h-6" />, label: "할 일·일정", sub: "해야 할 일과 날짜 정리" },
          { icon: <Wallet className="w-6 h-6" />, label: "예산", sub: "예상 금액과 실제로 쓴 금액" },
        ].map((item, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center gap-2 py-5 px-2 rounded-[6px] bg-[var(--hb-surface-hover)] border border-[#f6f3f2]"
          >
            <div className="w-11 h-11 rounded-[6px] bg-[var(--hb-primary)] flex items-center justify-center text-white">
              {item.icon}
            </div>
            <span className="text-base font-medium text-[var(--hb-text-strong)]">{item.label}</span>
            <span className="text-sm text-[var(--hb-text-muted)]">{item.sub}</span>
          </div>
        ))}
      </div>

      {/* 진행 안내선 */}
      <div className="w-full max-w-[300px] h-[2px] rounded-full overflow-hidden bg-[var(--hb-surface-hover)]">
        <div className="h-full w-1/2 rounded-full bg-[var(--hb-primary)] animate-guide-shimmer" />
      </div>
    </div>
  );
}

// ─── Slide 2: Dashboard ──────────────────────────────────────────────
function SlideDashboard() {
  return (
    <div className="flex flex-col items-center px-6 pt-2 pb-2">
      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[var(--hb-text-strong)] text-center mb-2">
        대시보드
      </h2>
      <p className="text-sm sm:text-base text-[var(--hb-text-body)] text-center mb-6">
        한눈에 보는 결혼 준비 현황
      </p>

      {/* Mock 대시보드 */}
      <div className="w-full max-w-[380px] flex flex-col gap-3">
        {/* D-day 카드 */}
        <div className="relative">
          <div className="rounded-[6px] border border-[#d8bb86]/60 bg-white p-4 flex items-center justify-between shadow-sm">
            <div>
              <p className="text-sm text-[var(--hb-text-body)] mb-0.5">우리의 결혼식</p>
              <p className="text-sm font-semibold text-[var(--hb-text-strong)]">2026. 09. 12 (토)</p>
            </div>
            <div className="text-right">
              <span className="font-display text-[40px] font-light leading-none text-[var(--hb-text-strong)]">
                D-149
              </span>
            </div>
          </div>
          {/* 어노테이션 */}
          <div className="absolute -right-1 -top-2 flex items-center gap-1">
            <span className="text-sm text-[var(--hb-text-strong)] font-medium bg-white/95 rounded-full px-2.5 py-0.5 shadow-sm border border-[var(--hb-primary)]/20">
              결혼까지 남은 날짜
            </span>
          </div>
        </div>

        {/* 진행률 카드 */}
        <div className="relative rounded-[6px] bg-white border border-[#f6f3f2] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-base font-medium text-[var(--hb-text-strong)]">전체 진행률</span>
            <span className="text-base font-medium text-[var(--hb-text-strong)]">35%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--hb-surface-hover)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--hb-primary)]"
              style={{ width: "35%" }}
            />
          </div>
          {/* 어노테이션 */}
          <div className="absolute -left-1 -bottom-2 flex items-center gap-1">
            <span className="text-sm text-[var(--hb-text-strong)] font-medium bg-white/95 rounded-full px-2.5 py-0.5 shadow-sm border border-[var(--hb-primary)]/20">
              전체 진행 상황
            </span>
          </div>
        </div>

        {/* 카테고리 상태 */}
        <div className="rounded-[6px] bg-white border border-[#f6f3f2] p-4">
          <p className="text-sm text-[var(--hb-text-body)] mb-3">카테고리 현황</p>
          <div className="flex flex-wrap gap-2">
            {[
              { name: "결혼식장", status: "done", emoji: "check" },
              { name: "사진·의상·메이크업", status: "progress", emoji: "refresh" },
              { name: "결혼반지·기념 선물", status: "todo", emoji: "empty" },
              { name: "신혼여행", status: "todo", emoji: "empty" },
              { name: "가전·가구·생활용품", status: "progress", emoji: "refresh" },
            ].map((cat, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium ${
                  cat.status === "done"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : cat.status === "progress"
                    ? "bg-amber-50 text-amber-700 border border-amber-200"
                    : "bg-[var(--hb-surface-hover)] text-[var(--hb-text-muted)] border border-[#f6f3f2]"
                }`}
              >
                {cat.status === "done" && <Check className="w-3 h-3" />}
                {cat.status === "progress" && <RefreshCw className="w-3 h-3" />}
                {cat.status === "todo" && <span className="w-3 h-3 rounded-[6px] border border-[#B5ADA3]/40" />}
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
      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[var(--hb-text-strong)] text-center mb-2">
        아모라 — 모든 걸 연결하는 중심
      </h2>
      <p className="text-sm sm:text-base text-[var(--hb-text-body)] text-center mb-5">
        궁금한 건 묻고, 준비는 라운지에서 정리해요
      </p>

      {/* Mock 채팅 UI: 현재 라운지 기능 기준 */}
      <div className="w-full max-w-[380px] flex flex-col gap-3">
        {/* 유저 메시지 (오른쪽) */}
        <div className="flex justify-end">
          <div className="max-w-[75%] rounded-[6px] rounded-tr-md bg-[var(--hb-primary)] text-white px-4 py-2.5 shadow-sm">
            <p className="text-base leading-relaxed">이번 주에 웨딩 사진 촬영 업체와 상담하는데, 무엇을 확인해야 할까?</p>
          </div>
        </div>

        {/* AI 메시지 (왼쪽) */}
        <div className="flex justify-start gap-2">
          <div className="w-8 h-8 rounded-full bg-[var(--hb-primary)] flex items-center justify-center flex-shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col gap-2 max-w-[80%]">
            <div className="rounded-[6px] rounded-tl-md bg-[var(--hb-surface-hover)] border border-[#f6f3f2] px-4 py-2.5">
              <p className="text-base text-[var(--hb-text-strong)] leading-relaxed">
                상담 전에 예산 범위, 원하는 촬영 분위기, 추가로 궁금한 질문을 먼저 정리해두면 좋아요.
              </p>
            </div>

            {/* 현재 연결 가능한 준비 도구 */}
            <div className="rounded-[6px] bg-white border border-[#f6f3f2] p-3 shadow-sm">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[var(--hb-success)] shrink-0" />
                  <span className="text-sm text-[var(--hb-text-body)]"><span className="text-[var(--hb-text-strong)] font-medium">예산 관리</span>에서 상담 금액 정리</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[var(--hb-success)] shrink-0" />
                  <span className="text-sm text-[var(--hb-text-body)]"><span className="text-[var(--hb-text-strong)] font-medium">일정 관리</span>에서 상담 일정 확인</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[var(--hb-success)] shrink-0" />
                  <span className="text-sm text-[var(--hb-text-body)]"><span className="text-[var(--hb-text-strong)] font-medium">체크리스트</span>에서 준비 상태 확인</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 통합 영역 칩 — 현재 제공되는 라운지 기능 */}
        <div className="mt-1">
          <p className="text-sm text-[var(--hb-text-muted)] mb-1.5 text-center">지금 라운지에서 쓸 수 있어요</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {[
              "아모라 상담",
              "예산 관리",
              "일정 관리",
              "카테고리 체크리스트",
              "커플 연동",
              "커뮤니티 연결",
            ].map((label) => (
              <span
                key={label}
                className="inline-flex items-center px-2.5 py-1 rounded-full bg-[var(--hb-surface-hover)] border border-[#f6f3f2] text-sm text-[var(--hb-text-body)]"
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
      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[var(--hb-text-strong)] text-center mb-2">
        예산 관리
      </h2>
      <p className="text-sm sm:text-base text-[var(--hb-text-body)] text-center mb-6">
        예산 흐름을 한눈에 확인
      </p>

      {/* Mock 예산 UI */}
      <div className="w-full max-w-[380px] flex flex-col gap-3">
        {/* 총 예산 카드 */}
        <div className="rounded-[6px] border border-[#d8bb86]/60 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-[var(--hb-text-body)]">총 예산</span>
            <span className="text-base font-semibold text-[var(--hb-text-strong)]">3,000만원</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-[#f1eadf] overflow-hidden">
            <div className="flex h-full">
              <div className="h-full bg-[var(--hb-primary)]" style={{ width: "36%" }} />
              <div className="h-full bg-[#C9A96E]/75" style={{ width: "18%" }} />
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-sm text-[var(--hb-text-body)]">1,080만원 사용</span>
            <span className="text-sm font-medium text-[var(--hb-text-strong)]">540만원 진행중</span>
          </div>
        </div>

        {/* 카테고리 리스트 */}
        <div className="rounded-[6px] bg-white border border-[#f6f3f2] overflow-hidden divide-y divide-[#f6f3f2]">
          {[
            {
              name: "결혼식장",
              spent: 600,
              total: 800,
              tag: "두 사람",
              tagColor: "bg-[var(--hb-primary)]/10 text-[var(--hb-text-strong)]",
            },
            {
              name: "사진·의상·메이크업",
              spent: 280,
              total: 350,
              tag: "한 사람",
              tagColor: "bg-[#F5EFE4] text-[#765D31]",
            },
            {
              name: "신혼여행",
              spent: 200,
              total: 300,
              tag: "두 사람",
              tagColor: "bg-[var(--hb-primary)]/10 text-[var(--hb-text-strong)]",
            },
          ].map((row, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-base font-medium text-[var(--hb-text-strong)]">{row.name}</span>
                  <span className={`text-sm font-medium px-1.5 py-0.5 rounded-full ${row.tagColor}`}>
                    {row.tag}
                  </span>
                </div>
                <span className="text-sm text-[var(--hb-text-body)]">
                  <span className="text-[var(--hb-text-strong)] font-medium">{row.spent}</span>/{row.total}만원
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[var(--hb-surface-hover)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--hb-primary)]"
                  style={{ width: `${(row.spent / row.total) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* 어노테이션 */}
        <div className="flex justify-center">
          <span className="text-sm text-[var(--hb-text-strong)] font-medium bg-white/95 rounded-full px-3 py-1 shadow-sm border border-[var(--hb-primary)]/20">
            사용 금액과 카테고리별 예산 확인
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Slide 5: Feature Pages ──────────────────────────────────────────
function SlideFeaturePages() {
  const features = [
    {
      icon: MessageCircle,
      title: "아모라 상담",
      desc: "견적·계약·순서가 막힐 때 먼저 질문",
    },
    {
      icon: CalendarCheck,
      title: "일정 관리",
      desc: "상담, 투어, 촬영, 계약 날짜 정리",
    },
    {
      icon: Wallet,
      title: "예산",
      desc: "예상 금액과 실제로 쓴 금액 정리",
    },
    {
      icon: Users,
      title: "커뮤니티",
      desc: "다른 사람의 준비 경험과 질문 확인",
    },
  ];

  return (
    <div className="flex flex-col items-center px-6 pt-2 pb-2">
      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[var(--hb-text-strong)] text-center mb-2">
        기능 페이지로 이어가기
      </h2>
      <p className="text-sm sm:text-base text-[var(--hb-text-body)] text-center mb-6">
        라운지는 입구, 세부 정리는 각 기능에서 해요
      </p>

      <div className="w-full max-w-[380px] flex flex-col gap-3">
        <div className="rounded-[6px] border border-[#d8bb86]/60 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-[var(--hb-text-strong)] mb-2">추천 흐름</p>
          <p className="text-base leading-relaxed text-[var(--hb-text-strong)]">
            아모라에게 결혼 준비를 말하면, 답변에서 나온 금액은 예산에, 해야 할 일과 날짜는 할 일·일정에 이어서 정리할 수 있어요.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="rounded-[6px] border border-[#f6f3f2] bg-white p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--hb-primary)]/10 text-[var(--hb-text-strong)]">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-medium text-[var(--hb-text-strong)]">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--hb-text-body)]">{feature.desc}</p>
              </div>
            );
          })}
        </div>

        <div className="rounded-[6px] border border-[#f6f3f2] bg-[var(--hb-surface-hover)] px-4 py-3">
          <p className="text-sm leading-relaxed text-[var(--hb-text-body)]">
            무엇부터 해야 할지 막히면 아모라에게 지금 상황을 말해보세요. 필요한 일과 날짜, 금액을 한곳에서 이어서 정리할 수 있어요.
          </p>
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
    <div className="flex flex-col items-center px-6 pt-4 pb-2 sm:pt-6">
      {/* 로고 — 모바일에선 작게 */}
      <div className="relative w-16 h-16 sm:w-24 sm:h-24 mb-4 sm:mb-6">
        <Image
          src="/images/logo-512-transparent.png"
          alt="웨딩한방"
          fill
          className="object-contain"
        />
      </div>

      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[var(--hb-text-strong)] text-center leading-snug mb-2 sm:mb-3">
        이제 아모라에게 말해보세요
      </h2>
      <p className="text-sm sm:text-sm sm:text-base text-[var(--hb-text-body)] text-center mb-5 sm:mb-6">
        지금 상황 한 가지만 말해도 다음에 확인할 일을 함께 정리할 수 있어요.
      </p>

      {/* CTA 버튼 */}
      <button
        onClick={onStart}
        className="w-full max-w-[320px] py-3.5 bg-[var(--hb-primary)] text-white text-base font-medium rounded-[6px] shadow-[var(--shadow-raised)] hover:bg-[var(--hb-primary-hover)] hover:shadow-[var(--shadow-raised)] transition-all mb-5"
      >
        시작하기
      </button>

      {/* 다시 보지 않기 */}
      <label className="flex items-center gap-2 cursor-pointer select-none mb-6">
        <input
          type="checkbox"
          checked={neverShow}
          onChange={(e) => onNeverShowChange(e.target.checked)}
          className="w-4 h-4 rounded-[6px] border-[#B5ADA3] text-[var(--hb-text-strong)] focus:ring-[var(--hb-primary)]/30 accent-[var(--hb-text-strong)]"
        />
        <span className="text-base text-[var(--hb-text-muted)]">다시 보지 않기</span>
      </label>

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
    // 첫 방문 자동 팝업 비활성 — 첫 세션의 목표는 가이드 시청이 아니라 첫 행동 1개(UX 감사 결론).
    // 가이드는 "hanbang:open-service-guide" 이벤트로만 수동 오픈한다.
    let entryFrame = 0;
    let nestedFrame = 0;
    const open = () => {
      setVisible(true);
      entryFrame = requestAnimationFrame(() => {
        nestedFrame = requestAnimationFrame(() => setEntered(true));
      });
    };
    window.addEventListener("hanbang:open-service-guide", open);
    return () => {
      window.removeEventListener("hanbang:open-service-guide", open);
      cancelAnimationFrame(entryFrame);
      cancelAnimationFrame(nestedFrame);
    };
  }, []);

  const hide = useCallback(() => {
    setEntered(false);
    setTimeout(() => setVisible(false), 250);
  }, []);

  const dismissForNow = useCallback(() => {
    try {
      sessionStorage.setItem(SESSION_DISMISSED_KEY, "true");
    } catch {
      // 무시
    }
    hide();
  }, [hide]);

  const dismissPermanently = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
      sessionStorage.setItem(SESSION_DISMISSED_KEY, "true");
    } catch {
      // 무시
    }
    hide();
  }, [hide]);

  const close = useCallback(() => {
    if (neverShow) {
      try {
        localStorage.setItem(STORAGE_KEY, "true");
        sessionStorage.setItem(SESSION_DISMISSED_KEY, "true");
      } catch {
        // 무시
      }
      hide();
      return;
    }
    dismissForNow();
  }, [dismissForNow, hide, neverShow]);

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
      sessionStorage.setItem(SESSION_DISMISSED_KEY, "true");
    } catch {
      // 무시
    }
    hide();
    try {
      window.dispatchEvent(new CustomEvent("hanbang:service-guide-completed"));
    } catch {
      // 무시
    }
  }, [hide]);

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
        className={`relative w-full max-w-[560px] mx-4 my-4 sm:my-0 max-h-[calc(100vh-2rem)] overflow-y-auto bg-white rounded-[6px] shadow-2xl transition-all duration-300 ${
          entered
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-4"
        }`}
      >
        {/* 상단 헤더: 페이지 번호 + 닫기/다시 보지 않기 — 모바일에서 컴팩트하게.
            no-min-tap 으로 글로벌 button min-height:40px 회피 (텍스트 버튼이라 부피 큼). */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-3 sm:pt-5 pb-1 sm:pb-2">
          <span className="text-xs sm:text-sm text-[var(--hb-text-muted)] font-medium tabular-nums">
            {current + 1}/{TOTAL_SLIDES}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={dismissPermanently}
              className="no-min-tap text-xs sm:text-sm font-medium text-[var(--hb-text-strong)] hover:text-[var(--hb-text-strong)] transition-colors"
            >
              다시 보지 않기
            </button>
            <button
              type="button"
              onClick={dismissForNow}
              className="no-min-tap flex items-center gap-1 text-xs sm:text-sm text-[var(--hb-text-muted)] hover:text-[var(--hb-text-strong)] transition-colors"
            >
              나중에 보기
              <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>

        {/* 프로그레스 바 */}
        <div className="px-6 mb-3">
          <div className="w-full h-[3px] rounded-full bg-[var(--hb-surface-hover)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--hb-primary)] transition-all duration-500 ease-out"
              style={{ width: `${((current + 1) / TOTAL_SLIDES) * 100}%` }}
            />
          </div>
        </div>

        {/* 슬라이드 콘텐츠 — 모바일에선 짧은 슬라이드가 viewport 가득 채우지 않도록 min-h 제거 */}
        <div
          className={`sm:min-h-[480px] transition-all duration-200 ease-out ${
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
          {current === 4 && <SlideFeaturePages />}
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
                className="flex items-center gap-1 px-4 py-3 text-base text-[var(--hb-text-body)] hover:text-[var(--hb-text-strong)] disabled:opacity-0 disabled:pointer-events-none transition-all rounded-[6px]"
              >
                <ChevronLeft className="w-4 h-4" />
                이전
              </button>
              <button
                onClick={next}
                className="flex items-center gap-1 px-6 py-3 bg-[var(--hb-primary)] hover:bg-[var(--hb-primary-hover)] text-white text-base font-medium rounded-[6px] transition-colors"
              >
                다음
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 도트 인디케이터 — 모든 점 동일 사이즈, active 만 색 진하게.
              no-min-tap 으로 글로벌 button min-height:40px 제외 (안 그러면 큰 막대로 확대됨). */}
          <div className="flex items-center justify-center gap-1.5 mt-4">
            {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`no-min-tap w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                  i === current ? "bg-[var(--hb-primary)]" : "bg-[#B5ADA3]/35 hover:bg-[#B5ADA3]/60"
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
