"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  LayoutDashboard,
  MessageCircle,
  Wallet,
  CalendarCheck,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const STORAGE_KEY = "hanbang_service_guide_seen";

interface SlideData {
  title: string;
  descriptions: string[];
  icon: React.ReactNode;
}

const slides: SlideData[] = [
  {
    title: "웨딩한방에 오신 것을\n환영해요!",
    descriptions: [
      "결혼 준비, 한방에 해결하세요",
      "AI 아모라가 24시간 함께합니다",
    ],
    icon: (
      <div className="relative w-24 h-24 mx-auto">
        <Image
          src="/images/logo-512-transparent.png"
          alt="웨딩한방"
          fill
          className="object-contain"
        />
      </div>
    ),
  },
  {
    title: "대시보드",
    descriptions: [
      "D-day와 진행 상황을 한눈에",
      "지금 해야 할 것을 자동으로 알려드려요",
    ],
    icon: (
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center mx-auto">
        <LayoutDashboard className="w-10 h-10 text-white" />
      </div>
    ),
  },
  {
    title: "AI 아모라",
    descriptions: [
      "궁금한 건 아모라에게 물어보세요",
      "업체 추천, 예산 상담, 견적 분석까지",
    ],
    icon: (
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center mx-auto">
        <MessageCircle className="w-10 h-10 text-white" />
      </div>
    ),
  },
  {
    title: "예산 관리",
    descriptions: [
      "카테고리별 예산을 한눈에",
      "숨은 비용 경고, 양가 분담까지",
    ],
    icon: (
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#2E7D5A] to-[#4CAF80] flex items-center justify-center mx-auto">
        <Wallet className="w-10 h-10 text-white" />
      </div>
    ),
  },
  {
    title: "일정 & 체크리스트",
    descriptions: [
      "D-day 기준으로 할 일을 자동 정리",
      "파트너와 실시간 동기화",
    ],
    icon: (
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#C9A96E] to-[#DCC9A0] flex items-center justify-center mx-auto">
        <CalendarCheck className="w-10 h-10 text-white" />
      </div>
    ),
  },
  {
    title: "시작해볼까요?",
    descriptions: [
      "웨딩한방과 함께 결혼 준비를 시작하세요",
    ],
    icon: (
      <div className="relative w-24 h-24 mx-auto">
        <Image
          src="/images/logo-512-transparent.png"
          alt="웨딩한방"
          fill
          className="object-contain"
        />
      </div>
    ),
  },
];

export default function ServiceGuide() {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [animating, setAnimating] = useState(false);
  const [neverShow, setNeverShow] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        setVisible(true);
      }
    } catch {
      // localStorage 접근 실패 시 가이드 표시하지 않음
    }
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    if (neverShow) {
      try {
        localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        // 무시
      }
    }
  }, [neverShow]);

  const goTo = useCallback(
    (index: number, dir: "next" | "prev") => {
      if (animating || index < 0 || index >= slides.length) return;
      setDirection(dir);
      setAnimating(true);
      // 짧은 딜레이로 CSS 트랜지션 트리거
      setTimeout(() => {
        setCurrent(index);
        setTimeout(() => setAnimating(false), 320);
      }, 10);
    },
    [animating]
  );

  const next = useCallback(() => {
    if (current === slides.length - 1) return;
    goTo(current + 1, "next");
  }, [current, goTo]);

  const prev = useCallback(() => {
    if (current === 0) return;
    goTo(current - 1, "prev");
  }, [current, goTo]);

  const handleLastSlideClick = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // 무시
    }
    setVisible(false);
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

  const isLast = current === slides.length - 1;
  const slide = slides[current];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="relative w-full max-w-[480px] mx-4 bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* 상단: 건너뛰기 + 페이지 번호 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <span className="text-[13px] text-taupe-400 font-medium">
            {current + 1}/{slides.length}
          </span>
          <button
            onClick={close}
            className="flex items-center gap-1 text-[13px] text-taupe-400 hover:text-noir-800 transition-colors"
          >
            건너뛰기
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 슬라이드 컨텐츠 영역 */}
        <div className="relative overflow-hidden" style={{ minHeight: "360px" }}>
          <div
            className="px-8 py-6 flex flex-col items-center text-center transition-all duration-300 ease-out"
            style={{
              opacity: animating ? 0 : 1,
              transform: animating
                ? direction === "next"
                  ? "translateX(60px)"
                  : "translateX(-60px)"
                : "translateX(0)",
            }}
          >
            {/* 아이콘 */}
            <div className="mb-8">{slide.icon}</div>

            {/* 제목 */}
            <h2 className="font-serif-kr text-[24px] font-normal text-noir-800 mb-4 whitespace-pre-line leading-snug">
              {slide.title}
            </h2>

            {/* 설명 */}
            <div className="flex flex-col gap-2">
              {slide.descriptions.map((desc, i) => (
                <p
                  key={i}
                  className="text-[15px] text-taupe-500 font-light leading-relaxed"
                >
                  {desc}
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* 하단: 네비게이션 */}
        <div className="px-6 pb-6 pt-2">
          {/* 마지막 슬라이드: 시작 버튼 + 다시 보지 않기 */}
          {isLast ? (
            <div className="flex flex-col items-center gap-4">
              <button
                onClick={handleLastSlideClick}
                className="w-full py-3.5 bg-noir-800 hover:bg-noir-soft text-white text-[15px] font-medium rounded-2xl transition-colors"
              >
                무료로 시작하기
              </button>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={neverShow}
                  onChange={(e) => setNeverShow(e.target.checked)}
                  className="w-4 h-4 rounded border-taupe-400 text-rose-500 focus:ring-rose-500/30 accent-[#C4967E]"
                />
                <span className="text-[13px] text-taupe-400">
                  다시 보지 않기
                </span>
              </label>
            </div>
          ) : (
            <>
              {/* 이전 / 다음 버튼 */}
              <div className="flex items-center justify-between">
                <button
                  onClick={prev}
                  disabled={current === 0}
                  className="flex items-center gap-1 px-4 py-2.5 text-[14px] text-taupe-500 hover:text-noir-800 disabled:opacity-0 disabled:pointer-events-none transition-all rounded-xl"
                >
                  <ChevronLeft className="w-4 h-4" />
                  이전
                </button>
                <button
                  onClick={next}
                  className="flex items-center gap-1 px-5 py-2.5 bg-noir-800 hover:bg-noir-soft text-white text-[14px] font-medium rounded-xl transition-colors"
                >
                  다음
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {/* 도트 인디케이터 */}
          <div className="flex items-center justify-center gap-2 mt-5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i, i > current ? "next" : "prev")}
                className={`rounded-full transition-all duration-300 ${
                  i === current
                    ? "w-6 h-2 bg-rose-500"
                    : "w-2 h-2 bg-taupe-400/40 hover:bg-taupe-400/70"
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
