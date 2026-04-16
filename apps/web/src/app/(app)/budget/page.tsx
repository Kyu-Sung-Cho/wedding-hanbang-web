"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem, PayerType } from "@/types/database.types";
import Link from "next/link";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

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
// 10만원(100000) 미만은 만원 단위로 간주 (웨딩 비용이 10만원 미만일 수 없음)
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
        className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] bg-amber-50 text-amber-500 hover:bg-amber-100 transition-colors flex-shrink-0"
        title="추가 비용 주의"
      >
        <AlertTriangle className="w-3 h-3" />
      </button>
      {show && (
        <div
          ref={tooltipRef}
          className="absolute z-40 bottom-full left-1/2 -translate-x-1/2 mb-2 w-[220px] bg-noir-800 text-white rounded-xl p-3 shadow-lg pointer-events-none"
        >
          <div className="text-[11px] font-medium text-amber-300 mb-1.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            추가 비용 주의
          </div>
          <p className="text-[11px] text-white/80 leading-relaxed mb-1.5">{data.warning}</p>
          <p className="text-[12px] font-medium text-amber-300">{data.extra}</p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px]">
            <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-noir-800" />
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
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-taupe-500 hover:bg-ivory-50 border border-transparent hover:border-black/[0.04] transition-colors"
        title="분담 변경"
      >
        <span>{current.emoji}</span>
        <span>{current.label}</span>
      </button>
      {open && (
        <div className="absolute z-40 top-full right-0 mt-1 w-[130px] bg-white rounded-xl border border-black/[0.06] shadow-lg overflow-hidden">
          {PAYER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] transition-colors ${
                value === opt.value
                  ? "bg-rose-500/5 text-rose-500 font-medium"
                  : "text-noir-800 hover:bg-ivory-50"
              }`}
            >
              <span>{opt.emoji}</span>
              <span>{opt.label}</span>
              {value === opt.value && <Check className="w-3 h-3 ml-auto" />}
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
          className="w-[80px] px-2 py-1 rounded-lg border border-rose-500/30 text-[13px] text-right text-noir-800 focus:outline-none focus:border-rose-500"
        />
        <span className="text-[11px] text-taupe-400">만원</span>
        <button onClick={save} className="w-6 h-6 rounded flex items-center justify-center text-[#2E7D5A] hover:bg-[#2E7D5A]/10" title="저장">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={cancel} className="w-6 h-6 rounded flex items-center justify-center text-taupe-400 hover:bg-taupe-400/10" title="취소">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={startEdit}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors ${
          highlight === "spent"
            ? "hover:bg-rose-500/5 border border-transparent hover:border-rose-500/20"
            : "hover:bg-gold/5 border border-transparent hover:border-gold/20"
        }`}
        title={`${label} 수정`}
      >
        <span className={`text-[13px] font-medium ${
          highlight === "spent" ? "text-noir-800" : "text-taupe-500"
        }`}>
          {formatWon(value)}
        </span>
        <Pencil className={`w-3 h-3 ${
          highlight === "spent" ? "text-rose-500/40" : "text-gold/40"
        }`} />
      </button>
      {onReset && value > 0 && (
        <button
          onClick={onReset}
          className="w-5 h-5 rounded flex items-center justify-center text-taupe-400/50 hover:text-red-400 hover:bg-red-50 transition-colors"
          title={`${label} 초기화`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// 카테고리 행 컴포넌트
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
  delay,
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
  delay: number;
}) {
  const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const isOver = spent > budget && budget > 0;
  const Icon = ICON_MAP[icon] ?? Building2;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay }}
      className="group flex items-center gap-3 px-5 py-3.5 hover:bg-ivory-50 transition-colors max-md:flex-wrap max-md:gap-2"
    >
      {/* 아이콘 + 이름 + 숨겨진 비용 경고 */}
      <div className="flex items-center gap-2 w-[140px] flex-shrink-0 max-md:w-full">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isOver
            ? "bg-red-50 ring-1 ring-red-200"
            : "bg-gradient-to-br from-rose-500/10 to-gold/10"
        }`}>
          <Icon className={`w-4 h-4 ${isOver ? "text-red-400" : "text-rose-500"}`} />
        </div>
        <span className="text-[13px] font-medium text-noir-800">{label}</span>
        <HiddenCostBadge catKey={catKey} />
      </div>

      {/* 진행 바 + 퍼센트 */}
      <div className="flex-1 min-w-0 max-md:order-last max-md:w-full">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-ivory-warm rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isOver ? "bg-red-400" : "bg-gradient-to-r from-rose-500 to-gold"
              }`}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          <span className={`text-[10px] font-medium w-[32px] text-right flex-shrink-0 ${
            isOver ? "text-red-400" : percent >= 100 ? "text-[#2E7D5A]" : "text-taupe-400"
          }`}>
            {percent}%
          </span>
        </div>
      </div>

      {/* 분담 선택 */}
      <div className="flex-shrink-0 max-md:w-auto">
        <PayerSelector value={payer} onChange={(v) => onPayerChange(catKey, v)} />
      </div>

      {/* 지출 (편집 가능) - 라벨 포함 */}
      <div className="flex flex-col items-end flex-shrink-0 max-md:w-auto">
        <span className="text-[9px] text-taupe-400 mb-0.5">지출</span>
        <InlineMoneyEdit
          value={spent}
          onSave={(v) => onSpentChange(catKey, v)}
          onReset={() => onSpentReset(catKey)}
          label={`${label} 지출`}
          highlight="spent"
        />
      </div>

      {/* 구분선 */}
      <span className="text-[11px] text-taupe-300 flex-shrink-0 self-end mb-1">/</span>

      {/* 예산 (편집 가능) - 라벨 포함 */}
      <div className="flex flex-col items-end flex-shrink-0 max-md:w-auto">
        <span className="text-[9px] text-taupe-400 mb-0.5">예산</span>
        <InlineMoneyEdit
          value={budget}
          onSave={(v) => onBudgetChange(catKey, v)}
          label={`${label} 예산`}
          highlight="budget"
        />
      </div>

      {/* 상태 + 삭제 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          status === "완료" ? "bg-[#2E7D5A]/10 text-[#2E7D5A]" :
          status === "진행중" ? "bg-rose-500/10 text-rose-500" :
          "bg-taupe-400/10 text-taupe-400"
        }`}>
          {status}
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(catKey)}
            className="w-5 h-5 rounded flex items-center justify-center text-taupe-400/40 hover:text-red-400 hover:bg-red-50 transition-colors max-md:opacity-100 opacity-0 group-hover:opacity-100"
            title={`${label} 삭제`}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </motion.div>
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
    case "confirmed": return { label: "확정", color: "bg-[#2E7D5A]/10 text-[#2E7D5A]" };
    case "completed": return { label: "완료", color: "bg-taupe-400/10 text-taupe-400" };
    case "cancelled": return { label: "취소", color: "bg-red-100 text-red-400" };
    default: return { label: "대기중", color: "bg-gold/10 text-gold" };
  }
}

function BookingsSection({ bookings, loading }: { bookings: BookingSummary[]; loading: boolean }) {
  const [showCancelled, setShowCancelled] = useState(false);

  const activeBookings = bookings.filter((b) => b.status !== "cancelled");
  const cancelledBookings = bookings.filter((b) => b.status === "cancelled");
  const displayBookings = showCancelled ? cancelledBookings : activeBookings;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.12 }}
      className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden mb-6"
    >
      <div className="px-5 py-4 border-b border-black/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <ShoppingBag className="w-5 h-5 text-rose-500" />
          <h3 className="font-serif-kr text-[15px] font-normal text-noir-800">내 예약 내역</h3>
          {!loading && <span className="text-[11px] text-taupe-400">{activeBookings.length}건</span>}
        </div>
        {cancelledBookings.length > 0 && (
          <button
            onClick={() => setShowCancelled(!showCancelled)}
            className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors ${
              showCancelled
                ? "bg-red-50 text-red-400 font-medium"
                : "text-taupe-400 hover:bg-ivory-100"
            }`}
          >
            {showCancelled ? "예약 중 보기" : `취소 내역 ${cancelledBookings.length}`}
          </button>
        )}
      </div>
      {loading ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="w-5 h-5 text-taupe-400 animate-spin" />
        </div>
      ) : displayBookings.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-[13px] text-taupe-400">
            {showCancelled ? "취소된 예약이 없습니다" : "예약 내역이 없습니다"}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-black/[0.03]">
          {displayBookings.map((b) => {
            const badge = getBookingStatusBadge(b.status);
            return (
              <div key={b.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-ivory-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-noir-800 truncate">{b.vendorName}</p>
                  {b.productName && (
                    <p className="text-[11px] text-taupe-400 truncate">{b.productName}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[12px] text-noir-800">{b.bookingDate} {b.bookingTime}</p>
                  {b.amount > 0 && (
                    <p className="text-[11px] text-rose-500 font-medium">{formatWon(b.amount)}원</p>
                  )}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${badge.color}`}>
                  {badge.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

export default function BudgetPage() {
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


  // progress에서 커스텀 카테고리 추출 (KNOWN_KEYS에 없고 __로 시작하지 않는 키)
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
      // 1. 저장된 커스텀 예산이 있으면 사용
      if (item?.budget !== undefined && item.budget > 0) return item.budget;
      // 2. 완료 항목에 cost가 있으면 cost를 예산으로 사용 (이전 데이터 호환)
      const cost = normalizeCost(item?.cost);
      if (cost > 0) return cost;
      // 3. 없으면 비율 기반 기본값
      const catRatio = CATEGORY_RATIOS.find((c) => c.key === key);
      return catRatio ? Math.round(totalBudget * catRatio.ratio) : 0;
    },
    [progress, totalBudget]
  );

  const getCategorySpent = useCallback(
    (key: string) => {
      const item = progress[key];
      // 1. 직접 수정한 지출이 있으면 최우선
      if (item?.spent !== undefined) return item.spent;
      // 2. 온보딩에서 입력한 비용(cost)이 있으면 사용 (이전 데이터 호환)
      const cost = normalizeCost(item?.cost);
      if (cost > 0) return cost;
      // 3. 없으면 0
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

  // 총합 계산 (고정 + 커스텀 카테고리 모두 포함)
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

  // 분담별 합계 계산
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

  // 예산/지출 수정 핸들러
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
      // spent를 제거하여 cost(온보딩 입력값)로 폴백되도록
      const { spent: _spent, ...rest } = existing;
      const newProgress = {
        ...progress,
        [key]: { ...rest, category: key },
      };
      await updateJourney({ progress: newProgress });
    },
    [progress, updateJourney]
  );

  // 분담(payer) 변경 핸들러
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

  // 커스텀 카테고리 추가 핸들러
  // 카테고리 추가 (모달에서 호출)
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

  // 카테고리 데이터 초기화 (고정 카테고리: progress에서 제거하여 기본값으로 복원)
  const handleResetCategory = useCallback(
    async (key: string) => {
      const { [key]: _removed, ...rest } = progress;
      await updateJourney({ progress: rest });
      setDeletingKey(null);
    },
    [progress, updateJourney]
  );

  // 카테고리 삭제 (커스텀: progress에서 제거, 고정: __hidden 리스트에 추가하여 목록에서 숨김)
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

  return (
    <div className="max-w-[1000px] mx-auto">
      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-3 gap-4 mb-8 max-md:grid-cols-1">
        {/* 총 예산 (편집 가능) */}
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5 }}
          className="bg-white rounded-2xl p-6 border border-black/[0.04]"
        >
          <p className="text-[12px] text-taupe-500 font-light mb-2 flex items-center gap-1.5">
            총 예산
            {!editingTotal && (
              <button
                onClick={() => {
                  setTotalText(String(Math.round(totalBudget / 10000)));
                  setEditingTotal(true);
                }}
                className="text-taupe-400 hover:text-rose-500 transition-colors"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
          </p>
          {editingTotal ? (
            <div className="flex items-center gap-2">
              <input
                ref={totalInputRef}
                type="number"
                value={totalText}
                onChange={(e) => setTotalText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleTotalBudgetSave();
                  if (e.key === "Escape") setEditingTotal(false);
                }}
                className="w-[100px] px-3 py-2 rounded-xl border border-rose-500/30 text-[20px] font-display font-light text-noir-800 focus:outline-none focus:border-rose-500"
              />
              <span className="text-[14px] text-taupe-400">만원</span>
              <button onClick={handleTotalBudgetSave} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#2E7D5A] hover:bg-[#2E7D5A]/10">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => setEditingTotal(false)} className="w-7 h-7 rounded-lg flex items-center justify-center text-taupe-400 hover:bg-taupe-400/10">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <p className="font-display text-[32px] font-light text-noir-800">
              {formatWon(totalBudget)}<span className="text-[16px] text-taupe-400">원</span>
            </p>
          )}
        </motion.div>

        {/* 사용 금액 */}
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="bg-white rounded-2xl p-6 border border-black/[0.04]"
        >
          <p className="text-[12px] text-taupe-500 font-light mb-2 flex items-center gap-1.5">
            사용 금액 <TrendingUp className="w-3.5 h-3.5 text-rose-500" />
          </p>
          <p className="font-display text-[32px] font-light text-noir-800">
            {formatWon(totalSpent)}<span className="text-[16px] text-taupe-400">원</span>
          </p>
          <div className="w-full h-2 bg-ivory-warm rounded-full mt-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-rose-500 to-gold rounded-full transition-all duration-700"
              style={{ width: `${Math.min(spentPercent, 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-taupe-400 mt-1.5">예산 대비 {spentPercent}% 사용</p>
        </motion.div>

        {/* 잔여 예산 */}
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-2xl p-6 border border-black/[0.04]"
        >
          <p className="text-[12px] text-taupe-500 font-light mb-2 flex items-center gap-1.5">
            잔여 예산 <TrendingDown className={`w-3.5 h-3.5 ${remaining >= 0 ? "text-[#2E7D5A]" : "text-red-400"}`} />
          </p>
          <p className={`font-display text-[32px] font-light ${remaining >= 0 ? "text-[#2E7D5A]" : "text-red-400"}`}>
            {remaining < 0 ? "-" : ""}{formatWon(Math.abs(remaining))}<span className={`text-[16px] ${remaining >= 0 ? "text-[#2E7D5A]/50" : "text-red-400/50"}`}>원</span>
          </p>
          {remaining < 0 && (
            <p className="text-[11px] text-red-400 mt-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              예산 초과
            </p>
          )}
        </motion.div>
      </div>

      {/* 분담 요약 */}
      {totalSpent > 0 && (
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="bg-white rounded-2xl p-5 border border-black/[0.04] mb-6"
        >
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-rose-500" />
            <h3 className="text-[13px] font-medium text-noir-800">분담 현황</h3>
          </div>
          <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
            {PAYER_OPTIONS.map((opt) => {
              const amount = payerSummary[opt.value] ?? 0;
              const pct = totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0;
              return (
                <div
                  key={opt.value}
                  className={`rounded-xl p-3 border transition-colors ${
                    amount > 0 ? "border-rose-500/10 bg-rose-500/[0.02]" : "border-black/[0.04] bg-ivory-50"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[14px]">{opt.emoji}</span>
                    <span className="text-[11px] text-taupe-500">{opt.label}</span>
                  </div>
                  <p className={`font-display text-[18px] font-light ${
                    amount > 0 ? "text-noir-800" : "text-taupe-400"
                  }`}>
                    {amount > 0 ? formatWon(amount) : "0"}
                    <span className="text-[11px] text-taupe-400">원</span>
                  </p>
                  {amount > 0 && (
                    <div className="mt-1.5">
                      <div className="h-1 bg-ivory-warm rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-rose-500/60 to-gold/60 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[9px] text-taupe-400 mt-0.5">{pct}%</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* 시세 비교 안내 스트립 */}
      <Link
        href="/market-prices"
        className="flex items-center gap-3 bg-gradient-to-r from-rose-500/5 to-[#C9A96E]/5 rounded-xl px-4 py-3 mb-6 border border-black/[0.04] hover:border-rose-500/20 transition-colors group"
      >
        <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center flex-shrink-0">
          <TrendingUp className="w-4 h-4 text-rose-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-noir-800 font-medium">시세 대비 내 예산 확인</p>
          <p className="text-[11px] text-taupe-400">한국소비자원 데이터 기반 · 카테고리별 시세 배지 표시 중</p>
        </div>
        <span className="text-[12px] text-rose-500 flex-shrink-0 group-hover:underline">자세히 보기 →</span>
      </Link>

      {/* 내 예약 내역 */}
      <BookingsSection bookings={bookings} loading={bookingsLoading} />

      {/* 스드메 패키지 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden mb-6"
      >
        <div className="px-5 py-4 border-b border-black/[0.04] bg-gradient-to-r from-rose-500/5 to-gold/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex -space-x-1">
                <div className="w-6 h-6 rounded-full bg-rose-500/10 flex items-center justify-center ring-2 ring-white">
                  <Camera className="w-3 h-3 text-rose-500" />
                </div>
                <div className="w-6 h-6 rounded-full bg-rose-500/10 flex items-center justify-center ring-2 ring-white">
                  <Shirt className="w-3 h-3 text-rose-500" />
                </div>
                <div className="w-6 h-6 rounded-full bg-rose-500/10 flex items-center justify-center ring-2 ring-white">
                  <Palette className="w-3 h-3 text-rose-500" />
                </div>
              </div>
              <div>
                <h3 className="text-[15px] font-medium text-noir-800">스드메 패키지</h3>
                <p className="text-[11px] text-taupe-400">스튜디오 + 드레스 + 메이크업</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[13px] font-medium text-noir-800">
                {formatWonFull(sdmSpent)} <span className="text-taupe-400 font-normal">/ {formatWonFull(sdmBudget)}</span>
              </p>
              <p className="text-[11px] text-taupe-400">
                {sdmBudget > 0 ? Math.round((sdmSpent / sdmBudget) * 100) : 0}% 사용
              </p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-black/[0.03]">
          {SDM_KEYS.filter((k) => !hiddenKeys.has(k)).map((key, i) => {
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
                delay={0.2 + i * 0.03}
              />
            );
          })}
        </div>
      </motion.div>

      {/* 기타 카테고리 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.25 }}
        className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-black/[0.04] flex items-center justify-between">
          <h3 className="font-serif-kr text-[15px] font-normal text-noir-800">기타 카테고리</h3>
          <div className="flex items-center gap-1.5 text-[11px] text-taupe-400">
            <Pencil className="w-3 h-3 text-rose-500/40" />
            클릭하여 수정 · <X className="w-3 h-3 text-taupe-400/50" /> 초기화
          </div>
        </div>
        <div className="divide-y divide-black/[0.03]">
          {OTHER_KEYS.filter((k) => !hiddenKeys.has(k)).map((key, i) => {
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
                delay={0.3 + i * 0.03}
              />
            );
          })}

          {/* 커스텀 카테고리 렌더링 */}
          {customCategories.map((cat, i) => (
              <BudgetRow
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
                delay={0.3 + (OTHER_KEYS.length + i) * 0.03}
              />
          ))}

          {/* 카테고리 추가 버튼 */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2.5 w-full px-5 py-3.5 text-taupe-400 hover:text-rose-500 hover:bg-ivory-50 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center border border-dashed border-taupe-300 group-hover:border-rose-500/40 transition-colors">
              <Plus className="w-4 h-4" />
            </div>
            <span className="text-[13px]">새 항목 추가</span>
          </button>
        </div>
      </motion.div>

      {/* 배분 안내 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="mt-4 px-2"
      >
        <p className="text-[11px] text-taupe-400 text-center">
          {totalAllocated !== totalBudget && (
            <span className="text-rose-500">
              배분 합계 {formatWonFull(totalAllocated)} (총 예산과 {formatWonFull(Math.abs(totalBudget - totalAllocated))} {totalAllocated > totalBudget ? "초과" : "차이"})
            </span>
          )}
          {totalAllocated === totalBudget && (
            <span>배분 합계가 총 예산과 일치합니다</span>
          )}
        </p>
      </motion.div>

      {/* 새 항목 추가 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-noir-900/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-white rounded-2xl w-[90%] max-w-[400px] p-6 border border-black/[0.04] shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-serif-kr text-[17px] text-noir-800">새 항목 추가</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-taupe-400 hover:bg-taupe-400/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[12px] text-taupe-500 mb-1.5 block">카테고리 이름 <span className="text-rose-500">*</span></label>
                <input
                  autoFocus
                  type="text"
                  value={newCatLabel}
                  onChange={(e) => setNewCatLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newCatLabel.trim()) handleAddCategory(); }}
                  placeholder="예: 웨딩카, 답례떡"
                  className="w-full px-4 py-2.5 rounded-xl border border-black/[0.08] text-[14px] text-noir-800 placeholder:text-taupe-400/60 focus:outline-none focus:border-rose-500/40 focus:ring-1 focus:ring-rose-500/20 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] text-taupe-500 mb-1.5 block">예산 (만원)</label>
                  <input
                    type="number"
                    value={newCatBudget}
                    onChange={(e) => setNewCatBudget(e.target.value)}
                    placeholder="0"
                    className="w-full px-4 py-2.5 rounded-xl border border-black/[0.08] text-[14px] text-noir-800 placeholder:text-taupe-400/60 focus:outline-none focus:border-gold/40 focus:ring-1 focus:ring-gold/20 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-taupe-500 mb-1.5 block">지출 (만원)</label>
                  <input
                    type="number"
                    value={newCatSpent}
                    onChange={(e) => setNewCatSpent(e.target.value)}
                    placeholder="0"
                    className="w-full px-4 py-2.5 rounded-xl border border-black/[0.08] text-[14px] text-noir-800 placeholder:text-taupe-400/60 focus:outline-none focus:border-rose-500/40 focus:ring-1 focus:ring-rose-500/20 transition-colors"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-black/[0.08] text-[13px] text-taupe-500 hover:bg-ivory-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleAddCategory}
                disabled={!newCatLabel.trim()}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-gold text-white text-[13px] font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
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
            <div className="absolute inset-0 bg-noir-900/40 backdrop-blur-sm" onClick={() => setDeletingKey(null)} />
            <div className="relative bg-white rounded-2xl w-[90%] max-w-[360px] p-6 border border-black/[0.04] shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="text-[15px] font-medium text-noir-800">
                    {isFixed ? "항목 관리" : "항목 삭제"}
                  </h3>
                  <p className="text-[12px] text-taupe-400 mt-0.5">
                    <span className="font-medium text-noir-800">{catLabel}</span>
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
                        className="flex-1 py-2.5 rounded-xl border border-gold/30 text-[13px] text-gold font-medium hover:bg-gold/5 transition-colors"
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
                      className="py-2.5 rounded-xl border border-black/[0.08] text-[13px] text-taupe-500 hover:bg-ivory-50 transition-colors"
                    >
                      취소
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setDeletingKey(null)}
                      className="flex-1 py-2.5 rounded-xl border border-black/[0.08] text-[13px] text-taupe-500 hover:bg-ivory-50 transition-colors"
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
  );
}
