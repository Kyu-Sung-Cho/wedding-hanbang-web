"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Clock, CalendarCheck, Filter, Plus, Save, User, Phone, Package, Play, CheckCircle } from "lucide-react";
import { useVendorStore } from "@/stores/vendorStore";
import type { BookingStatus } from "@/types/vendor.types";

const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

const tabs: { key: BookingStatus | "all"; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "confirmed", label: "확정" },
  { key: "pending", label: "대기중" },
  { key: "completed", label: "완료" },
  { key: "cancelled", label: "취소" },
];

const statusStyle: Record<string, { bg: string; text: string; label: string }> = {
  confirmed: { bg: "bg-[#2E7D5A]/10", text: "text-[#2E7D5A]", label: "확정" },
  pending: { bg: "bg-gold/10", text: "text-gold", label: "대기" },
  contract_sent: { bg: "bg-blue-500/10", text: "text-blue-600", label: "계약 전송" },
  contract_signed: { bg: "bg-purple-500/10", text: "text-purple-600", label: "계약 서명" },
  deposit_paid: { bg: "bg-[#2E7D5A]/10", text: "text-[#2E7D5A]", label: "결제 완료" },
  in_service: { bg: "bg-blue-500/10", text: "text-blue-600", label: "진행 중" },
  service_completed: { bg: "bg-taupe-400/10", text: "text-taupe-500", label: "서비스 완료" },
  settled: { bg: "bg-[#2E7D5A]/10", text: "text-[#2E7D5A]", label: "정산 완료" },
  completed: { bg: "bg-taupe-400/10", text: "text-taupe-400", label: "완료" },
  cancelled: { bg: "bg-red-500/10", text: "text-red-500", label: "취소" },
};

const HOUR_OPTIONS = Array.from({ length: 13 }, (_, i) => i + 9); // 9~21

function ManualBookingModal({ onClose }: { onClose: () => void }) {
  const { products, createBooking } = useVendorStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    bookingDate: "",
    bookingTime: "10",
    productId: "",
    brideName: "",
    groomName: "",
    contactPhone: "",
    amount: "",
    memo: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.bookingDate || !form.bookingTime) {
      setError("예약 날짜와 시간은 필수입니다.");
      return;
    }
    if (!form.brideName && !form.groomName) {
      setError("신부 또는 신랑 이름을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");

    const success = await createBooking({
      bookingDate: form.bookingDate,
      bookingTime: `${form.bookingTime.padStart(2, "0")}:00`,
      productId: form.productId || undefined,
      brideName: form.brideName,
      groomName: form.groomName,
      contactPhone: form.contactPhone,
      amount: form.amount ? Number(form.amount) : 0,
      memo: form.memo,
    });

    setSaving(false);
    if (success) {
      onClose();
    } else {
      setError("예약 등록에 실패했습니다. 다시 시도해주세요.");
    }
  };

  return (
    <div className="fixed inset-0 bg-noir-800/60 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl w-full max-w-[520px] mx-4 overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.04]">
          <h2 className="text-[21px] font-medium text-noir-800">예약 직접 등록</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-ivory-50 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-taupe-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-[38px] text-taupe-400 font-light -mt-1 mb-2">
            시스템 이용 전 잡힌 예약이나, 전화/방문 예약을 직접 등록합니다.
          </p>

          {/* 날짜 & 시간 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[38px] font-medium text-noir-800 mb-1.5">예약 날짜 *</label>
              <input
                type="date"
                value={form.bookingDate}
                onChange={(e) => setForm({ ...form, bookingDate: e.target.value })}
                className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[25px] outline-none focus:border-rose-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[38px] font-medium text-noir-800 mb-1.5">예약 시간 *</label>
              <select
                value={form.bookingTime}
                onChange={(e) => setForm({ ...form, bookingTime: e.target.value })}
                className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[25px] outline-none focus:border-rose-500 transition-colors bg-white"
              >
                {HOUR_OPTIONS.map(h => (
                  <option key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</option>
                ))}
              </select>
            </div>
          </div>

          {/* 상품 선택 */}
          {products.length > 0 && (
            <div>
              <label className="flex items-center gap-1.5 text-[38px] font-medium text-noir-800 mb-1.5">
                <Package className="w-3 h-3 text-taupe-400" />상품
              </label>
              <select
                value={form.productId}
                onChange={(e) => setForm({ ...form, productId: e.target.value })}
                className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[25px] outline-none focus:border-rose-500 transition-colors bg-white"
              >
                <option value="">선택 안 함</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* 고객 정보 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-[38px] font-medium text-noir-800 mb-1.5">
                <User className="w-3 h-3 text-taupe-400" />신부 이름
              </label>
              <input
                type="text"
                value={form.brideName}
                onChange={(e) => setForm({ ...form, brideName: e.target.value })}
                placeholder="김신부"
                className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[25px] outline-none focus:border-rose-500 transition-colors"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[38px] font-medium text-noir-800 mb-1.5">
                <User className="w-3 h-3 text-taupe-400" />신랑 이름
              </label>
              <input
                type="text"
                value={form.groomName}
                onChange={(e) => setForm({ ...form, groomName: e.target.value })}
                placeholder="이신랑"
                className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[25px] outline-none focus:border-rose-500 transition-colors"
              />
            </div>
          </div>

          {/* 연락처 & 금액 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-[38px] font-medium text-noir-800 mb-1.5">
                <Phone className="w-3 h-3 text-taupe-400" />연락처
              </label>
              <input
                type="tel"
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                placeholder="010-1234-5678"
                className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[25px] outline-none focus:border-rose-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[38px] font-medium text-noir-800 mb-1.5">금액 (원)</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="2500000"
                className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[25px] outline-none focus:border-rose-500 transition-colors"
              />
            </div>
          </div>

          {/* 메모 */}
          <div>
            <label className="block text-[38px] font-medium text-noir-800 mb-1.5">메모</label>
            <textarea
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder="예약 관련 참고사항"
              rows={2}
              className="w-full px-3 py-2.5 border border-platinum rounded-lg text-[25px] outline-none focus:border-rose-500 transition-colors resize-none"
            />
          </div>

          {error && <p className="text-[38px] text-rose-500">{error}</p>}

          {/* 버튼 */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-platinum text-[23px] font-medium text-taupe-500 hover:bg-ivory-50 transition-colors">
              취소
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-3 rounded-xl bg-noir-800 text-white text-[23px] font-medium hover:bg-noir-soft transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
              <Save className="w-4 h-4" />{saving ? "등록 중..." : "예약 등록"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export default function BookingsPage() {
  const [activeTab, setActiveTab] = useState<BookingStatus | "all">("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { bookings, updateBookingStatus, refreshBookings } = useVendorStore();

  const filtered = activeTab === "all" ? bookings : bookings.filter((b) => b.status === activeTab);
  const pendingCount = bookings.filter((b) => b.status === "pending").length;
  const confirmedCount = bookings.filter((b) => b.status === "confirmed").length;

  const [statusLoading, setStatusLoading] = useState<string | null>(null);

  const handleConfirm = async (id: string) => {
    await updateBookingStatus(id, "confirmed");
  };
  const handleCancel = async (id: string) => {
    await updateBookingStatus(id, "cancelled");
  };
  const handleStatusTransition = async (id: string, newStatus: string, confirmMsg: string) => {
    if (!confirm(confirmMsg)) return;
    setStatusLoading(id);
    try {
      const res = await fetch(`/api/vendor/bookings/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        await refreshBookings();
      } else {
        const data = await res.json();
        alert(data.error || "상태 변경에 실패했습니다.");
      }
    } catch {
      alert("서버 오류가 발생했습니다.");
    }
    setStatusLoading(null);
  };

  return (
    <div className="max-w-[1000px] mx-auto">
      {/* 헤더 */}
      <motion.div {...fadeIn} transition={{ duration: 0.5 }} className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-serif-kr text-[25px] text-noir-800">예약 현황</h2>
          <p className="text-[25px] text-taupe-500 font-light mt-0.5">예약을 확인하고 관리합니다</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-gold text-white rounded-xl text-[25px] font-medium hover:shadow-[0_4px_16px_rgba(196,150,126,0.3)] transition-all"
        >
          <Plus className="w-4 h-4" />
          예약 등록
        </button>
      </motion.div>

      <div className="grid grid-cols-3 gap-4 mb-6 max-md:grid-cols-1">
        {[
          { label: "전체 예약", value: bookings.length, icon: CalendarCheck, color: "text-noir-800" },
          { label: "확정", value: confirmedCount, icon: Check, color: "text-[#2E7D5A]" },
          { label: "대기 중", value: pendingCount, icon: Clock, color: "text-gold" },
        ].map((stat, i) => (
          <motion.div key={stat.label} {...fadeIn} transition={{ duration: 0.5, delay: i * 0.05 }} className="bg-white rounded-2xl p-5 border border-black/[0.04]">
            <p className="text-[38px] text-taupe-500 mb-1">{stat.label}</p>
            <p className={`font-display text-[50px] font-light ${stat.color}`}>{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.15 }} className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.04] max-md:flex-col max-md:gap-3">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-4 py-2 rounded-lg text-[25px] font-medium transition-colors ${activeTab === tab.key ? "bg-noir-800 text-white" : "text-charcoal hover:bg-ivory-warm"}`}>
                {tab.label}
                {tab.key === "pending" && pendingCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-gold text-white text-[25px]">{pendingCount}</span>}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[38px] text-charcoal border border-platinum hover:border-rose-500 transition-colors"><Filter className="w-3.5 h-3.5" />필터</button>
        </div>

        <div className="divide-y divide-black/[0.03]">
          {filtered.map((booking, i) => {
            const s = statusStyle[booking.status];
            return (
              <motion.div key={booking.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="flex items-center gap-4 px-6 py-4 hover:bg-ivory-50 transition-colors max-md:flex-col max-md:items-start">
                <div className="w-[90px] flex-shrink-0">
                  <p className="text-[23px] font-medium text-noir-800">{booking.bookingDate.slice(5)}</p>
                  <p className="text-[38px] text-taupe-400">{booking.bookingTime}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[23px] text-noir-800 font-medium">{booking.brideName || booking.groomName || "고객"}</p>
                  <p className="text-[38px] text-taupe-400 font-light truncate">{booking.memo}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {booking.bookingType === "manual" && (
                    <span className="text-[25px] px-2 py-0.5 rounded-full bg-taupe-400/10 text-taupe-400 font-medium">직접등록</span>
                  )}
                  <span className={`text-[23px] px-2.5 py-1 rounded-full font-medium ${s.bg} ${s.text}`}>{s.label}</span>
                </div>
                {booking.status === "pending" && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => handleConfirm(booking.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#2E7D5A] text-white text-[38px] font-medium hover:bg-[#246B4C] transition-colors"><Check className="w-3 h-3" />확정</button>
                    <button onClick={() => handleCancel(booking.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-500 text-[38px] font-medium hover:bg-red-50 transition-colors"><X className="w-3 h-3" />거절</button>
                  </div>
                )}
                {booking.status === "deposit_paid" && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => handleStatusTransition(booking.id, "in_service", "서비스를 시작하시겠습니까?")} disabled={statusLoading === booking.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[38px] font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
                      <Play className="w-3 h-3" />서비스 시작
                    </button>
                  </div>
                )}
                {booking.status === "in_service" && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => handleStatusTransition(booking.id, "service_completed", "서비스가 완료되었습니까? 완료 후 정산이 진행됩니다.")} disabled={statusLoading === booking.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#2E7D5A] text-white text-[38px] font-medium hover:bg-[#246B4C] transition-colors disabled:opacity-50">
                      <CheckCircle className="w-3 h-3" />서비스 완료
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
          {filtered.length === 0 && <div className="py-16 text-center"><p className="text-[23px] text-taupe-400">해당 상태의 예약이 없습니다</p></div>}
        </div>
      </motion.div>

      {/* 예약 등록 모달 */}
      <AnimatePresence>
        {showCreateModal && <ManualBookingModal onClose={() => setShowCreateModal(false)} />}
      </AnimatePresence>
    </div>
  );
}
