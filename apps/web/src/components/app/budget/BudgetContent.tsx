"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Pencil,
  Check,
  X,
  Users,
  Camera,
  Shirt,
  Palette,
  Building2,
  Gem,
  Flower2,
  Plane,
  Home,
  Key,
  Mail,
  Gift,
  Wallet,
  Video,
  Package,
  Sparkles,
  Flower,
  Heart,
  Mic,
  Box,
  ShoppingBag,
  Loader2,
  Tag,
  Plus,
  ArrowRight,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem, PayerType } from "@/types/database.types";
import Link from "next/link";

const ICON_MAP: Record<string, React.ElementType> = {
  Users, Building2, Camera, Shirt, Palette, Video, Gem, Package,
  Flower2, Plane, Home, Key, Mail, Gift, Wallet,
  Sparkles, Flower, Heart, Mic, Box, Tag,
};

// 카테고리별 예산 비율 (기본값)
const CATEGORY_RATIOS: { key: string; label: string; icon: string; ratio: number }[] = [
  { key: "meeting", label: "상견례", icon: "Users", ratio: 0.01 },
  { key: "venue", label: "예식장", icon: "Building2", ratio: 0.20 },
  { key: "studio", label: "스튜디오", icon: "Camera", ratio: 0.10 },
  { key: "dress", label: "드레스/턱시도", icon: "Shirt", ratio: 0.07 },
  { key: "makeup", label: "메이크업", icon: "Palette", ratio: 0.05 },
  { key: "snap", label: "본식 스냅/영상", icon: "Video", ratio: 0.04 },
  { key: "ring", label: "예물", icon: "Gem", ratio: 0.12 },
  { key: "yedan", label: "예단", icon: "Package", ratio: 0.05 },
  { key: "hanbok", label: "한복", icon: "Flower2", ratio: 0.03 },
  { key: "shoes", label: "웨딩 구두", icon: "Sparkles", ratio: 0.01 },
  { key: "bouquet", label: "부케/꽃장식", icon: "Flower", ratio: 0.01 },
  { key: "honeymoon", label: "신혼여행", icon: "Plane", ratio: 0.12 },
  { key: "houseware", label: "혼수", icon: "Home", ratio: 0.07 },
  { key: "housing", label: "신혼집", icon: "Key", ratio: 0.00 },
  { key: "invitation", label: "청첩장", icon: "Mail", ratio: 0.02 },
  { key: "gift", label: "답례품", icon: "Gift", ratio: 0.02 },
  { key: "mc", label: "사회/축가", icon: "Mic", ratio: 0.01 },
  { key: "ham", label: "함", icon: "Box", ratio: 0.01 },
  { key: "pyebaek", label: "폐백", icon: "Heart", ratio: 0.01 },
  { key: "reserve", label: "예비비", icon: "Wallet", ratio: 0.05 },
];

// 스드메 키
const SDM_KEYS = ["studio", "dress", "makeup"];
const OTHER_KEYS = CATEGORY_RATIOS.filter((c) => !SDM_KEYS.includes(c.key)).map((c) => c.key);

// 고정 카테고리 키 세트 (커스텀 카테고리 식별용)
const KNOWN_KEYS = new Set(CATEGORY_RATIOS.map((c) => c.key));

// 숨겨진 추가 비용 경고 데이터
const HIDDEN_COSTS: Record<string, { warning: string; extra: string }> = {
  studio: { warning: "원본 USB, 앨범 추가, 보정본 추가", extra: "+50~150만원" },
  dress: { warning: "속옷, 글러브, 베일, 슈즈 별도", extra: "+30~80만원" },
  makeup: { warning: "리허설, 어머니 메이크업, 피부관리", extra: "+30~100만원" },
  venue: { warning: "사회자, 축가, 영상, 꽃장식, 폐백실", extra: "+100~300만원" },
  honeymoon: { warning: "여행자보험, 쇼핑, 액티비티", extra: "+50~200만원" },
  hanbok: { warning: "맞춤 수선, 소품, 세탁", extra: "+10~30만원" },
  gift: { warning: "포장, 배송비, 추가 세트", extra: "+10~50만원" },
  snap: { warning: "DVD 편집, 스냅 원본, 액자", extra: "+30~80만원" },
  ham: { warning: "장식, 기사님 식사, 주차비", extra: "+5~20만원" },
  bouquet: { warning: "부케 보존, 부토니에, 양가 꽃", extra: "+5~20만원" },
};

// 분담 옵션
const PAYER_OPTIONS: { value: PayerType; label: string; emoji: string }[] = [
  { value: "couple", label: "커플", emoji: "\uD83D\uDC6B" },
  { value: "bride_parents", label: "신부측", emoji: "\uD83D\uDC70" },
  { value: "groom_parents", label: "신랑측", emoji: "\uD83E\uDD35" },
  { value: "both_parents", label: "양가", emoji: "\uD83E\uDD1D" },
];

function getPayerLabel(payer?: PayerType): { label: string; emoji: string } {
  const found = PAYER_OPTIONS.find((p) => p.value === payer);
  return found ? { label: found.label, emoji: found.emoji } : { label: "커플", emoji: "\uD83D\uDC6B" };
}

function formatWon(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만`;
  return n.toLocaleString();
}

function formatWonFull(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억원`;
  return `${Math.round(n / 10000).toLocaleString()}만원`;
}

// 이전 버전 호환: cost가 만원 단위로 저장된 경우 원 단위로 변환
function normalizeCost(cost: number | undefined): number {
  if (!cost || cost <= 0) return 0;
  return cost < 100000 ? cost * 10000 : cost;
}

// 숨겨진 비용 경고 배지 컴포넌트
function HiddenCostBadge({ catKey }: { catKey: string }) {
  const [show, setShow] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const data = HIDDEN_COSTS[catKey];
  if (!data) return null;

  return (
    <div className="relative inline-flex">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="w-6 h-6 rounded-full flex items-center justify-center text-sm bg-[#795252]/10 text-[#795252] hover:bg-[#795252]/15 transition-colors flex-shrink-0"
        title="추가 비용 주의"
      >
        <AlertTriangle className="w-4 h-4" />
      </button>
      {show && (
        <div
          ref={tooltipRef}
          className="absolute z-40 bottom-full left-1/2 -translate-x-1/2 mb-2 w-[220px] bg-white text-[#504444] rounded-xl p-3 shadow-[0_8px_30px_rgb(0,0,0,0.12)] pointer-events-none"
        >
          <div className="text-[11px] font-medium text-[#795252] mb-1.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            추가 비용 주의
          </div>
          <p className="text-[11px] text-[#504444] leading-relaxed mb-1.5">{data.warning}</p>
          <p className="text-[12px] font-medium text-[#795252]">{data.extra}</p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px]">
            <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-white" />
          </div>
        </div>
      )}
    </div>
  );
}

// 분담(Payer) 선택 컴포넌트
function PayerSelector({
  value,
  onChange,
}: {
  value: PayerType;
  onChange: (v: PayerType) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getPayerLabel(value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm text-[#504444] hover:bg-[#f6f3f2] transition-colors"
        title="분담 변경"
      >
        <span>{current.emoji}</span>
        <span>{current.label}</span>
      </button>
      {open && (
        <div className="absolute z-40 top-full right-0 mt-1 w-[150px] bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] overflow-hidden">
          {PAYER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                value === opt.value
                  ? "bg-[#795252]/5 text-[#795252] font-medium"
                  : "text-[#1b1c1c] hover:bg-[#f6f3f2]"
              }`}
            >
              <span>{opt.emoji}</span>
              <span>{opt.label}</span>
              {value === opt.value && <Check className="w-4 h-4 ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 인라인 금액 편집 컴포넌트
function InlineMoneyEdit({
  value,
  onSave,
  onReset,
  label,
  highlight,
}: {
  value: number;
  onSave: (v: number) => void;
  onReset?: () => void;
  label: string;
  highlight?: "spent" | "budget";
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = () => {
    setText(String(Math.round(value / 10000)));
    setEditing(true);
  };

  const save = () => {
    const num = parseFloat(text);
    if (!isNaN(num) && num >= 0) {
      onSave(Math.round(num * 10000));
    }
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="number"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          className="w-[80px] px-2 py-1 rounded-lg border border-[#795252]/40 text-[13px] text-right text-[#1b1c1c] focus:outline-none focus:border-[#795252] focus:ring-2 focus:ring-[#795252]/10"
        />
        <span className="text-[11px] text-[#B5ADA3]">만원</span>
        <button onClick={save} className="w-6 h-6 rounded flex items-center justify-center text-sage-500 hover:bg-sage-500/10" title="저장">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={cancel} className="w-6 h-6 rounded flex items-center justify-center text-[#B5ADA3] hover:bg-[#f6f3f2]" title="취소">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={startEdit}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors ${
          highlight === "spent"
            ? "hover:bg-[#795252]/5"
            : "hover:bg-[#f6f3f2]"
        }`}
        title={`${label} 수정`}
      >
        <span className={`text-base font-medium ${
          highlight === "spent" ? "text-[#1b1c1c]" : "text-[#504444]"
        }`}>
          {formatWon(value)}
        </span>
        <Pencil className={`w-4 h-4 ${
          highlight === "spent" ? "text-[#795252]/50" : "text-[#B5ADA3]"
        }`} />
      </button>
      {onReset && value > 0 && (
        <button
          onClick={onReset}
          className="w-6 h-6 rounded flex items-center justify-center text-[#B5ADA3] hover:text-red-400 hover:bg-red-50 transition-colors"
          title={`${label} 초기화`}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// 카테고리 행 컴포넌트 (리스트 스타일 - 스드메용)
function BudgetRow({
  catKey,
  label,
  icon,
  budget,
  spent,
  status,
  payer,
  onBudgetChange,
  onSpentChange,
  onSpentReset,
  onPayerChange,
  onDelete,
}: {
  catKey: string;
  label: string;
  icon: string;
  budget: number;
  spent: number;
  status: string;
  payer: PayerType;
  onBudgetChange: (key: string, val: number) => void;
  onSpentChange: (key: string, val: number) => void;
  onSpentReset: (key: string) => void;
  onPayerChange: (key: string, payer: PayerType) => void;
  onDelete?: (key: string) => void;
}) {
  const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const isOver = spent > budget && budget > 0;
  const Icon = ICON_MAP[icon] ?? Building2;

  return (
    <div
      className="group flex items-center gap-3 px-6 py-5 bg-white hover:bg-[#fcf9f8] transition-colors max-md:flex-wrap max-md:gap-2"
    >
      {/* 아이콘 + 이름 + 숨겨진 비용 경고 */}
      <div className="flex items-center gap-2 w-[170px] flex-shrink-0 max-md:w-full">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isOver
            ? "bg-red-50"
            : "bg-[#f6f3f2]"
        }`}>
          <Icon className={`w-5 h-5 ${isOver ? "text-red-400" : "text-[#795252]"}`} />
        </div>
        <span className="font-serif-kr text-[17px] font-normal text-[#1b1c1c] truncate">{label}</span>
        <HiddenCostBadge catKey={catKey} />

        {/* 모바일 전용: 상태 + 삭제를 라벨 옆에 배치 */}
        <div className="md:hidden ml-auto flex items-center gap-1.5 flex-shrink-0">
          <div className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            status === "완료" ? "bg-sage-500/10 text-sage-500" :
            status === "진행중" ? "bg-[#795252]/10 text-[#795252]" :
            "bg-[#f6f3f2] text-[#B5ADA3]"
          }`}>
            {status}
          </div>
          {onDelete && (
            <button
              onClick={() => onDelete(catKey)}
              className="w-6 h-6 rounded flex items-center justify-center text-[#B5ADA3] hover:text-red-400 hover:bg-red-50 transition-colors"
              title={`${label} 삭제`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 진행 바 + 퍼센트 */}
      <div className="flex-1 min-w-0 max-md:order-last max-md:w-full">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-[#f6f3f2] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isOver ? "bg-red-400" : "bg-gradient-to-r from-[#795252] to-[#946a6a]"
              }`}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          <span className={`text-xs font-medium w-[36px] text-right flex-shrink-0 ${
            isOver ? "text-red-400" : percent >= 100 ? "text-sage-500" : "text-[#B5ADA3]"
          }`}>
            {percent}%
          </span>
        </div>
      </div>

      {/* 분담 선택 */}
      <div className="flex-shrink-0 max-md:w-auto">
        <PayerSelector value={payer} onChange={(v) => onPayerChange(catKey, v)} />
      </div>

      {/* 지출 (편집 가능) */}
      <div className="flex flex-col items-end flex-shrink-0 max-md:w-auto">
        <span className="text-xs uppercase tracking-widest text-[#B5ADA3] mb-0.5">지출</span>
        <InlineMoneyEdit
          value={spent}
          onSave={(v) => onSpentChange(catKey, v)}
          onReset={() => onSpentReset(catKey)}
          label={`${label} 지출`}
          highlight="spent"
        />
      </div>

      {/* 구분선 */}
      <span className="text-sm text-[#B5ADA3]/60 flex-shrink-0 self-end mb-1">/</span>

      {/* 예산 (편집 가능) */}
      <div className="flex flex-col items-end flex-shrink-0 max-md:w-auto">
        <span className="text-xs uppercase tracking-widest text-[#B5ADA3] mb-0.5">예산</span>
        <InlineMoneyEdit
          value={budget}
          onSave={(v) => onBudgetChange(catKey, v)}
          label={`${label} 예산`}
          highlight="budget"
        />
      </div>

      {/* 상태 + 삭제 (데스크탑 전용 — 모바일은 라벨 옆에 배치) */}
      <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
        <div className={`text-xs px-2.5 py-1 rounded-full font-medium ${
          status === "완료" ? "bg-sage-500/10 text-sage-500" :
          status === "진행중" ? "bg-[#795252]/10 text-[#795252]" :
          "bg-[#f6f3f2] text-[#B5ADA3]"
        }`}>
          {status}
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(catKey)}
            className="w-5 h-5 rounded flex items-center justify-center text-[#B5ADA3] hover:text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
            title={`${label} 삭제`}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// 카테고리 카드 컴포넌트 (그리드 스타일 - 기타 카테고리용)
function BudgetCard({
  catKey,
  label,
  icon,
  budget,
  spent,
  status,
  payer,
  onBudgetChange,
  onSpentChange,
  onSpentReset,
  onPayerChange,
  onDelete,
}: {
  catKey: string;
  label: string;
  icon: string;
  budget: number;
  spent: number;
  status: string;
  payer: PayerType;
  onBudgetChange: (key: string, val: number) => void;
  onSpentChange: (key: string, val: number) => void;
  onSpentReset: (key: string) => void;
  onPayerChange: (key: string, payer: PayerType) => void;
  onDelete?: (key: string) => void;
}) {
  const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const isOver = spent > budget && budget > 0;
  const Icon = ICON_MAP[icon] ?? Building2;

  return (
    <div className="group bg-white rounded-2xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.06)] transition-shadow">
      {/* 상단: 아이콘 + 이름 + 상태 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isOver ? "bg-red-50" : "bg-[#f6f3f2]"
          }`}>
            <Icon className={`w-5 h-5 ${isOver ? "text-red-400" : "text-[#795252]"}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-serif-kr text-[17px] font-normal text-[#1b1c1c] truncate">{label}</span>
              <HiddenCostBadge catKey={catKey} />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <div className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                status === "완료" ? "bg-sage-500/10 text-sage-500" :
                status === "진행중" ? "bg-[#795252]/10 text-[#795252]" :
                "bg-[#f6f3f2] text-[#B5ADA3]"
              }`}>
                {status}
              </div>
            </div>
          </div>
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(catKey)}
            className="w-6 h-6 rounded flex items-center justify-center text-[#B5ADA3] hover:text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
            title={`${label} 삭제`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 진행 바 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[#B5ADA3]">진행률</span>
          <span className={`text-xs font-medium ${
            isOver ? "text-red-400" : percent >= 100 ? "text-sage-500" : "text-[#504444]"
          }`}>
            {percent}%
          </span>
        </div>
        <div className="h-2 bg-[#f6f3f2] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isOver ? "bg-red-400" : "bg-gradient-to-r from-[#795252] to-[#946a6a]"
            }`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      </div>

      {/* 지출/예산/분담 */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-end gap-3 min-w-0">
          <div className="flex flex-col items-start">
            <span className="text-xs uppercase tracking-widest text-[#B5ADA3] mb-0.5">지출</span>
            <InlineMoneyEdit
              value={spent}
              onSave={(v) => onSpentChange(catKey, v)}
              onReset={() => onSpentReset(catKey)}
              label={`${label} 지출`}
              highlight="spent"
            />
          </div>
          <span className="text-sm text-[#B5ADA3]/60 pb-2">/</span>
          <div className="flex flex-col items-start">
            <span className="text-xs uppercase tracking-widest text-[#B5ADA3] mb-0.5">예산</span>
            <InlineMoneyEdit
              value={budget}
              onSave={(v) => onBudgetChange(catKey, v)}
              label={`${label} 예산`}
              highlight="budget"
            />
          </div>
        </div>
        <PayerSelector value={payer} onChange={(v) => onPayerChange(catKey, v)} />
      </div>
    </div>
  );
}

interface BookingSummary {
  id: string;
  vendorName: string;
  productName?: string;
  bookingDate: string;
  bookingTime: string;
  amount: number;
  status: string;
}

function getBookingStatusBadge(status: string) {
  switch (status) {
    case "confirmed": return { label: "확정", color: "bg-sage-500/10 text-sage-500" };
    case "completed": return { label: "완료", color: "bg-[#f6f3f2] text-[#B5ADA3]" };
    case "cancelled": return { label: "취소", color: "bg-red-50 text-red-400" };
    default: return { label: "대기중", color: "bg-[#795252]/10 text-[#795252]" };
  }
}

function BookingsSection({ bookings, loading }: { bookings: BookingSummary[]; loading: boolean }) {
  const [showCancelled, setShowCancelled] = useState(false);

  const activeBookings = bookings.filter((b) => b.status !== "cancelled");
  const cancelledBookings = bookings.filter((b) => b.status === "cancelled");
  const displayBookings = showCancelled ? cancelledBookings : activeBookings;

  return (
    <div
      className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden mb-8 animate-fade-in"
    >
      <div className="px-5 sm:px-8 py-5 sm:py-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <ShoppingBag className="w-6 h-6 text-[#795252]" />
          <div className="min-w-0">
            <h3 className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c]">내 예약 내역</h3>
            {!loading && <p className="text-sm text-[#B5ADA3] mt-0.5">{activeBookings.length}건 진행 중</p>}
          </div>
        </div>
        {cancelledBookings.length > 0 && (
          <button
            onClick={() => setShowCancelled(!showCancelled)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              showCancelled
                ? "bg-red-50 text-red-400 font-medium"
                : "text-[#B5ADA3] hover:bg-[#f6f3f2]"
            }`}
          >
            {showCancelled ? "예약 중 보기" : `취소 내역 ${cancelledBookings.length}`}
          </button>
        )}
      </div>
      {loading ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="w-6 h-6 text-[#B5ADA3] animate-spin" />
        </div>
      ) : displayBookings.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-base text-[#B5ADA3]">
            {showCancelled ? "취소된 예약이 없습니다" : "예약 내역이 없습니다"}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#f6f3f2]">
          {displayBookings.map((b) => {
            const badge = getBookingStatusBadge(b.status);
            return (
              <div key={b.id} className="flex items-center gap-3 sm:gap-4 px-5 sm:px-8 py-4 sm:py-5 hover:bg-[#fcf9f8] transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="font-serif-kr text-[17px] font-normal text-[#1b1c1c] truncate">{b.vendorName}</p>
                  {b.productName && (
                    <p className="text-sm text-[#B5ADA3] truncate">{b.productName}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm text-[#504444]">{b.bookingDate} {b.bookingTime}</p>
                  {b.amount > 0 && (
                    <p className="text-sm text-[#795252] font-medium">{formatWon(b.amount)}원</p>
                  )}
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${badge.color}`}>
                  {badge.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface BudgetContentProps {
  /** 패널/오버레이 안에서 렌더되는지 여부. true면 풀스크린 chrome (min-h-screen, max-w) 제거. */
  embedded?: boolean;
}

export default function BudgetContent({ embedded = false }: BudgetContentProps = {}) {
  const { journey, updateJourney, isDemo } = useAuthStore();

  const totalBudget = journey?.total_budget ?? 20000000;
  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem>;
  const hiddenKeys = new Set(((progress as Record<string, unknown>).__hidden as string[]) ?? []);

  // 커스텀 카테고리 추가 폼
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState("");
  const [newCatBudget, setNewCatBudget] = useState("");
  const [newCatSpent, setNewCatSpent] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);


  // progress에서 커스텀 카테고리 추출
  const customCategories = Object.entries(progress)
    .filter(([key]) => !KNOWN_KEYS.has(key) && !key.startsWith("__"))
    .map(([key, item]) => ({
      key,
      label: item.label ?? key,
      icon: "Tag",
    }));

  // 내 예약 내역
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);

  useEffect(() => {
    if (isDemo) { setBookingsLoading(false); return; }
    (async () => {
      try {
        const res = await fetch("/api/bookings/mine");
        if (res.ok) {
          const data = await res.json();
          setBookings(data.bookings ?? []);
        }
      } catch {
        // silent
      } finally {
        setBookingsLoading(false);
      }
    })();
  }, [isDemo]);

  // 총 예산 편집
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalText, setTotalText] = useState("");
  const totalInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTotal && totalInputRef.current) {
      totalInputRef.current.focus();
      totalInputRef.current.select();
    }
  }, [editingTotal]);

  // 카테고리별 예산/지출 계산
  const getCategoryBudget = useCallback(
    (key: string) => {
      const item = progress[key];
      if (item?.budget !== undefined && item.budget > 0) return item.budget;
      const cost = normalizeCost(item?.cost);
      if (cost > 0) return cost;
      const catRatio = CATEGORY_RATIOS.find((c) => c.key === key);
      return catRatio ? Math.round(totalBudget * catRatio.ratio) : 0;
    },
    [progress, totalBudget]
  );

  const getCategorySpent = useCallback(
    (key: string) => {
      const item = progress[key];
      if (item?.spent !== undefined) return item.spent;
      const cost = normalizeCost(item?.cost);
      if (cost > 0) return cost;
      return 0;
    },
    [progress]
  );

  const getStatusLabel = useCallback(
    (key: string) => {
      const item = progress[key];
      const status = item?.status ?? "not_started";
      return status === "completed" ? "완료" : status === "in_progress" ? "진행중" : "예정";
    },
    [progress]
  );

  const getCategoryPayer = useCallback(
    (key: string): PayerType => {
      return progress[key]?.payer ?? "couple";
    },
    [progress]
  );

  // 총합 계산
  const allCats = CATEGORY_RATIOS;
  const visibleFixed = allCats.filter((c) => !hiddenKeys.has(c.key));
  const fixedSpent = visibleFixed.reduce((s, c) => s + getCategorySpent(c.key), 0);
  const fixedAllocated = visibleFixed.reduce((s, c) => s + getCategoryBudget(c.key), 0);
  const customSpent = customCategories.reduce((s, c) => s + getCategorySpent(c.key), 0);
  const customAllocated = customCategories.reduce((s, c) => s + getCategoryBudget(c.key), 0);
  const totalSpent = fixedSpent + customSpent;
  const totalAllocated = fixedAllocated + customAllocated;
  const remaining = totalBudget - totalSpent;
  const spentPercent = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  // 스드메 합계
  const sdmBudget = SDM_KEYS.filter((k) => !hiddenKeys.has(k)).reduce((s, k) => s + getCategoryBudget(k), 0);
  const sdmSpent = SDM_KEYS.filter((k) => !hiddenKeys.has(k)).reduce((s, k) => s + getCategorySpent(k), 0);

  // 분담별 합계
  const allVisibleKeys = [
    ...visibleFixed.map((c) => c.key),
    ...customCategories.map((c) => c.key),
  ];
  const payerSummary = allVisibleKeys.reduce(
    (acc, key) => {
      const payer = getCategoryPayer(key);
      const spent = getCategorySpent(key);
      acc[payer] = (acc[payer] ?? 0) + spent;
      return acc;
    },
    {} as Record<PayerType, number>
  );

  // 숨은 비용(hidden cost) 경고가 있는 카테고리 중 지출이 시작된 것들 — 경고 카드 표시용
  const hiddenCostWarnings = Object.keys(HIDDEN_COSTS).filter(
    (k) => !hiddenKeys.has(k) && getCategorySpent(k) > 0
  );

  // 핸들러들
  const handleBudgetChange = useCallback(
    async (key: string, newBudget: number) => {
      const existing = progress[key];
      const newProgress = {
        ...progress,
        [key]: {
          ...(existing ?? { category: key, status: "not_started" as const }),
          category: key,
          budget: newBudget,
        },
      };
      await updateJourney({ progress: newProgress });
    },
    [progress, updateJourney]
  );

  const handleSpentChange = useCallback(
    async (key: string, newSpent: number) => {
      const existing = progress[key];
      const newProgress = {
        ...progress,
        [key]: {
          ...(existing ?? { category: key, status: "not_started" as const }),
          category: key,
          spent: newSpent,
        },
      };
      await updateJourney({ progress: newProgress });
    },
    [progress, updateJourney]
  );

  const handleSpentReset = useCallback(
    async (key: string) => {
      const existing = progress[key];
      if (!existing) return;
      const { spent: _spent, ...rest } = existing;
      const newProgress = {
        ...progress,
        [key]: { ...rest, category: key },
      };
      await updateJourney({ progress: newProgress });
    },
    [progress, updateJourney]
  );

  const handlePayerChange = useCallback(
    async (key: string, newPayer: PayerType) => {
      const existing = progress[key];
      const newProgress = {
        ...progress,
        [key]: {
          ...(existing ?? { category: key, status: "not_started" as const }),
          category: key,
          payer: newPayer,
        },
      };
      await updateJourney({ progress: newProgress });
    },
    [progress, updateJourney]
  );

  const handleAddCategory = useCallback(
    async () => {
      const trimmed = newCatLabel.trim();
      if (!trimmed) return;
      const key = `custom_${Date.now()}`;
      const budgetVal = newCatBudget ? Math.round(parseFloat(newCatBudget) * 10000) : 0;
      const spentVal = newCatSpent ? Math.round(parseFloat(newCatSpent) * 10000) : 0;
      const newProgress = {
        ...progress,
        [key]: {
          category: key,
          label: trimmed,
          status: spentVal > 0 ? "in_progress" as const : "not_started" as const,
          ...(budgetVal > 0 ? { budget: budgetVal } : {}),
          ...(spentVal > 0 ? { spent: spentVal } : {}),
        },
      };
      await updateJourney({ progress: newProgress });
      setNewCatLabel("");
      setNewCatBudget("");
      setNewCatSpent("");
      setShowAddModal(false);
    },
    [newCatLabel, newCatBudget, newCatSpent, progress, updateJourney]
  );

  const handleResetCategory = useCallback(
    async (key: string) => {
      const { [key]: _removed, ...rest } = progress;
      await updateJourney({ progress: rest });
      setDeletingKey(null);
    },
    [progress, updateJourney]
  );

  const handleDeleteCategory = useCallback(
    async (key: string) => {
      if (KNOWN_KEYS.has(key)) {
        const hiddenList: string[] = (progress as Record<string, unknown>).__hidden as string[] ?? [];
        const { [key]: _removed, ...rest } = progress;
        await updateJourney({ progress: { ...rest, __hidden: [...hiddenList, key] } as unknown as Record<string, ProgressItem> });
      } else {
        const { [key]: _removed, ...rest } = progress;
        await updateJourney({ progress: rest });
      }
      setDeletingKey(null);
    },
    [progress, updateJourney]
  );

  const handleTotalBudgetSave = async () => {
    const num = parseFloat(totalText);
    if (!isNaN(num) && num > 0) {
      await updateJourney({ total_budget: Math.round(num * 10000) });
    }
    setEditingTotal(false);
  };

  // 카테고리 세그먼트 (Breakdown 바)
  const breakdownSegments = visibleFixed
    .map((c, idx) => ({
      key: c.key,
      label: c.label,
      budget: getCategoryBudget(c.key),
      color: [
        "#795252", "#946a6a", "#C9A96E", "#5a6147", "#dee6c4",
        "#b08968", "#a89b8c", "#8a7f6e", "#c49a8a", "#d4b896",
      ][idx % 10],
    }))
    .filter((s) => s.budget > 0);
  const breakdownTotal = breakdownSegments.reduce((s, c) => s + c.budget, 0);

  return (
    <div className={embedded ? "bg-[#fcf9f8]" : "min-h-screen bg-[#fcf9f8]"}>
      <div
        className={
          embedded
            ? "max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto px-4 sm:px-6 md:px-8 lg:px-12 py-6 sm:py-8 md:py-10"
            : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-6 sm:py-10"
        }
      >
        {/* 헤더 — 커뮤니티 모드는 컴팩트 (사이드바 타이틀 톤), 풀페이지는 hero 배너 */}
        {embedded ? (
          <header className="mb-6 sm:mb-8 animate-fade-in">
            <p className="text-xs tracking-widest uppercase text-[#795252] mb-2 font-medium">
              Budget Overview
            </p>
            <h1 className="font-serif-kr text-3xl sm:text-4xl italic text-[#795252] mb-1 leading-tight">
              예산 관리
            </h1>
            <p className="text-sm sm:text-base text-[#504444]">
              우리의 결혼 여정, 현명하게 계획해요.
            </p>
          </header>
        ) : (
          <section className="relative rounded-2xl overflow-hidden aspect-[5/3] sm:aspect-[16/5] mb-8 animate-fade-in">
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(circle at 30% 50%, rgba(201, 169, 110, 0.3) 0%, transparent 60%),
                  radial-gradient(circle at 70% 60%, rgba(121, 82, 82, 0.35) 0%, transparent 50%),
                  linear-gradient(135deg, #f6f3f2 0%, #dee6c4 50%, #f6f3f2 100%)
                `,
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-transparent to-transparent" />
            <div className="relative h-full flex items-center px-6 sm:px-10 lg:px-16">
              <div className="min-w-0">
                <p className="text-xs tracking-widest uppercase text-[#795252] mb-3 font-medium">
                  BUDGET OVERVIEW
                </p>
                <h1 className="font-serif-kr text-3xl sm:text-4xl lg:text-6xl text-[#1b1c1c] mb-3 sm:mb-4 leading-tight font-light break-words">
                  예산 관리
                </h1>
                <p className="text-base sm:text-lg lg:text-xl text-[#504444] font-light italic">
                  우리의 결혼 여정, 현명하게 계획해요.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 상단 스탯 3개 - Editorial */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-8">
          {/* Total Budget */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 lg:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden animate-fade-in">
            <Sparkles className="absolute top-6 right-6 w-6 h-6 text-[#C9A96E]/30" />
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs tracking-widest uppercase text-[#795252] font-medium">
                TOTAL BUDGET
              </p>
              {!editingTotal && (
                <button
                  onClick={() => {
                    setTotalText(String(Math.round(totalBudget / 10000)));
                    setEditingTotal(true);
                  }}
                  className="text-[#B5ADA3] hover:text-[#795252] transition-colors"
                  title="총 예산 수정"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </div>
            {editingTotal ? (
              <div className="flex items-end gap-2 mb-3 flex-wrap">
                <input
                  ref={totalInputRef}
                  type="number"
                  value={totalText}
                  onChange={(e) => setTotalText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleTotalBudgetSave();
                    if (e.key === "Escape") setEditingTotal(false);
                  }}
                  className="w-full sm:w-[180px] max-w-full px-3 py-2 rounded-xl border border-[#795252]/40 text-4xl sm:text-5xl font-serif-kr font-light text-[#1b1c1c] focus:outline-none focus:border-[#795252] focus:ring-2 focus:ring-[#795252]/10"
                />
                <button onClick={handleTotalBudgetSave} className="w-9 h-9 rounded-lg flex items-center justify-center text-white bg-[#795252] hover:bg-[#946a6a]">
                  <Check className="w-5 h-5" />
                </button>
                <button onClick={() => setEditingTotal(false)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#f6f3f2]">
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <p className="font-serif-kr text-4xl sm:text-5xl md:text-6xl lg:text-[72px] leading-none text-[#1b1c1c] mb-2 font-light break-words">
                {(totalBudget / 10000).toLocaleString()}
              </p>
            )}
            <p className="text-lg sm:text-xl text-[#504444] font-serif-kr italic mb-3">만원</p>
            <p className="text-base text-[#504444]">전체 예산</p>
          </div>

          {/* Spent */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 lg:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden animate-fade-in">
            <TrendingUp className="absolute top-6 right-6 w-6 h-6 text-sage-500/40" />
            <p className="text-xs tracking-widest uppercase text-sage-500 mb-4 font-medium">
              SPENT
            </p>
            <p className="font-serif-kr text-4xl sm:text-5xl md:text-6xl lg:text-[72px] leading-none text-[#1b1c1c] mb-2 font-light break-words">
              {(totalSpent / 10000).toLocaleString()}
            </p>
            <p className="text-lg sm:text-xl text-[#504444] font-serif-kr italic mb-3">만원</p>
            <p className="text-base text-[#504444]">사용한 금액 ({spentPercent}%)</p>
            <div className="w-full h-1.5 bg-[#f6f3f2] rounded-full mt-4 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all duration-700"
                style={{ width: `${Math.min(spentPercent, 100)}%` }}
              />
            </div>
          </div>

          {/* Remaining */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 lg:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden animate-fade-in sm:col-span-2 md:col-span-1">
            <TrendingDown className={`absolute top-6 right-6 w-6 h-6 ${remaining >= 0 ? "text-[#C9A96E]/40" : "text-red-400/60"}`} />
            <p className={`text-xs tracking-widest uppercase mb-4 font-medium ${remaining >= 0 ? "text-[#C9A96E]" : "text-red-400"}`}>
              REMAINING
            </p>
            <p className={`font-serif-kr text-4xl sm:text-5xl md:text-6xl lg:text-[72px] leading-none mb-2 font-light break-words ${remaining >= 0 ? "text-[#1b1c1c]" : "text-red-400"}`}>
              {remaining < 0 ? "-" : ""}{(Math.abs(remaining) / 10000).toLocaleString()}
            </p>
            <p className="text-lg sm:text-xl text-[#504444] font-serif-kr italic mb-3">만원</p>
            {remaining >= 0 ? (
              <p className="text-base text-[#504444]">
                남은 예산 (여유 {totalBudget > 0 ? Math.round((remaining / totalBudget) * 100) : 0}%)
              </p>
            ) : (
              <p className="text-base text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" />
                예산 초과
              </p>
            )}
          </div>
        </div>

        {/* Budget Breakdown 바 */}
        {breakdownTotal > 0 && (
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-8 animate-fade-in">
            <div className="flex items-start sm:items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs tracking-widest uppercase text-[#795252] mb-1 font-medium">BUDGET BREAKDOWN</p>
                <h2 className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c]">카테고리별 배분</h2>
              </div>
              <p className="text-sm text-[#504444]">
                <span className="font-medium text-[#1b1c1c]">{spentPercent}%</span> 사용 /{" "}
                <span className="font-medium text-[#1b1c1c]">{Math.max(0, 100 - spentPercent)}%</span> 남음
              </p>
            </div>
            <div className="flex w-full h-4 rounded-full overflow-hidden bg-[#f6f3f2]">
              {breakdownSegments.map((seg) => {
                const widthPct = (seg.budget / breakdownTotal) * 100;
                return (
                  <div
                    key={seg.key}
                    className="h-full transition-all"
                    style={{ width: `${widthPct}%`, backgroundColor: seg.color }}
                    title={`${seg.label} · ${formatWonFull(seg.budget)}`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
              {breakdownSegments.slice(0, 10).map((seg) => (
                <div key={seg.key} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                  <span className="text-[#504444]">{seg.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 분담 현황 (Editorial Style) */}
        {totalSpent > 0 && (
          <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 sm:p-8 mb-8 animate-fade-in">
            <div className="flex items-center gap-3 mb-6">
              <Users className="w-6 h-6 text-[#795252]" />
              <div>
                <p className="text-xs tracking-widest uppercase text-[#795252] mb-1 font-medium">PAYER SUMMARY</p>
                <h3 className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c]">분담 현황</h3>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {PAYER_OPTIONS.map((opt) => {
                const amount = payerSummary[opt.value] ?? 0;
                const pct = totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0;
                return (
                  <div
                    key={opt.value}
                    className={`rounded-xl p-4 sm:p-6 transition-colors ${
                      amount > 0 ? "bg-[#fcf9f8]" : "bg-[#f6f3f2]/60"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-3">
                      <span className="text-lg">{opt.emoji}</span>
                      <span className="text-sm text-[#504444]">{opt.label}</span>
                    </div>
                    <p className={`font-serif-kr text-2xl sm:text-3xl font-light break-words ${
                      amount > 0 ? "text-[#1b1c1c]" : "text-[#B5ADA3]"
                    }`}>
                      {amount > 0 ? formatWon(amount) : "0"}
                      <span className="text-sm text-[#B5ADA3] ml-0.5">원</span>
                    </p>
                    {amount > 0 && (
                      <div className="mt-3">
                        <div className="h-1.5 bg-[#f6f3f2] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-xs text-[#B5ADA3] mt-1.5">{pct}%</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 시세 비교 안내 */}
        <Link
          href="/market-prices"
          className="flex items-center gap-4 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] px-5 sm:px-8 py-5 sm:py-6 mb-8 hover:shadow-[0_12px_40px_rgb(0,0,0,0.06)] transition-shadow group animate-fade-in"
        >
          <div className="w-12 h-12 rounded-xl bg-[#795252]/10 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-5 h-5 text-[#795252]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs tracking-widest uppercase text-[#795252] mb-1 font-medium">MARKET COMPARISON</p>
            <p className="font-serif-kr text-base sm:text-[19px] text-[#1b1c1c] font-normal">시세 대비 내 예산 확인</p>
            <p className="text-sm text-[#504444] mt-1 line-clamp-2">한국소비자원 데이터 기반 · 카테고리별 시세 배지 표시 중</p>
          </div>
          <span className="hidden sm:flex text-base text-[#795252] flex-shrink-0 group-hover:underline items-center gap-1 whitespace-nowrap">
            자세히 보기 <ArrowRight className="w-4 h-4" />
          </span>
          <ArrowRight className="sm:hidden w-5 h-5 text-[#795252] flex-shrink-0" />
        </Link>

        {/* 내 예약 내역 */}
        <BookingsSection bookings={bookings} loading={bookingsLoading} />

        {/* 스드메 패키지 - Editorial */}
        <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden mb-8 animate-fade-in">
          <div className="px-5 sm:px-8 py-5 sm:py-6 flex items-start sm:items-center justify-between gap-4 border-b border-[#f6f3f2] flex-wrap">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div className="flex -space-x-1">
                <div className="w-11 h-11 rounded-full bg-[#795252]/10 flex items-center justify-center ring-2 ring-white">
                  <Camera className="w-5 h-5 text-[#795252]" />
                </div>
                <div className="w-11 h-11 rounded-full bg-[#795252]/10 flex items-center justify-center ring-2 ring-white">
                  <Shirt className="w-5 h-5 text-[#795252]" />
                </div>
                <div className="w-11 h-11 rounded-full bg-[#795252]/10 flex items-center justify-center ring-2 ring-white">
                  <Palette className="w-5 h-5 text-[#795252]" />
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-xs tracking-widest uppercase text-[#795252] mb-1 font-medium">SDM PACKAGE</p>
                <h3 className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c]">스드메 패키지</h3>
                <p className="text-sm text-[#504444] mt-0.5">스튜디오 · 드레스 · 메이크업</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c] break-words">
                {formatWonFull(sdmSpent)} <span className="text-[#B5ADA3] text-base sm:text-lg">/ {formatWonFull(sdmBudget)}</span>
              </p>
              <p className="text-sm text-[#504444] mt-1">
                {sdmBudget > 0 ? Math.round((sdmSpent / sdmBudget) * 100) : 0}% 사용
              </p>
            </div>
          </div>
          <div className="divide-y divide-[#f6f3f2]">
            {SDM_KEYS.filter((k) => !hiddenKeys.has(k)).map((key) => {
              const cat = CATEGORY_RATIOS.find((c) => c.key === key)!;
              return (
                <BudgetRow
                  key={key}
                  catKey={key}
                  label={cat.label}
                  icon={cat.icon}
                  budget={getCategoryBudget(key)}
                  spent={getCategorySpent(key)}
                  status={getStatusLabel(key)}
                  payer={getCategoryPayer(key)}
                  onBudgetChange={handleBudgetChange}
                  onSpentChange={handleSpentChange}
                  onSpentReset={handleSpentReset}
                  onPayerChange={handlePayerChange}
                  onDelete={(k) => setDeletingKey(k)}
                />
              );
            })}
          </div>
        </div>

        {/* 기타 카테고리 헤더 */}
        <div className="flex items-center justify-between gap-3 mb-4 animate-fade-in flex-wrap">
          <div className="min-w-0">
            <p className="text-xs tracking-widest uppercase text-[#795252] mb-1 font-medium">OTHER CATEGORIES</p>
            <h3 className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c]">기타 카테고리</h3>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-[#B5ADA3]">
            <Pencil className="w-4 h-4 text-[#795252]/50" />
            클릭하여 수정
          </div>
        </div>

        {/* 기타 카테고리 - 2열 그리드 카드 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 animate-fade-in">
          {OTHER_KEYS.filter((k) => !hiddenKeys.has(k)).map((key) => {
            const cat = CATEGORY_RATIOS.find((c) => c.key === key)!;
            return (
              <BudgetCard
                key={key}
                catKey={key}
                label={cat.label}
                icon={cat.icon}
                budget={getCategoryBudget(key)}
                spent={getCategorySpent(key)}
                status={getStatusLabel(key)}
                payer={getCategoryPayer(key)}
                onBudgetChange={handleBudgetChange}
                onSpentChange={handleSpentChange}
                onSpentReset={handleSpentReset}
                onPayerChange={handlePayerChange}
                onDelete={(k) => setDeletingKey(k)}
              />
            );
          })}

          {/* 커스텀 카테고리 */}
          {customCategories.map((cat) => (
            <BudgetCard
              key={cat.key}
              catKey={cat.key}
              label={cat.label}
              icon={cat.icon}
              budget={getCategoryBudget(cat.key)}
              spent={getCategorySpent(cat.key)}
              status={getStatusLabel(cat.key)}
              payer={getCategoryPayer(cat.key)}
              onBudgetChange={handleBudgetChange}
              onSpentChange={handleSpentChange}
              onSpentReset={handleSpentReset}
              onPayerChange={handlePayerChange}
              onDelete={(k) => setDeletingKey(k)}
            />
          ))}

          {/* 카테고리 추가 카드 */}
          <button
            onClick={() => setShowAddModal(true)}
            className="group flex items-center justify-center gap-3 bg-white/60 rounded-2xl p-6 border-2 border-dashed border-[#B5ADA3]/40 hover:border-[#795252] hover:bg-white transition-colors min-h-[180px]"
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center border-2 border-dashed border-[#B5ADA3]/60 group-hover:border-[#795252] transition-colors">
              <Plus className="w-5 h-5 text-[#B5ADA3] group-hover:text-[#795252]" />
            </div>
            <span className="text-base text-[#B5ADA3] group-hover:text-[#795252] font-serif-kr">새 항목 추가</span>
          </button>
        </div>

        {/* 하단: Hidden Costs + AI Spotlight */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 animate-fade-in">
          {/* Hidden Costs 섹션 */}
          <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 sm:p-8">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-[#795252]/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-[#795252]" />
              </div>
              <div className="min-w-0">
                <p className="text-xs tracking-widest uppercase text-[#795252] mb-1 font-medium">HIDDEN COSTS</p>
                <h3 className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c]">숨은 비용 체크</h3>
                <p className="text-sm text-[#504444] mt-1">
                  {hiddenCostWarnings.length > 0
                    ? `진행 중인 ${hiddenCostWarnings.length}개 카테고리에 추가 비용 주의가 필요해요.`
                    : "예상치 못한 추가 지출을 미리 확인하세요."}
                </p>
              </div>
            </div>
            <div className="space-y-2.5 max-h-[240px] overflow-y-auto">
              {(hiddenCostWarnings.length > 0
                ? hiddenCostWarnings
                : Object.keys(HIDDEN_COSTS).slice(0, 4)
              ).map((key) => {
                const cat = CATEGORY_RATIOS.find((c) => c.key === key);
                const data = HIDDEN_COSTS[key];
                if (!cat || !data) return null;
                const Icon = ICON_MAP[cat.icon] ?? Building2;
                return (
                  <div key={key} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#fcf9f8]">
                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-[#795252]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1b1c1c]">{cat.label}</p>
                      <p className="text-xs text-[#504444] truncate">{data.warning}</p>
                    </div>
                    <span className="text-xs font-medium text-[#795252] flex-shrink-0">{data.extra}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI Spotlight */}
          <div className="relative rounded-2xl overflow-hidden min-h-[240px] sm:min-h-[280px] bg-gradient-to-br from-[#1a1a1a] to-[#3a2a2a] p-6 sm:p-8 lg:p-10 flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-[#C9A96E]/10 blur-3xl" />
            <div className="relative">
              <p className="text-xs tracking-widest uppercase text-[#C9A96E] mb-3 font-medium">
                AI 예산 분석
              </p>
              <h3 className="font-serif-kr text-2xl sm:text-3xl text-white mb-3 font-light break-words">
                이 예산, 적정한가요?
              </h3>
              <p className="text-base text-white/70 mb-6 max-w-md">
                AI 아모라가 시세와 비교해서 과잉/절약 포인트를 알려드려요.
              </p>
            </div>
            <Link
              href="/chat"
              className="relative inline-flex items-center gap-2 text-base font-medium text-white border-b border-white/30 hover:border-white pb-1 transition-colors self-start"
            >
              아모라에게 물어보기
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* 배분 안내 */}
        <div className="mt-4 px-2 mb-8 animate-fade-in">
          <p className="text-[11px] text-[#B5ADA3] text-center">
            {totalAllocated !== totalBudget && (
              <span className="text-[#795252]">
                배분 합계 {formatWonFull(totalAllocated)} (총 예산과 {formatWonFull(Math.abs(totalBudget - totalAllocated))} {totalAllocated > totalBudget ? "초과" : "차이"})
              </span>
            )}
            {totalAllocated === totalBudget && (
              <span>배분 합계가 총 예산과 일치합니다</span>
            )}
          </p>
        </div>

        {/* 새 항목 추가 모달 */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-[#1b1c1c]/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
            <div className="relative bg-white rounded-2xl w-[90%] max-w-[420px] p-8 shadow-[0_8px_40px_rgb(0,0,0,0.12)]">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-serif-kr text-2xl font-light text-[#1b1c1c]">새 항목 추가</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#f6f3f2] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[11px] uppercase tracking-widest text-[#B5ADA3] mb-1.5 block">카테고리 이름 <span className="text-[#795252]">*</span></label>
                  <input
                    autoFocus
                    type="text"
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && newCatLabel.trim()) handleAddCategory(); }}
                    placeholder="예: 웨딩카, 답례떡"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#f6f3f2] text-[14px] text-[#1b1c1c] placeholder:text-[#B5ADA3] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] uppercase tracking-widest text-[#B5ADA3] mb-1.5 block">예산 (만원)</label>
                    <input
                      type="number"
                      value={newCatBudget}
                      onChange={(e) => setNewCatBudget(e.target.value)}
                      placeholder="0"
                      className="w-full px-4 py-2.5 rounded-xl bg-[#f6f3f2] text-[14px] text-[#1b1c1c] placeholder:text-[#B5ADA3] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-widest text-[#B5ADA3] mb-1.5 block">지출 (만원)</label>
                    <input
                      type="number"
                      value={newCatSpent}
                      onChange={(e) => setNewCatSpent(e.target.value)}
                      placeholder="0"
                      className="w-full px-4 py-2.5 rounded-xl bg-[#f6f3f2] text-[14px] text-[#1b1c1c] placeholder:text-[#B5ADA3] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-[#f6f3f2] text-[13px] text-[#504444] hover:bg-[#EFEBEA] transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleAddCategory}
                  disabled={!newCatLabel.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-[#795252] text-white text-[13px] font-medium disabled:opacity-40 hover:bg-[#946a6a] transition-colors"
                >
                  추가
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 삭제 확인 모달 */}
        {deletingKey && (() => {
          const isFixed = KNOWN_KEYS.has(deletingKey);
          const catLabel = (() => {
            const cat = CATEGORY_RATIOS.find((c) => c.key === deletingKey);
            return cat ? cat.label : (progress[deletingKey]?.label ?? deletingKey);
          })();
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-[#1b1c1c]/40 backdrop-blur-sm" onClick={() => setDeletingKey(null)} />
              <div className="relative bg-white rounded-2xl w-[90%] max-w-[380px] p-6 shadow-[0_8px_40px_rgb(0,0,0,0.12)]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="font-serif-kr text-[17px] font-light text-[#1b1c1c]">
                      {isFixed ? "항목 관리" : "항목 삭제"}
                    </h3>
                    <p className="text-[12px] text-[#B5ADA3] mt-0.5">
                      <span className="font-medium text-[#504444]">{catLabel}</span>
                      {isFixed
                        ? " — 데이터만 초기화하거나 목록에서 삭제할 수 있습니다."
                        : " 항목이 완전히 삭제됩니다."}
                    </p>
                  </div>
                </div>

                <div className={`flex gap-3 mt-5 ${isFixed ? "flex-col" : ""}`}>
                  {isFixed ? (
                    <>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleResetCategory(deletingKey)}
                          className="flex-1 py-2.5 rounded-xl bg-[#f6f3f2] text-[13px] text-[#795252] font-medium hover:bg-[#795252]/10 transition-colors"
                        >
                          데이터 초기화
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(deletingKey)}
                          className="flex-1 py-2.5 rounded-xl bg-red-400 text-white text-[13px] font-medium hover:bg-red-500 transition-colors"
                        >
                          항목 삭제
                        </button>
                      </div>
                      <button
                        onClick={() => setDeletingKey(null)}
                        className="py-2.5 rounded-xl bg-[#f6f3f2] text-[13px] text-[#504444] hover:bg-[#EFEBEA] transition-colors"
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setDeletingKey(null)}
                        className="flex-1 py-2.5 rounded-xl bg-[#f6f3f2] text-[13px] text-[#504444] hover:bg-[#EFEBEA] transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => handleDeleteCategory(deletingKey)}
                        className="flex-1 py-2.5 rounded-xl bg-red-400 text-white text-[13px] font-medium hover:bg-red-500 transition-colors"
                      >
                        삭제
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
