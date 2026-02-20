"use client";

import { motion } from "framer-motion";
import { TrendingDown, TrendingUp, AlertTriangle, ChevronRight } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

// 카테고리별 예산 비율 (기본값)
const CATEGORY_RATIOS: { key: string; label: string; ratio: number }[] = [
  { key: "venue", label: "예식장", ratio: 0.23 },
  { key: "studio", label: "스튜디오", ratio: 0.13 },
  { key: "dress", label: "드레스", ratio: 0.09 },
  { key: "makeup", label: "메이크업", ratio: 0.06 },
  { key: "ring", label: "예물", ratio: 0.14 },
  { key: "hanbok", label: "한복", ratio: 0.04 },
  { key: "honeymoon", label: "신혼여행", ratio: 0.14 },
  { key: "houseware", label: "혼수", ratio: 0.09 },
  { key: "invitation", label: "청첩장", ratio: 0.02 },
  { key: "gift", label: "답례품", ratio: 0.02 },
  { key: "reserve", label: "예비비", ratio: 0.04 },
];

function formatMoney(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(0)}만`;
  return `${n.toLocaleString()}`;
}

export default function BudgetPage() {
  const { journey } = useAuthStore();

  const totalBudget = journey?.total_budget ?? 20000000;
  const progress = journey?.progress ?? {};

  // 카테고리별 예산 계산
  const budgetItems = CATEGORY_RATIOS.map((cat) => {
    const categoryBudget = Math.round(totalBudget * cat.ratio);
    const progressItem = progress[cat.key] as { status: string } | undefined;
    const status = progressItem?.status ?? "not_started";

    // 상태에 따라 지출 추정
    let spent = 0;
    let statusLabel = "예정";
    if (status === "completed") {
      spent = categoryBudget;
      statusLabel = "완료";
    } else if (status === "in_progress") {
      spent = Math.round(categoryBudget * 0.4);
      statusLabel = "진행중";
    }

    return {
      key: cat.key,
      category: cat.label,
      budget: categoryBudget,
      spent,
      status: statusLabel,
    };
  });

  const totalSpent = budgetItems.reduce((s, i) => s + i.spent, 0);
  const remaining = totalBudget - totalSpent;
  const spentPercent = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <div className="max-w-[1000px] mx-auto">
      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-3 gap-4 mb-8 max-md:grid-cols-1">
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5 }}
          className="bg-white rounded-2xl p-6 border border-black/[0.04]"
        >
          <p className="text-[12px] text-taupe-500 font-light mb-2">총 예산</p>
          <p className="font-display text-[32px] font-light text-noir-800">
            ₩{(totalBudget / 10000).toFixed(0)}<span className="text-[16px] text-taupe-400">만원</span>
          </p>
        </motion.div>
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="bg-white rounded-2xl p-6 border border-black/[0.04]"
        >
          <p className="text-[12px] text-taupe-500 font-light mb-2 flex items-center gap-1.5">
            사용 금액 <TrendingUp className="w-3.5 h-3.5 text-rose-500" />
          </p>
          <p className="font-display text-[32px] font-light text-noir-800">
            ₩{(totalSpent / 10000).toFixed(0)}<span className="text-[16px] text-taupe-400">만원</span>
          </p>
          <div className="w-full h-2 bg-ivory-warm rounded-full mt-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-rose-500 to-gold rounded-full transition-all duration-700"
              style={{ width: `${spentPercent}%` }}
            />
          </div>
          <p className="text-[11px] text-taupe-400 mt-1.5">예산 대비 {spentPercent}% 사용</p>
        </motion.div>
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-2xl p-6 border border-black/[0.04]"
        >
          <p className="text-[12px] text-taupe-500 font-light mb-2 flex items-center gap-1.5">
            잔여 예산 <TrendingDown className="w-3.5 h-3.5 text-[#2E7D5A]" />
          </p>
          <p className="font-display text-[32px] font-light text-[#2E7D5A]">
            ₩{(remaining / 10000).toFixed(0)}<span className="text-[16px] text-[#2E7D5A]/50">만원</span>
          </p>
        </motion.div>
      </div>

      {/* 카테고리별 상세 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-black/[0.04] flex items-center justify-between">
          <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">카테고리별 예산</h3>
          <div className="flex items-center gap-1.5 text-[11px] text-taupe-400">
            <AlertTriangle className="w-3.5 h-3.5 text-gold" />
            총 예산 ₩{(totalBudget / 10000).toFixed(0)}만원 기준
          </div>
        </div>
        <div className="divide-y divide-black/[0.03]">
          {budgetItems.map((item, i) => {
            const percent = item.budget > 0 ? Math.round((item.spent / item.budget) * 100) : 0;
            const isOver = item.spent > item.budget;
            return (
              <motion.div
                key={item.key}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 + i * 0.03 }}
                className="flex items-center gap-5 px-6 py-4 hover:bg-ivory-50 transition-colors cursor-pointer group"
              >
                <div className="w-[100px] text-[14px] font-medium text-noir-800 flex-shrink-0">
                  {item.category}
                </div>
                <div className="flex-1">
                  <div className="h-2 bg-ivory-warm rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isOver ? "bg-red-400" : "bg-gradient-to-r from-rose-500 to-gold"
                      }`}
                      style={{ width: `${Math.min(percent, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="w-[80px] text-right text-[13px] font-light text-taupe-500 flex-shrink-0">
                  {formatMoney(item.spent)}
                </div>
                <div className="text-[11px] text-taupe-400 flex-shrink-0">
                  / {formatMoney(item.budget)}
                </div>
                <div className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                  item.status === "완료" ? "bg-[#2E7D5A]/10 text-[#2E7D5A]" :
                  item.status === "진행중" ? "bg-rose-500/10 text-rose-500" :
                  "bg-taupe-400/10 text-taupe-400"
                }`}>
                  {item.status}
                </div>
                <ChevronRight className="w-4 h-4 text-taupe-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
