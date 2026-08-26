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
          { text: "사진 촬영·드레스·메이크업 가격을 어떻게 비교해야 할지 모르겠어요.", align: "left" as const },
          { text: "다들 어디서 예약했어요?", align: "right" as const },
          { text: "결혼식장 견적에서 따로 내는 금액을 놓칠 뻔했어요.", align: "left" as const },
        ].map((bubble, i) => (
          <div
            key={i}
            className={`flex ${bubble.align === "right" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`px-4 py-3 rounded-2xl text-base leading-relaxed max-w-[280px] ${
                bubble.align === "right"
                  ? "bg-[#36534E]/10 text-[#263832] rounded-br-md"
                  : "bg-[#fbf8f2] text-[#263832] rounded-bl-md border border-[#f6efe5]"
              }`}
            >
              {bubble.text}
            </div>
          </div>
        ))}
      </div>

      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[#263832] mb-2 sm:mb-3 leading-snug">
        혼자 고민하지 마세요
      </h2>
      <p className="text-sm sm:text-base text-[#635b51] font-light leading-relaxed max-w-[340px]">
        같은 고민을 했던 선배 신부·신랑들이
        <br />
        솔직한 경험을 나누는 공간이에요
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Slide 2 — 후기 예시 (사진 촬영·드레스·메이크업을 알아볼 때)
   ───────────────────────────────────────────── */
function SlideRealReview() {
  return (
    <div className="flex flex-col items-center px-6">
      {/* 시나리오 상황 */}
      <div className="w-full max-w-[380px] mb-4">
        <div className="flex items-center gap-2 mb-3 px-1">
          <Search className="w-5 h-5 text-[#36534E]" />
          <span className="text-base text-[#36534E] font-medium">
            상황: 사진 촬영 업체를 알아보는 중
          </span>
        </div>
      </div>

      {/* Mock 포스트 카드 — 실제 후기처럼 */}
      <div className="w-full max-w-[380px] rounded-2xl bg-white border border-[#f6efe5] shadow-sm overflow-hidden mb-4">
        <div className="px-4 pt-3.5 pb-2 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#A8D8A8] to-sage-500 flex items-center justify-center">
            <span className="text-base">🌿</span>
          </div>
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <span className="text-base text-[#263832] font-medium">가을의신부</span>
              </div>
            <span className="text-sm text-[#B5ADA3] font-light">어제 · 후기</span>
          </div>
        </div>
        <div className="px-4 pb-2">
          <div className="text-[17px] text-[#263832] font-semibold mb-1 text-left">
            샘플 게시글 · 스튜디오 조건 비교 💍
          </div>
          <p className="text-base text-[#635b51] font-light leading-relaxed text-left">
            같은 상품 이름이어도 받는 전체 사진 수와 보정해 주는 사진 수가 달랐어요.
            받은 견적의 기준일과 따로 내는 금액을 함께 비교해볼게요.
          </p>
        </div>
        {/* 샘플 조건 비교 테이블 */}
        <div className="px-4 pb-3">
          <div className="bg-[#fbf8f2] rounded-xl p-3 border border-[#f6efe5]">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-sm text-[#B5ADA3] mb-1">샘플 A</div>
                <div className="text-base font-semibold text-[#263832]">총액 확인</div>
                <div className="text-sm text-red-500">별도 확인</div>
              </div>
              <div>
                <div className="text-sm text-[#B5ADA3] mb-1">샘플 B</div>
                <div className="text-base font-semibold text-sage-500">구성 공개</div>
                <div className="text-sm text-sage-500">원문 확인</div>
              </div>
              <div>
                <div className="text-sm text-[#B5ADA3] mb-1">샘플 C</div>
                <div className="text-base font-semibold text-[#263832]">기준일 확인</div>
                <div className="text-sm text-[#B5ADA3]">서면 확인</div>
              </div>
            </div>
          </div>
        </div>
        {/* 이미지 */}
        <div className="px-4 pb-3 flex gap-2">
          <div className="flex-1 h-[48px] rounded-lg bg-gradient-to-br from-[#36534E]/15 to-[#36534E]/5 border border-[#36534E]/10 flex items-center justify-center">
            <Camera className="w-4 h-4 text-[#36534E]/40" />
          </div>
          <div className="flex-1 h-[48px] rounded-lg bg-gradient-to-br from-[#B89785]/15 to-[#2B423E]/5 border border-[#B89785]/10 flex items-center justify-center">
            <Camera className="w-4 h-4 text-[#B89785]/40" />
          </div>
          <div className="flex-1 h-[48px] rounded-lg bg-gradient-to-br from-sage-500/15 to-sage-500/5 border border-sage-500/10 flex items-center justify-center">
            <Camera className="w-4 h-4 text-sage-500/40" />
          </div>
        </div>
        <div className="px-4 py-2.5 border-t border-[#f6efe5] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 text-sage-500">
              <ChevronUp className="w-5 h-5" />
              <span className="text-base font-semibold">공감</span>
              <ChevronDown className="w-5 h-5 text-[#B5ADA3]" />
            </div>
            <div className="flex items-center gap-1 text-[#B5ADA3]">
              <MessageCircle className="w-4 h-4" />
              <span className="text-sm">답변</span>
            </div>
          </div>
          <Bookmark className="w-4 h-4 text-[#B5ADA3]" />
        </div>
      </div>

      <p className="text-base text-[#635b51] font-light text-center">
        <span className="text-[#36534E] font-medium">가격, 사진, 솔직한 평가</span>까지
        <br />
        회원이 공유한 후기와 질문을 비교하세요
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
          <Users className="w-5 h-5 text-[#36534E]" />
          <span className="text-base text-[#36534E] font-medium">
            상황: 주변에 결혼 준비하는 친구가 없을 때
          </span>
        </div>
      </div>

      {/* 동기방 카드 */}
      <div className="w-full max-w-[380px] rounded-2xl border border-[#d8bb86]/60 bg-[linear-gradient(135deg,#fffdf8_0%,#ffffff_55%,#eef4eb_100%)] p-4 mb-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[17px] text-[#263832] font-semibold">샘플 동기방</div>
            <div className="text-sm text-[#7a8290] font-light mt-0.5">비슷한 시기 결혼 예정 커플</div>
          </div>
          <div className="px-2.5 py-1 rounded-full bg-[#36534E]/10 text-sm text-[#36534E] font-medium">
            예시 화면
          </div>
        </div>
        <div className="flex items-center mb-3">
          {[
            "from-[#36534E] to-[#2B423E]",
            "from-[#A8D8A8] to-sage-500",
            "from-[#7EB8D8] to-[#5A9CC0]",
            "from-[#B89785] to-[#DCC9A0]",
            "from-[#D88B8B] to-[#2B423E]",
          ].map((grad, i) => (
            <div
              key={i}
              className={`w-8 h-8 rounded-full bg-gradient-to-br ${grad} border-2 border-white shadow-sm ${i > 0 ? "-ml-2" : ""}`}
              style={{ zIndex: 5 - i }}
            />
          ))}
          <span className="text-sm text-[#7a8290] ml-2">예시 멤버</span>
        </div>
      </div>

      {/* 실제 대화 예시 */}
      <div className="w-full max-w-[380px] flex flex-col gap-2.5 mb-5">
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7EB8D8] to-[#5A9CC0] shrink-0 mt-0.5" />
          <div>
            <div className="text-sm text-[#B5ADA3] mb-0.5">행복한예비맘</div>
            <div className="bg-[#fbf8f2] rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[280px] border border-[#f6efe5]">
              <span className="text-base text-[#263832] leading-relaxed">
                사진 촬영 견적마다 받는 사진 수와 보정해 주는 사진 수가 달라서 비교하기 어렵네요.
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#B89785] to-[#DCC9A0] shrink-0 mt-0.5" />
          <div>
            <div className="text-sm text-[#B5ADA3] mb-0.5">민트초코신부</div>
            <div className="bg-[#fbf8f2] rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[280px] border border-[#f6efe5]">
              <span className="text-base text-[#263832] leading-relaxed">
                저는 같은 구성표로 맞춰봤어요. 별도 항목과 기준일도 함께 확인해보세요.
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#D88B8B] to-[#2B423E] shrink-0 mt-0.5" />
          <div>
            <div className="text-sm text-[#B5ADA3] mb-0.5">달빛웨딩</div>
            <div className="bg-[#fbf8f2] rounded-2xl rounded-tl-md px-3.5 py-2.5 max-w-[280px] border border-[#f6efe5]">
              <span className="text-base text-[#263832] leading-relaxed">
                저도 거기 상담 받았어요. 자세한 후기 글로 올려드릴게요 ✍️
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-base text-[#635b51] font-light text-center">
        <span className="text-[#36534E] font-medium">같은 시기에 결혼하는 동기들</span>과
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
          <Sparkles className="w-5 h-5 text-[#36534E]" />
          <span className="text-base text-[#36534E] font-medium">
            커뮤니티에서 찾고, 라운지에서 정리해요
          </span>
        </div>
      </div>

      {/* 현재 제공되는 라운지 기능만 안내 */}
      <div className="w-full max-w-[380px] rounded-2xl bg-white border border-[#f6efe5] shadow-sm overflow-hidden mb-4">
        <div className="px-4 pt-3.5 pb-2 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-[#36534E] flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-base text-[#263832] font-medium">웨딩 라운지로 이어가기</span>
            <span className="text-sm text-[#B5ADA3] font-light">지금 쓸 수 있는 준비 도구</span>
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="bg-[#fbf8f2] border border-[#f6efe5] rounded-xl p-3 mb-2 flex items-start gap-2">
            <MessageCircle className="w-4 h-4 text-[#36534E] shrink-0 mt-0.5" />
            <div className="text-left">
              <div className="text-sm text-[#263832] font-semibold mb-0.5">아모라 상담</div>
              <div className="text-sm text-[#635b51] leading-relaxed">
                커뮤니티에서 본 고민을 우리 상황에 맞게 다시 물어볼 수 있어요.
              </div>
            </div>
          </div>
          <div className="bg-[#fbf8f2] border border-[#f6efe5] rounded-xl p-3 flex items-start gap-2">
            <Check className="w-4 h-4 text-[#36534E] shrink-0 mt-0.5" />
            <div className="text-left">
              <div className="text-sm text-[#263832] font-semibold mb-0.5">예산·일정·체크리스트</div>
              <div className="text-sm text-[#635b51] leading-relaxed">
                확인한 금액, 상담 일정, 준비 상태를 라운지에서 직접 정리하세요.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 현재 연결되는 기능들 */}
      <div className="w-full max-w-[380px] mb-4">
        <p className="text-sm text-[#928980] mb-2 text-left">커뮤니티와 라운지가 이어지는 방법</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { icon: Search, label: "후기 검색" },
            { icon: Bookmark, label: "북마크" },
            { icon: Users, label: "동기방" },
            { icon: PenSquare, label: "글쓰기" },
            { icon: TrendingUp, label: "예산 관리" },
            { icon: Camera, label: "일정 관리" },
          ].map((chip) => (
            <span
              key={chip.label}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#fbf8f2] border border-[#f6efe5] text-sm text-[#635b51]"
            >
              <chip.icon className="w-3.5 h-3.5 text-[#36534E]" />
              {chip.label}
            </span>
          ))}
        </div>
      </div>

      <p className="text-base text-[#635b51] font-light text-center">
        후기는 커뮤니티에서 보고,
        <br />
        우리 준비는 <span className="text-[#36534E] font-medium">라운지에서 차분하게 정리</span>하세요
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
      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[#263832] mb-4 sm:mb-6 leading-snug">
        이렇게 활용하세요
      </h2>

      <div className="w-full max-w-[380px] flex flex-col gap-3">
        {/* 1. 검색 */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#fbf8f2] border border-[#f6efe5]">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#36534E]/20 to-[#36534E]/5 flex items-center justify-center shrink-0">
            <Search className="w-5 h-5 text-[#36534E]" />
          </div>
          <div className="text-left">
            <div className="text-base text-[#263832] font-semibold mb-1">검색으로 빠르게</div>
            <div className="text-sm text-[#635b51] font-light leading-relaxed">
              &quot;강남 사진 촬영&quot; &quot;받는 사진 수&quot;처럼 검색하면
              <br />관련 후기를 찾을 수 있어요
            </div>
          </div>
        </div>

        {/* 2. 투표 */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#fbf8f2] border border-[#f6efe5]">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sage-500/20 to-sage-500/5 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-sage-500" />
          </div>
          <div className="text-left">
            <div className="text-base text-[#263832] font-semibold mb-1">좋은 글은 투표로</div>
            <div className="text-sm text-[#635b51] font-light leading-relaxed">
              도움 된 글에 ▲ 투표하면 다른 예비부부도 찾기 쉬워져요
            </div>
          </div>
        </div>

        {/* 3. 북마크 */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#fbf8f2] border border-[#f6efe5]">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#B89785]/20 to-[#2B423E]/5 flex items-center justify-center shrink-0">
            <Star className="w-5 h-5 text-[#B89785]" />
          </div>
          <div className="text-left">
            <div className="text-base text-[#263832] font-semibold mb-1">나중에 볼 글은 저장</div>
            <div className="text-sm text-[#635b51] font-light leading-relaxed">
              ★ 북마크하면 &quot;내 저장 글&quot;에서 언제든 다시 볼 수 있어요
            </div>
          </div>
        </div>

        {/* 4. 글쓰기 */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#fbf8f2] border border-[#f6efe5]">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#263832]/20 to-[#263832]/5 flex items-center justify-center shrink-0">
            <PenSquare className="w-5 h-5 text-[#263832]" />
          </div>
          <div className="text-left">
            <div className="text-base text-[#263832] font-semibold mb-1">내 경험도 나눠주세요</div>
            <div className="text-sm text-[#635b51] font-light leading-relaxed">
              사진과 함께 후기를 올리면 다른 커플에게 큰 도움이 돼요
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
      <div className="w-16 h-16 rounded-2xl bg-[#36534E] flex items-center justify-center mb-5">
        <Shield className="w-8 h-8 text-white" />
      </div>

      <h2 className="font-serif-kr text-xl sm:text-3xl font-normal text-[#263832] mb-4 sm:mb-5 leading-snug">
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
            desc: "일반 회원이 작성한 글 · 경험 인증 아님",
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
            desc: "업체 광고임을 글에 표시",
          },
        ].map((rule, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#fbf8f2] border border-[#f6efe5]">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 border"
              style={{ backgroundColor: rule.bg, borderColor: rule.border, color: rule.color }}
              aria-hidden
            >
              <rule.Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
            </div>
            <span className="text-base text-[#263832] font-semibold min-w-[40px]">{rule.label}</span>
            <span className="text-sm text-[#635b51] font-light">— {rule.desc}</span>
          </div>
        ))}
      </div>

      <p className="text-base text-[#635b51] font-light mb-6 leading-relaxed">
        서로의 경험이 누군가의 큰 도움이 됩니다
      </p>

      <button
        onClick={handleStart}
        className="w-full max-w-[340px] py-3.5 bg-[#36534E] text-white text-base font-medium rounded-2xl shadow-[0_4px_14px_0_rgba(6,26,52,0.2)] hover:shadow-[0_6px_20px_rgba(6,26,52,0.23)] transition-all mb-3"
      >
        커뮤니티 둘러보기
      </button>
      <button
        onClick={handleNeverShow}
        className="text-base text-[#B5ADA3] hover:text-[#635b51] transition-colors underline underline-offset-2"
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
    // 첫 방문 자동 팝업 비활성 — 콘텐츠를 보기 전 모달 연쇄가 최대 이탈 지점(UX 감사 결론).
    // 가이드는 "hanbang:open-community-guide" 이벤트로만 수동 오픈한다.
    const open = () => setVisible(true);
    window.addEventListener("hanbang:open-community-guide", open);
    return () => window.removeEventListener("hanbang:open-community-guide", open);
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
      <div className="relative w-full max-w-[560px] mx-4 my-4 sm:my-0 max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-3xl shadow-2xl">
        {/* 상단 진행 바 */}
        <div className="h-1 bg-[#f6efe5]">
          <div
            className="h-full bg-[#36534E] transition-all duration-500 rounded-full"
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
            className="no-min-tap flex items-center gap-1 text-xs sm:text-sm text-[#B5ADA3] hover:text-[#263832] transition-colors"
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
                className="flex items-center gap-1 px-4 py-3 text-base text-[#635b51] hover:text-[#263832] disabled:opacity-0 disabled:pointer-events-none transition-all rounded-xl"
              >
                <ChevronLeft className="w-4 h-4" />
                이전
              </button>
              <button
                onClick={next}
                className="flex items-center gap-1 px-6 py-3 bg-[#36534E] hover:bg-[#2B423E] text-white text-base font-medium rounded-xl transition-colors"
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
                  i === current ? "bg-[#36534E]" : "bg-[#B5ADA3]/35 hover:bg-[#B5ADA3]/60"
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
