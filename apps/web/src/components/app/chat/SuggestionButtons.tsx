"use client";

import AmoraMark from "@/components/ui/AmoraMark";

import { useRef, useState, useEffect, useCallback } from "react";
import { INVITATION_CHAT_STYLES, type ChatPresentation } from "./chatBubbleStyles";

interface SuggestionButtonsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  disabled?: boolean;
  /**
   * 모양만 바꾼다. `invitation` 은 청첩장 디자인(2026-11-17 `Web.dc`)의 제안 칩이다 — 머리말 없이
   * 줄을 바꿔 가며 놓는 38px 칩. 누르면 하는 일(아모라에게 그 문장을 보내기)은 같다.
   */
  presentation?: ChatPresentation;
}

/**
 * AI 제안 칩 — 가로 스크롤 + 마우스 드래그 지원.
 * 모바일은 터치 스와이프, 데스크탑은 click-and-drag 또는 휠.
 */
export default function SuggestionButtons({
  suggestions,
  onSelect,
  disabled = false,
  presentation = "default",
}: SuggestionButtonsProps) {
  const invitation = presentation === "invitation";
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef({ startX: 0, startScrollLeft: 0, hasMoved: false });
  const [showRightFade, setShowRightFade] = useState(false);
  const [showLeftFade, setShowLeftFade] = useState(false);

  // 스크롤 가능 여부 + 페이드 표시 갱신
  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeftFade(el.scrollLeft > 4);
    setShowRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateFades();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateFades, { passive: true });
    window.addEventListener("resize", updateFades);
    return () => {
      el.removeEventListener("scroll", updateFades);
      window.removeEventListener("resize", updateFades);
    };
  }, [updateFades, suggestions]);

  // 마우스 드래그 (데스크탑)
  function handleMouseDown(e: React.MouseEvent) {
    const el = scrollRef.current;
    if (!el) return;
    setIsDragging(true);
    dragStateRef.current = {
      startX: e.pageX - el.offsetLeft,
      startScrollLeft: el.scrollLeft,
      hasMoved: false,
    };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = x - dragStateRef.current.startX;
    if (Math.abs(walk) > 4) dragStateRef.current.hasMoved = true;
    el.scrollLeft = dragStateRef.current.startScrollLeft - walk;
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  // 휠: 세로 휠을 가로 스크롤로 변환 (트랙패드 가로 스크롤은 기본 동작)
  function handleWheel(e: React.WheelEvent) {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
    }
  }

  if (suggestions.length === 0) return null;

  return (
    <div className="relative">
      {/* 라벨 — 시각적 구분 강화. 청첩장 디자인의 칩은 머리말 없이 놓인다. */}
      {!invitation && (
      <div className="flex items-center gap-1.5 px-1 mb-2">
        <AmoraMark className="w-3.5 h-3.5 text-[var(--hb-amora-ink,#7D5753)]" />
        <span className="text-xs text-[var(--hb-text-muted)] font-medium">
          추천 대화
        </span>
      </div>
      )}

      {/* 좌측 페이드 */}
      {!invitation && showLeftFade && (
        <div className="pointer-events-none absolute top-7 bottom-2 left-0 w-8 bg-gradient-to-r from-[#FAFAF8] to-transparent z-10" />
      )}
      {/* 우측 페이드 */}
      {!invitation && showRightFade && (
        <div className="pointer-events-none absolute top-7 bottom-2 right-0 w-8 bg-gradient-to-l from-[#FAFAF8] to-transparent z-10" />
      )}

      <div
        ref={scrollRef}
        onMouseDown={invitation ? undefined : handleMouseDown}
        onMouseMove={invitation ? undefined : handleMouseMove}
        onMouseUp={invitation ? undefined : handleMouseUp}
        onMouseLeave={invitation ? undefined : handleMouseUp}
        onWheel={invitation ? undefined : handleWheel}
        className={invitation ? INVITATION_CHAT_STYLES.suggestionRow : `flex gap-2 overflow-x-auto pb-2 px-1 scrollbar-hide select-none ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={invitation ? undefined : { WebkitOverflowScrolling: "touch" }}
      >
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={(e) => {
              // 드래그로 끝났으면 클릭 무시
              if (dragStateRef.current.hasMoved) {
                e.preventDefault();
                dragStateRef.current.hasMoved = false;
                return;
              }
              onSelect(suggestion);
            }}
            disabled={disabled}
            className={invitation ? INVITATION_CHAT_STYLES.suggestionChip : `flex-shrink-0 px-4 sm:px-5 py-2 sm:py-2.5 text-sm sm:text-base font-medium rounded-[6px]
              bg-white border border-black/[0.06] text-[var(--hb-text-body)]
              hover:border-[#C4967E] hover:text-rose-700 hover:bg-[#C4967E]/5
              active:scale-95
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors duration-200 shadow-sm
              whitespace-nowrap`}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
