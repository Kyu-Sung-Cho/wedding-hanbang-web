"use client";

import { useState, useCallback, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  FileText,
  TrendingUp,
  ChevronDown,
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
import { formatWon } from "@/lib/formatWon";
import { parseWeddingBudgetManwonInput } from "@/lib/weddingBudget";
import { formatLoungeBudgetRatio } from "@/lib/amora/loungeSummary";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import {
  CATEGORY_CHECKLISTS,
  PREPARATION_PROGRESS_STATUS_LABELS,
  isPreparationProgressStatus,
  type PreparationProgressStatus,
} from "@hanbang/shared/constants";
import type {
  ProgressItem,
  PayerType,
  WeddingJourney,
} from "@/types/database.types";
import { weddingLinkProps } from "@/lib/weddingPaths";
import Link from "next/link";
import PaymentLedger from "./PaymentLedger";
import BudgetShareChart from "./BudgetShareChart";
import { foldPayerSides } from "./shareMath";
import BudgetSideSplit from "./BudgetSideSplit";
import { isSkippedBudgetCategoryWithoutMoney, isUnusedBudgetCategory } from "./isUnusedBudgetCategory";
import Button from "@/components/ui/Button";
import AmoraMark from "@/components/ui/AmoraMark";
import { AMORA_ACTION_CLASS } from "@/components/ui/amoraActionStyles";
import { FEATURE_SUMMARY_CLASS, SUMMARY_LABEL_CLASS, SUMMARY_VALUE_CLASS } from "@/components/ui/featureSummaryStyles";
import BudgetProgress from "./BudgetProgress";

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

function formatWonFull(n: number): string {
  return formatWon(n);
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

// 분담(Payer) 선택 컴포넌트
function PayerSelector({
  value,
  onChange,
  alignStartOnMobile = false,
}: {
  value: PayerType;
  onChange: (v: PayerType) => Promise<void> | void;
  alignStartOnMobile?: boolean;
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
    <div ref={ref} className="relative" onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        setOpen(false);
        ref.current?.querySelector("button")?.focus();
      }
    }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setError("");
          setOpen(!open);
        }}
        className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-hover)] transition-colors"
        title="분담 변경"
      >
        <Users className="h-4 w-4" aria-hidden="true" />
        <span>{currentLabel}</span>
      </button>
      {open && (
        <div className={`absolute z-40 top-full mt-1 w-[150px] bg-white rounded-lg shadow-[var(--shadow-raised)] overflow-hidden ${alignStartOnMobile ? "left-0 lg:left-auto lg:right-0" : "right-0"}`}>
          {PAYER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                setError("");
                void Promise.resolve().then(() => onChange(opt.value))
                  .then(() => {
                    setOpen(false);
                    ref.current?.querySelector("button")?.focus();
                  })
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
                  ? "bg-[var(--amora-selected-bg)] text-[var(--amora-selected-text)] font-medium"
                  : "text-[var(--hb-text-strong)] hover:bg-[var(--hb-surface-hover)]"
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
    setText(String(value / 10000));
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
            aria-label={`${label} (만원)`}
            min="0"
            step="0.0001"
            className="w-[80px] px-2 py-1 rounded-lg border border-[var(--hb-hairline)] text-[13px] text-right text-[var(--hb-text-strong)] focus:outline-none border-[var(--amora-rose-deep)] focus:ring-2 ring-[#a77b744d] disabled:opacity-50"
          />
          <span className="text-[11px] text-[var(--amora-muted)]">만원</span>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="tap-area shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[var(--hb-success)] hover:bg-[#eef4ed] disabled:opacity-50"
            title="저장"
            aria-label={`${label} 저장`}
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={cancel}
            disabled={saving}
            className="tap-area shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[var(--amora-muted)] hover:bg-[var(--hb-surface-hover)] disabled:opacity-50"
            title="취소"
            aria-label={`${label} 수정 취소`}
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
        className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors ${
          highlight === "spent"
            ? "hover:bg-[var(--amora-warm)]"
            : "hover:bg-[var(--hb-surface-hover)]"
        }`}
        title={`${label} 수정`}
        aria-label={`${label} 수정`}
      >
        <span className={`whitespace-nowrap text-[12.5px] font-semibold tabular-nums ${
          highlight === "spent" ? "text-[var(--hb-text-strong)]" : "text-[var(--hb-text-body)]"
        }`}>
          {value > 0 || !emptyLabel ? formatWon(value) : emptyLabel}
        </span>
        <Pencil className={`h-3 w-3 shrink-0 ${
          highlight === "spent" ? "text-[#a77b74]" : "text-[var(--amora-muted)]"
        }`} />
      </button>
      {onReset && value > 0 && (
        <button
          onClick={() => {
            void Promise.resolve(onReset()).catch(() => undefined);
          }}
          className="tap-area shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[var(--amora-muted)] hover:text-danger-700 hover:bg-red-50 transition-colors"
          title={`${label} 초기화`}
          aria-label={`${label} 초기화`}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

interface BudgetCategoryProps {
  catKey: string;
  label: string;
  icon: string;
  budget: number;
  spent: number;
  status: PreparationProgressStatus;
  payer: PayerType;
  totalBudget: number;
  onBudgetChange: (key: string, val: number) => Promise<void> | void;
  onSpentChange: (key: string, val: number) => Promise<void> | void;
  onSpentReset: (key: string) => Promise<void> | void;
  onPayerChange: (key: string, payer: PayerType) => Promise<void> | void;
  onDelete?: (key: string) => Promise<void> | void;
}

// 상태와 편집 버튼을 한 번만 렌더해 화면 폭이 바뀌어도 입력 상태를 보존한다.
function BudgetCategoryEntry({
  catKey, label, icon, budget, spent, status, payer, totalBudget,
  onBudgetChange, onSpentChange, onSpentReset, onPayerChange, onDelete,
  compact = false,
}: BudgetCategoryProps & { compact?: boolean }) {
  const isOver = spent > budget && budget > 0;
  const totalShare = totalBudget > 0 && budget > 0 ? formatLoungeBudgetRatio(budget, totalBudget) : null;
  const Icon = ICON_MAP[icon] ?? Building2;

  return (
    <div data-budget-category={catKey} className={`group min-w-0 border-t border-[var(--amora-line)] bg-white py-3 ${compact ? "lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-6 lg:py-3.5" : "sm:rounded-[14px] sm:border sm:px-[18px] sm:py-4"}`}>
      <div className="min-w-0">
        <div className="mb-1.5 flex min-w-0 items-center gap-2.5">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:h-8 sm:w-8 ${isOver ? "bg-red-50 text-danger-700" : "bg-[var(--amora-warm)] text-[var(--amora-rose-deep)]"}`}>
            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-[var(--amora-ink)] sm:text-[13.5px]">{label}</span>
          <span data-budget-status={status} className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${status === "completed" ? "bg-[var(--amora-sage-pale)] text-[#33473a]" : status === "in_progress" ? "bg-[var(--amora-rose-pale)] text-[var(--amora-rose-deep)]" : status === "not_applicable" ? "border border-dashed border-[var(--amora-line)] bg-white text-[var(--amora-muted)]" : "bg-[var(--amora-low)] text-[var(--amora-soft)]"}`}>{PREPARATION_PROGRESS_STATUS_LABELS[status]}</span>
          {onDelete && (
            <button type="button" onClick={() => { void Promise.resolve(onDelete(catKey)).catch(() => undefined); }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--amora-muted)] transition-colors hover:bg-red-50 hover:text-danger-700" title={`${label} 삭제`}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-[var(--amora-muted)]">
          <span>{budget > 0 ? `예산 사용률 ${formatLoungeBudgetRatio(spent, budget)}` : "예산 입력 전"}{totalShare !== null ? ` · 총예산의 ${totalShare}` : ""}</span>
          <PayerSelector value={payer} onChange={(value) => onPayerChange(catKey, value)} />
        </div>
        {budget > 0 && <div className="mt-1.5"><BudgetProgress value={(spent / budget) * 100} danger={isOver} /></div>}
      </div>
      <div className={`mt-2 grid min-w-0 gap-1 ${compact ? "lg:mt-0 lg:min-w-[190px]" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-[11px] text-[var(--amora-muted)]">기록 지출</span>
          <InlineMoneyEdit value={spent} onSave={(value) => onSpentChange(catKey, value)} onReset={() => onSpentReset(catKey)} label={`${label} 기록 지출`} highlight="spent" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-[11px] text-[var(--amora-muted)]">예산</span>
          <InlineMoneyEdit value={budget} onSave={(value) => onBudgetChange(catKey, value)} label={`${label} 예산`} highlight="budget" emptyLabel="미입력" />
        </div>
      </div>
    </div>
  );
}

function BudgetRow(props: BudgetCategoryProps) {
  return <BudgetCategoryEntry {...props} compact />;
}

function BudgetCard(props: BudgetCategoryProps) {
  return <BudgetCategoryEntry {...props} />;
}

function BudgetVerificationRows({ categoryKeys }: { categoryKeys: string[] }) {
  return <>            {categoryKeys.map((key) => {
              const category = BUDGET_CATEGORIES.find((category) => category.key === key);
              const data = HIDDEN_COSTS[key];
              if (!category || !data) return null;
              const Icon = ICON_MAP[category.icon] ?? Building2;
              return (
                <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--amora-line)] py-3 sm:px-1 sm:py-[13px]">
                  <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--amora-warm)] text-[var(--amora-rose-deep)] sm:flex"><Icon className="h-[15px] w-[15px]" /></span>
                  <div className="min-w-0 flex-1 basis-[230px]"><p className="text-[12.5px] font-semibold text-[var(--amora-ink)] sm:text-[13px]">{category.label}</p><p className="mt-1 text-[11px] leading-relaxed text-[var(--amora-muted)] sm:text-[11.5px]">{data.warning}</p></div>
                  <span className="text-[11px] font-semibold text-[var(--amora-accent)] sm:text-[11.5px]">{data.guidance}</span>
                </div>
              );
            })}</>;
}

interface BudgetContentProps {
  /** 패널/오버레이 안에서 렌더되는지 여부. true면 풀스크린 chrome (min-h-screen, max-w) 제거. */
  embedded?: boolean;
  /** 서버가 exact-true 출시 플래그를 확인한 경우에만 계약·지급 기록을 노출한다. */
  paymentLedgerEnabled?: boolean;
}

function sameBudgetDeleteItem(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameBudgetDeleteItem(value, right[index]));
  }
  const previous = left as Record<string, unknown>;
  const current = right as Record<string, unknown>;
  const keys = Object.keys(previous);
  return keys.length === Object.keys(current).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(current, key)
      && sameBudgetDeleteItem(previous[key], current[key]));
}

function budgetEditorOwnerKey() {
  const state = useAuthStore.getState();
  return JSON.stringify([
    state.isDemo, state.user?.id, state.profile?.id, state.profile?.couple_id,
    state.couple?.id, state.journey?.couple_id, state.journey?.id,
  ]);
}

export default function BudgetContent(props: BudgetContentProps = {}) {
  // 입력·삭제·분담 선택을 같은 소유 범위에 묶는다. 구독에서 매 전환을 관찰해야
  // React가 A→B→A를 한 번에 그려도 A의 옛 초안과 지연된 저장이 되살아나지 않는다.
  const [owner] = useState(() => {
    let snapshot = { key: budgetEditorOwnerKey(), epoch: 0 };
    const getSnapshot = () => {
      const key = budgetEditorOwnerKey();
      if (key !== snapshot.key) snapshot = { key, epoch: snapshot.epoch + 1 };
      return snapshot;
    };
    return {
      getSnapshot,
      subscribe: (notify: () => void) => useAuthStore.subscribe(() => {
        const previous = snapshot;
        if (getSnapshot() !== previous) notify();
      }),
    };
  });
  const binding = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return <ScopedBudgetContent {...props} key={`${binding.key}:${binding.epoch}`}
    isCurrentOwner={() => owner.getSnapshot() === binding} />;
}

function ScopedBudgetContent({
  embedded = false,
  paymentLedgerEnabled = false,
  isCurrentOwner,
}: BudgetContentProps & { isCurrentOwner: () => boolean }) {
  const { journey, updateJourney } = useAuthStore();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const totalBudget = journey?.total_budget ?? 0;
  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress]
  );
  const hiddenKeys = new Set(((progress as Record<string, unknown>).__hidden as string[]) ?? []);
  const [openedCategories, setOpenedCategories] = useState<Set<string>>(() => new Set());
  const categorySection = useRef<HTMLDivElement>(null);
  const categoryToFocus = useRef<string | null>(null);
  const shownFixedKeys = BUDGET_CATEGORIES.filter(({ key }) =>
    !hiddenKeys.has(key)
    && (openedCategories.has(key) || (
      !isUnusedBudgetCategory(key, progress[key])
      && !isSkippedBudgetCategoryWithoutMoney(progress[key])
    )),
  ).map(({ key }) => key);
  const unusedCategories = BUDGET_CATEGORIES.filter(({ key }) =>
    !hiddenKeys.has(key) && !shownFixedKeys.includes(key),
  );
  const shownPhotoAttireMakeupKeys = PHOTO_ATTIRE_MAKEUP_KEYS.filter((key) => shownFixedKeys.includes(key));

  useEffect(() => {
    const category = BUDGET_CATEGORIES.find(({ key }) => key === categoryToFocus.current);
    if (!category) return;
    const editButton = Array.from(categorySection.current?.querySelectorAll<HTMLButtonElement>("button[title]") ?? [])
      .find((button) => button.title === `${category.label} 예산 수정`);
    editButton?.focus();
    categoryToFocus.current = null;
  }, [openedCategories]);

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
        if (!mounted.current || !isCurrentOwner()) {
          throw new Error("계정이나 커플 연결이 바뀌었어요. 현재 예산 화면에서 다시 입력해 주세요.");
        }
        const result = await updateJourney(updates);
        if (!mounted.current || !isCurrentOwner()) {
          throw new Error("계정이나 커플 연결이 바뀌었어요. 현재 예산 화면에서 결과를 확인해 주세요.");
        }
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
    [isCurrentOwner, updateJourney],
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
  /** 총 예산 입력이 거절된 이유. 없으면 화면이 조용해진다. */
  const [totalBudgetError, setTotalBudgetError] = useState("");
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

  // 상태 이름은 온보딩·체크리스트와 같은 공유 사전(아직/준비 중/완료/안 해요)을 쓴다.
  const getStatus = useCallback(
    (key: string): PreparationProgressStatus => {
      const status = progress[key]?.status;
      return isPreparationProgressStatus(status) ? status : "not_started";
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
  const hasLongSummaryAmount = [totalBudget, totalSpent, remaining ?? 0].some(
    (amount) => (amount / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 4 }).length >= 9,
  );

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

  /**
   * 양측 분담 — 네 값을 세 기둥으로 접는다.
   *
   * 접는 일은 `@hanbang/shared/budget-share` 가 한다. 모바일 예산 화면이 같은 함수를
   * 부르므로 두 앱이 같은 커플에게 다른 기둥을 말할 수 없다. 규칙과 왜 새 `payer`
   * 값을 만들지 않았는지는 그 파일 머리말에 있다.
   */
  const payerSides = foldPayerSides(payerSummary);

  /**
   * 항목별 비중에 넘길 조각들.
   *
   * **여기서 progress 를 다시 읽지 않는다.** 이 화면의 합계를 만든 것과 같은
   * `getCategorySpent`/`getCategoryBudget` 과 같은 목록(`visibleFixed` + 커스텀)을
   * 쓴다. 따로 세면 도넛의 총액과 위 카드의 총액이 갈리는데, 그 사고는
   * `lib/budgetTotals.ts` 머리말에 기록돼 있다(2026-08-24).
   *
   * 기록 지출이 아직 0이면 배정 예산으로 그린다 — 첫날에도 "어디에 얼마를 잡았나"는
   * 답할 수 있어야 한다.
   */
  const shareBasis: "spent" | "budget" = totalSpent > 0 ? "spent" : "budget";
  const shareSlices = [...visibleFixed, ...customCategories].map((category) => ({
    key: category.key,
    label: category.label,
    amount: shareBasis === "spent"
      ? getCategorySpent(category.key)
      : getCategoryBudget(category.key),
  }));

  // 카드의 확인 배지를 하단 표로 모으되, 예산·준비 기록만 있는 항목도 빠뜨리지 않는다.
  const hiddenCostWarnings = Object.keys(HIDDEN_COSTS).filter(
    (key) => !hiddenKeys.has(key) && shownFixedKeys.includes(key)
  );

  const shownVerificationKeys = hiddenCostWarnings.length > 0
    ? hiddenCostWarnings
    : Object.keys(HIDDEN_COSTS).slice(0, 4);
  const otherVerificationKeys = Object.keys(HIDDEN_COSTS).filter((key) => !shownVerificationKeys.includes(key));

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
      // progress[key]에는 금액과 함께 일정 페이지의 체크리스트·진행 상태·업체·메모가 들어 있다.
      // 키를 통째로 지우면 금액만 비우려던 사람의 체크 기록이 사라지고, 서버도 금액 밖 변경이
      // 섞였다며 400(PLAN_CHANGE_MIXED_DELTA_UNSUPPORTED)으로 거절한다.
      // 그래서 항목은 남기고 서버가 금액으로 세는 필드(budget·spent·payer)만 뗀다.
      // category 는 새로 붙이지 않고, cost·__hidden 은 건드리지 않는다.
      const item = progress[key] as ProgressItem | undefined;
      if (item) {
        const keep = { ...item };
        delete keep.budget;
        delete keep.spent;
        delete keep.payer;
        await saveJourney({ progress: { ...progress, [key]: keep } });
      }
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
      // 2026-09-04 실측: 커스텀 항목(체크리스트 없음)을 통째로 지우면 서버가 금액 변경과
      // 준비 현황 변경이 섞였다며 400(PLAN_CHANGE_MIXED_DELTA_UNSUPPORTED)을 돌려줘
      // 모달이 안 닫히고 항목이 남았다. 고정 카테고리 숨김·체크리스트 있는 항목은 통과한다.
      // 그래서 금액이 실린 커스텀 키는 **금액을 먼저 비우고**(1단계), 그 다음 키를 지운다(2단계).
      // 서버가 "공동 결정"으로 세는 필드는 budget·spent·cost 만이 아니라 payer·responsibility·
      // assigned_to 까지다(couple_plan_change_exact_high_summary). 하나라도 남기면 2단계가 또 400.
      const moneyLike = item as unknown as (Record<string, unknown> | undefined);
      const hasMoney = moneyLike !== undefined
        && ["budget", "spent", "cost", "payer", "responsibility", "assigned_to"]
          .some((field) => moneyLike[field] !== undefined && moneyLike[field] !== null);
      if (!KNOWN_KEYS.has(key) && !hasChecklist && hasMoney && item) {
        const emptied: Record<string, unknown> = { ...progress };
        const keep: Record<string, unknown> = { ...(item as unknown as Record<string, unknown>) };
        for (const field of ["budget", "spent", "cost", "payer", "responsibility", "assigned_to"]) {
          delete keep[field];
        }
        emptied[key] = keep;
        const cleared = await saveJourney({ progress: emptied as unknown as Record<string, ProgressItem> });
        if (cleared.status !== "applied") return;
        // 첫 저장을 기다리는 동안 다른 항목이 갱신될 수 있다. 최신 상태에서 이 키만
        // 제거하되, 이 항목 자체가 바뀌었으면 새 체크리스트·금액까지 지우지 않는다.
        const latest = useAuthStore.getState().journey;
        const clearedItem = cleared.journey.progress[key];
        if (!latest || latest.id !== cleared.journey.id
          || latest.couple_id !== cleared.journey.couple_id || !clearedItem
          || !sameBudgetDeleteItem(clearedItem, latest.progress[key])) {
          const message = "삭제 중 항목이 바뀌었어요. 최신 내용을 확인한 뒤 다시 삭제해 주세요.";
          setJourneyNotice("");
          setJourneyError(message);
          throw new Error(message);
        }
        const latestProgress = { ...latest.progress };
        delete latestProgress[key];
        await saveJourney({ progress: latestProgress });
        setDeletingKey(null);
        return;
      }
      await saveJourney({ progress: next as unknown as Record<string, ProgressItem> });
      setDeletingKey(null);
    },
    [progress, saveJourney]
  );

  const handleTotalBudgetSave = async () => {
    const amount = parseWeddingBudgetManwonInput(totalText);
    // 조건에 안 맞으면 **아무 일도 안 일어났다.** 닫히지도, 저장되지도, 말해주지도
    // 않아서 버튼이 죽은 것처럼 보였다. 0 을 넣거나 칸을 비운 사람이 그렇게 갇혔다.
    if (amount === null) {
      setTotalBudgetError("0보다 크고 10억원 이하인 금액을 만원 단위로 넣어주세요. 소수점 아래 네 자리까지 입력할 수 있어요. 아직 안 정했다면 그냥 닫으셔도 돼요.");
      return;
    }
    setTotalBudgetError("");
    try {
      await saveJourney({ total_budget: amount });
      setEditingTotal(false);
    } catch {
      // saveJourney 가 이미 오류 문구를 세웠다. 편집 상태를 열어 둬 다시 시도할 수 있게 한다.
    }
  };

  return (
    <div className="planning-workspace text-[var(--amora-soft)]">
      <div
        className={
          embedded
            ? "mx-auto max-w-[1160px] space-y-3.5 bg-[var(--amora-bg)] px-[18px] py-4 sm:space-y-5 sm:px-9 sm:py-[30px]"
            : "mx-auto w-full max-w-[1440px] space-y-3.5 px-[18px] py-4 sm:space-y-5 lg:px-9 lg:py-[30px]"
        }
      >
        {journeyNotice && (
          <div
            role="status"
            className="rounded-lg border border-[#B9D5C8] bg-[#F2F8F5] px-4 py-3 text-sm leading-6 text-[#315B49]"
          >
            {journeyNotice}
          </div>
        )}
        {journeyError && !showAddModal && !deletingKey && (
          <div
            role="alert"
            className="rounded-lg border border-[#E5B8B8] bg-[#FFF6F6] px-4 py-3 text-sm leading-6 text-[#8C3E3E]"
          >
            {journeyError}
          </div>
        )}

        {/* 긴 원 단위 금액과 편집 상태는 넓은 칸을 사용해 숫자를 끊지 않는다. */}
        <section aria-label="예산 요약" className={`${FEATURE_SUMMARY_CLASS} p-4 sm:p-6`}>
          <div data-budget-summary className={`grid gap-y-4 sm:gap-y-0 ${hasLongSummaryAmount ? "grid-cols-1 md:grid-cols-3" : "grid-cols-2 md:grid-cols-3"}`}>
            <div data-budget-stat="total" className={`min-w-0 border-b border-[var(--hb-summary-line,#DEC9BA)] pb-4 md:border-b-0 md:pb-0 md:pr-5 ${hasLongSummaryAmount ? "" : "col-span-2 md:col-span-1"}`}>
              {editingTotal ? (
                <p className={`flex min-h-11 items-center ${SUMMARY_LABEL_CLASS}`}>총 예산</p>
              ) : (
                <button type="button" onClick={() => { setTotalText(hasTotalBudget ? String(totalBudget / 10000) : ""); setEditingTotal(true); }} className={`flex min-h-11 min-w-11 w-full items-center justify-between gap-2 rounded text-left hover:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] ${SUMMARY_LABEL_CLASS}`} aria-label="총 예산 수정" title="총 예산 수정">
                  <span>총 예산</span>
                  <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              )}
              {editingTotal ? (
                <div className="mt-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <input ref={totalInputRef} type="number" min="0.0001" step="0.0001" aria-label="총 예산 (만원)" value={totalText} onChange={(event) => setTotalText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleTotalBudgetSave(); if (event.key === "Escape") setEditingTotal(false); }} className="w-full rounded-lg border border-[var(--amora-line)] bg-[var(--amora-warm)] px-2 py-1 text-[16px] tabular-nums outline-none focus:border-[var(--amora-rose-deep)]" />
                    <span className="mr-auto text-xs text-[var(--hb-summary-label,#624A3C)]">만원</span>
                    <button type="button" onClick={() => void handleTotalBudgetSave()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--amora-action)] text-white hover:bg-[var(--amora-action-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)]" title="총 예산 저장"><Check className="h-4 w-4" /></button>
                    <button type="button" onClick={() => setEditingTotal(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--amora-muted)] hover:bg-[var(--amora-warm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)]" title="총 예산 취소"><X className="h-4 w-4" /></button>
                  </div>
                  {totalBudgetError && <p role="alert" className="mt-2 text-xs leading-relaxed text-[#913C3C]">{totalBudgetError}</p>}
                </div>
              ) : (
                <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                  <span className={`whitespace-nowrap ${SUMMARY_VALUE_CLASS}`}>{hasTotalBudget ? (totalBudget / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 4 }) : "미입력"}</span>
                  {hasTotalBudget && <small className={SUMMARY_LABEL_CLASS}>만원</small>}
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-[var(--hb-summary-label,#624A3C)]">{hasTotalBudget ? "전체 예산" : "총 예산을 입력해 주세요"}</p>
            </div>
            <div data-budget-stat="spent" className="min-w-0 md:border-l md:border-[var(--hb-summary-line,#DEC9BA)] md:px-5">
              <p className={`sm:flex sm:min-h-11 sm:items-center ${SUMMARY_LABEL_CLASS}`}>기록 지출</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5"><span className={`whitespace-nowrap ${SUMMARY_VALUE_CLASS}`}>{(totalSpent / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 4 })}</span><small className={SUMMARY_LABEL_CLASS}>만원</small></p>
              <p className="mt-2 text-xs leading-relaxed text-[var(--hb-summary-label,#624A3C)]">{spentPercent === null ? "기록 지출 · 총 예산 입력 전" : <>기록 지출 (<strong className="text-sm font-semibold tabular-nums">{formatLoungeBudgetRatio(totalSpent, totalBudget)}</strong>)</>}</p>
            </div>
            <div data-budget-stat="remaining" className={`min-w-0 border-[var(--hb-summary-line,#DEC9BA)] md:border-l md:pl-5 ${hasLongSummaryAmount ? "border-t pt-4 md:border-t-0 md:pt-0" : "border-l pl-4"}`}>
              <p className={`sm:flex sm:min-h-11 sm:items-center ${SUMMARY_LABEL_CLASS}`}>남은 금액</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5"><span className={`whitespace-nowrap text-[24px] font-semibold leading-tight tracking-tight tabular-nums sm:text-[30px] ${isOverBudget ? "text-[#913C3C]" : "text-[var(--hb-summary-ink,#382F2B)]"}`}>{remaining === null ? "계산 전" : (remaining / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 4 })}</span>{remaining !== null && <small className={SUMMARY_LABEL_CLASS}>만원</small>}</p>
              <p className={`mt-2 text-xs leading-relaxed ${isOverBudget ? "font-semibold text-[#913C3C]" : "text-[var(--hb-summary-label,#624A3C)]"}`}>{remaining === null ? "총 예산을 입력하면 남은 금액을 계산해요" : isOverBudget ? "예산 초과" : "지출 기록을 뺀 금액"}</p>
            </div>
          </div>
          <dl aria-label="항목별 예산 배정" className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-[var(--hb-summary-line,#DEC9BA)] pt-3 text-xs leading-relaxed sm:mt-5 sm:text-[13px]">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <dt className="text-[var(--amora-muted)]">항목별 배정 합계</dt>
              <dd className="font-medium tabular-nums text-[var(--amora-ink)] [overflow-wrap:anywhere]">{formatWonFull(totalAllocated)}</dd>
            </div>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <dt className="text-[var(--amora-muted)]">{hasTotalBudget && totalAllocated > totalBudget ? "초과배정" : "미배정액"}</dt>
              <dd className={`font-medium tabular-nums [overflow-wrap:anywhere] ${hasTotalBudget && totalAllocated > totalBudget ? "text-[var(--danger-700)]" : "text-[var(--amora-ink)]"}`}>
                {hasTotalBudget ? formatWonFull(Math.abs(totalBudget - totalAllocated)) : "총 예산 입력 전"}
                {hasTotalBudget && totalAllocated === totalBudget && <span className="ml-2 font-normal text-[var(--amora-muted)]">총 예산과 일치</span>}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-[var(--hb-summary-label,#624A3C)]">항목별 배정 예산과 직접 기록한 지출 내역을 한눈에 비교해 보세요.</p>
        </section>

        {legacyReviewItems.length > 0 && (
          <section
            role="status"
            className="rounded-lg border border-[#D8C7BB] bg-[#FFF9F2] px-4 py-4 text-sm text-[var(--hb-text-body)]"
          >
            <h3 className="text-[#2B2525]">용도 미확인 이전 금액</h3>
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

        {/* 항목별 비중. 세 요약 카드가 "얼마"를 답하고 이 도넛이 "어디에"를 답한다 —
            그래서 카드 바로 다음이고 분담 현황보다 앞이다. 조각이 하나도 없으면
            컴포넌트가 스스로 null 을 낸다. */}
        <BudgetShareChart slices={shareSlices} basis={shareBasis} />

        {paymentLedgerEnabled && <PaymentLedger />}

        {totalSpent > 0 && (
          <details className="group rounded-[14px] border border-[var(--amora-line)] bg-white px-[18px] py-3.5 sm:px-[26px] sm:py-4">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-[var(--amora-ink)] marker:content-none [&::-webkit-details-marker]:hidden">
              <Users className="h-4 w-4 shrink-0" />
              <span>분담 현황</span>
              <span className="ml-auto text-[12px] font-normal text-[var(--amora-muted)]">기록 지출 {formatWon(totalSpent)}</span>
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-4 border-t border-[var(--amora-line)] pt-4">
            {/* 양측을 먼저 보여주고 네 칸으로 편다. 네 칸만 있으면 "우리 쪽이 얼마"를
                눈으로 더해야 나오는데, 그게 이 화면에서 제일 자주 묻는 질문이다. */}
            <BudgetSideSplit
              brideSide={payerSides.brideSide}
              groomSide={payerSides.groomSide}
              shared={payerSides.shared}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {PAYER_OPTIONS.map((opt) => {
                const amount = payerSummary[opt.value] ?? 0;
                const pct = totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0;
                return (
                  <div
                    key={opt.value}
                    className={`rounded-lg border border-[var(--hb-hairline)]/70 p-3.5 transition-colors ${
                      amount > 0 ? "bg-[var(--hb-surface-page)]" : "bg-[#f7f3ec]/55"
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-[var(--hb-text-strong)]" aria-hidden="true" />
                      <span className="text-[13px] font-medium text-[var(--hb-text-body)]">{opt.label}</span>
                    </div>
                    {/* 실제 카드 폭에 맞춰 열 수를 줄여 원 단위 금액을 한 줄로 보존한다. */}
                    <p className={`planning-display whitespace-nowrap text-[16px] font-medium leading-none ${
                      amount > 0 ? "text-[var(--hb-text-strong)]" : "text-[var(--hb-text-muted)]"
                    }`}>
                      {formatWon(amount)}
                    </p>
                    {amount > 0 && (
                      <div className="mt-3">
                        <BudgetProgress value={pct} />
                        <p className="text-xs text-[var(--amora-muted)] mt-1.5">{formatLoungeBudgetRatio(amount, totalSpent)}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </div>
          </details>
        )}

        <Link {...weddingLinkProps("/price")} className="group flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[14px] bg-[var(--amora-warm)] px-4 py-3.5 sm:px-5 sm:py-4">
          <span className="hidden h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border border-[var(--amora-line)] bg-white text-[var(--amora-accent)] sm:flex"><TrendingUp className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0 flex-1 basis-[220px]">
            <p className="text-[12.5px] font-semibold text-[var(--amora-ink)] sm:text-[13.5px]">공시가와 내 예산 확인</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--amora-muted)] sm:text-[11.5px]">운영자가 검수·발행한 업체 가격 · 기준일과 구성 범위 확인</p>
          </div>
          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--amora-ink)] group-hover:underline sm:text-[12.5px]">자세히 보기 <ArrowRight className="h-3.5 w-3.5" /></span>
        </Link>

        <div ref={categorySection} className="space-y-3.5 sm:space-y-5">
        {/* 소계는 기본 세 항목만 포함하며, 별도로 만든 항목과 합치지 않는다. */}
        {shownPhotoAttireMakeupKeys.length > 0 && (
        <section className="rounded-2xl border border-[var(--amora-line)] bg-white px-[18px] py-[18px] sm:rounded-[18px] sm:px-[26px] sm:py-6">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mb-4">
            <div className="hidden shrink-0 -space-x-2 sm:flex">
              {[Camera, Shirt, Palette].map((Icon, index) => <span key={index} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border-2 border-white bg-[var(--amora-rose-pale)] text-[var(--amora-rose-deep)]"><Icon className="h-[15px] w-[15px]" /></span>)}
            </div>
            <div className="min-w-0 flex-1 basis-[240px]">
              <h3 className="text-[13px] font-semibold text-[var(--amora-ink)] sm:text-[14.5px]">묶음 예산 · 사진·드레스·메이크업</h3>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--amora-muted)] sm:text-[11.5px]">포함 항목: {shownPhotoAttireMakeupKeys.map((key) => BUDGET_CATEGORIES.find((cat) => cat.key === key)!.label).join(" · ")}</p>
              {customCategories.length > 0 && <p className="mt-0.5 text-[10.5px] text-[var(--amora-muted)]">별도로 만든 항목은 이 소계에 포함되지 않아요.</p>}
            </div>
            <div className="text-[12px] font-semibold text-[var(--amora-soft)] sm:text-right sm:text-base">
              <p>{formatWonFull(photoAttireMakeupSpent)} / {photoAttireMakeupBudget > 0 ? formatWonFull(photoAttireMakeupBudget) : "예산 입력 전"}</p>
              {photoAttireMakeupBudget > 0 && <p className="mt-0.5 text-[11px] font-normal text-[var(--amora-muted)]">{formatLoungeBudgetRatio(photoAttireMakeupSpent, photoAttireMakeupBudget)} 기록</p>}
            </div>
          </div>
          <div>
            {shownPhotoAttireMakeupKeys.map((key) => {
              const cat = BUDGET_CATEGORIES.find((category) => category.key === key)!;
              return (
                <BudgetRow
                  key={key}
                  catKey={key}
                  label={cat.label}
                  icon={cat.icon}
                  budget={getCategoryBudget(key)}
                  spent={getCategorySpent(key)}
                  status={getStatus(key)}
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
        </section>
        )}

        <section className="rounded-2xl border border-[var(--amora-line)] bg-white px-[18px] py-[18px] sm:rounded-[18px] sm:px-[26px] sm:py-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4">
            <div>
              <h3 className="text-[14px] font-semibold text-[var(--amora-ink)] sm:text-[15px]">{shownPhotoAttireMakeupKeys.length > 0 ? "기타 카테고리" : "예산 항목"}</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--amora-muted)]">입력한 금액이나 준비 기록이 있는 항목부터 보여드려요.</p>
            </div>
            <span className="flex items-center gap-1 text-[11px] text-[var(--amora-muted)]"><Pencil className="h-3 w-3" />클릭하여 수정</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-3.5">
          {OTHER_KEYS.filter((key) => shownFixedKeys.includes(key)).map((key) => {
            const cat = BUDGET_CATEGORIES.find((category) => category.key === key)!;
            return (
              <BudgetCard
                key={key}
                catKey={key}
                label={cat.label}
                icon={cat.icon}
                budget={getCategoryBudget(key)}
                spent={getCategorySpent(key)}
                status={getStatus(key)}
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
              status={getStatus(cat.key)}
              payer={getCategoryPayer(cat.key)}
              totalBudget={totalBudget}
              onBudgetChange={handleBudgetChange}
              onSpentChange={handleSpentChange}
              onSpentReset={handleSpentReset}
              onPayerChange={handlePayerChange}
              onDelete={(k) => setDeletingKey(k)}
            />
          ))}

          <button type="button" onClick={() => setShowAddModal(true)} className="flex min-h-12 items-center justify-center gap-2 border-t border-dashed border-[var(--amora-line)] py-3.5 text-[12.5px] font-semibold text-[var(--amora-muted)] transition-colors hover:bg-[var(--amora-warm)] hover:text-[var(--amora-ink)] sm:min-h-24 sm:rounded-[14px] sm:border">
            <Plus className="h-3.5 w-3.5" />새 항목 추가
          </button>
          </div>
        </section>

        {unusedCategories.length > 0 && (
          <details className="rounded-[14px] border border-[var(--amora-line)] bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-rose-deep)]">
              아직 입력하지 않은 기본 항목 {unusedCategories.length}개 보기
            </summary>
            <div className="px-5 pb-5">
              <p className="mb-3 text-sm text-[var(--hb-text-body)]">필요한 항목을 선택하면 위에서 예산을 입력할 수 있어요.</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {unusedCategories.map((cat) => (
                  <Button
                    key={cat.key}
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      categoryToFocus.current = cat.key;
                      setOpenedCategories((current) => new Set([...current, cat.key]));
                    }}
                    className="w-full min-w-0 rounded-lg border-[var(--amora-line)] py-2 text-[12px]"
                    aria-label={`${cat.label} 예산 입력하기`}
                  >
                    <span className="flex-1 text-left whitespace-normal">{cat.label}</span>
                    {getStatus(cat.key) === "not_applicable" && <span className="shrink-0 text-[11px] text-[var(--amora-muted)]">{PREPARATION_PROGRESS_STATUS_LABELS.not_applicable}</span>}
                    <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </Button>
                ))}
              </div>
            </div>
          </details>
        )}
        </div>

        <section className="rounded-2xl border border-[var(--amora-line)] bg-white px-[18px] py-[18px] sm:rounded-[18px] sm:px-[26px] sm:py-6">
          <h3 className="text-[14px] font-semibold text-[var(--amora-ink)] sm:text-[15px]">견적·계약 전에 확인 <span className="hidden sm:inline">· 포함·별도 항목 체크</span></h3>
          <p className="mb-4 mt-1 text-[11.5px] leading-relaxed text-[var(--amora-muted)] sm:text-xs">아래 항목이 견적에 포함되는지, 별도라면 얼마인지 업체에 물어보고 서면으로 받아두세요.</p>
          <div>
            <BudgetVerificationRows categoryKeys={shownVerificationKeys} />
            {otherVerificationKeys.length > 0 && (
              <details className="border-t border-[var(--amora-line)]">
                <summary className="cursor-pointer py-3 text-[11.5px] font-semibold text-[var(--amora-soft)]">다른 항목의 포함 범위 보기 ({otherVerificationKeys.length})</summary>
                <BudgetVerificationRows categoryKeys={otherVerificationKeys} />
              </details>
            )}
          </div>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[15px] bg-[var(--amora-ink)] px-[19px] py-[18px] text-white sm:rounded-2xl sm:px-7 sm:py-[26px]">
          <div className="min-w-0 flex-1 basis-[280px]">
            <p className="mb-1.5 text-[9.5px] tracking-[0.02em] text-[var(--color-gold)] sm:mb-2 sm:text-[10.5px]">AI 예산 분석</p>
            <h3 className="planning-display mb-1.5 text-base text-white sm:mb-2 sm:text-[19px]">어디를 먼저 확인할까요?</h3>
            <p className="max-w-[480px] text-[11.5px] leading-relaxed text-[var(--color-paper-on-ink-soft)] sm:text-[12.5px]">직접 입력한 예산·기록 지출과 확인이 필요한 포함 항목을 함께 정리해드려요.</p>
          </div>
          <Link {...weddingLinkProps("/chat")} className={`${AMORA_ACTION_CLASS} whitespace-nowrap`}><AmoraMark className="size-5 shrink-0" />아모라에게 물어보기</Link>
        </section>

        <p className="px-0.5 text-[10.5px] leading-relaxed text-[var(--amora-muted)] sm:text-[11px]">
          직접 입력하거나 계약 금액으로 확인된 예산만 합산합니다.
        </p>

        {/* 새 항목 추가 모달 */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-[#1b1c1c]/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
            <div role="dialog" aria-modal="true" aria-label="새 항목 추가" className="relative max-h-[90dvh] overflow-y-auto bg-white rounded-2xl w-[90%] max-w-[420px] p-8 shadow-[var(--shadow-raised)]">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-[18px] font-semibold text-[var(--amora-ink)]">새 항목 추가</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  aria-label="새 항목 추가 닫기"
                  className="tap-area shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--amora-muted)] hover:bg-[var(--hb-surface-hover)] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="budget-new-category-name" className="text-[11px] text-[var(--amora-muted)] mb-1.5 block">카테고리 이름 <span className="text-[var(--amora-rose-deep)]">*</span></label>
                  {/* 60자는 아모라(add_custom_category)가 거절하는 경계와 같다.
                      화면만 더 길게 받으면 아모라가 이름을 잘라 부르고, 그 잘린
                      이름으로 고치면 같은 항목이 하나 더 생긴다. */}
                  <input
                    id="budget-new-category-name"
                    autoFocus
                    type="text"
                    required
                    maxLength={60}
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newCatLabel.trim()) {
                        void handleAddCategory().catch(() => undefined);
                      }
                    }}
                    placeholder="예: 웨딩카, 답례떡"
                    className="w-full px-4 py-2.5 rounded-lg bg-[var(--hb-surface-hover)] text-[14px] text-[var(--hb-text-strong)] placeholder:text-[var(--amora-muted)] focus:outline-none focus:bg-white focus:ring-2 ring-[#a77b744d] transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="budget-new-category-allocation" className="text-[11px] text-[var(--amora-muted)] mb-1.5 block">예산 (만원)</label>
                    <input
                      id="budget-new-category-allocation"
                      type="number"
                      value={newCatBudget}
                      onChange={(e) => setNewCatBudget(e.target.value)}
                      placeholder="0"
                      className="w-full px-4 py-2.5 rounded-lg bg-[var(--hb-surface-hover)] text-[14px] text-[var(--hb-text-strong)] placeholder:text-[var(--amora-muted)] focus:outline-none focus:bg-white focus:ring-2 ring-[#a77b744d] transition-all"
                    />
                  </div>
                  <div>
                    <label htmlFor="budget-new-category-spent" className="text-[11px] text-[var(--amora-muted)] mb-1.5 block">기록 지출 (만원 · 결제 확인과 별도)</label>
                    <input
                      id="budget-new-category-spent"
                      type="number"
                      value={newCatSpent}
                      onChange={(e) => setNewCatSpent(e.target.value)}
                      placeholder="0"
                      className="w-full px-4 py-2.5 rounded-lg bg-[var(--hb-surface-hover)] text-[14px] text-[var(--hb-text-strong)] placeholder:text-[var(--amora-muted)] focus:outline-none focus:bg-white focus:ring-2 ring-[#a77b744d] transition-all"
                    />
                  </div>
                </div>
              </div>

              {journeyError && <p role="alert" className="mt-4 text-[12px] leading-relaxed text-danger-700">{journeyError}</p>}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 rounded-lg bg-[var(--hb-surface-hover)] text-[13px] text-[var(--hb-text-body)] hover:bg-[#EFEBEA] transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={() => void handleAddCategory().catch(() => undefined)}
                  disabled={!newCatLabel.trim()}
                  className="flex-1 py-2.5 rounded-lg bg-[var(--amora-action)] text-white text-[13px] font-medium disabled:opacity-40 hover:bg-[var(--amora-action-hover)] transition-colors"
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
              <div role="dialog" aria-modal="true" aria-label="예산 항목 관리" className="relative max-h-[90dvh] overflow-y-auto bg-white rounded-2xl w-[90%] max-w-[380px] p-6 shadow-[var(--shadow-raised)]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-danger-700" />
                  </div>
                  <div>
                    <h3 className="text-[18px] font-semibold text-[var(--amora-ink)]">
                      {isFixed ? "항목 관리" : "항목 삭제"}
                    </h3>
                    <p className="text-[12px] text-[var(--amora-muted)] mt-0.5">
                      <span className="font-medium text-[var(--hb-text-body)]">{catLabel}</span>
                      {isFixed
                        ? " — 데이터만 초기화하거나 목록에서 삭제할 수 있습니다."
                        : " 항목이 완전히 삭제됩니다."}
                    </p>
                  </div>
                </div>

                {journeyError && <p role="alert" className="mt-4 text-[12px] leading-relaxed text-danger-700">{journeyError}</p>}
                <div className={`flex gap-3 mt-5 ${isFixed ? "flex-col" : ""}`}>
                  {isFixed ? (
                    <>
                      <div className="flex gap-3">
                        <button
                          onClick={() => {
                            void handleResetCategory(deletingKey).catch(() => undefined);
                          }}
                          className="flex-1 py-2.5 rounded-lg bg-[var(--hb-surface-hover)] text-[13px] text-[var(--amora-rose-deep)] font-medium bg-[#f3e9df] transition-colors"
                        >
                          데이터 초기화
                        </button>
                        <button
                          onClick={() => {
                            void handleDeleteCategory(deletingKey).catch(() => undefined);
                          }}
                          className="flex-1 py-2.5 rounded-lg bg-danger-700 text-white text-[13px] font-medium hover:bg-danger-700/90 transition-colors"
                        >
                          항목 삭제
                        </button>
                      </div>
                      <button
                        onClick={() => setDeletingKey(null)}
                        className="py-2.5 rounded-lg bg-[var(--hb-surface-hover)] text-[13px] text-[var(--hb-text-body)] hover:bg-[#EFEBEA] transition-colors"
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setDeletingKey(null)}
                        className="flex-1 py-2.5 rounded-lg bg-[var(--hb-surface-hover)] text-[13px] text-[var(--hb-text-body)] hover:bg-[#EFEBEA] transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => {
                          void handleDeleteCategory(deletingKey).catch(() => undefined);
                        }}
                        className="flex-1 py-2.5 rounded-lg bg-danger-700 text-white text-[13px] font-medium hover:bg-danger-700/90 transition-colors"
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
