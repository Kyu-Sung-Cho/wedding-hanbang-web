"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Banknote,
  Clock,
  CheckCircle,
  ArrowUpRight,
  TrendingUp,
} from "lucide-react";
import type { Settlement } from "@/types/contract.types";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

function formatPrice(price: number): string {
  if (price >= 10000) return `${(price / 10000).toFixed(price % 10000 === 0 ? 0 : 1)}만원`;
  return `${price.toLocaleString()}원`;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: "정산 대기", color: "text-gold bg-gold/10", icon: Clock },
  processing: { label: "처리 중", color: "text-blue-600 bg-blue-500/10", icon: ArrowUpRight },
  completed: { label: "정산 완료", color: "text-[#2E7D5A] bg-[#2E7D5A]/10", icon: CheckCircle },
  failed: { label: "실패", color: "text-red-500 bg-red-500/10", icon: Clock },
};

export default function VendorSettlementsPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [stats, setStats] = useState({ totalSettled: 0, pendingAmount: 0, totalCommission: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/api/vendor/settlements")
      .then((r) => r.json())
      .then((data) => {
        setSettlements(data.settlements ?? []);
        setStats(data.stats ?? { totalSettled: 0, pendingAmount: 0, totalCommission: 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === "all"
    ? settlements
    : settlements.filter((s) => s.status === filter);

  if (loading) {
    return (
      <div className="max-w-[1015px] mx-auto flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1015px] mx-auto">
      {/* 헤더 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="mb-6">
        <h2 className="font-serif-kr text-[23px] text-noir-800">정산 내역</h2>
        <p className="text-[21px] text-taupe-500 font-light mt-0.5">
          서비스 완료 후 정산 현황을 확인합니다
        </p>
      </motion.div>

      {/* 통계 카드 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.05 }} className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-black/[0.04] p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-[#2E7D5A]" />
            <p className="text-[23px] text-taupe-500">총 정산 금액</p>
          </div>
          <p className="font-display text-[25px] text-[#2E7D5A]">
            {formatPrice(stats.totalSettled)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-black/[0.04] p-5">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-gold" />
            <p className="text-[23px] text-taupe-500">정산 대기</p>
          </div>
          <p className="font-display text-[25px] text-gold">
            {formatPrice(stats.pendingAmount)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-black/[0.04] p-5">
          <div className="flex items-center gap-2 mb-2">
            <Banknote className="w-4 h-4 text-taupe-400" />
            <p className="text-[23px] text-taupe-500">수수료 합계</p>
          </div>
          <p className="font-display text-[25px] text-taupe-500">
            {formatPrice(stats.totalCommission)}
          </p>
        </div>
      </motion.div>

      {/* 필터 탭 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.1 }} className="flex gap-2 mb-6">
        {["all", "pending", "processing", "completed"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-[21px] font-medium transition-colors ${
              filter === s ? "bg-noir-800 text-white" : "text-taupe-500 hover:bg-ivory-warm"
            }`}
          >
            {s === "all" ? "전체" : STATUS_CONFIG[s]?.label ?? s}
          </button>
        ))}
      </motion.div>

      {/* 정산 목록 */}
      {filtered.length === 0 ? (
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.15 }} className="bg-white rounded-2xl border border-black/[0.04] p-12 text-center">
          <Banknote className="w-12 h-12 text-taupe-400/40 mx-auto mb-4" />
          <p className="text-[21px] text-taupe-500 mb-2">정산 내역이 없습니다</p>
          <p className="text-[21px] text-taupe-400 font-light">
            서비스 완료 후 정산이 자동으로 생성됩니다
          </p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {filtered.map((settlement, i) => {
            const config = STATUS_CONFIG[settlement.status] ?? STATUS_CONFIG.pending;
            const Icon = config.icon;

            return (
              <motion.div
                key={settlement.id}
                {...fadeIn}
                transition={{ duration: 0.4, delay: 0.05 + i * 0.04 }}
                className="bg-white rounded-2xl border border-black/[0.04] px-5 py-4"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${config.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-[23px] font-medium ${config.color}`}>
                        {config.label}
                      </span>
                      <span className="text-[23px] text-taupe-400">
                        {new Date(settlement.createdAt).toLocaleDateString("ko-KR")}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-[21px]">
                      <div>
                        <span className="text-taupe-500">결제 금액: </span>
                        <span className="text-noir-800 font-medium">{formatPrice(settlement.totalAmount)}</span>
                      </div>
                      <div>
                        <span className="text-taupe-500">수수료 ({Math.round(settlement.commissionRate * 100)}%): </span>
                        <span className="text-red-500">{formatPrice(settlement.commissionAmount)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[23px] text-taupe-400">정산 금액</p>
                    <p className="font-display text-[23px] text-[#2E7D5A]">
                      {formatPrice(settlement.settleAmount)}
                    </p>
                  </div>
                </div>

                {settlement.status === "completed" && settlement.settledAt && (
                  <div className="mt-3 pt-3 border-t border-black/[0.03] flex items-center gap-2 text-[23px] text-[#2E7D5A]">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {new Date(settlement.settledAt).toLocaleDateString("ko-KR")}에 정산 완료
                    {settlement.bankName && ` — ${settlement.bankName} ${settlement.accountNumber}`}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
