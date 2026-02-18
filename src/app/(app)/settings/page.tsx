"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  User,
  Calendar,
  Wallet,
  Heart,
  Bell,
  BellOff,
  LogOut,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

export default function SettingsPage() {
  const [notifications, setNotifications] = useState({
    schedule: true,
    budget: true,
    ai: false,
    marketing: false,
  });
  const [copied, setCopied] = useState(false);

  const coupleCode = "WH-2026-JMKS";

  const handleCopy = () => {
    navigator.clipboard.writeText(coupleCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-[700px] mx-auto">
      {/* 프로필 카드 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5 }}
        className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-6"
      >
        <div className="flex items-center gap-5 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center">
            <span className="font-display text-[24px] text-white font-light">JE</span>
          </div>
          <div>
            <h2 className="text-[18px] font-medium text-noir-800">김지은</h2>
            <p className="text-[13px] text-taupe-500 font-light">jieun.kim@email.com</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-ivory-50 border border-black/[0.02]">
            <Calendar className="w-5 h-5 text-rose-500" />
            <div>
              <p className="text-[11px] text-taupe-400">결혼 예정일</p>
              <p className="text-[14px] font-medium text-noir-800">2026년 10월 15일</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-xl bg-ivory-50 border border-black/[0.02]">
            <Wallet className="w-5 h-5 text-gold" />
            <div>
              <p className="text-[11px] text-taupe-400">설정 예산</p>
              <p className="text-[14px] font-medium text-noir-800">₩2,150만원</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* 커플 연동 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center">
            <Heart className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h3 className="text-[15px] font-medium text-noir-800">커플 연동</h3>
            <p className="text-[12px] text-taupe-500 font-light">파트너와 함께 준비 현황을 공유하세요</p>
          </div>
        </div>

        <div className="bg-ivory-50 rounded-xl p-4 border border-black/[0.02]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[12px] text-taupe-400 mb-1">나의 커플 코드</p>
              <p className="text-[16px] font-display font-medium text-noir-800 tracking-wider">{coupleCode}</p>
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-black/[0.06] text-[12px] text-charcoal hover:border-rose-500 hover:text-rose-500 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#2E7D5A]" />
                  <span className="text-[#2E7D5A]">복사됨</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  코드 복사
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-white border border-dashed border-taupe-400/30">
            <div className="w-10 h-10 rounded-full bg-ivory-warm flex items-center justify-center">
              <User className="w-5 h-5 text-taupe-400" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] text-taupe-400 font-light">파트너 미연동</p>
              <p className="text-[11px] text-taupe-400/70">코드를 공유해서 파트너를 초대하세요</p>
            </div>
            <ChevronRight className="w-4 h-4 text-taupe-400" />
          </div>
        </div>
      </motion.div>

      {/* 알림 설정 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2E7D5A] to-[#4CAF80] flex items-center justify-center">
            <Bell className="w-4.5 h-4.5 text-white" />
          </div>
          <h3 className="text-[15px] font-medium text-noir-800">알림 설정</h3>
        </div>

        <div className="flex flex-col gap-1">
          {[
            { key: "schedule" as const, label: "일정 알림", desc: "D-day 체크리스트 리마인더" },
            { key: "budget" as const, label: "예산 알림", desc: "예산 초과 및 변동 알림" },
            { key: "ai" as const, label: "AI 추천 알림", desc: "맞춤 업체 추천, 꿀팁 안내" },
            { key: "marketing" as const, label: "마케팅 알림", desc: "이벤트, 할인 정보" },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between px-4 py-3.5 rounded-xl hover:bg-ivory-50 transition-colors"
            >
              <div>
                <p className="text-[14px] font-medium text-noir-800">{item.label}</p>
                <p className="text-[12px] text-taupe-400 font-light">{item.desc}</p>
              </div>
              <button
                onClick={() =>
                  setNotifications((prev) => ({ ...prev, [item.key]: !prev[item.key] }))
                }
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  notifications[item.key] ? "bg-rose-500" : "bg-taupe-400/30"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                    notifications[item.key] ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </motion.div>

      {/* 기타 메뉴 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden mb-6"
      >
        {[
          { label: "이용약관", href: "#" },
          { label: "개인정보 처리방침", href: "#" },
          { label: "고객센터", href: "#" },
          { label: "앱 버전", href: "#", value: "v1.0.0 (Beta)" },
        ].map((item, i) => (
          <button
            key={item.label}
            className={`w-full flex items-center justify-between px-6 py-4 hover:bg-ivory-50 transition-colors ${
              i > 0 ? "border-t border-black/[0.03]" : ""
            }`}
          >
            <span className="text-[14px] text-noir-800">{item.label}</span>
            {item.value ? (
              <span className="text-[13px] text-taupe-400">{item.value}</span>
            ) : (
              <ChevronRight className="w-4 h-4 text-taupe-400" />
            )}
          </button>
        ))}
      </motion.div>

      {/* 로그아웃 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <button className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-red-200 text-red-400 text-[14px] font-medium hover:bg-red-50 transition-colors">
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>
      </motion.div>
    </div>
  );
}
