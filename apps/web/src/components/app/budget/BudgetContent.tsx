"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  FileText,
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
  Tag,
  Plus,
  ArrowRight,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import type {
  ProgressItem,
  PayerType,
  WeddingJourney,
} from "@/types/database.types";
import { weddingLinkProps } from "@/lib/weddingPaths";
import Link from "next/link";
import PaymentLedger from "./PaymentLedger";

const ICON_MAP: Record<string, React.ElementType> = {
  FileText,
  Users, Building2, Camera, Shirt, Palette, Video, Gem, Package,
  Flower2, Plane, Home, Key, Mail, Gift, Wallet,
  Sparkles, Flower, Heart, Mic, Box, Tag,
};

// 금액은 사용자가 입력하거나 계약·예약 결과로 확인된 값만 사용한다.
//
// 목록은 템플릿에서 뽑는다. 2026-08-21까지는 스무 줄을 손으로 적어 두었는데, 분야가
// 스물하나로 늘었을 때 모바일 예산 화면만 따라오고 이 화면은 그대로여서 웹에서만 새
// 분야가 사라졌다. 아이콘까지 템플릿과 한 글자도 다르지 않은 사본이었다.
const BUDGET_CATEGORIES: { key: string; label: string; icon: string }[] = [
  ...CATEGORY_CHECKLISTS.map(({ key, label, icon }) => ({ key, label, icon })),
  // 예비비는 체크리스트에 없는 예산 전용 칸이다.
  { key: "reserve", label: PLANNING_CATEGORY_LABELS.reserve, icon: "Wallet" },
];

const PHOTO_ATTIRE_MAKEUP_KEYS = ["studio", "dress", "makeup"];
const OTHER_KEYS = BUDGET_CATEGORIES
  .filter((category) => !PHOTO_ATTIRE_MAKEUP_KEYS.includes(category.key))
  .map((category) => category.key);

// 고정 카테고리 키 세트 (커스텀 카테고리 식별용)
const KNOWN_KEYS = new Set(BUDGET_CATEGORIES.map((category) => category.key));

// 업체·상품마다 다른 포함/별도 확인 항목. 금액은 공시가 또는 사용자 견적에서만 표시한다.
const HIDDEN_COSTS: Record<string, { warning: string; guidance: string }> = {
  studio: { warning: "받는 사진 파일 수, 앨범, 밝기와 색을 다듬어 주는 사진 수의 포함 범위", guidance: "업체 공개 가격·견적서 확인" },
  dress: { warning: "속옷, 장갑, 머리에 쓰는 면사포, 신발의 포함 범위", guidance: "업체 서면 안내 확인" },
  makeup: { warning: "미리 받아보는 메이크업, 부모님 메이크업, 피부 관리의 포함 범위", guidance: "업체 서면 안내 확인" },
  venue: { warning: "결혼식 진행자, 축하 노래, 영상, 꽃 장식, 결혼식 뒤 전통 인사 공간의 포함 범위", guidance: "업체 공개 가격·견적서 확인" },
  honeymoon: { warning: "보험, 선택 일정, 현지 비용의 포함 범위", guidance: "예약 문서 기준 확인" },
  hanbok: { warning: "수선, 소품, 세탁의 포함 범위", guidance: "업체 서면 안내 확인" },
  gift: { warning: "포장, 배송, 추가 수량의 포함 범위", guidance: "업체 서면 안내 확인" },
  snap: { warning: "편집한 영상, 받는 사진 파일 수, 액자의 포함 범위", guidance: "업체 공개 가격·견적서 확인" },
  ham: { warning: "장식, 운송, 주차의 포함 범위", guidance: "업체 서면 안내 확인" },
  bouquet: { warning: "꽃 보존, 예식 정장에 다는 꽃, 두 가족에게 드리는 꽃의 포함 범위", guidance: "업체 서면 안내 확인" },
};

// 분담 옵션
const PAYER_OPTIONS: { value: PayerType; label: string }[] = [
  { value: "couple", label: "두 사람" },
  { value: "bride_parents", label: "예비 신부 가족" },
  { value: "groom_parents", label: "예비 신랑 가족" },
  { value: "both_parents", label: "두 가족" },
];

function getPayerLabel(payer?: PayerType): string {
  const found = PAYER_OPTIONS.find((p) => p.value === payer);
  return found?.label ?? "두 사람";
}

function formatWon(n: number): string {
  return `${Math.round(n / 10000).toLocaleString()}만원`;
}

function formatWonFull(n: number): string {
  return `${Math.round(n / 10000).toLocaleString()}만원`;
}

// 이전 버전의 cost는 예산인지 지출인지 구분할 수 없다. 합산하지 않고
// 검토 화면에만 보여주기 위해 예전 표시 단위를 복원한다.
function normalizeLegacyCostForReview(cost: unknown): number | null {
  if (!Number.isSafeInteger(cost) || (cost as number) <= 0) return null;
  const normalized = (cost as number) < 100_000
    ? (cost as number) * 10_000
    : (cost as number);
  return Number.isSafeInteger(normalized) && normalized <= 1_000_000_000
    ? normalized
    : null;
}

// 포함·별도 항목 확인 배지 컴포넌트
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
        title="포함·별도 항목 확인"
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
            포함·별도 항목 확인
          </div>
          <p className="text-[11px] text-[#504444] leading-relaxed mb-1.5">{data.warning}</p>
          <p className="text-[12px] font-medium text-[#795252]">{data.guidance}</p>
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
  onChange: (v: PayerType) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const currentLabel = getPayerLabel(value);

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
        onClick={() => {
          setError("");
          setOpen(!open);
        }}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm text-[#504444] hover:bg-[#f6f3f2] transition-colors"
        title="분담 변경"
      >
        <Users className="h-4 w-4" aria-hidden="true" />
        <span>{currentLabel}</span>
      </button>
      {open && (
        <div className="absolute z-40 top-full right-0 mt-1 w-[150px] bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] overflow-hidden">
          {PAYER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={saving}
              onClick={() => {
                setSaving(true);
                setError("");
                void Promise.resolve(onChange(opt.value))
                  .then(() => setOpen(false))
                  .catch((changeError: unknown) => {
                    setError(
                      changeError instanceof Error
                        ? changeError.message
                        : "부담 주체를 저장하지 못했습니다.",
                    );
                  })
                  .finally(() => setSaving(false));
              }}
              className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                value === opt.value
                  ? "bg-[#795252]/5 text-[#795252] font-medium"
                  : "text-[#1b1c1c] hover:bg-[#f6f3f2]"
              }`}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              <span>{opt.label}</span>
              {value === opt.value && <Check className="w-4 h-4 ml-auto" />}
            </button>
          ))}
          {error && (
            <p role="alert" className="border-t border-[#F0EAE5] px-3 py-2 text-[10px] leading-4 text-[#9A3F3F]">
              {error}
            </p>
          )}
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
  emptyLabel,
}: {
  value: number;
  onSave: (v: number) => Promise<void> | void;
  onReset?: () => Promise<void> | void;
  label: string;
  highlight?: "spent" | "budget";
  emptyLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = () => {
    setText(String(Math.round(value / 10000)));
    setError("");
    setEditing(true);
  };

  const save = async () => {
    const num = parseFloat(text);
    if (isNaN(num) || num < 0) {
      setError("0 이상의 금액을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(Math.round(num * 10000));
      setEditing(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "금액을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <div>
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="number"
            value={text}
            disabled={saving}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape" && !saving) cancel();
            }}
            className="w-[80px] px-2 py-1 rounded-lg border border-[#795252]/40 text-[13px] text-right text-[#1b1c1c] focus:outline-none focus:border-[#795252] focus:ring-2 focus:ring-[#795252]/10 disabled:opacity-50"
          />
          <span className="text-[11px] text-[#B5ADA3]">만원</span>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="w-6 h-6 rounded flex items-center justify-center text-sage-500 hover:bg-sage-500/10 disabled:opacity-50"
            title="저장"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={cancel}
            disabled={saving}
            className="w-6 h-6 rounded flex items-center justify-center text-[#B5ADA3] hover:bg-[#f6f3f2] disabled:opacity-50"
            title="취소"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-1 max-w-[180px] text-[10px] leading-4 text-[#9A3F3F]">
            {error}
          </p>
        )}
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
          {value > 0 || !emptyLabel ? formatWon(value) : emptyLabel}
        </span>
        <Pencil className={`w-4 h-4 ${
          highlight === "spent" ? "text-[#795252]/50" : "text-[#B5ADA3]"
        }`} />
      </button>
      {onReset && value > 0 && (
        <button
          onClick={() => {
            void Promise.resolve(onReset()).catch(() => undefined);
          }}
          className="w-6 h-6 rounded flex items-center justify-center text-[#B5ADA3] hover:text-red-400 hover:bg-red-50 transition-colors"
          title={`${label} 초기화`}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// 사진 촬영·의상·메이크업 항목용 리스트 행
function BudgetRow({
  catKey,
  label,
  icon,
  budget,
  spent,
  status,
  payer,
  totalBudget,
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
  totalBudget: number;
  onBudgetChange: (key: string, val: number) => Promise<void> | void;
  onSpentChange: (key: string, val: number) => Promise<void> | void;
  onSpentReset: (key: string) => Promise<void> | void;
  onPayerChange: (key: string, payer: PayerType) => Promise<void> | void;
  onDelete?: (key: string) => Promise<void> | void;
}) {
  const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const isOver = spent > budget && budget > 0;
  // 총 예산 대비 이 카테고리의 비중 (이슈 #7)
  const totalShare = totalBudget > 0 && budget > 0 ? Math.round((budget / totalBudget) * 100) : 0;
  const Icon = ICON_MAP[icon] ?? Building2;

  return (
    <div
      className="group flex items-center gap-3 px-6 py-5 bg-white hover:bg-[#fcf9f8] transition-colors max-lg:flex-wrap max-lg:gap-2"
    >
      {/* 아이콘 + 이름 + 포함·별도 항목 확인 */}
      <div className="flex w-[190px] flex-shrink-0 items-center gap-2 max-lg:w-full">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isOver
            ? "bg-red-50"
            : "bg-[#f6f3f2]"
        }`}>
          <Icon className={`w-5 h-5 ${isOver ? "text-red-400" : "text-[#795252]"}`} />
        </div>
        <span className="min-w-0 font-serif-kr text-[16px] font-normal leading-snug text-[#1b1c1c] line-clamp-2">{label}</span>
        <HiddenCostBadge catKey={catKey} />

        {/* 모바일 전용: 상태 + 삭제를 라벨 옆에 배치 */}
        <div className="lg:hidden ml-auto flex items-center gap-1.5 flex-shrink-0">
          <div className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            status === "완료" ? "bg-sage-500/10 text-sage-500" :
            status === "진행중" ? "bg-[#795252]/10 text-[#795252]" :
            "bg-[#f6f3f2] text-[#B5ADA3]"
          }`}>
            {status}
          </div>
          {onDelete && (
            <button
              onClick={() => {
                void Promise.resolve(onDelete(catKey)).catch(() => undefined);
              }}
              className="w-6 h-6 rounded flex items-center justify-center text-[#B5ADA3] hover:text-red-400 hover:bg-red-50 transition-colors"
              title={`${label} 삭제`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 진행 바 + 퍼센트 */}
      <div className="flex-1 min-w-0 max-lg:order-last max-lg:w-full">
        {budget > 0 ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-[#f6f3f2] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isOver ? "bg-red-400" : "bg-[#795252]"
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
        ) : (
          <span className="text-xs font-medium text-[#B5ADA3]">예산 입력 전</span>
        )}
      </div>

      {/* 분담 선택 */}
      <div className="flex-shrink-0 max-lg:w-auto">
        <PayerSelector value={payer} onChange={(v) => onPayerChange(catKey, v)} />
      </div>

      {/* 지출 (편집 가능) */}
      <div className="flex flex-col items-end flex-shrink-0 max-lg:w-auto">
        <span className="text-xs uppercase tracking-widest text-[#B5ADA3] mb-0.5">기록 지출</span>
        <InlineMoneyEdit
          value={spent}
          onSave={(v) => onSpentChange(catKey, v)}
          onReset={() => onSpentReset(catKey)}
          label={`${label} 기록 지출`}
          highlight="spent"
        />
      </div>

      {/* 구분선 */}
      <span className="text-sm text-[#B5ADA3]/60 flex-shrink-0 self-end mb-1">/</span>

      {/* 예산 (편집 가능) */}
      <div className="flex flex-col items-end flex-shrink-0 max-lg:w-auto">
        <span className="text-xs uppercase tracking-widest text-[#B5ADA3] mb-0.5">예산</span>
        <InlineMoneyEdit
          value={budget}
          onSave={(v) => onBudgetChange(catKey, v)}
          label={`${label} 예산`}
          highlight="budget"
          emptyLabel="미입력"
        />
        {totalShare > 0 && (
          <span className="text-[10px] text-[#B5ADA3] mt-0.5">총예산의 {totalShare}%</span>
        )}
      </div>

      {/* 상태 + 삭제 (데스크탑 전용 — 모바일은 라벨 옆에 배치) */}
      <div className="hidden lg:flex items-center gap-1.5 flex-shrink-0">
        <div className={`text-xs px-2.5 py-1 rounded-full font-medium ${
          status === "완료" ? "bg-sage-500/10 text-sage-500" :
          status === "진행중" ? "bg-[#795252]/10 text-[#795252]" :
          "bg-[#f6f3f2] text-[#B5ADA3]"
        }`}>
          {status}
        </div>
        {onDelete && (
          <button
            onClick={() => {
              void Promise.resolve(onDelete(catKey)).catch(() => undefined);
            }}
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
  totalBudget,
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
  totalBudget: number;
  onBudgetChange: (key: string, val: number) => Promise<void> | void;
  onSpentChange: (key: string, val: number) => Promise<void> | void;
  onSpentReset: (key: string) => Promise<void> | void;
  onPayerChange: (key: string, payer: PayerType) => Promise<void> | void;
  onDelete?: (key: string) => Promise<void> | void;
}) {
  const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const isOver = spent > budget && budget > 0;
  // 총 예산 대비 이 카테고리의 비중 (이슈 #7)
  const totalShare = totalBudget > 0 && budget > 0 ? Math.round((budget / totalBudget) * 100) : 0;
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
              <span className="min-w-0 font-serif-kr text-[17px] font-normal leading-snug text-[#1b1c1c] line-clamp-2">{label}</span>
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
            onClick={() => {
              void Promise.resolve(onDelete(catKey)).catch(() => undefined);
            }}
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
          <span className="text-xs text-[#B5ADA3]">
            {budget > 0 ? "예산 사용률" : "예산 입력 전"}
            {totalShare > 0 ? <span className="ml-1.5 text-[#B5ADA3]/70">· 총예산의 {totalShare}%</span> : null}
          </span>
          {budget > 0 && (
            <span className={`text-xs font-medium ${
              isOver ? "text-red-400" : percent >= 100 ? "text-sage-500" : "text-[#504444]"
            }`}>
              {percent}%
            </span>
          )}
        </div>
        {budget > 0 && (
          <div className="h-2 bg-[#f6f3f2] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isOver ? "bg-red-400" : "bg-[#795252]"
              }`}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* 지출/예산/분담 */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-end gap-3 min-w-0">
          <div className="flex flex-col items-start">
            <span className="text-xs uppercase tracking-widest text-[#B5ADA3] mb-0.5">기록 지출</span>
            <InlineMoneyEdit
              value={spent}
              onSave={(v) => onSpentChange(catKey, v)}
              onReset={() => onSpentReset(catKey)}
              label={`${label} 기록 지출`}
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
              emptyLabel="미입력"
            />
          </div>
        </div>
        <PayerSelector value={payer} onChange={(v) => onPayerChange(catKey, v)} />
      </div>
    </div>
  );
}

interface BudgetContentProps {
  /** 패널/오버레이 안에서 렌더되는지 여부. true면 풀스크린 chrome (min-h-screen, max-w) 제거. */
  embedded?: boolean;
  /** 서버가 exact-true 출시 플래그를 확인한 경우에만 계약·지급 기록을 노출한다. */
  paymentLedgerEnabled?: boolean;
}

export default function BudgetContent({
  embedded = false,
  paymentLedgerEnabled = false,
}: BudgetContentProps = {}) {
  const { journey, updateJourney } = useAuthStore();

  const totalBudget = journey?.total_budget ?? 0;
  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress]
  );
  const hiddenKeys = new Set(((progress as Record<string, unknown>).__hidden as string[]) ?? []);

  // 커스텀 카테고리 추가 폼
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState("");
  const [newCatBudget, setNewCatBudget] = useState("");
  const [newCatSpent, setNewCatSpent] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [journeyNotice, setJourneyNotice] = useState("");
  const [journeyError, setJourneyError] = useState("");

  const saveJourney = useCallback(
    async (
      updates: Partial<
        Pick<
          WeddingJourney,
          "wedding_date" | "total_budget" | "venue" | "progress"
        >
      >,
    ) => {
      setJourneyError("");
      setJourneyNotice("");
      try {
        const result = await updateJourney(updates);
        if (result.status === "pending_partner") {
          setJourneyNotice(
            `${result.summary} 상대방에게 확인 요청을 보냈어요. 두 분 확인 전에는 반영되지 않습니다.`,
          );
        } else {
          setJourneyNotice("변경 내용을 저장했어요.");
        }
        return result;
      } catch (error) {
        setJourneyError(
          error instanceof Error
            ? error.message
            : "예산 변경을 저장하지 못했습니다.",
        );
        throw error;
      }
    },
    [updateJourney],
  );


  // progress에서 커스텀 카테고리 추출
  const customCategories = Object.entries(progress)
    .filter(([key]) => !KNOWN_KEYS.has(key) && !key.startsWith("__"))
    .map(([key, item]) => ({
      key,
      label: item.label ?? key,
      icon: "Tag",
    }));
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
      if (Number.isSafeInteger(item?.budget) && (item?.budget ?? 0) >= 0) {
        return item!.budget!;
      }
      return 0;
    },
    [progress]
  );

  const getCategorySpent = useCallback(
    (key: string) => {
      const item = progress[key];
      if (Number.isSafeInteger(item?.spent) && (item?.spent ?? 0) >= 0) {
        return item!.spent!;
      }
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
  const allCats = BUDGET_CATEGORIES;
  const visibleFixed = allCats.filter((c) => !hiddenKeys.has(c.key));
  const fixedSpent = visibleFixed.reduce((s, c) => s + getCategorySpent(c.key), 0);
  const fixedAllocated = visibleFixed.reduce((s, c) => s + getCategoryBudget(c.key), 0);
  const customSpent = customCategories.reduce((s, c) => s + getCategorySpent(c.key), 0);
  const customAllocated = customCategories.reduce((s, c) => s + getCategoryBudget(c.key), 0);
  const totalSpent = fixedSpent + customSpent;
  const totalAllocated = fixedAllocated + customAllocated;
  const hasTotalBudget = totalBudget > 0;
  const remaining = hasTotalBudget ? totalBudget - totalSpent : null;
  const spentPercent = hasTotalBudget
    ? Math.round((totalSpent / totalBudget) * 100)
    : null;
  const isOverBudget = remaining !== null && remaining < 0;

  const photoAttireMakeupBudget = PHOTO_ATTIRE_MAKEUP_KEYS
    .filter((key) => !hiddenKeys.has(key))
    .reduce((sum, key) => sum + getCategoryBudget(key), 0);
  const photoAttireMakeupSpent = PHOTO_ATTIRE_MAKEUP_KEYS
    .filter((key) => !hiddenKeys.has(key))
    .reduce((sum, key) => sum + getCategorySpent(key), 0);

  // 분담별 합계
  const allVisibleKeys = [
    ...visibleFixed.map((c) => c.key),
    ...customCategories.map((c) => c.key),
  ];
  const legacyReviewItems = [
    ...BUDGET_CATEGORIES.map((category) => ({
      key: category.key,
      label: category.label,
    })),
    ...customCategories.map((category) => ({
      key: category.key,
      label: category.label,
    })),
  ].flatMap(({ key, label }) => {
    const item = progress[key] as unknown as Record<string, unknown> | undefined;
    if (!item || !Object.prototype.hasOwnProperty.call(item, "cost")) return [];
    return [{
      key,
      label,
      amount: normalizeLegacyCostForReview(item.cost),
    }];
  });
  const payerSummary = allVisibleKeys.reduce(
    (acc, key) => {
      const payer = getCategoryPayer(key);
      const spent = getCategorySpent(key);
      acc[payer] = (acc[payer] ?? 0) + spent;
      return acc;
    },
    {} as Record<PayerType, number>
  );

  // 포함·별도 확인 항목이 있는 카테고리 중 지출이 시작된 것들 — 안내 카드 표시용
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
      await saveJourney({ progress: newProgress });
    },
    [progress, saveJourney]
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
      await saveJourney({ progress: newProgress });
    },
    [progress, saveJourney]
  );

  const handleSpentReset = useCallback(
    async (key: string) => {
      const existing = progress[key];
      if (!existing) return;
      const rest = { ...existing };
      delete rest.spent;
      const newProgress = {
        ...progress,
        [key]: { ...rest, category: key },
      };
      await saveJourney({ progress: newProgress });
    },
    [progress, saveJourney]
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
      await saveJourney({ progress: newProgress });
    },
    [progress, saveJourney]
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
      await saveJourney({ progress: newProgress });
      setNewCatLabel("");
      setNewCatBudget("");
      setNewCatSpent("");
      setShowAddModal(false);
    },
    [newCatLabel, newCatBudget, newCatSpent, progress, saveJourney]
  );

  const handleResetCategory = useCallback(
    async (key: string) => {
      const rest = { ...progress };
      delete rest[key];
      await saveJourney({ progress: rest });
      setDeletingKey(null);
    },
    [progress, saveJourney]
  );

  const handleDeleteCategory = useCallback(
    async (key: string) => {
      // progress[key]는 예산(budget/spent)과 일정 페이지 체크리스트를 같은 객체에 담는다.
      // 통째로 지우면 예산에서 뺐을 뿐인데 체크 진행도까지 영구 소실되므로,
      // 체크리스트가 있으면 금액만 비우고 항목 자체는 보존한다.
      const item = progress[key] as ProgressItem | undefined;
      const hasChecklist = Array.isArray(item?.checklist) && item.checklist.length > 0;
      const next: Record<string, unknown> = { ...progress };
      if (hasChecklist && item) {
        const keep = { ...item };
        delete keep.budget;
        delete keep.spent;
        delete keep.cost;
        next[key] = keep;
      } else {
        delete next[key];
      }
      if (KNOWN_KEYS.has(key)) {
        const hiddenList: string[] = (progress as Record<string, unknown>).__hidden as string[] ?? [];
        next.__hidden = [...hiddenList, key];
      }
      await saveJourney({ progress: next as unknown as Record<string, ProgressItem> });
      setDeletingKey(null);
    },
    [progress, saveJourney]
  );

  const handleTotalBudgetSave = async () => {
    const num = parseFloat(totalText);
    if (!isNaN(num) && num > 0) {
      try {
        await saveJourney({ total_budget: Math.round(num * 10000) });
        setEditingTotal(false);
      } catch {
        return;
      }
    }
  };

  return (
    <div className={embedded ? "bg-[#fcf9f8]" : ""}>
      <div
        className={
          embedded
            ? "max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto px-4 sm:px-6 md:px-8 lg:px-12 py-6 sm:py-8 md:py-10"
            : "space-y-4"
        }
      >
        {journeyNotice && (
          <div
            role="status"
            className="rounded-xl border border-[#B9D5C8] bg-[#F2F8F5] px-4 py-3 text-sm leading-6 text-[#315B49]"
          >
            {journeyNotice}
          </div>
        )}
        {journeyError && (
          <div
            role="alert"
            className="rounded-xl border border-[#E5B8B8] bg-[#FFF6F6] px-4 py-3 text-sm leading-6 text-[#8C3E3E]"
          >
            {journeyError}
          </div>
        )}

        {/* 상단 스탯 3개 - Editorial */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* Total Budget */}
          <div className="relative overflow-hidden rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in md:p-5">
            <Sparkles className="pointer-events-none absolute right-4 top-4 h-5 w-5 text-[#36534E]/25" />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">
                TOTAL BUDGET
              </p>
              {!editingTotal && (
                <button
                  onClick={() => {
                    setTotalText(
                      hasTotalBudget
                        ? String(Math.round(totalBudget / 10000))
                        : "",
                    );
                    setEditingTotal(true);
                  }}
                  className="relative z-10 text-[#9a9188] transition-colors hover:text-[#36534E]"
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
                  className="w-full max-w-full rounded-xl border border-[#36534E]/35 px-3 py-2 font-serif-kr text-[34px] font-medium leading-none text-[#071629] focus:border-[#36534E] focus:outline-none focus:ring-2 focus:ring-[#36534E]/10 sm:w-[170px]"
                />
                <button onClick={handleTotalBudgetSave} className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#36534E] text-white hover:bg-[#2d4642]">
                  <Check className="w-5 h-5" />
                </button>
                <button onClick={() => setEditingTotal(false)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#f6f3f2]">
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <p className="mt-4 flex flex-wrap items-baseline gap-2 font-serif-kr leading-none text-[#071629]">
                {hasTotalBudget ? (
                  <>
                    <span className="text-[36px] font-medium sm:text-[40px] lg:text-[42px]">{(totalBudget / 10000).toLocaleString()}</span>
                    <span className="text-[13px] font-medium text-[#7a8290]">만원</span>
                  </>
                ) : (
                  <span className="text-[30px] font-medium sm:text-[34px]">미입력</span>
                )}
              </p>
            )}
            <p className="mt-3 text-[13px] font-medium text-[#5d6879]">
              {hasTotalBudget ? "전체 예산" : "연필 버튼을 눌러 총 예산을 입력해주세요"}
            </p>
          </div>

          {/* Spent */}
          <div className="relative overflow-hidden rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in md:p-5">
            <TrendingUp className="pointer-events-none absolute right-4 top-4 h-5 w-5 text-[#36534E]/35" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">
              RECORDED SPEND
            </p>
            <p className="mt-4 flex flex-wrap items-baseline gap-2 font-serif-kr leading-none text-[#071629]">
              <span className="text-[36px] font-medium sm:text-[40px] lg:text-[42px]">{(totalSpent / 10000).toLocaleString()}</span>
              <span className="text-[13px] font-medium text-[#7a8290]">만원</span>
            </p>
            <p className="mt-3 text-[13px] font-medium text-[#5d6879]">
              {spentPercent === null
                ? "기록 지출 · 총 예산 입력 전 · 결제 완료 여부와 별도"
                : `기록 지출 (${spentPercent}%) · 결제 완료 여부와 별도`}
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#efe6d7]">
              <div
                className="h-full rounded-full bg-[#36534E] transition-all duration-700"
                style={{ width: `${Math.min(spentPercent ?? 0, 100)}%` }}
              />
            </div>
          </div>

          {/* Remaining */}
          <div className="relative overflow-hidden rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in md:p-5">
            <TrendingDown className={`pointer-events-none absolute right-4 top-4 h-5 w-5 ${isOverBudget ? "text-red-400/60" : "text-[#36534E]/35"}`} />
            <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${isOverBudget ? "text-red-400" : "text-[#36534E]"}`}>
              REMAINING
            </p>
            <p className={`mt-4 flex flex-wrap items-baseline gap-2 font-serif-kr leading-none ${isOverBudget ? "text-red-400" : "text-[#071629]"}`}>
              {remaining === null ? (
                <span className="text-[30px] font-medium sm:text-[34px]">계산 전</span>
              ) : (
                <>
                  <span className="text-[36px] font-medium sm:text-[40px] lg:text-[42px]">{remaining < 0 ? "-" : ""}{(Math.abs(remaining) / 10000).toLocaleString()}</span>
                  <span className="text-[13px] font-medium text-[#7a8290]">만원</span>
                </>
              )}
            </p>
            {remaining === null ? (
              <p className="mt-3 text-[13px] font-medium text-[#5d6879]">
                총 예산을 입력하면 남은 금액을 계산해요
              </p>
            ) : remaining >= 0 ? (
              <p className="mt-3 text-[13px] font-medium text-[#5d6879]">
                남은 예산 (여유 {Math.round((remaining / totalBudget) * 100)}%)
              </p>
            ) : (
              <p className="mt-3 flex items-center gap-1 text-[13px] font-medium text-red-400">
                <AlertTriangle className="w-4 h-4" />
                예산 초과
              </p>
            )}
          </div>
        </div>

        {legacyReviewItems.length > 0 && (
          <section
            role="status"
            className="rounded-[16px] border border-[#D8C7BB] bg-[#FFF9F2] px-4 py-4 text-sm text-[#504444]"
          >
            <h3 className="font-semibold text-[#2B2525]">용도 미확인 이전 금액</h3>
            <p className="mt-1 leading-6">
              이전 버전 값은 배정 예산인지 실제 기록인지 확인할 수 없어 예산·기록 지출 합계에서 제외했어요.
              아래 금액을 확인한 뒤 해당 항목에서 맞는 칸에 다시 입력해 주세요.
            </p>
            <ul className="mt-2 space-y-1">
              {legacyReviewItems.map((item) => (
                <li key={item.key}>
                  {item.label} {item.amount === null
                    ? "금액 형식 확인 필요"
                    : formatWonFull(item.amount)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {paymentLedgerEnabled && <PaymentLedger />}

        {/* 분담 현황 (Editorial Style) */}
        {totalSpent > 0 && (
          <div className="rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in md:p-5">
            <div className="mb-4 flex items-center gap-3">
              <Users className="h-5 w-5 text-[#36534E]" />
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">PAYER SUMMARY</p>
                <h3 className="font-serif-kr text-[22px] font-medium leading-tight text-[#071629]">분담 현황</h3>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {PAYER_OPTIONS.map((opt) => {
                const amount = payerSummary[opt.value] ?? 0;
                const pct = totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0;
                return (
                  <div
                    key={opt.value}
                    className={`rounded-[14px] border border-[#eadfc9]/70 p-3.5 transition-colors ${
                      amount > 0 ? "bg-[#fffdf7]" : "bg-[#f7f3ec]/55"
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-[#36534E]" aria-hidden="true" />
                      <span className="text-[13px] font-medium text-[#5d6879]">{opt.label}</span>
                    </div>
                    <p className={`font-serif-kr text-[25px] font-medium leading-none break-words ${
                      amount > 0 ? "text-[#071629]" : "text-[#9a9188]"
                    }`}>
                      {formatWon(amount)}
                    </p>
                    {amount > 0 && (
                      <div className="mt-3">
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#efe6d7]">
                          <div
                            className="h-full rounded-full bg-[#36534E] transition-all duration-500"
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

        {/* 검수된 공시가 비교 안내 — /price는 베이스패스 밖 최상위 표면이라 절대 경로 */}
        <Link
          href="/price"
          className="group flex items-center gap-4 rounded-[18px] border border-[#eadfc9] bg-white/90 px-4 py-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] transition-shadow hover:shadow-[0_12px_32px_rgba(8,22,38,0.055)] animate-fade-in md:px-5"
        >
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-[#f7f3ec]">
            <TrendingUp className="h-5 w-5 text-[#36534E]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">DISCLOSED PRICES</p>
            <p className="font-serif-kr text-[18px] font-medium text-[#071629]">공시가와 내 예산 확인</p>
            <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-[#5d6879]">운영자가 검수·발행한 업체 가격 · 기준일과 구성 범위 확인</p>
          </div>
          <span className="hidden flex-shrink-0 items-center gap-1 whitespace-nowrap text-[13px] font-semibold text-[#36534E] group-hover:underline sm:flex">
            자세히 보기 <ArrowRight className="w-4 h-4" />
          </span>
          <ArrowRight className="h-5 w-5 flex-shrink-0 text-[#36534E] sm:hidden" />
        </Link>

        {/* 사진 촬영·의상·메이크업 묶음 */}
        <div className="overflow-hidden rounded-[18px] border border-[#eadfc9] bg-white/90 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in">
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
                <p className="text-xs tracking-widest uppercase text-[#795252] mb-1 font-medium">묶음 예산</p>
                <h3 className="h-section">사진 촬영·드레스·헤어·메이크업 묶음</h3>
                <p className="text-sm text-[#504444] mt-0.5">웨딩 사진 촬영 · 드레스 · 헤어·메이크업</p>
              </div>
            </div>
            <div className="text-right">
              {photoAttireMakeupBudget > 0 ? (
                <>
                  <p className="h-section break-words">
                    {formatWonFull(photoAttireMakeupSpent)} <span className="text-[#B5ADA3] text-base sm:text-lg">/ {formatWonFull(photoAttireMakeupBudget)}</span>
                  </p>
                  <p className="text-sm text-[#504444] mt-1">
                    {Math.round((photoAttireMakeupSpent / photoAttireMakeupBudget) * 100)}% 사용
                  </p>
                </>
              ) : (
                <>
                  <p className="h-section break-words">{formatWonFull(photoAttireMakeupSpent)} 사용</p>
                  <p className="text-sm text-[#504444] mt-1">예산 입력 전</p>
                </>
              )}
            </div>
          </div>
          <div className="divide-y divide-[#f6f3f2]">
            {PHOTO_ATTIRE_MAKEUP_KEYS.filter((key) => !hiddenKeys.has(key)).map((key) => {
              const cat = BUDGET_CATEGORIES.find((category) => category.key === key)!;
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
                  totalBudget={totalBudget}
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
            <h3 className="h-section">기타 카테고리</h3>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-[#B5ADA3]">
            <Pencil className="w-4 h-4 text-[#795252]/50" />
            클릭하여 수정
          </div>
        </div>

        {/* 기타 카테고리 - 2열 그리드 카드 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 animate-fade-in">
          {OTHER_KEYS.filter((k) => !hiddenKeys.has(k)).map((key) => {
            const cat = BUDGET_CATEGORIES.find((category) => category.key === key)!;
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
                totalBudget={totalBudget}
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
              totalBudget={totalBudget}
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
          {/* 포함·별도 확인 섹션 */}
          <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 sm:p-8">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-[#795252]/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-[#795252]" />
              </div>
              <div className="min-w-0">
                <p className="text-xs tracking-widest uppercase text-[#795252] mb-1 font-medium">VERIFY ITEMS</p>
                <h3 className="h-section">포함·별도 항목 체크</h3>
                <p className="text-sm text-[#504444] mt-1">
                  {hiddenCostWarnings.length > 0
                    ? `진행 중인 ${hiddenCostWarnings.length}개 카테고리의 포함 범위를 확인해보세요.`
                    : "계약 전에 항목별 포함·별도 여부를 서면으로 확인하세요."}
                </p>
              </div>
            </div>
            <div className="space-y-2.5 max-h-[240px] overflow-y-auto">
              {(hiddenCostWarnings.length > 0
                ? hiddenCostWarnings
                : Object.keys(HIDDEN_COSTS).slice(0, 4)
              ).map((key) => {
                const cat = BUDGET_CATEGORIES.find((category) => category.key === key);
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
                    <span className="text-xs font-medium text-[#795252] flex-shrink-0">{data.guidance}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI Spotlight */}
          <div className="relative rounded-2xl overflow-hidden min-h-[240px] sm:min-h-[280px] bg-[#243832] p-6 sm:p-8 lg:p-10 flex flex-col justify-between">
            <div className="relative">
              <p className="text-xs tracking-widest uppercase text-[#C9A96E] mb-3 font-medium">
                AI 예산 분석
              </p>
              <h3 className="font-serif-kr text-2xl sm:text-3xl text-white mb-3 font-light break-words">
                어디를 먼저 확인할까요?
              </h3>
              <p className="text-base text-white/70 mb-6 max-w-md">
                직접 입력한 예산·기록 지출과 확인이 필요한 포함 항목을 함께 정리해드려요.
              </p>
            </div>
            <Link
              {...weddingLinkProps("/chat")}
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
            <span className="block mb-1">
              직접 입력하거나 계약 금액으로 확인된 예산만 합산합니다.
            </span>
             {totalBudget > 0 && totalAllocated < totalBudget && (
               <span className="text-[#795252]">
                 항목별 예산 합계 {formatWonFull(totalAllocated)} · 아직 {formatWonFull(totalBudget - totalAllocated)}을 항목에 나누지 않았습니다.
               </span>
             )}
             {totalBudget > 0 && totalAllocated > totalBudget && (
               <span className="text-red-500">
                 항목별 예산 합계가 총 예산보다 {formatWonFull(totalAllocated - totalBudget)} 많습니다.
               </span>
             )}
             {totalBudget > 0 && totalAllocated === totalBudget && (
               <span>항목별 예산 합계가 총 예산과 일치합니다.</span>
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newCatLabel.trim()) {
                        void handleAddCategory().catch(() => undefined);
                      }
                    }}
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
                    <label className="text-[11px] uppercase tracking-widest text-[#B5ADA3] mb-1.5 block">기록 지출 (만원 · 결제 확인과 별도)</label>
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
                  onClick={() => void handleAddCategory().catch(() => undefined)}
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
            const cat = BUDGET_CATEGORIES.find((category) => category.key === deletingKey);
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
                          onClick={() => {
                            void handleResetCategory(deletingKey).catch(() => undefined);
                          }}
                          className="flex-1 py-2.5 rounded-xl bg-[#f6f3f2] text-[13px] text-[#795252] font-medium hover:bg-[#795252]/10 transition-colors"
                        >
                          데이터 초기화
                        </button>
                        <button
                          onClick={() => {
                            void handleDeleteCategory(deletingKey).catch(() => undefined);
                          }}
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
                        onClick={() => {
                          void handleDeleteCategory(deletingKey).catch(() => undefined);
                        }}
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
