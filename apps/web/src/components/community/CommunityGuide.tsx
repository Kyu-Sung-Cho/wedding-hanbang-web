"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  MessageCircle,
  Search,
  Star,
  Bookmark,
  PenSquare,
  Heart,
} from "lucide-react";

const STORAGE_KEY = "hanbang_community_guide_seen";
const TOTAL_SLIDES = 5;

/* ─────────────────────────────────────────────
   Slide 1 — Welcome
   ───────────────────────────────────────────── */
function SlideWelcome() {
  return (
    <div className="flex flex-col items-center text-center px-6">
      {/* 그라디언트 아이콘 */}
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center mb-5">
        <Heart className="w-8 h-8 text-white" />
      </div>

      <h2 className="font-serif-kr text-[22px] font-normal text-noir-800 mb-2 leading-snug">
        예비 신부·신랑들의 솔직한 공간
      </h2>
      <p className="text-[14px] text-taupe-500 font-light mb-6">
        후기, 비용, 고민을 자유롭게 나눠요
      </p>

      {/* 3 stats */}
      <div className="flex items-center gap-3 mb-6 w-full max-w-[340px]">
        {[
          { value: "1,200+", label: "후기" },
          { value: "50+", label: "동기방" },
          { value: "매일", label: "새 글" },
        ].map((s, i) => (
          <div
            key={i}
            className="flex-1 py-3 rounded-2xl bg-ivory-100 border border-ivory-200 text-center"
          >
            <div className="text-[17px] font-semibold text-noir-800 font-cormorant leading-none mb-1">
              {s.value}
            </div>
            <div className="text-[11px] text-taupe-500 font-light">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Mock 포스트 카드 스택 */}
      <div className="relative w-full max-w-[280px] h-[120px]">
        {/* 뒤 카드 3 */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-[220px] h-[80px] rounded-xl bg-ivory-200 border border-ivory-200 opacity-40" />
        {/* 뒤 카드 2 */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-2 w-[240px] h-[80px] rounded-xl bg-ivory-100 border border-ivory-200 opacity-60" />
        {/* 앞 카드 */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 w-[260px] rounded-xl bg-white border border-ivory-200 shadow-sm px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-rose-500 to-gold" />
            <span className="text-[11px] text-noir-800 font-medium">
              봄날의신부
            </span>
            <span className="text-[9px] px-1.5 py-0.5 bg-rose-500/10 text-rose-500 rounded-full font-medium">
              BEST
            </span>
          </div>
          <div className="text-[12px] text-noir-800 font-medium truncate">
            강남 스튜디오 3곳 비교 후기
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-taupe-400">
            <span className="flex items-center gap-0.5">
              <ChevronUp className="w-3 h-3" />
              24
            </span>
            <span className="flex items-center gap-0.5">
              <MessageCircle className="w-3 h-3" />8
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 2 — 글쓰기 & 후기 공유
   ───────────────────────────────────────────── */
function SlideWriteReview() {
  return (
    <div className="flex flex-col items-center text-center px-6">
      <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-1 leading-snug">
        글쓰기 & 후기 공유
      </h2>
      <p className="text-[13px] text-taupe-500 font-light mb-5">
        사진/영상과 함께 솔직한 후기를
      </p>

      {/* Mock 포스트 카드 */}
      <div className="w-full max-w-[320px] rounded-2xl bg-white border border-ivory-200 shadow-sm overflow-hidden mb-4">
        {/* 작성자 */}
        <div className="px-4 pt-3.5 pb-2 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#A8D8A8] to-[#6BBF6B] flex items-center justify-center">
            <span className="text-[12px]">🌱</span>
          </div>
          <div className="flex flex-col items-start">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-noir-800 font-medium">
                봄날의신부
              </span>
              <span className="text-[9px] px-1.5 py-0.5 bg-[#2E7D5A]/10 text-[#2E7D5A] rounded-full font-semibold">
                Lv.3
              </span>
            </div>
            <span className="text-[10px] text-taupe-400 font-light">
              2시간 전
            </span>
          </div>
        </div>

        {/* 제목 & 본문 */}
        <div className="px-4 pb-2">
          <div className="text-[14px] text-noir-800 font-semibold mb-1 text-left">
            강남 스튜디오 3곳 비교 후기
          </div>
          <p className="text-[12px] text-taupe-500 font-light leading-relaxed text-left">
            촬영 컨셉, 가격, 보정 스타일까지 꼼꼼하게 비교해봤어요. 결론부터 말하면...
          </p>
        </div>

        {/* 이미지 썸네일 */}
        <div className="px-4 pb-3 flex gap-2">
          <div className="flex-1 h-[48px] rounded-lg bg-gradient-to-br from-rose-500/20 to-rose-500/5 border border-rose-500/10" />
          <div className="flex-1 h-[48px] rounded-lg bg-gradient-to-br from-gold/20 to-gold/5 border border-gold/10" />
          <div className="flex-1 h-[48px] rounded-lg bg-gradient-to-br from-[#2E7D5A]/20 to-[#2E7D5A]/5 border border-[#2E7D5A]/10" />
        </div>

        {/* 하단 인터랙션 바 */}
        <div className="px-4 py-2.5 border-t border-ivory-200 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* 투표 */}
            <div className="flex items-center gap-1">
              <div className="flex items-center gap-0.5 text-[#2E7D5A]">
                <ChevronUp className="w-4 h-4" />
              </div>
              <span className="text-[13px] font-semibold text-noir-800">
                24
              </span>
              <ChevronDown className="w-4 h-4 text-taupe-400" />
            </div>
            {/* 댓글 */}
            <div className="flex items-center gap-1 text-taupe-400">
              <MessageCircle className="w-3.5 h-3.5" />
              <span className="text-[12px]">8</span>
            </div>
          </div>
          <Bookmark className="w-4 h-4 text-taupe-400" />
        </div>
      </div>

      {/* 글쓰기 버튼 모의 */}
      <div className="flex items-center gap-2 px-5 py-2.5 bg-noir-800 rounded-xl">
        <PenSquare className="w-4 h-4 text-white" />
        <span className="text-[13px] text-white font-medium">글쓰기</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 3 — 동기방
   ───────────────────────────────────────────── */
function SlideCohort() {
  return (
    <div className="flex flex-col items-center text-center px-6">
      <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-1 leading-snug">
        동기방
      </h2>
      <p className="text-[13px] text-taupe-500 font-light mb-5">
        같은 시기 결혼하는 커플들과 정보 공유
      </p>

      {/* Mock 동기방 카드 (다크) */}
      <div className="w-full max-w-[320px] rounded-2xl bg-gradient-to-br from-noir-800 to-[#2A2A30] p-4 mb-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[15px] text-white font-semibold">
              2026 2분기 동기방
            </div>
            <div className="text-[11px] text-white/50 font-light mt-0.5">
              활발한 대화 중
            </div>
          </div>
          <div className="px-2.5 py-1 rounded-full bg-white/10 text-[10px] text-white/70 font-medium">
            32명의 동기
          </div>
        </div>
        {/* 멤버 아바타 */}
        <div className="flex items-center mb-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rose-500 to-gold border-2 border-noir-800 z-[4]" />
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#A8D8A8] to-[#6BBF6B] border-2 border-noir-800 -ml-2 z-[3]" />
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7EB8D8] to-[#5A9CC0] border-2 border-noir-800 -ml-2 z-[2]" />
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gold to-[#DCC9A0] border-2 border-noir-800 -ml-2 z-[1]" />
          <span className="text-[11px] text-white/40 ml-2">+28</span>
        </div>
        {/* 마지막 메시지 */}
        <div className="rounded-xl bg-white/10 px-3 py-2.5">
          <span className="text-[11px] text-white/80 font-light leading-relaxed">
            &quot;다음주 스드메 투어 같이 가실 분...&quot;
          </span>
        </div>
      </div>

      {/* Mock 채팅 메시지 */}
      <div className="w-full max-w-[320px] flex flex-col gap-2">
        {/* 메시지 1 — 다른 사람 */}
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#7EB8D8] to-[#5A9CC0] shrink-0 mt-0.5" />
          <div className="bg-ivory-100 rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[240px]">
            <span className="text-[12px] text-noir-800 leading-relaxed">
              저도 강남 스튜디오 갔는데요!
            </span>
          </div>
        </div>
        {/* 메시지 2 — 다른 사람 */}
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gold to-[#DCC9A0] shrink-0 mt-0.5" />
          <div className="bg-ivory-100 rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[240px]">
            <span className="text-[12px] text-noir-800 leading-relaxed">
              거기 기본가 얼마였어요?
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 4 — 투표 · 북마크 · 검색
   ───────────────────────────────────────────── */
function SlideInteractions() {
  return (
    <div className="flex flex-col items-center text-center px-6">
      <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-1 leading-snug">
        투표 · 북마크 · 검색
      </h2>
      <p className="text-[13px] text-taupe-500 font-light mb-5">
        좋은 글은 투표하고, 나중에 볼 글은 저장
      </p>

      {/* Mock 인터랙션 UI */}
      <div className="w-full max-w-[320px] flex flex-col gap-3">
        {/* 검색바 */}
        <div className="w-full flex items-center gap-2 px-4 py-3 rounded-2xl bg-ivory-100 border border-ivory-200">
          <Search className="w-4 h-4 text-taupe-400 shrink-0" />
          <span className="text-[13px] text-noir-800">스드메 후기</span>
          <div className="ml-auto w-1 h-4 bg-rose-500 rounded-full animate-pulse" />
        </div>

        {/* 카테고리 탭 */}
        <div className="flex items-center gap-2 overflow-hidden">
          {["전체", "후기", "비용", "고민"].map((tab, i) => (
            <div
              key={tab}
              className={`px-4 py-2 rounded-full text-[12px] font-medium shrink-0 transition-colors ${
                i === 1
                  ? "bg-noir-800 text-white"
                  : "bg-ivory-100 text-taupe-500 border border-ivory-200"
              }`}
            >
              {tab}
            </div>
          ))}
        </div>

        {/* 투표 + 북마크 인터랙션 카드 */}
        <div className="w-full rounded-2xl bg-white border border-ivory-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-rose-500 to-gold" />
              <span className="text-[12px] text-noir-800 font-medium">
                하늘빛신랑
              </span>
            </div>
            <span className="text-[10px] text-taupe-400 font-light">
              어제
            </span>
          </div>
          <div className="text-[13px] text-noir-800 font-medium mb-1 text-left">
            스드메 패키지 200만원대 정리
          </div>
          <p className="text-[11px] text-taupe-500 font-light text-left mb-3">
            직접 발품 팔아서 정리한 가성비 리스트...
          </p>
          {/* 투표 + 북마크 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {/* 업보트 (활성) */}
              <div className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg bg-[#2E7D5A]/10 border border-[#2E7D5A]/20">
                <ChevronUp className="w-4 h-4 text-[#2E7D5A]" />
                <span className="text-[12px] font-semibold text-[#2E7D5A]">
                  47
                </span>
              </div>
              <div className="flex items-center gap-0.5 px-2 py-1.5 rounded-lg bg-ivory-100">
                <ChevronDown className="w-4 h-4 text-taupe-400" />
              </div>
            </div>
            {/* 북마크 (활성) */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gold/10 border border-gold/20">
              <Star className="w-4 h-4 text-gold fill-gold" />
              <span className="text-[11px] font-medium text-gold">저장됨</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 5 — 시작하기
   ───────────────────────────────────────────── */
function SlideStart({ onClose }: { onClose: () => void }) {
  const handleStart = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // 무시
    }
    onClose();
  }, [onClose]);

  const handleNeverShow = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // 무시
    }
    onClose();
  }, [onClose]);

  return (
    <div className="flex flex-col items-center text-center px-6">
      <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-5 leading-snug">
        커뮤니티 규칙
      </h2>

      {/* 규칙 카드 */}
      <div className="w-full max-w-[320px] flex flex-col gap-2.5 mb-5">
        {[
          {
            color: "bg-[#2E7D5A]",
            label: "일반",
            desc: "직접 쓴 글",
          },
          {
            color: "bg-[#C9A96E]",
            label: "협찬",
            desc: "혜택 받은 글",
          },
          {
            color: "bg-[#D85A5A]",
            label: "광고",
            desc: "알고리즘 미반영",
          },
        ].map((rule, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-ivory-100 border border-ivory-200"
          >
            <div className={`w-3 h-3 rounded-full ${rule.color} shrink-0`} />
            <span className="text-[13px] text-noir-800 font-semibold min-w-[36px]">
              {rule.label}
            </span>
            <span className="text-[12px] text-taupe-500 font-light">
              — {rule.desc}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[13px] text-taupe-500 font-light mb-6 leading-relaxed">
        정직한 후기가 모두에게 도움이 됩니다
      </p>

      {/* CTA */}
      <button
        onClick={handleStart}
        className="w-full max-w-[320px] py-3.5 bg-noir-800 hover:bg-noir-soft text-white text-[15px] font-medium rounded-2xl transition-colors mb-3"
      >
        둘러보기
      </button>
      <button
        onClick={handleNeverShow}
        className="text-[13px] text-taupe-400 hover:text-taupe-500 transition-colors"
      >
        다시 보지 않기
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main Component
   ───────────────────────────────────────────── */
export default function CommunityGuide() {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [animating, setAnimating] = useState(false);

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
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // 무시
    }
    setVisible(false);
  }, []);

  const goTo = useCallback(
    (index: number, dir: "next" | "prev") => {
      if (animating || index < 0 || index >= TOTAL_SLIDES) return;
      setDirection(dir);
      setAnimating(true);
      setTimeout(() => {
        setCurrent(index);
        setTimeout(() => setAnimating(false), 320);
      }, 10);
    },
    [animating]
  );

  const next = useCallback(() => {
    if (current === TOTAL_SLIDES - 1) return;
    goTo(current + 1, "next");
  }, [current, goTo]);

  const prev = useCallback(() => {
    if (current === 0) return;
    goTo(current - 1, "prev");
  }, [current, goTo]);

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

  // 슬라이드 렌더
  function renderSlide() {
    switch (current) {
      case 0:
        return <SlideWelcome />;
      case 1:
        return <SlideWriteReview />;
      case 2:
        return <SlideCohort />;
      case 3:
        return <SlideInteractions />;
      case 4:
        return <SlideStart onClose={() => setVisible(false)} />;
      default:
        return null;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="relative w-full max-w-[520px] mx-4 bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* 상단: 페이지 번호 + 건너뛰기 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <span className="text-[13px] text-taupe-400 font-medium">
            {current + 1}/{TOTAL_SLIDES}
          </span>
          <button
            onClick={close}
            className="flex items-center gap-1 text-[13px] text-taupe-400 hover:text-noir-800 transition-colors"
          >
            건너뛰기
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 슬라이드 컨텐츠 */}
        <div className="relative overflow-hidden" style={{ minHeight: "420px" }}>
          <div
            className="py-4 flex flex-col items-center transition-all duration-300 ease-out"
            style={{
              opacity: animating ? 0 : 1,
              transform: animating
                ? direction === "next"
                  ? "translateX(60px)"
                  : "translateX(-60px)"
                : "translateX(0)",
            }}
          >
            {renderSlide()}
          </div>
        </div>

        {/* 하단: 네비게이션 */}
        <div className="px-6 pb-6 pt-2">
          {isLast ? null : (
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
          )}

          {/* 도트 인디케이터 */}
          <div className="flex items-center justify-center gap-2 mt-5">
            {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
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
