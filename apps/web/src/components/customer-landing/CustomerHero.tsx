"use client";

import { motion } from "framer-motion";

const isComingSoonEnv = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

interface CustomerHeroProps {
  demoMode?: boolean;
}

export default function CustomerHero({ demoMode }: CustomerHeroProps = {}) {
  const isComingSoon = demoMode ? false : isComingSoonEnv;
  const accountHref = "/login?mode=signup";
  const exampleAppHref = "/demo/login";
  return (
    <section className="min-h-[100svh] flex items-center justify-center relative overflow-hidden bg-ivory-50">
      {/* 배경 */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(121,82,82,0.08),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_60%_at_80%_100%,rgba(201,169,110,0.06),transparent)]" />
      </div>

      {/* 상단·하단 라인 */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <div className="relative z-10 text-center max-w-[900px] px-[clamp(20px,5vw,60px)] py-20 md:py-24">
        {/* 로고 */}
        <motion.div
          initial={false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8 }}
          className="flex flex-col items-center mb-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/logo-main.png"
            alt="웨딩한방 로고"
            width={280}
            height={280}
            className="object-contain w-[clamp(120px,18vw,180px)] h-auto"
          />
        </motion.div>

        {/* 배지 */}
        <motion.a
          href={exampleAppHref}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="inline-flex items-center gap-3 px-5 py-2.5 bg-white/80 backdrop-blur-sm border border-platinum rounded-full mb-8 cursor-pointer hover:bg-white hover:border-rose-500/30 transition-all"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isComingSoon ? "bg-gold" : "bg-emerald-500"} animate-pulse`} />
          <span className="text-[13px] text-charcoal tracking-wide font-light">
            {isComingSoon ? "베타 준비중 · 예시 앱 체험 가능" : "베타 계정 · 예시 앱 별도 체험"}
          </span>
        </motion.a>

        {/* 메인 헤드라인 */}
        <motion.h1
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.4 }}
          className="font-serif-kr text-[clamp(40px,6vw,68px)] font-extralight leading-[1.15] tracking-tight mb-5 text-noir-800"
        >
          결혼 준비,
          <br />
          <span className="font-medium bg-gradient-to-r from-[#795252] via-[#C9A96E] to-[#B8976A] bg-clip-text text-transparent">
            한방
          </span>
          에
        </motion.h1>

        {/* 서브 카피 */}
        <motion.p
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.6 }}
          className="text-[clamp(15px,1.6vw,18px)] leading-[1.9] text-taupe-500 max-w-[480px] mx-auto mb-8 font-light"
        >
          아모라가 비교 기준을 함께 정리하고
          <br />
          일정과 예산을 커플이 한곳에서 관리하도록 돕습니다
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.8 }}
          className="flex gap-4 justify-center flex-wrap mb-10"
        >
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
            className="inline-flex items-center gap-2.5 px-10 py-4 bg-transparent text-charcoal border border-platinum rounded-full text-[15px] font-light hover:border-rose-500 hover:text-rose-500 hover:-translate-y-0.5 transition-all duration-300"
          >
            계정 없이 예시 앱 체험
          </a>
        </motion.div>

        {/* 하단 신뢰 지표 */}
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.1 }}
          className="flex justify-center gap-[clamp(24px,4vw,48px)]"
        >
          {[
            { num: "아모라", label: "필요할 때 상담" },
            { num: "커플 연동", label: "일정·예산 공유" },
            { num: "견적 체크", label: "비교 기준 정리" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-display text-[clamp(20px,3vw,28px)] font-medium bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent">
                {stat.num}
              </div>
              <div className="text-[13px] text-taupe-500 mt-1.5 font-normal tracking-wide">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* 스크롤 힌트 */}
      <motion.div
        initial={false}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 1.4 }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 max-md:hidden"
      >
        <span className="text-[10px] tracking-[0.2em] uppercase text-taupe-400">
          Scroll
        </span>
        <div className="w-px h-8 bg-gradient-to-b from-taupe-400 to-transparent animate-[scrollLine_2s_ease-in-out_infinite]" />
      </motion.div>
    </section>
  );
}
