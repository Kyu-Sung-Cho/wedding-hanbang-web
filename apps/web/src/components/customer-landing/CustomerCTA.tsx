"use client";

import { motion } from "framer-motion";

const isComingSoonEnv = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

interface CustomerCTAProps {
  demoMode?: boolean;
}

export default function CustomerCTA({ demoMode }: CustomerCTAProps = {}) {
  const isComingSoon = demoMode ? false : isComingSoonEnv;
  const accountHref = "/login?mode=signup";
  const exampleAppHref = "/demo/login";
  return (
    <section id="cta" className="relative py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] overflow-hidden">
      {/* 배경 */}
      <div className="absolute inset-0 bg-gradient-to-br from-ivory-deep via-ivory-warm to-[#F0E8DD]" />
      <div className="absolute -top-[300px] left-1/2 -translate-x-1/2 w-[min(900px,90vw)] h-[min(900px,90vw)] bg-[radial-gradient(circle,rgba(121,82,82,0.12),transparent)] rounded-full" />
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
                베타 계정 제공 상황과 별개로
                <br className="hidden md:block" />
                예시 앱은 계정 없이 바로 둘러볼 수 있습니다.
              </>
            ) : (
              <>
                베타 계정을 만들어 내 준비 정보를 저장하거나,
                <br className="hidden md:block" />
                계정 없이 별도 예시 데이터로 먼저 둘러보세요.
              </>
            )}
          </p>

          <div className="flex gap-4 justify-center flex-wrap mb-8">
            <a
              href={accountHref}
              className="group inline-flex items-center gap-2.5 px-10 py-4 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-full text-[15px] font-medium hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(121,82,82,0.25)] transition-all duration-300 shadow-[0_4px_14px_0_rgba(121,82,82,0.2)]"
            >
              베타 계정 만들기
              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </a>
            <a
              href={exampleAppHref}
              className="inline-flex items-center justify-center px-10 py-4 border border-[#36534E]/30 text-[#36534E] rounded-full text-[15px] font-medium hover:-translate-y-0.5 hover:border-[#36534E] hover:bg-white/40 transition-all duration-300"
            >
              계정 없이 예시 앱 체험
            </a>
          </div>

          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[12px] text-taupe-500">
            {isComingSoon ? (
              <>
                <span>✦ 계정 없는 예시 앱</span>
                <span>✦ 주요 기능 미리보기</span>
                <span>✦ 예시 데이터 사용</span>
              </>
            ) : (
              <>
                <span>✦ 베타 계정과 예시 앱 분리</span>
                <span>✦ 계정 없는 예시 앱</span>
                <span>✦ 공개는 직접 선택</span>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
