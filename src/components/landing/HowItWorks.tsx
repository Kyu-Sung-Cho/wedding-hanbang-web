"use client";

import { motion } from "framer-motion";

const steps = [
  { icon: "📱", title: "앱 다운로드", desc: "회원가입 후 카카오 또는 구글로 간편 로그인" },
  { icon: "💑", title: "커플 연동", desc: "초대 코드로 파트너와 연결하면 모든 정보가 실시간 공유" },
  { icon: "🎯", title: "온보딩", desc: "결혼일, 예산, 현재 상황을 입력하면 AI가 맞춤 플랜을 세워드려요" },
  { icon: "✨", title: "AI와 함께 준비", desc: "언제든 AI에게 물어보고, 드레스 입어보고, 예산 관리하세요" },
];

export default function HowItWorks() {
  return (
    <section id="how" className="bg-ivory-warm px-5 py-[100px] md:px-[60px] md:py-[140px]">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="mx-auto mb-20 max-w-[600px] text-center"
      >
        <div className="mb-5 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-500">
          <span className="h-px w-5 bg-rose-500" />
          How It Works
        </div>
        <h2 className="mb-5 font-serif text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-[-0.02em]">
          시작은 간단합니다
        </h2>
        <p className="mx-auto max-w-[520px] text-base font-light leading-[1.75] text-charcoal">
          4단계만으로 AI 웨딩 플래너와 함께 결혼 준비를 시작하세요.
        </p>
      </motion.div>

      <div className="relative mx-auto grid max-w-[1100px] grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-4">
        {/* 연결선 (데스크탑만) */}
        <div className="absolute top-12 right-[60px] left-[60px] hidden h-px bg-gradient-to-r from-rose-pale via-gold-light to-rose-pale md:block" />

        {steps.map((step, i) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: i * 0.1 }}
            className="group relative text-center"
          >
            <div className="relative z-[1] mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full border-2 border-ivory-deep bg-white text-[32px] shadow-[0_4px_24px_rgba(0,0,0,0.06)] transition-all duration-400 group-hover:-translate-y-1 group-hover:border-rose-pale group-hover:shadow-[0_8px_32px_rgba(196,150,126,0.15)]">
              {step.icon}
              <span className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-noir-800 text-xs font-semibold text-white">
                {i + 1}
              </span>
            </div>
            <h4 className="mb-2 text-base font-medium tracking-[-0.01em]">{step.title}</h4>
            <p className="text-[13px] font-light leading-[1.6] text-taupe-500">{step.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
