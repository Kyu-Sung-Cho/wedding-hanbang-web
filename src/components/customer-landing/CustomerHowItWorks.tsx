"use client";

import { motion } from "framer-motion";

const steps = [
  {
    num: "01",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
      </svg>
    ),
    title: "회원가입",
    desc: "웨딩한방에서 간단히 가입하고 바로 시작하세요.",
    highlight: "간편 가입",
  },
  {
    num: "02",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
      </svg>
    ),
    title: "커플 연동",
    desc: "초대 코드 한 번이면 끝. 모든 정보를 실시간으로 함께 확인하세요.",
    highlight: "초대 코드 공유",
  },
  {
    num: "03",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
      </svg>
    ),
    title: "AI 온보딩",
    desc: "결혼일, 예산, 선호도만 입력하면 AI가 맞춤 플랜을 자동 생성합니다.",
    highlight: "간단한 설정",
  },
  {
    num: "04",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
      </svg>
    ),
    title: "완벽한 결혼 준비 시작",
    desc: "AI가 D-day까지 함께합니다. 상담, 예산, 일정 모든 걸 하나의 플랫폼에서.",
    highlight: "All-in-One",
  },
];

export default function CustomerHowItWorks() {
  return (
    <section className="bg-ivory-50 py-[140px] px-[60px] relative max-md:py-20 max-md:px-5">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[640px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          How It Works
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          시작은 간단합니다
        </h2>
        <p className="text-[16px] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          4단계만 거치면 AI가 당신의 결혼 준비를
          <br className="hidden md:block" />
          처음부터 끝까지 함께합니다.
        </p>
      </motion.div>

      <div className="max-w-[1000px] mx-auto relative">
        {/* 연결 라인 (데스크톱) */}
        <div className="absolute top-[52px] left-[calc(12.5%+24px)] right-[calc(12.5%+24px)] h-[1.5px] bg-gradient-to-r from-rose-500 via-gold to-rose-500 hidden md:block" />

        <div className="grid grid-cols-4 gap-8 max-md:grid-cols-1 max-md:gap-0">
          {steps.map((step, i) => (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.7, delay: Math.min(i * 0.12, 0.3) }}
              className="text-center relative max-md:flex max-md:items-start max-md:gap-5 max-md:text-left max-md:py-6 max-md:border-l-[1.5px] max-md:border-rose-500/20 max-md:pl-7 max-md:ml-4"
            >
              {/* 모바일 타임라인 점 */}
              <div className="hidden max-md:block absolute -left-[5px] top-8 w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_0_4px_rgba(196,150,126,0.15)]" />

              <div className="w-[52px] h-[52px] rounded-2xl bg-white border border-black/[0.06] flex items-center justify-center text-rose-500 mx-auto mb-5 relative z-10 shadow-[0_4px_16px_rgba(0,0,0,0.04)] max-md:mx-0 max-md:mb-0 max-md:flex-shrink-0">
                {step.icon}
              </div>
              <div className="max-md:flex-1">
                <span className="font-display text-[12px] text-rose-500 font-semibold block mb-2">{step.num}</span>
                <h4 className="text-[16px] font-medium text-noir-800 mb-2">{step.title}</h4>
                <p className="text-[13px] text-taupe-500 font-light leading-relaxed mb-3">{step.desc}</p>
                <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2.5 py-1 rounded-full font-medium">
                  {step.highlight}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
