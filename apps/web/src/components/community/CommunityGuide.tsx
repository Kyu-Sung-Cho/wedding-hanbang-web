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
  Users,
  TrendingUp,
  Camera,
  Crown,
  Shield,
} from "lucide-react";

const STORAGE_KEY = "hanbang_community_guide_seen";
const TOTAL_SLIDES = 6;

/* ─────────────────────────────────────────────
   Slide 1 — 공감 시작 (기능 나열 X, 감정으로 시작)
   ───────────────────────────────────────────── */
function SlideEmpathy() {
  return (
    <div className="flex flex-col items-center text-center px-6">
      {/* 말풍선 시나리오 */}
      <div className="w-full max-w-[340px] flex flex-col gap-2.5 mb-6">
        {[
          { text: "스드메 가격이 적정한 건지 모르겠어요...", align: "left" as const },
          { text: "다른 신부들은 어디서 예약했어요?", align: "right" as const },
          { text: "예식장 추가금이 이렇게 많은 줄 몰랐어요 😢", align: "left" as const },
        ].map((bubble, i) => (
          <div
            key={i}
            className={`flex ${bubble.align === "right" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed max-w-[240px] ${
                bubble.align === "right"
                  ? "bg-rose-500/10 text-noir-800 rounded-br-md"
                  : "bg-ivory-100 text-noir-800 rounded-bl-md border border-ivory-200"
              }`}
            >
              {bubble.text}
            </div>
          </div>
        ))}
      </div>

      <h2 className="font-serif-kr text-[22px] font-normal text-noir-800 mb-2 leading-snug">
        혼자 고민하지 마세요
      </h2>
      <p className="text-[14px] text-taupe-500 font-light leading-relaxed max-w-[300px]">
        같은 고민을 했던 선배 신부·신랑들이
        <br />
        솔직한 경험을 나누는 공간이에요
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 2 — 진짜 후기 (시나리오: 스드메 알아볼 때)
   ───────────────────────────────────────────── */
function SlideRealReview() {
  return (
    <div className="flex flex-col items-center px-6">
      {/* 시나리오 상황 */}
      <div className="w-full max-w-[340px] mb-4">
        <div className="flex items-center gap-2 mb-3 px-1">
          <Search className="w-4 h-4 text-rose-500" />
          <span className="text-[13px] text-rose-500 font-medium">
            상황: 스드메 알아보는 중
          </span>
        </div>
      </div>

      {/* Mock 포스트 카드 — 실제 후기처럼 */}
      <div className="w-full max-w-[340px] rounded-2xl bg-white border border-ivory-200 shadow-sm overflow-hidden mb-3">
        <div className="px-4 pt-3.5 pb-2 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#A8D8A8] to-[#6BBF6B] flex items-center justify-center">
            <span className="text-[11px]">🌿</span>
          </div>
          <div className="flex flex-col items-start">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-noir-800 font-medium">가을의신부</span>
              <span className="text-[9px] px-1.5 py-0.5 bg-[#2E7D5A]/10 text-[#2E7D5A] rounded-full font-semibold">Lv.4</span>
            </div>
            <span className="text-[10px] text-taupe-400 font-light">어제 · 후기</span>
          </div>
        </div>
        <div className="px-4 pb-2">
          <div className="text-[14px] text-noir-800 font-semibold mb-1 text-left">
            강남 스드메 3곳 투어 솔직 비교 💍
          </div>
          <p className="text-[12px] text-taupe-500 font-light leading-relaxed text-left">
            기본가 280만원인데 추가금이 130만원... 총 410만원이었어요.
            다른 곳은 패키지 350만원에 추가금 거의 없었어요. 사진 비교해볼게요
          </p>
        </div>
        {/* 실제 가격 비교 테이블 */}
        <div className="px-4 pb-3">
          <div className="bg-ivory-50 rounded-xl p-3 border border-ivory-200">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] text-taupe-400 mb-1">A 스튜디오</div>
                <div className="text-[13px] font-semibold text-noir-800">410만</div>
                <div className="text-[9px] text-red-500">추가금 多</div>
              </div>
              <div>
                <div className="text-[10px] text-taupe-400 mb-1">B 스튜디오</div>
                <div className="text-[13px] font-semibold text-[#2E7D5A]">350만</div>
                <div className="text-[9px] text-[#2E7D5A]">추천 ✓</div>
              </div>
              <div>
                <div className="text-[10px] text-taupe-400 mb-1">C 스튜디오</div>
                <div className="text-[13px] font-semibold text-noir-800">380만</div>
                <div className="text-[9px] text-taupe-400">보통</div>
              </div>
            </div>
          </div>
        </div>
        {/* 이미지 */}
        <div className="px-4 pb-3 flex gap-2">
          <div className="flex-1 h-[44px] rounded-lg bg-gradient-to-br from-rose-500/15 to-rose-500/5 border border-rose-500/10 flex items-center justify-center">
            <Camera className="w-4 h-4 text-rose-500/40" />
          </div>
          <div className="flex-1 h-[44px] rounded-lg bg-gradient-to-br from-gold/15 to-gold/5 border border-gold/10 flex items-center justify-center">
            <Camera className="w-4 h-4 text-gold/40" />
          </div>
          <div className="flex-1 h-[44px] rounded-lg bg-gradient-to-br from-[#2E7D5A]/15 to-[#2E7D5A]/5 border border-[#2E7D5A]/10 flex items-center justify-center">
            <Camera className="w-4 h-4 text-[#2E7D5A]/40" />
          </div>
        </div>
        <div className="px-4 py-2.5 border-t border-ivory-200 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 text-[#2E7D5A]">
              <ChevronUp className="w-4 h-4" />
              <span className="text-[13px] font-semibold">47</span>
              <ChevronDown className="w-4 h-4 text-taupe-400" />
            </div>
            <div className="flex items-center gap-1 text-taupe-400">
              <MessageCircle className="w-3.5 h-3.5" />
              <span className="text-[12px]">23</span>
            </div>
          </div>
          <Bookmark className="w-4 h-4 text-taupe-400" />
        </div>
      </div>

      <p className="text-[13px] text-taupe-500 font-light text-center">
        <span className="text-rose-500 font-medium">가격, 사진, 솔직한 평가</span>까지
        <br />
        직접 경험한 후기로 비교하세요
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 3 — 동기방 (시나리오: 혼자라서 불안할 때)
   ───────────────────────────────────────────── */
function SlideCohort() {
  return (
    <div className="flex flex-col items-center px-6">
      {/* 시나리오 */}
      <div className="w-full max-w-[340px] mb-4">
        <div className="flex items-center gap-2 mb-3 px-1">
          <Users className="w-4 h-4 text-rose-500" />
          <span className="text-[13px] text-rose-500 font-medium">
            상황: 주변에 결혼 준비하는 친구가 없을 때
          </span>
        </div>
      </div>

      {/* 동기방 카드 */}
      <div className="w-full max-w-[340px] rounded-2xl bg-gradient-to-br from-noir-800 to-[#2A2A30] p-4 mb-3 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[15px] text-white font-semibold">2026 2분기 동기방</div>
            <div className="text-[11px] text-white/50 font-light mt-0.5">4~6월 결혼 예정 커플</div>
          </div>
          <div className="px-2.5 py-1 rounded-full bg-[#2E7D5A]/30 text-[10px] text-[#6BBF6B] font-medium">
            248명 활동 중
          </div>
        </div>
        <div className="flex items-center mb-3">
          {[
            "from-rose-500 to-gold",
            "from-[#A8D8A8] to-[#6BBF6B]",
            "from-[#7EB8D8] to-[#5A9CC0]",
            "from-gold to-[#DCC9A0]",
            "from-[#D88B8B] to-[#C06B6B]",
          ].map((grad, i) => (
            <div
              key={i}
              className={`w-7 h-7 rounded-full bg-gradient-to-br ${grad} border-2 border-noir-800 ${i > 0 ? "-ml-2" : ""}`}
              style={{ zIndex: 5 - i }}
            />
          ))}
          <span className="text-[11px] text-white/40 ml-2">+243</span>
        </div>
      </div>

      {/* 실제 대화 예시 */}
      <div className="w-full max-w-[340px] flex flex-col gap-2 mb-4">
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#7EB8D8] to-[#5A9CC0] shrink-0 mt-0.5" />
          <div>
            <div className="text-[10px] text-taupe-400 mb-0.5">행복한예비맘</div>
            <div className="bg-ivory-100 rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[260px] border border-ivory-200">
              <span className="text-[12px] text-noir-800 leading-relaxed">
                혹시 5월에 스드메 투어 같이 가실 분 계세요? 🙋‍♀️
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gold to-[#DCC9A0] shrink-0 mt-0.5" />
          <div>
            <div className="text-[10px] text-taupe-400 mb-0.5">민트초코신부</div>
            <div className="bg-ivory-100 rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[260px] border border-ivory-200">
              <span className="text-[12px] text-noir-800 leading-relaxed">
                저요! 저도 5월 말 예식인데 아직 스드메 못 정했어요 😂
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#D88B8B] to-[#C06B6B] shrink-0 mt-0.5" />
          <div>
            <div className="text-[10px] text-taupe-400 mb-0.5">달빛웨딩</div>
            <div className="bg-ivory-100 rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[260px] border border-ivory-200">
              <span className="text-[12px] text-noir-800 leading-relaxed">
                저 지난주에 다녀왔어요! 후기 올릴게요 ✍️
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-[13px] text-taupe-500 font-light text-center">
        <span className="text-rose-500 font-medium">같은 시기에 결혼하는 동기들</span>과
        <br />
        정보도 나누고, 응원도 하고
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 4 — 나만의 커뮤니티 활용법
   ───────────────────────────────────────────── */
function SlideHowToUse() {
  return (
    <div className="flex flex-col items-center px-6">
      <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-5 leading-snug">
        이렇게 활용하세요
      </h2>

      <div className="w-full max-w-[340px] flex flex-col gap-3">
        {/* 1. 검색 */}
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-ivory-50 border border-ivory-200">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500/20 to-rose-500/5 flex items-center justify-center shrink-0">
            <Search className="w-4.5 h-4.5 text-rose-500" />
          </div>
          <div className="text-left">
            <div className="text-[13px] text-noir-800 font-semibold mb-0.5">검색으로 빠르게</div>
            <div className="text-[11px] text-taupe-500 font-light leading-relaxed">
              &quot;강남 스튜디오&quot; &quot;300만원대 스드메&quot; 검색하면
              <br />관련 후기가 바로 나와요
            </div>
          </div>
        </div>

        {/* 2. 투표 */}
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-ivory-50 border border-ivory-200">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2E7D5A]/20 to-[#2E7D5A]/5 flex items-center justify-center shrink-0">
            <TrendingUp className="w-4.5 h-4.5 text-[#2E7D5A]" />
          </div>
          <div className="text-left">
            <div className="text-[13px] text-noir-800 font-semibold mb-0.5">좋은 글은 투표로</div>
            <div className="text-[11px] text-taupe-500 font-light leading-relaxed">
              도움 된 글에 ▲ 투표하면 다른 신부들도 찾기 쉬워져요
            </div>
          </div>
        </div>

        {/* 3. 북마크 */}
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-ivory-50 border border-ivory-200">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold/20 to-gold/5 flex items-center justify-center shrink-0">
            <Star className="w-4.5 h-4.5 text-gold" />
          </div>
          <div className="text-left">
            <div className="text-[13px] text-noir-800 font-semibold mb-0.5">나중에 볼 글은 저장</div>
            <div className="text-[11px] text-taupe-500 font-light leading-relaxed">
              ★ 북마크하면 &quot;내 저장 글&quot;에서 언제든 다시 볼 수 있어요
            </div>
          </div>
        </div>

        {/* 4. 글쓰기 */}
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-ivory-50 border border-ivory-200">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-noir-800/20 to-noir-800/5 flex items-center justify-center shrink-0">
            <PenSquare className="w-4.5 h-4.5 text-noir-800" />
          </div>
          <div className="text-left">
            <div className="text-[13px] text-noir-800 font-semibold mb-0.5">내 경험도 나눠주세요</div>
            <div className="text-[11px] text-taupe-500 font-light leading-relaxed">
              사진/영상과 함께 후기를 올리면 다른 커플에게 큰 도움이 돼요
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 5 — 랭크 시스템
   ───────────────────────────────────────────── */
function SlideRankSystem() {
  return (
    <div className="flex flex-col items-center px-6">
      <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-2 leading-snug">
        활동하면 랭크가 올라가요
      </h2>
      <p className="text-[13px] text-taupe-500 font-light mb-5">
        글쓰기, 댓글, 투표로 경험치를 쌓으세요
      </p>

      <div className="w-full max-w-[320px] flex flex-col gap-2">
        {[
          { rank: "🌱", name: "새싹", level: "Lv.1", desc: "가입하면 바로", color: "from-[#A8D8A8] to-[#6BBF6B]", xp: "0 XP" },
          { rank: "🌿", name: "준비중", level: "Lv.2", desc: "첫 글 작성", color: "from-[#7EB8D8] to-[#5A9CC0]", xp: "100 XP" },
          { rank: "💐", name: "전문가", level: "Lv.3", desc: "후기 5개 이상", color: "from-rose-500 to-gold", xp: "500 XP" },
          { rank: "👑", name: "마스터", level: "Lv.4", desc: "BEST 글 선정", color: "from-gold to-[#DCC9A0]", xp: "1,500 XP" },
          { rank: "💎", name: "시니어", level: "Lv.5", desc: "결혼 완료 선배", color: "from-[#B39DDB] to-[#7E57C2]", xp: "5,000 XP" },
        ].map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-ivory-200 hover:border-rose-500/20 transition-colors"
          >
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center shrink-0`}>
              <span className="text-[16px]">{item.rank}</span>
            </div>
            <div className="flex-1 text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] text-noir-800 font-semibold">{item.name}</span>
                <span className="text-[9px] px-1.5 py-0.5 bg-ivory-100 text-taupe-500 rounded-full">{item.level}</span>
              </div>
              <div className="text-[11px] text-taupe-400 font-light">{item.desc}</div>
            </div>
            <div className="text-[11px] text-taupe-400 font-light">{item.xp}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 6 — 커뮤니티 약속 + CTA
   ───────────────────────────────────────────── */
function SlideStart({ onClose }: { onClose: () => void }) {
  const handleStart = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* */ }
    onClose();
  }, [onClose]);

  const handleNeverShow = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* */ }
    onClose();
  }, [onClose]);

  return (
    <div className="flex flex-col items-center text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center mb-4">
        <Shield className="w-7 h-7 text-white" />
      </div>

      <h2 className="font-serif-kr text-[20px] font-normal text-noir-800 mb-4 leading-snug">
        우리의 약속
      </h2>

      <div className="w-full max-w-[320px] flex flex-col gap-2.5 mb-5">
        {[
          { color: "bg-[#2E7D5A]", label: "일반", desc: "직접 경험한 솔직한 글" },
          { color: "bg-[#C9A96E]", label: "협찬", desc: "혜택 받았지만 솔직하게" },
          { color: "bg-[#D85A5A]", label: "광고", desc: "광고는 표시하고, 추천에서 제외" },
        ].map((rule, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-ivory-50 border border-ivory-200">
            <div className={`w-3 h-3 rounded-full ${rule.color} shrink-0`} />
            <span className="text-[13px] text-noir-800 font-semibold min-w-[36px]">{rule.label}</span>
            <span className="text-[12px] text-taupe-500 font-light">— {rule.desc}</span>
          </div>
        ))}
      </div>

      <p className="text-[13px] text-taupe-500 font-light mb-6 leading-relaxed">
        서로의 경험이 누군가의 큰 도움이 됩니다
      </p>

      <button
        onClick={handleStart}
        className="w-full max-w-[320px] py-3.5 bg-noir-800 hover:bg-noir-soft text-white text-[15px] font-medium rounded-2xl transition-colors mb-3"
      >
        커뮤니티 둘러보기
      </button>
      <button
        onClick={handleNeverShow}
        className="text-[13px] text-taupe-400 hover:text-taupe-500 transition-colors underline underline-offset-2"
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
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState<"next" | "prev">("next");

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch { /* */ }
  }, []);

  const close = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* */ }
    setVisible(false);
  }, []);

  const goTo = useCallback((index: number, dir: "next" | "prev") => {
    if (animating || index < 0 || index >= TOTAL_SLIDES) return;
    setDirection(dir);
    setAnimating(true);
    setTimeout(() => {
      setCurrent(index);
      setTimeout(() => setAnimating(false), 320);
    }, 10);
  }, [animating]);

  const next = useCallback(() => {
    if (current < TOTAL_SLIDES - 1) goTo(current + 1, "next");
  }, [current, goTo]);

  const prev = useCallback(() => {
    if (current > 0) goTo(current - 1, "prev");
  }, [current, goTo]);

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

  function renderSlide() {
    switch (current) {
      case 0: return <SlideEmpathy />;
      case 1: return <SlideRealReview />;
      case 2: return <SlideCohort />;
      case 3: return <SlideHowToUse />;
      case 4: return <SlideRankSystem />;
      case 5: return <SlideStart onClose={() => setVisible(false)} />;
      default: return null;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="relative w-full max-w-[520px] mx-4 bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* 상단 진행 바 */}
        <div className="h-1 bg-ivory-200">
          <div
            className="h-full bg-gradient-to-r from-rose-500 to-gold transition-all duration-500 rounded-full"
            style={{ width: `${((current + 1) / TOTAL_SLIDES) * 100}%` }}
          />
        </div>

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 pt-4 pb-2">
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

        {/* 슬라이드 */}
        <div className="relative overflow-hidden" style={{ minHeight: "460px" }}>
          <div
            className="py-4 flex flex-col items-center transition-all duration-300 ease-out"
            style={{
              opacity: animating ? 0 : 1,
              transform: animating
                ? `translateX(${direction === "next" ? 60 : -60}px) scale(0.98)`
                : "translateX(0) scale(1)",
            }}
          >
            {renderSlide()}
          </div>
        </div>

        {/* 하단 네비게이션 */}
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
