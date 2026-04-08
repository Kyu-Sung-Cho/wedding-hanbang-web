"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  FileText,
  Send,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  Plus,
  ChevronDown,
  ChevronUp,
  Check,
  AlertTriangle,
  Settings2,
} from "lucide-react";
import type { Contract, ContractClause } from "@/types/contract.types";
import type { VendorContractTemplate } from "@/types/contract.types";
import { useVendorStore } from "@/stores/vendorStore";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

type StatusFilter = "all" | "draft" | "sent" | "viewed" | "signed" | "cancelled";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: "작성 중", color: "text-taupe-400 bg-taupe-400/10", icon: FileText },
  sent: { label: "전송됨", color: "text-blue-600 bg-blue-500/10", icon: Send },
  viewed: { label: "확인함", color: "text-gold bg-gold/10", icon: Eye },
  signed: { label: "서명완료", color: "text-[#2E7D5A] bg-[#2E7D5A]/10", icon: CheckCircle },
  cancelled: { label: "취소", color: "text-red-500 bg-red-500/10", icon: XCircle },
};

function formatPrice(price: number): string {
  if (price >= 10000) return `${(price / 10000).toFixed(0)}만원`;
  return `${price.toLocaleString()}원`;
}

// 계약 생성 모달
function CreateContractModal({
  bookings,
  templates,
  onClose,
  onCreate,
}: {
  bookings: Array<{
    id: string;
    brideName: string;
    groomName: string;
    bookingDate: string;
    amount: number;
    productName?: string;
  }>;
  templates: VendorContractTemplate[];
  onClose: () => void;
  onCreate: (data: {
    bookingId: string;
    templateId?: string;
    contractAmount: number;
    depositRate: number;
  }) => void;
}) {
  const [selectedBooking, setSelectedBooking] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [contractAmount, setContractAmount] = useState(0);
  const [depositRate, setDepositRate] = useState(30);
  const [creating, setCreating] = useState(false);

  const handleBookingSelect = (bookingId: string) => {
    setSelectedBooking(bookingId);
    const booking = bookings.find((b) => b.id === bookingId);
    if (booking?.amount) setContractAmount(booking.amount);
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl) setDepositRate(Math.round(tmpl.depositRate * 100));
  };

  const handleSubmit = async () => {
    if (!selectedBooking || !contractAmount) return;
    setCreating(true);
    await onCreate({
      bookingId: selectedBooking,
      templateId: selectedTemplate || undefined,
      contractAmount,
      depositRate: depositRate / 100,
    });
    setCreating(false);
  };

  return (
    <div className="fixed inset-0 bg-noir-800/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl w-full max-w-[500px] mx-4 overflow-hidden"
      >
        <div className="border-b border-black/[0.04] px-6 py-4 flex items-center justify-between">
          <h2 className="text-[21px] font-medium text-noir-800">새 계약 생성</h2>
          <button onClick={onClose} className="text-taupe-400 hover:text-noir-800 transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[23px] font-medium text-noir-800 mb-1.5">예약 선택 *</label>
            <select
              value={selectedBooking}
              onChange={(e) => handleBookingSelect(e.target.value)}
              className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[21px] outline-none focus:border-rose-500 bg-white"
            >
              <option value="">예약을 선택하세요</option>
              {bookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.brideName} & {b.groomName} — {b.bookingDate}
                  {b.productName ? ` (${b.productName})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[23px] font-medium text-noir-800 mb-1.5">
              계약 템플릿 (선택)
            </label>
            <select
              value={selectedTemplate}
              onChange={(e) => handleTemplateSelect(e.target.value)}
              className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[21px] outline-none focus:border-rose-500 bg-white"
            >
              <option value="">템플릿 없이 생성</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} {t.isDefault ? "(기본)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[23px] font-medium text-noir-800 mb-1.5">
                계약 금액 (원) *
              </label>
              <input
                type="number"
                value={contractAmount || ""}
                onChange={(e) => setContractAmount(Number(e.target.value))}
                placeholder="2500000"
                className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[21px] outline-none focus:border-rose-500"
              />
            </div>
            <div>
              <label className="block text-[23px] font-medium text-noir-800 mb-1.5">
                계약금 비율 (%)
              </label>
              <input
                type="number"
                value={depositRate}
                onChange={(e) => setDepositRate(Number(e.target.value))}
                min={0}
                max={100}
                className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[21px] outline-none focus:border-rose-500"
              />
            </div>
          </div>

          {contractAmount > 0 && (
            <div className="bg-ivory-50 rounded-lg px-4 py-3 border border-black/[0.03]">
              <div className="flex justify-between text-[21px]">
                <span className="text-taupe-500">총 계약 금액</span>
                <span className="font-medium text-noir-800">{formatPrice(contractAmount)}</span>
              </div>
              <div className="flex justify-between text-[21px] mt-1">
                <span className="text-taupe-500">계약금 ({depositRate}%)</span>
                <span className="font-medium text-rose-500">
                  {formatPrice(Math.round(contractAmount * (depositRate / 100)))}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-black/[0.04] px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-platinum text-[23px] font-medium text-taupe-500 hover:bg-ivory-50 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={creating || !selectedBooking || !contractAmount}
            className="flex-1 py-3 rounded-xl bg-noir-800 text-white text-[23px] font-medium hover:bg-noir-soft transition-colors disabled:opacity-50"
          >
            {creating ? "생성 중..." : "계약 생성"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function VendorContractsPage() {
  const { bookings } = useVendorStore();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [templates, setTemplates] = useState<VendorContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [contractRes, templateRes] = await Promise.all([
        fetch("/api/vendor/contracts"),
        fetch("/api/vendor/contracts/templates"),
      ]);
      const contractData = await contractRes.json();
      const templateData = await templateRes.json();
      setContracts(contractData.contracts ?? []);
      setTemplates(templateData.templates ?? []);
    } catch {
      console.error("데이터 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async (data: {
    bookingId: string;
    templateId?: string;
    contractAmount: number;
    depositRate: number;
  }) => {
    const res = await fetch("/api/vendor/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setShowCreateModal(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      fetchData();
    }
  };

  const handleSend = async (contractId: string) => {
    if (!confirm("고객에게 계약서를 전송하시겠습니까?")) return;
    const res = await fetch(`/api/vendor/contracts/${contractId}/send`, { method: "POST" });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      fetchData();
    }
  };

  const filtered = filter === "all" ? contracts : contracts.filter((c) => c.status === filter);

  // 계약 없는 확인된 예약 (계약 생성 가능)
  const contractedBookingIds = new Set(contracts.filter((c) => c.status !== "cancelled").map((c) => c.bookingId));
  const availableBookings = bookings
    .filter((b) => b.status === "confirmed" && !contractedBookingIds.has(b.id))
    .map((b) => ({
      id: b.id,
      brideName: b.brideName || "신부",
      groomName: b.groomName || "신랑",
      bookingDate: b.bookingDate,
      amount: b.amount || 0,
      productName: b.productName,
    }));

  const statusCounts = {
    all: contracts.length,
    draft: contracts.filter((c) => c.status === "draft").length,
    sent: contracts.filter((c) => c.status === "sent").length,
    viewed: contracts.filter((c) => c.status === "viewed").length,
    signed: contracts.filter((c) => c.status === "signed").length,
    cancelled: contracts.filter((c) => c.status === "cancelled").length,
  };

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
      <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-serif-kr text-[23px] text-noir-800">계약 관리</h2>
          <p className="text-[21px] text-taupe-500 font-light mt-0.5">
            고객과의 계약 현황을 관리합니다
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/vendor/contracts/templates"
            className="flex items-center gap-2 px-4 py-2.5 border border-platinum rounded-xl text-[21px] font-medium text-charcoal hover:bg-ivory-50 transition-colors"
          >
            <Settings2 className="w-4 h-4" />
            템플릿 관리
          </Link>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={availableBookings.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-gold text-white rounded-xl text-[21px] font-medium hover:shadow-[0_4px_16px_rgba(196,150,126,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            계약 생성
          </button>
        </div>
      </motion.div>

      {/* 상태 필터 탭 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.05 }} className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {(["all", "draft", "sent", "viewed", "signed", "cancelled"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-[21px] font-medium whitespace-nowrap transition-colors ${
              filter === s
                ? "bg-noir-800 text-white"
                : "text-taupe-500 hover:bg-ivory-warm"
            }`}
          >
            {s === "all" ? "전체" : STATUS_CONFIG[s].label}
            <span className="ml-1.5 text-[23px] opacity-60">{statusCounts[s]}</span>
          </button>
        ))}
      </motion.div>

      {/* 계약 리스트 */}
      {filtered.length === 0 ? (
        <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.1 }} className="bg-white rounded-2xl border border-black/[0.04] p-12 text-center">
          <FileText className="w-12 h-12 text-taupe-400/40 mx-auto mb-4" />
          <p className="text-[21px] text-taupe-500 mb-2">
            {filter === "all" ? "아직 계약이 없습니다" : `${STATUS_CONFIG[filter]?.label} 상태의 계약이 없습니다`}
          </p>
          {filter === "all" && availableBookings.length > 0 && (
            <>
              <p className="text-[21px] text-taupe-400 font-light mb-6">
                확인된 예약에서 계약을 생성해보세요
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-5 py-3 bg-noir-800 text-white rounded-xl text-[21px] font-medium hover:bg-noir-soft transition-colors"
              >
                <Plus className="w-4 h-4" />
                첫 계약 생성하기
              </button>
            </>
          )}
        </motion.div>
      ) : (
        <div className="space-y-3">
          {filtered.map((contract, i) => {
            const isExpanded = expandedId === contract.id;
            const config = STATUS_CONFIG[contract.status];
            const Icon = config.icon;

            return (
              <motion.div
                key={contract.id}
                {...fadeIn}
                transition={{ duration: 0.4, delay: 0.05 + i * 0.04 }}
                className={`bg-white rounded-2xl border transition-colors ${
                  isExpanded ? "border-rose-500/30" : "border-black/[0.04]"
                }`}
              >
                <div className="flex items-center gap-4 px-5 py-4">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : contract.id)}
                    className="flex-1 flex items-center gap-4 text-left"
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${config.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[21px] font-medium text-noir-800 truncate">
                          {contract.vendorName || "고객"}
                        </h3>
                        <span className={`px-2 py-0.5 rounded-full text-[23px] font-medium ${config.color}`}>
                          {config.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[23px] text-taupe-400">
                        {contract.productName && <span>{contract.productName}</span>}
                        <span>{formatPrice(contract.contractAmount)}</span>
                        <span>계약금 {formatPrice(contract.depositAmount)}</span>
                        {contract.bookingDate && (
                          <span>{new Date(contract.bookingDate).toLocaleDateString("ko-KR")}</span>
                        )}
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-taupe-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-taupe-400" />
                    )}
                  </button>

                  {/* 액션 버튼 */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {contract.status === "draft" && (
                      <button
                        onClick={() => handleSend(contract.id)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 text-blue-600 text-[23px] font-medium hover:bg-blue-500/20 transition-colors"
                      >
                        <Send className="w-3.5 h-3.5" />
                        전송
                      </button>
                    )}
                  </div>
                </div>

                {/* 펼쳐진 상세 */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 border-t border-black/[0.03]">
                        {/* 타임라인 */}
                        <div className="mt-4 flex items-center gap-2 flex-wrap mb-4">
                          {[
                            { label: "생성", date: contract.createdAt, done: true },
                            { label: "전송", date: contract.sentAt, done: !!contract.sentAt },
                            { label: "확인", date: contract.viewedAt, done: !!contract.viewedAt },
                            { label: "서명", date: contract.signedAt, done: !!contract.signedAt },
                          ].map((step, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              {idx > 0 && (
                                <div className={`w-6 h-px ${step.done ? "bg-[#2E7D5A]" : "bg-taupe-400/20"}`} />
                              )}
                              <div className="flex items-center gap-1.5">
                                <div
                                  className={`w-5 h-5 rounded-full flex items-center justify-center ${
                                    step.done ? "bg-[#2E7D5A]" : "bg-taupe-400/20"
                                  }`}
                                >
                                  {step.done ? (
                                    <Check className="w-3 h-3 text-white" />
                                  ) : (
                                    <Clock className="w-3 h-3 text-taupe-400" />
                                  )}
                                </div>
                                <div>
                                  <span className="text-[23px] text-noir-800 font-medium">{step.label}</span>
                                  {step.date && (
                                    <p className="text-[23px] text-taupe-400">
                                      {new Date(step.date).toLocaleDateString("ko-KR")}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* 계약 내용 미리보기 */}
                        {contract.content && contract.content.length > 0 && (
                          <div className="space-y-2">
                            {(contract.content as ContractClause[]).slice(0, 3).map((clause, idx) => (
                              <div key={idx} className="bg-ivory-50/50 rounded-lg px-4 py-2 border border-black/[0.03]">
                                <p className="text-[23px] text-rose-500 font-medium">
                                  제{idx + 1}조 {clause.title}
                                </p>
                                <p className="text-[23px] text-taupe-500 line-clamp-2 mt-0.5">
                                  {clause.body}
                                </p>
                              </div>
                            ))}
                            {contract.content.length > 3 && (
                              <p className="text-[23px] text-taupe-400 text-center">
                                외 {contract.content.length - 3}개 조항
                              </p>
                            )}
                          </div>
                        )}

                        {/* 금액 정보 */}
                        <div className="mt-4 bg-ivory-50/50 rounded-lg px-4 py-3 border border-black/[0.03]">
                          <div className="flex justify-between text-[21px] mb-1">
                            <span className="text-taupe-500">총 계약 금액</span>
                            <span className="font-medium text-noir-800">
                              {formatPrice(contract.contractAmount)}
                            </span>
                          </div>
                          <div className="flex justify-between text-[21px]">
                            <span className="text-taupe-500">
                              계약금 ({Math.round(contract.depositRate * 100)}%)
                            </span>
                            <span className="font-medium text-rose-500">
                              {formatPrice(contract.depositAmount)}
                            </span>
                          </div>
                        </div>

                        {/* 서명 정보 */}
                        {contract.signedName && (
                          <div className="mt-3 flex items-center gap-2 text-[23px] text-[#2E7D5A]">
                            <CheckCircle className="w-4 h-4" />
                            <span>
                              {contract.signedName}님이{" "}
                              {contract.signedAt
                                ? new Date(contract.signedAt).toLocaleDateString("ko-KR")
                                : ""}
                              에 서명 완료
                            </span>
                          </div>
                        )}

                        {/* 취소 정보 */}
                        {contract.status === "cancelled" && (
                          <div className="mt-3 flex items-start gap-2 text-[23px] text-red-500">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span>
                              계약 취소됨
                              {contract.cancelReason && ` — ${contract.cancelReason}`}
                            </span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* 저장 알림 */}
      <AnimatePresence>
        {saved && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-[#2E7D5A] text-white rounded-xl text-[23px] font-medium flex items-center gap-2 shadow-lg z-50"
          >
            <Check className="w-4 h-4" />
            처리되었습니다
          </motion.div>
        )}
      </AnimatePresence>

      {/* 계약 생성 모달 */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateContractModal
            bookings={availableBookings}
            templates={templates}
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
