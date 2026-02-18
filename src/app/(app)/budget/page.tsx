"use client";

import { motion } from "framer-motion";
import { TrendingDown, TrendingUp, AlertTriangle, ChevronRight } from "lucide-react";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

const budgetItems = [
  { category: "예식장", budget: 5000000, spent: 4800000, status: "완료" },
  { category: "스튜디오", budget: 2800000, spent: 2800000, status: "완료" },
  { category: "드레스", budget: 2000000, spent: 800000, status: "진행중" },
  { category: "메이크업", budget: 1200000, spent: 0, status: "예정" },
  { category: "예물", budget: 3000000, spent: 1500000, status: "진행중" },
  { category: "한복", budget: 800000, spent: 0, status: "예정" },
  { category: "신혼여행", budget: 3000000, spent: 0, status: "예정" },
  { category: "혼수", budget: 2000000, spent: 0, status: "예정" },
  { category: "답례품", budget: 500000, spent: 0, status: "예정" },
  { category: "예비비", budget: 1200000, spent: 200000, status: "진행중" },
];

function formatMoney(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(0)}만`;
  return `${n.toLocaleString()}`;
}

export default function BudgetPage() {
  const totalBudget = budgetItems.reduce((s, i) => s + i.budget, 0);
  const totalSpent = budgetItems.reduce((s, i) => s + i.spent, 0);
  const remaining = totalBudget - totalSpent;
  const spentPercent = Math.round((totalSpent / totalBudget) * 100);

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
            추가 비용 알림 ON
          </div>
        </div>
        <div className="divide-y divide-black/[0.03]">
          {budgetItems.map((item, i) => {
            const percent = item.budget > 0 ? Math.round((item.spent / item.budget) * 100) : 0;
            const isOver = item.spent > item.budget;
            return (
              <motion.div
                key={item.category}
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
