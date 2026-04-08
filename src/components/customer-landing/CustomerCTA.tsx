"use client";

import { motion } from "framer-motion";

const isComingSoonEnv = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

interface CustomerCTAProps {
  demoMode?: boolean;
}

export default function CustomerCTA({ demoMode }: CustomerCTAProps = {}) {
  const isComingSoon = demoMode ? false : isComingSoonEnv;
  const loginHref = demoMode ? "/demo/login" : "/login";
  return (
    <section id="cta" className="relative py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] overflow-hidden">
      {/* 배경 */}
      <div className="absolute inset-0 bg-gradient-to-br from-ivory-deep via-ivory-warm to-[#F0E8DD]" />
      <div className="absolute -top-[300px] left-1/2 -translate-x-1/2 w-[min(900px,90vw)] h-[min(900px,90vw)] bg-[radial-gradient(circle,rgba(196,150,126,0.12),transparent)] rounded-full" />
      <div className="absolute bottom-[-200px] right-[-100px] w-[min(400px,70vw)] h-[min(400px,70vw)] bg-[radial-gradient(circle,rgba(201,169,110,0.08),transparent)] rounded-full" />

      <div className="relative z-10 max-w-[640px] mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.8 }}
        >
          <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5 justify-center">
            <span className="w-5 h-px bg-rose-500" />
            Get Started
          </div>

          <h2 className="font-serif-kr text-[clamp(32px,4vw,52px)] font-light leading-[1.3] tracking-tight mb-5">
            행복한 결혼 준비,
            <br />
            <em className="not-italic font-medium bg-gradient-to-br from-rose-500 to-gold bg-clip-text text-transparent">
              웨딩한방
            </em>
            과 함께
          </h2>

          <p className="text-[clamp(14px,1.8vw,16px)] text-charcoal leading-relaxed font-light mb-10">
            {isComingSoon ? (
              <>
                정식 오픈 전, 로그인 없이
                <br className="hidden md:block" />
                웨딩한방의 주요 기능을 미리 체험해보세요.
              </>
            ) : (
              <>
                지금 바로 시작하세요. 카카오 또는 구글 계정으로
                <br className="hidden md:block" />
                간편하게 가입하고 모든 기능을 무료로 이용할 수 있습니다.
              </>
            )}
          </p>

          <div className="flex gap-4 justify-center flex-wrap mb-8">
            <a
              href={loginHref}
              className="group inline-flex items-center gap-2.5 px-10 py-4 bg-noir-800 text-white rounded-full text-[15px] font-medium hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(26,26,31,0.15)] transition-all duration-300"
            >
              {isComingSoon ? "미리 둘러보기" : "무료로 시작하기"}
              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </a>
          </div>

          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[12px] text-taupe-500">
            {isComingSoon ? (
              <>
                <span>✦ 로그인 없이 체험</span>
                <span>✦ 주요 기능 미리보기</span>
                <span>✦ 완전 무료</span>
              </>
            ) : (
              <>
                <span>✦ 가입 즉시 모든 기능 이용</span>
                <span>✦ 카카오 · 구글 간편 로그인</span>
                <span>✦ 완전 무료</span>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
