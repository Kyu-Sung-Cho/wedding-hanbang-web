"use client";

import { motion } from "framer-motion";

const steps = [
  { icon: "📱", num: "1", title: "앱 다운로드", desc: "회원가입 후 카카오 또는 구글로 간편 로그인" },
  { icon: "💑", num: "2", title: "커플 연동", desc: "초대 코드로 파트너와 연결하면 모든 정보가 실시간 공유" },
  { icon: "🎯", num: "3", title: "온보딩", desc: "결혼일, 예산, 현재 상황을 입력하면 AI가 맞춤 플랜을 세워드려요" },
  { icon: "✨", num: "4", title: "AI와 함께 준비", desc: "언제든 AI에게 물어보고, 드레스 입어보고, 예산 관리하세요" },
];

export default function HowItWorks() {
  return (
    <section id="how" className="bg-ivory-warm py-[140px] px-[60px] max-md:py-20 max-md:px-5">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[600px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[47px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          How It Works
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          시작은 간단합니다
        </h2>
        <p className="text-[25px] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          4단계만으로 AI 웨딩 플래너와 함께 결혼 준비를 시작하세요.
        </p>
      </motion.div>

      <div className="grid grid-cols-4 gap-8 max-w-[1100px] mx-auto relative max-lg:grid-cols-2 max-md:grid-cols-1">
        {/* 연결선 */}
        <div className="absolute top-12 left-[60px] right-[60px] h-px bg-gradient-to-r from-rose-pale via-gold-light to-rose-pale max-lg:hidden" />

        {steps.map((step, i) => (
          <motion.div
            key={step.num}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.8, delay: i * 0.1 }}
            className="text-center relative"
          >
            <div className="w-24 h-24 rounded-full bg-white mx-auto mb-6 flex items-center justify-center text-[50px] shadow-[0_4px_24px_rgba(0,0,0,0.06)] border-2 border-ivory-deep relative z-10 hover:border-rose-pale hover:shadow-[0_8px_32px_rgba(196,150,126,0.15)] hover:-translate-y-1 transition-all duration-400">
              {step.icon}
              <span className="absolute -top-2 -right-2 w-7 h-7 bg-noir-800 text-white rounded-full text-[47px] font-semibold flex items-center justify-center">
                {step.num}
              </span>
            </div>
            <h4 className="text-[25px] font-medium mb-2 tracking-tight">{step.title}</h4>
            <p className="text-[31px] text-taupe-500 leading-relaxed font-light">{step.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
