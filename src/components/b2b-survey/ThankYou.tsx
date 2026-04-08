"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import Logo from "@/components/ui/Logo";

interface Props {
  shopTypeName: string;
}

export default function ThankYou({ shopTypeName }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-ivory-50 to-ivory-warm flex items-center justify-center px-5">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-[600px] w-full text-center"
      >
        {/* 로고 */}
        <div className="flex items-center justify-center mb-8">
          <Link href="/business">
            <Logo size="sm" />
          </Link>
        </div>

        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[var(--rose-glow)] flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C4967E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20,6 9,17 4,12" />
          </svg>
        </div>

        <h2 className="font-serif-kr text-[35px] font-light tracking-tight mb-4">
          감사합니다!
        </h2>
        <p className="text-[38px] text-charcoal font-light leading-relaxed mb-3">
          {shopTypeName} 대표님의 소중한 의견,
          <br />
          서비스 개발에 적극 반영하겠습니다.
        </p>
        <p className="text-[25px] text-taupe-500 font-light leading-relaxed mb-8">
          웨딩한방 파트너 서비스 출시 시
          <br />
          연락처를 남겨주신 분께 우선 안내드리겠습니다.
        </p>

        <Link
          href="/business"
          className="inline-flex px-8 py-3.5 rounded-full bg-noir-800 text-white text-[23px] font-medium hover:bg-noir-soft transition-colors"
        >
          웨딩한방 파트너 홈으로
        </Link>
      </motion.div>
    </div>
  );
}
