"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  MessageCircle,
  Wallet,
  CalendarCheck,
  TrendingUp,
  CheckCircle2,
  Clock,
  ArrowRight,
} from "lucide-react";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

const categories = [
  { name: "스튜디오", status: "완료", color: "bg-[#2E7D5A]" },
  { name: "드레스", status: "진행중", color: "bg-rose-500" },
  { name: "메이크업", status: "예정", color: "bg-taupe-400" },
  { name: "예식장", status: "완료", color: "bg-[#2E7D5A]" },
  { name: "예물", status: "진행중", color: "bg-rose-500" },
  { name: "한복", status: "예정", color: "bg-taupe-400" },
  { name: "신혼여행", status: "예정", color: "bg-taupe-400" },
  { name: "혼수", status: "예정", color: "bg-taupe-400" },
];

const recentActivity = [
  { text: "스튜디오 '로즈스튜디오' 계약 완료", time: "2시간 전", icon: CheckCircle2 },
  { text: "AI 상담: 드레스 추천 3곳 확인", time: "어제", icon: MessageCircle },
  { text: "예산 항목 '예식장' 업데이트", time: "2일 전", icon: Wallet },
  { text: "D-120 체크리스트 완료", time: "3일 전", icon: CalendarCheck },
];

export default function DashboardPage() {
  const dday = 240;
  const completedCategories = 2;
  const totalCategories = 8;
  const progressPercent = Math.round((completedCategories / totalCategories) * 100);

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* D-day 히어로 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.6 }}
        className="bg-gradient-to-br from-noir-800 to-noir-soft rounded-3xl p-10 max-md:p-6 mb-8 relative overflow-hidden"
      >
        <div className="absolute top-[-20%] right-[-10%] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(196,150,126,0.12),transparent)] rounded-full" />
        <div className="relative z-10 flex items-center justify-between max-md:flex-col max-md:text-center max-md:gap-6">
          <div>
            <p className="text-[12px] tracking-[0.18em] uppercase text-rose-light font-medium mb-3">
              Wedding Day
            </p>
            <div className="flex items-baseline gap-3 max-md:justify-center">
              <span className="font-display text-[72px] max-md:text-[56px] font-light bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent leading-none">
                D-{dday}
              </span>
            </div>
            <p className="text-white/40 text-[14px] font-light mt-3">
              2026년 10월 15일 · 김지은 & 박민수
            </p>
          </div>
          <div className="text-center">
            <div className="relative w-[120px] h-[120px] mx-auto">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="url(#progressGrad)" strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${progressPercent * 3.27} ${327 - progressPercent * 3.27}`}
                />
                <defs>
                  <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#C4967E" />
                    <stop offset="100%" stopColor="#C9A96E" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-[28px] font-light text-white">{progressPercent}%</span>
                <span className="text-[10px] text-white/30">진행률</span>
              </div>
            </div>
            <p className="text-white/40 text-[12px] mt-2">{completedCategories}/{totalCategories} 카테고리 완료</p>
          </div>
        </div>
      </motion.div>

      {/* 빠른 액션 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="grid grid-cols-3 gap-4 mb-8 max-md:grid-cols-1"
      >
        {[
          { href: "/chat", icon: MessageCircle, label: "AI에게 물어보기", desc: "결혼 준비 뭐든 상담하세요", accent: "from-rose-500 to-gold" },
          { href: "/budget", icon: Wallet, label: "예산 현황 보기", desc: "잔여 예산 ₩4,000,000", accent: "from-[#2E7D5A] to-[#4CAF80]" },
          { href: "/schedule", icon: CalendarCheck, label: "오늘의 할 일", desc: "드레스 투어 예약 확인", accent: "from-gold to-[#DCC9A0]" },
        ].map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group bg-white rounded-2xl p-6 border border-black/[0.04] hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)] transition-all duration-300"
          >
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${action.accent} flex items-center justify-center mb-4`}>
              <action.icon className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-[15px] font-medium text-noir-800 mb-1">{action.label}</h3>
            <p className="text-[12px] text-taupe-500 font-light">{action.desc}</p>
          </Link>
        ))}
      </motion.div>

      <div className="grid grid-cols-5 gap-6 max-lg:grid-cols-1">
        {/* 카테고리 현황 */}
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="col-span-3 bg-white rounded-2xl p-6 border border-black/[0.04]"
        >
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">카테고리별 진행 상태</h3>
            <Link href="/schedule" className="text-[12px] text-rose-500 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              전체 보기 <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            {categories.map((cat) => (
              <div key={cat.name} className="flex items-center justify-between px-4 py-3 rounded-xl bg-ivory-50 border border-black/[0.02]">
                <span className="text-[13px] text-noir-800 font-medium">{cat.name}</span>
                <span className={`text-[11px] px-2.5 py-1 rounded-full text-white font-medium ${cat.color}`}>
                  {cat.status}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* 최근 활동 */}
        <motion.div
          {...fadeIn}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="col-span-2 bg-white rounded-2xl p-6 border border-black/[0.04]"
        >
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-4 h-4 text-rose-500" />
            <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">최근 활동</h3>
          </div>
          <div className="flex flex-col gap-1">
            {recentActivity.map((activity, i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-3 rounded-xl hover:bg-ivory-50 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-ivory-warm flex items-center justify-center flex-shrink-0 mt-0.5">
                  <activity.icon className="w-4 h-4 text-rose-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-noir-800 font-light leading-snug">{activity.text}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Clock className="w-3 h-3 text-taupe-400" />
                    <span className="text-[11px] text-taupe-400">{activity.time}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
