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
  AlertCircle,
} from "lucide-react";
import { useVendorStore } from "@/stores/vendorStore";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

function getStatusLabel(status: string) {
  switch (status) {
    case "confirmed": return "확정";
    case "pending": return "대기";
    case "completed": return "완료";
    case "cancelled": return "취소";
    default: return status;
  }
}

function getStatusStyle(status: string) {
  switch (status) {
    case "confirmed": return "bg-[#2E7D5A]/10 text-[#2E7D5A]";
    case "pending": return "bg-gold/10 text-gold";
    case "completed": return "bg-taupe-400/10 text-taupe-400";
    case "cancelled": return "bg-red-500/10 text-red-500";
    default: return "bg-taupe-400/10 text-taupe-400";
  }
}

export default function VendorDashboardPage() {
  const { vendor, bookings } = useVendorStore();

  const today = new Date().toISOString().split("T")[0];
  const todayBookings = bookings.filter((b) => b.bookingDate === today);
  const pendingBookings = bookings.filter((b) => b.status === "pending");

  const statusBanner = vendor?.status === "approved" ? {
    gradient: "from-[#2E7D5A] to-[#4CAF80]",
    icon: ShieldCheck,
    title: "업체가 승인되었습니다",
    desc: "고객 서비스에 노출 중입니다",
  } : vendor?.status === "pending" ? {
    gradient: "from-gold to-[#D4B878]",
    icon: Clock,
    title: "심사 진행 중입니다",
    desc: "1~2영업일 내에 심사가 완료됩니다",
  } : {
    gradient: "from-red-500 to-red-400",
    icon: AlertCircle,
    title: "업체 등록이 반려되었습니다",
    desc: "프로필을 수정하여 다시 신청해주세요",
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* 심사 상태 배너 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5 }}
        className={`bg-gradient-to-r ${statusBanner.gradient} rounded-2xl p-5 mb-6 flex items-center justify-between max-md:flex-col max-md:gap-3`}
      >
        <div className="flex items-center gap-3">
          <statusBanner.icon className="w-6 h-6 text-white" />
          <div>
            <p className="text-[23px] text-white font-medium">{statusBanner.title}</p>
            <p className="text-[38px] text-white/70 font-light">{statusBanner.desc}</p>
          </div>
        </div>
        <Link
          href="/vendor/profile"
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/20 text-white text-[38px] font-medium hover:bg-white/30 transition-colors"
        >
          프로필 관리 <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </motion.div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-8 max-md:grid-cols-2">
        {[
          { label: "오늘 예약", value: `${todayBookings.length}건`, icon: CalendarCheck, color: "text-rose-500", bg: "bg-rose-500/10" },
          { label: "대기 중", value: `${pendingBookings.length}건`, icon: Clock, color: "text-gold", bg: "bg-gold/10" },
          { label: "이번 달 조회", value: "-", icon: Eye, color: "text-[#2E7D5A]", bg: "bg-[#2E7D5A]/10" },
          { label: "평균 평점", value: vendor?.rating ? vendor.rating.toFixed(1) : "-", icon: Star, color: "text-gold", bg: "bg-gold/10" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            {...fadeIn}
            transition={{ duration: 0.5, delay: 0.05 + i * 0.05 }}
            className="bg-white rounded-2xl p-5 border border-black/[0.04]"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-[38px] text-taupe-500">{stat.label}</p>
              <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
            </div>
            <p className="font-display text-[35px] font-light text-noir-800">{stat.value}</p>
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
            <h3 className="font-serif-kr text-[21px] font-normal text-noir-800">오늘의 예약</h3>
            <Link href="/vendor/bookings" className="text-[38px] text-rose-500 font-medium flex items-center gap-1 hover:gap-2 transition-all">
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
                      <p className="text-[23px] font-medium text-noir-800">{booking.bookingTime}</p>
                      <p className="text-[38px] text-taupe-400">{booking.brideName || booking.groomName || "고객"} · {booking.memo || "예약"}</p>
                    </div>
                  </div>
                  <span className={`text-[23px] px-2.5 py-1 rounded-full font-medium ${getStatusStyle(booking.status)}`}>
                    {getStatusLabel(booking.status)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-[23px] text-taupe-400">오늘 예약이 없습니다</p>
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
            <h3 className="font-serif-kr text-[21px] font-normal text-noir-800">빠른 액션</h3>
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
                  <p className="text-[23px] font-medium text-noir-800">{action.label}</p>
                  <p className="text-[38px] text-taupe-400 font-light">{action.desc}</p>
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
          <h3 className="font-serif-kr text-[21px] font-normal text-noir-800">최근 예약</h3>
        </div>
        {bookings.length > 0 ? (
          <div className="divide-y divide-black/[0.03]">
            {bookings.slice(0, 5).map((booking) => (
              <div key={booking.id} className="flex items-center gap-4 px-6 py-4 hover:bg-ivory-50 transition-colors">
                <div className="w-[90px] text-[25px] text-taupe-500 flex-shrink-0">{booking.bookingDate.slice(5)}</div>
                <div className="w-[60px] text-[23px] font-medium text-noir-800 flex-shrink-0">{booking.bookingTime}</div>
                <div className="flex-1 text-[25px] text-noir-800">{booking.brideName || booking.groomName || "고객"}</div>
                <div className="text-[38px] text-taupe-400 max-md:hidden">{booking.memo}</div>
                <span className={`text-[23px] px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${getStatusStyle(booking.status)}`}>
                  {getStatusLabel(booking.status)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10">
            <p className="text-[23px] text-taupe-400">아직 예약이 없습니다</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
