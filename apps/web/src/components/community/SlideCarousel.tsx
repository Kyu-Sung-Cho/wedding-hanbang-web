"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { SlideMedia } from "@/types/community.types";

interface SlideCarouselProps {
  slides: SlideMedia[];
  /** 가로:세로 비율 (기본 4:5 — 인스타 풀형) */
  aspect?: "1/1" | "4/5" | "9/16" | "auto";
  className?: string;
}

/**
 * 인스타 캐러셀 스타일 슬라이더.
 * - 좌우 화살표 (호버 시 노출)
 * - 점 인디케이터
 * - 키보드 ←/→ 네비
 * - 모바일 swipe (간단한 touch handler)
 * - 영상은 click-to-play (autoplay X, 데이터 절약)
 */
export default function SlideCarousel({ slides, aspect = "4/5", className = "" }: SlideCarouselProps) {
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const total = slides.length;

  const go = useCallback((next: number) => {
    if (next < 0 || next >= total) return;
    setIndex(next);
  }, [total]);

  // 키보드
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "ArrowRight") go(index + 1);
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [go, index]);

  // 모바일 swipe
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) > 40) {
      if (delta < 0) go(index + 1);
      else go(index - 1);
    }
    touchStartX.current = null;
  };

  if (total === 0) return null;

  const aspectClass = {
    "1/1": "aspect-square",
    "4/5": "aspect-[4/5]",
    "9/16": "aspect-[9/16]",
    auto: "",
  }[aspect];

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`group focus:outline-none ${className}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      aria-label={`슬라이드 ${index + 1} / ${total}`}
    >
      <div className="relative overflow-hidden rounded-2xl bg-[#1A1A1F]">
        {/* 슬라이드 트랙 */}
        <div
          className={`flex transition-transform duration-300 ease-out ${aspectClass}`}
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map((slide, i) => (
            <SlideItem key={i} slide={slide} active={i === index} />
          ))}
        </div>

        {/* 좌우 버튼 — 호버 시 노출, 모바일은 항상 작게 */}
        {index > 0 && (
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="이전 슬라이드"
            className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[var(--hb-primary)]/82 backdrop-blur-sm flex items-center justify-center shadow-md transition-opacity opacity-90 sm:opacity-0 group-hover:opacity-100 hover:bg-[var(--hb-primary-hover)]"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
        )}
        {index < total - 1 && (
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="다음 슬라이드"
            className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[var(--hb-primary)]/82 backdrop-blur-sm flex items-center justify-center shadow-md transition-opacity opacity-90 sm:opacity-0 group-hover:opacity-100 hover:bg-[var(--hb-primary-hover)]"
          >
            <ChevronRight className="w-5 h-5 text-white" />
          </button>
        )}
      </div>

      {/* 점 인디케이터 — 카드뉴스 밖에서 보여 이미지 내용을 가리지 않음 */}
      {total > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`${i + 1}번 슬라이드로 이동`}
              className={`no-min-tap transition-all rounded-full ${
                i === index ? "w-5 h-1.5 bg-[var(--hb-primary)]" : "w-1.5 h-1.5 bg-[#d8cfc1] hover:bg-[#b5ada3]"
              }`}
            />
          ))}
          <span className="ml-2 rounded-full bg-[var(--hb-primary)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white">
            {index + 1}/{total}
          </span>
        </div>
      )}
    </div>
  );
}

function SlideItem({ slide, active }: { slide: SlideMedia; active: boolean }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 활성 슬라이드를 벗어나면 영상 일시정지
  useEffect(() => {
    if (!active && videoRef.current) {
      videoRef.current.pause();
    }
  }, [active]);

  if (slide.type === "video") {
    return (
      <div className="w-full shrink-0 relative bg-black flex items-center justify-center">
        <video
          ref={videoRef}
          src={slide.url}
          poster={slide.thumbnail_url}
          preload="metadata"
          playsInline
          controls={playing}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="max-w-full max-h-full w-auto h-auto object-contain"
        />
        {!playing && (
          <button
            type="button"
            onClick={() => {
              videoRef.current?.play();
            }}
            aria-label="재생"
            className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
          >
            <span className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <Play className="w-7 h-7 text-[var(--hb-text-strong)] fill-[#1A1A1F] ml-0.5" />
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full shrink-0 relative bg-[var(--hb-surface-page)] flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={slide.url}
        alt=""
        className="max-w-full max-h-full w-auto h-auto object-contain"
        loading={active ? "eager" : "lazy"}
      />
    </div>
  );
}
