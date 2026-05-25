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
  TrendingUp,
  Camera,
  Shield,
  Users,
  Sparkles,
  FileSearch,
  AlertTriangle,
  Heart,
  Check,
  Megaphone,
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
      <div className="w-full max-w-[380px] flex flex-col gap-3 mb-7">
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
              className={`px-4 py-3 rounded-2xl text-base leading-relaxed max-w-[280px] ${
                bubble.align === "right"
                  ? "bg-[#9d6f36]/10 text-[#071629] rounded-br-md"
                  : "bg-[#fffdf7] text-[#071629] rounded-bl-md border border-[#fff8ec]"
              }`}
            >
              {bubble.text}
            </div>
          </div>
        ))}
      </div>

      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[#071629] mb-2 sm:mb-3 leading-snug">
        혼자 고민하지 마세요
      </h2>
      <p className="text-sm sm:text-base text-[#5d6879] font-light leading-relaxed max-w-[340px]">
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
      <div className="w-full max-w-[380px] mb-4">
        <div className="flex items-center gap-2 mb-3 px-1">
          <Search className="w-5 h-5 text-[#9d6f36]" />
          <span className="text-base text-[#9d6f36] font-medium">
            상황: 스드메 알아보는 중
          </span>
        </div>
      </div>

      {/* Mock 포스트 카드 — 실제 후기처럼 */}
      <div className="w-full max-w-[380px] rounded-2xl bg-white border border-[#fff8ec] shadow-sm overflow-hidden mb-4">
        <div className="px-4 pt-3.5 pb-2 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#A8D8A8] to-sage-500 flex items-center justify-center">
            <span className="text-base">🌿</span>
          </div>
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <span className="text-base text-[#071629] font-medium">가을의신부</span>
              </div>
            <span className="text-sm text-[#B5ADA3] font-light">어제 · 후기</span>
          </div>
        </div>
        <div className="px-4 pb-2">
          <div className="text-[17px] text-[#071629] font-semibold mb-1 text-left">
            강남 스튜디오 3곳 가격 솔직 비교 💍
          </div>
          <p className="text-base text-[#5d6879] font-light leading-relaxed text-left">
            기본가 280만원인데 추가금이 130만원... 총 410만원이었어요.
            다른 곳은 패키지 350만원에 추가금 거의 없었어요. 사진 비교해볼게요
          </p>
        </div>
        {/* 실제 가격 비교 테이블 */}
        <div className="px-4 pb-3">
          <div className="bg-[#fffdf7] rounded-xl p-3 border border-[#fff8ec]">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-sm text-[#B5ADA3] mb-1">A 스튜디오</div>
                <div className="text-base font-semibold text-[#071629]">410만</div>
                <div className="text-sm text-red-500">추가금 多</div>
              </div>
              <div>
                <div className="text-sm text-[#B5ADA3] mb-1">B 스튜디오</div>
                <div className="text-base font-semibold text-sage-500">350만</div>
                <div className="text-sm text-sage-500">추천 ✓</div>
              </div>
              <div>
                <div className="text-sm text-[#B5ADA3] mb-1">C 스튜디오</div>
                <div className="text-base font-semibold text-[#071629]">380만</div>
                <div className="text-sm text-[#B5ADA3]">보통</div>
              </div>
            </div>
          </div>
        </div>
        {/* 이미지 */}
        <div className="px-4 pb-3 flex gap-2">
          <div className="flex-1 h-[48px] rounded-lg bg-gradient-to-br from-[#9d6f36]/15 to-[#9d6f36]/5 border border-[#9d6f36]/10 flex items-center justify-center">
            <Camera className="w-4 h-4 text-[#9d6f36]/40" />
          </div>
          <div className="flex-1 h-[48px] rounded-lg bg-gradient-to-br from-[#C9A96E]/15 to-[#C9A96E]/5 border border-[#C9A96E]/10 flex items-center justify-center">
            <Camera className="w-4 h-4 text-[#C9A96E]/40" />
          </div>
          <div className="flex-1 h-[48px] rounded-lg bg-gradient-to-br from-sage-500/15 to-sage-500/5 border border-sage-500/10 flex items-center justify-center">
            <Camera className="w-4 h-4 text-sage-500/40" />
          </div>
        </div>
        <div className="px-4 py-2.5 border-t border-[#fff8ec] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 text-sage-500">
              <ChevronUp className="w-5 h-5" />
              <span className="text-base font-semibold">47</span>
              <ChevronDown className="w-5 h-5 text-[#B5ADA3]" />
            </div>
            <div className="flex items-center gap-1 text-[#B5ADA3]">
              <MessageCircle className="w-4 h-4" />
              <span className="text-sm">23</span>
            </div>
          </div>
          <Bookmark className="w-4 h-4 text-[#B5ADA3]" />
        </div>
      </div>

      <p className="text-base text-[#5d6879] font-light text-center">
        <span className="text-[#9d6f36] font-medium">가격, 사진, 솔직한 평가</span>까지
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
      <div className="w-full max-w-[380px] mb-4">
        <div className="flex items-center gap-2 mb-3 px-1">
          <Users className="w-5 h-5 text-[#9d6f36]" />
          <span className="text-base text-[#9d6f36] font-medium">
            상황: 주변에 결혼 준비하는 친구가 없을 때
          </span>
        </div>
      </div>

      {/* 동기방 카드 */}
      <div className="w-full max-w-[380px] rounded-2xl bg-gradient-to-br from-[#071629] to-[#2A2A30] p-4 mb-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[17px] text-white font-semibold">2026 2분기 동기방</div>
            <div className="text-sm text-white/50 font-light mt-0.5">4~6월 결혼 예정 커플</div>
          </div>
          <div className="px-2.5 py-1 rounded-full bg-sage-500/30 text-sm text-[#A8D8A8] font-medium">
            248명 활동 중
          </div>
        </div>
        <div className="flex items-center mb-3">
          {[
            "from-[#9d6f36] to-[#C9A96E]",
            "from-[#A8D8A8] to-sage-500",
            "from-[#7EB8D8] to-[#5A9CC0]",
            "from-[#C9A96E] to-[#DCC9A0]",
            "from-[#D88B8B] to-[#102a4d]",
          ].map((grad, i) => (
            <div
              key={i}
              className={`w-8 h-8 rounded-full bg-gradient-to-br ${grad} border-2 border-[#071629] ${i > 0 ? "-ml-2" : ""}`}
              style={{ zIndex: 5 - i }}
            />
          ))}
          <span className="text-sm text-white/40 ml-2">+243</span>
        </div>
      </div>

      {/* 실제 대화 예시 */}
      <div className="w-full max-w-[380px] flex flex-col gap-2.5 mb-5">
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7EB8D8] to-[#5A9CC0] shrink-0 mt-0.5" />
          <div>
            <div className="text-sm text-[#B5ADA3] mb-0.5">행복한예비맘</div>
            <div className="bg-[#fffdf7] rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[280px] border border-[#fff8ec]">
              <span className="text-base text-[#071629] leading-relaxed">
                강남 스튜디오 다들 얼마에 계약하셨어요? 380만원 견적이 적정한지 모르겠어요 💭
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#C9A96E] to-[#DCC9A0] shrink-0 mt-0.5" />
          <div>
            <div className="text-sm text-[#B5ADA3] mb-0.5">민트초코신부</div>
            <div className="bg-[#fffdf7] rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[280px] border border-[#fff8ec]">
              <span className="text-base text-[#071629] leading-relaxed">
                저는 340만원에 했어요! 추가금 거의 없어서 가성비 좋았어요
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#D88B8B] to-[#102a4d] shrink-0 mt-0.5" />
          <div>
            <div className="text-sm text-[#B5ADA3] mb-0.5">달빛웨딩</div>
            <div className="bg-[#fffdf7] rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[280px] border border-[#fff8ec]">
              <span className="text-base text-[#071629] leading-relaxed">
                저도 거기 상담 받았어요. 자세한 후기 글로 올려드릴게요 ✍️
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-base text-[#5d6879] font-light text-center">
        <span className="text-[#9d6f36] font-medium">같은 시기에 결혼하는 동기들</span>과
        <br />
        정보도 나누고, 응원도 하고
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 4 — 아모라가 같이 본다 (커뮤니티 ↔ AI 통합)
   ───────────────────────────────────────────── */
function SlideAmora() {
  return (
    <div className="flex flex-col items-center px-6">
      {/* 시나리오 라벨 */}
      <div className="w-full max-w-[380px] mb-4">
        <div className="flex items-center gap-2 mb-3 px-1">
          <Sparkles className="w-5 h-5 text-[#9d6f36]" />
          <span className="text-base text-[#9d6f36] font-medium">
            혼자 판단하지 마세요 — AI 아모라가 같이 봐줘요
          </span>
        </div>
      </div>

      {/* 아모라 견적 체크리스트 카드 mockup */}
      <div className="w-full max-w-[380px] rounded-2xl bg-white border border-[#fff8ec] shadow-sm overflow-hidden mb-4">
        <div className="px-4 pt-3.5 pb-2 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#9d6f36] to-[#C9A96E] flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-base text-[#071629] font-medium">아모라 견적 체크리스트</span>
            <span className="text-sm text-[#B5ADA3] font-light">방금 정리 완료</span>
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-left">
              <div className="text-sm text-amber-800 font-semibold mb-0.5">원본 데이터 비용 누락</div>
              <div className="text-sm text-amber-700 leading-relaxed">
                강남 평균 +40~80만원 추가될 가능성. 계약 전에 꼭 확인하세요.
              </div>
            </div>
          </div>
          <div className="bg-[#fffdf7] border border-[#fff8ec] rounded-xl p-3 flex items-start gap-2">
            <FileSearch className="w-4 h-4 text-[#9d6f36] shrink-0 mt-0.5" />
            <div className="text-left">
              <div className="text-sm text-[#071629] font-semibold mb-0.5">업체에 물어볼 질문</div>
              <div className="text-sm text-[#5d6879] leading-relaxed">
                &ldquo;원본 데이터 비용 포함 견적으로 다시 받을 수 있을까요?&rdquo;
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 아모라가 통합하는 것들 — 칩 */}
      <div className="w-full max-w-[380px] mb-4">
        <p className="text-sm text-[#928980] mb-2 text-left">아모라 하나가 다 연결돼 있어요</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { icon: FileSearch, label: "견적 체크리스트" },
            { icon: Shield, label: "계약서 검토" },
            { icon: TrendingUp, label: "예산 자동 반영" },
            { icon: Camera, label: "일정 자동 등록" },
            { icon: Heart, label: "양가·상견례 코칭" },
            { icon: AlertTriangle, label: "숨은 비용 경고" },
          ].map((chip) => (
            <span
              key={chip.label}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#fffdf7] border border-[#fff8ec] text-sm text-[#5d6879]"
            >
              <chip.icon className="w-3.5 h-3.5 text-[#9d6f36]" />
              {chip.label}
            </span>
          ))}
        </div>
      </div>

      <p className="text-base text-[#5d6879] font-light text-center">
        커뮤니티 글에서도 <span className="text-[#9d6f36] font-medium">아모라가 가격 댓글</span>로 적정한지 알려줘요
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 5 — 나만의 커뮤니티 활용법
   ───────────────────────────────────────────── */
function SlideHowToUse() {
  return (
    <div className="flex flex-col items-center px-6">
      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[#071629] mb-4 sm:mb-6 leading-snug">
        이렇게 활용하세요
      </h2>

      <div className="w-full max-w-[380px] flex flex-col gap-3">
        {/* 1. 검색 */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#fffdf7] border border-[#fff8ec]">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#9d6f36]/20 to-[#9d6f36]/5 flex items-center justify-center shrink-0">
            <Search className="w-5 h-5 text-[#9d6f36]" />
          </div>
          <div className="text-left">
            <div className="text-base text-[#071629] font-semibold mb-1">검색으로 빠르게</div>
            <div className="text-sm text-[#5d6879] font-light leading-relaxed">
              &quot;강남 스튜디오&quot; &quot;300만원대 스드메&quot; 검색하면
              <br />관련 후기가 바로 나와요
            </div>
          </div>
        </div>

        {/* 2. 투표 */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#fffdf7] border border-[#fff8ec]">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sage-500/20 to-sage-500/5 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-sage-500" />
          </div>
          <div className="text-left">
            <div className="text-base text-[#071629] font-semibold mb-1">좋은 글은 투표로</div>
            <div className="text-sm text-[#5d6879] font-light leading-relaxed">
              도움 된 글에 ▲ 투표하면 다른 신부들도 찾기 쉬워져요
            </div>
          </div>
        </div>

        {/* 3. 북마크 */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#fffdf7] border border-[#fff8ec]">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#C9A96E]/20 to-[#C9A96E]/5 flex items-center justify-center shrink-0">
            <Star className="w-5 h-5 text-[#C9A96E]" />
          </div>
          <div className="text-left">
            <div className="text-base text-[#071629] font-semibold mb-1">나중에 볼 글은 저장</div>
            <div className="text-sm text-[#5d6879] font-light leading-relaxed">
              ★ 북마크하면 &quot;내 저장 글&quot;에서 언제든 다시 볼 수 있어요
            </div>
          </div>
        </div>

        {/* 4. 글쓰기 */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#fffdf7] border border-[#fff8ec]">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#071629]/20 to-[#071629]/5 flex items-center justify-center shrink-0">
            <PenSquare className="w-5 h-5 text-[#071629]" />
          </div>
          <div className="text-left">
            <div className="text-base text-[#071629] font-semibold mb-1">내 경험도 나눠주세요</div>
            <div className="text-sm text-[#5d6879] font-light leading-relaxed">
              사진/영상과 함께 후기를 올리면 다른 커플에게 큰 도움이 돼요
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 5 — 커뮤니티 약속 + CTA
   ───────────────────────────────────────────── */
function SlideStart({ onClose }: { onClose: () => void }) {
  const handleStart = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
      window.dispatchEvent(new CustomEvent("hanbang:community-guide-completed"));
    } catch { /* */ }
    onClose();
  }, [onClose]);

  const handleNeverShow = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
      window.dispatchEvent(new CustomEvent("hanbang:community-guide-completed"));
    } catch { /* */ }
    onClose();
  }, [onClose]);

  return (
    <div className="flex flex-col items-center text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#9d6f36] to-[#C9A96E] flex items-center justify-center mb-5">
        <Shield className="w-8 h-8 text-white" />
      </div>

      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[#071629] mb-4 sm:mb-5 leading-snug">
        우리의 약속
      </h2>

      <div className="w-full max-w-[360px] flex flex-col gap-2.5 mb-6">
        {[
          {
            Icon: Check,
            color: "#0284C7",
            bg: "#F0F9FF",
            border: "#BAE6FD",
            label: "일반",
            desc: "직접 경험한 솔직한 글",
          },
          {
            Icon: Star,
            color: "#A16207",
            bg: "#FEFCE8",
            border: "#FDE68A",
            label: "협찬",
            desc: "혜택 받았지만 솔직하게",
          },
          {
            Icon: Megaphone,
            color: "#334155",
            bg: "#F1F5F9",
            border: "#CBD5E1",
            label: "광고",
            desc: "광고는 표시하고, 추천에서 제외",
          },
        ].map((rule, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#fffdf7] border border-[#fff8ec]">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 border"
              style={{ backgroundColor: rule.bg, borderColor: rule.border, color: rule.color }}
              aria-hidden
            >
              <rule.Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
            </div>
            <span className="text-base text-[#071629] font-semibold min-w-[40px]">{rule.label}</span>
            <span className="text-sm text-[#5d6879] font-light">— {rule.desc}</span>
          </div>
        ))}
      </div>

      <p className="text-base text-[#5d6879] font-light mb-6 leading-relaxed">
        서로의 경험이 누군가의 큰 도움이 됩니다
      </p>

      <button
        onClick={handleStart}
        className="w-full max-w-[340px] py-3.5 bg-gradient-to-br from-[#9d6f36] to-[#102a4d] text-white text-base font-medium rounded-2xl shadow-[0_4px_14px_0_rgba(6,26,52,0.2)] hover:shadow-[0_6px_20px_rgba(6,26,52,0.23)] transition-all mb-3"
      >
        커뮤니티 둘러보기
      </button>
      <button
        onClick={handleNeverShow}
        className="text-base text-[#B5ADA3] hover:text-[#5d6879] transition-colors underline underline-offset-2"
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
    try {
      localStorage.setItem(STORAGE_KEY, "true");
      window.dispatchEvent(new CustomEvent("hanbang:community-guide-completed"));
    } catch { /* */ }
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
      case 3: return <SlideAmora />;
      case 4: return <SlideHowToUse />;
      case 5: return <SlideStart onClose={() => setVisible(false)} />;
      default: return null;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="relative w-full max-w-[560px] mx-4 my-4 sm:my-0 max-h-[calc(100vh-2rem)] overflow-y-auto bg-white rounded-3xl shadow-2xl">
        {/* 상단 진행 바 */}
        <div className="h-1 bg-[#fff8ec]">
          <div
            className="h-full bg-gradient-to-r from-[#9d6f36] to-[#C9A96E] transition-all duration-500 rounded-full"
            style={{ width: `${((current + 1) / TOTAL_SLIDES) * 100}%` }}
          />
        </div>

        {/* 헤더 — 모바일 컴팩트 + no-min-tap 으로 텍스트 버튼 부피 회피 */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-3 sm:pt-4 pb-1 sm:pb-2">
          <span className="text-xs sm:text-sm text-[#B5ADA3] font-medium tabular-nums">
            {current + 1}/{TOTAL_SLIDES}
          </span>
          <button
            onClick={close}
            className="no-min-tap flex items-center gap-1 text-xs sm:text-sm text-[#B5ADA3] hover:text-[#071629] transition-colors"
          >
            건너뛰기
            <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>

        {/* 슬라이드 — 모바일에선 min-h 제거해 짧은 슬라이드가 화면 가득 채우지 않음 */}
        <div
          className="relative overflow-hidden sm:min-h-[500px]"
        >
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
                className="flex items-center gap-1 px-4 py-3 text-base text-[#5d6879] hover:text-[#071629] disabled:opacity-0 disabled:pointer-events-none transition-all rounded-xl"
              >
                <ChevronLeft className="w-4 h-4" />
                이전
              </button>
              <button
                onClick={next}
                className="flex items-center gap-1 px-6 py-3 bg-[#9d6f36] hover:bg-[#102a4d] text-white text-base font-medium rounded-xl transition-colors"
              >
                다음
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 도트 인디케이터 — 모든 점 동일 사이즈, active 만 색 진하게.
              no-min-tap 으로 글로벌 button min-height:40px 제외. */}
          <div className="flex items-center justify-center gap-1.5 mt-5">
            {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i, i > current ? "next" : "prev")}
                className={`no-min-tap w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                  i === current ? "bg-[#9d6f36]" : "bg-[#B5ADA3]/35 hover:bg-[#B5ADA3]/60"
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
