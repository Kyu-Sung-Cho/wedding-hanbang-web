"use client";

import { motion } from "framer-motion";

const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

const features = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
      </svg>
    ),
    title: "업체 운영정보 확인",
    desc: "업체가 공개한 상품과 운영시간을 참고해 직접 확인할 질문을 정리하세요. 업체 연결은 준비 중이며 현재 상담 요청은 전송되지 않습니다.",
    tag: "정보 확인",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
      </svg>
    ),
    title: "업체 포트폴리오 탐색",
    desc: "업체가 공개한 사진과 기본 정보를 한곳에서 살펴보세요. 최신 구성과 가능 여부는 계약 전에 업체에 직접 확인해야 합니다.",
    tag: "탐색",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
      </svg>
    ),
    title: "패키지 가격 비교",
    desc: "공개된 가격 정보와 카테고리별 시세를 함께 보며 질문할 항목을 정리하세요. 실제 견적과 포함 범위는 업체마다 다를 수 있습니다.",
    tag: "비교",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
      </svg>
    ),
    title: "상담 질문 체크리스트",
    desc: "가격, 포함·불포함, 환불·변경 조건 등 업체에 직접 확인할 질문을 정리하세요. 웨딩한방에서 업체로 문의는 전송되지 않습니다.",
    tag: "체크리스트",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
      </svg>
    ),
    title: "커플 준비 기록 공유",
    desc: "초대 코드로 파트너와 연결해 일정, 예산, 준비 진행 상황을 같은 화면에서 확인하고 업데이트할 수 있습니다.",
    tag: "커플",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
      </svg>
    ),
    title: "웨딩 예절 가이드",
    desc: "축의금 금액부터 하객 복장, 상견례 준비까지. 궁금한 결혼 예절을 상황별로 정리한 가이드를 제공합니다.",
    tag: "가이드",
  },
];

export default function CustomerFeatures() {
  return (
    <section className="bg-ivory-100 py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] relative">
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
          More Features
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          이것만으로 끝이 아닙니다
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          {isComingSoon ? "정식 베타에서 준비 중인 주요 기능을" : "현재 제공 중인 주요 기능을"}
          <br className="hidden md:block" />
          하나의 준비 공간에서 확인하세요.
        </p>
      </motion.div>

      <div className="max-w-[1100px] mx-auto grid grid-cols-3 gap-[clamp(16px,2vw,24px)] max-lg:grid-cols-2 max-md:grid-cols-1">
        {features.map((feat, i) => (
          <motion.div
            key={feat.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.7, delay: Math.min(i * 0.08, 0.3) }}
            className="group bg-ivory-warm rounded-2xl p-7 border border-transparent hover:border-rose-pale md:hover:-translate-y-2 hover:shadow-[0_20px_60px_rgba(0,0,0,0.06)] transition-all duration-500"
          >
            <div className="w-12 h-12 rounded-xl bg-noir-800 text-rose-500 flex items-center justify-center mb-5 group-hover:bg-rose-500 group-hover:text-white transition-colors duration-500">
              {feat.icon}
            </div>
            <div className="inline-block text-[11px] text-rose-500 bg-rose-500/10 px-2.5 py-1 rounded-full font-medium mb-3">
              {feat.tag}
            </div>
            <h3 className="text-[17px] font-medium mb-2.5 text-noir-800">{feat.title}</h3>
            <p className="text-[13px] text-taupe-500 leading-relaxed font-light">{feat.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
