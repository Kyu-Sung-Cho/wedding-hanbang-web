"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, X, Clock, CalendarCheck, Filter } from "lucide-react";
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

const statusStyle: Record<BookingStatus, { bg: string; text: string; label: string }> = {
  confirmed: { bg: "bg-[#2E7D5A]/10", text: "text-[#2E7D5A]", label: "확정" },
  pending: { bg: "bg-gold/10", text: "text-gold", label: "대기" },
  completed: { bg: "bg-taupe-400/10", text: "text-taupe-400", label: "완료" },
  cancelled: { bg: "bg-red-500/10", text: "text-red-500", label: "취소" },
};

export default function BookingsPage() {
  const [activeTab, setActiveTab] = useState<BookingStatus | "all">("all");
  const { bookings, updateBookingStatus } = useVendorStore();

  const filtered = activeTab === "all" ? bookings : bookings.filter((b) => b.status === activeTab);
  const pendingCount = bookings.filter((b) => b.status === "pending").length;
  const confirmedCount = bookings.filter((b) => b.status === "confirmed").length;

  const handleConfirm = async (id: string) => {
    await updateBookingStatus(id, "confirmed");
  };
  const handleCancel = async (id: string) => {
    await updateBookingStatus(id, "cancelled");
  };

  return (
    <div className="max-w-[1000px] mx-auto">
      <div className="grid grid-cols-3 gap-4 mb-6 max-md:grid-cols-1">
        {[
          { label: "전체 예약", value: bookings.length, icon: CalendarCheck, color: "text-noir-800" },
          { label: "확정", value: confirmedCount, icon: Check, color: "text-[#2E7D5A]" },
          { label: "대기 중", value: pendingCount, icon: Clock, color: "text-gold" },
        ].map((stat, i) => (
          <motion.div key={stat.label} {...fadeIn} transition={{ duration: 0.5, delay: i * 0.05 }} className="bg-white rounded-2xl p-5 border border-black/[0.04]">
            <p className="text-[12px] text-taupe-500 mb-1">{stat.label}</p>
            <p className={`font-display text-[32px] font-light ${stat.color}`}>{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <motion.div {...fadeIn} transition={{ duration: 0.5, delay: 0.15 }} className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.04] max-md:flex-col max-md:gap-3">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${activeTab === tab.key ? "bg-noir-800 text-white" : "text-charcoal hover:bg-ivory-warm"}`}>
                {tab.label}
                {tab.key === "pending" && pendingCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-gold text-white text-[10px]">{pendingCount}</span>}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-charcoal border border-platinum hover:border-rose-500 transition-colors"><Filter className="w-3.5 h-3.5" />필터</button>
        </div>

        <div className="divide-y divide-black/[0.03]">
          {filtered.map((booking, i) => {
            const s = statusStyle[booking.status];
            return (
              <motion.div key={booking.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="flex items-center gap-4 px-6 py-4 hover:bg-ivory-50 transition-colors max-md:flex-col max-md:items-start">
                <div className="w-[90px] flex-shrink-0">
                  <p className="text-[14px] font-medium text-noir-800">{booking.bookingDate.slice(5)}</p>
                  <p className="text-[12px] text-taupe-400">{booking.bookingTime}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-noir-800 font-medium">{booking.brideName || booking.groomName || "고객"}</p>
                  <p className="text-[12px] text-taupe-400 font-light truncate">{booking.memo}</p>
                </div>
                <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${s.bg} ${s.text}`}>{s.label}</span>
                {booking.status === "pending" && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => handleConfirm(booking.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#2E7D5A] text-white text-[12px] font-medium hover:bg-[#246B4C] transition-colors"><Check className="w-3 h-3" />확정</button>
                    <button onClick={() => handleCancel(booking.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-500 text-[12px] font-medium hover:bg-red-50 transition-colors"><X className="w-3 h-3" />거절</button>
                  </div>
                )}
              </motion.div>
            );
          })}
          {filtered.length === 0 && <div className="py-16 text-center"><p className="text-[14px] text-taupe-400">해당 상태의 예약이 없습니다</p></div>}
        </div>
      </motion.div>
    </div>
  );
}
