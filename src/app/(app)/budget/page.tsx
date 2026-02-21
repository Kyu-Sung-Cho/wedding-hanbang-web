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
  Camera,
  Shirt,
  Palette,
  Building2,
  Gem,
  Flower2,
  Plane,
  Home,
  Mail,
  Gift,
  Wallet,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

const ICON_MAP: Record<string, React.ElementType> = {
  Building2, Camera, Shirt, Palette, Gem,
  Flower2, Plane, Home, Mail, Gift, Wallet,
};

// 카테고리별 예산 비율 (기본값)
const CATEGORY_RATIOS: { key: string; label: string; icon: string; ratio: number }[] = [
  { key: "venue", label: "예식장", icon: "Building2", ratio: 0.23 },
  { key: "studio", label: "스튜디오", icon: "Camera", ratio: 0.13 },
  { key: "dress", label: "드레스", icon: "Shirt", ratio: 0.09 },
  { key: "makeup", label: "메이크업", icon: "Palette", ratio: 0.06 },
  { key: "ring", label: "예물", icon: "Gem", ratio: 0.14 },
  { key: "hanbok", label: "한복", icon: "Flower2", ratio: 0.04 },
  { key: "honeymoon", label: "신혼여행", icon: "Plane", ratio: 0.14 },
  { key: "houseware", label: "혼수", icon: "Home", ratio: 0.09 },
  { key: "invitation", label: "청첩장", icon: "Mail", ratio: 0.02 },
  { key: "gift", label: "답례품", icon: "Gift", ratio: 0.02 },
  { key: "reserve", label: "예비비", icon: "Wallet", ratio: 0.04 },
];

// 스드메 키
const SDM_KEYS = ["studio", "dress", "makeup"];
const OTHER_KEYS = CATEGORY_RATIOS.filter((c) => !SDM_KEYS.includes(c.key)).map((c) => c.key);

function formatWon(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만`;
  return n.toLocaleString();
}

function formatWonFull(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억원`;
  return `${Math.round(n / 10000).toLocaleString()}만원`;
}

// 인라인 금액 편집 컴포넌트
function InlineMoneyEdit({
  value,
  onSave,
  label,
}: {
  value: number;
  onSave: (v: number) => void;
  label: string;
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
        <button onClick={save} className="w-6 h-6 rounded flex items-center justify-center text-[#2E7D5A] hover:bg-[#2E7D5A]/10">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={cancel} className="w-6 h-6 rounded flex items-center justify-center text-taupe-400 hover:bg-taupe-400/10">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      className="flex items-center gap-1 group"
      title={`${label} 수정`}
    >
      <span className="text-[13px] font-medium text-noir-800">
        {formatWon(value)}
      </span>
      <Pencil className="w-3 h-3 text-taupe-400 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
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
  onBudgetChange,
  onSpentChange,
  delay,
}: {
  catKey: string;
  label: string;
  icon: string;
  budget: number;
  spent: number;
  status: string;
  onBudgetChange: (key: string, val: number) => void;
  onSpentChange: (key: string, val: number) => void;
  delay: number;
}) {
  const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const isOver = spent > budget;
  const Icon = ICON_MAP[icon] ?? Building2;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay }}
      className="flex items-center gap-4 px-5 py-4 hover:bg-ivory-50 transition-colors max-md:flex-wrap max-md:gap-2"
    >
      {/* 아이콘 + 이름 */}
      <div className="flex items-center gap-2.5 w-[110px] flex-shrink-0 max-md:w-full">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500/10 to-gold/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-rose-500" />
        </div>
        <span className="text-[13px] font-medium text-noir-800">{label}</span>
      </div>

      {/* 진행 바 */}
      <div className="flex-1 min-w-0 max-md:order-last max-md:w-full">
        <div className="h-2 bg-ivory-warm rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isOver ? "bg-red-400" : "bg-gradient-to-r from-rose-500 to-gold"
            }`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      </div>

      {/* 지출 (편집 가능) */}
      <div className="w-[120px] flex-shrink-0 text-right max-md:w-auto">
        <InlineMoneyEdit
          value={spent}
          onSave={(v) => onSpentChange(catKey, v)}
          label={`${label} 지출`}
        />
      </div>

      {/* 구분선 */}
      <span className="text-[11px] text-taupe-300 flex-shrink-0">/</span>

      {/* 예산 (편집 가능) */}
      <div className="w-[120px] flex-shrink-0 text-right max-md:w-auto">
        <InlineMoneyEdit
          value={budget}
          onSave={(v) => onBudgetChange(catKey, v)}
          label={`${label} 예산`}
        />
      </div>

      {/* 상태 */}
      <div className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
        status === "완료" ? "bg-[#2E7D5A]/10 text-[#2E7D5A]" :
        status === "진행중" ? "bg-rose-500/10 text-rose-500" :
        "bg-taupe-400/10 text-taupe-400"
      }`}>
        {status}
      </div>
    </motion.div>
  );
}

export default function BudgetPage() {
  const { journey, updateJourney } = useAuthStore();

  const totalBudget = journey?.total_budget ?? 20000000;
  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem>;

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
      // 저장된 커스텀 예산이 있으면 사용, 없으면 비율 기반 기본값
      const catRatio = CATEGORY_RATIOS.find((c) => c.key === key);
      const defaultBudget = catRatio ? Math.round(totalBudget * catRatio.ratio) : 0;
      return item?.budget ?? defaultBudget;
    },
    [progress, totalBudget]
  );

  const getCategorySpent = useCallback(
    (key: string) => {
      const item = progress[key];
      // 저장된 지출이 있으면 사용, 없으면 상태 기반 추정
      if (item?.spent !== undefined) return item.spent;
      const budget = getCategoryBudget(key);
      if (item?.status === "completed") return budget;
      if (item?.status === "in_progress") return Math.round(budget * 0.4);
      return 0;
    },
    [progress, getCategoryBudget]
  );

  const getStatusLabel = useCallback(
    (key: string) => {
      const item = progress[key];
      const status = item?.status ?? "not_started";
      return status === "completed" ? "완료" : status === "in_progress" ? "진행중" : "예정";
    },
    [progress]
  );

  // 총합 계산
  const allCats = CATEGORY_RATIOS;
  const totalSpent = allCats.reduce((s, c) => s + getCategorySpent(c.key), 0);
  const totalAllocated = allCats.reduce((s, c) => s + getCategoryBudget(c.key), 0);
  const remaining = totalBudget - totalSpent;
  const spentPercent = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  // 스드메 합계
  const sdmBudget = SDM_KEYS.reduce((s, k) => s + getCategoryBudget(k), 0);
  const sdmSpent = SDM_KEYS.reduce((s, k) => s + getCategorySpent(k), 0);

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
          {SDM_KEYS.map((key, i) => {
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
                onBudgetChange={handleBudgetChange}
                onSpentChange={handleSpentChange}
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
            <AlertTriangle className="w-3.5 h-3.5 text-gold" />
            금액을 클릭하면 수정할 수 있어요
          </div>
        </div>
        <div className="divide-y divide-black/[0.03]">
          {OTHER_KEYS.map((key, i) => {
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
                onBudgetChange={handleBudgetChange}
                onSpentChange={handleSpentChange}
                delay={0.3 + i * 0.03}
              />
            );
          })}
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
    </div>
  );
}
