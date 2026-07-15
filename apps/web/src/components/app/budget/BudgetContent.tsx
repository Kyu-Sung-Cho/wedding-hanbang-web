"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  Camera,
  Check,
  CircleDollarSign,
  FileCheck2,
  Flower2,
  Gem,
  Gift,
  Home,
  Key,
  Mail,
  Palette,
  Pencil,
  Plane,
  Plus,
  ReceiptText,
  Shirt,
  Tag,
  Trash2,
  Users,
  Video,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { normalizeOptionalBudgetWon, storedMoneyToWon } from "@hanbang/shared";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";
import { weddingLinkProps } from "@/lib/weddingPaths";
import {
  mutateBudgetCategory,
  type BudgetCategoryMutation,
} from "@/lib/budget/budgetCategoryClient";

interface FinancialProgressItem extends Omit<Partial<ProgressItem>, "payer"> {
  category?: string;
  label?: string;
  budget?: number;
  contractedTotal?: number;
  paidToDate?: number;
  nextPaymentAmount?: number;
  nextPaymentDate?: string;
  spent?: number;
  cost?: number;
  payer?: string;
}

interface BudgetCategoryDefinition {
  key: string;
  label: string;
  icon: LucideIcon;
}

interface CategoryEditorState {
  key: string;
  label: string;
  custom: boolean;
  budget: string;
  contractedTotal: string;
  paidToDate: string;
  nextPaymentAmount: string;
  nextPaymentDate: string;
}

const BUDGET_CATEGORIES: BudgetCategoryDefinition[] = [
  { key: "meeting", label: "상견례", icon: Users },
  { key: "venue", label: "예식장", icon: Building2 },
  { key: "studio", label: "스튜디오", icon: Camera },
  { key: "dress", label: "드레스/턱시도", icon: Shirt },
  { key: "makeup", label: "메이크업", icon: Palette },
  { key: "snap", label: "본식 스냅/영상", icon: Video },
  { key: "ring", label: "예물", icon: Gem },
  { key: "hanbok", label: "한복", icon: Flower2 },
  { key: "honeymoon", label: "신혼여행", icon: Plane },
  { key: "houseware", label: "혼수", icon: Home },
  { key: "housing", label: "신혼집", icon: Key },
  { key: "invitation", label: "청첩장", icon: Mail },
  { key: "gift", label: "답례품", icon: Gift },
  { key: "reserve", label: "예비비", icon: Wallet },
];

const CONTRACT_SCOPE_QUESTIONS: Record<string, string> = {
  venue: "식대 단위, 최소보증인원, 대관료, 꽃장식과 진행 서비스의 포함 여부",
  studio: "원본 데이터, 보정본 수량, 앨범 페이지와 추가 촬영 조건",
  dress: "피팅, 헬퍼, 수선, 소품, 반납 조건의 포함 여부",
  makeup: "촬영·본식·리허설, 출장, 혼주 항목의 선택 여부와 포함 범위",
  snap: "촬영 시간, 원본·편집본, 앨범·액자, 납품 기한",
  honeymoon: "취소·변경, 보험, 수하물, 현지 이동과 선택 활동의 포함 여부",
};

function formatWon(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "미입력";
  if (value === 0) return "0원";
  return `${(value / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 4 })}만원`;
}

function wonToManwonInput(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value / 10_000) : "";
}

function parseOptionalManwon(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const manwon = Number(trimmed.replaceAll(",", ""));
  const won = Math.round(manwon * 10_000);
  if (
    !Number.isFinite(manwon) ||
    manwon < 0 ||
    !Number.isSafeInteger(won) ||
    won > 10_000_000_000
  ) {
    return undefined;
  }
  return won;
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function hasOwn(record: FinancialProgressItem | undefined, field: keyof FinancialProgressItem): boolean {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, field));
}

function legacyUnclassifiedAmount(record: FinancialProgressItem | undefined): number | null {
  if (!record) return null;
  if (typeof record.spent === "number" && Number.isFinite(record.spent) && record.spent >= 0) {
    return record.spent;
  }
  const legacyCost = storedMoneyToWon(record.cost);
  return legacyCost > 0 ? legacyCost : null;
}

function hasFinancialRecord(record: FinancialProgressItem | undefined): boolean {
  if (!record) return false;
  return [
    "budget",
    "contractedTotal",
    "paidToDate",
    "nextPaymentAmount",
    "nextPaymentDate",
    "spent",
    "cost",
    "payer",
  ].some((field) => Object.prototype.hasOwnProperty.call(record, field));
}

function sumField(records: FinancialProgressItem[], field: keyof FinancialProgressItem): number {
  return records.reduce((sum, record) => {
    const value = record[field];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? sum + value : sum;
  }, 0);
}

function SummaryCard({
  eyebrow,
  label,
  value,
  helper,
  icon: Icon,
}: {
  eyebrow: string;
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-2xl border border-[#eadfc9] bg-white p-5 shadow-[0_8px_24px_rgba(8,22,38,0.035)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">{eyebrow}</p>
        <Icon className="h-5 w-5 text-[#36534E]/45" />
      </div>
      <p className="mt-4 break-words font-serif-kr text-[28px] font-medium leading-none text-[#071629] sm:text-[32px]">
        {value}
      </p>
      <p className="mt-3 text-[13px] font-medium text-[#5d6879]">{label}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[#8c847d]">{helper}</p>
    </div>
  );
}

function FinancialRecordCard({
  definition,
  record,
  onEdit,
  onClearLegacy,
}: {
  definition: BudgetCategoryDefinition;
  record: FinancialProgressItem;
  onEdit: () => void;
  onClearLegacy: () => Promise<void>;
}) {
  const Icon = definition.icon;
  const legacyAmount = legacyUnclassifiedAmount(record);
  const hasLegacy = legacyAmount !== null || hasOwn(record, "payer");
  const hasContract = hasOwn(record, "contractedTotal");
  const hasPaid = hasOwn(record, "paidToDate");
  const outstanding = hasContract && hasPaid &&
    typeof record.contractedTotal === "number" && typeof record.paidToDate === "number"
    ? record.contractedTotal - record.paidToDate
    : null;
  const scopeQuestion = CONTRACT_SCOPE_QUESTIONS[definition.key];

  return (
    <article className="rounded-2xl border border-[#eadfc9] bg-white p-5 shadow-[0_8px_24px_rgba(8,22,38,0.035)] sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f3ece5]">
          <Icon className="h-5 w-5 text-[#795252]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif-kr text-[19px] font-medium text-[#1b1c1c]">{definition.label}</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[#8c847d]">사용자가 직접 입력한 기록 · 계약 증빙이나 검증 결과가 아님</p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-[#36534E] hover:bg-[#eef2ef]"
        >
          <Pencil className="h-3.5 w-3.5" />
          편집
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-[#fbf8f2] p-3.5">
          <dt className="text-[11px] font-medium text-[#7a716a]">내 계획 예산</dt>
          <dd className="mt-1.5 font-serif-kr text-[20px] font-medium text-[#1b1c1c]">{formatWon(record.budget)}</dd>
        </div>
        <div className="rounded-xl bg-[#f5f1ec] p-3.5">
          <dt className="text-[11px] font-medium text-[#7a716a]">서명한 계약 총액</dt>
          <dd className="mt-1.5 font-serif-kr text-[20px] font-medium text-[#1b1c1c]">{formatWon(record.contractedTotal)}</dd>
        </div>
        <div className="rounded-xl bg-[#eef2ef] p-3.5">
          <dt className="text-[11px] font-medium text-[#5f6f67]">실제 누적 납부액</dt>
          <dd className="mt-1.5 font-serif-kr text-[20px] font-medium text-[#243832]">{formatWon(record.paidToDate)}</dd>
        </div>
      </dl>

      {(record.nextPaymentDate || hasOwn(record, "nextPaymentAmount") || outstanding !== null) && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-xl border border-[#eadfc9] bg-white px-3.5 py-3 text-xs text-[#5d6879]">
          {outstanding !== null && <span>계약 기록상 미납액 {formatWon(outstanding)}</span>}
          {record.nextPaymentDate && <span>다음 납부일 {record.nextPaymentDate}</span>}
          {hasOwn(record, "nextPaymentAmount") && <span>다음 납부 예정액 {formatWon(record.nextPaymentAmount)}</span>}
        </div>
      )}

      {scopeQuestion && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#fff9ef] px-3.5 py-3 text-[11px] leading-relaxed text-[#715e45]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><strong>계약 원문에서 포함 여부 확인:</strong> {scopeQuestion}</span>
        </div>
      )}

      {hasLegacy && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3.5">
          <p className="text-xs font-semibold text-red-700">이전 버전의 미분류 금액·분담 기록</p>
          <p className="mt-1 text-[11px] leading-relaxed text-red-600">
            {legacyAmount !== null ? `${formatWon(legacyAmount)} · ` : ""}계약 총액인지 실제 납부액인지 구분할 수 없어 모든 합계에서 제외했습니다. 필요한 값은 편집에서 직접 다시 입력하세요.
          </p>
          <button
            type="button"
            onClick={() => void onClearLegacy()}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 underline underline-offset-2"
          >
            <Trash2 className="h-3 w-3" />
            이전 기록 지우기
          </button>
        </div>
      )}
    </article>
  );
}

interface BudgetContentProps {
  embedded?: boolean;
}

export default function BudgetContent({ embedded = false }: BudgetContentProps = {}) {
  const { journey, updateJourney, updateJourneyLocal, isDemo } = useAuthStore();
  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, FinancialProgressItem>,
    [journey?.progress],
  );
  const totalBudget = journey?.total_budget ?? 0;
  const [editor, setEditor] = useState<CategoryEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInput, setTotalInput] = useState("");

  const hiddenKeys = useMemo(() => {
    const hidden = (progress as Record<string, unknown>).__hidden;
    return new Set(Array.isArray(hidden) ? hidden.filter((key): key is string => typeof key === "string") : []);
  }, [progress]);

  const persistCategory = useCallback(async (mutation: BudgetCategoryMutation): Promise<boolean> => {
    setSaveError(null);
    if (isDemo) {
      const nextProgress = { ...progress } as Record<string, FinancialProgressItem> & { __hidden?: string[] };
      const current = { ...(nextProgress[mutation.categoryKey] ?? {}) } as FinancialProgressItem & Record<string, unknown>;
      for (const field of mutation.remove ?? []) delete current[field];
      Object.assign(current, mutation.set ?? {}, { category: mutation.categoryKey });
      if (mutation.set || mutation.remove) nextProgress[mutation.categoryKey] = current;
      if (mutation.visibility) {
        const hidden = new Set(nextProgress.__hidden ?? []);
        if (mutation.visibility === "hidden") hidden.add(mutation.categoryKey);
        else hidden.delete(mutation.categoryKey);
        if (hidden.size > 0) nextProgress.__hidden = [...hidden];
        else delete nextProgress.__hidden;
      }
      const saved = await updateJourney({ progress: nextProgress as never });
      if (!saved) setSaveError("저장하지 못했습니다. 입력값은 유지되며 합계에 반영되지 않았습니다.");
      return saved;
    }

    try {
      const result = await mutateBudgetCategory(mutation);
      updateJourneyLocal({ progress: result.progress as never });
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "예산 기록을 저장하지 못했습니다.");
      return false;
    }
  }, [isDemo, progress, updateJourney, updateJourneyLocal]);

  const activeCategories = useMemo(() => {
    const fixed = BUDGET_CATEGORIES
      .filter((definition) => !hiddenKeys.has(definition.key) && hasFinancialRecord(progress[definition.key]))
      .map((definition) => ({ definition, record: progress[definition.key] ?? {} }));
    const custom = Object.entries(progress)
      .filter(([key, record]) =>
        key.startsWith("custom_") &&
        !hiddenKeys.has(key) &&
        (hasFinancialRecord(record) || typeof record?.label === "string"),
      )
      .map(([key, record]) => ({
        definition: { key, label: record.label?.trim() || "직접 추가한 항목", icon: Tag },
        record,
      }));
    return [...fixed, ...custom];
  }, [hiddenKeys, progress]);

  const activeRecords = activeCategories.map(({ record }) => record);
  const totalAllocated = sumField(activeRecords, "budget");
  const totalContracted = sumField(activeRecords, "contractedTotal");
  const totalPaid = sumField(activeRecords, "paidToDate");
  const legacyCount = activeRecords.filter((record) =>
    legacyUnclassifiedAmount(record) !== null || hasOwn(record, "payer"),
  ).length;
  const availableCategories = BUDGET_CATEGORIES.filter((definition) =>
    !activeCategories.some(({ definition: active }) => active.key === definition.key),
  );

  const openEditor = useCallback((definition: BudgetCategoryDefinition, custom = false) => {
    const record = progress[definition.key] ?? {};
    setSaveError(null);
    setEditor({
      key: definition.key,
      label: definition.label,
      custom,
      budget: wonToManwonInput(record.budget),
      contractedTotal: wonToManwonInput(record.contractedTotal),
      paidToDate: wonToManwonInput(record.paidToDate),
      nextPaymentAmount: wonToManwonInput(record.nextPaymentAmount),
      nextPaymentDate: record.nextPaymentDate ?? "",
    });
  }, [progress]);

  const startCustomEditor = () => {
    setEditor({
      key: `custom_${crypto.randomUUID().replaceAll("-", "")}`,
      label: "",
      custom: true,
      budget: "",
      contractedTotal: "",
      paidToDate: "",
      nextPaymentAmount: "",
      nextPaymentDate: "",
    });
  };

  const saveEditor = async () => {
    if (!editor) return;
    const label = editor.label.trim();
    if (editor.custom && (label.length < 1 || label.length > 60)) {
      setSaveError("직접 추가한 항목 이름은 1~60자로 입력해 주세요.");
      return;
    }

    const parsed = {
      budget: parseOptionalManwon(editor.budget),
      contractedTotal: parseOptionalManwon(editor.contractedTotal),
      paidToDate: parseOptionalManwon(editor.paidToDate),
      nextPaymentAmount: parseOptionalManwon(editor.nextPaymentAmount),
    };
    if (Object.values(parsed).some((value) => value === undefined)) {
      setSaveError("금액은 0원 이상 100억원 이하로 만원 단위에 입력해 주세요.");
      return;
    }
    const validated = parsed as Record<keyof typeof parsed, number | null>;
    if (validated.paidToDate !== null && validated.contractedTotal === null) {
      setSaveError("누적 납부액을 기록하려면 서명한 계약 총액을 함께 입력해 주세요.");
      return;
    }
    if (
      validated.paidToDate !== null &&
      validated.contractedTotal !== null &&
      validated.paidToDate > validated.contractedTotal
    ) {
      setSaveError("누적 납부액은 서명한 계약 총액보다 클 수 없습니다. 입력 단위와 금액을 확인해 주세요.");
      return;
    }
    if (editor.nextPaymentDate && !isValidDateOnly(editor.nextPaymentDate)) {
      setSaveError("다음 납부일을 올바른 날짜로 입력해 주세요.");
      return;
    }
    if ((validated.nextPaymentAmount !== null || editor.nextPaymentDate) && validated.contractedTotal === null) {
      setSaveError("다음 납부 기록을 추가하려면 서명한 계약 총액을 함께 입력해 주세요.");
      return;
    }

    const existing = progress[editor.key];
    const setFields: Record<string, number | string> = {};
    const removeFields: string[] = [];
    for (const field of ["budget", "contractedTotal", "paidToDate", "nextPaymentAmount"] as const) {
      const value = validated[field];
      if (value === null) {
        if (hasOwn(existing, field)) removeFields.push(field);
      } else {
        setFields[field] = value;
      }
    }
    if (editor.nextPaymentDate) setFields.nextPaymentDate = editor.nextPaymentDate;
    else if (hasOwn(existing, "nextPaymentDate")) removeFields.push("nextPaymentDate");
    if (editor.custom) setFields.label = label;

    if (Object.keys(setFields).length === 0 && removeFields.length === 0) {
      setSaveError("기록할 값을 하나 이상 입력해 주세요. 선택 전에는 예산 기록으로 계산하지 않습니다.");
      return;
    }

    setSaving(true);
    const saved = await persistCategory({
      categoryKey: editor.key,
      set: Object.keys(setFields).length > 0
        ? setFields as NonNullable<BudgetCategoryMutation["set"]>
        : undefined,
      remove: removeFields.length > 0
        ? removeFields as NonNullable<BudgetCategoryMutation["remove"]>
        : undefined,
      visibility: "visible",
    });
    setSaving(false);
    if (saved) setEditor(null);
  };

  const clearLegacy = async (key: string) => {
    await persistCategory({ categoryKey: key, remove: ["spent", "cost", "payer"] });
  };

  const clearCategory = async () => {
    if (!editor) return;
    setSaving(true);
    const removeFields = [
      "budget",
      "contractedTotal",
      "paidToDate",
      "nextPaymentAmount",
      "nextPaymentDate",
      "spent",
      "cost",
      "payer",
      ...(editor.custom ? ["label"] : []),
    ];
    const saved = await persistCategory({
      categoryKey: editor.key,
      remove: removeFields as NonNullable<BudgetCategoryMutation["remove"]>,
      ...(editor.custom ? { visibility: "hidden" as const } : {}),
    });
    setSaving(false);
    if (saved) setEditor(null);
  };

  const saveTotalBudget = async () => {
    const parsed = parseOptionalManwon(totalInput);
    if (parsed === undefined) {
      setSaveError("총 계획 예산은 0원 이상 100억원 이하로 입력해 주세요.");
      return;
    }
    const value = normalizeOptionalBudgetWon(parsed ?? 0);
    const saved = await updateJourney({ total_budget: value });
    if (!saved) {
      setSaveError("총 계획 예산을 저장하지 못했습니다.");
      return;
    }
    setEditingTotal(false);
  };

  return (
    <div className={embedded ? "bg-[#fcf9f8]" : ""}>
      <div className={embedded ? "mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8" : "space-y-5"}>
        <section className="rounded-2xl border border-[#eadfc9] bg-[#fbf8f2] p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-[#36534E]" />
            <div>
              <h2 className="font-serif-kr text-[21px] font-medium text-[#243832]">계획·계약·납부를 섞지 않는 금액 기록</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-[#5d6879]">
                견적을 평가하거나 계약을 중개하지 않습니다. 업체가 준 원문을 직접 확인하고 서명한 뒤, 사용자가 확정한 금액과 실제 납부액만 구분해 기록합니다.
              </p>
            </div>
          </div>
        </section>

        {saveError && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{saveError}</span>
            <button type="button" onClick={() => setSaveError(null)} aria-label="오류 닫기"><X className="h-4 w-4" /></button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-[#eadfc9] bg-white p-5 shadow-[0_8px_24px_rgba(8,22,38,0.035)]">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">TOTAL PLAN</p>
              <button
                type="button"
                onClick={() => {
                  setTotalInput(wonToManwonInput(totalBudget));
                  setEditingTotal(true);
                }}
                className="rounded p-1 text-[#36534E] hover:bg-[#eef2ef]"
                aria-label="총 계획 예산 편집"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
            {editingTotal ? (
              <div className="mt-4 flex items-center gap-2">
                <input
                  value={totalInput}
                  onChange={(event) => setTotalInput(event.target.value)}
                  inputMode="decimal"
                  placeholder="미정"
                  className="min-w-0 flex-1 rounded-xl border border-[#d8cdbd] px-3 py-2 text-sm outline-none focus:border-[#36534E]"
                />
                <span className="text-xs text-[#7a716a]">만원</span>
                <button type="button" onClick={() => void saveTotalBudget()} className="rounded-lg bg-[#36534E] p-2 text-white"><Check className="h-4 w-4" /></button>
              </div>
            ) : (
              <p className="mt-4 font-serif-kr text-[28px] font-medium leading-none text-[#071629] sm:text-[32px]">{formatWon(totalBudget || undefined)}</p>
            )}
            <p className="mt-3 text-[13px] font-medium text-[#5d6879]">커플이 직접 정한 전체 계획 예산</p>
            <p className="mt-1 text-[11px] text-[#8c847d]">계약·납부 합계와 자동 비교하지 않습니다.</p>
          </div>
          <SummaryCard eyebrow="ITEM PLANS" label="선택한 항목의 계획 예산 합계" value={formatWon(totalAllocated)} helper="선택하지 않은 템플릿은 포함하지 않음" icon={Wallet} />
          <SummaryCard eyebrow="SIGNED TOTAL" label="서명한 계약 총액 기록" value={formatWon(totalContracted)} helper="사용자 입력값 · 계약 검증 아님" icon={ReceiptText} />
          <SummaryCard eyebrow="PAID TO DATE" label="실제 누적 납부액 기록" value={formatWon(totalPaid)} helper="계약 총액과 구분해 입력한 값만 합산" icon={CircleDollarSign} />
        </div>

        {legacyCount > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-700">
            이전 버전의 `지출·분담` 기록 {legacyCount}건은 의미를 확인할 수 없어 합계에서 제외했습니다. 각 카드에서 직접 재입력하거나 이전 기록을 지울 수 있습니다.
          </div>
        )}

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">MY FINANCIAL RECORDS</p>
              <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">내가 시작한 금액 기록</h2>
              <p className="mt-1 text-xs text-[#7a716a]">체크리스트 진행 상태와 금융·계약 상태는 서로 연결하지 않습니다.</p>
            </div>
          </div>

          {activeCategories.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#d8cdbd] bg-white px-5 py-10 text-center">
              <ReceiptText className="mx-auto h-8 w-8 text-[#a69b91]" />
              <p className="mt-3 font-serif-kr text-lg text-[#243832]">아직 시작한 금액 기록이 없습니다</p>
              <p className="mt-1 text-xs leading-relaxed text-[#7a716a]">필요한 항목만 아래에서 선택하세요. 선택 전에는 예산 기록으로 계산하지 않습니다.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {activeCategories.map(({ definition, record }) => (
                <FinancialRecordCard
                  key={definition.key}
                  definition={definition}
                  record={record}
                  onEdit={() => openEditor(definition, definition.key.startsWith("custom_"))}
                  onClearLegacy={() => clearLegacy(definition.key)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#eadfc9] bg-white p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <Plus className="mt-0.5 h-5 w-5 shrink-0 text-[#36534E]" />
            <div>
              <h2 className="font-serif-kr text-[21px] font-medium text-[#243832]">필요한 항목 추가</h2>
              <p className="mt-1 text-xs leading-relaxed text-[#7a716a]">아래 항목은 선택 라이브러리입니다. 모두 해야 하는 절차나 권장 예산이 아닙니다.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {availableCategories.map((definition) => {
              const Icon = definition.icon;
              return (
                <button
                  key={definition.key}
                  type="button"
                  onClick={() => openEditor(definition)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#d8cdbd] bg-[#fbf8f2] px-3 py-2 text-xs font-medium text-[#36534E] hover:border-[#36534E]"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {definition.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={startCustomEditor}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#795252] px-3 py-2 text-xs font-medium text-[#795252] hover:bg-[#795252]/5"
            >
              <Tag className="h-3.5 w-3.5" />
              직접 추가
            </button>
          </div>
        </section>

        <Link
          {...weddingLinkProps("/market-prices")}
          className="group flex items-center gap-4 rounded-2xl border border-[#eadfc9] bg-white p-5 hover:shadow-[0_8px_24px_rgba(8,22,38,0.05)]"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eef2ef]">
            <FileCheck2 className="h-5 w-5 text-[#36534E]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-serif-kr text-[18px] font-medium text-[#243832]">공식 조사 자료의 범위 확인</p>
            <p className="mt-1 text-xs leading-relaxed text-[#7a716a]">공개 통계는 개인 견적이나 계약의 적정성을 판정하지 않습니다.</p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-[#36534E] transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && setEditor(null)} aria-label="편집 닫기" />
          <div className="relative max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">MANUAL RECORD</p>
                <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">금액 기록 편집</h2>
              </div>
              <button type="button" onClick={() => setEditor(null)} disabled={saving} className="rounded-lg p-2 text-[#7a716a] hover:bg-[#f5f1ec]"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-5 space-y-4">
              {editor.custom ? (
                <label className="block">
                  <span className="text-xs font-medium text-[#504a46]">항목 이름</span>
                  <input value={editor.label} onChange={(event) => setEditor({ ...editor, label: event.target.value })} maxLength={60} className="mt-1.5 w-full rounded-xl border border-[#d8cdbd] px-3.5 py-3 text-sm outline-none focus:border-[#36534E]" />
                </label>
              ) : (
                <div className="rounded-xl bg-[#fbf8f2] px-4 py-3 text-sm font-medium text-[#243832]">{editor.label}</div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-[#504a46]">내 계획 예산</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-[#8c847d]">계약 전 스스로 정한 상한·목표</span>
                  <div className="mt-1.5 flex items-center gap-2"><input value={editor.budget} onChange={(event) => setEditor({ ...editor, budget: event.target.value })} inputMode="decimal" placeholder="미입력" className="min-w-0 flex-1 rounded-xl border border-[#d8cdbd] px-3.5 py-3 text-sm outline-none focus:border-[#36534E]" /><span className="text-xs text-[#7a716a]">만원</span></div>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-[#504a46]">서명한 계약 총액</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-[#8c847d]">업체 원문을 확인하고 직접 서명한 뒤 입력</span>
                  <div className="mt-1.5 flex items-center gap-2"><input value={editor.contractedTotal} onChange={(event) => setEditor({ ...editor, contractedTotal: event.target.value })} inputMode="decimal" placeholder="미입력" className="min-w-0 flex-1 rounded-xl border border-[#d8cdbd] px-3.5 py-3 text-sm outline-none focus:border-[#36534E]" /><span className="text-xs text-[#7a716a]">만원</span></div>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-[#504a46]">실제 누적 납부액</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-[#8c847d]">계약금·중도금·잔금 중 실제 보낸 금액의 합</span>
                  <div className="mt-1.5 flex items-center gap-2"><input value={editor.paidToDate} onChange={(event) => setEditor({ ...editor, paidToDate: event.target.value })} inputMode="decimal" placeholder="미입력" className="min-w-0 flex-1 rounded-xl border border-[#d8cdbd] px-3.5 py-3 text-sm outline-none focus:border-[#36534E]" /><span className="text-xs text-[#7a716a]">만원</span></div>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-[#504a46]">다음 납부 예정액</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-[#8c847d]">계약 원문에 적힌 다음 금액만 입력</span>
                  <div className="mt-1.5 flex items-center gap-2"><input value={editor.nextPaymentAmount} onChange={(event) => setEditor({ ...editor, nextPaymentAmount: event.target.value })} inputMode="decimal" placeholder="미입력" className="min-w-0 flex-1 rounded-xl border border-[#d8cdbd] px-3.5 py-3 text-sm outline-none focus:border-[#36534E]" /><span className="text-xs text-[#7a716a]">만원</span></div>
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-[#504a46]">다음 납부일</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-[#8c847d]">서비스가 기한을 추정하지 않습니다. 계약 원문 날짜만 직접 입력하세요.</span>
                <div className="relative mt-1.5"><CalendarClock className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[#8c847d]" /><input type="date" value={editor.nextPaymentDate} onChange={(event) => setEditor({ ...editor, nextPaymentDate: event.target.value })} className="w-full rounded-xl border border-[#d8cdbd] py-3 pl-10 pr-3 text-sm outline-none focus:border-[#36534E]" /></div>
              </label>

              <div className="rounded-xl bg-[#eef2ef] px-3.5 py-3 text-[11px] leading-relaxed text-[#52635a]">
                웨딩한방은 계약서 원본·송금 내역을 검증하지 않습니다. 입력값은 커플의 정리용 기록이며 업체 견적, 계약 효력, 납부 증빙을 대신하지 않습니다.
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {hasFinancialRecord(progress[editor.key]) && (
                <button type="button" onClick={() => void clearCategory()} disabled={saving} className="mr-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />금액 기록 비우기</button>
              )}
              <button type="button" onClick={() => setEditor(null)} disabled={saving} className="rounded-xl bg-[#f5f1ec] px-4 py-2.5 text-sm text-[#5d6879] disabled:opacity-50">취소</button>
              <button type="button" onClick={() => void saveEditor()} disabled={saving} className="rounded-xl bg-[#36534E] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "저장 중…" : "직접 입력한 값 저장"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
