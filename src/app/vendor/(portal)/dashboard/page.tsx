"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  CalendarCheck,
  Eye,
  Star,
  Clock,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";
import { mockBookings } from "@/data/mockVendors";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

export default function VendorDashboardPage() {
  const todayBookings = mockBookings.filter((b) => b.date === "2026-02-20");
  const pendingBookings = mockBookings.filter((b) => b.status === "pending");

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* 심사 상태 배너 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5 }}
        className="bg-gradient-to-r from-[#2E7D5A] to-[#4CAF80] rounded-2xl p-5 mb-6 flex items-center justify-between max-md:flex-col max-md:gap-3"
      >
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-white" />
          <div>
            <p className="text-[14px] text-white font-medium">업체가 승인되었습니다</p>
            <p className="text-[12px] text-white/70 font-light">고객 서비스에 노출 중입니다</p>
          </div>
        </div>
        <Link
          href="/vendor/profile"
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/20 text-white text-[12px] font-medium hover:bg-white/30 transition-colors"
        >
          프로필 관리 <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </motion.div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-8 max-md:grid-cols-2">
        {[
          { label: "오늘 예약", value: `${todayBookings.length}건`, icon: CalendarCheck, color: "text-rose-500", bg: "bg-rose-500/10" },
          { label: "대기 중", value: `${pendingBookings.length}건`, icon: Clock, color: "text-gold", bg: "bg-gold/10" },
          { label: "이번 달 조회", value: "1,247", icon: Eye, color: "text-[#2E7D5A]", bg: "bg-[#2E7D5A]/10" },
          { label: "평균 평점", value: "4.8", icon: Star, color: "text-gold", bg: "bg-gold/10" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            {...fadeIn}
            transition={{ duration: 0.5, delay: 0.05 + i * 0.05 }}
            className="bg-white rounded-2xl p-5 border border-black/[0.04]"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-[12px] text-taupe-500">{stat.label}</p>
              <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
            </div>
            <p className="font-display text-[28px] font-light text-noir-800">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-6 max-lg:grid-cols-1">
        {/* 오늘의 예약 */}
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="col-span-3 bg-white rounded-2xl border border-black/[0.04] p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">오늘의 예약</h3>
            <Link href="/vendor/bookings" className="text-[12px] text-rose-500 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              전체 보기 <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {todayBookings.length > 0 ? (
            <div className="space-y-3">
              {todayBookings.map((booking) => (
                <div key={booking.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-ivory-50 border border-black/[0.02]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center">
                      <Clock className="w-4 h-4 text-rose-500" />
                    </div>
                    <div>
                      <p className="text-[14px] font-medium text-noir-800">{booking.time}</p>
                      <p className="text-[12px] text-taupe-400">{booking.customerName} · {booking.memo}</p>
                    </div>
                  </div>
                  <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
                    booking.status === "confirmed" ? "bg-[#2E7D5A]/10 text-[#2E7D5A]" :
                    booking.status === "pending" ? "bg-gold/10 text-gold" :
                    "bg-taupe-400/10 text-taupe-400"
                  }`}>
                    {booking.status === "confirmed" ? "확정" : booking.status === "pending" ? "대기" : booking.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-[14px] text-taupe-400">오늘 예약이 없습니다</p>
            </div>
          )}
        </motion.div>

        {/* 빠른 액션 */}
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="col-span-2 bg-white rounded-2xl border border-black/[0.04] p-6"
        >
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-4 h-4 text-rose-500" />
            <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">빠른 액션</h3>
          </div>
          <div className="space-y-3">
            {[
              { href: "/vendor/products", label: "상품 관리", desc: "패키지/상품 등록·수정", color: "from-rose-500 to-gold" },
              { href: "/vendor/timeslots", label: "타임슬롯 관리", desc: "예약 가능 시간 설정", color: "from-noir-800 to-noir-soft" },
              { href: "/vendor/bookings", label: "예약 관리", desc: `${pendingBookings.length}건 확인 대기`, color: "from-[#2E7D5A] to-[#4CAF80]" },
            ].map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-ivory-50 transition-colors group"
              >
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${action.color} flex items-center justify-center flex-shrink-0`}>
                  <ArrowRight className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-[14px] font-medium text-noir-800">{action.label}</p>
                  <p className="text-[12px] text-taupe-400 font-light">{action.desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-taupe-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        </motion.div>
      </div>

      {/* 최근 예약 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.35 }}
        className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden mt-6"
      >
        <div className="px-6 py-4 border-b border-black/[0.04]">
          <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">최근 예약</h3>
        </div>
        <div className="divide-y divide-black/[0.03]">
          {mockBookings.slice(0, 5).map((booking) => (
            <div key={booking.id} className="flex items-center gap-4 px-6 py-4 hover:bg-ivory-50 transition-colors">
              <div className="w-[90px] text-[13px] text-taupe-500 flex-shrink-0">{booking.date.slice(5)}</div>
              <div className="w-[60px] text-[14px] font-medium text-noir-800 flex-shrink-0">{booking.time}</div>
              <div className="flex-1 text-[13px] text-noir-800">{booking.customerName}</div>
              <div className="text-[12px] text-taupe-400 max-md:hidden">{booking.memo}</div>
              <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${
                booking.status === "confirmed" ? "bg-[#2E7D5A]/10 text-[#2E7D5A]" :
                booking.status === "pending" ? "bg-gold/10 text-gold" :
                booking.status === "completed" ? "bg-taupe-400/10 text-taupe-400" :
                "bg-red-500/10 text-red-500"
              }`}>
                {booking.status === "confirmed" ? "확정" : booking.status === "pending" ? "대기" : booking.status === "completed" ? "완료" : "취소"}
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
